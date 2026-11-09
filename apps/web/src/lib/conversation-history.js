const whole=value=>Number.isSafeInteger(value)&&value>=0;
export function conversationKind(row){return row.agentId?'agent':row.appId?'app':'chat';}
export function readConversationPage(value){
 if(!value||!Array.isArray(value.items)||!Array.isArray(value.folders)||!whole(value.total)||!whole(value.unpinnedTotal)||value.unpinnedTotal>value.total||typeof value.hasMore!=='boolean'||(value.hasMore?typeof value.nextCursor!=='string'||!value.nextCursor:value.nextCursor!==null))throw Error('history-response');
 const ids=new Set();for(const row of value.items){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.title!=='string'||!Number.isSafeInteger(row.version)||row.version<1||typeof row.pinned!=='boolean')throw Error('history-row');ids.add(row.id);}
 if(value.items.length>value.total||!value.kindCounts||!['chat','app','agent'].every(key=>whole(value.kindCounts[key]))||!value.folderCounts||Object.values(value.folderCounts).some(count=>!whole(count)))throw Error('history-counts');
 const folderIds=new Set();for(const row of value.folders){if(!row||typeof row.id!=='string'||!row.id||folderIds.has(row.id)||typeof row.name!=='string'||!Number.isSafeInteger(row.version)||row.version<1)throw Error('history-folder');folderIds.add(row.id);}return value;
}
export function historyPath(filter,cursor){const params=new URLSearchParams({kind:filter.kind,scope:filter.scope,limit:'40'});if(filter.q)params.set('q',filter.q);if(filter.folder)params.set('folder',filter.folder);if(cursor)params.set('cursor',cursor);return'/conversations/history?'+params;}
export function conversationGroups(rows,labels,now=new Date(),trash=false){
 const start=new Date(now);start.setHours(0,0,0,0);const day=86400000,groups=['pinned','today','yesterday','week','earlier'].map(key=>({key,label:labels[key],items:[]})),byKey=new Map(groups.map(row=>[row.key,row]));
 for(const row of rows){const date=new Date(trash?row.deletedAt:row.lastMessageAt||row.createdAt),stamp=date.getTime(),key=row.pinned&&!trash?'pinned':!Number.isFinite(stamp)?'earlier':stamp>=start.getTime()?'today':stamp>=start.getTime()-day?'yesterday':stamp>=start.getTime()-6*day?'week':'earlier';byKey.get(key).items.push(row);}return groups.filter(row=>row.items.length);
}
export function matchesHistory(row,filter){const inFolder=!filter.folder||(filter.folder==='unfiled'?!row.folderId:row.folderId===filter.folder);return conversationKind(row)===filter.kind&&(!filter.q||row.title.toLowerCase().includes(filter.q.toLowerCase()))&&inFolder;}
