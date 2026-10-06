import {
  ActivityLevel,
  BreathingSound,
  BreathingStatus,
  ClothingLevel,
  CordStatus,
  CryDescription,
  FeedingQuality,
  JaundiceLevel,
  RiskLevel,
  RoomFeel,
  SkinColor,
  StoolPattern,
  VomitingStatus,
} from '../generated/prisma/enums';

/**
 * Rule-based newborn danger-sign triage — the rules in docs/01-requirements-specification.md §6.
 *
 *  - Conservative: when in doubt, escalate (PDR §12).
 *  - Pure and deterministic: every rule is unit-tested and a stored result can be
 *    reproduced from the stored inputs + RISK_ENGINE_VERSION.
 *  - Thresholds live in RiskConfig so clinicians can tune them.
 *
 * ⚠ Clinical content must be signed off by the clinical lead before production.
 *   Bump RISK_ENGINE_VERSION on every rule or threshold change.
 */
export const RISK_ENGINE_VERSION = '0.2.0';

export interface RiskConfig {
  feverC: number;
  highFeverC: number;
  veryHighFeverC: number;
  warmC: number;
  hypothermiaC: number;
  severeHypothermiaC: number;
  /** Under this age any fever is RED (WHO: fever in young infants needs care). */
  youngInfantFeverDays: number;
  /** Fewer feeds than this in 24 h → YELLOW (clinical lead: "at least 6"). */
  minFeedsPer24h: number;
  /** Feed-count rule applies under this age. */
  feedCountMaxAgeDays: number;
  yellowFindingsForRed: number;
  earlyJaundiceHours: number;
  prolongedJaundiceDays: number;
  /** Any concern in a preterm/LBW baby within this window → RED; longer for very preterm/VLBW. */
  highRiskWindowDays: number;
  veryHighRiskWindowDays: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  feverC: 38.0,
  highFeverC: 39.0,
  veryHighFeverC: 40.0,
  warmC: 37.5,
  hypothermiaC: 36.5,
  severeHypothermiaC: 36.0,
  youngInfantFeverDays: 90,
  minFeedsPer24h: 6,
  feedCountMaxAgeDays: 90,
  yellowFindingsForRed: 3,
  earlyJaundiceHours: 24,
  prolongedJaundiceDays: 14,
  highRiskWindowDays: 7,
  veryHighRiskWindowDays: 28,
};

export interface ObservationInput {
  temperatureC?: number | null;
  feedingCount24h?: number | null;
  feedingQuality?: FeedingQuality | null;
  stoolPattern?: StoolPattern | null;
  skinColor?: SkinColor | null;
  cry?: CryDescription | null;
  activity?: ActivityLevel | null;
  breathing?: BreathingStatus | null;
  respiratoryRate?: number | null;
  chestIndrawing?: boolean | null;
  breathingSound?: BreathingSound | null;
  jaundice?: JaundiceLevel | null;
  cordStatus?: CordStatus | null;
  vomiting?: VomitingStatus | null;
  roomFeel?: RoomFeel | null;
  clothing?: ClothingLevel | null;
  convulsions?: boolean | null;
}

export interface BabyContext {
  /** Age in hours at the time of the observation. */
  ageHours: number;
  gestationalAgeWeeks?: number | null;
  birthWeightGrams?: number | null;
}

export interface AssessOptions {
  /** True when this check answers a fever recheck (FR-CHK-08). */
  isRecheck?: boolean;
}

export type FindingLevel = typeof RiskLevel.YELLOW | typeof RiskLevel.RED;

export interface RiskFinding {
  /** Stable machine code — clients map it to localized text/icons. */
  code: string;
  level: FindingLevel;
}

export interface RiskAssessment {
  level: RiskLevel;
  findings: RiskFinding[];
  /** Action codes for the client, most urgent first. */
  actions: string[];
  /** True when the client should schedule a temperature recheck in 30 minutes. */
  recheck: boolean;
  engineVersion: string;
}

export function isPretermOrLbw(ctx: BabyContext): boolean {
  return (
    (ctx.gestationalAgeWeeks != null && ctx.gestationalAgeWeeks < 37) ||
    (ctx.birthWeightGrams != null && ctx.birthWeightGrams < 2500)
  );
}

function isVeryPretermOrVlbw(ctx: BabyContext): boolean {
  return (
    (ctx.gestationalAgeWeeks != null && ctx.gestationalAgeWeeks < 32) ||
    (ctx.birthWeightGrams != null && ctx.birthWeightGrams < 1500)
  );
}

/** Kept for v1 callers: preterm or low birth weight. */
export const isHighRiskBaby = isPretermOrLbw;

