import {
  LayoutGrid,
  Search,
  BadgeCheck,
  Send,
  Inbox,
  CalendarClock,
  Users,
  ListChecks,
  GitMerge,
  FileCheck2,
  Moon,
  ScrollText,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Build phase that delivers this section; undefined = available now. */
  phase?: number;
  permission?: string;
  summary: string;
}

export const NAV: NavItem[] = [
  { label: 'Overview', path: '/', icon: LayoutGrid, summary: 'Live pipeline counts from the database.' },
  { label: 'Brand Discovery', path: '/brand-discovery', icon: Search, summary: 'Import validated research results, preview them, and review discovered brands with their sponsorship evidence, quality score and configuration version.' },
  { label: 'Brand Approvals', path: '/brand-approvals', icon: BadgeCheck, summary: 'Approve or decline each discovered brand. Approval authorizes preparing an outreach draft only — never sending.' },
  { label: 'Outreach Management', path: '/outreach', icon: Send, phase: 3, summary: 'Personalized drafts, editing, regeneration requests and exact-content approval before any email is sent through Hostinger Mail.' },
  { label: 'Inbox & Replies', path: '/inbox', icon: Inbox, phase: 4, summary: 'Synchronized replies matched to brands, deterministic classification and manual review of anything ambiguous.' },
  { label: 'Follow-up Queue', path: '/follow-ups', icon: CalendarClock, phase: 4, summary: 'Business-day follow-up schedule. Every follow-up is drafted for approval and rechecked against replies and opt-outs before sending.' },
  { label: 'Creator Discovery', path: '/creator-discovery', icon: Users, phase: 5, summary: 'Creator research driven by each brand’s actual campaign requirements.' },
  { label: 'Creator Shortlists', path: '/shortlists', icon: ListChecks, phase: 5, summary: 'Ranked candidates with evidence. Approve, reject, reorder, request replacements and finalize.' },
  { label: 'Brand–Creator Matching', path: '/matching', icon: GitMerge, phase: 5, summary: 'Weighted match scoring with explanations and representation status.' },
  { label: 'Proposal Approvals', path: '/proposals', icon: FileCheck2, phase: 6, summary: 'Proposal builder and exact-content approval before a proposal is sent.' },
  { label: 'Dormant Outreach', path: '/dormant', icon: Moon, phase: 4, summary: 'Brands with no reply after the final follow-up. Never deleted, never restarted automatically.' },
  { label: 'Activity & Audit Logs', path: '/audit', icon: ScrollText, permission: 'audit.view', summary: 'Every material decision and system action.' },
  { label: 'Settings', path: '/settings', icon: Settings, summary: 'Intelligence settings with approval-controlled versioning.' },
];
