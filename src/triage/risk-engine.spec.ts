import {
  ActivityLevel,
  BreathingSound,
  BreathingStatus,
  ClothingLevel,
  CordStatus,
  CryDescription,
  FeedingQuality,
  JaundiceLevel,
  RoomFeel,
  SkinColor,
  StoolPattern,
  VomitingStatus,
} from '../generated/prisma/enums';
import { assessRisk, BabyContext, ObservationInput } from './risk-engine';

const days = (d: number): BabyContext => ({
  ageHours: d * 24,
  gestationalAgeWeeks: 39,
  birthWeightGrams: 3200,
});
const termBaby = days(10);
const olderBaby = days(150); // 5 months
const normal: ObservationInput = {
  temperatureC: 36.9,
  feedingCount24h: 9,
  feedingQuality: FeedingQuality.GOOD,
  stoolPattern: StoolPattern.NORMAL,
  skinColor: SkinColor.NORMAL,
  cry: CryDescription.NORMAL,
  activity: ActivityLevel.NORMAL,
  breathing: BreathingStatus.NORMAL,
  respiratoryRate: 45,
  chestIndrawing: false,
  breathingSound: BreathingSound.QUIET,
  jaundice: JaundiceLevel.NONE,
  cordStatus: CordStatus.NORMAL,
  vomiting: VomitingStatus.NONE,
  convulsions: false,
};
const codes = (obs: ObservationInput, ctx = termBaby, opts = {}) =>
  assessRisk(obs, ctx, undefined, opts).findings.map((f) => f.code);

