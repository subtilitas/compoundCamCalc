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
| Free degree of freedom | User shapes the string track, parametrically (eccentric circle, ellipse) or as a free-form track; the solver computes the cable track |
| Geometry model | 2D, top/bottom symmetric: rigid limb levers rotate about a pivot (pseudo-rigid-body model), axles move on an arc, string and cable contacts solved at every draw step |
| Draw length convention | AMO (Archery Manufacturers Organization) / ATA (Archery Trade Association): draw length = nock to grip pivot point + 1.75 in; brace height = grip pivot point to string |
| Exported curves | Pitch line (cord centre), groove bottom (pitch − d/2) and flange edge (groove bottom + groove depth), each labelled |
| STEP content | One prismatic solid per cam plate (flange or groove-bottom outline with axle bore and post holes), thickness from the flange thickness and groove clearance settings; a stacked file of all five plates with the pitch lines as wireframe, and one file per plate; no Boolean operations |
| DXF content | Separate files: one cut file per cam plate, one reference file, one string-plan file; always millimetres |
| Stack | Plain JavaScript ES modules with JSDoc types checked by `tsc`, Vite, Vitest, Playwright, ESLint |
| Units | SI internally (m, N, rad, J, N·m/rad). Default display: draw length in in, force in N, part dimensions in mm, energy in J. Each quantity switchable |
| Force curve editor | Free points: double-click or "Add point" + tap adds, right-click or select + Delete removes, drag moves, arrow keys nudge; numeric point table; peak and let-off sliders rescale |
| String plan | Bow layout drawing: string and both cables at brace and full draw, axle positions, contact points, lengths |
| Pages deployment | On every push to `main` and after every release: main at the site root, each release tag `vMAJOR.MINOR.PATCH` in a folder of its name, `versions.json` listing them; tags produce releases with a build archive |

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

### String track representation

- Shapes: eccentric circle and ellipse (exact analytic support functions;
  exports keep true circles), and free-form. Old files load unchanged,
  schemaVersion stays 1, missing fields take their defaults.
- Free-form: `stringTrack.freeform = { values }`, N groove-bottom support
  values p_i (m) at ψ_i = 2π·i/N, N from 8 to 16, default 12. The groove
  bottom is the periodic C2 cubic spline through (ψ_i, p_i), period 2π; the
  pitch line is that spline offset by d/2 (`stringTrackSupport`). No new
  support kind. The track closes by construction and ρ = p + p'' is linear
  in the values.
- N ≤ 16: one value moves ρ at its knot by −15 mm per mm at N = 12 and by
  −63 mm per mm at N = 24.
- The default free-form values are the default eccentric track sampled at
  N = 12, so the Shape select switches to free-form without changing the
  cam (one undo step). Sampling any analytic track at N = 12 keeps the cam
  size within 0.1 mm and the largest force difference within 0.05 N on the
  sample designs. A strongly elliptical track takes the smallest N from 12
  to 16 whose spline keeps the smallest groove ρ within max(1 mm, 10 %)
  and p within 50 µm of the exact track (`sampleAnalytic`), or 16 with a
  message when none does; the Shape switch, the presets and Optimise use
  the same sampling.
- Validation checks structure only: an array of 8 to 16 finite values from
  2 mm to 150 mm. Convexity and bore clearance stay solver diagnostics
  (`string-radius`, `string-clearance`) with the rule of the other shapes,
  ρ ≥ `rhoLimitFor(body, d)` on the pitch line. As validation errors they
  would make `fromJSON` replace a saved design by the default after a
  later edit of the bend radius or the string diameter.
- `checkStringTrack` takes the exact `minRho(0, 2π)` for every shape; the
  clearance check keeps its 720 samples.
- A larger free-form track is a uniform outward offset of every value: ρ
  grows by exactly the offset and the shape stays. Every suggestion that
  names a larger string track says "Offset the free-form track outward"
  for a free-form track, with the amount where it is computed.
- `src/core/freeform.js` holds the pure functions the editor and the
  optimiser build on: sampling and resampling, the pitch-line minimum of ρ,
  shape modifiers (size, shift, oval, rounded triangle, rounded square,
  egg) with their largest amount by bisection on the spline, the drag bump
  (raised cosine over ±2 points) with its limit by bisection to 1 µm, and
  the contact points X(ψ_i) = p·n + p'·t of the knots.
- Free-form editor (`src/ui/trackeditor.js`) in the String track group: an
  SVG polar view (width 100 %, at most 280 px, `viewBox` in mm) with the
  groove bottom, the bore and N handles at the contact points; the working
  arc of the latest result (brace to full-draw contact, `achieved.psiS`)
  drawn thick with marks B and F, handles outside it grey ("outline
  only"). A drag projects the pointer onto n_i and moves the bump, stopped
  by `dragLimit`; values are rounded to 0.1 µm and step back by 1 µm when
  the rounded track misses the limit. A track that misses the limit
  already is limited by the value range only. The stop reason, bend limit
  or value range, sets the status text, `aria-valuetext` and the style of
  the handle. Keyboard: one tab stop
  (roving focus), Left and Right pick the point, Up and Down change one
  value by 0.1 mm (Shift 0.5 mm) or 0.005 in (Shift 0.02 in), refused when
  it crosses the limit. An `aria-live` line reads out the point, its value
  and "Sharpest bend X mm, limit Y mm". The values table takes typed values
  in 2 mm to 150 mm (a value past the bend limit is a solver diagnostic),
  with the draw length at which the string leaves each point. "Offset all
  points" and the Points select (8, 12, 16, `resampleChecked` with a
  message when the track falls below the limit) complete it. Every change
  is one store action; a drag is one transaction and one undo step.
- Shape presets (the modifiers in the user interface): Oval, Rounded
  triangle, Rounded square, Egg, Size and Shift, each with Amount and
  Angle, applied to the current track. The amount starts at the nominal
  amount clamped by `presetRoom` with a 0.5 mm margin; the line under it
  says what limits it, and tells a track below the limit from one inside
  the margin. Size on such a track starts at the smallest amount that
  restores the margin; Shift also keeps the bore clearance. An eccentric
  or elliptical track is sampled (`sampleAnalytic`, 12 to 16 points) in
  the same action, so one undo step reverts it. The panel says that a
  preset can make the design fail and that the solve shows why.

### Optimise

