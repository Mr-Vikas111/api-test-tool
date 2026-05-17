/**
 * main.js  —  Entry point (ES module)
 *
 * Wires together all extracted modules (toast, shortcuts, focus, storage,
 * filter, list, detail) and contains the remaining orchestration logic
 * that directly interacts with the Chrome extension APIs.
 *
 * Replaces the monolithic popup.js.
 */

"use strict";

// ── Module imports ──────────────────────────────────────────────────────────
import { showToast, clearToasts } from "./toast.js";
import { register, setViewContext, setEnabled as setShortcutsEnabled, initShortcuts } from "./shortcuts.js";
import { autoFocus, focusFirst, isVisible } from "./focus.js";
import { get, set, remove, getWithTTL } from "./storage.js";
import {
  setTextFilter, setMethodFilter, getMethodFilter, getTextFilter,
  filterEntries, saveState as saveFilterState, restoreState as restoreFilterState, resetFilters,
} from "./filter.js";
import {
  setEntries, getEntries, getSelectedEntry, setSelectedEntry,
  renderList, updateCount, setLiveStatus, updateMethodCounts,
  onSelect as listOnSelect, onRowCreate as listOnRowCreate,
} from "./list.js";
import { initBatch, addCheckboxToRow, clearSelection } from "./batch.js";
import {
  openDetail, closeDetail, switchTab,
  initDetailEvents, setLastResultsData, renderTestcaseWorkspace,
} from "./detail.js";

// ── Constants ──────────────────────────────────────────────────────────────

const RESULTS_STORAGE_KEY = "activeResults";
const ENTRIES_STORAGE_KEY = "capturedEntries";
const THEME_STORAGE_KEY = "openapi_theme";
const WEBHOOK_STORAGE_KEY = "webhookUrl";

// ── State ──────────────────────────────────────────────────────────────────

let currentTabId = null;
let isCapturing = false;
let pollTimer = null;
let resultsPollTimer = null;

// Method + results filter state
let activeMethodFilter = "ALL";
let activeResultsFilter = "all";
let lastResultsData = null;
let activeResultsApiKey = null;
let selectedResultsApiLabel = null;
let scrollSelectedApiOnNextRender = false;
let activeCategoryFilter = "all";
let activeDetailCategoryFilter = "all";
let selectedDetailTestcaseKey = null;

// ── DOM refs ───────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const btnStart       = $("btn-start");
const btnStop        = $("btn-stop");
const btnClear       = $("btn-clear");
const btnConfirmClear = $("btn-confirm-clear");
const btnCancelClear  = $("btn-cancel-clear");
const statusDot      = $("status-dot");
const filterInput    = $("filter-input");
const webhookUrlInput = $("webhook-url");
const btnSaveWebhook  = $("btn-save-webhook");
const btnTestWebhook  = $("btn-test-webhook");
const webhookStatus   = $("webhook-status");

// Results panel
const resultsPanel      = $("results-panel");
const btnCloseResults   = $("btn-close-results");
const resultsStatusText = $("results-status-text");
const resultsSpinner    = $("results-spinner");
const resultsSummary    = $("results-summary");
const sumPassed         = $("sum-passed");
const sumFailed         = $("sum-failed");
const sumErrors         = $("sum-errors");
const resultsList       = $("results-list");
const resultsRestoredBadge = $("results-restored-badge");
const btnExpandAll        = $("btn-expand-all");
const btnCollapseAll      = $("btn-collapse-all");
const resultsProgressWrap = $("results-progress-wrap");
const resultsProgressBar  = $("results-progress-bar");
const resultsFilterCount  = $("results-filter-count");
const resultsScope        = $("results-scope");
const btnClearResultsScope = $("btn-clear-results-scope");
const resultsCategoryFilter = $("results-category-filter");
const btnResetAllFilters   = $("btn-reset-all-filters");
const btnFullpage          = $("btn-fullpage");
const btnCompact           = $("btn-compact");
const clearConfirm         = $("clear-confirm");
const resultsSearch       = $("results-search");

// Results full-text search query
let resultsSearchQuery = "";

// ── Workflow steps (clickable tab navigation) ─────────────────────────────

const VIEW_NAMES = ["capture", "analyze", "results"];

