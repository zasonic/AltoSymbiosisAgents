"""
services/escalation_ladder.py — Local-response escalation rungs.

Fifth extraction in the Layer 3 decomposition. Owns the two-rung ladder
that promotes a local-model response to Claude when local fails:

  Rung 1 — Empty-response gate. A local response under 20 chars is the
           strongest possible signal of failure (the quality scorer
           can't grade an empty input), so it bypasses the quality
           check and escalates directly.
  Rung 2 — Quality gate. The local model self-scores its own answer
           against the user's question. A score below 4/10 escalates.

Bug 4 from the Layer 1 audit (router_log recording stale response_empty
from BEFORE escalation) is honoured here: maybe_escalate() returns a
fresh response_empty alongside the (possibly replaced) response_text
so the orchestrator's router_log write captures the post-escalation
state.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from models import RoutingDecision
from services import margin_proxy
from services.turn_context import TurnContext

log = logging.getLogger("altosybioagents.escalation_ladder")

# Threshold below which a local response is considered "empty enough" to
# bypass the quality scorer and escalate directly. Pre-Layer-3 was inlined
# in the orchestrator's check.
EMPTY_RESPONSE_CHAR_LIMIT = 20

# Below this self-rated score, the local response is judged inadequate
# and we promote to Claude. Stays at 4/10 to match the original behavior.
QUALITY_ESCALATION_THRESHOLD = 4.0

# Trivial messages bypass escalation: a 4-word question shouldn't summon
# Claude even if local stumbles. Original threshold was 5 words.
MIN_WORDS_FOR_ESCALATION = 5


@dataclass
class EscalationOutcome:
    """Result of running the escalation ladder over a worker response.

    All five worker-result fields can change when escalation fires; the
    orchestrator unpacks them into the locals it threads downstream so
    router_log + persistence see the post-escalation state.
    """
    response_text: str
    tokens_in:     int
    tokens_out:    int
    route_model:   str
    model_name:    str
    response_empty: bool      # recomputed AFTER escalation (Bug 4 fix)
    escalated:      bool
    escalation_reason: str = ""


class EscalationLadder:
    """Owns the local-fail → claude-rescue control flow."""

    def __init__(self, hub_router, local_client, settings=None):
        self._hub = hub_router
        self._local = local_client
        # QLPT Stage 1: settings is optional so existing test construction
        # ``EscalationLadder(hub, local)`` keeps working. When None, the
        # margin-proxy flag is treated as False and the ladder behaves
        # exactly as it did pre-Stage-1.
        self._settings = settings
        # Per-call scratchpad: records which scorer produced the latest
        # _quality_score result so maybe_escalate can label the escalation
        # reason for auditability. Reset on every _quality_score call.
        self._last_score_path: str = "self-score"

    def maybe_escalate(
        self,
        ctx: TurnContext,
        decision: RoutingDecision,
        target,
        full_system: str,
        messages: list,
        response_text: str,
        tokens_in: int,
        tokens_out: int,
        route_model: str,
        model_name: str,
        had_error: bool,
        split_enabled: bool,
    ) -> EscalationOutcome:
        """Run the two-rung ladder. Always returns an EscalationOutcome.

        ``split_enabled`` short-circuits the entire ladder because the
        Reader/Actor split owns its own escalation; the legacy gate would
        re-invoke with full_system, leaking RAG past the architectural
        wall. ``had_error`` likewise skips: a worker-level error already
        produced an "[Error: ...]" placeholder we don't replace here.
        """
        response_empty = self._is_empty(response_text)
        outcome = EscalationOutcome(
            response_text=response_text,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            route_model=route_model,
            model_name=model_name,
            response_empty=response_empty,
            escalated=False,
        )
        if not self._eligible(
            ctx=ctx, target=target, had_error=had_error,
            split_enabled=split_enabled,
        ):
            return outcome

        if response_empty:
            log.info("Local response empty — escalating to Claude")
            self._escalate(
                outcome, decision, full_system, messages, target, ctx.on_token,
                reason="local response empty; escalated",
            )
        else:
            score = self._quality_score(
                ctx.user_message, response_text,
                logprobs=ctx.worker_logprobs,
            )
            if score is not None and score < QUALITY_ESCALATION_THRESHOLD:
                log.info("Local response scored %s — escalating to Claude", score)
                # QLPT Stage 1: label which scorer produced the score so
                # offline analysis can split escalation rates by path
                # without having to re-derive them from telemetry. Keep
                # the bare reason string for the self-score path so the
                # existing test_escalation_ladder.py assertions on the
                # exact string keep passing unmodified.
                if self._last_score_path == "margin proxy":
                    reason = (
                        "local response failed quality gate (margin proxy); "
                        "escalated"
                    )
                else:
                    reason = "local response failed quality gate; escalated"
                self._escalate(
                    outcome, decision, full_system, messages, target, ctx.on_token,
                    reason=reason,
                )

        # Bug 4: response_empty must reflect the POST-escalation text, not
        # the pre-escalation value, so router_log doesn't claim the turn
        # was empty when escalation produced a real answer.
        outcome.response_empty = self._is_empty(outcome.response_text)
        return outcome

    # ── Internals ───────────────────────────────────────────────────────

    @staticmethod
    def _is_empty(text: str) -> bool:
        return len((text or "").strip()) < EMPTY_RESPONSE_CHAR_LIMIT

    def _eligible(
        self, ctx: TurnContext, target, had_error: bool, split_enabled: bool,
    ) -> bool:
        if had_error:
            return False
        if split_enabled:
            return False
        if target.backend != "local":
            return False
        if self._local is None:
            return False
        try:
            if not self._local.is_available():
                return False
        except Exception:
            return False
        if len(ctx.user_message.split()) < MIN_WORDS_FOR_ESCALATION:
            return False
        return True

    def _escalate(
        self,
        outcome: EscalationOutcome,
        decision: RoutingDecision,
        full_system: str,
        messages: list,
        target,
        on_token,
        reason: str,
    ) -> None:
        """Re-invoke through hub_router with backend forced to claude.

        Mutates ``outcome`` in place. Failures are swallowed so a flaky
        Claude call can't regress a working-but-weak local response.
        """
        try:
            escalation = RoutingDecision(
                agent_id=decision.agent_id,
                backend="claude",
                score=decision.score,
                reasoning=reason,
                used_fallback=False,
                skill_matched=decision.skill_matched,
            )
            esc_result = self._hub.invoke(
                escalation, full_system, messages,
                max_tokens=target.max_tokens, on_token=on_token,
            )
        except Exception as exc:
            log.debug("Escalation to Claude failed: %s", exc)
            return
        outcome.response_text = esc_result.text
        outcome.tokens_in = esc_result.input_tokens
        outcome.tokens_out = esc_result.output_tokens
        outcome.route_model = "claude"
        outcome.model_name = esc_result.model_name
        outcome.escalated = True
        outcome.escalation_reason = reason

    def _quality_score(
        self,
        user_message: str,
        response_text: str,
        logprobs: tuple[float, ...] | None = None,
    ):
        """Quality score on the same 0..10 scale, or None if unscorable.

        QLPT Stage 1 decision tree:
          1. If ``escalation_use_margin_proxy`` is True AND the worker
             produced logprobs, score with services.margin_proxy. The
             margin-proxy path is pure and ~free (no extra LLM call).
          2. Otherwise, run the legacy self-score path: a second local
             LLM call that asks the model to rate its own answer. Stays
             on local-first to keep the gate cheap; Claude is the
             rescue, not the judge.

        Returns None on any error so the caller skips escalation
        (graceful degradation).
        """
        # Reset the audit trail before either branch so a stale value
        # from a previous turn can't leak into the escalation reason.
        self._last_score_path = "self-score"

        if (
            self._settings is not None
            and self._settings.get("escalation_use_margin_proxy", False)
            and logprobs
        ):
            params_override = self._settings.get("escalation_margin_proxy_params", None)
            try:
                score = margin_proxy.score_from_logprobs(
                    list(logprobs), params_override=params_override,
                )
            except Exception as exc:
                log.debug("margin_proxy.score_from_logprobs raised: %s", exc)
                score = None
            if score is not None:
                self._last_score_path = "margin proxy"
                if self._settings.get("escalation_log_margin_proxy_scores", False):
                    # Log the raw array alongside the score so the data
                    # can be re-aggregated offline (geometric mean,
                    # min-token, etc.) without re-running inference.
                    log.info(
                        "margin_proxy score=%.3f logprobs_len=%d raw=%s",
                        score, len(logprobs), list(logprobs),
                    )
                return score
            # Margin proxy returned None (e.g. empty / non-numeric input).
            # Fall through to the self-score path so the gate still fires.

        try:
            from services.task_artifacts import local_first_call
            quality_raw = local_first_call(
                self._local, None,  # local only, no Claude fallback for the score
                "Rate this response's relevance and completeness for the given question. "
                "Respond with ONLY a JSON: {\"score\": 0-10, \"reason\": \"...\"}",
                f"QUESTION: {user_message[:300]}\nRESPONSE: {(response_text or '')[:500]}",
                max_tokens=100,
            )
        except Exception:
            return None
        if not quality_raw:
            return None
        qstart = quality_raw.find("{")
        qend = quality_raw.rfind("}")
        if qstart == -1 or qend == -1 or qend <= qstart:
            return None
        try:
            quality = json.loads(quality_raw[qstart:qend + 1])
        except (ValueError, TypeError):
            return None
        # Coerce score to a number; a model emitting {"score": "low"}
        # would otherwise raise TypeError on the comparison and silently
        # disable escalation via the outer `except Exception: pass` swallow.
        try:
            return float(quality.get("score", 10))
        except (TypeError, ValueError):
            return 10.0
