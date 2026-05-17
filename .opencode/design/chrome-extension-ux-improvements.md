# Chrome Extension UI/UX Improvements

## Overview
Comprehensive UX refresh for the "AI Test API Capture" Chrome extension (popup + full-page mode). The extension uses `chrome.debugger` to capture HTTP(S) API traffic, sends captured requests to a webhook backend for AI-powered test generation, and displays results.

## Current Architecture Summary
- **`manifest.json`** — Manifest V3, permissions: `debugger`, `activeTab`, `storage`, `downloads`, `<all_urls>`
- **`background.js`** — Service worker. Manages `chrome.debugger` attach/detach, captures `Network.requestWillBeSent` + `Network.responseReceived` events, stores entries in an in-memory `Map<tabId, entries>`
- **`popup.html`** — Single-page layout: header → workflow bar → controls → webhook bar → filter bar → request list | detail panel | results panel
- **`popup.js`** (~1300 lines) — Monolithic UI controller. Handles polling, filtering, detail views, results rendering, theme, webhook config, persistence
- **`styles.css`** (~1384 lines) — Dark/light theme via CSS custom properties, custom scrollbar, developer-tool aesthetic

## Design Scope (Mixed Approach)

Three phases, implement in order:

### Phase 1 — Quick Wins
1. Keyboard shortcuts
2. Focus management
3. Toast notification system
4. Confirmation on Clear
5. Smooth expand/collapse animations
6. Paginated request list (incremental render)
7. Contextual empty state SVGs
8. Status bar feedback during capture
9. ARIA labels & keyboard roles
10. Click ripple feedback

### Phase 2 — Medium Refinements
11. Tab-based main navigation (clickable workflow steps)
12. Responsive popup 2-column layout
13. Batch selection for export/send
14. Filter persistence across sessions
15. Session timeline strip
16. Full-text search within results
17. Loading skeleton placeholders

### Phase 3 — Structural
18. Virtual scrolling for large lists
19. IndexedDB storage for large captures

---

## Phase 1 — Detailed Design

### 1. Keyboard Shortcuts

**Strategy:** Central shortcut registry using a `KeyboardShortcutManager` module. Decoupled from DOM event handlers.

```js
// popup.js — new module (or inline if small)
const shortcuts = new KeyboardShortcutManager();

shortcuts.register('ctrl+enter', () => {
  isCapturing ? stopCapture() : startCapture();
});
shortcuts.register('escape', () => {
  closeDetail();
  closeResults();
});
shortcuts.register('ctrl+f', () => {
  filterInput.focus();
  filterInput.select();
});
shortcuts.register('ctrl+shift+e', () => {
  if (selectedEntry) exportSelected();
});
shortcuts.register('ctrl+shift+c', () => {
  clearCapture();
});
```

**Key decisions:**
- Use `keydown` on `document`, not `chrome.commands` API — commands API only works when extension has focus, but we also want shortcuts in popup
- Store registry as a Map so shortcuts can be enabled/disabled per view state (e.g., disable `Ctrl+F` when detail panel is focused)

**ADR-1: `chrome.commands` vs document keydown**
- `chrome.commands` requires manifest registration and only fires in extension context
- Document keydown is simpler, testable, works in both popup and fullpage mode
- Decision: document keydown with a registry pattern

### 2. Focus Management

**Pattern:** `FocusManager` singleton.

```js
class FocusManager {
  trap(element)       // trap Tab key within element
  release()           // remove trap
  focusFirst(element) // focus first focusable child
}
```

- On popup open → focus `filter-input`
- On detail open → focus detail panel first tab
- On results open → focus results panel
- On Escape → close current panel and return focus to filter

### 3. Toast Notification System

**Current:** Inline `webhook-status` div that flashes and pushes content around.

**New:** Fixed-position toast container at top of `.window-frame`.

```html
<!-- popup.html — add once -->
<div id="toast-container" class="toast-container" aria-live="polite"></div>
```

```css
.toast-container {
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
}
.toast {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  box-shadow: var(--shadow-md);
  animation: toast-in 0.2s ease-out;
  pointer-events: auto;
  white-space: nowrap;
}
.toast-ok   { background: var(--green); color: var(--bg); }
.toast-warn { background: var(--orange); color: var(--bg); }
.toast-err  { background: var(--red); color: var(--contrast-text); }

@keyframes toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.toast-out {
  animation: toast-out 0.2s ease-in forwards;
}
@keyframes toast-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-8px); }
}
```

