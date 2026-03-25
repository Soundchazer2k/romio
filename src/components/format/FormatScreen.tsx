// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { readDir } from "@tauri-apps/plugin-fs";
import { FileSearch, HelpCircle } from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type {
  FormatSystemGroup, FormatRule, StagedFix,
  EmulatorMatrixEntry, FormatCheckResult,
} from "@/types";
import { groupResultsBySystem } from "@/lib/utils";
import { FormatConfigBar }       from "./FormatConfigBar";
import { FormatSystemRow }       from "./FormatSystemRow";
import { FormatFixTray }         from "./FormatFixTray";
import { FormatFixPlanModal }    from "./FormatFixPlanModal";
import { FormatReferenceDrawer } from "./FormatReferenceDrawer";

function joinPath(root: string, ...parts: string[]): string {
  const sep = root.includes("\\") ? "\\" : "/";
  return [root, ...parts].join(sep);
}

export function FormatScreen() {
  const { activeProject } = useAppStore();

  // Config state — pre-fill from active project if available
  const [libraryPath, setLibraryPath] = useState(
    activeProject?.libraryRoots[0] ?? ""
  );
  const [frontend, setFrontend] = useState(
    activeProject?.targetFrontends[0] ?? "esde"
  );
  const [emulatorOverride, setEmulatorOverride] = useState("auto");

  // Scan state
  const [isScanning,  setIsScanning]  = useState(false);
  const [scanError,   setScanError]   = useState<string | null>(null);
  const [groups,      setGroups]      = useState<FormatSystemGroup[]>([]);
  const [expandedSys, setExpandedSys] = useState<string | null>(null);

  // Fix plan state
  const [stagedFixes, setStagedFixes] = useState<StagedFix[]>([]);
  const [planOpen,    setPlanOpen]    = useState(false);
  const [drawerOpen,  setDrawerOpen]  = useState(false);

  // Load the format matrix on mount (used by impact tables + reference drawer)
  const { data: rules = [] } = useQuery<FormatRule[]>({
    queryKey: ["format-matrix"],
    queryFn:  () => ipc.getFormatMatrix(),
  });

  // Load emulator matrix on mount (used for "auto" emulator resolution)
  const { data: emulatorMatrix = [] } = useQuery<EmulatorMatrixEntry[]>({
    queryKey: ["emulator-matrix"],
    queryFn:  () => ipc.getEmulatorMatrix(),
  });

  async function runScan() {
    if (!libraryPath) return;
    setIsScanning(true);
    setScanError(null);
    setGroups([]);
    setStagedFixes([]);

    try {
      const allResults: FormatCheckResult[] = [];

      // Walk one level: top-level folders = systems
      const systemEntries = await readDir(libraryPath);
      const systemFolders = systemEntries.filter((e) => e.isDirectory);

      for (const sysEntry of systemFolders) {
        const systemId = sysEntry.name;
        if (!systemId) continue;
        const systemPath = joinPath(libraryPath, systemId);

        // Determine emulator for this system
        const emu = emulatorOverride === "auto"
          ? (emulatorMatrix.find((m) => m.system === systemId)?.recommended ?? "unknown")
          : emulatorOverride;

        // Walk files in this system folder (non-recursive)
        let fileEntries;
        try {
          fileEntries = await readDir(systemPath);
        } catch {
          continue; // skip unreadable dirs
        }

        const files = fileEntries.filter((e) => e.isFile && !!e.name);

        for (const file of files) {
          const name = file.name!;
          const filePath = joinPath(systemPath, name);
          try {
            const result = await ipc.checkFormat(filePath, systemId, emu, frontend);
            allResults.push(result);
          } catch {
            // Per-file error: push Unknown result
            const ext = name.includes(".")
              ? name.split(".").pop() ?? ""
              : "";
            allResults.push({
              path:      filePath,
              extension: ext,
              system:    systemId,
              emulator:  emu,
              state:     "Unknown",
              notes:     "Check failed — file may be unreadable",
            });
          }
        }
      }

      setGroups(groupResultsBySystem(allResults));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  }

  function stageFix(fix: StagedFix) {
    setStagedFixes((prev) =>
      prev.some((f) => f.result.path === fix.result.path)
        ? prev
        : [...prev, fix]
    );
  }

  const hasResults = groups.length > 0;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-romio-green/10 border border-romio-green/20">
            <FileSearch className="w-5 h-5 text-romio-green" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-romio-cream">Format Compatibility</h1>
            <p className="text-romio-gray text-sm mt-0.5">
              Scan your library for format issues before they cause silent launch failures.
            </p>
          </div>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          title="Format rules reference"
          className="p-2 rounded-lg text-romio-gray hover:text-romio-cream
                     hover:bg-white/5 transition-colors flex-shrink-0"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      </div>

      {/* Config bar */}
      <FormatConfigBar
        path={libraryPath}
        frontend={frontend}
        emulator={emulatorOverride}
        emulatorMatrix={emulatorMatrix}
        isScanning={isScanning}
        onPathChange={setLibraryPath}
        onFrontendChange={setFrontend}
        onEmulatorChange={setEmulatorOverride}
        onScan={runScan}
      />

      {/* Scan error banner */}
      {scanError && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3 rounded-xl bg-romio-red/10 border border-romio-red/20
                     text-sm text-romio-red"
        >
          {scanError}
        </motion.div>
      )}

      {/* Results */}
      {hasResults && (
        <div className="space-y-2">
          {groups.map((group, i) => (
            <FormatSystemRow
              key={group.system}
              group={group}
              rules={rules}
              stagedFixes={stagedFixes}
              expanded={expandedSys === group.system}
              onToggle={() => setExpandedSys(
                expandedSys === group.system ? null : group.system
              )}
              index={i}
              onStageFix={stageFix}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!hasResults && !isScanning && !scanError && (
        <div className="text-center py-16 text-romio-gray space-y-2">
          <FileSearch className="w-10 h-10 mx-auto opacity-30" />
          <p>Run a scan to check your library</p>
        </div>
      )}

      {/* Fix tray — conditionally mounted so AnimatePresence can animate exit */}
      <AnimatePresence>
        {stagedFixes.length > 0 && (
          <FormatFixTray
            fixes={stagedFixes}
            onClear={() => setStagedFixes([])}
            onReviewPlan={() => setPlanOpen(true)}
          />
        )}
      </AnimatePresence>

      {/* Fix plan modal */}
      <AnimatePresence>
        {planOpen && (
          <FormatFixPlanModal
            fixes={stagedFixes}
            onClose={() => setPlanOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Reference drawer */}
      <FormatReferenceDrawer
        open={drawerOpen}
        rules={rules}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
