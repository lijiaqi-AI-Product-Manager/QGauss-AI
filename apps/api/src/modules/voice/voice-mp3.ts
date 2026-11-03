/** Join complete Layer III streams while removing per-file tags and obsolete seek headers. */
export function mergeVoiceMp3(parts:Buffer[]){
 if(!parts.length||parts.reduce((n,b)=>n+b.length,0)>32*1024*1024)throw Error('声音文件不完整或超过整理上限。');
 if(parts.length===1)return parts[0];
 const output:Buffer[]=[];let format='';
 for(const buffer of parts){let offset=0,frames=0;
  if(buffer.length>=10&&buffer.toString('ascii',0,3)==='ID3'){
   if(![2,3,4].includes(buffer[3])||buffer.subarray(6,10).some(byte=>byte>127))throw Error('声音文件的标记无效。');
   offset=10+(buffer[6]<<21)+(buffer[7]<<14)+(buffer[8]<<7)+buffer[9]+(buffer[3]===4&&buffer[5]&16?10:0);if(offset>buffer.length)throw Error('声音文件的标记不完整。');
  }
  while(offset<buffer.length){
   if(buffer.length-offset===128&&buffer.toString('ascii',offset,offset+3)==='TAG')break;
   if(buffer.length-offset<=2048&&buffer.subarray(offset).every(byte=>byte===0))break;
   if(offset+4>buffer.length)throw Error('声音文件的末段不完整。');
   const h=buffer.readUInt32BE(offset),version=(h>>>19)&3,layer=(h>>>17)&3,rate=(h>>>12)&15,sample=(h>>>10)&3;
   if((h>>>21)!==2047||version===1||layer!==1||!rate||rate===15||sample===3)throw Error('各段声音暂时无法整理为完整 MP3，可以继续分段重听。');
   const mono=((h>>>6)&3)===3,bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[rate],hz=[44100,48000,32000][sample]/(version===3?1:version===2?2:4),length=Math.floor((version===3?144000:72000)*bitrate/hz)+((h>>>9)&1);
   if(offset+length>buffer.length)throw Error('有一段声音尚未完整保存。');const signature=version+':'+hz+':'+mono;if(format&&format!==signature)throw Error('各段声音的格式不同，暂时无法合并，可以继续分段重听。');format=signature;
   const side=version===3?(mono?17:32):(mono?9:17),start=offset+4+(((h>>>16)&1)?0:2)+side,marker=buffer.toString('ascii',start,start+4),vbri=buffer.toString('ascii',offset+36,offset+40),seek=frames===0&&(['Xing','Info'].includes(marker)||vbri==='VBRI');
   if(!seek)output.push(buffer.subarray(offset,offset+length));frames++;offset+=length;
  }
  if(!frames)throw Error('有一段声音没有完整音频帧。');
 }
 if(!output.length)throw Error('声音文件没有可保存的音频。');return Buffer.concat(output);
}
