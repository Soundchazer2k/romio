// SPDX-License-Identifier: GPL-3.0
import { motion } from "framer-motion";
import { Home, Shield, Save, Cpu, FileCode2 } from "lucide-react";
import { useAppStore, type Screen } from "@/stores";
import { RomioCompanion } from "@/components/romio/RomioCompanion";
import { cn } from "@/lib/utils";

interface NavItem {
  id:      Screen;
  label:   string;
  icon:    React.ComponentType<{ className?: string }>;
  divider?: boolean;
}

// Only finished screens. Multi-Disc, ScummVM, Installed, Export, Change Preview and
// Rollback stay out until they're built (DESIGN.md: no sidebar items to "Coming soon").
const NAV: NavItem[] = [
  { id: "dashboard",  label: "Dashboard",     icon: Home },
  { id: "preflight",  label: "Pre-flight",    icon: Cpu,        divider: true },
  { id: "bios",       label: "BIOS",          icon: Shield },
  { id: "format",     label: "Format Check",  icon: FileCode2 },
  { id: "saves",      label: "Save Migration",icon: Save,       divider: true },
];

export function Sidebar() {
  const { screen, setScreen, romioState, activeProject } = useAppStore();

  return (
    <motion.aside
      initial={{ x: -240 }}
      animate={{ x: 0 }}
      className="w-56 shrink-0 flex flex-col bg-background-surface border-r border-border
                 h-full overflow-hidden"
    >
      {/* Project name */}
      <div className="px-4 py-3 border-b border-border">
        {activeProject ? (
          <>
            <p className="text-xs text-romio-gray font-semibold">Project</p>
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
        "text-left focus:outline-hidden focus-visible:ring-1 focus-visible:ring-romio-green",
        active
          ? "bg-romio-green/15 text-romio-green font-medium"
          : "text-romio-gray hover:text-romio-cream hover:bg-white/5"
      )}
    >
      <Icon className={cn("w-4 h-4 shrink-0", active && "text-romio-green")} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}
