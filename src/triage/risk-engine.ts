import {
  ActivityLevel,
  BreathingStatus,
  CordStatus,
  CryDescription,
  FeedingQuality,
  JaundiceLevel,
  RiskLevel,
  SkinColor,
  StoolPattern,
} from '../generated/prisma/enums';

/**
 * Rule-based newborn danger-sign triage (PDR §3 "Risk scoring", §5 "Rule engine").
 *
 * Design principles:
 *  - Conservative: when in doubt, escalate (PDR §12 "err on side of recommending care").
 *  - Pure and deterministic: no I/O, so every rule is unit-tested and the stored result
 *    can be reproduced from the stored inputs + `RISK_ENGINE_VERSION`.
 *  - Thresholds live in `RiskConfig`, not in the rules, so clinicians can tune them.
 *
 * ⚠ Clinical content must be reviewed and signed off by the partner neonatology team
 *   before launch. Bump `RISK_ENGINE_VERSION` on every rule or threshold change.
 */
export const RISK_ENGINE_VERSION = '0.1.0';

export interface RiskConfig {
  /** At or above this temperature (°C) → RED (neonatal fever). */
  feverC: number;
  /** At or above this temperature (°C) → YELLOW (raised, re-check). */
  warmC: number;
  /** Below this temperature (°C) → YELLOW (mild hypothermia / cold stress). */
  hypothermiaC: number;
  /** Below this temperature (°C) → RED (moderate/severe hypothermia). */
  severeHypothermiaC: number;
  /** Fewer feeds than this in 24h → YELLOW. */
  minFeedsPer24h: number;
  /** This many YELLOW findings together escalate to RED. */
  yellowFindingsForRed: number;
  /** Jaundice of any extent within this many hours of birth → RED. */
  earlyJaundiceHours: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  feverC: 38.0,
  warmC: 37.5,
  hypothermiaC: 36.5,
  severeHypothermiaC: 36.0,
  minFeedsPer24h: 8,
  yellowFindingsForRed: 3,
  earlyJaundiceHours: 24,
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
  jaundice?: JaundiceLevel | null;
  cordStatus?: CordStatus | null;
  convulsions?: boolean | null;
}

export interface BabyContext {
  /** Age in hours at the time of the observation. */
  ageHours: number;
  gestationalAgeWeeks?: number | null;
  birthWeightGrams?: number | null;
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
  /** Codes for the actions the client should show, most urgent first. */
  actions: string[];
  engineVersion: string;
}

export function isHighRiskBaby(ctx: BabyContext): boolean {
  return (
    (ctx.gestationalAgeWeeks != null && ctx.gestationalAgeWeeks < 37) ||
    (ctx.birthWeightGrams != null && ctx.birthWeightGrams < 2500)
  );
}

