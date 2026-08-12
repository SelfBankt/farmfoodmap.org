import './style.css';
import '../node_modules/leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import '../node_modules/leaflet.markercluster/dist/leaflet.markercluster.js';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet/dist/leaflet.css';
import { LatLngBounds } from 'leaflet';
import { debounce } from './debounce';
import { MapData, MapDataObject, NostrDataObject } from './MapTypes';
import globalMapData from './globalData.json';
import nostrData from './nostrData.json';
import type { PendingSubmission } from './osmAuth';
import {
  login as osmLogin,
  logout as osmLogout,
  handleRedirectCallback as osmHandleRedirectCallback,
  isLoggedIn as osmIsLoggedIn,
  getAccessToken as osmGetAccessToken,
  stashPendingSubmission,
  takePendingSubmission,
  OSM_API_ROOT,
} from './osmAuth';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}
declare global {
  interface Window {
    editMap: Function;
    sharePopup: Function;
    markers: L.MarkerClusterGroup;
  }
}
declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

declare namespace Intl {
  class ListFormat {
    constructor(
      locales?: string | string[],
      options?: { style: string; type: string }
    );
    public format: (items: string[]) => string;
  }
}

const registerServiceWorker = async () => {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
    } catch (error) {
      console.error(`Registration failed with ${error}`);
    }
  }
};

registerServiceWorker();

// Save unnecessary searches
const fetchedBounds: L.LatLngBounds[] = [];

const mapData: MapDataObject = {};
/* Dummy marker for testing */
// mapData['id-0'] = {
//   id: 0,
//   lat: 0,
//   lon: 0,
//   tags: {
//     'addr:city': 'Null Island',
//     'addr:country': 'Atlantic Ocean',
//     'addr:housename': 'Null Farm',
//     'addr:postcode': 'NU11 1SL',
//     'addr:street': 'Null Road',
//     description: "This is a dummy marker for testing, Don't try to visit it!",
//     name: 'Null Island Market',
//     opening_hours: 'Th 08:00-14:00',
//     organic: 'yes',
//     shop: 'farm',
//     produce: 'apples;pairs',
//     product: 'cider;perry',
//     'payment:cash': 'no',
//     'payment:lightning_contactless': 'no',
//     'payment:lightning': 'yes',
//     'payment:onchain': 'no',
//     'currency:XBT': 'only',
//     'contact:facebook': 'https://www.facebook.com/',
//     phone: '+43 650 4949470',
//     website: 'https://www.example.com/',
//     wheelchair: 'no',
//   },
// };

