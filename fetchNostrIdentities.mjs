import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { verifyNip05Claim } from './lib/nostrClaim.mjs';

console.log(
  'Verifying curated Nostr (NIP-05) identities for farm listings...\nPlease be patient...'
);
try {
  let identities = {};
  try {
    identities = JSON.parse(await readFile('./nostr-identities.json', 'utf8'));
  } catch (_e) {
    console.log('No nostr-identities.json found (or empty) — nothing to verify.');
  }

  let globalData = {};
  try {
    globalData = JSON.parse(await readFile('./src/globalData.json', 'utf8'));
  } catch (_e) {
    console.log(
      'src/globalData.json not found — skipping the "known farm" sanity check.'
    );
  }

  const verified = {};
  let verifiedCount = 0;
  let skippedCount = 0;

  for (const [id, nip05] of Object.entries(identities)) {
    const pid = `id${id}`;
    const farm = globalData[pid];
    if (Object.keys(globalData).length && !farm) {
      console.warn(
        `Skipping ${nip05}: node id ${id} isn't a known farm in globalData.json (typo?).`
      );
      skippedCount++;
      continue;
    }
    const result = await verifyNip05Claim(nip05, farm?.tags);
    if (!result.ok) {
      const reasons = {
        'email-mismatch':
          "doesn't match this farm's email/contact:email tag on OSM — the OSM listing's email must match before this identity can be claimed.",
        'not-resolved': 'NIP-05 did not resolve to a pubkey.',
        'resolve-error': `${result.error?.message || result.error}`,
      };
      console.warn(`Skipping ${nip05}: ${reasons[result.reason]}`);
      skippedCount++;
      continue;
    }
    verified[pid] = {
      nip05,
      pubkey: result.pubkey,
      npub: result.npub,
      verifiedAt: new Date().toISOString(),
    };
    verifiedCount++;
  }

  const data = new Uint8Array(Buffer.from(JSON.stringify(verified)));
  await writeFile('./src/nostrData.json', data);
  console.log(`Done: ${verifiedCount} verified, ${skippedCount} skipped.`);
} catch (error) {
  console.error('ERROR:>> ', error);
}
