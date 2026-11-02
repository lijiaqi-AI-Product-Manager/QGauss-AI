import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'qgauss-publication-test-')),word='sampleblockedterm';
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
 mkdirSync(join(root,'scripts'));for(const file of ['release-check.mjs','brand-check.mjs'])writeFileSync(join(root,'scripts',file),readFileSync(join(project,'scripts',file)));
 writeFileSync(join(root,'.qgauss-brand.json'),JSON.stringify({deniedProductTokens:[{length:word.length,firstCodePoint:word.charCodeAt(0),lastCodePoint:word.charCodeAt(word.length-1),sha256:createHash('sha256').update(word).digest('hex')}]}));
 writeFileSync(join(root,'README.md'),'QGauss AI\n');git('init','-b','main');git('config','user.name','QGauss Maintainer');git('config','user.email','maintainer@qgauss.test');
 const run=file=>spawnSync(process.execPath,['scripts/'+file+'.mjs'],{cwd:root,encoding:'utf8',windowsHide:true});
 return{root,git,run,write:(path,data)=>writeFileSync(join(root,path),data),close:()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'qgauss-publication-test-'));rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
}
test('clean publication works before the first commit and after a human-authored root commit',()=>{const f=fixture();try{for(const file of ['release-check','brand-check'])assert.equal(f.run(file).status,0);f.git('add','.');f.git('commit','-m','chore: initialize product workspace');assert.equal(f.run('release-check').status,0);}finally{f.close();}});
test('brand checks reject case, separators, compatibility characters and invisible separators',()=>{const f=fixture();try{for(const text of ['SAMPLE_BLOCKED_TERM','sample blocked-term','ｓａｍｐｌｅｂｌｏｃｋｅｄｔｅｒｍ','sample\u200bblocked\u200dterm']){f.write('README.md',text);assert.equal(f.run('brand-check').status,1,text);}}finally{f.close();}});
test('binary metadata and untracked file names are checked',()=>{const f=fixture();try{f.write('sample.bin',Buffer.concat([Buffer.from([0]),Buffer.from('sampleblockedterm'),Buffer.from([0])]));assert.equal(f.run('brand-check').status,1);unlinkSync(join(f.root,'sample.bin'));f.write('sample_blocked_term.txt','QGauss');assert.equal(f.run('release-check').status,1);}finally{f.close();}});
test('private configuration and database paths cannot enter a publication',()=>{const f=fixture();try{for(const path of ['.env','sample.db','sample.qgb','sample.key']){f.write(path,'synthetic-only');assert.equal(f.run('release-check').status,1,path);unlinkSync(join(f.root,path));}f.write('.env.example','EXAMPLE=synthetic-only');assert.equal(f.run('release-check').status,0);}finally{f.close();}});
test('commit identity, commit body and branch name are checked independently',()=>{const f=fixture();try{f.git('add','.');f.git('commit','-m','chore: sample_blocked_term');assert.equal(f.run('release-check').status,1);f.git('commit','--amend','-m','chore: product baseline');f.git('config','user.name','sample blocked term');f.write('README.md','QGauss AI updated');f.git('add','.');f.git('commit','-m','docs: update product');assert.equal(f.run('release-check').status,1);f.git('config','user.name','QGauss Maintainer');f.git('commit','--amend','--reset-author','-m','docs: update product');assert.equal(f.run('release-check').status,0);f.git('branch','-m','sample_blocked_term');assert.equal(f.run('release-check').status,1);}finally{f.close();}});
test('pending tracked deletions do not break content checks',()=>{const f=fixture();try{f.git('add','.');unlinkSync(join(f.root,'README.md'));assert.equal(f.run('brand-check').status,0);}finally{f.close();}});
