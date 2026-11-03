import{currentLang}from'./index.js';
import{chatText as message}from'./chat-messages.js';
export const chatText=(original,values)=>message(currentLang.value,original,values);
export const chatLocale=()=>currentLang.value==='en'?'en-US':currentLang.value==='zh-TW'?'zh-TW':'zh-CN';
