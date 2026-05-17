import { useEffect, useMemo, useRef, useState } from "react";

import { Agents, Teams, type TeamRow } from "@/api/client";
import { useAppStore } from "@/stores/appStore";

export interface AgentRow {
  id: string;
  name: string;
  description?: string;
  role?: string;
  model_preference?: string;
  is_builtin?: boolean | number;
}

// What the parent (ChatView) needs to apply the pick.
//   agentIds = []  → clear binding
//   agentIds = [x] → solo agent
//   agentIds = 2+  → ad-hoc team
//   teamId set     → preset team (overrides agentIds)
export interface RosterPick {
  agentIds: string[];
  teamId?: string;
}

interface Props {
  // The current binding from the conversation: an agent id, a team id, or
  // neither. Empty strings = unset.
  agentId: string;
  teamId: string;
  // Apply the user's selection. Resolves once persisted; the parent will
  // typically refresh the conversation row from the response.
  onApply: (pick: RosterPick) => Promise<void>;
  disabled?: boolean;
}

export function RosterPicker({ agentId, teamId, onApply, disabled = false }: Props) {
  const sidecarReady = useAppStore((s) => s.sidecarStatus?.status === "ready");
  const pushToast = useAppStore((s) => s.pushToast);

  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  // Local in-popover selection — committed only on Apply so transient
  // multi-clicks don't thrash the backend.
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [draftTeamId, setDraftTeamId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [saveName, setSaveName] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);

  const reload = async () => {
    try {
      const [agentList, teamList] = await Promise.all([
        Agents.list(),
        Teams.list(),
      ]);
      setAgents((agentList ?? []) as AgentRow[]);
      setTeams((teamList ?? []).filter((t) => !t.is_adhoc));
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not load agents",
      });
    }
  };

  useEffect(() => {
    if (!sidecarReady) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidecarReady]);

  // When the picker opens, seed the draft from the current binding so the
  // user sees what's already applied and can edit it in place.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSavingTeam(false);
    setSaveName("");
    setDraftTeamId(teamId || "");
    if (teamId) {
      // Hydrate the draft from the team's members so the chips reflect it.
      Teams.get(teamId)
        .then((rsp) => {
          const members = (rsp as { members?: { id: string }[] })?.members ?? [];
          setDraft(new Set(members.map((m) => m.id)));
        })
        .catch(() => setDraft(new Set()));
    } else if (agentId) {
      setDraft(new Set([agentId]));
    } else {
      setDraft(new Set());
    }
  }, [open, agentId, teamId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === agentId),
    [agents, agentId],
  );
  const activeTeam = useMemo(
    () => teams.find((t) => t.id === teamId),
    [teams, teamId],
  );

  const pillLabel = (() => {
    if (teamId) return activeTeam?.name ?? "Team";
    if (agentId) return activeAgent?.name ?? "Agent";
    return "No agent";
  })();

  const pillIcon = teamId ? "◆" : "●";

  const filtered = query.trim()
    ? agents.filter((a) => {
        const q = query.trim().toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          (a.description ?? "").toLowerCase().includes(q) ||
          (a.role ?? "").toLowerCase().includes(q)
        );
      })
    : agents;

  const toggleAgent = (id: string) => {
    // Clicking an agent clears any preset-team draft — the user is now
    // building an ad-hoc roster.
    setDraftTeamId("");
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pickTeam = (tid: string) => {
    setDraftTeamId(tid);
    // Hydrate chip state from members for visual feedback.
    Teams.get(tid)
      .then((rsp) => {
        const members = (rsp as { members?: { id: string }[] })?.members ?? [];
        setDraft(new Set(members.map((m) => m.id)));
      })
      .catch(() => {});
  };

  const apply = async () => {
    setBusy(true);
    try {
      const ids = Array.from(draft);
      // If a saved team was picked AND no chips were tweaked, route via teamId
      // so the conversation binds to the saved preset rather than spawning
      // an ad-hoc duplicate.
      if (draftTeamId && ids.length >= 2) {
        await onApply({ agentIds: [], teamId: draftTeamId });
      } else {
        await onApply({ agentIds: ids });
      }
      setOpen(false);
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not apply roster",
      });
    } finally {
      setBusy(false);
    }
  };

  // Save-as-team flow: only meaningful when the conversation already binds
  // to an ad-hoc team (teamId set + activeTeam is undefined, meaning the
  // saved-teams list doesn't include it because is_adhoc=1).
  const canSaveCurrent =
    !!teamId && !teams.find((t) => t.id === teamId);

  const saveCurrentAsTeam = async () => {
    if (!teamId || !saveName.trim()) return;
    setBusy(true);
    try {
      await Teams.saveAdhoc(teamId, saveName.trim());
      pushToast({ kind: "success", text: `Saved "${saveName.trim()}"` });
      setSavingTeam(false);
      setSaveName("");
      await reload();
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const draftSize = draft.size;
  const draftSummary = (() => {
    if (draftTeamId) {
      const t = teams.find((x) => x.id === draftTeamId);
      return t ? `Preset team: ${t.name}` : "Preset team";
    }
    if (draftSize === 0) return "No agent";
    if (draftSize === 1) {
      const onlyId = Array.from(draft)[0];
      return agents.find((a) => a.id === onlyId)?.name ?? "1 agent";
    }
    return `Team of ${draftSize}`;
  })();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || !sidecarReady}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full
                   bg-bg-1 text-ink hover:shadow-soft-2 shadow-soft-1 transition
                   disabled:opacity-50 disabled:cursor-not-allowed"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="roster-picker-pill"
        title={activeTeam?.description ?? activeAgent?.description ?? "Pick agents or a team"}
      >
        <span className="text-accent" aria-hidden>{pillIcon}</span>
        <span className="truncate max-w-[200px]">{pillLabel}</span>
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="3 5 6 8 9 5" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[28rem] max-h-[70vh] overflow-y-auto
                     glass z-30 p-3"
          role="dialog"
          aria-label="Pick agents or a team"
          data-testid="roster-picker-dropdown"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs text-ink-faint">{draftSummary}</div>
            {canSaveCurrent && !savingTeam && (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setSavingTeam(true)}
                data-testid="roster-picker-save-current"
              >
                Save current as team…
              </button>
            )}
          </div>

          {savingTeam && (
            <div className="rounded-md border border-line bg-bg-2 p-2 mb-2 space-y-2">
              <input
                type="text"
                className="input"
                placeholder="Team name (e.g. Research squad)"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                autoFocus
                data-testid="roster-picker-save-name"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setSavingTeam(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={saveCurrentAsTeam}
                  disabled={busy || !saveName.trim()}
                  data-testid="roster-picker-save-commit"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          <input
            type="text"
            placeholder="Search agents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input mb-2"
            data-testid="roster-picker-search"
          />

          {teams.length > 0 && (
            <div className="mt-1 mb-2">
              <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-ink-faint">
                Saved teams
              </div>
              <div className="flex flex-wrap gap-1">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pickTeam(t.id)}
                    className={`px-2 py-1 text-xs rounded-full transition
                      ${draftTeamId === t.id
                        ? "bg-accent/20 ring-1 ring-accent"
                        : "bg-bg-2 hover:bg-bg-3"}`}
                    title={t.description}
                    data-testid={`roster-picker-team-${t.id}`}
                  >
                    ◆ {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="px-1 pt-1 pb-1 text-[10px] uppercase tracking-wide text-ink-faint">
            Agents (click to add)
          </div>
          <AgentCard
            agent={null}
            selected={draftSize === 0 && !draftTeamId}
            onClick={() => {
              setDraft(new Set());
              setDraftTeamId("");
            }}
          />
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-faint">
              {agents.length === 0 ? "No agents yet." : "No matches."}
            </div>
          ) : (
            filtered.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                selected={draft.has(a.id)}
                onClick={() => toggleAgent(a.id)}
              />
            ))
          )}

          <footer className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-line/40">
            <span className="text-[11px] text-ink-faint">
              {draftSize === 0
                ? "Smart routing handles it."
                : draftSize === 1
                  ? "Solo agent."
                  : "Coordinator picked automatically from team roles."}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={apply}
                disabled={busy}
                data-testid="roster-picker-apply"
              >
                {busy ? "Applying…" : "Apply"}
              </button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}

