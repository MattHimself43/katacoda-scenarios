import type { Role } from '../domain/statuses.js';

export interface Actor {
  userId: number;
  email: string;
  displayName: string;
  role: Role;
  isOwner: boolean;
  ip?: string;
}
