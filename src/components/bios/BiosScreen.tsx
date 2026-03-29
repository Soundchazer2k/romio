// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ChevronDown, ChevronRight, ExternalLink, Copy, FolderOpen } from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type { BiosSystemResult, BiosEntryResult } from "@/types";
import { cn, biosStateColor, biosStateBg, biosStateLabel, truncatePath } from "@/lib/utils";

// All systems that may have BIOS requirements
const SYSTEMS = [
  { id: "ps1",       name: "PlayStation 1",     emulator: "duckstation" },
  { id: "ps2",       name: "PlayStation 2",     emulator: "pcsx2" },
  { id: "saturn",    name: "Sega Saturn",        emulator: "lr-beetle-saturn" },
  { id: "segacd",    name: "Sega CD",            emulator: "lr-genesis-plus-gx" },
  { id: "sega32x",   name: "Sega 32X",           emulator: "lr-picodrive" },
  { id: "dreamcast", name: "Dreamcast",          emulator: "lr-flycast" },
  { id: "tg16cd",    name: "TurboGrafx-CD",      emulator: "lr-beetle-pce" },
  { id: "nds",       name: "Nintendo DS",        emulator: "melonds" },
  { id: "fds",       name: "Famicom Disk System",emulator: "lr-mesen" },
  { id: "3do",       name: "Panasonic 3DO",      emulator: "lr-opera" },
  { id: "neogeo",    name: "Neo Geo",            emulator: "lr-fbneo" },
  { id: "xbox",      name: "Xbox (OG)",          emulator: "xemu" },
];

