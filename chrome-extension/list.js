/**
 * list.js  —  Request list rendering with incremental render
 *
 * Renders the captured request list with chunked rendering for performance.
 * Handles empty states, selection, and filtering integration.
 *
 * Usage:
 *   import { renderList, updateCount, getSelectedEntry, setSelectedEntry } from './list.js';
 */

"use strict";

import { filterEntries } from "./filter.js";

// ── Constants ────────────────────────────────────────────────────────────

const RENDER_CHUNK = 50;
const URL_TRUNCATE_LENGTH = 62;

// ── State ────────────────────────────────────────────────────────────────

let entries = [];
let selectedEntry = null;
let renderCount = 0;

// ── Callbacks ────────────────────────────────────────────────────────────

/** Called when a request row is clicked */
let onSelectCallback = null;

/** Called to decorate a row element (e.g., add checkbox) */
let onRowCreateCallback = null;

/**
 * Set the callback fired when a request is selected.
 */
export function onSelect(callback) {
  onSelectCallback = callback;
}

/**
 * Set a callback to decorate created rows (e.g., add checkboxes for batch).
 * Called with (rowElement, entry).
 */
export function onRowCreate(callback) {
  onRowCreateCallback = callback;
}

// ── Core ─────────────────────────────────────────────────────────────────

/**
 * Set the full entry list.
 */
export function setEntries(allEntries) {
  entries = allEntries || [];
  renderCount = 0;

  // Update selected entry reference if it still exists
  if (selectedEntry) {
    const updated = entries.find(e => e.requestId === selectedEntry.requestId);
    if (updated) selectedEntry = updated;
    else selectedEntry = null;
  }
}

/**
 * Get all entries.
 */
export function getEntries() {
  return entries;
}

/**
 * Get the currently selected entry.
 */
export function getSelectedEntry() {
  return selectedEntry;
}

/**
 * Set the selected entry (e.g., from detail panel close).
 */
export function setSelectedEntry(entry) {
  selectedEntry = entry;
}

/**
 * Get the count of entries (for the count badge).
 */
export function getCount() {
  return entries.length;
}

/**
 * Build method counts for filter pills.
 */