function setWorkflowStep(n, { skipViewSwitch = false } = {}) {
  [1, 2, 3].forEach(i => {
    const el = $(`step-${i}`);
    if (!el) return;
    const isDone = i < n;
    const isActive = i === n;
    el.className = `step ${isActive ? "step-active" : isDone ? "step-done" : "step-pending"}`;
    el.disabled = false;
    el.setAttribute("aria-selected", isActive ? "true" : "false");
    el.setAttribute("aria-label", `Step ${i}: ${["Capture","Analyze","Results"][i-1]}${isActive ? " active" : isDone ? " done" : " pending"}`);
  });

  // Lock future steps (can't jump to step 3 if step 2 hasn't started)
  for (let i = n + 1; i <= 3; i++) {
    const el = $(`step-${i}`);
    if (el) el.disabled = true;
  }

  if (!skipViewSwitch) {
    switchView(VIEW_NAMES[n - 1]);
  }
}

function switchView(viewName) {
  // Remove all view classes and add the active one
  document.body.classList.remove("view-capture", "view-analyze", "view-results");
  document.body.classList.add(`view-${viewName}`);
  setViewContext(viewName);

  // Hide/shows panels appropriately
  if (viewName === "capture") {
    // Detail panel stays open if it was open
  } else if (viewName === "analyze") {
    // Results panel should be visible
    resultsPanel.classList.remove("hidden");
  } else if (viewName === "results") {
    resultsPanel.classList.remove("hidden");
  }
}

function initWorkflowSteps() {
  [1, 2, 3].forEach(i => {
    const el = $(`step-${i}`);
    if (!el) return;
    el.addEventListener("click", () => {
      if (el.disabled) return;
      setWorkflowStep(i);
    });
  });
}

// ── Captured entries persistence ──────────────────────────────────────────

function saveEntriesState(tabId, entries) {
  if (!entries || !entries.length) return;
  set(ENTRIES_STORAGE_KEY, { tabId, entries, savedAt: Date.now() });
}

function clearEntriesState() {
  remove(ENTRIES_STORAGE_KEY);
}

// ── Results state persistence ──────────────────────────────────────────

function saveResultsState(resultsUrl, data) {
  setWithTimestamp(RESULTS_STORAGE_KEY, { resultsUrl, data: data || null });
}

function clearResultsState() {
  remove(RESULTS_STORAGE_KEY);
  chrome.action.setBadgeText({ text: "" });
}

// ── Results state restore ───────────────────────────────────────────────

function restoreResultsState() {
  getWithTTL(RESULTS_STORAGE_KEY, 2 * 60 * 60 * 1000).then(state => {
    if (!state || !state.resultsUrl) return;

    if (state.data) {
      resultsPanel.classList.remove("hidden");
      renderResults(state.data);
    }

    const isDone = state.data && (
      state.data.status === "done" || state.data.status === "error"
    );

    if (isDone) {
      setWorkflowStep(3);
      resultsPanel.classList.remove("hidden");
      resultsSpinner.classList.add("hidden");
      resultsRestoredBadge.classList.remove("hidden");
      lastResultsData = state.data;
      setLastResultsData(state.data);
    } else {
      resultsRestoredBadge.classList.remove("hidden");
      startResultsPolling(state.resultsUrl, true);
    }
  });
}

// ── Session timeline ──────────────────────────────────────────────────────

function renderTimeline() {
  const timeline = $("timeline");
  if (!timeline) return;

  const entries = getEntries();
  if (entries.length < 2) {
    timeline.classList.add("hidden");
    return;
  }

  timeline.classList.remove("hidden");
  timeline.innerHTML = '<div class="timeline-bar"></div>';
  const bar = timeline.querySelector(".timeline-bar");

  // Use timestamps to calculate relative positions and heights
  const times = entries.map(e => new Date(e.timestamp).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const range = Math.max(maxTime - minTime, 1);

  entries.forEach((entry, i) => {
    const elapsed = (new Date(entry.timestamp).getTime() - minTime) / range;
    const height = Math.max(30, Math.min(100, elapsed * 100));
    const isPending = !entry.status_code;

    const dot = document.createElement("div");
    dot.className = `timeline-entry method-${(entry.method || "GET").toUpperCase()}${isPending ? " timeline-pending" : ""}`;
    dot.style.height = `${height}%`;
    dot.setAttribute("data-tooltip", `${entry.method} ${new URL(entry.url).pathname}`);
    dot.setAttribute("aria-label", `${entry.method} ${entry.url}`);
    dot.title = `${entry.method} ${entry.url}`;

    dot.addEventListener("click", () => {
      // Scroll to this entry in the list
      requestAnimationFrame(() => {
        const rows = document.querySelectorAll(".request-row");
        if (rows[i]) {
          rows[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
          rows[i].click();
        }
      });
    });

    bar.appendChild(dot);
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

// ── Capture UI state ─────────────────────────────────────────────────────

function setCapturingUI(active) {
  isCapturing = active;
  btnStart.disabled = active;
  btnStop.disabled  = !active;
  statusDot.className = active ? "dot dot-active" : "dot dot-idle";
  statusDot.setAttribute("aria-label", active ? "Capture status: active" : "Capture status: inactive");

  if (active) {
    setWorkflowStep(1);
    setViewContext("capture");
  }

  setLiveStatus(active);
}

// ── Count ─────────────────────────────────────────────────────────────────

function updateMethodCountsUI() {
  updateMethodCounts();
}

// ── Filter pills ─────────────────────────────────────────────────────────

function initMethodFilters() {
  document.querySelectorAll(".mf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mf-btn").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      activeMethodFilter = btn.dataset.method;
      setMethodFilter(activeMethodFilter);
      renderList({ isCapturing });
      saveFilterState();
    });
  });
}

// ── Filter input ─────────────────────────────────────────────────────────

filterInput.addEventListener("input", () => {
  setTextFilter(filterInput.value);
  renderList({ isCapturing });
});

// ── Results filter tabs ────────────────────────────────────────────────

function initResultsFilters() {
  document.querySelectorAll(".rf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".rf-btn").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      activeResultsFilter = btn.dataset.filter;
      if (lastResultsData) renderResults(lastResultsData);
    });
  });
}

