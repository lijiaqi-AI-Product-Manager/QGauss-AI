import {validSpeaker} from './video-speaker.js';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value),id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const materialFields=['id','kind','filename','mime','size','duration','width','height','sourceTaskId'];
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const material=value=>object(value)&&id(value.id)&&['image','video','audio'].includes(value.kind)&&typeof value.filename==='string'&&value.filename.length<=1024&&(value.mime===undefined||typeof value.mime==='string')&&['size','duration','width','height'].every(key=>value[key]===undefined||Number.isFinite(value[key])&&value[key]>=0);

/** Keep editable state with a pending submission; media bytes and temporary links are not persisted. */
export function videoDraftSnapshot(form,references,materials,sourceTask,speakerSelection,incomplete=false){
 return{version:1,incomplete,form:{...form},references:references.map(value=>({id:value.id})),materials:materials.map(value=>pick(value,materialFields)),sourceTask:sourceTask?pick(sourceTask,['id','prompt','mine','presetId','profile','canExtend']):null,speakerSelection:speakerSelection?{...speakerSelection}:null};
}
export function videoDraftFromIntent(intent,defaults){
 const saved=object(intent?.draft)&&intent.draft.version===1?intent.draft:null,raw=object(saved?.form)?saved.form:intent?.payload,form={...defaults};
 for(const key of Object.keys(form)){const value=raw?.[key];if(typeof value===typeof defaults[key]&&(typeof value!=='number'||Number.isFinite(value))&&(typeof value!=='string'||value.length<=4000)||key==='seed'&&typeof value==='number'&&Number.isFinite(value))form[key]=value;}
 if(!saved&&['edit','upscale','lipsync'].includes(form.mode)&&raw?.seconds===undefined)form.seconds=0;
 if(!saved&&['upscale','lipsync'].includes(form.mode))form.resolution='';
 if(!saved&&form.mode==='upscale')form.customEnhance=['compression','noise','halo','grain','recoverDetail'].some(key=>raw?.[key]!==undefined);
 const source=saved?.sourceTask??(id(intent?.payload?.sourceTaskId)?{id:intent.payload.sourceTaskId,prompt:intent.payload.prompt,mine:true}:null),sourceTask=object(source)&&id(source.id)?pick(source,['id','prompt','mine','presetId','profile','canExtend']):null;
 const images=intent?.payload?.imageIds,referenceValues=saved?.references??(form.mode==='image'&&Array.isArray(images)?images.map(id=>({id})):[]),references=Array.isArray(referenceValues)?referenceValues.filter(value=>object(value)&&id(value.id)).slice(0,2).map(value=>({id:value.id})):[];
 const values=saved?.materials,materials=Array.isArray(values)&&values.length<=50&&values.every(material)?values.map(value=>pick(value,materialFields)):[];
 const speaker=saved?.speakerSelection??intent?.payload?.speakerSelection,speakerSelection=validSpeaker(speaker,materials.find(value=>value.kind==='video'))?{...speaker}:null;
 const needsMaterials=['reference','edit','upscale','lipsync'].includes(form.mode)&&['imageIds','videoIds','audioIds'].some(key=>intent?.payload?.[key]?.length);
 return{form,references,materials,sourceTask,speakerSelection,incomplete:!!needsMaterials&&(saved?.incomplete===true||!saved||!Array.isArray(values)||values.length>50||!values.every(material))};
}
