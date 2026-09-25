# Compound Cam Calculator — Plan

Static web app, hosted on GitHub Pages, that computes the string track and the
power-cable track of a twin-cam compound bow from a target draw force curve.
It exports cam parts and the string plan as DXF (Drawing Exchange Format) and
STEP (ISO 10303, Standard for the Exchange of Product model data) files.

This file is the running record of the project. Each slice updates it.

## Design decisions

| Topic | Decision |
|---|---|
| Cam system | Twin cam: two identical cams; the power cable of each cam is anchored at the opposite axle (yoke at the axle centre) |
| Free degree of freedom | User shapes the string track parametrically; the solver computes the cable track |
| Geometry model | 2D, top/bottom symmetric: rigid limb levers rotate about a pivot (pseudo-rigid-body model), axles move on an arc, string and cable contacts solved at every draw step |
| Draw length convention | AMO (Archery Manufacturers Organization) / ATA (Archery Trade Association): draw length = nock to grip pivot point + 1.75 in; brace height = grip pivot point to string |
| Exported curves | Pitch line (cord centre), groove bottom (pitch − d/2) and flange edge (groove bottom + groove depth), each labelled |
| STEP content | One prismatic solid per cam layer (flange or groove-bottom outline with axle bore), pitch curves as wireframe; no Boolean operations |
| DXF content | Separate files: one cut file per cam plate, one reference file, one string-plan file; always millimetres |
| Stack | Plain JavaScript ES modules with JSDoc types checked by `tsc`, Vite, Vitest, Playwright, ESLint |
| Units | SI internally (m, N, rad, J, N·m/rad). Default display: draw length in in, force in N, part dimensions in mm, energy in J. Each quantity switchable |
| Force curve editor | Free points: double-click or "Add point" + tap adds, right-click or select + Delete removes, drag moves, arrow keys nudge; numeric point table; peak and let-off sliders rescale |
| String plan | Bow layout drawing: string and both cables at brace and full draw, axle positions, contact points, lengths |
| Pages deployment | On every push to `main`; tags produce releases with a build archive |

## Coordinate conventions

- Origin at the grip pivot point. x points along the draw direction (towards
  the archer), y points up. The nock is at (x, 0).
- Brace height x_b, full draw x_f. Draw length (AMO) = x_f + 1.75 in. Power
  stroke = x_f − x_b.
- Top axle O(α) moves on a circle of radius R_L about the limb pivot Q; α is
  the limb rotation from brace, positive towards the bow centre. The limb
  lever angle β is measured from +x, counter-clockwise positive:
  β = β_b − α, O = Q + R_L·(cos β, sin β), O_α = R_L·(sin β, −cos β). At
  brace the string is vertical at x_b and touches the string track at ψ = 0,
  so O_b = (x_b − p_s(0), ATA/2) and Q = O_b − R_L·(cos β_b, sin β_b). The
  bottom axle is the mirror image, A = (O_x, −O_y). A is also the anchor of
  the top cam's power cable.
- θ is the cam rotation, positive in the string pay-out direction, which is
  a clockwise turn of the top cam in the world frame. Cam frame:
  v_cam = R(θ)·v_world with R the counter-clockwise rotation matrix.
- Each track is a convex curve given by its support function p(ψ) about the
  axle, on the cord centreline (pitch line):
  n = (cos ψ, sin ψ), t = (−sin ψ, cos ψ),
  contact point X = p·n + p'·t, |X| = √(p² + p'²),
  radius of curvature ρ = p + p''.
- Groove bottom: p − d/2, ρ − d/2 (exact where ρ > d/2). Flange edge:
  p − d/2 + groove depth.

## Model

### Cord length

For a cord that wraps a track and leaves it tangentially towards a point B
(B in the cam frame):

