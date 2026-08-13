export interface NostrIdentity {
  nip05: string;
  pubkey: string;
  npub: string;
  verifiedAt: string;
}
export interface NostrDataObject {
  [key: string]: NostrIdentity;
}
export interface NostrListing {
  eventId: string;
  title: string;
  summary?: string;
  priceAmount?: string;
  priceCurrency?: string;
  category: string;
  location?: string;
  content: string;
  createdAt: number;
}
export interface MapData {
  ll?: L.LatLng;
  id: number;
  lat: number;
  lon: number;
  tags: {
    [key: string]: string;
  };
  // Not an OSM tag — attached client-side from src/nostrData.json (see fetchNostrIdentities.mjs).
  nostr?: NostrIdentity;
}
export interface MapDataObject {
  [key: string]: MapData;
}