A search for a free-form string track that improves one goal of a design
that meets every check, plausibility warnings allowed (`src/core/optimise.js`, run by
`src/worker/optimise.worker.js`, a second module worker; the solver
client's latest-request-wins scheduler would drop the solves of a search).

- Goals: "Smallest cam, force curve no worse than now" (largest cam
  dimension) and "Closest force curve, cam no larger than now" (largest
  force difference; without a fit, the largest difference between the
  achieved and the target samples). A third goal, the gentlest cable
  track, is left out: the constrained fit pins the smallest cable ρ at its
  limit on every sample design.
- Constraints with margins: status ok, no diagnostic, no warning the
  current design does not have (a cam-size warning is what the cam goal
  is for, and a candidate may clear it); pitch
  string ρ ≥ ρ_lim + max(1 mm, 10 % of ρ_lim), or the start's own smallest
  ρ when that is lower (a start inside the margin keeps at least its own
  bend); string and cable wrap ≤ 350°; for the cam goal a force difference
  ≤ the start's; for the force goal a cam size ≤ the start's; every value
  in 2 mm to 150 mm.
- Search space: the constant and cos kψ, sin kψ of the N values for
  k = 1 … min(4, N/2); the modes up to N/2 join once the step is below
  0.2 mm. Moving single values stalls: on a round track p(ψ) + p(ψ + π) is
  the same in every direction, so a single value makes the cam larger on
  one side (before the force-curve rule of the cam goal, 146 solves over
  single values left the crossbow at 86.0 mm and the mini bow at 26.4 mm,
  where modes reached 70.4 mm and 18.5 mm; with the rule, modes take the
  crossbow from 86.0 mm to 69.8 mm in 157 solves and leave the mini bow at
  26.4 mm after 84 solves, since every smaller cam found there raises its
  force difference above the start's 1.28 N).
- Compass search: poll order low mode first, + before −, the last
  successful direction first; opportunistic (the first improvement by
  more than 1e-9 is accepted). The step starts at 5 % of the mean value,
  scaled per mode by 1/max(1, k² − 1) (mode k of amplitude δ changes ρ by
  (1 − k²)·δ), halves after a poll without improvement and ends below
  0.05 mm.
- Each candidate is rounded to 0.1 µm and prescreened on the spline (value
  range, pitch-line ρ with its margin, bore clearance); a rejected
  candidate is not solved. Solves are cached on the rounded values. The
  cam goal solves coarse (on the default design and the nine samples the
  cam size agrees with a full solve to within 0.003 mm, 0.0025 mm at most
  on the hunting bow) and confirms each improvement with a full solve; the
  force goal solves full throughout (a coarse force difference reads
  0.01 N to 0.62 N low: 0.012 N on the youth bow, 0.620 N on the
  crossbow). A current design whose coarse solve fails a check while the
  full one passes ends the cam goal at once (`start-coarse`).
- Budget: 600 solves, plus the full (and for the cam goal the coarse)
  solve of the current design, which also warms up the worker; 120 s
  wall-clock as a safety stop. Measured in Node.js: the default design
  with the cam goal converges after 178 solves in 4.8 s, 98.2 mm →
  93.9 mm at a force difference of 3.56 N (start 3.71 N); the force goal
  uses all 600 solves in 22 s, 3.71 N → 2.48 N at a cam of 98.2 mm. The
  hunting sample goes from 132.2 mm to 96.4 mm (cam goal, 600 solves), the
  crossbow from 86.0 mm to 69.8 mm (cam goal, 157 solves) and from 11.87 N
  to 3.35 N (force goal). Over the nine samples and both goals a run takes
  2.1 s (mini bow, cam goal, 84 solves) to 42.6 s (youth bow, force goal,
  600 solves).
- The worker posts the start figures, progress after each solve, every
  confirmed improvement and the outcome. Stop terminates the worker and
  keeps the last improvement. A change of the design (units aside) or
  another design stops the run and discards its result. Apply dispatches
  one `setStringTrack` with the free-form values: one undo step.
- Test hook: the query parameter `optimise-budget` (1 to 600) lowers the
  budget of a run for the browser tests.

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
  `docs/model.md`). A degree-7 fit of the forward force at x_b + k·1 mm
  agrees with it to 1e-8 relative (tested; measured 4.7e-10 for the twin
  cam and 2.3e-9 for a cable circle of radius p_c0). The target is rebuilt
  with
  `createCurve(points, { startSlope, startSecondDerivative })`.
- Refinement: F'''' at brace is fixed by the geometry too; a mismatch gives
  the cable track a (ψ − ψ_c0)^(3/2) term with negative ρ near brace. The
  solver replaces the cable track over the first curve segment by a brace
  blend: the quintic in ψ with p(ψ_c0) = p_c0, a C2 join to the ideal track
  at point 2, ∫ p dψ from the cable closure
  (√(D_0² − p_c0²) − √(D_1² − p_1²)) and the smallest ∫ p'''² dψ. The cam
  then reaches the target state at point 2, and the achieved curve equals
  the target from point 2 on to the accuracy of the resampled track: on a
  test cam built without the fit, 1.3e-7 N (full) and 3.8e-7 N (coarse),
  tested to 1e-6 N and 5e-6 N; θ and α at the curve points agree with the
  inverse model to 1e-12 rad (full) and 2e-10 rad (coarse). Inside the
  first segment the achieved curve follows the cam (0.006 N from the
  target on that cam). A fitted track replaces the blend and meets the fit
  tolerance instead.
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
  closer than that after the linear rescaling move apart. A power stroke of
  L holds floor(L / 0.1 in) + 1 points; where a curve has more, the interior
  points at the smallest gaps are dropped first (a stroke over 2 in holds at
  least 21 points, the limit is 50). Validation rejects smaller
  gaps (tolerance 10⁻⁹ m). A move never goes towards a neighbour that is
  already closer.
- Parametric generator: brace, ramp point (40 % of the rise, 38 % of the
  peak), peak start (rise fraction of the power stroke, default 46 %), peak
  end (30 % of the way to the valley), let-off transition point (halfway,
  67 % of the drop), valley start and full draw (default valley width
  1.2 in); the flat part at full draw is adjusted until the measured valley
  width matches the requested one. When the flat part is at its minimum of
  0.1 in and the valley is still more than 1 % too wide, the transition
  point moves on the straight line towards the valley start, so the last
  part of the drop keeps its mean slope, until the width matches. Close to
  the valley start the drop becomes one S-shaped segment and the valley
  widens again, so the generator has a smallest width: on the default bow
  about 0.49 in at 75 % let-off, 0.46 in at 80 %, 0.68 in at 50 % and
  1.54 in at 20 % (rise 46 %); at a let-off ≤ 5 % the valley spans peak to
  full draw. The valley field names the reached width when it differs by
  more than 1 %. The default curve keeps its transition point halfway: its
  valley is 1.2036 in, 0.3 % above the request.
- Walls are vertical in the rigid model; the wall position is x_f. A cable
  stop post is placed on the cable span at θ(x_f).

### Feasibility and diagnostics

The solver never throws on user input and never clamps silently. It returns
`status: ok | infeasible | no-convergence` and a list of diagnostics
`{code, xRange, psiRange, message, suggestion}`. Checks:

- T_c > 0 along the path, equivalently E1'(α) > s_a·T_s and dθ/dx > 0.
- F > 0 on (x_b, x_f].
- Brace: 0 < T_s0 < M_b / s_a0.
- The cable contact at point 2 lies after its brace position, so the brace
  blend exists.
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
  level, skips dependent equalities that hold and checks them again at the
  end, refines x onto the active constraints after each added constraint
  while the largest active residual falls or stays above rounding (at most
  8 passes), reports `infeasible` when rounding leaves an active
  constraint or a skipped equality outside the tolerance, and returns
  `invalid` for mismatched sizes or non-finite data. It is reliable when
  the active normals differ in direction by well over 1e-6, as in the fit
  programmes; with two rows 1e-8 to 1e-6 apart it reports 4 % to 13 % of
  feasible random problems `infeasible` and returns a few `optimal`
  results with a redundant equality off by up to 1.1e-2 of its size
  (`docs/model.md`). The fit returns `invalid` for out-of-range input,
  including points to pass through outside the fitted range or with
  non-finite values, instead of throwing.
- Equalities at every curve point whose ideal lever arm meets p_min:
  p(ψ_k) = p_k and ∫ p dψ from ψ_c0 to ψ_k from the cable closure, plus
  p(ψ_c0) = p_c0. The fitted cam then passes through the target force and
  energy at those points.
- Refinement of the diagnostics: the ideal track follows every wiggle of the
  interpolant between the points and often bends the wrong way over a few
  degrees, most at the corners of the curve (peak start and end, let-off
  transition). A convex cam rounds these corners: on the default preset the
  largest force difference stays at 3.7 N to 3.9 N for 22 to 90 spline
  intervals. A fitted cam whose achieved force stays within 3 % of the peak
  (8.0 N at 267 N, at least 2 N) of the target everywhere, with the draw
  energy within 0.5 %, meets the target; the violations of the ideal track
  are then kept in `fit.idealIssues` and are no diagnostics. Larger
  differences are reported as `cable-radius` or `cable-clearance`, with the
  draw position of the largest difference and the curve points on either
  side; the `cable-radius` suggestion is chosen there, and its named range
  leaves out the brace blend, which the fit always replaces. Of 45
  edits of the default (peak 250 N to 290 N, rise 43 % to 50 %, valley
  1.0 in to 1.5 in), 41 meet 3 % of the peak and 2 meet 1.5 %; the largest
  draw energy difference is 0.14 J against a tolerance of at least 0.42 J.
- Codes: `invalid-input`, `brace-tension`, `cable-lever`, `slack-cable`,
  `nonpositive-force`, `cable-fold`, `limb-rotation`, `limb-energy`,
  `target-shape`, `string-radius`, `string-clearance`, `string-wrap`,
  `cable-radius`, `cable-clearance`, `cable-wrap`, `closing-blend`,
  `no-convergence`, `slack-string`, `wrap-exhausted`; the table with the
  suggestions is in `docs/model.md`.

### Plausibility warnings

`src/core/plausibility.js` checks a solved cam for designs that meet every
diagnostic check but cannot be built or used as drawn. The result carries
them in `warnings` (`{code, xRange, message, suggestion}`); they leave the
status and the exports unchanged, and the results card, the status line and
the print report list them.

- `cam-size`: the cam maximum dimension exceeds 35 % of the axle-to-axle
  length. The sample designs lie between 10 % and 21 %.
- `cam-overlap`: the twin cams are mirror images about the line through the
  grip pivot perpendicular to the axles, and their flange outlines are
  convex, so they overlap exactly when the top cam reaches that line. At
  each forward sample the lowest point of the top cam is
  O_y − max over the outline points (u, v) of (sin θ·u − cos θ·v); a value
  at or below 0 is an overlap of twice its depth.

### Closed cam outline

- The active part of each track covers the draw. Extensions: lead-in wrap at
  brace for the cable, residual wrap at full draw for the string (inputs,
  0° to 180°, default 30°), each ending at a post. The string residual wrap
  lies on the string track. The cable lead-in keeps p, p' and p''
  continuous at the brace contact of the track (ψ_c0, or later when the fit
  leaves out p(ψ_c0) = p_c0) and settles within about 10° to a constant
  ρ_0 = clamp(ρ(ψ_c0), ρ_min, p(ψ_c0)), so it cannot swing outwards
  (`docs/model.md`).
- The remaining arc is closed by a quintic blend in ψ that matches p, p', p''
  at both joins with ρ ≥ ρ_min. Any periodic p with p + p'' > 0 gives a closed
  convex curve.
- When no closing blend exists, `closing-blend` names the largest lead-in
  wrap (5° steps, down to 0°) that closes the track. Otherwise it names a
  string track 5 mm to 20 mm larger, or half the minimum bend radius, only
  when a coarse trial solve with that change reports no diagnostic, and
  otherwise lists what was tried (`docs/model.md`). The trials run in a
  full solve; a coarse solve, which runs while an input is dragged, names
  the force curve.
- Posts (string post, cable post), cable stop post and timing marks (string
  exit at brace, cable exit at brace, full-draw index) are placed in the cam
  frame.
- Implementation (`src/core/outline.js`): when the quintic blend bends below
  ρ_min or comes below p_min, a constrained spline fit with p, p', p''
  prescribed at both joins replaces it. The closed track is a periodic C2
  cubic spline through samples of the pieces (at most 0.25° apart in a full
  solve, 0.5° in a coarse solve). The
  cable stop peg touches the full-draw cable line on the axle side where it
  clears the cable groove bottom by its radius. The cam maximum dimension
  is the largest width of the union of both flange outlines.

### Numerics

- Forward model: 1500 draw samples for final results, 100 while dragging;
  closure residual < 1e-10 m; contact residual < 1e-15 m. Budgets: 8 ms
  for 100 samples and 100 ms for 1500 samples.
- Inverse: samples uniform in ψ; E1⁻¹ residual < 1e-9 J. Draw grid of 100
  (coarse) or 600 (full) samples plus the curve points; cable samples every
  0.5° or 0.25°; string closure residual < 1e-10 m.
- Solve budgets for the default preset: 30 ms coarse (while dragging),
  200 ms full (on release). The performance tests report the medians and
  fail only above 5 times the budget, which allows for shared continuous
  integration (CI) machines. The solve test times the solve in a worker
  thread: the coverage run adds V8 block counters to the test process,
  which slow the solve about 4 times, and the budget applies to the code as
  the app runs it. Measured medians with Node 22 on a 4-core 2.1 GHz Xeon:
  24 ms to 27 ms coarse and 30 ms to 35 ms full alone; 26 ms to 35 ms and
  33 ms to 51 ms in the coverage run with the rest of the suite in
  parallel; 32 ms to 49 ms and 56 ms to 63 ms with every core also loaded
  by another process. The first call, before the JavaScript engine has
  optimised the code, takes 200 ms to 250 ms alone and up to 480 ms on a
  loaded machine. A `closing-blend` that no lead-in wrap closes adds up to
  five coarse trial solves to a full solve: 107 ms to 112 ms median and at
  most 490 ms on 76 edits of point 2 of the default. A coarse solve runs
  no trials: on these edits it takes 82 ms to 85 ms median and at most
  127 ms. The performance test holds the coarse solve with point 2 at
  10 in and 50 N below 10 times the coarse budget: 78 ms to 89 ms alone
  and up to 138 ms on a loaded machine. Its five trial solves take about
  350 ms in a full solve.
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
  semi-axes, offset, phase; free-form: 8 to 16 groove radii at equal
  angles), defined on the groove bottom as the user measures it.
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
  draw, force, θ, T_s, T_c; JSON project; share link.
