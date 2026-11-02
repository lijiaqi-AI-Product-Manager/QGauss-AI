/** Native asynchronous video fixture. Only imported by the isolated fake upstream. */
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const movie = await readFile(new URL('./fixtures/qgauss-video.mp4', import.meta.url)), poster = await readFile(new URL('./fixtures/qgauss-video-poster.png', import.meta.url));
const jobs = new Map(), calls = [], sha = b => createHash('sha256').update(b).digest('hex');
async function source(url) { const u = new URL(url); if (u.hostname !== '127.0.0.1' || !/^\/api\/video\/input\//.test(u.pathname) && !/^\/video-fixture\/assets\//.test(u.pathname)) throw Error('Fixture refuses non-local source'); const r = await fetch(u, { signal: AbortSignal.timeout(5000) }), bytes = Buffer.from(await r.arrayBuffer()); return { status: r.status, bytes: bytes.length, sha256: sha(bytes) }; }
export async function videoUpstreamFixture(req, res) {
  const url = new URL(req.url, 'http://' + req.headers.host); if (!url.pathname.startsWith('/video-fixture/')) return false;
  const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/video-fixture/stats') { reply(200, { calls, jobs: [...jobs.values()].map(j => ({ id:j.id,profile:j.profile,prompt:j.prompt,auth:j.auth,polls:j.polls,released:j.released,canceled:j.canceled,sourceImage:j.sourceImage,sourceVideo:j.sourceVideo,inputUrl:j.inputUrl,body:j.observed })) }); return true; }
  const release = /^\/video-fixture\/release\/(.+)$/.exec(url.pathname); if (release) { const job = jobs.get(release[1]); if (job) job.released = true; reply(200, {}); return true; }
  if (url.pathname.startsWith('/video-fixture/assets/')) { const invalid = url.pathname.includes('invalid'); const bytes = invalid ? Buffer.from('not an MP4') : url.pathname.endsWith('.png') ? poster : movie; res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.png') ? 'image/png' : 'video/mp4', 'Content-Length': bytes.length }); res.end(bytes); return true; }
  const profile = url.pathname.includes('/pika/') ? 'PIKA_1' : 'ARK', match = profile === 'PIKA_1' ? /\/web\/jobs\/([^/]+)$/.exec(url.pathname) : /\/contents\/generations\/tasks\/([^/]+)$/.exec(url.pathname), auth = String(req.headers.authorization || '');
  if (match) {
    const job = jobs.get(match[1]); if (!job) { reply(404, {}); return true; }
    calls.push({ method:req.method,id:job.id,auth });
    if (req.method === 'DELETE') { if (!job.prompt.includes('[fixture:hold]') || job.released || job.prompt.includes('[fixture:running]')) { reply(409, {}); return true; } job.canceled = true; res.writeHead(204).end(); return true; }
    job.polls++; const failed = job.prompt.includes('[fixture:fail]'), held = job.prompt.includes('[fixture:hold]') && !job.released, queued = held && !job.prompt.includes('[fixture:running]'), done = !held && job.polls >= 2;
    const base = 'http://' + req.headers.host + '/video-fixture/assets/' + (job.prompt.includes('[fixture:invalid]') ? 'invalid-' : '') + job.id;
    if (profile === 'PIKA_1') reply(200, { job: { id: job.id, status:job.canceled?'canceled':failed?'failed':done?'finished':queued?'queued':'processing',progress:done?100:45 },videos:done?[{jobId:job.id,resultUrl:base+'.mp4',videoPoster:base+'.png',status:'finished',progress:100,seed:0}]:[] });
    else reply(200, { id:job.id,status:job.canceled?'cancelled':failed?'failed':done?'succeeded':queued?'queued':'running',progress:done?100:52,seed:0,...(done?{content:{video_url:base+'.mp4',last_frame_url:base+'.png'}}:{}) }); return true;
  }
  let body; try { const chunks=[];for await(const part of req)chunks.push(part);body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(400,{});return true; }
  const prompt = profile === 'PIKA_1' ? body.promptText : body.content?.find(c=>c.type==='text')?.text || '', id='vg-'+randomUUID();
  const observed = profile==='PIKA_1'?body:{...body,content:body.content.map(c=>c.type==='image_url'?{type:c.type,role:c.role,sha256:sha(Buffer.from(c.image_url.url.split(',')[1]||'','base64'))}:c)};
  const job={id,profile,prompt,auth,body,observed,polls:0,released:false,canceled:false};calls.push({method:req.method,id,auth,action:url.pathname});
  if(prompt.includes('[fixture:reject]')){reply(400,{error:{message:'synthetic rejection'}});return true;}
  try { if(body.image){job.inputUrl=body.image;job.sourceImage=await source(body.image);} const video=body.video||body.content?.find(c=>c.type==='video_url')?.video_url?.url;if(video){job.inputUrl=video;job.sourceVideo=await source(video);} }catch{reply(400,{error:{message:'synthetic source read failed'}});return true;}
  jobs.set(id,job);
  if(prompt.includes('[fixture:unknown]')){res.writeHead(200,{'Content-Type':'application/json'}).end('{');return true;}
  if(prompt.includes('[fixture:submit-hold]')){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');return true;}
  reply(200,profile==='PIKA_1'?{job:{id,status:'queued'}}:{id});return true;
}
