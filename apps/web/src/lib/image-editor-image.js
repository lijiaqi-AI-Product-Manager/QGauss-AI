/** Browser decoders differ on vector input; the fallback owns and releases its object URL. */
export async function decodeEditorImage(blob){
 try{if(typeof createImageBitmap==='function')return await createImageBitmap(blob);}catch{}
 const image=new Image(),url=URL.createObjectURL(blob);
 return new Promise((resolve,reject)=>{
  const release=()=>{clearTimeout(timer);image.onload=image.onerror=null;URL.revokeObjectURL(url);};
  const fail=()=>{release();reject(Error('图片未能完整打开，请使用有效的静态图片后再试。'));};
  const timer=setTimeout(fail,15000);
  image.onload=()=>{if(!image.naturalWidth||!image.naturalHeight)return fail();clearTimeout(timer);image.onload=image.onerror=null;resolve({width:image.naturalWidth,height:image.naturalHeight,image,close:release});};
  image.onerror=fail;image.src=url;
 });
}
