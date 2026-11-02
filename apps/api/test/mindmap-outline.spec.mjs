import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {mindmapOutline,mindmapGeneratedOutline,normalizeMindmapText} from '../dist/modules/mindmap/mindmap-outline.js';
import {MindmapMutationDto,MindmapGenerationDto,MindmapPageDto} from '../dist/modules/mindmap/mindmap.dto.js';
import {parseMindmap} from '../../web/src/lib/mindmap-outline.js';

test('mindmap API and editor agree on normalized outline structure, title and limits',()=>{
 for(const source of ['# 一个想法\n## 从这里开始\n- 线索\n  - 下一步','# 光与想法\r\n- $E=mc^2$\r\n- $\\sqrt{x}$','---\nmarkmap:\n  extraJs: [https://qgauss.test/ignored.js]\n---\n# 正文\n- 一条线索']){
  const api=mindmapOutline(source),editor=parseMindmap(source,value=>value);assert.equal(api.nodeCount,editor.nodes);assert.equal(api.depth,editor.depth);assert.equal(api.title,editor.title);assert.equal(api.outline,editor.source);
 }
});
test('mindmap API rejects empty, oversized, malformed and excessive-node documents before persistence',()=>{
 const rejected=['',' \n','---\nkey: value\n---\n','abc\0def','x'.repeat(60001),'# 主题\n'+Array.from({length:1001},(_,i)=>'- 线索'+i).join('\n')];
 for(const value of rejected)assert.throws(()=>mindmapOutline(value),error=>error.getStatus()===400);assert.equal(normalizeMindmapText('# 仍然可用\r\n- 线索'),'# 仍然可用\n- 线索');assert.equal(mindmapOutline('# 仍然可用\n- 线索').nodeCount,2);
});
test('mindmap generated results unwrap only a complete Markdown wrapper and require useful structure',()=>{
 const result=mindmapGeneratedOutline('```markdown\n# 我的方向\n- 第一条线索\n```');assert.equal(result.title,'我的方向');assert.equal(result.outline,'# 我的方向\n- 第一条线索');assert.throws(()=>mindmapGeneratedOutline('这次没有形成大纲'),error=>error.getStatus()===400);assert.equal(mindmapOutline('一条手写想法').nodeCount,1);
});
test('mindmap mutation validation requires owner-scoped identifiers and numeric original versions',async()=>{
 assert.equal((await validate(plainToInstance(MindmapMutationDto,{requestKey:'qg-request-1',kind:'create',documentId:null,title:'新想法',outline:'# 标题\n- 正文'}))).length,0);
 for(const body of [{kind:'edit',documentId:'qg-doc-1',expectedVersion:'1'},{kind:'archive',documentId:'../private',expectedVersion:1},{kind:'restore',documentId:'qg-doc-1',expectedVersion:0}])assert.ok((await validate(plainToInstance(MindmapMutationDto,{requestKey:'qg-request-1',...body}))).length);
});
test('mindmap generation validation requires an explicit bounded prompt and quote revision',async()=>{
 const input={requestKey:'qg-request-2',modelId:'qg-model',prompt:'整理这份想法',context:'',quoteRevision:'a'.repeat(64)};assert.equal((await validate(plainToInstance(MindmapGenerationDto,input))).length,0);
 for(const patch of [{quoteRevision:''},{prompt:''},{prompt:'x'.repeat(4001)},{context:'x'.repeat(60001)},{requestKey:'bad/key'}])assert.ok((await validate(plainToInstance(MindmapGenerationDto,{...input,...patch}))).length);
});
test('mindmap paging accepts ordinary page numbers and rejects object or mixed numeric values',async()=>{
 const valid=plainToInstance(MindmapPageDto,{page:'2',pageSize:'6',view:'trash',q:'想法'});assert.equal((await validate(valid)).length,0);assert.equal(valid.page,2);
 for(const value of ['2x','0','1.5',['2'],{gt:1}])assert.ok((await validate(plainToInstance(MindmapPageDto,{page:value}))).length);
});
