import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';import{resolve,join,dirname}from'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
/** A test can start from an older real-data snapshot without changing that source database. */
export async function upgradeIsolatedDatabase(database){
  const target=resolve(database);if(target===resolve(root,'prisma/dev.db'))throw Error('Test migration cannot modify the live database');
  const child=spawn(process.execPath,[join(root,'prisma/migrate.mjs')],{cwd:root,windowsHide:true,env:{...process.env,DATABASE_FILE:target,DATABASE_URL:'file:'+target.replace(/\\/g,'/')},stdio:['ignore','pipe','pipe']});let output='';for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-12000);});
  const code=await new Promise((done,reject)=>{child.once('exit',done);child.once('error',reject);});if(code!==0)throw Error('Isolated database migration failed: '+output);
}
