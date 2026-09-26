# Research: measured bows, cam timing, cord stiffness, other cam systems

This page collects the published data on real compound bows and the
extensions of the model that the data and the literature suggest. It holds
the formulation and the delivery plan for cam timing and cord stiffness,
and the feasibility of cam systems other than the twin cam. The model as
built is in [model.md](model.md); the delivery slices are in
[PLAN.md](PLAN.md).

Every number on this page falls into one of these classes:

- **measured**: a measurement read from a primary source;
- **fitted**: a parameter the source's author fitted to a measurement;
- **model output**: a result of the source author's model, run on fitted
  parameters;
- **derived**: computed here by hand from published values, with the
  arithmetic in the text;
- **computed**: computed with the model code of this app;
- **reported**: taken from a search-engine summary of a source that could not
  be opened, and unverified until someone opens the source.

A reference test compares against measured values with their uncertainty
and against model outputs of the same model form; the two kinds are kept
apart in every fixture.

## Source access

The research environment reached github.com, raw.githubusercontent.com,
pypi.org and registry.npmjs.org. Every other host was refused by its
network policy (HTTP 403 on CONNECT), among them arxiv.org, d-nb.info,
www.ias.ac.in, link.springer.com, doi.org, scispace.com, patents.google.com,
ppubs.uspto.gov, www.virtualbow.org, www.bcyfibers.com, www.archerytalk.com,
en.wikipedia.org and web.archive.org. Primary data comes from the
VirtualBow repository on GitHub and from copies of the papers listed under
"Reference data from papers", provided by the user. The repository holds
only values extracted from them, with their citation; it holds no copy of
a paper and no figure.

## Measured data

### Cord material (measured)

Tensile tests by DITF (Deutsche Institute für Textil- und Faserforschung),
July 2018, published in the VirtualBow user manual
(`github.com/bow-simulation/virtualbow`,
`docs/user-manual/src/model-editor-string.md`, commit a5d2c0c). Stiffness is
the secant value per strand, breaking force divided by the elongation at
break.

| Material | Linear density (kg/m) | Breaking force (N) | Elongation at break | Stiffness per strand (N) |
|---|---|---|---|---|
| Dacron B50 | 370e-6 | 180 | 8.5 % | 2 118 |
| Fastflight Plus | 176e-6 | 318 | 2.9 % | 10 966 |
| BCY 452X | 192e-6 | 309 | 2.5 % | 12 360 |

A 24-strand 452X string has an axial stiffness EA of 2.97e5 N. 452X is
1920 dtex (1728 denier). At the fibre moduli of its blend, 67 % Dyneema
SK75 and 33 % Vectran (reported), the fibre-level bound is 18.8 kN per
strand; the braided strand keeps about 66 % of it. Stiffness values for
BCY 8125 and X99 are not measured here.

### Bow data sources

| Source | Content | Numeric data | Status |
|---|---|---|---|
| Tiermas, "A model of the twin-cam compound bow with cam design options", Meccanica 52 (2017) 421–429; author PDF d-nb.info/1110194862/34 | Measured F(x) of a Hoyt "Smoke" twin-cam bow, cams and force curve as figures only | Table values; figures must be digitised | Read, CC BY 4.0 |
| Tiermas, "The limb deformation of the compound bow", Meccanica 52 (2017) 1475; d-nb.info/1106585151/34 | Limb second moment of area (figure), fitted Young's modulus | Text values | Read, CC BY 4.0 |
| Tiermas, round-wheel compound bow, Meccanica 51 (2016) 1201–1207; Sports Eng. 20 (2017) 155–162; PhD thesis, University of Helsinki, 2017 | Round-wheel twin cam "B1" (JahtiJakt 55 lbs): full parameter table, model outputs, measured F(x) as a figure | Tables | Meccanica and Sports Eng. read, CC BY 4.0; thesis summary read |
| "A systematic kinematic analysis and experimental verification of an eccentric twin-cam compound bow", Sādhanā 50 (2025) 167 | Barnett Banshee youth bow: eccentric round cams, torsion-spring limbs (the model form of this app), measured F(x) as a figure | Text values; cam phase and limb angles not published | Read, not open access: numbers only |
| Meyer, "Applications of Physics to Archery", arXiv:1511.02250 | F(x) with hysteresis; string compliance 5.6e-6 1/N from 100 N to 2000 N | Yes | Not opened |
| Zanevskyy, "Compound archery bow asymmetry in the vertical plane", Sports Eng. 15 (2012) 167–175 | Model of a twin-cam bow with measured limb angles at one pose (the "cam angles" of the abstract are limb angles); both cams forced to equal rotation | Tables | Read, CC BY |
| Park, Proc. IMechE P 223 (2009) 139–150; 224 (2010) 141–154; Giulieri and Park, Proc. IMechE P (2025), doi 10.1177/17543371251360603 | Single-cam dynamic model, nocking-point locus, cam timing by bow rotation near full draw | Unknown | Paywalled |
| ArcheryTalk reviews with Easton Bow Force Mapper curves (Mathews Lift X 29.5, Lift 29.5, V3X 29, Phase 4, ARC 30 with two cam modules, Triax, VXR 31.5) | Peak, holding weight, stored energy, power stroke, speed | Scalars; curves are images | Not opened |
| Hanson, "Kinematic Analysis of Cam Profiles Used in Compound Bows", MS thesis, University of Missouri, 2009 | Measured F(x) tables of a PSE Firestorm Lite (hybrid) and a Bear Buckmaster BTR (single cam); limb stiffness 52 lbf/in at the tip | Tables | Read, no licence stated: numbers only |
| PSE patents US 7,699,045 and US 7,891,349 (high limb preload) | Axle offset from unstrung 5.25 in at brace and 6.5 in at full draw; limb tip angle 75° and 100° | Yes | Not opened |

