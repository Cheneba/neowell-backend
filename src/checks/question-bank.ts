import { Complaint } from '../generated/prisma/enums';

/**
 * Check questions (FR-CHK-02..05, FR-CHK-09). Text is served in the caregiver's language,
 * so questions can be added or reworded without an app release.
 * Versioned together with the triage engine (src/triage/risk-engine.ts).
 */
export const QUESTION_BANK_VERSION = '0.2.0';

export type QuestionKind = 'TEMPERATURE' | 'COUNTER' | 'SINGLE' | 'BOOLEAN' | 'BREATH_COUNTER';
type Text = { en: string; fr: string };

export interface ShowIf {
  field: string;
  /** Show when the value is outside [from, to) — e.g. temperature not between 36.5 and 37.5. */
  notBetween?: [number, number];
}

export interface QuestionDef {
  id: string;
  /** Observation field this question fills. */
  field: string;
  kind: QuestionKind;
  label: Text;
  help?: Text;
  options?: { value: string; label: Text; danger?: boolean }[];
  min?: number;
  max?: number;
  defaultValue?: number;
  /** Only asked up to this age. */
  maxAgeDays?: number;
}

const yesNo = (danger: 'yes' | 'no' | null) => [
  { value: 'false', label: { en: 'No', fr: 'Non' }, danger: danger === 'no' },
  { value: 'true', label: { en: 'Yes', fr: 'Oui' }, danger: danger === 'yes' },
];

