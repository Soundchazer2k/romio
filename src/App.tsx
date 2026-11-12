// SPDX-License-Identifier: GPL-3.0
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore, useScanStore, type Screen } from "@/stores";
import type { ScanProgress } from "@/types";

// Screens
import { WelcomeScreen }    from "@/components/dashboard/WelcomeScreen";
import { ProjectsScreen }   from "@/components/dashboard/ProjectsScreen";
import { PreflightScreen }  from "@/components/preflight/PreflightScreen";
import { DashboardScreen }  from "@/components/dashboard/DashboardScreen";
import { BiosScreen }       from "@/components/bios/BiosScreen";
import { FormatScreen }    from "@/components/format/FormatScreen";
import { SavesScreen }      from "@/components/saves/SavesScreen";
import { MultiDiscScreen }  from "@/components/multidisc/MultiDiscScreen";
import { ScummVmScreen }    from "@/components/scummvm/ScummVmScreen";
import { InstalledScreen }  from "@/components/installed/InstalledScreen";

// Layout
import { Sidebar }          from "@/components/shared/Sidebar";
import { Titlebar }         from "@/components/shared/Titlebar";

const SCREENS: Record<Screen, React.ComponentType> = {
  welcome:    WelcomeScreen,
  projects:   ProjectsScreen,
  preflight:  PreflightScreen,
  dashboard:  DashboardScreen,
  bios:       BiosScreen,
  format:     FormatScreen,
  multidisc:  MultiDiscScreen,
  scummvm:    ScummVmScreen,
  installed:  InstalledScreen,
  saves:      SavesScreen,
  export:     () => <PlaceholderScreen name="Export Planner" />,
  preview:    () => <PlaceholderScreen name="Change Preview" />,
  rollback:   () => <PlaceholderScreen name="Rollback History" />,
  smoketest:  () => <PlaceholderScreen name="Smoke Test Results" />,
};

function PlaceholderScreen({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <p className="text-2xl font-semibold text-romio-gray">{name}</p>
        <p className="text-sm text-romio-gray">Coming soon</p>
      </div>
    </div>
  );
}

export default function App() {
  const { screen, sidebarOpen } = useAppStore();
  const { setProgress } = useScanStore();

  // Listen for scan progress events from the Rust backend
  useEffect(() => {
    const unlisten = listen<ScanProgress>("scan_progress", (event) => {
      // "complete" only ends the walk. The Dashboard clears this once saving and the BIOS sweep finish.
      setProgress(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setProgress]);

  const ActiveScreen = SCREENS[screen];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-romio-cream">
      {/* Custom titlebar */}
      <Titlebar />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && <Sidebar />}

        {/* Main content */}
        <main className="flex-1 overflow-auto relative z-1">
          <ActiveScreen />
        </main>
      </div>
    </div>
  );
}