```
L = σ·[B·t(ψ_c) + P(ψ_c)] + C,   P' = p
tangency: B·n(ψ_c) = p(ψ_c),  σ·(B·t − p') > 0
cable:  σ = +1, C = −p'(ψ_e) − P(ψ_e)
string: σ = −1, C = P(ψ_e) + p'(ψ_e)
```

ψ_e is the termination angle. The p' terms cancel (envelope property). ψ is
kept unwrapped. The contact is found by safeguarded Newton on
f(ψ) = B·n − p, f' = B·t − p'. The identity is used to evaluate lengths and to
check the forward model, never to march an unknown contact angle (the error
gain is 2/(l·Δψ)).

### Constraints and potential

One cam and one limb are modelled; the other half mirrors them.

```
g_s(x, θ, α) = L_s / 2          string half-length
g_c(θ, α)    = L_c              power cable length
E            = 2·E1(α)          limb energy, E1 per limb
```

Partial derivatives (projections, no finite differences):

```
∂g_s/∂θ = −p_s      ∂g_s/∂x = sin φ      ∂g_s/∂α = −s_a,  s_a = u_s·O_α
∂g_c/∂θ = +p_c      ∂g_c/∂α = −c_a,      c_a = u_c·(O_α − A_α)
```

u_s is the unit vector from the string contact to the nock, u_c from the cable
contact to the anchor, φ the string angle against the normal to the draw
direction.

### Forward model (cam → force curve)

At each x: 2×2 Newton on (θ, α) with J = [[−p_s, −s_a], [p_c, −c_a]] and
warm starts. Then solve J·[θ', α'] = [−sin φ, 0] and

```
F   = 2·E1'(α)·α'                  virtual work
T_s = F / (2 sin φ)                string tension
T_c = T_s·p_s / p_c                cable tension
E1'(α) = T_s·s_a + T_c·c_a         limb balance
```

The implementation evaluates T_s = E1'·p_c/det and T_c = E1'·p_s/det with
det = p_s·c_a + s_a·p_c, which equal the lines above and hold at brace
without a division by sin φ. The limb balance holds by construction of
these formulas, so it is no check; the tests compare the tensions with a
free-body balance built from positions.

Validity: T_s > 0, T_c > 0, c_a > 0 along the path. The forward model
reports `{code, xRange, message}` diagnostics; codes and the verification
results are in `docs/model.md`.

### Limb

- Rigid lever of length R_L (pivot to axle) with torsional stiffness
  k_t = k·R_L², k measured at the axle perpendicular to the lever (stored in
  N/m, shown in N/mm).
- Preload: axle travel s_0 from unstrung to brace, α_0 = s_0/R_L > 0 is the
  rotation from unstrung to brace, or limb moment at brace M_b = k_t·α_0.
  E1(α) = ½·k_t·(α + α_0)².
- Energy: W = 2·(E1(α_f) − E1(0)), so α_f = −α_0 + √(α_0² + W/k_t),
  W = draw energy.
- Input modes: (a) stiffness k plus preload; (b) target axle travel s_f from
  brace to full draw plus preload, k = W/((s_f + s_0)² − s_0²); (c) measured
  force-deflection table, converted to limb moment against rotation from
  unstrung and fitted by the C2 monotone quintic of `src/core/interp.js`.
- Outputs: draw energy W and total limb energy including preload, reported
  separately; axle travel in mm.

### Inverse model (target force curve → cable track)

Explicit per sample, no marching (`src/core/inverse.js`):

1. W(x) = exact integral of the target curve.
2. α(x) = E1⁻¹(E_b + W/2).
3. θ(x) from the string closure (1D Newton, derivative −p_s).
4. T_s = F / (2 sin φ); at brace T_s0 = F'(x_b)·l_0 / 2 (l_0 = free string
   span at brace).