function initResultsSearch() {
  if (!resultsSearch) return;
  resultsSearch.addEventListener("input", () => {
    resultsSearchQuery = resultsSearch.value.trim().toLowerCase();
    if (lastResultsData) renderResults(lastResultsData);
  });
}

// ── Results category filter ────────────────────────────────────────────

if (resultsCategoryFilter) {
  resultsCategoryFilter.addEventListener("click", ev => {
    const btn = ev.target.closest(".rcf-btn");
    if (!btn) return;
    activeCategoryFilter = btn.dataset.category || "all";
    if (lastResultsData) renderResults(lastResultsData);
  });
}

// ── Results scope clear ────────────────────────────────────────────────

if (btnClearResultsScope) {
  btnClearResultsScope.addEventListener("click", () => {
    selectedResultsApiLabel = null;
    activeResultsApiKey = null;
    scrollSelectedApiOnNextRender = false;
    if (lastResultsData) renderResults(lastResultsData);
  });
}

// ── Reset all filters ──────────────────────────────────────────────────

function resetAllFilters() {
  // Request filters
  activeMethodFilter = "ALL";
  setMethodFilter("ALL");
  filterInput.value = "";
  setTextFilter("");
  document.querySelectorAll(".mf-btn").forEach(btn => {
    const isAll = btn.dataset.method === "ALL";
    btn.classList.toggle("active", isAll);
    btn.setAttribute("aria-pressed", isAll ? "true" : "false");
  });

  // Results filters
  activeResultsFilter = "all";
  activeCategoryFilter = "all";
  resultsSearchQuery = "";
  if (resultsSearch) resultsSearch.value = "";
  selectedResultsApiLabel = null;
  activeResultsApiKey = null;
  scrollSelectedApiOnNextRender = false;
  activeDetailCategoryFilter = "all";
  selectedDetailTestcaseKey = null;

  document.querySelectorAll(".rf-btn").forEach(btn => {
    const isAll = btn.dataset.filter === "all";
    btn.classList.toggle("active", isAll);
    btn.setAttribute("aria-pressed", isAll ? "true" : "false");
  });

  renderList({ isCapturing });
  if (lastResultsData) renderResults(lastResultsData);
}

if (btnResetAllFilters) {
  btnResetAllFilters.addEventListener("click", resetAllFilters);
}

// ── Expand / Collapse all ───────────────────────────────────────────────

btnExpandAll.addEventListener("click", () => {
  document.querySelectorAll(".group-tests").forEach(el => el.classList.remove("collapsed"));
  document.querySelectorAll(".results-group-header").forEach(h => h.classList.add("group-expanded"));
  document.querySelectorAll(".result-detail").forEach(el => el.classList.remove("hidden"));
  document.querySelectorAll(".result-row").forEach(row => {
    row.classList.add("expanded");
    const arrow = row.querySelector(".result-expand-btn");
    if (arrow) arrow.textContent = "⌄";
  });
});

btnCollapseAll.addEventListener("click", () => {
  document.querySelectorAll(".group-tests").forEach(el => el.classList.add("collapsed"));
  document.querySelectorAll(".results-group-header").forEach(h => h.classList.remove("group-expanded"));
  document.querySelectorAll(".result-detail").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".result-row").forEach(row => {
    row.classList.remove("expanded");
    const arrow = row.querySelector(".result-expand-btn");
    if (arrow) arrow.textContent = "›";
  });
});

