export const APP_IMAGE_PREFIX='qgauss:app-icon:';
export const APP_IMAGE_MAX_BYTES=5*1024*1024;
export const APP_IMAGE_MAX_PIXELS=16*1024*1024;
export function appImageId(icon){return typeof icon==='string'&&/^qgauss:app-icon:ai_[a-f\d]{48}$/.test(icon)?icon.slice(APP_IMAGE_PREFIX.length):'';}
export function appImagePath(icon,appId,privateImage=false){const id=appImageId(icon);return id?(privateImage?'/api/apps/icons/'+id+'/raw':appId?'/api/apps/'+encodeURIComponent(appId)+'/icon?imageId='+id:''):'';}
export function appImageCrop(width,height,zoom=1,cx=.5,cy=.5){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>APP_IMAGE_MAX_PIXELS)throw Error('请使用不超过 1600 万像素的图片。');
 if(![zoom,cx,cy].every(Number.isFinite))throw Error('图片裁切范围不正确。');
 const size=Math.max(1,Math.floor(Math.min(width,height)/Math.min(4,Math.max(1,zoom)))),x=Math.max(0,Math.min(width-size,Math.round(cx*width-size/2))),y=Math.max(0,Math.min(height-size,Math.round(cy*height-size/2)));
 return{x,y,size,width,height};
}
export function appImageFileProblem(file){if(!file?.size)return'请选择一张图片。';if(file.size>APP_IMAGE_MAX_BYTES)return'图片不能超过 5MB。';if(!['image/png','image/jpeg','image/webp'].includes(file.type))return'请使用静态 PNG、JPEG 或 WebP 图片。';return'';}
export function imageRequestKey(value){return typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)?value:'';}