```js
function showToast(message, type = 'ok', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}
```

**Replace all calls:**
- `showWebhookStatus(msg, "ok")` → `showToast(msg, "ok")`
- `showWebhookStatus(msg, "warn")` → `showToast(msg, "warn")`
- `showWebhookStatus(msg, "err")` → `showToast(msg, "err")`

**ADR-2: Toast animation vs no animation**
- Animations improve perceived responsiveness and draw attention to transient messages
- Using `animationend` to clean up DOM avoids setInterval polling
- Decision: CSS keyframe animations with DOM cleanup

### 4. Confirmation on Clear

**Pattern:** Inline confirmation bar (not a blocking `confirm()` dialog).

```html
<!-- popup.html — add next to controls or reuse -->
<div id="clear-confirm" class="clear-confirm hidden">
  <span>Clear all captured requests?</span>
  <button id="btn-confirm-clear" class="btn btn-red btn-sm">Yes, Clear</button>
  <button id="btn-cancel-clear" class="btn btn-gray btn-sm">Cancel</button>
</div>
```

**Flow:**
1. User clicks Clear
2. If `allEntries.length === 0` → no-op
3. If entries exist → hide `btn-clear`, show `clear-confirm` bar with undo button
4. "Yes, Clear" → execute clear; "Cancel" → hide bar, show btn-clear again
5. Auto-dismiss after 8 seconds via timeout

### 5. Smooth Expand/Collapse Animations

**Targets:**
- `.group-tests.collapsed` / `.group-tests` (API groups in results panel)
- `.result-detail.hidden` / `.result-detail` (individual test result details)
- `.detail-panel.hidden` / `.detail-panel` (right-column detail panel)

**CSS change pattern:**

```css
/* Before: instant hide */
.group-tests.collapsed { display: none; }

/* After: animated collapse */
.group-tests {
  max-height: 2000px;           /* large enough for content */
  opacity: 1;
  overflow: hidden;
  transition: max-height 0.25s ease, opacity 0.2s ease, margin 0.2s ease;
}
.group-tests.collapsed {
  max-height: 0;
  opacity: 0;
  margin: 0;
}
```

Repeat for `.result-detail` and `.detail-panel`.

### 6. Paginated Request List (Incremental Render)

**Current:** Renders all entries at once into DOM.

**New:** `IncrementalList` helper.

```js
const RENDER_CHUNK = 50;
let renderCount = 0;

function renderList() {
  const entries = filterEntries();
  // ... setup ...
  if (entries.length > RENDER_CHUNK && renderCount < entries.length) {
    // Add "Show more" button or auto-load on scroll
  }
  renderCount = Math.min(entries.length, renderCount + RENDER_CHUNK);
  // render up to renderCount entries only
}

// Auto-load on scroll
requestList.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = requestList;
  if (scrollHeight - scrollTop - clientHeight < 100) {
    renderCount += RENDER_CHUNK;
    renderList();
  }
});
```

**Empty state updates (item 7):**

Replace text-only empty states with inline SVG illustrations. Keep the existing text but wrap in a more visually structured container.

### 8. Status Bar Feedback

Add a live status indicator next to `capture-count` during capture:

```html
<!-- popup.html — in .controls -->
<span id="live-status" class="live-status hidden">● Capturing…</span>
```

```css
.live-status {
  font-size: 11px;
  color: var(--green);
  font-weight: 600;
  animation: pulse-dot 1.2s ease-in-out infinite;
}
```

Show when capturing, hide when stopped.

### 9. ARIA Labels

**Add to popup.html:**
```html
<header role="banner" aria-label="Extension toolbar">
<div class="workflow-bar" role="navigation" aria-label="Workflow steps">
<div class="step step-active" id="step-1" role="tab" aria-selected="true" aria-controls="panel-capture">
<div class="tabs" role="tablist" aria-label="Request details">
  <button class="tab-btn active" data-tab="request" role="tab" aria-selected="true">Request</button>
<pre id="detail-url" class="code-block" aria-label="Request URL">
<div id="request-list" class="request-list" role="listbox" aria-label="Captured requests">
```

**In popup.js:**
- `aria-expanded` on `.results-group-header` toggle buttons
- `aria-controls` linking headers to their content panels
- Focus management with `tabindex` as needed

### 10. Click Ripple Feedback

```css
.btn {
  position: relative;
  overflow: hidden;
}
.btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,0.1);
  opacity: 0;
  transition: opacity 0.2s;
}
.btn:active::after {
  opacity: 1;
  transition: opacity 0s;
}
```