5. p_c = p_s·c_a·T_s / (E1'(α) − T_s·s_a). Implemented in closed form: the
   anchor lies straight below the axle at D = 2·O_y, so
   c_a = 2·R_L·cos β·√(1 − (p_c/D)²) and, with
   K = 2·R_L·cos β·p_s·T_s / (E1' − T_s·s_a), p_c = K·D/√(D² + K²) and
   ψ_c = π + asin(p_c/D) + θ. This is the limit of the fixed-point
   iteration on the cable direction.
6. Draw grid x − x_b = s² plus the curve points; cable samples near a
   uniform ψ grid (0.25° full, 0.5° coarse) by regula falsi in x, each an
   exact point of the ideal track; open C2 spline with fourth-order end
   slopes.
7. Check: p_c = c_a·dα/dθ (tests).

### Brace conditions

- F(x_b) = 0 holds automatically; F'(x_b) = 2·T_s0 / l_0.
- p_c0 = p_s0·c_a0·T_s0 / (M_b − T_s0·s_a0). Feasible only for
  0 < T_s0 < M_b / s_a0.
- F''(x_b) is fixed by geometry, preload and p_c0 and does not depend on p_c'.
  Implemented by the analytic brace expansion
  F''(x_b) = −(2·T_s0/l_0²)·(3·K_1 + ρ_s0/l_0),
  K_1 = (p_s'(0)·c_a0 + R_L·sin β_b·p_c0)/det_0 (derivation in
  `docs/model.md`), which agrees with the forward model of a circle of
  radius p_c0 to 1e-9. The target is rebuilt with
  `createCurve(points, { startSlope, startSecondDerivative })`.
- Refinement: F'''' at brace is fixed by the geometry too; a mismatch gives
  the cable track a (ψ − ψ_c0)^(3/2) term with negative ρ near brace. The
  solver replaces the cable track over the first curve segment by a brace
  blend: the quintic in ψ with p(ψ_c0) = p_c0, a C2 join to the ideal track
  at point 2, ∫ p dψ from the cable closure
  (√(D_0² − p_c0²) − √(D_1² − p_1²)) and the smallest ∫ p'''² dψ. The cam
  then reaches the target state at point 2 exactly; the achieved curve
  differs from the target only inside the first segment.
- The app shows the brace slope, the implied p_c0 and its feasible range.

### Target curve representation

- Control points from the editor; brace point fixed at (x_b, 0 N), last point
  fixed at x_f.
- Interpolant: C2 piecewise quintic Hermite; slopes by Fritsch–Carlson,
  second derivatives limited so monotone data stay monotone. C2 matters
  because ρ_c depends on F''. Construction (`src/core/interp.js`): slopes
  d_i by the Fritsch–Butland weighted harmonic mean with the three-point end
  formula (as SciPy `PchipInterpolator`); s_i = mean of the end second
  derivatives of the two adjacent cubic Hermite pieces. Per interval the
  minimum of the quartic q' on [0, 1] is found exactly (roots of q'' isolated
  on monotone pieces of q''). Where q' changes sign against the data, a
  bisection finds the largest common factor for s at both knots; if s = 0 is
  not enough, the largest factor for d. Neighbours are re-checked. The
  monotone parameter set is convex and contains d = s = 0 (quintic
  smoothstep), so the search is exact and terminates; after 20·n fixes both
  knots of a violating interval are set to d = s = 0. Result: each interval
  is monotone between its end values, local extrema sit at knots, flat data
  stay flat.
- Prescribed F'(x_b) or F''(x_b) (options of the interpolant, from the brace
  conditions) can exclude d = s = 0 at knot 0. When the first interval then
  stays non-monotone, a deep-cut ellipsoid method maximises the smallest
  scaled slope of intervals 0 and 1 over the free values at knots 0 and 1,
  with d = s = 0 at the later knots (a concave problem in at most 3
  variables, at most 1000 steps). A setting with slope ≥ 0 becomes the
  target: the shrinking above runs again towards it instead of towards 0,
  and terminates for the same reason. `shapePreserved = false` means that
  no such setting exists; a monotone curve that needs non-zero values at
  knot 2 or later is not searched for. Non-finite prescribed values are
  rejected.