export const QUESTIONS: Record<string, QuestionDef> = {
  temperature: {
    id: 'temperature',
    field: 'temperatureC',
    kind: 'TEMPERATURE',
    label: { en: 'Temperature', fr: 'Température' },
    help: {
      en: 'Under the arm, with a digital thermometer. Hold it until it beeps.',
      fr: 'Sous le bras, avec un thermomètre numérique. Tenez-le jusqu’au bip.',
    },
    min: 30,
    max: 43,
    defaultValue: 36.8,
  },
  roomFeel: {
    id: 'roomFeel',
    field: 'roomFeel',
    kind: 'SINGLE',
    label: { en: 'How does the room feel?', fr: 'Comment est la pièce ?' },
    help: { en: 'Hot weather can make a baby warm.', fr: 'La chaleur peut réchauffer un bébé.' },
    options: [
      { value: 'COLD', label: { en: 'Cold', fr: 'Froide' } },
      { value: 'COMFORTABLE', label: { en: 'Comfortable', fr: 'Agréable' } },
      { value: 'HOT', label: { en: 'Hot', fr: 'Chaude' } },
    ],
  },
  clothing: {
    id: 'clothing',
    field: 'clothing',
    kind: 'SINGLE',
    label: { en: 'How is the baby dressed?', fr: 'Comment le bébé est-il habillé ?' },
    help: {
      en: 'A baby needs about one layer more than an adult — not many blankets.',
      fr: 'Un bébé a besoin d’environ une couche de plus qu’un adulte — pas de nombreuses couvertures.',
    },
    options: [
      { value: 'LIGHT', label: { en: 'Lightly', fr: 'Légèrement' } },
      { value: 'NORMAL', label: { en: 'Normally', fr: 'Normalement' } },
      {
        value: 'HEAVY',
        label: { en: 'Many layers or wrapped in blankets', fr: 'Plusieurs couches ou emmailloté' },
      },
    ],
  },
  feedingQuality: {
    id: 'feedingQuality',
    field: 'feedingQuality',
    kind: 'SINGLE',
    label: { en: 'Feeding', fr: 'Alimentation' },
    options: [
      { value: 'GOOD', label: { en: 'Feeding well', fr: 'Tète bien' } },
      { value: 'REDUCED', label: { en: 'Feeding less', fr: 'Tète moins' } },
      { value: 'UNABLE', label: { en: 'Cannot feed', fr: 'Ne peut pas téter' }, danger: true },
    ],
  },
  feedingCount24h: {
    id: 'feedingCount24h',
    field: 'feedingCount24h',
    kind: 'COUNTER',
    label: { en: 'Feeds in the last 24 hours', fr: 'Tétées ces dernières 24 heures' },
    help: {
      en: 'Newborns usually feed 8 to 12 times a day.',
      fr: 'Un nouveau-né tète en général 8 à 12 fois par jour.',
    },
    min: 0,
    max: 30,
    defaultValue: 8,
  },
  breathing: {
    id: 'breathing',
    field: 'breathing',
    kind: 'SINGLE',
    label: { en: 'Breathing', fr: 'Respiration' },
    options: [
      { value: 'NORMAL', label: { en: 'Normal', fr: 'Normale' } },
      { value: 'FAST', label: { en: 'Fast breathing', fr: 'Respire vite' }, danger: true },
      {
        value: 'DIFFICULT',
        label: { en: 'Struggling to breathe', fr: 'Respire avec difficulté' },
        danger: true,
      },
    ],
  },
  respiratoryRate: {
    id: 'respiratoryRate',
    field: 'respiratoryRate',
    kind: 'BREATH_COUNTER',
    label: {
      en: 'Count the breaths for 1 minute',
      fr: 'Comptez les respirations pendant 1 minute',
    },
    help: {
      en: 'When the baby is calm or asleep, watch the belly rise and tap once for each breath.',
      fr: 'Quand le bébé est calme ou endormi, regardez le ventre se soulever et touchez une fois par respiration.',
    },
    min: 5,
    max: 150,
  },
  chestIndrawing: {
    id: 'chestIndrawing',
    field: 'chestIndrawing',
    kind: 'BOOLEAN',
    label: {
      en: 'Does the chest pull in when the baby breathes in?',
      fr: 'La poitrine se creuse-t-elle quand le bébé inspire ?',
    },
    help: {
      en: 'Look below the ribs while the baby breathes in.',
      fr: 'Regardez sous les côtes pendant l’inspiration.',
    },
    options: yesNo('yes'),
  },
  breathingSound: {
    id: 'breathingSound',
    field: 'breathingSound',
    kind: 'SINGLE',
    label: { en: 'Breathing sounds', fr: 'Bruits de respiration' },
    options: [
      { value: 'QUIET', label: { en: 'Quiet', fr: 'Silencieuse' } },
      { value: 'WHEEZING', label: { en: 'Whistling (wheezing)', fr: 'Sifflante' } },
      {
        value: 'GRUNTING',
        label: { en: 'Grunting with each breath', fr: 'Geignement à chaque respiration' },
        danger: true,
      },
      {
        value: 'NOISY',
        label: { en: 'Noisy, as if blocked', fr: 'Bruyante, comme bouchée' },
        danger: true,
      },
    ],
  },
  activity: {
    id: 'activity',
    field: 'activity',
    kind: 'SINGLE',
    label: { en: 'Activity', fr: 'Activité' },
    options: [
      { value: 'NORMAL', label: { en: 'Active', fr: 'Actif' } },
      { value: 'REDUCED', label: { en: 'Less active', fr: 'Moins actif' } },
      {
        value: 'LETHARGIC',
        label: { en: 'Very sleepy, hard to wake', fr: 'Très endormi, difficile à réveiller' },
        danger: true,
      },
    ],
  },
  convulsions: {
    id: 'convulsions',
    field: 'convulsions',
    kind: 'BOOLEAN',
    label: {
      en: 'Fits, twitching or jerking movements?',
      fr: 'Convulsions, secousses ou mouvements saccadés ?',
    },
    help: {
      en: 'In babies, fits can be small: twitching of the face or a limb, jerking, lip-smacking, staring, or "cycling" legs.',
      fr: 'Chez le bébé, les convulsions peuvent être discrètes : secousses du visage ou d’un membre, mâchonnement, regard fixe ou jambes qui « pédalent ».',
    },
    options: yesNo('yes'),
  },
  skinColor: {
    id: 'skinColor',
    field: 'skinColor',
    kind: 'SINGLE',
    label: { en: 'Skin colour', fr: 'Couleur de la peau' },
    options: [
      { value: 'NORMAL', label: { en: 'Normal', fr: 'Normale' } },
      { value: 'PALE', label: { en: 'Pale', fr: 'Pâle' } },
      { value: 'YELLOW', label: { en: 'Yellow', fr: 'Jaune' } },
      { value: 'FLUSHED', label: { en: 'Red, flushed', fr: 'Rouge' } },
      { value: 'MOTTLED', label: { en: 'Blotchy', fr: 'Marbrée' } },
      {
        value: 'BLUE',
        label: { en: 'Blue lips or skin', fr: 'Lèvres ou peau bleues' },
        danger: true,
      },
    ],
  },
  jaundice: {
    id: 'jaundice',
    field: 'jaundice',
    kind: 'SINGLE',
    label: { en: 'Yellow eyes or skin', fr: 'Yeux ou peau jaunes' },
    help: {
      en: 'Look in daylight. Press the skin gently and look at the colour.',
      fr: 'Regardez à la lumière du jour. Appuyez doucement sur la peau.',
    },
    options: [
      { value: 'NONE', label: { en: 'None', fr: 'Non' } },
      { value: 'FACE_CHEST', label: { en: 'Face or chest', fr: 'Visage ou poitrine' } },
      {
        value: 'PALMS_SOLES',
        label: { en: 'Palms or soles', fr: 'Paumes ou plantes des pieds' },
        danger: true,
      },
    ],
  },
  cry: {
    id: 'cry',
    field: 'cry',
    kind: 'SINGLE',
    label: { en: 'Crying', fr: 'Pleurs' },
    options: [
      { value: 'NORMAL', label: { en: 'Normal', fr: 'Normaux' } },
      { value: 'WEAK', label: { en: 'Weak', fr: 'Faibles' } },
      { value: 'INCONSOLABLE', label: { en: 'Cannot be calmed', fr: 'Impossible à calmer' } },
      { value: 'NONE', label: { en: 'Not crying at all', fr: 'Ne pleure pas du tout' } },
      { value: 'HIGH_PITCHED', label: { en: 'High-pitched', fr: 'Aigus' }, danger: true },
    ],
  },
  stoolPattern: {
    id: 'stoolPattern',
    field: 'stoolPattern',
    kind: 'SINGLE',
    label: { en: 'Stool (poo)', fr: 'Selles' },
    options: [
      { value: 'NORMAL', label: { en: 'Normal', fr: 'Normales' } },
      { value: 'REDUCED', label: { en: 'Less than usual', fr: 'Moins que d’habitude' } },
      { value: 'NONE', label: { en: 'None today', fr: 'Aucune aujourd’hui' } },
      { value: 'DIARRHEA', label: { en: 'Watery', fr: 'Liquides' } },
      {
        value: 'BLOODY',
        label: { en: 'Blood in stool', fr: 'Sang dans les selles' },
        danger: true,
      },
    ],
  },
  cordStatus: {
    id: 'cordStatus',
    field: 'cordStatus',
    kind: 'SINGLE',
    label: { en: 'Umbilical cord', fr: 'Cordon ombilical' },
    options: [
      { value: 'NORMAL', label: { en: 'Clean and dry', fr: 'Propre et sec' } },
      { value: 'RED_OR_DISCHARGE', label: { en: 'Red or oozing', fr: 'Rouge ou suintant' } },
      {
        value: 'SPREADING_REDNESS_OR_PUS',
        label: { en: 'Redness spreading or pus', fr: 'Rougeur qui s’étend ou pus' },
        danger: true,
      },
    ],
    maxAgeDays: 21,
  },
  vomiting: {
    id: 'vomiting',
    field: 'vomiting',
    kind: 'SINGLE',
    label: { en: 'Vomiting', fr: 'Vomissements' },
    help: {
      en: 'Small spit-ups after feeds are normal.',
      fr: 'De petits rejets après la tétée sont normaux.',
    },
    options: [
      { value: 'NONE', label: { en: 'None', fr: 'Non' } },
      { value: 'SOMETIMES', label: { en: 'Sometimes', fr: 'Parfois' } },
      { value: 'REPEATED', label: { en: 'Again and again', fr: 'À répétition' } },
      {
        value: 'FORCEFUL_OR_GREEN',
        label: { en: 'Forceful or green', fr: 'En jet ou vert' },
        danger: true,
      },
    ],
  },
};

