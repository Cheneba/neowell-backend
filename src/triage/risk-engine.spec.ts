import {
  ActivityLevel,
  BreathingStatus,
  CordStatus,
  CryDescription,
  FeedingQuality,
  JaundiceLevel,
  SkinColor,
  StoolPattern,
} from '../generated/prisma/enums';
import { assessRisk, BabyContext, ObservationInput } from './risk-engine';

const termBaby: BabyContext = {
  ageHours: 10 * 24,
  gestationalAgeWeeks: 39,
  birthWeightGrams: 3200,
};
const normal: ObservationInput = {
  temperatureC: 36.9,
  feedingCount24h: 10,
  feedingQuality: FeedingQuality.GOOD,
  stoolPattern: StoolPattern.NORMAL,
  skinColor: SkinColor.NORMAL,
  cry: CryDescription.NORMAL,
  activity: ActivityLevel.NORMAL,
  breathing: BreathingStatus.NORMAL,
  jaundice: JaundiceLevel.NONE,
  cordStatus: CordStatus.NORMAL,
  convulsions: false,
};

const codes = (obs: ObservationInput, ctx = termBaby) =>
  assessRisk(obs, ctx).findings.map((f) => f.code);

describe('assessRisk', () => {
  it('returns GREEN for a well baby', () => {
    const r = assessRisk(normal, termBaby);
    expect(r.level).toBe('GREEN');
    expect(r.findings).toEqual([]);
    expect(r.actions).toEqual(['CONTINUE_ROUTINE_CARE']);
  });

  it('returns GREEN when only a temperature is entered', () => {
    expect(assessRisk({ temperatureC: 37.0 }, termBaby).level).toBe('GREEN');
  });

  describe('temperature thresholds', () => {
    it.each([
      [38.0, 'RED', 'FEVER'],
      [39.2, 'RED', 'FEVER'],
      [37.9, 'YELLOW', 'TEMPERATURE_RAISED'],
      [37.5, 'YELLOW', 'TEMPERATURE_RAISED'],
      [37.4, 'GREEN', undefined],
      [36.5, 'GREEN', undefined],
      [36.4, 'YELLOW', 'HYPOTHERMIA_MILD'],
      [36.0, 'YELLOW', 'HYPOTHERMIA_MILD'],
      [35.9, 'RED', 'HYPOTHERMIA_SEVERE'],
    ])('%s°C → %s', (temperatureC, level, code) => {
      const r = assessRisk({ ...normal, temperatureC }, termBaby);
      expect(r.level).toBe(level);
      if (code) expect(r.findings.map((f) => f.code)).toContain(code);
    });
  });

  it.each<[string, ObservationInput]>([
    ['CONVULSIONS', { convulsions: true }],
    ['UNABLE_TO_FEED', { feedingQuality: FeedingQuality.UNABLE }],
    ['LETHARGIC', { activity: ActivityLevel.LETHARGIC }],
    ['DIFFICULT_BREATHING', { breathing: BreathingStatus.DIFFICULT }],
    ['FAST_BREATHING', { breathing: BreathingStatus.FAST }],
    ['CYANOSIS', { skinColor: SkinColor.BLUE }],
    ['CORD_INFECTION_SEVERE', { cordStatus: CordStatus.SPREADING_REDNESS_OR_PUS }],
    ['BLOODY_STOOL', { stoolPattern: StoolPattern.BLOODY }],
    ['HIGH_PITCHED_CRY', { cry: CryDescription.HIGH_PITCHED }],
    ['JAUNDICE_SEVERE', { jaundice: JaundiceLevel.PALMS_SOLES }],
  ])('danger sign %s → RED even with a normal temperature', (code, patch) => {
    const r = assessRisk({ ...normal, ...patch }, termBaby);
    expect(r.level).toBe('RED');
    expect(r.findings.map((f) => f.code)).toContain(code);
    expect(r.actions[0]).toBe('SEEK_CARE_NOW');
  });

  it('treats any jaundice in the first 24 hours as RED', () => {
    const r = assessRisk({ ...normal, jaundice: JaundiceLevel.FACE_CHEST }, { ageHours: 12 });
    expect(r.level).toBe('RED');
    expect(r.findings.map((f) => f.code)).toContain('JAUNDICE_EARLY');
  });

  it('treats face/chest jaundice after 24 hours as YELLOW', () => {
    const r = assessRisk({ ...normal, jaundice: JaundiceLevel.FACE_CHEST }, termBaby);
    expect(r.level).toBe('YELLOW');
    expect(r.actions).toContain('CHECK_JAUNDICE_IN_DAYLIGHT');
  });

  it('counts yellow skin as jaundice', () => {
    expect(codes({ ...normal, skinColor: SkinColor.YELLOW })).toContain('JAUNDICE');
  });

  it('flags infrequent feeding', () => {
    const r = assessRisk({ ...normal, feedingCount24h: 5 }, termBaby);
    expect(r.level).toBe('YELLOW');
    expect(r.actions).toContain('FEED_MORE_OFTEN');
  });

  it('escalates three or more YELLOW findings to RED', () => {
    const r = assessRisk(
      {
        ...normal,
        temperatureC: 37.6,
        feedingQuality: FeedingQuality.REDUCED,
        activity: ActivityLevel.REDUCED,
      },
      termBaby,
    );
    expect(r.level).toBe('RED');
    expect(r.findings.map((f) => f.code)).toContain('MULTIPLE_CONCERNS');
  });

  it('keeps two YELLOW findings at YELLOW', () => {
    const r = assessRisk(
      { ...normal, temperatureC: 37.6, feedingQuality: FeedingQuality.REDUCED },
      termBaby,
    );
    expect(r.level).toBe('YELLOW');
  });

  it('escalates any concern in a preterm baby during the first week to RED', () => {
    const r = assessRisk(
      { ...normal, cordStatus: CordStatus.RED_OR_DISCHARGE },
      { ageHours: 3 * 24, gestationalAgeWeeks: 34 },
    );
    expect(r.level).toBe('RED');
    expect(r.findings.map((f) => f.code)).toContain('HIGH_RISK_BABY_WITH_CONCERN');
  });

  it('escalates any concern in a low-birth-weight baby during the first week to RED', () => {
    const r = assessRisk(
      { ...normal, cry: CryDescription.WEAK },
      { ageHours: 48, birthWeightGrams: 2100 },
    );
    expect(r.level).toBe('RED');
  });

  it('does not escalate a single concern in a preterm baby after the first week', () => {
    const r = assessRisk(
      { ...normal, cordStatus: CordStatus.RED_OR_DISCHARGE },
      { ageHours: 10 * 24, gestationalAgeWeeks: 34 },
    );
    expect(r.level).toBe('YELLOW');
  });

  it('suggests warming for hypothermia and clothing removal for fever', () => {
    expect(assessRisk({ temperatureC: 35.5 }, termBaby).actions).toContain(
      'WARM_SKIN_TO_SKIN_ON_THE_WAY',
    );
    expect(assessRisk({ temperatureC: 38.5 }, termBaby).actions).toContain('REMOVE_EXTRA_CLOTHING');
  });

  it('stamps the engine version', () => {
    expect(assessRisk(normal, termBaby).engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
