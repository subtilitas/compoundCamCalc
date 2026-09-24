# Compound Cam Calculator — Plan

Static web app, hosted on GitHub Pages, that computes the string track and
cable track of a twin-cam compound bow from a target draw force curve and
exports the result as DXF and STEP.

## Design decisions

| Topic | Decision |
|---|---|
| Cam system | Twin cam: two identical cams, power cable of each cam anchored to the opposite axle |
| Free degree of freedom | User shapes the string track parametrically (circle, eccentric offset, ellipse); the solver computes the cable track |
| Geometry model | Full 2D: axles move on an arc about the limb pivot; string and cable tangent points solved at every draw step |
| STEP content | Track curves as B-splines plus an extruded cam body (planar faces, extruded B-spline side faces), no grooves |
| Stack | Plain JavaScript ES modules with JSDoc types, Vite, Vitest, Playwright |
| Units | SI internally; defaults: draw length in in, force in N, part dimensions in mm; each quantity switchable (in/mm, N/lbf) |
| Force curve editor | Free points: double-click adds, right-click removes, drag moves; first point fixed at brace height with 0 N, last point at full draw; peak and let-off sliders rescale the curve |
| String plan | Bow layout drawing: side view of string and both cables at brace and full draw, with tangent points, axle positions and lengths |
| Pages deployment | On every push to `main`; tags produce releases with a build archive |

## Model

For cam angle θ the lever arms of the string track, r_s(θ), and of the cable
track, r_c(θ), are the perpendicular distances from the axle to the string and
cable tangent lines. Quasi-static torque balance:

```
T_string · r_s(θ) = T_cable · r_c(θ)
F_nock(x)         = 2 · T_string · sin(φ)
```

φ is the string angle at the nock. Cable take-up drives limb deflection; limb
deflection sets cable tension through the limb stiffness.

Inverse solve: target F(x), limb stiffness and geometry give r_c(θ) for the
chosen r_s(θ). Each track is the envelope of its tangent lines (support
function p):

```
point(ψ) = p(ψ)·n(ψ) + p'(ψ)·t(ψ)
radius of curvature ρ(ψ) = p(ψ) + p''(ψ)
```

A track is manufacturable only where ρ > string radius. The app flags angles
that violate this.

Energy constraint: the area under F(x) from brace to full draw equals the
energy stored in the limbs over the same deflection. Force curve and limb
stiffness therefore fix the required limb deflection; the app reports the
balance.

## Inputs

- Geometry: axle-to-axle length, brace height, draw length, riser length,
  limb length, limb pivot position, limb angle at brace
- Force: peak draw weight, let-off (% or holding weight), valley width, wall
  type (cable stop or limb stop), force curve editor (free points, monotone
  cubic Fritsch–Carlson interpolation), presets
- Limbs: linear stiffness (N/mm) or force-deflection table
- Cam: rotation range (180–320°), string diameter, groove width and depth,
  cam thickness, minimum track radius

## Outputs

- Cam profile view with rotation animation
- String plan: bow layout at brace and full draw with string and cable
  lengths, tangent points and axle positions; exported as its own DXF layer
- Achieved force curve over target, stored energy (J), achieved let-off, cam
  rotation against draw, curvature check
- DXF export (ASCII, one layer per track and per string-plan element; SPLINE
  or LWPOLYLINE at set tolerance)
- STEP export (ISO 10303 AP214): track curves and extruded cam body
- JSON project save and load; parameters encoded in a shareable URL

## Verification

Committed as tests:

- Energy balance: ∫F dx equals limb energy within ±0.5 %
- Circular cams (constant r_s, r_c) reproduce the analytic curve
- Round trip: forward model of a solved cam reproduces the target curve
- Exported DXF and STEP files parse back
- Playwright smoke test: load, drag a control point, export DXF

## Repository layout

```
src/core/     geometry, solver, envelope, interpolation, units (no DOM)
src/export/   DXF and STEP writers
src/ui/       force-curve editor, views, forms
tests/        Vitest unit tests, Playwright end-to-end test
docs/         model description, pushed to the wiki
```

## Workflows

All on Node.js 24 with `actions/checkout@v6`, `actions/cache@v6`,
`actions/upload-artifact@v7`.

- CI: lint, unit tests, coverage, `--check` that fails when the README
  coverage figure drifts; on push to `main` also builds and deploys to
  GitHub Pages
- Docs CI: pushes `docs/` to the GitHub wiki
- Release CI on tags: build, create a GitHub release, attach build archive

## Delivery slices

1. Scaffold, workflows, units, interpolation, force curve editor
2. Forward model (cam + limbs to draw curve), validated on analytic cases
3. Inverse solver, envelope construction, curvature check
4. Bow layout view, string plan, cable lengths
5. DXF export, then STEP export
6. Presets, save/load, URL sharing, wiki docs

## Limitations

- Static model only: arrow speed and dynamic efficiency are not computed
- String and cable stretch ignored in the first version
- Cam lean, axle friction and limb twist not modelled
- Hybrid, binary and single-cam systems not modelled
