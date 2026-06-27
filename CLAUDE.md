# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # dev server at http://localhost:5173/medication-calculator/
pnpm test         # run Vitest unit tests
pnpm test:watch   # watch mode
pnpm build        # type-check + Vite bundle → dist/
```

## Architecture

React + TypeScript + Vite SPA, deployed to GitHub Pages at `teezeit.github.io/medication-calculator/`.

The Python files (`streamlit_app.py`, `fit.py`) are legacy and no longer the entry point.

**`src/model.ts`** - bi-exponential pharmacokinetic computation. `PARAMS` are pre-fitted constants from research data. `computeConcentrations(doseTimes)` takes `[hour, mg][]` and returns a 1140-point time array (5 to 24h, minute resolution) plus per-dose individual curves and their sum.

**`src/chart.ts`** - pure Plotly figure builder. `buildFigure(results, options)` takes pre-computed `ConcentrationResult[]` and returns `{ data, layout }`. Handles multi-schedule compare mode, threshold line, "you are here" vrect+marker, and mobile/desktop layout variants. Does not call Plotly directly - App.tsx calls `Plotly.react()`.

**`src/App.tsx`** - UI. Mobile-first layout (default `isMobile: true`, detects via `window.innerWidth < 600` on mount). Two tabs: single dose schedule and compare mode. DoseTable component uses `<input type="time">` and `<input type="number">` for editable rows.

## Key design notes

- Time is always decimal hours internally (7.5 = 7:30 AM); conversion in `rowsToDoseEntries()`.
- Mobile default state avoids flash on narrow viewports.
- Compare tab shows two dose tables; the "Compare mode" checkbox determines whether to plot one or two schedules.
- `buildFigure` is unit-tested (`chart.test.ts`) without needing Plotly in the DOM; tests verify trace counts, shape presence, and layout ranges.
