// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, ChevronDown } from "lucide-react";
import type { EmulatorMatrixEntry } from "@/types";
import { useAppStore } from "@/stores";

interface Props {
  path:           string;
  frontend:       string;
  emulator:       string;           // "auto" or specific emulator id
  emulatorMatrix: EmulatorMatrixEntry[];
  isScanning:     boolean;
  ready:          boolean;          // rules and emulators have loaded
  onPathChange:     (v: string) => void;
  onFrontendChange: (v: string) => void;
  onEmulatorChange: (v: string) => void;
  onScan:           () => void;
}

export function FormatConfigBar({
  path, frontend, emulator, emulatorMatrix,
  isScanning, ready, onPathChange, onFrontendChange, onEmulatorChange, onScan,
}: Props) {
  const { activeProject } = useAppStore();

  const [browsing, setBrowsing] = useState(false);

  async function browse() {
    setBrowsing(true);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") onPathChange(selected);
    } finally {
      setBrowsing(false);
    }
  }

  // Collect all unique emulators from the matrix for the dropdown
  const emulators = ["auto", ...Array.from(
    new Set(emulatorMatrix.flatMap((e) => [e.recommended, ...e.alternatives]))
  ).sort()];

  const frontends = activeProject?.targetFrontends ?? ["esde"];

  return (
    <div className="flex gap-3 flex-wrap items-end">
      {/* Library path */}
      <div className="flex-1 min-w-48 space-y-1">
        <label className="text-xs font-semibold text-romio-gray">Library root</label>
        <div className="flex gap-2">
          <input
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder="/path/to/roms"
            className="flex-1 px-3 py-2 rounded-lg bg-background-surface border border-white/10
                       text-sm font-mono text-romio-cream placeholder:text-romio-gray
                       focus:outline-hidden focus:border-romio-green/40"
          />
          <button
            onClick={browse}
            disabled={browsing}
            className="px-3 py-2 rounded-lg bg-background-surface border border-white/10
                       text-romio-gray hover:text-romio-cream hover:bg-white/5 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
            title="Browse"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Frontend select */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-romio-gray">Frontend</label>
        <div className="relative">
          <select
            value={frontend}
            onChange={(e) => onFrontendChange(e.target.value)}
            className="appearance-none px-3 py-2 pr-8 rounded-lg bg-background-surface border border-white/10
                       text-sm text-romio-cream focus:outline-hidden focus:border-romio-green/40"
          >
            {frontends.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5
                                  text-romio-gray pointer-events-none" />
        </div>
      </div>

      {/* Emulator select */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-romio-gray">Emulator</label>
        <div className="relative">
          <select
            value={emulator}
            onChange={(e) => onEmulatorChange(e.target.value)}
            title="Used for the systems that can run it. Other systems keep their recommended emulator."
            className="appearance-none px-3 py-2 pr-8 rounded-lg bg-background-surface border border-white/10
                       text-sm text-romio-cream focus:outline-hidden focus:border-romio-green/40"
          >
            {emulators.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5
                                  text-romio-gray pointer-events-none" />
        </div>
      </div>

      {/* Scan button */}
      <button
        onClick={onScan}
        disabled={!path || isScanning || !ready}
        className="px-4 py-2 rounded-lg bg-romio-green-fill text-white text-sm font-semibold
                   hover:bg-romio-green-fill/90 disabled:opacity-40 disabled:cursor-not-allowed
                   transition-colors flex items-center gap-2"
      >
        {isScanning
          ? <><div className="w-3 h-3 border-2 border-white/40 border-t-white
                               rounded-full animate-spin" /> Scanning…</>
          : "Scan ▶"
        }
      </button>
    </div>
  );
}