- Print report (`src/ui/report.js`): the last cam that met every check and
  its inputs, as the exports use them, in the current display units. It
  lists the design name, date and time, app version and the export status
  sentence; the inputs; the target statistics; the results metrics and
  diagnostics; a static force chart (`src/ui/staticchart.js`, fixed size,
  no ids); the cam and the string plan at brace from fresh view instances;
  the build lengths; the loads chart at a fixed width with the load maxima;
  a force table at 10 % steps of the draw; the static-model footnote. The
  report is built on `beforeprint` and removed on `afterprint`, so the
  print command of the browser prints it too; without such a cam the page
  prints unchanged. A print style sheet forces the light colours, keeps
  figures and table rows on one page, repeats table headers and sets 12 mm
  page margins without a page size, so A4 and Letter both work.

## Hosted versions

- `scripts/build-site.js [out]` builds the site: the checked-out tree at
  the root with `APP_CHANNEL=main`, then every tag matching
  vMAJOR.MINOR.PATCH (no leading zeros) from its own `git worktree` with
  its own `npm ci` and `APP_CHANNEL=<tag>`, into `<out>/<tag>/`. It writes
  `<out>/versions.json`: `{ versions: [{ id: "main", path: "" }, { id:
  "v0.2.0", path: "v0.2.0/" }, …] }`, tags newest first. Measured: 10 s
  for main plus one tag with a warm npm cache.
