/** Explicit local samples for creator and review screens. They never call a provider. */
export function appStudioFixtures(state='creator-ready',ownerId='qgauss-reference-only'){
 const statuses=['DRAFT','PENDING','APPROVED','REJECTED','DRAFT'];
 const rows=state==='creator-empty'?[]:statuses.map((reviewStatus,index)=>({
  id:'qg-role-'+(index+1),ownerId,origin:'USER',name:['灵感漫游者','把复杂讲简单','你的文字搭档','下一次，再大胆一点','暂存的好主意'][index],description:['把零散的念头，变成一场有方向的探索。','从一个问题开始，走向清晰、轻盈的下一步。','一起推敲表达，让每一句都更像你。','一份还在打磨的耐心，等待新的惊喜。','收进抽屉的点子，也能重新发光。'][index],icon:['🪐','🧠','📝','🎨','🧭'][index],
  systemPrompt:'你是一位耐心的灵感伙伴。先询问目标，再提供清楚、可行动的建议。保留用户的表达习惯，主动解释不确定的地方。',greeting:'嗨，今天有什么想一起探索的好点子？',defaultModel:'qg-creative',categoryId:'qg-studio-cat',category:{id:'qg-studio-cat',name:'创意与表达'},
  shareViewCount:0,reviewStatus,published:reviewStatus==='APPROVED',version:index+2,shareId:'qg-role-share-'+(index+1),deletedAt:index===4?'2026-11-01T10:00:00Z':null,reviewNote:reviewStatus==='REJECTED'?'请补充它擅长的具体场景，让第一次相遇更容易理解。':'',lastActionKey:'00000000-0000-4000-8000-000000000001',lastAction:'CREATE',events:[],rewardGrantedAt:reviewStatus==='APPROVED'?'2026-11-01T10:00:00Z':null,reward:{model3:5,model4:0,drawMj:0,agent:2},updatedAt:'2026-11-01T10:00:00Z',
 }));
 const summary=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['systemPrompt','events','lastActionKey','lastAction'].includes(key)));
 const review=row=>({...row,owner:{id:ownerId,username:'QGauss 创作伙伴',displayName:'把灵感写成诗',status:'ACTIVE'},rewardOffer:{revision:'a'.repeat(64),alreadyGranted:!!row.rewardGrantedAt,counts:row.rewardGrantedAt?{model3:0,model4:0,drawMj:0,agent:0}:{model3:5,model4:0,drawMj:0,agent:2}}});
 const active=rows.filter(row=>!row.deletedAt),data={
  '/api/apps/mine':{items:active.map(summary),trashItems:rows.filter(row=>row.deletedAt).map(summary),counts:{active:active.length,trash:rows.length-active.length},limit:20},
  '/api/apps/admin/review':{items:rows.filter(row=>!row.deletedAt&&['PENDING','APPROVED','REJECTED'].includes(row.reviewStatus)).map(row=>summary(review(row))),total:3,page:1,pageSize:15},
  '/api/apps/categories':[{id:'qg-studio-cat',name:'创意与表达'}],
  '/api/models/available':[{id:'qg-studio-model',name:'qg-creative',displayName:'QGauss 灵感模型',vendor:'QGauss',capabilities:['chat'],ready:true}],
  '/api/apps':active.filter(row=>row.published).map(summary),
 };
 for(const row of rows){data['/api/apps/mine/'+row.id]=row;data['/api/apps/'+row.id]=Object.fromEntries(Object.entries(summary(row)).filter(([key])=>!['ownerId','reviewNote','reward','rewardGrantedAt'].includes(key)));if(['PENDING','APPROVED','REJECTED'].includes(row.reviewStatus)&&!row.deletedAt)data['/api/apps/admin/review/'+row.id]=review(row);if(row.published)data['/api/apps/shared/'+row.shareId]={id:row.id};}
 return data;
}
export function appStudioPage(data,url){
 if(url.pathname==='/api/apps/mine'){const trash=url.searchParams.get('view')==='trash';return{...data,items:trash?data.trashItems||[]:data.items};}
 if(url.pathname==='/api/apps/admin/review'){const rows=data.items.filter(row=>row.reviewStatus===(url.searchParams.get('status')||'PENDING')),page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('pageSize')||15);return{...data,items:rows.slice((page-1)*size,page*size),total:rows.length,page,pageSize:size};}
 return data;
}
