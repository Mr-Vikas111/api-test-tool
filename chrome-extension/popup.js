/**
 * popup.js  —  Popup UI logic
 *
 * Communicates with background.js via chrome.runtime.sendMessage.
 * Renders captured API entries, allows filtering, and exports them
 * as JSON in the API test platform input format.
 */

"use strict";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const btnStart       = document.getElementById("btn-start");
const btnStop        = document.getElementById("btn-stop");
const btnClear       = document.getElementById("btn-clear");
const captureCount   = document.getElementById("capture-count");
const statusDot      = document.getElementById("status-dot");
const filterInput    = document.getElementById("filter-input");
const requestList    = document.getElementById("request-list");

const detailPanel    = document.getElementById("detail-panel");
const detailTitle    = document.getElementById("detail-title");
const btnCloseDetail = document.getElementById("btn-close-detail");

const detailUrl        = document.getElementById("detail-url");
const detailReqHeaders = document.getElementById("detail-req-headers");
const detailPayload    = document.getElementById("detail-payload");
const detailStatus     = document.getElementById("detail-status");
const detailResHeaders = document.getElementById("detail-res-headers");
const detailResponse   = document.getElementById("detail-response");
const detailExport     = document.getElementById("detail-export");
const apiTestcaseWorkspace = document.getElementById("api-testcase-workspace");
const apiTestcaseSubtitle  = document.getElementById("api-testcase-subtitle");
const apiTestcaseCount     = document.getElementById("api-testcase-count");
const apiTestcaseChips     = document.getElementById("api-testcase-chips");
const apiTestcaseList      = document.getElementById("api-testcase-list");
const apiTestcaseViewer    = document.getElementById("api-testcase-viewer");

const btnCopy        = document.getElementById("btn-copy");
const btnDownload    = document.getElementById("btn-download");
const webhookUrlInput  = document.getElementById("webhook-url");
const btnSaveWebhook   = document.getElementById("btn-save-webhook");
const webhookStatus    = document.getElementById("webhook-status");

// ── Results panel DOM refs ────────────────────────────────────────────────────
const resultsPanel      = document.getElementById("results-panel");
const btnCloseResults   = document.getElementById("btn-close-results");
const resultsStatusText = document.getElementById("results-status-text");
const resultsSpinner    = document.getElementById("results-spinner");
const resultsSummary    = document.getElementById("results-summary");
const sumPassed         = document.getElementById("sum-passed");
const sumFailed         = document.getElementById("sum-failed");
const sumErrors         = document.getElementById("sum-errors");
const resultsList       = document.getElementById("results-list");
const resultsRestoredBadge = document.getElementById("results-restored-badge");
const btnTestWebhook      = document.getElementById("btn-test-webhook");
const btnExpandAll        = document.getElementById("btn-expand-all");
const btnCollapseAll      = document.getElementById("btn-collapse-all");
const resultsProgressWrap = document.getElementById("results-progress-wrap");
const resultsProgressBar  = document.getElementById("results-progress-bar");
const resultsFilterCount  = document.getElementById("results-filter-count");
const resultsScope        = document.getElementById("results-scope");
const btnClearResultsScope = document.getElementById("btn-clear-results-scope");
const resultsCategoryFilter = document.getElementById("results-category-filter");
const btnResetAllFilters  = document.getElementById("btn-reset-all-filters");
const btnFullpage         = document.getElementById("btn-fullpage");
const btnCompact          = document.getElementById("btn-compact");

// ── State ─────────────────────────────────────────────────────────────────────
let currentTabId   = null;
let isCapturing    = false;
let allEntries     = [];      // raw entries from background
let selectedEntry  = null;   // currently shown in detail panel
let pollTimer      = null;
let resultsPollTimer = null; // polls /api/v1/results/<batch_id>

// Method + results filter state
let activeMethodFilter  = "ALL"; // "ALL" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
let activeResultsFilter = "all"; // "all" | "pass" | "fail" | "error"
let lastResultsData     = null;  // last received data, used for re-filter without re-fetch
let activeResultsApiKey = null;  // selected API group key (only this group shows test rows)
let selectedResultsApiLabel = null; // METHOD + URL from selected request row
let scrollSelectedApiOnNextRender = false;
let activeCategoryFilter = "all"; // "all" or testcase category string
let activeDetailCategoryFilter = "all";
let selectedDetailTestcaseKey = null;

// Keys used in chrome.storage.local to survive popup close/reopen
const RESULTS_STORAGE_KEY  = "activeResults";
const ENTRIES_STORAGE_KEY  = "capturedEntries";

// ── Captured entries persistence ──────────────────────────────────────────────

function saveEntriesState(tabId, entries) {
  if (!entries || !entries.length) return;
  chrome.storage.local.set({ [ENTRIES_STORAGE_KEY]: { tabId, entries, savedAt: Date.now() } });
}

function clearEntriesState() {
  chrome.storage.local.remove(ENTRIES_STORAGE_KEY);
}

// ── Results state persistence ──────────────────────────────────────────────

function saveResultsState(resultsUrl, data) {
  chrome.storage.local.set({
    [RESULTS_STORAGE_KEY]: {
      resultsUrl,
      data:      data || null,
      savedAt:   Date.now(),
    },
  });
}

function clearResultsState() {
  chrome.storage.local.remove(RESULTS_STORAGE_KEY);
  // Clear badge
  chrome.action.setBadgeText({ text: "" });
}

// ── Workflow steps ───────────────────────────────────────────────────────

/** Highlight step n as active; steps < n as done; steps > n as pending. */
function setWorkflowStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById(`step-${i}`);
    if (!el) return;
    el.className = `step ${i === n ? "step-active" : i < n ? "step-done" : "step-pending"}`;
  });
}

/**
 * On popup open: check if there was an in-progress or recently completed
 * batch.  If yes, restore the results panel and resume polling if needed.
 */
