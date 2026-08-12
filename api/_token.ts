import { createHmac, timingSafeEqual } from 'node:crypto';

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface ClaimTokenPayload {
  osmId: number;
  nip05: string;
  email: string;
  iat: number;
  exp: number;
}

export type VerifyClaimTokenResult =
  | { ok: true; claim: ClaimTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

const base64url = (input: string | Buffer) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const base64urlDecode = (input: string) =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8'
  );

const sign = (payload: string, secret: string) =>
  base64url(createHmac('sha256', secret).update(payload).digest());

// Stateless verification link: the token IS the entire "pending claim" record — nothing is
// persisted anywhere between sending the email and the recipient clicking the link.
export const signClaimToken = (
  { osmId, nip05, email }: { osmId: number; nip05: string; email: string },
  secret: string
): string => {
  const payload: ClaimTokenPayload = {
    osmId,
    nip05,
    email,
    iat: Date.now(),
    exp: Date.now() + ONE_HOUR_MS,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
};

export const verifyClaimToken = (
  token: string,
  secret: string
): VerifyClaimTokenResult => {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'malformed' };
  }
  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = sign(encodedPayload, secret);
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let claim: ClaimTokenPayload;
  try {
    claim = JSON.parse(base64urlDecode(encodedPayload));
  } catch (_e) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claim.exp !== 'number' || Date.now() > claim.exp) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, claim };
};
