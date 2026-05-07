# GrowSeason 2026

A single-page dashboard for tracking an outdoor cannabis grow in Roanoke, VA.

## Run locally

```sh
python -m http.server
```

Then open `http://localhost:8000`.

## Deploy to Netlify

Drag the `growseason/` folder onto [app.netlify.com/drop](https://app.netlify.com/drop). No configuration needed — `netlify.toml` sets the publish directory to the project root.

## Features

- **Timeline** — Gantt-style SVG showing veg / flower / harvest windows for all four strains across May–November, with a live "today" marker and frost line.
- **Now** — Per-strain current phase, days into phase, and days until the next milestone.
- **Tasks** — Full season task list with recurring Bt spray expansions, filter chips (Today / This week / Overdue / All), and persistent checkbox state.
- **Journal** — Per-strain daily log with optional height, node count, and water volume fields. Exports to Markdown.
- **Shopping** — Categorized supply list with three-state cycle (needed → ordered → acquired) and priority indicators. Conditional light dep items appear only when that mode is on.
- **Settings** — Toggle Laughing Buddha light dep mode (shifts harvest ~3 weeks earlier), edit transplant and frost dates, export/import full app state as JSON.

## Data model

All reference data lives in `data.js` as `window.SEASON_DATA`. The object has four top-level keys:

- `season` — location, zone, frost date, transplant target
- `strains[]` — per-strain phenology dates, color, and notes. Laughing Buddha has a nested `lightDepMode` object with alternate dates.
- `tasks[]` — task definitions. `recurring: "weekly"` with `until` expands to individual dated entries. `conditional: "lightDep"` hides the task unless light dep is enabled.
- `shopping[]` — supply items with `priority`, `needBy`, and optional `notes`.

All user state (task completion, journal entries, shopping status, settings) is persisted to `localStorage` and survives hard reloads.

## Adding a fifth strain mid-season

1. Open `data.js` and append a new object to the `strains` array with the same shape as the existing entries. Pick a unique `id`, set `vegStart`, `flowerStart`, `harvestStart`, `harvestEnd`, `color`, and `flowerWeeks`.

2. Add any strain-specific tasks to the `tasks` array using the strain's `id` as the `scope` value.

3. Reload `index.html`. The timeline, now panel, and journal strain tabs all derive their content from `SEASON_DATA` — no template changes needed.

## Time travel for testing

Append `?today=YYYY-MM-DD` to the URL to override the current date:

```
http://localhost:8000?today=2026-08-15
```

This lets you verify that phase calculations, overdue task highlighting, and frost warnings all behave correctly at any point in the season.

## File layout

```
growseason/
  index.html     — single page, all six panels
  app.js         — Alpine.js component, all logic
  data.js        — SEASON_DATA reference data
  styles.css     — dark theme, mobile-first
  netlify.toml   — static deploy config
  README.md      — this file
```