- Vite injects `__APP_CHANNEL__` from `APP_CHANNEL` (default `main`) and
  rejects any other value. `src/state/channel.js` holds the pure rules:
  tag syntax and order, the manifest, `parseVersions` (each entry must be
  main at '' or a tag at '<tag>/', no duplicates, at most 64 KB), the site
  root ('./' for main, '../' for a release) and the storage prefix.
- Storage (decision of the user): main keeps the keys
  `compoundCamCalc.project`, `.current`, `.designs` and their backups; a
  release built with this code uses `compoundCamCalc@<tag>.…`, so an older
  release never reads or replaces data written by a newer schema, and the
  named designs of main are not listed in a release.
- Version select (`src/ui/versions.js`) after the Help button: fetched
  from `<site root>versions.json` (`cache: no-cache`); hidden when the
  fetch fails, the list is invalid, has fewer than two entries or does
  not name this build. Options "main, newest (<version>)" (on main) or
  "main, newest", then the tags. A change navigates to `<site root><path>`
  with `#design=` and the share payload of the open design and its name;
  the target opens it as a shared design (it asks first when it has
  unsaved changes). A note under the select says that releases keep their
  own saved designs and that the open design goes along.
- Workflows: CI runs on `workflow_dispatch` as well; `pages-build` and
  `deploy` run for a push to main or a dispatch on main. `pages-build`
  checks out main with all tags (`fetch-depth: 0`) and uploads `site/`.
  The release job (permission `actions: write`) runs `gh workflow run
  ci.yml --ref main` after it creates the release, so the Pages
  environment deploys from main only.
- Limitation: a share link from a newer schema version opened in an older
  release reads "The link was made with a newer version of the app;
  reload the page", which is wrong advice on the versioned site (a reload
  stays on the release). Planned fix in slice 9.

## User interface rules

- Validation on Enter, blur or stepper; sliders update live. Every field has
  min, max, step and unit; inline messages next to the field.
- Solve runs in a Web Worker, latest request wins. Coarse solve while
  dragging, full solve on release, within the solve budgets under
  Numerics (30 ms and 200 ms for the default preset).
  `data-solve-state` attribute exposes idle / busy / ok / error.
- On an infeasible result the last valid cam stays visible, dimmed; the
  diagnostic names the draw range, the constraint and the input to change.
- Undo/redo for all edits (Ctrl+Z, Ctrl+Shift+Z), one entry per drag, capped
  at 100; undo and redo are refused while a drag or slider gesture is open.
- Autosave to localStorage (guarded by try/catch), debounced 300 ms and
  flushed on `pagehide` and when the page is hidden; schemaVersion in saved
  data. Unreadable saved data is copied to a backup key before the next
  change replaces it.
- Glossary tooltips for ATA, brace height, draw length (AMO), peak draw
  force, let-off, holding weight, valley, power stroke, draw energy, limb
  energy, axle travel, cam rotation, lever arm, radius of curvature,
  minimum bend radius, minimum wall, working arc. One source, `GLOSSARY` in
  `src/ui/glossary.js`, feeds the info buttons, the help dialog and the
  Terms section of the user guide; unit tests check that every term here
  has an info button and that the user guide repeats each text word for
  word.
- Help dialog from a Help button next to the File menu, with no keyboard
  shortcut (Web Content Accessibility Guidelines, WCAG, success criterion
  2.1.4): quick start in 5 steps, the keyboard shortcuts of the chart, the
  free-form track editor, undo and redo, the drawings and the draw position
  slider, the whole glossary,
  and a link to the user guide in the wiki (new tab). Focus starts on the
  heading and returns to the Help button; close buttons at the top and the
  bottom; the dialog scrolls within 90 % of the dynamic viewport height
  with no horizontal scroll at 320 px.
- Footnote under results: static model; string stretch, cam timing and
  dynamics not modelled.
- Touch: Pointer Events, `touch-action: none` on the editor, hit targets
  ≥ 44 px. Keyboard: points focusable, arrows move 0.1 in / 1 N, Shift ×10.
- Responsive layout: side-by-side panels on screens from 960 px, stacked
  panels on narrower screens; no horizontal scroll at 320 px.

## Export geometry

- All exports in millimetres; origin at the axle centre, +Z along the axle,
  string layer at +Z, viewed from the string side. No mirrored bottom cam:
  the bottom cam uses the same plates turned over.
- One canonical clamped cubic non-rational B-spline per curve
  (`src/core/bspline.js`), used by both writers; first control point = last
  control point for closed curves. A spline track is fitted by Hermite
  pieces on its own knots with the exact tangents (C1, no inflection); an
  ellipse by a C2 interpolant on uniform knots, refined until convex and
  within tolerance. Eccentric-circle tracks are written as circles.