function restoreResultsState() {
  chrome.storage.local.get(RESULTS_STORAGE_KEY, stored => {
    const state = stored[RESULTS_STORAGE_KEY];
    if (!state || !state.resultsUrl) return;

    // Don't restore stale state (older than 2 hours)
    if (Date.now() - state.savedAt > 2 * 60 * 60 * 1000) {
      clearResultsState();
      return;
    }

    // Show whatever we last had immediately (no blank panel)
    if (state.data) {
      resultsPanel.classList.remove("hidden");
      renderResults(state.data);
    }

    const isDone = state.data && (
      state.data.status === "done" || state.data.status === "error"
    );

    if (isDone) {
      // Just show the stored results — no need to re-poll
      setWorkflowStep(3);
      resultsPanel.classList.remove("hidden");
      resultsSpinner.classList.add("hidden");
      resultsRestoredBadge.classList.remove("hidden");
      lastResultsData = state.data;
    } else {
      // Still running — resume polling
      resultsRestoredBadge.classList.remove("hidden");
      startResultsPolling(state.resultsUrl, /* restoring= */ true);
    }
  });
}

// ── Badge helpers ──────────────────────────────────────────────────────────

function updateBadge(data) {
  if (!data) { chrome.action.setBadgeText({ text: "" }); return; }

  const status = data.status;
  if (status === "pending") {
    chrome.action.setBadgeBackgroundColor({ color: "#7f849c" });
    chrome.action.setBadgeText({ text: "…" });
  } else if (status === "running") {
    const prog = data.progress || {};
    const label = prog.total ? `${prog.done}/${prog.total}` : "…";
    chrome.action.setBadgeBackgroundColor({ color: "#89b4fa" });
    chrome.action.setBadgeText({ text: label });
  } else if (status === "done") {
    const s = data.summary || {};
    const failed = (s.failed || 0) + (s.errors || 0);
    if (failed > 0) {
      chrome.action.setBadgeBackgroundColor({ color: "#f38ba8" });
      chrome.action.setBadgeText({ text: `✗${failed}` });
    } else {
      chrome.action.setBadgeBackgroundColor({ color: "#a6e3a1" });
      chrome.action.setBadgeText({ text: `✓${s.passed || 0}` });
    }
  } else if (status === "error") {
    chrome.action.setBadgeBackgroundColor({ color: "#f9e2af" });
    chrome.action.setBadgeText({ text: "!" });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value) {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

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

function normalizeMethod(method) {
  return String(method || "").trim().toUpperCase();
}

function normalizeUrlForMatch(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    // Match by origin + pathname; query strings may differ/order differently.
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(rawUrl || "").trim().replace(/\/+$/, "").toLowerCase();
  }
}

function parseApiRequestLabel(label) {
  const text = String(label || "").trim();
  const m = text.match(/^([A-Za-z]+)\s+(.+)$/);
  if (!m) {
    return { method: "", rawUrl: text, normalizedUrl: normalizeUrlForMatch(text) };
  }
  const method = normalizeMethod(m[1]);
  const rawUrl = m[2].trim();
  return { method, rawUrl, normalizedUrl: normalizeUrlForMatch(rawUrl) };
}

function isSameApiLabel(selectedLabel, groupLabel) {
  const s = parseApiRequestLabel(selectedLabel);
  const g = parseApiRequestLabel(groupLabel);
  if (!s.method || !g.method) {
    return s.normalizedUrl && s.normalizedUrl === g.normalizedUrl;
  }
  return s.method === g.method && s.normalizedUrl === g.normalizedUrl;
}

function cleanTestcaseTitle(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Unnamed testcase";
  // Remove common prefixes like: "POST /users - ", "GET https://...: "
  const withoutApiPrefix = raw.replace(
    /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\S+\s*(?:[-:|]|=>)\s*/i,
    ""
  );
  return withoutApiPrefix.trim() || raw;
}

/**
 * Build the export JSON object (the format the webhook endpoint expects).
 */
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

function setCapturingUI(active) {
  isCapturing = active;
  btnStart.disabled = active;
  btnStop.disabled  = !active;
  statusDot.className = active ? "dot dot-active" : "dot dot-idle";
  statusDot.title     = active ? "Capture active"  : "Capture inactive";
  if (active) setWorkflowStep(1);
}

function updateCount() {
  const n = allEntries.length;
  captureCount.textContent = `${n} request${n !== 1 ? "s" : ""}`;
  updateMethodCounts();
}

function updateMethodCounts() {
  const counts = {};
  allEntries.forEach(e => { const m = e.method || "?"; counts[m] = (counts[m] || 0) + 1; });
  document.querySelectorAll(".mf-btn").forEach(btn => {
    const m = btn.dataset.method;
    const countEl = btn.querySelector(".mf-count");
    if (countEl) countEl.textContent = m === "ALL" ? allEntries.length : (counts[m] || 0);
  });
}

// ── Filtering & rendering list ─────────────────────────────────────────────────

function filterEntries() {
  const q = filterInput.value.trim().toLowerCase();
  return allEntries.filter(e => {
    const methodOk = activeMethodFilter === "ALL" || e.method === activeMethodFilter;
    const textOk   = !q ||
      e.url.toLowerCase().includes(q) ||
      (e.method || "").toLowerCase().includes(q) ||
      String(e.status_code || "").includes(q);
    return methodOk && textOk;
  });
}

function renderList() {
  const entries = filterEntries();

  if (entries.length === 0) {
    requestList.innerHTML = isCapturing
      ? `<div class="empty-state empty-listening">● Recording API requests… browse the page</div>`
      : allEntries.length > 0
        ? `<div class="empty-state">No requests match the current filter.</div>`
        : `<div class="empty-state"><div class="empty-guide">
            <div class="empty-step"><b>1</b><span>Click <strong>▶ Start</strong> to begin recording</span></div>
            <div class="empty-step"><b>2</b><span>Browse the page — API calls appear here</span></div>
            <div class="empty-step"><b>3</b><span>Click <strong>■ Stop</strong> to send for AI testing</span></div>
          </div></div>`;
    return;
  }

  requestList.innerHTML = "";
  // Show newest first
  [...entries].reverse().forEach(entry => {
    const row = document.createElement("div");
    row.className = "request-row";
    if (selectedEntry && selectedEntry.requestId === entry.requestId) {
      row.classList.add("selected");
    }

    const urlShort = entry.url.length > 62
      ? "…" + entry.url.slice(-58)
      : entry.url;

    const dur = entry.duration_ms ? `<span class="req-dur">${entry.duration_ms}ms</span>` : "";
    row.innerHTML = `
      <span class="method-badge ${methodClass(entry.method)}">${entry.method || "?"}</span>
      <span class="entry-url" title="${entry.url}">${urlShort}</span>
      <span class="status-badge ${statusClass(entry.status_code)}">${entry.status_code || "…"}</span>
      ${dur}
    `;

    row.addEventListener("click", () => openDetail(entry));
    requestList.appendChild(row);
  });
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function openDetail(entry) {
  selectedEntry = entry;
  selectedResultsApiLabel = `${entry.method || "?"} ${entry.url || ""}`;
  activeResultsApiKey = null;
  scrollSelectedApiOnNextRender = true;
  activeDetailCategoryFilter = "all";
  selectedDetailTestcaseKey = null;

  // If results are already loaded, scope them to this selected API immediately.
  if (lastResultsData) {
    renderResults(lastResultsData);
  }

  // Header
  const urlObj = (() => { try { return new URL(entry.url); } catch { return null; } })();
  const statusInfo = entry.status_code ? `  [${entry.status_code}]` : "";
  detailTitle.textContent = urlObj
    ? `${entry.method}  ${urlObj.pathname}${statusInfo}`
    : `${entry.method}  ${entry.url}${statusInfo}`;

  // Request tab
  detailUrl.textContent        = entry.url;
  detailReqHeaders.textContent = fmt(entry.headers);
  detailPayload.textContent    = fmt(entry.payload);

  // Response tab
  detailStatus.textContent     = entry.status_code ? String(entry.status_code) : "pending";
  detailResHeaders.textContent = fmt(entry.response_headers);
  detailResponse.textContent   = fmt(entry.response);

  // Export tab
  const exportObj = toExportObject(entry);
  detailExport.textContent = JSON.stringify(exportObj, null, 2);

  detailPanel.classList.remove("hidden");
  renderList(); // re-render to update selection highlight
  renderDetailTestcaseWorkspace();

  // Default to Request tab
  switchTab("request");
}

btnCloseDetail.addEventListener("click", () => {
  detailPanel.classList.add("hidden");
  selectedEntry = null;
  selectedResultsApiLabel = null;
  activeDetailCategoryFilter = "all";
  selectedDetailTestcaseKey = null;
  renderDetailTestcaseWorkspace();
  if (lastResultsData) {
    renderResults(lastResultsData);
  }
  renderList();
});

function getSelectedApiCases() {
  if (!selectedResultsApiLabel || !lastResultsData) return [];
  const groups = (lastResultsData.groups || []).filter(group =>
    isSameApiLabel(selectedResultsApiLabel, group.api_request || "")
  );
  return groups.flatMap(group => group.test_results || []);
}

function renderDetailTestcaseWorkspace() {
  if (!apiTestcaseWorkspace || !apiTestcaseList || !apiTestcaseViewer || !apiTestcaseChips) return;

  if (!selectedEntry) {
    apiTestcaseWorkspace.classList.add("hidden");
    apiTestcaseList.innerHTML = "";
    apiTestcaseViewer.innerHTML = "";
    apiTestcaseChips.innerHTML = "";
    apiTestcaseChips.classList.add("hidden");
    return;
  }

  apiTestcaseWorkspace.classList.remove("hidden");

  if (!lastResultsData) {
    apiTestcaseSubtitle.textContent = "Run the AI analysis to generate testcases for this API.";
    apiTestcaseCount.textContent = "0 tests";
    apiTestcaseList.innerHTML = `<div class="api-viewer-empty">No generated testcases yet for this request.</div>`;
    apiTestcaseViewer.innerHTML = `<div class="api-viewer-empty">Generated testcase details will appear here after the batch finishes or resumes polling.</div>`;
    apiTestcaseChips.innerHTML = "";
    apiTestcaseChips.classList.add("hidden");
    return;
  }

  const allCases = getSelectedApiCases();
  apiTestcaseSubtitle.textContent = selectedResultsApiLabel || "Selected API";

  const categorySet = new Set(allCases.map(testcase => testcase.category).filter(Boolean));
  const categories = Array.from(categorySet).sort();
  if (categories.length) {
    apiTestcaseChips.innerHTML = [
      `<button class="api-chip ${activeDetailCategoryFilter === "all" ? "active" : ""}" data-category="all">All</button>`,
      ...categories.map(category =>
        `<button class="api-chip ${activeDetailCategoryFilter === category ? "active" : ""}" data-category="${escHtml(category)}">${escHtml(category.replace(/_/g, " "))}</button>`
      ),
    ].join("");
    apiTestcaseChips.classList.remove("hidden");
  } else {
    apiTestcaseChips.innerHTML = "";
    apiTestcaseChips.classList.add("hidden");
  }

  const visibleCases = allCases.filter(testcase =>
    activeDetailCategoryFilter === "all" || (testcase.category || "") === activeDetailCategoryFilter
  );
  apiTestcaseCount.textContent = `${visibleCases.length} test${visibleCases.length === 1 ? "" : "s"}`;

  if (!visibleCases.length) {
    apiTestcaseList.innerHTML = `<div class="api-viewer-empty">No testcases match the selected chip filter.</div>`;
    apiTestcaseViewer.innerHTML = `<div class="api-viewer-empty">Choose another chip or reset the filter to inspect testcase details.</div>`;
    return;
  }

  const availableKeys = visibleCases.map((testcase, index) => `${testcase.name || "testcase"}::${index}`);
  if (!selectedDetailTestcaseKey || !availableKeys.includes(selectedDetailTestcaseKey)) {
    selectedDetailTestcaseKey = availableKeys[0];
  }

  apiTestcaseList.innerHTML = "";
  let selectedCase = visibleCases[0];
  visibleCases.forEach((testcase, index) => {
    const testcaseKey = `${testcase.name || "testcase"}::${index}`;
    const item = document.createElement("div");
    item.className = `api-testcase-item${selectedDetailTestcaseKey === testcaseKey ? " active" : ""}`;
    const statusClass = testcase.error ? "error" : testcase.passed ? "pass" : "fail";
    item.innerHTML =
      `<div class="api-testcase-item-top">` +
        `<div class="api-testcase-name">${escHtml(cleanTestcaseTitle(testcase.name))}</div>` +
      `</div>` +
      `<div class="api-testcase-meta">` +
        `<span class="api-mini-status ${statusClass}">${testcase.error ? "ERROR" : testcase.passed ? "PASS" : "FAIL"}</span>` +
        `${testcase.category ? `<span class="api-mini-cat">${escHtml(testcase.category.replace(/_/g, " "))}</span>` : ""}` +
        `${testcase.actual_status ? `<span class="api-mini-cat">HTTP ${testcase.actual_status}</span>` : ""}` +
      `</div>`;
    item.addEventListener("click", () => {
      selectedDetailTestcaseKey = testcaseKey;
      renderDetailTestcaseWorkspace();
    });
    apiTestcaseList.appendChild(item);
    if (selectedDetailTestcaseKey === testcaseKey) {
      selectedCase = testcase;
    }
  });

  const viewerStatus = selectedCase.error ? "ERROR" : selectedCase.passed ? "PASS" : "FAIL";
  apiTestcaseViewer.innerHTML =
    `<div class="api-viewer-title">${escHtml(cleanTestcaseTitle(selectedCase.name))}</div>` +
    `<div class="api-viewer-row">` +
      `<span class="api-viewer-pill">${viewerStatus}</span>` +
      `${selectedCase.category ? `<span class="api-viewer-pill">${escHtml(selectedCase.category.replace(/_/g, " "))}</span>` : ""}` +
      `${selectedCase.expected_status ? `<span class="api-viewer-pill">Expected ${selectedCase.expected_status}</span>` : ""}` +
      `${selectedCase.actual_status ? `<span class="api-viewer-pill">Actual ${selectedCase.actual_status}</span>` : ""}` +
    `</div>` +
    `${selectedCase.description ? `<div class="api-viewer-section"><span class="api-viewer-label">Description</span><div class="api-viewer-text">${escHtml(selectedCase.description)}</div></div>` : ""}` +
    `${selectedCase.scenario_description ? `<div class="api-viewer-section"><span class="api-viewer-label">Scenario</span><div class="api-viewer-text">${escHtml(selectedCase.scenario_description)}</div></div>` : ""}` +
    `${selectedCase.request_body_note ? `<div class="api-viewer-section"><span class="api-viewer-label">Request Body Note</span><div class="api-viewer-text">${escHtml(selectedCase.request_body_note)}</div></div>` : ""}` +
    `<div class="api-viewer-section"><span class="api-viewer-label">Model Request</span><pre class="detail-json">${toPrettyJson(selectedCase.model_request || {
      method: selectedCase.method || null,
      url: selectedCase.url || null,
      headers: selectedCase.request_headers || null,
      payload: selectedCase.request_payload ?? null,
    })}</pre></div>` +
    `${selectedCase.assertion_notes ? `<div class="api-viewer-section"><span class="api-viewer-label">Assertions</span><div class="api-viewer-text">${escHtml(selectedCase.assertion_notes)}</div></div>` : ""}` +
    `${selectedCase.error ? `<div class="api-viewer-section"><span class="api-viewer-label">Error</span><div class="api-viewer-text">${escHtml(selectedCase.error)}</div></div>` : ""}` +
    `${selectedCase.failure_suggestion ? `<div class="api-viewer-section"><span class="api-viewer-label">Suggestion</span><div class="api-viewer-text">${escHtml(selectedCase.failure_suggestion)}</div></div>` : ""}`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".tab-content").forEach(div => {
    div.classList.toggle("active", div.id === `tab-${name}`);
  });
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ── Copy & Download ───────────────────────────────────────────────────────────

btnCopy.addEventListener("click", async () => {
  if (!selectedEntry) return;
  const text = JSON.stringify(toExportObject(selectedEntry), null, 2);
  await navigator.clipboard.writeText(text);
  btnCopy.textContent = "OK Copied!";
  setTimeout(() => { btnCopy.textContent = "Copy"; }, 1500);
});

btnDownload.addEventListener("click", () => {
  if (!selectedEntry) return;
  const exportObj = toExportObject(selectedEntry);
  const text = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url  = URL.createObjectURL(blob);

  // Derive a filename from the URL path
  const urlObj  = (() => { try { return new URL(selectedEntry.url); } catch { return null; } })();
  const slug    = urlObj
    ? urlObj.pathname.replace(/\//g, "_").replace(/^_/, "").replace(/[^a-z0-9_.-]/gi, "") || "api"
    : "api";
  const fname   = `api_log_${slug}.json`;

  chrome.downloads.download({ url, filename: fname, saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
// ── Results panel: poll + render ───────────────────────────────────────────────

function startResultsPolling(resultsUrl, restoring = false) {
  setWorkflowStep(2);
  resultsPanel.classList.remove("hidden");
  activeResultsApiKey = null;
  activeCategoryFilter = "all";
  if (!restoring) {
    // Fresh start — clear old content
    resultsStatusText.textContent = "Connecting to Ollama…";
    resultsSpinner.classList.remove("hidden");
    resultsSummary.classList.add("hidden");
    resultsList.innerHTML = "";
    resultsRestoredBadge.classList.add("hidden");
    if (resultsProgressWrap) { resultsProgressWrap.classList.add("hidden"); resultsProgressBar.style.width = "0%"; }
    saveResultsState(resultsUrl, null);
  }

  if (resultsPollTimer) clearInterval(resultsPollTimer);
  resultsPollTimer = setInterval(() => fetchResults(resultsUrl), 2000);
  fetchResults(resultsUrl); // immediate first fetch
}

function testMatchesFilter(r) {
  if (activeResultsFilter === "pass" && !(r.passed && !r.error)) return false;
  if (activeResultsFilter === "fail" && !(!r.passed && !r.error)) return false;
  if (activeResultsFilter === "error" && !r.error) return false;
  if (activeCategoryFilter !== "all" && (r.category || "") !== activeCategoryFilter) return false;
  return true;
}

function renderCategoryChips(categories) {
  if (!resultsCategoryFilter) return;
  if (!categories.length) {
    resultsCategoryFilter.classList.add("hidden");
    resultsCategoryFilter.innerHTML = "";
    return;
  }
  const chips = [
    `<button class="rcf-btn ${activeCategoryFilter === "all" ? "active" : ""}" data-category="all">All Categories</button>`,
    ...categories.map(cat =>
      `<button class="rcf-btn ${activeCategoryFilter === cat ? "active" : ""}" data-category="${escHtml(cat)}">${escHtml(cat.replace(/_/g, " "))}</button>`
    ),
  ];
  resultsCategoryFilter.innerHTML = chips.join("");
  resultsCategoryFilter.classList.remove("hidden");
}

function resetAllFilters() {
  // Request list filters
  activeMethodFilter = "ALL";
  if (filterInput) {
    filterInput.value = "";
  }
  document.querySelectorAll(".mf-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.method === "ALL");
  });

  // Results filters
  activeResultsFilter = "all";
  activeCategoryFilter = "all";
  selectedResultsApiLabel = null;
  activeResultsApiKey = null;
  scrollSelectedApiOnNextRender = false;
  activeDetailCategoryFilter = "all";
  selectedDetailTestcaseKey = null;
  document.querySelectorAll(".rf-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === "all");
  });

  renderList();
  renderDetailTestcaseWorkspace();
  if (lastResultsData) {
    renderResults(lastResultsData);
  }
}

function appendResultRow(container, r) {
  const wrapper = document.createElement("div");
  wrapper.className = "result-row-wrapper";

  const icon  = r.error ? "!" : r.passed ? "OK" : "X";
  const cls   = r.error ? "result-error" : r.passed ? "result-pass" : "result-fail";
  const category = r.category || "";
  const catLabel = category ? `<span class="cat-badge cat-${escHtml(category)}" title="Filter by this category">${escHtml(category.replace(/_/g, " "))}</span>` : "";
  const badge = r.actual_status
    ? `<span class="res-status ${statusBadgeClass(r.actual_status, r.passed)}">${r.actual_status}</span>`
    : (r.expected_status ? `<span class="res-status res-status-expected">exp ${r.expected_status}</span>` : "");
  const dur = r.duration_ms != null ? `<span class="res-dur">${r.duration_ms}ms</span>` : "";

  const summary = document.createElement("div");
  summary.className = `result-row ${cls}`;
  summary.innerHTML =
    `<span class="result-icon">${icon}</span>` +
    `<span class="result-name" title="${escHtml(r.name || "")}">${escHtml(r.name || "")}</span>` +
    `${catLabel}${badge}${dur}` +
    `<span class="result-expand-btn" title="Show details">›</span>`;

  const catBadgeEl = summary.querySelector(".cat-badge");
  if (catBadgeEl) {
    catBadgeEl.addEventListener("click", ev => {
      ev.stopPropagation();
      activeCategoryFilter = category || "all";
      if (lastResultsData) renderResults(lastResultsData);
    });
  }

  const detail = document.createElement("div");
  detail.className = "result-detail hidden";

  let detailHtml = "";
  if (r.description) {
    detailHtml += `<div class="detail-desc">${escHtml(r.description)}</div>`;
  }
  if (r.scenario_description) {
    detailHtml += `<div class="detail-section"><span class="detail-label">Scenario</span>${escHtml(r.scenario_description)}</div>`;
  }
  if (r.request_body_note) {
    detailHtml += `<div class="detail-section"><span class="detail-label">Request Body Note</span>${escHtml(r.request_body_note)}</div>`;
  }

  const modelReq = r.model_request || {
    method: r.method || null,
    url: r.url || null,
    headers: r.request_headers || null,
    payload: r.request_payload ?? null,
  };
  detailHtml +=
    `<div class="detail-section">` +
      `<span class="detail-label">Request From Model Test Case</span>` +
      `<pre class="detail-json">${toPrettyJson(modelReq)}</pre>` +
    `</div>`;

  if (r.assertion_notes) {
    detailHtml += `<div class="detail-section"><span class="detail-label">🔍 Assert</span>${escHtml(r.assertion_notes)}</div>`;
  }
  if (r.error) {
    detailHtml += `<div class="detail-section detail-error-msg"><span class="detail-label">❌ Error</span>${escHtml(r.error)}</div>`;
  }
  if (r.failure_suggestion && (!r.passed || r.error)) {
    detailHtml += `<div class="detail-suggestion"><span class="detail-label">💡 Suggestion</span>${escHtml(r.failure_suggestion)}</div>`;
  }
  detail.innerHTML = detailHtml || `<div class="detail-desc">No additional details.</div>`;

  summary.addEventListener("click", () => {
    const isOpen = !detail.classList.contains("hidden");
    detail.classList.toggle("hidden", isOpen);
    summary.classList.toggle("expanded", !isOpen);
    summary.querySelector(".result-expand-btn").textContent = isOpen ? "›" : "⌄";
  });

  wrapper.appendChild(summary);
  wrapper.appendChild(detail);
  container.appendChild(wrapper);
}

async function fetchResults(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      resultsStatusText.textContent = `Server error: HTTP ${resp.status}`;
      return;
    }
    const data = await resp.json();
    lastResultsData = data;
    renderDetailTestcaseWorkspace();
    renderResults(data);
    saveResultsState(url, data);  // persist latest data across popup close
    updateBadge(data);            // update extension icon badge
    // Update progress bar
    if (resultsProgressWrap) {
      const prog = data.progress || {};
      if (prog.total > 0 || data.status === "done") {
        resultsProgressWrap.classList.remove("hidden");
        const pct = data.status === "done" ? 100 : Math.round((prog.done / prog.total) * 100);
        resultsProgressBar.style.width = `${pct}%`;
        resultsProgressBar.className = `progress-bar${data.status === "done" ? " progress-done" : ""}`;
      }
    }
    if (data.status === "done" || data.status === "error") {
      setWorkflowStep(3);
      clearInterval(resultsPollTimer);
      resultsPollTimer = null;
      resultsSpinner.classList.add("hidden");
    }
  } catch (err) {
    resultsStatusText.textContent = `Cannot reach server: ${err.message}`;
    renderDetailTestcaseWorkspace();
  }
}

function renderResults(data) {
  // Status message
  resultsStatusText.textContent = data.message || data.status || "Working…";

  // Spinner
  const running = data.status === "running" || data.status === "pending";
  resultsSpinner.classList.toggle("hidden", !running);

  // Summary chips
  const s = data.summary || {};
  if (s.total > 0 || data.status === "done") {
    resultsSummary.classList.remove("hidden");
    sumPassed.textContent = `${s.passed || 0} Passed`;
    sumFailed.textContent = `${s.failed || 0} Failed`;
    sumErrors.textContent = `${s.errors || 0} Errors`;
    sumPassed.className = `sum-chip sum-pass${(s.passed || 0) > 0 ? " active" : ""}`;
    sumFailed.className = `sum-chip sum-fail${(s.failed || 0) > 0 ? " active" : ""}`;
    sumErrors.className = `sum-chip sum-err${(s.errors  || 0) > 0 ? " active" : ""}`;
  }

  // Per-test rows (optionally scoped to selected API)
  resultsList.innerHTML = "";
  const allGroups = data.groups || [];
  const groups = selectedResultsApiLabel
    ? allGroups.filter(g => isSameApiLabel(selectedResultsApiLabel, g.api_request || ""))
    : allGroups;

  if (groups.length === 0 && selectedResultsApiLabel) {
    resultsList.innerHTML = `<div class="results-empty">No test cases found for selected API: ${escHtml(selectedResultsApiLabel)}</div>`;
    return;
  }
  if (groups.length === 0 && running) {
    resultsList.innerHTML = `<div class="results-empty"><span class="results-generating">Generating test cases via Ollama...</span></div>`;
    return;
  }
  if (groups.length === 0 && !running) {
    resultsList.innerHTML = `<div class="results-empty">No results yet.</div>`;
    return;
  }

  const categories = new Set();
  groups.forEach(group => {
    (group.test_results || []).forEach(r => {
      if ((r.category || "") && (activeResultsFilter === "all" || (activeResultsFilter === "pass" && r.passed && !r.error) || (activeResultsFilter === "fail" && !r.passed && !r.error) || (activeResultsFilter === "error" && !!r.error))) {
        categories.add(r.category);
      }
    });
  });
  renderCategoryChips(Array.from(categories).sort());

  let selectedGroupStillExists = false;
  const shouldAutoOpenSelectedApi = !!selectedResultsApiLabel;

  if (selectedResultsApiLabel) {
    // In request-detail scope mode, show testcases directly (no API collapse header).
    groups.forEach(group => {
      const visible = (group.test_results || []).filter(testMatchesFilter);
      visible.forEach(r => appendResultRow(resultsList, r));
    });

    if (!resultsList.children.length) {
      resultsList.innerHTML = `<div class="results-empty">No test cases match the current filters for selected API.</div>`;
    }

    // Hide API scope chip per UX request; selection is already implied by request detail panel.
    if (resultsScope && btnClearResultsScope) {
      resultsScope.textContent = "";
      resultsScope.classList.add("hidden");
      btnClearResultsScope.classList.add("hidden");
    }

    if (resultsFilterCount) {
      const total = groups.reduce((n, g) => n + (g.test_results || []).filter(testMatchesFilter).length, 0);
      resultsFilterCount.textContent = `${total} tests`;
    }
    return;
  }

  groups.forEach((group, idx) => {
    const groupKey = `${group.api_request || "api"}::${idx}`;
    if (shouldAutoOpenSelectedApi && activeResultsApiKey === null && idx === 0) {
      activeResultsApiKey = groupKey;
    }
    if (activeResultsApiKey === groupKey) selectedGroupStillExists = true;

    // Group header — clickable to expand/collapse test cases
    const header = document.createElement("div");
    header.className = "results-group-header";
    const gs = group.summary || {};
    const isScopedMatch = selectedResultsApiLabel && isSameApiLabel(selectedResultsApiLabel, group.api_request || "");

    // Filter tests before deciding whether to render this group
    const _visibleTests = (group.test_results || []).filter(testMatchesFilter);
    if (_visibleTests.length === 0 && activeResultsFilter !== "all") return;

    const testCount = _visibleTests.length;
    header.innerHTML =
      `<span class="group-chevron">▶</span>` +
      `<span class="results-group-label">${escHtml(group.api_request || "")}</span>` +
      `<span class="results-group-meta">` +
        `<span class="chip-pass">${gs.passed || 0}</span> ` +
        `<span class="chip-fail">${gs.failed || 0}</span>` +
        (gs.errors > 0 ? ` <span class="chip-err">${gs.errors}</span>` : "") +
        ` <span class="chip-total">${testCount} tests</span>` +
      `</span>`;
    if (group.error) header.innerHTML += `<div class="group-error">! ${escHtml(group.error)}</div>`;

    // Collapsible container — collapsed by default
    const testsContainer = document.createElement("div");
    const isActiveGroup = activeResultsApiKey === groupKey;
    testsContainer.className = isActiveGroup ? "group-tests" : "group-tests collapsed";
    header.classList.toggle("group-expanded", isActiveGroup);
    header.classList.toggle("group-selected-api", !!isScopedMatch);

    // Toggle selected API group; only selected API shows test cases.
    header.addEventListener("click", () => {
      activeResultsApiKey = activeResultsApiKey === groupKey ? null : groupKey;
      if (lastResultsData) renderResults(lastResultsData);
    });

    resultsList.appendChild(header);

    _visibleTests.forEach(r => appendResultRow(testsContainer, r));

    resultsList.appendChild(testsContainer);
  });

  if (scrollSelectedApiOnNextRender && selectedResultsApiLabel) {
    const selectedHeader = resultsList.querySelector(".results-group-header.group-selected-api");
    if (selectedHeader) {
      selectedHeader.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    scrollSelectedApiOnNextRender = false;
  }

  if (activeResultsApiKey && !selectedGroupStillExists) {
    activeResultsApiKey = null;
  }

  // Update filter count + selected-API scope label
  if (resultsFilterCount) {
    const total = groups.reduce((n, g) => n + (g.test_results || []).length, 0);
    resultsFilterCount.textContent = activeResultsFilter === "all" ? `${total} tests` : "";
  }
  if (resultsScope && btnClearResultsScope) {
    resultsScope.textContent = "";
    resultsScope.classList.add("hidden");
    btnClearResultsScope.classList.add("hidden");
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toPrettyJson(value) {
  try {
    return escHtml(JSON.stringify(value, null, 2));
  } catch {
    return escHtml(String(value));
  }
}

function statusBadgeClass(code, passed) {
  if (!code) return "";
  if (passed) return "res-status-pass";
  if (code < 300) return "res-status-pass";
  if (code < 400) return "res-status-redirect";
  if (code < 500) return "res-status-client";
  return "res-status-server";
}

btnCloseResults.addEventListener("click", () => {
  resultsPanel.classList.add("hidden");
  if (resultsPollTimer) { clearInterval(resultsPollTimer); resultsPollTimer = null; }
  clearResultsState(); // forget this batch — user explicitly dismissed
});

// ── Results filter tabs ───────────────────────────────────────────────────────

document.querySelectorAll(".rf-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".rf-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeResultsFilter = btn.dataset.filter;
    if (lastResultsData) renderResults(lastResultsData);
  });
});

if (btnClearResultsScope) {
  btnClearResultsScope.addEventListener("click", () => {
    selectedResultsApiLabel = null;
    activeResultsApiKey = null;
    scrollSelectedApiOnNextRender = false;
    if (lastResultsData) renderResults(lastResultsData);
  });
}

if (resultsCategoryFilter) {
  resultsCategoryFilter.addEventListener("click", ev => {
    const btn = ev.target.closest(".rcf-btn");
    if (!btn) return;
    activeCategoryFilter = btn.dataset.category || "all";
    if (lastResultsData) renderResults(lastResultsData);
  });
}

if (apiTestcaseChips) {
  apiTestcaseChips.addEventListener("click", ev => {
    const btn = ev.target.closest(".api-chip");
    if (!btn) return;
    activeDetailCategoryFilter = btn.dataset.category || "all";
    selectedDetailTestcaseKey = null;
    renderDetailTestcaseWorkspace();
  });
}

if (btnResetAllFilters) {
  btnResetAllFilters.addEventListener("click", resetAllFilters);
}

// ── Expand / Collapse all ───────────────────────────────────────────────────

btnExpandAll.addEventListener("click", () => {
  // Expand all API groups
  document.querySelectorAll(".group-tests").forEach(el => el.classList.remove("collapsed"));
  document.querySelectorAll(".results-group-header").forEach(h => {
    h.classList.add("group-expanded");
  });
  // Expand all individual test details
  document.querySelectorAll(".result-detail").forEach(el => el.classList.remove("hidden"));
  document.querySelectorAll(".result-row").forEach(row => {
    row.classList.add("expanded");
    const arrow = row.querySelector(".result-expand-btn");
    if (arrow) arrow.textContent = "⌄";
  });
});

btnCollapseAll.addEventListener("click", () => {
  // Collapse all API groups
  document.querySelectorAll(".group-tests").forEach(el => el.classList.add("collapsed"));
  document.querySelectorAll(".results-group-header").forEach(h => {
    h.classList.remove("group-expanded");
  });
  // Collapse all individual test details
  document.querySelectorAll(".result-detail").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".result-row").forEach(row => {
    row.classList.remove("expanded");
    const arrow = row.querySelector(".result-expand-btn");
    if (arrow) arrow.textContent = "›";
  });
});

// ── Webhook URL save / load ───────────────────────────────────────────────────────────

function showWebhookStatus(msg, type) {
  webhookStatus.textContent = msg;
  webhookStatus.className   = `webhook-status webhook-status-${type}`;
  webhookStatus.classList.remove("hidden");
  setTimeout(() => { webhookStatus.classList.add("hidden"); }, 4000);
}

/** Get the current saved webhook URL from storage. */
function getSavedWebhookUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get("webhookUrl", data => resolve(data.webhookUrl || ""));
  });
}

