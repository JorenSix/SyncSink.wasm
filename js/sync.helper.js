
const audio_sample_rate = 16000; //Hz
const audio_block_size = 1024; //16000/512 = 31Hz per bin
const audio_step_size = 128; //128/16 = 8 ms

const max_filter_size_t = 29;
const max_filter_size_f = 29;
const max_fps_per_sec = 50;

const eps_per_point = 3;

const min_delta_t = 11;
const min_delta_f = 11;
const max_delta_t = 56;
const max_delta_f = 79;
const max_f = 320;


const bytes_per_element = 4;

var pffftCore = null;
var ffmpegHelper = null;

class MediaFile {

  buffer = null;
  duration = 0;
  file_name = null;

  constructor(file_name) {
    this.file_name = file_name;
  }

  asBlob(){
    return new Blob([this.buffer], { type: 'audio/' + this.extension() })
  }

  extension(){
    return this.file_name.split('.').pop();
  }

  async part(start,duration,target_sample_rate){
    
    var helper = new FFmpegHelper();
    await helper.initialzeFFmpeg();

    var outputFileName = "part.raw";
    var inputFileName = this.file_name;

    var args = ['-y','-i', inputFileName, '-ss', '' + start , '-t', '' + duration , '-vn' ,'-codec:a', 'pcm_f32le' ,'-ac','1','-f','f32le','-ar',target_sample_rate.toFixed() , outputFileName];

    if(typeof window === `undefined`)
      helper.FS().writeFile(inputFileName, new Uint8Array(this.buffer)) ;
    else
      helper.FS().writeFile(inputFileName, new Uint8Array(await this.buffer)) ;

    await helper.run(args);

    console.log("Ran ffmpeg");

    var outBuffer = helper.FS().readFile(outputFileName);
    return await new Float32Array(outBuffer.buffer);
  }

  async info(){
    
    var helper = FFmpegSingleton.getInstance();
    await helper.initialzeFFmpeg();
    var log = "";
    helper.ffmpegLogHandler = (type,message) => {log = log + '\n' + message};

    var inputFileName = this.file_name;

    var args = ['-i', inputFileName  ];

    if(typeof window === `undefined`)
      helper.FS().writeFile(inputFileName, new Uint8Array(this.buffer)) ;
    else
      helper.FS().writeFile(inputFileName, new Uint8Array(await this.buffer)) ;

    await helper.run(args);
    //console.log(log);

    var stream_info = {streams: []};

    var stream_matches = log.match(/.*Stream .\d.*/mg);
    stream_matches.forEach((m) => {
      var isAudio = m.includes('Audio');
      var isVideo = m.includes('Video');
      var stream_info_matches = m.match(/.*Stream..(\d+).(\d+).*/);
      var stream_index = 0;
      var sub_stream_index = 0;
      if(stream_info_matches){
        stream_index = parseFloat(stream_info_matches[1]);
        sub_stream_index = parseFloat(stream_info_matches[2]);
      }

      var stream_encoding_matches = m.match(/.*Stream.*(Audio|Video).(.*)/);
      var encoding_info = null;
      if(stream_encoding_matches[2])
        encoding_info = stream_encoding_matches[2];
      stream_info['streams'].push({stream_index: stream_index, sub_stream_index: sub_stream_index, is_audio: isAudio, is_video: isVideo, encoding_info: encoding_info});
    })
    console.log(stream_info);
    return stream_info;

  }

}


const initialzePFFFT = async () => {
  pffft_simd().then(async function(Module) {
    pffftCore = Module;
    //console.log("PFFFT SIMD module loaded");
  });
}


class SyncTask{

  processed = false;
  failed = false;
  input_file = null;
  output_file = null;
  log = null;
  running = false;
  delta_list = [];
  delta_tree = null;
  offset = 0;
  best_match_info = null;

  constructor(in_file){
    this.input_file = in_file;
    this.output_file = new MediaFile("out.raw");
  }

