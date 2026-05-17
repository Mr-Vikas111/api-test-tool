/**
 * detail.js  —  Detail panel (request/response/export tabs + API testcase workspace)
 *
 * Manages the right-column detail panel showing the selected request's
 * details, response, export JSON, and generated test cases.
 *
 * Usage:
 *   import { openDetail, closeDetail, switchTab } from './detail.js';
 *   openDetail(entry);
 */

"use strict";

import { focusFirst, trapFocus, releaseFocus } from "./focus.js";

// ── DOM refs (lazily resolved) ───────────────────────────────────────────

const DOM = {};

function ensureDom() {
  if (DOM.panel) return;

  DOM.panel           = document.getElementById("detail-panel");
  DOM.title           = document.getElementById("detail-title");
  DOM.btnClose        = document.getElementById("btn-close-detail");
  DOM.url             = document.getElementById("detail-url");
  DOM.reqHeaders      = document.getElementById("detail-req-headers");
  DOM.payload         = document.getElementById("detail-payload");
  DOM.status          = document.getElementById("detail-status");
  DOM.resHeaders      = document.getElementById("detail-res-headers");
  DOM.response        = document.getElementById("detail-response");
  DOM.exportPre       = document.getElementById("detail-export");
  DOM.btnCopy         = document.getElementById("btn-copy");
  DOM.btnDownload     = document.getElementById("btn-download");
  DOM.workspace       = document.getElementById("api-testcase-workspace");
  DOM.workspaceSub    = document.getElementById("api-testcase-subtitle");
  DOM.workspaceCount  = document.getElementById("api-testcase-count");
  DOM.workspaceChips  = document.getElementById("api-testcase-chips");
  DOM.workspaceList   = document.getElementById("api-testcase-list");
  DOM.workspaceViewer = document.getElementById("api-testcase-viewer");

  // Tab buttons
  DOM.tabBtns = document.querySelectorAll(".tab-btn");
  DOM.tabContents = document.querySelectorAll(".tab-content");
}

// ── State ────────────────────────────────────────────────────────────────

let currentEntry = null;
let lastResultsData = null;

/**
 * Set the last results data for testcase workspace rendering.
 * Called externally when results data is updated.
 */
export function setLastResultsData(data) {
  lastResultsData = data;
}

/**
 * Get the current entry being viewed.
 */
export function getCurrentEntry() {
  return currentEntry;
}

// ── Core ─────────────────────────────────────────────────────────────────

/**
 * Open the detail panel for a given entry.
 *
 * @param {object} entry - The captured request entry
 */
export function openDetail(entry) {
  ensureDom();
  currentEntry = entry;

  if (!DOM.panel) return;

  // Populate header
  const urlObj = safeParseUrl(entry.url);
  const statusInfo = entry.status_code ? `  [${entry.status_code}]` : "";
  DOM.title.textContent = urlObj
    ? `${entry.method}  ${urlObj.pathname}${statusInfo}`
    : `${entry.method}  ${entry.url}${statusInfo}`;
  DOM.title.setAttribute("title", entry.url);

  // Request tab
  DOM.url.textContent = entry.url;
  DOM.reqHeaders.textContent = fmt(entry.headers);
  DOM.payload.textContent = fmt(entry.payload);

  // Response tab
  DOM.status.textContent = entry.status_code ? String(entry.status_code) : "pending";
  DOM.resHeaders.textContent = fmt(entry.response_headers);
  DOM.response.textContent = fmt(entry.response);

  // Export tab
  const exportObj = toExportObject(entry);
  DOM.exportPre.textContent = JSON.stringify(exportObj, null, 2);

  // Show panel
  DOM.panel.classList.remove("hidden");
  DOM.panel.classList.add("detail-animated");

  // Focus trap
  trapFocus(DOM.panel);

  // Default tab
  switchTab("request");

  // Update parent to mark detail-open
  document.body.classList.add("detail-open");
}

/**
 * Close the detail panel.
 */
export function closeDetail() {
  ensureDom();
  if (!DOM.panel) return;

  DOM.panel.classList.add("hidden");
  DOM.panel.classList.remove("detail-animated");
  currentEntry = null;
  releaseFocus();

  document.body.classList.remove("detail-open");
}

// ── Tab switching ────────────────────────────────────────────────────────

/**
 * Switch to a named tab.
 *
 * @param {'request'|'response'|'export'} name - Tab name
 */
