import { CONTACT_PLACEHOLDER as H, maskContacts } from './contact-mask';

describe('maskContacts', () => {
  it.each([
    ['Call me on 670 00 00 00', `Call me on ${H}`],
    ['my number +237 6 70 12 34 56 ok', `my number ${H} ok`],
    ['WhatsApp 6.70.12.34.56', `WhatsApp ${H}`],
    ['email me: doc.ngwa@gmail.com', `email me: ${H}`],
    ['wa.me/237670000000', H],
    ['see https://example.com/x', `see ${H}`],
    ['facebook.com/dr.ngwa', H],
  ])('masks %p', (input, expected) => {
    expect(maskContacts(input)).toEqual({ text: expected, masked: true });
  });

  it.each([
    'Give 2.5 ml at 08:00 and 20:00',
    'Temperature was 38.4 on 06/10/2026',
    'She fed 8 times, weight 3200 g',
    'Come back in 7 days',
  ])('keeps clinical text %p', (input) => {
    expect(maskContacts(input)).toEqual({ text: input, masked: false });
  });
});
