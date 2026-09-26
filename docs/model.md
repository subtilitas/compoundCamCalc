# Model

This page describes the static model of a twin-cam compound bow in
`src/core`: the bow geometry, the cam tracks as support functions, the cord
length, the forward model that turns two cam tracks and a limb into a draw
force curve, the inverse model that turns a target force curve into the
power-cable track, the constrained fit of the cable track, the closed cam
outline, the diagnostics of the solver and the tests that verify it (see
also [Plan](PLAN.md)).

All model code works in SI units: lengths in m, angles in rad, forces in N,
moments in N·m, energies in J.

## Coordinate conventions

- World frame: origin at the grip pivot point, x along the draw direction
  (towards the archer), y up. The nock sits at N = (x, 0).
- Brace height x_b is the nock position at brace. Full draw
  x_f = AMO draw length − 1.75 in, where AMO is the Archery Manufacturers
  Organization convention (draw length = nock to grip pivot point + 1.75 in).
- The bow is symmetric about y = 0. The model holds the top cam and the top
  limb; the bottom half is their mirror image.
- The top cam turns by θ about its axle O. θ > 0 is a clockwise turn in the
  world frame (x right, y up); it pays out string and winds the power cable.
  The cam frame is fixed to the cam and equals the world frame at θ = 0:

  ```
  v_cam = R(θ)·v_world,   R(θ) = [[cos θ, −sin θ], [sin θ, cos θ]]
  ```

- Track angles ψ are cam-frame angles of the outward normal and are kept
  unwrapped, so they stay continuous when a contact passes ψ = 2π. A planar
  groove holds less than one turn of cord: a wrapped angle of 2π or more is
  reported as `wrap-overlap`.

| Symbol | Meaning |
|---|---|
| Q | limb pivot |
| O(α), A(α) | top axle, bottom axle |
| R_L | limb lever length, pivot to axle |
| β, β_b | limb lever angle against +x, counter-clockwise positive; at brace |
| α | limb rotation from brace, positive towards the bow centre |
| θ | cam rotation from brace, clockwise positive |
| p_s, p_c | support functions (lever arms) of the string and cable tracks |
| ψ_s, ψ_c | contact angles of string and cable, cam frame |
| ψ_e | termination angle of a cord on the cam, cam frame |
| σ | side of a cord: −1 for the string, +1 for the power cable |
| φ | string angle against the y axis |
| T_s, T_c | string and cable tension |
| E1(α) | energy of one limb |

## Bow geometry

The top limb is a rigid lever (pseudo-rigid-body model) of length R_L from
the pivot Q to the axle O. Drawing turns it by α towards the bow centre:

```
β(α)  = β_b − α
O(α)  = Q + R_L·(cos β, sin β)
O_α   = dO/dα = R_L·(sin β, −cos β)
A(α)  = (O_x, −O_y)                 bottom axle, anchor of the top power cable
A_α   = (O_α,x, −O_α,y)
```

The power cable of the top cam ends at a yoke on the bottom axle; the model
places the anchor at the axle centre.

Brace fixes Q. At brace the string is vertical at x = x_b and leaves the top
cam on its +x side, so the string contact normal is ψ = 0 and

```
O_b = (x_b − p_s(0), ATA/2)          ATA: axle-to-axle length
Q   = O_b − R_L·(cos β_b, sin β_b)
```

The free string span at brace is l_0 = O_y + p_s'(0); it must be positive.

## Support functions

Each track is a convex curve given by its support function p(ψ) on the cord
centreline (pitch line):

```
n = (cos ψ, sin ψ),  t = (−sin ψ, cos ψ)
tangent line   X·n = p(ψ)
contact point  X = p·n + p'·t,   |X| = √(p² + p'²)
dX/dψ = ρ·t,   ρ = p + p''       radius of curvature
P(ψ) = ∫ p dψ  from the reference angle of the shape
arc length from ψ_1 to ψ_2 = [P + p'] from ψ_1 to ψ_2
```

Shapes (`src/core/support.js`):

| Shape | p(ψ) | Reference angle |
|---|---|---|
| Eccentric circle: radius r, centre at distance e in direction `phase` | r + e·cos(ψ − phase), ρ = r | 0 |
| Ellipse: semi-axis a along `axisAngle`, b across, centre at distance e in direction `offsetAngle` | √(a²cos²u + b²sin²u) + e·cos(ψ − offsetAngle), u = ψ − axisAngle | 0 |
| Offset of a track by δ | p + δ, ρ + δ | as the base |
| C2 cubic spline through (ψ_i, p_i), periodic or open | piecewise cubic | ψ_0 |

- The ellipse integral P uses the incomplete elliptic integral of the second
  kind, a·E(u | m) with m = 1 − b²/a², computed with Carlson's symmetric
  integrals R_F and R_D (`src/core/elliptic.js`) to about 1e-15 relative.
  The ellipse has ρ = b²/a at the ends of the major axis. Both semi-axes
  must be finite and positive, so m < 1; `createSupport` rejects others.
  The elliptic functions accept m ≤ 1: at m = 1, where R_F and R_D diverge,
  they return E(1) = 1 and E(φ | 1) = sin(φ − kπ) + 2k directly.
- The spline integral P is the exact piecewise polynomial antiderivative. A
  periodic spline repeats with period ψ_n − ψ_0; an open spline continues its
  end pieces outside [ψ_0, ψ_n], which is its defined range.
- The project state describes the string track by its groove bottom. The
  pitch line is the groove bottom offset by half the string diameter,
  p_pitch = p_groove + d/2 (exact, because offsetting adds a constant to p).

### Free-form string track

A free-form string track (`src/core/freeform.js`) stores N groove-bottom
support values p_i at ψ_i = 2π·i/N, N from 8 to 16 (12 by default). The
groove bottom is the periodic C2 cubic spline through (ψ_i, p_i) with
period 2π; the pitch line is that spline offset by d/2, as for the other
shapes. The track closes by construction, and ρ = p + p'' is linear in the
values.

- Sensitivity: one value moves ρ at its knot by −15 mm per mm at N = 12
  and by −63 mm per mm at N = 24. N stops at 16 to keep single values
  usable.
- Sampling: switching the shape to free-form samples the eccentric or
  elliptical groove bottom (`sampleAnalytic`) at the smallest N from 12 to
  16 whose spline keeps the smallest groove ρ within max(1 mm, 10 %) of
  the exact one and p within 50 µm of the exact support (checked every
  0.5°), rounded to 0.1 µm; without such an N it takes 16 and the page
  says so. Every sample design takes 12. On the default eccentric track
  and the elliptical track of the hunting sample the spline stays within
  10 µm of p at N = 12 and 3 µm at N = 16, and within 1.1 mm of ρ at
  N = 12 and 0.6 mm at N = 16 (tested with 50 µm, 5 µm, 3 mm and 1 mm).
  Strong ellipses need more points: 50 mm by 35 mm with a 20 mm offset at
  57.3° takes 14 (12 points miss p by 62 µm); 60 mm by 25 mm (exact
  groove ρ_min 10.42 mm) misses at every N, with 9.27 mm and 62 µm at 12
  points and 9.23 mm and 55 µm at 16; 100 mm by 30 mm with a 10 mm offset
  bends at 9.00 mm exactly, at −14.62 mm on 12 points and at 6.94 mm on
  16.
- Solve effect of that sampling (full solves): default 98.19 → 98.19 mm
  cam, 3.71 → 3.71 N largest force difference; hunting 132.2 → 132.2 mm,
  5.53 → 5.53 N; light hunting 88.4 → 88.4 mm, 5.55 → 5.54 N; long draw
  120.3 → 120.3 mm, 6.62 → 6.62 N; youth 75.6 → 75.6 mm, 1.96 → 1.97 N;
  crossbow 86.0 → 86.0 mm, 11.87 → 11.89 N; mini 26.4 → 26.4 mm, 1.28 →
  1.28 N (tested within 0.1 mm and 0.05 N). The short-brace hunting
  sample is free-form already and resamples to the same values.
- Resampling to another N evaluates the spline at the new knots. The shape
  changes slightly: the default track at 8 points keeps p within 26 µm and
  ρ within 1.4 mm. A track at its limit can fall below it: an oval, rounded
  triangle or egg at its largest amount on 12 points bends below the limit
  on 8 points. `resampleChecked` reports that case.
- Limit: the pitch line must keep ρ ≥ ρ_lim = max(minimum bend radius,
  d/2 + 0.2 mm) (`rhoLimitFor`, the rule of `string-radius`), plus an
  optional margin, and every value must stay in 2 mm to 150 mm. The exact
  minimum of ρ comes from `minRho` (the cubic p + p'' minimised on every
  interval).
- Contact points of the knots, X(ψ_i) = p·n + p'·t, sit off the radial
  line by p' (up to 22 mm on the default track).

Shape modifiers add a harmonic term to the values of the current track:

| Modifier | Added to p | Change of ρ (exact) |
|---|---|---|
| Size | a | +a |
| Shift | a·cos(ψ − φ) | 0 (a translation) |
| Oval | a·cos 2(ψ − φ) | −3a·cos 2(ψ − φ) |
| Rounded triangle | a·cos 3(ψ − φ) | −8a·cos 3(ψ − φ) |
| Rounded square | a·cos 4(ψ − φ) | −15a·cos 4(ψ − φ) |
| Egg | a·(cos 2(ψ − φ) + 0.5·cos 3(ψ − φ)) | −a·(3·cos 2(ψ − φ) + 4·cos 3(ψ − φ)) |

- A cos ψ or sin ψ term adds nothing to ρ: a closed track has no first
  harmonic in ρ, so an egg built from cos ψ is only a shifted oval.
- Harmonic k needs N ≥ 4k points: the triangle and the egg raise N to 12,
  the square to 16, before the term is added. On the spline the drop of ρ
  is 0.9 to 1.3 times the exact value.
- `largestAmount` finds the largest amount that keeps the limit by
  bisection (1 µm) on the spline of the modified values, not on the exact
  formula: ρ is linear in the amount, so the amounts within the limit form
  one interval. The default amounts (1 mm, 0.5 mm for the square, scaled
  by the mean groove radius over 40 mm when that ratio is below 1) are
  clamped to it. On the default track with a 0.5 mm margin the largest
  amounts are about 12 mm (oval), 4 mm (triangle), 2.2 mm (square) and
  5 mm (egg).
- `presetRoom` tells the cases apart for the preset panel: the track
  (resampled to the points of the modifier) at least ρ_lim + margin, at
  least ρ_lim but inside the margin, or below ρ_lim; and what ends the
  largest amount (the bend with its margin, the value range, the bore
  clearance, or the 30 mm search limit). Size (ρ + a) on a track inside
  the margin or below the limit gets the smallest positive amount that
  restores ρ_lim + margin, by bisection upwards to 1 µm. Shift keeps ρ of
  the exact track, but on the spline its cos ψ term changes ρ by a small
  amount (a 1 mm Shift takes the default track dragged to the 5 mm limit
  from 5.0002 mm to about 4.977 mm), so Shift keeps the bend limit with
  its margin like the other modifiers, and in addition the bore clearance
  (the rule of `string-clearance`, 720 angles). When a track within the
  margin has no room for a shape modifier, the largest negative amount is
  reported instead.