  async sync(ref_delta_tree,ref_media_file,durationHandler,progressHandler){
    if(pffftCore==null)
        initialzePFFFT();

    FFmpegSingleton.getInstance();

    //first transcode to f32le raw 16kHz
    await this.transcode(durationHandler,progressHandler);


    if(this.failed) return;

    const list_and_tree = process_blob(pffftCore,this.output_file.buffer,ref_delta_tree !=null);
    this.delta_list = list_and_tree[0];
    this.delta_tree = list_and_tree[1];

    if(ref_delta_tree != null){
      var best_offset = find_offset(ref_delta_tree,this.delta_list,ref_media_file,this.input_file);
      console.log("best offset" ,best_offset);
      var score = best_offset[1];
      this.offset = best_offset[0]/1000.0;
      this.best_match_info = best_offset; 
    }

    this.running = false;
    this.processed = true;
  }

  async transcode(durationHandler,progressHandler){
    console.log("progressHandler",progressHandler);
    this.running = true;
    var prefixIn =  ~~(Math.random() * 10000) + "_";
    var prefixOut = ~~(Math.random() * 10000)+ "_";

    const helper = new FFmpegHelper();
    await helper.initialzeFFmpeg();

    var outputExtension = this.output_file.extension();
    var outputFileName = prefixOut + this.output_file.file_name;
    var inputFileName = prefixIn + this.input_file.file_name;
    var args = [];

    args = ['-i', inputFileName, '-vn' ,'-codec:a', 'pcm_f32le' ,'-ac','1','-f','f32le','-ar','16000' ,outputFileName];

    helper.ffmpegDurationHandler = (duration) => {this.input_file.duration = duration; console.log("Handled duration:" , duration,this.input_file.duration); if(durationHandler != null) durationHandler(duration);};

    helper.ffmpegProgressHandler = (progress) => {console.log("handled progress", progress);if(progressHandler != null) progressHandler(progress);};


    if(typeof window === `undefined`)
      helper.FS().writeFile(inputFileName, new Uint8Array(this.input_file.buffer)) ;
    else
      helper.FS().writeFile(inputFileName, new Uint8Array(await this.input_file.buffer)) ;

    await helper.run(args);

    const check = helper.FS().readdir('.').find(name => (name === outputFileName));

    if (typeof check !== 'undefined') {
      this.output_file.buffer = helper.FS().readFile(outputFileName);
      this.failed = false;
    }else{
      this.failed = true;
    } 
  }
}

async function processTaskQueue(taskQueue,onTaskQueued,onTaskDone,updateDuration,updateProgress){

   for (const index in taskQueue) {
      task = taskQueue[index];
      if(task.processed) continue;
      onTaskQueued(index,task);
    }

    for (const index in taskQueue) {
      task = taskQueue[index];
      if(task.processed) continue;

      var ref_delta_tree = null;
      var ref_media_file = null;
      if(index > 0){
        ref_delta_tree = taskQueue[0].delta_tree;
        ref_media_file = taskQueue[0].input_file;
        //console.log(index,"set ref_delta_tree",ref_delta_tree);
      }

      if(verbose) console.log("Processing task: ",task);
      await task.sync(ref_delta_tree,ref_media_file,updateDuration,updateProgress);

      console.log("transcode task done" , index)
      onTaskDone(index,task);
    }
}

