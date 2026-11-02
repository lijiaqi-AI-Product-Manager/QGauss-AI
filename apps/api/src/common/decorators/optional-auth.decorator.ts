import {SetMetadata} from '@nestjs/common';

export const OPTIONAL_AUTH_KEY='optionalAuth';
/** Anonymous reads are allowed; a supplied access token still has to be valid. */
export const OptionalAuth=()=>SetMetadata(OPTIONAL_AUTH_KEY,true);
