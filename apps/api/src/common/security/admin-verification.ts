import { SetMetadata } from '@nestjs/common';

export const ADMIN_VERIFICATION_PENDING_MS = 10 * 60_000;
export const ALLOW_PENDING_ADMIN_VERIFICATION = Symbol('Allow pending admin verification');
export const AllowPendingAdminVerification = () => SetMetadata(ALLOW_PENDING_ADMIN_VERIFICATION, true);

export function canUseAdminVerification(role: string) {
  return role === 'ADMIN' || role === 'SUPER';
}

export function adminVerificationRequired(enabledAt?: Date | null, verifiedAt?: Date | null) {
  return !!enabledAt && (!verifiedAt || verifiedAt < enabledAt);
}
