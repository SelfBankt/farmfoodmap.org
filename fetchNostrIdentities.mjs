import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { queryProfile } from 'nostr-tools/nip05';
import { npubEncode } from 'nostr-tools/nip19';

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
    if (Object.keys(globalData).length && !globalData[pid]) {
      console.warn(
        `Skipping ${nip05}: node id ${id} isn't a known farm in globalData.json (typo?).`
      );
      skippedCount++;
      continue;
    }
    try {
      const profile = await queryProfile(nip05);
      if (!profile?.pubkey) {
        console.warn(`Skipping ${nip05}: NIP-05 did not resolve to a pubkey.`);
        skippedCount++;
        continue;
      }
      verified[pid] = {
        nip05,
        pubkey: profile.pubkey,
        npub: npubEncode(profile.pubkey),
        verifiedAt: new Date().toISOString(),
      };
      verifiedCount++;
    } catch (error) {
      console.warn(`Skipping ${nip05}: ${error?.message || error}`);
      skippedCount++;
    }
  }

  const data = new Uint8Array(Buffer.from(JSON.stringify(verified)));
  await writeFile('./src/nostrData.json', data);
  console.log(`Done: ${verifiedCount} verified, ${skippedCount} skipped.`);
} catch (error) {
  console.error('ERROR:>> ', error);
}
