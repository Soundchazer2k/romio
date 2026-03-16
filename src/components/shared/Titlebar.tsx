// SPDX-License-Identifier: GPL-3.0
import { Menu, PanelLeft } from "lucide-react";
import { useAppStore } from "@/stores";
import { useScanStore } from "@/stores";

export function Titlebar() {
  const { setSidebarOpen, sidebarOpen, activeProject } = useAppStore();
  const { isScanning, progress } = useScanStore();

  return (
    <header
      data-tauri-drag-region
      className="h-10 flex items-center justify-between px-3 bg-romio-black
                 border-b border-border select-none flex-shrink-0 z-10"
    >
      {/* Left: sidebar toggle + logo */}
      <div className="flex items-center gap-2" data-tauri-drag-region="false">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1 rounded hover:bg-white/5 text-romio-gray hover:text-romio-cream
                     transition-colors focus:outline-none"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5">
          {/* Small Romio icon */}
          <img src="/romio/romio_accomplished.png" alt="Romio" className="w-5 h-5 object-contain" />
          <span className="text-sm font-semibold text-romio-cream tracking-wide">Romio</span>
          {activeProject && (
            <span className="text-xs text-romio-gray">— {activeProject.name}</span>
          )}
        </div>
      </div>

      {/* Center: scan progress indicator */}
      {isScanning && progress && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-romio-green animate-pulse" />
          <span className="text-xs text-romio-gray">
            Scanning… {progress.filesScanned.toLocaleString()} files
          </span>
        </div>
      )}

      {/* Right: version */}
      <span className="text-xs text-romio-gray/50">v0.1.0</span>
    </header>
  );
}
