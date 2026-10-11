/**
 * Website/domain normalization used as the primary brand identity key.
 * Reduces a URL to its registrable domain (eTLD+1) using a small built-in list of common
 * multi-label public suffixes, so "https://www.shop.Example.co.uk/x" → "example.co.uk".
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr',
  'com.br', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.cn', 'com.tw', 'com.hk', 'com.sg', 'com.my', 'com.ph',
  'co.in', 'co.id', 'co.th', 'co.za', 'com.tr', 'com.ua', 'com.pl', 'co.il', 'com.sa', 'com.eg', 'com.vn',
]);

export class DomainError extends Error {}

export function parseWebsite(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new DomainError('Website is empty');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new DomainError(`Not a valid website URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new DomainError('Website must use http or https');
  return url;
}

export function normalizeDomain(input: string): string {
  const url = parseWebsite(input);
  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host === 'localhost' || !host.includes('.')) {
    throw new DomainError(`Website must use a public domain name: ${input}`);
  }
  host = host.replace(/^(www\d*|m)\./, '');
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const take = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

const COMPANY_SUFFIXES = /\b(incorporated|inc|llc|ltd|limited|gmbh|corp|corporation|co|company|plc|ag|sa|srl|bv|oy|ab|pty|kk)\b/g;

/** Normalized company name for secondary identity checks. */
export function normalizeBrandName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
