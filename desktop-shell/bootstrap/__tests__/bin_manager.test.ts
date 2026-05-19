// @vitest-environment node
//
// Main-process vitest spec for the engine-binary helpers in bin_manager.ts
// (Stage-2 #12).
//
// The `electron` module is mocked so the suite runs in a plain Node
// environment. We point Electron's userData root and process.resourcesPath
// at a temp directory and write/remove fake binaries under the candidate
// paths to exercise the lookup order.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeApp = {
  // Run all engine-binary tests in packaged mode so getResourceDir() reads
  // process.resourcesPath (which we can stub) rather than PROJECT_ROOT
  // (which is computed from import.meta.url at module load — i.e. the real
  // repo root — and would force writing test files inside the working tree).
  isPackaged: true,
  getPath: vi.fn((_name: string) => ""),
  getAppPath: vi.fn(() => ""),
};

vi.mock("electron", () => ({ app: fakeApp }));

let userData: string;
let resources: string;
let originalResourcesPath: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "binmgr-userdata-"));
  resources = mkdtempSync(join(tmpdir(), "binmgr-resources-"));
  fakeApp.isPackaged = true;
  fakeApp.getPath.mockReturnValue(userData);
  fakeApp.getAppPath.mockReturnValue(resources);
  // process.resourcesPath isn't usually defined in plain Node; stub it.
  originalResourcesPath = (process as { resourcesPath?: string }).resourcesPath ?? "";
  (process as { resourcesPath?: string }).resourcesPath = resources;
});

afterEach(() => {
  for (const dir of [userData, resources]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  (process as { resourcesPath?: string }).resourcesPath = originalResourcesPath;
  vi.resetModules();
});

const ENGINE_NAME =
  process.platform === "win32" ? "llama-server.exe" : "llama-server";

async function loadBinManager() {
  vi.resetModules();
  return await import("../bin_manager");
}

describe("bin_manager — engine binary lookup", () => {
  it("returns the userData/engines candidate first when binary lives there", async () => {
    const mgr = await loadBinManager();
    const enginesDir = join(userData, "bin", "engines");
    mkdirSync(enginesDir, { recursive: true });
    const target = join(enginesDir, ENGINE_NAME);
    writeFileSync(target, "fake binary");

    expect(mgr.hasEngineBinary()).toBe(true);
    expect(mgr.resolveEngineBinary()).toBe(target);
  });

  it("falls back to the installer-resources path when userData is empty", async () => {
    const mgr = await loadBinManager();
    // In packaged mode getResourceDir("backend") returns
    // <process.resourcesPath>/backend.
    const resourceDir = join(resources, "backend", "llama-server");
    mkdirSync(resourceDir, { recursive: true });
    const target = join(resourceDir, ENGINE_NAME);
    writeFileSync(target, "fake binary");

    expect(mgr.hasEngineBinary()).toBe(true);
    expect(mgr.resolveEngineBinary()).toBe(target);
  });

  it("returns null + false when no candidate exists", async () => {
    const mgr = await loadBinManager();
    expect(mgr.hasEngineBinary()).toBe(false);
    expect(mgr.resolveEngineBinary()).toBeNull();
  });

  it("prefers the userData candidate over the installer-resources candidate when both exist", async () => {
    const mgr = await loadBinManager();
    const userTarget = join(userData, "bin", "engines", ENGINE_NAME);
    const resTarget = join(resources, "backend", "llama-server", ENGINE_NAME);
    mkdirSync(join(userData, "bin", "engines"), { recursive: true });
    mkdirSync(join(resources, "backend", "llama-server"), { recursive: true });
    writeFileSync(userTarget, "user-downloaded binary");
    writeFileSync(resTarget, "shipped binary");

    expect(mgr.resolveEngineBinary()).toBe(userTarget);
  });

  it("emits three candidate paths covering userData, resources, and branding", async () => {
    const mgr = await loadBinManager();
    const candidates = mgr.getEngineBinaryCandidates();
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toContain(join("bin", "engines", ENGINE_NAME));
    expect(candidates[1]).toContain(join("llama-server", ENGINE_NAME));
    expect(candidates[2]).toContain(
      join("branding", "sidecar-bundle", "llama-server", ENGINE_NAME),
    );
  });
});
