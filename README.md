# SGTM Preview Cookie

A Chrome extension that captures `x-gtm-server-preview` tokens from Google Tag Manager debug pages and sets them as cookies on your target domain — so you can preview server-side GTM changes without manually copying tokens.

---

## Table of Contents

- [Installation](#installation)
- [How it works](#how-it-works)
- [Tutorial](#tutorial)
  - [1. Open the side panel](#1-open-the-side-panel)
  - [2. Navigate to your GTM debug page](#2-navigate-to-your-gtm-debug-page)
  - [3. Scrape the preview token](#3-scrape-the-preview-token)
  - [4. Set the cookie](#4-set-the-cookie)
  - [5. Verify on your site](#5-verify-on-your-site)
- [Enable / Disable toggle](#enable--disable-toggle)
- [Managing tokens](#managing-tokens)
- [Permissions explained](#permissions-explained)
- [Troubleshooting](#troubleshooting)

---

## Installation

The extension is not yet published to the Chrome Web Store, so you load it manually as an unpacked extension.

**Requirements:** Google Chrome 114 or later (Side Panel API support required).

1. Download or clone this repository to your computer.

2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```

3. Enable **Developer mode** using the toggle in the top-right corner.

4. Click **Load unpacked**.

5. Select the root folder of this repository (the one containing `manifest.json`).

6. The extension will appear in your extensions list. You should see the SGTM Preview Cookie icon in the Chrome toolbar.

> **Tip:** Pin the extension icon to your toolbar by clicking the puzzle-piece icon and then the pin next to *SGTM Preview Cookie*. This makes opening the side panel one click away.

---

## How it works

When you open a GTM debug page (`https://your-sgtm-domain.com/gtm/debug`), the extension:

1. Automatically watches the page for a preview token appearing in the DOM (via a MutationObserver).
2. If found, stores it against the hostname and shows it in the side panel.
3. When you click **Set Cookie**, the extension writes an `x-gtm-server-preview` cookie on the *parent* domain derived from your sGTM hostname — so GTM can pick it up on your actual website.

Cookie details:
- **Name:** `x-gtm-server-preview`
- **Domain:** parent domain of your sGTM host (e.g. sGTM on `sgtm.example.com` → cookie on `.example.com`)
- **Expiry:** 7 days
- **Flags:** `Secure; SameSite=None`

---

## Tutorial

### 1. Open the side panel

Click the **SGTM Preview Cookie** icon in the Chrome toolbar. The side panel opens on the right side of your browser window. It stays open as you navigate between tabs.

---

### 2. Navigate to your GTM debug page

In any tab, go to your server-side GTM debug URL. It typically looks like:

```
https://sgtm.example.com/gtm/debug
```

The URL must contain `/gtm/debug`. The extension's content script only runs on matching URLs.

If the page already has the preview dialog open (showing the header snippet), the token is captured automatically — you'll see a card appear in the side panel immediately.

---

### 3. Scrape the preview token

If the token wasn't captured automatically, click **Scrape Token** in the side panel.

The extension will:
1. Click the three-dots overflow menu on the GTM debug page.
2. Click **Send requests manually** from the menu.
3. Wait for the dialog to open and read the `x-gtm-server-preview` token from the header snippet field.

A card appears in the side panel showing:
- The **hostname** of the sGTM server (e.g. `sgtm.example.com`)
- The **token value** (truncated for display, always full value when used)
- A **timestamp** of when it was captured

> **Note:** The active tab must be a `/gtm/debug` page for scraping to work. If you are on a different page, switch to your debug tab first.

---

### 4. Set the cookie

Each token card has two action buttons:

| Button | What it does |
|---|---|
| **Set Cookie** | Writes the cookie on the target domain and stays on the current page. |
| **Set Cookie & Open Site** | Writes the cookie and opens `https://www.{domain}/` in a new tab. |

Click whichever suits your workflow. A green success banner confirms the cookie was set and shows the domain it was written to.

---

### 5. Verify on your site

Open DevTools on your target website (`F12` → **Application** → **Cookies**) and confirm that `x-gtm-server-preview` is present with the correct value.

Your server-side GTM container will now route requests through the preview environment, so you can QA tags and triggers before publishing.

---

## Enable / Disable toggle

The **On / Off toggle** in the top-right corner of the side panel lets you pause the extension without uninstalling it.

| State | Behaviour |
|---|---|
| **On** (default) | Auto-detection runs; tokens are captured and stored; Scrape Token works normally. |
| **Off** | Auto-detection is silenced; incoming tokens from the page are dropped; Scrape Token returns an error. The panel UI dims to signal the inactive state. |

The toggle state is **persisted** — it survives closing the panel, reloading the browser, and extension restarts. Already-captured token cards remain visible while disabled; only new captures and scraping are blocked.

To re-enable, simply flip the toggle back to **On**.

---

## Managing tokens

- **Tokens are stored per hostname.** If you scrape a new token from the same sGTM host, it replaces the previous one.
- **Up to 50 tokens** are kept in storage at once. Oldest entries are dropped automatically beyond that limit.
- **Delete a single token** by clicking the trash icon on its card.
- **Clear All** removes every stored token at once (a confirmation prompt is shown first).

---

## Permissions explained

| Permission | Why it's needed |
|---|---|
| `sidePanel` | Render the UI in Chrome's built-in side panel. |
| `cookies` | Read and write the `x-gtm-server-preview` cookie on target domains. |
| `tabs` | Query active tabs to forward the scrape command to the right page. |
| `storage` | Persist captured tokens and the enabled/disabled state across sessions. |
| `host_permissions: <all_urls>` | Set cookies on arbitrary domains (your sGTM parent domain varies per installation). |

---

## Troubleshooting

**"Active tab is not a GTM debug page"**
Switch to a tab whose URL contains `/gtm/debug` before clicking Scrape Token.

**"Overflow menu button not found"**
The GTM debug page may still be loading, or the layout has changed. Refresh the debug page and try again.

**"Dialog opened but no token found within 4s"**
The dialog appeared but the header snippet field was empty or slow to populate. Wait a moment and click Scrape Token again.

**Cookie is set but the preview doesn't work on the site**
Check that the sGTM hostname has at least two parts separated by dots (e.g. `sgtm.example.com`). A bare hostname like `localhost` cannot produce a valid cookie domain.

**Extension was just installed and no tokens appear**
Reload any already-open GTM debug tabs after installing — content scripts do not inject into tabs that were open before the extension was loaded.

**Toggle is Off and Scrape Token shows an error**
Flip the On/Off toggle in the header back to **On** and try again.