btnSaveWebhook.addEventListener("click", () => {
  const url = webhookUrlInput.value.trim();
  if (url && !url.startsWith("http")) {
    showWebhookStatus("URL must start with http:// or https://", "warn");
    return;
  }
  chrome.storage.local.set({ webhookUrl: url }, () => {
    showWebhookStatus(url ? "Webhook URL saved" : "Webhook URL cleared", "ok");
  });
});

// ── Webhook connection test ───────────────────────────────────────────────

async function testWebhookConnection() {
  const rawUrl = webhookUrlInput.value.trim() || await getSavedWebhookUrl();
  if (!rawUrl) { showWebhookStatus("Enter the webhook URL first", "warn"); return; }
  let healthUrl;
  try {
    const u = new URL(rawUrl);
    healthUrl = `${u.protocol}//${u.host}/health`;
  } catch {
    showWebhookStatus("Invalid URL format", "warn");
    return;
  }
  btnTestWebhook.disabled = true;
  btnTestWebhook.textContent = "...";
  try {
    const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(4000) });
    if (resp.ok) {
      const d = await resp.json();
      showWebhookStatus(`Server online - model: ${d.ollama_model || "?"}`, "ok");
    } else {
      showWebhookStatus(`Server returned HTTP ${resp.status}`, "warn");
    }
  } catch (err) {
    showWebhookStatus(`Cannot reach server (${err.message})`, "err");
  } finally {
    btnTestWebhook.disabled = false;
    btnTestWebhook.textContent = "⚡ Test";
  }
}

