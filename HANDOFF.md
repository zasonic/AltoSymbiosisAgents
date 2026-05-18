# Handoff

**Last commit:** _pending_ — `feat(llm): LiteLLM adapter + Pydantic-validated ReaderOutput`
**Branch:** `feat/litellm-pydantic-ai` · **Pushed:** no
**Date:** 2026-05-17

## What just shipped (this branch)

**Stage 1 / item #3** of the Atelier-blueprint plan — the last open Stage-1
item. Adds LiteLLM as a third `LLMClient` implementation for BYO-key
providers (OpenAI / Gemini / Groq / Mistral / DeepSeek / Grok / Cohere /
etc.) and moves the Reader's JSON parsing from hand-rolled regex onto a
Pydantic v2 schema validator. Existing `ClaudeClient` and `LocalClient`
are untouched.

- **`backend/services/llm_litellm_adapter.py`** (new). `LiteLLMClient`
  implements the `LLMClient` ABC: `chat_unified` / `stream_unified` /
  `is_available` / `client_name`. System prompt is prepended as
  `{"role":"system",…}` (OpenAI chat shape, matching `LocalClient`).
  Imports `litellm` lazily so sidecars that never see a BYO-key turn
  never pay the openai+tokenizers warm-up cost. `is_available` requires
  both a model and a key so HubRouter fails closed when the third client
  is misconfigured.
- **`backend/services/hub_router.py`.** `HubRouter.__init__` accepts an
  optional `litellm_client`. `invoke()` dispatches to it when
  `decision.backend == "litellm"`; missing-client falls closed with an
  errored `WorkerResult` rather than silently using Claude.
  `_resolve_backend` recognises `"litellm"` as a model preference and as
  a backend hint. `target_for` emits a `litellm`-typed `ExecutionTarget`
  without the `local`-style 2048-token clamp.
- **`backend/models.py`.** New `_ReaderOutputSchema(BaseModel)` Pydantic
  v2 schema declares the JSON contract for the Reader's output, with
  per-field validators that coerce `null → []`, drop entries that
  aren't `str / int / float`, and ignore unknown keys. `ReaderOutput.from_raw`
  now does a code-fence / JSON-envelope cleanup pass and hands the
  envelope to `_ReaderOutputSchema.model_validate_json`. The dataclass
  form (frozen, tuple fields) is preserved as the runtime contract.
- **`backend/requirements.txt`.** Adds `litellm>=1.50.0,<2.0.0` to the
  lite bundle (Pydantic v2 is already shipped via FastAPI; no new
  Python-side dep for the structured-output validator).
- **Tests.**
  - `backend/tests/test_litellm_adapter.py` (new, 10 tests). Mocks
    `litellm.completion` and pins: system-prompt prepending, empty-system
    omission, missing-usage tolerance, provider-error sentinel,
    streaming token accumulation + final-chunk usage, stream-error
    fallback to non-streaming.
  - `backend/tests/test_reader_output_schema.py` (new, 14 tests). Pins
    cleanup tolerance (fences, surrounding prose, missing braces) AND
    the new Pydantic schema (mixed-type lists, unknown fields, null
    coercion, non-list-as-string drop, half-formed-JSON degradation).
  - `backend/tests/test_hub_router.py` (extended, +9 tests). LiteLLM
    dispatch (non-streaming + streaming + fail-closed), the new
    `_resolve_backend` keyword, the new `target_for` litellm shape.

## Verified

- `cd backend; python -m pytest tests/ -q -x` — **706 passed, 9
  skipped, 13 deselected** in 131.77s (up from 665 baseline; +14
  schema + +10 adapter + +9 hub_router + … all green).
- Plan-specified verification: `pytest tests/test_hub_router.py
  tests/test_reader_actor_split.py tests/test_logprob_data_flow.py`
  → 37 passed, 0 failed.
- Layer-fence test still green (41 parametrized tests).
- `npm run typecheck` clean.

## Stage-1 status (post-this-PR)

- **#3 Pydantic AI + LiteLLM** — DONE (this branch).
- **#4 SignPath OSS code signing** — DEFERRED per scope decision.
- **#5 openapi-typescript codegen** — DONE (merged PR #14).
- **#6 Layer fence** — DONE (merged PR #15).