export function assessRisk(
  obs: ObservationInput,
  ctx: BabyContext,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
  options: AssessOptions = {},
): RiskAssessment {
  const findings: RiskFinding[] = [];
  const red = (code: string) => findings.push({ code, level: RiskLevel.RED });
  const yellow = (code: string) => findings.push({ code, level: RiskLevel.YELLOW });
  const ageDays = ctx.ageHours / 24;
  const overheated = obs.roomFeel === RoomFeel.HOT || obs.clothing === ClothingLevel.HEAVY;
  let recheck = false;

  // ── Temperature ────────────────────────────────────────────
  const t = obs.temperatureC;
  if (t != null) {
    if (t >= config.veryHighFeverC) red('FEVER_VERY_HIGH');
    else if (t >= config.feverC) {
      if (ageDays < config.youngInfantFeverDays) red('FEVER_YOUNG_INFANT');
      else if (t >= config.highFeverC) red('FEVER_HIGH');
      else if (options.isRecheck) red('FEVER_PERSISTENT');
      else {
        yellow('FEVER_MODERATE');
        recheck = true;
      }
    } else if (t >= config.warmC) {
      yellow('TEMPERATURE_RAISED');
      if (overheated) yellow('OVERHEATING_LIKELY');
      recheck = !options.isRecheck;
    } else if (t < config.severeHypothermiaC) red('HYPOTHERMIA_SEVERE');
    else if (t < config.hypothermiaC) yellow('HYPOTHERMIA_MILD');
  }

  // ── Classic young-infant danger signs → RED ───────────────
  if (obs.convulsions) red('CONVULSIONS');
  if (obs.feedingQuality === FeedingQuality.UNABLE) red('UNABLE_TO_FEED');
  if (obs.activity === ActivityLevel.LETHARGIC) red('LETHARGIC');
  if (obs.breathing === BreathingStatus.DIFFICULT) red('DIFFICULT_BREATHING');
  if (obs.chestIndrawing) red('CHEST_INDRAWING');
  if (obs.breathingSound === BreathingSound.GRUNTING) red('GRUNTING');
  if (obs.breathingSound === BreathingSound.NOISY) red('NOISY_BREATHING');
  if (obs.skinColor === SkinColor.BLUE) red('CYANOSIS');
  if (obs.cordStatus === CordStatus.SPREADING_REDNESS_OR_PUS) red('CORD_INFECTION_SEVERE');
  if (obs.stoolPattern === StoolPattern.BLOODY) red('BLOODY_STOOL');
  if (obs.cry === CryDescription.HIGH_PITCHED) red('HIGH_PITCHED_CRY');
  if (obs.vomiting === VomitingStatus.FORCEFUL_OR_GREEN) red('VOMITING_GREEN_OR_FORCEFUL');

  // ── Breathing rate (age-based) ─────────────────────────────
  const rr = obs.respiratoryRate;
  const fastThreshold = ageDays < 60 ? 60 : ageDays < 365 ? 50 : 40;
  const slowThreshold = ageDays < 365 ? 30 : 20;
  const fast =
    (rr != null && rr >= fastThreshold) || (rr == null && obs.breathing === BreathingStatus.FAST);
  if (fast) {
    if (ageDays < 60) red('FAST_BREATHING');
    else yellow('FAST_BREATHING_INFANT');
  }
  if (rr != null && rr < slowThreshold) red('SLOW_BREATHING');
  if (obs.breathingSound === BreathingSound.WHEEZING) yellow('WHEEZING');

  // ── Jaundice ───────────────────────────────────────────────
  const anyJaundice =
    (obs.jaundice != null && obs.jaundice !== JaundiceLevel.NONE) ||
    obs.skinColor === SkinColor.YELLOW;
  if (obs.jaundice === JaundiceLevel.PALMS_SOLES) red('JAUNDICE_SEVERE');
  else if (anyJaundice && ctx.ageHours < config.earlyJaundiceHours) red('JAUNDICE_EARLY');
  else if (anyJaundice && ageDays > config.prolongedJaundiceDays) yellow('PROLONGED_JAUNDICE');
  else if (anyJaundice) yellow('JAUNDICE');

  // ── Early concerns → YELLOW ────────────────────────────────
  if (obs.feedingQuality === FeedingQuality.REDUCED) yellow('FEEDING_REDUCED');
  if (
    obs.feedingCount24h != null &&
    obs.feedingCount24h < config.minFeedsPer24h &&
    ageDays < config.feedCountMaxAgeDays
  )
    yellow('FEEDING_INFREQUENT');
  if (obs.activity === ActivityLevel.REDUCED) yellow('ACTIVITY_REDUCED');
  if (obs.cry === CryDescription.WEAK) yellow('WEAK_CRY');
  if (obs.cry === CryDescription.INCONSOLABLE) yellow('INCONSOLABLE_CRY');
  if (obs.cry === CryDescription.NONE) yellow('NOT_CRYING');
  if (obs.skinColor === SkinColor.PALE) yellow('PALLOR');
  if (obs.skinColor === SkinColor.MOTTLED) yellow('MOTTLED_SKIN');
  if (obs.skinColor === SkinColor.FLUSHED) yellow('FLUSHED_SKIN');
  if (obs.cordStatus === CordStatus.RED_OR_DISCHARGE) yellow('CORD_INFECTION_LOCAL');
  if (obs.stoolPattern === StoolPattern.DIARRHEA) yellow('DIARRHEA');
  if (obs.stoolPattern === StoolPattern.NONE) yellow('NO_STOOL');
  if (obs.stoolPattern === StoolPattern.REDUCED) yellow('STOOL_REDUCED');
  if (obs.vomiting === VomitingStatus.REPEATED) yellow('VOMITING_REPEATED');

  // ── Composite rules ────────────────────────────────────────
  const hasRed = findings.some((f) => f.level === RiskLevel.RED);
  // OVERHEATING_LIKELY explains another finding; it is not a separate concern.
  const concerns = findings.filter(
    (f) => f.level === RiskLevel.YELLOW && f.code !== 'OVERHEATING_LIKELY',
  );
  const window = isVeryPretermOrVlbw(ctx)
    ? config.veryHighRiskWindowDays
    : config.highRiskWindowDays;

  let level: RiskLevel = RiskLevel.GREEN;
  if (hasRed) level = RiskLevel.RED;
  else if (concerns.length >= config.yellowFindingsForRed) {
    level = RiskLevel.RED;
    red('MULTIPLE_CONCERNS');
  } else if (concerns.length > 0) {
    if (isPretermOrLbw(ctx) && ageDays < window) {
      level = RiskLevel.RED;
      red('HIGH_RISK_BABY_WITH_CONCERN');
    } else level = RiskLevel.YELLOW;
  }
  if (level === RiskLevel.RED) recheck = false; // go now, don't wait

  return {
    level,
    findings,
    actions: actionsFor(level, findings, ageDays, recheck, overheated),
    recheck,
    engineVersion: RISK_ENGINE_VERSION,
  };
}