- Definitions: F_hold = min F on [x_peak, x_f]; let-off =
  (F_peak − F_hold) / F_peak; valley width = length of the interval around the
  minimum where F ≤ F_hold + 0.05·F_peak.
- Peak slider scales all interior points. Let-off slider applies an affine map
  to the points after the peak; the holding weight stays at least
  10⁻⁶·F_peak below the peak, so the map stays invertible and let-off 0 %
  can be undone by a later let-off. One slider gesture applies each value to
  the points at its start (no compounding). Points stay ≥ 1 N. In custom
  mode the peak and let-off parameters follow the measured values, clamped
  to their field ranges; a field note names a custom curve outside them.
- Custom points keep a gap of ≥ 0.1 in, also after a geometry change: points
  closer than that after the linear rescaling move apart (a power stroke
  over 5 in has room for 49 gaps of 0.1 in). Validation rejects smaller
  gaps (tolerance 10⁻⁹ m). A move never goes towards a neighbour that is
  already closer.
- Parametric generator: brace, ramp point (40 % of the rise, 38 % of the
  peak), peak start (rise fraction of the power stroke, default 46 %), peak
  end (30 % of the way to the valley), let-off transition point (halfway,
  67 % of the drop), valley start and full draw (default valley width
  1.2 in); the flat part at full draw is adjusted until
  the measured valley width matches the requested one as closely as the
  let-off, rise and power stroke allow (the let-off transition sets a
  smallest width, about 1.20 in at 75 % let-off on the default bow; at a
  let-off ≤ 5 % the valley spans peak to full draw). The valley field names
  the reached width when it differs by more than 1 %.
- Walls are vertical in the rigid model; the wall position is x_f. A cable
  stop post is placed on the cable span at θ(x_f).

### Feasibility and diagnostics

The solver never throws on user input and never clamps silently. It returns
`status: ok | infeasible | no-convergence` and a list of diagnostics
`{code, xRange, psiRange, message, suggestion}`. Checks:

- T_c > 0 along the path, equivalently E1'(α) > s_a·T_s and dθ/dx > 0.
- F > 0 on (x_b, x_f].
- Brace: 0 < T_s0 < M_b / s_a0.
- ρ ≥ max(ρ_min, d/2 + margin) on both tracks (groove bottom stays convex).
- Clearance: |X| ≥ r_bore + wall + d/2; groove bottom stays outside the bore
  wall.
- Wrap: string Δθ + Δφ + terminations < 360°; cable Δθ + Δβ + terminations
  < 360° (`wrap-overlap` in the forward model).
- α_f within the allowed limb rotation.
- Newton convergence within fixed iteration limits.

When the ideal cable track is not manufacturable, the solver fits a C2
B-spline p_c(ψ) (20–40 coefficients) by constrained least squares with linear
constraints ρ ≥ ρ_min and p ≥ p_min, runs the forward model on it and shows
the achieved curve against the target with differences in peak, let-off and
energy. Clearance is checked and reported.

Implementation (`src/core/fit.js`, `src/core/qp.js`, `src/core/solve.js`):

- Clamped cubic spline on uniform knots (values and end slopes as unknowns),
  dual active-set QP of Goldfarb and Idnani. The QP treats a constraint as
  dependent when n constraints are active or when its step is at rounding
  level, skips dependent equalities that hold, refines x onto the active
  constraints after each added constraint, reports `infeasible` when
  rounding leaves an active constraint outside the tolerance, and returns
  `invalid` for mismatched sizes or non-finite data; the fit returns
  `invalid` for out-of-range input instead of throwing.
- Equalities at every curve point whose ideal lever arm meets p_min:
  p(ψ_k) = p_k and ∫ p dψ from ψ_c0 to ψ_k from the cable closure, plus
  p(ψ_c0) = p_c0. The fitted cam then passes through the target force and
  energy at those points.
