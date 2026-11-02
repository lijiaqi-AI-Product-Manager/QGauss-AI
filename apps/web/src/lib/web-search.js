const STATES = new Set(['requested','searching','complete','no_sources','interrupted','failed']);
function source(value) {
  if (!value || typeof value.url !== 'string' || value.url.length > 2048 || /[\u0000-\u0020\u007f]/.test(value.url)) return null;
  try { const url=new URL(value.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;return {url:url.href,title:typeof value.title==='string'?value.title.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180):url.hostname,domain:url.hostname}; }catch{return null;}
}
export function webSearchReport(value) {
  if (!value || value.requested !== true) return null;
  const seen=new Set(),sources=[];
  for (const item of Array.isArray(value.sources)?value.sources:[]) { const row=source(item);if(row&&!seen.has(row.url)&&sources.length<20){seen.add(row.url);sources.push(row);} }
  const citations=(Array.isArray(value.citations)?value.citations:[]).filter(item=>item&&seen.has(item.url)&&Number.isSafeInteger(item.start)&&Number.isSafeInteger(item.end)&&item.start>=0&&item.end>=item.start&&item.end<=2_000_000).slice(0,100).map(({url,start,end})=>({url,start,end}));
  const status=STATES.has(value.status)?value.status:'no_sources';
  return {requested:true,status:status==='complete'&&!sources.length?'no_sources':status,sources,citations};
}
export function webSearchLabel(value) {
  const report=webSearchReport(value);
  return report?({requested:'等待联网回复',searching:'正在查找资料',complete:'资料来源已返回',no_sources:'本轮未提供可核对来源',interrupted:'检索结果尚未完整确认',failed:'本轮联网未完成'})[report.status]:'';
}
/** Keep stored text intact. Valid provider offsets add numbered links at the cited span. */
export function citationMarkdown(content,value) {
  const report=webSearchReport(value);if(!report?.sources.length||!content)return content;
  const used=new Set(),insertions=[];
  for(const citation of report.citations){
    if(citation.end>content.length)continue;
    const number=report.sources.findIndex(item=>item.url===citation.url)+1;if(!number)continue;
    let start=citation.start,end=citation.end;
    const span=content.slice(start,end);
    // Only replace provider citation markers; ordinary answer text is always preserved.
    if(!/^[\uE000-\uF8FF].*(?:cite|source).*$/su.test(span))start=end;
    if(start>0&&/[\uDC00-\uDFFF]/u.test(content[start]))continue;
    const key=end+':'+number;if(used.has(key))continue;used.add(key);insertions.push({start,end,text:' ['+number+'](<'+citation.url+'>)'});
  }
  insertions.sort((a,b)=>b.start-a.start||b.end-a.end);
  let result=content,last=content.length;for(const item of insertions){if(item.end>last)continue;result=result.slice(0,item.start)+item.text+result.slice(item.end);last=item.start;}
  if(!insertions.length)result+='\n\n参考链接：'+report.sources.map((item,index)=>'['+(index+1)+'](<'+item.url+'>)').join(' · ');
  return result;
}