- DXF: hand-written R2000 (AC1015) writer (`src/export/dxf.js`) with handles,
  tables, layouts and an object dictionary; `$INSUNITS = 4`,
  `$MEASUREMENT = 1`; SPLINE flag 70 = 8 only, no exponent in any number;
  explicit colour per layer; layers PITCH, GROOVE, FLANGE, OUTLINE, BORE,
  POSTS, STOP, MARKS, TEXT (string plan: BRACE, FULL, TEXT). The writer
  replaces the library `@tarikjabiri/dxf`, which writes R2007 and does not
  control its number format.
- Cut contours: closed LWPOLYLINE on the track offset outwards by the export
  tolerance, at a constant angle step, so every chord stays within ±0.01 mm.
- Plates (thicknesses from the flange thickness and groove clearance
  settings, see STEP below): 1 string flange, 2 string
  groove, 3 middle flange (convex hull of both flanges), 4 cable groove, 5
  cable flange. Post holes only in the flange plates next to their cord's
  groove (string post 1 and 3, cable post and cable stop 3 and 5). A
  flange plate that does not keep the minimum wall around the cable stop
  peg gets a boss of radius peg + minimum wall around it; any other hole
  that does not fit is left out with a warning that names the plates still
  holding the post.
- Number format: coordinates 6 decimals (mm), knots 12, spline control
  points 10. The drawing extents include the glyph box of every text
  (advance of 1 text height per character, descent 0.3 text heights).
- Files: five plate cut files, a reference drawing, a string plan, the force
  table (CSV) and a ZIP of all of them with a README; names
  `cam-<YYYYMMDD>-<design id>-<part>`, design id = first 6 hex digits of the
  FNV-1a hash of the inputs without display units.
- STEP AP214 (automotive design schema, ISO 10303-214), hand-written
  Part 21 text (`src/export/step.js`), millimetres:
  - Plate thicknesses from two cam body settings (decision of the user):
    flange thickness t_f (default 2 mm, 0.5 to 20 mm) for plates 1, 3 and
    5; groove clearance c (default 0.5 mm, 0 to 5 mm) for plates 2 and 4,
    which are d + c thick with d the diameter of their cord. The fields fill
    in with their defaults when a saved project lacks them, so the schema
    version stays 1.
  - Files (decision of the user): one stacked file and one file per plate
    with its solid on z ∈ [0, t]. The stack has plate 5 on z ∈ [0, t_f] and
    plate 1 on top, so +Z points towards a viewer on the string side, as in
    the drawings. The pitch lines lie in the mid-plane of their groove
    plate. All six files go into the ZIP and have their own buttons.
  - One MANIFOLD_SOLID_BREP per plate, named after the plate, in one
    ADVANCED_BREP_SHAPE_REPRESENTATION of one product (a multi-body part,
    no assembly structure); product name "Cam <design id>" in the stacked
    file, the plate name in the others. No Boolean operations: the outline
    and the holes are the loops of the planar faces.
  - Outline: the exact track, not the cut offset of the DXF files, within
    tol/2 = 0.005 mm (the user's tolerance: ±0.01 mm is enough):
    - a plate of one track without a boss reuses the export fit of that
      track (plate 1 string flange, 2 string groove, 4 cable groove, 5
      cable flange): a CIRCLE for an eccentric circle, the Hermite pieces
      of a spline track, the C2 interpolant of an ellipse;
    - plate 3 and a plate with a boss use the hull fit (`fitHull`): arcs of
      h(ψ) = max p_k(ψ) with crossings from a 0.25° grid refined by
      bisection; Hermite pieces with exact points and tangents on each arc
      (breakpoints on the track knots, at most π/8 apart otherwise, pieces
      that fail the tol/2 check at 9 points halved); an exact straight
      cubic on each common tangent P → Q, knot interval 2L/(ρ_a + ρ_b) and
      inner points P + (Δu/3)ρ_a·t, Q − (Δu/3)ρ_b·t, so the curve is C1 in
      u. The boss is an eccentric-circle track. A hull of one track over
      the whole turn reuses that track's curve. The curve starts at ψ_0 = 0
      (plates 1 to 3) or at the cable track start (plates 4 and 5).
    - Interior triple knots are reduced to double ones where the curve is
      C1 in u (exact knot removal); coordinates carry 12 significant
      digits, knots 15.
  - Holes: bore and post holes as CIRCLE edges and CYLINDRICAL_SURFACE
    faces. A hole closer than tol to the outline or to another hole is left
    out of the solids with a warning.
  - Topology and orientation: per closed profile two vertices at its start
    point (bottom, top), three edges (bottom curve, top curve, vertical
    seam LINE) and one side face; V = 2n, E = 3n, F = n + 2, L = 3n for n
    profiles, so V − E + 2F − L = 2(1 − G) with G = n − 1 holes. Profiles
    run counter-clockwise seen from +Z. Outline side face: loop (bottom
    .T., seam .T., top .F., seam .F.), same_sense .T.; hole side face:
    loop (bottom .F., seam .T., top .T., seam .F.), same_sense .F.; top
    PLANE (axis +Z) same_sense .T. with the outline .T. and holes .F.;
    bottom PLANE same_sense .F. with the outline .F. and holes .T.; outer
    loops FACE_OUTER_BOUND, holes FACE_BOUND. No topology is shared
    between solids.
  - Pitch lines: a GEOMETRIC_CURVE_SET in a
    GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION linked to the
    B-rep by SHAPE_REPRESENTATION_RELATIONSHIP; a circle is written as a
    TRIMMED_CURVE over one turn (a bounded curve). Some programs hide
    wireframe on import.
  - Header: FILE_SCHEMA AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 },
    time stamp YYYY-MM-DDThh:mm:ss of the export; units millimetre, radian,
    steradian; uncertainty 1E-6 mm. REAL tokens always carry a decimal
    point; strings escape ' and \ and write other characters as
    \X2\hhhh\X0\, above U+FFFF as \X4\hhhhhhhh\X0\.
