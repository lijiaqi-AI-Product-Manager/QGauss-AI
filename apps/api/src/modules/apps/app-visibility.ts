import type {Prisma} from '@prisma/client';
export function publicAppWhere():Prisma.AppWhereInput{return{deletedAt:null,published:true,OR:[{origin:'CURATED'},{origin:'USER',reviewStatus:'APPROVED',owner:{status:'ACTIVE',deletedAt:null}}]};}
export function accessibleAppWhere(userId:string,id:string):Prisma.AppWhereInput{return{id,deletedAt:null,OR:[publicAppWhere(),{origin:'USER',ownerId:userId}]};}
export function appVisibleTo(row:any,userId:string){if(!row||row.deletedAt)return false;if(row.origin==='USER'&&row.ownerId===userId)return true;return!!row.published&&(row.origin!=='USER'||row.reviewStatus==='APPROVED'&&row.owner?.status==='ACTIVE'&&!row.owner?.deletedAt);}
export const conversationAppSelect={id:true,name:true,icon:true,version:true,origin:true,ownerId:true,published:true,reviewStatus:true,deletedAt:true,owner:{select:{status:true,deletedAt:true}}} as const;
export function conversationAppView(row:any,userId:string){return appVisibleTo(row,userId)?{id:row.id,name:row.name,icon:row.icon,version:row.version}:null;}
