# Compound Cam Calculator

Web app that designs the string track and the power-cable track of a twin-cam
compound bow. Input: bow geometry, limb stiffness and the draw force curve the
bow should have. Output: the cam track shapes, the string and cable lengths,
and cam plate files for CAD and CNC work (DXF and STEP). It runs in the
browser without a server and is hosted on GitHub Pages:
<https://subtilitas.github.io/compoundCamCalc/>.

Status: not usable yet. The live page is a placeholder; the calculator is
built in stages listed in [docs/PLAN.md](docs/PLAN.md). Changes are recorded
in [CHANGELOG.md](CHANGELOG.md).

## Coverage

<!-- coverage:start -->
Line coverage of `src/core`, `src/state` and `src/export`: **100 %**
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
```

Playwright needs a Chromium build. In CI, `npx playwright install chromium`
provides it. Locally, `PW_CHROMIUM_PATH` points Playwright to an installed
Chromium executable.

## Repository layout

```
src/core/     model code in SI units, no DOM access
src/ui/       user interface
scripts/      tooling
tests/unit/   Vitest
tests/e2e/    Playwright
docs/         documentation, synced to the GitHub wiki
```

## Workflows

| Workflow | Trigger | Jobs |
|---|---|---|
| CI | pull request, push to `main` | lint and typecheck, unit tests with coverage check, build, end-to-end tests, Pages deploy (push to `main` only) |
| Docs | push to `main` touching `docs/`, manual | sync `docs/` to the wiki |
| Release | tag `v*` | CI, tag/version check, GitHub release with the build archive |

## Manual setup

Done once per repository:

1. Settings → Pages → Source: GitHub Actions.
2. Settings → General → Features → Wikis on; create a Home page once.
3. Optional: protect `main` and require the CI jobs `lint`, `unit`, `build`, `e2e`.

## License

MIT, see [LICENSE](LICENSE).
