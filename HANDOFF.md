# Handoff

**Last commit:** _pending_ — `feat(codegen): switch API type codegen to OpenAPI → openapi-typescript`
**Branch:** `feat/openapi-typescript-codegen` · **Pushed:** no
**Date:** 2026-05-17

## What just shipped

**Stage 1 / item #5** of the Atelier-blueprint plan
(`C:\Users\dmuhl\.claude\plans\altosymbiosisagents-atelier-synthetic-wirth.md`).
Layer C5 (API type codegen) now dumps FastAPI's live `app.openapi()` schema
and runs `openapi-typescript` against it instead of walking allowlisted route
modules and calling `pydantic2ts` + `json-schema-to-typescript`. The route
table is now the single source of truth.

- **`backend/server.py`.** Extracted `ROUTER_SPECS` (the 20-tuple of
  `(dotted_module, prefix)`) and `register_routers(app)` as module-level
  helpers; `build_app()` now calls `register_routers(app)` instead of the
  20-line inline `include_router` block. `OPENAPI_TITLE` and
  `OPENAPI_VERSION` are surfaced as constants so the codegen produces a
  schema whose info block matches the running sidecar.

- **`build-scripts/generate_api_types.py`.** Full rewrite. Imports
  `register_routers` + the two metadata constants from `server`, builds a
  bare `FastAPI` instance, dumps `app.openapi()` to a temp JSON, and shells
  out to `npx --no-install openapi-typescript <input> --output <output>`.
  Cross-platform npx resolution (`npx.cmd` on Windows). Deterministic across
  runs — verified via SHA256.

- **Dependency swap.** Dropped `pydantic-to-typescript` from
  `backend/requirements-dev.txt` and `json-schema-to-typescript` from
  `package.json`. Added `openapi-typescript ^7.4.0` (resolved to 7.13.0).

- **Drift gate (`.github/workflows/tests.yml`).** Updated the comment
  blocks describing the toolchain; the gate itself is unchanged
  (`python build-scripts/generate_api_types.py` + `git diff --exit-code`).

- **Generated output (`desktop-ui/api/generated.d.ts`).** Grew from 256
  lines (flat Pydantic-only `interface` declarations) to 6,776 lines
  covering `paths`, `components.schemas`, and `operations`. Nothing in the
  renderer currently imports from this file (the type surface is being
  built up incrementally), so the larger output is purely opportunity, not
  regression.

## Verified

- `python build-scripts/generate_api_types.py` — wrote 124 path entries +
  59 component schemas; SHA256 stable across re-runs.
- `npm run typecheck` — both `tsconfig.node.json` and `tsconfig.web.json`
  clean.
- `cd backend && python -m pytest tests/ -q -x` — 632 passed, 9 skipped,
  13 deselected.
- `npm run test:frontend` — 11 files / 94 tests pass.
- `npm run build` — clean build in 15.9s.
- `npm run bundle-size` — +5.56% from 2026-05-12 baseline (within 10%
  tolerance, no new renderer code shipped — the delta is npm graph churn
  from openapi-typescript install).
- Pre-existing local-only failure: `node dev/run-ts-prune.cjs` crashes
  with `spawnSync npx ENOENT` on Windows. Reproduces on a clean checkout
  of `main` (verified via `git stash` and re-run) — not a regression
  from this branch. CI on Ubuntu is unaffected.

## Next up (per the approved plan)

- **Stage 1 item #3** — Pydantic AI + LiteLLM as a third `LLMClient`
  implementation behind the existing ABC at
  `backend/services/llm_interface.py:11-33`. New
  `backend/services/llm_litellm_adapter.py`; one new branch in
  `hub_router.invoke()`. Pydantic AI also slots into the Phase-6 Reader
  output parser at `chat_orchestrator.py:1650-1705`.
- **Stage 1 item #6** — `backend/tests/test_layer_fences.py` AST-walk test
  asserting `backend/routes/*.py` may import `backend/core/api/*` but not
  the reverse, and neither imports the other's private helpers.
- **Stage 1 item #4** — _skipped per user decision_ until SignPath
  Foundation OSS application is in flight.

## Walls hit

None this session.