// ── Webhook URL ───────────────────────────────────────────────────────────

function showWebhookStatusInline(msg, type) {
  if (!webhookStatus) return;
  webhookStatus.textContent = msg;
  webhookStatus.className = `webhook-status webhook-status-${type}`;
  webhookStatus.classList.remove("hidden");
  setTimeout(() => { webhookStatus.classList.add("hidden"); }, 4000);
}

function getSavedWebhookUrl() {
  return get(WEBHOOK_STORAGE_KEY).then(url => url || "");
}

/**
 * Validate a webhook URL for security.
 * - Must start with https:// or http://
 * - http:// only allowed for localhost/127.0.0.1 (local dev)
 * - Must be a valid URL
 */
function validateWebhookUrl(url) {
  if (!url) return { ok: true }; // empty is ok (cleared)
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    return { ok: false, message: "URL must start with http:// or https://" };
  }
  if (url.startsWith("http://")) {
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1") || url.includes("0.0.0.0");
    if (!isLocal) {
      return { ok: false, message: "For security, use an HTTPS webhook URL for non-local servers" };
    }
  }
  try {
    new URL(url);
    return { ok: true };
  } catch {
    return { ok: false, message: "Invalid URL format" };
  }
}

btnSaveWebhook.addEventListener("click", async () => {
  const url = webhookUrlInput.value.trim();
  const validation = validateWebhookUrl(url);
  if (!validation.ok) {
    showToast(validation.message, "warn");
    return;
  }
  await set(WEBHOOK_STORAGE_KEY, url);
  showToast(url ? "Webhook URL saved" : "Webhook URL cleared", "ok");
});

// ── Webhook connection test ─────────────────────────────────────────────

async function testWebhookConnection() {
  const rawUrl = webhookUrlInput.value.trim() || await getSavedWebhookUrl();
  if (!rawUrl) { showToast("Enter the webhook URL first", "warn"); return; }

  const validation = validateWebhookUrl(rawUrl);
  if (!validation.ok) {
    showToast(validation.message, "warn");
    return;
  }

  let healthUrl;
  try {
    const u = new URL(rawUrl);
    healthUrl = `${u.protocol}//${u.host}/health`;
  } catch {
    showToast("Invalid URL format", "warn");
    return;
  }

  btnTestWebhook.disabled = true;
  btnTestWebhook.textContent = "...";
  try {
    const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(4000) });
    if (resp.ok) {
      const d = await resp.json();
      showToast(`Server online — model: ${d.ollama_model || "?"}`, "ok", 4000);
    } else {
      showToast(`Server returned HTTP ${resp.status}`, "warn");
    }
  } catch (err) {
    showToast(`Cannot reach server (${err.message})`, "err", 5000);
  } finally {
    btnTestWebhook.disabled = false;
    btnTestWebhook.textContent = "⚡ Test";
  }
}

btnTestWebhook.addEventListener("click", testWebhookConnection);

// ── Polling background for new entries ────────────────────────────────────

