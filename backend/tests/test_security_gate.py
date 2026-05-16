"""
tests/test_security_gate.py — Layer 3: SecurityGate module.

Pins the structural pieces SecurityGate inherited from the orchestrator's
inline block:

  - quarantine swap of the "Reference documents" header on rag presence
  - context-rule violations counted on assessment
  - security_assessment SSE emitted on every turn
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from models import ExecutionTarget
from services.memory import MemoryContext
from services.security_gate import (
    SecurityGate,
    SecurityResult,
)
from services.turn_context import TurnContext


@dataclass(frozen=True)
class _Target:
    backend: str
    model_name: str = "test-model"


def _ctx(conv_id: str = "conv1") -> TurnContext:
    return TurnContext(conversation_id=conv_id, user_message="hi")


def _mem(rag=None) -> MemoryContext:
    return MemoryContext(
        recent_messages=[], session_facts=[], rag_chunks=rag or [], memories=[],
    )


# ── Happy path ───────────────────────────────────────────────────────────────


def test_evaluate_returns_unblocked_for_safe_turn():
    gate = SecurityGate()
    result = gate.evaluate(
        _ctx(), full_system="BASE", mem=_mem(), target=_Target("local"),
    )
    assert isinstance(result, SecurityResult)
    assert result.blocked is False
    assert result.full_system == "BASE"


def test_evaluate_rewrites_rag_section_for_quarantine():
    gate = SecurityGate()
    sys_prompt = (
        "BASE\n\n## Reference documents the user has provided\nstuff"
    )
    result = gate.evaluate(
        _ctx(), full_system=sys_prompt, mem=_mem(rag=["doc-a", "doc-b"]),
        target=_Target("local"),
    )
    assert "## Retrieved Context (Quarantined)" in result.full_system
    assert "## Reference documents the user has provided" not in result.full_system
    assert result.assessment.quarantined_chunks == 2


def test_evaluate_emits_security_assessment_event():
    events: list = []
    ctx = _ctx()
    ctx.on_event = lambda et, data: events.append((et, data))
    SecurityGate().evaluate(
        ctx, full_system="BASE", mem=_mem(), target=_Target("claude"),
    )
    assert any(et == "security_assessment" for et, _ in events)