document.querySelector<HTMLDivElement>('#app')!.innerHTML = /*html*/ `
<section id="mapPage" class="pages">
  <div id="heading">
    <img src="/FFM_logo.png" />
  </div>
  <div id="settings" class="custom-button" onclick="()=>{}"></div>
  <div id="infoBarWrap" class="hidden">
  <span id="statusText"></span>
  <div id="infoBar" onclick="()=>{}">
    <a href="https://twitter.com/farmfoodmap" target="_blank" rel="noopener noreferrer" title="Follow us on Twitter / X"><svg xmlns="http://www.w3.org/2000/svg" class="svg-social"
        id="svg-icon-twitter" viewBox="0 0 512 512">
        <path
          d="M419.6 168.6c-11.7 5.2-24.2 8.7-37.4 10.2 13.4-8.1 23.8-20.8 28.6-36 -12.6 7.5-26.5 12.9-41.3 15.8 -11.9-12.6-28.8-20.6-47.5-20.6 -42 0-72.9 39.2-63.4 79.9 -54.1-2.7-102.1-28.6-134.2-68 -17 29.2-8.8 67.5 20.1 86.9 -10.7-0.3-20.7-3.3-29.5-8.1 -0.7 30.2 20.9 58.4 52.2 64.6 -9.2 2.5-19.2 3.1-29.4 1.1 8.3 25.9 32.3 44.7 60.8 45.2 -27.4 21.4-61.8 31-96.4 27 28.8 18.5 63 29.2 99.8 29.2 120.8 0 189.1-102.1 185-193.6C399.9 193.1 410.9 181.7 419.6 168.6z" />
      </svg></a>
    <a href="https://github.com/SelfBankt/farmfoodmap.org" target="_blank" rel="noopener noreferrer"
      title="View the source code on GitHub"><svg xmlns="http://www.w3.org/2000/svg" class="svg-social" id="svg-icon-github"
        viewBox="0 0 512 512">
        <path
          d="M256 70.7c-102.6 0-185.9 83.2-185.9 185.9 0 82.1 53.3 151.8 127.1 176.4 9.3 1.7 12.3-4 12.3-8.9V389.4c-51.7 11.3-62.5-21.9-62.5-21.9 -8.4-21.5-20.6-27.2-20.6-27.2 -16.9-11.5 1.3-11.3 1.3-11.3 18.7 1.3 28.5 19.2 28.5 19.2 16.6 28.4 43.5 20.2 54.1 15.4 1.7-12 6.5-20.2 11.8-24.9 -41.3-4.7-84.7-20.6-84.7-91.9 0-20.3 7.3-36.9 19.2-49.9 -1.9-4.7-8.3-23.6 1.8-49.2 0 0 15.6-5 51.1 19.1 14.8-4.1 30.7-6.2 46.5-6.3 15.8 0.1 31.7 2.1 46.6 6.3 35.5-24 51.1-19.1 51.1-19.1 10.1 25.6 3.8 44.5 1.8 49.2 11.9 13 19.1 29.6 19.1 49.9 0 71.4-43.5 87.1-84.9 91.7 6.7 5.8 12.8 17.1 12.8 34.4 0 24.9 0 44.9 0 51 0 4.9 3 10.7 12.4 8.9 73.8-24.6 127-94.3 127-176.4C441.9 153.9 358.6 70.7 256 70.7z" />
      </svg></a>
    <span id="installPrompt" style="display: none;" title="Install this app on your device"><svg
        xmlns="http://www.w3.org/2000/svg" xml:space="preserve" viewBox="0 0 256 256" class="svg-social">
        <g stroke-miterlimit="10" stroke-width="0">
          <path
            d="M244 141c-9-3-9-11-9-13s0-10 9-14a17 17 0 0 0 9-22l-11-27c-4-9-14-13-23-9-8 3-14-2-16-4-1-1-6-7-3-16a17 17 0 0 0-9-22L164 3c-9-4-19 0-23 9-3 8-11 9-13 9s-10-1-14-9a17 17 0 0 0-22-9L65 14a17 17 0 0 0-9 22c3 9-2 15-4 16-1 2-7 7-16 4a17 17 0 0 0-22 9L3 92a17 17 0 0 0 9 22c8 4 9 12 9 14s-1 10-9 13c-9 4-13 14-9 23l11 27a17 17 0 0 0 22 9c9-3 15 2 16 3 2 2 7 8 4 16-4 9 0 19 9 23l27 11a17 17 0 0 0 22-9c4-9 12-9 14-9s10 0 13 9c4 8 14 13 23 9l27-11c9-4 13-14 9-23-3-8 2-14 3-16 2-1 8-6 16-3 9 4 19 0 23-9l11-27c4-9-1-19-9-23zm-116 59a72 72 0 1 1 0-144 72 72 0 0 1 0 144z" />
          <path d="m128 173-6-3-28-28a8 8 0 1 1 12-12l22 22 22-22a8 8 0 1 1 12 12l-28 28-6 3z" />
          <path d="M128 173c-5 0-9-4-9-9V91a8 8 0 1 1 17 0v73c0 5-3 9-8 9z" />
        </g>
      </svg></span>
    <a id="aboutLink" class="btn" title="Learn more about Farm Food Map">ABOUT</a>
  </div>
  </div>
  <div id="myModal" class="modal">

    <div class="modal-content">
      <span id="modalClose">&times;</span>
      <p>Hi and thank you for visiting the Farm Food Map! This Web Application is designed to be installed onto your
        device for offline access.</p>
      <p>If you don't want to install the application yet, you are free to continue to use the online version by
        dismissing this. You can always return by clicking this icon below in the settings box (bottom left):</p>
      <p><svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" viewBox="0 0 256 256"
          style="height: 2em;fill: var(--color-text);">
          <g stroke-miterlimit="10" stroke-width="0">
            <path
              d="M244 141c-9-3-9-11-9-13s0-10 9-14a17 17 0 0 0 9-22l-11-27c-4-9-14-13-23-9-8 3-14-2-16-4-1-1-6-7-3-16a17 17 0 0 0-9-22L164 3c-9-4-19 0-23 9-3 8-11 9-13 9s-10-1-14-9a17 17 0 0 0-22-9L65 14a17 17 0 0 0-9 22c3 9-2 15-4 16-1 2-7 7-16 4a17 17 0 0 0-22 9L3 92a17 17 0 0 0 9 22c8 4 9 12 9 14s-1 10-9 13c-9 4-13 14-9 23l11 27a17 17 0 0 0 22 9c9-3 15 2 16 3 2 2 7 8 4 16-4 9 0 19 9 23l27 11a17 17 0 0 0 22-9c4-9 12-9 14-9s10 0 13 9c4 8 14 13 23 9l27-11c9-4 13-14 9-23-3-8 2-14 3-16 2-1 8-6 16-3 9 4 19 0 23-9l11-27c4-9-1-19-9-23zm-116 59a72 72 0 1 1 0-144 72 72 0 0 1 0 144z" />
            <path d="m128 173-6-3-28-28a8 8 0 1 1 12-12l22 22 22-22a8 8 0 1 1 12 12l-28 28-6 3z" />
            <path d="M128 173c-5 0-9-4-9-9V91a8 8 0 1 1 17 0v73c0 5-3 9-8 9z" />
          </g>
        </svg></p>
      ${
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
          ? '<p>iOS Install Notes: If you are on an iPhone or iPad, tap the sharing button at the bottom of the screen. This calls up the sharing panel. Among the options should be the "Add to Home Screen" option</p>'
          : '<div id="installButton" class="btn">Install</div>'
      }
    </div>

  </div>
  <div id="map"></div>
</section>
<section id="aboutPage" class="pages hidden">
  <span class="backToMap btn">
    Back to the map
  </span>
  <article>
    <h1>ABOUT</h1>
    <p>Contribute to the worlds largest, borderless, farm food map - built on local open data.</p>
    <ol>
      <li>Discover local farmers at <a href="https://farmfoodmap.org" target="_blank" noreferrer noopener>farmfoodmap.org</a></li>
      <li>Shake your farmers hand & eat local</li>
      <li>Add, edit & verify listings - right here in the app, no separate editor needed</li>
    </ol>
    <p>Growing local circular economies - globally. Mapping where to buy real food, direct from independent farmers, food producers, farm shops, growers, farmers markets & co-ops.</p>
    <p>Our mission is to provide access to this valuable, free and open data, fully editable by users, on beautiful open source mobile web apps. Every listing lives on <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>, the open map anyone can edit - so what you add here is portable data that outlives any one app, not locked into a platform. Log in with your OpenStreetMap account to add a farm shop or edit an existing one straight from the map, capturing details like opening hours, payment methods (including Bitcoin), organic status, wholesale availability and raw milk sales.</p>
    <p>Follow us on <a href="https://www.twitter.com/farmfoodmap" target="_blank" noreferrer noopener>Twitter @farmfoodmap</a> and <a href="https://www.instagram.com/farmfoodmap" target="_blank" noreferrer noopener>Instagram @farmfoodmap</a></p>
    </p>
  </article>
</section>
<section id="addLocationForm" class="pages hidden">
  <div class="backToMap btn">
    Back to the map
  </div>
  <article>
    <h1 id="osmFormTitle">Add a location</h1>
    <p>
      This submits directly to <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>,
      the open map data that powers Farm Food Map — no separate editor needed. Please only add real,
      existing farm shops, and see the notes under each field below for how OSM expects that field
      to be filled in. For more detail than fits here, see the
      <a href="https://wiki.openstreetmap.org/wiki/Main_Page" target="_blank" rel="noopener noreferrer">OpenStreetMap wiki</a>.
    </p>
    <p><strong>Only the name is required</strong> — everything else is optional, so feel free to submit with just that and come back to add more later.</p>
    <div id="osmSubmitStatus"></div>
    <form id="osmForm">
      <label>Name <span class="field-tag required">Required</span>
        <input type="text" id="osmName" required>
      </label>

      <label>Description <span class="field-tag optional">optional</span>
        <textarea id="osmDescription" placeholder="A sentence or two — objective, not an advert."></textarea>
        <small>Good place to mention things with no dedicated field below, like a CSA/veg-box scheme or seasonal availability (e.g. "strawberries June–August").</small>
      </label>

      <fieldset>
        <legend>What they sell <span class="field-tag optional">optional</span></legend>
        <label>Produce
          <small>Raw or lightly processed, e.g. vegetables, eggs, honey.</small>
          <div class="chip-input" id="osmProduceChips">
            <div class="chip-list"></div>
            <input type="text" list="produceExamples" placeholder="Type and press Enter">
          </div>
        </label>
        <datalist id="produceExamples">
          <option value="vegetables"></option>
          <option value="fruit"></option>
          <option value="beef"></option>
          <option value="lamb"></option>
          <option value="pork"></option>
          <option value="game"></option>
          <option value="eggs"></option>
          <option value="poultry"></option>
          <option value="dairy"></option>
          <option value="fish"></option>
          <option value="honey"></option>
        </datalist>
        <label>Product
          <small>More processed, e.g. cider, cheese, preserves.</small>
          <div class="chip-input" id="osmProductChips">
            <div class="chip-list"></div>
            <input type="text" list="productExamples" placeholder="Type and press Enter">
          </div>
        </label>
        <datalist id="productExamples">
          <option value="cider"></option>
          <option value="beer"></option>
          <option value="wine"></option>
          <option value="olive oil"></option>
          <option value="preserves"></option>
          <option value="cream"></option>
          <option value="butter"></option>
          <option value="tallow"></option>
          <option value="stock"></option>
          <option value="sausages"></option>
          <option value="biltong"></option>
          <option value="jerky"></option>
          <option value="leather goods"></option>
        </datalist>
      </fieldset>

      <label>Website <span class="field-tag optional">optional</span>
        <input type="url" id="osmWebsite" placeholder="https://">
      </label>

      <label>Organic <span class="field-tag optional">optional</span>
        <select id="osmOrganic">
          <option value="">Unset</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="only">Only</option>
        </select>
      </label>

      <label>Raw milk sold <span class="field-tag optional">optional</span>
        <select id="osmRawMilk">
          <option value="">Unset</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>

      <label>Wholesale <span class="field-tag optional">optional</span>
        <select id="osmWholesale">
          <option value="">Unset</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="only">Only</option>
        </select>
        <small>Sells to resellers or in bulk quantities, as opposed to (or as well as) individual retail customers.</small>
      </label>

      <fieldset>
        <legend>Other contact details <span class="field-tag optional">optional</span></legend>
        <label>Phone<input type="tel" id="osmPhone"></label>
        <label>Email<input type="email" id="osmEmail"></label>
        <label>Facebook<input type="url" id="osmContactFacebook" placeholder="https://facebook.com/..."></label>
        <label>Twitter / X<input type="url" id="osmContactTwitter" placeholder="https://twitter.com/..."></label>
      </fieldset>

      <fieldset>
        <legend>Address <span class="field-tag optional">optional</span></legend>
        <label>House name<input type="text" id="osmAddrHousename"></label>
        <label>House number<input type="text" id="osmAddrHousenumber"></label>
        <label>Street<input type="text" id="osmAddrStreet"></label>
        <label>Suburb<input type="text" id="osmAddrSuburb"></label>
        <label>City<input type="text" id="osmAddrCity"></label>
        <label>State<input type="text" id="osmAddrState"></label>
        <label>Province<input type="text" id="osmAddrProvince"></label>
        <label>Postcode<input type="text" id="osmAddrPostcode"></label>
        <label>Country<input type="text" id="osmAddrCountry"></label>
      </fieldset>

      <label>Opening hours <span class="field-tag optional">optional</span>
        <input type="text" id="osmOpeningHours" placeholder="Mo-Fr 09:00-17:00; Sa-Su 10:00-17:00">
        <small>Days as the first two letters, times in 24h with a leading zero (<code>09:00</code> not
          <code>9:00</code>). <a href="https://wiki.openstreetmap.org/wiki/Key:opening_hours" target="_blank" rel="noopener noreferrer">More on the wiki</a>.</small>
      </label>

      <fieldset>
        <legend>Payment <span class="field-tag optional">optional</span></legend>
        <label>Cash
          <select id="osmPaymentCash">
            <option value="">Unset</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Bitcoin accepted <span class="field-tag optional">optional</span></legend>
        <p><small>Prefer these specific tags over the outdated "accepts bitcoin" tag.</small></p>
        <label>Bitcoin (any form)
          <select id="osmCurrencyXbt">
            <option value="">Unset</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="only">Only</option>
          </select>
        </label>
        <label>On-chain
          <select id="osmPaymentOnchain">
            <option value="">Unset</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>Lightning
          <select id="osmPaymentLightning">
            <option value="">Unset</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </fieldset>

      <label>Wheelchair accessible <span class="field-tag optional">optional</span>
        <select id="osmWheelchair">
          <option value="">Unset</option>
          <option value="yes">Yes</option>
          <option value="limited">Limited</option>
          <option value="no">No</option>
        </select>
        <small>Only set this if you're sure — a sign you saw, or your own experience. If unsure, mention it in the description instead.</small>
      </label>

      <div class="form-actions">
        <button type="button" id="osmCancelBtn" class="btn backToMap">Cancel</button>
        <button type="submit" id="osmSubmitBtn" class="btn">Submit to OpenStreetMap</button>
      </div>
    </form>
  </article>
</section>
`;

