# Handoff

**Last commit:** 1c06d93 — feat(audit): render unrendered SSE events in chat thinking timeline
**Branch:** main · **Pushed:** no
**Date:** 2026-05-17

## What just shipped

Audit verification pass + targeted closures from the v6 audit punch list.

- **Gap 1 — SSE thinking timeline (`desktop-ui/components/ChatView.tsx`).**
  Added [`_deriveThinkingTimeline`](desktop-ui/components/ChatView.tsx#L170)
  and a [`ThinkingTimeline`](desktop-ui/components/ChatView.tsx) component
  that renders every backend SSE event the chat view previously ignored:
  `checkpoint_state` (rolled_back only), `pipeline_step_retry`,
  `challenger_started/_complete`, `memory_recalled`, `compound_query_detected`,
  `vision_unavailable`, `governance_blocked`, `camel_started/_complete`,
  `reader_complete`, `reasoning_started/_complete`, `alignment_warning`,
  `security_assessment`, `security_scan`, `route_decided`. Each row carries
  `role="status"` and lives inside the bubble's existing `aria-live="polite"`
  region. Intentional drops documented in the comment block.

- **Gap 2 — Dead parameter
  ([backend/services/health_monitor.py:70](backend/services/health_monitor.py#L70)).**
  Removed unused `app_root` from `check_rag_index` and updated the lone caller
  in `check_all`. Updated the stale "ChromaDB" docstring to "sqlite-vec"
  (the actual vector backend).

- **Docstring drift.** Replaced live (non-legacy) "ChromaDB" references with
  "sqlite-vec" in `rag_index.py`, `semantic_search.py`,
  `memory/_context.py`, `core/api/__init__.py`, `core/api/memory.py`.
  Historical comments in `backend/requirements.txt` and `legacy/` were left
  alone — they document why the migration happened.

## Verified

- `npx tsc --noEmit -p tsconfig.web.json` clean.
- `npx tsc --noEmit -p tsconfig.node.json` clean.
- `npx vitest run` → 11 files / 94 tests pass.
- `health_monitor.check_all(skip_api=True)` smoke-runs end-to-end on the
  workstation env.

## Audit items confirmed already wired (no changes needed)

- `general_assistant` — no references anywhere; 6 builtins.
- Consolidated modules (`pipeline.py` 1125 LOC, `security_engine.py` 722 LOC,
  `memory/`, `camel/`, `_high_stakes_consensus`) — all real, substantial,
  reached on the hot path.
- Anti-regression: `HandoffPacket`+`handoff_log`, `refresh_team_tom` + ToM
  blocks, `governance.check_tool_call`/`check_token_budget` (orchestrator
  pre-invocation + CaMeL adapter per tool call), `_run_challenger` →
  `debate_log` with critique fed into synthesis prompt
  ([`pipeline.py:476-494`](backend/services/pipeline.py#L476)),
  `quarantine_chunks` + `render_quarantined_context` on RAG/attachments,
  BM25 + sqlite-vec + `reciprocal_rank_fusion`, `cache_control: ephemeral`
  on system prompt, `knowledge_triples` INSERT in `_extract_triples`.
- Runtime IPC contract (127.0.0.1:0 + `PORT=` + `randomUUID()` Bearer +
  `/shutdown` then kill + `contextIsolation:true` / `nodeIntegration:false` /
  `sandbox:true`) — confirmed in
  [`desktop-shell/sidecar.ts`](desktop-shell/sidecar.ts) and
  [`backend/server.py`](backend/server.py).

## Audit items the audit was wrong about

- **"token-efficient-tools beta header"** — Anthropic docs (May 2026
  migration guide) explicitly state Claude 4+ models have token-efficient
  tool use built in; the legacy header has no effect. Not a gap.
- **"ChromaDB hybrid retrieval"** — project migrated to fastembed + sqlite-vec.
  Substance (BM25 + vector + RRF) is preserved.
- **"setup.bat → setup.ps1 + winget chain + pyinstaller --onedir"** — current
  install path is `START_HERE.bat` (dev) + Electron-builder (production) +
  first-launch Miniconda bootstrap (NSIS silent install + SHA256 pin) at
  [`desktop-shell/bootstrap/miniconda.ts:50`](desktop-shell/bootstrap/miniconda.ts#L50).

## Next up — audit / debug / improve

- **ChatView SSE timeline coverage tests.** The new
  `_deriveThinkingTimeline` has no direct unit tests. Add a couple of
  vitest cases covering: (a) duplicate `route_decided` collapses to the
  latest, (b) `checkpoint_state` `provisional`/`committed` are dropped,
  `rolled_back` renders, (c) `camel_complete` with `error` flips to error
  state. The existing ChatView.test.tsx has the harness.
- **`call_with_tools` is dead code**
  ([backend/services/claude_client.py:258](backend/services/claude_client.py#L258)).
  Nothing in the project calls it. Either wire it into a real path
  (Anthropic native tool-use loop instead of the prompt-listed MCP catalog)
  or delete it.
- **`get_stale_memories` API**
  ([backend/core/api/memory.py:40](backend/core/api/memory.py#L40)) calls
  `semantic_search.get_stale_memories` — confirm that function still exists
  on the sqlite-vec backend; the old ChromaDB-era code may have shipped
  with that name and not been re-implemented.
- **Documentation pass.** `requirements.txt` comments and `legacy/` keep
  the historical record. Anything user-facing
  (`README.md`, `START_HERE.md`, `docs/`) should be re-read for stale
  ChromaDB / sentence-transformers mentions before any release.

## Walls hit

None this session — every gap I attempted to close was closeable with the
current code. The only deferred work is the in-place
`_deriveThinkingTimeline` test backfill (above), which is additive and
better as its own focused PR.