async function syncTaskQueue(trim_audio,taskQueue,onSyncDone){

  const channels = [];

  if(trim_audio){
    const ref_channel = new Float32Array(taskQueue[0].output_file.buffer.buffer);
    channels.push(ref_channel);

    for(var taskIndex = 1 ; taskIndex < taskQueue.length ; taskIndex++){
      const task = taskQueue[taskIndex];
      const synced_channel  = trim(task.output_file.buffer,task.offset);
      channels.push(synced_channel);
    }
  }else {
    //extended version:
    var largest_neg_offset = 0;
    for(var taskIndex = 1 ; taskIndex < taskQueue.length ; taskIndex++){
      largest_neg_offset = Math.min(largest_neg_offset,task.offset);
    }
    //first fix the ref: add zero to the start of ref
    console.log("largest_neg_offset",largest_neg_offset)
    const ref_channel = trim(taskQueue[0].output_file.buffer,-1 * largest_neg_offset);
    channels.push(ref_channel);
    for(var taskIndex = 1 ; taskIndex < taskQueue.length ; taskIndex++){
      const task = taskQueue[taskIndex];
      const synced_channel  = trim(task.output_file.buffer,task.offset - largest_neg_offset);
      channels.push(synced_channel);
    }
  } 

  //now the start is fixed but ffmpeg by defaut trims to the shortest media, append silence to the end 
  //  to match reference (in case of trim)
  //  to make sure all audio is used (in case of extend)
  if(trim_audio){

    const ref_length_in_seconds = channels[0].length / audio_sample_rate;

    for(var chanelIndex = 1 ; chanelIndex < channels.length ; chanelIndex++){
      const channel_length_in_seconds = channels[chanelIndex].length / audio_sample_rate;
      var seconds_to_append = ref_length_in_seconds - channel_length_in_seconds;
      if(seconds_to_append > 0) channels[chanelIndex] = append(channels[chanelIndex], seconds_to_append);
    }

  } else {

    var longest_channel_in_seconds = 0;
    for(var chanelIndex = 0 ; chanelIndex < channels.length ; chanelIndex++){
      const channel_length_in_seconds = channels[chanelIndex].length / audio_sample_rate;
      longest_channel_in_seconds = Math.max(longest_channel_in_seconds,channel_length_in_seconds)
    }

    //extend all audio to have the longest length:
    for(var chanelIndex = 0 ; chanelIndex < channels.length ; chanelIndex++){
       const channel_length_in_seconds = channels[chanelIndex].length / audio_sample_rate;
      var seconds_to_append = longest_channel_in_seconds - channel_length_in_seconds;
      if(seconds_to_append > 0) channels[chanelIndex] = append(channels[chanelIndex], seconds_to_append);
    }
  }

  const ffmpegHelper = new FFmpegHelper();
  await ffmpegHelper.initialzeFFmpeg();

  var filter_complex = "";

  var args = [];
  for(var chanelIndex = 0 ; chanelIndex < channels.length ; chanelIndex++){
        var input_file_name = chanelIndex + ".raw";
        ffmpegHelper.FS().writeFile(input_file_name, new Uint8Array(channels[chanelIndex].buffer));
        ['-f', 'f32le','-ac', '1', '-ar', '16000', '-i', input_file_name].forEach((e) => {args.push(e)});
        filter_complex = filter_complex.concat("[" + chanelIndex + ":0]");
  }

  var outputFileName = "multichannel_out.wav";

  var output_args = ['-filter_complex',  filter_complex +'amerge=inputs=' + channels.length +'[a]','-map', '[a]',outputFileName ];
  output_args.forEach((e) => {args.push(e)});

  await ffmpegHelper.run(args);

  onSyncDone(ffmpegHelper.FS().readFile(outputFileName));
}

class EventPoint {
  constructor(t,f,m) {
    this.t = t;
    this.f = f;
    this.m = m;
  }

  tooFarFrom(other){
    var in_t_range = (this.t <= other.t  && other.t <= (this.t + max_delta_t));
    //console.log("in t range" , in_t_range,this,other);
    return !in_t_range; 
  }

  isInRange(other){
    var in_t_range = (this.t + min_delta_t) <= other.t  && other.t <= (this.t + max_delta_t);
    var in_pos_f_range = (this.f + min_delta_f) <= other.f && other.f <= (this.f + max_delta_f);
    var in_neg_f_range = (this.f - max_delta_f) <= other.f && other.f <= (this.f + min_delta_f);
    return (in_t_range && (in_pos_f_range || in_neg_f_range));
  }

  tInAudioSamples(){
    return (this.t * audio_step_size) / audio_sample_rate * 16000.0 ;
  }

  fInMidiPitch(){
    var inHz = this.f * audio_sample_rate / audio_block_size;
    return inHz;
    //return 69 + 12 * Math.log(inHz/440) / Math.log(2);
  }
}


//ffmpeg -hide_banner -y -loglevel panic  -i ../../test/demo.wav -ac 1 -ar 16000 -f f32le -acodec pcm_f32le ../../test/demo.raw

