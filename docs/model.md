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
x_b + k·1 mm to 1e-9 relative, which is the accuracy of the fit.

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
at both ends.

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
distance min p. Optional equalities: p(ψ_c0) = p_c0 and, at the contact
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

In the fit programmes the active normals are often nearly dependent: the
condition number of M, estimated from the diagonal of its Cholesky factor,
has a median of 6e5 and reaches 7e16 on 100 random near-default states.
Three rules keep rounding from turning into large steps:

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
  hold makes the programme infeasible.
- Iterative refinement. After each added constraint, two passes move x by
  W·M⁻¹·e and the multipliers by M⁻¹·e, with the residuals e of the active
  constraints. G·x + a = N·u still holds, and the active constraints hold
  to rounding. A pass that would turn an inequality multiplier negative is
  skipped.

The result is optimal only when every active constraint holds within the
tolerance times max(s_i, |b_i| + Σ|c_ij·x_j|). Otherwise rounding has moved
x off the active constraints, and the status is `infeasible`: the
programme cannot be solved in double precision, for example with normals
that differ by 1e-7 of their size and a solution 1e7 times the row scale
away.

On 600 random near-default states the 2597 fit programmes that `solve`
builds end with every constraint met to 1.0e-10 of its row scale.
`solveQP` returns `invalid` for sizes that do not match, meq outside 0 to
m, a non-finite entry or options out of range, and `fitCableTrack` returns
`invalid` for non-finite or out-of-range input (limits in the table of
numerical settings) instead of throwing.

The solver fits when the ideal track violates ρ_lim or p_min, when its
contact angle does not increase, or when it cannot be sampled. It then runs
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
  blend fails. With the bound the same states give 114 mm to 144 mm and
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
  as constraints. When no such spline exists the solver reports
  `closing-blend` and names the largest lead-in wrap k·5° below the input,
  down to 0°, that closes the track. When none does, it names the string
  track radius: a larger string track turns the cam less over the draw and
  leaves a longer arc for the blend. When ρ_lim is the minimum bend radius
  and the blend bends too sharply, it also names that radius. On 119
  states without a closing lead-in wrap (rise 30 % to 50 %, let-off 60 % to
  80 %, limb 2.0 to 4.0 N/mm with 84 mm to 200 mm preload, lead-in 15°, 30°
  and 60°), a string track radius 5 mm or 10 mm larger closes 113, half the
  minimum bend radius closes 68, 5 points less let-off closes 12 and a
  valley 1 in longer closes 5.
- The closed track is stored as a periodic C2 cubic spline through samples
  of the pieces at a spacing of at most 0.25° (full) or 0.5° (coarse); the
  knots of spline pieces are kept. A knot closer than 1e-3 of the spacing
  to the previous one is left out (a lead-in wrap of 0 or near 0), so no
  interval is near zero and rounding does not spike p''. A periodic p with
  p + p'' > 0 is a closed convex curve.

The string track is the closed parametric track of the project; the string
post sits at its termination, the full-draw contact angle plus the residual
wrap.

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
   stiffness follows from the draw energy of the rebuilt target, iterated
   three times.
2. Brace conditions and the rebuilt target.
3. Inverse model on the draw grid; checks of the ideal state.
4. Ideal cable track (samples, spline, brace blend); ρ and p checks; the
   constrained fit where needed.
5. Closed outline; string track checks.
6. Forward model of the final cam on 100 (coarse) or 1500 (full) samples:
   achieved curve, tensions, loads and metrics (peak, holding weight,
   let-off, draw and limb energy, axle travel, cam and limb rotation, string
   and cable length, cam maximum dimension, smallest radius of curvature,
   wraps).
