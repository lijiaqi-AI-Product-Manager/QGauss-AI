import { parseArgs } from 'node:util';
import { generateBackupKey } from './archive.mjs';
import { createEncryptedBackup, verifyEncryptedBackup, restoreEncryptedBackup, recoverAdministrator, inspectLocalDatabase } from './operations.mjs';
const usage=`QGauss AI 本地维护（先停止本项目服务；不自动启动、发信或调用模型）
keygen --key-file <新密钥文件>
inspect --database <已停止服务的数据库>
backup --database <数据库> --storage <本地上传目录> --env-file <运行配置> --key-file <密钥> --output <新 .qgb 文件>
verify --input <.qgb 文件> --key-file <密钥>
restore --input <.qgb 文件> --key-file <密钥> --destination <尚不存在的新目录>
recover-admin <backup 的全部参数> --user-id <已有管理员 ID> --password-file <新密码文件> [--reactivate]
恢复不会覆盖现有目录。备份密钥应另行保管；命令只输出状态和汇总，不输出凭据。`;
try {
  const {values,positionals}=parseArgs({allowPositionals:true,strict:true,options:Object.fromEntries(['key-file','database','storage','env-file','output','input','destination','user-id','password-file','reactivate','help'].map(key=>[key,{type:['reactivate','help'].includes(key)?'boolean':'string'}]))});
  if(values.help||!positionals.length){console.log(usage);}
  else {
    if(positionals.length!==1)throw Error('只接受一个维护动作');
    const options=Object.fromEntries(Object.entries(values).map(([key,value])=>[key.replace(/-([a-z])/g,(_,char)=>char.toUpperCase()),value]));
    const actions={keygen:()=>{if(!options.keyFile)throw Error('请提供 key-file');return generateBackupKey(options.keyFile);},inspect:()=>inspectLocalDatabase(options),backup:()=>createEncryptedBackup(options),verify:()=>verifyEncryptedBackup(options),restore:()=>restoreEncryptedBackup(options),'recover-admin':()=>recoverAdministrator(options)};
    if(!actions[positionals[0]])throw Error('未知维护动作，请使用 --help');
    console.log(JSON.stringify(await actions[positionals[0]](),null,2));
  }
}catch(error){console.error('QGauss 维护未完成：'+error.message);process.exitCode=1;}
