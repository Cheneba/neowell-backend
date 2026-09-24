import { boundingBox, haversineKm } from './geo';

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(5.96, 10.15, 5.96, 10.15)).toBe(0);
  });

  it('matches the known Bamenda → Yaoundé great-circle distance (~278 km)', () => {
    const d = haversineKm(5.9597, 10.1453, 3.848, 11.5021);
    expect(d).toBeGreaterThan(270);
    expect(d).toBeLessThan(290);
  });
});

describe('boundingBox', () => {
  it('contains points at the radius in every direction', () => {
    const box = boundingBox(5.96, 10.15, 50);
    expect(box.maxLat - 5.96).toBeCloseTo(0.4497, 3);
    expect(box.minLon).toBeLessThan(10.15 - 0.44);
  });
});
