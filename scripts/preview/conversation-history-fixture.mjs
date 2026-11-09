/** Read-only conversation data for the independent visual preview. */
export function conversationHistoryFixture(fixtures,url,method='GET',body={}){
 const rows=(fixtures['/api/conversations']||[]).map(row=>({...row,version:row.version||1,title:row.title||'新对话',pinned:!!(row.pinned||row.pinnedAt),folderId:row.folderId||null,messageCount:row.messageCount??fixtures['/api/conversations/'+row.id]?.messages?.length??0}));
 const kind=row=>row.agentId?'agent':row.appId?'app':'chat',filter=Object.fromEntries(url.searchParams);
 const scope=(row,value)=>value==='trash'?!!row.deletedAt:!row.deletedAt;
 if(method==='POST'&&url.pathname==='/api/conversations/status'){
  const items=rows.filter(row=>(body.ids||[]).includes(row.id)&&scope(row,body.scope));return{items,missing:(body.ids||[]).filter(id=>!items.some(row=>row.id===id))};
 }
 if(method!=='GET'||url.pathname!=='/api/conversations/history')return undefined;
 const inFolder=row=>!filter.folder||(filter.folder==='unfiled'?!row.folderId:row.folderId===filter.folder),matching=rows.filter(row=>scope(row,filter.scope)&&(!filter.q||row.title.toLowerCase().includes(filter.q.trim().toLowerCase()))),items=matching.filter(row=>kind(row)===(filter.kind||'chat')&&inFolder(row)),offset=Math.max(0,Number(filter.cursor?.replace('preview:','')||0)),limit=Math.min(50,Math.max(1,Number(filter.limit)||40)),page=items.slice(offset,offset+limit),hasMore=offset+page.length<items.length,kindCounts={chat:0,app:0,agent:0},folderCounts={};
 for(const row of matching){if(inFolder(row))kindCounts[kind(row)]++;if(kind(row)===(filter.kind||'chat')){const key=row.folderId||'unfiled';folderCounts[key]=(folderCounts[key]||0)+1;}}
 const folders=(fixtures['/api/folders']||[]).map(row=>({...row,version:row.version||1,conversationCount:folderCounts[row.id]||0}));
 return{items:page,total:items.length,unpinnedTotal:items.filter(row=>!row.pinned).length,hasMore,nextCursor:hasMore?'preview:'+(offset+page.length):null,kindCounts,folderCounts,folders};
}
