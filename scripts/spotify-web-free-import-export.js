// ==UserScript==
// @name         Spotify Web Free - Import/Export
// @namespace    https://github.com/rtritto/spotify-utils
// @version      1.0.0
// @description  Export and import Liked Songs, Followed Artists, and Playlists on Spotify Web Free (Violentmonkey + Tampermonkey)
// @author       rtritto
// @homepageURL  https://github.com/rtritto/spotify-utils
// @supportURL   https://github.com/rtritto/spotify-utils/issues
// @updateURL    https://raw.githubusercontent.com/rtritto/spotify-utils/refs/heads/master/scripts/spotify-web-free-import-export.js
// @downloadURL  https://raw.githubusercontent.com/rtritto/spotify-utils/refs/heads/master/scripts/spotify-web-free-import-export.js
// @match        https://open.spotify.com/*
// @run-at       document-start
// @inject-into  content
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const rawWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const pageWin = rawWin.wrappedJSObject || rawWin;
  const apiFetch = window.fetch.bind(window);
  const STORAGE_HASHES_KEY = 'sp_ie_pathfinder_hashes_v2';

  const auth = {
    bearer: null,
    clientToken: null,
    appVersion: null,
    userId: null,
  };

  const diag = {
    bridgeActive: false,
    sawAnySpotifyReq: false,
  };

  const hashes = loadCachedHashes();
  const scannedScripts = new Set();

  function loadCachedHashes() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_HASHES_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveHash(opName, sha256Hash) {
    if (!opName || !sha256Hash || !/^[a-f0-9]{64}$/i.test(sha256Hash)) return;
    if (hashes[opName] !== sha256Hash) {
      hashes[opName] = sha256Hash;
      try {
        localStorage.setItem(STORAGE_HASHES_KEY, JSON.stringify(hashes));
      } catch { }
    }
  }

  // =========================================================================
  // 1. MAIN-WORLD BRIDGE VIA BLOB (works in Violentmonkey @inject-into content)
  // =========================================================================
  function mainWorldBridge() {
    if (window.__spIeBridgeLoaded) return;
    window.__spIeBridgeLoaded = true;

    let lastBearer = null;
    let lastClient = null;
    let lastVer = null;
    let sawReq = false;

    function emitToken() {
      try {
        window.postMessage({
          __spIe: true,
          type: 'token',
          bearer: lastBearer,
          clientToken: lastClient,
          appVersion: lastVer,
          sawReq: sawReq,
        }, '*');
      } catch { }
    }

    function emitHash(op, hash) {
      if (!op || !hash) return;
      try {
        window.postMessage({ __spIe: true, type: 'hash', op: op, hash: hash }, '*');
      } catch { }
    }

    function captureHeaderPair(key, val) {
      if (!key || !val) return;
      const k = String(key).toLowerCase();
      const v = String(val).trim();
      let changed = false;

      if (k === 'authorization' && v.toLowerCase().startsWith('bearer ') && v.length > 35) {
        const tok = v.slice(7).trim();
        if (lastBearer !== tok) {
          lastBearer = tok;
          changed = true;
        }
      } else if (k === 'client-token' && v.length > 15) {
        if (lastClient !== v) {
          lastClient = v;
          changed = true;
        }
      } else if (k === 'spotify-app-version' && v) {
        lastVer = v;
      }
      if (changed) emitToken();
    }

    function extractHeaders(headersLike) {
      if (!headersLike) return;
      try {
        if (typeof headersLike.forEach === 'function') {
          headersLike.forEach((v, k) => captureHeaderPair(k, v));
          return;
        }
        if (Array.isArray(headersLike)) {
          for (const pair of headersLike) {
            if (Array.isArray(pair) && pair.length >= 2) captureHeaderPair(pair[0], pair[1]);
          }
          return;
        }
        if (typeof headersLike === 'object') {
          for (const k of Object.keys(headersLike)) {
            captureHeaderPair(k, headersLike[k]);
          }
        }
      } catch { }
    }

    function inspectPathfinder(url, bodyText) {
      try {
        if (!url || !url.includes('api-partner.spotify.com/pathfinder')) return;
        const u = new URL(url, location.origin);
        const opParam = u.searchParams.get('operationName');
        const extParam = u.searchParams.get('extensions');
        if (opParam && extParam) {
          const ext = JSON.parse(extParam);
          const h = ext?.persistedQuery?.sha256Hash;
          if (h) emitHash(opParam, h);
        }
        if (bodyText && typeof bodyText === 'string' && bodyText.trim().startsWith('{')) {
          const body = JSON.parse(bodyText);
          const h = body?.extensions?.persistedQuery?.sha256Hash;
          if (body?.operationName && h) emitHash(body.operationName, h);
        }
      } catch { }
    }

    try {
      const origSet = Headers.prototype.set;
      Headers.prototype.set = function (name, value) {
        try { captureHeaderPair(name, value); } catch { }
        return origSet.apply(this, arguments);
      };
      const origAppend = Headers.prototype.append;
      Headers.prototype.append = function (name, value) {
        try { captureHeaderPair(name, value); } catch { }
        return origAppend.apply(this, arguments);
      };
    } catch { }

    try {
      const origJson = Response.prototype.json;
      Response.prototype.json = function () {
        const p = origJson.apply(this, arguments);
        try {
          const rUrl = String((this && this.url) || '');
          if (rUrl.includes('/api/token') || rUrl.includes('clienttoken.spotify.com') || rUrl.includes('/get_access_token')) {
            sawReq = true;
            p.then((j) => {
              let ch = false;
              if (j && j.accessToken && j.isAnonymous !== true && lastBearer !== j.accessToken) {
                lastBearer = j.accessToken;
                ch = true;
              }
              if (j && j.granted_token && j.granted_token.token && lastClient !== j.granted_token.token) {
                lastClient = j.granted_token.token;
                ch = true;
              }
              if (ch) emitToken();
            }).catch(() => { });
          }
        } catch { }
        return p;
      };
    } catch { }

    try {
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        try {
          if (url.includes('spotify.com') || url.startsWith('/')) {
            sawReq = true;
            if (input && typeof input === 'object' && input.headers) extractHeaders(input.headers);
            if (init && init.headers) extractHeaders(init.headers);
            if (init && typeof init.body === 'string') inspectPathfinder(url, init.body);
            else inspectPathfinder(url, null);
          }
        } catch { }

        const p = origFetch.apply(this, arguments);
        try {
          p.then((res) => {
            try {
              const rUrl = (res && res.url) || url || '';
              if (rUrl.includes('/api/token') || rUrl.includes('/get_access_token')) {
                res.clone().json().then((j) => {
                  if (j && j.accessToken && j.isAnonymous !== true) {
                    lastBearer = j.accessToken;
                    emitToken();
                  }
                }).catch(() => { });
              } else if (rUrl.includes('clienttoken.spotify.com')) {
                res.clone().json().then((j) => {
                  const tok = j && j.granted_token && j.granted_token.token;
                  if (tok) {
                    lastClient = tok;
                    emitToken();
                  }
                }).catch(() => { });
              }
            } catch { }
          }).catch(() => { });
        } catch { }
        return p;
      };
    } catch { }

    try {
      const origXhrOpen = XMLHttpRequest.prototype.open;
      const origXhrSet = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.open = function (m, url) {
        this._spUrl = String(url || '');
        return origXhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
        try {
          if (this._spUrl && (this._spUrl.includes('spotify.com') || this._spUrl.startsWith('/'))) {
            sawReq = true;
            captureHeaderPair(k, v);
          }
        } catch { }
        return origXhrSet.apply(this, arguments);
      };
    } catch { }

    try {
      const OrigWS = window.WebSocket;
      if (OrigWS) {
        const WrappedWS = function (wsUrl, protocols) {
          try {
            const s = String(wsUrl || '');
            if (s.includes('spotify.com')) {
              sawReq = true;
              const m = s.match(/[?&]access_token=([^&]+)/);
              if (m && m[1]) {
                lastBearer = decodeURIComponent(m[1]);
                emitToken();
              }
            }
          } catch { }
          return protocols !== undefined ? new OrigWS(wsUrl, protocols) : new OrigWS(wsUrl);
        };
        WrappedWS.prototype = OrigWS.prototype;
        window.WebSocket = WrappedWS;
      }
    } catch { }

    function scanWebpack() {
      if (lastBearer && lastClient) {
        emitToken();
        return;
      }
      try {
        const chunks = window.webpackChunkclient_web;
        if (!chunks || typeof chunks.push !== 'function') return;
        if (chunks.push === Array.prototype.push) return;

        let wpRequire = null;
        chunks.push([[`__sp_ie_${Date.now()}`], {}, function (req) { wpRequire = req; }]);
        if (!wpRequire || !wpRequire.c) return;

        const cache = wpRequire.c;
        const visited = new WeakSet();

        function scanObj(obj, depth) {
          if (!obj || depth > 4) return;
          if (typeof obj === 'string') {
            if (!lastBearer && obj.length >= 100 && obj.length <= 450 && /^BQ[A-Za-z0-9_-]+$/.test(obj)) {
              lastBearer = obj;
            }
            return;
          }
          if (typeof obj !== 'object') return;
          if (visited.has(obj)) return;
          visited.add(obj);
          if (obj === window || obj === document || obj instanceof Node) return;
          if (Array.isArray(obj)) {
            if (obj.length > 40) return;
            for (let i = 0; i < obj.length; i++) scanObj(obj[i], depth + 1);
            return;
          }
          let keys;
          try { keys = Object.keys(obj); } catch { return; }
          if (keys.length > 60) return;

          for (const k of keys) {
            try {
              const kl = k.toLowerCase();
              const v = obj[k];
              if (typeof v === 'string') {
                if (!lastBearer && v.length >= 100 && v.length <= 450 && /^BQ[A-Za-z0-9_-]+$/.test(v)) {
                  lastBearer = v;
                } else if (!lastBearer && (kl.includes('accesstoken') || kl === 'token' || kl === 'authorization') && v.length >= 80 && !v.includes(' ')) {
                  const clean = v.replace(/^Bearer\s+/i, '');
                  if (/^[A-Za-z0-9._-]{80,500}$/.test(clean)) lastBearer = clean;
                } else if (!lastClient && (kl.includes('clienttoken') || kl.includes('client_token')) && v.length >= 40 && v.length <= 600) {
                  lastClient = v;
                }
              } else if (v && typeof v === 'object' && depth < 3) {
                if (
                  kl === 'exports' || kl === 'default' || kl === '_token' ||
                  kl.includes('auth') || kl.includes('session') || kl.includes('token') ||
                  kl.includes('transport') || kl.includes('client') || kl.includes('platform') ||
                  kl.includes('user') || kl.includes('state') || kl.includes('config')
                ) {
                  scanObj(v, depth + 1);
                }
              }
            } catch { }
          }
        }

        for (const modId of Object.keys(cache)) {
          try {
            const mod = cache[modId];
            if (mod && mod.exports) scanObj(mod.exports, 0);
            if (lastBearer && lastClient) break;
          } catch { }
        }
        emitToken();
      } catch { }
    }

    window.addEventListener('message', (ev) => {
      if (ev && ev.data && ev.data.__spIeCmd === 'scan') {
        if (ev.data.resetBearer) lastBearer = null;
        scanWebpack();
      }
    });

    emitToken();
    setInterval(scanWebpack, 1500);
  }

  function injectMainWorldBridge() {
    if (document.getElementById('sp-ie-bridge-script')) return;
    try {
      const parent = document.documentElement || document.head || document.body;
      if (!parent) return;
      const code = `(${mainWorldBridge.toString()})();`;
      const blob = new Blob([code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const s = document.createElement('script');
      s.id = 'sp-ie-bridge-script';
      s.src = url;
      s.onload = () => {
        diag.bridgeActive = true;
        URL.revokeObjectURL(url);
      };
      s.onerror = () => {
        URL.revokeObjectURL(url);
      };
      parent.appendChild(s);
    } catch { }
  }

  window.addEventListener('message', (ev) => {
    const d = ev && ev.data;
    if (!d || d.__spIe !== true) return;
    diag.bridgeActive = true;
    if (d.type === 'token') {
      if (d.sawReq) diag.sawAnySpotifyReq = true;
      let changed = false;
      if (d.bearer && auth.bearer !== d.bearer) {
        auth.bearer = d.bearer;
        changed = true;
      }
      if (d.clientToken && auth.clientToken !== d.clientToken) {
        auth.clientToken = d.clientToken;
        changed = true;
      }
      if (d.appVersion) auth.appVersion = d.appVersion;
      if (changed) updateStatusBadge();
    } else if (d.type === 'hash') {
      saveHash(d.op, d.hash);
    }
  });

  function checkSessionTag() {
    if (auth.bearer) return;
    for (const id of ['session', 'config']) {
      try {
        const s = document.getElementById(id);
        if (s && s.textContent) {
          const j = JSON.parse(s.textContent);
          if (j?.accessToken && j?.isAnonymous !== true) {
            auth.bearer = j.accessToken;
            updateStatusBadge();
            return;
          }
        }
      } catch { }
    }
  }

  // Direct fallback via wrappedJSObject (Firefox @inject-into content)
  function findTokenDirectlyFirefox() {
    if (auth.bearer && auth.clientToken) return;
    try {
      const chunks = pageWin && pageWin.webpackChunkclient_web;
      if (!chunks || typeof chunks.push !== 'function') return;
      if (chunks.push === pageWin.Array.prototype.push) return;

      let wpRequire = null;
      const probeFn = (typeof exportFunction === 'function')
        ? exportFunction(function (req) { wpRequire = req; }, pageWin)
        : function (req) { wpRequire = req; };

      const payload = (typeof cloneInto === 'function')
        ? [cloneInto([`__sp_ie_fx_${Date.now()}`], pageWin), cloneInto({}, pageWin), probeFn]
        : [[`__sp_ie_fx_${Date.now()}`], {}, probeFn];

      chunks.push(payload);
      if (!wpRequire || !wpRequire.c) return;

      const cache = wpRequire.c;
      for (const modId of Object.keys(cache)) {
        try {
          const exp = cache[modId]?.exports;
          if (!exp || typeof exp !== 'object') continue;
          for (const k of Object.keys(exp)) {
            const v = exp[k];
            if (typeof v === 'string' && !auth.bearer && /^BQ[A-Za-z0-9_-]{100,450}$/.test(v)) {
              auth.bearer = v;
              updateStatusBadge();
            }
          }
        } catch { }
        if (auth.bearer) break;
      }
    } catch { }
  }

  function requestBridgeScan(resetBearer = false) {
    try {
      window.postMessage({ __spIeCmd: 'scan', resetBearer }, '*');
    } catch { }
    findTokenDirectlyFirefox();
  }

  // =========================================================================
  // 2. PATHFINDER HASH DISCOVERY FROM SPOTIFY WEB BUNDLES
  // =========================================================================
  const TARGET_OPS = [
    'fetchLibraryTracks',
    'addToLibrary',
    'libraryV3',
    'fetchPlaylist',
    'fetchPlaylistContents',
    'fetchPlaylistMetadata',
    'addItemsToRootlist',
  ];

  async function scanLoadedBundlesForHashes() {
    const urls = new Set();
    document.querySelectorAll('script[src]').forEach((s) => {
      if (s.src && s.src.includes('spotify')) urls.add(s.src);
    });
    try {
      performance.getEntriesByType('resource').forEach((e) => {
        if (e.name && e.name.endsWith('.js') && (e.name.includes('spotifycdn.com') || e.name.includes('open.spotify.com'))) {
          urls.add(e.name);
        }
      });
    } catch { }

    for (const url of urls) {
      if (scannedScripts.has(url)) continue;
      scannedScripts.add(url);
      try {
        const res = await apiFetch(url, { cache: 'force-cache' });
        if (!res.ok) continue;
        const text = await res.text();

        const p1 = /(["'])([A-Za-z0-9_]+)\1\s*,\s*(["'])(?:query|mutation)\3\s*,\s*(["'])([a-f0-9]{64})\4/g;
        let m;
        while ((m = p1.exec(text)) !== null) saveHash(m[2], m[5]);

        const p2 = /(?:operationName|name)\s*:\s*(["'])([A-Za-z0-9_]+)\1[^}]{0,160}?sha256Hash\s*:\s*(["'])([a-f0-9]{64})\3/g;
        while ((m = p2.exec(text)) !== null) saveHash(m[2], m[4]);

        for (const op of TARGET_OPS) {
          if (hashes[op]) continue;
          let idx = text.indexOf(`"${op}"`);
          if (idx === -1) idx = text.indexOf(`'${op}'`);
          if (idx !== -1) {
            const slice = text.slice(idx, idx + 120);
            const hm = slice.match(/["']([a-f0-9]{64})["']/);
            if (hm) saveHash(op, hm[1]);
          }
        }
      } catch { }
    }
  }

  async function ensureHash(opName) {
    if (hashes[opName]) return hashes[opName];
    await scanLoadedBundlesForHashes();
    return hashes[opName] || null;
  }

  // =========================================================================
  // 3. SPOTIFY API HELPERS
  // =========================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function ensureAuth() {
    checkSessionTag();
    requestBridgeScan(false);
    if (auth.bearer && auth.clientToken) return true;
    for (let i = 0; i < 12; i++) {
      checkSessionTag();
      requestBridgeScan(false);
      if (auth.bearer && auth.clientToken) return true;
      await sleep(250);
    }
    return !!(auth.bearer);
  }

  function pfHeaders() {
    const h = {
      'authorization': `Bearer ${auth.bearer}`,
      'content-type': 'application/json',
      'accept': 'application/json',
      'app-platform': 'WebPlayer',
    };
    if (auth.clientToken) h['client-token'] = auth.clientToken;
    if (auth.appVersion) h['spotify-app-version'] = auth.appVersion;
    return h;
  }

  function spclientHeaders() {
    const h = {
      'accept': 'application/json',
      'app-platform': 'WebPlayer',
      'authorization': `Bearer ${auth.bearer}`,
      'content-type': 'application/json;charset=UTF-8',
    };
    if (auth.clientToken) h['client-token'] = auth.clientToken;
    if (auth.appVersion) h['spotify-app-version'] = auth.appVersion;
    return h;
  }

  async function pfQuery(operationName, variables, retryOnStale = true) {
    const sha256Hash = await ensureHash(operationName);
    if (!sha256Hash) throw new Error(`HASH_MISSING:${operationName}`);

    const res = await apiFetch('https://api-partner.spotify.com/pathfinder/v2/query', {
      method: 'POST',
      headers: pfHeaders(),
      body: JSON.stringify({
        variables,
        operationName,
        extensions: { persistedQuery: { version: 1, sha256Hash } },
      }),
    });
    if (res.status === 401 && retryOnStale) {
      auth.bearer = null;
      requestBridgeScan(true);
      await sleep(400);
      if (auth.bearer) return pfQuery(operationName, variables, false);
    }
    if (res.status === 429) {
      const wait = parseInt(res.headers.get('retry-after') || '3', 10) * 1000;
      await sleep(wait);
      return pfQuery(operationName, variables, retryOnStale);
    }
    const json = await res.json();
    if (json?.errors?.some((e) => String(e.message || '').includes('PersistedQueryNotFound'))) {
      delete hashes[operationName];
      if (retryOnStale) {
        scannedScripts.clear();
        await scanLoadedBundlesForHashes();
        return pfQuery(operationName, variables, false);
      }
      throw new Error(`HASH_STALE:${operationName}`);
    }
    if (!res.ok || json?.errors?.length) {
      throw new Error(json?.errors?.[0]?.message || `HTTP ${res.status} (${operationName})`);
    }
    return json;
  }

  async function v1Fetch(path, options = {}) {
    const res = await apiFetch(`https://api.spotify.com/v1${path}`, {
      ...options,
      headers: {
        'authorization': `Bearer ${auth.bearer}`,
        'content-type': 'application/json',
        ...(auth.clientToken ? { 'client-token': auth.clientToken } : {}),
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      auth.bearer = null;
      requestBridgeScan(true);
      await sleep(400);
      if (auth.bearer) {
        return apiFetch(`https://api.spotify.com/v1${path}`, {
          ...options,
          headers: {
            'authorization': `Bearer ${auth.bearer}`,
            'content-type': 'application/json',
            ...(auth.clientToken ? { 'client-token': auth.clientToken } : {}),
            ...(options.headers || {}),
          },
        });
      }
    }
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      if (retryAfter > 0 && retryAfter <= 10) {
        await sleep(retryAfter * 1000);
        return v1Fetch(path, options);
      }
    }
    return res;
  }

  async function getCurrentUserId() {
    if (auth.userId) return auth.userId;

    try {
      const res = await v1Fetch('/me');
      if (res.ok) {
        const j = await res.json();
        if (j?.id) {
          auth.userId = j.id;
          return j.id;
        }
      }
    } catch { }

    try {
      const h = await ensureHash('profileAttributes');
      if (h) {
        const j = await pfQuery('profileAttributes', {});
        const u = j?.data?.me?.profile?.username || j?.data?.me?.username;
        if (u) {
          auth.userId = u;
          return u;
        }
      }
    } catch { }

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        const m = k.match(/^([^:]{2,64}):(?:active|recent|ads|playback|playlist|collection|artist)/i);
        if (m && m[1] !== 'anonymous') {
          auth.userId = m[1];
          return m[1];
        }
      }
    } catch { }

    return null;
  }

  // =========================================================================
  // 4. LIKED SONGS, FOLLOWED ARTISTS & PLAYLIST API
  // =========================================================================
  function findItemsContainer(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    if (Array.isArray(obj.items)) return obj;
    for (const k of Object.keys(obj)) {
      const res = findItemsContainer(obj[k], depth + 1);
      if (res) return res;
    }
    return null;
  }

  function normalizeTrackItem(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const holder = raw.itemV2 || raw.item || raw.track || raw;
    const data = holder?.data || raw?.track?.data || raw?.data || holder;

    const candidates = [
      data?.uri,
      data?._uri,
      holder?.uri,
      holder?._uri,
      raw?.track?.uri,
      raw?.track?._uri,
      raw?.itemV2?.uri,
      raw?.itemV2?._uri,
      raw?.item?.uri,
      raw?.item?._uri,
      raw?.uri,
      raw?._uri,
    ];

    let uri = candidates.find((u) => typeof u === 'string' && u.startsWith('spotify:track:'));
    if (!uri) {
      const id = data?.id || holder?.id || raw?.track?.id;
      if (typeof id === 'string' && /^[A-Za-z0-9]{15,30}$/.test(id)) {
        uri = `spotify:track:${id}`;
      }
    }
    if (!uri) return null;

    const name = data?.name || holder?.name || '';
    let artists = [];
    if (Array.isArray(data?.artists?.items)) {
      artists = data.artists.items.map((a) => a?.profile?.name || a?.name).filter(Boolean);
    } else if (Array.isArray(data?.artists)) {
      artists = data.artists.map((a) => a?.name).filter(Boolean);
    }
    const album = data?.albumOfTrack?.name || data?.album?.name || '';
    const addedAt = raw?.addedAt?.isoString || raw?.added_at || undefined;
    return { uri, name, artists, album, ...(addedAt ? { addedAt } : {}) };
  }

  async function exportLikedSongs(onProgress) {
    const tracks = [];

    try {
      let offset = 0;
      const limit = 50;
      while (true) {
        const json = await pfQuery('fetchLibraryTracks', { offset, limit });
        const lib =
          json?.data?.me?.library?.tracks ||
          json?.data?.me?.libraryV3 ||
          findItemsContainer(json?.data?.me) ||
          findItemsContainer(json?.data);

        const items = lib?.items || [];
        for (const it of items) {
          const parsed = normalizeTrackItem(it);
          if (parsed) tracks.push(parsed);
        }
        const total = lib?.totalCount ?? lib?.pagingInfo?.totalCount ?? null;
        if (onProgress) onProgress(tracks.length, total);
        if (items.length < limit || (total !== null && tracks.length >= total)) break;
        offset += limit;
      }
      if (tracks.length > 0) return tracks;
    } catch (err) {
      console.warn('[SP-IE] fetchLibraryTracks falling back to /v1/me/tracks:', err);
    }

    tracks.length = 0;
    let offset = 0;
    const limit = 50;
    while (true) {
      const res = await v1Fetch(`/me/tracks?offset=${offset}&limit=${limit}`);
      if (!res.ok) {
        throw new Error(
          `Unable to read Liked Songs (HTTP ${res.status}). ` +
          `Try opening the "Liked Songs" page on Spotify and retry.`
        );
      }
      const j = await res.json();
      const items = j?.items || [];
      for (const it of items) {
        const parsed = normalizeTrackItem(it);
        if (parsed) tracks.push(parsed);
      }
      if (onProgress) onProgress(tracks.length, j?.total ?? null);
      if (!j?.next || items.length < limit) break;
      offset += limit;
    }
    return tracks;
  }

  async function importLikedSongs(trackUris, onProgress) {
    const ordered = [...trackUris].reverse();
    let done = 0;

    try {
      const hasAddHash = await ensureHash('addToLibrary');
      if (hasAddHash) {
        const BATCH = 50;
        for (let i = 0; i < ordered.length; i += BATCH) {
          const batch = ordered.slice(i, i + BATCH);
          await pfQuery('addToLibrary', { libraryItemUris: batch });
          done += batch.length;
          if (onProgress) onProgress(done, ordered.length);
          if (i + BATCH < ordered.length) await sleep(250);
        }
        return done;
      }
    } catch (err) {
      console.warn('[SP-IE] addToLibrary failed, falling back to spclient collection/v2/write:', err);
    }

    done = 0;
    const uid = await getCurrentUserId();
    if (uid) {
      try {
        const BATCH_SP = 50;
        const nowSec = Math.floor(Date.now() / 1000);
        for (let i = 0; i < ordered.length; i += BATCH_SP) {
          const batch = ordered.slice(i, i + BATCH_SP);
          const res = await apiFetch('https://spclient.wg.spotify.com/collection/v2/write?market=from_token', {
            method: 'POST',
            headers: spclientHeaders(),
            body: JSON.stringify({
              username: uid,
              set: 'collection',
              items: batch.map((uri) => ({ uri, addedAt: nowSec })),
            }),
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`collection/v2/write HTTP ${res.status}: ${txt}`);
          }
          done += batch.length;
          if (onProgress) onProgress(done, ordered.length);
          if (i + BATCH_SP < ordered.length) await sleep(250);
        }
        return done;
      } catch (err) {
        console.warn('[SP-IE] collection/v2/write failed, falling back to REST v1:', err);
      }
    }

    done = 0;
    const BATCH_LIB = 40;
    for (let i = 0; i < ordered.length; i += BATCH_LIB) {
      const batch = ordered.slice(i, i + BATCH_LIB);
      let res = await v1Fetch(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, { method: 'PUT' });
      if (!res.ok) {
        const ids = batch.map((u) => u.split(':').pop());
        res = await v1Fetch('/me/tracks', {
          method: 'PUT',
          body: JSON.stringify({ ids }),
        });
      }
      if (!res.ok) {
        throw new Error(
          `Unable to save Liked Songs (HTTP ${res.status}). ` +
          `Tip: manually like 1 track on Spotify so the query hash is detected, then retry.`
        );
      }
      done += batch.length;
      if (onProgress) onProgress(done, ordered.length);
      if (i + BATCH_LIB < ordered.length) await sleep(300);
    }
    return done;
  }

  async function exportFollowedArtists(onProgress) {
    const artists = [];
    const seen = new Set();

    try {
      let offset = 0;
      const limit = 200;
      while (true) {
        const json = await pfQuery('libraryV3', {
          filters: ['Artists'],
          order: null,
          textFilter: '',
          limit,
          offset,
          flatten: true,
          expandedFolders: [],
          folderUri: null,
          includeFoldersWhenFlattening: true,
        });
        const lib = json?.data?.me?.libraryV3 || findItemsContainer(json?.data?.me);
        const items = lib?.items || [];
        for (const it of items) {
          const holder = it?.itemV2 || it?.item || it;
          const data = holder?.data || holder;
          const uri = [
            data?.uri,
            data?._uri,
            holder?.uri,
            holder?._uri,
            it?.item?._uri,
          ].find((u) => typeof u === 'string' && u.startsWith('spotify:artist:'));

          if (uri && !seen.has(uri)) {
            seen.add(uri);
            const name = data?.profile?.name || data?.name || holder?.name || uri.split(':').pop();
            artists.push({ uri, name });
          }
        }
        const total = lib?.totalCount ?? null;
        if (onProgress) onProgress(artists.length, total);
        if (items.length < limit || (total !== null && offset + items.length >= total)) break;
        offset += limit;
      }
      if (artists.length > 0) return artists;
    } catch (err) {
      console.warn('[SP-IE] libraryV3 Artists falling back to /v1/me/following:', err);
    }

    artists.length = 0;
    seen.clear();
    let after = null;
    while (true) {
      const qs = after ? `?type=artist&limit=50&after=${encodeURIComponent(after)}` : '?type=artist&limit=50';
      const res = await v1Fetch(`/me/following${qs}`);
      if (!res.ok) {
        throw new Error(`Unable to read Followed Artists (HTTP ${res.status}).`);
      }
      const j = await res.json();
      const artBlock = j?.artists;
      const items = artBlock?.items || [];
      for (const a of items) {
        const uri = a?.uri || (a?.id ? `spotify:artist:${a.id}` : null);
        if (uri && !seen.has(uri)) {
          seen.add(uri);
          artists.push({ uri, name: a?.name || uri.split(':').pop() });
        }
      }
      if (onProgress) onProgress(artists.length, artBlock?.total ?? null);
      after = artBlock?.cursors?.after || null;
      if (!artBlock?.next || !after || items.length === 0) break;
    }
    return artists;
  }

  async function importFollowedArtists(artistUris, onProgress) {
    const ordered = [...artistUris];
    let done = 0;

    try {
      const hasAddHash = await ensureHash('addToLibrary');
      if (hasAddHash) {
        const BATCH = 50;
        for (let i = 0; i < ordered.length; i += BATCH) {
          const batch = ordered.slice(i, i + BATCH);
          await pfQuery('addToLibrary', { libraryItemUris: batch });
          done += batch.length;
          if (onProgress) onProgress(done, ordered.length);
          if (i + BATCH < ordered.length) await sleep(250);
        }
        return done;
      }
    } catch (err) {
      console.warn('[SP-IE] addToLibrary (artists) failed, falling back to spclient:', err);
    }

    done = 0;
    const uid = await getCurrentUserId();
    if (uid) {
      try {
        const BATCH_SP = 50;
        const nowSec = Math.floor(Date.now() / 1000);
        for (let i = 0; i < ordered.length; i += BATCH_SP) {
          const batch = ordered.slice(i, i + BATCH_SP);
          const res = await apiFetch('https://spclient.wg.spotify.com/collection/v2/write?market=from_token', {
            method: 'POST',
            headers: spclientHeaders(),
            body: JSON.stringify({
              username: uid,
              set: 'collection',
              items: batch.map((uri) => ({ uri, addedAt: nowSec })),
            }),
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`collection/v2/write HTTP ${res.status}: ${txt}`);
          }
          done += batch.length;
          if (onProgress) onProgress(done, ordered.length);
          if (i + BATCH_SP < ordered.length) await sleep(250);
        }
        return done;
      } catch (err) {
        console.warn('[SP-IE] collection/v2/write (artists) failed, falling back to REST v1:', err);
      }
    }

    done = 0;
    const BATCH_LIB = 40;
    for (let i = 0; i < ordered.length; i += BATCH_LIB) {
      const batch = ordered.slice(i, i + BATCH_LIB);
      let res = await v1Fetch(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, { method: 'PUT' });
      if (!res.ok) {
        const ids = batch.map((u) => u.split(':').pop());
        res = await v1Fetch(`/me/following?type=artist&ids=${encodeURIComponent(ids.join(','))}`, {
          method: 'PUT',
          body: JSON.stringify({ ids }),
        });
      }
      if (!res.ok) {
        throw new Error(
          `Unable to follow Artists (HTTP ${res.status}). ` +
          `Tip: manually click "Follow" on 1 artist on Spotify and retry.`
        );
      }
      done += batch.length;
      if (onProgress) onProgress(done, ordered.length);
      if (i + BATCH_LIB < ordered.length) await sleep(300);
    }
    return done;
  }

  async function fetchUserPlaylists() {
    const list = [];
    try {
      let offset = 0;
      const limit = 200;
      while (true) {
        const json = await pfQuery('libraryV3', {
          filters: ['Playlists'],
          order: null,
          textFilter: '',
          limit,
          offset,
          flatten: true,
          expandedFolders: [],
          folderUri: null,
          includeFoldersWhenFlattening: true,
        });
        const lib = json?.data?.me?.libraryV3 || findItemsContainer(json?.data?.me);
        const items = lib?.items || [];
        for (const it of items) {
          const holder = it?.itemV2 || it?.item || it;
          const data = holder?.data || holder;
          const uri = data?.uri || holder?._uri || holder?.uri || it?.item?._uri;
          if (uri && uri.startsWith('spotify:playlist:')) {
            const id = uri.split(':').pop();
            list.push({
              id,
              uri,
              name: data?.name || id,
              description: data?.description || '',
              owner: data?.ownerV2?.data?.username || data?.ownerV2?.data?.name || '',
            });
          }
        }
        const total = lib?.totalCount ?? null;
        if (items.length < limit || (total !== null && list.length >= total)) break;
        offset += limit;
      }
      if (list.length > 0) return list;
    } catch (err) {
      console.warn('[SP-IE] libraryV3 falling back to v1:', err);
    }

    let offset = 0;
    const limit = 50;
    while (true) {
      const res = await v1Fetch(`/me/playlists?offset=${offset}&limit=${limit}`);
      if (!res.ok) throw new Error(`Error reading playlists (HTTP ${res.status})`);
      const j = await res.json();
      for (const p of j?.items || []) {
        list.push({
          id: p.id,
          uri: p.uri || `spotify:playlist:${p.id}`,
          name: p.name,
          description: p.description || '',
          owner: p.owner?.id || '',
        });
      }
      if (!j?.next || (j?.items || []).length < limit) break;
      offset += limit;
    }
    return list;
  }

  async function fetchSinglePlaylist(playlistId, onProgress) {
    const uri = `spotify:playlist:${playlistId}`;
    let name = '';
    let description = '';
    const tracks = [];

    try {
      let offset = 0;
      const limit = 100;
      let total = null;
      while (true) {
        const op = offset === 0 ? 'fetchPlaylist' : ((await ensureHash('fetchPlaylistContents')) ? 'fetchPlaylistContents' : 'fetchPlaylist');
        const vars = op === 'fetchPlaylist'
          ? { uri, offset, limit, enableWatchFeedEntrypoint: false }
          : { uri, offset, limit };
        const json = await pfQuery(op, vars);
        const pl = json?.data?.playlistV2 || json?.data?.playlist;
        if (offset === 0) {
          name = pl?.name || '';
          description = pl?.description || '';
        }
        const content = pl?.content || findItemsContainer(pl);
        const items = content?.items || [];
        total = content?.totalCount ?? total;
        for (const it of items) {
          const parsed = normalizeTrackItem(it);
          if (parsed) tracks.push(parsed);
        }
        if (onProgress) onProgress(tracks.length, total);
        if (items.length < limit || (total !== null && offset + items.length >= total)) break;
        offset += limit;
      }
      if (tracks.length > 0 || total === 0) return { id: playlistId, uri, name, description, tracks };
    } catch (err) {
      console.warn('[SP-IE] fetchPlaylist falling back to v1:', err);
    }

    tracks.length = 0;
    const metaRes = await v1Fetch(`/playlists/${playlistId}`);
    if (metaRes.ok) {
      const meta = await metaRes.json();
      name = meta?.name || name;
      description = meta?.description || description;
    }
    let offset = 0;
    const limit = 100;
    while (true) {
      let res = await v1Fetch(`/playlists/${playlistId}/items?offset=${offset}&limit=${limit}`);
      if (res.status === 404) {
        res = await v1Fetch(`/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`);
      }
      if (!res.ok) {
        throw new Error(`Unable to read playlist ${playlistId} (HTTP ${res.status}).`);
      }
      const j = await res.json();
      const items = j?.items || [];
      for (const it of items) {
        const parsed = normalizeTrackItem(it);
        if (parsed) tracks.push(parsed);
      }
      if (onProgress) onProgress(tracks.length, j?.total ?? null);
      if (!j?.next || items.length < limit) break;
      offset += limit;
    }
    return { id: playlistId, uri, name, description, tracks };
  }

  async function attachPlaylistToRootlist(uri) {
    try {
      const h = await ensureHash('addItemsToRootlist');
      if (h) {
        await pfQuery('addItemsToRootlist', { uris: [uri] });
        return true;
      }
    } catch (e) {
      console.warn('[SP-IE] addItemsToRootlist fallback:', e);
    }

    const uid = await getCurrentUserId();
    if (uid) {
      try {
        const res = await apiFetch(`https://spclient.wg.spotify.com/playlist/v2/user/${encodeURIComponent(uid)}/rootlist/changes?format=json`, {
          method: 'POST',
          headers: spclientHeaders(),
          body: JSON.stringify({
            deltas: [{
              ops: [{
                kind: 'ADD',
                add: {
                  items: [{ uri, attributes: { formatAttributes: [], availableSignals: [] } }],
                  addFirst: true,
                },
              }],
              info: { source: { client: 'WEBPLAYER' } },
            }],
          }),
        });
        if (res.ok) return true;
      } catch { }
    }
    return false;
  }

  async function createPlaylistRemote(name, description = '', isPublic = false) {
    const cleanName = String(name || 'Imported Playlist').slice(0, 100);
    const cleanDesc = String(description || '').slice(0, 300);

    const payloads = [
      {
        ops: [{
          kind: 'UPDATE_LIST_ATTRIBUTES',
          updateListAttributes: {
            newAttributes: { values: { name: cleanName, description: cleanDesc } },
          },
        }],
      },
      {
        ops: [{
          kind: 'UPDATE_LIST_ATTRIBUTES',
          updateListAttributes: {
            newAttributes: { name: cleanName, description: cleanDesc },
          },
        }],
      },
      {
        deltas: [{
          ops: [{
            kind: 'UPDATE_LIST_ATTRIBUTES',
            updateListAttributes: {
              newAttributes: { values: { name: cleanName, description: cleanDesc } },
            },
          }],
          info: { source: { client: 'WEBPLAYER' } },
        }],
      },
    ];

    let lastErr = '';
    for (const bodyObj of payloads) {
      try {
        const res = await apiFetch('https://spclient.wg.spotify.com/playlist/v2/playlist?format=json', {
          method: 'POST',
          headers: spclientHeaders(),
          body: JSON.stringify(bodyObj),
        });
        if (res.ok) {
          const j = await res.json();
          const uri = j?.uri || j?.playlistUri || (j?.id ? `spotify:playlist:${j.id}` : null);
          const id = j?.id || (uri ? uri.split(':').pop() : null);
          if (id) {
            const finalUri = uri || `spotify:playlist:${id}`;
            await attachPlaylistToRootlist(finalUri);
            return { id, uri: finalUri, name: cleanName };
          }
        } else {
          lastErr = `spclient HTTP ${res.status}: ${await res.text().catch(() => '')}`;
        }
      } catch (e) {
        lastErr = e.message;
      }
    }

    let res = await v1Fetch('/me/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: cleanName, description: cleanDesc, public: !!isPublic }),
    });
    if (!res.ok) {
      const uid = await getCurrentUserId();
      if (uid) {
        res = await v1Fetch(`/users/${encodeURIComponent(uid)}/playlists`, {
          method: 'POST',
          body: JSON.stringify({ name: cleanName, description: cleanDesc, public: !!isPublic }),
        });
      }
    }
    if (!res.ok) {
      throw new Error(`Unable to create playlist "${cleanName}" (v1 HTTP ${res.status}; ${lastErr})`);
    }
    const j = await res.json();
    return { id: j.id, uri: j.uri || `spotify:playlist:${j.id}`, name: j.name || cleanName };
  }

  async function addTracksToPlaylistRemote(playlistId, trackUris, onProgress) {
    const BATCH = 100;
    let done = 0;

    for (let i = 0; i < trackUris.length; i += BATCH) {
      const batch = trackUris.slice(i, i + BATCH);
      let ok = false;
      let spErr = '';

      try {
        const res = await apiFetch(`https://spclient.wg.spotify.com/playlist/v2/playlist/${encodeURIComponent(playlistId)}/changes?format=json`, {
          method: 'POST',
          headers: spclientHeaders(),
          body: JSON.stringify({
            deltas: [{
              ops: [{
                kind: 'ADD',
                add: {
                  items: batch.map((uri) => ({
                    uri,
                    attributes: { formatAttributes: [], availableSignals: [] },
                  })),
                  addLast: true,
                },
              }],
              info: { source: { client: 'WEBPLAYER' } },
            }],
            wantResultingRevisions: false,
            wantSyncResult: false,
            nonces: [],
          }),
        });
        if (res.ok) {
          ok = true;
        } else {
          spErr = `spclient HTTP ${res.status}: ${await res.text().catch(() => '')}`;
        }
      } catch (e) {
        spErr = e.message;
      }

      if (!ok) {
        let res = await v1Fetch(`/playlists/${playlistId}/items`, {
          method: 'POST',
          body: JSON.stringify({ uris: batch }),
        });
        if (res.status === 404) {
          res = await v1Fetch(`/playlists/${playlistId}/tracks`, {
            method: 'POST',
            body: JSON.stringify({ uris: batch }),
          });
        }
        if (!res.ok) {
          throw new Error(`Error adding tracks to playlist ${playlistId} (v1 HTTP ${res.status}; ${spErr})`);
        }
      }

      done += batch.length;
      if (onProgress) onProgress(done, trackUris.length);
      if (i + BATCH < trackUris.length) await sleep(250);
    }
    return done;
  }

  // =========================================================================
  // 5. UNIFIED PARSER & DOWNLOAD HELPER
  // =========================================================================
  function extractTrackUriFromToken(str) {
    const s = String(str || '').trim();
    if (!s) return null;
    if (/^spotify:track:[A-Za-z0-9]{15,30}$/.test(s)) return s;
    const urlMatch = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{15,30})/);
    if (urlMatch) return `spotify:track:${urlMatch[1]}`;
    if (/^[A-Za-z0-9]{22}$/.test(s)) return `spotify:track:${s}`;
    return null;
  }

  function extractArtistUriFromToken(str) {
    const s = String(str || '').trim();
    if (!s) return null;
    if (/^spotify:artist:[A-Za-z0-9]{15,30}$/.test(s)) return s;
    const urlMatch = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{15,30})/);
    if (urlMatch) return `spotify:artist:${urlMatch[1]}`;
    if (/^[A-Za-z0-9]{22}$/.test(s)) return `spotify:artist:${s}`;
    return null;
  }

  function dedupeUris(arr) {
    const seen = new Set();
    const out = [];
    for (const u of arr) {
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    }
    return out;
  }

  function toTrackUriList(arr) {
    if (!Array.isArray(arr)) return [];
    return dedupeUris(
      arr.map((t) => (typeof t === 'string'
        ? extractTrackUriFromToken(t)
        : extractTrackUriFromToken(t?.uri || t?.track?.uri || t?.id))).filter(Boolean)
    );
  }

  function toArtistUriList(arr) {
    if (!Array.isArray(arr)) return [];
    return dedupeUris(
      arr.map((a) => (typeof a === 'string'
        ? extractArtistUriFromToken(a)
        : extractArtistUriFromToken(a?.uri || a?.id))).filter(Boolean)
    );
  }

  function parseImportItems(rawText, sourceFilename = '') {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) throw new Error('Empty file.');

    const items = [];

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed?.liked)) {
        const likedUris = toTrackUriList(parsed.liked);
        if (likedUris.length > 0) {
          items.push({ kind: 'liked', name: 'Liked Songs', description: '', uris: likedUris, file: sourceFilename });
        }
      }

      if (Array.isArray(parsed?.artists)) {
        const artistUris = toArtistUriList(parsed.artists);
        if (artistUris.length > 0) {
          items.push({ kind: 'artists', name: 'Followed Artists', description: '', uris: artistUris, file: sourceFilename });
        }
      }

      if (Array.isArray(parsed?.playlists)) {
        for (const pl of parsed.playlists) {
          const uris = toTrackUriList(pl.tracks || pl.uris || []);
          if (uris.length > 0) {
            items.push({
              kind: 'playlist',
              name: pl.name || 'Imported Playlist',
              description: pl.description || '',
              uris,
              file: sourceFilename,
            });
          }
        }
      }

      if (items.length === 0 && (parsed?.type === 'playlist' || (parsed?.name && Array.isArray(parsed?.tracks)))) {
        const uris = toTrackUriList(parsed.tracks);
        if (uris.length > 0) {
          items.push({
            kind: 'playlist',
            name: parsed.name || 'Imported Playlist',
            description: parsed.description || '',
            uris,
            file: sourceFilename,
          });
        }
      }

      if (items.length === 0) {
        const arr = Array.isArray(parsed) ? parsed : (parsed?.tracks || parsed?.items || []);
        const looksArtists = parsed?.type === 'artists' || /artist/i.test(sourceFilename);
        if (looksArtists) {
          const artistUris = toArtistUriList(arr);
          if (artistUris.length > 0) {
            items.push({ kind: 'artists', name: 'Followed Artists', description: '', uris: artistUris, file: sourceFilename });
          }
        } else {
          const uris = toTrackUriList(arr);
          if (uris.length > 0) {
            const looksLiked = parsed?.type === 'liked' || /liked/i.test(sourceFilename);
            items.push({
              kind: looksLiked ? 'liked' : 'playlist',
              name: looksLiked ? 'Liked Songs' : (sourceFilename.replace(/\.(json|txt)$/i, '') || 'Imported Playlist'),
              description: '',
              uris,
              file: sourceFilename,
            });
          }
        }
      }

      if (items.length === 0) throw new Error('No valid tracks or artists found in JSON.');
      return items;
    }

    throw new Error('Invalid format: please select exported .json files.');
  }

  function downloadJsonFile(obj, filename) {
    const jsonText = JSON.stringify(obj, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    getUiParent().appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFilePart(str) {
    return String(str || 'playlist').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'playlist';
  }

  // =========================================================================
  // 6. UNIFIED UI (ZERO innerHTML)
  // =========================================================================
  let statusDotEl = null;
  let toastEl = null;
  let toastTimer = null;
  let isCollapsed = false;

  const STYLES = {
    bar: {
      position: 'fixed',
      top: '10px',
      left: '10px',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 9px',
      backgroundColor: 'rgba(18, 18, 18, 0.96)',
      border: '1px solid rgba(29, 185, 84, 0.75)',
      borderRadius: '999px',
      boxShadow: '0 6px 22px rgba(0, 0, 0, 0.65)',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      pointerEvents: 'auto',
    },
    btn: {
      appearance: 'none',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      backgroundColor: '#242424',
      color: '#ffffff',
      fontSize: '12px',
      fontWeight: '700',
      lineHeight: '1.2',
      padding: '6px 12px',
      borderRadius: '999px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    },
    toggle: {
      appearance: 'none',
      border: 'none',
      backgroundColor: 'transparent',
      color: '#b3b3b3',
      fontSize: '14px',
      fontWeight: '700',
      cursor: 'pointer',
      padding: '2px 6px',
      borderRadius: '999px',
    },
    backdrop: {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      zIndex: '2147483647',
      backgroundColor: 'rgba(0, 0, 0, 0.76)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    modal: {
      backgroundColor: '#181818',
      color: '#ffffff',
      border: '1px solid #333333',
      borderRadius: '14px',
      width: '100%',
      maxWidth: '520px',
      maxHeight: '86vh',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '18px',
      boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7)',
      boxSizing: 'border-box',
    },
    listBox: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      maxHeight: '340px',
      overflowY: 'auto',
      padding: '6px',
      backgroundColor: '#111111',
      border: '1px solid #2c2c2e',
      borderRadius: '10px',
    },
    checkRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 10px',
      borderRadius: '8px',
      backgroundColor: '#1f1f22',
      cursor: 'pointer',
      fontSize: '13.5px',
      color: '#ffffff',
      userSelect: 'none',
    },
    fileRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      padding: '8px 10px',
      borderRadius: '8px',
      backgroundColor: '#1f1f22',
      fontSize: '13.5px',
      color: '#ffffff',
    },
    removeBtn: {
      appearance: 'none',
      border: '1px solid rgba(248, 113, 113, 0.45)',
      backgroundColor: 'rgba(185, 28, 28, 0.25)',
      color: '#fca5a5',
      borderRadius: '6px',
      padding: '3px 8px',
      fontSize: '12px',
      fontWeight: '700',
      cursor: 'pointer',
      flexShrink: '0',
    },
    primary: {
      backgroundColor: '#1db954',
      color: '#000000',
      border: 'none',
      borderRadius: '999px',
      padding: '9px 18px',
      fontSize: '13px',
      fontWeight: '700',
      cursor: 'pointer',
    },
    secondary: {
      backgroundColor: '#2a2a2a',
      color: '#ffffff',
      border: '1px solid #444444',
      borderRadius: '999px',
      padding: '8px 14px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
    },
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'style' && typeof v === 'object') {
        Object.assign(node.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v !== undefined && v !== null) {
        node.setAttribute(k, v);
      }
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function makeActionButton(label, title, onClick) {
    const b = el('button', { type: 'button', title, style: STYLES.btn, onClick }, [label]);
    b.addEventListener('mouseenter', () => {
      b.style.backgroundColor = '#1db954';
      b.style.color = '#000000';
      b.style.borderColor = '#1db954';
    });
    b.addEventListener('mouseleave', () => {
      b.style.backgroundColor = '#242424';
      b.style.color = '#ffffff';
      b.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
    return b;
  }

  function getUiParent() {
    return document.body || document.documentElement;
  }

  function showToast(msg, isError = false, duration = 4500) {
    const parent = getUiParent();
    if (!parent) return;
    if (!toastEl || !toastEl.isConnected) {
      toastEl = el('div', { id: 'sp-ie-toast' });
      parent.appendChild(toastEl);
    }
    Object.assign(toastEl.style, {
      position: 'fixed',
      top: '56px',
      left: '10px',
      zIndex: '2147483647',
      backgroundColor: isError ? '#b91c1c' : '#18181b',
      color: '#ffffff',
      border: `1px solid ${isError ? '#f87171' : '#1db954'}`,
      borderRadius: '10px',
      padding: '9px 14px',
      fontSize: '13px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: '600',
      boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      maxWidth: '420px',
      pointerEvents: 'none',
      opacity: '1',
    });
    toastEl.textContent = msg;
    clearTimeout(toastTimer);
    if (duration > 0) {
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.style.opacity = '0';
      }, duration);
    }
  }

  function updateStatusBadge() {
    if (!statusDotEl) return;
    const hasBearer = !!auth.bearer;
    const hasClient = !!auth.clientToken;
    statusDotEl.style.backgroundColor = (hasBearer && hasClient) ? '#1db954' : (hasBearer ? '#84cc16' : '#f59e0b');
    statusDotEl.title = `Bearer: ${hasBearer ? 'OK' : 'NO'} | Client-Token: ${hasClient ? 'OK' : 'NO'} (click for diagnostics)`;
  }

  function closeModal() {
    const m = document.getElementById('sp-ie-modal-backdrop');
    if (m) m.remove();
  }

  function showStatusHelpModal() {
    closeModal();
    injectMainWorldBridge();
    requestBridgeScan(false);
    const diagText =
      `Bearer: ${auth.bearer ? 'OK' : 'NO'} | Client-Token: ${auth.clientToken ? 'OK' : 'NO'}\n` +
      `Page bridge (blob): ${diag.bridgeActive ? 'OK' : 'WAITING'} | ` +
      `Spotify requests seen: ${diag.sawAnySpotifyReq ? 'YES' : 'NO'}`;

    const info = el('pre', {
      style: {
        fontSize: '12px',
        lineHeight: '1.45',
        color: '#d4d4d8',
        backgroundColor: '#101010',
        padding: '10px',
        borderRadius: '8px',
        whiteSpace: 'pre-wrap',
        margin: '0',
        fontFamily: 'ui-monospace, monospace',
      },
    }, [diagText]);

    const tokenInput = el('input', {
      type: 'text',
      placeholder: 'Optional: paste Bearer token manually',
      style: {
        width: '100%',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid #3f3f46',
        backgroundColor: '#101010',
        color: '#ffffff',
        fontSize: '12px',
        boxSizing: 'border-box',
      },
    });
    const backdrop = el('div', {
      id: 'sp-ie-modal-backdrop',
      style: STYLES.backdrop,
      onClick: (e) => { if (e.target === backdrop) closeModal(); },
    }, [
      el('div', { id: 'sp-ie-modal', style: STYLES.modal }, [
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
          el('strong', { style: { fontSize: '15px', color: '#ffffff' } }, ['Session Diagnostics']),
          el('button', { type: 'button', style: { ...STYLES.secondary, padding: '4px 10px' }, onClick: closeModal }, ['✕']),
        ]),
        info,
        tokenInput,
        el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } }, [
          el('button', {
            type: 'button',
            style: STYLES.secondary,
            onClick: () => {
              requestBridgeScan(false);
              setTimeout(() => {
                closeModal();
                showStatusHelpModal();
              }, 200);
            },
          }, ['🔄 Retry scan']),
          el('button', {
            type: 'button',
            style: STYLES.primary,
            onClick: () => {
              const v = tokenInput.value.trim().replace(/^Bearer\s+/i, '');
              if (v.length > 30) {
                auth.bearer = v;
                updateStatusBadge();
                closeModal();
                showToast('✅ Token saved!');
              } else {
                showToast('Invalid token.', true);
              }
            },
          }, ['Save token']),
        ]),
      ]),
    ]);
    getUiParent().appendChild(backdrop);
  }

  function createCheckRow(labelText, checked = true, onChange = null) {
    const cb = el('input', {
      type: 'checkbox',
      style: { width: '16px', height: '16px', accentColor: '#1db954', cursor: 'pointer', flexShrink: '0' },
    });
    cb.checked = checked;
    if (onChange) cb.addEventListener('change', onChange);

    const row = el('label', { style: STYLES.checkRow }, [
      cb,
      el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [labelText]),
    ]);
    return { row, cb };
  }

  // =========================================================================
  // 7. EXPORT MODAL (Checkboxes + Separate JSON files)
  // =========================================================================
  async function openExportModal() {
    if (!(await ensureAuth())) {
      showToast('Token not ready yet: click the status dot or browse to Home/Library.', true, 6000);
      return;
    }
    closeModal();

    const entries = [];
    const selectAllCb = el('input', {
      type: 'checkbox',
      style: { width: '16px', height: '16px', accentColor: '#1db954', cursor: 'pointer' },
    });
    selectAllCb.checked = true;

    const countLabel = el('span', { style: { fontSize: '12.5px', color: '#a1a1aa' } }, ['2 selected']);
    const downloadBtn = el('button', { type: 'button', style: STYLES.primary }, ['💾 Download selected']);

    function refreshSelectionState() {
      const total = entries.length;
      const checkedCount = entries.filter((e) => e.cb.checked).length;
      selectAllCb.checked = total > 0 && checkedCount === total;
      selectAllCb.indeterminate = checkedCount > 0 && checkedCount < total;
      countLabel.textContent = `${checkedCount} of ${total} selected`;
      downloadBtn.disabled = checkedCount === 0;
      downloadBtn.style.opacity = checkedCount === 0 ? '0.5' : '1';
    }

    selectAllCb.addEventListener('change', () => {
      const val = selectAllCb.checked;
      entries.forEach((e) => { e.cb.checked = val; });
      refreshSelectionState();
    });

    const listBox = el('div', { style: STYLES.listBox });

    const likedRow = createCheckRow('❤️ Liked Songs', true, refreshSelectionState);
    likedRow.row.style.border = '1px solid rgba(29, 185, 84, 0.35)';
    entries.push({ kind: 'liked', id: 'liked', name: 'Liked Songs', cb: likedRow.cb });
    listBox.appendChild(likedRow.row);

    const artistsRow = createCheckRow('👤 Followed Artists', true, refreshSelectionState);
    artistsRow.row.style.border = '1px solid rgba(29, 185, 84, 0.35)';
    entries.push({ kind: 'artists', id: 'artists', name: 'Followed Artists', cb: artistsRow.cb });
    listBox.appendChild(artistsRow.row);

    const loadingHint = el('div', { style: { fontSize: '12.5px', color: '#a1a1aa', padding: '6px 4px' } }, [
      '⏳ Loading playlists...',
    ]);
    listBox.appendChild(loadingHint);

    downloadBtn.addEventListener('click', async () => {
      const selected = entries.filter((e) => e.cb.checked);
      if (selected.length === 0) return;

      closeModal();

      const dateStr = new Date().toISOString().slice(0, 10);
      const likedSelected = selected.some((s) => s.kind === 'liked');
      const artistsSelected = selected.some((s) => s.kind === 'artists');
      const playlistsSelected = selected.filter((s) => s.kind === 'playlist');

      try {
        let totalItems = 0;

        if (likedSelected) {
          showToast('⏳ Exporting Liked Songs...', false, 0);
          const likedTracks = await exportLikedSongs((done, total) => {
            showToast(`⏳ Liked Songs: ${done}${total ? '/' + total : ''}...`, false, 0);
          });
          totalItems += likedTracks.length;
          downloadJsonFile({
            app: 'spotify-web-ie',
            version: 2,
            type: 'liked',
            exportedAt: new Date().toISOString(),
            liked: likedTracks,
          }, `liked-songs-${dateStr}.json`);
          if (artistsSelected || playlistsSelected.length > 0) await sleep(300);
        }

        if (artistsSelected) {
          showToast('⏳ Exporting Followed Artists...', false, 0);
          const artists = await exportFollowedArtists((done, total) => {
            showToast(`⏳ Followed Artists: ${done}${total ? '/' + total : ''}...`, false, 0);
          });
          totalItems += artists.length;
          downloadJsonFile({
            app: 'spotify-web-ie',
            version: 2,
            type: 'artists',
            exportedAt: new Date().toISOString(),
            artists,
          }, `followed-artists-${dateStr}.json`);
          if (playlistsSelected.length > 0) await sleep(300);
        }

        for (let i = 0; i < playlistsSelected.length; i++) {
          const p = playlistsSelected[i];
          showToast(`⏳ (${i + 1}/${playlistsSelected.length}) Reading "${p.name}"...`, false, 0);
          const full = await fetchSinglePlaylist(p.id, (d, t) => {
            showToast(`⏳ "${p.name}" (${i + 1}/${playlistsSelected.length}): ${d}${t ? '/' + t : ''} tracks...`, false, 0);
          });
          const plObj = {
            name: full.name || p.name,
            description: full.description || '',
            tracks: full.tracks,
          };
          totalItems += plObj.tracks.length;
          downloadJsonFile({
            app: 'spotify-web-ie',
            version: 2,
            type: 'playlist',
            exportedAt: new Date().toISOString(),
            playlists: [plObj],
          }, `playlist-${safeFilePart(plObj.name)}-${dateStr}.json`);
          if (i + 1 < playlistsSelected.length) await sleep(300);
        }

        showToast(`✅ Download complete! (${totalItems} items exported)`, false, 5000);
      } catch (err) {
        console.error('[SP-IE] Export error:', err);
        showToast(`❌ ${err.message}`, true, 7000);
      }
    });

    const backdrop = el('div', {
      id: 'sp-ie-modal-backdrop',
      style: STYLES.backdrop,
      onClick: (e) => { if (e.target === backdrop) closeModal(); },
    }, [
      el('div', { id: 'sp-ie-modal', style: STYLES.modal }, [
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
          el('strong', { style: { fontSize: '16px', color: '#ffffff' } }, ['⬇ Export Spotify Library']),
          el('button', { type: 'button', style: { ...STYLES.secondary, padding: '4px 10px' }, onClick: closeModal }, ['✕']),
        ]),
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' } }, [
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' } }, [
            selectAllCb,
            el('span', {}, ['Select all']),
          ]),
          countLabel,
        ]),
        listBox,
        el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } }, [
          el('button', { type: 'button', style: STYLES.secondary, onClick: closeModal }, ['Cancel']),
          downloadBtn,
        ]),
      ]),
    ]);

    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    getUiParent().appendChild(backdrop);
    refreshSelectionState();

    try {
      const currentPlMatch = location.pathname.match(/^\/playlist\/([a-zA-Z0-9]+)/);
      const currentPlId = currentPlMatch ? currentPlMatch[1] : null;

      const playlists = await fetchUserPlaylists();
      loadingHint.remove();

      if (currentPlId && !playlists.some((p) => p.id === currentPlId)) {
        playlists.unshift({ id: currentPlId, name: `Open playlist (${currentPlId})` });
      }

      if (playlists.length === 0) {
        listBox.appendChild(el('div', { style: { fontSize: '12.5px', color: '#a1a1aa', padding: '6px' } }, [
          'No playlists found in your library.',
        ]));
      } else {
        for (const p of playlists) {
          const label = (p.id === currentPlId) ? `🎵 ${p.name} (open)` : `🎵 ${p.name}`;
          const r = createCheckRow(label, true, refreshSelectionState);
          entries.push({ kind: 'playlist', id: p.id, name: p.name, cb: r.cb });
          listBox.appendChild(r.row);
        }
      }
      refreshSelectionState();
    } catch (err) {
      loadingHint.textContent = `⚠ Unable to load playlists: ${err.message}`;
      loadingHint.style.color = '#f87171';
    }
  }

  // =========================================================================
  // 8. IMPORT MODAL (.json files only, remove items with X)
  // =========================================================================
  function openImportModal() {
    closeModal();

    let loadedEntries = [];
    let nextUid = 1;

    const listBox = el('div', { style: STYLES.listBox });
    const dropHint = el('div', {
      style: {
        padding: '28px 16px',
        textAlign: 'center',
        color: '#a1a1aa',
        fontSize: '13px',
        border: '1px dashed #3f3f46',
        borderRadius: '8px',
        lineHeight: '1.5',
      },
    }, ['Click "📂 Choose files (.json)" or drag & drop your exported files here.']);

    const countInfo = el('span', { style: { fontSize: '12.5px', color: '#a1a1aa' } }, ['No files loaded']);
    const importBtn = el('button', { type: 'button', style: { ...STYLES.primary, opacity: '0.5' }, disabled: 'disabled' }, [
      '▶ Import',
    ]);

    function renderEntries() {
      listBox.textContent = '';
      if (loadedEntries.length === 0) {
        listBox.appendChild(dropHint);
        countInfo.textContent = 'No files loaded';
        importBtn.disabled = true;
        importBtn.style.opacity = '0.5';
        importBtn.textContent = '▶ Import';
        return;
      }

      const totalItems = loadedEntries.reduce((s, e) => s + e.uris.length, 0);
      countInfo.textContent = `${loadedEntries.length} file(s) (${totalItems} items)`;
      importBtn.disabled = false;
      importBtn.style.opacity = '1';
      importBtn.textContent = `▶ Import (${loadedEntries.length})`;

      for (const entry of loadedEntries) {
        const icon = entry.kind === 'liked' ? '❤️' : (entry.kind === 'artists' ? '👤' : '🎵');
        const unit = entry.kind === 'artists' ? 'artists' : 'tracks';
        const sub = entry.file ? ` · ${entry.file}` : '';

        const removeBtn = el('button', {
          type: 'button',
          title: 'Remove this item',
          style: STYLES.removeBtn,
          onClick: () => {
            loadedEntries = loadedEntries.filter((x) => x.uid !== entry.uid);
            renderEntries();
          },
        }, ['✕']);

        const row = el('div', { style: STYLES.fileRow }, [
          el('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [
            `${icon} ${entry.name} (${entry.uris.length} ${unit})${sub}`,
          ]),
          removeBtn,
        ]);
        listBox.appendChild(row);
      }
    }

    async function handleFiles(fileList) {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      let added = 0;
      for (const f of files) {
        try {
          const txt = await f.text();
          const parsed = parseImportItems(txt, f.name);
          for (const item of parsed) {
            loadedEntries.push({ ...item, uid: nextUid++ });
            added++;
          }
        } catch (err) {
          showToast(`Error in file "${f.name}": ${err.message}`, true);
        }
      }
      renderEntries();
      if (added > 0) showToast(`✔ Added ${added} item(s) to the import queue.`);
    }

    const fileInput = el('input', {
      type: 'file',
      multiple: 'multiple',
      accept: '.json',
      style: { display: 'none' },
      onChange: async (e) => {
        await handleFiles(e.target.files);
        fileInput.value = '';
      },
    });

    importBtn.addEventListener('click', async () => {
      if (loadedEntries.length === 0) return;

      if (!(await ensureAuth())) {
        showToast('Token not captured yet: click the status dot or browse to Home/Library.', true, 6000);
        return;
      }

      const toImport = [...loadedEntries];
      closeModal();

      try {
        const likedEntries = toImport.filter((s) => s.kind === 'liked');
        if (likedEntries.length > 0) {
          const allLikedUris = dedupeUris(likedEntries.flatMap((l) => l.uris));
          showToast(`⏳ Importing Liked Songs: 0/${allLikedUris.length}...`, false, 0);
          const done = await importLikedSongs(allLikedUris, (d, tot) => {
            showToast(`⏳ Liked Songs: ${d}/${tot}...`, false, 0);
          });
          showToast(`✅ Imported ${done} Liked Songs!`, false, 3500);
        }

        const artistEntries = toImport.filter((s) => s.kind === 'artists');
        if (artistEntries.length > 0) {
          const allArtistUris = dedupeUris(artistEntries.flatMap((a) => a.uris));
          showToast(`⏳ Importing Followed Artists: 0/${allArtistUris.length}...`, false, 0);
          const done = await importFollowedArtists(allArtistUris, (d, tot) => {
            showToast(`⏳ Followed Artists: ${d}/${tot}...`, false, 0);
          });
          showToast(`✅ Followed ${done} artists!`, false, 3500);
        }

        const plEntries = toImport.filter((s) => s.kind === 'playlist');
        for (let i = 0; i < plEntries.length; i++) {
          const pl = plEntries[i];
          const plName = (pl.name || '').trim() || 'Imported Playlist';
          showToast(`⏳ (${i + 1}/${plEntries.length}) Creating "${plName}"...`, false, 0);
          const created = await createPlaylistRemote(plName, pl.description || '');
          await addTracksToPlaylistRemote(created.id, pl.uris, (d, tot) => {
            showToast(`⏳ "${plName}" (${i + 1}/${plEntries.length}): ${d}/${tot} tracks...`, false, 0);
          });
        }

        showToast('✅ Import complete! Reload if the sidebar does not update immediately.', false, 6000);
      } catch (err) {
        console.error('[SP-IE] Import error:', err);
        showToast(`❌ ${err.message}`, true, 8000);
      }
    });

    const modalEl = el('div', { id: 'sp-ie-modal', style: STYLES.modal }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
        el('strong', { style: { fontSize: '16px', color: '#ffffff' } }, ['⬆ Import Spotify Library']),
        el('button', { type: 'button', style: { ...STYLES.secondary, padding: '4px 10px' }, onClick: closeModal }, ['✕']),
      ]),
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
        el('button', { type: 'button', style: STYLES.secondary, onClick: () => fileInput.click() }, ['📂 Choose files (.json)']),
        countInfo,
      ]),
      fileInput,
      listBox,
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } }, [
        el('button', { type: 'button', style: STYLES.secondary, onClick: closeModal }, ['Cancel']),
        importBtn,
      ]),
    ]);

    const backdrop = el('div', {
      id: 'sp-ie-modal-backdrop',
      style: STYLES.backdrop,
      onClick: (e) => { if (e.target === backdrop) closeModal(); },
    }, [modalEl]);

    modalEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      listBox.style.borderColor = '#1db954';
    });
    modalEl.addEventListener('dragleave', () => {
      listBox.style.borderColor = '#2c2c2e';
    });
    modalEl.addEventListener('drop', (e) => {
      e.preventDefault();
      listBox.style.borderColor = '#2c2c2e';
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    getUiParent().appendChild(backdrop);
    renderEntries();
  }

  // =========================================================================
  // 9. TOP-LEFT TOOLBAR (2 BUTTONS: EXPORT & IMPORT)
  // =========================================================================
  function mountTopLeftBar() {
    const parent = getUiParent();
    if (!parent || document.getElementById('sp-ie-bar')) return;

    statusDotEl = el('span', {
      style: {
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        display: 'inline-block',
        flexShrink: '0',
        backgroundColor: '#f59e0b',
        cursor: 'pointer',
      },
      onClick: showStatusHelpModal,
    });
    updateStatusBadge();

    const btnExport = makeActionButton('⬇ Export', 'Export Liked Songs, Followed Artists, and Playlists', openExportModal);
    const btnImport = makeActionButton('⬆ Import', 'Import Liked Songs, Followed Artists, and Playlists', openImportModal);

    const actionButtons = [btnExport, btnImport];

    const toggleBtn = el('button', {
      type: 'button',
      title: 'Collapse/Expand bar',
      style: STYLES.toggle,
      onClick: () => {
        isCollapsed = !isCollapsed;
        actionButtons.forEach((b) => { b.style.display = isCollapsed ? 'none' : 'inline-block'; });
        toggleBtn.textContent = isCollapsed ? '⇄' : '−';
      },
    }, ['−']);

    const barEl = el('div', { id: 'sp-ie-bar', style: STYLES.bar }, [
      statusDotEl,
      ...actionButtons,
      toggleBtn,
    ]);

    parent.appendChild(barEl);
  }

  function initUI() {
    injectMainWorldBridge();
    checkSessionTag();
    mountTopLeftBar();
    requestBridgeScan(false);
    try {
      const obs = new MutationObserver(() => {
        if (!document.getElementById('sp-ie-bar')) mountTopLeftBar();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch { }
    setInterval(() => {
      injectMainWorldBridge();
      checkSessionTag();
      if (!auth.bearer || !auth.clientToken) requestBridgeScan(false);
      if (!document.getElementById('sp-ie-bar')) mountTopLeftBar();
    }, 1500);
  }

  injectMainWorldBridge();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
