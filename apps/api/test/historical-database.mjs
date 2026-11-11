import {copyFileSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

/** Execute a real prefix of the migration history rather than removing columns from today's schema. */
export function historicalDatabase(target,through){
  if(!Number.isInteger(through)||through<1)throw Error('Invalid migration boundary');
  const source=resolve(dirname(fileURLToPath(import.meta.url)),'../prisma'),parent=resolve(dirname(target)),folder=mkdtempSync(join(parent,'migration-history-'));
  try{
    mkdirSync(join(folder,'migrations'));
    for(const file of ['migrate.mjs','data-lease.cjs'])copyFileSync(join(source,file),join(folder,file));
    for(const file of readdirSync(join(source,'migrations')).filter(name=>/^\d{4}.*\.sql$/.test(name)&&Number(name.slice(0,4))<=through))copyFileSync(join(source,'migrations',file),join(folder,'migrations',file));
    execFileSync(process.execPath,[join(folder,'migrate.mjs')],{env:{...process.env,DATABASE_FILE:resolve(target)},stdio:'pipe',windowsHide:true});
  }finally{const checked=resolve(folder);if(!checked.startsWith(parent+sep)||!checked.slice(parent.length+1).startsWith('migration-history-'))throw Error('Unexpected history fixture path');rmSync(checked,{recursive:true,force:true});}
}

export function historicalSnapshot(target,through){
  const parent=resolve(dirname(target)),folder=mkdtempSync(join(parent,'migration-snapshot-')),staged=join(folder,'historical.db'),quote=value=>'"'+value.replaceAll('"','""')+'"';
  let source,destination;
  try{
    historicalDatabase(staged,through);source=new DatabaseSync(target);source.exec('PRAGMA wal_checkpoint(TRUNCATE);PRAGMA journal_mode=DELETE;');destination=new DatabaseSync(staged);
    const names=database=>database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_migrations'").all().map(row=>row.name),historical=names(destination);
    for(const name of names(source).filter(name=>!historical.includes(name)))if(source.prepare('SELECT count(*) n FROM '+quote(name)).get().n)throw Error('Cannot discard populated future table: '+name);
    destination.exec('PRAGMA foreign_keys=OFF;BEGIN');
    for(const name of historical)destination.exec('DELETE FROM '+quote(name));
    try{for(const name of historical){const columns=destination.prepare('PRAGMA table_info('+quote(name)+')').all().map(row=>row.name),rows=source.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(name)+' ORDER BY rowid').all(),insert=destination.prepare('INSERT INTO '+quote(name)+' ('+columns.map(quote).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')');for(const row of rows)insert.run(...columns.map(key=>row[key]));}if(destination.prepare('PRAGMA foreign_key_check').all().length)throw Error('Historical fixture relationships are incomplete');destination.exec('COMMIT;PRAGMA foreign_keys=ON');}catch(error){destination.exec('ROLLBACK');throw error;}
    source.close();source=undefined;destination.close();destination=undefined;copyFileSync(staged,target);
  }finally{source?.close();destination?.close();const checked=resolve(folder);if(!checked.startsWith(parent+sep)||!checked.slice(parent.length+1).startsWith('migration-snapshot-'))throw Error('Unexpected snapshot fixture path');rmSync(checked,{recursive:true,force:true});}
}
