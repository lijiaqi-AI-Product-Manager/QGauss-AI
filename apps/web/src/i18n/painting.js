import{currentLang}from'./index.js';
import{paintingText as message}from'./painting-messages.js';
export const paintingText=(original,values)=>message(currentLang.value,original,values);
export const paintingLocale=()=>currentLang.value==='en'?'en-US':currentLang.value==='zh-TW'?'zh-TW':'zh-CN';
