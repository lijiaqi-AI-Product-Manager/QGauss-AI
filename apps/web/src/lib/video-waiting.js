const states=new Set(['QUEUED','SUBMITTING','POLLING','SAVING','SETTLING','SUCCESS','FAILED','CANCELED']);
/** An incomplete or unrelated receipt must leave the original waiting record intact. */
export function videoRequestOutcome(value,key){
  if(!value||value.requestKey!==key||typeof value.ended!=='boolean')return null;
  if(value.ended)return value.task==null?{ended:true}:null;
  const task=value.task;
  return task&&typeof task.id==='string'&&task.id.length>0&&task.mine===true&&task.requestKey===key&&states.has(task.status)?{ended:false,task}:null;
}