let bounds: LatLngBounds;

const markers = L.markerClusterGroup({
  chunkedLoading: true,
});
const FFMM = L.icon({
  iconUrl: '/android-chrome-192x192.png',
  iconRetinaUrl: '/android-chrome-192x192.png',
  iconSize: [50, 50],
  iconAnchor: [25, 50],
  popupAnchor: [0, 0],
});

const settings = document.getElementById('settings');
const infoBarWrap = document.getElementById('infoBarWrap');
settings?.addEventListener('mouseenter', () => {
  settings.classList.add('hidden');
  infoBarWrap?.classList.remove('hidden');
});
infoBarWrap?.addEventListener('mouseleave', () => {
  infoBarWrap.classList.add('hidden');
  settings?.classList.remove('hidden');
});

const mbAttr =
  'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>';
const mbUrl =
  'https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw';
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});
const streets = L.tileLayer(mbUrl, {
  id: 'mapbox/streets-v11',
  tileSize: 512,
  zoomOffset: -1,
  attribution: mbAttr,
});
const satellite = L.tileLayer(mbUrl, {
  id: 'mapbox/satellite-v9',
  tileSize: 512,
  zoomOffset: -1,
  attribution: mbAttr,
});
const darkMatter = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }
);
const cycle = L.tileLayer(
  'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
  {
    maxZoom: 20,
    attribution:
      '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> | Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }
);
const railway = L.tileLayer(
  'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
  {
    maxZoom: 19,
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Map style: &copy; <a href="https://www.OpenRailwayMap.org">OpenRailwayMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  }
);
const baseLayers = {
  OpenStreetMap: osm,
  Streets: streets,
  Satellite: satellite,
  Dark: darkMatter,
  Cycle: cycle,
  Railway: railway,
};

const map = L.map('map', {
  layers: [osm],
  zoomControl: false,
}).setView([0, 0], 3);
const moveMapToSavedPosition = () => {
  const c = JSON.parse(localStorage.center);
  const z = parseInt(localStorage.zoom);
  map.setView(c, z);
};
bounds = map.getBounds();
L.control.layers(baseLayers).addTo(map);

try {
  const s = location.search;
  if (s && s.includes('lat=') && s.includes('lng=') && s.includes('z=')) {
    const p = new URLSearchParams(s);
    const lat = parseFloat(p.get('lat') || 'l');
    const lng = parseFloat(p.get('lng') || 'l');
    const z = parseInt(p.get('z') || 'z');
    if (isNaN(lat) || isNaN(lng) || isNaN(z)) {
      moveMapToSavedPosition();
    } else {
      map.setView({ lat, lng }, z);
    }
  } else {
    moveMapToSavedPosition();
  }
} catch (_) {}
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.addLayer(markers);
let isInAddMode = false;
let addModeButton: HTMLElement | null = null;

// shared by the marker toggle button, the cancel button in the banner, and
// clicking the map itself — all three ways of leaving "add a location" mode
function setAddMode(active: boolean) {
  isInAddMode = active;
  const mapElement = document.getElementById('map');
  if (mapElement) mapElement.style.cursor = active ? 'crosshair' : 'pointer';
  document.getElementById('addLocation')?.classList.toggle('show', active);
  // the marker icon only swaps color on hover, so without this there's no
  // visible cue (once the mouse moves away) that add-mode is still active
  addModeButton?.classList.toggle('active', active);
}

const customControl = L.Control.extend({
  options: {
    position: 'topleft',
  },

  onAdd: function (_map: L.Map) {
    const addControlDiv = L.DomUtil.create('div');
    addControlDiv.style.border = 'none';

    // --- SEARCH (first) — a real text input typed into directly, with results
    // dropping down right below it, rather than opening a separate box elsewhere ---
    const searchWrap = L.DomUtil.create('div');
    searchWrap.className = 'control-row';

    const searchBoxInput = L.DomUtil.create('input') as HTMLInputElement;
    searchBoxInput.type = 'text';
    searchBoxInput.id = 'searchBox';
    searchBoxInput.title = 'Search for a location';
    searchBoxInput.placeholder = 'SEARCH';
    searchBoxInput.autocomplete = 'off';
    searchBoxInput.className =
      'leaflet-bar-part leaflet-bar-part-single custom-button search-input';
    searchBoxInput.style.background = `url(/icons/search.svg) left 8px center no-repeat, var(--card-bg)`;
    searchWrap.append(searchBoxInput);

    const searchResultsDiv = L.DomUtil.create('div');
    searchResultsDiv.id = 'searchResults';
    searchWrap.append(searchResultsDiv);

    searchBoxInput.addEventListener('input', () => {
      const text = searchBoxInput.value;
      searchResultsDiv.innerHTML = '';
      if (text.length < 4) return;
      let results: MapData[] = [];
      Object.values(mapData).map((shop) => {
        // first add ones that have matching names
        if (shop.tags.name?.includes(text)) results.push(shop);
      });
      Object.values(mapData).map((shop) => {
        // next add any address matches
        for (const tag in shop.tags) {
          if (Object.prototype.hasOwnProperty.call(shop.tags, tag)) {
            const tagValue = shop.tags[tag];
            if (tag.startsWith('addr') && tagValue.includes(text)) {
              results.push(shop);
              break;
            }
          }
        }
      });
      Object.values(mapData).map((shop) => {
        // next add any remaining matches
        for (const tag in shop.tags) {
          if (Object.prototype.hasOwnProperty.call(shop.tags, tag)) {
            const tagValue = shop.tags[tag];
            if (
              !tag.startsWith('addr') &&
              tag !== 'name' &&
              tagValue.includes(text)
            ) {
              results.push(shop);
              break;
            }
          }
        }
      });
      // Put the visible ones first
      if (bounds) {
        const inBounds = results.filter((shop) =>
          bounds.contains({ lat: shop.lat, lng: shop.lon })
        );
        const outBounds = results.filter(
          (shop) => !bounds.contains({ lat: shop.lat, lng: shop.lon })
        );
        results = [...inBounds, ...outBounds];
      }
      results.forEach((shop) => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'searchResult';
        const address = makeAddressArray(shop);
        resultDiv.innerHTML = `<strong>${
          shop.tags.name || 'Unknown Name'
        }</strong><br><small>${
          address.length ? `${address.join(', ')}` : 'Unknown Address'
        }</small>`;
        resultDiv.onclick = () =>
          map.setView({ lat: shop.lat, lng: shop.lon }, 19);
        searchResultsDiv.appendChild(resultDiv);
      });
    });

    addControlDiv.append(searchWrap);

    // --- ADD FARM (second) — the "click the map" hint sits directly beside
    // this button (via the wrapping .control-row's position:relative), rather
    // than as a banner at the bottom of the screen ---
    const addFarmWrap = L.DomUtil.create('div');
    addFarmWrap.className = 'control-row';

    const newLocationButton = L.DomUtil.create('input');
    newLocationButton.type = 'button';
    newLocationButton.title = 'Add a new location to the map';
    newLocationButton.value = 'ADD FARM';
    newLocationButton.className =
      'leaflet-bar-part leaflet-bar-part-single custom-button';
    newLocationButton.style.background = `url(/icons/marker.svg) left 8px center no-repeat, var(--card-bg)`;
    addModeButton = newLocationButton;

    newLocationButton.onmouseover = function () {
      newLocationButton.style.background = `url(/icons/marker-black.svg) left 8px center no-repeat, var(--card-bg)`;
    };
    newLocationButton.onmouseout = function () {
      newLocationButton.style.background = `url(/icons/marker.svg) left 8px center no-repeat, var(--card-bg)`;
    };

    newLocationButton.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      setAddMode(!isInAddMode);
    };
    addFarmWrap.append(newLocationButton);

    const addLocationHint = L.DomUtil.create('div');
    addLocationHint.id = 'addLocation';
    addLocationHint.innerHTML =
      '<span>Add a new location to the map by clicking on its location</span><button type="button" id="addLocationCancel" title="Cancel adding a location">&times;</button>';
    addFarmWrap.append(addLocationHint);

    addControlDiv.append(addFarmWrap);

    // --- MY LOCATION (third, below the other two) ---
    const geoLocationButton = L.DomUtil.create('input');
    geoLocationButton.type = 'button';
    geoLocationButton.title = 'Move the map to my location.';
    geoLocationButton.value = 'MY LOCATION';
    geoLocationButton.className =
      'leaflet-bar-part leaflet-bar-part-single custom-button';
    geoLocationButton.style.background = `url(/icons/locate.svg) left 8px center no-repeat, var(--card-bg)`;

    geoLocationButton.onmouseover = function () {
      geoLocationButton.style.background = `url(/icons/locate-black.svg) left 8px center no-repeat, var(--card-bg)`;
    };
    geoLocationButton.onmouseout = function () {
      geoLocationButton.style.background = `url(/icons/locate.svg) left 8px center no-repeat, var(--card-bg)`;
    };

    geoLocationButton.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Geo locate
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
      } else {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            map.setView(
              {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              },
              18
            );
          },
          () => {
            alert('Unable to retrieve your location');
          }
        );
      }
    };
    addControlDiv.append(geoLocationButton);

    return addControlDiv;
  },
});

