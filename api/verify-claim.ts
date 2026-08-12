import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyNip05Claim } from '../lib/nostrClaim.mjs';
import { verifyClaimToken } from './_token';

export const config = { runtime: 'nodejs20.x' };

const GITHUB_API = 'https://api.github.com';
const REPO_OWNER = 'SelfBankt';
const REPO_NAME = 'farmfoodmap.org';
const IDENTITIES_PATH = 'nostr-identities.json';

type MapData = { id: number; tags: { [key: string]: string } };
type MapDataObject = { [key: string]: MapData };

// Minimal shapes for the GitHub REST API responses this handler actually reads —
// not full API types, just the fields used here.
type GitHubRepo = { default_branch: string };
type GitHubRef = { object: { sha: string } };
type GitHubContentFile = { content: string; sha: string };
type GitHubPull = { html_url: string };

const page = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;text-align:center;color:#213547}
a{color:#3d9251}</style></head>
<body><h1>${title}</h1><p>${body}</p></body></html>`;

const respondHtml = (res: VercelResponse, status: number, title: string, body: string) => {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(page(title, body));
};

const githubRequest = async (
  githubToken: string,
  endpoint: string,
  options: RequestInit = {}
) => {
  const res = await fetch(`${GITHUB_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  return res;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const token = req.query.token as string | undefined;
  const secret = process.env.CLAIM_TOKEN_SECRET as string;
  const verified = verifyClaimToken(token || '', secret);
  if (!verified.ok) {
    respondHtml(
      res,
      400,
      'Link invalid or expired',
      'This verification link is no longer valid. Please submit the claim again from the map.'
    );
    return;
  }

  const { osmId, nip05 } = verified.claim as { osmId: number; nip05: string };

  try {
    const raw = await readFile(
      path.join(process.cwd(), 'src', 'globalData.json'),
      'utf8'
    );
    const globalData = JSON.parse(raw) as MapDataObject;
    const farm = globalData[`id${osmId}`];

    // Re-check live — the token proves the email/NIP-05 pairing was valid when the email was
    // sent, but the OSM listing's email tag or the NIP-05's own DNS/well-known.json could have
    // changed since. Don't trust a snapshot from up to an hour ago for something this final.
    const result = farm ? await verifyNip05Claim(nip05, farm.tags) : { ok: false as const };
    if (!farm || !result.ok) {
      respondHtml(
        res,
        400,
        'Could not verify claim',
        'This listing or Nostr identity no longer matches — please submit the claim again.'
      );
      return;
    }

    const githubToken = process.env.GITHUB_TOKEN as string;
    const branch = `nostr-claim-${osmId}`;

    const repoRes = await githubRequest(githubToken, `/repos/${REPO_OWNER}/${REPO_NAME}`);
    const repo = (await repoRes.json()) as GitHubRepo;
    const defaultBranch = repo.default_branch || 'main';

    const refRes = await githubRequest(
      githubToken,
      `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${defaultBranch}`
    );
    const ref = (await refRes.json()) as GitHubRef;
    const baseSha = ref.object.sha;

    const createRefRes = await githubRequest(
      githubToken,
      `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`,
      {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
      }
    );
    if (createRefRes.status === 422) {
      respondHtml(
        res,
        200,
        'Claim already pending',
        `A claim for this listing is already awaiting review. Thanks for your patience!`
      );
      return;
    }
    if (!createRefRes.ok) {
      throw new Error(`Failed to create branch: ${createRefRes.status}`);
    }

    const fileRes = await githubRequest(
      githubToken,
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IDENTITIES_PATH}?ref=${branch}`
    );
    const file = (await fileRes.json()) as GitHubContentFile;
    const currentIdentities = JSON.parse(
      Buffer.from(file.content, 'base64').toString('utf8')
    );
    currentIdentities[String(osmId)] = nip05;

    const updateRes = await githubRequest(
      githubToken,
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IDENTITIES_PATH}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: `Add Nostr identity claim for ${farm.tags.name || `node ${osmId}`}`,
          content: Buffer.from(
            JSON.stringify(currentIdentities, null, 2) + '\n'
          ).toString('base64'),
          sha: file.sha,
          branch,
        }),
      }
    );
    if (!updateRes.ok) {
      throw new Error(`Failed to update file: ${updateRes.status}`);
    }

    const prRes = await githubRequest(
      githubToken,
      `/repos/${REPO_OWNER}/${REPO_NAME}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: `Nostr identity claim: ${farm.tags.name || `node ${osmId}`}`,
          head: branch,
          base: defaultBranch,
          body: `Automated claim — verified via email magic link.\n\n- OSM node: ${osmId}\n- NIP-05: ${nip05}\n\nEmail ownership was confirmed before this PR was opened; please review and merge if this looks right.`,
        }),
      }
    );
    const pr = (await prRes.json()) as GitHubPull;

    respondHtml(
      res,
      200,
      'Claim submitted!',
      `Your Nostr identity has been verified and a pull request has been opened for review: <a href="${pr.html_url}" target="_blank" rel="noopener noreferrer">${pr.html_url}</a>`
    );
  } catch (error) {
    console.error('verify-claim error:', error);
    respondHtml(
      res,
      500,
      'Something went wrong',
      'Please try submitting the claim again later.'
    );
  }
}