/** Always asked in a routine check (temperature first). */
export const ROUTINE_CORE = [
  'temperature',
  'roomFeel',
  'clothing',
  'feedingQuality',
  'feedingCount24h',
  'breathing',
  'activity',
  'convulsions',
];
/** Rotated across routine checks, least recently answered first (FR-CHK-02). */
export const ROUTINE_ROTATING = [
  'respiratoryRate',
  'skinColor',
  'jaundice',
  'cry',
  'stoolPattern',
  'cordStatus',
  'vomiting',
  'chestIndrawing',
  'breathingSound',
];
export const ROTATING_PER_CHECK = 3;
/** Room and clothing questions only show when the temperature is outside this range. */
const TEMP_CONTEXT: ShowIf = { field: 'temperatureC', notBetween: [36.5, 37.5] };

/** Follow-up questions per unwell complaint (FR-CHK-03). Temperature is always first. */
export const COMPLAINT_QUESTIONS: Record<Complaint, string[]> = {
  FEVER: [
    'roomFeel',
    'clothing',
    'convulsions',
    'activity',
    'feedingQuality',
    'breathing',
    'skinColor',
  ],
  FEELS_COLD: ['roomFeel', 'clothing', 'activity', 'feedingQuality', 'skinColor'],
  CRYING_A_LOT: ['cry', 'feedingQuality', 'stoolPattern', 'vomiting', 'activity'],
  NOT_CRYING_OR_WEAK: ['activity', 'cry', 'feedingQuality', 'breathing', 'skinColor'],
  NOT_FEEDING: ['feedingQuality', 'feedingCount24h', 'vomiting', 'activity', 'stoolPattern'],
  BREATHING_PROBLEM: [
    'breathing',
    'respiratoryRate',
    'chestIndrawing',
    'breathingSound',
    'skinColor',
  ],
  TWITCHING_OR_FITS: ['convulsions', 'activity', 'feedingQuality'],
  VOMITING: ['vomiting', 'stoolPattern', 'feedingQuality', 'activity'],
  DIARRHEA: ['stoolPattern', 'feedingQuality', 'vomiting', 'activity'],
  YELLOW_SKIN_OR_EYES: ['jaundice', 'skinColor', 'feedingQuality', 'stoolPattern', 'activity'],
  SKIN_COLOUR_CHANGE: ['skinColor', 'breathing', 'activity'],
  CORD_PROBLEM: ['cordStatus', 'feedingQuality', 'activity'],
  OTHER: ['feedingQuality', 'breathing', 'activity', 'convulsions'],
};

