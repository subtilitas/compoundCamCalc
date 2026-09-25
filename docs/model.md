# Model

This page describes the static model of a twin-cam compound bow in
`src/core`: the bow geometry, the cam tracks as support functions, the cord
length, the forward model that turns two cam tracks and a limb into a draw
force curve, and the tests that verify it. The inverse model (target force
curve to cable track) builds on the same pieces and follows in a later
stage (see [Plan](PLAN.md)).

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
(status `inside`). A point on the track has no free span: a largest f below
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
  integral. The point (0, 0) is added when the table starts after q = 0.
  Outside the table the moment continues linearly with the end slope. When
  the last row falls, that line reaches M = 0 at q_peak, where E1 is
  largest. The project table (axle travel from brace, force at the axle)
  converts with q = (travel + s_0)/R_L and M = force·R_L.
- Travel mode: the stiffness that stores the draw energy W over the axle
  travel s_f from brace to full draw is k = W / ((s_f + s_0)² − s_0²).
- E1', E1'' and the inverse E1⁻¹ (Newton inside a bracket, residual below
  1e-9 J; closed form α = √(2E/k_t) − α_0 for the linear limb) are
  available for the inverse model. For a tabulated limb the bracket ends at
  q_peak; an energy above E1 there has no inverse and gives NaN, as do a
  negative or non-finite energy. Every limb method returns NaN for a NaN
  argument instead of throwing.

## Validity and diagnostics

The solver never throws on user input. It returns `status`: `ok`,
`infeasible` or `no-convergence`, and a list of diagnostics
`{code, xRange, message}`; xRange gives the first and last nock position of
each run of affected samples.

| Code | Condition |
|---|---|
| `invalid-input` | non-finite or out-of-domain geometry, unknown track kind, unknown limb kind, limb data with a non-positive stiffness or a negative preload rotation, ellipse without finite positive semi-axes, spline with non-finite knots, x grid that is not a non-empty array, not increasing or leaves [x_b, x_f], sample count outside 2 to 20000, iteration limit outside 1 to 200, non-finite termination angle, non-finite limb moment at brace, or any exception while reading the input |
| `brace` | the string cannot leave its track at ψ = 0 towards the nock, the anchor lies inside the cable track, or det = 0 at brace |
| `no-convergence` | a sample does not close within 30 iterations, or a contact is lost; later samples are NaN |
| `slack-string` | T_s ≤ 0 |
| `slack-cable` | T_c ≤ 0 |
| `wrap-exhausted` | a contact passes its termination (σ·(ψ_c − ψ_e) < 0), a contact leaves the defined range of an open track, or a termination lies outside that range |
| `wrap-overlap` | a cord wraps a full turn or more, σ·(ψ_c − ψ_e) ≥ 2π, and would overlap itself in its groove; the string wrap is largest at brace, the cable wrap at full draw |
| `cable-lever` | c_a ≤ 0: limb rotation no longer takes up cable |
| `cam-reversal` | dθ/dx ≤ 0 after brace |
| `non-finite` | the force, a tension, θ or α at a sample, or the limb energy, is not finite (input magnitudes beyond the floating-point range) |

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
| Coarse solve (100 samples) and full solve (1500 samples) | 8 ms and 100 ms, tested with a factor 5 margin | 0.3 ms and 2.7 ms after warm-up |

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