map.addControl(new customControl());
// Added after the custom control (rather than left as the default auto-added control) so it
// stacks below the ADD FARM/MY LOCATION/SEARCH buttons in the topleft corner, not above them.
L.control.zoom({ position: 'topleft' }).addTo(map);

const updateInfo = (message = 'MAP IS READY') => {
  const statusText = document.querySelector('#statusText');
  if (statusText) {
    statusText!.innerHTML = message;
  }
};
updateInfo();

window.addEventListener('offline', () =>
  updateInfo('OFFLINE — showing saved data')
);
window.addEventListener('online', () => updateInfo());

const setBounds = debounce(() => {
  bounds = map.getBounds();
  const z = map.getZoom();
  const c = map.getCenter();
  localStorage.zoom = z;
  localStorage.center = JSON.stringify(c);
  localStorage.bounds = JSON.stringify(bounds);
  history.replaceState({}, '', `?lat=${c.lat}&lng=${c.lng}&z=${z}`);
  updateInfo('Map moved, processing...');
  fetchData();
}, 50);

const fetchData = debounce(() => {
  if (map.getZoom() < 8) {
    updateInfo();
    return;
  }
  const currentBounds = bounds;
  if (fetchedBounds.find((b) => b.contains(currentBounds))) {
    return;
  }
  updateInfo('Fetching latest data...');
  const q = `[out:json];node[shop=farm](${currentBounds.getSouth()},${currentBounds.getWest()},${currentBounds.getNorth()},${currentBounds.getEast()});out body;>;out skel qt;`;
  const address =
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter?data=' +
    encodeURIComponent(q);
  fetch(address)
    .then((r) => r.json())
    .then((j) => {
      updateInfo('Updating markers');
      const allowed = [
        'shop',
        'amenity',
        'name',
        'addr:housename',
        'addr:housenumber',
        'addr:floor',
        'addr:street',
        'addr:suburb',
        'addr:city',
        'addr:state',
        'addr:province',
        'addr:postcode',
        'addr:country',
        'opening_hours',
        'payment:cash',
        'payment:bitcoin',
        'currency:XBT',
        'payment:onchain',
        'payment:lightning',
        'payment:lightning_contactless',
        'organic',
        'payment:onchain',
        'phone',
        'website',
        'email',
        'facebook',
        'produce',
        'product',
        'wheelchair',
        'contact:phone',
        'contact:website',
        'contact:email',
        'contact:facebook',
        'contact:twitter',
        'contact:phone',
        'url',
        'description',
        'note',
        'wholesale',
        'drink:raw_milk',
      ];
      j?.elements.forEach((n: MapData) => {
        const p: MapData = {
          ll: L.latLng(n.lat, n.lon),
          id: n.id,
          lat: n.lat,
          lon: n.lon,
          tags: Object.keys(n.tags)
            .filter((key) => allowed.includes(key))
            .reduce((obj: { [key: string]: string }, key) => {
              obj[key] = n.tags[key];
              return obj;
            }, {}),
        };
        const pid: string = `id${p.id}`;
        if (
          !(mapData[pid] && JSON.stringify(mapData[pid]) === JSON.stringify(p))
        ) {
          // something has changed, update it
          upsertMarker(p);
        }
      });
      updateInfo();
      fetchedBounds.push(currentBounds);
    })
    .catch((e) => {
      console.error('e :>> ', e);
      updateInfo(
        navigator.onLine ? 'MAP IS READY' : 'OFFLINE — showing saved data'
      );
    });
}, 1000);

