/**
 * shortcuts.js  —  Keyboard shortcut registry
 *
 * Central registry for keyboard shortcuts. Shortcuts can be enabled/disabled
 * per view state to avoid conflicts (e.g., Ctrl+F should work differently
 * when the filter input is already focused).
 *
 * Usage:
 *   import { register, unregister, setEnabled, initShortcuts } from './shortcuts.js';
 *   register('ctrl+enter', () => startCapture());
 *   setEnabled('capture');
 */

"use strict";

const registry = new Map();
let enabled = true;
let viewContext = "global";

/**
 * Parse a shortcut combo like "ctrl+shift+e" into { ctrlKey, shiftKey, altKey, key }.
 */
function parseCombo(combo) {
  const parts = combo.toLowerCase().split("+");
  const modifiers = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  let key = null;

  for (const p of parts) {
    if (p === "ctrl" || p === "control") { modifiers.ctrlKey = true; continue; }
    if (p === "shift") { modifiers.shiftKey = true; continue; }
    if (p === "alt") { modifiers.altKey = true; continue; }
    if (p === "meta" || p === "cmd" || p === "win") { modifiers.metaKey = true; continue; }
    key = p;
  }

  if (!key) throw new Error(`Invalid shortcut combo: "${combo}"`);

  return { ...modifiers, key };
}

/**
 * Register a keyboard shortcut.
 *
 * @param {string}   combo   - e.g. "ctrl+enter", "escape", "ctrl+shift+e"
 * @param {Function} handler - Called when shortcut is pressed
 * @param {string}   [context] - Optional view context filter ("capture" | "analyze" | "results" | "global")
 */
export function register(combo, handler, context = "global") {
  if (registry.has(combo)) {
    console.warn(`[shortcuts] Overwriting existing handler for "${combo}"`);
  }
  registry.set(combo, { handler, context });
}

/**
 * Unregister a keyboard shortcut.
 */
export function unregister(combo) {
  registry.delete(combo);
}

/**
 * Set the active view context. Shortcuts whose context doesn't match will
 * be ignored. "global" shortcuts always fire.
 *
 * @param {'capture'|'analyze'|'results'} view
 */
export function setViewContext(view) {
  viewContext = view;
}

/**
 * Enable or disable all shortcuts (e.g., when a text input is focused).
 */
export function setEnabled(state) {
  enabled = state;
}

/**
 * Handle a keydown event against the registry.
 * Returns true if a shortcut was matched and handled.
 */
function handleKeyDown(event) {
  if (!enabled) return false;

  // Don't trigger shortcuts when typing in input/textarea
  const tag = (event.target && event.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    // Exception: Escape always works to close panels
    if (event.key !== "Escape") return false;
  }

  for (const [combo, entry] of registry) {
    if (entry.context !== "global" && entry.context !== viewContext) continue;

    const parsed = parseCombo(combo);
    const match =
      event.key.toLowerCase() === parsed.key &&
      event.ctrlKey === parsed.ctrlKey &&
      event.shiftKey === parsed.shiftKey &&
      event.altKey === parsed.altKey &&
      event.metaKey === parsed.metaKey;

    if (match) {
      event.preventDefault();
      event.stopPropagation();
      entry.handler(event);
      return true;
    }
  }

  return false;
}

/**
 * Initialize the keyboard shortcut system. Call once on page load.
 */
export function initShortcuts() {
  document.addEventListener("keydown", handleKeyDown);
}

/**
 * Remove the global listener (cleanup).
 */
export function destroyShortcuts() {
  document.removeEventListener("keydown", handleKeyDown);
}
