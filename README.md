# Utilities for X

A Chrome extension (Manifest V3) with small quality-of-life utilities for x.com.

## Load locally

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this directory
4. Reload the extension after any change to `manifest.json`; content-script edits only need a page refresh

## DM templates

Outbound DMs with variables, filled from the conversation you're looking at — no AI,
no automation, you always press Send yourself.

1. Click the toolbar icon → the template manager opens.
2. Write a template, e.g. `Hey {{first_name}}! …`, and record a shortcut (defaults: ⌥1, ⌥2).
3. On x.com, open any classic DM or XChat conversation and press the shortcut. The composer is
   pre-filled with the template, variables substituted from the recipient's profile
   header. Review, edit, send.

Variables: `{{first_name}}`, `{{full_name}}`, `{{handle}}` resolve automatically from
the conversation header. Names are cleaned programmatically — emoji stripped,
`| Building X`-style suffixes cut, `JANE` → `Jane`. If one can't be resolved (group
chat, no header found) nothing is inserted and a toast explains why.

`{{company}}` is a manual variable for now: it inserts a pre-selected `[company]`
token, so your very next keystrokes replace it — type the company, hit Send.

Troubleshooting: in DevTools console, switch the JavaScript context from `top` to
`Utilities for X`, then run `__ufxDmDebug()` to see the composer, recipient, route,
and loaded templates the extension detects. X ships DOM changes regularly; that
helper is the fastest way to spot selector drift.

**Read `SAFETY.md` before running outreach** — the extension never automates sending,
but X enforces duplicate/volume limits on human-sent DMs too.

## Layout

| Path                   | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `manifest.json`        | Extension manifest (MV3)                                   |
| `src/background.js`    | Opens the manager from the toolbar icon; seeds starter templates |
| `src/content.js`       | Content-script runner; executes registered utilities       |
| `src/dm-templates.js`  | DM templates utility (shortcut → resolve recipient → insert) |
| `src/template-lib.js`  | Pure helpers shared by content script and manager page     |
| `src/options.*`        | Template manager page (list, editor, shortcut recorder, preview) |
| `src/content.css`      | Styles injected into x.com (prefix selectors `ufx-`)       |
| `SAFETY.md`            | X ToS/policy review + operating guardrails                 |
| `test/`                | Browser harnesses (no build needed): manager UI, classic Draft.js DMs, and current XChat textarea/header behavior |

## Adding a utility

Create `src/<utility>.js` that pushes `{ id, label, run() }` onto
`window.__ufxUtilities`, and list it in `manifest.json` before `src/content.js`.
Each utility runs inside its own try/catch, so one failing utility won't take down
the rest. Per-utility on/off state lives in `chrome.storage.sync` under `enabled`.

## Roadmap

- Auto-resolve `{{company}}` from the recipient's bio link (strip protocol + TLD), replacing the manual type-over placeholder
- Daily send counter with soft-limit nudges (see `SAFETY.md` guardrails)
- Link-in-first-message warning
- Hosted web version of the template manager, synced to the extension
