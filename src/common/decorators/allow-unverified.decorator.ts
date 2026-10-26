import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_KEY = 'allowUnverified';

/** Lets a clinician who is not verified (pending, rejected or suspended) use this route: onboarding and "who am I". */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