function pollEntries() {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ action: "getLog", tabId: currentTabId }, res => {
    if (chrome.runtime.lastError) return;
    const entries = res.entries || [];
    setEntries(entries);
    if (entries.length) saveEntriesState(currentTabId, entries);
    updateCount();
    updateMethodCountsUI();
    renderList({ isCapturing });

    // If selected entry was updated, refresh detail
    const selected = getSelectedEntry();
    if (selected) {
      const updated = entries.find(e => e.requestId === selected.requestId);
      if (updated && updated.status_code !== selected.status_code) {
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

// ── Control buttons ───────────────────────────────────────────────────────

btnStart.addEventListener("click", () => {
  if (!currentTabId) return;

  // Starting a new capture clears any previous results
  clearResultsState();
  resultsPanel.classList.add("hidden");
  if (resultsProgressWrap) { resultsProgressWrap.classList.add("hidden"); resultsProgressBar.style.width = "0%"; }
  if (resultsPollTimer) { clearInterval(resultsPollTimer); resultsPollTimer = null; }
  setWorkflowStep(1);
  lastResultsData = null;
  setLastResultsData(null);

  chrome.runtime.sendMessage({ action: "start", tabId: currentTabId }, res => {
    if (res && res.ok) {
      setCapturingUI(true);
      startPolling();
    } else {
      showToast("Failed to start capture: " + (res?.error || "unknown error"), "err");
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
      showToast(`Sent ${res.total} request${res.total !== 1 ? "s" : ""} to webhook (HTTP ${res.status})`, "ok");
      if (res.resultsUrl && res.webhookUrl) {
        // Validate the results URL originates from the same host as the webhook
        try {
          const webhookOrigin = new URL(res.webhookUrl).origin;
          const resultsOrigin = new URL(res.resultsUrl).origin;
          if (resultsOrigin !== webhookOrigin) {
            showToast("Results URL origin mismatch — not polling", "warn", 5000);
          } else {
            startResultsPolling(res.resultsUrl);
          }
        } catch {
          showToast("Invalid results URL format — not polling", "warn", 5000);
        }
      } else if (res.resultsUrl) {
        startResultsPolling(res.resultsUrl);
      }
    } else if (webhookUrl && res && !res.sent) {
      const reason = res.error
        ? `Failed: ${res.error}`
        : res.total === 0
          ? "Nothing to send (0 requests captured)"
          : "Webhook URL not set";
      showToast(`${reason}`, "warn", 5000);
    }

    pollEntries();
  });
});

// ── Clear confirmation ──────────────────────────────────────────────────

btnClear.addEventListener("click", () => {
  const entries = getEntries();
  if (entries.length === 0) return;
  // Show confirmation bar
  clearConfirm.classList.remove("hidden");
  btnClear.classList.add("hidden");
  focusFirst(clearConfirm);
});

btnConfirmClear.addEventListener("click", () => {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ action: "clear", tabId: currentTabId }, () => {
    setEntries([]);
    setSelectedEntry(null);
    closeDetail();
    clearEntriesState();
    clearSelection();
    updateCount();
    updateMethodCountsUI();
    renderList({ isCapturing });
    clearConfirm.classList.add("hidden");
    btnClear.classList.remove("hidden");
    showToast("Captured requests cleared", "ok");
  });
});

btnCancelClear.addEventListener("click", () => {
  clearConfirm.classList.add("hidden");
  btnClear.classList.remove("hidden");
});

// Auto-dismiss clear confirmation after 8 seconds
let clearAutoDismiss = null;
function watchClearConfirm() {
  const observer = new MutationObserver(() => {
    if (clearAutoDismiss) clearTimeout(clearAutoDismiss);
    if (!clearConfirm.classList.contains("hidden")) {
      clearAutoDismiss = setTimeout(() => {
        clearConfirm.classList.add("hidden");
        btnClear.classList.remove("hidden");
      }, 8000);
    }
  });
  observer.observe(clearConfirm, { attributes: true, attributeFilter: ["class"] });
}
watchClearConfirm();

// ── Listen for detach events from background ──────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "detached" && msg.tabId === currentTabId) {
    setCapturingUI(false);
    stopPolling();
  }
});

// ── List selection callback ─────────────────────────────────────────────

listOnSelect(entry => {
  selectedResultsApiLabel = `${entry.method || "?"} ${entry.url || ""}`;
  activeResultsApiKey = null;
  scrollSelectedApiOnNextRender = true;
  activeDetailCategoryFilter = "all";
  selectedDetailTestcaseKey = null;

  if (lastResultsData) {
    renderResults(lastResultsData);
  }

  openDetail(entry);
});

// ── Detail testcase workspace callbacks ──────────────────────────────────

window._onTestcaseSelect = (key) => {
  selectedDetailTestcaseKey = key;
  renderDetailTestcaseWorkspace();
};

// ── Theme (dark/light mode) ───────────────────────────────────────────────

const btnTheme = $("btn-theme");

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.className = theme;
  if (btnTheme) btnTheme.textContent = theme === "dark" ? "☀" : "☾";
}

function loadTheme() {
  get(THEME_STORAGE_KEY).then(saved => {
    applyTheme(saved || getSystemTheme());
  });
}

if (btnTheme) {
  btnTheme.addEventListener("click", () => {
    const next = document.documentElement.className === "dark" ? "light" : "dark";
    applyTheme(next);
    set(THEME_STORAGE_KEY, next);
  });
}

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", e => {
  get(THEME_STORAGE_KEY).then(saved => {
    if (!saved) applyTheme(e.matches ? "light" : "dark");
  });
});

loadTheme();

// ── Init ──────────────────────────────────────────────────────────────────

