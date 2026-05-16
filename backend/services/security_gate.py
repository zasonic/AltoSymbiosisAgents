"""
services/security_gate.py — Per-turn structural security enforcement.

Fourth extraction in the Layer 3 decomposition. Owns two concerns
that the orchestrator used to inline in ~95 lines of nested try/except:

  1. Context quarantine: wrap RAG chunks with provenance tags + swap
     the raw "Reference documents" section in the system prompt for a
     "Retrieved Context (Quarantined)" header.
  2. Deterministic rule engine: strip known structural-injection
     patterns (enforce_context_rules) and count violations.

Caller contract:
  result = gate.evaluate(ctx, full_system, mem, target)
  if result.blocked:
      # surface a security-abort ChatResult to the user; emit already
      # ran inside evaluate()
      return ...
  full_system = result.full_system  # may have been mutated for quarantine
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from services.security_engine import (
    quarantine_chunks, render_quarantined_context, enforce_context_rules,
    SecurityAssessment,
)
from services.turn_context import TurnContext

log = logging.getLogger("altosybioagents.security_gate")


@dataclass
class SecurityResult:
    """Outcome of SecurityGate.evaluate()."""
    blocked:    bool
    full_system: str
    assessment: SecurityAssessment


class SecurityGate:
    """Owns the per-turn quarantine + rule-engine pipeline."""

    # ── Public API ──────────────────────────────────────────────────────

    def evaluate(
        self,
        ctx: TurnContext,
        full_system: str,
        mem,
        target,
    ) -> SecurityResult:
        """Run the security pipeline for one turn.

        Returns a SecurityResult. ``blocked`` is currently always False —
        the structural pipeline performs quarantine + rule enforcement
        but does not gate the turn.
        """
        security = SecurityAssessment()
        try:
            full_system = self._apply_quarantine(security, full_system, mem, ctx)
            full_system = self._enforce_rules(security, full_system, ctx)
            ctx.emit("security_assessment", security.to_event())
        except Exception as exc:
            # Security pipeline failures are non-fatal — original behaviour
            # was to fall through to model invocation rather than crash the
            # turn. We preserve that contract here.
            log.debug("Security engine non-fatal error: %s", exc)

        return SecurityResult(
            blocked=False, full_system=full_system, assessment=security,
        )

    # ── Internals ───────────────────────────────────────────────────────

    @staticmethod
    def _apply_quarantine(
        security: SecurityAssessment,
        full_system: str,
        mem,
        ctx: TurnContext,
    ) -> str:
        """Wrap RAG chunks with provenance tags + swap the system-prompt header."""
        if not mem.rag_chunks:
            return full_system
        quarantined = quarantine_chunks(
            mem.rag_chunks,
            source_type="user_document",
            source_id=ctx.conversation_id,
        )
        security.quarantined_chunks = len(quarantined)
        if not render_quarantined_context(quarantined):
            return full_system
        raw_rag = mem.to_system_suffix()
        if raw_rag and "## Reference documents the user has provided" in full_system:
            full_system = full_system.replace(
                "## Reference documents the user has provided",
                "## Retrieved Context (Quarantined)",
            )
        return full_system

    @staticmethod
    def _enforce_rules(
        security: SecurityAssessment,
        full_system: str,
        ctx: TurnContext,
    ) -> str:
        """Run the deterministic rule engine; count any violations."""
        full_system, violations = enforce_context_rules(
            full_system, source_label=ctx.conversation_id[:8],
        )
        security.context_violations = violations
        return full_system
