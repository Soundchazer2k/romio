// SPDX-License-Identifier: GPL-3.0
import { create } from "zustand";
import type {
  Project, RomioState, ScanProgress,
  HostEnvironmentReport, BiosSystemResult,
} from "@/types";

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

export const useAppStore = create<AppStore>((set) => ({
  screen:        "welcome",
  setScreen:     (screen) => set({ screen }),

  activeProject:    null,
  setActiveProject: (activeProject) => set({ activeProject }),

  romioState:    "welcome",
  setRomioState: (romioState) => set({ romioState }),

  sidebarOpen:    true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));

// ── Scan store ────────────────────────────────────────────────────────────────

interface ScanStore {
  isScanning:   boolean;
  progress:     ScanProgress | null;
  setScanning:  (v: boolean) => void;
  setProgress:  (p: ScanProgress | null) => void;
}

export const useScanStore = create<ScanStore>((set) => ({
  isScanning:  false,
  progress:    null,
  setScanning: (isScanning) => set({ isScanning }),
  setProgress: (progress)   => set({ progress }),
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
