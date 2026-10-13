import type { Role } from '../domain/statuses.js';

/**
 * Role → permission matrix. Access to a page never implies authority: every
 * state-changing endpoint checks a specific permission server-side.
 */
const MATRIX = {
  'dashboard.view': ['ADMIN', 'MANAGER', 'RESEARCHER', 'VIEWER'],
  'settings.view': ['ADMIN', 'MANAGER', 'RESEARCHER', 'VIEWER'],
  'settings.propose': ['ADMIN', 'MANAGER', 'RESEARCHER'],
  'settings.propose_sensitive': ['ADMIN'],
  'settings.approve': ['ADMIN'],
  'approvals.decide_admin': ['ADMIN'],
  'audit.view': ['ADMIN', 'MANAGER'],
  'users.view': ['ADMIN'],
  'users.manage': ['ADMIN'],
  'research.import': ['ADMIN', 'MANAGER', 'RESEARCHER'],
  'brands.decide': ['ADMIN', 'MANAGER'],
  'email.authorize_send': ['ADMIN'],
  'proposals.approve': ['ADMIN'],
  'followup_policy.modify': ['ADMIN'],
  'integrations.modify': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: Role, permission: Permission): boolean {
  return (MATRIX[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(MATRIX) as Permission[]).filter((p) => can(role, p));
}
