import type { DB } from '../db/connection.js';
import { escapeLike } from './audit.js';

export function globalSearch(db: DB, q: string) {
  const term = q.trim();
  if (term.length < 2) return { query: term, brands: [], creators: [] };
  const like = `%${escapeLike(term.toLowerCase())}%`;
  const brands = db
    .prepare(
      `SELECT id, name, website_domain, status, discovery_niche FROM brands
       WHERE normalized_name LIKE ? ESCAPE '\\' OR website_domain LIKE ? ESCAPE '\\'
       ORDER BY name LIMIT 20`,
    )
    .all(like, like);
  const creators = db
    .prepare(
      `SELECT id, display_name, handle, platform, niche FROM creator_profiles
       WHERE lower(display_name) LIKE ? ESCAPE '\\' OR normalized_handle LIKE ? ESCAPE '\\'
       ORDER BY display_name LIMIT 20`,
    )
    .all(like, like);
  return { query: term, brands, creators };
}
