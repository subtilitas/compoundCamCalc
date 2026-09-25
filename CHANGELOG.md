# Changelog

All notable changes are listed here. Versions follow semantic versioning.

## Unreleased

### Added

- Help dialog from a Help button in the page header (`src/ui/help.js`):
  quick start in 5 steps, the keyboard shortcuts, every glossary term and a
  link to the user guide in the wiki. No keyboard shortcut opens it.
- Glossary terms for limb energy, axle travel, cam rotation, lever arm,
  radius of curvature, minimum bend radius and minimum wall, with info
  buttons on the minimum wall and minimum bend radius settings, on the
  results values (achieved peak, limb energy, axle travel, cam rotation and
  the smallest radii of curvature) and on the lever arm in the cam view
  legend. The Terms section of the user guide repeats every glossary text
  word for word; a unit test checks it.
- File menu in the page header: Save, Save as…, Open… (with Rename and
  Delete), Open sample…, Reset to default, Save to file (.json) and Open
  from file…; named designs in the browser (`src/state/library.js`), an
  unsaved-changes marker, and `store.replace` that switches designs and
  clears the undo history.
- Sample designs (`src/state/samples.js`): target and hunting compound
  bows, a crossbow and a mini bow for FDM printing, each solving without
  diagnostics.
- STEP export (`src/export/step.js`, AP214, millimetres): a stacked file of
  all five plates with the pitch lines as wireframe and one file per
  plate; outlines on the exact tracks within 0.005 mm, the middle flange
  and plates with a boss from a hull fit with exact straight tangents
  (`fitHull`); a Part 21 checker and an import test in OpenCascade
  (occt-import-js), also run on the CI samples by
  `scripts/validate-step.js`.
- Plate thickness settings: flange thickness (default 2 mm) and groove
  clearance (default 0.5 mm).
- Wider input ranges for crossbows and small bows: axle-to-axle length 8
  to 48 in, brace height from 1.5 in, draw length from 6 in, limb lever
  from 2 in, peak force from 5 N, limb stiffness from 0.1 N/mm, power
  stroke from 2 in.
- Range sliders reach both bounds for any range: the step keeps 12
  significant digits, rounded down.

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
  width about 0.49 in at 75 % let-off on the default bow, 1.54 in at 20 %)
  and a flat valley length matched to the requested width by four steps,
  then a bracketed root over the flat range where the steps stop short
  (5.834 in instead of 5.73 in at 6 % let-off and 50.5 % rise before);
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
- Solver in the page (slice 3b):
  - The solve runs in a module Web Worker (`src/worker/solver.worker.js`,
    client `src/ui/solver.js`). The newest request wins; a finished result
    is shown even while a newer request waits, so a continuous drag shows
    coarse results (100 samples) and the release a full one (1500 samples).
    A worker that fails before its first answer is replaced by a solve on
    the main thread, which repeats the failed request.
  - Results card (`src/ui/results.js`): status, achieved peak, holding
    weight, let-off, draw and limb energy, axle travel, cam rotation,
    string and cable length, cam maximum dimension, radius of curvature of
    each track with its limit, the fit against its tolerance, and the
    problems with their suggestions.
  - Achieved force curve (dashed) over the target, with the draw ranges of
    problems shaded and a legend.
  - Cam view (`src/ui/camview.js`): flange outlines, groove bottoms, pitch
    lines, bore, posts and timing marks with a legend and a scale bar;
    zoom by buttons, Ctrl and wheel, or keys; pan by drag or arrow keys.
  - An input that fails a check keeps the last cam that met every check in
    the cam view, dimmed and labelled; the values and the dashed curve are
    labelled as the latest attempt. Only a full solve (1500 samples) can
    become that cam; a coarse result without problems shows as a preview.
    After a solver error the values are empty. A solve running for 250 ms or
    longer shows the values in grey italics with a caption, and a unit
    change relabels them at once.
  - Settings for limb lever length and angle, limbs (stiffness, axle
    travel or a measured table of 3 to 50 rows), string track (eccentric
    circle or ellipse), cords and cam body; dimension and stiffness units;
    a solve status link at the top of the settings; angles shown in
    degrees with the ° symbol; range hints with the unit of the step.
