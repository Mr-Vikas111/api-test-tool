/**
 * background.js  —  Service Worker
 *
 * Uses chrome.debugger to attach to the active tab, enable Network domain,
 * capture full request + response (including bodies), and store them so the
 * popup can read and export them.
 *
 * Only the following HTTP methods are captured:
 *   GET, POST, PUT, PATCH, DELETE
 *
 * Message API (from popup.js → background.js):
 *   { action: "start",   tabId }              → attach debugger, start capture
 *   { action: "stop",    tabId, webhookUrl }  → send webhook then detach
 *   { action: "getLog",  tabId }              → return captured entries
 *   { action: "clear",   tabId }              → clear entries for that tab
 *   { action: "status",  tabId }              → return { attached: bool }
 */

"use strict";

// ── State ──────────────────────────────────────────────────────────────────────
// captureState[tabId] = { attached: bool, requests: Map<requestId, entry> }
const captureState = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getState(tabId) {
  if (!captureState[tabId]) {
    captureState[tabId] = { attached: false, requests: new Map() };
  }
  return captureState[tabId];
}

/** Parse JSON safely; return raw string on failure. */
function tryParseJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Redact sensitive header values to prevent credential leakage.
 * Returns the header name with the value replaced by "[REDACTED]" if sensitive.
 */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-api-token",
  "api-key",
  "token",
  "x-auth-token",
  "x-access-token",
  "x-session-token",
  "x-csrf-token",
  "x-xsrf-token",
]);

function redactSensitiveHeader(name, value) {
  const lc = name.toLowerCase();
  if (SENSITIVE_HEADERS.has(lc)) return "[REDACTED]";
  return value;
}

/**
 * Convert raw header array [{ name, value }] to a plain object.
 * Filters out internal/binary headers and redacts sensitive credentials.
 */
function headersToObject(headers = []) {
  const skip = new Set([
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
  ]);
  const obj = {};
  for (const { name, value } of headers) {
    const lc = name.toLowerCase();
    if (!skip.has(lc)) obj[name] = redactSensitiveHeader(name, value);
  }
  return obj;
}

/** HTTP methods to capture — all others are silently ignored. */
const MAIN_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Determine if a request is worth capturing.
 * Only tracks MAIN_METHODS on non-browser-internal URLs.
 */
function isApiRequest(url, method, resourceType) {
  if (!url || url.startsWith("chrome") || url.startsWith("about:")) return false;
  if (!MAIN_METHODS.has((method || "").toUpperCase())) return false;
  const skipTypes = new Set(["Document", "Stylesheet", "Image", "Font", "Media", "Manifest"]);
  if (skipTypes.has(resourceType)) return false;
  return true;
}

// ── Debugger event handler ────────────────────────────────────────────────────

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const { tabId } = source;
  const state = captureState[tabId];
  if (!state || !state.attached) return;

  // ── Request sent ────────────────────────────────────────────────────────────
  if (method === "Network.requestWillBeSent") {
    const { requestId, request, type } = params;
    if (!isApiRequest(request.url, request.method, type)) return;

    let payload = null;
    if (request.postData) {
      const ct = (request.headers["content-type"] || request.headers["Content-Type"] || "").toLowerCase();
      payload = ct.includes("application/json")
        ? tryParseJSON(request.postData)
        : request.postData;
    }

    state.requests.set(requestId, {
      requestId,
      url: request.url,
      method: request.method,
      headers: headersToObject(
        Object.entries(request.headers).map(([name, value]) => ({ name, value }))
      ),
      payload,
      resourceType: type,
      status_code: null,
      response_headers: {},
      response: null,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Response received ────────────────────────────────────────────────────────
  if (method === "Network.responseReceived") {
    const { requestId, response } = params;
    const entry = state.requests.get(requestId);
    if (!entry) return;

    entry.status_code = response.status;
    entry.response_headers = headersToObject(
      Object.entries(response.headers || {}).map(([name, value]) => ({ name, value }))
    );
    entry.mimeType = response.mimeType || "";

    // Fetch the response body asynchronously
    try {
      const bodyResult = await chrome.debugger.sendCommand(
        { tabId },
        "Network.getResponseBody",
        { requestId }
      );
      const rawBody = bodyResult.body || "";
      const ct = entry.mimeType.toLowerCase();
      entry.response = ct.includes("json") ? tryParseJSON(rawBody) : rawBody;
    } catch {
      // Body unavailable (e.g. redirects, streams) — leave as null
    }
  }
});

// ── Debugger detach event ─────────────────────────────────────────────────────

chrome.debugger.onDetach.addListener((source) => {
  const { tabId } = source;
  if (captureState[tabId]) {
    captureState[tabId].attached = false;
  }
  // Notify popup if open
  chrome.runtime.sendMessage({ type: "detached", tabId }).catch(() => {});
});

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const { action, tabId } = msg;

  if (action === "start") {
    const state = getState(tabId);
    if (state.attached) {
      sendResponse({ ok: true, alreadyAttached: true });
      return true;
    }
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      state.attached = true;
      chrome.debugger.sendCommand({ tabId }, "Network.enable", {}, () => {
        sendResponse({ ok: true });
      });
    });
    return true; // async response
  }

  if (action === "stop") {
    const state = getState(tabId);
    if (!state.attached) {
      sendResponse({ ok: true, sent: false });
      return true;
    }

    const entries = [...state.requests.values()];
    const webhookUrl = (msg.webhookUrl || "").trim();

    const doDetach = () => {
      chrome.debugger.detach({ tabId }, () => {
        state.attached = false;
      });
    };

    if (webhookUrl && entries.length > 0) {
      // Build payload: array of export-format objects
      const payload = entries.map(e => ({
        url:         e.url,
        method:      e.method,
        headers:     e.headers          || {},
        payload:     e.payload          || {},
        response:    e.response         || {},
        status_code: e.status_code      || null,
        timestamp:   e.timestamp        || null,
      }));

      fetch(webhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ captured_at: new Date().toISOString(), total: payload.length, requests: payload }),
      })
        .then(async res => {
          let body = {};
          try { body = await res.json(); } catch { /* ignore parse error */ }
          doDetach();
          sendResponse({
            ok:         true,
            sent:       true,
            status:     res.status,
            total:      payload.length,
            batchId:    body.batch_id    || null,
            resultsUrl: body.results_url || null,
            webhookUrl: webhookUrl,       // passed for origin validation in main.js
          });
        })
        .catch(err => {
          doDetach();
          sendResponse({ ok: true, sent: false, error: err.message, total: payload.length, webhookUrl });
        });
    } else {
      doDetach();
      sendResponse({ ok: true, sent: false, total: entries.length, webhookUrl });
    }
    return true;
  }

  if (action === "getLog") {
    const state = captureState[tabId];
    const entries = state ? [...state.requests.values()] : [];
    sendResponse({ entries });
    return true;
  }

  if (action === "clear") {
    const state = captureState[tabId];
    if (state) state.requests.clear();
    sendResponse({ ok: true });
    return true;
  }

  if (action === "status") {
    const state = captureState[tabId];
    sendResponse({ attached: state ? state.attached : false });
    return true;
  }
});
