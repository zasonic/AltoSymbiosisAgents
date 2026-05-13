import { useEffect, useState } from "react";

import { useAppStore } from "@/stores/appStore";

// Stub overlay for commit 1 of the Pinokio bootstrap pipeline. Renders a
// minimal "setting up…" message and re-checks `window.electronAPI.isBootstrapped`
// once on mount; if the backing bin/ tree turns out to be ready, it flips the
// Zustand `bootstrapped` flag and the App component falls through to the main
// UI. The real 3-step progress UI + error cards land in commit 4.
//
// On non-Windows we render a "Windows installer only this release — macOS /
// Linux coming in a future release" message instead. The packaged build is
// Windows-only per electron-builder.yml, so non-Windows hits this path only
// in dev when no legacy `backend/.venv` is present.
export function BootstrapWizard() {
  const setBootstrapped = useAppStore((s) => s.setBootstrapped);
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, ready] = await Promise.all([
        window.electronAPI.getPlatform(),
        window.electronAPI.recheckBootstrap(),
      ]);
      if (!alive) return;
      setPlatform(p);
      if (ready) setBootstrapped(true);
    })();
    return () => {
      alive = false;
    };
  }, [setBootstrapped]);

  const isUnsupportedPlatform = platform !== null && platform !== "win32";

  return (
    <div className="fixed inset-0 z-50 bg-bg/95 flex items-center justify-center p-6">
      <div className="card max-w-lg w-full" data-testid="bootstrap-wizard">
        <header className="mb-4">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">
            First-run setup
          </div>
          <h1 className="text-xl font-semibold">
            {isUnsupportedPlatform
              ? "Windows installer only this release"
              : "Setting up AltoSymbiosis…"}
          </h1>
        </header>

        {isUnsupportedPlatform ? (
          <p className="text-sm text-ink-dim">
            The bundled-Python install flow ships for Windows x64 in this
            release. macOS and Linux installers are tracked for a future
            release. For development, create a Python 3.12 venv at{" "}
            <code className="text-ink">backend/.venv</code> and reinstall the
            sidecar requirements.
          </p>
        ) : (
          <p className="text-sm text-ink-dim">
            Checking your environment. The full install wizard (Miniconda
            download, environment setup) arrives in a follow-up commit.
          </p>
        )}
      </div>
    </div>
  );
}