const makeAddressArray = (p: MapData) => {
  const address = [];
  if (p?.tags['addr:floor']) address.push(p.tags['addr:floor'] + ' Floor');
  if (p?.tags['addr:housename']) address.push(p.tags['addr:housename']);
  if (p?.tags['addr:housenumber'] && p?.tags['addr:street'])
    address.push(p.tags['addr:housenumber'] + ' ' + p?.tags['addr:street']);
  else if (p?.tags['addr:street']) address.push(p.tags['addr:street']);
  if (p?.tags['addr:suburb']) address.push(p.tags['addr:suburb']);
  if (p?.tags['addr:city']) address.push(p.tags['addr:city']);
  if (p?.tags['addr:state']) address.push(p.tags['addr:state']);
  if (p?.tags['addr:province']) address.push(p.tags['addr:province']);
  if (p?.tags['addr:postcode']) address.push(p.tags['addr:postcode']);
  if (p?.tags['addr:country']) address.push(p.tags['addr:country']);
  return address;
};

const formatPopup = (place: MapData): string => {
  const p = JSON.parse(JSON.stringify(place));
  const punctuate = (str: string) =>
    str.endsWith('.') || str.endsWith('!') || str.endsWith('?')
      ? `${str}.`
      : str;
  const shopName = p?.tags.name || 'Unknown Name',
    sharing: string[] = [shopName],
    contact = [],
    address = makeAddressArray(p);
  const shareData = {
    title: shopName,
    text: `Find ${shopName} on Farm Food Map.`,
    url: `https://farmfoodmap.org/?lat=${p.lat}&lng=${p.lon}&z=19`,
  };
  if (address.length) shareData.text += punctuate(` ${address.join(', ')}`);
  // contact
  if (p?.tags['website']) {
    contact.push(
      `<a href="${p.tags['website']}" target="_blank" rel="noopener noreferrer">Website</a>`
    );
    sharing.push(p?.tags['website']);
  } else if (p?.tags['contact:website']) {
    contact.push(
      `<a href="${p.tags['contact:website']}" target="_blank" rel="noopener noreferrer">Website</a>`
    );
    sharing.push(p?.tags['contact:website']);
  } else if (p?.tags['url']) {
    contact.push(
      `<a href="${p.tags['url']}" target="_blank" rel="noopener noreferrer">Website</a>`
    );
    sharing.push(p?.tags['url']);
  }
  if (p?.tags['email']) {
    contact.push(
      `<a href="mailto:${p.tags['email']}" target="_blank" rel="noopener noreferrer">Email</a>`
    );
  } else if (p?.tags['contact:email']) {
    contact.push(
      `<a href="mailto:${p.tags['contact:email']}" target="_blank" rel="noopener noreferrer">Email</a>`
    );
  }
  if (p?.tags['phone']) {
    contact.push(`<a href="tel:${p.tags['phone']}">${p.tags['phone']}</a>`);
  } else if (p?.tags['contact:phone']) {
    contact.push(
      `<a href="tel:${p.tags['contact:phone']}">${p.tags['contact:phone']}</a>`
    );
  } else if (p?.tags['contact:mobile']) {
    contact.push(
      `<a href="tel:${p.tags['contact:mobile']}">${p.tags['contact:mobile']}</a>`
    );
  }
  if (p?.tags['contact:facebook']) {
    contact.push(
      `<a href="${p.tags['url']}" target="_blank" rel="noopener noreferrer">Facebook</a>`
    );
  } else if (p?.tags['facebook']) {
    contact.push(
      `<a href="${p.tags['url']}" target="_blank" rel="noopener noreferrer">Facebook</a>`
    );
  }

  const capitalize = (word: string) =>
    word.charAt(0).toUpperCase() + word.slice(1);
  const joiner = new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
  });
  p.tags.products = capitalize(
    joiner.format(
      (p.tags.produce || '')
        .split(';')
        .concat((p.tags.product || '').split(';'))
        .filter((item: string) => !!item)
        .map((item: string) => item.trim())
    )
  );
  if (p.tags.description) shareData.text += punctuate(` ${p.tags.description}`);
  if (p.tags.products)
    shareData.text += punctuate(` Selling: ${p.tags.products}`);
  shareData.text = shareData.text
    .replaceAll("'", '\x27')
    .replaceAll('"', '\x22');
  if (
    (p.tags['currency:XBT'] && p.tags['currency:XBT'] !== 'no') ||
    (p.tags['payment:bitcoin'] && p.tags['payment:bitcoin'] !== 'no') ||
    (p.tags['payment:onchain'] && p.tags['payment:onchain'] !== 'no') ||
    (p.tags['payment:lightning'] && p.tags['payment:lightning'] !== 'no') ||
    (p.tags['payment:lightning_contactless'] &&
      p.tags['payment:lightning_contactless'] !== 'no')
  ) {
    shareData.text += ` Bitcoin accepted here!`;
  }
  if (p.nostr) shareData.text += ` Verified on Nostr.`;
  const nostrBadge = p.nostr
    ? `<div class="nostr-badge" title="NIP-05 verified — checked ${new Date(
        p.nostr.verifiedAt
      ).toLocaleDateString()}">✔ Nostr verified: <a href="https://njump.me/${
        p.nostr.npub
      }" target="_blank" rel="noopener noreferrer">${p.nostr.nip05}</a></div>`
    : '';
  let info = `<strong>${shopName}</strong><br>
        ${nostrBadge}
        ${
          address.length ? `<small>${address.join('<br>')}</small><br>` : ''
        }<br>
        ${p.tags.products.length ? `Selling: ${p.tags.products}<br><br>` : ''}
        ${
          p.tags['description']
            ? p.tags['description'] + '<br><br>'
            : p.tags['note']
            ? p.tags['note'] + '<br><br>'
            : ''
        }
        ${
          Object.keys(p.tags)
            .filter(
              (k) =>
                k === 'payment:cash' ||
                k === 'payment:bitcoin' ||
                k === 'payment:onchain' ||
                k === 'payment:lightning' ||
                k === 'payment:lightning_contactless' ||
                k === 'organic' ||
                k === 'currency:XBT' ||
                k === 'wheelchair' ||
                k === 'wholesale' ||
                k === 'drink:raw_milk'
            )
            .map((k) => {
              p.tags[k] = p.tags[k]
                .replace(/^\byes\b$/, '✔')
                .replace(/^\bno\b$/, '✘');
              const key =
                capitalize(
                  k
                    .replace('_', ' ')
                    .replace(/^payment/, 'pay')
                    .replace('currency:XBT', 'Bitcoin accepted')
                    .replace('drink:raw milk', 'Raw milk sold')
                    .replace(':', ' with ')
                ) || '';
              const value =
                joiner.format(
                  capitalize(p.tags[k])
                    .split(';')
                    .map((w) => w.trim())
                ) || '';
              return p.tags[k]
                ? `<em>${capitalize(key)}</em>: ${value}<br>`
                : '';
            })
            .join('') + '<br>'
        }${contact.length ? contact.join(' - ') + '<br><br><br>' : ''}
          <div class="btn" onclick="editMap('${
            p.id
          }')">Edit</div><div class="btn" onclick="sharePopup(this,'${btoa(
    encodeURIComponent(JSON.stringify(shareData))
  )}')">Share</div>`;
  return info;
};

