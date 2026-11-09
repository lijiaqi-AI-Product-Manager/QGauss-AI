import {currentLang} from './index.js';
import {partnerText as message} from './partner-messages.js';
export const partnerText=(original,values)=>message(currentLang.value,original,values);
export const partnerLocale=()=>currentLang.value==='en'?'en-US':currentLang.value==='zh-TW'?'zh-TW':'zh-CN';
