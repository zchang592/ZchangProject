// Convert already-decoded mono/stereo audio into a simple PCM WAV.
export function encodeWav(buffer) {
  const channels=buffer.numberOfChannels, frames=buffer.length, rate=buffer.sampleRate;
  if (![1,2].includes(channels)) throw new Error('仅支持提取单声道或立体声音频。');
  if (!Number.isInteger(frames) || frames<=0 || !Number.isFinite(rate) || rate<=0) throw new Error('音频数据无效。');
  const dataBytes=frames*channels*2;
  if (dataBytes>200*1024*1024) throw new Error('提取后的音频过大，请手动处理。');
  const result=new ArrayBuffer(44+dataBytes), view=new DataView(result);
  const write=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  write(0,'RIFF');view.setUint32(4,36+dataBytes,true);write(8,'WAVE');write(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);
  view.setUint16(32,channels*2,true);view.setUint16(34,16,true);
  write(36,'data');view.setUint32(40,dataBytes,true);
  const samples=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
  let offset=44;
  for(let i=0;i<frames;i++) for(let c=0;c<channels;c++){
    const sample=Math.max(-1,Math.min(1,samples[c][i]||0));
    view.setInt16(offset,sample<0?sample*0x8000:sample*0x7fff,true);offset+=2;
  }
  return new Blob([result],{type:'audio/wav'});
}

export async function extractWav(blob) {
  if(blob.size>100*1024*1024)throw new Error('视频超过100 MB，请手动提取音频。');
  const AudioCtx=globalThis.AudioContext || globalThis.webkitAudioContext;
  if(!AudioCtx)throw new Error('当前浏览器不支持提取音频。');
  const context=new AudioCtx();
  try {
    let decoded;
    try {decoded=await context.decodeAudioData(await blob.arrayBuffer());}
    catch (_) {throw new Error('浏览器无法解码此视频，请手动提取音频后上传。');}
    if(decoded.duration>20*60)throw new Error('音频超过20分钟，请手动提取。');
    return {blob:encodeWav(decoded),duration:decoded.duration,sampleRate:decoded.sampleRate};
  } finally {await context.close();}
}