const bulkMarkersToMap = (arr = Object.values(mapData)) => {
  markers.clearLayers();
  const markerArr = arr.map((p) => {
    const info = formatPopup(p);
    const thisMarker = L.marker([p.lat, p.lon], {
      icon: FFMM,
    }).bindPopup(info);
    return thisMarker;
  });
  markers.addLayers(markerArr);
  updateInfo();
};
Object.values(globalMapData).forEach((p: MapData) => {
  const pid: string = `id${p.id}`;
  const nostr = (nostrData as NostrDataObject)[pid];
  const place = {
    ll: L.latLng(p.lat, p.lon),
    ...p,
    ...(nostr ? { nostr } : {}),
  };
  if (Object.prototype.hasOwnProperty.call(globalMapData, pid)) {
    if (!mapData[pid]) {
      mapData[pid] = place;
    }
  }
});
bulkMarkersToMap();

// ---------------------------------------------------------------------------
// In-app OSM submission (add/edit a location without leaving the app)
// ---------------------------------------------------------------------------

// Adds/updates a single marker in-place — the same L.marker/formatPopup pattern fetchData's
// per-node loop already used, extracted so the post-submit optimistic render can reuse it too.
const upsertMarker = (p: MapData): L.Marker => {
  const ll = L.latLng(p.lat, p.lon);
  // Live Overpass data and post-submit OSM responses never carry a `nostr` field (it's
  // farmfoodmap's own data, not an OSM tag) — re-attach it here or a pan/zoom refresh or an
  // edit would silently drop a previously-shown verified badge.
  const nostr = (nostrData as NostrDataObject)[`id${p.id}`];
  const place = { ...p, ...(nostr ? { nostr } : {}) };
  const thisMarker = L.marker([p.lat, p.lon], { icon: FFMM }).bindPopup(
    formatPopup(place)
  );
  const existing = markers
    .getLayers()
    .find((item) => (item as L.Marker).getLatLng().equals(ll));
  if (existing) {
    markers.removeLayer(existing).addLayer(thisMarker);
  } else {
    markers.addLayer(thisMarker);
  }
  mapData[`id${p.id}`] = { ...place, ll };
  return thisMarker;
};

type FormMode = 'add' | 'edit';
type FormContext = {
  mode: FormMode;
  nodeId?: number;
  version?: number;
  lat: number;
  lon: number;
};
let currentFormContext: FormContext | null = null;

const xmlEscape = (str: string) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const osmFetch = (path: string, options: RequestInit = {}) =>
  fetch(`${OSM_API_ROOT}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${osmGetAccessToken()}`,
    },
  });

const throwOnError = async (res: Response) => {
  if (!res.ok) {
    throw { status: res.status, body: await res.text() };
  }
  return res;
};

const createChangeset = async (comment: string): Promise<number> => {
  const body = `<osm><changeset><tag k="created_by" v="farmfoodmap.org"/><tag k="comment" v="${xmlEscape(
    comment
  )}"/></changeset></osm>`;
  const res = await throwOnError(
    await osmFetch('/api/0.6/changeset/create', { method: 'PUT', body })
  );
  return parseInt(await res.text());
};

const closeChangeset = async (changesetId: number): Promise<void> => {
  await throwOnError(
    await osmFetch(`/api/0.6/changeset/${changesetId}/close`, { method: 'PUT' })
  );
};

const tagsToXml = (tags: { [key: string]: string }) =>
  Object.entries(tags)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `<tag k="${xmlEscape(k)}" v="${xmlEscape(v)}"/>`)
    .join('');

const createNode = async (
  changesetId: number,
  lat: number,
  lon: number,
  tags: { [key: string]: string }
): Promise<number> => {
  const body = `<osm><node changeset="${changesetId}" lat="${lat}" lon="${lon}">${tagsToXml(
    tags
  )}</node></osm>`;
  const res = await throwOnError(
    await osmFetch('/api/0.6/node/create', { method: 'PUT', body })
  );
  return parseInt(await res.text());
};

const updateNode = async (
  nodeId: number,
  changesetId: number,
  version: number,
  lat: number,
  lon: number,
  tags: { [key: string]: string }
): Promise<void> => {
  const body = `<osm><node id="${nodeId}" changeset="${changesetId}" version="${version}" lat="${lat}" lon="${lon}">${tagsToXml(
    tags
  )}</node></osm>`;
  await throwOnError(
    await osmFetch(`/api/0.6/node/${nodeId}`, { method: 'PUT', body })
  );
};

const fetchNode = async (
  nodeId: number
): Promise<{
  lat: number;
  lon: number;
  version: number;
  tags: { [key: string]: string };
}> => {
  const res = await throwOnError(
    await fetch(`${OSM_API_ROOT}/api/0.6/node/${nodeId}.json`)
  );
  const json = await res.json();
  const el = json.elements[0];
  return { lat: el.lat, lon: el.lon, version: el.version, tags: el.tags || {} };
};

// --- form field <-> tags -----------------------------------------------------

const fieldValue = (id: string): string =>
  (
    document.getElementById(id) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | null
  )?.value.trim() || '';

const setFieldValue = (id: string, v: string) => {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  if (el) el.value = v || '';
};

const getChipValues = (containerId: string): string[] => {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>('.chip'))
    .map((chip) => chip.dataset.value || '')
    .filter(Boolean);
};

const addChip = (containerId: string, rawValue: string) => {
  const value = rawValue.trim();
  if (!value) return;
  const list = document
    .getElementById(containerId)
    ?.querySelector('.chip-list');
  if (!list) return;
  if (
    Array.from(list.children).some(
      (c) => (c as HTMLElement).dataset.value === value
    )
  ) {
    return;
  }
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.dataset.value = value;
  chip.textContent = value;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'chipRemove';
  removeBtn.title = `Remove ${value}`;
  removeBtn.textContent = '×';
  removeBtn.onclick = () => chip.remove();
  chip.appendChild(removeBtn);
  list.appendChild(chip);
};

