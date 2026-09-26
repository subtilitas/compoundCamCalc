# Compound Cam Calculator

Web app that designs the string track and the power-cable track of a twin-cam
compound bow. Input: bow geometry, limb stiffness and the draw force curve the
bow should have. Output: the cam track shapes, the string and cable lengths,
and cam plate files for CAD and CNC work (DXF and STEP). It runs in the
browser without a server and is hosted on GitHub Pages:
<https://subtilitas.github.io/compoundCamCalc/> (newest main), with each
release in its own folder, for example `/v0.1.0/`, and a Version select in
the header.

Status: in development. The live page contains the force curve editor, the
settings of the bow and the cam, the solver running in a Web Worker, the
results with the problems and their suggestions, the achieved force curve,
a cam view that turns with the draw position, the string plan with the
build lengths, a loads chart, a File menu with named designs and sample
designs (compound bows, a crossbow, a mini bow for FDM printing), and
exports of the cam plates (DXF and STEP), drawings (DXF) and the force
table (CSV) ([user guide](docs/user-guide.md)). The model is in `src/core`
and described in [docs/model.md](docs/model.md); the remaining stages are
listed in [docs/PLAN.md](docs/PLAN.md). Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

## Coverage

<!-- coverage:start -->
Line coverage of `src/core`, `src/state` and `src/export`: **98 %**
<!-- coverage:end -->

UI code is covered by the Playwright tests and is not part of this figure.

## Development

Requires Node.js 24. Node.js 22.13 or a later 22.x release also works for local use.

```bash
npm ci
npm run dev            # development server on http://localhost:5173/
npm run check          # lint, typecheck, unit tests with coverage, README coverage check
npm run build          # static site in dist/
npm run e2e            # Playwright tests against the built site (run npm run build first)
npm run coverage:update  # rewrite the coverage figure above
node scripts/build-site.js site  # Pages site: main at the root, each v* tag in its folder
```

Playwright needs a Chromium build. In CI, `npx playwright install chromium`
provides it. Locally, `PW_CHROMIUM_PATH` points Playwright to an installed
Chromium executable.

## Repository layout

```
src/core/     model code in SI units, no DOM access: units, force curve,
              support functions, contact, geometry, limb, forward and
              inverse model, constrained fit, outline, solve, bow layout
              and loads
src/state/    project state: schema, presets, validation, store, no DOM access
src/export/   export model and DXF, STEP, CSV and ZIP writers, no DOM access
src/worker/   solver worker
src/ui/       user interface
scripts/      tooling
tests/unit/   Vitest
tests/e2e/    Playwright
docs/         user guide, model description and plan, synced to the GitHub wiki
```

## Workflows

| Workflow | Trigger | Jobs |
|---|---|---|
| CI | pull request, push to `main` | lint and typecheck, unit tests with coverage check, build, end-to-end tests, export files checked with ezdxf, Pages deploy (push to `main` only) |
| Docs | push to `main` touching `docs/`, manual | sync `docs/` to the wiki |
| Release | tag `v*` | CI, tag/version check, GitHub release with the build archive |

## Manual setup

Done once per repository:

1. Settings → Pages → Source: GitHub Actions.
2. Settings → General → Features → Wikis on; create a Home page once.
3. Optional: protect `main` and require the CI jobs `lint`, `unit`, `build`, `e2e`.

## License

MIT, see [LICENSE](LICENSE).