- Refinement of the diagnostics: the ideal track follows every wiggle of the
  interpolant between the points and often bends the wrong way over a few
  degrees. A fitted cam whose achieved force stays within 1.5 % of the peak
  (at least 2 N) of the target everywhere, with the draw energy within
  0.5 %, meets the target; the violations of the ideal track are then kept
  in `fit.idealIssues` and are no diagnostics. Larger differences are
  reported as `cable-radius` or `cable-clearance`.
- Codes: `invalid-input`, `brace-tension`, `cable-lever`, `slack-cable`,
  `nonpositive-force`, `cable-fold`, `limb-rotation`, `limb-energy`,
  `target-shape`, `string-radius`, `string-clearance`, `string-wrap`,
  `cable-radius`, `cable-clearance`, `cable-wrap`, `closing-blend`,
  `no-convergence`, `slack-string`, `wrap-exhausted`; the table with the
  suggestions is in `docs/model.md`.

### Closed cam outline

- The active part of each track covers the draw. Extensions: lead-in wrap at
  brace for the cable, residual wrap at full draw for the string (inputs,
  default 30°), each at constant ρ, ending at a post.
- The remaining arc is closed by a quintic blend in ψ that matches p, p', p''
  at both joins with ρ ≥ ρ_min. Any periodic p with p + p'' > 0 gives a closed
  convex curve.
- Posts (string post, cable post), cable stop post and timing marks (string
  exit at brace, cable exit at brace, full-draw index) are placed in the cam
  frame.
- Implementation (`src/core/outline.js`): when the quintic blend bends below
  ρ_min or comes below p_min, a constrained spline fit with p, p', p''
  prescribed at both joins replaces it. The closed track is a periodic C2
  cubic spline through samples of the pieces (at most 0.25° apart). The
  cable stop peg touches the full-draw cable line on the axle side where it
  clears the cable groove bottom by its radius. The cam maximum dimension
  is the largest width of the union of both flange outlines.

### Numerics

- Forward model: 1000–2000 draw samples for final results, about 100 while
  dragging; closure residual < 1e-10 m; contact residual < 1e-12 m.
- Inverse: samples uniform in ψ; E1⁻¹ residual < 1e-9 J. Draw grid of 100
  (coarse) or 600 (full) samples plus the curve points; cable samples every
  0.5° or 0.25°; string closure residual < 1e-10 m.
- Solve budgets for the default preset: 30 ms coarse, 200 ms full. The
  performance test reports the median and fails only above 5 times the
  budget, which allows for shared continuous integration (CI) machines.
  Measured medians with Node 24: about 17 ms coarse and 25 ms full; the first call, before
  the JavaScript engine has optimised the code, takes about 100 ms.
- Exported curves deviate from the model curve by at most the export
  tolerance (default 0.01 mm) along the normal.

## Inputs

Independent set; everything else is derived and shown read-only.

- Geometry: axle-to-axle length (ATA), brace height, draw length (AMO), limb
  lever length R_L, limb lever angle at brace. Derived: limb pivot position,
  axle positions, string and cable lengths.
- Force: target curve (editor), peak draw weight, let-off, parametric
  generator (rise length, valley width).
- Limbs: stiffness mode (see Limb), preload, maximum limb rotation.
- String track: shape (eccentric circle: radius, offset, phase; ellipse:
  semi-axes, offset, phase), defined on the groove bottom as the user measures
  it.
- Cords: string diameter, cable diameter, groove depth per track.
- Cam body: axle bore diameter, minimum wall, layer table (flange, string
  groove, flange, cable groove, flange: thickness of each), post diameter,
  lead-in and residual wrap, minimum bend radius.
- Units per quantity; decimal comma and point accepted.

## Outputs

