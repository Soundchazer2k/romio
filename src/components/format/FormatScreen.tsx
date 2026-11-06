// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { FileSearch, HelpCircle } from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type {
  FormatSystemGroup, FormatRule, StagedFix,
  EmulatorMatrixEntry, FormatCheckResult,
} from "@/types";
import { emulatorForSystem, groupResultsBySystem } from "@/lib/utils";
import { FormatConfigBar }       from "./FormatConfigBar";
import { FormatSystemRow }       from "./FormatSystemRow";
import { FormatFixTray }         from "./FormatFixTray";
import { FormatFixPlanModal }    from "./FormatFixPlanModal";
import { FormatReferenceDrawer } from "./FormatReferenceDrawer";

// Small enough that the count keeps moving inside one big folder
const CHECK_CHUNK_SIZE = 200;

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
  const [progress,    setProgress]    = useState<{ checked: number; total: number } | null>(null);
  const [scanError,   setScanError]   = useState<string | null>(null);
  const [scanned,     setScanned]     = useState(false);
  const [scannedWith, setScannedWith] = useState({ path: "", frontend: "", emulator: "" });
  const [groups,      setGroups]      = useState<FormatSystemGroup[]>([]);
  const [expandedSys, setExpandedSys] = useState<string | null>(null);

  // Fix plan state
  const [stagedFixes, setStagedFixes] = useState<StagedFix[]>([]);
  const [planOpen,    setPlanOpen]    = useState(false);
  const [drawerOpen,  setDrawerOpen]  = useState(false);

  // Load the format matrix on mount (used by impact tables + reference drawer)
  const { data: rules = [], isSuccess: rulesLoaded, isError: rulesFailed } = useQuery<FormatRule[]>({
    queryKey: ["format-matrix"],
    queryFn:  () => ipc.getFormatMatrix(),
  });

  // Load emulator matrix on mount (used for "auto" emulator resolution)
  const { data: emulatorMatrix = [], isSuccess: matrixLoaded, isError: matrixFailed } = useQuery<EmulatorMatrixEntry[]>({
    queryKey: ["emulator-matrix"],
    queryFn:  () => ipc.getEmulatorMatrix(),
  });

  // Without these, every file would read as "No rules yet"
  const ready = rulesLoaded && matrixLoaded;
  const bannerError = scanError
    ?? (rulesFailed || matrixFailed ? "Romio couldn't load its format rules, so it can't check this library. Restart Romio and try again." : null);

  async function runScan() {
    if (!libraryPath || !ready) return;
    setIsScanning(true);
    setProgress(null);
    setScanError(null);
    setGroups([]);
    setScanned(false);
    setStagedFixes([]);
    setScannedWith({ path: libraryPath, frontend, emulator: emulatorOverride });

    try {
      const allResults: FormatCheckResult[] = [];

      // System folders and their game files, listed by the backend (uses roms/ when present)
      const folders = await ipc.listLibraryFolders(libraryPath);
      const unreadable = folders.filter((f) => f.error).map((f) => f.name);

      const total = folders.reduce((sum, f) => sum + f.files.length, 0);
      let checked = 0;
      setProgress({ checked, total });

      for (const folder of folders) {
        const systemId = folder.system;

        const emu = emulatorForSystem(systemId, emulatorOverride, emulatorMatrix);

        for (let i = 0; i < folder.files.length; i += CHECK_CHUNK_SIZE) {
          const chunk = folder.files.slice(i, i + CHECK_CHUNK_SIZE);
          try {
            allResults.push(...await ipc.checkFormatBatch(chunk, systemId, emu, frontend));
          } catch {
            // Failed call: its files become Unknown results, and the scan goes on
            for (const filePath of chunk) {
              const name = filePath.split(/[\\/]/).pop() ?? filePath;
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
          checked += chunk.length;
          setProgress({ checked, total });
        }
      }

      setGroups(groupResultsBySystem(allResults));
      setScanned(true);
      if (unreadable.length > 0) {
        setScanError(`Romio couldn't read these folders, so their games weren't checked: ${unreadable.join(", ")}.`);
      }
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
  // scanned, not hasResults: an empty scan goes out of date too
  const stale = scanned && (
    scannedWith.path !== libraryPath ||
    scannedWith.frontend !== frontend ||
    scannedWith.emulator !== emulatorOverride
  );
  const pick = scannedWith.emulator;
  const pickedSystems = groups.filter((g) => g.results[0]?.emulator === pick).map((g) => g.system);
  // A system outside the matrix used no emulator at all, so it isn't "a different one"
  const otherCount = groups.filter((g) => {
    const emulator = g.results[0]?.emulator;
    return emulator !== pick && emulator !== "unknown";
  }).length;

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
                     hover:bg-white/5 transition-colors shrink-0"
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
        ready={ready}
        onPathChange={setLibraryPath}
        onFrontendChange={setFrontend}
        onEmulatorChange={setEmulatorOverride}
        onScan={runScan}
      />

      {/* Scan progress */}
      {isScanning && (
        <p role="status" className="font-mono text-sm text-romio-gray">
          {progress
            ? `Checked ${progress.checked.toLocaleString()} of ${progress.total.toLocaleString()} ${progress.total === 1 ? "file" : "files"}`
            : "Finding game files…"}
        </p>
      )}

      {/* Scan error banner */}
      {bannerError && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3 rounded-xl bg-romio-red/10 border border-romio-red/20
                     text-sm text-romio-red"
        >
          {bannerError}
        </motion.div>
      )}

      {/* Results no longer match the settings above */}
      {stale && (
        <p
          role="status"
          className="px-4 py-3 rounded-xl bg-amber-400/10 border border-amber-400/20
                     text-sm text-amber-400"
        >
          You changed the settings, so these results are out of date. They're for{" "}
          {scannedWith.path} on {scannedWith.frontend} with emulator {pick}. Scan again to update them.
        </p>
      )}

      {/* A picked emulator only runs on systems that list it; never let "All OK" imply otherwise */}
      {!stale && pick !== "auto" && hasResults && pickedSystems.length < groups.length && (
        <p
          role="status"
          className="px-4 py-3 rounded-xl bg-amber-400/10 border border-amber-400/20
                     text-sm text-amber-400"
        >
          {pickedSystems.length > 0
            ? `${pick} only applies to ${pickedSystems.join(", ")}.${otherCount > 0 ? ` ${otherCount} other ${otherCount === 1 ? "system" : "systems"} used a different emulator, shown on each row.` : ""}`
            : `${pick} doesn't apply to any system in this scan.${otherCount > 0 ? " Each system with an emulator used a different one, shown on its row." : ""}`}
        </p>
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
      {!hasResults && !isScanning && !bannerError && (
        <div className="text-center py-16 text-romio-gray space-y-2">
          <FileSearch className="w-10 h-10 mx-auto opacity-30" />
          <p>{scanned
            ? `No game files found in ${scannedWith.path}. Point it at your frontend folder or its roms folder.`
            : ready ? "Run a scan to check your library" : "Loading format rules…"}</p>
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