---

## Phase 2 — Detailed Design

### 11. Tab-Based Main Navigation

**Current:** Workflow steps are decorative indicators only.

**New:** Clickable tabs that switch the main content area.

```html
<!-- popup.html — workflow-bar becomes clickable -->
<div class="workflow-bar" role="tablist">
  <button class="step step-active" data-view="capture" role="tab" aria-selected="true">
    <span class="step-num">1</span>
    <span class="step-label">Capture</span>
  </button>
  <span class="step-arrow">›</span>
  <button class="step step-pending" data-view="analyze" role="tab" aria-selected="false" disabled>
    <span class="step-num">2</span>
    <span class="step-label">Analyze</span>
  </button>
  <span class="step-arrow">›</span>
  <button class="step step-pending" data-view="results" role="tab" aria-selected="false" disabled>
    <span class="step-num">3</span>
    <span class="step-label">Results</span>
  </button>
</div>
```

**View switching:**
- "Capture" view → request list + detail panel (current left+right)
- "Analyze" view → webhook bar + progress/results (collapses request list)
- "Results" view → full results panel (hides capture list)

```css
.view-capture .view-analyze { display: none; }
.view-capture .view-results { display: none; }
.view-analyze .view-capture-main { display: none; }
/* etc. */
```

**Auto-switch:**
- On Start → auto-switch to Capture view
- On Stop → auto-switch to Analyze view
- On results received → enable Results tab, auto-switch
- User can always click back to Capture to inspect

### 12. Responsive Popup Layout

**Current:** In popup mode, `.main-split` is `display: contents` — everything stacks.

**New:** Use CSS `container queries` (or matchMedia fallback):

```css
/* Popup (<900px) — when detail is closed, show request list full width;
   when detail is open, split 50/50 */
.main-split {
  display: flex;
  flex-direction: row;
}
.col-left {
  flex: 0 0 100%;
  transition: flex 0.2s;
}
.detail-open .col-left {
  flex: 0 0 50%;
  max-width: 50%;
}
.detail-open .col-right {
  display: flex;
  flex: 0 0 50%;
  flex-direction: column;
}
```

### 13. Batch Selection

```html
<!-- Each request row gets a checkbox -->
<div class="request-row">
  <input type="checkbox" class="req-checkbox" />
  <!-- existing content -->
</div>
<div id="batch-bar" class="batch-bar hidden">
  <span id="batch-count">0 selected</span>
  <button id="btn-batch-export">Export Selected</button>
  <button id="btn-batch-send">Send to Webhook</button>
  <button id="btn-batch-select-all">Select All</button>
</div>
```

**State:** `let selectedRequestIds = new Set();`

**Batch bar** appears when `selectedRequestIds.size > 0`.

### 14. Filter Persistence

```js
// Save
function saveFilterState() {
  chrome.storage.local.set({
    filterState: {
      text: filterInput.value,
      method: activeMethodFilter,
      savedAt: Date.now(),
    }
  });
}

// Restore
function restoreFilterState() {
  chrome.storage.local.get('filterState', data => {
    const f = data.filterState;
    if (!f) return;
    if (Date.now() - f.savedAt > 24 * 60 * 60 * 1000) return; // stale
    filterInput.value = f.text || '';
    activeMethodFilter = f.method || 'ALL';
    // update UI pills
  });
}
```

### 15. Session Timeline

Add a compact timeline bar below the request list header:

```html
<div id="timeline" class="timeline hidden">
  <div id="timeline-bar" class="timeline-bar"></div>
</div>
```

Show relative timing of requests as thin colored bars. Only visible when capturing or when entries exist. Minimal — ~30px height.

### 16. Full-Text Search in Results

Add a search input to `results-filter-bar`:

```html
<input id="results-search" type="text" placeholder="Search tests…" class="results-search" />
```

```js
function filterTests(tests) {
  const q = resultsSearch.value.trim().toLowerCase();
  return tests.filter(t =>
    !q ||
    (t.name || '').toLowerCase().includes(q) ||
    (t.description || '').toLowerCase().includes(q) ||
    (t.error || '').toLowerCase().includes(q) ||
    (t.category || '').toLowerCase().includes(q) ||
    (t.failure_suggestion || '').toLowerCase().includes(q)
  );
}
```

### 17. Loading Skeleton Placeholders

Replace spinner with content-matching skeletons:

