import { z } from 'zod';
import { isValidTimeZone } from '../lib/util.js';

export const PREDEFINED_NICHES = [
  'Gaming',
  'Fitness',
  'Technology',
  "Men's Grooming",
  'Lifestyle',
  'Travel',
  'Fashion',
  'Food & Beverage',
  'Sports',
  'Beauty',
  'Automotive',
] as const;

export const NICHE_OPTIONS = [...PREDEFINED_NICHES, 'Custom'] as const;
export const RESEARCH_FREQUENCIES = ['DAILY', 'WEEKDAYS', 'WEEKLY', 'MANUAL'] as const;
export const DISCOVERY_MODES = ['VERIFIED_INFLUENCER_ACTIVITY'] as const;

export const rankingWeightsSchema = z
  .object({
    relevance: z.number().int().min(0).max(100),
    engagement: z.number().int().min(0).max(100),
    contentQuality: z.number().int().min(0).max(100),
    sponsorshipSuitability: z.number().int().min(0).max(100),
    budgetPracticality: z.number().int().min(0).max(100),
  })
  .strict()
  .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) === 100, {
    message: 'Ranking weights must add up to 100',
  });

export const followUpPolicySchema = z
  .object({
    firstFollowUpBusinessDays: z.number().int().min(1).max(30),
    secondFollowUpBusinessDays: z.number().int().min(1).max(30),
    maxFollowUps: z.number().int().min(0).max(2),
    dormantAfterBusinessDays: z.number().int().min(1).max(60),
    excludeWeekends: z.literal(true),
    requireApproval: z.literal(true),
  })
  .strict();

export const intelligenceConfigSchema = z
  .object({
    activeNiche: z.enum(NICHE_OPTIONS),
    customNiche: z.string().trim().min(2).max(80).nullable(),
    dailyBrandTarget: z.number().int().min(1).max(100),
    targetGeography: z.string().trim().min(2).max(120),
    targetLanguage: z.string().trim().min(2).max(60),
    researchFrequency: z.enum(RESEARCH_FREQUENCIES),
    discoveryMode: z.enum(DISCOVERY_MODES),
    minBrandQualityScore: z.number().int().min(0).max(100),
    sponsorshipRecencyMonths: z.number().int().min(1).max(60),
    businessTimeZone: z.string().refine(isValidTimeZone, { message: 'Unknown IANA time zone' }),
    creatorsPerResearchAssignment: z.number().int().min(1).max(50),
    creatorRankingWeights: rankingWeightsSchema,
    followUpPolicy: followUpPolicySchema,
    requireCreatorAvailabilityConfirmation: z.boolean(),
    // Invariants of the approval-first operating model. They are part of the versioned
    // configuration so every snapshot records them, but they cannot be changed.
    automaticExternalCommunication: z.literal(false),
    humanApprovalRequired: z.literal(true),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.activeNiche === 'Custom' && !c.customNiche) {
      ctx.addIssue({ code: 'custom', path: ['customNiche'], message: 'Enter a custom niche name' });
    }
    if (c.activeNiche !== 'Custom' && c.customNiche !== null) {
      ctx.addIssue({ code: 'custom', path: ['customNiche'], message: 'Custom niche must be empty unless "Custom" is selected' });
    }
  });

export type IntelligenceConfig = z.infer<typeof intelligenceConfigSchema>;
export type ConfigKey = keyof IntelligenceConfig;

export const DEFAULT_CONFIG: IntelligenceConfig = {
  activeNiche: 'Gaming',
  customNiche: null,
  dailyBrandTarget: 15,
  targetGeography: 'Global — English-speaking',
  targetLanguage: 'English',
  researchFrequency: 'DAILY',
  discoveryMode: 'VERIFIED_INFLUENCER_ACTIVITY',
  minBrandQualityScore: 60,
  sponsorshipRecencyMonths: 12,
  businessTimeZone: 'UTC',
  creatorsPerResearchAssignment: 15,
  creatorRankingWeights: {
    relevance: 30,
    engagement: 25,
    contentQuality: 20,
    sponsorshipSuitability: 15,
    budgetPracticality: 10,
  },
  followUpPolicy: {
    firstFollowUpBusinessDays: 4,
    secondFollowUpBusinessDays: 4,
    maxFollowUps: 2,
    dormantAfterBusinessDays: 4,
    excludeWeekends: true,
    requireApproval: true,
  },
  requireCreatorAvailabilityConfirmation: false,
  automaticExternalCommunication: false,
  humanApprovalRequired: true,
};

/** Keys that only administrators may propose changes to (in addition to admin-only approval). */
export const ADMIN_ONLY_PROPOSAL_KEYS: ReadonlySet<ConfigKey> = new Set<ConfigKey>(['followUpPolicy', 'businessTimeZone']);

/** Keys that can never change through the settings workflow. */
export const LOCKED_KEYS: ReadonlySet<ConfigKey> = new Set<ConfigKey>(['automaticExternalCommunication', 'humanApprovalRequired']);

export function effectiveNiche(config: IntelligenceConfig): string {
  return config.activeNiche === 'Custom' ? (config.customNiche ?? 'Custom') : config.activeNiche;
}

export interface ConfigChange {
  key: ConfigKey;
  from: unknown;
  to: unknown;
}

export function diffConfig(from: IntelligenceConfig, to: IntelligenceConfig): ConfigChange[] {
  const changes: ConfigChange[] = [];
  for (const key of Object.keys(to) as ConfigKey[]) {
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
      changes.push({ key, from: from[key] ?? null, to: to[key] });
    }
  }
  return changes;
}