function stft(Module,audio_all_data){
  var magnitudes = new Array();

  var pffft_runner = Module._pffft_runner_new(audio_block_size,bytes_per_element);
  // Get data byte size, allocate memory on Emscripten heap, and get pointer
  var nDataBytes = audio_block_size * audio_all_data.BYTES_PER_ELEMENT;
  var dataPtr = Module._malloc(nDataBytes);
  // Copy data to Emscripten heap (directly accessed from Module.HEAPU8)
  var dataHeap = new Uint8Array(Module.HEAPU8.buffer, dataPtr, nDataBytes);

  for(var audio_sample_index = 0 ; audio_sample_index < audio_all_data.length - audio_block_size ; audio_sample_index  += audio_step_size){

    const audio_block_data = audio_all_data.slice(audio_sample_index,audio_sample_index+audio_block_size);

    dataHeap.set(new Uint8Array(audio_block_data.buffer));
    // Call function and get result
    Module._pffft_runner_transform(pffft_runner,dataHeap.byteOffset);
    var fft_result = new Float32Array(dataHeap.buffer, dataHeap.byteOffset, audio_block_data.length);

    var current_magnitudes = new Float32Array(audio_block_size/2);

    for (var i = 0; i < audio_block_size; i+=2) {
      //var hz = Math.round(audio_sample_rate / audio_block_size  * i / 2.0);
      var bin_magnitude = fft_result[i] * fft_result[i] + fft_result[i+1] * fft_result[i+1];
      //if(bin_magnitude > 1 ) console.log("index , ",audio_sample_index, "#,",i,",",hz,"Hz",bin_magnitude);
      current_magnitudes[i/2] = bin_magnitude;
    }
    magnitudes.push(current_magnitudes);
  }

  Module._free(dataPtr);
  Module._pffft_runner_destroy(pffft_runner);

  return magnitudes;
}


function filter_f(magnitudes,max_mags){
  //a max filter in columns (frequency)
  //This should run fast: worst case O(n*m*filter_size)
  //
  for(var t = 0 ; t < magnitudes.length ; t++){
    for(var f = 0 ; f < magnitudes[t].length  ; f++){

      if(max_mags[t][f]==0) continue;

      var start = Math.max(f-max_filter_size_f,0);
      var stop = Math.min(f+max_filter_size_f,magnitudes[t].length);
   
      for(var other_f = start;other_f < stop ; other_f++){
        if(magnitudes[t][other_f]>magnitudes[t][f]){
          max_mags[t][f] = 0;
          break;
        }
      }
    }
  }
}

function filter(magnitudes,max_mags){
  //a max filter in columns (frequency)
  //This should run fast: worst case O(n*m*filter_size)
  //
  for(var t = 0 ; t < magnitudes.length  ; t++){
  
    for(var f = 0 ; f < magnitudes[t].length; f++){

      if(max_mags[t][f]==0) {
        continue;
      }

      var start_f = Math.max(f-max_filter_size_f,0);
      var stop_f = Math.min(f+max_filter_size_f,magnitudes[t].length);

      var start_t = Math.max(t-max_filter_size_t,0);
      var stop_t = Math.min(t+max_filter_size_t,magnitudes.length);

      var maxValue = -10000;

      for(var other_f = start_f;other_f < stop_f ; other_f++){
        for(var other_t = start_t;other_t < stop_t ; other_t++){
          if( magnitudes[other_t][other_f]>maxValue){
            maxValue = magnitudes[other_t][other_f];
          }
        }
      }

      max_mags[t][f] = maxValue;

    }
  }
}


function filter_t(magnitudes,max_mags){
  //a max filter in columns (frequency)
  //This should run fast: worst case O(n*m*filter_size)
  //
  for(var f = 0 ; f < magnitudes[0].length ; f++){

    for(var t = 0 ; t < magnitudes.length  ; t++){

      if(max_mags[t][f]==0) continue;

      var start = Math.max(t-max_filter_size_t,0);
      var stop = Math.min(t+max_filter_size_t,magnitudes.length);

      for(var other_t = start;other_t < stop ; other_t++){
        if(magnitudes[other_t][f]>magnitudes[t][f]){
          max_mags[t][f] = 0;
          break;
        }
      }
    }
  }
}

function pack_eps(magnitudes,max_mags){
  var eps = new Array();
  for(var t = 0 ; t < magnitudes.length ; t++){
    //ignore everything above max_f
    for(var f = 1 ; f < max_f  ; f++){
      if(magnitudes[t][f] == max_mags[t][f] && magnitudes[t][f] !=0 ){
        eps.push(new EventPoint(t,f,magnitudes[t][f]));
      }
    }
  }
  return eps;
}