```html
<div class="skeleton-group">
  <div class="skeleton-row" style="width: 60%"></div>
  <div class="skeleton-row" style="width: 85%"></div>
  <div class="skeleton-row" style="width: 45%"></div>
</div>
```

```css
.skeleton-row {
  height: 12px;
  background: linear-gradient(90deg, var(--win-btn) 25%, var(--win-bevel-lighter) 50%, var(--win-btn) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## Data Model (Storage Schema)

### chrome.storage.local keys

| Key | Value | TTL | Notes |
|---|---|---|---|
| `capturedEntries` | `{ tabId, entries: Entry[], savedAt }` | 2h | Persisted entries across popup close; used for restore |
| `activeResults` | `{ resultsUrl, data: ResultsData, savedAt }` | 2h | Persisted results state for polling restore |
| `webhookUrl` | `string` | ∞ | Saved webhook URL |
| `openapi_theme` | `"dark" \| "light"` | ∞ | User theme preference |
| `filterState` | `{ text, method, savedAt }` | 24h | Filter state persistence (Phase 2) |
| `selectedIdsBatch` | `string[]` | 1h | Batch selection IDs (Phase 2) |

### Entry shape (data model)

```ts
interface Entry {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  payload: any;
  response: any;
  status_code: number | null;
  response_headers: Record<string, string>;
  timestamp: string;
  resourceType: string;
  mimeType: string;
  duration_ms?: number;
}
```

### ResultsData shape

```ts
interface ResultsData {
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
  progress?: { done: number; total: number };
  summary?: { passed: number; failed: number; errors: number; total: number };
  groups: Array<{
    api_request: string;
    summary?: { passed: number; failed: number; errors: number };
    error?: string;
    test_results: Array<{
      name: string;
      passed: boolean;
      error?: string;
      category?: string;
      description?: string;
      expected_status?: number;
      actual_status?: number;
      duration_ms?: number;
      scenario_description?: string;
      request_body_note?: string;
      method?: string;
      url?: string;
      request_headers?: Record<string, string>;
      request_payload?: any;
      model_request?: any;
      assertion_notes?: string;
      failure_suggestion?: string;
    }>;
  }>;
}
```

---

## Module Architecture (popup.js Refactor)

Current `popup.js` is a monolithic 1300-line file. Refactor into logical modules:

| Module | Responsibility | Exports |
|--------|---------------|---------|
| `shortcuts.js` | Keyboard shortcut registry | `register()`, `unregister()`, `enabled()` |
| `focus.js` | Focus trap, auto-focus | `trap()`, `release()`, `focusFirst()` |
| `toast.js` | Toast notification system | `showToast()` |
| `filter.js` | Text + method filtering | `filterEntries()`, `saveFilterState()`, `restoreFilterState()` |
| `list.js` | Request list rendering, incremental render | `renderList()`, `updateCount()` |
| `detail.js` | Detail panel, tabs, export | `openDetail()`, `closeDetail()`, `switchTab()` |
| `results.js` | Results panel, polling, rendering | `startPolling()`, `renderResults()`, `fetchResults()` |
| `testcase-workspace.js` | API testcase viewer | `renderDetailTestcaseWorkspace()` |
| `theme.js` | Dark/light toggle, persistence | `loadTheme()`, `applyTheme()`, `toggleTheme()` |
| `webhook.js` | Webhook URL save/test | `saveWebhookUrl()`, `testConnection()` |
| `batch.js` | Batch selection (Phase 2) | `toggleSelect()`, `exportSelected()`, `sendSelected()` |
| `storage.js` | chrome.storage helpers | `get()`, `set()`, `remove()` with TTL logic |
| `main.js` | Init, message handling, orchestration | `initWithTabId()`, event wiring |

**Module dependency graph:**
```
main.js
  ├─ toast.js (self-contained)
  ├─ shortcuts.js (self-contained)
  ├─ focus.js (self-contained)
  ├─ theme.js (depends on: storage.js)
  ├─ storage.js (self-contained)
  ├─ webhook.js (depends on: toast.js, storage.js)
  ├─ filter.js (depends on: storage.js)
  ├─ list.js (depends on: filter.js)
  ├─ detail.js (depends on: toast.js, list.js)
  ├─ testcase-workspace.js (depends on: detail.js)
  ├─ results.js (depends on: toast.js, storage.js, list.js)
  └─ batch.js (depends on: list.js, toast.js)