- Results card: achieved peak, let-off, holding weight, draw energy and limb
  energy (J, ft·lbf), axle travel, cam rotation, string and cable lengths,
  cam maximum dimension, minimum track radius against limit; status colour
  plus text.
- Force chart: target and achieved curves (solid and dashed, labelled),
  brace and full-draw lines, infeasible ranges highlighted.
- Cam view: both tracks, groove bottoms, flange outline, posts, bore, contact
  points and lever arms at the current draw position, zoom and scale bar.
- String plan: bow layout at brace and full draw with lengths.
- Load chart: string tension, cable tension, axle load against draw.
- One draw-position scrubber drives the force-chart marker, the cam rotation
  and the layout pose.
- Exports: cam plate DXF files, reference DXF, string-plan DXF, STEP, CSV of
  draw, force, θ, T_s, T_c; JSON project; shareable URL.

## User interface rules

- Validation on Enter, blur or stepper; sliders update live. Every field has
  min, max, step and unit; inline messages next to the field.
- Solve runs in a Web Worker, latest request wins. Coarse solve while
  dragging (budget 8 ms on a laptop), full solve on release (budget 100 ms).
  `data-solve-state` attribute exposes idle / busy / ok / error.
- On an infeasible result the last valid cam stays visible, dimmed; the
  diagnostic names the draw range, the constraint and the input to change.
- Undo/redo for all edits (Ctrl+Z, Ctrl+Shift+Z), one entry per drag, capped
  at 100; undo and redo are refused while a drag or slider gesture is open.
- Autosave to localStorage (guarded by try/catch), debounced 300 ms and
  flushed on `pagehide` and when the page is hidden; schemaVersion in saved
  data. Unreadable saved data is copied to a backup key before the next
  change replaces it.
- Glossary tooltips for let-off, holding weight, valley, wall, brace height,
  ATA, AMO draw length, power stroke, lever arm, radius of curvature.
- Footnote under results: static model; string stretch, cam timing and
  dynamics not modelled.
- Touch: Pointer Events, `touch-action: none` on the editor, hit targets
  ≥ 44 px. Keyboard: points focusable, arrows move 0.1 in / 1 N, Shift ×10.
- Responsive layout: side-by-side panels on screens from 960 px, stacked
  panels on narrower screens; no horizontal scroll at 320 px.

## Export geometry

- All exports in millimetres; origin at the axle centre, +Z along the axle,
  string layer at +Z; view side documented; optional mirrored bottom cam.
- One canonical clamped cubic non-rational B-spline per curve, used by both
  writers; first control point = last control point for closed curves.
- DXF: R2000 or later structure with handles and tables (library
  `@tarikjabiri/dxf`, MIT), `$INSUNITS = 4`, `$MEASUREMENT = 1`; SPLINE flag
  70 = 8 only; cut contours as closed LWPOLYLINE with vertices shifted
  outward by half the sagitta; explicit colour per layer; layers PITCH,
  GROOVE, FLANGE, OUTLINE, BORE, POSTS, STOP, MARKS.
- STEP AP214 (automotive design schema), hand-written:
  - one MANIFOLD_SOLID_BREP per layer: SURFACE_OF_LINEAR_EXTRUSION side face
    with a seam edge, planar top and bottom faces with the bore as inner loop,
    CYLINDRICAL_SURFACE bore;
  - pitch curves as B_SPLINE_CURVE_WITH_KNOTS in a
    GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION linked to the solid
    representation;
  - shared vertices, one EDGE_CURVE per edge used twice with opposite
    orientation, Euler–Poincaré check;
  - REAL tokens always contain a decimal point, upper-case exponent;
    deterministic entity ids; timestamp injected.

## Verification

Committed as tests with stated tolerances:

- Concentric circles: closed-form θ(α), T_c/T_s = r_string/r_cable exactly,
  semi-analytic F(x) from x(α).
- Reverse round trip: eccentric-circle cable track → forward model → inverse
  recovers p_c(ψ) to < 1e-8 m.
