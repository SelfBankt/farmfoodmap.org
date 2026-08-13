import type { VercelRequest, VercelResponse } from '@vercel/node';

// Exact allow-list, never a wildcard — this endpoint has real side effects (sends email,
// opens PRs). farmfoodmap.org is the primary site (GitHub Pages); farmfoodmap-org-xi.vercel.app
// is the Vercel mirror that actually hosts this API (GitHub Pages can't run functions) — both
// are legitimate first-party origins for the app's own UI to call from.
const ALLOWED_ORIGINS = [
  'https://farmfoodmap.org',
  'https://farmfoodmap-org-xi.vercel.app',
];

export const applyCors = (req: VercelRequest, res: VercelResponse) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
};

// Returns true if this request was a handled preflight (caller should return immediately).
export const handlePreflight = (req: VercelRequest, res: VercelResponse): boolean => {
  if (req.method !== 'OPTIONS') return false;
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(204).end();
  return true;
};