export interface PlannedQuestion {
  id: string;
  field: string;
  kind: QuestionKind;
  required: boolean;
  label: string;
  help?: string;
  options?: { value: string; label: string; danger: boolean }[];
  min?: number;
  max?: number;
  defaultValue?: number;
  showIf?: ShowIf;
}

function localize(
  q: QuestionDef,
  lang: 'en' | 'fr',
  extra: Partial<PlannedQuestion> = {},
): PlannedQuestion {
  return {
    id: q.id,
    field: q.field,
    kind: q.kind,
    required: q.id === 'temperature',
    label: q.label[lang],
    ...(q.help ? { help: q.help[lang] } : {}),
    ...(q.options
      ? {
          options: q.options.map((o) => ({
            value: o.value,
            label: o.label[lang],
            danger: !!o.danger,
          })),
        }
      : {}),
    ...(q.min != null ? { min: q.min } : {}),
    ...(q.max != null ? { max: q.max } : {}),
    ...(q.defaultValue != null ? { defaultValue: q.defaultValue } : {}),
    ...extra,
  };
}

const forAge = (ids: string[], ageDays: number) =>
  ids.filter((id) => QUESTIONS[id].maxAgeDays == null || ageDays <= QUESTIONS[id].maxAgeDays!);

/**
 * Routine plan: core questions + the rotating questions answered least recently.
 * `lastAnswered` maps an observation field to when it was last answered (absent = never).
 */