function combine_eps(filtered_eps,index,ep_accum,fp_accum,max){
  var start_ep = filtered_eps[index];
  ep_accum.push(start_ep);

  //stop condition
  if(ep_accum.length == max){
    const clone = [...ep_accum];


    fp_accum.push(clone);
    ep_accum.pop(); 
    return;
  }

  for(var other_index = index + 1 ; other_index < filtered_eps.length ; other_index++){
    var other_ep = filtered_eps[other_index];

    if(start_ep.tooFarFrom(other_ep)) break;
    if(!start_ep.isInRange(other_ep)) continue;

    //go deeper!
    combine_eps(filtered_eps,other_index,ep_accum,fp_accum,max);
  }
}


function create_delta_list(fps){
  var delta_list = new Array(); 

  for(var i = 0 ; i < fps.length ; i++){
    var ep1 = fps[i][0];
    var ep2 = fps[i][1];
    var ep3 = fps[i][2];

    var delta_t1 = ep2.t -  ep1.t ;
    var delta_t2 = ep3.t -  ep2.t  ;

    var delta_f1 = ep1.f - ep2.f;
    var delta_f2 = ep1.f - ep3.f;

    delta_list.push([delta_t1,delta_f1,delta_t2,delta_f2,ep1.t]);
    //console.log(i,`(${fps[i][0].t },${fps[i][0].f}) (${fps[i][1].t},${fps[i][1].f}) (${fps[i][2].t},${fps[i][2].f})`);
    //console.log(i,"🔺t1:",delta_t1 ,"🔺t2:" , delta_t2 ,"🔺f1:" , delta_f1, " 🔺f2 " , delta_f2);
    //console.log("");
  }

  const distance = (a, b) => {
    const dist =  Math.pow(a[0] - b[0], 2) +  Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2)  + Math.pow(a[3] - b[3], 2) ;
    return dist;
  }
  var tree = new kdTree(delta_list, distance, [0,1,2,3]);

  console.log("Delta list size:",delta_list.length);

  return [delta_list,tree];
}


function trim(blob,offset){
  //offset in seconds, 
  // zero offset means do nothing
  // negative offset means cut the first x seconds off
  // positive offset means add x seconds of silence
  let buffer = blob.buffer;
  //console.log("Buffer to trim",buffer);
  //console.log("Buffer to trim",blob);
  const audio_untrimmed = new Float32Array(blob.buffer);
  const number_of_samples_to_trim = Math.round(audio_sample_rate * offset);

  console.log("Untrimmed audio length (s)",audio_untrimmed.length / audio_sample_rate);

  console.log("Trim with offset: " , offset, " samples to trim ",number_of_samples_to_trim);
  var audio_trimmed = null;
  if(number_of_samples_to_trim == 0){
    audio_trimmed = audio_untrimmed
  }else if(number_of_samples_to_trim < 0){
    audio_trimmed = audio_untrimmed.slice(number_of_samples_to_trim * -1);
  }else if(number_of_samples_to_trim > 0){
    audio_trimmed = new Float32Array(number_of_samples_to_trim + audio_untrimmed.length);
    audio_trimmed.set(audio_untrimmed, number_of_samples_to_trim);
  }
  console.log("Trimmed audio length (s)", audio_trimmed.length / audio_sample_rate);


  return audio_trimmed;
}


function append(blob,appendage){
  //appendage in seconds, 
  // zero appendage means do nothing
  // positive appendage means add x seconds of silence at the end
  let buffer = blob.buffer;
  //console.log("Buffer to trim",buffer);
  //console.log("Buffer to trim",blob);
  const audio_unappended = new Float32Array(blob.buffer);
  const number_of_samples_to_append = Math.round(audio_sample_rate * appendage);

  console.log("Unappended audio length (s) ",audio_unappended.length / audio_sample_rate);

  console.log("Extend with appendage: " , appendage, " samples to append ",number_of_samples_to_append);
  var audio_appended = null;
  if(number_of_samples_to_append == 0){
    audio_appended = audio_unappended
  }else if(number_of_samples_to_append > 0){
    audio_appended = new Float32Array(number_of_samples_to_append + audio_unappended.length);
    audio_appended.set(audio_unappended, 0);
  }
  console.log("Appended length (s): ", audio_appended.length / audio_sample_rate);

  return audio_appended;
}


