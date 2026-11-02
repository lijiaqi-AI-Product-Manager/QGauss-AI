import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutCents, checkoutMoney, paymentHref, cardCode, pendingCheckout, orderState, packageDuration, orderBenefits } from '../src/lib/checkout-presentation.js';
test('checkout parses exact cents and enforces persisted integer limits', () => {
  assert.equal(checkoutCents(' 1.09 '), 109); assert.equal(checkoutCents('21474836.47'), 2147483647);
  for (const value of ['0','-1','1.001','1e2','21474836.48','',null]) assert.equal(checkoutCents(value), null);
  assert.equal(checkoutMoney(109), '1.09');
});
test('external payment links allow only absolute HTTP(S) URLs without embedded credentials', () => {
  assert.equal(paymentHref('https://pay.qgauss.test/?a=1&b=2'), 'https://pay.qgauss.test/?a=1&b=2');
  for (const value of ['javascript:alert(1)','data:text/html,x','//pay.qgauss.test','https://a:b@pay.qgauss.test','/recharge',null]) assert.equal(paymentHref(value), '');
});
test('card code normalization accepts expected grouping without silently removing arbitrary punctuation', () => {
  assert.equal(cardCode('abcd efgh-jkmn'), 'ABCDEFGHJKMN'); assert.equal(cardCode('<ABCD>EFGHJKMN'), '');
  assert.equal(cardCode('ABCDE'), '');
});
test('recovery payloads contain only validated intent fields and exact money', () => {
  assert.deepEqual(pendingCheckout({ requestKey:'qgauss-valid-intent',goodsType:'money',amountYuan:'1.2',extra:'discard' }), { requestKey:'qgauss-valid-intent',goodsType:'money',amountYuan:'1.20' });
  assert.equal(pendingCheckout({ requestKey:'short',goodsType:'money',amountYuan:'1' }), null);
  assert.equal(pendingCheckout({ requestKey:'qgauss-valid-intent',goodsType:'package',goodsId:'p',expectedOfferRevision:'not-a-version' }), null);
});
test('membership duration and order status do not imply automatic renewal or success from a redirect', () => {
  assert.equal(packageDuration(-1), '长期会员'); assert.equal(packageDuration(0), '次数补充包');
  assert.match(orderState(0), /等待/); assert.match(orderState(1), /到账/); assert.equal(orderState(99), '状态待确认');
});
test('order receipts multiply the accepted unit entitlements, retaining perpetual membership', () => {
  const offer = {days:30,model3Count:10,model4Count:5,drawMjCount:2,agentCount:1};
  assert.deepEqual(orderBenefits(offer,2),{days:60,model3Count:20,model4Count:10,drawMjCount:4,agentCount:2});
  assert.equal(orderBenefits({...offer,days:-1},3).days,-1);assert.equal(offer.model3Count,10);
});
