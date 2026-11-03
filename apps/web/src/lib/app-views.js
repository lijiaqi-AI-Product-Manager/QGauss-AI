const MAX_VIEWS=2147483647;
export function appViewCount(value){return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=MAX_VIEWS?value:null;}

/** Compact counts are lower bounds; the full count remains available in the label. */
export function formatAppViews(value,language='zh',compact=true){
  const count=appViewCount(value);if(count===null)return'—';
  if(!compact){try{return new Intl.NumberFormat(language==='zh-TW'?'zh-TW':language==='en'?'en':'zh-CN').format(count);}catch{return String(count);}}
  if(count<=1000)return String(count);
  const units=language==='en'?[[1e9,'B'],[1e6,'M'],[1e3,'K']]:[[1e8,language==='zh-TW'?'億':'亿'],[1e4,language==='zh-TW'?'萬':'万'],[1e3,'千']];
  const [size,label]=units.find(([size])=>count>=size);
  return String(Math.floor(count/(size/10))/10)+label+'+';
}
