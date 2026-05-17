/**
 * focus.js  —  Focus management utilities
 *
 * Auto-focus, focus trapping, and keyboard navigation helpers.
 *
 * Usage:
 *   import { trapFocus, releaseFocus, focusFirst, autoFocus } from './focus.js';
 *   trapFocus(detailPanel);
 *   focusFirst(filterInput);
 */

"use strict";

let trappedElement = null;
let lastFocusedBeforeTrap = null;

/**
 * Get all focusable children within a container.
 */
function getFocusableElements(container) {
  if (!container) return [];
  const selectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ];
  return Array.from(container.querySelectorAll(selectors.join(",")));
}

/**
 * Trap Tab focus within a container.
 *
 * @param {HTMLElement} container - Element to trap focus within
 */
export function trapFocus(container) {
  if (trappedElement) releaseFocus();

  trappedElement = container;
  lastFocusedBeforeTrap = document.activeElement;

  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
  }

  container.addEventListener("keydown", handleTabTrap);
}

/**
 * Release a previously trapped focus.
 */
export function releaseFocus() {
  if (!trappedElement) return;

  trappedElement.removeEventListener("keydown", handleTabTrap);
  trappedElement = null;

  // Return focus to where it was before trap
  if (lastFocusedBeforeTrap && lastFocusedBeforeTrap.focus) {
    lastFocusedBeforeTrap.focus();
  }
  lastFocusedBeforeTrap = null;
}

function handleTabTrap(event) {
  if (event.key !== "Tab") return;
  if (!trappedElement) return;

  const focusable = getFocusableElements(trappedElement);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/**
 * Focus the first focusable element in a container.
 */
export function focusFirst(container) {
  if (!container) return;
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
  }
}

/**
 * Auto-focus a specific element. Safe to call on page load.
 */
export function autoFocus(element) {
  if (!element) return;
  // Use requestAnimationFrame to ensure DOM is ready
  requestAnimationFrame(() => {
    element.focus();
  });
}

/**
 * Check if an element is currently visible and focusable.
 */
export function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
}
