import {
  detectComplaints,
  QUESTIONS,
  ROUTINE_CORE,
  routinePlan,
  unwellPlan,
} from './question-bank';

describe('routinePlan', () => {
  it('asks the core questions plus 3 rotating ones, temperature first and required', () => {
    const plan = routinePlan(10, new Map(), 'en');
    expect(plan[0]).toMatchObject({ id: 'temperature', kind: 'TEMPERATURE', required: true });
    expect(plan.map((q) => q.id).slice(0, ROUTINE_CORE.length)).toEqual(ROUTINE_CORE);
    expect(plan).toHaveLength(ROUTINE_CORE.length + 3);
    expect(plan.filter((q) => q.required)).toHaveLength(1);
  });

  it('rotates: questions answered least recently come first', () => {
    const now = Date.now();
    const answered = new Map<string, Date>([
      ['respiratoryRate', new Date(now - 1000)],
      ['skinColor', new Date(now - 2000)],
      ['jaundice', new Date(now - 3000)],
    ]);
    const ids = routinePlan(10, answered, 'en')
      .slice(ROUTINE_CORE.length)
      .map((q) => q.id);
    expect(ids).toEqual(['cry', 'stoolPattern', 'cordStatus']);
  });

  it('stops asking about the cord after 21 days', () => {
    const answered = new Map([
      ['respiratoryRate', new Date()],
      ['skinColor', new Date()],
      ['jaundice', new Date()],
      ['cry', new Date()],
      ['stoolPattern', new Date()],
    ]);
    expect(routinePlan(40, answered, 'en').map((q) => q.id)).not.toContain('cordStatus');
  });

  it('only shows room and clothing questions when the temperature is outside 36.5–37.5', () => {
    const room = routinePlan(10, new Map(), 'en').find((q) => q.id === 'roomFeel')!;
    expect(room.showIf).toEqual({ field: 'temperatureC', notBetween: [36.5, 37.5] });
  });

  it('localises labels, help and options', () => {
    const conv = routinePlan(10, new Map(), 'fr').find((q) => q.id === 'convulsions')!;
    expect(conv.label).toMatch(/Convulsions/);
    expect(conv.help).toMatch(/secousses/);
    expect(conv.options).toEqual([
      { value: 'false', label: 'Non', danger: false },
      { value: 'true', label: 'Oui', danger: true },
    ]);
  });
});

describe('unwellPlan', () => {
  it('asks temperature first, then questions for each complaint without duplicates', () => {
    const ids = unwellPlan(['FEVER', 'VOMITING'], 30, 'en').map((q) => q.id);
    expect(ids[0]).toBe('temperature');
    expect(ids).toEqual(
      expect.arrayContaining(['roomFeel', 'clothing', 'convulsions', 'vomiting', 'stoolPattern']),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('always shows room/clothing for fever, but only conditionally otherwise', () => {
    expect(
      unwellPlan(['FEVER'], 30, 'en').find((q) => q.id === 'roomFeel')!.showIf,
    ).toBeUndefined();
    expect(
      unwellPlan(['VOMITING'], 30, 'en').find((q) => q.id === 'roomFeel')!.showIf,
    ).toBeDefined();
  });

  it('includes the breath counter for breathing problems', () => {
    expect(unwellPlan(['BREATHING_PROBLEM'], 30, 'en').map((q) => q.kind)).toContain(
      'BREATH_COUNTER',
    );
  });

  it('falls back to general questions with no complaint', () => {
    expect(unwellPlan([], 30, 'en').length).toBeGreaterThan(3);
  });
});

describe('question bank content', () => {
  it('has English and French text for every label and option', () => {
    for (const q of Object.values(QUESTIONS)) {
      expect(q.label.en && q.label.fr).toBeTruthy();
      for (const o of q.options ?? []) expect(o.label.en && o.label.fr).toBeTruthy();
    }
  });
});

describe('detectComplaints', () => {
  it.each([
    ['The baby is very hot and keeps vomiting', ['FEVER', 'VOMITING']],
    ['Le bébé a de la fièvre et des secousses', ['FEVER', 'TWITCHING_OR_FITS']],
    ['she is breathing fast', ['BREATHING_PROBLEM']],
    ['ses yeux sont jaunes', ['YELLOW_SKIN_OR_EYES']],
    ['il a froid et les lèvres bleues', ['FEELS_COLD', 'SKIN_COLOUR_CHANGE']],
  ])('%p → %p', (text, expected) => {
    expect(detectComplaints(text)).toEqual(expected);
  });
});