const setChipValues = (containerId: string, values: string[]) => {
  const list = document
    .getElementById(containerId)
    ?.querySelector('.chip-list');
  if (list) list.innerHTML = '';
  values.forEach((v) => addChip(containerId, v));
};

['osmProduceChips', 'osmProductChips'].forEach((containerId) => {
  const input = document
    .getElementById(containerId)
    ?.querySelector('input') as HTMLInputElement | null;
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip(containerId, input.value.replace(/,$/, ''));
      input.value = '';
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      addChip(containerId, input.value);
      input.value = '';
    }
  });
});

// Only the primary phone/website/email tags are exposed in the form, not the contact:* variants
// of the same thing (contact:phone/website/email) — formatPopup already treats them as
// interchangeable fallbacks, so asking users to fill in both would just be duplicate data entry.
// contact:facebook/contact:twitter are kept since those genuinely aren't covered by any other field.
const gatherFormTags = (): { [key: string]: string } => {
  const tags: { [key: string]: string } = { shop: 'farm' };
  const set = (key: string, id: string) => {
    const v = fieldValue(id);
    if (v) tags[key] = v;
  };
  set('name', 'osmName');
  set('addr:housename', 'osmAddrHousename');
  set('addr:housenumber', 'osmAddrHousenumber');
  set('addr:street', 'osmAddrStreet');
  set('addr:suburb', 'osmAddrSuburb');
  set('addr:city', 'osmAddrCity');
  set('addr:state', 'osmAddrState');
  set('addr:province', 'osmAddrProvince');
  set('addr:postcode', 'osmAddrPostcode');
  set('addr:country', 'osmAddrCountry');
  set('opening_hours', 'osmOpeningHours');
  set('payment:cash', 'osmPaymentCash');
  set('currency:XBT', 'osmCurrencyXbt');
  set('payment:onchain', 'osmPaymentOnchain');
  set('payment:lightning', 'osmPaymentLightning');
  set('organic', 'osmOrganic');
  set('drink:raw_milk', 'osmRawMilk');
  set('wholesale', 'osmWholesale');
  set('wheelchair', 'osmWheelchair');
  set('phone', 'osmPhone');
  set('website', 'osmWebsite');
  set('email', 'osmEmail');
  set('contact:facebook', 'osmContactFacebook');
  set('contact:twitter', 'osmContactTwitter');
  set('description', 'osmDescription');
  const produce = getChipValues('osmProduceChips');
  if (produce.length) tags.produce = produce.join('; ');
  const product = getChipValues('osmProductChips');
  if (product.length) tags.product = product.join('; ');
  return tags;
};

