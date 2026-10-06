import { ClinicianProfile, User } from '../generated/prisma/client';
import { FilesService } from '../files/files.service';

export type ClinicianWithUser = ClinicianProfile & { user: Pick<User, 'firstName' | 'lastName'> };

/** "Dr Amina N." — first name and last initial only (FR-CLIN-05). */
export function clinicianDisplayName(c: ClinicianWithUser): string {
  const last = c.user.lastName?.trim();
  return [c.title, c.user.firstName?.trim(), last ? `${last[0].toUpperCase()}.` : null]
    .filter(Boolean)
    .join(' ');
}

export function isAvailableNow(
  c: Pick<ClinicianProfile, 'availableNowUntil'>,
  now = new Date(),
): boolean {
  return !!c.availableNowUntil && c.availableNowUntil > now;
}

export function mediaOf(c: ClinicianProfile): Partial<Record<'CHAT' | 'AUDIO' | 'VIDEO', number>> {
  return {
    ...(c.offersChat ? { CHAT: c.feeChatXaf } : {}),
    ...(c.offersAudio ? { AUDIO: c.feeAudioXaf } : {}),
    ...(c.offersVideo ? { VIDEO: c.feeVideoXaf } : {}),
  };
}

/** Public profile: never contains phone, e-mail or payout details (FR-CLIN-05, NFR-PRIV-02). */
export function presentPublicClinician(c: ClinicianWithUser, files: FilesService) {
  return {
    id: c.id,
    displayName: clinicianDisplayName(c),
    title: c.title,
    specialties: c.specialties,
    bio: c.bio,
    currentFacility: c.currentFacility,
    yearsExperience: c.yearsExperience,
    photoUrl: files.url(c.photoKey),
    verified: c.verificationStatus === 'VERIFIED',
    ratingAvg: c.ratingAvg == null ? null : Number(c.ratingAvg),
    ratingCount: c.ratingCount,
    media: mediaOf(c),
    availableNow: isAvailableNow(c),
  };
}