function process_blob(Module,blob,ref){
  
  const audio_all_data = new Float32Array(blob.buffer);

  var magnitudes = stft(Module,audio_all_data);
  var max_mags = new Array();
  
  //Clone magnitudes
  magnitudes.forEach((a) => {max_mags.push(new Float32Array(a))});

  //Run max filter
  filter_f(magnitudes,max_mags);
  filter_t(magnitudes,max_mags);
  filter(magnitudes,max_mags);

  //Create a list of Event Points
  eps = pack_eps(magnitudes,max_mags);
  console.log("all eps",eps.length);

  var fps = [];
  for(var i = 0 ; i < eps.length ; i++){
    combine_eps(eps,i,[],fps,3);
  }

  console.log("Create 🔺 lists");

  var ref_delta_list = create_delta_list(fps);
  return ref_delta_list;
}

// sort array ascending
const asc = arr => arr.sort((a, b) => a - b);

const sum = arr => arr.reduce((a, b) => a + b, 0);

const mean = arr => sum(arr) / arr.length;

// sample standard deviation
const std = (arr) => {
    const mu = mean(arr);
    const diffArr = arr.map(a => (a - mu) ** 2);
    return Math.sqrt(sum(diffArr) / (arr.length - 1));
};

const quantile = (arr, q) => {
    const sorted = asc(arr);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
};


class Match{
  match_time = 0;
  query_time = 0;

  constructor(match_time,query_time){
    this.match_time = match_time;
    this.query_time = query_time;
    this.delta = this.match_time - this.query_time;
  }

  diff(){
    return this.match_time - this.query_time;
  }
}

function mostCommonDeltaT(matches){
  const delta_t_hash = {};
  var maxCount = 0;
  var mostCommonDeltaT = 0;

  matches.forEach((m) => {
    const diff = m.diff();
    if(diff in delta_t_hash){
      delta_t_hash[diff]= 1 + delta_t_hash[diff];
    }else{
      delta_t_hash[diff] = 1;
    }

    if(delta_t_hash[diff] > maxCount){
      maxCount = delta_t_hash[diff];
      mostCommonDeltaT = diff; 
    }
  });
  
  return mostCommonDeltaT;
}

function firstQueryTimeWithDelta(matches, diff){
  for(var i = 0 ; i < matches.length ; i++){
    const m = matches[i];
    if(diff == m.diff()) return m.query_time;       
  }
  return 0;
}

function find_offset(ref_delta_tree,offset_delta_list,ref_media_file,other_media_file){
  var matches = [];
  const max_dist = 10;
  const max_result_size = 0.10;

  for(var i = 0 ; i < offset_delta_list.length ; i++){
    var needle = offset_delta_list[i];
    
     var nearest_results = ref_delta_tree.nearest(needle, max_result_size ,max_dist);
     for(var j = 0 ; j < nearest_results.length ; j ++){

        var nearest_delta_list = nearest_results[j][0];
        var nearest_distance = nearest_results[j][1];
        var nearest = nearest_delta_list;

        const t1_needle = needle[4];
        const t1_nn = nearest[4];

        console.log(t1_needle,t1_needle - t1_nn, nearest_distance)
        
        matches.push(new Match(t1_nn,t1_needle));
     }
  }

  //remove random time diffs
  const min_diff_count = 3;
  //first count each diff
  diffs = {};
  matches.forEach((m) => {
    const diff = m.diff();
    if( ! (diff  in diffs)) diffs[diff] = [];
    diffs[diff].push(m);
  });
  matches_with_common_diffs = [];
  //fill list only with matches with more than 5 diffs
  Object.values(diffs).forEach((match_list) => {
    if(match_list.length >= min_diff_count)
      match_list.forEach((m) => {matches_with_common_diffs.push(m)});
  });

  //Take into account lineair time modification

  //sort by time
  matches_with_common_diffs.sort(function(first, second) {
    return first.query_time - second.query_time;
  });

  //first matches
  var start = 0;
  var end = Math.min(matches_with_common_diffs.length,Math.min(100,Math.max(10,matches_with_common_diffs.length/5)));
  const firstMatches = matches_with_common_diffs.slice(start,end);

  var start = matches_with_common_diffs.length-Math.min(100, Math.max(10,matches_with_common_diffs.length/5))
  var end = matches_with_common_diffs.length;
  const lastMatches = matches_with_common_diffs.slice(start,end);

  var y1 = mostCommonDeltaT(firstMatches);
  var x1 = firstQueryTimeWithDelta(firstMatches,y1);

  var y2 = mostCommonDeltaT(lastMatches);
  var x2 = firstQueryTimeWithDelta(lastMatches,y2);

  const slope = (y2-y1)/(x2-x1);
  const offset = -x1 * slope + y1;
  const timeFactor = 1-slope;

  var filteredMatches = [];
  matches.forEach((m) => {
    var yActual = m.diff();
    var x = m.query_time;
    var yPredicted = slope * x + offset;
     
    //should be within an expected range
    var yInExpectedRange = Math.abs(yActual-yPredicted) <= 8;
    if(yInExpectedRange) {
       filteredMatches.push(m);
    }
  });


  //sort filtered matches by time
  filteredMatches.sort(function(first, second) {
    return first.query_time - second.query_time;
  });

  var result = [0,0,0,0,0,[]];

  //assumes single good match
  if (filteredMatches.length > 5){
    const match_times = filteredMatches.map((m) => {return m.match_time});
    const t_difference_in_ms = filteredMatches[~~(filteredMatches.length/2)].diff() * audio_step_size/audio_sample_rate * 1000;
    const t_0 = filteredMatches[0].match_time;
    const t_100 = filteredMatches[filteredMatches.length - 1].match_time;;
    const t_match_duration_time_ms = (t_100 - t_0)  * audio_step_size/audio_sample_rate * 1000;
  
    //how much of the extracted fps match with the query for percentile 10 -> 90 to exclude outliers?
    var match_percentage = filteredMatches.length /matches.length;
    match_percentage = Math.min(1,match_percentage);

    result = [t_difference_in_ms ,filteredMatches.length, t_match_duration_time_ms, match_percentage,timeFactor,filteredMatches];

    var refined_difference_in_ms = t_difference_in_ms;

    //improve if 
  
    //pick the 'best' second here?
    const t_q10_in_ms = filteredMatches[~~(filteredMatches.length/2)].match_time * audio_step_size/audio_sample_rate * 1000;
    refine_difference(t_difference_in_ms,ref_media_file,other_media_file,t_q10_in_ms,result);
    
  }

  return result;
}