- File menu (request of the user, same slice as STEP): several named
  designs in the browser plus JSON project files (decision of the user),
  and sample designs.
  - Header: "Design: <name>" and one "File" button (disclosure with
    `aria-expanded`, not `role=menu`; Escape closes it and returns focus)
    opening Save, Save as…, Open…, Open sample…, Reset to default, Save to
    file (.json) and Open from file…. "(unsaved changes)" follows the name while the
    inputs differ from the saved copy; it is not a live region. Without a
    current design the name reads "Untitled"; a design opened from a file
    reads "<file name> (from file, not saved)".
  - Dialogs: native `<dialog>` with `showModal()` for Save as, Rename, Open
    and confirmations; focus returns to the control that opened them; the
    Ctrl+Z/Y handler ignores keys while a dialog is open. Name fields have
    visible labels, errors use `aria-invalid` and `aria-describedby`. The
    Open list shows name and saved time per row with Open, Rename and
    Delete buttons whose accessible names carry the design name; at 320 px
    the row stacks, every target is 44 px, nothing scrolls sideways.
    Results ("Saved "bow"", "Opened "bow"", errors) go to one live region
    that is always in the page.
  - Library (`src/state/library.js`, no DOM): localStorage key
    `compoundCamCalc.designs` holds `{ version: 1, designs: [{ id, name,
    savedAt, state }] }`, savedAt as ISO 8601. Names are trimmed, inner
    white space collapsed, NFC-normalised, 1 to 80 characters, unique
    ignoring case; a clash in Save as or Rename shows "A design named
    "<name>" already exists" with a Replace button. Every operation reads
    the library right before writing; a `storage` event from another tab
    refreshes the list, the name and the marker. Each entry is checked with
    migrate and validate when listed; a broken entry reads "cannot be
    opened" and can only be deleted. A library that cannot be parsed is
    copied to `compoundCamCalc.designs.unreadable` and never overwritten.
  - Current design: `compoundCamCalc.current` holds `{ id, name, source }`
    (id null for an unsaved design) and is written in the same save as the
    working copy `compoundCamCalc.project`, and at once on Open, Save, Save
    as, Rename and Delete, so name and inputs always come from one tab. A
    reload restores the working copy with its name and marker. There is no
    leave-page prompt: the working copy is autosaved. Autosave writes the
    working copy and the current design together; when either write fails
    it restores both. The current design carries `pair`, a 32-bit FNV-1a
    stamp of the working copy text it was written with: two tabs that
    autosave at once can interleave their writes, and a stamp that does not
    match on load gives an unsaved "Untitled" design that asks before it is
    replaced. On load a saved design takes its name from the library.
    Library changes (save, rename, delete) read, change and write the
    library under a Web Lock shared by all tabs, so two tabs cannot
    overwrite each other's changes; a real write that fails turns Save and
    Save as off until a write succeeds. An action that waited for the lock
    changes the current design only when no other design was opened
    meanwhile.
  - Unsaved changes: `toJSON(state)` differs from the saved copy after
    `fromJSON` (key order normalised by `migrate`, including table rows).
    Recomputed after each change outside a gesture; undoing back to the
    saved inputs clears it; display units count. Without a current design,
    the marker shows when the inputs differ from the default preset, so an
    untouched default never asks before Open.
  - Save writes the working copy into the current design; without one it
    opens Save as…, prefilled with the file name for a design from a file.
    Opening a design or a file while the marker shows asks first (Discard
    or Cancel).
  - Reset to default replaces the inputs with the default preset, keeps
    the display units, leaves the saved design untouched (the marker
    shows) and is one undo step. Its description reads "Replace all inputs
    with the default design", unlike Reset curve.
  - Open and Open from file use a new store method `replace(state)`:
    validates the state, clears undo, redo and any open gesture, always
    notifies, is not undoable. The app then drops the latest and last-valid
    solve results, so exports wait for a cam of the opened design, and the
    editor clears its point selection and message.
  - Delete of the open design (here or in another tab) keeps the inputs as
    an unsaved design with the same name; the confirmation says so.
  - Save to file downloads `<name>.json` (characters `/\:*?"<>|` and
    control characters replaced by '-', fallback `design.json`) with the
    project state in the autosave format, schema version 1. Open from file…
    rejects empty files, files over 1 MB and non-JSON text before parsing;
    with any `fromJSON` error nothing changes and the message reads "Could
    not open <file>: <first error>"; a file that lacked fields opens with
    "Missing values in <file> were set to their defaults". The file input
    is cleared after each pick.
  - Storage blocked or full: a failed write keeps the marker and says "The
    design was not saved: browser storage is full or blocked. Use Save to
    file."; with storage blocked, Save, Save as and Open… are disabled with
    that note, and the file actions keep working. Nothing throws.
  - Open sample… lists the sample designs (`src/state/samples.js`) with a
    one-line description each; a sample opens like a file, as an unsaved
    design named after the sample. Samples (request of the user): the
    default target compound bow, a hunting compound bow, a crossbow and a
    mini bow whose cams print on an FDM (fused deposition modelling)
    printer with a 0.4 mm nozzle. Slice 8 adds five compound bows: the
    target with a free-form string track from Optimise, light hunting,
    short-brace hunting with a free-form string track, long draw and
    youth. Each solves with zero diagnostics and zero plausibility
    warnings; a unit test checks that.
  - Input ranges widen for crossbows and small bows: axle-to-axle length
    8 to 48 in, brace height from 1.5 in, draw length from 6 in, limb lever
    from 2 in, peak force from 5 N, limb stiffness from 0.1 N/mm, power
    stroke from 2 in.
  - Export file names keep the design id hash in this slice.
- Share link (slice 7): File → Copy share link, after Save to file.
  - Link: `location.origin + location.pathname + location.search +
    '#design=' + payload`. The fragment is not sent to the server. The
    payload (`src/state/share.js`, no DOM) is `v1.` and base64url of the
    UTF-8 bytes of the JSON `{ name, state }`, without compression: about
    1.6 KB for the default design. Base64url is written by hand ('-' and
    '_', padding optional, any other character rejected, bytes in chunks);
    UTF-8 through `TextEncoder` and a fatal `TextDecoder`.
  - Limits: a payload over 64 KB is refused before decoding, decoded
    bytes over 1 MB after. `readProjectText(text, bytes, noun)`, factored
    out of `readProjectFile`, reads the state, so messages say "link" and
    not "file".
  - Messages: a cut-off or damaged link (bad base64url, UTF-8 or JSON, no
    state) reads "The link is incomplete or damaged, often because a chat
    app shortened it. Ask for the whole link, or for a project file." A
    newer schema or link format reads "The link was made with a newer
    version of the app; reload the page."
  - Name: cut to 80 characters, then normalised; "Shared design" when
    missing or invalid. It is set as text, never as markup.
  - Copy: `navigator.clipboard.writeText`; status "Share link copied (N
    characters)". Without the clipboard, or when it refuses, a dialog
    shows the link selected in a read-only field with a Close button.
  - Open: the app reads the fragment after autosave starts, on load and on
    `hashchange`; only `#design=` fragments count, so the `#results-title`
    anchor of the solve chip stays a page anchor. `openShared(state,
    name)` of the File menu opens the design as Open from file does:
    unsaved, with the link state as baseline and the display units of the
    recipient. Unsaved changes or an orphaned design ask in "Open a shared
    design": Save mine first… (Save as, then open), Open without saving,
    Keep my design (default focus). Keep leaves a notice with an "Open
    shared design" button that asks again while the changes are unsaved.
    An open whose current design changed meanwhile (the epoch counter of
    the File menu) is dropped. A link that arrives while a dialog is open
    waits for it to close; only the newest waiting link applies. After a
    link is handled, `history.replaceState` removes the fragment.
  - Tests: unit tests for base64url against Node.js, a round trip of
    every sample, cut links (50 %, 90 %, one character short), damaged
    and wrong-prefix links, newer schema, oversize and name rules;
    Playwright for copy and open in another browser profile with other
    units, the clipboard fallback dialog, direct open, the three-choice
    dialog with Keep and the notice, Save mine first, invalid links, a
    name with markup, and links that arrive while a dialog is open.
  - Tests: unit tests for the library codec (parse, broken entry,
    unreadable library, names, file names), `store.replace`, the unsaved
    comparison (revert, reordered keys) and partial files; Playwright for
    the first visit, Save as and reload, a name clash, Open with unsaved
    changes, undo after Open and after Reset to default, Delete of the open
    design, Save to file and Open from file round trip, invalid files,
    blocked storage, two pages sharing a library, the export panel after
    Open, 320 px layout, focus return and a keyboard-only flow.

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
- STEP: a Part 21 checker (`tests/unit/step-reader.js`, also run by
  `scripts/validate-step.js` in the CI export job): references, REAL and
  INTEGER tokens, knot sums, edge use, loop connectivity, Euler–Poincaré,
  loop orientation on the planar faces (signed area against the face
  normal) and side-face orientation. occt-import-js heals orientation
  errors, so its import proves neither. occt-import-js (dev dependency,
  absolute deflection 0.001 mm, angular 0.1): one mesh per solid, face
  count, z range, and mesh volume against t·(outline area − hole areas)
  within 2e-4, with the outline area from the written B-spline (Green,
  3-point Gauss per span). The outline area against the exact hull area
  ½∫p(p + p'')dψ on the arcs plus ½ P × Q on each tangent stays within
  0.4 m × tol/2.