export function switchTab(name) {
  ensureDom();

  DOM.tabBtns.forEach(btn => {
    const isActive = btn.dataset.tab === name;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  DOM.tabContents.forEach(div => {
    div.classList.toggle("active", div.id === `tab-${name}`);
  });
}

// ── Export helpers ───────────────────────────────────────────────────────

function toExportObject(entry) {
  return {
    url:         entry.url,
    method:      entry.method,
    headers:     entry.headers     || {},
    payload:     entry.payload     || {},
    response:    entry.response    || {},
    status_code: entry.status_code || null,
  };
}

/**
 * Get the export JSON for the current entry.
 */
export function getExportJSON() {
  if (!currentEntry) return null;
  return JSON.stringify(toExportObject(currentEntry), null, 2);
}

// ── API Testcase Workspace ────────────────────────────────────────────────

/**
 * Render the testcase workspace below the detail panel.
 *
 * @param {string|null} selectedApiLabel - The "METHOD URL" label for the selected API
 * @param {function} isSameApiLabel - Comparison function from parent
 * @param {object} [options]
 * @param {string} [options.activeCategoryFilter]
 * @param {string} [options.selectedDetailTestcaseKey]
 */
export function renderTestcaseWorkspace(selectedApiLabel, isSameApiLabel, options = {}) {
  ensureDom();
  if (!DOM.workspace) return;

  const activeCategoryFilter = options.activeCategoryFilter || "all";
  let selectedDetailTestcaseKey = options.selectedDetailTestcaseKey || null;

  // Hide if no entry selected or no results data
  if (!currentEntry || !lastResultsData) {
    DOM.workspace.classList.add("hidden");
    DOM.workspaceList.innerHTML = "";
    DOM.workspaceViewer.innerHTML = "";
    DOM.workspaceChips.innerHTML = "";
    DOM.workspaceChips.classList.add("hidden");

    if (!currentEntry) return;

    DOM.workspace.classList.remove("hidden");
    DOM.workspaceSub.textContent = "Run the AI analysis to generate testcases for this API.";
    DOM.workspaceCount.textContent = "0 tests";
    DOM.workspaceList.innerHTML = `<div class="api-viewer-empty">No generated testcases yet for this request.</div>`;
    DOM.workspaceViewer.innerHTML = `<div class="api-viewer-empty">Generated testcase details will appear here after the batch finishes.</div>`;
    return;
  }

  // Get test cases for this API
  const groups = (lastResultsData.groups || []).filter(g =>
    isSameApiLabel(selectedApiLabel, g.api_request || "")
  );
  const allCases = groups.flatMap(group => group.test_results || []);

  DOM.workspaceSub.textContent = selectedApiLabel || "Selected API";

  // Category chips
  const categorySet = new Set(allCases.map(tc => tc.category).filter(Boolean));
  const categories = Array.from(categorySet).sort();

  if (categories.length) {
    DOM.workspaceChips.innerHTML = [
      `<button class="api-chip ${activeCategoryFilter === "all" ? "active" : ""}" data-category="all">All</button>`,
      ...categories.map(cat =>
        `<button class="api-chip ${activeCategoryFilter === cat ? "active" : ""}" data-category="${escHtml(cat)}">${escHtml(cat.replace(/_/g, " "))}</button>`
      ),
    ].join("");
    DOM.workspaceChips.classList.remove("hidden");
  } else {
    DOM.workspaceChips.innerHTML = "";
    DOM.workspaceChips.classList.add("hidden");
  }

  // Filter by category
  const visibleCases = allCases.filter(tc =>
    activeCategoryFilter === "all" || (tc.category || "") === activeCategoryFilter
  );

  DOM.workspaceCount.textContent = `${visibleCases.length} test${visibleCases.length === 1 ? "" : "s"}`;

  if (!visibleCases.length) {
    DOM.workspaceList.innerHTML = `<div class="api-viewer-empty">No testcases match the selected chip filter.</div>`;
    DOM.workspaceViewer.innerHTML = `<div class="api-viewer-empty">Choose another chip or reset the filter.</div>`;
    return;
  }

  // Build list
  const availableKeys = visibleCases.map((tc, i) => `${tc.name || "testcase"}::${i}`);
  if (!selectedDetailTestcaseKey || !availableKeys.includes(selectedDetailTestcaseKey)) {
    selectedDetailTestcaseKey = availableKeys[0];
  }

  DOM.workspaceList.innerHTML = "";
  let selectedCase = visibleCases[0];

  visibleCases.forEach((tc, i) => {
    const key = `${tc.name || "testcase"}::${i}`;
    const item = document.createElement("div");
    item.className = `api-testcase-item${selectedDetailTestcaseKey === key ? " active" : ""}`;
    const sClass = tc.error ? "error" : tc.passed ? "pass" : "fail";

    item.innerHTML =
      `<div class="api-testcase-item-top">` +
        `<div class="api-testcase-name">${escHtml(cleanTitle(tc.name))}</div>` +
      `</div>` +
      `<div class="api-testcase-meta">` +
        `<span class="api-mini-status ${sClass}">${tc.error ? "ERROR" : tc.passed ? "PASS" : "FAIL"}</span>` +
        `${tc.category ? `<span class="api-mini-cat">${escHtml(tc.category.replace(/_/g, " "))}</span>` : ""}` +
        `${tc.actual_status ? `<span class="api-mini-cat">HTTP ${tc.actual_status}</span>` : ""}` +
      `</div>`;

    item.addEventListener("click", () => {
      // Trigger re-render via callback (parent handles state)
      if (window._onTestcaseSelect) {
        window._onTestcaseSelect(key);
      }
    });

    DOM.workspaceList.appendChild(item);

    if (selectedDetailTestcaseKey === key) {
      selectedCase = tc;
    }
  });

  // Viewer
  const vStatus = selectedCase.error ? "ERROR" : selectedCase.passed ? "PASS" : "FAIL";
  DOM.workspaceViewer.innerHTML =
    `<div class="api-viewer-title">${escHtml(cleanTitle(selectedCase.name))}</div>` +
    `<div class="api-viewer-row">` +
      `<span class="api-viewer-pill">${vStatus}</span>` +
      `${selectedCase.category ? `<span class="api-viewer-pill">${escHtml(selectedCase.category.replace(/_/g, " "))}</span>` : ""}` +
      `${selectedCase.expected_status ? `<span class="api-viewer-pill">Expected ${selectedCase.expected_status}</span>` : ""}` +
      `${selectedCase.actual_status ? `<span class="api-viewer-pill">Actual ${selectedCase.actual_status}</span>` : ""}` +
    `</div>` +
    buildViewerSections(selectedCase) +
    `<div class="api-viewer-section"><span class="api-viewer-label">Model Request</span><pre class="detail-json">${toPrettyJson(selectedCase.model_request || {})}</pre></div>` +
    (selectedCase.assertion_notes ? `<div class="api-viewer-section"><span class="api-viewer-label">Assertions</span><div class="api-viewer-text">${escHtml(selectedCase.assertion_notes)}</div></div>` : "") +
    (selectedCase.error ? `<div class="api-viewer-section"><span class="api-viewer-label">Error</span><div class="api-viewer-text">${escHtml(selectedCase.error)}</div></div>` : "") +
    (selectedCase.failure_suggestion ? `<div class="api-viewer-section"><span class="api-viewer-label">Suggestion</span><div class="api-viewer-text">${escHtml(selectedCase.failure_suggestion)}</div></div>` : "");
}

function buildViewerSections(tc) {
  let html = "";
  if (tc.description) html += `<div class="api-viewer-section"><span class="api-viewer-label">Description</span><div class="api-viewer-text">${escHtml(tc.description)}</div></div>`;
  if (tc.scenario_description) html += `<div class="api-viewer-section"><span class="api-viewer-label">Scenario</span><div class="api-viewer-text">${escHtml(tc.scenario_description)}</div></div>`;
  if (tc.request_body_note) html += `<div class="api-viewer-section"><span class="api-viewer-label">Request Body Note</span><div class="api-viewer-text">${escHtml(tc.request_body_note)}</div></div>`;
  return html;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function safeParseUrl(url) {
  try { return new URL(url); } catch { return null; }
}

function fmt(value) {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function cleanTitle(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Unnamed testcase";
  return raw.replace(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\S+\s*(?:[-:|]|=>)\s*/i, "").trim() || raw;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Sanitize a string for safe use as a CSS class name. */
function safeClass(str) {
  return String(str || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function toPrettyJson(value) {
  try {
    return escHtml(JSON.stringify(value, null, 2));
  } catch {
    return escHtml(String(value));
  }
}

// ── Event wiring (tab buttons) ───────────────────────────────────────────

export function initDetailEvents() {
  ensureDom();

  // Tab switching
  DOM.tabBtns.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Close button
  if (DOM.btnClose) {
    DOM.btnClose.addEventListener("click", () => closeDetail());
  }

  // Copy
  if (DOM.btnCopy) {
    DOM.btnCopy.addEventListener("click", async () => {
      const text = getExportJSON();
      if (!text) return;
      await navigator.clipboard.writeText(text);
      DOM.btnCopy.textContent = "OK Copied!";
      setTimeout(() => { DOM.btnCopy.textContent = "Copy"; }, 1500);
    });
  }

  // Download
  if (DOM.btnDownload) {
    DOM.btnDownload.addEventListener("click", () => {
      if (!currentEntry) return;
      const text = getExportJSON();
      if (!text) return;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const urlObj = safeParseUrl(currentEntry.url);
      const slug = urlObj
        ? urlObj.pathname.replace(/\//g, "_").replace(/^_/, "").replace(/[^a-z0-9_.-]/gi, "") || "api"
        : "api";
      const fname = `api_log_${slug}.json`;

      chrome.downloads.download({ url, filename: fname, saveAs: false });
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  }
}