btnTestWebhook.addEventListener("click", testWebhookConnection);
// ── Polling background for new entries ────────────────────────────────────────

function pollEntries() {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ action: "getLog", tabId: currentTabId }, res => {
    if (chrome.runtime.lastError) return;
    allEntries = res.entries || [];
    if (allEntries.length) saveEntriesState(currentTabId, allEntries);
    updateCount();
    renderList();
    // If selected entry was updated, refresh detail
    if (selectedEntry) {
      const updated = allEntries.find(e => e.requestId === selectedEntry.requestId);
      if (updated && updated.status_code !== selectedEntry.status_code) {
        openDetail(updated);
      }
    }
  });
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollEntries, 800);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// ── Control buttons ───────────────────────────────────────────────────────────

btnStart.addEventListener("click", () => {
  if (!currentTabId) return;
  // Starting a new capture clears any previous results
  clearResultsState();
  resultsPanel.classList.add("hidden");
  if (resultsProgressWrap) { resultsProgressWrap.classList.add("hidden"); resultsProgressBar.style.width = "0%"; }
  if (resultsPollTimer) { clearInterval(resultsPollTimer); resultsPollTimer = null; }
  setWorkflowStep(1);
  lastResultsData = null;
  chrome.runtime.sendMessage({ action: "start", tabId: currentTabId }, res => {
    if (res && res.ok) {
      setCapturingUI(true);
      startPolling();
    } else {
      alert("Failed to start capture: " + (res?.error || "unknown error"));
    }
  });
});

