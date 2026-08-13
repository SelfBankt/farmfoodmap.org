// Everything that touches nostr-tools' relay/crypto code lives here, and only here — main.ts
// only ever reaches this module via `await import('./nostrMarket')`, so its dependencies
// (@noble/*, @scure/*) land in their own lazy-loaded chunk instead of bloating the main bundle
// for every visitor who never opens a claimed farm's popup.
import { getEventHash, type Event, type UnsignedEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import type { NostrListing } from './MapTypes';

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: UnsignedEvent): Promise<Event>;
    };
  }
}

export const MARKET_CATEGORIES: { label: string; tag: string }[] = [
  { label: 'Eggs', tag: 'eggs' },
  { label: 'Seasonal vegetables', tag: 'vegetables' },
  { label: 'Fruit', tag: 'fruit' },
  { label: 'Raw honey', tag: 'honey' },
  { label: 'Meat (whole/half shares & cuts)', tag: 'meat' },
  { label: 'Raw milk & dairy', tag: 'dairy' },
  { label: 'Bread & baked goods', tag: 'baked-goods' },
  { label: 'Jams, chutneys & preserves', tag: 'preserves' },
  { label: 'Cut flowers', tag: 'flowers' },
  { label: 'Potted plants, seedlings & herbs', tag: 'plants' },
];

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
];

const MARKET_KIND = 30402;

const pool = new SimplePool();

export const slugify = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const escapeHtml = (str: string) =>
  str.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c] as string)
  );

const eventToListing = (event: Event): NostrListing => {
  const tag = (name: string) => event.tags.find((t) => t[0] === name);
  const priceTag = tag('price');
  return {
    eventId: event.id,
    title: tag('title')?.[1] || 'Untitled listing',
    summary: tag('summary')?.[1],
    priceAmount: priceTag?.[1],
    priceCurrency: priceTag?.[2],
    category: tag('t')?.[1] || '',
    location: tag('location')?.[1],
    content: event.content,
    createdAt: event.created_at,
  };
};

export const fetchListings = async (pubkey: string): Promise<NostrListing[]> => {
  const events = await pool.querySync(
    RELAYS,
    { kinds: [MARKET_KIND], authors: [pubkey] },
    { maxWait: 4000 }
  );
  return events.map(eventToListing).sort((a, b) => b.createdAt - a.createdAt);
};

export const renderMarketListingsHtml = (listings: NostrListing[]): string => {
  if (!listings.length) {
    return '<div class="market-empty">No listings yet.</div>';
  }
  return listings
    .map((l) => {
      const price = l.priceAmount
        ? `<strong>${escapeHtml(l.priceAmount)} ${escapeHtml(
            l.priceCurrency || ''
          )}</strong> — `
        : '';
      const category =
        MARKET_CATEGORIES.find((c) => c.tag === l.category)?.label || l.category;
      return `<div class="market-listing-card" data-event-id="${escapeHtml(
        l.eventId
      )}">${price}${escapeHtml(l.title)}${
        category ? ` <small>(${escapeHtml(category)})</small>` : ''
      }${l.summary ? `<br><small>${escapeHtml(l.summary)}</small>` : ''}</div>`;
    })
    .join('');
};

export const renderMarketFormHtml = (nodeId: string): string => {
  const chips = MARKET_CATEGORIES.map(
    (c) =>
      `<span class="market-chip" onclick="selectMarketCategory('${nodeId}','${c.tag}', this)">${escapeHtml(
        c.label
      )}</span>`
  ).join('');
  return `
    <div class="market-chip-list">
      ${chips}
      <span class="market-chip" onclick="selectMarketCategory('${nodeId}','custom', this)">Custom…</span>
    </div>
    <input type="hidden" id="marketCategory-${nodeId}" value="" />
    <input type="text" id="marketCustomCategory-${nodeId}" placeholder="Custom category" class="claim-input" style="display:none;" oninput="updateMarketCustomCategory('${nodeId}')" />
    <input type="text" id="marketTitle-${nodeId}" placeholder="What are you selling?" class="claim-input" />
    <div class="market-price-row">
      <input type="number" id="marketAmount-${nodeId}" placeholder="Price (optional)" class="claim-input" min="0" step="0.01" />
      <input type="text" id="marketCurrency-${nodeId}" value="USD" maxlength="3" class="claim-input" />
    </div>
    <textarea id="marketDescription-${nodeId}" placeholder="Description (optional)" class="claim-input"></textarea>
    <div id="marketPublishError-${nodeId}"></div>
    <div class="btn" onclick="publishNostrListing('${nodeId}')">Publish listing</div>
  `;
};

export const buildUnsignedEvent = (params: {
  pubkey: string;
  title: string;
  summary?: string;
  amount?: string;
  currency?: string;
  categoryTag: string;
  address: string[];
  description?: string;
}): UnsignedEvent => {
  const now = Math.floor(Date.now() / 1000);
  return {
    kind: MARKET_KIND,
    created_at: now,
    pubkey: params.pubkey,
    tags: [
      ['d', crypto.randomUUID()],
      ['title', params.title],
      ...(params.summary ? [['summary', params.summary]] : []),
      ...(params.amount
        ? [['price', params.amount, params.currency || 'USD']]
        : []),
      ['t', params.categoryTag],
      ...(params.address.length ? [['location', params.address.join(', ')]] : []),
      ['published_at', String(now)],
    ],
    content: params.description || '',
  };
};

export const publishListing = async (
  unsignedEvent: UnsignedEvent
): Promise<{ ok: true; listing: NostrListing } | { ok: false; error: string }> => {
  if (!window.nostr) {
    return { ok: false, error: 'No Nostr extension found.' };
  }
  let signed: Event;
  try {
    signed = await window.nostr.signEvent(unsignedEvent);
  } catch (_e) {
    return { ok: false, error: 'Signing was cancelled or failed.' };
  }
  // Cheap integrity check on the extension's response — not a full signature verification
  // (relays already reject bad signatures on their own), just a sanity check that what came
  // back actually hashes to its own claimed id before we trust it enough to render optimistically.
  if (signed.id !== getEventHash(signed)) {
    return { ok: false, error: 'Signature integrity check failed.' };
  }
  pool.publish(RELAYS, signed);
  return { ok: true, listing: eventToListing(signed) };
};
