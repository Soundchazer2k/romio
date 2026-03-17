// SPDX-License-Identifier: GPL-3.0
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import type { EmulatorMatrixEntry } from "@/types";
import { useAppStore } from "@/stores";

interface Props {
  path:           string;
  frontend:       string;
  emulator:       string;           // "auto" or specific emulator id
  emulatorMatrix: EmulatorMatrixEntry[];
  isScanning:     boolean;
  onPathChange:     (v: string) => void;
  onFrontendChange: (v: string) => void;
  onEmulatorChange: (v: string) => void;
  onScan:           () => void;
}

export function FormatConfigBar({
  path, frontend, emulator, emulatorMatrix,
  isScanning, onPathChange, onFrontendChange, onEmulatorChange, onScan,
}: Props) {
  const { activeProject } = useAppStore();

  async function browse() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") onPathChange(selected);
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
        <label className="text-xs text-romio-gray uppercase tracking-wider">Library root</label>
        <div className="flex gap-2">
          <input
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder="/path/to/roms"
            className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-border
                       text-sm font-mono text-romio-cream placeholder:text-romio-gray/40
                       focus:outline-none focus:border-romio-green/40"
          />
          <button
            onClick={browse}
            className="px-3 py-2 rounded-lg bg-black/30 border border-border
                       text-romio-gray hover:text-romio-cream hover:bg-white/5 transition-colors"
            title="Browse"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Frontend select */}
      <div className="space-y-1">
        <label className="text-xs text-romio-gray uppercase tracking-wider">Frontend</label>
        <select
          value={frontend}
          onChange={(e) => onFrontendChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-black/30 border border-border text-sm
                     text-romio-cream focus:outline-none focus:border-romio-green/40"
        >
          {frontends.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Emulator select */}
      <div className="space-y-1">
        <label className="text-xs text-romio-gray uppercase tracking-wider">Emulator</label>
        <select
          value={emulator}
          onChange={(e) => onEmulatorChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-black/30 border border-border text-sm
                     text-romio-cream focus:outline-none focus:border-romio-green/40"
        >
          {emulators.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      {/* Scan button */}
      <button
        onClick={onScan}
        disabled={!path || isScanning}
        className="px-4 py-2 rounded-lg bg-romio-green text-romio-dark text-sm font-semibold
                   hover:bg-romio-green/90 disabled:opacity-40 disabled:cursor-not-allowed
                   transition-colors flex items-center gap-2"
      >
        {isScanning
          ? <><div className="w-3 h-3 border-2 border-romio-dark/40 border-t-romio-dark
                               rounded-full animate-spin" /> Scanning…</>
          : "Scan ▶"
        }
      </button>
    </div>
  );
}