export function getMethodCounts() {
  const counts = {};
  entries.forEach(e => {
    const m = e.method || "?";
    counts[m] = (counts[m] || 0) + 1;
  });
  return counts;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function statusClass(code) {
  if (!code) return "status-pending";
  if (code < 300) return "status-ok";
  if (code < 400) return "status-redirect";
  if (code < 500) return "status-client-err";
  return "status-server-err";
}

function methodClass(method) {
  return `method-${(method || "GET").toUpperCase()}`;
}

// ── DOM refs (lazily resolved) ───────────────────────────────────────────

let _listEl = null;
let _countEl = null;
let _liveStatusEl = null;
let _emptyStatesInitialized = false;

function getListEl() {
  if (!_listEl) _listEl = document.getElementById("request-list");
  return _listEl;
}

function getCountEl() {
  if (!_countEl) _countEl = document.getElementById("capture-count");
  return _countEl;
}

function getLiveStatusEl() {
  if (!_liveStatusEl) _liveStatusEl = document.getElementById("live-status");
  return _liveStatusEl;
}

// ── Rendering ────────────────────────────────────────────────────────────

/**
 * Render the request list (incrementally, with pagination).
 *
 * @param {object} [options]
 * @param {boolean} [options.forceFull=false] - Force full render (ignore chunking)
 * @param {boolean} [options.isCapturing=false] - Is capture active?
 */
export function renderList(options = {}) {
  const listEl = getListEl();
  if (!listEl) return;

  const filtered = filterEntries(entries);
  const isCapturing = options.isCapturing || false;
  const forceFull = options.forceFull || false;

  // Determine how many to render
  const targetCount = forceFull ? filtered.length : Math.min(filtered.length, RENDER_CHUNK);
  const hasMore = filtered.length > targetCount;

  // Reset container
  listEl.innerHTML = "";

  if (filtered.length === 0) {
    renderEmptyState(listEl, isCapturing);
    return;
  }

  // Render newest first
  const slice = [...filtered].reverse().slice(0, targetCount);

  slice.forEach(entry => {
    const row = createRow(entry);
    listEl.appendChild(row);
  });

  // "Show more" button if paginated
  if (hasMore) {
    const showMore = document.createElement("button");
    showMore.className = "show-more-btn";
    showMore.textContent = `Show ${filtered.length - targetCount} more…`;
    showMore.addEventListener("click", () => {
      renderList({ ...options, forceFull: true });
    });
    listEl.appendChild(showMore);
  }

  // Scroll-triggered incremental load
  if (!forceFull && filtered.length > RENDER_CHUNK) {
    setupScrollTrigger(listEl);
  }
}

function createRow(entry) {
  const row = document.createElement("div");
  row.className = "request-row";
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", selectedEntry && selectedEntry.requestId === entry.requestId ? "true" : "false");

  if (selectedEntry && selectedEntry.requestId === entry.requestId) {
    row.classList.add("selected");
  }

  const urlShort = entry.url.length > URL_TRUNCATE_LENGTH
    ? "…" + entry.url.slice(-(URL_TRUNCATE_LENGTH - 1))
    : entry.url;

  const dur = entry.duration_ms ? `<span class="req-dur">${entry.duration_ms}ms</span>` : "";

  row.innerHTML = `
    <span class="method-badge ${methodClass(entry.method)}">${entry.method || "?"}</span>
    <span class="entry-url" title="${escHtml(entry.url)}">${escHtml(urlShort)}</span>
    <span class="status-badge ${statusClass(entry.status_code)}">${entry.status_code || "…"}</span>
    ${dur}
  `;

  row.addEventListener("click", () => {
    selectedEntry = entry;
    renderList();
    if (onSelectCallback) onSelectCallback(entry);
  });

  if (onRowCreateCallback) onRowCreateCallback(row, entry);

  return row;
}

function renderEmptyState(listEl, isCapturing) {
  const hasEntries = entries.length > 0;

  if (isCapturing) {
    listEl.innerHTML = `<div class="empty-state empty-listening" role="status">● Recording API requests… browse the page</div>`;
  } else if (hasEntries) {
    listEl.innerHTML = `<div class="empty-state" role="status">No requests match the current filter.</div>`;
  } else {
    listEl.innerHTML = `<div class="empty-state" role="status">
      <div class="empty-guide">
        <div class="empty-step"><b>1</b><span>Click <strong>▶ Start</strong> to begin recording</span></div>
        <div class="empty-step"><b>2</b><span>Browse the page — API calls appear here</span></div>
        <div class="empty-step"><b>3</b><span>Click <strong>■ Stop</strong> to send for AI testing</span></div>
      </div>
    </div>`;
  }
}

// ── Infinite scroll (scroll-triggered chunk loading) ────────────────────

let scrollListenerAttached = false;

function setupScrollTrigger(listEl) {
  if (scrollListenerAttached) return;

  const handler = () => {
    const { scrollTop, scrollHeight, clientHeight } = listEl;
    if (scrollHeight - scrollTop - clientHeight < 150) {
      const filtered = filterEntries(entries);
      if (renderCount < filtered.length) {
        renderCount = Math.min(filtered.length, renderCount + RENDER_CHUNK);
        renderList();
      }
    }
  };

  listEl.addEventListener("scroll", handler, { passive: true });
  scrollListenerAttached = true;

  // Clean up old handler if listEl changes
  // Store for potential removal
  listEl._scrollHandler = handler;
}

// ── Count display ─────────────────────────────────────────────────────────

/**
 * Update the captured-requests count display.
 */
export function updateCount() {
  const countEl = getCountEl();
  if (!countEl) return;

  const n = entries.length;
  countEl.textContent = `${n} request${n !== 1 ? "s" : ""}`;
}

/**
 * Show/hide the live capture status indicator.
 */
export function setLiveStatus(active) {
  const el = getLiveStatusEl();
  if (!el) return;
  el.classList.toggle("hidden", !active);
}

// ── Method count updates (for filter pills) ──────────────────────────────

/**
 * Update the method filter pill counts.
 */
export function updateMethodCounts() {
  const counts = getMethodCounts();
  document.querySelectorAll(".mf-btn").forEach(btn => {
    const m = btn.dataset.method;
    const countEl = btn.querySelector(".mf-count");
    if (countEl) {
      countEl.textContent = m === "ALL" ? entries.length : (counts[m] || 0);
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