btnStop.addEventListener("click", async () => {
  if (!currentTabId) return;

  btnStop.disabled = true;
  btnStop.textContent = "Sending...";

  const webhookUrl = await getSavedWebhookUrl();

  chrome.runtime.sendMessage({ action: "stop", tabId: currentTabId, webhookUrl }, res => {
    setCapturingUI(false);
    stopPolling();
    btnStop.textContent = "■ Stop";

    if (res && res.sent) {
      showWebhookStatus(`Sent ${res.total} request${res.total !== 1 ? "s" : ""} to webhook (HTTP ${res.status})`, "ok");
      // Start polling for results if server returned a results URL
      if (res.resultsUrl) {
        startResultsPolling(res.resultsUrl);
      }
    } else if (webhookUrl && res && !res.sent) {
      const reason = res.error
        ? `Failed: ${res.error}`
        : res.total === 0
          ? "Nothing to send (0 requests captured)"
          : "Webhook URL not set";
      showWebhookStatus(`${reason}`, "warn");
    }

    pollEntries(); // one final UI refresh
  });
});

btnClear.addEventListener("click", () => {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ action: "clear", tabId: currentTabId }, () => {
    allEntries = [];
    selectedEntry = null;
    detailPanel.classList.add("hidden");
    clearEntriesState();
    updateCount();
    renderList();
  });
});

