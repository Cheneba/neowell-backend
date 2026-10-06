/**
 * Removes contact details from chat messages (FR-CONS-08): phone numbers, e-mail addresses
 * and messaging/social links. Keeps doses ("2.5 ml"), times ("08:00") and dates ("06/10/2026").
 */
export const CONTACT_PLACEHOLDER = '[contact hidden]';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LINKS =
  /\b(?:https?:\/\/\S+|www\.\S+|wa\.me\/\S*|(?:api\.)?whatsapp\.com\/\S*|t\.me\/\S*|(?:m\.)?facebook\.com\/\S*|fb\.me\/\S*|instagram\.com\/\S*|tiktok\.com\/\S*)/gi;
/** Digit runs with spaces, dots, dashes or brackets; 8+ digits in total = a phone number. */
const PHONE_LIKE = /\+?\(?\d[\d\s().-]{6,}\d/g;

export function maskContacts(text: string): { text: string; masked: boolean } {
  let masked = false;
  const replace = (s: string, re: RegExp, check?: (m: string) => boolean) =>
    s.replace(re, (m) => {
      if (check && !check(m)) return m;
      masked = true;
      return CONTACT_PLACEHOLDER;
    });
  let out = replace(text, EMAIL);
  out = replace(out, LINKS);
  out = replace(out, PHONE_LIKE, (m) => m.replace(/\D/g, '').length >= 8);
  return { text: out, masked };
}
