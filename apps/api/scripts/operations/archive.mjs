import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, readFile, writeFile, appendFile, stat, mkdir, link, unlink } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';

const MAGIC = Buffer.from('QGAUSS-BACKUP-V1\0');
const HEADER_BYTES = MAGIC.length + 12;
const MAX_BYTES = 10 * 1024 ** 3, MAX_FILES = 10_000, MAX_MANIFEST = 4 * 1024 ** 2;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function portablePath(value) {
  return typeof value === 'string' && value.length <= 1024 && !/[\\:\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(part => part && !['.','..'].includes(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
    && (['database/qgauss.db','environment/original.env'].includes(value) || value.startsWith('storage/'));
}

export async function backupKey(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 1024) throw Error('备份密钥文件无效');
  const value = (await readFile(file,'utf8')).replace(/\r?\n$/, '');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw Error('备份密钥必须由 keygen 生成，不能填写密码或应用密钥');
  const bytes = Buffer.from(value,'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) throw Error('备份密钥文件无效');
  return bytes;
}

export async function generateBackupKey(file) {
  await writeFile(file,randomBytes(32).toString('base64')+'\n',{flag:'wx',mode:0o600});
  return { generated:true };
}

export async function fileDigest(file) {
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { digest.update(chunk); bytes += chunk.length; }
  return { bytes,sha256:digest.digest('hex') };
}

export function validateManifest(value) {
  if (!value || value.format !== 'QGauss AI Backup' || value.version !== 1 || typeof value.id !== 'string' || !Array.isArray(value.files) || value.files.length < 2 || value.files.length > MAX_FILES) throw Error('备份清单格式无效');
  const paths = new Set(); let total = 0;
  for (const file of value.files) {
    if (!file || !portablePath(file.path) || paths.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('备份包含非法路径、重复文件或无效大小');
    if (file.path==='environment/original.env' && file.bytes>1024**2) throw Error('备份中的运行配置文件过大');
    paths.add(file.path.toLowerCase()); total += file.bytes;
    if (total > MAX_BYTES) throw Error('备份超出当前 10 GiB 上限');
  }
  if (!paths.has('database/qgauss.db') || !paths.has('environment/original.env')) throw Error('备份缺少数据库或运行配置');
  return value;
}

export async function encryptBundle(root,manifest,output,key) {
  validateManifest(manifest);
  const meta = Buffer.from(JSON.stringify(manifest));
  if (meta.length > MAX_MANIFEST) throw Error('备份清单过大');
  const length = Buffer.alloc(4); length.writeUInt32BE(meta.length);
  const header = Buffer.concat([MAGIC,randomBytes(12)]), cipher = createCipheriv('aes-256-gcm',key,header.subarray(MAGIC.length));
  cipher.setAAD(header);
  const temporary = output + '.partial-' + randomBytes(8).toString('hex');
  const stream = createWriteStream(temporary,{flags:'wx',mode:0o600});
  async function* frames() { yield length; yield meta; for (const file of manifest.files) { for await (const chunk of createReadStream(join(root,file.path))) yield chunk; } }
  try {
    stream.write(header);
    await pipeline(Readable.from(frames()),cipher,stream);
    await appendFile(temporary,cipher.getAuthTag());
    const fd = await open(temporary,'r+'); try { await fd.sync(); } finally { await fd.close(); }
    // Hard-link publication is exclusive: an existing operator backup is never replaced.
    await link(temporary,output); await unlink(temporary);
    return { id:manifest.id,files:manifest.files.length,bytes:(await stat(output)).size };
  } catch (error) { stream.destroy(); await unlink(temporary).catch(()=>{}); throw error; }
}

async function exactRead(fd,size,offset) {
  const bytes = Buffer.alloc(size); let read = 0;
  while (read < size) { const result = await fd.read(bytes,read,size-read,offset+read); if (!result.bytesRead) throw Error('备份内容不完整'); read += result.bytesRead; }
  return bytes;
}

/** Authentication completes before any manifest or archived path is interpreted. */
export async function decryptBundle(input,key,stage) {
  const size = (await stat(input)).size;
  if (size < HEADER_BYTES+16+4 || size > MAX_BYTES+MAX_MANIFEST+HEADER_BYTES+20) throw Error('备份大小无效');
  const fd = await open(input,'r'); let header,tag;
  try { header=await exactRead(fd,HEADER_BYTES,0);tag=await exactRead(fd,16,size-16); } finally { await fd.close(); }
  if (!header.subarray(0,MAGIC.length).equals(MAGIC)) throw Error('不支持的备份版本');
  const decipher = createDecipheriv('aes-256-gcm',key,header.subarray(MAGIC.length)); decipher.setAAD(header);decipher.setAuthTag(tag);
  const payload = join(stage,'payload.private');
  try { await pipeline(createReadStream(input,{start:HEADER_BYTES,end:size-17}),decipher,createWriteStream(payload,{flags:'wx',mode:0o600})); }
  catch { throw Error('备份认证失败：密钥不匹配或文件已损坏'); }
  const source = await open(payload,'r'); let manifest,offset;
  try {
    const length = (await exactRead(source,4,0)).readUInt32BE();
    if (!length || length > MAX_MANIFEST) throw Error('备份清单大小无效');
    manifest = validateManifest(JSON.parse((await exactRead(source,length,4)).toString('utf8')));
    offset = length+4;
  } finally { await source.close(); }
  if (offset+manifest.files.reduce((sum,file)=>sum+file.bytes,0) !== (await stat(payload)).size) throw Error('备份长度与清单不一致');
  const bundle = join(stage,'bundle'); await mkdir(bundle,{mode:0o700});
  for (const file of manifest.files) {
    const target = join(bundle,file.path);await mkdir(dirname(target),{recursive:true,mode:0o700});
    const digest = createHash('sha256');
    if (file.bytes) await pipeline(createReadStream(payload,{start:offset,end:offset+file.bytes-1}),new Transform({transform(chunk,_encoding,callback){digest.update(chunk);callback(null,chunk);}}),createWriteStream(target,{flags:'wx',mode:0o600}));
    else await writeFile(target,Buffer.alloc(0),{flag:'wx',mode:0o600});
    if (digest.digest('hex') !== file.sha256) throw Error('备份文件校验不一致');
    offset += file.bytes;
  }
  await mkdir(join(bundle,'storage'),{recursive:true,mode:0o700});
  await writeFile(join(bundle,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {manifest,bundle};
}