describe('assessRisk v0.2', () => {
  it('returns GREEN for a well baby', () => {
    const r = assessRisk(normal, termBaby);
    expect(r).toMatchObject({
      level: 'GREEN',
      findings: [],
      actions: ['CONTINUE_ROUTINE_CARE'],
      recheck: false,
    });
    expect(r.engineVersion).toBe('0.2.0');
  });

  describe('fever by age (§6.1–6.2)', () => {
    it('makes any fever RED under 90 days, with cooling steps on the way', () => {
      const r = assessRisk({ ...normal, temperatureC: 38.1 }, days(60));
      expect(r.level).toBe('RED');
      expect(codes({ ...normal, temperatureC: 38.1 }, days(60))).toContain('FEVER_YOUNG_INFANT');
      expect(r.actions).toEqual(expect.arrayContaining(['SEEK_CARE_NOW', 'COOLING_STEPS']));
      expect(r.recheck).toBe(false);
    });

    it('gives a moderate fever from 3 months cooling steps and a 30-minute recheck', () => {
      const r = assessRisk({ ...normal, temperatureC: 38.4 }, olderBaby);
      expect(r.level).toBe('YELLOW');
      expect(r.findings).toEqual([{ code: 'FEVER_MODERATE', level: 'YELLOW' }]);
      expect(r.actions).toEqual(
        expect.arrayContaining(['COOLING_STEPS', 'REMOVE_EXTRA_CLOTHING', 'RECHECK_TEMP_30_MIN']),
      );
      expect(r.recheck).toBe(true);
    });

    it('escalates a fever that persists at the recheck', () => {
      const r = assessRisk({ ...normal, temperatureC: 38.2 }, olderBaby, undefined, {
        isRecheck: true,
      });
      expect(r.level).toBe('RED');
      expect(r.findings.map((f) => f.code)).toContain('FEVER_PERSISTENT');
    });

    it.each([
      [39.2, 'FEVER_HIGH'],
      [40.1, 'FEVER_VERY_HIGH'],
    ])('%s °C at 5 months → RED %s with a fits warning', (t, code) => {
      const r = assessRisk({ ...normal, temperatureC: t }, olderBaby);
      expect(r.level).toBe('RED');
      expect(r.findings.map((f) => f.code)).toContain(code);
      expect(r.actions).toContain('WATCH_FOR_FITS');
    });

    it('points to overheating when the room is hot or the baby is wrapped up', () => {
      const r = assessRisk(
        { ...normal, temperatureC: 37.7, roomFeel: RoomFeel.HOT, clothing: ClothingLevel.HEAVY },
        termBaby,
      );
      expect(r.level).toBe('YELLOW');
      expect(r.findings.map((f) => f.code)).toEqual(['TEMPERATURE_RAISED', 'OVERHEATING_LIKELY']);
      expect(r.actions).toEqual(
        expect.arrayContaining(['REMOVE_EXTRA_CLOTHING', 'COOL_ROOM', 'RECHECK_TEMP_30_MIN']),
      );
    });

    it.each([
      [37.4, 'GREEN'],
      [36.5, 'GREEN'],
      [36.4, 'YELLOW'],
      [35.9, 'RED'],
    ])('%s °C → %s', (t, level) =>
      expect(assessRisk({ ...normal, temperatureC: t }, termBaby).level).toBe(level),
    );
  });

  describe('breathing (§6.1)', () => {
    it.each([
      [62, 10, 'RED', 'FAST_BREATHING'],
      [59, 10, 'GREEN', undefined],
      [55, 120, 'YELLOW', 'FAST_BREATHING_INFANT'],
      [28, 10, 'RED', 'SLOW_BREATHING'],
    ])('%i breaths/min at %i days → %s', (rr, d, level, code) => {
      const r = assessRisk({ ...normal, respiratoryRate: rr }, days(d));
      expect(r.level).toBe(level);
      if (code) expect(r.findings.map((f) => f.code)).toContain(code);
    });

    it.each<[string, ObservationInput]>([
      ['CHEST_INDRAWING', { chestIndrawing: true }],
      ['GRUNTING', { breathingSound: BreathingSound.GRUNTING }],
      ['NOISY_BREATHING', { breathingSound: BreathingSound.NOISY }],
      ['DIFFICULT_BREATHING', { breathing: BreathingStatus.DIFFICULT }],
    ])('%s → RED', (code, patch) => {
      expect(codes({ ...normal, ...patch })).toContain(code);
      expect(assessRisk({ ...normal, ...patch }, termBaby).level).toBe('RED');
    });

    it('uses the "fast" answer when no count was made', () => {
      expect(
        codes({ ...normal, respiratoryRate: null, breathing: BreathingStatus.FAST }),
      ).toContain('FAST_BREATHING');
    });

    it('treats wheezing as YELLOW', () => {
      expect(
        assessRisk({ ...normal, breathingSound: BreathingSound.WHEEZING }, termBaby).level,
      ).toBe('YELLOW');
    });
  });

  it.each<[string, ObservationInput]>([
    ['CONVULSIONS', { convulsions: true }],
    ['UNABLE_TO_FEED', { feedingQuality: FeedingQuality.UNABLE }],
    ['LETHARGIC', { activity: ActivityLevel.LETHARGIC }],
    ['CYANOSIS', { skinColor: SkinColor.BLUE }],
    ['CORD_INFECTION_SEVERE', { cordStatus: CordStatus.SPREADING_REDNESS_OR_PUS }],
    ['BLOODY_STOOL', { stoolPattern: StoolPattern.BLOODY }],
    ['HIGH_PITCHED_CRY', { cry: CryDescription.HIGH_PITCHED }],
    ['JAUNDICE_SEVERE', { jaundice: JaundiceLevel.PALMS_SOLES }],
    ['VOMITING_GREEN_OR_FORCEFUL', { vomiting: VomitingStatus.FORCEFUL_OR_GREEN }],
  ])('danger sign %s → RED', (code, patch) => {
    const r = assessRisk({ ...normal, ...patch }, termBaby);
    expect(r.level).toBe('RED');
    expect(r.findings.map((f) => f.code)).toContain(code);
    expect(r.actions[0]).toBe('SEEK_CARE_NOW');
  });

  it.each<[string, ObservationInput]>([
    ['NOT_CRYING', { cry: CryDescription.NONE }],
    ['FLUSHED_SKIN', { skinColor: SkinColor.FLUSHED }],
    ['VOMITING_REPEATED', { vomiting: VomitingStatus.REPEATED }],
    ['FEEDING_INFREQUENT', { feedingCount24h: 5 }],
  ])('early concern %s → YELLOW', (code, patch) => {
    const r = assessRisk({ ...normal, ...patch }, termBaby);
    expect(r.level).toBe('YELLOW');
    expect(r.findings.map((f) => f.code)).toContain(code);
  });

  it('accepts 6 feeds a day (clinical lead threshold)', () => {
    expect(assessRisk({ ...normal, feedingCount24h: 6 }, termBaby).level).toBe('GREEN');
  });

  describe('jaundice by age', () => {
    it('is RED in the first 24 hours', () => {
      expect(codes({ ...normal, jaundice: JaundiceLevel.FACE_CHEST }, days(0.5))).toContain(
        'JAUNDICE_EARLY',
      );
    });
    it('is YELLOW after 24 hours', () => {
      expect(codes({ ...normal, jaundice: JaundiceLevel.FACE_CHEST }, days(4))).toEqual([
        'JAUNDICE',
      ]);
    });
    it('is flagged as prolonged after 14 days', () => {
      expect(codes({ ...normal, jaundice: JaundiceLevel.FACE_CHEST }, days(20))).toEqual([
        'PROLONGED_JAUNDICE',
      ]);
    });
  });

  describe('composite rules (§6.3)', () => {
    it('escalates three concerns to RED', () => {
      const r = assessRisk(
        {
          ...normal,
          feedingQuality: FeedingQuality.REDUCED,
          activity: ActivityLevel.REDUCED,
          cry: CryDescription.WEAK,
        },
        termBaby,
      );
      expect(r.level).toBe('RED');
      expect(r.findings.map((f) => f.code)).toContain('MULTIPLE_CONCERNS');
    });

    it('does not count OVERHEATING_LIKELY as a separate concern', () => {
      const r = assessRisk(
        {
          ...normal,
          temperatureC: 37.6,
          roomFeel: RoomFeel.HOT,
          feedingQuality: FeedingQuality.REDUCED,
        },
        termBaby,
      );
      expect(r.level).toBe('YELLOW');
    });

    it('escalates any concern in a preterm baby in the first week', () => {
      const r = assessRisk(
        { ...normal, cry: CryDescription.WEAK },
        { ageHours: 72, gestationalAgeWeeks: 35 },
      );
      expect(r.level).toBe('RED');
      expect(r.findings.map((f) => f.code)).toContain('HIGH_RISK_BABY_WITH_CONCERN');
    });

    it('extends the window to 28 days for very preterm or VLBW babies', () => {
      expect(
        assessRisk(
          { ...normal, cry: CryDescription.WEAK },
          { ageHours: 20 * 24, gestationalAgeWeeks: 30 },
        ).level,
      ).toBe('RED');
      expect(
        assessRisk(
          { ...normal, cry: CryDescription.WEAK },
          { ageHours: 20 * 24, gestationalAgeWeeks: 35 },
        ).level,
      ).toBe('YELLOW');
      expect(
        assessRisk(
          { ...normal, cry: CryDescription.WEAK },
          { ageHours: 20 * 24, birthWeightGrams: 1400 },
        ).level,
      ).toBe('RED');
    });
  });

  describe('newborn medicine warning (FR-CHK-07)', () => {
    it('is added to every non-GREEN result under 42 days', () => {
      expect(assessRisk({ ...normal, cry: CryDescription.WEAK }, days(20)).actions).toContain(
        'NO_HOME_MEDICINES',
      );
      expect(assessRisk({ ...normal, convulsions: true }, days(20)).actions).toContain(
        'NO_HOME_MEDICINES',
      );
    });
    it('is not added from 42 days or for GREEN', () => {
      expect(assessRisk({ ...normal, cry: CryDescription.WEAK }, days(50)).actions).not.toContain(
        'NO_HOME_MEDICINES',
      );
      expect(assessRisk(normal, days(20)).actions).not.toContain('NO_HOME_MEDICINES');
    });
  });
});