// ── Agent card ───────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent: AgentRow | null;
  selected: boolean;
  onClick: () => void;
}

function AgentCard({ agent, selected, onClick }: AgentCardProps) {
  const name = agent?.name ?? "No agent";
  const desc =
    agent?.description ??
    "Fall back to smart routing with the default system prompt.";

  return (
    <button
      type="button"
      onClick={onClick}
      role="checkbox"
      aria-checked={selected}
      className={`w-full text-left px-3 py-2 rounded-md flex items-start gap-2 transition mb-0.5
                  ${selected ? "bg-accent/15" : "hover:bg-bg-2"}`}
      data-testid={agent ? `roster-picker-agent-${agent.id}` : "roster-picker-agent-none"}
    >
      <span
        className={`mt-1 inline-flex items-center justify-center h-3.5 w-3.5 rounded-sm shrink-0 border ${
          selected ? "bg-accent border-accent" : "bg-bg-1 border-line"
        }`}
        aria-hidden
      >
        {selected && (
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="white" strokeWidth="2" fill="none">
            <polyline points="2 5 4 7 8 3" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{name}</span>
          {agent?.role && (
            <span className="pill text-[10px]">{agent.role}</span>
          )}
        </span>
        {desc && (
          <span className="block text-[11px] text-ink-faint mt-0.5 line-clamp-2">
            {desc}
          </span>
        )}
      </span>
    </button>
  );
}
