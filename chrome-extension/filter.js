/**
 * filter.js  —  Text + method filter logic
 *
 * Manages filter state (text query + active method filter), provides
 * filtered views of entry arrays, persists/restores filter state.
 *
 * Usage:
 *   import { setTextFilter, setMethodFilter, filterEntries, saveState, restoreState } from './filter.js';
 */

"use strict";

import { get, set } from "./storage.js";

/** Current text query string */
let textQuery = "";

/** Current HTTP method filter ("ALL" | "GET" | "POST" | etc.) */
let methodFilter = "ALL";

/** Filter persistence key */
const STORAGE_KEY = "filterState";

/**
 * Set the text filter query.
 */
export function setTextFilter(text) {
  textQuery = (text || "").trim().toLowerCase();
}

/**
 * Get the current text filter.
 */
export function getTextFilter() {
  return textQuery;
}

/**
 * Set the active method filter.
 */
export function setMethodFilter(method) {
  methodFilter = method || "ALL";
}

/**
 * Get the current method filter.
 */
export function getMethodFilter() {
  return methodFilter;
}

/**
 * Apply text + method filters to an array of entries.
 *
 * @param {Array} entries - Array of captured request entries
 * @returns {Array} Filtered entries
 */
export function filterEntries(entries) {
  if (!entries || !entries.length) return [];

  return entries.filter(e => {
    // Method filter
    const methodOk = methodFilter === "ALL" || (e.method || "").toUpperCase() === methodFilter;

    // Text filter
    const textOk = !textQuery ||
      (e.url || "").toLowerCase().includes(textQuery) ||
      (e.method || "").toLowerCase().includes(textQuery) ||
      String(e.status_code || "").includes(textQuery);

    return methodOk && textOk;
  });
}

/**
 * Save current filter state to chrome.storage.local.
 * Persists for 24 hours.
 */
export async function saveState() {
  await set(STORAGE_KEY, {
    text: textQuery,
    method: methodFilter,
    savedAt: Date.now(),
  });
}

/**
 * Restore filter state from chrome.storage.local.
 * Returns true if state was restored.
 */
export async function restoreState() {
  const state = await get(STORAGE_KEY);
  if (!state) return false;

  // Expire after 24 hours
  if (state.savedAt && Date.now() - state.savedAt > 24 * 60 * 60 * 1000) {
    return false;
  }

  textQuery = (state.text || "").trim().toLowerCase();
  methodFilter = state.method || "ALL";
  return true;
}

/**
 * Reset all filters to defaults.
 */
export function resetFilters() {
  textQuery = "";
  methodFilter = "ALL";
}
