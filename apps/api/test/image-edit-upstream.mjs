/** Isolated binary receiver used only by fake-upstream, never by production. */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const observations = [], waiters = new Map();
const output = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#a69bdf' } }).png().toBuffer();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function imageEditUpstream(req, res) {
  if (!req.url?.startsWith('/image-edit-fixture/')) return false;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/image-edit-fixture/stats') { res.end(JSON.stringify(observations)); return true; }
  if (req.url === '/image-edit-fixture/release') { for (const done of waiters.values()) done(); waiters.clear(); res.end('{}'); return true; }
  const parts = []; for await (const chunk of req) parts.push(chunk);
  const form = await new Request('http://qgauss.test', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: Buffer.concat(parts) }).formData();
  const images = []; for (const file of form.getAll('image[]')) { const bytes = Buffer.from(await file.arrayBuffer()), meta = await sharp(bytes).metadata(); images.push({ sha256: digest(bytes), width: meta.width, height: meta.height, mime: file.type }); }
  const selected = form.get('mask'); let mask = null;
  if (selected) { const bytes = Buffer.from(await selected.arrayBuffer()), alpha = await sharp(bytes).extractChannel('alpha').raw().toBuffer(); mask = { sha256: digest(bytes), selected: alpha.includes(0), retained: alpha.includes(255), mime: selected.type }; }
  const observation = { model: form.get('model'), n: Number(form.get('n')), images, mask, aborted: false }; observations.push(observation);
  res.once('close', () => { observation.aborted = !res.writableEnded; });
  if (String(observation.model).includes('-hold')) await new Promise(done => { waiters.set(observation.model, done); res.once('close', () => { waiters.delete(observation.model); done(); }); });
  if (!res.destroyed) res.end(JSON.stringify({ data: Array.from({ length: observation.n }, () => ({ b64_json: output.toString('base64') })) }));
  return true;
}