- Draw position, string plan and loads (slice 4):
  - Bow layout and loads (`src/core/layout.js`): the pose of limbs, axles,
    cams, string and cables at any draw position, linear between the
    forward-model samples; string tension, cable tension and the load on
    each limb tip (string, own cable and the anchored cable of the other
    cam) with their largest values; build lengths. Never throws.
  - Draw-position control (`src/ui/scrubber.js`): a slider in draw steps
    (0.1 in, 2.5 mm or 0.25 cm) from brace to full draw, − and + buttons,
    jumps to brace, peak draw force and full draw, and a readout. It stays
    in view above the cam, the string plan and the loads. The position is
    not saved, not part of undo, and starts no solve; brace and full draw
    stay put when a new result arrives, other positions keep their draw
    length.
  - The cam view turns the cam to the draw position and shows the contact
    points, the lever arms and the cord directions, with a line giving the
    rotation, both lever arms and their ratio. The fitted view covers every
    orientation of the cam.
  - String plan (`src/ui/stringplan.js`): side view of the whole bow at
    brace (dashed), full draw (dotted) and the draw position (solid), with
    the limb tip load as an arrow, zoom and pan, a Top cam button, and the
    string and cable lengths in both dimension units, the axle-to-axle
    length at brace and full draw, brace height and draw length.
  - Loads chart (`src/ui/loadchart.js`): string tension, cable tension and
    limb tip load against the draw, the values at the draw position, the
    largest values with their draw position, and a table at 10 % steps.
  - The force chart marks the draw position with a vertical line and a dot
    on the achieved curve.
  - Zoom and pan shared by the cam view and the string plan
    (`src/ui/viewport.js`).
- Export (slice 5):
  - B-spline fit of the tracks (`src/core/bspline.js`): Hermite pieces on the
    knots of a spline track with exact tangents, a convex C2 interpolant for
    an ellipse, circles for an eccentric circle; within 0.01 mm along the
    track normal.
  - Export model (`src/export/model.js`): five plate cut outlines within
    ±0.01 mm (the middle flange is the convex hull of both flanges), bore
    and post holes in the flange plates next to their cord, a boss around
    the cable stop peg where a flange does not keep the minimum wall
    around it, timing marks and
    warnings that name the plates still holding a post.
  - DXF R2000 writer (`src/export/dxf.js`), CSV writer (`src/export/csv.js`)
    and ZIP writer (`src/export/zip.js`), all deterministic and never
    throwing; spline control points with 10 decimals (mm).
  - Files (`src/export/files.js`): plate cut files, reference drawing,
    string plan, force table and a ZIP with a README; names carry the date
    and a design id.
  - Export panel in the page: a ZIP of all files and one button per file,
    always from the last cam that met every check.
  - CI job `export`: writes sample files of two designs and checks them with
    ezdxf 1.4.4; each ZIP entry must pass its CRC-32 and equal its single
    file.
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
  0.25° grid. Nock positions within 1e-9 m of brace take the brace values;
  each sample carries B·t = √(D² − p_c²) as `anchorReach`. Round trip
  forward → inverse recovers an eccentric cable track to 1e-12 m and the
  concentric case to 6e-13 m.
- Constrained fit of the cable track (`src/core/fit.js`): C2 spline by
  least squares with the limits on radius of curvature and lever arm and
  with the target force and energy at the curve points (a start value
  prescribed both alone and with the end conditions must agree to
  1e-12 m, otherwise the fit is `infeasible`), solved by a dense
  dual active-set quadratic programming solver (`src/core/qp.js`). The
  solver treats a constraint as dependent when n constraints are active or
  its step is at rounding level, skips dependent equalities that hold and
  checks them again at the end, refines x onto the active constraints
  after each step while the largest active residual falls or stays above
  rounding (at most 8 passes), reports `infeasible` when rounding leaves
  an active constraint or a skipped equality outside the tolerance, and
  returns `invalid` for mismatched sizes, non-finite data, a missing programme or options container, an option other than undefined that is not a number, or any exception while reading the input (array-like data is solved on Float64Array copies); the fit
  programmes of 600 random near-default states end with the constraints
  met to 1e-10 of the row scale. With two rows 1e-8 to 1e-6 apart, 4 % to
  13 % of feasible random problems come back `infeasible`, and 44 of
  64,054 come back `optimal` with a redundant equality off by up to 1.1e-2
  of its size. The fit returns `invalid` for non-finite, out-of-range or
  malformed input, including points to pass through outside the fitted
  range, with non-finite values or null, instead of throwing. Its grid
  constraints carry a 5 µm margin, and the exact minima of p and ρ on
  every knot interval that fall below the limits become further
  constraints, so the limits hold between the grid points too. A fitted cam whose force
  stays within 3 % of the peak (at least 2 N) and whose draw energy stays
  within 0.5 % of the target meets it; 41 of 45 edits of the default
  preset (peak 250 N to 290 N, rise 43 % to 50 %, valley 1.0 in to 1.5 in)
  do.
