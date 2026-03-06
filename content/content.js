'use strict';

// Only run on GTM debug pages
if (!window.location.pathname.includes('/gtm/debug')) {
  // No-op — manifest match pattern already guards this, but be defensive
  throw new Error('sgtm-preview: not a debug page, exiting');
}

const PAGE_HOSTNAME = window.location.hostname;
let lastReportedToken = null;
let isEnabled = true;   // kept in sync with background storage via SET_ENABLED messages

// ── Token extraction ──────────────────────────────────────────────────────────

function extractToken() {
  // Primary selector: the read-only header snippet textarea inside the dialog
  const textarea = document.querySelector(
    'textarea.gtm-snippet__textarea--header.header-snippet, ' +
    'textarea.header-snippet'
  );
  return textarea ? textarea.value.trim() : null;
}

function reportToken(token) {
  if (!isEnabled) return;
  if (!token || token === lastReportedToken) return;
  lastReportedToken = token;
  chrome.runtime.sendMessage({
    type: 'PREVIEW_TOKEN_FOUND',
    token,
    hostname: PAGE_HOSTNAME,
    url: window.location.href,
    timestamp: Date.now()
  }).catch(() => {
    // Background may not be listening yet — safe to ignore
  });
}

// ── Sync enabled state from storage on load ───────────────────────────────────
chrome.storage.local.get('enabled').then(({ enabled = true }) => {
  isEnabled = enabled;
});

// ── MutationObserver: watch for dialog appearing ──────────────────────────────

const observer = new MutationObserver(() => {
  reportToken(extractToken());
});

observer.observe(document.documentElement, { childList: true, subtree: true });

// Check immediately if dialog already open on page load
reportToken(extractToken());

// ── Commands from the side panel (via background) ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SET_ENABLED') {
    isEnabled = msg.enabled;
    return;
  }

  if (msg.type === 'TRIGGER_SCRAPE') {
    if (!isEnabled) {
      sendResponse({ success: false, error: 'Extension is disabled. Enable it with the toggle in the side panel.' });
      return;
    }
    triggerScrape()
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.type === 'GET_TOKEN') {
    sendResponse({ token: extractToken(), hostname: PAGE_HOSTNAME });
  }
});

// ── Auto-click through menu to open the dialog ───────────────────────────────

/**
 * Dispatch a realistic MouseEvent instead of calling .click() directly.
 * Plain .click() on AngularJS-managed elements can cause "Possibly unhandled
 * rejection: undefined" errors in the GTM debug app's digest cycle because
 * Angular's $apply wraps the handler but the event doesn't flow through its
 * zone properly. A bubbling MouseEvent triggers the ng-click binding the same
 * way a real user interaction does.
 */
function simulateClick(el) {
  el.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window
  }));
}

async function triggerScrape() {
  // Close any existing dialog first
  const existingCloseBtn = document.querySelector('.ctui-dialog-header__close [role="button"]');
  if (existingCloseBtn) {
    simulateClick(existingCloseBtn);
    await sleep(300);
  }

  // Step 1: Click the three-dots overflow menu button
  const menuBtn = document.querySelector('.gtm-debug-header-overflow-menu');
  if (!menuBtn) throw new Error('Overflow menu button not found. Make sure you are on the GTM debug page.');
  simulateClick(menuBtn);

  // Step 2: Wait for the menu items to be rendered, then click "Send requests manually"
  const sendManuallyItem = await waitForElement(
    () => {
      const items = document.querySelectorAll('li[role="button"], [data-ng-click*="showSgtmManualRequestsDialog"]');
      return Array.from(items).find(el =>
        el.textContent.trim().toLowerCase().includes('send requests manually')
      ) ?? null;
    },
    2000
  );
  if (!sendManuallyItem) throw new Error('"Send requests manually" menu item not found after opening the overflow menu.');
  simulateClick(sendManuallyItem);

  // Step 3: Wait for the dialog and extract the token
  const token = await waitForToken(4000);
  if (!token) throw new Error('Dialog opened but no token found within 4s.');

  reportToken(token);
  return { success: true, token, hostname: PAGE_HOSTNAME };
}

/**
 * Poll until `finder()` returns a non-null value, or until timeoutMs elapses.
 */
function waitForElement(finder, timeoutMs) {
  return new Promise((resolve) => {
    const el = finder();
    if (el) { resolve(el); return; }
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const found = finder();
      if (found) { clearInterval(poll); resolve(found); }
      else if (Date.now() > deadline) { clearInterval(poll); resolve(null); }
    }, 100);
  });
}

function waitForToken(timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const token = extractToken();
      if (token) {
        clearInterval(poll);
        resolve(token);
      } else if (Date.now() > deadline) {
        clearInterval(poll);
        resolve(null);
      }
    }, 100);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
