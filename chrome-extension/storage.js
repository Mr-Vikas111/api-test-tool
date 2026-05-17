/**
 * storage.js  —  chrome.storage.local helpers with TTL support
 *
 * Wraps chrome.storage.local with consistent error handling,
 * TTL expiry, and type-safe get/set/remove.
 *
 * Usage:
 *   import { get, set, remove, getWithTTL } from './storage.js';
 *   await set('theme', 'dark');
 *   const theme = await get('theme');
 *   const results = await getWithTTL('activeResults', 2 * 60 * 60 * 1000);
 */

"use strict";

/**
 * Get a value from chrome.storage.local.
 *
 * @param {string} key
 * @returns {Promise<any|null>} The stored value, or null if not found / error
 */
export function get(key) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(key, data => {
        if (chrome.runtime.lastError) {
          console.warn(`[storage] Error reading "${key}":`, chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(data[key] !== undefined ? data[key] : null);
        }
      });
    } catch (err) {
      console.warn(`[storage] Exception reading "${key}":`, err);
      resolve(null);
    }
  });
}

/**
 * Set a value in chrome.storage.local.
 *
 * @param {string} key
 * @param {any} value
 * @returns {Promise<boolean>} true on success
 */
export function set(key, value) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          console.warn(`[storage] Error writing "${key}":`, chrome.runtime.lastError);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (err) {
      console.warn(`[storage] Exception writing "${key}":`, err);
      resolve(false);
    }
  });
}

/**
 * Remove a key from chrome.storage.local.
 *
 * @param {string} key
 * @returns {Promise<boolean>} true on success
 */
export function remove(key) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.remove(key, () => {
        if (chrome.runtime.lastError) {
          console.warn(`[storage] Error removing "${key}":`, chrome.runtime.lastError);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (err) {
      console.warn(`[storage] Exception removing "${key}":`, err);
      resolve(false);
    }
  });
}

/**
 * Get a value with TTL (time-to-live) expiry check.
 * The stored value must have a `savedAt` timestamp.
 *
 * @param {string} key
 * @param {number} ttlMs - Max age in milliseconds
 * @returns {Promise<any|null>} The stored value's data, or null if expired/not found
 */
export async function getWithTTL(key, ttlMs) {
  const entry = await get(key);
  if (!entry) return null;
  if (entry.savedAt && Date.now() - entry.savedAt > ttlMs) {
    await remove(key);
    return null;
  }
  return entry.data !== undefined ? entry.data : entry;
}

/**
 * Set a value with a `savedAt` timestamp for TTL checks.
 *
 * @param {string} key
 * @param {any} data
 * @returns {Promise<boolean>}
 */
export async function setWithTimestamp(key, data) {
  return await set(key, {
    data,
    savedAt: Date.now(),
  });
}

/**
 * Clear all extension storage.
 */
export function clear() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          console.warn(`[storage] Error clearing:`, chrome.runtime.lastError);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (err) {
      console.warn(`[storage] Exception clearing:`, err);
      resolve(false);
    }
  });
}
