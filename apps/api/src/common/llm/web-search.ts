export type WebSearchMode = 'responses' | 'anthropic' | 'retrieval';
export type WebSource = { url: string; title: string };
export type WebCitation = { url: string; start: number; end: number };
export type WebSearchReport = { requested: true; status: 'requested' | 'searching' | 'complete' | 'no_sources' | 'interrupted' | 'failed'; sources: WebSource[]; citations: WebCitation[] };

/** The compatibility gateway's retrieval option is explicit; ordinary CUSTOM routes stay unchanged. */
export function webSearchMode(type: string, extra?: string | null): WebSearchMode | null {
  if (type === 'OPENAI_RESPONSES') return 'responses';
  if (type === 'ANTHROPIC') return 'anthropic';
  if (type !== 'CUSTOM' || !extra || extra.length > 65536) return null;
  try { return JSON.parse(extra)?.webSearchProtocol === 'retrieval' ? 'retrieval' : null; } catch { return null; }
}

export function safeWebSource(value: unknown): WebSource | null {
  const raw = value as {url?:unknown;title?:unknown} | null;
  if (typeof raw?.url !== 'string' || raw.url.length > 2048 || /[\u0000-\u0020\u007f]/.test(raw.url)) return null;
  try {
    const url = new URL(raw.url);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return null;
    return { url: url.href, title: typeof raw.title === 'string' ? raw.title.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180) : url.hostname };
  } catch { return null; }
}

/** Used again at every HTTP/history boundary. Never project a raw upstream annotation object. */
export function safeWebSearch(value: unknown): WebSearchReport | null {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  const raw = value as Partial<WebSearchReport> | null;
  if (!raw || raw.requested !== true) return null;
  const sources: WebSource[] = [], seen = new Set<string>();
  for (const item of Array.isArray(raw.sources) ? raw.sources : []) { const row = safeWebSource(item); if (row && !seen.has(row.url) && sources.length < 20) { seen.add(row.url); sources.push(row); } }
  const citations = (Array.isArray(raw.citations) ? raw.citations : []).filter(item => item && seen.has(item.url) && Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end) && item.start >= 0 && item.end >= item.start && item.end <= 2_000_000).slice(0,100).map(({url,start,end})=>({url,start,end}));
  const states = ['requested','searching','complete','no_sources','interrupted','failed'];
  let status = states.includes(raw.status || '') ? raw.status! : 'no_sources';
  if(status==='complete'&&!sources.length)status='no_sources';
  return {requested:true,status,sources,citations};
}

export class WebSearchCollector {
  private report: WebSearchReport = {requested:true,status:'requested',sources:[],citations:[]};
  constructor(private readonly emit?: (report: WebSearchReport) => void) {}
  private changed() { this.emit?.(this.snapshot()); }
  snapshot() { return safeWebSearch(this.report)!; }
  begin() { if(this.report.status==='requested'){this.report.status='searching';this.changed();} }
  source(value: unknown, range?: {start:number;end:number}) {
    const row=safeWebSource(value);if(!row)return;
    let changed=false;
    if(!this.report.sources.some(item=>item.url===row.url)&&this.report.sources.length<20){this.report.sources.push(row);changed=true;}
    if(range && this.report.sources.some(item=>item.url===row.url) && Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end)&&range.start>=0&&range.end>=range.start&&range.end<=2_000_000 && this.report.citations.length<100 && !this.report.citations.some(item=>item.url===row.url&&item.start===range.start&&item.end===range.end)) {this.report.citations.push({url:row.url,...range});changed=true;}
    if(changed)this.changed();
  }
  finish() {this.report.status=this.report.sources.length?'complete':'no_sources';this.changed();return this.snapshot();}
}
