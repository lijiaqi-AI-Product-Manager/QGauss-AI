export function registerUserRecordLinkTests({test,assert,mount,settle,relayJson}){
 test('user-management record links reject repeated identity filters without displaying or exporting an unrelated search',async()=>{
  const f=await mount({loggedIn:true,admin:true,initialPath:'/chat-logs?user=one&user=two',intercept:call=>call.url.startsWith('/api/chat-logs?')?relayJson({items:[],total:0,page:1,pageSize:20,asOf:'2026-01-02T00:00:00.000Z'}):null});
  try{for(let i=0;i<100&&!document.querySelector('.qcr-error');i++)await settle();assert.ok(document.querySelector('.qcr-error'));assert.equal(document.querySelectorAll('.qcr-record').length,0);assert.equal(f.calls.filter(call=>call.url.startsWith('/api/chat-logs?')).length,0);assert.equal(document.querySelector('.qcr-export').disabled,true);assert.deepEqual(f.errors,[]);}finally{await f.close();}
 });
}
