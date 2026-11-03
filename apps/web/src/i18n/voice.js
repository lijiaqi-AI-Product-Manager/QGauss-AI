import {currentLang} from './index.js';
import {voiceText as message} from './voice-messages.js';

export const voiceText=(original,values)=>message(currentLang.value,original,values);
export const voiceLocale=()=>currentLang.value==='en'?'en-US':currentLang.value==='zh-TW'?'zh-TW':'zh-CN';