Unverified or refuted items that the plan does not use:

- A second peak of 76.4 lb for the Lift X appears in no source.
- A per-strand break of 110 lb for 452X contradicts the 309 N (69.5 lbf) measured by DITF.
- US 9,453,698 is not confirmed as the Prime parallel-cam patent.

### Parameter ranges (class given per item)

- Stored energy per peak weight of current 70 lb flagship bows (reported):
  1.29 to 1.47 ft·lbf per lbf. Normalised by the power stroke,
  η = W / (F_peak · S) = 0.72 to 0.79 (derived from the reported values).
- Holding weight 11 to 13.6 lb at 69 to 71 lb peak (reported): let-off
  80 % to 84 % (derived).
- Axle travel brace to full draw (derived): 54 mm to 71 mm in the three
  model fits to measured bows of 50 lbf to 58 lbf peak (see "Reference data
  from papers"). The PSE patent offsets (reported) give 32 mm to 50 mm;
  they are not used.
- Cam rotation brace to full draw (reported): 180° to 250° on classic
  designs, 270° to over 360° on newer designs (patent language).
- Dynamic efficiency, arrow energy / stored energy (reported): 80.7 % at a
  360 gr arrow to 88.1 % at 700 gr. Hysteresis (reported): 3 % to 4.5 %.
- Limb stiffness at the axle: 4.4 N/mm and 4.8 N/mm in Tiermas's fits
  (derived from his tables); 9.1 N/mm (52 lbf/in) at the tip of an
  unidentified PSE limb (measured by Hanson).

### The app's default design against these ranges

| Quantity | Default design | Reference | Difference |
|---|---|---|---|
| Axle travel, brace to full draw | 78 mm | 54 mm to 71 mm (model fits) | 1.1× to 1.4× |
| Limb stiffness at the axle | 2.6 N/mm | 4.4 N/mm to 4.8 N/mm (model fits); 9.1 N/mm (Hanson, measured) | 0.3× to 0.6× |
| Limb force at the axle, brace / full draw | 499 N / 702 N | 359 N to 506 N / 554 N to 849 N (model fits) | inside, higher preload share |
| η = W / (F_peak · S) | 0.66 (samples 0.63 to 0.66) | 0.62 (B1), 0.73 (Smoke); 0.72 to 0.79 reported for current 70 lbf bows | inside the fitted range |
| Cam rotation | 224° | 223° (B1); 180° to 360° reported | inside |
| Let-off | 75 % | 67 % (B1), 66 % (Smoke), 80 % to 84 % reported | inside |
| Power stroke at 29 in | 527 mm (20.75 in) | 445 mm (B1), 506 mm (Smoke); 20.3 in to 22.5 in reported | inside |

The default limb is softer and more preloaded than the fitted limbs: it
reaches similar axle forces with 2.6 N/mm and 192 mm of preload travel,
where the fitted limbs use 4.4 N/mm to 4.8 N/mm and 86 mm to 105 mm. Its
axle travel is 10 % to 40 % longer.

The let-off ceiling in [PLAN.md](PLAN.md) ties the axle travel to the cable
lever arm at full draw, which must stay at or above
p_min = r_bore + wall + d_cable/2 = 8.25 mm. A shorter travel at the same
let-off needs a smaller cable lever arm at full draw. Open spiral tracks
(slice 13) let the cable end at a post closer to the axle.

## Reference data from papers

Values below were read from the papers and checked against them a second
time. "Model output" means a result of the author's model, fitted to the
author's measurement; "derived" means computed here from the published
values.

### Tiermas round-wheel bow B1

Sources: Tiermas, "An advanced model of the round-wheel compound bow",
Meccanica 51 (2016) 1201–1207, doi 10.1007/s11012-015-0262-5, Table 1 and
Fig. 7; Tiermas, Sports Engineering 20 (2017) 155–162, doi
10.1007/s12283-017-0225-2, Tables 1 and 2; Tiermas, "The limb deformation
of the compound bow", Meccanica 52 (2017) 1475, doi 10.1007/s11012-016-0485-0.
All three CC BY 4.0. Bow: JahtiJakt 55 lbs.

| Quantity | Value | Kind |
|---|---|---|
| Axle-to-axle at brace e0 | 102.1 cm | measured |
| Riser g (limb base to limb base) | 38.1 cm | measured |
| Limb length L; unstrung limb angle θU | 38.9 cm; 20.5° | measured |
| Lever fraction A | 0.598 | fitted to the limb-tip path |
| Spring constant k | 1032 N/rad; torque stiffness k·A·L = 240.07 N·m/rad | fitted to the measured F(x) |
| String wheel R, cable wheel r, common offset d | 26.8 mm, 19.9 mm, 13.7 mm (cord centre lines) | measured |
| Initial wheel angle α0 | 52.5° | measured |
| Cable anchor | axle of the opposite wheel | model definition |
| Draw at brace D0; full draw DF (from the limb-base line) | 22.8 cm; 67.3 cm | model output |
| Peak; force at full draw; stored energy | 223.9 N; 73.1 N; 61.7 J | model output |
| Limb Young's modulus | 33.75 GPa | fitted |
| Axle travel; axle force brace → full draw | 59.8 mm; 383 N → 648 N | derived |
| Measured F(x), draw and release | Fig. 7 of the 2016 paper, D 0.2 m to 0.8 m | measured, figure; forces read in steps of about 22 N |

The forward model of this app reproduces B1 exactly (computed): mapped to
ATA 1.021 m, brace height 0.2281506 m, full draw x 0.67337 m, lever
0.232622 m at 90° − 41.759° at brace, torsional stiffness 240.0659 N·m/rad,
preload rotation 0.371039 rad and two eccentric circles with phase
232.5°, it gives peak 223.856 N at 0.45807 m, 73.059 N at full draw and
61.680 J. On the author's draw grid the two models differ by at most
2.3e-12 N.

Against the measured points the comparison is provisional. The points
were read from the figure image of Fig. 7 (about 20 draw and 20 release
points) with a reading uncertainty of about ±1 mm and ±0.5 N, ±3 mm where
markers overlap; the measured forces themselves come in steps of about
22 N, the resolution of the scale used. With these readings the draw
series lies 5.3 N above the model on average (rms 6.1 N) and the release
series 4.3 N below (rms 5.4 N), which points to hysteresis, included in
neither model, and cord stretch near full draw. The readings are not
stored; slice 12 stores digitised points with their uncertainty before
any test uses them.

### Tiermas twin-cam bow "Smoke"

Source: Tiermas, "A model of the twin-cam compound bow with cam design
options", Meccanica 52 (2017), doi 10.1007/s11012-016-0395-1, Table 1,
Figs. 8 and 9; PhD thesis summary, University of Helsinki, 2017, Table
7.1. CC BY 4.0. Bow: Hoyt Smoke.

| Quantity | Value | Kind |
|---|---|---|
| e0; g; L; θU | 102.0 cm; 42.0 cm; 39.2 cm; 23° | measured |
| A; k | 0.601; 1135 N/rad (267.40 N·m/rad) | fitted |
| Grip offset h | 9.5 cm | measured |
| Brace and full draw from the grip | 16.3 cm; 66.9 cm | model output |
| Peak; force at full draw; stored energy | 259.3 N; 86.9 N; 96.4 J | model output |
| Axle travel; axle force brace → full draw | 71.2 mm; 506 N → 849 N | derived |
| Cam shapes; measured F(x) | Figs. 8 and 9 | figures, must be digitised |

The cams are published only as a figure, so this bow is no reference test
until the figure is digitised.

### Other sources

- Sādhanā 50 (2025) 167, Barnett Banshee youth bow (not open access,
  numbers only): axle-to-axle 840 mm, limb 300 mm, cam eccentricity 7.2 mm,
  cam sizes 59.0 mm and 35.0 mm (diameters by the photograph and the
  kinematics, though the text calls them radii), spring 145.68 N·m/rad and
  preload 0.328 rad (fitted, from angles that are not self-consistent;
  consistent angles give 143.3 N·m/rad), measured peak about 90 N. The cam
  phase and the limb angles are not published, so the bow is no reference
  test.
- Zanevskyy, Sports Eng. 15 (2012) 167–175 (CC BY): measured limb angles
  0.125 rad (top) and 0.106 rad (bottom) at one pose against 0.124 rad and
  0.110 rad in his model; derived axle travel 53.7 mm at 359 N → 554 N.
  No cam rotation is measured, and his model forces both cams to turn
  equally, so the data checks one pose of a timing analysis at most.
- Hanson, MS thesis, 2009 (numbers only): measured F(x) tables in 1 in
  steps, PSE Firestorm Lite 56.2 lbf peak and 813.4 lbf·in (91.9 J), Bear
  Buckmaster BTR 56 lbf and 814.6 lbf·in (92.0 J), draw measured from the
  front of the arrow shelf, both ending before the valley; limb stiffness
  52 lbf/in (9.11 N/mm) at the tip of an unidentified PSE limb. The thesis
  gives no preload or axle travel: with its stiffness and energy, a
  preload of 1 in gives 78 mm of travel, 3 in gives 50 mm and 5.6 in
  gives 32 mm.

## Cam timing

### Practice (reported)

- **Definition.** A twin-cam bow is in time when both cables touch their
  draw stops at the same draw position.
- **Adjustment.** Timing is set by the power-cable length of each cam:
  - by twisting the cable in a bow press;
  - with screw-adjusted cable anchors (Bowtech TimeLock, US 12,241,716).
- **Tolerance.** No published tolerance in degrees or millimetres was
  found. One practitioner rule is a gap of about a credit card (0.76 mm) at
  the second stop when the first touches.
- **Park.**
  - A flat nocking-point path near full draw gives a firm wall and no
    high or low shots from pulling into the wall by different amounts.
  - Asymmetric degrees of freedom are needed for a straight nock locus.

### Model

Each half keeps its own mirror frame, M = diag(1, −1):

- The top axle is O_t(α_t). The bottom axle, in its own frame, is O_b(α_b).
- The top cable ends at A_t = M·O_b(α_b); the bottom cable ends at
  A_b = M·O_t(α_t).
- The nock is N = (x, y), fixed on the string. It splits the string into
  a top part and a bottom part.

Four cord closures:

```
g_s,t(x, y, θ_t, α_t)  = L_s,t
g_c,t(θ_t, α_t, α_b)   = L_c + ΔL_t
g_s,b(x, −y, θ_b, α_b) = L_s,b
g_c,b(θ_b, α_b, α_t)   = L_c + ΔL_b
```

The partial derivatives use the projections of the forward model, with
the cable term c_a split into its two limb parts. The split is exact in a
symmetric pose:

```
c_a = c_o + c_x,   c_o = u_c·O_α (own limb),   c_x = −u_c·A_α (other limb)
```

With rows (s,t | c,t | s,b | c,b) and columns (θ_t, α_t, θ_b, α_b | y),
the Jacobian of the closures is:

```
[ −p_s,t  −s_a,t    0        0     | −cos φ_t ]
[  p_c,t  −c_o,t    0      −c_x,t  |    0     ]
[   0       0     −p_s,b   −s_a,b  | +cos φ_b ]
[   0     −c_x,b   p_c,b   −c_o,b  |    0     ]
```

The Jacobian and the split are computed: central differences of the real
contact lengths agree to 1.3e-9 in every entry.

Equilibrium with tensions T ≥ 0:

```
∇E + Jᵀ T = 0,   E = E1_t(α_t) + E1_b(α_b)
F   = Σ T_k ∂g_k/∂x
F_y = Σ T_k ∂g_k/∂y     vertical force on the nock
```

Nock modes:

- **Free nock (primary).** y is free and F_y = 0. The result y(x) is the
  static nock travel.
- **Draw board.** y = 0 is imposed and F_y is reported. This mode is pure
  kinematics: 4 closures in 4 unknowns.

A stable nock needs k_y = dF_y/dy > 0.

### Computed on the default design

Top power cable 0.1 mm longer, rigid cords:

| Draw position | brace | 0.30 m | peak 0.41 m | 0.55 m | 0.65 m | full draw 0.69 m |
|---|---|---|---|---|---|---|
| dΔθ/dL_c,t, draw board (°/mm) | 1.38 | 1.46 | 1.11 | 1.31 | 4.00 | 6.65 |
| dΔθ/dL_c,t, free nock (°/mm) | – | 1.49 | 1.14 | 1.36 | 4.17 | 6.91 |
| k_y (N/mm) | – | 3.98 | 3.80 | 3.56 | 3.23 | 3.12 |
| Nock shift, free nock, per 0.1 mm (mm) | – | −0.033 | −0.036 | −0.093 | −0.370 | −0.613 |

Here Δθ = θ_t − θ_b. In the draw-board mode the linearisation gives

```
dΔθ/dL_c,t = s_a / (p_c·s_a + p_s·(c_o − c_x))
```

This agrees with the finite differences to 4 digits. The approximation
1/p_c overstates the sensitivity by 3.6 % to 4.0 %. The sensitivity
peaks at full draw, where p_c is 8.3 mm. The response splits between the
cams: at full draw, 0.1 mm of top cable turns the top cam by +0.349° and
the bottom cam by −0.316°. k_y stays positive over the whole draw, so the
level nock of the symmetric bow is stable.

A symmetric solver with 4 unknowns at y = 0 reproduces `solveForward` to
3e-15 rad. A plain 4×4 Newton over 1500 samples takes 8.1 ms, against
3.37 ms for `solveForward`.

### Draw stops

The cable stop peg touches the free span of the cable. Each cam therefore
gets a stop gap:

```
gap = distance(peg centre, cable line) − (peg radius + d_cable/2)
```

The gap is zero at x_f on the design. When the cams are out of time:

- The first stop contact at x₁ is the first wall.
- With rigid cords the first stop is the wall (computed, slice 10a). The
  stopped cam keeps its gap at 0; the closures then leave one soft
  direction, a rotation of axles, cams and nock about a point at nock
  height that keeps every cord length. It moves x only at second order:
  on the default design with the top cable 1 mm longer, the draw folds
  about 1 µm past x₁.
- With cord stretch (slice 11) the draw continues past x₁ to the second
  stop x₂. The force rise between x₁ and x₂ is the two-stage wall that
  archers report.

The rigid analysis grid ends at x₁, which can lie beyond x_f, and reports
the gap of the other cam there.

### Twist to length

A twisted cord of length L with n twists and an outer fibre at radius r
shortens by

```
dL/dn = −(2πr)²·n / L        (outer fibre, an upper bound)
```

For a 2.5 mm cord (r = 1.1 mm to 1.25 mm), L = 0.9 m and n = 20 to 30,
this gives 1.1 mm to 2.1 mm per twist. With the fibres spread over the
whole cross-section, the mean is half of that. Practitioner reports give
0.8 mm to 1.6 mm per twist (1/16 in per 1 to 2 twists).

The model cannot give one number, because the shortening depends on the
twists already in the cord. The plan therefore takes cable length changes
in millimetres. A millimetres-per-twist factor set by the user can follow
later.

## Cord stiffness

### Model

Each cord gets a linear compliance: C = L0 / EA for each cable, and
C_half = (L_s/2) / EA_s for each string half. The closures become:

```
g_k(q) − L0_k − C_k·T_k = 0
∇E + Jᵀ T = 0
Newton matrix [[H, Jᵀ], [J, −C]],  H = ∇²E + Σ T_k ∇²g_k
```

The following results are computed; no measured bow data is involved.

- **Draw force.** F = 2·T_s·sin φ still holds. The energy balance gains
  the cord energy:
  F dx = d(2·E1 + ½·(2·C_half)·T_s² + C_c·T_c²).
- **Stretched closure identity.** Along the draw,
  p_c θ' − c_a α' = C_c T_c'.
- **Design lengths.** The free lengths are L0 = L_brace − C·T_brace. The
  elastic bow then braces exactly at the design point: 0.44 mm of stretch
  per string half and 0.50 mm per cable at brace.
- **Wall stiffness with the cam on its stop.** The half string acts in
  series with the cable, which is transformed by (s_a/c_a)²:

  ```
  k_wall = 2 sin²φ / (C_half + s_a²/(k_t + c_a²/C_c)) + 2 T_s cos²φ / l_s
  ```

  This formula gives 480.37 N/mm against 480.38 N/mm from the full solve.
  Using the compliance of the whole string instead of the half gives a
  value 46 % too low.

### Effect on the default design, EA = 3e5 N on string and cables (computed)

| Quantity | Rigid | Elastic | Change |
|---|---|---|---|
| Peak force | 270.09 N | 270.29 N | +0.20 N |
| Largest force change (on the let-off drop, x = 0.647 m) | – | – | −1.47 N (−1.5 %) |
| Force at full draw | 69.27 N | 69.51 N | +0.25 N |
| Draw energy | 93.00 J | 92.87 J | −0.13 J |
| Let-off | 74.35 % | 74.28 % | −0.07 points |
| Draw length at the cam stop | – | – | −0.66 mm |
| Wall stiffness | infinite | 480 N/mm | – |

At EA = 1.5e5 N every change doubles.

With equal stiffness on both cables, stretch leaves the bow in time. It
changes timing only through differential stretch, which comes from
different stiffness, different tension or creep:

```
Δθ ≈ (dΔθ/dL_c,t) · (C_c,t·T_c,t − C_c,b·T_c,b + creep_t − creep_b)
```

At full draw, 0.1 mm of differential stretch gives about 0.66° of Δθ.

## Other cam systems

| System | Cords | Coordinates besides x | Symmetric | Design unknowns | Forward model | Design (inverse) | Size (slice 8 = 1.0) |
|---|---|---|---|---|---|---|---|
| Twin cam (built) | string, 2 cables to the opposite axle | θ, α | yes | cable track | built | built, explicit per sample | – |
| Twin cam, out of time | 4 cord parts | θ_t, α_t, θ_b, α_b, y | no | – | slice 10a | not needed | 0.45 |
| Binary (Bowtech, US 7,305,979) | string, 2 cam-to-cam cables | θ, α symmetric; 5 asymmetric | yes | take-up track, with a let-out track set by the user | needs a two-track tangent contact | explicit per sample: T_s p_s = T_c (p_c − p_l) | 0.6 forward, 1.0 design |
| Hybrid (Darton CPS, Hoyt Cam & ½) | string, control cable cam to cam, buss cable to the axle | 5 | no | power track, control track | two-track tangent contact | two tracks: power track solved with the control track set by the user; nock travel reported | 1.5 or more |
| Single cam (US 5,368,006) | lower string, upper string and control over an idler, power cable | θ, α_t, α_b, y | no | power track, control track | idler as an offset track plus an arc term | as hybrid | 1.5 or more |
| Parallel cam (Prime) | twin or binary with a split string | as twin or binary | yes | as twin or binary | unchanged in 2D | unchanged | export only |
| Helical journal (Ravin HeliCoil) | twin-like, wrap over 360° | θ, α | yes | cable track | wrap limit per track | unchanged | 2D small; helical groove in STEP (ISO 10303) 0.5 to 1.0 |
| Draw-length modules, limb stop | twin | θ, α | yes | unchanged | inequality per sample | unchanged | small |

Computed checks of the building blocks:

- **Two-track tangent contact.** The length derivative is ∂L/∂θ_i = σ_i·p_i,
  checked against polygons of 40 000 points for open and crossed belts on
  two ellipses (4 to 5 digits).
- **Idler as an offset track.** The idler reduces to the existing offset
  shape: p − r_i for an open belt, p + r_i for a crossed one. The length
  then needs the idler arc term ∓r_i·θ; without it the cam lever arm is
  wrong by r_i. For an open belt the offset track can bend the wrong way
  where ρ < r_i.
- **Designing two tracks.** With k unknown tracks and k targets (the force
  curve plus, for example, a level nock), k − 1 configuration coordinates
  must be integrated from brace. This holds for k = 1 (today's explicit
  inverse) and for the single cam by counting. It is not proven in
  general.

## Open spiral tracks

A cord touches its track only on the arc it wraps: from its post to the
point where it leaves the track. The force curve depends on that working
arc and on the lead-in and residual wrap at the posts, not on the rest of
the outline. A track can therefore rise like a spiral over most of a turn
and end in a step at its post, so the outline is not convex.

- The working arc stays convex (ρ = p + p'' > 0); the contact solver and
  the length identity keep their equations. The contact solver extrapolates
  an open spline past its knot range and only flags this in
  `contact.inRange`, which no caller reads today; on an open track a
  contact past either end of the working arc is refused with a diagnostic
  instead of producing a force. The inverse model already builds the
  cable track as an open spline over the working arc; only the outline
  closes it with a blend.
- A closed convex track ties opposite sides together: p(ψ) + p(ψ + π) is
  the width of the track in that direction. An open spiral removes this
  link, so the lever arm can change more within one turn and the cam can
  turn further than the 224° of the default design.
- The step replaces the closing blend, whose failure is the
  `closing-blend` diagnostic.
- The cable can end at a post close to the axle, below the present limit
  p_min = r_bore + wall + d/2 (8.25 mm on the default design). The free
  cable span keeps its centreline at least r_bore + d/2 plus a clearance
  from the axle centre, so the cord never touches the axle.
- New checks: no free cord span may touch any part of the outline it does
  not wrap (the step, or an arc of either track, which a convex working arc
  no longer rules out) over the whole draw;
  the minimum wall holds at the step corner; the step does not cross its
  own track; the cam overlap check and the
  middle plate may no longer assume convex outlines.

## Delivery plan

The design path stays symmetric and inextensible. In slices 9 to 12 the
designed cam, its plates and its lengths do not change; slices 13 and 14
change them on purpose (open tracks, retuned samples). Timing and stiffness run as an
analysis of the designed cam in the full solve only, behind a solve option
that Optimise does not set. The coarse solve takes 24 ms to 27 ms against
its 30 ms budget and gets no analysis. Analysis results never change the
design status, never dim the cam and never block exports.

| Slice | Content | Done when | Main tests | Size |
|---|---|---|---|---|
| 9 | Forward compatibility. `migrate` reports dropped unknown keys ("Settings this version does not know were left out: …"). The newer-version messages point to the Version select. The design id of export file names ignores analysis-only sections. | Released as 0.2.0 before slice 10b | Unit: dropped-key notice for files and links, messages, design id stable under an added analysis section; Playwright: open a file with an unknown key | 0.1 |
| 10a | `src/core/analysis.js`, rigid and asymmetric, no user interface. `solve` option `analysis`, off by default and never set by Optimise. Poses per half in the mirror frame. 4×4 Newton on the closures at fixed (x, y); secant on y for F_y = 0. Tensions from Jᵀ T = −∇E. Brace re-solved with x, y, θ and α free. Stop gaps with event bisection; grid to the first stop, the wall with rigid cords, 300 samples to full draw. Outputs y, θ_t, θ_b, Δθ, F, F_y, four tensions, gaps, k_y, dΔθ/dL. `analysis-*` diagnostics: slack cord, fold, wrap at brace, k_y ≤ 0. Section in model.md. | Zero offsets reproduce `solveForward` to 1e-9 relative on the default and the nine samples; median below 25 ms | Regression; equal offsets keep y = 0 to 1e-12; swapped offsets mirror y and flip Δθ; free-body balance per half; ∫F dx = ΔE; dΔθ/dL against the closed form; stop events; one test per diagnostic; performance in a worker | 0.45 |
| 10b | Timing user interface. Settings group "Timing (analysis only)": top cable length change, bottom cable length change, string length change, nocking point above centre (mm). Results block: Δθ at full draw, first stop and gap at the other, nock travel, Δ brace height, Δ draw length, Δ peak, Δ let-off, dΔθ/dL. Timing chart: stacked nock height and Δθ over draw length. Glossary: timing, nock travel, draw stop. Results footnote, report note, user guide and Limitations updated. | Timing edits never change the cam, status or exports; one undo step per edit; share link keeps the offsets | Unit: glossary and guide text, defaults, ranges; Playwright: +1 mm top cable shows Δθ and the stop order, undo, share link, 320 px, axe | 0.4 |
| 10c | String plan with both halves from the analysis pose (brace and x₁); CSV columns θ_t, θ_b, y, four tensions; print report timing section | Drawings match the analysis poses to 1e-9 m | Layout pose tests, DXF round trip, report | 0.25 |
| 11 | Cord stiffness. EA per cord (string, top cable, bottom cable) with a rigid option (`cordModel: rigid | elastic`, no Infinity in JSON). Compliant closures: quasi-Newton before the stops, full Newton with ∂T/∂q at the wall. Free lengths L0 = L − C·T at brace. The draw continues past the first stop to the second stop x₂. Wall stiffness; build lengths free and at 445 N (100 lbf). Material presets from measured data only (452X at 12.36 kN per strand). | EA → ∞ reproduces 10a; equal EA keeps y = 0; differential EA gives Δθ; wall stiffness within 1 % of the closed form | Rigid limit, energy balance with ½·C·T², wall at the stop, convergence at the wall, median below 60 ms | 0.4 |
| 12 | Reference bows. Fixture format `tests/fixtures/reference/<id>.json`: citation, licence, bow inputs in the author's symbols and as app inputs, cam as eccentric circles or free-form values, targets (model outputs and measured points with their uncertainty), optional cam angles and nock height, tolerances, `enforced` flag. Harness in continuous integration (CI). First fixture: Tiermas's round-wheel bow B1 (table values and equations only, no figures). | B1 enforced against Table 2 to half a unit of the last printed digit and against 10 exact forces to 1e-4 N; measured points only when digitised with stated uncertainty | Harness test, B1 fixture | 0.15 |
| 13 | Open spiral tracks. A track may end at a post with a step in the outline instead of the closing blend: the working arc stays convex, the outline is closed by a radial step and the post. Every rule of the present code that assumes a closed convex outline is replaced for the stepped outline: the closed track (`outline.js`), the cam size (`maxDimension`, `metrics.camMaxDimension`, used by the cam-size warning, the results and Optimise) measured on the actual outline, the post and cable-stop placement (`terminationPost`, `cableStopPost`), the middle plate and the hole-inside-hull tests (`export/model.js`), the export fits (`bspline.js`, straight step segments between fitted arcs), and the cam overlap check (`plausibility.js`, distance between non-convex outlines). Clearances: no free cord span touches any part of the outline it does not wrap, on either track and the step included, at every draw position, lead-in and residual wrap included (a convex working arc no longer guarantees this); every free cord span keeps its centreline at least bore radius + d/2 plus a set clearance from the axle centre; every post hole (termination posts and cable stop) keeps at least the minimum wall to the axle bore and to every other hole, and a post that cannot is refused with a diagnostic instead of being moved; minimum wall at the step corner; the whole stepped outline is a simple closed curve (no segment, the step included, crosses or touches a non-adjacent part of its own track), and one that is not is refused with a diagnostic before export; every pose whose contact point lies outside the working arc (`contact.inRange` false) is refused with a diagnostic instead of giving a force. The cable track may end at a post whose free cord line passes closer to the axle than bore radius + wall + d/2 at full draw; the groove itself keeps the present clearance check |X| ≥ r_bore + wall + d/2 (`string-clearance`, `cable-clearance`) at every point of the working arc, lead-in and residual wrap. | A spiral track with a step builds with zero diagnostics; convex tracks give the same results and exports as before | For each replaced rule a stepped-outline case and the unchanged convex case; clearance of every free span to the whole outline, to the axle, and post and stop-post walls to the bore, each with a boundary case on each side of the limit; cam size of a stepped outline against a polygon of the exported outline; groove clearance to the bore on a low-lever-arm spiral with a boundary case on each side; a step that crosses its own working arc fails, one that clears it passes; a draw that reaches past the end of the working arc is refused at the boundary and accepted just inside it; export round trips; cable lever arm below the bore-and-wall limit | 0.6 |
| 14 | Default design and the adult compound-bow samples (target, target with optimised track, hunting, light hunting, short-brace hunting, long draw) retuned towards real limbs: stiffer and less preloaded (4 N/mm to 5 N/mm at the axle instead of 2.6 N/mm), axle travel towards 55 mm to 70 mm, from the reference data above, which covers bows of 50 lbf to 58 lbf peak; open spiral tracks where the let-off needs them. The optimised target sample is run through Optimise again from the retuned target, and its stored values and reported figures are replaced. The youth bow, the crossbow and the FDM mini bow keep their limbs: no reference covers them (the Banshee youth bow of Sādhanā 2025 gives about 1.6 N/mm, 145.68 N·m/rad over a 300 mm lever). | Default and samples build with zero diagnostics and zero warnings; the retuned samples have limb parameters inside the verified range; the optimised target has a smaller cam than the retuned target at no larger force difference | Sample tests, the optimised target against the retuned target (cam size and force difference), performance budgets | 0.3 |
| 15 | Binary cam forward analysis: two-track tangent contact with branch choice, `system.type`; schema version 2 written only for designs other than twin cam. Stiffness of the cam-to-cam timing cables: EA per cable with the compliant closures of slice 11 applied to the two-track contact; slice 17 reuses it for the control cable of the hybrid. | Tangent length matches a polygon to 1e-12 m; binary equals a hand-built case; EA → ∞ reproduces the rigid binary analysis; different EA on the two cables gives the timing difference of the linearised model | Contact branches, symmetry, energy with ½·C·T², rigid limit, differential stiffness | 0.75 |
| 16 | Binary cam design: symmetric inverse with the let-out track set by the user, fit, outline, 7 plates | Binary sample with zero diagnostics | Round trip, exports | 1.0 |
| 17 | Hybrid, then single cam: control track set by the user, power track solved, nock travel reported; the stiffness of the hybrid control cable reuses slice 15 | Decided with the user per slice | – | 1.5 or more each |

Slices 9 to 12 deliver cam timing and cord stiffness; slices 13 and 14
deliver open spiral tracks and the retuned default. Slices 15 to 17 each
need a go-ahead. The stiffness of the cam-to-cam timing cable of binary and
hybrid systems belongs to slice 15.

### Not in the plan yet

- Separate top and bottom limbs (limb bolt turns). The analysis kernel
  takes them without change; they need inputs and data.
- Limb stop, finite peg stiffness, cam lean, hysteresis and dynamics.

### Decisions of the user

- "Timing string stiffness" covers both cords: the power cables of the twin
  cam first (slice 11), the cam-to-cam timing cable with the binary cam
  (slice 15).
- The default design moves towards real limbs (slice 14), after open
  spiral tracks (slice 13).
- Reference data comes from papers the user provides; the repository holds
  only extracted values with their citation and licence, never the papers.
