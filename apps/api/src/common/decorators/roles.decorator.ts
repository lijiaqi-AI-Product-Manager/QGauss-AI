import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export type AppRole = 'USER' | 'ADMIN';

/** 限定可访问的角色，不写则登录即可 */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
