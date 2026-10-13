export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${humanize(k)}: ${formatValue(val)}`)
      .join(' · ');
  }
  return String(v);
}

export function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/\b(Bd)\b/, 'business days');
}

export const SETTING_LABELS: Record<string, string> = {
  activeNiche: 'Active niche',
  customNiche: 'Custom niche',
  dailyBrandTarget: 'Daily brand discovery target',
  targetGeography: 'Target geography',
  targetLanguage: 'Target language',
  researchFrequency: 'Research frequency',
  discoveryMode: 'Discovery mode',
  minBrandQualityScore: 'Minimum brand quality score',
  sponsorshipRecencyMonths: 'Sponsorship evidence recency (months)',
  businessTimeZone: 'Business time zone',
  creatorsPerResearchAssignment: 'Creators per research assignment',
  creatorRankingWeights: 'Creator ranking weights (%)',
  followUpPolicy: 'Follow-up policy',
  requireCreatorAvailabilityConfirmation: 'Require creator availability confirmation before proposals',
  automaticExternalCommunication: 'Automatic external communication',
  humanApprovalRequired: 'Human approval required',
};

export const FREQUENCY_LABELS: Record<string, string> = {
  DAILY: 'Daily',
  WEEKDAYS: 'Weekdays',
  WEEKLY: 'Weekly',
  MANUAL: 'Manual only',
};

export const DISCOVERY_MODE_LABELS: Record<string, string> = {
  VERIFIED_INFLUENCER_ACTIVITY: 'Brands with verifiable influencer marketing activity',
};
