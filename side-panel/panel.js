'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let port = null;
let tokens = [];   // [{ hostname, token, url, timestamp }]
let isEnabled = true;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tokenList     = document.getElementById('token-list');
const emptyState    = document.getElementById('empty-state');
const statusBanner  = document.getElementById('status-banner');
const btnScrape     = document.getElementById('btn-scrape');
const btnClear      = document.getElementById('btn-clear');
const toggleInput   = document.getElementById('toggle-enabled');
const toggleLabel   = document.getElementById('toggle-label');

// ── Connection to background ──────────────────────────────────────────────────
async function connect() {
  const windowId = (await chrome.windows.getCurrent()).id ?? 0;
  const portName = `sgtm-panel-${windowId}`;
  port = chrome.runtime.connect({ name: portName });

  port.onMessage.addListener(onBackgroundMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 1000);   // reconnect after 1s
  });

  // Load persisted tokens and enabled state
  port.postMessage({ type: 'GET_TOKENS' });
  port.postMessage({ type: 'GET_ENABLED' });
}

function onBackgroundMessage(msg) {
  switch (msg.type) {

    case 'TOKENS_LIST':
      tokens = msg.tokens ?? [];
      renderAll();
      break;

    case 'PREVIEW_TOKEN_FOUND':
      upsertToken(msg.entry);
      renderAll();
      showStatus(`New token captured from ${msg.entry.hostname}`, 'success');
      break;

    case 'COOKIE_RESULT':
      if (msg.success) {
        showStatus(
          `Cookie set on ${msg.cookieDomain} for ${msg.hostname}`,
          'success'
        );
      } else {
        showStatus(`Failed to set cookie: ${msg.error}`, 'error');
      }
      break;

    case 'ENABLED_STATE':
      applyEnabledState(msg.enabled);
      break;

    case 'SCRAPE_RESULT':
      btnScrape.disabled = false;
      btnScrape.textContent = '';
      btnScrape.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
        </svg>
        Scrape Token`;
      if (!msg.success) {
        showStatus(`Scrape failed: ${msg.error}`, 'error');
      }
      break;
  }
}

// ── Button handlers ───────────────────────────────────────────────────────────
btnScrape.addEventListener('click', () => {
  if (!port) return;
  btnScrape.disabled = true;
  btnScrape.innerHTML = `<span style="opacity:.7">Scraping…</span>`;
  port.postMessage({ type: 'TRIGGER_SCRAPE' });
});

btnClear.addEventListener('click', () => {
  if (!port) return;
  if (tokens.length === 0) return;
  if (!confirm('Clear all captured tokens?')) return;
  port.postMessage({ type: 'CLEAR_TOKENS' });
});

toggleInput.addEventListener('change', () => {
  if (!port) return;
  port.postMessage({ type: 'SET_ENABLED', enabled: toggleInput.checked });
  applyEnabledState(toggleInput.checked);
});

function applyEnabledState(enabled) {
  isEnabled = enabled;
  toggleInput.checked = enabled;
  toggleLabel.textContent = enabled ? 'On' : 'Off';
  document.body.classList.toggle('ext-disabled', !enabled);
}

// ── Token state helpers ───────────────────────────────────────────────────────
function upsertToken(entry) {
  const idx = tokens.findIndex(t => t.hostname === entry.hostname);
  if (idx >= 0) {
    tokens[idx] = entry;
  } else {
    tokens.unshift(entry);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderAll() {
  // Remove all cards (keep empty-state node)
  tokenList.querySelectorAll('.token-card').forEach(el => el.remove());

  if (tokens.length === 0) {
    emptyState.style.display = '';
    return;
  }
  emptyState.style.display = 'none';

  tokens.forEach(entry => tokenList.appendChild(buildCard(entry)));
}

function buildCard(entry) {
  const { hostname, token, url, timestamp } = entry;

  // Derive cookie domain and target tab URL
  const parts = hostname.split('.');
  const cookieDomain = parts.length >= 2 ? '.' + parts.slice(1).join('.') : '.' + hostname;
  const baseDomain   = parts.length >= 2 ? parts.slice(1).join('.')       : hostname;
  const targetUrl    = `https://www.${baseDomain}/`;

  const card = document.createElement('div');
  card.className = 'token-card';
  card.dataset.hostname = hostname;

  const time = timestamp ? formatTime(timestamp) : '';
  const shortToken = token.length > 40 ? token.slice(0, 38) + '…' : token;

  card.innerHTML = `
    <div class="card-header">
      <span class="domain-badge" title="${hostname}">${hostname}</span>
      <span class="card-timestamp">${time}</span>
      <button class="btn-icon btn-delete" title="Remove entry" data-hostname="${hostname}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>

    <div class="token-value" title="${token}">${shortToken}</div>

    <div class="card-actions">
      <button class="btn btn-primary btn-sm btn-apply" data-hostname="${hostname}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        Set Cookie &amp; Open Tab
      </button>
      <button class="btn btn-outline btn-sm btn-cookie-only" data-hostname="${hostname}">
        Set Cookie Only
      </button>
      <button class="btn btn-outline btn-sm btn-copy" data-token="${token}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
        Copy
      </button>
      <span class="cookie-info">cookie on ${cookieDomain}</span>
    </div>
  `;

  // Event listeners
  card.querySelector('.btn-apply').addEventListener('click', () => {
    sendSetCookie(hostname, token, true);
  });

  card.querySelector('.btn-cookie-only').addEventListener('click', () => {
    sendSetCookie(hostname, token, false);
  });

  card.querySelector('.btn-copy').addEventListener('click', (e) => {
    navigator.clipboard.writeText(token).then(() => {
      const btn = e.currentTarget;
      const orig = btn.innerHTML;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    });
  });

  card.querySelector('.btn-delete').addEventListener('click', () => {
    if (!port) return;
    port.postMessage({ type: 'DELETE_TOKEN', hostname });
  });

  return card;
}

function sendSetCookie(hostname, token, openTab) {
  if (!port) return;
  port.postMessage({ type: 'SET_COOKIE', hostname, token, openTab });
}

// ── Status banner ─────────────────────────────────────────────────────────────
let statusTimer = null;
function showStatus(text, type = 'info') {
  statusBanner.className = type;
  statusBanner.textContent = text;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusBanner.className = '';
    statusBanner.textContent = '';
  }, 4000);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
connect();
