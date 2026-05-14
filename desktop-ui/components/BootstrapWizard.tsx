import { useCallback, useEffect, useRef, useState } from "react";

import type { BootstrapProgressEvent } from "@/env";
import { useAppStore } from "@/stores/appStore";

// Three-step progress wizard for the Pinokio bootstrap pipeline. Auto-starts
// `bootstrap:start` on mount (Windows only) and renders one of three faces:
//
//   1. Progress face — three labeled steps with per-step progress bars driven
//      by `bootstrap:progress` events.
//   2. Error face — labeled error card (Retry / Reset bin / Open log folder).
//      Retry re-invokes `bootstrap:start` which skips phases whose terminal
//      artifact already exists, so a step-3 SidecarBootError doesn't trigger
//      a fresh 600 MB Miniconda download.
//   3. Unsupported-platform face — non-Windows dev users see a message
//      pointing at the legacy `backend/.venv` fallback. The packaged
//      installer is Win-only per electron-builder.yml so end users only
//      hit this on dev.
//
// Bootstrap is considered done only when the main process emits
// `bootstrap:done`, which fires AFTER waitForSidecarReady resolves —
// gating the flip of `bootstrapped` on a live /health, not just on file
// existence. See desktop-shell/main.ts:bootstrap:start handler.

interface StepState {
  /** null = not started yet; -1 = indeterminate (pip --quiet fallback); 0..100 = in-progress/done. */
  pct: number | null;
  phase?: string;
  message?: string;
}

interface ErrorState {
  step: number;
  label: string;
  cause: string;
  logPath: string;
}

const STEP_LABELS: Record<1 | 2 | 3, string> = {
  1: "Downloading Python",
  2: "Setting up environment",
  3: "Almost done",
};

export function BootstrapWizard() {
  const setBootstrapped = useAppStore((s) => s.setBootstrapped);
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);
  const [steps, setSteps] = useState<Record<1 | 2 | 3, StepState>>({
    1: { pct: null },
    2: { pct: null },
    3: { pct: null },
  });
  const [error, setError] = useState<ErrorState | null>(null);
  const [resetting, setResetting] = useState(false);
  const startedRef = useRef(false);

  // Platform detection so we can suppress auto-start on non-Windows.
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await window.electronAPI.getPlatform();
      if (alive) setPlatform(p);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const begin = useCallback(async () => {
    setError(null);
    try {
      const result = await window.electronAPI.startBootstrap();
      // Both success and labeled failure also stream through the
      // bootstrap:progress / bootstrap:done events that the listeners
      // below consume. We only act on the IPC return value as a
      // defensive fallback: if the renderer somehow missed the error
      // event (race during mount, listener torn down), surface the
      // resolved-value error so the user isn't stuck on a spinning UI.
      if (!result.ok) {
        setError((prev) =>
          prev ?? {
            step: 0,
            label: result.error.label,
            cause: result.error.cause,
            logPath: "",
          },
        );
      }
    } catch (err) {
      setError({
        step: 0,
        label: "BootstrapError",
        cause: err instanceof Error ? err.message : String(err),
        logPath: "",
      });
    }
  }, []);

  // Auto-start the install on Windows once we know the platform. Guarded by
  // startedRef so React StrictMode double-mount in dev doesn't kick off two
  // concurrent downloads.
  useEffect(() => {
    if (platform === null || platform !== "win32") return;
    if (startedRef.current) return;
    startedRef.current = true;
    void begin();
  }, [platform, begin]);

  // Progress + done subscriptions. Stable identity across re-renders so the
  // unsubscribe-on-unmount semantics are correct.
  useEffect(() => {
    const unsubProgress = window.electronAPI.onBootstrapProgress(
      (event: BootstrapProgressEvent) => {
        if (event.error) {
          setError({
            step: event.step,
            label: event.error.label,
            cause: event.error.cause,
            logPath: event.error.logPath,
          });
          return;
        }
        const stepNum = event.step as 1 | 2 | 3;
        if (stepNum !== 1 && stepNum !== 2 && stepNum !== 3) return;
        setSteps((prev) => ({
          ...prev,
          [stepNum]: {
            pct: event.pct,
            phase: event.phase,
            message: event.message,
          },
        }));
      },
    );
    const unsubDone = window.electronAPI.onBootstrapDone(() => {
      setBootstrapped(true);
    });
    return () => {
      unsubProgress();
      unsubDone();
    };
  }, [setBootstrapped]);

  const onRetry = useCallback(() => {
    // Reset error only; main-process skips phases whose artifacts exist, so
    // step 1/2 will already report 100% if they completed before the
    // failure.
    void begin();
  }, [begin]);

  const onResetBin = useCallback(async () => {
    setResetting(true);
    try {
      await window.electronAPI.resetBin();
      setSteps({ 1: { pct: null }, 2: { pct: null }, 3: { pct: null } });
      setError(null);
      // Force a fresh run after the wipe.
      startedRef.current = true;
      void begin();
    } finally {
      setResetting(false);
    }
  }, [begin]);

  const onOpenLogs = useCallback(async () => {
    await window.electronAPI.openBootstrapLogs();
  }, []);

  if (platform !== null && platform !== "win32") {
    return <UnsupportedPlatform />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg/95 flex items-center justify-center p-6">
      <div className="card max-w-lg w-full" data-testid="bootstrap-wizard">
        <header className="mb-4">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">
            First-run setup
          </div>
          <h1 className="text-xl font-semibold">Setting up AltoSymbiosis</h1>
          <p className="text-sm text-ink-dim mt-1">
            About 5 minutes, ~600 MB. Downloaded once; subsequent launches
            work offline.
          </p>
        </header>

        {error ? (
          <ErrorCard
            error={error}
            resetting={resetting}
            onRetry={onRetry}
            onResetBin={onResetBin}
            onOpenLogs={onOpenLogs}
          />
        ) : (
          <div data-testid="bootstrap-steps">
            <StepRow n={1} label={STEP_LABELS[1]} state={steps[1]} />
            <StepRow n={2} label={STEP_LABELS[2]} state={steps[2]} />
            <StepRow n={3} label={STEP_LABELS[3]} state={steps[3]} />
          </div>
        )}
      </div>
    </div>
  );
}