filterInput.addEventListener("input", renderList);

// ── Listen for detach events from background ──────────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "detached" && msg.tabId === currentTabId) {
    setCapturingUI(false);
    stopPolling();
  }
});

// ── Method filter pill click handlers ────────────────────────────────────────

document.querySelectorAll(".mf-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mf-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeMethodFilter = btn.dataset.method;
    renderList();
  });
});

// ── Theme (dark/light mode) ───────────────────────────────────────────────────

const THEME_STORAGE_KEY = "openapi_theme";
const btnTheme = document.getElementById("btn-theme");

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.className = theme;
  if (btnTheme) btnTheme.textContent = theme === "dark" ? "☀" : "☾";
}

function loadTheme() {
  chrome.storage.local.get(THEME_STORAGE_KEY, data => {
    applyTheme(data[THEME_STORAGE_KEY] || getSystemTheme());
  });
}

if (btnTheme) {
  btnTheme.addEventListener("click", () => {
    const next = document.documentElement.className === "dark" ? "light" : "dark";
    applyTheme(next);
    chrome.storage.local.set({ [THEME_STORAGE_KEY]: next });
  });
}

// Listen for system theme changes (only applies if user hasn't set a manual preference)
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", e => {
  chrome.storage.local.get(THEME_STORAGE_KEY, data => {
    if (!data[THEME_STORAGE_KEY]) applyTheme(e.matches ? "light" : "dark");
  });
});

