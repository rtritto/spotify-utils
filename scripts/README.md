# Spotify Utils — Import / Export for Spotify Web

A userscript for **Violentmonkey** and **Tampermonkey** that lets you **export** and **import** your library directly from **Spotify Web (`open.spotify.com`)**, even on a **Free** account — no Spotify Premium or Developer API keys required.

---

## Features

- **Compact top-left toolbar** with 2 buttons (`⬇ Export` and `⬆ Import`), a status/diagnostics dot, and a `−` button to collapse the bar.
- **Export (`⬇ Export`)**:
  - ❤️ **Liked Songs** (`liked-songs-YYYY-MM-DD.json`)
  - 👤 **Followed Artists** (`followed-artists-YYYY-MM-DD.json`)
  - 🎵 **Playlists** (`playlist-<name>-YYYY-MM-DD.json`)
  - Checkbox selection (with `Select all`) and automatic separate `.json` downloads.
- **Import (`⬆ Import`)**:
  - Multi-file `.json` upload (via file picker or drag & drop).
  - Remove individual items from the queue using the `✕` button.
  - Automatically creates playlists and adds tracks, restores Liked Songs (preserving track order), and follows artists.
- **Automatic token capture**:
  - Captures the session token automatically via a page-context bridge (`blob:` + `wrappedJSObject` + Webpack module scan fallback).
  - No manual token entry required.
- **Auto-updates** linked directly to this GitHub repository.

---

# Installation
## 1. Install a userscript manager

Install one of the following browser extensions:

- **Violentmonkey** (recommended for Chrome, Edge, Brave, Firefox)

- **Tampermonkey** (Chrome, Edge, Brave, Firefox)

2. Install the script with auto-updates

> Because the script uses a `.js` extension (instead of `.user.js`), install it from URL or paste it manually into a new script.

Direct raw script URL:
[spotify-web-free-import-export.js](https://raw.githubusercontent.com/rtritto/spotify-utils/main/scripts/spotify-web-free-import-export.js)

- **Violentmonkey**:
1. Open the Violentmonkey **Dashboard**.
1. Click `+` → **Install from URL.**
1. Paste the raw URL above and confirm installation.
- **Tampermonkey**:
1. Open the Tampermonkey **Dashboard** → **Utilities** tab.
1. Under **Import from URL**, paste the raw URL above and click **Install**.

(__Alternatively, create a new script in your extension's dashboard and paste the contents of `scripts/spotify-web-free-import-export.js` — the `@updateURL` and `@downloadURL` headers will still handle future updates.__)

---

# Browser Setup (if the bar or token doesn't appear)
## Violentmonkey
- The script uses `@inject-into` content to bypass `open.spotify.com`'s strict CSP.
- In the script's **Settings** tab in Violentmonkey, make sure Injection mode is set to `Default` or `content` (not forced to `page`).

## Tampermonkey on Chrome / Edge / Brave (Manifest V3)
1. Go to `chrome://extensions` (or `edge://extensions`) → **Details** under Tampermonkey → enable "Allow User Scripts".
1. (__Recommended__) In Tampermonkey **Dashboard** → **Settings** → **Config mode: Advanced** → **Content Script API**, select `UserScripts API Dynamic`.

---

# Usage
1. Open `https://open.spotify.com` and log in.
1. The toolbar will appear in the top-left corner with a status dot:
  - 🟢 **Green**: `Bearer` and `Client-Token` captured, ready to use.
  - 🟡 **Yellow/Lime**: waiting to complete capture (navigate to __Home__ or __Your Library__, or click the dot itself to open diagnostics and click `🔄 Retry scan`).
1. Click `⬇ Export`, check the items you want to back up, and click `💾 Download selected`.
1. To import into another account (or restore a backup), click `⬆ Import`, select or drag & drop your `.json` files, remove any unwanted entries with `✕`, and click `▶ Import`.

---

# Updates
Violentmonkey/Tampermonkey will automatically detect and pull the update on the next check (or when clicking __Check for updates__ in the extension dashboard).

---

# Privacy & Security

Everything runs **100% locally** in your browser on the `open.spotify.com` tab. No tokens, tracks, or account data are ever sent to third-party servers.