interface StepRowProps {
  n: 1 | 2 | 3;
  label: string;
  state: StepState;
}

function StepRow({ n, label, state }: StepRowProps) {
  const status: "pending" | "in-progress" | "done" =
    state.pct === null
      ? "pending"
      : state.pct >= 100
        ? "done"
        : "in-progress";

  // -1 marks pip's --quiet fallback (no machine-readable progress); render
  // as a half-full bar without a percentage so the user still sees motion
  // from the current-package message.
  const indeterminate = state.pct === -1;
  const visualPct =
    status === "pending"
      ? 0
      : indeterminate
        ? 50
        : Math.max(0, Math.min(100, state.pct ?? 0));

  return (
    <div className="mb-3" data-testid={`bootstrap-step-${n}`}>
      <div className="flex items-center gap-2">
        <span
          className={`w-6 h-6 rounded-full text-xs flex items-center justify-center border ${
            status === "done"
              ? "border-ok/50 text-ok bg-ok/10"
              : status === "in-progress"
                ? "border-accent/60 text-accent"
                : "border-line text-ink-faint"
          }`}
          aria-hidden
        >
          {status === "done" ? "✓" : n}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm">{label}</div>
          {state.message && (
            <div className="text-xs text-ink-faint truncate" title={state.message}>
              {state.message}
            </div>
          )}
        </div>
        {status === "in-progress" && !indeterminate && state.pct != null && (
          <span className="text-xs text-ink-faint tabular-nums">{state.pct}%</span>
        )}
      </div>
      <div
        className="h-1 w-full mt-2 bg-bg-2 rounded overflow-hidden"
        role="progressbar"
        aria-valuenow={visualPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${visualPct}%` }}
        />
      </div>
    </div>
  );
}

interface ErrorCardProps {
  error: ErrorState;
  resetting: boolean;
  onRetry: () => void;
  onResetBin: () => Promise<void>;
  onOpenLogs: () => Promise<void>;
}

function ErrorCard({
  error,
  resetting,
  onRetry,
  onResetBin,
  onOpenLogs,
}: ErrorCardProps) {
  return (
    <div
      className="card border-err/40 bg-err/5"
      data-testid="bootstrap-error"
    >
      <div className="text-xs uppercase tracking-wide text-err mb-1">
        {error.label}
      </div>
      <div className="text-sm text-ink">{error.cause}</div>
      {error.logPath && (
        <div className="text-xs text-ink-faint mt-2 break-all">
          Log file: <code className="text-ink">{error.logPath}</code>
        </div>
      )}
      <div className="flex gap-2 mt-4">
        <button
          className="btn-primary flex-1"
          onClick={onRetry}
          disabled={resetting}
          data-testid="bootstrap-error-retry"
        >
          Retry
        </button>
        <button
          className="btn-ghost flex-1"
          onClick={() => void onResetBin()}
          disabled={resetting}
          data-testid="bootstrap-error-reset"
        >
          {resetting ? "Resetting…" : "Reset bin"}
        </button>
        <button
          className="btn-ghost flex-1"
          onClick={() => void onOpenLogs()}
          data-testid="bootstrap-error-open-logs"
        >
          Open log folder
        </button>
      </div>
    </div>
  );
}

function UnsupportedPlatform() {
  return (
    <div className="fixed inset-0 z-50 bg-bg/95 flex items-center justify-center p-6">
      <div className="card max-w-lg w-full" data-testid="bootstrap-wizard">
        <header className="mb-4">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">
            First-run setup
          </div>
          <h1 className="text-xl font-semibold">
            Windows installer only this release
          </h1>
        </header>
        <p className="text-sm text-ink-dim">
          The bundled-Python install flow ships for Windows x64 in this
          release. macOS and Linux installers are tracked for a future
          release. For development, create a Python 3.12 venv at{" "}
          <code className="text-ink">backend/.venv</code> and reinstall the
          sidecar requirements.
        </p>
      </div>
    </div>
  );
}