const populateForm = (tags: { [key: string]: string }) => {
  setFieldValue('osmName', tags.name || '');
  setFieldValue('osmAddrHousename', tags['addr:housename'] || '');
  setFieldValue('osmAddrHousenumber', tags['addr:housenumber'] || '');
  setFieldValue('osmAddrStreet', tags['addr:street'] || '');
  setFieldValue('osmAddrSuburb', tags['addr:suburb'] || '');
  setFieldValue('osmAddrCity', tags['addr:city'] || '');
  setFieldValue('osmAddrState', tags['addr:state'] || '');
  setFieldValue('osmAddrProvince', tags['addr:province'] || '');
  setFieldValue('osmAddrPostcode', tags['addr:postcode'] || '');
  setFieldValue('osmAddrCountry', tags['addr:country'] || '');
  setFieldValue('osmOpeningHours', tags.opening_hours || '');
  setFieldValue('osmPaymentCash', tags['payment:cash'] || '');
  setFieldValue('osmCurrencyXbt', tags['currency:XBT'] || '');
  setFieldValue('osmPaymentOnchain', tags['payment:onchain'] || '');
  setFieldValue('osmPaymentLightning', tags['payment:lightning'] || '');
  setFieldValue('osmOrganic', tags.organic || '');
  setFieldValue('osmRawMilk', tags['drink:raw_milk'] || '');
  setFieldValue('osmWholesale', tags.wholesale || '');
  setFieldValue('osmWheelchair', tags.wheelchair || '');
  setFieldValue('osmPhone', tags.phone || '');
  setFieldValue('osmWebsite', tags.website || '');
  setFieldValue('osmEmail', tags.email || '');
  setFieldValue('osmContactFacebook', tags['contact:facebook'] || '');
  setFieldValue('osmContactTwitter', tags['contact:twitter'] || '');
  setFieldValue('osmDescription', tags.description || '');
  setChipValues(
    'osmProduceChips',
    (tags.produce || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  setChipValues(
    'osmProductChips',
    (tags.product || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
  );
};

const clearForm = () => populateForm({});

// --- panel open/close, submit orchestration ----------------------------------

const setSubmitStatus = (
  text: string,
  kind: 'info' | 'error' | 'success' = 'info'
) => {
  const el = document.getElementById('osmSubmitStatus');
  if (!el) return;
  el.className = kind;
  el.textContent = text;
};

const updateSubmitButtonForAuthState = () => {
  const btn = document.getElementById('osmSubmitBtn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = osmIsLoggedIn()
    ? 'Submit to OpenStreetMap'
    : 'Log in with OpenStreetMap to submit';
};

const showFormPanel = () => {
  document.querySelectorAll('.pages').forEach((p) => {
    p.classList.add('hidden');
  });
  document.getElementById('addLocationForm')?.classList.remove('hidden');
  updateSubmitButtonForAuthState();
};

const openAddLocationForm = (lat: number, lon: number) => {
  currentFormContext = { mode: 'add', lat, lon };
  clearForm();
  const title = document.getElementById('osmFormTitle');
  if (title) title.textContent = 'Add a location';
  setSubmitStatus('');
  showFormPanel();
};

const openEditLocationForm = async (nodeId: number) => {
  currentFormContext = { mode: 'edit', nodeId, lat: 0, lon: 0 };
  const title = document.getElementById('osmFormTitle');
  if (title) title.textContent = 'Edit this location';
  clearForm();
  showFormPanel();
  setSubmitStatus('Loading current details from OpenStreetMap…');
  try {
    const node = await fetchNode(nodeId);
    currentFormContext = {
      mode: 'edit',
      nodeId,
      version: node.version,
      lat: node.lat,
      lon: node.lon,
    };
    populateForm(node.tags);
    setSubmitStatus('');
  } catch (_e) {
    setSubmitStatus(
      'Could not load this location from OpenStreetMap. Please try again.',
      'error'
    );
  }
};

const buildPendingSubmission = (tags: { [key: string]: string }): PendingSubmission | null => {
  if (!currentFormContext) return null;
  return {
    mode: currentFormContext.mode,
    nodeId: currentFormContext.nodeId,
    version: currentFormContext.version,
    lat: currentFormContext.lat,
    lon: currentFormContext.lon,
    tags,
  };
};

const submitLocationForm = async () => {
  if (!currentFormContext) return;
  const tags = gatherFormTags();
  if (!tags.name) {
    setSubmitStatus('Please enter a name.', 'error');
    return;
  }

  if (!osmIsLoggedIn()) {
    const pending = buildPendingSubmission(tags);
    if (pending) stashPendingSubmission(pending);
    setSubmitStatus('Redirecting to OpenStreetMap to log in…');
    await osmLogin();
    return;
  }

  const submitBtn = document.getElementById('osmSubmitBtn') as HTMLButtonElement | null;
  if (submitBtn) submitBtn.disabled = true;
  setSubmitStatus('Submitting to OpenStreetMap…');

  try {
    let place: MapData;
    if (currentFormContext.mode === 'add') {
      const changesetId = await createChangeset('Add farm shop via farmfoodmap.org');
      const nodeId = await createNode(
        changesetId,
        currentFormContext.lat,
        currentFormContext.lon,
        tags
      );
      await closeChangeset(changesetId);
      place = { id: nodeId, lat: currentFormContext.lat, lon: currentFormContext.lon, tags };
    } else {
      if (!currentFormContext.nodeId || !currentFormContext.version) {
        throw new Error('Missing node id/version for edit');
      }
      const changesetId = await createChangeset('Edit farm shop via farmfoodmap.org');
      await updateNode(
        currentFormContext.nodeId,
        changesetId,
        currentFormContext.version,
        currentFormContext.lat,
        currentFormContext.lon,
        tags
      );
      await closeChangeset(changesetId);
      place = {
        id: currentFormContext.nodeId,
        lat: currentFormContext.lat,
        lon: currentFormContext.lon,
        tags,
      };
    }
    const marker = upsertMarker(place);
    setSubmitStatus(
      "Added! You can see it here right away — it's live on OpenStreetMap now, but it may take a while to show up for other visitors, since Farm Food Map's dataset only refreshes periodically.",
      'success'
    );
    setTimeout(() => {
      backToMap();
      marker.openPopup();
    }, 1800);
  } catch (err: any) {
    if (submitBtn) submitBtn.disabled = false;
    if (err?.status === 401) {
      osmLogout();
      const pending = buildPendingSubmission(tags);
      if (pending) stashPendingSubmission(pending);
      setSubmitStatus(
        'Your OpenStreetMap login expired. Please log in again to finish submitting.',
        'error'
      );
      updateSubmitButtonForAuthState();
      return;
    }
    if (err?.status === 409 && currentFormContext.mode === 'edit' && currentFormContext.nodeId) {
      try {
        const fresh = await fetchNode(currentFormContext.nodeId);
        currentFormContext.version = fresh.version;
        currentFormContext.lat = fresh.lat;
        currentFormContext.lon = fresh.lon;
        populateForm(fresh.tags);
        setSubmitStatus(
          'This location changed on OpenStreetMap since you opened it. Its latest details are shown above — please review and resubmit.',
          'error'
        );
      } catch (_e2) {
        setSubmitStatus(
          'This location changed on OpenStreetMap since you opened it. Please reopen it and try again.',
          'error'
        );
      }
      return;
    }
    setSubmitStatus(
      err?.body
        ? `Something went wrong: ${err.body}`
        : 'Something went wrong submitting to OpenStreetMap. You can try again.',
      'error'
    );
  }
};

document.getElementById('osmForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  submitLocationForm();
});

// If we're coming back from an OSM OAuth redirect, complete the token exchange and restore
// whatever form the user had filled in before being sent to log in.
(async () => {
  const result = await osmHandleRedirectCallback();
  if (result === 'none') return;
  const pending = takePendingSubmission();
  if (!pending) return;
  currentFormContext = {
    mode: pending.mode,
    nodeId: pending.nodeId,
    version: pending.version,
    lat: pending.lat,
    lon: pending.lon,
  };
  const title = document.getElementById('osmFormTitle');
  if (title) {
    title.textContent = pending.mode === 'add' ? 'Add a location' : 'Edit this location';
  }
  populateForm(pending.tags);
  showFormPanel();
  setSubmitStatus(
    osmIsLoggedIn()
      ? 'Logged in — review and submit below.'
      : "Login didn't complete. Please try logging in again.",
    osmIsLoggedIn() ? 'success' : 'error'
  );
})();

window.sharePopup = async (button: HTMLElement, text: string) => {
  let shareData: { title?: string; text?: string; url?: string } = {};
  try {
    shareData = JSON.parse(decodeURIComponent(atob(text)));
    await navigator.share(shareData);
  } catch (_e) {
    const newClip = Object.values(shareData).join('\n');
    navigator.clipboard.writeText(newClip).then(
      () => {
        /* clipboard successfully set */
        button.innerText = 'Copy';
      },
      () => {
        /* clipboard write failed */
        alert('Unable to copy or share');
      }
    );
  }
};

setBounds();
map.on('moveend', setBounds);
map.on('zoomend', setBounds);

const modal = document.getElementById('myModal');
const closeButton = document.getElementById('modalClose') as HTMLElement;

closeButton!.onclick = function () {
  modal!.style.display = 'none';
  localStorage.userInstallChoice = 'dismissed';
};

window.onclick = function (event) {
  if (event.target == modal) {
    modal!.style.display = 'none';
    localStorage.userInstallChoice = 'dismissed';
  }
};

const installPromptButton = document.getElementById('installPrompt');

if (!localStorage.userInstallChoice) {
  localStorage.userInstallChoice = 'null';
}

const showInstallPromotion = () => {
  if (localStorage.userInstallChoice === 'accepted') {
    return;
  }
  if (localStorage.userInstallChoice === 'null') {
    modal!.style.display = 'block';
  }
  installPromptButton!.style.display = 'block';
};

const hideInstallPromotion = () => {
  modal!.style.display = 'none';
  installPromptButton!.style.display = 'none';
};

installPromptButton!.onclick = () => {
  localStorage.userInstallChoice = 'null';
  showInstallPromotion();
};

let deferredPrompt: BeforeInstallPromptEvent | null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallPromotion();
});

window.addEventListener('appinstalled', () => {
  hideInstallPromotion();
  deferredPrompt = null;
  localStorage.userInstallChoice = 'installed';
});

document
  .getElementById('installButton')
  ?.addEventListener('click', async () => {
    hideInstallPromotion();
    deferredPrompt!.prompt();
    const { outcome } = await deferredPrompt!.userChoice;
    localStorage.userInstallChoice = outcome;
    deferredPrompt = null;
  });

if (
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
) {
  if (!localStorage.iOSLoaded) {
    localStorage.iOSLoaded = 1;
    showInstallPromotion();
  } else {
    installPromptButton!.style.display = 'block';
  }
}

window.editMap = (nodeId = '') => {
  const id = parseInt(nodeId);
  if (!id) {
    console.warn('editMap called without a valid node id');
    return;
  }
  openEditLocationForm(id);
};

const backToMap = () => {
  document.querySelectorAll('.pages').forEach((p) => {
    p.classList.add('hidden');
  });
  document.getElementById('mapPage')?.classList.remove('hidden');
};

document.getElementById('aboutLink')?.addEventListener('click', () => {
  document.querySelectorAll('.pages').forEach((p) => {
    p.classList.add('hidden');
  });
  document.getElementById('aboutPage')?.classList.remove('hidden');
});

document.querySelectorAll('.backToMap').forEach((b) => {
  b.addEventListener('click', backToMap);
});

map.addEventListener('click', (event: L.LeafletMouseEvent) => {
  if (isInAddMode) {
    setAddMode(false);
    openAddLocationForm(event.latlng.lat, event.latlng.lng);
  }
});

document.getElementById('addLocationCancel')?.addEventListener('click', (e) => {
  e.stopPropagation();
  setAddMode(false);
});
