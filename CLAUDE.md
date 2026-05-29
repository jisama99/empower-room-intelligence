# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**EMPOWER ROOM INTELLIGENCE v4.1** is a French-language PWA (Progressive Web App) for Norton × Impact Sales Marketing (ISM/Marvesting) field sales reps. It tracks store visits, phone calls, KPIs, and incentive calculations for the FY27 fiscal year.

**Stack**: Pure vanilla JS, no build tool, no framework, no npm. Three files: `index.html`, `style.css`, `app.js`.

**Backend**: Google Apps Script REST (deployed web app). Data persists in Google Sheets.

## Development

There is no build step. Serve the root directory with any static HTTP server:

```bash
python3 -m http.server 8000
# or VS Code Live Server extension
# then open http://localhost:8000
```

No test suite exists. There is no linter configuration.

To deploy: push `index.html`, `style.css`, `app.js` (and `manifest.json`, `service-worker.js`, `icons/`) to the hosting platform. The Apps Script backend URL is set in `CONFIG.APPS_SCRIPT_URL`.

## Architecture

The entire application logic lives in `app.js` (~2964 lines), structured as numbered sections:

| Section | Object | Responsibility |
|---------|--------|----------------|
| 1 | `CONFIG` | Single source of truth: app version, Apps Script URL, timeouts, thresholds |
| 2 | `USERS`, `OBJECTIFS_FY27` | Static user registry (PIN → role/rights) and FY27 targets |
| 3 | `STATE` | Global mutable state: authenticated user, loaded data, current route, visit draft |
| 4 | `Auth` | PIN authentication, 8-hour localStorage session, role helpers |
| 5 | `Router` | SPA router using `history.pushState`, template cloning |
| 6 | `API` | HTTP client for Apps Script; all calls go through `API.call()` |
| 6bis | `Normalize` | Defensive data normalization — every row from Sheets passes through here |
| 6ter | `OfflineQueue` | localStorage queue; replays on `window.online` so no data is lost on 3G |
| 7 | `UI` | Shared components: toast, modal bottom-sheet, loader/spinner, account card |
| 8 | `Utils` | Pure helpers: HTML escape, EUR/% formatting, ISO week, Jaccard similarity |
| 9 | `Screens` | One function per route; registered in the `Screens` object |
| 10 | init | `DOMContentLoaded` bootstrap: `Router.init()`, `OfflineQueue.init()`, `Auth.init()` |

### Router / Screens pattern

`Router._renderScreen()` clones the matching `<template id="tpl-{name}">` from `index.html` into `#screen-container`, then calls `Screens[name](params)`. Every screen initializes itself by querying the freshly cloned DOM and wiring event listeners.

Routes are defined in `Router.ROUTES`. Some require specific PINs (`requires: [1000, 2000]`).

### API layer

`API.call(action, payload, method)` always:
- Sends `pin` + `action` as URL query params (Apps Script reads `e.parameter`)
- Uses `Content-Type: text/plain;charset=UTF-8` for POST to avoid CORS preflight
- Applies a configurable timeout (`CONFIG.API_TIMEOUT`)
- Throws on HTTP errors and on `{ error: '...' }` in the response

The Groq AI pipeline (voice dictation → Whisper transcription → Llama extraction) is proxied entirely through Apps Script — the Groq key is never in client code.

## User roles and PINs

| PIN | Name | Role | Key permissions |
|-----|------|------|-----------------|
| 1000 | Tadjidine | manager / super-user | All features, bonus manager, physical deletion, objective validation |
| 2000 | Alexandra | directrice | Co-manager: COPIL, exports, NSB, CA import, co-validates objectives |
| 3000 | Flavie | flavie | Read-only pipeline + lead management |
| 4001 | Mehdi | cds | Pipeline, visits, phoning, primes |
| 4002 | Lyes | cds | Pipeline, visits, phoning, primes |
| 4003 | Johanne | cds | Pipeline, visits, phoning, primes |

`STATE.isManager` is true for both PINs 1000 and 2000. `STATE.isSuperUser` is true only for 1000.

Use the `Auth.*` helpers (`Auth.isManager()`, `Auth.isCDS()`, `Auth.isPin1000()`, `Auth.canSupprimer()`, `Auth.canModifierObj()`) — never compare `STATE.pin` directly except where business logic explicitly requires it.

## Key conventions

**HTML escaping**: Always use `Utils.esc(value)` when inserting user or server data into `innerHTML`. Never bypass this.

**Data normalization**: All data received from Apps Script must pass through `Normalize.compte()` or `Normalize.comptes()` before use. This prevents crashes from empty/corrupt Sheets cells.

**CSS design tokens**: All colors, spacing, radii, and shadows are CSS custom properties on `:root` (e.g. `var(--nav)`, `var(--coral)`, `var(--r-md)`). Use tokens; do not hardcode values.

**Hiding elements**: Use the `.hidden` class (`display: none !important`), not inline `style.display`. Exceptions exist for the RGPD modal (inline for specificity reasons) and the PIN 1000 bonus section (intentionally absent from DOM rather than hidden, to prevent client-side inspection).

**Manager-only DOM nodes**: The bonus manager section in the COPIL and home screens is inserted into the DOM by JavaScript only when `Auth.isPin1000()` is true — it is not in the template and not CSS-hidden. Maintain this pattern.

**Visit canal**: The visit form (10 blocs) has a Phoning vs Visite toggle. Elements with `data-canal-visite-only` are hidden and their inputs disabled in Phoning mode. Respect this attribute when adding new bloc content.

**Offline resilience**: Failed `addVisite` and `addAppel` POST calls should be enqueued via `OfflineQueue.enqueue(action, payload)` rather than silently dropped.

**Objective revision**: `updateObjectif()` blocks revision to 0. Alexandra (2000) writes with `co_validation: true`; manager (1000) validates immediately. This asymmetry is intentional.

## Business vocabulary

- **CDS** — Chargé de Développement Secteur (field sales rep)
- **NSB** — Nouveau Sujet Bienvenue (a specific Norton product line tracked for incentives)
- **AXE1/2/3** — The three incentive pillars (CA vs objective / NSB orders / activation + onboarding)
- **COPIL** — Management review dashboard (PIN 1000/2000 only)
- **Compte** — An established reseller account (in the Sheets COMPTES tab)
- **Prospect** — A not-yet-active account (in the PROSPECTS tab)
- **Cold revendeur** — A new prospect created from a cold visit; gets `Origine=Visite_terrain`
- **EMPOWER** — The Norton partner portal; interest level drives prospect nurturing workflows
- **Marvesting** / **ISM** — Impact Sales Marketing, the agency running the field team
