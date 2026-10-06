/** Notification texts (EN/FR) by type. `{param}` placeholders are filled from `params`. */
type T = { title: string; body: string };
export const TEMPLATES: Record<string, { en: T; fr: T }> = {
  CONSULT_REQUESTED: {
    en: { title: 'New consultation request', body: '{baby} — {medium}. Please accept or decline.' },
    fr: {
      title: 'Nouvelle demande de consultation',
      body: '{baby} — {medium}. Veuillez accepter ou refuser.',
    },
  },
  CONSULT_CONFIRMED: {
    en: {
      title: 'Consultation confirmed',
      body: '{doctor} accepted your consultation for {baby}.',
    },
    fr: {
      title: 'Consultation confirmée',
      body: '{doctor} a accepté votre consultation pour {baby}.',
    },
  },
  CONSULT_DECLINED: {
    en: {
      title: 'Consultation declined',
      body: 'The doctor could not take this consultation. You will be refunded.',
    },
    fr: {
      title: 'Consultation refusée',
      body: 'Le médecin ne peut pas prendre cette consultation. Vous serez remboursé(e).',
    },
  },
  CONSULT_EXPIRED: {
    en: {
      title: 'No answer from the doctor',
      body: 'Your request for {baby} expired. You will be refunded. Please choose another doctor.',
    },
    fr: {
      title: 'Pas de réponse du médecin',
      body: 'Votre demande pour {baby} a expiré. Vous serez remboursé(e). Choisissez un autre médecin.',
    },
  },
  CONSULT_CANCELLED: {
    en: { title: 'Consultation cancelled', body: 'The consultation for {baby} was cancelled.' },
    fr: { title: 'Consultation annulée', body: 'La consultation pour {baby} a été annulée.' },
  },
  CONSULT_STARTING_SOON: {
    en: {
      title: 'Consultation starting soon',
      body: 'Your NeoWell consultation for {baby} starts at {time}.',
    },
    fr: {
      title: 'Consultation bientôt',
      body: 'Votre consultation NeoWell pour {baby} commence à {time}.',
    },
  },
  NEW_MESSAGE: {
    en: { title: 'New message', body: '{from}: {preview}' },
    fr: { title: 'Nouveau message', body: '{from} : {preview}' },
  },
  REFERRAL_CREATED: {
    en: {
      title: 'Referral to {facility}',
      body: 'The doctor referred {baby}. Open NeoWell for details and code {code}.',
    },
    fr: {
      title: 'Référence vers {facility}',
      body: 'Le médecin a référé {baby}. Ouvrez NeoWell pour les détails et le code {code}.',
    },
  },
  DRUG_CHART_CREATED: {
    en: {
      title: 'Medicines for {baby}',
      body: 'The doctor added a medicine plan. Reminders are set on your phone.',
    },
    fr: {
      title: 'Médicaments pour {baby}',
      body: 'Le médecin a ajouté un traitement. Des rappels sont programmés.',
    },
  },
  PAYMENT_FAILED: {
    en: { title: 'Payment failed', body: 'Your payment did not go through. Please try again.' },
    fr: { title: 'Paiement échoué', body: 'Votre paiement n’a pas abouti. Veuillez réessayer.' },
  },
  REFUND_COMPLETED: {
    en: { title: 'Refund sent', body: '{amount} FCFA was sent back to your mobile money account.' },
    fr: {
      title: 'Remboursement envoyé',
      body: '{amount} FCFA ont été renvoyés sur votre compte mobile money.',
    },
  },
  RECHECK_DUE: {
    en: { title: 'Re-check the temperature', body: 'It is time to re-check {baby}’s temperature.' },
    fr: {
      title: 'Reprenez la température',
      body: 'Il est temps de reprendre la température de {baby}.',
    },
  },
  BABY_NAME_PROMPT: {
    en: { title: '{baby} is 6 weeks old!', body: 'Add your baby’s name in NeoWell.' },
    fr: { title: '{baby} a 6 semaines !', body: 'Ajoutez le prénom de votre bébé dans NeoWell.' },
  },
  CHECK_NUDGE: {
    en: {
      title: 'How is {baby} today?',
      body: 'No check in the last day. A quick check takes 2 minutes.',
    },
    fr: {
      title: 'Comment va {baby} aujourd’hui ?',
      body: 'Aucun contrôle depuis un jour. Un contrôle rapide prend 2 minutes.',
    },
  },
  CLINICIAN_VERIFIED: {
    en: {
      title: 'You are verified',
      body: 'Mothers can now book consultations with you on NeoWell.',
    },
    fr: {
      title: 'Vous êtes vérifié(e)',
      body: 'Les mères peuvent maintenant réserver des consultations avec vous.',
    },
  },
  CLINICIAN_REJECTED: {
    en: { title: 'Verification not approved', body: '{note}' },
    fr: { title: 'Vérification non approuvée', body: '{note}' },
  },
  PAYOUT_CREATED: {
    en: {
      title: 'Payout prepared',
      body: '{amount} FCFA for last week will be sent to your mobile money account.',
    },
    fr: {
      title: 'Paiement préparé',
      body: '{amount} FCFA pour la semaine dernière seront envoyés sur votre compte.',
    },
  },
};

export function render(
  type: string,
  locale: 'en' | 'fr',
  params: Record<string, string | number> = {},
): T {
  const t = TEMPLATES[type]?.[locale] ?? TEMPLATES[type]?.en ?? { title: 'NeoWell', body: '' };
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
  return { title: fill(t.title), body: fill(t.body) };
}