function actionsFor(
  level: RiskLevel,
  findings: RiskFinding[],
  ageDays: number,
  recheck: boolean,
  overheated: boolean,
): string[] {
  const codes = new Set(findings.map((f) => f.code));
  const has = (...c: string[]) => c.some((x) => codes.has(x));
  const fever = has(
    'FEVER_VERY_HIGH',
    'FEVER_YOUNG_INFANT',
    'FEVER_HIGH',
    'FEVER_PERSISTENT',
    'FEVER_MODERATE',
  );
  const actions: string[] = [];
  const newborn = ageDays < 42;

  if (level === RiskLevel.RED) {
    actions.push('SEEK_CARE_NOW', 'SHOW_EMERGENCY_NUMBERS', 'SHOW_NEAREST_FACILITIES');
    if (newborn) actions.push('NO_HOME_MEDICINES');
    if (has('HYPOTHERMIA_SEVERE')) actions.push('WARM_SKIN_TO_SKIN_ON_THE_WAY');
    if (fever) actions.push('COOLING_STEPS');
    if (has('FEVER_VERY_HIGH', 'FEVER_HIGH')) actions.push('WATCH_FOR_FITS');
    actions.push('KEEP_BREASTFEEDING_IF_ABLE', 'CONSIDER_TELECONSULT');
    return actions;
  }

  if (level === RiskLevel.YELLOW) {
    if (newborn) actions.push('NO_HOME_MEDICINES');
    if (has('FEVER_MODERATE')) actions.push('COOLING_STEPS');
    if (has('FEVER_MODERATE', 'TEMPERATURE_RAISED')) {
      actions.push('REMOVE_EXTRA_CLOTHING');
      if (overheated) actions.push('COOL_ROOM');
    }
    if (recheck) actions.push('RECHECK_TEMP_30_MIN');
    if (has('HYPOTHERMIA_MILD')) actions.push('WARM_SKIN_TO_SKIN');
    if (has('FEEDING_REDUCED', 'FEEDING_INFREQUENT')) actions.push('FEED_MORE_OFTEN');
    if (has('CORD_INFECTION_LOCAL')) actions.push('KEEP_CORD_CLEAN_AND_DRY');
    if (has('JAUNDICE', 'PROLONGED_JAUNDICE')) actions.push('CHECK_JAUNDICE_IN_DAYLIGHT');
    if (!recheck) actions.push('RECHECK_IN_HOURS');
    actions.push('CONSIDER_TELECONSULT');
    return actions;
  }

  return ['CONTINUE_ROUTINE_CARE'];
}
