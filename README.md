# Utilities for X

A Chrome extension (Manifest V3) with small quality-of-life utilities for x.com.

## Load locally

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this directory
4. Reload the extension after any change to `manifest.json`; content-script edits only need a page refresh

## Layout

| Path              | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `manifest.json`   | Extension manifest (MV3)                             |
| `src/content.js`  | Content script; each utility registers in `utilities` |
| `src/content.css` | Styles injected into x.com (prefix selectors `ufx-`) |
| `src/popup.html`  | Toolbar popup                                        |

## Adding a utility

Append an entry to `utilities` in `src/content.js` with an `id`, a `label`, and a `run()`.
Each runs inside its own try/catch, so one failing utility won't take down the rest.
Per-utility on/off state lives in `chrome.storage.sync` under `enabled`.
