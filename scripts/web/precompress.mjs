import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync,constants as zlib} from 'node:zlib';

/** Reuse an encoded asset only when it decodes to the exact new source bytes. */
export function precompressAsset(buffer,target,previous) {
  let reused=0,created=0;
  for(const [suffix,decode,encode] of [
    ['.br',brotliDecompressSync,bytes=>brotliCompressSync(bytes,{params:{[zlib.BROTLI_PARAM_QUALITY]:11}})],
    ['.gz',gunzipSync,bytes=>gzipSync(bytes,{level:9})],
  ]) {
    let encoded;
    if(previous)try{
      const size=statSync(previous+suffix).size;
      if(size>0&&size<=buffer.length+1024*1024){const cached=readFileSync(previous+suffix);if(decode(cached,{maxOutputLength:buffer.length}).equals(buffer))encoded=cached;}
    }catch{/* Missing, corrupt or different cached data is regenerated. */}
    if(encoded)reused++;else{encoded=encode(buffer);created++;}
    writeFileSync(target+suffix,encoded);
  }
  return {reused,created};
}
