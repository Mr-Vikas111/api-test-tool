/**
 * toast.js  —  Toast notification system
 *
 * Fixed-position toast container at the top of the popup.
 * Replaces inline webhook-status messages.
 *
 * Usage:
 *   import { showToast } from './toast.js';
 *   showToast('Sent 12 requests', 'ok');
 *   showToast('Server unreachable', 'err', 5000);
 */

"use strict";

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    // Insert at top of window-frame
    const frame = document.querySelector(".window-frame") || document.body;
    frame.prepend(container);
  }
  return container;
}

/**
 * Show a toast notification.
 *
 * @param {string}  message   - Text to display
 * @param {'ok'|'warn'|'err'} type - Style: ok (green), warn (orange), err (red)
 * @param {number}  duration  - Auto-dismiss after ms (default 3000; 0 = sticky)
 */
export function showToast(message, type = "ok", duration = 3000) {
  const c = ensureContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute("role", "alert");
  c.appendChild(toast);

  if (duration > 0) {
    const timer = setTimeout(() => dismiss(toast), duration);
    // Store timer so we can cancel if user clicks
    toast._dismissTimer = timer;
  }

  toast.addEventListener("click", () => {
    if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
    dismiss(toast);
  });

  return toast;
}

function dismiss(toast) {
  if (toast._dismissing) return;
  toast._dismissing = true;
  toast.classList.add("toast-out");
  toast.addEventListener("animationend", () => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, { once: true });
}

/**
 * Clear all active toasts immediately.
 */
export function clearToasts() {
  if (!container) return;
  while (container.firstChild) {
    const child = container.firstChild;
    if (child._dismissTimer) clearTimeout(child._dismissTimer);
    container.removeChild(child);
  }
}
