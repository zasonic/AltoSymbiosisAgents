import { useEffect, useRef, useState } from "react";

import {
  Models,
  Settings,
  System,
  type LocalBackend,
  type LocalModelRow,
  type ModelCatalogEntry,
} from "@/api/client";
import { t } from "@/i18n";
import { useAppStore } from "@/stores/appStore";

// Asymmetric on purpose. The orchestrator currently has two switches:
//   routing_enabled=true   → router picks Claude vs local per message
//   routing_enabled=false  → always send to `claude_model`
// There's no "always use this exact local model" mode, so a local pick can
// only set the default model Smart Routing reaches for. The dropdown footer
// surfaces this so users aren't surprised.
const LOCAL_BACKENDS: LocalBackend[] = ["ollama", "lm_studio", "bundled"];

export function ModelSwitcher() {
  const sidecarReady = useAppStore((s) => s.sidecarStatus?.status === "ready");
  const pushToast = useAppStore((s) => s.pushToast);

  const [open, setOpen] = useState(false);
  const [claudeModels, setClaudeModels] = useState<ModelCatalogEntry[]>([]);
  const [localModels, setLocalModels] = useState<LocalModelRow[]>([]);
  const [routingEnabled, setRoutingEnabled] = useState<boolean | null>(null);
  const [claudeModel, setClaudeModel] = useState<string>("");
  const [defaultLocalModel, setDefaultLocalModel] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pull the current state from the backend. Called on mount and after each
  // successful selection — we re-fetch rather than optimistically mutate so
  // the pill stays in sync with whatever the orchestrator actually saved.
  const refresh = async () => {
    try {
      const [catalog, local, settings] = await Promise.all([
        Models.catalog(),
        System.listLocalModels(),
        Settings.get(),
      ]);
      setClaudeModels(catalog.models);
      setLocalModels(local.models);
      setRoutingEnabled(Boolean(settings.routing_enabled));
      setClaudeModel(settings.claude_model || "");
      setDefaultLocalModel(settings.default_local_model || "");
    } catch (err) {
      // Don't toast on background fetch — the chat itself will surface a
      // user-visible error if the sidecar is genuinely broken.
      // eslint-disable-next-line no-console
      console.warn("ModelSwitcher refresh failed", err);
    }
  };

  useEffect(() => {
    if (!sidecarReady) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidecarReady]);

  // Close the dropdown on outside click or Escape so it behaves like every
  // other floating menu in the OS.
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

  const pickSmartRouting = async () => {
    setBusy(true);
    try {
      await Settings.set("routing_enabled", true);
      pushToast({ kind: "success", text: "Smart routing enabled" });
      await refresh();
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not change model",
      });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const pickClaude = async (id: string) => {
    setBusy(true);
    try {
      await Settings.set("routing_enabled", false);
      await Settings.set("claude_model", id);
      pushToast({ kind: "success", text: `Sending to Claude · ${id}` });
      await refresh();
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not change model",
      });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const pickLocal = async (id: string) => {
    setBusy(true);
    try {
      await Settings.set("default_local_model", id);
      pushToast({
        kind: "success",
        text: `Local default set to ${id} (Smart Routing remains on)`,
      });
      await refresh();
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not change model",
      });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  // What the closed pill displays. Reads "Smart routing" by default, or the
  // pinned Claude model when routing is off. Falls back to "Loading…" before
  // the first refresh resolves so the layout doesn't jump.
  const pillLabel = (() => {
    if (routingEnabled === null) return "Loading…";
    if (routingEnabled) {
      if (defaultLocalModel) {
        return `Smart routing · local: ${defaultLocalModel}`;
      }
      return "Smart routing";
    }
    const claude = claudeModels.find((c) => c.id === claudeModel);
    return `Claude · ${claude?.display_name || claudeModel || "(unset)"}`;
  })();

  const isPickedClaude = (id: string) =>
    routingEnabled === false && claudeModel === id;
  const isPickedLocal = (id: string) =>
    routingEnabled === true && defaultLocalModel === id;
  const isSmartRouting =
    routingEnabled === true && !defaultLocalModel;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!sidecarReady || busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full
                   bg-bg-1 text-ink hover:shadow-soft-2 shadow-soft-1 transition
                   disabled:opacity-50 disabled:cursor-not-allowed"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="model-switcher-pill"
      >
        <span className="truncate max-w-[260px]">{pillLabel}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="3 5 6 8 9 5" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-h-[60vh] overflow-y-auto
                     glass z-30 p-2"
          role="listbox"
          data-testid="model-switcher-dropdown"
        >
          <SwitcherOption
            checked={isSmartRouting}
            disabled={busy}
            onClick={pickSmartRouting}
            title="Smart routing"
            subtitle="Router picks per message"
          />

          <SwitcherSection label="Claude">
            {claudeModels.length === 0 ? (
              <div className="px-3 py-2 text-xs text-ink-faint">No models in catalog.</div>
            ) : (
              claudeModels.map((m) => (
                <SwitcherOption
                  key={m.id}
                  checked={isPickedClaude(m.id)}
                  disabled={busy}
                  onClick={() => pickClaude(m.id)}
                  title={m.display_name}
                  subtitle={m.id}
                />
              ))
            )}
          </SwitcherSection>

          {LOCAL_BACKENDS.map((backend) => {
            const rows = localModels.filter((m) => m.backend === backend);
            if (rows.length === 0) return null;
            return (
              <SwitcherSection key={backend} label={`Local — ${t(backend)}`}>
                {rows.map((m) => (
                  <SwitcherOption
                    key={`${backend}:${m.id}`}
                    checked={isPickedLocal(m.id)}
                    disabled={busy}
                    onClick={() => pickLocal(m.id)}
                    title={m.id}
                    subtitle={m.quantization || undefined}
                  />
                ))}
              </SwitcherSection>
            );
          })}

          <div className="px-3 pt-3 pb-1 text-[11px] text-ink-faint border-t border-line/40 mt-2">
            Picking a Claude model pins the next messages to Claude. Picking a
            local model sets the default Smart Routing uses for simple turns.
          </div>
        </div>
      )}
    </div>
  );
}

interface SwitcherSectionProps {
  label: string;
  children: React.ReactNode;
}

function SwitcherSection({ label, children }: SwitcherSectionProps) {
  return (
    <div className="mt-2">
      <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

interface SwitcherOptionProps {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
}

function SwitcherOption({
  checked,
  disabled,
  onClick,
  title,
  subtitle,
}: SwitcherOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="option"
      aria-selected={checked}
      className={`w-full text-left px-3 py-2 rounded-md flex items-start gap-2 transition
                  ${checked ? "bg-accent/15" : "hover:bg-bg-2"}
                  disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span
        className={`mt-1 inline-block h-2 w-2 rounded-full shrink-0 ${
          checked ? "bg-accent" : "bg-bg-3"
        }`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{title}</span>
        {subtitle && (
          <span className="block text-[11px] text-ink-faint truncate font-mono">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}