- A modifier within the limit can still fail the solve. At angle 0 and the
  default amounts on the nine samples: the square on the hunting bow
  reports `closing-blend`, the square on the light hunting bow reports
  `cable-radius` and `cable-clearance` (its fitted cam lies 7.1 N from the
  target, over the 6.7 N tolerance), Size on the youth bow reports
  `cable-radius` and `cable-clearance`; the other 51 of the 54
  combinations solve without diagnostics or warnings.

A drag moves a raised-cosine bump: the value at index i by δ, its
neighbours by 0.75·δ and 0.25·δ. A single value would bend the track at
its knot. `dragLimit` finds the largest δ in a direction that keeps the
limit by bisection to 1 µm; along the bump the feasible set is one
interval, since ρ is linear in δ.

The editor (`src/ui/trackeditor.js`) rounds dragged values to 0.1 µm like
sampled ones. Rounding can move ρ by about a micrometre, and the solver
compares ρ with ρ_lim without tolerance, so a rounded track that misses the
limit steps back by 1 µm until it keeps it. A single keyboard step of one
value is refused when it takes a track within the limit past it. The
working arc is the range of the string contact angle ψ_s of the forward
model, from brace (ψ_s(x_b)) to full draw (ψ_s(x_f)); a knot angle on it,
taken one turn around, gives the nock position at which the string leaves
the track there, linear between the samples.

Convexity and bore clearance of a free-form track are solver diagnostics
(`string-radius`, `string-clearance`), not validation errors. Their limits
depend on the minimum bend radius, the string diameter, the bore and the
wall; a later edit of those must not make a saved design fail to load.
Validation checks the structure only: 8 to 16 finite values from 2 mm to
150 mm.

### Optimise search directions

Optimise (`src/core/optimise.js`) changes the values along Fourier modes,
not one value at a time. Mode k of amplitude δ (δ·cos kψ or δ·sin kψ in p)
changes ρ by (1 − k²)·δ·cos kψ (or sin kψ): the constant raises ρ by δ,
k = 1 moves the track without changing ρ, and higher modes bend it more.
The search scales the step of mode k by 1/max(1, k² − 1), so one step
changes ρ by about the same amount in every mode. A single value cannot
make a round track smaller: p(ψ) + p(ψ + π) is the width of the track in
direction ψ, and raising one value widens it on that side only. The
spline prescreen (value range, pitch-line ρ ≥ ρ_lim + max(1 mm, 10 %),
groove clearance to the bore) rejects a candidate before the solve.

## Cord contact and length

A cord wraps a track and leaves it tangentially towards a point B in the cam
frame. The contact angle ψ_c solves

```
f(ψ) = B·n(ψ) − p(ψ) = 0,   f' = B·t − p'
branch:  σ·(B·t − p') > 0
free span  l = σ·(B·t − p'),  unit vector from contact to B  u = σ·t
```

The side σ selects the tangent: the string wraps [ψ_c, ψ_e] and leaves along
−t (σ = −1); the power cable wraps [ψ_e, ψ_c] and leaves along +t (σ = +1).
ψ_e is the termination (the end of the cord on the cam), fixed in the cam
frame. The wrapped angle σ·(ψ_c − ψ_e) must be non-negative.

Cord length from the termination to B:

```
L = σ·[B·t(ψ_c) + P(ψ_c)] + C
cable  (σ = +1):  C = −p'(ψ_e) − P(ψ_e)
string (σ = −1):  C = P(ψ_e) + p'(ψ_e)
```

