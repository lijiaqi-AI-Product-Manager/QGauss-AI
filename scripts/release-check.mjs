#!/usr/bin/env node
/** Check tracked publication paths, project metadata and reachable commit identities. */
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const policy=JSON.parse(readFileSync(join(root,'.qgauss-brand.json'),'utf8'));
const normalize=value=>value.normalize('NFKC').toLowerCase().replace(/[-_\s\u200b-\u200d\ufeff]/g,'');
const sha=value=>createHash('sha256').update(value).digest('hex');
function denied(value){const text=normalize(value);for(const token of policy.deniedProductTokens){for(let at=0;at<=text.length-token.length;at++){if(text.charCodeAt(at)!==token.firstCodePoint||text.charCodeAt(at+token.length-1)!==token.lastCodePoint)continue;if(sha(text.slice(at,at+token.length))===token.sha256)return true;}}return false;}
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
const files=git(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean),failures=[];
for(const file of files){if(!existsSync(join(root,file)))continue;if(denied(file))failures.push(file+' (path)');if(/(?:^|\/)(?:research|local|artifacts)\/|(?:^|\/)\.env(?:$|\.(?!example$))|\.(?:db(?:-wal|-shm|-journal)?|qgb|key|pem|zip|7z|rar)$/i.test(file))failures.push(file+' (private material)');}
const branch=git(['branch','--show-current']).trim();if(denied(branch))failures.push('branch name');
let commits=[];try{git(['rev-parse','--verify','HEAD']);commits=git(['log','--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00','HEAD']).split('\0');}catch(error){if(!/unknown revision|Needed a single revision|bad revision/i.test(String(error.stderr)))throw error;}
for(let index=0;index+5<commits.length;index+=6){if(commits.slice(index+1,index+6).some(denied))failures.push('commit '+commits[index].trim());}
if(failures.length){console.error('QGauss publication checks failed:\n'+[...new Set(failures)].join('\n'));process.exitCode=1;}else console.log(`QGauss publication checks passed: ${files.length} paths; ${Math.floor(commits.length/6)} commits.`);
