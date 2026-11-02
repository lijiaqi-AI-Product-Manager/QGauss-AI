import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync} from 'node:zlib';
import {precompressAsset} from '../../../scripts/web/precompress.mjs';
const folders=[];
function fixture(){const dir=mkdtempSync(join(tmpdir(),'qgauss-compression-'));folders.push(dir);return{old:join(dir,'old.js'),target:join(dir,'new.js')};}
afterEach(()=>{for(const dir of folders.splice(0)){if(!resolve(dir).startsWith(resolve(tmpdir())+sep+'qgauss-compression-'))throw Error('Compression cleanup escaped');rmSync(dir,{recursive:true,force:true});}});
const source=Buffer.from('QGauss AI · 你好，想象。\n'.repeat(400));
function verify(target,expected){assert.deepEqual(brotliDecompressSync(readFileSync(target+'.br')),expected);assert.deepEqual(gunzipSync(readFileSync(target+'.gz')),expected);}
test('新资源产生可解码且内容完整的两种压缩格式',()=>{const f=fixture();assert.deepEqual(precompressAsset(source,f.target,f.old),{created:2,reused:0});verify(f.target,source);});
test('内容相同的旧压缩资源直接复用，保留原始压缩字节',()=>{const f=fixture(),br=brotliCompressSync(source),gz=gzipSync(source,{level:1});writeFileSync(f.old+'.br',br);writeFileSync(f.old+'.gz',gz);assert.deepEqual(precompressAsset(source,f.target,f.old),{created:0,reused:2});assert.deepEqual(readFileSync(f.target+'.br'),br);assert.deepEqual(readFileSync(f.target+'.gz'),gz);verify(f.target,source);});
test('旧资源内容不同或损坏时重新生成，不把旧内容带进新发布',()=>{const f=fixture();writeFileSync(f.old+'.br',brotliCompressSync(Buffer.from('different')));writeFileSync(f.old+'.gz',Buffer.from('corrupt'));assert.deepEqual(precompressAsset(source,f.target,f.old),{created:2,reused:0});verify(f.target,source);});
test('旧压缩内容膨胀超过新资源大小时不会复用',()=>{const f=fixture(),expanded=Buffer.alloc(source.length*20,65);writeFileSync(f.old+'.br',brotliCompressSync(expanded));writeFileSync(f.old+'.gz',gzipSync(expanded));assert.deepEqual(precompressAsset(source,f.target,f.old),{created:2,reused:0});verify(f.target,source);});
