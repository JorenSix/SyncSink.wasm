const fs = require('fs');

const createFFmpegCore = require('./wasm/ffmpeg.audio.core/v5/ffmpeg.core');
const ffmpegHelper = require('./js/ffmpeg.helper.js');
const syncer = require('./js/sync.helper.js');

//Make some classes and methods globally available as a browser does
global.createFFmpegCore = createFFmpegCore;
global.FFmpegHelper = ffmpegHelper.FFmpegHelper;
global.FFmpegSingleton = ffmpegHelper.FFmpegSingleton;


let MediaFile = syncer.MediaFile;

async function mediaInfo(media_file){
  var m = new MediaFile("demo.wav");
  m.buffer = fs.readFileSync(media_file);
  await m.info();
}
