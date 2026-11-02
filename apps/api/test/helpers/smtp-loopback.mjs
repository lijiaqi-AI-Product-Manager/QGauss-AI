import {createServer} from 'node:net';
import {once} from 'node:events';
/** Deliberately local SMTP receiver; never relays, authenticates remotely or sends mail. */
export async function smtpLoopback(){
 const sockets=new Set(),messages=[];
 const server=createServer(socket=>{
  sockets.add(socket);socket.setEncoding('utf8');socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let pending='',data=false,lines=[],envelope={};socket.write('220 qgauss.test ESMTP fixture\r\n');
  socket.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+2);if(data){if(line!=='.'){lines.push(line.replace(/^\.\./,'.'));continue;}messages.push({...envelope,raw:lines.join('\r\n')});data=false;lines=[];socket.write('250 accepted locally\r\n');}else if(/^EHLO|^HELO/.test(line))socket.write('250-qgauss.test\r\n250 PIPELINING\r\n');else if(/^MAIL FROM:/i.test(line)){envelope={from:line.slice(10).trim()};socket.write('250 sender ok\r\n');}else if(/^RCPT TO:/i.test(line)){envelope.to=line.slice(8).trim();socket.write('250 recipient ok\r\n');}else if(line==='DATA'){data=true;socket.write('354 end with dot\r\n');}else if(line==='QUIT')socket.end('221 bye\r\n');else socket.write('250 ok\r\n');}});
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 return{port:server.address().port,messages,async close(){for(const socket of sockets)socket.destroy();await new Promise(done=>server.close(done));}};
}
export function deliveredCode(message){const raw=message.raw.replace(/=\r?\n/g,'').replace(/=([A-Fa-f\d]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));return/>\s*(\d{6})\s*</.exec(raw)?.[1]||null;}
