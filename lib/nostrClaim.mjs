import { queryProfile } from 'nostr-tools/nip05';
import { npubEncode } from 'nostr-tools/nip19';

// The claim mechanism: a NIP-05 identity is only accepted if it matches the email/
// contact:email already publicly listed on the OSM node itself. NIP-05 alone only proves
// "controls this domain" — it says nothing about "runs this particular farm." Requiring the
// domain to match the farm's own OSM-listed email closes that gap using a signal that's
// already public and independently checkable, without needing any new auth/claim UI.
export const emailMatchesListing = (nip05, tags) => {
  const farmEmails = [tags?.email, tags?.['contact:email']]
    .filter(Boolean)
    .map((e) => e.trim().toLowerCase());
  if (!farmEmails.length) return false;
  const [localPart, domain] = nip05.trim().toLowerCase().split('@');
  if (!domain) return false;
  // NIP-05's "_@domain" root-identifier convention has no local part, so match on domain only.
  if (localPart === '_') {
    return farmEmails.some((email) => email.endsWith(`@${domain}`));
  }
  return farmEmails.includes(`${localPart}@${domain}`);
};

// The email a verification link gets sent to — always derived from the OSM listing's own
// tags, never trusted from client input (that would defeat the whole point of the check).
export const resolveClaimEmail = (tags) =>
  tags?.email?.trim() || tags?.['contact:email']?.trim() || null;

// One shared "is this claim valid" check, used at claim-submission time, at verification-link
// click time, and by the manual-curation build script — so all three call one implementation
// instead of three copies that can drift apart.
export const verifyNip05Claim = async (nip05, tags) => {
  if (!emailMatchesListing(nip05, tags)) {
    return { ok: false, reason: 'email-mismatch' };
  }
  let profile;
  try {
    profile = await queryProfile(nip05);
  } catch (error) {
    return { ok: false, reason: 'resolve-error', error };
  }
  if (!profile?.pubkey) {
    return { ok: false, reason: 'not-resolved' };
  }
  return { ok: true, pubkey: profile.pubkey, npub: npubEncode(profile.pubkey) };
};