Derivation for the cable: the wrapped arc is [P + p'] from ψ_e to ψ_c and
the free span is B·t − p'(ψ_c). Their sum is B·t + P(ψ_c) − p'(ψ_e) − P(ψ_e);
the p'(ψ_c) terms cancel. The string follows with the arc from ψ_c to ψ_e
and the span p'(ψ_c) − B·t.

Because f = 0 at the contact, ∂L/∂ψ_c = σ·(p − B·n) = 0 (envelope
property). Hence

```
∂L/∂B = σ·t = u
∂L/∂θ = σ·p        (B_cam = R(θ)·B_world, dB_cam/dθ = J·B_cam, Jᵀ·t = n)
```

The contact solver (`src/core/contact.js`) runs Newton on f from a warm start
ψ_w (the previous contact), with steps limited to 0.5 rad and the branch
checked at every step. When Newton leaves the branch, stalls or moves more
than half a turn from ψ_w, a scan of 96 points over [ψ_w − π, ψ_w + π]
brackets the root of the branch nearest to ψ_w and a safeguarded
Newton–bisection finishes it. When no sign change exists on the scan, a
golden-section search refines the largest f over the two grid cells next to
the largest grid value, including the cell beyond the window end when that
value sits at an end; f ≤ 0 everywhere means that B lies inside the track
(status `inside`). Serialized track data is checked when it is loaded:
finite values, increasing spline knots, C2 continuity of the spline
coefficients (value, first and second derivative at each join, each to
1e-9 of the largest magnitude of that same quantity at any knot), and
spline integrals recomputed from the coefficients. An
ellipse stored with a < b is turned into the form a ≥ b (axis angle + 90°),
which the curvature minimum b²/a assumes (the axis turns by 90° towards
0), and its axis angle is reduced
modulo π to [−π/2, π/2], which keeps the arc integral
P = a·(E(ψ − θ) − E(−θ)) free of cancellation between large integrals. A point on the track has no free span: a largest f below
256·ε·max(|B|, |p|) or a free span below √(256·ε)·max(|B|, |p|) (ε the
machine epsilon, 2.2e-16) also gives `inside`, so rounding noise never makes a
tangent from a point on the track. The golden-section search stops at an interval of 1e-12
relative to |ψ| or after 100 steps, so it also ends at warm starts of
thousands of radians. The solver never throws.

The length identity is used to evaluate lengths and to check the forward
model. It is never used to march an unknown contact angle: marching with it
amplifies length errors by about 2/(l·Δψ).

## Constraints and projection partials

With B_s = R(θ)·(N − O) for the string and B_c = R(θ)·(A − O) for the cable:

```
g_s(x, θ, α) = L_s / 2          string half-length, nock to termination
g_c(θ, α)    = L_c              power cable length
```

The partial derivatives follow from ∂L/∂B = u and ∂L/∂θ = σ·p:

```
∂g_s/∂θ = −p_s      ∂g_s/∂x = sin φ = u_s·(1, 0)
∂g_s/∂α = −s_a,     s_a = u_s·O_α
∂g_c/∂θ = +p_c      ∂g_c/∂α = −c_a,   c_a = u_c·(O_α − A_α)
```

u_s is the world unit vector from the string contact to the nock,
u_s = (sin φ, −cos φ); u_c is the world unit vector from the cable contact to
the anchor. s_a and c_a are the lengths by which one radian of limb rotation
shortens the string half and the cable.

## Forward model

`solveForward` in `src/core/forward.js` computes the draw force curve of a
given string track, cable track and limb.

1. Brace: θ = 0 and α = 0 by definition. The contacts at brace give the
   constant lengths L_s/2 and L_c (only differences of lengths enter the
   closure, so the terminations only add constants).
2. Grid: nock positions x − x_b = s² with s uniform, which puts more samples
   near brace; 1500 samples by default, 100 for a coarse solve, or an
   explicit increasing list of positions between x_b and x_f. The solve
   always starts at brace: an explicit list that starts later gets x_b
   prepended, so every check also covers the brace state.
3. Closure at each x: Newton on (θ, α) with

   ```
   J = [[−p_s, −s_a], [p_c, −c_a]],   det = p_s·c_a + s_a·p_c
   Δθ = (c_a·r_s − s_a·r_c) / det,    Δα = (p_c·r_s + p_s·r_c) / det
   ```

   where r_s = g_s − L_s/2 and r_c = g_c − L_c. The partials are exact at the
   current iterate (envelope property), so the convergence is quadratic.
   Warm start: previous sample plus the tangent step. Steps are limited to
   0.5 rad in θ and 0.1 rad in α. Newton stops at a residual of 1e-15 m, or
   when the residual is below 1e-10 m and no longer halves per iteration
   (rounding floor); a sample with a residual above 1e-10 m after 30
   iterations fails.
4. Path tangent: J·[θ', α'] = [−sin φ, 0], so

   ```
   θ' = c_a·sin φ / det,   α' = p_c·sin φ / det
   ```

5. Force and tensions:

   ```
   F   = 2·E1'(α)·α'                   virtual work, both limbs
   T_s = E1'(α)·p_c / det              = F / (2·sin φ)
   T_c = E1'(α)·p_s / det              = T_s·p_s / p_c
   ```

   These tensions satisfy the limb balance E1'(α) = T_s·s_a + T_c·c_a by
   construction, so the solver reports no residual of it; the tests check
   the tensions against a free-body balance built from positions (see
   Verification). The tension formulas avoid the division by sin φ, so they
   also hold at brace, where they give the brace equilibrium:

   ```
   T_s0·p_s = T_c0·p_c          cam moment balance
   E1'(0)   = T_s0·s_a + T_c0·c_a   limb moment balance
   ```

The result holds Float64Arrays of x, F, θ, α, T_s, T_c, φ, ψ_s, ψ_c, p_s,
p_c, s_a, c_a, free spans, axle position, dθ/dx, dα/dx and the closure
residual; the brace state; the cord lengths L_s = 2·g_s and L_c; the draw
energy 2·(E1(α_f) − E1(0)), the limb energy at full draw 2·E1(α_f) and the
preload energy 2·E1(0). Draw and limb energy are NaN when a sample fails or
the grid does not end at x_f. All of it survives structured cloning, so it
can move between a worker and the page.

Default terminations: the cable ends 30° before its smallest contact angle,
which is the brace contact when the cam turns forwards (lead-in wrap); the
string ends 30° beyond its largest contact angle (residual wrap). The
extremes are taken over the solved samples, which cover the whole draw on
the default grid. The terminations shift the reported lengths and set the
wrapped angles that `wrap-exhausted` and `wrap-overlap` check.

### Brace behaviour

- F(x_b) = 0 because sin φ = 0.
- θ'(x_b) = α'(x_b) = 0, so the axle, the anchor and the cable contact angle
  do not move to first order. The string contact angle does: ψ_s = θ + φ
  gives dψ_s/dx = φ'(x_b). The contact point moves by dX = ρ·t·dψ_s, along
  the string line, which does not turn the string; only the nock, moving
  across the string at the distance l_0, turns it, so φ'(x_b) = 1/l_0 and
  F = 2·T_s·sin φ gives F'(x_b) = 2·T_s0 / l_0.
- F''(x_b) depends on the geometry, the preload, p_c(ψ_c0) and the string
  track near ψ = 0 (p_s, p_s' and ρ_s there), but not on p_c'(ψ_c0): the
  cable contact angle does not move to first order at brace, so p_c' enters
  F only from the third derivative on.

## Limb model

`src/core/limb.js`. The limb rotation from unstrung is q = α + α_0, where
α_0 > 0 is the rotation from unstrung to brace. E1 is the energy of one
limb.

- Linear limb: E1(α) = ½·k_t·(α + α_0)², k_t = k·R_L² with the stiffness k
  at the axle perpendicular to the lever (N/m), and α_0 = s_0 / R_L with the
  preload travel s_0 of the axle from unstrung to brace. In axle terms
  E1 = ½·k·(s + s_0)² with the arc travel s = R_L·α.
- Tabulated limb: moments M(q_i) against the rotation from unstrung, fitted
  by the C2 shape-preserving quintic of `src/core/interp.js`; E1 is its exact
  integral. The point (0, 0) is added when the table starts after q = 0; a
  row at q = 0 must have M = 0, because q = 0 is the unstrung limb.
  Outside the table the moment continues linearly with the end slope. When
  the last row falls, that line reaches M = 0 at q_peak, where E1 is
  largest. The project table (axle travel from brace, force at the axle)
  converts with q = (travel + s_0)/R_L and M = force·R_L; travel and force
  are at least 0. Serialized table data is rebuilt from its knots and
  values, so these invariants hold for every table limb. The draw energy
  E1(α_f) − E1(0) is computed directly (½·k_t·α_f·(α_f + 2·α_0) for the
  linear limb), not as a difference of the preload-scale totals. A table
  limb integrates M from α_0 piece by piece (end line, table, end line).
  The piece that starts at α_0 takes its length directly: beyond the table
  the end line over α, inside it the Taylor expansion of the quintic about
  α_0 over α. A preload far larger than α_f, or an α_f below the
  floating-point spacing at α_0, keeps the draw energy.
- Travel mode: the stiffness that stores the draw energy W over the axle
  travel s_f from brace to full draw is k = W / ((s_f + s_0)² − s_0²),
  evaluated as W / (s_f·(s_f + 2·s_0)) without subtracting the squares.
- E1', E1'' and the inverse E1⁻¹ are available for the inverse model. The
  linear limb has the closed form α = √2·√E/√k_t − α_0. A tabulated limb
  uses Newton inside the bracket [0, q_n] for energies up to the table
  total (residual below 1e-9 J), and beyond the table the root of the end
  line, u = 2·ΔE/(v + √(v² + 2·s·ΔE)) with u = q − q_n. With a falling end
  slope E1 peaks at q_peak; an energy above E1 there has no inverse and
  gives NaN, as do a
  negative or non-finite energy. Every limb method returns NaN for a NaN
  argument instead of throwing.

## Input domain

The core accepts values inside the ranges below (`src/core/domain.js`)
and returns `invalid-input` for anything else. The ranges cover every bow
by several orders of magnitude. Inside them no intermediate quantity comes
near the floating-point limits of about 1e±308.

| Quantity | Range |
| --- | --- |
| ATA, brace height, draw length, limb lever length | 1e-6 m to 10 m |
| Limb angle at brace | −2π to 2π rad |
| Eccentric circle radius | 0 to 10 m (0 is a point) |
| Ellipse semi-axes | 1e-6 m to 10 m |
| Track offsets (eccentric, ellipse centre, groove offset) | −10 m to 10 m |
| Spline track \|p\| and \|p′\| on every interval (ends and interior extrema) | at most 10 m |
| Spline track \|p″\| on every interval | at most 1e6 m |
| Track angles (phase, axis and offset angles, spline knots) and cord terminations | −1e4 to 1e4 rad |
| Limb preload rotation α_0 and limb table rotations | 0 to 2π rad |
| Spacing of limb table rotations, and a first row after 0 | at least 1e-6 rad |
| Limb table rows | 2 to 1000 |
| Spline track intervals | at most 100000 |
| Spacing of spline track knots | at least 1e-6 rad |
| Torsional limb stiffness k_t | 1e-6 to 1e9 N·m/rad |
| Limb table moments | 0 to 1e7 N·m |
| Limb preload travel, table travel, limb travel | 0 to 10 m (travel mode: at least 1e-6 m) |
| Draw energy for the travel mode | above 0, at most 1e7 J |

## Inverse model

`src/core/inverse.js` computes the power-cable track that makes a given
string track and limb follow a target force curve F(x). Each nock position
is solved on its own; the previous sample only supplies a warm start.

1. Work of the target: W(x) = ∫ F dx from x_b, the exact integral of the
   interpolant.
2. Limb rotation from the energy balance of both limbs:
   α(x) = E1⁻¹(E1(0) + W/2).
3. Cam rotation from the string closure g_s(x, θ, α(x)) = L_s/2 by Newton
   in θ with ∂g_s/∂θ = −p_s, the stopping rules of the forward model and a
   warm start from the previous sample plus θ'·Δx.
4. String tension T_s = F / (2·sin φ); within 1e-9 m of x_b (the
   tolerance of the brace point in validation) the brace value
   T_s0 = F'(x_b)·l_0/2 and θ = α = 0.
5. Cable lever arm from the cam balance T_s·p_s = T_c·p_c and the limb
   balance E1'(α) = T_s·s_a + T_c·c_a:

   ```
   p_c = p_s·c_a·T_s / (E1'(α) − T_s·s_a)
   ```

   The anchor A lies straight below the axle at the distance D = 2·O_y, so
   the cable line through A at the distance p_c from O has the world normal
   angle π + asin(p_c/D) (tangent on the −x side of the axle), and
   c_a = u_c·(O_α − A_α) = V·√(1 − (p_c/D)²) with V = 2·R_L·cos β. With
   K = p_s·T_s·V / (E1' − T_s·s_a) the lever arm follows in closed form,

   ```
   p_c = K·D / √(D² + K²)
   ψ_c = π + asin(p_c/D) + θ            cam frame
   T_c = (E1' − T_s·s_a) / c_a = T_s·p_s / p_c
   ```

   This is the fixed point of the iteration on the cable direction; no
   iteration is needed. The sign of E1' − T_s·s_a is the sign of p_c and
   T_c: a string tension that the limb moment cannot hold makes the cable
   push.
6. Path derivatives: α' = F / (2·E1'), θ' = (sin φ − s_a·α') / p_s. The
   kinematic identity p_c = c_a·dα/dθ follows from the cable closure and
   is checked in the tests.

### Brace conditions

At brace F = 0 and sin φ = 0. The slope of the target sets the brace string
tension, T_s0 = F'(x_b)·l_0/2, and with it p_c0 = p_s0·c_a0·T_s0 /
(M_b − T_s0·s_a0), M_b = E1'(0). A cam exists only for
0 < T_s0 < M_b/s_a0 (s_a0 = R_L·cos β_b), that is
0 < F'(x_b) < 2·M_b/(s_a0·l_0). Towards the upper limit K grows without
bound, p_c0 = K·D/√(D² + K²) tends to the axle distance D = 2·O_y from below
and c_a0 tends to 0.

The second derivative of the force at brace follows from the second-order
expansion of the string closure G = (x − O_x)·cos φ − O_y·sin φ − p_s(φ + θ)
= 0 with θ' = α' = 0 at brace: φ' = 1/l_0 and

```
φ''  = −(ρ_s0/l_0 + K_1) / l_0²
K_1  = (p_s'(0)·c_a0 + R_L·sin β_b·p_c0) / det_0,   det_0 = p_s0·c_a0 + s_a0·p_c0
```

and from F = 2·E1'(α)·α', α' = (p_c/det)·sin φ, where at brace
F'' = 2·M_b·α''' with α''' = 2·(p_c/det)'·φ' + (p_c/det)·φ'' and
det' = K_1·det_0/l_0 (c_a and p_c do not change to first order). Hence

```
F''(x_b) = −(2·T_s0 / l_0²)·(3·K_1 + ρ_s0/l_0)
```

It depends on p_c0, the string track at ψ = 0 (p_s, p_s', ρ_s) and the
geometry, but not on p_c'. The solver takes F'(x_b) as the natural end
slope of the user's curve and rebuilds the curve with
`createCurve(points, { startSlope, startSecondDerivative })`, so the first
segment matches both; `shapePreserved` of the rebuilt curve is reported.
The formula agrees with a degree-7 fit of the forward model at
x_b + k·1 mm to 1e-8 relative (tested; measured 4.7e-10 for the twin cam
and 2.3e-9 for a cable circle of radius p_c0), which is the accuracy of the
fit.

### Brace blend

Near brace the cam turns slowly: θ and ψ_c − ψ_c0 grow like (x − x_b)².
A cable track that is smooth in ψ therefore needs matching derivatives of
F at brace beyond the second: F''' sets p_c'(ψ_c0), and F'''' is again fixed
by the geometry. A target whose F'''' differs gives p_c(ψ) a term in
(ψ − ψ_c0)^(3/2) with an unbounded p_c'' and a radius of curvature that is
negative over the first degrees of the track. The quintic first segment of
the interpolant does not match F''''.

The solver therefore replaces the ideal cable track over the first curve
segment [x_b, x_1] (x_1: point 2 of the curve) by a brace blend on
[ψ_c0, ψ_1]: the quintic in ψ with

- p(ψ_c0) = p_c0, which keeps the brace tension and F'(x_b);
- p, p' and p'' of the ideal track at ψ_1 (a C2 join);
- ∫ p dψ over [ψ_c0, ψ_1] = √(D_0² − p_c0²) − √(D_1² − p_1²),

and among these the one with the smallest ∫ (p''')² dψ. The last condition
is the cable closure between brace and x_1: the reduced cable length is
B·t + P(ψ_c) with B·t = √(D² − p_c²) for the tangent line through the
anchor (the sample field `anchorReach`; the free span is B·t − p_c'(ψ_c)).
With it the cam reaches the target state (θ_1, α_1) at x_1, so the
achieved curve equals the target from x_1 on and has the target's work
W(x_1); on [x_b, x_1] it follows the cam, with F, F' and F'' of the target
at both ends. "Equals" holds to the accuracy of the spline through the
resampled track: on a test cam that the solver builds without the fit
(verification table), the achieved force differs from the target by at
most 1.3e-7 N (full) and 3.8e-7 N (coarse) from x_1 on, and by 0.006 N
inside [x_b, x_1].

### Sampling the ideal cable track

The inverse model runs on the draw grid x − x_b = s² (100 samples for a
coarse solve, 600 for a full solve) plus every curve point. From x_1 to x_f
the contact angle ψ_c(x) must increase, and the brace blend needs
ψ_1 > ψ_c0; inside [x_b, x_1] the blend replaces the samples, so ψ_c may
fall there. Cable samples near a uniform grid of 0.5° (coarse) or 0.25°
(full) come from the Illinois variant of regula falsi in x inside the
bracket of two grid samples, stopped within 0.1 % of the step; the pair
(ψ_c(x), p_c(x)) at the found x is an exact point of the ideal track, so
the search tolerance adds no error. An open C2 cubic spline through these
points, clamped with the slopes of the quartic through the five end
points, is the ideal track on [ψ_1, ψ_cf].

## Constrained fit

`src/core/fit.js` fits a clamped C2 cubic spline p(ψ) on uniform knots over
[ψ_c0, ψ_cf] (one interval per about 10°, 17 to 37 intervals, so 20 to 40
unknowns: the knot values and the two end slopes) to samples of the ideal
track by least squares, subject to linear constraints on a grid of eight
points per knot interval:

```
p + p'' ≥ ρ_lim = max(minimum bend radius, d/2 + 0.2 mm)
p       ≥ p_min = bore/2 + minimum wall + d/2
```

p_min keeps the groove bottom of a convex track outside the bore and its
wall: the closest point of a convex curve around the axle lies at the
distance min p. The grid constraints carry a margin of 5 µm. After each
solve the exact minima of p and ρ on every knot interval (both are cubics
there) are checked; any that falls more than 1e-9 m below its limit
becomes a further constraint and the programme is solved again, at most
10 times, so the limits hold between the grid points too. A margin of
1 µm leaves the spline up to 3.5 µm below p_min between two grid points
near full draw of the default preset; with 5 µm none of 62 fits of the
default and its edits needs a further round. Optional equalities: p(ψ_c0) = p_c0 and, at the contact
angle ψ_k of every curve point k whose ideal lever arm meets p_min,

```
p(ψ_k) = p_k,   ∫ p dψ from ψ_c0 to ψ_k = √(D_0² − p_c0²) − √(D_k² − p_k²)
```

With them the cam reaches the target state of each such point exactly: the
achieved force and draw energy equal the target there. The solver builds
two candidates:

1. Through the curve points: the brace value and the point equalities.
   Points close to brace often need a lever arm that bends the wrong way;
   while the programme has no solution, the point nearest to brace is
   dropped.
2. Plain: the brace value only (no equality at all if even that has no
   solution).

Each candidate is closed (see below) and run through the forward model; the
one whose achieved force differs least from the target (largest difference
over the draw) is kept, a candidate with a valid closing blend before one
without. The brace value keeps T_s0, so both candidates have the brace
slope of the target. A penalty of 1e-8 times the trace of BᵀB on the second
differences of the knot values keeps the problem strictly convex where the
samples are sparse. Lengths are scaled to mm inside the fit.

The quadratic programme is solved by the dual active-set method of Goldfarb
and Idnani (`src/core/qp.js`): start at the unconstrained minimum, add the
most violated constraint, drop active constraints whose multipliers would
turn negative. With the active normals N, W = G⁻¹·N and M = Nᵀ·G⁻¹·N the
primal step is z = G⁻¹·n⁺ − W·M⁻¹·Wᵀ·n⁺ and the dual step r = M⁻¹·Wᵀ·n⁺; M
is refactored by Cholesky after each change. Equality constraints enter
first and keep multipliers of either sign.

In the fit programmes the rows have very different scales. At the final
active sets of 100 random near-default states the condition number of M,
estimated from the diagonal of its Cholesky factor, has a median of 1.1e6
and reaches 9.7e13; with M scaled to a unit diagonal, the median is 110
and the largest 6.4e7. The smallest sine of the angle between two active
normals is 0.028 on the 600 states below. Three rules keep rounding from
turning into large steps:

- Linear dependence. With n active constraints every normal is a
  combination of theirs. Below n, z vanishes in exact arithmetic when n⁺ is
  a combination of the active normals, and rounding leaves
  |z|_G = √(zᵀ·G·z) of the order of the machine precision times the terms
  that cancel, √(n⁺ᵀ·G⁻¹·n⁺) + Σ|r_k|·√M_kk. The constraint counts as
  dependent when |z|_G is at most 1e-8 of that sum. A dependent constraint
  takes no primal step: an active inequality is dropped, or the programme
  is infeasible. At most n constraints are active.
- Redundant equalities. A dependent equality n_p = Σ r_k·n_k that holds
  within the tolerance (1e-10) times s_p + Σ|r_k|·s_k, with the row scales
  s = max(|b|, |c_j|), stays inactive with multiplier 0. One that does not
  hold makes the programme infeasible. A nearly dependent equality moves
  off when a later inequality moves x, so it is checked again at the end
  (below): x = 0 and x + 1e-9·y = 0 hold within 1e-10 at y = 0.1 and
  contradict y ≥ 100, where the second misses by 1e-7.
- Iterative refinement. After each added constraint, a pass moves x by
  W·M⁻¹·e and the multipliers by M⁻¹·e, with the residuals e of the active
  constraints, so G·x + a = N·u still holds. Passes repeat while the
  largest active residual, relative to the size t_i of its row (below),
  falls or stays above 4 machine epsilons (8.9e-16), at most 8 passes. A
  pass that would turn an inequality multiplier negative is skipped and
  ends the refinement. With nearly parallel active normals M is nearly
  singular: a pass then removes only part of the residual, and the
  residual can rise for a pass before it falls again.

The result is optimal only when every active constraint holds within the
tolerance times its size t_i = max(s_i, |b_i| + Σ|c_ij·x_j|), and every
redundant equality within the tolerance times t_p + Σ|r_k|·t_k over the
rows it combines. Otherwise the status is `infeasible`. An active
constraint outside its bound means that rounding in this solver has moved
x off it, typically with nearly parallel active normals (Reliability,
below). A redundant equality outside its bound was only nearly dependent.
The combined bound keeps an exact combination of large rows: with rows
(3e8, 2), (−3e8, 5) and their sum (0, 7), rounding leaves the sum 4.7e-6
off, within 1e-10 of the sizes of the combined rows (6e8 each) and outside
1e-10 of its own size 14.

Reliability. The solver is reliable when the active normals differ in
direction by well over 1e-6 (sine of the angle between them), as in the
fit programmes: there the active residuals end within 6.5e-16 of their
size. Two failures remain for normals 1e-8 to 1e-6 apart, where x is
uncertain along the nearly shared direction: a feasible programme
reported `infeasible`, and an `optimal` result with a redundant equality
off. Random problems measure them: 1 to 5 unknowns and up to 11 rows,
drawn as random rows, multiples and combinations of earlier rows, and
rows that change each coefficient of an earlier row by up to 5e-7 of its
size (nearly parallel); 60 % of the problems pass through a known point
(feasible), the others have arbitrary right-hand sides. Over 400,000
problems (eight seeds of the unit test's generator), by the smallest sine
between two rows; the first row counts every feasible problem without
nearly parallel rows, the others the feasible problems with two or more
unknowns:

| Smallest sine between two rows | Feasible problems | Reported `infeasible` | `optimal` with a redundant equality off by more than 1e-8 of its size |
|---|---|---|---|
| no nearly parallel rows | 156,364 | 0 | 0 |
| 1e-7 to 1e-6 | 43,625 | 1748 (4.0 %) | 6, off by up to 5.6e-5 |
| 1e-8 to 1e-7 | 20,429 | 2741 (13 %) | 38, off by up to 1.1e-2 |
| below 1e-8 | 2998 | 660 (22 %) | 3, off by up to 3.9e-5 |

The 16,920 feasible problems with one unknown and nearly parallel rows
show neither failure. Two refinement passes per added constraint, a fixed
count, give 7219 `infeasible` and 264 such `optimal` results (171 off by
more than 1e-6, up to 4.1e-3) on the same problems. The combination
coefficients of an equality that comes back off reach 4e5 to 7e7, and its
bound tolerance·(t_p + Σ|r_k|·t_k) grows with them to 1e-4 to 8e-2 of its
size. 4 of the 400,000 problems, all with arbitrary right-hand sides, end
at the iteration limit.

On 600 random near-default states (edits of peak, let-off, rise and
valley, of the point forces by ±15 %, or of the limb to 2 N/mm to 4 N/mm
with 100 mm to 250 mm preload; coarse or full) `solve` builds 7486 fit
programmes. The 2937 that end `optimal` meet every constraint to 1.0e-10
of its row scale and their active constraints to 6.5e-16 of their size.
`solveQP` returns `invalid` for sizes that do not match, meq outside 0 to
m, a non-finite entry or options out of range, and `fitCableTrack` returns
`invalid` for non-finite or out-of-range input (limits in the table of
numerical settings), including a point to pass through with its angle
outside (ψ_c0, ψ_cf] or a non-finite lever arm or integral, instead of
throwing. Non-finite samples of the ideal track are left out of the least
squares.

The solver fits when the ideal track violates ρ_lim or p_min, when its
contact angle does not increase, or when it cannot be sampled. It also fits
when the ideal track passes its sampled checks (every 0.1°) but the exact
periodic spline of its closed track dips below a limit between the
samples: the fitted candidates then join the comparison, and one that
closes wins (a 9.850 mm limit on the known-circle test cam: the samples keep
9.851 mm, the closed spline reaches 9.849 mm). It then runs
the forward model on the fitted cam and compares the achieved curve with
the target. A fitted cam whose force differs from the target by at most
3 % of the peak (8.0 N at 267 N, at least 2 N) everywhere and whose draw
energy is within 0.5 % meets the target: the violations of the ideal track
are listed in `fit.idealIssues` and cause no diagnostic. The ideal track
bends the wrong way at the corners of the target (peak start and end,
let-off transition), and a convex cam rounds them: on the default preset
the difference stays at 3.7 N to 3.9 N for 22 to 90 spline intervals, so
the tolerance covers this rounding. On 45 edits of the default (peak
250 N to 290 N, rise 43 % to 50 %, valley 1.0 in to 1.5 in) the draw
energy of the fitted cam differs from the target by at most 0.14 J, below
the energy tolerance of at least 0.42 J. A larger difference is reported
as `cable-radius` or `cable-clearance`, with the largest force
difference, the tolerance, the differences in peak (N), let-off
(percentage points) and draw energy (J), and the draw position of the
largest difference with the curve points on either side.

## Closed cam outline

`src/core/outline.js` closes the active cable track [ψ_c0, ψ_cf]. A fit
without the brace value p(ψ_c0) = p_c0 (p_c0 below p_min, or no solution
with it) has its brace contact, the tangent point from the anchor at
θ = 0, after ψ_c0: 0.47° for a 10 mm wall and point 2 at 60 N. The solver
then starts the active track at that contact, so ψ_c0 below stands for
the brace contact of the built cam and the cable wraps exactly the lead-in
wrap at brace.

- Lead-in on [ψ_c0 − lead-in wrap, ψ_c0]. Its radius of curvature settles
  to ρ_0 = clamp(ρ(ψ_c0), ρ_lim, p(ψ_c0)). With u = ψ_c0 − ψ and
  λ = 0.5°:

  ```text
  ρ(u) = ρ_0 + (ρ(ψ_c0) − ρ_0)·(1 + u/λ)·e^(−u/λ)
  ```

  p solves p'' + p = ρ from p(ψ_c0) and p'(ψ_c0) in closed form:
  p = ρ_0 + A·cos u − B·sin u + (ρ(ψ_c0) − ρ_0)·h(u) with A = p(ψ_c0) − ρ_0,
  B = p'(ψ_c0) and h = (α + β·u)·e^(−u/λ) − α·cos u + (α/λ − β)·sin u,
  α = (1 + 3/λ²)/(1 + 1/λ²)², β = (1/λ)/(1 + 1/λ²). At ψ_c0, ρ = ρ(ψ_c0),
  so p, p' and p'' are continuous. ρ lies between ρ(ψ_c0) and ρ_0; the
  factor (1 + u/λ)·e^(−u/λ) is 4e-8 at 10° and 3e-12 at 15°. The settling
  moves the lead-in by at most 2λ·|ρ(ψ_c0) − ρ_0| from the arc of radius
  ρ_0: 5.9 mm for a change in ρ of 340 mm.
- The upper bound p(ψ_c0) keeps the lead-in from swinging outwards. A fit
  that flattens the brace region has ρ(ψ_c0) of 260 mm to 830 mm; a lead-in
  of that radius makes the cam 205 mm to 451 mm across, and the closing
  blend fails. With the bound the same states give 113 mm to 144 mm and
  close. The cable contact never runs on the lead-in (the smallest contact
  angle of the forward model is the brace contact), so the lead-in changes
  the cable length, not the force curve.
- The lead-in settles over λ instead of starting at ρ_0 because the
  periodic spline cannot follow a jump of p'': at a knot it dips about 13 %
  of the jump, (2 − √3)/2, below ρ_0. For ρ(ψ_c0) = 390 mm and
  ρ_0 = 50 mm that is a dip to 5 mm; smaller ρ_0 gives a concave dent. The
  cable post sits at the start of the lead-in, the cable termination.
- Closing blend from ψ_cf to ψ_c0 − lead-in + 2π: the quintic Hermite piece
  that matches p, p', p'' at both joins. When it bends below ρ_lim or comes
  below p_min, the constrained fit replaces it: a clamped spline close to
  the quintic with p, p', p'' prescribed at both joins and the two limits
  as constraints. The closed track re-interpolates the lead-in, the active
  track and the blend as one periodic spline; it counts as closed only when
  the exact minima of its p and ρ on every interval meet p_min and ρ_lim to
  1e-7 m (on the default preset and 8 edits they clear both by 0.1 µm to
  1 µm). When no such track exists the solver reports `closing-blend`. It
  also reports `closing-blend` when the arc left for the blend is too short
  for any closing curve: the closed track then leaves the input domain
  (on the default preset a lead-in wrap of 137.55° leaves 0.06°), and the
  result has the string outlines only. The suggestion names the largest lead-in wrap k·5°
  below the input, down to 0°, that closes the track; the lead-in does not
  change the active track, so closing it is the whole check.
- When no lead-in wrap closes the track, a full solve runs trial solves:
  coarse, without trials of their own, and stopped at their first
  diagnostic, except for the string wrap and the limb rotation of the
  ideal track, which the final cam's checks replace; a trial passes
  exactly when a coarse solve of the same state reports no diagnostic. It
  tries the string track radius (both semi-axes of an
  ellipse) 5, 10, 15 and 20 mm larger, then half the minimum bend radius
  when that radius sets ρ_lim and the blend bends too sharply. The
  suggestion names the first change whose trial reports no diagnostic,
  with its value; otherwise it lists what was tried and names the force
  curve. A coarse solve runs while an input is dragged; it runs no trials
  and names the force curve. A larger string track turns the cam less
  over the draw and leaves a longer arc for the blend, but it also changes
  the ideal cable track, so a track that closes is not enough. On the 76
  placements of point 2 of the default (9 in to 15 in, 30 N to 200 N)
  whose full solve no lead-in wrap closes, a radius 5 mm or 10 mm larger
  closes the track in 49 and raises the largest force difference of the
  fitted cam in 71 (coarse solves, as in the trials). The trials name a
  radius in 30 of them, and a full solve with it reports no diagnostic in
  all 30. In the other 46 (23 with `cable-fold`, 13 with `cable-radius`
  and `cable-clearance`, 10 with `closing-blend` alone) no trial passes.
  With a 20 mm minimum bend radius and a lead-in wrap of 5° or 10°, no
  larger string track passes and a 10 mm bend radius does. The trials
  take 107 ms to 112 ms median and at most 490 ms on these states (Node 22,
  4-core 2.1 GHz Xeon); the coarse solve of the same states takes 82 ms to
  85 ms median and at most 127 ms. A solve without `closing-blend`, or
  with a lead-in wrap that closes the track, runs none.
- The closed track is stored as a periodic C2 cubic spline through samples
  of the pieces at a spacing of at most 0.25° (full) or 0.5° (coarse); the
  knots of spline pieces are kept. A knot closer than 1e-3 of the spacing
  to the previous one is left out (a lead-in wrap of 0 or near 0), so no
  interval is near zero and rounding does not spike p''. A periodic p with
  p + p'' > 0 is a closed convex curve.

The string track is the closed parametric track of the project; the string
post sits at its termination, the full-draw contact angle plus the residual
wrap. For a fitted cam the achieved full-draw contact replaces the ideal
one (0.1° earlier for peak 250 N, rise 49 % and valley width 1.4 in), so
the residual wrap holds at the achieved full draw; the contact angles do
not depend on the termination, and a second forward solve gives the string
length and the wrap checks. The reported full-draw cable contact is the
one of the final cam as well; the end of the active track, where the
closing blend starts, is reported separately (0.021° apart on the default
preset).

- Groove bottom and flange edge: parallel curves of the pitch line,
  p − d/2 and p − d/2 + groove depth.
- Termination posts: the cord's pitch line is tangent to the post, so the
  centre lies on the inner normal at the termination angle, at the post
  radius plus d/2 from the pitch line.
- Cable stop post: a peg of the post diameter touching the cable free span
  at full draw. Its centre lies at the peg radius plus the cable radius from
  the full-draw cable line on the axle side, at the smallest distance along
  the span from the contact where it clears the cable groove bottom by the
  peg radius (distance of a point from a convex region: the largest
  C·n(ψ) − p(ψ) over ψ).
- Timing marks: the string exit at brace (ψ = 0 on the string track), the
  cable exit at brace (the brace contact of the forward model of the built
  cam) and the full-draw index (the string exit at full draw), each as the
  pitch point and the outward normal in the cam frame.
- Sampled outlines: pitch, groove bottom and flange of both tracks, 360
  (coarse) or 720 (full) intervals over one turn, last point equal to the
  first.
- Cam maximum dimension: the largest width of the union of the two flange
  outlines, max over ψ of h(ψ) + h(ψ + π) with h the larger of the two
  flange supports.

## Solve

`solve(state, { resolution })` in `src/core/solve.js` builds everything from
the project state and returns plain data (structured-cloneable):

1. Validation (`invalid-input` on failure); the first and last curve
   point are placed exactly at x_b and x_f (validation accepts them within
   1e-9 m); string pitch line, bow geometry, limb; in the travel mode the
   stiffness follows from the draw energy of the rebuilt target, which
   depends on that stiffness through the brace conditions; the passes
   repeat until the energy changes by less than 1e-9 of itself (at most 50,
   else `no-convergence`), and the limb is built from that energy.
2. Brace conditions and the rebuilt target.
3. Inverse model on the draw grid; checks of the ideal state.
4. Ideal cable track (samples, spline, brace blend); ρ and p checks; the
   constrained fit where needed.
5. Closed outline; string track checks.
6. Forward model of the final cam on 100 (coarse) or 1500 (full) samples:
   achieved curve, tensions, loads and metrics (peak, holding weight,
   let-off, draw and limb energy, axle travel, cam and limb rotation, string
   and cable length, cam maximum dimension, smallest radius of curvature
   and its limit for each track, wraps).
7. Outlines, posts and marks.

The result keeps the brace conditions in `brace` (slope, second
derivative, tensions, p_c0, ψ_c0, the limits `maxStringTension` and
`maxSlope`), with `shapePreserved`, `naturalSecond` (F''(x_b) of the curve
without the brace correction) and, when the ideal track is built, the ends
of the brace blend: `blendStartPsi` (ψ_c0, rad), `blendEndPsi` (ψ_1, rad)
and `blendEndX` (x_1, m). `outlines` holds all six sampled outlines when a
cable track is built, the three string outlines when none is built (for
example `brace-tension`, `cable-lever`, `cable-wrap`, `limb-energy`, or no
track that the fit and the closing blend can build) and none for
`invalid-input`.

`status` is `no-convergence` when any diagnostic has that code,
`infeasible` for any other diagnostic and `ok` without diagnostics. The
solver never throws; an unexpected exception becomes a `no-convergence`
diagnostic.

### Diagnostics of the solve

Each diagnostic is `{ code, xRange, psiRange, message, suggestion }`. xRange
holds the first and last affected nock position, psiRange the first and
last affected cam angle; either is null when it does not apply. Messages
use the display units of the project; draw positions are AMO draw lengths.

| Code | Condition | Suggestion names |
|---|---|---|
| `invalid-input` | the state fails validation, an iteration limit other than undefined outside the integers 1 to 200 (before any solving), or the limb or the bow at brace cannot be built | the marked input fields, or the iteration limit |
| `brace-tension` | T_s0 = F'(x_b)·l_0/2 outside (0, M_b/s_a0), or no limb moment at brace | the force of point 2 (largest value, rounded down; found by bisection on the natural end slope of the curve, which is affine in that force and clamped at 0) and, in the stiffness mode, the preload travel when it stays within its range (at most 400 mm), otherwise the stiffness; each computed so that T_s0 is 80 % of M_b/s_a0 (M_b = k·R_L·s_0 grows in proportion to k and s_0, T_s0 does not depend on the limb) |
| `cable-lever` | limb lever at 90° at brace: c_a = 0 | the limb lever angle |
| `slack-cable` | T_c ≤ 0 of the target after point 2: E1'(α) ≤ s_a·T_s, equivalently dθ/dx ≤ 0 | the preload travel that gives 25 % more limb moment when it stays within its range, otherwise the stiffness, or a later peak |
| `nonpositive-force` | F ≤ 0 after brace | the force of point 2 or of the points in the range |
| `cable-fold` | the ideal contact angle does not increase after point 2, or the contact at point 2 lies at or behind ψ_c0 (no brace blend joins them) | a lower or later point 2 for a fold at point 2 before the peak; less let-off only where the target force falls after the peak; otherwise spreading the force change |
| `limb-rotation` | α_f above the maximum limb rotation: of the final cam once it is built, otherwise of the ideal track (the message shows up to 4 decimals, enough to tell the two apart) | the stiffness (computed) or the limb travel, or the maximum rotation |
| `limb-energy` | a tabulated limb cannot store the work of the target | a longer limb table or a lower peak |
| `target-shape` | the rebuilt target is not monotone on its first segment: no monotone setting of the free values at knots 0 and 1 exists (for example a string groove with 46 mm offset on a 50 mm radius, and point 2 at 7 N, 11.8 in from brace, as a local maximum: the first segment dips below 0 N) | point 2 |
| `string-radius` | ρ of the string pitch line below ρ_lim; the exact minimum over one turn (`minRho`) for every shape, since a 0.5° grid misses the knot minima of a free-form track when N does not divide 720 | the string track radius (computed increase), the ellipse axes, or an outward offset of a free-form track by at least the shortfall (a uniform offset raises ρ by exactly its amount) |
| `string-clearance` | the string groove bottom closer to the axle than bore/2 + wall (smallest of 720 samples) | the radius or the offset (computed), or an outward offset of a free-form track (computed) |
| `string-wrap` | full-draw contact angle plus residual wrap ≥ 360°: the contact of the final cam once it is built, otherwise of the ideal track (up to 4 decimals in the message); a full turn in the forward model of the final cam, `string-wrap` or `cable-wrap` by the cord that wraps it on the solved samples | the string track radius (computed), or an outward offset of a free-form track (computed), or the residual wrap |
| `cable-radius` | ρ of the ideal cable track below ρ_lim and the fitted cam outside the tolerance; the named range leaves out the brace blend unless it is the only one, and a negative ρ is given as the angle over which the track bends the wrong way | chosen at the largest force difference of the fitted cam: before point 2 a change of point 2; between points 2 and 3, before the peak, where the force rises and point 3 is not the full-draw point, a later point 3, for a parametric curve a larger rise to peak; after the peak a more gradual drop over the nearest falling interval at or before it, or less let-off; otherwise a more gradual change between the curve points on either side |
| `cable-clearance` | lever arm of the ideal cable track below p_min and the fitted cam outside the tolerance, or the lead-in too close to the bore | the let-off (computed limit) at full draw or the force at the position, and the bore radius plus wall (at most the lowest lever arm / 1.03 minus the cable radius, rounded down, when at least 1.5 mm); a larger string track also raises the lever arm at the peak and is not suggested |
| `cable-wrap` | active cable range plus lead-in wrap ≥ 360° | the lead-in wrap (computed) or the string track radius (an outward offset of a free-form track) |
| `closing-blend` | no closing curve with ρ ≥ ρ_lim and p ≥ p_min, or an arc too short for a closed track within the input domain (no cam then); the message gives the smallest ρ or p of the returned closed track, which decides, and the closing blend's constrained fit uses no margin, since its lead-in end can sit exactly at ρ_lim | the largest lead-in wrap that closes the track (5° steps, down to 0°); otherwise the smallest string track increase (5 mm to 20 mm, both semi-axes of an ellipse, every value of a free-form track), then half the minimum bend radius when it sets ρ_lim, with which a coarse trial solve reports no diagnostic; otherwise the changes tried and the force curve. The trials run in a full solve; a coarse solve names the force curve |
| `no-convergence` | a closure, the resampling, the constrained fit or the forward model of the final cam fails (including a non-finite or concave final cam, and any forward code without its own entry), the travel-mode stiffness does not settle, or an internal error | the input to change |
| `slack-string` | the string of the final cam goes slack (forward model) | the force in the range or the let-off |
| `wrap-exhausted` | a contact of the final cam passes its termination (forward model) | the residual and lead-in wrap |

## Layout and loads

`createLayout(result, geometry)` in `src/core/layout.js` builds, once per
result, the bow pose at any nock position x from the forward-model samples.
`bowPoseAt(ctx, x, pose)` fills the pose. Neither function throws.

Between two samples, θ, α, φ, ψ_s, ψ_c, p_s, p_c, T_s, T_c, F and the free
spans are linear in x. Every point follows from these values:

    β = β_b − α,   O = Q + R_L·(cos β, sin β),   A = (O_x, −O_y),   N = (x, 0)
    u_s = (sin φ, −cos φ)                  string contact → nock
    γ = ψ_c − θ,   u_c = (−sin γ, cos γ)   cable contact → anchor

The pivot Q is that of `bowGeometry`, so the limb stays rigid. The contact
points are the pitch-line points X(ψ) of the tracks, turned into the world
frame by R(−θ) about O. At a sample they equal N − span_s·u_s and
A − span_c·u_c to 1e-9 m. Between samples they stay on the pitch line. A
result without track data falls back to the span form.

x outside the solved samples is clamped to the nearest one. When the
solve stopped before full draw, a position past the last solved sample is
flagged `beyondSolution`.

Loads on the top limb tip (the axle O). The string pulls with T_s·u_s and
the own cable with T_c·u_c. The cable of the bottom cam is anchored at O
and pulls with T_c·(−u_c,x, u_c,y), the mirror of u_c reversed. The x parts
of the two cables cancel:

    tip = (T_s·sin φ, −T_s·cos φ + 2·T_c·u_c,y),   axle load = |tip|

The virtual work of the tip load equals the limb moment,
tip·O_α = E1'(α) with O_α = R_L·(sin β, −cos β). The unit tests check this
to 1e-9 relative. The cam bearing carries |T_s·u_s + T_c·u_c|. The bottom
limb tip carries the mirrored load.

Build lengths are those of the braced bow:

- string: the pitch-line length from the termination point on the top cam
  to the one on the bottom cam, 2·g_s;
- power cable, one of 2: the pitch-line length from its termination point
  ψ_e,c to the centre of the opposite axle.

Neither length includes the wrap around a post, loops, serving or
stretch. The axle-to-axle length at full draw is 2·O_y at the last sample.
It is not given when the solve stopped before full draw.

## Export geometry

`src/core/bspline.js` and `src/export/` turn the solved tracks into CAD
curves in the cam frame at brace. All curves stay within the export
tolerance of 0.01 mm of the model track, measured along the track normal.

**Curve fit.** A track is the envelope X(ψ) = p·n + p'·t with
X'(ψ) = ρ·t. `fitSupport` returns a clamped cubic B-spline whose parameter
is the track angle from the start of the curve:

- A spline track (the cable pitch line, its groove bottom and flange, and
  the three curves of a free-form string track) has
  ρ = p + p'' only C0 at its knots. It is fitted by one Hermite cubic per
  knot interval with the exact end points and tangents (Bézier form, triple
  interior knots). The curve is C1 and keeps the radius of curvature of the
  track: a C2 fit on uniform knots passes the position tolerance but adds
  inflections near the track knots. On the default preset: 4360 control
  points per curve, largest normal deviation 3.8e-13 m.
- An ellipse track is fitted by a C2 cubic interpolant on N uniform
  intervals with the exact end tangents; N doubles from 16 to at most 4096
  until the deviation is at most tol/2 at 9 points per interval and the
  curve is convex with ρ ≥ min ρ − 1e-6 m.
- An eccentric-circle track is a circle of radius r about e·(cos φ, sin φ)
  and is exported as a circle.

The normal distance of a point S from a track is S·n(ψ*) − p(ψ*), with ψ*
the root of S·t(ψ) − p'(ψ) found by bracketed Newton.

**Cut contours.** A plate outline is a closed polygon on the track offset
outwards by tol, sampled at a constant angle step Δψ with
1 − cos(Δψ/2) = 2·tol/(1.1·ρ_max + tol), ρ_max from a 0.25° grid. Every
vertex lies tol outside the track and every chord dips at most 2·tol below
the offset, so the outline stays within [−tol, +tol] of the track. The
middle flange is the convex hull of both flanges, h(ψ) = max of the two
supports; where they cross (found by bisection) the outline follows their
common tangent between both tangent points. Default preset: 269 to 274
vertices per outline.

**Cable stop boss.** The cable stop peg of radius r clears the cable groove
bottom by r, so it reaches past the cable flange by 2r − d_g, with d_g the
cable groove depth: 2.5 mm on the default preset (r = 2.5 mm,
d_g = 2.5 mm). A plate among 3 and 5 whose outline does not hold the disc
of radius r + w around the peg, w the minimum wall, adds that disc, with
support h(ψ) = c·n(ψ) + r + w, to the hull. The outline then follows the
common tangents from the flange to the disc, and at least w of material
surrounds the peg hole. On the default preset both plates 3 and 5 get the
disc: plate 3 would keep 1.5 mm around the hole.

**Number format.** Coordinates are written with 6 decimals in mm, knots with
12. Spline control points keep 10 decimals: the Hermite pieces of a spline
track span 0.25° and their control points lie about 0.007 mm apart, so
6 decimals would change the second differences by about 10 % and lower the
radius of curvature from 5.005 mm to 4.55 mm on the default cable pitch
line. A unit test reads the written reference DXF back and checks that the
smallest radius of the cable pitch line stays above the minimum bend radius
minus 0.001 mm.

**Round trip.** A unit test reads the reference DXF back, rebuilds the cable
support p(ψ) = max over the exported spline of S·n(ψ) on a 0.25° grid and
the string track from its circle, runs the forward model and compares the
draw force with the solved one: the largest difference is below 0.5 N.

## STEP solids

`src/export/step.js` writes each plate as a prism: its outline and holes in
the XY plane, extruded along +Z by the plate thickness. Flange plates are
t_f thick, groove plates d + c (cord diameter plus groove clearance).

**Outline.** The solid follows the exact track, not the DXF cut outline,
which is offset outwards by the tolerance. A plate of one track reuses the
export fit of that track. The middle flange and a plate with a boss use
the hull of their tracks: h(ψ) = max_k p_k(ψ). On each arc of the hull one
track gives h; the arcs meet at crossing angles ψ_c where two supports are
equal, found on a 0.25° grid and refined by bisection. There the hull
follows the common tangent from P = X_a(ψ_c) to Q = X_b(ψ_c), a straight
segment of length L along t(ψ_c). The fit uses Hermite cubics with the
exact point X and derivative X' = ρ·t on each arc (parameter u = ψ), and
one straight cubic per tangent with knot interval Δu = 2L/(ρ_a + ρ_b) and
inner control points P + (Δu/3)·ρ_a·t and Q − (Δu/3)·ρ_b·t. The derivative
then equals ρ_a·t at P and ρ_b·t at Q on both sides of each joint, so the
curve is C1 in u, and the segment is straight because the four control
points are collinear. A cubic with interior knots of multiplicity 3 that is
C1 in u loses one multiplicity exactly: the joint control point lies on
the line of its neighbours, Q_j = (h_r·Q_{j−1} + h_l·Q_{j+1})/(h_l + h_r).

**Area check.** On an arc the boundary X = p·n + p'·t has X × X' = p·ρ, so
the hull area is A = ½ Σ_arcs ∫ p(p + p'') dψ + ½ Σ_tangents P × Q. The
written B-spline encloses ½∮(x dy − y dx), exact with 3-point Gauss per
span. Default preset: middle flange, cable flange and cable groove plate
within 2e-6 m² (0.4 m × tol/2) of the exact area.

**Orientation.** Profiles run counter-clockwise seen from +Z. The normal
of a SURFACE_OF_LINEAR_EXTRUSION of a counter-clockwise curve along +Z,
C'(u) × Z, points outwards; a CYLINDRICAL_SURFACE normal points away from
its axis. The outline side face therefore uses its surface as it is
(same_sense .T.), a hole face reversed (.F.). The top plane (axis +Z)
faces up (.T.), the bottom plane down (.F.).

**Topology.** With n closed profiles (outline and n − 1 holes) a solid has
V = 2n vertices, E = 3n edges, F = n + 2 faces and L = 3n loops, and
satisfies V − E + 2F − L = 2(1 − G) with genus G = n − 1: both sides equal
4 − 2n.

## Validity and diagnostics of the forward model

The solver never throws on user input. It returns `status`: `ok`,
`infeasible` or `no-convergence`, and a list of diagnostics
`{code, xRange, message}`; xRange gives the first and last nock position of
each run of affected samples.

| Code | Condition |
|---|---|
| `invalid-input` | a value outside the input domain above, non-finite geometry, unknown track kind, unknown limb kind, spline with non-finite knots, x grid that is not a non-empty array, not increasing or leaves [x_b, x_f], sample count outside 2 to 20000, iteration limit outside 1 to 200, non-finite termination angle, non-finite limb moment at brace, or any exception while reading the input |
| `brace` | the string cannot leave its track at ψ = 0 towards the nock, the anchor lies inside the cable track, or det = 0 at brace |
| `no-convergence` | a sample does not close within 30 iterations, or a contact is lost; later samples are NaN |
| `slack-string` | T_s ≤ 0 |
| `slack-cable` | T_c ≤ 0 |
| `wrap-exhausted` | a contact passes its termination (σ·(ψ_c − ψ_e) < 0), a contact leaves the defined range of an open track, or a termination lies outside that range |
| `wrap-overlap` | a cord wraps a full turn or more, σ·(ψ_c − ψ_e) ≥ 2π, and would overlap itself in its groove; the string wrap is largest at brace, the cable wrap at full draw |
| `cable-lever` | c_a ≤ 0: limb rotation no longer takes up cable |
| `cam-reversal` | dθ/dx ≤ 0 after brace |
| `non-finite` | the force, a tension, θ or α at a sample, or the limb energy, is not finite. A guard: no input inside the domain is known to reach it |
| `concave-track` | the radius of curvature p + p″ is below −1e-9 m (rounding in p + p″ stays above it) somewhere on the wrapped range of a track (exact minimum: constant r for a circle, b²/a or an end value for an ellipse, the cubic p + p″ minimised on every spline interval): string from its smallest contact angle to its termination, cable from its termination to its largest contact angle |

## Verification

The tests in `tests/unit/` check the model against independent results.
Measured values are the largest errors over the tested samples.

| Test | Tolerance | Measured |
|---|---|---|
| Cord length identity against free span plus Gauss–Legendre arc length ∫ρ dψ, ellipse, eccentric circle and periodic spline tracks, both sides | 1e-12 m | 2e-16 m |
| ∂L/∂B = u and ∂L/∂θ = σ·p against finite differences | 1e-9, 1e-10 m | 2e-11, 1e-11 m |
| Support functions: X on its tangent line, dX/dψ = ρ·t, P' = p, p', p'' against differences, P against quadrature, ellipse ρ = b²/a and a²/b | 1e-16 m to 1e-10 | passes |
| Projection partials of g_s and g_c against finite differences | 1e-10 | passes |
| Concentric circles: θ(α) against the closed form of the cable closure | 1e-12 rad | 6e-14 rad |
| Concentric circles: T_s and T_c against the free-body balance (see the free-body rows); its ratio T_c/T_s = r_s/r_c | 1e-9, 1e-12 relative | 1e-15, 2e-15 |
| Concentric circles: F(x) against the semi-analytic curve (α as parameter, x(α) from the string closure, F = 2·E1'/x'(α)) | 1e-10 relative | 1e-14 |
| Free-body statics: F = 2·T_s·u_s,x, T_s and T_c from the moment balance of the cam about the axle and of the limb about the pivot, with tangent points found by bisection and cord directions taken from the contact, nock and anchor positions (no lever arms or projections of the solver) | 1e-9 relative | 8e-11 |
| Free-body statics at brace: T_s0, T_c0, free span l_0 and F'(x_b) = 2·T_s0/l_0 | 1e-9, 1e-12 relative | 4e-16 |
| Virtual work: F against dE/dx of 2·E1(α) along a closure path solved in the test (tangent points by bisection, cord lengths as free span plus the Gauss–Legendre arc length ∫ρ dψ, Newton with a difference Jacobian), 4th-order differences with h = 0.25 mm; α and θ at the same points | 1e-9 relative; 1e-12 rad, 1e-11 rad | 6e-11; 4e-16 rad, 3e-15 rad |
| F = 2·E1'(α)·dα/dx with dα/dx from finite differences of the solution | 1e-9 relative | 1e-11 |
| Energy: Simpson rule in s on 1501 samples against 2·(E1(α_f) − E1(0)) | 1e-9 relative | 5e-11 |
| Energy: trapezoid rule on 2000 samples | 1e-6 relative | 8e-7 |
| Grid refinement: trapezoid energy error for 100, 200, 400, 800 samples | order 1.9 to 2.1 | 2.00 to 2.02 |
| Brace slope F'(x_b) = 2·T_s0/l_0 against a degree-7 fit of F(x_b + k·1 mm) | 1e-8 relative | 2e-14 |
| F''(x_b) of four cable tracks with p_c(ψ_c0) = 20 mm and p_c' = 0, ±8 mm, −2.3 mm | 1e-6 relative | 2e-9 |
| Cable track that is a point at the axle (p_c = 0): α constant, F = 0 | 1e-15 rad, 0 N | passes |
| Same solution at a nock position for any grid through it | 1e-12 rad | passes |
| Tabulated limb with linear data against the linear limb | 1e-12 relative | passes |
| E1⁻¹ of a tabulated limb whose last row falls, beyond the table up to the peak of E1; NaN above it | 1e-9 J | passes |
| E(φ \| 1) against the quadrature of \|cos u\| | 1e-14 | passes |
| Contact solver: tangent pair within 1 µm of a circle next to the end of the scan window; warm starts up to 1e6 rad | | passes |
| One test per diagnostic code | | passes |
| Realistic twin cam (below): peak between 150 N and 500 N, let-off above 20 %, each cord wrapped less than one turn | | 260 N, 38 %, 341° |
| Forward model: coarse solve (100 samples) and full solve (1500 samples) | 8 ms and 100 ms, tested with a factor 5 margin | 0.4 ms and 5.2 ms median after warm-up (full: 3.6 ms to 7.8 ms over 30 runs) |
| Inverse brace conditions against the forward model of the twin cam: T_s0, T_c0, p_c0, ψ_c0, c_a0 from F'(x_b) | 1e-12 relative, 1e-15 m, 1e-13 rad | passes |
| Inverse F''(x_b) against a degree-7 fit of the forward force at x_b + k·1 mm, for the twin cam and for a cable circle of radius p_c0; F'(x_b) of the same fit | 1e-8 relative; 1e-9 relative | 4.7e-10 and 2.3e-9; 1.6e-14 |
| Brace feasibility: T_s0 ≤ 0 and T_s0 ≥ M_b/s_a0 rejected, 0.999 of the limit accepted | | passes |
| Reverse round trip: forward model of the twin cam (eccentric circles), F and its integral into the inverse model, p_c at the forward samples | 1e-8 m | 9.6e-13 m; θ 2.7e-14 rad |
| Reverse round trip, concentric circles | 1e-8 m | 5.4e-13 m; θ 2.9e-14 rad |
| Reverse round trip: spline through the cable track resampled from brace (no brace blend), from a dense target (degree-7 interpolation of 4001 forward samples), against the forward cable track over the draw | 1e-8 m | 9.5e-15 m over 258°; 9.0e-17 m over 241° (concentric) |
| Inverse statics: T_s, T_c and F at the pose (x, θ, α) of each inverse sample against the free-body balance of the free-body rows (twin cam, tangent points by bisection); T_c against the forward model | 1e-9 relative; 1e-8 relative | 6.3e-11; 3.6e-11 |
| Inverse kinematics: p_c = c_a·dα/dθ, dα/dx and dθ/dx against central differences along the draw | 1e-7 relative | passes |
| Brace blend: p(ψ_c0), C2 join and the cable closure integral; Lagrange end slopes of a quartic test polynomial on uneven points | 5e-16 m (p), 5e-15 m/rad (p'), 5e-14 m/rad² (p''), 5e-15 m·rad (integral); 5e-13, 5e-12 | passes |
| Quadratic programme: reference problems, equality multipliers of either sign, dropped constraints; KKT (Karush–Kuhn–Tucker) conditions on 300 random convex problems (fast-check) | 5e-13 (reference problems); 1e-10 (KKT) | passes |
| Quadratic programme: redundant and contradicting equalities; a nearly dependent equality (1e-9 and 1e-10 apart) that holds when found and that y ≥ 100 moves off reported `infeasible`; exact combinations of rows of size 3e7 and 3e8 kept `optimal` within the bound of the combined rows; two equalities 1.2e-7 apart refined until a third, redundant one holds to 5e-10 (7.6e-4 off after two passes); an inequality that only the rule for n active constraints treats as dependent (equalities 2e-8 apart) reported `infeasible` with 2 active; a third normal that combines the two active ones; nearly parallel constraints (1e-5 apart) met to the tolerance; a programme with rows 1e-7 apart reported `infeasible`; `invalid` for non-finite data, mismatched sizes and options out of range | 3e-10 | passes |
| Quadratic programme on 20,000 random problems with 1 to 5 unknowns and up to 11 rows, including multiples, combinations and nearly parallel rows (seed 7): no failure without nearly parallel rows, at most n active constraints, feasible problems with nearly parallel rows reported `infeasible`, `optimal` results with a redundant equality off by more than 1e-8 of its size | 0; n; below 7 %; at most 5, below 2e-2 | 0 of 7833; n; 6.0 % (257 of 4294); 2, up to 1.3e-4 |
| Quadratic programme against a brute-force solution (every set of independent constraints as equalities) on 500 small integer problems with repeated, scaled and negated rows (fast-check), feasible and arbitrary right-hand sides: x, KKT conditions relative to the size of their terms, `infeasible` exactly when the brute force finds nothing | 1e-9, 1e-12 | passes |
| Constrained fit: a track within the limits is reproduced; ρ ≥ ρ_min and p ≥ p_min where the samples violate them; prescribed points and integrals; `invalid` for out-of-range input, including points to pass through outside (ψ_0, ψ_1] or with a non-finite angle, lever arm or integral | 1e-7 m; 5e-6 m, 1e-7 m; 1e-12 m and m·rad | passes |
| Solve where the fit through the curve points wins (limb 3.5 N/mm, let-off 65 %, rise 50 %): forward force of the built cam at the 4 matched points against the target, θ and α against the inverse model; more than 1e-3 N at the other points | 1e-9 N, 1e-12 rad | 4e-13 N, 5e-15 rad |
| Solve without the fit: target of 7 points from the forward model of a known cam (string groove 47.7 mm with 0.25 mm offset, limb 12.45 N/mm with 190 mm preload, cable circle 13.5 mm with 0.9 mm offset), ideal track from brace blend and resampled spline: achieved force against the target from point 2 on; forward force, θ and α of the built cam at the curve points; brace slope | 1e-6 N (full), 5e-6 N (coarse); 1e-12 rad (full), 2e-10 rad (coarse); 1e-9 relative | 1.3e-7 N and 3.8e-7 N; 1.3e-13 rad and 1.8e-11 rad; 2e-16 |
| Closed cable track: lead-in and active track kept, periodic C2 join, ρ of the closing blend ≥ ρ_lim, closed outlines | 1e-8 m (lead-in), 1e-9 m (active track and joins), 5e-13 m, m/rad and m/rad² (p, p', p'' after one period), 1e-6 m (ρ) | passes |
| Lead-in with ρ(ψ_c0) = 330 mm and 2 mm at p(ψ_c0) = 30 mm: ρ_0 = 30 mm and 5 mm; ρ(u) = p + p'' with p'' from central differences of p alone (steps 1e-4 and 2e-4 rad, Richardson extrapolation) against the formula, monotone; p'' of the evaluator against the same differences; p' against central differences; C2 join; p within 2λ·\|ρ(ψ_c0) − ρ_0\| of the arc of radius ρ_0; closed spline at most 5 % of the change in ρ below the smaller end value | 1e-8 m and m/rad²; 1e-9 m/rad | 1.7e-9 m |
| Lead-in wrap 0, 1.5e-179, 1e-15 and 1e-9 rad: knots at least 1e-3 of the spacing apart, ρ of the closed track ≥ ρ_lim | 1e-6 m | passes |
| Solve with rise 40 % at let-off 75 % and 65 %: no `closing-blend`, cam below 120 mm, closed track ρ ≥ ρ_lim | 1e-5 m | cam 114.0 mm and 113.4 mm |
| Solve with a lead-in wrap of 0: no diagnostics, cable post at ψ_c0; minimum bend radius 20 mm with a lead-in wrap of 5° and 10°: `closing-blend`, `cable-radius`, `cable-clearance`, suggestion a 10 mm bend radius, which solves without diagnostics, while no larger string track does; lead-in trials k·5° down to exactly 0 | | passes |
| Peak 250 N, rise 49 %, valley width 1.4 in (fitted cam, full solve): string termination at the achieved full-draw contact plus 30° to 1e-12 rad, string post at the termination, string length equal to a forward solve with that termination to 1e-12 m | | passes |
| Final cam decides: residual wrap 1.46396 rad on the default preset wraps the ideal track 360.003°, the final cam 359.997°, and solves without diagnostics, 1.4641 rad gives `string-wrap` (360.01°); a fitted cam at 16.975° with an ideal track at 16.983° passes a 16.979° limit | | passes |
| Maximum limb rotation 15.893° on the default preset (ideal track 15.8923°, fitted cam 15.8940°, coarse and full): `limb-rotation` alone, message with 3 decimals | | passes |
| Constrained fit with p(ψ_0) prescribed twice: 0.03 m and 0.02 m infeasible, 0.02 m twice optimal with p(ψ_0) = 0.02 m to 1e-12 m | | passes |
| Known-circle cam with a 9.850 mm bend radius (full solve): the closed ideal track dips to 9.849 mm between the 0.1° samples; the fit runs, the cam closes without diagnostics and keeps ρ ≥ 9.850 mm | 1e-6 m | passes |
| Lead-in wrap 137.55° on the default preset (0.06° left to close, coarse and full): `closing-blend` alone, no cable track, achieved curve or metrics, string outlines only, suggestion a lead-in wrap of at most 105.0°, which solves without diagnostics; 100 random valid states: every solve without diagnostics has a cable track, an achieved curve and metrics | | passes |
| `closing-blend` trials: point 2 at 12 in and 120 N names a 55.0 mm string track radius (full solve; 50 mm fails, 55 mm solves without diagnostics; the coarse solve runs no trials and names the force curve); a 45 mm × 35 mm ellipse with point 2 at 11 in and 100 N names both semi-axes 15 mm larger; point 2 at 10 in and 50 N names none, and each larger string track raises the largest force difference; trial states within the field range, the bend radius tried only when it sets ρ_lim | | passes |
| Offsets, maximum dimension, termination and cable stop posts, timing marks | 5e-16 m to 1e-6 m | passes |
| Free-form track: default eccentric and hunting ellipse sampled at 12 and 16 points against the exact support, p and ρ on a 0.1° grid | 50 µm, 5 µm; 3 mm, 1 mm | 9.8 µm, 3.0 µm; 1.06 mm, 0.59 mm |
| Free-form track: each sample converted at 12 points, full solve | 0.1 mm cam size, 0.05 N force difference | 0.08 mm, 0.021 N |
| Free-form track: `largestAmount` and `dragLimit` by bisection, the value 1 µm further misses the limit; clamped default amounts keep a 0.5 mm margin at 8, 12 and 16 points and 12 angles; exact `minRho` at a knot at 98.18° (N = 11) named by `string-radius` | 1 µm | passes |
| Free-form design exported: string curves as splines within the export tolerance, DXF reader and Part 21 checks | 0.01 mm | passes |
| Default preset: zero diagnostics; force within the fit tolerance; outlines closed and nested (groove bottom inside the pitch line and the flange, outside the bore and its wall); posts and marks at the achieved contacts | 8.0 N | 3.71 N |
| Edits of the default preset (peak 250, 260, 275, 285 N; rise 44 %, 48 %, 50 %; valley 0.9 in, 1.5 in): zero diagnostics | 3 % of the peak | 6.0 N at peak 250 N (7.5 N) |
| Solve: one test per diagnostic code; 100 random states (fast-check) never throw and return plain data; a result without a cable track has the three string outlines only, invalid input none | | passes |
| Solve with the first curve point moved by ±1e-12 m, ±5e-10 m and ±1e-9 m, or the last by 1e-9 m (all accepted by validation): the result of the exact state; inverse samples within 1e-9 m of x_b take the brace values | | identical |
| Inverse B·t = √(D² − p_c²) minus p_c'(ψ_c) against the free cable span of the forward model, twin cam | 1e-8 m | 4.8e-12 m |
| Fitted cam without the brace value (10 mm wall, point 2 at 60 N): cable-brace mark at the brace contact of the forward model, 0.47° after ψ_c0, on the cable line to the anchor; lead-in from that contact | 1e-9 m, 1e-9 rad | passes |
| Suggestions applied: the brace-tension force of point 2 at 30 mm and 50 mm preload travel (slope 0.77 and 0.80 of the limit), the cable-clearance hub and let-off limits at let-off 80 %, a lower or 2 in later point 2 for a cable contact behind brace at point 2, point 5 moved 0.5 in earlier for a `cable-radius` miss between points 5 and 6; for a miss between points 2 and 3 at rise 30 % (43.5 N), rise 40 % (10.6 N) and 44 % (no diagnostics), and point 3 of the custom curve 1.5 in later (6.6 N, within the tolerance), while point 2 10 N lower raises the difference to 60 N; for a miss between brace and point 2 with point 2 at 16.75 in and 240 N (10.7 N), point 2 at 245 N (5.7 N, no diagnostics) | | passes |
| Solve of the default preset: coarse and full, timed in a worker thread (no coverage counters) | 30 ms and 200 ms, tested with a factor 5 margin | 24 ms to 27 ms and 30 ms to 35 ms after warm-up (Node 22, 4-core 2.1 GHz Xeon); 26 ms to 35 ms and 33 ms to 51 ms in the coverage run (spread of 7 runs) |
| Coarse solve with point 2 at 10 in and 50 N, where no lead-in wrap closes the track: no trial solves, timed in the worker thread | 10 times the 30 ms coarse budget | 75 ms to 89 ms after warm-up; 75 ms to 99 ms in the coverage run (spread of 7 runs) |

Realistic twin cam of the tests: default geometry (ATA 33 in, brace height
6.5 in, draw length 29 in, limb lever 11 in at 25°), groove bottoms of an
eccentric string circle (radius 45 mm, offset 6 mm, phase 45°) and an
eccentric cable circle (radius 18 mm, offset 10 mm, phase −60°), 2.5 mm
cords, linear limb 10 N/mm with 30 mm preload. The cam turns 258°; the
string wraps 341° at brace (including the 30° residual wrap) and the cable
288° at full draw. The axle moves 54 mm, the peak is 260 N at 25.4 in and
the holding weight 160 N at full draw, a let-off of 38 %. The same cam with
a 36 mm string groove (offset 6 mm, phase 45°, cable phase −30°, offset
8 mm) wraps the string 396° at brace and reports `wrap-overlap` over the
first 123 mm of the power stroke.

## Numerical settings

| Setting | Value |
|---|---|
| Draw samples | 1500 (full), 100 (coarse), x − x_b = s² |
| Closure residual | below 1e-10 m, typically below 1e-15 m |
| Newton iteration limit per sample | 30 (2.75 on average) |
| Newton step limits | 0.5 rad in θ, 0.1 rad in α |
| Contact Newton | stops at a step below 1e-11 rad; residual below 1e-15 m |
| Contact scan | 96 points over one turn around the warm start |
| Contact golden-section search | at most 100 steps, interval 1e-12 relative to \|ψ\| |
| Brace contact of the string | within 1e-9 rad of ψ = 0 |
| E1⁻¹ residual | below 1e-9 J |
| Default lead-in and residual wrap | 30° |
| Inverse draw grid | 100 (coarse), 600 (full) samples, x − x_b = s², plus the curve points |
| Inverse string closure | Newton, residual below 1e-10 m, at most 30 iterations |
| Ideal cable resampling | 0.5° (coarse), 0.25° (full); Illinois search stopped within 0.1 % of the step |
| Constrained fit | one knot interval per about 10° (17 to 37), 8 constraint points per interval, margin 5e-6 m, penalty 1e-8·trace on second differences; up to 10 exchange rounds add the exact minima of p and ρ that fall more than 1e-9 m below their limits as constraints (none needed on 62 fits of the default and its edits) |
| Constrained fit input | \|ψ\| ≤ 1e4 rad, 1 to 200 knot intervals, 1 to 50 constraint points per interval, knot spacing at least 1e-6 rad (the input domain), points to pass through at ψ_0 < ψ ≤ ψ_1 with finite lever arm and integral; an optimum outside the input domain gives the status `out-of-domain`, and a closed cable track outside it cannot be closed |
| Quadratic programme | violation tolerance 1e-10 of the row scale, for active constraints of max(row scale, size of the terms), for redundant equalities of that size plus the sizes of the rows they combine; dependence at \|z\|_G ≤ 1e-8 of the cancelled terms; refinement after each added constraint while the largest active residual falls or exceeds 4 machine epsilons (8.9e-16) of its size, at most 8 passes; at most 10·(n + m) + 20 steps |
| Fit tolerance | force 3 % of the peak, at least 2 N; draw energy 0.5 % |
| `closing-blend` trials | lead-in wraps k·5° down to 0° (closing only); in a full solve, coarse trial solves with the string track radius, or both semi-axes, 5, 10, 15 and 20 mm larger, then half the minimum bend radius |
| Groove margin in ρ_lim | 0.2 mm |
| Outline samples | 360 (coarse), 720 (full) intervals |
| Forward model of the final cam | 100 (coarse), 1500 (full) samples |

## Limitations

- Static model: arrow speed, dynamic efficiency and hysteresis are not
  computed.
- String and cables are inextensible.
- Rigid limb levers with a fixed pivot; top and bottom limbs identical; the
  nock stays on y = 0 midway between the axles, so cam timing is not
  modelled.
- The cable anchor is the bottom axle centre: yoke legs and cable guard
  offset are ignored.
- The forward model follows the solution branch that starts at brace; a
  fold of that branch (det = 0) ends the solve with `no-convergence`.
- The model is not validated against measured bows.
