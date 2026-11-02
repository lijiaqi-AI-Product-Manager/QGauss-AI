import { walletEnergyFixtures } from './wallet-energy-fixture.mjs';
export function membershipFixtures() {
  const specs = [
    ['light', '合成 · 灵感轻装', 990, 0, 80, 0, 0, 0],
    ['roam', '合成 · 创作漫游', 2900, 30, 200, 40, 30, 10],
    ['always', '合成 · 长期灵感', 19900, -1, 1000, 200, 150, 60],
  ];
  const items = specs.map(([id,name,priceCents,days,model3Count,model4Count,drawMjCount,agentCount],index)=>({ id:'qg-offer-'+id,name,des:'本地只读合成套餐，用于观察权益、价格与确认界面，不代表实际在售报价。',priceCents,priceYuan:(priceCents/100).toFixed(2),days,model3Count,model4Count,drawMjCount,agentCount,offerRevision:String(index+1).repeat(64) }));
  const orders = Array.from({length:8},(_,index)=>({ orderId:'qg-demo-order-'+index,goodsType:index%3===2?'money':'package',goodsName:index%3===2?'合成余额充值':'合成 · 创作漫游',goodsId:'qg-offer-roam',count:1,priceCents:2900,totalCents:2900,totalYuan:'29.00',status:[0,1,3,0,2,1,0,4][index],createdAt:'2026-10-'+String(31-index).padStart(2,'0')+'T03:00:00Z',expiresAt:index===0?'2026-11-01T03:30:00Z':null,entitlements:index%3===2?null:{version:1,...items[1]},legacyEntitlements:false }));
  const data = { '/api/settings/public': {'commerce.enabled':true,'site.name':'QGauss AI'},'/api/balance/query':walletEnergyFixtures()['/api/balance/query'],'/api/crami/packages':{items},'/api/order/list':orders };
  for(const order of orders){data['/api/order/detail/'+order.orderId]=order;data['/api/pay/status/'+order.orderId]={orderId:order.orderId,status:order.status,totalCents:order.totalCents};}
  return data;
}
export function membershipOrderPage(rows,url){
  const status=url.searchParams.get('status');const items=status!==null&&status!==''?rows.filter(row=>row.status===Number(status)):rows;
  const page=Math.max(1,Number(url.searchParams.get('page'))||1),pageSize=Math.min(100,Number(url.searchParams.get('pageSize'))||6);
  return {items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize};
}
