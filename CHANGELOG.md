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
- Cam track support functions (`src/core/support.js`): eccentric circle,
  ellipse with offset centre, parallel offset (groove bottom to pitch line)
  and C2 cubic spline (periodic or open) with exact integrals; ellipse
  integrals by Carlson's symmetric elliptic integrals (`src/core/elliptic.js`).
- Cord contact solver (`src/core/contact.js`): tangent from a point to a
  track by Newton with a bracketing fallback, cord length from the
  termination by the envelope identity, free span and direction; never
  throws and reports a point inside the track.
- Bow geometry (`src/core/geometry.js`): limb pivot from brace, top and
  bottom axle positions and their derivatives, string half-length and cable
  length, projection partials.
- Limb model (`src/core/limb.js`): linear limb with preload, tabulated limb
  fitted by the C2 monotone quintic, stiffness from a target axle travel,
  energy inverse, draw, total and preload energy.
- Forward model (`src/core/forward.js`): draw force, cam and limb rotation,
  string and cable tension along the draw from given string and cable
  tracks, within the time budgets of 8 ms for 100 samples and 100 ms for
  1500 samples; diagnostics for slack cords, exhausted wrap, cable lever,
  cam reversal, brace state and convergence.
- Model description with derivations and verification tolerances
  (`docs/model.md`).
