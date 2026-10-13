import type { IntelligenceConfig } from './config.js';
import { effectiveNiche } from './config.js';
import { PARTNERSHIP_EVIDENCE, type BrandRecordInput, type EvidenceInput } from './brandResearch.js';
import { emailDomain } from './domains.js';

/**
 * Deterministic, explainable brand quality score (0–100). The score is computed by the
 * application from the evidence supplied — a researcher-suggested score is never trusted.
 *
 *   Evidence strength      40  verified paid sponsorships / ambassador programs / creator
 *                              announcements count most; affiliate programs count little
 *   Evidence recency       25  most recent partnership evidence vs. the configured window
 *   Contactability         15  verified partnership email > official contact page > unverified email
 *   Profile completeness   10  subcategory, products, target markets, activity summary
 *   Niche fit              10  record matches the configured niche (and priority subcategories)
 */
export interface QualityBreakdown {
  evidence: number;
  recency: number;
  contactability: number;
  completeness: number;
  nicheFit: number;
  total: number;
  notes: string[];
}

const NICHE_PRIORITY_KEYWORDS: Record<string, string[]> = {
  gaming: [
    'peripheral', 'hardware', 'pc', 'monitor', 'controller', 'accessor', 'chair', 'furniture', 'desk',
    'publisher', 'game', 'software', 'service', 'stream', 'creator tool', 'capture', 'microphone', 'headset', 'esport',
  ],
};

const MONTH_MS = 30.44 * 24 * 3600_000;

export function evidenceDateToTime(date: string | null): number | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number | undefined];
  return Date.UTC(y, m - 1, d ?? 1);
}

function evidencePoints(e: EvidenceInput): number {
  if (PARTNERSHIP_EVIDENCE.has(e.type)) return e.verified ? 15 : e.sourceUrl ? 6 : 2;
  if (e.type === 'AFFILIATE_PROGRAM') return e.verified ? 6 : 2;
  return e.verified ? 4 : 1;
}

export function scoreBrand(record: BrandRecordInput, config: IntelligenceConfig, now: Date): QualityBreakdown {
  const notes: string[] = [];

  // Evidence strength
  const evidence = Math.min(40, record.evidence.reduce((sum, e) => sum + evidencePoints(e), 0));

  // Recency — only partnership evidence that has a source counts toward full marks.
  const window = config.sponsorshipRecencyMonths;
  const ageMonths = (e: EvidenceInput) => {
    const t = evidenceDateToTime(e.date);
    return t === null ? null : (now.getTime() - t) / MONTH_MS;
  };
  const partnershipAges = record.evidence
    .filter((e) => PARTNERSHIP_EVIDENCE.has(e.type) && e.sourceUrl)
    .map(ageMonths)
    .filter((a): a is number => a !== null);
  let recency: number;
  if (partnershipAges.length) {
    const newest = Math.min(...partnershipAges);
    recency = newest <= window / 2 ? 25 : newest <= window ? 18 : newest <= window * 2 ? 8 : 3;
    if (newest > window) notes.push(`Newest partnership evidence is older than ${window} months`);
  } else {
    const anyAges = record.evidence.map(ageMonths).filter((a): a is number => a !== null);
    recency = anyAges.some((a) => a <= window) ? 8 : 4;
    notes.push(record.evidence.some((e) => PARTNERSHIP_EVIDENCE.has(e.type)) ? 'Partnership evidence is undated' : 'No partnership evidence (sponsorship, ambassador or announcement)');
  }

  // Contactability
  let contactability = 0;
  if (record.contactEmail?.verified) contactability = 15;
  else if (record.contactChannelUrl) contactability = 8;
  else if (record.contactEmail) contactability = 5;
  if (contactability < 15) notes.push('No verified partnership email');

  // Completeness
  const completeness = Math.round(
    [record.subcategory, record.productsServices, record.targetMarkets.length ? 'x' : null, record.influencerActivitySummary].filter(Boolean)
      .length * 2.5,
  );

  // Niche fit
  const niche = effectiveNiche(config).toLowerCase();
  const haystack = [record.industry, record.subcategory, record.productsServices].filter(Boolean).join(' ').toLowerCase();
  const nicheWords = niche.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let nicheFit = 0;
  if (haystack.includes(niche) || nicheWords.some((w) => haystack.includes(w))) nicheFit = 7;
  const priority = NICHE_PRIORITY_KEYWORDS[niche];
  const sub = (record.subcategory ?? '').toLowerCase();
  if (priority ? priority.some((k) => sub.includes(k)) && nicheFit > 0 : nicheFit > 0) nicheFit = 10;
  if (nicheFit === 0) notes.push(`Industry/subcategory does not mention the ${effectiveNiche(config)} niche`);

  const total = Math.max(0, Math.min(100, evidence + recency + contactability + completeness + nicheFit));
  return { evidence, recency, contactability, completeness, nicheFit, total, notes };
}

/** Non-blocking issues the reviewer should see. */
export function brandWarnings(record: BrandRecordInput, domain: string, config: IntelligenceConfig, now: Date): string[] {
  const w: string[] = [];
  const partnership = record.evidence.filter((e) => PARTNERSHIP_EVIDENCE.has(e.type));
  if (!partnership.length && record.evidence.some((e) => e.type === 'AFFILIATE_PROGRAM')) {
    w.push('Affiliate program only — no paid sponsorship or ambassador evidence');
  } else if (!partnership.some((e) => e.verified)) {
    w.push('Partnership evidence is unverified');
  }
  if (record.evidence.every((e) => !e.verified)) w.push('All evidence is unverified');
  const cutoff = now.getTime() - config.sponsorshipRecencyMonths * MONTH_MS;
  if (!record.evidence.some((e) => (evidenceDateToTime(e.date) ?? 0) >= cutoff)) {
    w.push(`No evidence dated within the last ${config.sponsorshipRecencyMonths} months`);
  }
  if (record.contactEmail && !record.contactEmail.verified) w.push('Contact email is unverified');
  if (record.contactEmail) {
    const ed = emailDomain(record.contactEmail.value);
    if (ed && ed !== domain && !ed.endsWith(`.${domain}`)) w.push(`Contact email domain (${ed}) differs from the website (${domain})`);
  }
  if (!record.contactEmail && !record.contactChannelUrl) w.push('No contact email or official contact channel');
  if (record.contactName && !record.contactName.verified) w.push('Contact name is unverified');
  if (record.contactRole && !record.contactRole.verified) w.push('Contact role is unverified');
  return w;
}