- DXF: round trip with an own reader (`tests/unit/dxf-reader.js`); `ezdxf audit` in CI; header units; end-to-end
  test that parses the exported DXF, rebuilds the tracks, runs the forward
  model and matches the target.
- Optimise: a synthetic objective with a known minimum, determinism,
  constraint handling (prescreen, warnings, wraps, force and cam limits,
  full-solve confirmation), budget and time stops; the default design with
  a budget of 30 solves makes the cam smaller, keeps every check and the
  margins, and repeats the same values.
- Playwright: load, drag, keyboard edit, touch add/delete in a mobile
  viewport, unit switch, undo/redo, infeasible input message, export
  downloads, Optimise with a small budget (Stop, Apply, Discard, undo,
  discard on a change); axe accessibility check.

## Repository layout

```
src/core/     units, interpolation, support functions, geometry, limb,
              forward and inverse solvers, B-spline fitting (no DOM)
src/state/    ProjectState schema, defaults, presets, validation, JSON/URL codec
src/export/   DXF and STEP writers: (result, options) => string
src/worker/   solver and optimise worker wrappers
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
`actions/setup-python@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`,
`actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`,
`actions/deploy-pages@v5`.

- CI (`pull_request`, push to `main`): jobs lint (ESLint + `tsc`), unit
  (Vitest with coverage, `coverage-readme --check`), build, e2e (Playwright on
  the built site), export (sample files of two designs from
  `scripts/export-samples.js`, checked by `scripts/validate-dxf.py` with
  Python `ezdxf` 1.4.4 and a ZIP check in `scripts/validate-dxf.py`), deploy to Pages (push
  to `main` only, needs all other jobs).
- Docs CI (push to `main` touching `docs/**`, manual dispatch): syncs `docs/`
  to the wiki repository.
- Release CI (a pushed tag `v*`, or a manual run with the inputs `tag` and
  `target`): a `prepare` job checks the tag format (vMAJOR.MINOR.PATCH),
  and for a manual run that `target` is a full SHA on main and the tag
  does not exist yet. CI runs on that commit (`workflow_call` input `ref`;
  the Pages jobs skip a call with a ref). The release job checks the tag
  against `package.json` at the commit, builds the archive and creates the
  release: with `--verify-tag` for a pushed tag, with `--target <sha>` for
  a manual run, which creates the tag on GitHub without a git push. Then it
  dispatches CI on main to rebuild the site. The workflow token cannot
  create a tag on a commit whose `.github/workflows` differ from main
  (the API answers HTTP 403 "Resource not accessible by integration"), so
  `prepare` refuses such a target; that commit needs a pushed tag.
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
| 3b | User interface of slice 3: solver worker (latest request wins, coarse while dragging, full on release), results card with diagnostics, achieved-curve overlay, cam view, settings for limbs, string track, cords and cam body |
| 4 | String plan layout, build lengths, loads chart, draw-position scrubber. Pose and loads in `src/core/layout.js` from the forward-model samples, linear between samples; no change to the solver, the worker or the project schema. The draw position is view state: not saved, not in the undo history, no solve. Zoom and pan shared in `src/ui/viewport.js` |
| 5 | B-spline fitting, DXF export (plates, reference, string plan), CSV export. Hand-written R2000 writer, five plate profiles with post holes in the flange plates, ZIP of all files, no mirror option (decisions of the user); exports use the last cam that met every check |
| 6 | STEP export: flange thickness and groove clearance settings, a stacked STEP file and one STEP file per plate (decisions of the user), Part 21 checker and `occt-import-js` checks. File menu: named designs in the browser, JSON project files, reset to default, sample designs (compound bows, crossbow, FDM mini bow) with wider input ranges (requests and decisions of the user) |
| 7 | Share link (`#design=` fragment, `src/state/share.js`), glossary and help, print report, wiki user guide |
| 8 | Free-form string track plus Optimise (request of the user): free-form representation, shape modifiers presented as shape presets that apply to the current track, a free-form editor, Optimise with two goals ("Smallest cam, force curve no worse than now" and "Closest force curve, cam no larger than now") and more sample designs. First part: the representation, the solver branches, the pure functions of `src/core/freeform.js`, the Shape select option and exports. Second part: the free-form editor and the shape presets (`src/ui/trackeditor.js`). Optimise part: the search in `src/core/optimise.js`, the optimise worker and the Optimise section of the String track group. Sample part: light hunting, short-brace hunting (free-form track with a rounded triangle), long draw and youth compound bows, and the target with an optimised track |
| 9 | Forward compatibility before new inputs: dropped unknown keys reported, newer-version messages pointing to the Version select, design id ignoring analysis-only inputs, `solve` option `analysis` (off by default). Details in [research.md](research.md#delivery-plan) |
| 10a | Asymmetric rigid analysis `src/core/analysis.js` (cam timing, nock travel, stop order), no user interface |
| 10b | Timing user interface: cable and string length changes, nocking point height, timing results block and chart |
| 10c | String plan with both halves, CSV columns and print report section for the analysis |
| 11 | Cord stiffness: EA per cord, compliant closures, wall stiffness, free and loaded build lengths |
| 12 | Reference-bow fixture format and harness; first fixture Tiermas's round-wheel bow B1 |
| 13 | Open spiral tracks: a track may end at a post with a step in the outline; step clearance, non-convex overlap check and exports (request of the user) |
| 14 | Default design and samples retuned towards real limbs from verified reference data (decision of the user) |
| 15 to 17 | Binary cam (forward, then design, with the stiffness of the cam-to-cam timing cable), then hybrid and single cam; each needs a go-ahead of the user |

Default preset: ATA (axle-to-axle length) 33 in, brace height 6.5 in, draw
length 29 in, peak 267 N (60 lbf), let-off 75 %, string and cable diameter
2.5 mm, limb 11 in long at 25° at brace. The solver builds it with zero
diagnostics:

- Limb: stiffness mode, 2.6 N/mm, preload travel 192 mm, axle travel
  78 mm, rotation limit 30°; achieved axle travel 77.5 mm. The limb is soft
  and heavily preloaded: the preload travel turns the 11 in lever 39° from
  unstrung to brace, and the limb pushes on the axle with 499 N at brace
  and 701 N at full draw. Limbs fitted to measured bows of 50 lbf to
  58 lbf are stiffer (4.4 N/mm to 4.8 N/mm) with 54 mm to 71 mm of axle
  travel ([research.md](research.md#the-apps-default-design-against-these-ranges));
  slice 14 retunes the default towards them.
- String track: eccentric circle, radius 45 mm, offset 22 mm towards −122°;
  string lever arm 63.6 mm at full draw.
- Hub: bore 8 mm, wall 3 mm; the cable lever arm stays at or above
  p_min = 4 + 3 + 1.25 = 8.25 mm.
- Curve: the generator defaults above (rise 46 %, valley 1.2 in).
- Result (full resolution): achieved peak 270.1 N, let-off 74.9 %, draw
  energy 93.0 J, limb energy 188.8 J, cam rotation 224°, largest cam
  dimension 98 mm, smallest cable radius of curvature 5.0 mm (the limit);
  the fitted cam follows the target within 3.7 N (tolerance 8.0 N) and
  0.01 J.
- Edits: peak 250, 260, 275 and 285 N, rise 44 %, 48 % and 50 %, and
  valley 0.9 in and 1.5 in each build with zero diagnostics (a unit test);
  the largest force difference is 6.0 N at peak 250 N (tolerance 7.5 N).
  Of the 45 edits of peak 250 N to 290 N, rise 43 % to 50 % and valley
  1.0 in to 1.5 in, 41 build with zero diagnostics.

Let-off ceiling (symbols as in docs/model.md, L the let-off). At full draw
the string carries the low holding force, F_hold = (1 − L)·F_peak =
2·T_s,f·sin φ_f,
and the cable lever arm p_c = p_s·c_a·T_s / (E1' − T_s·s_a) must stay at or
above p_min. This bounds the limb moment at full draw from above,
E1'_f ≤ T_s,f·(s_a + p_s,f·c_a/p_min). At a fixed draw energy
W = k·s_f·(s_f + 2·s_0) (both limbs) the limb force at the axle at full
draw is k·(s_0 + s_f) = W·(s_0 + s_f)/(s_f·(s_f + 2·s_0)); it falls with
more axle travel s_f and more preload travel s_0. With the lever geometry
of this bow the balance gives an approximate lower bound on the axle
travel,

```
s_f ≳ η·S·sin φ_f / ((1 − L)·(2·p_s,f/p_min + 1)) · (s_0 + s_f)/(s_0 + s_f/2)
```

with η = W/(F_peak·S) = 0.66, power stroke S = 527 mm and φ_f = 52°: 78 mm
at 75 % (the model gives 77.5 mm), about 100 mm at 80 % and about 140 mm at
85 %. On four tuned 80 % states the bound lies within 3 % of the model
(model 77.6 mm to 101 mm, bound 78.8 mm to 103 mm).

- The main levers are p_min (bore and wall) and the string lever arm at
  full draw p_s,f: both enter as p_s,f/p_min.
- At a fixed draw energy a softer, more preloaded limb with more axle
  travel raises the let-off, and a stiffer one lowers it. With the default
  string groove and hub the achieved let-off follows the limb force at the
  axle at full draw: 10 N/mm with 60 mm preload (1142 N) reaches 61.5 % for
  a 75 % target; 2.6 N/mm with 192 mm (699 N) and 4 N/mm with 84 mm
  (694 N) reach 76.1 % and 76.3 % for an 80 % target; 1.8 N/mm with 200 mm
  (543 N) reaches 80.8 %.
- A lower let-off also relaxes the limit.

Let-off 80 % builds with zero diagnostics and at least 90 J of draw energy,
but not with the margins of 75 %:

- Default limb, groove and hub: 76.1 % achieved, 15.5 N from the target.
- Default hub, limb 2.1 N/mm with 191 mm preload, groove radius 44.3 mm,
  offset 24.2 mm towards −117.4°, rise 47.2 %: 79.6 %, 91.2 J, 4.4 N
  (tolerance 8.0 N), 92 mm axle travel, 124 mm cam. Eight of the nine
  edits above build (largest 6.7 N; rise 44 % reports `closing-blend`),
  and 29 of the 45 edits do (largest cam 135 mm); tuned for the 45 edits
  as well, 33 of 45 (2.07 N/mm, 93 mm axle travel, 127 mm cam).
- Default hub with the cam at most 105 mm and the axle travel at most
  85 mm: at best 6.9 N (86 % of the tolerance), and up to 93 % of the
  tolerance on the nine edits, with a 48 mm groove radius and a 73.8 mm
  string lever arm at full draw.
- Bore 6.35 mm and wall 2 mm (p_min 6.43 mm), limb 2.575 N/mm with 191 mm
  preload, groove radius 43.1 mm, offset 22 mm towards −120.75°, valley
  1.18 in: 79.6 %, 91.8 J, 3.86 N, 77.6 mm axle travel, 95 mm cam; the nine
  edits build (largest 6.9 N) and 38 of the 45 edits do. This needs a
  smaller axle and bushing than the default hub.

Let-off 75 % is the default: among the states with the default hub it has
the smallest cam, the shortest axle travel and the most edits within the
tolerance (41 of 45).

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
- No reference-bow test runs yet (slice 12 adds the fixtures); the
  reference values read from papers are in
  [research.md](research.md#reference-data-from-papers). The forward model reproduces the published model of
  Tiermas's round-wheel bow B1 to 2.3e-12 N; against the measured points
  of the bow, read from a figure and not yet stored, that model deviates by
  5 N to 6 N rms (provisional; the cause is not established). The
  default limb (2.6 N/mm, 192 mm preload travel, 78 mm axle travel) is
  softer and more preloaded than the limbs fitted to measured bows
  (4.4 N/mm to 4.8 N/mm, 54 mm to 71 mm axle travel)
  ([research.md](research.md#the-apps-default-design-against-these-ranges)).

## Later

Cable guard 3D lengths and fleet angle, yoke legs, draw-length modules, limb
bolt range sweep, separate top and bottom limbs, mass and inertia, import of
an existing cam for analysis.
