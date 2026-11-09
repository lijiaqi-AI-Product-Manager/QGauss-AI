import {createHash} from 'node:crypto';
const kind=row=>row.agentId?'agent':row.appId?'app':'chat';
export const conversationRow=(row,index=0)=>({title:'普通对话',version:1,pinned:false,folderId:null,appId:null,agentId:null,messageCount:2,lastMessageAt:new Date(Date.UTC(2026,10,9,0,0,-index)).toISOString(),deletedAt:null,...row});
export function conversationArchive(initial,initialFolders=[]){
 const rows=initial.map(conversationRow),folders=initialFolders.map(row=>({version:1,...row}));
 function matching(filter,allKinds=false,allFolders=false){return rows.filter(row=>(filter.scope==='trash'?!!row.deletedAt:!row.deletedAt)&&(allKinds||kind(row)===(filter.kind||'chat'))&&(!filter.q||row.title.toLowerCase().includes(filter.q.toLowerCase()))&&(allFolders||!filter.folder||(filter.folder==='unfiled'?!row.folderId:row.folderId===filter.folder)));}
 function selected(input){const found=matching(input);return input.mode==='unpinned'?found.filter(row=>!row.pinned):found.filter(row=>input.targets?.some(target=>target.id===row.id&&target.expectedVersion===row.version));}
 function confirmation(input){return createHash('sha256').update(JSON.stringify([input,selected(input).map(row=>[row.id,row.version])])).digest('hex');}
 function respond(call){
  const url=new URL(call.url,'http://qgauss.test');
  if(call.method==='GET'&&url.pathname==='/api/conversations/history'){
   const filter=Object.fromEntries(url.searchParams),all=matching(filter).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.lastMessageAt.localeCompare(a.lastMessageAt)||b.id.localeCompare(a.id)),offset=Number(filter.cursor?.replace('fixture:','')||0),items=all.slice(offset,offset+40),hasMore=offset+items.length<all.length,kindCounts={chat:0,app:0,agent:0},folderCounts={};
   for(const row of matching(filter,true))kindCounts[kind(row)]++;
   for(const row of matching(filter,false,true)){const key=row.folderId||'unfiled';folderCounts[key]=(folderCounts[key]||0)+1;}
   return{items,total:all.length,unpinnedTotal:all.filter(row=>!row.pinned).length,hasMore,nextCursor:hasMore?'fixture:'+(offset+items.length):null,kindCounts,folderCounts,folders:folders.map(row=>({...row,conversationCount:folderCounts[row.id]||0}))};
  }
  if(call.method==='POST'&&url.pathname==='/api/conversations/status'){const items=rows.filter(row=>call.body.ids.includes(row.id)&&(call.body.scope==='trash'?!!row.deletedAt:!row.deletedAt));return{items,missing:call.body.ids.filter(id=>!items.some(row=>row.id===id))};}
  if(call.method==='POST'&&url.pathname==='/api/conversations/bulk-preview'){const items=selected(call.body);return{count:items.length,activeCount:items.filter(row=>row.activeMessageId).length,pinnedCount:items.filter(row=>row.pinned).length,confirmation:confirmation(call.body)};}
  if(call.method==='POST'&&url.pathname==='/api/conversations/bulk-delete'){
   const {confirmation:token,...input}=call.body.preview;if(token!==confirmation(input))throw Error('fixture-stale-confirmation');const items=selected(input);for(const row of items){row.deletedAt=new Date().toISOString();row.version++;}return{count:items.length,removedIds:items.map(row=>row.id)};
  }
  const action=/^\/api\/conversations\/([^/]+)\/(trash|restore)$/.exec(url.pathname);
  if(call.method==='POST'&&action){const row=rows.find(row=>row.id===action[1]);if(!row||row.version!==call.body.expectedVersion)throw Error('fixture-stale-version');row.deletedAt=action[2]==='trash'?new Date().toISOString():null;row.version++;return{ok:true,id:row.id,version:row.version};}
  return undefined;
 }
 return{rows,folders,respond};
}