export function assessRisk(
  obs: ObservationInput,
  ctx: BabyContext,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskAssessment {
  const findings: RiskFinding[] = [];
  const red = (code: string) => findings.push({ code, level: RiskLevel.RED });
  const yellow = (code: string) => findings.push({ code, level: RiskLevel.YELLOW });

  // Temperature
  const t = obs.temperatureC;
  if (t != null) {
    if (t >= config.feverC) red('FEVER');
    else if (t >= config.warmC) yellow('TEMPERATURE_RAISED');
    else if (t < config.severeHypothermiaC) red('HYPOTHERMIA_SEVERE');
    else if (t < config.hypothermiaC) yellow('HYPOTHERMIA_MILD');
  }

  // Classic young-infant danger signs → RED
  if (obs.convulsions) red('CONVULSIONS');
  if (obs.feedingQuality === FeedingQuality.UNABLE) red('UNABLE_TO_FEED');
  if (obs.activity === ActivityLevel.LETHARGIC) red('LETHARGIC');
  if (obs.breathing === BreathingStatus.DIFFICULT) red('DIFFICULT_BREATHING');
  if (obs.breathing === BreathingStatus.FAST) red('FAST_BREATHING');
  if (obs.skinColor === SkinColor.BLUE) red('CYANOSIS');
  if (obs.cordStatus === CordStatus.SPREADING_REDNESS_OR_PUS) red('CORD_INFECTION_SEVERE');
  if (obs.stoolPattern === StoolPattern.BLOODY) red('BLOODY_STOOL');
  if (obs.cry === CryDescription.HIGH_PITCHED) red('HIGH_PITCHED_CRY');

  // Jaundice
  const anyJaundice =
    (obs.jaundice != null && obs.jaundice !== JaundiceLevel.NONE) ||
    obs.skinColor === SkinColor.YELLOW;
  if (obs.jaundice === JaundiceLevel.PALMS_SOLES) red('JAUNDICE_SEVERE');
  else if (anyJaundice && ctx.ageHours < config.earlyJaundiceHours) red('JAUNDICE_EARLY');
  else if (anyJaundice) yellow('JAUNDICE');

  // Early concerns → YELLOW
  if (obs.feedingQuality === FeedingQuality.REDUCED) yellow('FEEDING_REDUCED');
  if (obs.feedingCount24h != null && obs.feedingCount24h < config.minFeedsPer24h)
    yellow('FEEDING_INFREQUENT');
  if (obs.activity === ActivityLevel.REDUCED) yellow('ACTIVITY_REDUCED');
  if (obs.cry === CryDescription.WEAK) yellow('WEAK_CRY');
  if (obs.cry === CryDescription.INCONSOLABLE) yellow('INCONSOLABLE_CRY');
  if (obs.skinColor === SkinColor.PALE) yellow('PALLOR');
  if (obs.skinColor === SkinColor.MOTTLED) yellow('MOTTLED_SKIN');
  if (obs.cordStatus === CordStatus.RED_OR_DISCHARGE) yellow('CORD_INFECTION_LOCAL');
  if (obs.stoolPattern === StoolPattern.DIARRHEA) yellow('DIARRHEA');
  if (obs.stoolPattern === StoolPattern.NONE) yellow('NO_STOOL');
  if (obs.stoolPattern === StoolPattern.REDUCED) yellow('STOOL_REDUCED');

  const hasRed = findings.some((f) => f.level === RiskLevel.RED);
  const yellowCount = findings.filter((f) => f.level === RiskLevel.YELLOW).length;

  let level: RiskLevel = RiskLevel.GREEN;
  if (hasRed) {
    level = RiskLevel.RED;
  } else if (yellowCount >= config.yellowFindingsForRed) {
    level = RiskLevel.RED;
    red('MULTIPLE_CONCERNS');
  } else if (yellowCount > 0) {
    // Preterm / low-birth-weight babies in their first week have little reserve.
    if (isHighRiskBaby(ctx) && ctx.ageHours < 7 * 24) {
      level = RiskLevel.RED;
      red('HIGH_RISK_BABY_WITH_CONCERN');
    } else {
      level = RiskLevel.YELLOW;
    }
  }

  return {
    level,
    findings,
    actions: actionsFor(level, findings),
    engineVersion: RISK_ENGINE_VERSION,
  };
}

function actionsFor(level: RiskLevel, findings: RiskFinding[]): string[] {
  const codes = new Set(findings.map((f) => f.code));
  const actions: string[] = [];

  if (level === RiskLevel.RED) {
    actions.push('SEEK_CARE_NOW', 'SHOW_EMERGENCY_NUMBERS', 'SHOW_NEAREST_FACILITIES');
    if (codes.has('HYPOTHERMIA_SEVERE')) actions.push('WARM_SKIN_TO_SKIN_ON_THE_WAY');
    if (codes.has('FEVER')) actions.push('REMOVE_EXTRA_CLOTHING');
    actions.push('KEEP_BREASTFEEDING_IF_ABLE');
    return actions;
  }

  if (level === RiskLevel.YELLOW) {
    if (codes.has('TEMPERATURE_RAISED')) actions.push('REMOVE_EXTRA_CLOTHING');
    if (codes.has('HYPOTHERMIA_MILD')) actions.push('WARM_SKIN_TO_SKIN');
    if (codes.has('FEEDING_REDUCED') || codes.has('FEEDING_INFREQUENT'))
      actions.push('FEED_MORE_OFTEN');
    if (codes.has('CORD_INFECTION_LOCAL')) actions.push('KEEP_CORD_CLEAN_AND_DRY');
    if (codes.has('JAUNDICE')) actions.push('CHECK_JAUNDICE_IN_DAYLIGHT');
    actions.push('RECHECK_IN_HOURS', 'CONSIDER_TELECONSULT');
    return actions;
  }

  return ['CONTINUE_ROUTINE_CARE'];
}