7. Outlines, posts and marks.

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
| `invalid-input` | the state fails validation, or the limb or the bow at brace cannot be built | the marked input fields |
| `brace-tension` | T_s0 = F'(x_b)·l_0/2 outside (0, M_b/s_a0), or no limb moment at brace | the force of point 2 (largest value, rounded down; found by bisection on the natural end slope of the curve, which is affine in that force and clamped at 0) and, in the stiffness mode, the preload travel when it stays within its range (at most 400 mm), otherwise the stiffness; each computed so that T_s0 is 80 % of M_b/s_a0 (M_b = k·R_L·s_0 grows in proportion to k and s_0, T_s0 does not depend on the limb) |
| `cable-lever` | limb lever at 90° at brace: c_a = 0 | the limb lever angle |
| `slack-cable` | T_c ≤ 0 of the target after point 2: E1'(α) ≤ s_a·T_s, equivalently dθ/dx ≤ 0 | the preload travel that gives 25 % more limb moment when it stays within its range, otherwise the stiffness, or a later peak |
| `nonpositive-force` | F ≤ 0 after brace | the force of point 2 or of the points in the range |
| `cable-fold` | the ideal contact angle does not increase after point 2, or the contact at point 2 lies at or behind ψ_c0 (no brace blend joins them) | a lower or later point 2 for a fold at point 2 before the peak; less let-off only where the target force falls after the peak; otherwise spreading the force change |
| `limb-rotation` | α_f above the maximum limb rotation | the stiffness (computed) or the limb travel, or the maximum rotation |
| `limb-energy` | a tabulated limb cannot store the work of the target | a longer limb table or a lower peak |
| `target-shape` | the rebuilt target is not monotone on its first segment: no monotone setting of the free values at knots 0 and 1 exists (for example a string groove with 46 mm offset on a 50 mm radius, and point 2 at 7 N, 11.8 in from brace, as a local maximum: the first segment dips below 0 N) | point 2 |
| `string-radius` | ρ of the string pitch line below ρ_lim | the string track radius (computed increase) or the ellipse axes |
| `string-clearance` | the string groove bottom closer to the axle than bore/2 + wall | the radius or the offset (computed) |
| `string-wrap` | full-draw contact angle plus residual wrap ≥ 360° | the string track radius (computed) or the residual wrap |
| `cable-radius` | ρ of the ideal cable track below ρ_lim and the fitted cam outside the tolerance; the named range leaves out the brace blend unless it is the only one, and a negative ρ is given as the angle over which the track bends the wrong way | chosen at the largest force difference of the fitted cam: point 2 before point 3; after the peak a more gradual drop over the nearest falling interval at or before it, or less let-off; otherwise a more gradual change between the curve points on either side |
| `cable-clearance` | lever arm of the ideal cable track below p_min and the fitted cam outside the tolerance, or the lead-in too close to the bore | the let-off (computed limit) at full draw or the force at the position, and the bore radius plus wall (at most the lowest lever arm / 1.03 minus the cable radius, rounded down, when at least 1.5 mm); a larger string track also raises the lever arm at the peak and is not suggested |
| `cable-wrap` | active cable range plus lead-in wrap ≥ 360° | the lead-in wrap (computed) or the string track radius |
| `closing-blend` | no closing curve with ρ ≥ ρ_lim and p ≥ p_min | the largest lead-in wrap that closes the track (5° steps, down to 0°); otherwise the string track radius, and the minimum bend radius when it sets ρ_lim |
| `no-convergence` | a closure, the resampling, the constrained fit or the forward model of the final cam fails, or an internal error | the input to change |
| `slack-string` | the string of the final cam goes slack (forward model) | the force in the range or the let-off |
| `wrap-exhausted` | a contact of the final cam passes its termination (forward model) | the residual and lead-in wrap |

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
| Forward model: coarse solve (100 samples) and full solve (1500 samples) | 8 ms and 100 ms, tested with a factor 5 margin | 0.3 ms and 2.7 ms after warm-up |
| Inverse brace conditions against the forward model of the twin cam: T_s0, T_c0, p_c0, ψ_c0, c_a0 from F'(x_b) | 1e-12 relative, 1e-15 m, 1e-13 rad | passes |
| Inverse F''(x_b) against a degree-7 fit of the forward force at x_b + k·1 mm, for the twin cam and for a cable circle of radius p_c0 | 1e-8 relative | passes |
| Brace feasibility: T_s0 ≤ 0 and T_s0 ≥ M_b/s_a0 rejected, 0.999 of the limit accepted | | passes |
| Reverse round trip: forward model of the twin cam (eccentric circles), F and its integral into the inverse model, p_c at the forward samples | 1e-8 m | 9.6e-13 m; θ 2.7e-14 rad |
| Reverse round trip, concentric circles | 1e-8 m | 5.4e-13 m; θ 2.9e-14 rad |
| Reverse round trip: ideal cable spline (brace blend and resampled spline) against the forward cable track over the draw | 1e-8 m | 9.5e-15 m over 258°; 9.0e-17 m over 241° (concentric) |
| Inverse statics: T_s·p_s = T_c·p_c, E1' = T_s·s_a + T_c·c_a; T_c against the forward model | 1e-12, 1e-12, 1e-8 relative | passes |
| Inverse kinematics: p_c = c_a·dα/dθ, dα/dx and dθ/dx against central differences along the draw | 1e-7 relative | passes |
| Brace blend: p(ψ_c0), C2 join and the cable closure integral; Lagrange end slopes on uneven points | 1e-13; 1e-11 | passes |
| Quadratic programme: reference problems, equality multipliers of either sign, dropped constraints; KKT (Karush–Kuhn–Tucker) conditions on 300 random convex problems (fast-check) | 1e-10 | passes |
| Quadratic programme: redundant and contradicting equalities; a dependent constraint with n active; nearly parallel constraints (1e-5 apart) met to the tolerance; a programme with rows 1e-7 apart reported `infeasible`; `invalid` for non-finite data, mismatched sizes and options out of range | 3e-10 | passes |
| Quadratic programme against a brute-force solution (every set of independent constraints as equalities) on 500 small integer problems with repeated, scaled and negated rows (fast-check), feasible and arbitrary right-hand sides: x, KKT conditions relative to the size of their terms, `infeasible` exactly when the brute force finds nothing | 1e-9, 1e-12 | passes |
| Constrained fit: a track within the limits is reproduced; ρ ≥ ρ_min and p ≥ p_min where the samples violate them; prescribed points and integrals; `invalid` for out-of-range input | 1e-7 m; 5e-6 m, 1e-7 m; 1e-12 m | passes |
| Solver fit through the curve points of the default preset: forward force at those points | | 3.7e-13 N |
| Closed cable track: lead-in and active track kept, periodic C2 join, ρ of the closing blend ≥ ρ_lim, closed outlines | 1e-8 m, 1e-12 | passes |
| Lead-in with ρ(ψ_c0) = 330 mm and 2 mm at p(ψ_c0) = 30 mm: ρ_0 = 30 mm and 5 mm, ρ(u) against the formula, monotone, p' and p'' against central differences, C2 join, p within 2λ·\|ρ(ψ_c0) − ρ_0\| of the arc of radius ρ_0; closed spline at most 5 % of the change in ρ below the smaller end value | 5e-13 m; 1e-9, 1e-4 | passes |
| Lead-in wrap 0, 1.5e-179, 1e-15 and 1e-9 rad: knots at least 1e-3 of the spacing apart, ρ of the closed track ≥ ρ_lim | 1e-6 m | passes |
| Solve with rise 40 % at let-off 75 % and 65 %: no `closing-blend`, cam below 120 mm, closed track ρ ≥ ρ_lim | 1e-5 m | cam 113.9 mm and 114.1 mm |
| Solve with a lead-in wrap of 0: no diagnostics, cable post at ψ_c0; minimum bend radius 20 mm with a lead-in wrap of 5° and 10°: `closing-blend`, `cable-radius`, `cable-clearance`; lead-in trials k·5° down to exactly 0 | | passes |
| Offsets, maximum dimension, termination and cable stop posts, timing marks | 1e-15 m to 1e-6 m | passes |
| Default preset: zero diagnostics; force within the fit tolerance; outlines closed and nested (groove bottom inside the pitch line and the flange, outside the bore and its wall); posts and marks at the achieved contacts | 8.0 N | 3.71 N |
| Edits of the default preset (peak 250, 260, 275, 285 N; rise 44 %, 48 %, 50 %; valley 0.9 in, 1.5 in): zero diagnostics | 3 % of the peak | 6.0 N at peak 250 N (7.5 N) |
| Solve: one test per diagnostic code; 100 random states (fast-check) never throw and return plain data | | passes |
| Solve with the first curve point moved by ±1e-12 m, ±5e-10 m and ±1e-9 m, or the last by 1e-9 m (all accepted by validation): the result of the exact state; inverse samples within 1e-9 m of x_b take the brace values | | identical |
| Inverse B·t = √(D² − p_c²) minus p_c'(ψ_c) against the free cable span of the forward model, twin cam | 1e-8 m | 4.8e-12 m |
| Fitted cam without the brace value (10 mm wall, point 2 at 60 N): cable-brace mark at the brace contact of the forward model, 0.47° after ψ_c0, on the cable line to the anchor; lead-in from that contact | 1e-9 m, 1e-9 rad | passes |
| Suggestions applied: the brace-tension force of point 2 at 30 mm and 50 mm preload travel (slope 0.77 and 0.80 of the limit), the cable-clearance hub and let-off limits at let-off 80 %, a lower or 2 in later point 2 for a cable contact behind brace at point 2, point 5 moved 0.5 in earlier for a `cable-radius` miss between points 5 and 6 | | passes |
| Solve of the default preset: coarse and full | 30 ms and 200 ms, tested with a factor 5 margin | about 17 ms and 25 ms after warm-up |

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
| Constrained fit | one knot interval per about 10° (17 to 37), 8 constraint points per interval, margin 1e-6 m, penalty 1e-8·trace on second differences |
| Constrained fit input | \|ψ\| ≤ 1e6 rad, 1 to 200 knot intervals, 1 to 50 constraint points per interval, knot spacing above 1e-9·max(1, \|ψ_0\|, \|ψ_1\|) |
| Quadratic programme | violation tolerance 1e-10 of the row scale, for active constraints of max(row scale, size of the terms); dependence at \|z\|_G ≤ 1e-8 of the cancelled terms; two refinement passes per added constraint; at most 10·(n + m) + 20 steps |
| Fit tolerance | force 3 % of the peak, at least 2 N; draw energy 0.5 % |
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