// Load theme on startup
loadTheme();

// ── Init ──────────────────────────────────────────────────────────────────────

// Full-page mode: when opened as a tab, apply wider layout
if (new URLSearchParams(window.location.search).get("fullpage") === "1") {
  document.body.classList.add("fullpage");
  if (btnFullpage) btnFullpage.style.display = "none"; // already full page
  if (btnCompact)  btnCompact.style.display  = "";     // show revert button
}

// Revert to compact popup view
if (btnCompact) {
  btnCompact.addEventListener("click", () => { window.close(); });
}

// Open as a full-page tab (pass current tabId so full-page view knows which tab to fetch from)
if (btnFullpage) {
  btnFullpage.addEventListener("click", () => {
    const tabParam = currentTabId ? `&tabId=${currentTabId}` : "";
    const url = chrome.runtime.getURL("popup.html") + `?fullpage=1${tabParam}`;
    chrome.tabs.create({ url });
  });
}

function initWithTabId(tabId) {
  currentTabId = tabId;

  setWorkflowStep(1);

  // Restore saved webhook URL
  getSavedWebhookUrl().then(url => { webhookUrlInput.value = url; });

  // Restore results panel if a batch was in progress when popup was closed
  restoreResultsState();

  // Restore persisted entries (survives service-worker restarts and full-page tab)
  chrome.storage.local.get(ENTRIES_STORAGE_KEY, stored => {
    const saved = stored[ENTRIES_STORAGE_KEY];
    if (saved && saved.entries && saved.entries.length) {
      allEntries = saved.entries;
      updateCount();
      renderList();
    }
  });

  // Restore state if capture was already running
  chrome.runtime.sendMessage({ action: "status", tabId: currentTabId }, res => {
    if (res && res.attached) {
      setCapturingUI(true);
      startPolling();
    }
    pollEntries();
  });
}

// In full-page mode the tabId is passed via URL param (the full-page tab itself
// is not the tab being debugged, so chrome.tabs.query would return the wrong tab)
const _urlTabId = new URLSearchParams(window.location.search).get("tabId");
if (_urlTabId) {
  initWithTabId(parseInt(_urlTabId, 10));
} else {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs.length) return;
    initWithTabId(tabs[0].id);
  });
}
