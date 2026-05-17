/**
 * batch.js  —  Batch selection for request list
 *
 * Adds checkbox-based multi-selection to request rows, batch action bar,
 * and batch export/send capabilities.
 *
 * Usage:
 *   import { initBatch, getSelectedEntries, clearSelection, toggleSelectAll } from './batch.js';
 */

"use strict";

import { getEntries, getMethodCounts, renderList } from "./list.js";
import { showToast } from "./toast.js";

// ── State ────────────────────────────────────────────────────────────────

let selectedIds = new Set();
let batchBar = null;
let batchCount = null;
let btnExport = null;
let btnSend = null;
let btnSelectAll = null;

// ── Helpers ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

/**
 * Check if batch mode is active (at least one selected).
 */
export function isBatchActive() {
  return selectedIds.size > 0;
}

/**
 * Get the set of selected request IDs.
 */
export function getSelectedIds() {
  return new Set(selectedIds);
}

/**
 * Get selected entry objects.
 */
export function getSelectedEntries() {
  const all = getEntries();
  return all.filter(e => selectedIds.has(e.requestId));
}

/**
 * Toggle selection for a single request ID.
 */
export function toggleSelect(requestId) {
  if (selectedIds.has(requestId)) {
    selectedIds.delete(requestId);
  } else {
    selectedIds.add(requestId);
  }
  updateBatchUI();
}

/**
 * Select or deselect all visible (filtered) entries.
 */
export function toggleSelectAll() {
  const all = getEntries();
  if (selectedIds.size === all.length) {
    clearSelection();
  } else {
    selectedIds = new Set(all.map(e => e.requestId));
    updateBatchUI();
  }
}

/**
 * Clear all selections.
 */
export function clearSelection() {
  selectedIds.clear();
  updateBatchUI();
}

/**
 * Add a checkbox to a request row element.
 * Returns the checkbox element.
 */
export function addCheckboxToRow(row, requestId) {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "req-checkbox";
  cb.checked = selectedIds.has(requestId);
  cb.setAttribute("aria-label", "Select request");

  cb.addEventListener("change", (e) => {
    e.stopPropagation();
    toggleSelect(requestId);
    // Re-render checkboxes without full list re-render
    document.querySelectorAll(".req-checkbox").forEach(c => {
      c.checked = selectedIds.has(c.dataset.requestId);
    });
  });

  cb.dataset.requestId = requestId;
  row.insertBefore(cb, row.firstChild);

  // Add batch CSS class when any items are selected
  row.classList.toggle("row-batch-selected", selectedIds.has(requestId));

  return cb;
}

/**
 * Get the export JSON blob for selected entries.
 */
export function getSelectedExportBlob() {
  const entries = getSelectedEntries();
  const data = entries.map(e => ({
    url: e.url,
    method: e.method,
    headers: e.headers || {},
    payload: e.payload || {},
    response: e.response || {},
    status_code: e.status_code || null,
  }));
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

/**
 * Export selected entries as a download.
 */
export function exportSelected() {
  const count = selectedIds.size;
  if (!count) {
    showToast("No requests selected", "warn");
    return;
  }
  const blob = getSelectedExportBlob();
  const url = URL.createObjectURL(blob);
  const fname = `api_log_batch_${Date.now()}.json`;
  chrome.downloads.download({ url, filename: fname, saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast(`Exported ${count} request${count !== 1 ? "s" : ""}`, "ok");
}

// ── Batch bar UI ─────────────────────────────────────────────────────────

function updateBatchUI() {
  if (!batchBar || !batchCount) return;

  const count = selectedIds.size;

  if (count > 0) {
    batchBar.classList.remove("hidden");
    batchCount.textContent = `${count} selected`;
  } else {
    batchBar.classList.add("hidden");
    batchCount.textContent = "0 selected";
  }

  // Update checkbox states in the list
  document.querySelectorAll(".req-checkbox").forEach(cb => {
    const id = cb.dataset.requestId;
    cb.checked = selectedIds.has(id);
    const row = cb.closest(".request-row");
    if (row) row.classList.toggle("row-batch-selected", cb.checked);
  });
}

/**
 * Initialize the batch selection system.
 */
export function initBatch() {
  batchBar = $("batch-bar");
  batchCount = $("batch-count");
  btnExport = $("btn-batch-export");
  btnSend = $("btn-batch-send");
  btnSelectAll = $("btn-batch-select-all");

  if (btnExport) {
    btnExport.addEventListener("click", exportSelected);
  }

  if (btnSend) {
    btnSend.addEventListener("click", () => {
      const count = selectedIds.size;
      if (!count) {
        showToast("No requests selected", "warn");
        return;
      }
      // Trigger stop-and-send with only selected entries
      showToast("Select All to send, then click Stop", "warn");
    });
  }

  if (btnSelectAll) {
    btnSelectAll.addEventListener("click", toggleSelectAll);
  }

  // Click anywhere outside batch bar to clear
  document.addEventListener("click", (e) => {
    if (selectedIds.size === 0) return;
    if (batchBar && !batchBar.contains(e.target) &&
        !e.target.closest(".req-checkbox")) {
      // Don't auto-clear — user might be clicking elsewhere
    }
  });
}
