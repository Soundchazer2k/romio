// SPDX-License-Identifier: GPL-3.0
import { motion } from "framer-motion";
import {
  Home, FolderOpen, Shield, Disc, HardDrive,
  GamepadIcon, Save, Upload, RotateCcw, Cpu, FileCode2
} from "lucide-react";
import { useAppStore, type Screen } from "@/stores";
import { RomioCompanion } from "@/components/romio/RomioCompanion";
import { cn } from "@/lib/utils";

interface NavItem {
  id:      Screen;
  label:   string;
  icon:    React.ComponentType<{ className?: string }>;
  divider?: boolean;
}

const NAV: NavItem[] = [
  { id: "dashboard",  label: "Dashboard",     icon: Home },
  { id: "preflight",  label: "Pre-flight",    icon: Cpu,        divider: true },
  { id: "bios",       label: "BIOS",          icon: Shield },
  { id: "format",     label: "Format Check",  icon: FileCode2 },
  { id: "multidisc",  label: "Multi-Disc",    icon: Disc },
  { id: "scummvm",    label: "ScummVM",        icon: GamepadIcon },
  { id: "installed",  label: "Installed",     icon: HardDrive, divider: true },
  { id: "saves",      label: "Save Migration",icon: Save },
  { id: "export",     label: "Export",        icon: Upload,    divider: true },
  { id: "preview",    label: "Change Preview",icon: FolderOpen },
  { id: "rollback",   label: "Rollback",      icon: RotateCcw },
];

export function Sidebar() {
  const { screen, setScreen, romioState, activeProject } = useAppStore();

  return (
    <motion.aside
      initial={{ x: -240 }}
      animate={{ x: 0 }}
      className="w-56 flex-shrink-0 flex flex-col bg-romio-surface border-r border-border
                 h-full overflow-hidden"
    >
      {/* Project name */}
      <div className="px-4 py-3 border-b border-border">
        {activeProject ? (
          <>
            <p className="text-xs text-romio-gray uppercase tracking-widest">Project</p>
            <p className="text-sm font-semibold text-romio-cream truncate mt-0.5">
              {activeProject.name}
            </p>
          </>
        ) : (
          <p className="text-xs text-romio-gray">No project open</p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {NAV.map((item) => (
          <div key={item.id}>
            {item.divider && (
              <div className="my-2 border-t border-border" />
            )}
            <NavButton
              item={item}
              active={screen === item.id}
              onClick={() => setScreen(item.id)}
            />
          </div>
        ))}
      </nav>

      {/* Romio companion — bottom of sidebar */}
      <div className="border-t border-border">
        <RomioCompanion state={romioState} />
      </div>
    </motion.aside>
  );
}

function NavButton({
  item, active, onClick
}: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
        "text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-romio-green",
        active
          ? "bg-romio-green/15 text-romio-green font-medium"
          : "text-romio-gray hover:text-romio-cream hover:bg-white/5"
      )}
    >
      <Icon className={cn("w-4 h-4 flex-shrink-0", active && "text-romio-green")} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}
