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
import { SavesScreen }      from "@/components/saves/SavesScreen";

// Layout
import { Sidebar }          from "@/components/shared/Sidebar";
import { Titlebar }         from "@/components/shared/Titlebar";

const SCREENS: Record<Screen, React.ComponentType> = {
  welcome:    WelcomeScreen,
  projects:   ProjectsScreen,
  preflight:  PreflightScreen,
  dashboard:  DashboardScreen,
  bios:       BiosScreen,
  format:     () => <PlaceholderScreen name="Format Compatibility" />,
  multidisc:  () => <PlaceholderScreen name="Multi-Disc Toolkit" />,
  scummvm:    () => <PlaceholderScreen name="ScummVM Workspace" />,
  installed:  () => <PlaceholderScreen name="Installed Titles" />,
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
        <p className="text-2xl font-semibold text-romio-cream/60">{name}</p>
        <p className="text-sm text-romio-gray">Coming soon</p>
      </div>
    </div>
  );
}

export default function App() {
  const { screen, sidebarOpen } = useAppStore();
  const { setScanning, setProgress } = useScanStore();

  // Listen for scan progress events from the Rust backend
  useEffect(() => {
    const unlisten = listen<ScanProgress>("scan_progress", (event) => {
      setProgress(event.payload);
      if (event.payload.phase === "complete") {
        setScanning(false);
        setProgress(null);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setScanning, setProgress]);

  const ActiveScreen = SCREENS[screen];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0F0F11] text-romio-cream">
      {/* Custom titlebar */}
      <Titlebar />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && <Sidebar />}

        {/* Main content */}
        <main className="flex-1 overflow-auto relative z-[1]">
          <ActiveScreen />
        </main>
      </div>
    </div>
  );
}
