// OpenStreetMap OAuth 2.0 (Authorization Code + PKCE), entirely client-side — this app has no
// backend to hold a client secret, so it uses OSM's public/PKCE client support (the same approach
// editors like iD and StreetComplete use). See CLAUDE-facing notes in main.ts around the
// #addLocationForm wiring for how this fits into the rest of the app.

export type PendingSubmission = {
  mode: 'add' | 'edit';
  nodeId?: number;
  version?: number;
  lat: number;
  lon: number;
  tags: { [key: string]: string };
};

const isDev = import.meta.env.DEV;

// Sandbox for local dev, real production API for the deployed build — picked automatically so a
// build can never accidentally ship pointed at the sandbox.
export const OSM_WEB_ROOT = isDev
  ? 'https://master.apis.dev.openstreetmap.org'
  : 'https://www.openstreetmap.org';
export const OSM_API_ROOT = OSM_WEB_ROOT;

// Public (PKCE) OAuth 2 client IDs — safe to commit, these client types have no secret to protect.
// Register at Settings > OAuth 2 applications on the relevant OSM instance (production:
// www.openstreetmap.org, sandbox: master.apis.dev.openstreetmap.org — a separate account/database
// from production). Redirect URI must exactly match this app's own origin+path at runtime (see
// redirectUri() below) — for production that means registering BOTH
// https://farmfoodmap.org/ and https://farmfoodmap-org.vercel.app/ on the same application.
const OSM_CLIENT_ID = isDev
  ? 'REPLACE_WITH_SANDBOX_CLIENT_ID'
  : 'jUWxmcBONdS_A7pv_ikAw2Eu4iEqLGsfHHgoyu79oC0';

const SCOPE = 'write_api';

const redirectUri = () => location.origin + location.pathname;

const base64url = (bytes: Uint8Array) => {
  let str = '';
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const randomString = (byteLength = 64) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
};

const codeChallengeFromVerifier = async (verifier: string) => {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
};

export const isLoggedIn = () => !!localStorage.osmAccessToken;

export const getAccessToken = (): string => localStorage.osmAccessToken || '';

export const logout = () => {
  delete localStorage.osmAccessToken;
};

// Stashed right before redirecting to login (or after a 401 mid-submission) so an in-progress
// add/edit form isn't lost across the full-page OAuth redirect.
export const stashPendingSubmission = (submission: PendingSubmission) => {
  sessionStorage.osmPendingSubmission = JSON.stringify(submission);
};

export const takePendingSubmission = (): PendingSubmission | null => {
  const raw = sessionStorage.osmPendingSubmission;
  if (!raw) return null;
  delete sessionStorage.osmPendingSubmission;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
};

export const login = async () => {
  const verifier = randomString();
  const challenge = await codeChallengeFromVerifier(verifier);
  const state = randomString(16);
  sessionStorage.osmCodeVerifier = verifier;
  sessionStorage.osmState = state;
  const params = new URLSearchParams({
    client_id: OSM_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  location.href = `${OSM_WEB_ROOT}/oauth2/authorize?${params.toString()}`;
};

// Call once near app startup, before anything depends on login state. Safe to call even when
// there's no OAuth redirect in progress (returns 'none' immediately). Authorization codes are
// single-use, so this always strips code/state/scope from the url before returning, regardless of
// outcome, to avoid a page refresh trying to redeem the same code twice.
export const handleRedirectCallback = async (): Promise<
  'success' | 'error' | 'none'
> => {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return 'none';

  const expectedState = sessionStorage.osmState;
  const verifier = sessionStorage.osmCodeVerifier;
  delete sessionStorage.osmState;
  delete sessionStorage.osmCodeVerifier;

  params.delete('code');
  params.delete('state');
  params.delete('scope');
  const rest = params.toString();
  history.replaceState({}, '', location.pathname + (rest ? `?${rest}` : ''));

  if (!expectedState || state !== expectedState || !verifier) {
    console.error('OSM OAuth: state mismatch or missing verifier, aborting.');
    return 'error';
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: OSM_CLIENT_ID,
      code_verifier: verifier,
    });
    const res = await fetch(`${OSM_WEB_ROOT}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    const json = await res.json();
    localStorage.osmAccessToken = json.access_token;
    return 'success';
  } catch (e) {
    console.error('OSM OAuth token exchange failed', e);
    return 'error';
  }
};
