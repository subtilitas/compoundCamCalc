# Changelog

All notable changes are listed here. Versions follow semantic versioning.

## Unreleased

### Added

- Project plan (`docs/PLAN.md`).
- Build and test tooling: Vite, Vitest with V8 coverage, ESLint, TypeScript
  check of JSDoc types, Playwright with axe accessibility checks.
- Unit conversion module with exact constants (1 in = 0.0254 m,
  1 lbf = 4.4482216152605 N) and parsing of decimal comma input.
- CI, docs-to-wiki and release workflows; Pages deploy on push to `main`.
- README coverage figure with a `--check` mode.
- CI check that fails on session links in tracked files or commit messages
  (`scripts/check-session-links.js`).
- Force curve interpolant (`src/core/interp.js`): C2 piecewise quintic
  Hermite spline with Fritsch–Butland slopes (as SciPy
  `PchipInterpolator`) and second derivatives limited per interval, so
  monotone data stay monotone without overshoot; exact integral; optional
  prescribed slope and second derivative at the start point, with a
  search for monotone values at the first two knots when shrinking
  towards 0 fails; non-finite prescribed values are rejected.
- Force curve model (`src/core/curve.js`): peak, holding weight, let-off,
  valley width (5 % band), draw energy and power stroke; parametric
  generator with seven points; move, add and remove point operations with a
  0.1 in (2.54 mm) minimum gap and a 1 N to 5000 N force range; peak scaling
  and a let-off mapping that stays invertible down to 0 %.
- Project state (`src/state/`): schema version 1 in SI units with
  validation messages in plain words, migration of saved data, JSON codec
  that never throws, default preset (ATA 33 in, brace height 6.5 in, draw
  length 29 in, peak 267 N, let-off 80 %, string diameter 2.5 mm) and a
  store with undo and redo of 100 steps and transactions for drag gestures,
  during which undo and redo wait; geometry changes keep the 0.1 in gap
  between custom points.
- Force curve editor: SVG chart with mouse, touch and keyboard editing,
  floating position readout with the point number, toolbar, point table
  with inline messages, status line with the position after keyboard moves
  and the reason for refused edits, stats line, settings for geometry, peak,
  let-off, rise and valley width with notes when the curve cannot follow a
  setting, unit selectors for draw length, force and energy, parametric and
  custom curve modes, glossary popovers, autosave to localStorage that
  writes at once when the page is hidden and keeps a copy of unreadable
  saved data.
- User guide (`docs/user-guide.md`).