export function routinePlan(
  ageDays: number,
  lastAnswered: Map<string, Date>,
  lang: 'en' | 'fr',
): PlannedQuestion[] {
  const rotating = forAge(ROUTINE_ROTATING, ageDays)
    .map((id, order) => ({ id, order, at: lastAnswered.get(QUESTIONS[id].field)?.getTime() ?? -1 }))
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .slice(0, ROTATING_PER_CHECK)
    .sort((a, b) => a.order - b.order)
    .map((r) => r.id);
  return [...ROUTINE_CORE, ...rotating].map((id) =>
    localize(
      QUESTIONS[id],
      lang,
      id === 'roomFeel' || id === 'clothing' ? { showIf: TEMP_CONTEXT } : {},
    ),
  );
}

/** Unwell plan: temperature + the questions for the chosen complaints, without duplicates. */
export function unwellPlan(
  complaints: Complaint[],
  ageDays: number,
  lang: 'en' | 'fr',
): PlannedQuestion[] {
  const ids = ['temperature'];
  const list = complaints.length ? complaints : [Complaint.OTHER];
  for (const c of list)
    for (const id of COMPLAINT_QUESTIONS[c]) if (!ids.includes(id)) ids.push(id);
  // Temperature context is always useful when the baby is unwell.
  for (const id of ['roomFeel', 'clothing']) if (!ids.includes(id)) ids.push(id);
  const contextAlways = list.some((c) => c === Complaint.FEVER || c === Complaint.FEELS_COLD);
  return forAge(ids, ageDays).map((id) =>
    localize(
      QUESTIONS[id],
      lang,
      !contextAlways && (id === 'roomFeel' || id === 'clothing') ? { showIf: TEMP_CONTEXT } : {},
    ),
  );
}

/** Keyword → complaint detection for voice-note transcripts (FR-VOICE-02), English and French. */
const KEYWORDS: [Complaint, RegExp][] = [
  [Complaint.FEVER, /\b(fever|hot|temperature|fièvre|chaude?s?|température)\b/i],
  [Complaint.FEELS_COLD, /\b(cold|froide?s?)\b/i],
  [
    Complaint.CRYING_A_LOT,
    /\b(crying a lot|keeps crying|cries all|pleure beaucoup|pleure tout le temps|pleure sans arrêt)\b/i,
  ],
  [Complaint.NOT_CRYING_OR_WEAK, /\b(not crying|weak|floppy|ne pleure pas|faible|mou)\b/i],
  [
    Complaint.NOT_FEEDING,
    /\b(not feeding|won'?t feed|refus\w* (le sein|de téter)|ne tète pas|ne mange pas)\b/i,
  ],
  [Complaint.BREATHING_PROBLEM, /\b(breath\w*|respir\w*|souffle)\b/i],
  [
    Complaint.TWITCHING_OR_FITS,
    /\b(fit|fits|seizure|convuls\w*|twitch\w*|jerk\w*|secouss\w*|tremble\w*)\b/i,
  ],
  [Complaint.VOMITING, /\b(vomit\w*|throw\w* up|vomi\w*)\b/i],
  [Complaint.DIARRHEA, /\b(diarrh\w*|watery stool|selles liquides)\b/i],
  [Complaint.YELLOW_SKIN_OR_EYES, /\b(yellow|jaunes?|jaunisse|jaundice|ictère)\b/i],
  [Complaint.SKIN_COLOUR_CHANGE, /\b(blue|pale|bleue?s?|pâles?)\b/i],
  [Complaint.CORD_PROBLEM, /\b(cord|navel|belly button|cordon|nombril)\b/i],
];

export function detectComplaints(text: string): Complaint[] {
  return KEYWORDS.filter(([, re]) => re.test(text)).map(([c]) => c);
}