- Statics F = 2·T_s·sin φ, with T_s from a free-body balance built from
  positions, equals virtual work dE/dx along a closure path solved
  independently in the test, to 1e-9 relative.
- Brace slope F'(x_b) = 2·T_s0/l_0; F''(x_b) independent of p_c'.
- p_c = 0 gives F = 0.
- Length identity against explicit span plus arc length to 1e-12 m.
- Energy balance with an independent quadrature, ≥ 1000 steps, 1e-6 relative.
- Grid refinement shows the expected convergence order.
- One test per diagnostic code.
- Property tests: interpolant monotone on monotone data; envelope point on its
  tangent line; ρ matches finite differences.
- Default preset solves with zero diagnostics.
- STEP: custom Part 21 checker (references, REAL format, knot sums, edge use,
  loop connectivity, Euler–Poincaré); `occt-import-js` (dev dependency) for
  solid count, face count, volume against ½∫(p² − p'²)dψ within 0.1 %, bounding
  box and unit handling.
- DXF: `dxf-parser` round trip; `ezdxf audit` in CI; header units; end-to-end
  test that parses the exported DXF, rebuilds the tracks, runs the forward
  model and matches the target.
- Playwright: load, drag, keyboard edit, touch add/delete in a mobile
  viewport, unit switch, undo/redo, infeasible input message, export
  downloads; axe accessibility check.

## Repository layout

```
src/core/     units, interpolation, support functions, geometry, limb,
              forward and inverse solvers, B-spline fitting (no DOM)
src/state/    ProjectState schema, defaults, presets, validation, JSON/URL codec
src/export/   DXF and STEP writers: (result, options) => string
src/worker/   solver worker wrapper
src/ui/       editor, views, forms, downloads
scripts/      coverage-readme.js and other tooling
tests/unit/   Vitest
tests/e2e/    Playwright
docs/         model description and user guide, pushed to the wiki
```

ESLint forbids DOM globals and `ui` imports in `src/core`, `src/state` and
`src/export`.

## Workflows

Node.js 24; `actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache@v6`,
`actions/upload-artifact@v7`, `actions/download-artifact@v8`,
`actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`,
`actions/deploy-pages@v5`.

- CI (`pull_request`, push to `main`): jobs lint (ESLint + `tsc`), unit
  (Vitest with coverage, `coverage-readme --check`), build, e2e (Playwright on
  the built site), export validation (Python `ezdxf`), deploy to Pages (push
  to `main` only, needs all other jobs).
- Docs CI (push to `main` touching `docs/**`, manual dispatch): syncs `docs/`
  to the wiki repository.
- Release CI (tags `v*`): runs tests, checks tag against `package.json`
  version, creates a GitHub release with the build archive.
- Vite `base: './'`.
- Coverage figure in README: line coverage of `src/core`, `src/state`,
  `src/export`, floor to integer percent, between
  `<!-- coverage:start -->` and `<!-- coverage:end -->`.

## Manual setup (once)

1. Settings → Pages → Source: GitHub Actions.
2. Settings → General → Features → Wikis on; create a Home page once.
3. Optional: protect `main` with the CI job names as required checks.

## Delivery slices

Each slice is done when: code review, user-friendliness review and math review
are addressed; CI is green; the Codex review is addressed; `docs/` and
`CHANGELOG.md` are updated; the PR is merged.

| Slice | Content |
|---|---|
| 1a | Scaffold, lint, typecheck, unit tests, coverage check, e2e on a stub page, three workflows, README, manual setup notes |
| 1b | Units, interpolation, ProjectState schema with schemaVersion, default preset, autosave |
| 1c | Force curve editor (pointer, touch, keyboard, table, sliders, undo/redo), unit toggles |
| 2 | Support functions, contact solver, limb model, forward model, `docs/model.md` |
| 3 | Inverse solver, brace conditions, diagnostics, constrained fit, closed outline, achieved-curve overlay (needs the cable track from the inverse solver), cam view, results card, worker |
| 3a | Model code of slice 3 in `src/core` (inverse, fit, QP solver, outline, diagnostics, `solve`) and the tuned default preset; no user interface |
| 4 | String plan layout, build lengths, loads chart, draw-position scrubber |
| 5 | B-spline fitting, DXF export (plates, reference, string plan), CSV export |
| 6 | STEP export |
| 7 | Additional presets, JSON save/load, share URL, glossary and help, print report, wiki user guide |

Default preset: ATA (axle-to-axle length) 33 in, brace height 6.5 in, draw
length 29 in, peak 267 N (60 lbf), let-off 75 %, string and cable diameter
2.5 mm, limb 11 in long at 25° at brace. The solver builds it with zero
diagnostics:

- Limb: stiffness mode, 2.6 N/mm, preload travel 192 mm, axle travel
  78 mm, rotation limit 30°; achieved axle travel 77.5 mm.
- String track: eccentric circle, radius 45 mm, offset 22 mm towards −122°.
- Curve: the generator defaults above (rise 46 %, valley 1.2 in).
- Result (full resolution): achieved peak 270.1 N, let-off 74.9 %, draw
  energy 93.0 J, limb energy 188.8 J, cam rotation 224°, largest cam
  dimension 98 mm, smallest cable radius of curvature 5.0 mm (the limit);
  the fitted cam follows the target within 3.7 N (tolerance 4.0 N) and
  0.01 J.

Let-off 80 % is not the default because no tested combination of limb and
string track builds a cam within the fit tolerance and with a draw energy of
90 J or more. Two limits act together (symbols as in docs/model.md). The
limb balance E1'(α) = T_s·s_a + T_c·c_a with T_c > 0 bounds the string
tension by T_s < E1'/s_a, so an early rise of the force needs a large limb
moment early in the draw. At full draw the cable lever arm
p_c = p_s·c_a·T_s / (E1' − T_s·s_a) must stay at or above 8.25 mm (bore
radius, wall and cable radius); with the low string tension of the holding force this bounds the
limb moment at full draw from above, E1'_f ≤ T_s·(s_a + p_s·c_a / 8.25 mm).
A stiff limb, whose moment grows along the draw, then has little moment
early. A soft, heavily preloaded limb keeps the moment nearly constant and
gives the most early string tension, yet the peak still comes late and the
draw energy stays near 90 J. A search over limb stiffness, preload, string
groove radius, offset and phase and the generator fractions gives, for the
best combination at each let-off: 80 % at most 90 J with a 4.2 N force
difference (above the 4.0 N tolerance), 78 % 91 J with 4.3 N, 76 % to 77 %
within 98 % to 99 % of the tolerance, 75 % 93 J with 3.7 N (93 % of the
tolerance), 70 % 1.9 N. Let-off 75 % is the closest value with a margin. A
lower let-off, a stiffer limb with more axle travel or a larger cam relaxes
the limits.

## Limitations

- Static model: arrow speed, dynamic efficiency and hysteresis are not
  computed.
- String and cable are inextensible; walls are therefore vertical.
- Nock at the midpoint between the axles; top and bottom limbs identical; no
  nock travel or cam timing error.
- Cable guard offset is ignored: 3D cable build lengths exceed the reported
  2D lengths by about 1.5–3 mm for a 25–40 mm guard offset.
- Yoke legs, cam lean, axle friction and limb twist are not modelled.
- Limb stop is not modelled; only a cable stop.
- Hybrid, binary and single-cam systems are not modelled.
- The model is not validated against measured bows; no reference data is in
  the repository.

## Later

Cable guard 3D lengths and fleet angle, yoke legs, draw-length modules, limb
bolt range sweep, mass and inertia, import of an existing cam for analysis,
reference bows from measured data, tuning sensitivities.