Stage-1 is complete except for #4, which is gated on the SignPath
Foundation OSS application.

## Next up (per the approved plan)

Stage 2 (Tier-2 surface refit):
- **#7** LangGraph 1.2 `StateGraph` rewrite of the orchestrator,
  preserving CaMeL / HandoffPacket / saga / challenger / ToM / voting /
  governance / hub-router policy verbatim as nodes.
- **#8** Decompose `ChatView.tsx` (2,762 LOC) into composed shadcn/ui
  panels + TanStack Query hooks.
- **#9** Devin-style Plan→Confirm→Execute→Critique drillable timeline
  (extending the existing `_deriveThinkingTimeline`).
- **#10** Visual TeamComposer replacing the 6-field `AgentPanel`.
- **#11** Typed error envelopes across `backend/routes/*`.
- **#12** Finish the bundled `llama-server` binary integration (resolve
  the `TODO(engines)` in `backend/services/bundled_server.py`).

## Walls hit

None this session. Some intentional scope discipline: did NOT add
`pydantic-ai` (the package) as a runtime dep this stage — the Reader's
validator uses Pydantic v2 directly (the same layer Pydantic AI is
built on). Adding the package will land naturally when Stage 2's
LangGraph rewrite begins using `pydantic_ai.Agent` for typed agent
flows. Also did NOT wire the LiteLLM client into Settings / UI — the
adapter and HubRouter branch are infrastructure; the UI exposure is a
focused follow-up.

---

<!-- Earlier handoff content preserved below for cross-session reference. -->

# Earlier session — `feat/layer-fences-test` (commit `8ddac21`)

**Last commit:** 8ddac21 — `test(arch): add backend/core ↔ backend/routes import-fence gate`
**Branch:** `feat/layer-fences-test` · **Pushed:** yes
**Date:** 2026-05-17

## What just shipped (this branch)

**Stage 1 / item #6** of the Atelier-blueprint plan. New
`backend/tests/test_layer_fences.py` codifies the layering between
`backend/core/` (business logic, 2,259 LOC) and `backend/routes/` (HTTP
serialization, 5,061 LOC). The split was reframed in the plan after
exploration confirmed it is NOT duplicate trees — they are layered.

Two AST-walked, parametrized fence rules:

1. **`core/` must not import from `routes`.** 19 core files checked
   (current state: zero violations). Catches `import routes.x`,
   `from routes import y`, `from routes.x import z`.
2. **`routes/` must not import `core.api._*` private modules** (or
   private names like `from core.api import _Foo`). 22 routes files
   checked (current state: zero violations). The expansion of
   `from M import N` into `M.N` entries makes the private-name
   variant detectable even though the module-level part is public.

Tests are intentionally excluded from the fence — fixtures legitimately
reach into private module-level state (e.g.
`system_routes._bundled_download_running`).

## Verified

- `cd backend; python -m pytest tests/test_layer_fences.py -v` —
  41 passed in 0.22s (19 core + 22 routes parametrizations).

## Prior branch (already shipped)

`feat/openapi-typescript-codegen` (commit `75282c5`) — Stage 1 / item #5,
OpenAPI → TS codegen via `openapi-typescript`. See PR at
https://github.com/zasonic/AltoSymbiosisAgents/pull/new/feat/openapi-typescript-codegen

## Next up (per the approved plan)

- **Stage 1 item #3** — Pydantic AI + LiteLLM as a third `LLMClient`
  implementation behind the existing ABC at
  `backend/services/llm_interface.py:11-33`. New
  `backend/services/llm_litellm_adapter.py`; one new branch in
  `hub_router.invoke()`. Pydantic AI also slots into the Phase-6 Reader
  output parser at `chat_orchestrator.py:1650-1705`.
- **Stage 1 item #4** — _skipped per user decision_ until SignPath
  Foundation OSS application is in flight.

## Walls hit

None this session.

---

<!-- Earlier handoff content preserved below for cross-session reference. -->

# Earlier session — `feat/openapi-typescript-codegen` (commit `75282c5`)

**Last commit:** 75282c5 — `feat(codegen): switch API types to OpenAPI + openapi-typescript`
**Branch:** `feat/openapi-typescript-codegen` · **Pushed:** yes
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
