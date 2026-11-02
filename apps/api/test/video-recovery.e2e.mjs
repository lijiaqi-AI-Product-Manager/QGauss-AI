/** Real process crashes with native asynchronous jobs, private media and one durable charge. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync,readFileSync } from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { LedgerService } from '../dist/modules/commerce/ledger.service.js';
import { VideoAccountingService } from '../dist/modules/video/video-accounting.service.js';
import { upgradeIsolatedDatabase } from './isolated-migrations.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), directory = mkdtempSync(join(tmpdir(), 'qgauss-video-recovery-')), database = join(directory, 'recovery.db');
const source = new DatabaseSync(join(root, 'prisma/dev.db'), { readOnly: true }); try { await backup(source, database); } finally { source.close(); } await upgradeIsolatedDatabase(database);
const fake = new URL(process.env.E2E_FAKE).origin, tag = randomBytes(6).toString('hex'), probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(done => probe.close(done));
const base = 'http://127.0.0.1:' + port + '/api', env = { ...process.env, PORT: String(port), NODE_ENV: 'test', DATABASE_URL: 'file:' + database.replace(/\\/g, '/'), MAIL_SMTP_HOST: '', STORAGE_DRIVER: 'local', STORAGE_DIR: join(directory, 'files'), JWT_SECRET: randomBytes(48).toString('hex'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), TRUST_PROXY: 'false', ALLOW_HTTP_UPSTREAM: '1', UPSTREAM_PORT_ALLOWLIST: new URL(fake).port, UPSTREAM_PRIVATE_ALLOWLIST: new URL(fake).host, UPSTREAM_HOST_ALLOWLIST: '127.0.0.1' };
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } }), accounting = new VideoAccountingService(prisma, new LedgerService(prisma)), children = new Set(), pause = ms => new Promise(done => setTimeout(done, ms));
let child, logs = '', admin = '', token = '', userId = '', passed = 0;
process.on('exit', () => { for (const process of children) if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL'); });
const check = (name, value) => { assert.ok(value, name); passed++; console.log('  ✔ ' + name); };
async function api(path, method = 'GET', body, access = admin) { const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: 'Bearer ' + access } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) }), json = await response.json(); return { status: response.status, data: json.data ?? json }; }
async function start() { logs = ''; child = spawn(process.execPath, ['--require', join(root, 'test/startup-probe.cjs'), 'dist/main.js'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.add(child); for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-18000); }); for (let round = 0; round < 180; round++) { if (child.exitCode !== null || child.signalCode !== null) throw Error('Video recovery API exited: ' + logs); try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(500) })).ok) return; } catch {} await pause(250); } throw Error('Video recovery API not ready: ' + logs); }
async function crash() { if (!child || child.exitCode !== null || child.signalCode !== null) return; const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; }
const stats = async () => await (await fetch(fake + '/video-fixture/stats')).json();
async function wait(id, status) { for (let round = 0; round < 180; round++) { const row = (await api('/video/tasks/' + id, 'GET', undefined, token)).data; if (row.status === status) return row; await pause(40); } throw Error('Missing video status ' + status); }
async function job(marker) { for (let round = 0; round < 180; round++) { const row = (await stats()).jobs.find(j => j.prompt.includes(marker)); if (row) return row; await pause(30); } throw Error('Missing native video job'); }
const balance = async () => (await api('/balance/query', 'GET', undefined, token)).data;
async function create(preset, prompt) { const payload = { presetId: preset.id, mode: 'text', prompt, seconds: 5, ratio: 'adaptive', resolution: '720p', sound: false }, quote = await api('/video/quote', 'POST', payload, token); assert.equal(quote.status, 201); const body = { ...payload, requestKey: randomUUID(), quoteRevision: quote.data.revision }, result = await api('/video/tasks', 'POST', body, token); assert.equal(result.status, 201); return { ...result.data, requestKey: body.requestKey }; }
try {
  await start(); admin = (await api('/auth/login', 'POST', { account: process.env.E2E_ADMIN || 'admin', password: process.env.E2E_PASSWORD || 'admin123456' }, '')).data.accessToken; assert.ok(admin);
  const settings = { 'security.registerEnabled': true, 'security.registerRateLimit': 1000, 'security.videoRateLimit': 1000, 'security.videoQuoteRateLimit': 1000, 'security.registerInviteCode': '', 'security.captchaEnabled': false, 'commerce.enabled': true, 'demo.siteEnabled': false };
  assert.equal((await api('/settings', 'PUT', { settings: Object.entries(settings).map(([key, value]) => ({ key, value })) })).status, 200);
  const email = tag + '@qgauss.test', password = 'qgauss-video-recovery-123'; await api('/auth/register', 'POST', { email, username: 'qgvr' + tag, password }, ''); const signed = (await api('/auth/login', 'POST', { account: email, password }, '')).data; token = signed.accessToken; userId = signed.user.id; await api('/balance/upgradeBalance', 'POST', { userId, drawMjCount: 100 });
  const channel = (await api('/models/channels', 'POST', { name: 'QGauss video recovery ' + tag, type: 'OPENAI', baseUrl: fake + '/video-fixture/ark/api/v3', apiKey: 'qgauss-synthetic-video-main', timeoutMs: 60000 })).data;
  const preset = (await api('/video/admin/presets', 'POST', { name: 'QGauss recovery ' + tag, version: 0, profile: 'ARK_2_5', channelId: channel.id, upstreamModel: 'qg-native-video-recovery', enabled: true, baseCost: 2, perSecondCost: 1, pool: 'drawMj', maxWaitMinutes: 2, publicBaseUrl: base.replace(/\/api$/, '') })).data;
  const finished = await create(preset, 'QGauss saved recovery ' + tag), saved = await wait(finished.id, 'SUCCESS'), savedRow = await prisma.videoTask.findUniqueOrThrow({ where: { id: saved.id } });
  check('真实子进程完成原生任务并保存成片与唯一结算', saved.billing.charged === 7 && !!savedRow.resultJson);
  const polling = await create(preset, 'QGauss [fixture:hold] polling ' + tag), native = await job('polling ' + tag); await wait(polling.id, 'POLLING');
  const uncertain = await create(preset, 'QGauss [fixture:submit-hold] uncertain ' + tag); await job('uncertain ' + tag); await wait(uncertain.id, 'SUBMITTING');
  check('查询中与未确认提交均持久保存意图，预留尚未结算', (await balance()).reserved.drawMj === 14);
  await crash();
  async function stage(status, extra = {}) { const row = await prisma.videoTask.create({ data: { userId, requestKey: randomUUID(), intentHash: 'synthetic-recovery-hash', presetId: preset.id, presetName: preset.name, profile: savedRow.profile, presetJson: savedRow.presetJson, intentJson: savedRow.intentJson, routeJson: savedRow.routeJson, upstreamId: savedRow.upstreamId, outputJson: savedRow.outputJson, resultJson: status === 'SETTLING' ? savedRow.resultJson : null, status, pool: 'drawMj', totalCost: 7, deadlineAt: new Date(Date.now() + 120000), ...extra } }); await prisma.$transaction(tx => accounting.reserveTx(tx, row)); return row; }
  const saving = await stage('SAVING'), settling = await stage('SETTLING'), missing = await stage('SETTLING', { resultJson: JSON.stringify({ videoFileId: 'missing-movie' }) });
  const canceled = await prisma.videoTask.create({ data: { userId, requestKey: randomUUID(), intentHash: 'synthetic-cancel', presetId: preset.id, presetName: preset.name, profile: savedRow.profile, presetJson: savedRow.presetJson, intentJson: savedRow.intentJson, routeJson: savedRow.routeJson, upstreamId: native.id, status: 'CANCELED', pool: 'drawMj', totalCost: 0, deadlineAt: new Date(Date.now() + 120000), remoteCancelState: 'PROCESSING' } });
  const posts = (await stats()).calls.filter(c => c.method === 'POST').length, deletes = (await stats()).calls.filter(c => c.method === 'DELETE').length;
  await fetch(fake + '/video-fixture/release/' + native.id, { method: 'POST' }); await start();
  const recovered = await wait(polling.id, 'SUCCESS'), unknown = await wait(uncertain.id, 'FAILED'), savedAgain = await wait(saving.id, 'SUCCESS'), settledAgain = await wait(settling.id, 'SUCCESS'), missingResult = await wait(missing.id, 'FAILED');
  check('已取得编号的任务重启只查询原任务，保持原编号与一次费用', recovered.billing.charged === 7 && (await prisma.videoTask.findUnique({ where: { id: polling.id } })).upstreamId === native.id);
  check('未确认提交重启后明确失败并释放，没有静默重新开机', unknown.errorCode === 'submission_unconfirmed' && unknown.billing.returned === 7);
  check('已经取得下载地址的任务恢复保存同一成片，不再提交生成', savedAgain.billing.charged === 7 && !!(await prisma.videoTask.findUnique({ where: { id: saving.id } })).resultJson);
  check('结算阶段重启只恢复原账本，原成片仍可播放', settledAgain.billing.charged === 7 && (await api('/video/tasks/' + settling.id + '/playback', 'GET', undefined, token)).status === 200);
  check('缺失成片不会被重启伪装成成功，预留释放且不能播放', missingResult.errorCode === 'saved_file_missing' && missingResult.billing.returned === 7 && (await api('/video/tasks/' + missing.id + '/playback', 'GET', undefined, token)).status === 404);
  check('未确认取消不会重放删除请求，保留未确认回执', (await prisma.videoTask.findUnique({ where: { id: canceled.id } })).remoteCancelState === 'UNCONFIRMED' && (await stats()).calls.filter(c => c.method === 'DELETE').length === deletes);
  check('所有恢复阶段都没有新增外部生成请求', (await stats()).calls.filter(c => c.method === 'POST').length === posts);
  const funds = await balance(); check('恢复后的可用、累计已用与释放精确一致', funds.counts.drawMj === 72 && funds.used.drawMj === 28 && funds.reserved.drawMj === 0);
  check('重载原意图找回同一条失败回执', (await api('/video/tasks/by-request/' + uncertain.requestKey, 'GET', undefined, token)).data.id === uncertain.id);
  await crash(); await start(); const again = await balance();
  check('再次重启不重复收费、退款、生成或取消', again.counts.drawMj === 72 && again.used.drawMj === 28 && again.reserved.drawMj === 0 && (await stats()).calls.filter(c => c.method === 'POST').length === posts && (await stats()).calls.filter(c => c.method === 'DELETE').length === deletes);

  // New native queue family. Keep each admission/recovery phase within the actual per-user limits.
  const filmEmail=tag+'film@qgauss.test';await api('/auth/register','POST',{email:filmEmail,username:'qgfilm'+tag,password},'');const filmSigned=(await api('/auth/login','POST',{account:filmEmail,password},'')).data;token=filmSigned.accessToken;userId=filmSigned.user.id;await api('/balance/upgradeBalance','POST',{userId,drawMjCount:200});
  const filmChannel=(await api('/models/channels','POST',{name:'QGauss processing recovery '+tag,type:'OPENAI',baseUrl:fake+'/film-fixture',apiKey:'qg-video-tool-key',timeoutMs:60000})).data;
  const filmPreset=(await api('/video/admin/presets','POST',{name:'QGauss processing recovery '+tag,version:0,profile:'FAL_UPSCALE',channelId:filmChannel.id,upstreamModel:'topaz/upscale/video/precision',enabled:true,baseCost:2,perSecondCost:1,pool:'drawMj',maxWaitMinutes:2,publicBaseUrl:base.replace(/\/api$/,'')})).data;
  const upload=new FormData();upload.append('file',new Blob([readFileSync(join(root,'test/fixtures/qgauss-reference-video.mp4'))],{type:'video/mp4'}),'QGauss-owned-source.mp4');const uploaded=await fetch(base+'/video/materials/video',{method:'POST',headers:{Authorization:'Bearer '+token},body:upload});assert.equal(uploaded.status,201);const material=(await uploaded.json()).data;
  async function filmCreate(model){const dto={presetId:filmPreset.id,mode:'upscale',prompt:'',ratio:'source',videoIds:[material.id],upscaleFactor:2,enhanceModel:model},quote=await api('/video/quote','POST',dto,token);assert.equal(quote.status,201);const intent={...dto,quoteRevision:quote.data.revision,requestKey:randomUUID()},created=await api('/video/tasks','POST',intent,token);assert.equal(created.status,201);return{...created.data,requestKey:intent.requestKey};}
  const filmStats=async()=>await(await fetch(fake+'/film-fixture/stats')).json();
  async function filmJob(id){for(let n=0;n<180;n++){const j=(await filmStats()).jobs.find(x=>x.inputs.some(m=>m.url.includes('/'+id+'/')));if(j)return j;await pause(30);}throw Error('Native processing job not received');}
  const filmComplete=await filmCreate('Proteus'),filmSaved=await wait(filmComplete.id,'SUCCESS'),filmRow=await prisma.videoTask.findUniqueOrThrow({where:{id:filmComplete.id}});check('新原生队列完成精修，成片倍率经过实际容器检查后结算',filmSaved.billing.charged===26);
  const filmHeld=await filmCreate('Theia Fine Tune Detail'),heldJob=await filmJob(filmHeld.id);await wait(filmHeld.id,'POLLING');const filmUncertain=await filmCreate('Iris Low Quality');await filmJob(filmUncertain.id);await wait(filmUncertain.id,'SUBMITTING');check('精修两条在途任务仅预留原价，持久素材与原连接已经保存',(await balance()).reserved.drawMj===52);
  await crash();const filmPosts=(await filmStats()).calls.filter(x=>x.method==='POST').length;await fetch(fake+'/film-fixture/release/'+heldJob.id,{method:'POST'});await start();const filmRecovered=await wait(filmHeld.id,'SUCCESS'),filmUnknown=await wait(filmUncertain.id,'FAILED');
  check('精修进程重启沿用原生编号、原密钥与原查询路径',filmRecovered.billing.charged===26&&(await prisma.videoTask.findUnique({where:{id:filmHeld.id}})).upstreamId===heldJob.id&&(await filmStats()).calls.filter(x=>x.method==='POST').length===filmPosts);
  check('未确认精修提交不重发，恢复明确失败并完整退回预留',filmUnknown.errorCode==='submission_unconfirmed'&&filmUnknown.billing.returned===26);
  await crash();
  async function filmStage(status){const staged=await prisma.videoTask.create({data:{userId,requestKey:randomUUID(),intentHash:'synthetic-processing-phase',presetId:filmPreset.id,presetName:filmPreset.name,profile:filmRow.profile,presetJson:filmRow.presetJson,intentJson:filmRow.intentJson,inputJson:filmRow.inputJson,routeJson:filmRow.routeJson,upstreamId:filmRow.upstreamId,outputJson:filmRow.outputJson,resultJson:status==='SETTLING'?filmRow.resultJson:null,status,pool:'drawMj',totalCost:26,deadlineAt:new Date(Date.now()+120000)}});await prisma.$transaction(tx=>accounting.reserveTx(tx,staged));return staged;}
  const filmSaving=await filmStage('SAVING'),filmSettling=await filmStage('SETTLING'),filmCanceled=await prisma.videoTask.create({data:{userId,requestKey:randomUUID(),intentHash:'synthetic-processing-cancel',presetId:filmPreset.id,presetName:filmPreset.name,profile:filmRow.profile,presetJson:filmRow.presetJson,intentJson:filmRow.intentJson,inputJson:filmRow.inputJson,routeJson:filmRow.routeJson,upstreamId:heldJob.id,status:'CANCELED',remoteCancelState:'PROCESSING',pool:'drawMj',totalCost:0,deadlineAt:new Date(Date.now()+120000)}});const filmCancels=(await filmStats()).calls.filter(x=>x.method==='PUT').length;
  await start();const filmSaveAgain=await wait(filmSaving.id,'SUCCESS'),filmSettleAgain=await wait(filmSettling.id,'SUCCESS');check('精修保存及结算阶段恢复仍核对素材和倍率，只续原结果',filmSaveAgain.billing.charged===26&&filmSettleAgain.billing.charged===26&&(await filmStats()).calls.filter(x=>x.method==='POST').length===filmPosts);
  check('精修取消在重启后保持未确认，不重复发送运行中取消',(await prisma.videoTask.findUnique({where:{id:filmCanceled.id}})).remoteCancelState==='UNCONFIRMED'&&(await filmStats()).calls.filter(x=>x.method==='PUT').length===filmCancels);
  const filmFunds=await balance();check('精修恢复后的唯一结算、退回与可用次数精确一致',filmFunds.counts.drawMj===96&&filmFunds.used.drawMj===104&&filmFunds.reserved.drawMj===0);
  check('新的处理方式也可凭原提交标识找回中断回执',(await api('/video/tasks/by-request/'+filmUncertain.requestKey,'GET',undefined,token)).data.id===filmUncertain.id);
  await crash();await start();const filmAgain=await balance();check('再次重启不重放精修生成、结算、退回或取消',filmAgain.counts.drawMj===96&&filmAgain.used.drawMj===104&&filmAgain.reserved.drawMj===0&&(await filmStats()).calls.filter(x=>x.method==='POST').length===filmPosts&&(await filmStats()).calls.filter(x=>x.method==='PUT').length===filmCancels);
  console.log('\n视频进程恢复通过：' + passed + ' 项（真实进程、合成服务）');
} finally { await crash(); await prisma.$disconnect(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'qgauss-video-recovery-')) throw Error('Video recovery cleanup escaped'); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
