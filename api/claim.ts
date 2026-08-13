import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveClaimEmail, verifyNip05Claim } from '../lib/nostrClaim.mjs';
import { signClaimToken } from './_token';
import { applyCors, handlePreflight } from './_cors';

export const config = { runtime: 'nodejs20.x' };

const RESEND_API_URL = 'https://api.resend.com/emails';
const VERIFY_BASE_URL = 'https://farmfoodmap-org-xi.vercel.app/api/verify-claim';

type MapData = { id: number; tags: { [key: string]: string } };
type MapDataObject = { [key: string]: MapData };

let globalDataCache: MapDataObject | null = null;
const loadGlobalData = async (): Promise<MapDataObject> => {
  if (globalDataCache) return globalDataCache;
  const raw = await readFile(
    path.join(process.cwd(), 'src', 'globalData.json'),
    'utf8'
  );
  globalDataCache = JSON.parse(raw) as MapDataObject;
  return globalDataCache;
};

const sendVerificationEmail = async (
  to: string,
  farmName: string,
  osmId: number,
  nip05: string,
  token: string
) => {
  const verifyLink = `${VERIFY_BASE_URL}?token=${encodeURIComponent(token)}`;
  const body = {
    from: process.env.CLAIM_EMAIL_FROM || 'Farm Food Map <onboarding@resend.dev>',
    to,
    subject: `Verify your Nostr identity claim for ${farmName}`,
    text: `Someone (hopefully you) requested to link the Nostr identity
${nip05}
to the "${farmName}" listing on Farm Food Map (OSM node ${osmId}).

If this was you, confirm by clicking:
${verifyLink}

This link expires in 1 hour. If you didn't request this, ignore this email — nothing will happen.`,
  };
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Resend API responded ${res.status}: ${await res.text()}`);
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { osmId, nip05, hp } = (req.body || {}) as {
    osmId?: number | string;
    nip05?: string;
    hp?: string;
  };

  if (osmId === undefined || osmId === null || !nip05) {
    res.status(400).json({ error: 'osmId and nip05 are required' });
    return;
  }

  // Honeypot: a real user never fills this in. Respond exactly like a normal accepted
  // submission so a bot can't distinguish "silently dropped" from "email sent".
  const genericAccepted = () =>
    res
      .status(200)
      .json({ ok: true, message: 'If this listing is eligible, a verification email has been sent.' });

  if (hp) {
    genericAccepted();
    return;
  }

  try {
    const globalData = await loadGlobalData();
    const pid = `id${osmId}`;
    const farm = globalData[pid];
    if (!farm) {
      genericAccepted();
      return;
    }

    const email = resolveClaimEmail(farm.tags);
    if (!email) {
      genericAccepted();
      return;
    }

    const result = await verifyNip05Claim(nip05, farm.tags);
    if (!result.ok) {
      genericAccepted();
      return;
    }

    const token = signClaimToken(
      { osmId: Number(osmId), nip05, email },
      process.env.CLAIM_TOKEN_SECRET as string
    );

    await sendVerificationEmail(
      email,
      farm.tags.name || 'this listing',
      Number(osmId),
      nip05,
      token
    );

    genericAccepted();
  } catch (error) {
    console.error('claim error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  }
}