- Closed cam outline (`src/core/outline.js`): lead-in, closing blend,
  periodic cable track, groove bottom and flange offsets, string, cable and
  cable stop posts, timing marks, sampled outlines and the cam maximum
  dimension. The lead-in keeps p, p' and p'' continuous at brace and
  settles within about 10° to ρ_0 = clamp(ρ(ψ_c0), ρ_lim, p(ψ_c0)), so a
  fitted track with ρ of 260 mm to 830 mm at brace gives a cam of 113 mm
  to 144 mm that closes. The closed track counts as closed only when the
  exact minima of p and ρ on every interval of its periodic spline meet
  p_min and ρ_lim to 1e-7 m. A lead-in wrap of 0 is valid: knots less than
  1e-3 of the spacing apart are left out. An arc too short for any closing
  curve inside the input domain, such as the 0.06° a lead-in wrap of
  137.55° leaves on the default preset, is a `closing-blend` result with the
  string outlines only. The `closing-blend` suggestion
  names the largest lead-in wrap k·5° down to 0° that closes the track.
  Otherwise it names a string track 5 mm to 20 mm larger, or half the
  minimum bend radius when it sets the limit, only when a coarse trial
  solve with that value reports no diagnostic; on 76 edits of point 2 of
  the default it names a radius in 30, each of which solves without
  diagnostics, and lists the changes tried in the other 46. The trials
  run in a full solve only; a coarse solve names the force curve.
- Solver entry point (`src/core/solve.js`): project state to cable track,
  outlines, achieved force curve, tensions and metrics in 24 ms to 27 ms
  (coarse) and 30 ms to 35 ms (full) for the default preset, within the
  budgets of 30 ms and 200 ms, with 19 diagnostic codes whose messages
  carry numbers and units and whose suggestions name the input to change;
  never throws, also for a missing or non-object options container, which
  means the defaults, and for input whose fields cannot be read (a test
  passes a throwing getter, a thrown value without text, null, undefined
  and a number to every never-throw export); the inverse model refuses an
  iteration limit outside the integers 1 to 200; an ideal cable track whose
  closed spline dips below a limit between its 0.1° samples gets the
  constrained fit instead of a `closing-blend` result; the reported cable
  radius of curvature is the exact minimum of the closed track that the
  limit check accepted; a negative fit margin is invalid input; an iteration limit outside the integers 1 to 200
  gives `invalid-input` before any solving. A `closing-blend` message names
  the smallest radius of curvature or lever arm of the returned closed
  track, which decides whether the track closes.
  The result type names each outline, and a result without a cable track
  has the string outlines only; the metrics give the smallest radius of
  curvature and its limit for the string and the cable track separately;
  the string termination lies the residual wrap past the achieved
  full-draw contact, the reported full-draw cable contact is the achieved
  one, and the string wrap and the limb rotation of the final cam replace
  those of the ideal track once the cam is built, also in the trial solves
  of a suggestion, and a full turn found by the forward model names the
  cord that wraps it on the solved samples; `brace` holds the brace conditions and the
  ends of the brace blend as ψ_c0, ψ_1 (rad) and x_1 (m). Without the fit
  the achieved curve equals the target from point 2 on within 1.3e-7 N
  (full) on a test cam. In the limb travel mode the stiffness passes
  repeat until the draw energy settles to 1e-9 of itself, so the ideal
  track turns the limb by the requested travel to 1e-9 m. A non-finite or
  concave final cam, and any forward diagnostic without its own entry,
  gives `no-convergence`. `brace-tension` and `slack-cable` name
  the limb preload travel while it stays within its range of 0 mm to
  400 mm, otherwise the stiffness. `brace-tension` gives the force of
  point 2 that makes the end slope of the curve 80 % of the limit.
  `cable-fold` also reports a cable contact at point 2 behind its brace
  position and names the let-off only where the force falls after the
  peak. `cable-radius` leaves out the brace blend, gives a negative radius
  as the angle over which the track bends the wrong way, and names the
  draw position and curve points of the largest force difference of the
  fitted cam; a difference before point 2 names point 2, one between
  points 2 and 3 on the rise to the peak a later point 3 (for a
  parametric curve a larger rise to peak), and one after the peak the
  drop. `cable-clearance` gives the largest bore radius plus wall that
  clears the lever arm. The first and last curve point are placed exactly
  at brace and full draw, so points within the 1e-9 m validation
  tolerance give the result of the exact state. The cable-brace mark and
  the lead-in start at the brace contact of the built cam.
- Default preset tuned so the solver builds its cam without diagnostics:
  let-off 75 %, limb 2.6 N/mm with 192 mm preload travel, eccentric string
  groove of radius 45 mm with 22 mm offset towards −122°, parametric
  generator with a gentle start (ramp point at 38 % of the peak) and a
  later peak (rise 46 % of the power stroke); draw energy 93.0 J, largest
  force difference 3.7 N against the 8.0 N tolerance. Edits of peak
  (250 N to 285 N), rise (44 % to 50 %) and valley (0.9 in, 1.5 in) also
  build without diagnostics. Let-off 80 % builds with a softer limb and a
  larger cam; `docs/PLAN.md` gives the full-draw bound and the numbers.
