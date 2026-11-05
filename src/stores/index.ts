// SPDX-License-Identifier: GPL-3.0
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Project, RomioState, ScanProgress,
  HostEnvironmentReport, BiosSystemResult,
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
  // For results that arrive late: does nothing if you've since switched projects
  refreshActiveProject: (p: Project) => void;

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
  refreshActiveProject: (p) =>
    set((s) => (s.activeProject?.id === p.id ? { activeProject: p } : s)),

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
  // The backend runs one scan at a time, and it may not be the open project's
  scanningProject: Pick<Project, "id" | "name"> | null;
  progress:     ScanProgress | null;
  // Per project and kept here: a scan can fail after the Dashboard has unmounted
  scanErrors:   Record<string, string | null>;
  setScanning:  (p: Pick<Project, "id" | "name"> | null) => void;
  setProgress:  (p: ScanProgress | null) => void;
  setScanError: (projectId: string, message: string | null) => void;
}

export const useScanStore = create<ScanStore>((set) => ({
  scanningProject: null,
  progress:    null,
  scanErrors:  {},
  setScanning: (scanningProject) => set({ scanningProject }),
  setProgress: (progress)   => set({ progress }),
  setScanError: (projectId, message) =>
    set((s) => ({ scanErrors: { ...s.scanErrors, [projectId]: message } })),
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