function initWithTabId(tabId) {
  currentTabId = tabId;
  setWorkflowStep(1);
  setViewContext("capture");

  // Restore saved webhook URL
  getSavedWebhookUrl().then(url => { webhookUrlInput.value = url; });

  // Restore results panel if a batch was in progress
  restoreResultsState();

  // Restore persisted entries
  getWithTTL(ENTRIES_STORAGE_KEY, 2 * 60 * 60 * 1000).then(saved => {
    if (saved && saved.entries && saved.entries.length) {
      const entries = saved.entries;
      setEntries(entries);
    updateCount();
    updateMethodCountsUI();
    renderList({ isCapturing });
    renderTimeline();
    }
  });

  // Restore filter state
  restoreFilterState().then(restored => {
    if (restored) {
      filterInput.value = getTextFilter();
      activeMethodFilter = getMethodFilter();
      // Update method filter pills
      document.querySelectorAll(".mf-btn").forEach(btn => {
        const isActive = btn.dataset.method === activeMethodFilter;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      renderList({ isCapturing });
    }
  });

  // Check if capture was already running
  chrome.runtime.sendMessage({ action: "status", tabId: currentTabId }, res => {
    if (res && res.attached) {
      setCapturingUI(true);
      startPolling();
    }
    pollEntries();
  });
}

// Full-page mode detection
if (new URLSearchParams(window.location.search).get("fullpage") === "1") {
  document.body.classList.add("fullpage");
  if (btnFullpage) btnFullpage.style.display = "none";
  if (btnCompact) btnCompact.style.display = "";
}

if (btnCompact) {
  btnCompact.addEventListener("click", () => { window.close(); });
}

if (btnFullpage) {
  btnFullpage.addEventListener("click", () => {
    const tabParam = currentTabId ? `&tabId=${currentTabId}` : "";
    const url = chrome.runtime.getURL("popup.html") + `?fullpage=1${tabParam}`;
    chrome.tabs.create({ url });
  });
}

// ── Initialize modules ────────────────────────────────────────────────────

initShortcuts();
initWorkflowSteps();
initDetailEvents();
initMethodFilters();
initResultsFilters();
initResultsSearch();
initBatch();

// Wire batch checkbox creation on request rows
listOnRowCreate((row, entry) => {
  addCheckboxToRow(row, entry.requestId);
});

// Keyboard shortcuts
register("ctrl+enter", () => {
  if (isCapturing) {
    btnStop.click();
  } else {
    btnStart.click();
  }
});

register("escape", () => {
  // Close detail panel first
  const detailPanel = $("detail-panel");
  if (detailPanel && !detailPanel.classList.contains("hidden")) {
    closeDetail();
    return;
  }
  // Close results panel next
  if (resultsPanel && !resultsPanel.classList.contains("hidden")) {
    resultsPanel.classList.add("hidden");
    return;
  }
  // Close clear confirmation
  if (!clearConfirm.classList.contains("hidden")) {
    btnCancelClear.click();
    return;
  }
});

register("ctrl+f", () => {
  if (filterInput) {
    filterInput.focus();
    filterInput.select();
  }
});

register("ctrl+shift+e", () => {
  const selected = getSelectedEntry();
  if (selected) {
    openDetail(selected);
    switchTab("export");
  }
});

register("ctrl+shift+c", () => {
  if (!btnClear.disabled) {
    btnClear.click();
  }
});

// Init: determine tab ID
const urlTabId = new URLSearchParams(window.location.search).get("tabId");
if (urlTabId) {
  const parsedTabId = parseInt(urlTabId, 10);
  if (!isNaN(parsedTabId) && parsedTabId >= 0) {
    initWithTabId(parsedTabId);
  } else {
    showToast("Invalid tab ID in URL", "err");
  }
} else {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs.length) return;
    initWithTabId(tabs[0].id);
  });
}

// ── Results panel: poll + render ───────────────────────────────────────────

function startResultsPolling(resultsUrl, restoring = false) {
  setWorkflowStep(2);
  setViewContext("analyze");
  resultsPanel.classList.remove("hidden");
  activeResultsApiKey = null;
  activeCategoryFilter = "all";

  if (!restoring) {
    resultsStatusText.textContent = "Connecting to Ollama…";
    resultsSpinner.classList.remove("hidden");
    resultsSummary.classList.add("hidden");
    resultsRestoredBadge.classList.add("hidden");
    // Show skeleton placeholders while loading
    resultsList.innerHTML = `
      <div class="results-skeleton" aria-label="Loading test results">
        <div class="skeleton-row"></div>
        <div class="skeleton-row"></div>
        <div class="skeleton-row"></div>
        <div class="skeleton-row"></div>
        <div class="skeleton-row"></div>
      </div>`;
    if (resultsProgressWrap) {
      resultsProgressWrap.classList.add("hidden");
      resultsProgressBar.style.width = "0%";
    }
    saveResultsState(resultsUrl, null);
  }

  if (resultsPollTimer) clearInterval(resultsPollTimer);
  resultsPollTimer = setInterval(() => fetchResults(resultsUrl), 2000);
  fetchResults(resultsUrl);
}