async function refine_difference(diff_in_ms,ref_media_file,other_media_file,t_q10_in_ms,mapped_item){
  
  const audio_sample_rate = 4000;
  const other_start = t_q10_in_ms/1000;
  const duration_in_sec = 1;
  const ref_start = (t_q10_in_ms + diff_in_ms) / 1000;
  console.log("Refine: ", diff_in_ms,ref_media_file.file_name,other_media_file.file_name,t_q10_in_ms);
  console.log("ref start (s)",ref_start," other start ", other_start);

  const ref_part = await ref_media_file.part(ref_start,duration_in_sec,audio_sample_rate);
  const corresponding_other_part = await other_media_file.part(other_start,duration_in_sec,audio_sample_rate);

  var lag_in_samples =  crossCorrelation(corresponding_other_part,ref_part);
  if(lag_in_samples > ref_part.length/2) {
    lag_in_samples = ref_part.length - lag_in_samples;
    lag_in_samples = -lag_in_samples;
  }

  const lag_in_ms = lag_in_samples / audio_sample_rate * 1000;
  var total_difference = diff_in_ms - lag_in_ms;

  const range = 16;
  if( Math.abs(total_difference - diff_in_ms) < range ) {
    console.log("Refine success: total dff ", total_difference, " lag in ms ", lag_in_ms , " diff start ", diff_in_ms);
  } else {
    console.log("Refine failed reset total difference", total_difference, " to ", diff_in_ms, " lag_in_ms ", lag_in_ms);
    total_difference = diff_in_ms;
  }
  mapped_item[0] = total_difference;

  return total_difference;
}



function crossCorrelation(one, other) {
  console.log(one);
  console.log(other);
  var maxIndex = -1;
  var maxValue = -1000;
    
  for(var lag = 0 ; lag < one.length ; lag++) {
    var accum = 0;
    for(var i = 0 ; i < other.length ; i++) {
      var other_index = ~~((i+lag) % other.length);
      accum += other[i] * one[other_index];
    }
    if(accum > maxValue) {
      maxValue = accum;
      maxIndex = lag;
    }
  }
  return maxIndex;
}



if(typeof window === `undefined`)
module.exports = { process_blob, find_offset,crossCorrelation, MediaFile: MediaFile,  SyncTask: SyncTask };





