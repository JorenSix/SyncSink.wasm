const fs = require('fs');

const pffft = require('./wasm/pffft/pffft');
const createFFmpegCore = require('./wasm/ffmpeg.audio.core/v5/ffmpeg.core');
const ffmpegHelper = require('./js/ffmpeg.helper.js');
const syncer = require('./js/sync.helper.js');
const KdTree = require('./js/kdTree.js');

//Make some classes and methods globally available as a browser does
global.createFFmpegCore = createFFmpegCore;
global.FFmpegHelper = ffmpegHelper.FFmpegHelper;
global.FFmpegSingleton = ffmpegHelper.FFmpegSingleton;
global.pffft_simd = pffft;
global.kdTree = KdTree.kdTree;

let MediaFile = syncer.MediaFile;
let SyncTask = syncer.SyncTask;

async function sync(){
  //reads an audio file as a single Float32Array 
  var ref_file = '../../../test/MN-00004474 [30] .mp3';
  var other_file = '../../../test/OTA_10s_MN-00004474 [30] .wav';


  var refFile = new MediaFile("ref.mp3");
  refFile.buffer = fs.readFileSync(ref_file);
  var ref_task = new SyncTask(refFile);
  await ref_task.sync(null,null);
  var ref_delta_tree = ref_task.delta_tree
  
  var otherFile = new MediaFile("other.mp3");
  otherFile.buffer = fs.readFileSync(other_file);
  var task = new SyncTask(otherFile);
  await task.sync(ref_delta_tree,null);

}

sync();