function testMatchesFilter(r) {
  if (activeResultsFilter === "pass" && !(r.passed && !r.error)) return false;
  if (activeResultsFilter === "fail" && !(!r.passed && !r.error)) return false;
  if (activeResultsFilter === "error" && !r.error) return false;
  if (activeCategoryFilter !== "all" && (r.category || "") !== activeCategoryFilter) return false;
  if (resultsSearchQuery) {
    const haystack = [
      r.name, r.description, r.error, r.category,
      r.scenario_description, r.failure_suggestion, r.assertion_notes,
    ].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(resultsSearchQuery)) return false;
  }
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

function appendResultRow(container, r) {
  const wrapper = document.createElement("div");
  wrapper.className = "result-row-wrapper";

  const icon  = r.error ? "!" : r.passed ? "OK" : "X";
  const cls   = r.error ? "result-error" : r.passed ? "result-pass" : "result-fail";
  const category = r.category || "";
  const catLabel = category ? `<span class="cat-badge cat-${safeClass(category)}" title="Filter by this category: ${escHtml(category.replace(/_/g, " "))}">${escHtml(category.replace(/_/g, " "))}</span>` : "";
  const badge = r.actual_status
    ? `<span class="res-status ${statusBadgeClass(r.actual_status, r.passed)}">${r.actual_status}</span>`
    : (r.expected_status ? `<span class="res-status res-status-expected">exp ${r.expected_status}</span>` : "");
  const dur = r.duration_ms != null ? `<span class="res-dur">${r.duration_ms}ms</span>` : "";

  const summary = document.createElement("div");
  summary.className = `result-row ${cls}`;
  summary.setAttribute("role", "button");
  summary.setAttribute("tabindex", "0");
  summary.setAttribute("aria-expanded", "false");
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
  if (r.description) detailHtml += `<div class="detail-desc">${escHtml(r.description)}</div>`;
  if (r.scenario_description) detailHtml += `<div class="detail-section"><span class="detail-label">Scenario</span>${escHtml(r.scenario_description)}</div>`;
  if (r.request_body_note) detailHtml += `<div class="detail-section"><span class="detail-label">Request Body Note</span>${escHtml(r.request_body_note)}</div>`;

  const modelReq = r.model_request || { method: r.method || null, url: r.url || null, headers: r.request_headers || null, payload: r.request_payload ?? null };
  detailHtml += `<div class="detail-section"><span class="detail-label">Request From Model Test Case</span><pre class="detail-json">${toPrettyJson(modelReq)}</pre></div>`;

  if (r.assertion_notes) detailHtml += `<div class="detail-section"><span class="detail-label">🔍 Assert</span>${escHtml(r.assertion_notes)}</div>`;
  if (r.error) detailHtml += `<div class="detail-section detail-error-msg"><span class="detail-label">❌ Error</span>${escHtml(r.error)}</div>`;
  if (r.failure_suggestion && (!r.passed || r.error)) detailHtml += `<div class="detail-suggestion"><span class="detail-label">💡 Suggestion</span>${escHtml(r.failure_suggestion)}</div>`;
  detail.innerHTML = detailHtml || `<div class="detail-desc">No additional details.</div>`;

  summary.addEventListener("click", () => {
    const isOpen = !detail.classList.contains("hidden");
    detail.classList.toggle("hidden", isOpen);
    summary.classList.toggle("expanded", !isOpen);
    summary.querySelector(".result-expand-btn").textContent = isOpen ? "›" : "⌄";
    summary.setAttribute("aria-expanded", !isOpen);
  });

  // Keyboard support for Enter/Space
  summary.addEventListener("keydown", ev => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      summary.click();
    }
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
    setLastResultsData(data);
    renderDetailTestcaseWorkspace();
    renderResults(data);
    saveResultsState(url, data);
    updateBadge(data);

    if (resultsProgressWrap) {
      const prog = data.progress || {};
      if (prog.total > 0 || data.status === "done") {
        resultsProgressWrap.classList.remove("hidden");
        const pct = data.status === "done" ? 100 : Math.round((prog.done / prog.total) * 100);
        resultsProgressBar.style.width = `${pct}%`;
        resultsProgressBar.className = `progress-bar${data.status === "done" ? " progress-done" : ""}`;
        resultsProgressBar.setAttribute("aria-valuenow", pct);
      }
    }
    if (data.status === "done" || data.status === "error") {
      setWorkflowStep(3);
      setViewContext("results");
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
  resultsStatusText.textContent = data.message || data.status || "Working…";

  const running = data.status === "running" || data.status === "pending";
  resultsSpinner.classList.toggle("hidden", !running);

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
      if ((r.category || "") && matchesAnyResultsFilter(r)) {
        categories.add(r.category);
      }
    });
  });
  renderCategoryChips(Array.from(categories).sort());

  let selectedGroupStillExists = false;
  const shouldAutoOpenSelectedApi = !!selectedResultsApiLabel;

  if (selectedResultsApiLabel) {
    groups.forEach(group => {
      const visible = (group.test_results || []).filter(testMatchesFilter);
      visible.forEach(r => appendResultRow(resultsList, r));
    });

    if (!resultsList.children.length) {
      resultsList.innerHTML = `<div class="results-empty">No test cases match the current filters for selected API.</div>`;
    }

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

    const header = document.createElement("div");
    header.className = "results-group-header";
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", "false");

    const gs = group.summary || {};
    const isScopedMatch = selectedResultsApiLabel && isSameApiLabel(selectedResultsApiLabel, group.api_request || "");

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

    const testsContainer = document.createElement("div");
    const isActiveGroup = activeResultsApiKey === groupKey;
    testsContainer.className = isActiveGroup ? "group-tests" : "group-tests collapsed";

    if (isActiveGroup) {
      header.classList.add("group-expanded");
      header.setAttribute("aria-expanded", "true");
    }
    header.classList.toggle("group-selected-api", !!isScopedMatch);

    header.addEventListener("click", () => {
      activeResultsApiKey = activeResultsApiKey === groupKey ? null : groupKey;
      if (lastResultsData) renderResults(lastResultsData);
    });

    // Keyboard support for Enter/Space
    header.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        header.click();
      }
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

