// SPDX-License-Identifier: GPL-3.0
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Project, RomioState, ScanProgress,
  HostEnvironmentReport, BiosSystemResult,
  FormatSystemGroup, StagedFix,
} from "@/types";
import type { Scenario } from "@/lib/scenario";

// ── App store — global UI state ───────────────────────────────────────────────

interface AppStore {
  // Current screen
  screen: Screen;
  setScreen: (s: Screen) => void;

  // Active project
  activeProject:    Project | null;
  setActiveProject: (p: Project | null) => void;

  // Romio mascot state
  romioState:    RomioState;
  setRomioState: (s: RomioState) => void;

  // Sidebar open/closed
  sidebarOpen:    boolean;
  setSidebarOpen: (v: boolean) => void;

  // Frontend root typed on the Saves screen, per project; lasts until the app closes
  saveRoots:   Record<string, string>;
  setSaveRoot: (projectId: string, root: string) => void;

  // Which of the three moments the person is in; remembered across launches
  scenario:    Scenario | null;
  setScenario: (s: Scenario) => void;
}

export type Screen =
  | "welcome"
  | "projects"
  | "preflight"
  | "dashboard"
  | "bios"
  | "format"
  | "multidisc"
  | "scummvm"
  | "installed"
  | "saves"
  | "export"
  | "preview"
  | "rollback"
  | "smoketest";

export const useAppStore = create<AppStore>()(persist((set) => ({
  screen:        "welcome",
  setScreen:     (screen) => set({ screen }),

  activeProject:    null,
  setActiveProject: (activeProject) => set({ activeProject }),

  romioState:    "welcome",
  setRomioState: (romioState) => set({ romioState }),

  sidebarOpen:    true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  saveRoots:   {},
  setSaveRoot: (projectId, root) =>
    set((s) => ({ saveRoots: { ...s.saveRoots, [projectId]: root } })),

  scenario:    null,
  setScenario: (scenario) => set({ scenario }),
}), {
  name:       "romio-app",
  // Only the scenario outlives a launch; screens and projects start fresh
  partialize: (s) => ({ scenario: s.scenario }),
}));

// ── Scan store ────────────────────────────────────────────────────────────────

interface ScanStore {
  isScanning:   boolean;
  progress:     ScanProgress | null;
  // Kept here: a scan can fail after the Dashboard has unmounted
  scanError:    { projectId: string; message: string } | null;
  setScanning:  (v: boolean) => void;
  setProgress:  (p: ScanProgress | null) => void;
  setScanError: (e: { projectId: string; message: string } | null) => void;
}

export const useScanStore = create<ScanStore>((set) => ({
  isScanning:  false,
  progress:    null,
  scanError:   null,
  setScanning: (isScanning) => set({ isScanning }),
  setProgress: (progress)   => set({ progress }),
  setScanError: (scanError) => set({ scanError }),
}));

// ── Preflight store ───────────────────────────────────────────────────────────

interface PreflightStore {
  report:    HostEnvironmentReport | null;
  completed: boolean;
  setReport:    (r: HostEnvironmentReport | null) => void;
  setCompleted: (v: boolean) => void;
}

export const usePreflightStore = create<PreflightStore>((set) => ({
  report:       null,
  completed:    false,
  setReport:    (report)    => set({ report }),
  setCompleted: (completed) => set({ completed }),
}));

// ── BIOS store ────────────────────────────────────────────────────────────────

interface BiosStore {
  results:    BiosSystemResult[];
  setResults: (r: BiosSystemResult[]) => void;
}

export const useBiosStore = create<BiosStore>((set) => ({
  results:    [],
  setResults: (results) => set({ results }),
}));

// ── Format store ──────────────────────────────────────────────────────────────

export interface FormatSession {
  libraryPath:      string;
  frontend:         string;
  emulatorOverride: string;
  isScanning:       boolean;
  progress:         { checked: number; total: number } | null;
  scanError:        string | null;
  scanned:          boolean;
  scannedWith:      { path: string; frontend: string; emulator: string };
  groups:           FormatSystemGroup[];
  partialSystems:   string[];
  limitedFolders:   string[];
  stagedFixes:      StagedFix[];
}

interface FormatStore {
  // Per project, so results can't show under another one; lasts until the app closes
  sessions:      Record<string, FormatSession>;
  updateSession: (project: Project | null, patch: Partial<FormatSession>) => void;
}

function newFormatSession(project: Project | null): FormatSession {
  return {
    libraryPath:      project?.libraryRoots[0] ?? "",
    frontend:         project?.targetFrontends[0] ?? "esde",
    emulatorOverride: "auto",
    isScanning:       false,
    progress:         null,
    scanError:        null,
    scanned:          false,
    scannedWith:      { path: "", frontend: "", emulator: "" },
    groups:           [],
    partialSystems:   [],
    limitedFolders:   [],
    stagedFixes:      [],
  };
}

export const useFormatStore = create<FormatStore>((set) => ({
  sessions: {},
  updateSession: (project, patch) =>
    set((s) => {
      const id = project?.id ?? "";
      return { sessions: { ...s.sessions, [id]: { ...(s.sessions[id] ?? newFormatSession(project)), ...patch } } };
    }),
}));

/** A project's session, or the blank one it starts from before anything is changed. */
export function formatSessionOf(project: Project | null): FormatSession {
  return useFormatStore.getState().sessions[project?.id ?? ""] ?? newFormatSession(project);
}
