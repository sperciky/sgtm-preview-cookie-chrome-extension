'use strict';

// Open side panel when user clicks the toolbar icon
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Map of windowId -> Port for side panel connections
const sidePanelPorts = new Map();

// ── Connection from side panel ────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('sgtm-panel')) return;

  // Extract windowId from port name: "sgtm-panel-{windowId}"
  const windowId = parseInt(port.name.split('-').pop(), 10) || port.name;
  sidePanelPorts.set(windowId, port);

  port.onMessage.addListener(async (msg) => {
    switch (msg.type) {

      case 'GET_TOKENS': {
        const { tokens = [] } = await chrome.storage.local.get('tokens');
        port.postMessage({ type: 'TOKENS_LIST', tokens });
        break;
      }

      case 'GET_ENABLED': {
        const { enabled = true } = await chrome.storage.local.get('enabled');
        port.postMessage({ type: 'ENABLED_STATE', enabled });
        break;
      }

      case 'SET_ENABLED': {
        await chrome.storage.local.set({ enabled: msg.enabled });
        // Notify all content scripts so auto-detection respects the new state
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.url && tab.url.includes('/gtm/debug')) {
            chrome.tabs.sendMessage(tab.id, { type: 'SET_ENABLED', enabled: msg.enabled }).catch(() => {});
          }
        }
        break;
      }

      case 'SET_COOKIE': {
        try {
          const result = await handleSetCookie(msg.token, msg.hostname, msg.openTab);
          port.postMessage({ type: 'COOKIE_RESULT', success: true, hostname: msg.hostname, ...result });
        } catch (err) {
          port.postMessage({ type: 'COOKIE_RESULT', success: false, error: err.message });
        }
        break;
      }

      case 'TRIGGER_SCRAPE': {
        // Forward scrape command to the active tab's content script
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('No active tab found');
          if (!tab.url || !tab.url.includes('/gtm/debug')) {
            throw new Error('Active tab is not a GTM debug page');
          }
          const result = await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SCRAPE' });
          port.postMessage({ type: 'SCRAPE_RESULT', ...result });
        } catch (err) {
          port.postMessage({ type: 'SCRAPE_RESULT', success: false, error: err.message });
        }
        break;
      }

      case 'CLEAR_TOKENS': {
        await chrome.storage.local.set({ tokens: [] });
        port.postMessage({ type: 'TOKENS_LIST', tokens: [] });
        break;
      }

      case 'DELETE_TOKEN': {
        const { tokens: existing = [] } = await chrome.storage.local.get('tokens');
        const updated = existing.filter(t => t.hostname !== msg.hostname);
        await chrome.storage.local.set({ tokens: updated });
        port.postMessage({ type: 'TOKENS_LIST', tokens: updated });
        break;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    sidePanelPorts.delete(windowId);
  });
});

// ── Messages from content script ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PREVIEW_TOKEN_FOUND') {
    chrome.storage.local.get('enabled').then(({ enabled = true }) => {
      if (!enabled) return;   // extension is disabled — drop the token
      saveToken(msg).then(() => {
        for (const port of sidePanelPorts.values()) {
          try { port.postMessage({ type: 'PREVIEW_TOKEN_FOUND', entry: msg }); } catch (_) {}
        }
      });
    });
  }
  return false;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function saveToken({ token, hostname, url, timestamp }) {
  const { tokens = [] } = await chrome.storage.local.get('tokens');

  // Update existing entry for this hostname, or prepend a new one
  const idx = tokens.findIndex(t => t.hostname === hostname);
  const entry = { token, hostname, url, timestamp };
  if (idx >= 0) {
    tokens[idx] = entry;
  } else {
    tokens.unshift(entry);
  }

  // Cap to 50 entries
  if (tokens.length > 50) tokens.length = 50;
  await chrome.storage.local.set({ tokens });
  return tokens;
}

/**
 * Derives the cookie domain from an sGTM hostname.
 * e.g. "sgtm.ceneje.si"  →  domain ".ceneje.si", base "ceneje.si"
 *      "gtm.server.example.co.uk" → domain ".server.example.co.uk", base "server.example.co.uk"
 */
async function handleSetCookie(token, sgtmHostname, openTab) {
  const parts = sgtmHostname.split('.');
  if (parts.length < 2) throw new Error(`Cannot derive cookie domain from "${sgtmHostname}"`);

  const baseDomain = parts.slice(1).join('.');          // ceneje.si
  const cookieDomain = '.' + baseDomain;                // .ceneje.si
  const cookieUrl = `https://${baseDomain}/`;

  await chrome.cookies.set({
    url: cookieUrl,
    name: 'x-gtm-server-preview',
    value: token,
    domain: cookieDomain,
    path: '/',
    secure: true,          // required when sameSite is 'no_restriction' (SameSite=None)
    httpOnly: false,
    sameSite: 'no_restriction',
    expirationDate: Math.floor(Date.now() / 1000) + 86400 * 7   // 7 days
  });

  if (openTab) {
    chrome.tabs.create({ url: `https://www.${baseDomain}/` });
  }

  return { cookieDomain, baseDomain };
}
