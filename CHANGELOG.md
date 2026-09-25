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
  generator with seven points whose let-off transition point moves on the
  straight line towards the valley start for a narrow valley (smallest
  width about 0.49 in at 75 % let-off on the default bow, 1.54 in at 20 %);
  move, add and remove point operations with a
  0.1 in (2.54 mm) minimum gap and a 1 N to 5000 N force range; peak scaling
  and a let-off mapping that stays invertible down to 0 %.
- Project state (`src/state/`): schema version 1 in SI units with
  validation messages in plain words, migration of saved data, JSON codec
  that never throws, default preset (ATA 33 in, brace height 6.5 in, draw
  length 29 in, peak 267 N, let-off 75 %, string diameter 2.5 mm) and a
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
  1500 samples; diagnostics for slack cords, exhausted wrap, a cord wrapped
  a full turn or more, cable lever, cam reversal, brace state and
  convergence.
- Input domain of the core model (`src/core/domain.js`): lengths up to
  10 m, limb rotations up to one turn, torsional stiffness 1e-6 to
  1e9 N·m/rad, table moments up to 1e7 N·m; values outside it are invalid
  input, so no intermediate quantity reaches the floating-point limits.
- Model description with derivations and verification tolerances
  (`docs/model.md`).
- Inverse model (`src/core/inverse.js`): power-cable track from the target
  force curve, the string track and the limb, sample by sample from the
  energy balance, the string closure and the cam and limb balance, with the
  cable lever arm in closed form; brace conditions with the analytic
  F''(x_b); brace blend of the cable track over the first curve segment
  that keeps the target state at point 2; cable samples near a uniform
  0.25° grid. Round trip forward → inverse recovers an eccentric cable
  track to 1e-12 m and the concentric case to 6e-13 m.
- Constrained fit of the cable track (`src/core/fit.js`): C2 spline by
  least squares with the limits on radius of curvature and lever arm and
  with the target force and energy at the curve points, solved by a dense
  dual active-set quadratic programming solver (`src/core/qp.js`). The
  solver treats a constraint as dependent when n constraints are active or
  its step is at rounding level, skips dependent equalities that hold,
  refines x onto the active constraints after each step, reports
  `infeasible` when rounding leaves an active constraint outside the
  tolerance, and returns `invalid` for mismatched sizes or non-finite
  data; the fit programmes of 600 random near-default states end with the
  constraints met to 1e-10 of the row scale. The fit returns `invalid` for
  non-finite or out-of-range input instead of throwing. A fitted cam whose
  force stays within 3 % of the peak (at least 2 N) and whose draw energy
  stays within 0.5 % of the target meets it; 41 of 45 edits of the default
  preset (peak 250 N to 290 N, rise 43 % to 50 %, valley 1.0 in to 1.5 in)
  do.
- Closed cam outline (`src/core/outline.js`): lead-in, closing blend,
  periodic cable track, groove bottom and flange offsets, string, cable and
  cable stop posts, timing marks, sampled outlines and the cam maximum
  dimension. The lead-in keeps p, p' and p'' continuous at brace and
  settles within about 10° to ρ_0 = clamp(ρ(ψ_c0), ρ_lim, p(ψ_c0)), so a
  fitted track with ρ of 260 mm to 830 mm at brace gives a cam of 114 mm
  to 144 mm that closes. A lead-in wrap of 0 is valid: knots less than
  1e-3 of the spacing apart are left out. The `closing-blend` suggestion
  names the largest lead-in wrap k·5° down to 0° that closes the track,
  otherwise the string track radius and, when it sets the limit, the
  minimum bend radius.
- Solver entry point (`src/core/solve.js`): project state to cable track,
  outlines, achieved force curve, tensions and metrics in about 17 ms
  (coarse) and 25 ms (full) for the default preset, with 19 diagnostic
  codes whose messages carry numbers and units and whose suggestions name
  the input to change; never throws. `brace-tension` and `slack-cable` name
  the limb preload travel while it stays within its range of 0 mm to
  400 mm, otherwise the stiffness.
- Default preset tuned so the solver builds its cam without diagnostics:
  let-off 75 %, limb 2.6 N/mm with 192 mm preload travel, eccentric string
  groove of radius 45 mm with 22 mm offset towards −122°, parametric
  generator with a gentle start (ramp point at 38 % of the peak) and a
  later peak (rise 46 % of the power stroke); draw energy 93.0 J, largest
  force difference 3.7 N against the 8.0 N tolerance. Edits of peak
  (250 N to 285 N), rise (44 % to 50 %) and valley (0.9 in, 1.5 in) also
  build without diagnostics. Let-off 80 % builds with a softer limb and a
  larger cam; `docs/PLAN.md` gives the full-draw bound and the numbers.
