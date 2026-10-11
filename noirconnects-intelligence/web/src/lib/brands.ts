export const EVIDENCE_LABELS: Record<string, string> = {
  PAID_SPONSORSHIP: 'Paid sponsorship',
  AMBASSADOR_PROGRAM: 'Ambassador program',
  CREATOR_ANNOUNCEMENT: 'Creator announcement',
  AFFILIATE_PROGRAM: 'Affiliate program',
  OTHER: 'Other',
};

export const BRAND_STATUS_LABELS: Record<string, string> = {
  PENDING_BRAND_APPROVAL: 'Pending approval',
  APPROVED_FOR_OUTREACH: 'Approved for outreach',
  DECLINED: 'Declined',
  PENDING_EMAIL_APPROVAL: 'Email awaiting approval',
  AWAITING_REPLY: 'Awaiting reply',
  DORMANT_OUTREACH: 'Dormant',
};

export const OUTCOME_LABELS: Record<string, string> = {
  NEW: 'New',
  DUPLICATE: 'Duplicate',
  DUPLICATE_IN_FILE: 'Repeated in file',
  POSSIBLE_DUPLICATE: 'Possible duplicate',
  BELOW_THRESHOLD: 'Below min. score',
  INVALID: 'Invalid',
};

export const brandStatusLabel = (s: string) =>
  BRAND_STATUS_LABELS[s] ?? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const SCORE_PARTS = [
  ['evidence', 'Evidence strength', 40],
  ['recency', 'Evidence recency', 25],
  ['contactability', 'Contactability', 15],
  ['completeness', 'Profile completeness', 10],
  ['nicheFit', 'Niche fit', 10],
] as const;

/** Only render http(s) links from research data. */
export function safeHref(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}
