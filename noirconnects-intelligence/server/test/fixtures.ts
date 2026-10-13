/** Synthetic research data. All domains use the reserved .example TLD; no real companies or people. */
export function brandRecord(n: number, overrides: Record<string, unknown> = {}) {
  return {
    name: `Synthetic Peripherals ${n}`,
    website: `https://www.synthetic-peripherals-${n}.example`,
    industry: 'Gaming',
    subcategory: 'Gaming peripherals',
    targetMarkets: ['United States', 'United Kingdom'],
    productsServices: 'Mechanical keyboards, mice and headsets',
    influencerActivitySummary: 'Sponsors mid-size streamers for product launches.',
    recommendationReason: 'Recent paid creator sponsorships and an active ambassador program.',
    researchedAt: '2026-03-01T09:00:00.000Z',
    contactName: { value: 'Alex Example', verified: true },
    contactRole: { value: 'Partnerships Manager', verified: true },
    contactEmail: { value: `partnerships@synthetic-peripherals-${n}.example`, verified: true },
    contactChannelUrl: `https://synthetic-peripherals-${n}.example/partners`,
    evidence: [
      {
        type: 'PAID_SPONSORSHIP',
        description: 'Sponsored launch video with a streamer (#ad disclosed).',
        sourceUrl: `https://video.example/watch?v=sp${n}`,
        date: '2026-01-20',
        creatorName: 'Synthetic Streamer',
        platform: 'YouTube',
        verified: true,
      },
      {
        type: 'AFFILIATE_PROGRAM',
        description: 'Public affiliate program page offering commission on sales.',
        sourceUrl: `https://synthetic-peripherals-${n}.example/affiliates`,
        date: null,
        verified: true,
      },
    ],
    ...overrides,
  };
}

export function researchFile(brands: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'brand-research/v1',
    configVersion: 1,
    niche: 'Gaming',
    generatedAt: '2026-03-02T08:00:00.000Z',
    producedBy: 'Test fixture',
    brands,
    ...overrides,
  };
}

export const jsonInput = (file: unknown, fileName = 'research.json') => ({
  format: 'JSON' as const,
  content: JSON.stringify(file),
  fileName,
});