export function BiosScreen() {
  const { activeProject } = useAppStore();
  const [biosRoot, setBiosRoot] = useState<string>("");
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  const [selectedFrontend, setSelectedFrontend] = useState(
    activeProject?.targetFrontends[0] ?? "esde"
  );

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-xl bg-romio-green/10 border border-romio-green/20">
          <Shield className="w-5 h-5 text-romio-green" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">BIOS Validation</h1>
          <p className="text-romio-gray text-sm mt-0.5">
            Hash-first identification. Frontend-aware path rules. 5-state output.
          </p>
        </div>
      </div>

      {/* Config row */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-48 space-y-1">
          <label className="text-xs font-medium text-romio-gray/70 uppercase tracking-widest">BIOS directory</label>
          <div className="relative flex items-center w-full">
            <div className="absolute left-0 flex items-center h-full pl-3 pr-2.5
                            border-r border-white/10 pointer-events-none">
              <FolderOpen className="w-4 h-4 text-romio-gray/50" />
            </div>
            <input
              value={biosRoot}
              onChange={(e) => setBiosRoot(e.target.value)}
              placeholder="/path/to/bios"
              className="w-full pl-11 pr-3 py-2 rounded-lg bg-romio-surface border border-white/10
                         text-sm font-mono text-romio-cream placeholder:text-romio-gray/40
                         focus:outline-none focus:border-romio-green/40"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-romio-gray/70 uppercase tracking-widest">Frontend</label>
          <div className="relative">
            <select
              value={selectedFrontend}
              onChange={(e) => setSelectedFrontend(e.target.value)}
              className="appearance-none px-3 py-2 pr-8 rounded-lg bg-romio-surface border border-white/10
                         text-sm text-romio-cream focus:outline-none focus:border-romio-green/40"
            >
              {(activeProject?.targetFrontends ?? ["esde"]).map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5
                                    text-romio-gray/60 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* System list */}
      <div className="space-y-2">
        {SYSTEMS.map((sys, i) => (
          <SystemRow
            key={sys.id}
            sys={sys}
            biosRoot={biosRoot}
            frontend={selectedFrontend}
            expanded={expandedSystem === sys.id}
            onToggle={() => setExpandedSystem(
              expandedSystem === sys.id ? null : sys.id
            )}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

function SystemRow({ sys, biosRoot, frontend, expanded, onToggle, index }: {
  sys:      { id: string; name: string; emulator: string };
  biosRoot: string;
  frontend: string;
  expanded: boolean;
  onToggle: () => void;
  index:    number;
}) {
  const { data: result, isLoading } = useQuery({
    queryKey: ["bios", sys.id, biosRoot, frontend, sys.emulator],
    queryFn:  () => ipc.validateBios(sys.id, biosRoot, frontend, sys.emulator),
    enabled:  biosRoot.length > 0,
  });

  const blocking = result?.blocking ?? false;
  const allValid = result?.entries.every((e) => e.state === "PRESENT_VALID") ?? false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(
        "rounded-xl border transition-colors overflow-hidden",
        blocking  ? "border-romio-red/30 bg-romio-red/5" :
        allValid  ? "border-romio-green/20" :
                    "border-border bg-romio-surface/40"
      )}
    >
      {/* System header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5
                   transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-romio-gray flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-romio-gray flex-shrink-0" />
          }
          <div>
            <span className="font-medium text-sm text-romio-cream">{sys.name}</span>
            <span className="ml-2 text-xs text-romio-gray font-mono">{sys.emulator}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLoading && biosRoot && (
            <div className="w-3 h-3 rounded-full border-2 border-romio-green/40
                             border-t-romio-green animate-spin" />
          )}
          {result && (
            <SystemStatusBadge result={result} />
          )}
          {!biosRoot && (
            <span className="text-xs text-romio-gray/50">Set BIOS dir to validate</span>
          )}
        </div>
      </button>

      {/* Expanded entries */}
      <AnimatePresence>
        {expanded && result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-3 space-y-2">
              {result.entries.map((entry) => (
                <BiosEntryRow key={entry.rule.filename} entry={entry} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SystemStatusBadge({ result }: { result: BiosSystemResult }) {
  if (result.blocking) {
    return <span className="text-xs font-medium text-romio-red">Blocking</span>;
  }
  if (result.entries.every((e) => e.state === "PRESENT_VALID")) {
    return <span className="text-xs font-medium text-romio-green">All valid</span>;
  }
  const missing = result.entries.filter((e) =>
    e.state === "MISSING_OPTIONAL" || e.state === "MISSING_REQUIRED"
  ).length;
  if (missing > 0) {
    return <span className="text-xs font-medium text-amber-400">{missing} missing</span>;
  }
  return <span className="text-xs font-medium text-amber-400">Issues found</span>;
}

function BiosEntryRow({ entry }: { entry: BiosEntryResult }) {
  const [_copied, setCopied] = useState(false);

  function copyMd5() {
    if (entry.foundMd5) {
      navigator.clipboard.writeText(entry.foundMd5);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className={cn(
      "px-3 py-2.5 rounded-lg border text-sm",
      biosStateBg(entry.state),
      entry.state === "PRESENT_VALID" ? "border-romio-green/10" :
      entry.state === "MISSING_REQUIRED" ? "border-romio-red/20" :
      "border-border"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-mono text-xs font-medium", biosStateColor(entry.state))}>
              {entry.rule.filename}
            </span>
            {entry.rule.region && (
              <span className="text-xs text-romio-gray border border-border px-1.5 rounded">
                {entry.rule.region}
              </span>
            )}
            <span className={cn("text-xs", biosStateColor(entry.state))}>
              {biosStateLabel(entry.state)}
            </span>
          </div>

          {entry.foundPath && (
            <p className="font-mono text-xs text-romio-gray mt-1 truncate">
              {truncatePath(entry.foundPath)}
            </p>
          )}

          {entry.renameFrom && (
            <p className="text-xs text-amber-400 mt-1">
              Found as: <span className="font-mono">{entry.renameFrom}</span> — rename recommended
            </p>
          )}

          {entry.badDumpLabel && (
            <p className="text-xs text-romio-red mt-1">
              ⚠ Known bad dump: {entry.badDumpLabel}
            </p>
          )}

          {entry.rule.notes && (
            <p className="text-xs text-romio-gray/70 mt-1">{entry.rule.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {entry.foundMd5 && (
            <button onClick={copyMd5} title="Copy MD5"
              className="text-romio-gray hover:text-romio-cream transition-colors">
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {entry.state === "MISSING_REQUIRED" && entry.rule.dumpingGuideUrl && (
            <a href={entry.rule.dumpingGuideUrl} target="_blank" rel="noopener noreferrer"
               className="text-blue-400 hover:text-blue-300 transition-colors" title="Dumping guide">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
