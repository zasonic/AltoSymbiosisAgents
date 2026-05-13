import { useEffect, useState } from "react";

import {
  Chat,
  Models,
  PromptTemplates,
  Settings,
  System,
  Voice,
  type ModelCatalogEntry,
  type PromptTemplate,
  type SettingsPayload,
  type VoiceAssetsStatus,
} from "@/api/client";
import { t } from "@/i18n";
import { VoiceSetupModal } from "@/components/VoiceSetupModal";
import { useAppStore } from "@/stores/appStore";

interface RouterStats {
  total_exchanges: number;
  error_rate_overall: number;
  by_complexity: Record<string, { total: number; errors: number; error_rate: number }>;
  by_route: Record<string, { total: number; errors: number; error_rate: number }>;
  recent: Array<{
    route: string;
    complexity: string;
    had_error: boolean;
    model_used: string;
    created_at: string;
  }>;
}

export function SettingsPanel() {
  const ready = useAppStore((s) => s.sidecarStatus?.status === "ready");
  const pushToast = useAppStore((s) => s.pushToast);
  const [config, setConfig] = useState<SettingsPayload | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [routerStats, setRouterStats] = useState<RouterStats | null>(null);
  // PR 17: voice setup modal + asset readiness probe.
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceAssetsStatus | null>(null);
  // Layer B1: Claude model dropdown is sourced from
  // /api/models/catalog so the renderer can't offer an id the backend
  // price math doesn't know about.
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntry[]>([]);

  const reload = async () => {
    try {
      const fresh = await Settings.get();
      setConfig(fresh);
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not load settings",
      });
    }
  };

  const reloadRouterStats = async () => {
    try {
      const stats = (await Chat.routerStats()) as RouterStats;
      setRouterStats(stats);
    } catch {
      setRouterStats(null);
    }
  };

  const reloadVoiceStatus = async () => {
    try {
      const status = await Voice.assetsStatus();
      setVoiceStatus(status);
    } catch {
      setVoiceStatus(null);
    }
  };

  const reloadModelCatalog = async () => {
    try {
      const rsp = await Models.catalog();
      setModelCatalog(rsp.models);
    } catch {
      // Fall back to a free-text input if the catalog can't load — better
      // than locking the user out of changing the model.
      setModelCatalog([]);
    }
  };

  useEffect(() => {
    if (ready) {
      reload();
      reloadRouterStats();
      reloadVoiceStatus();
      reloadModelCatalog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const save = async (key: keyof SettingsPayload, value: unknown) => {
    try {
      await Settings.save(String(key), value);
      reload();
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Save failed",
      });
    }
  };

  const verifyKey = async () => {
    if (!apiKey.trim()) return;
    setVerifying(true);
    try {
      const rsp = await Settings.verifyApiKey(apiKey);
      if (rsp.ok) {
        pushToast({ kind: "success", text: rsp.message });
        setApiKey("");
        reload();
      } else {
        pushToast({ kind: "error", text: rsp.message });
      }
    } catch (err) {
      pushToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Verify failed",
      });
    } finally {
      setVerifying(false);
    }
  };

  // PR 17: voice toggle. When the user enables either voice flag and the
  // backend reports the assets aren't ready yet, fire the setup modal so
  // they don't get a confusing 503 the first time they hit the mic.
  const toggleVoiceInput = async (enabled: boolean) => {
    await save("voice_input_enabled", enabled);
    if (enabled) {
      const fresh = await Voice.assetsStatus().catch(() => null);
      setVoiceStatus(fresh);
      if (fresh && !fresh.stt_ready) {
        setVoiceModalOpen(true);
      }
    }
  };

  const toggleVoiceOutput = async (enabled: boolean) => {
    await save("voice_output_enabled", enabled);
    if (enabled) {
      const fresh = await Voice.assetsStatus().catch(() => null);
      setVoiceStatus(fresh);
      if (fresh && !fresh.tts_ready) {
        setVoiceModalOpen(true);
      }
    }
  };

  if (!config) {
    return (
      <div className="p-6 text-ink-dim text-sm">
        {ready ? "Loading…" : "Waiting for backend…"}
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto h-full max-w-2xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-ink-dim">API keys, model selection, routing.</p>
      </header>

      <section className="card">
        <h3 className="font-semibold mb-2">Anthropic API key</h3>
        <div className="text-sm text-ink-dim mb-2">
          {config.claude_api_key_set
            ? `Stored in OS keyring · ${config.claude_api_key}`
            : "Not configured."}
        </div>
        <div className="flex gap-2">
          <input
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
          />
          <button className="btn-primary" onClick={verifyKey} disabled={verifying}>
            {verifying ? "Verifying…" : "Verify & save"}
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Model</h3>
        <label className="label">Claude model</label>
        {modelCatalog.length > 0 ? (
          <select
            className="input"
            value={config.claude_model}
            onChange={(e) => {
              const next = e.target.value;
              setConfig({ ...config, claude_model: next });
              save("claude_model", next);
            }}
          >
            {/* If the saved model isn't in the catalog (e.g. older
                install, custom id), keep it visible at the top so the
                user isn't silently switched. */}
            {modelCatalog.find((m) => m.id === config.claude_model)
              ? null
              : (
                <option value={config.claude_model}>
                  {config.claude_model} (not in catalog)
                </option>
              )}
            {modelCatalog.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name} — ${m.input_price_per_mtok}/${m.output_price_per_mtok} per MTok
              </option>
            ))}
          </select>
        ) : (
          // Catalog failed to load — fall back to the legacy free-text
          // input so a transient API failure doesn't strand the user.
          <input
            className="input"
            value={config.claude_model}
            onChange={(e) =>
              setConfig({ ...config, claude_model: e.target.value })
            }
            onBlur={() => save("claude_model", config.claude_model)}
          />
        )}
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Routing</h3>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!config.routing_enabled}
            onChange={(e) => save("routing_enabled", e.target.checked)}
          />
          <span className="text-sm">
            Smart routing (uncertainty-aware classifier picks Claude vs local)
          </span>
        </label>
      </section>

      <RoutingPerformanceSection stats={routerStats} />

      <section className="card">
        <h3 className="font-semibold mb-2">Local models</h3>
        <label className="label">Ollama URL</label>
        <input
          className="input mb-2"
          value={config.ollama_url}
          onChange={(e) => setConfig({ ...config, ollama_url: e.target.value })}
          onBlur={() => save("ollama_url", config.ollama_url)}
        />
        <label className="label">LM Studio URL</label>
        <input
          className="input"
          value={config.lm_studio_url}
          onChange={(e) =>
            setConfig({ ...config, lm_studio_url: e.target.value })
          }
          onBlur={() => save("lm_studio_url", config.lm_studio_url)}
        />
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Updates</h3>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Update mechanism">
          {([
            {
              value: "auto",
              label: "Automatic (recommended)",
              hint: "Download and install new versions in the background. Asks before restarting.",
            },
            {
              value: "manual",
              label: "Manual",
              hint: "Notify me when a new version is out and open the download page so I can install it myself.",
            },
            {
              value: "off",
              label: "Off",
              hint: "Never check for updates.",
            },
          ] as const).map((opt) => (
            <label key={opt.value} className="flex items-start gap-2">
              <input
                type="radio"
                name="update_mechanism"
                className="mt-1"
                checked={(config.update_mechanism ?? "auto") === opt.value}
                onChange={() => save("update_mechanism", opt.value)}
              />
              <span className="text-sm">
                <div>{opt.label}</div>
                <div className="text-xs text-ink-dim">{opt.hint}</div>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-dim">
          Manual mode is useful if automatic updates fail on your machine
          because the app is unsigned.
        </p>
      </section>

      <section className="card" data-testid="settings-voice-section">
        <h3 className="font-semibold mb-2">Voice</h3>
        <p className="text-sm text-ink-dim mb-3">
          Speak to dictate messages and have replies read back to you. Both
          features run on your machine — audio never leaves this computer.
        </p>
        <label className="flex items-start gap-2 mb-2">
          <input
            type="checkbox"
            data-testid="settings-voice-input-toggle"
            className="mt-1"
            checked={!!config.voice_input_enabled}
            onChange={(e) => toggleVoiceInput(e.target.checked)}
          />
          <span className="text-sm">
            <div>Voice input</div>
            <div className="text-xs text-ink-dim">
              Adds a mic button to the chat input. Click to record, click again
              to transcribe with Whisper.cpp.
            </div>
          </span>
        </label>
        <label className="flex items-start gap-2 mb-3">
          <input
            type="checkbox"
            data-testid="settings-voice-output-toggle"
            className="mt-1"
            checked={!!config.voice_output_enabled}
            onChange={(e) => toggleVoiceOutput(e.target.checked)}
          />
          <span className="text-sm">
            <div>Voice output</div>
            <div className="text-xs text-ink-dim">
              Adds a speaker button to assistant messages. Click to hear the
              reply spoken aloud with Piper.
            </div>
          </span>
        </label>

        {(config.voice_input_enabled || config.voice_output_enabled) && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Speech-to-text model</label>
                <input
                  className="input"
                  value={config.stt_model_id || ""}
                  onChange={(e) =>
                    setConfig({ ...config, stt_model_id: e.target.value })
                  }
                  onBlur={() => save("stt_model_id", config.stt_model_id)}
                />
              </div>
              <div>
                <label className="label">Text-to-speech voice</label>
                <input
                  className="input"
                  value={config.tts_voice_id || ""}
                  onChange={(e) =>
                    setConfig({ ...config, tts_voice_id: e.target.value })
                  }
                  onBlur={() => save("tts_voice_id", config.tts_voice_id)}
                />
              </div>
            </div>

            <div className="rounded-md border border-line bg-bg-2 px-3 py-2 text-xs space-y-1.5 mt-3">
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">STT model</span>
                <span className={voiceStatus?.stt_ready ? "text-ok" : "text-warn"}>
                  {voiceStatus == null
                    ? "Checking…"
                    : voiceStatus.stt_ready
                      ? "Ready"
                      : "Not downloaded"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">TTS voice</span>
                <span className={voiceStatus?.tts_ready ? "text-ok" : "text-warn"}>
                  {voiceStatus == null
                    ? "Checking…"
                    : voiceStatus.tts_ready
                      ? "Ready"
                      : "Not downloaded"}
                </span>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={reloadVoiceStatus}
                >
                  Re-check
                </button>
                {(voiceStatus && (!voiceStatus.stt_ready || !voiceStatus.tts_ready)) && (
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => setVoiceModalOpen(true)}
                    data-testid="settings-voice-download"
                  >
                    Download models
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <VoiceSetupModal
        open={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
        onComplete={() => {
          setVoiceModalOpen(false);
          reloadVoiceStatus();
        }}
      />

      <section className="card">
        <h3 className="font-semibold mb-2">System prompt</h3>
        <textarea
          className="input min-h-[120px] font-mono text-xs"
          value={config.system_prompt}
          onChange={(e) =>
            setConfig({ ...config, system_prompt: e.target.value })
          }
          onBlur={() => save("system_prompt", config.system_prompt)}
        />
        <SystemPromptTemplatesPicker
          onApply={(tmpl) => {
            setConfig({ ...config, system_prompt: tmpl.body });
            save("system_prompt", tmpl.body);
          }}
        />
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">Troubleshooting</h3>
        <div className="space-y-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={async () => {
              try {
                await System.exportDiagnostics();
                pushToast({ kind: "success", text: "Diagnostics exported" });
              } catch {
                pushToast({ kind: "error", text: "Export failed" });
              }
            }}
          >
            Export diagnostics
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              const ok = window.confirm(
                "This will clear your conversation history, memory, and settings. Your API key (stored in the OS keyring) will not be affected. This cannot be undone. Continue?",
              );
              if (ok) {
                window.electronAPI.restartSidecar();
              }
            }}
          >
            Reset to defaults
          </button>
        </div>
      </section>
    </div>
  );
}

// ── PR 18: pick a saved system_prompt template as the default ──────────────

interface SystemPromptTemplatesPickerProps {
  onApply: (tmpl: PromptTemplate) => void;
}

function SystemPromptTemplatesPicker({
  onApply,
}: SystemPromptTemplatesPickerProps) {
  const ready = useAppStore((s) => s.sidecarStatus?.status === "ready");
  const pushToast = useAppStore((s) => s.pushToast);
  const templates = useAppStore((s) => s.promptTemplates);
  const setPromptTemplates = useAppStore((s) => s.setPromptTemplates);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    PromptTemplates.list()
      .then((rows) => {
        if (alive) setPromptTemplates(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ready, setPromptTemplates]);

  const systemPrompts = templates.filter((p) => p.kind === "system_prompt");
  if (systemPrompts.length === 0) return null;

  return (
    <div
      className="mt-3 rounded-md border border-line bg-bg-2 px-3 py-2"
      data-testid="settings-system-prompt-templates"
    >
      <div className="text-xs text-ink-dim mb-2">
        {t("prompts.set_as_default_system_prompt")}
      </div>
      <ul className="space-y-1">
        {systemPrompts.map((tmpl) => (
          <li
            key={tmpl.id}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="truncate">{tmpl.title}</span>
            <button
              type="button"
              className="btn-ghost text-xs"
              data-testid={`settings-set-default-${tmpl.id}`}
              onClick={() => {
                onApply(tmpl);
                pushToast({
                  kind: "success",
                  text: t("prompts.set_as_default.success"),
                });
              }}
            >
              {t("prompts.set_as_default_system_prompt")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutingPerformanceSection({ stats }: { stats: RouterStats | null }) {
  if (!stats || stats.total_exchanges === 0) {
    return (
      <section className="card">
        <h3 className="font-semibold mb-2">Routing Performance</h3>
        <div className="text-sm text-ink-dim">No routing data yet</div>
      </section>
    );
  }

  const errorPct = (stats.error_rate_overall * 100).toFixed(1);
  const claudeCount = stats.by_route?.claude?.total ?? 0;
  const localCount = stats.by_route?.local?.total ?? 0;
  const complexityKeys = ["simple", "medium", "complex"];

  return (
    <section className="card">
      <h3 className="font-semibold mb-2">Routing Performance</h3>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <div className="text-lg font-semibold">{stats.total_exchanges}</div>
          <div className="text-xs text-ink-dim">Total</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold">{errorPct}%</div>
          <div className="text-xs text-ink-dim">Error rate</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold">
            {claudeCount} / {localCount}
          </div>
          <div className="text-xs text-ink-dim">Claude / local</div>
        </div>
      </div>

      <div className="text-xs font-semibold mb-1">By complexity</div>
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        {complexityKeys.map((k) => {
          const b = stats.by_complexity?.[k];
          return (
            <div key={k} className="border border-base-700 rounded p-2">
              <div className="capitalize text-ink-dim">{k}</div>
              <div>
                {b ? `${b.total} · ${(b.error_rate * 100).toFixed(1)}% err` : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {stats.recent.length > 0 && (
        <>
          <div className="text-xs font-semibold mb-1">Recent decisions</div>
          <div className="text-xs space-y-1 max-h-48 overflow-y-auto">
            {stats.recent.slice(0, 10).map((r, i) => (
              <div
                key={i}
                className="flex justify-between gap-2 border-b border-base-700/50 pb-1"
              >
                <span className="text-ink-dim">{r.route}</span>
                <span className="text-ink-dim">{r.complexity}</span>
                <span className={r.had_error ? "text-rose-400" : ""}>
                  {r.model_used || "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
