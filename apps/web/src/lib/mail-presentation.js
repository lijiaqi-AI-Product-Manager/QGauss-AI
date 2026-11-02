export const MAIL_STATUS_OPTIONS = Object.freeze([
  {value:'queued',title:'等待出发'}, {value:'sending',title:'正在投递'}, {value:'sent',title:'服务器已接受'},
  {value:'failed',title:'发送失败'}, {value:'skipped',title:'尚未发出'}, {value:'suppressed',title:'已停止投递'}, {value:'unknown',title:'结果未确认'},
]);
export function mailStatus(status) { return MAIL_STATUS_OPTIONS.find(item=>item.value===status)?.title || '结果未确认'; }
export function mailDate(value) { const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return '尚无记录';return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date); }
