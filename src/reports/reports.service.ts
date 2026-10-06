import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { BabiesService } from '../babies/babies.service';
import { checksPerDay } from '../triage/check-schedule';
import { ChecksService } from '../checks/checks.service';
import { RiskLevel } from '../generated/prisma/enums';
import { GrowthService } from '../growth/growth.service';
import { PrismaService } from '../prisma/prisma.service';

export type SummaryDays = 3 | 7;
export type Summary = Awaited<ReturnType<ReportsService['summary']>>;

/**
 * Clinician-ready summary of the last N days (FR-RPT-01). The same JSON is snapshotted
 * onto a consultation when it is paid (FR-CONS-06).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly babies: BabiesService,
    private readonly checks: ChecksService,
    private readonly growth: GrowthService,
  ) {}

  /** Caller must have already authorised access to `babyId`. */
  async summary(babyId: string, days: SummaryDays, now = new Date()) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const [baby, row, rows] = await Promise.all([
      this.babies.presentById(babyId),
      this.prisma.baby.findUniqueOrThrow({ where: { id: babyId } }),
      this.prisma.observation.findMany({
        where: { babyId, observedAt: { gte: since, lte: now } },
        orderBy: { observedAt: 'asc' },
      }),
    ]);
    const growth = await this.growth.growth(row);
    const obs = rows.map((o) => this.checks.present(o));
    const temps = obs.filter((o) => o.temperatureC != null).map((o) => o.temperatureC as number);
    const count = (level: RiskLevel) => obs.filter((o) => o.riskLevel === level).length;
    const findingCounts: Record<string, number> = {};
    for (const o of obs)
      for (const f of o.findings) findingCounts[f.code] = (findingCounts[f.code] ?? 0) + 1;

    return {
      generatedAt: now.toISOString(),
      period: { days, from: since.toISOString(), to: now.toISOString() },
      baby,
      growth,
      totals: {
        checks: obs.length,
        expectedChecks: days * checksPerDay(row.dateOfBirth, now),
        unwellChecks: obs.filter((o) => o.checkType === 'UNWELL').length,
        green: count(RiskLevel.GREEN),
        yellow: count(RiskLevel.YELLOW),
        red: count(RiskLevel.RED),
      },
      latestRiskLevel: obs.at(-1)?.riskLevel ?? null,
      temperature: temps.length
        ? { min: Math.min(...temps), max: Math.max(...temps), latest: temps.at(-1) }
        : null,
      findingCounts,
      observations: obs.map((o) => ({
        id: o.id,
        observedAt: o.observedAt,
        checkType: o.checkType,
        complaints: o.complaints,
        complaintText: o.complaintText,
        riskLevel: o.riskLevel,
        temperatureC: o.temperatureC,
        respiratoryRate: o.respiratoryRate,
        feedingCount24h: o.feedingCount24h,
        feedingQuality: o.feedingQuality,
        breathing: o.breathing,
        chestIndrawing: o.chestIndrawing,
        breathingSound: o.breathingSound,
        activity: o.activity,
        cry: o.cry,
        skinColor: o.skinColor,
        jaundice: o.jaundice,
        stoolPattern: o.stoolPattern,
        vomiting: o.vomiting,
        cordStatus: o.cordStatus,
        roomFeel: o.roomFeel,
        clothing: o.clothing,
        convulsions: o.convulsions,
        notes: o.notes,
        voiceNoteId: o.voiceNoteId,
        findings: o.findings.map((f) => f.code),
      })),
    };
  }

  /** FR-RPT-02: the summary as a printable PDF. */
  async pdf(babyId: string, days: SummaryDays, lang: 'en' | 'fr'): Promise<Buffer> {
    const s = await this.summary(babyId, days);
    const L = LABELS[lang];
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `NeoWell ${L.title}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );
    const fmt = (d: string | Date) =>
      new Date(d).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'Africa/Douala' });
    const blue = '#2C6CB5';

    doc.fillColor(blue).fontSize(20).text(`NeoWell — ${L.title}`);
    doc
      .fillColor('#5E6E82')
      .fontSize(10)
      .text(`${L.period}: ${fmt(s.period.from)} → ${fmt(s.period.to)}`);
    doc.moveDown();
    doc
      .fillColor('#1E2B3C')
      .fontSize(14)
      .text(
        s.baby.displayName +
          (s.baby.givenName && s.baby.givenName !== s.baby.displayName
            ? ` (${s.baby.givenName})`
            : ''),
      );
    doc
      .fontSize(10)
      .text(
        [
          `${L.born}: ${new Date(s.baby.dateOfBirth).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')} (${s.baby.ageDays} ${L.days})`,
          s.baby.gestationalAgeWeeks ? `${s.baby.gestationalAgeWeeks} ${L.weeks}` : null,
          s.baby.birthWeightGrams ? `${s.baby.birthWeightGrams} g` : null,
          s.baby.birthLengthCm ? `${s.baby.birthLengthCm} cm` : null,
          s.baby.birthHeadCircumferenceCm ? `HC ${s.baby.birthHeadCircumferenceCm} cm` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
    if (s.baby.riskFactors.length)
      doc.text(`${L.risk}: ${s.baby.riskFactors.map((r) => r.code).join(', ')}`);
    const g = s.growth.latest;
    doc.text(
      `${L.latest}: ` +
        [
          g.weight ? `${g.weight.value} g (z ${g.weight.zScore ?? '—'})` : null,
          g.length ? `${g.length.value} cm (z ${g.length.zScore ?? '—'})` : null,
          g.headCircumference
            ? `HC ${g.headCircumference.value} cm (z ${g.headCircumference.zScore ?? '—'})`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
    );
    doc.moveDown();
    doc.fontSize(12).fillColor(blue).text(L.totals);
    doc
      .fillColor('#1E2B3C')
      .fontSize(10)
      .text(
        `${s.totals.checks}/${s.totals.expectedChecks} ${L.checks} · ${L.green} ${s.totals.green} · ${L.yellow} ${s.totals.yellow} · ${L.red} ${s.totals.red}` +
          (s.temperature ? ` · ${s.temperature.min}–${s.temperature.max} °C` : ''),
      );
    doc.moveDown();
    doc.fontSize(12).fillColor(blue).text(L.checksTitle);
    doc.fillColor('#1E2B3C').fontSize(9);
    for (const o of [...s.observations].reverse()) {
      doc.text(
        `${fmt(o.observedAt)} — ${o.riskLevel} — ${o.temperatureC ?? '—'} °C` +
          (o.respiratoryRate ? ` · ${o.respiratoryRate}/min` : '') +
          (o.findings.length ? ` — ${o.findings.join(', ')}` : ''),
      );
    }
    doc.moveDown().fontSize(8).fillColor('#5E6E82').text(L.disclaimer);
    doc.end();
    return done;
  }
}

const LABELS = {
  en: {
    title: 'Health summary',
    period: 'Period',
    born: 'Born',
    days: 'days',
    weeks: 'weeks of pregnancy',
    risk: 'Risk factors',
    latest: 'Latest measurements',
    totals: 'Checks',
    checks: 'checks',
    green: 'Green',
    yellow: 'Yellow',
    red: 'Red',
    checksTitle: 'All checks',
    disclaimer:
      'Generated by NeoWell from caregiver-reported checks. Supportive information, not a diagnosis.',
  },
  fr: {
    title: 'Résumé de santé',
    period: 'Période',
    born: 'Né(e) le',
    days: 'jours',
    weeks: 'semaines de grossesse',
    risk: 'Facteurs de risque',
    latest: 'Dernières mesures',
    totals: 'Contrôles',
    checks: 'contrôles',
    green: 'Vert',
    yellow: 'Jaune',
    red: 'Rouge',
    checksTitle: 'Tous les contrôles',
    disclaimer:
      'Généré par NeoWell à partir des contrôles saisis par l’aidant. Information de soutien, pas un diagnostic.',
  },
};