```

**No circular dependencies.** Each module imports from below or from self-contained modules only.

---

## Service Interfaces (Module Contracts)

### shortcuts.js
```js
function register(combo: string, handler: () => void): void
function unregister(combo: string): void
function setEnabled(view: 'capture' | 'analyze' | 'results'): void
```

### focus.js
```js
function trap(container: HTMLElement): void
function release(): void
function focusFirst(container: HTMLElement): void
```

### toast.js
```js
function showToast(message: string, type: 'ok' | 'warn' | 'err', duration?: number): void
```

### filter.js
```js
function filterEntries(entries: Entry[]): Entry[]
function saveFilterState(): Promise<void>
function restoreFilterState(): Promise<void>
function setMethodFilter(method: string): void
function setTextFilter(text: string): void
```

### storage.js
```js
function get<T>(key: string): Promise<T | null>
function set(key: string, value: any): Promise<void>
function remove(key: string): Promise<void>
function getWithTTL<T>(key: string, ttlMs: number): Promise<T | null>
```

### batch.js (Phase 2)
```js
function toggleSelect(requestId: string): void
function selectAll(): void
function deselectAll(): void
function getSelected(): string[]
function exportSelected(): Blob
function sendSelected(webhookUrl: string): Promise<SendResult>
```

---

## Key Decisions (ADRs)

### ADR-3: Monolithic → Modular refactor
- **Context:** popup.js is 1300 lines, single function scope
- **Options:** (a) keep monolithic, (b) extract to separate files with IIFE, (c) ES modules with import/export
- **Decision:** ES modules (`type="module"` in popup.html). Chrome 89+ supports modules.
- **Consequence:** Must update `popup.html` script tag to `<script type="module" src="popup.js"></script>` and refactor into `import`/`export`. All tests must import modules.

### ADR-4: CSS transitions for collapse vs CSS `display` toggling
- **Context:** `display: none` is not animatable; `max-height` animation has quirks with large values
- **Decision:** Use `max-height` + `opacity` transitions for collapsible containers. Set `max-height` to a generous upper bound (2000px). Accept minor timing mismatch for very large content.
- **Alternative considered:** `grid-template-rows: 0fr/1fr` — not widely supported enough for Chrome extensions targeting Chrome 89+.

### ADR-5: Inline confirmation vs blocking `confirm()`
- **Context:** Standard `confirm()` is blocking and ugly
- **Decision:** Inline confirmation bar within the controls row. Styled to match the theme, non-blocking, auto-dismisses.
- **Consequence:** Slightly more markup but consistent UX.

### ADR-6: Incremental render vs virtual scrolling for Phase 1
- **Context:** Request list could have hundreds of entries
- **Decision:** Incremental render (chunked append) for Phase 1. Virtual scrolling deferred to Phase 3.
- **Rationale:** Virtual scrolling requires measuring row heights, managing a visible window, and is more complex to implement correctly. Incremental render with a scroll trigger solves 80% of the problem with 20% of the code.

---

## Design Review Gate Checklist

- ✅ **Every endpoint has its auth requirements specified** — N/A (Chrome extension, no auth)
- ✅ **Every data model has its relationships and cascade rules defined** — Entry, ResultsData, storage keys all specified
- ✅ **Every service interface has its responsibilities documented** — Module contracts defined
- ✅ **Every repository interface beyond base CRUD is listed** — storage.js with TTL logic, batch selection
- ✅ **Design avoids circular dependencies between layers** — Module dependency graph is a DAG, no cycles

---

## Implementation Order

### Phase 1 (Quick Wins)
1. **focus.js** + **shortcuts.js** + **toast.js** — self-contained, no dependencies
2. Update `popup.html` — add toast container, clear-confirm bar, live-status span, ARIA attributes
3. **storage.js** — extract storage helpers with TTL
4. **filter.js** — extract filter logic (text + method)
5. **list.js** — incremental render, empty states, timeline
6. **detail.js** — extract detail panel (tabs, export, selection)
7. CSS — smooth transitions, ripple, skeletons, toast animations
8. Integrate into `main.js`

### Phase 2 (Medium)
1. **batch.js** — batch selection + batch bar
2. **theme.js** — extract theme logic
3. **webhook.js** — extract webhook logic
4. **results.js** + **testcase-workspace.js** — extract results panel
5. Tab navigation — clickable workflow steps
6. Responsive layout — container queries

### Phase 3 (Structural)
1. Virtual scrolling (custom or `react-virtual`-style windowing)
2. IndexedDB adapter for storage.js (swap implementation)
