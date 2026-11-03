import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appViewCount,formatAppViews} from '../src/lib/app-views.js';
import {applicationText} from '../src/i18n/application-messages.js';
import {creatorReward} from '../src/lib/app-creator.js';

test('share counts show unknown data honestly and keep exact zero',()=>{
 for(const input of [undefined,null,'12',-1,NaN,Infinity,1.5,2147483648,{},[]]){assert.equal(appViewCount(input),null);assert.equal(formatAppViews(input),'—');}
 assert.equal(appViewCount(0),0);assert.equal(formatAppViews(0),'0');assert.equal(formatAppViews(1000),'1000');
});
test('compact share counts stay below the real count across magnitude boundaries',()=>{
 for(const [count,zh,en,tw]of [[1001,'1千+','1K+','1千+'],[9999,'9.9千+','9.9K+','9.9千+'],[10000,'1万+','10K+','1萬+'],[100000,'10万+','100K+','10萬+'],[999999,'99.9万+','999.9K+','99.9萬+'],[1000000,'100万+','1M+','100萬+'],[100000000,'1亿+','100M+','1億+'],[2147483647,'21.4亿+','2.1B+','21.4億+']]){assert.equal(formatAppViews(count),zh);assert.equal(formatAppViews(count,'en'),en);assert.equal(formatAppViews(count,'zh-TW'),tw);}
 assert.equal(formatAppViews(123456,'en',false),'123,456');
});
test('application copy changes language while preserving literal user values and unknown service details',()=>{
 assert.equal(applicationText('en','与{name}开始新会话',{name:'我的 {name} $& 搭档'}),'Start a new chat with 我的 {name} $& 搭档');
 assert.equal(applicationText('zh','与{name}开始新会话',{name:'小队'}),'与小队开始新会话');
 assert.equal(applicationText('zh-TW','保存修改'),'儲存修改');
 assert.equal(applicationText('en','自定义错误：保留原内容'),'自定义错误：保留原内容');
 assert.equal(applicationText('en',null),'');
});
test('reward summaries translate units without changing the confirmed amounts',()=>{
 const offer={counts:{model3:3,model4:2,drawMj:0}};
 assert.equal(creatorReward(offer),'3 基础次数、2 高级次数');
 assert.equal(creatorReward(offer,text=>applicationText('en',text)),'3 basic credits, 2 advanced credits');
 assert.equal(creatorReward({counts:{}},text=>applicationText('en',text)),'No credits granted this time');
});