function matchesAnyResultsFilter(r) {
  return (activeResultsFilter === "all" ||
    (activeResultsFilter === "pass" && r.passed && !r.error) ||
    (activeResultsFilter === "fail" && !r.passed && !r.error) ||
    (activeResultsFilter === "error" && !!r.error)) &&
    (!resultsSearchQuery || matchesSearchQuery(r));
}

function matchesSearchQuery(r) {
  const haystack = [
    r.name, r.description, r.error, r.category,
    r.scenario_description, r.failure_suggestion, r.assertion_notes,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(resultsSearchQuery);
}

btnCloseResults.addEventListener("click", () => {
  resultsPanel.classList.add("hidden");
  if (resultsPollTimer) { clearInterval(resultsPollTimer); resultsPollTimer = null; }
  clearResultsState();
});

// ── Helpers ────────────────────────────────────────────────────────────────

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

function statusBadgeClass(code, passed) {
  if (!code) return "";
  if (passed) return "res-status-pass";
  if (code < 300) return "res-status-pass";
  if (code < 400) return "res-status-redirect";
  if (code < 500) return "res-status-client";
  return "res-status-server";
}

function isSameApiLabel(selectedLabel, groupLabel) {
  const s = parseApiRequestLabel(selectedLabel);
  const g = parseApiRequestLabel(groupLabel);
  if (!s.method || !g.method) {
    return s.normalizedUrl && s.normalizedUrl === g.normalizedUrl;
  }
  return s.method === g.method && s.normalizedUrl === g.normalizedUrl;
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

function normalizeMethod(method) {
  return String(method || "").trim().toUpperCase();
}

function normalizeUrlForMatch(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(rawUrl || "").trim().replace(/\/+$/, "").toLowerCase();
  }
}

function renderDetailTestcaseWorkspace() {
  renderTestcaseWorkspace(selectedResultsApiLabel, isSameApiLabel, {
    activeCategoryFilter,
    selectedDetailTestcaseKey,
  });

  // Re-wire chip clicks
  const chips = document.getElementById("api-testcase-chips");
  if (chips) {
    // Remove existing listener to avoid duplicates
    const newChips = chips.cloneNode(true);
    chips.parentNode.replaceChild(newChips, chips);
    newChips.addEventListener("click", ev => {
      const btn = ev.target.closest(".api-chip");
      if (!btn) return;
      activeDetailCategoryFilter = btn.dataset.category || "all";
      selectedDetailTestcaseKey = null;
      renderTestcaseWorkspace(selectedResultsApiLabel, isSameApiLabel, {
        activeCategoryFilter,
        selectedDetailTestcaseKey,
      });
    });
  }
}
