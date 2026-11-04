import{currentLang}from'./index.js';
import{videoText as message}from'./video-messages.js';
export const videoText=(original,values)=>message(currentLang.value,original,values);
export const videoLocale=()=>currentLang.value==='en'?'en-US':currentLang.value==='zh-TW'?'zh-TW':'zh-CN';
