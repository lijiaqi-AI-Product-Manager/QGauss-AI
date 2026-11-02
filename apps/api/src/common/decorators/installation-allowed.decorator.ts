import { SetMetadata } from '@nestjs/common';

export const INSTALLATION_ALLOWED = 'installationAllowed';
/** Only installation facts and health checks remain available before the first administrator exists. */
export const InstallationAllowed = () => SetMetadata(INSTALLATION_ALLOWED, true);
