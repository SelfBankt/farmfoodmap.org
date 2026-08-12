export declare function emailMatchesListing(
  nip05: string,
  tags: { [key: string]: string } | undefined
): boolean;

export declare function resolveClaimEmail(
  tags: { [key: string]: string } | undefined
): string | null;

export type Nip05ClaimResult =
  | { ok: true; pubkey: string; npub: string }
  | { ok: false; reason: 'email-mismatch' | 'not-resolved' | 'resolve-error'; error?: unknown };

export declare function verifyNip05Claim(
  nip05: string,
  tags: { [key: string]: string } | undefined
): Promise<Nip05ClaimResult>;
