import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string | null;
  username: string;
  role: 'USER' | 'ADMIN';
}

export interface AuthSessionContext {tokenVersion:number;familyId:string;expiresAt:number|null;}
const sessionContext=Symbol('QGauss authenticated session');
/** Authentication metadata stays on the request and is never serialized as profile data. */
export function withAuthSession<T extends object>(user:T,context:AuthSessionContext):T{Object.defineProperty(user,sessionContext,{value:Object.freeze({...context})});return user;}
export function authSession(user:AuthUser):AuthSessionContext|undefined{return(user as AuthUser&{[sessionContext]?:AuthSessionContext})[sessionContext];}

/** 从 JWT 解析出的当前用户 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    return field ? user?.[field] : user;
  },
);
