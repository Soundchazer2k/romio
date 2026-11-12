// SPDX-License-Identifier: GPL-3.0
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Play, XCircle, Info, CheckCircle2 } from "lucide-react";
import { useAppStore, useScanStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import { cn, biosIssueLabel } from "@/lib/utils";
import { SCENARIOS, SCENARIO_ORDER, dashboardChecks, type DashboardCheck, type Scenario } from "@/lib/scenario";
import type { Project } from "@/types";

function biosBadge(project: Project): {
  label: string;
  color: "gray" | "amber" | "red" | "green";
} {
  if (!project.biosRoot)     return { label: "Not configured", color: "gray" };
  if (!project.biosResults)  return { label: "Not validated",  color: "gray" };

  const results      = project.biosResults;
  const erroredCount  = results.filter(r => r.errored).length;
  const blockingCount = results.filter(r => r.blocking).length;
  const issue         = biosIssueLabel(results.flatMap(r => r.entries));

  if (blockingCount > 0) return { label: `${blockingCount} blocking`,          color: "red"   };
  if (erroredCount  > 0) return { label: `${erroredCount} systems incomplete`, color: "amber" };
  if (issue)             return { label: issue,                                color: "amber" };
  return { label: "All valid", color: "green" };
}

// Each project's scans are numbered, and the latest one that succeeded is remembered. A
// reload belonging to an earlier scan is dropped once a later scan has succeeded, whether
// that reload worked or not. A later scan that fails saved nothing, so it drops nothing.
// Kept outside the component because the scan outlives the screen.
const latestScan = new Map<string, number>();
const latestSaved = new Map<string, number>();

export function DashboardScreen() {
  const { activeProject, refreshActiveProject, setScreen, setRomioState, scenario, setScenario } = useAppStore();
  const { scanningProject, setScanning, progress, setProgress, scanErrors, setScanError } = useScanStore();
  const queryClient = useQueryClient();

  const isScanning   = !!scanningProject;
  const scanningHere = isScanning && scanningProject.id === activeProject?.id;
  const scanFailure  = activeProject ? scanErrors[activeProject.id] : null;

  useEffect(() => {
    if (scanningHere) setRomioState("processing");
    else if (scanFailure) setRomioState("error");
  }, [scanningHere, scanFailure, setRomioState]);

  // The project travels with the scan: you can switch to another one before it ends
  const scanMut = useMutation({
    mutationFn: async (project: Project) => {
      setProgress(null);
      setScanning(project);
      setScanError(project.id, null);
      await ipc.scanLibrary(project.id, project.libraryRoots);
    },
    onMutate: (project) => {
      const run = (latestScan.get(project.id) ?? 0) + 1;
      latestScan.set(project.id, run);
      return { run };
    },
    onSuccess: async (_, project, context) => {
      setScanning(null);
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Re-fetch project so scanStats and lastScannedAt reflect persisted data.
      // If you've switched away there's nothing to update: opening it again fetches it fresh.
      const stillOpen = () => useAppStore.getState().activeProject?.id === project.id;
      if (context) latestSaved.set(project.id, context.run);
      // This scan saved, so a message left by an earlier scan's reload no longer applies
      setScanError(project.id, null);
      const superseded = () => latestSaved.get(project.id) !== context?.run;
      try {
        const reloaded = await ipc.getProject(project.id);
        if (superseded()) return;
        refreshActiveProject(reloaded);
        // A new scan may have started while this reload was out
        const idle = stillOpen() && !useScanStore.getState().scanningProject;
        if (idle && useAppStore.getState().screen === "dashboard") setRomioState("idle");
      } catch {
        if (stillOpen() && !superseded()) {
          setScanError(project.id, "The scan finished, but Romio couldn't load the new results. Scan again to see them.");
        }
      }
    },
    onError: (err, project) => {
      setScanning(null);
      setProgress(null);
      setScanError(project.id, `${String(err)}. The scan stopped${project.scanStats ? ", so these results may be out of date" : ""}.`);
    },
  });

  if (!activeProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-romio-gray">No project open.</p>
      </div>
    );
  }

  const stats = activeProject.scanStats;
  const finishing = progress?.phase === "saving";

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">{activeProject.name}</h1>
          <p className="text-sm text-romio-gray mt-0.5">
            {activeProject.libraryRoots.join(" · ")}
          </p>
          <div className="flex gap-2 mt-2">
            {activeProject.targetFrontends.map((f) => (
              <span key={f} className="px-2 py-0.5 text-xs rounded-full
                                       bg-romio-green/10 text-romio-green border border-romio-green/20">
                {f}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={() => scanMut.mutate(activeProject)}
          disabled={isScanning}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm",
            "transition-all shadow-romio-sm",
            isScanning
              ? "bg-romio-green/20 text-romio-green cursor-not-allowed"
              : "bg-romio-green-fill text-white hover:bg-romio-green-fill/90"
          )}
        >
          {isScanning ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-romio-green/40
                               border-t-romio-green animate-spin" />
              <span className="truncate max-w-48">
                {scanningHere
                  ? (finishing ? "Finishing…" : "Scanning…")
                  : `${finishing ? "Finishing" : "Scanning"} ${scanningProject.name}…`}
              </span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {stats ? "Re-scan Library" : "Scan Library"}
            </>
          )}
        </button>
      </div>

      {/* Scan progress bar */}
      {scanningHere && progress && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex justify-between text-xs text-romio-gray">
            <span className={cn("truncate max-w-xs", !finishing && "font-mono")}>
              {finishing ? "Finishing scan…" : progress.currentPath || "Scanning…"}
            </span>
            {!finishing && <span>{progress.filesScanned.toLocaleString()} files</span>}
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className={cn("h-full bg-romio-green rounded-full", finishing && "animate-pulse")}
              initial={{ width: 0 }}
              animate={{ width: finishing ? "100%" : progress.filesTotal
                ? `${Math.min(100, (progress.filesScanned / progress.filesTotal) * 100)}%`
                : "60%" }}
              transition={{ ease: "easeOut" }}
            />
          </div>
        </motion.div>
      )}

      {/* Stats cards */}
      {scanFailure && (
        <div role="alert" className="px-4 py-3 rounded-xl bg-romio-red/10 border border-romio-red/20 text-sm text-romio-red">
          {scanFailure}
        </div>
      )}

      {stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Files" value={stats.totalFiles}
            color="info"
            icon={<Info className="w-4 h-4" />}
          />
        </div>
      ) : (
        <NoScanState onScan={() => scanMut.mutate(activeProject)} disabled={isScanning} />
      )}

      {/* Quick-action cards, ordered for the person's situation */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dashboardChecks(scenario).map((check) => (
            <CheckCard key={check} check={check} project={activeProject} onOpen={setScreen} />
          ))}
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-romio-gray">
        <span className="font-semibold">Your situation</span>
        <select
          value={scenario ?? ""}
          onChange={(e) => setScenario(e.target.value as Scenario)}
          className="bg-background-surface border border-border rounded-md px-2 py-1 text-romio-cream
                     focus:outline-hidden focus-visible:ring-2 focus-visible:ring-romio-green"
        >
          {!scenario && <option value="" disabled>Not chosen</option>}
          {SCENARIO_ORDER.map((id) => (
            <option key={id} value={id}>{SCENARIOS[id].title}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function CheckCard({ check, project, onOpen }: {
  check: DashboardCheck; project: Project; onOpen: (s: DashboardCheck) => void;
}) {
  if (check === "bios") {
    const badge  = biosBadge(project);
    const status = badge.color === "red" ? "error" : badge.color === "green" ? "ok" : "warning";
    return (
      <ActionCard title="BIOS Validation" description="Check all BIOS files for your target frontend"
        status={status} onClick={() => onOpen("bios")} badge={badge} />
    );
  }
  if (check === "saves") {
    return (
      <ActionCard title="Save Migration" description="Check for save roots at risk after emulator updates"
        status="info" onClick={() => onOpen("saves")} />
    );
  }
  return (
    <ActionCard title="Format Check" description="Validate ROM container formats against active emulators"
      status="info" onClick={() => onOpen("format")} />
  );
}

function StatCard({ label, value, color, icon, onClick }: {
  label: string; value: number; color: string;
  icon: React.ReactNode; onClick?: () => void;
}) {
  const colorMap: Record<string, string> = {
    error:   "border-romio-red/30 bg-romio-red/5 text-romio-red",
    warning: "border-amber-600/30 bg-amber-600/5 text-amber-400",
    advisory:"border-border bg-background-surface/50 text-romio-gray",
    info:    "border-border bg-background-surface/50 text-romio-cream",
    ok:      "border-romio-green/20 bg-romio-green/5 text-romio-green",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-4 rounded-xl border text-left transition-all",
        colorMap[color] ?? colorMap.info,
        onClick && "hover:scale-[1.02] cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        {icon}
        <span className="text-2xl font-bold">{value.toLocaleString()}</span>
      </div>
      <p className="text-xs text-romio-gray">{label}</p>
    </button>
  );
}

function ActionCard({ title, description, status, onClick, badge }: {
  title: string;
  description: string;
  status: string;
  onClick: () => void;
  badge?: { label: string; color: "gray" | "amber" | "red" | "green" };
}) {
  return (
    <button
      onClick={onClick}
      className="px-5 py-4 rounded-xl border border-border bg-background-surface/50
                 text-left hover:border-romio-green/30 hover:bg-romio-green/5
                 transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-romio-cream text-sm group-hover:text-romio-green
                        transition-colors">{title}</p>
          <p className="text-xs text-romio-gray mt-0.5">{description}</p>
          {badge && (
            <span className={cn(
              "inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full",
              badge.color === "red"   && "bg-romio-red/10 text-romio-red",
              badge.color === "amber" && "bg-amber-600/10 text-amber-400",
              badge.color === "green" && "bg-romio-green/10 text-romio-green",
              badge.color === "gray"  && "bg-white/5 text-romio-gray",
            )}>
              {badge.label}
            </span>
          )}
        </div>
        {status === "error" && <XCircle className="w-4 h-4 text-romio-red shrink-0 mt-0.5" />}
        {status === "ok"    && <CheckCircle2 className="w-4 h-4 text-romio-green shrink-0 mt-0.5" />}
      </div>
    </button>
  );
}

function NoScanState({ onScan, disabled }: { onScan: () => void; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-4
                    border border-dashed border-border rounded-xl">
      <img src="/romio/romio_idle.png" alt="" className="w-20 h-20 opacity-50" />
      <div>
        <p className="text-romio-cream font-medium">Library not scanned yet</p>
        <p className="text-romio-gray text-sm">Run a scan to see validation results.</p>
      </div>
      <button
        onClick={onScan}
        disabled={disabled}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors
                   bg-romio-green-fill text-white enabled:hover:bg-romio-green-fill/90
                   disabled:bg-romio-green/20 disabled:text-romio-green disabled:cursor-not-allowed"
      >
        <Play className="w-3.5 h-3.5" /> Scan Now
      </button>
    </div>
  );
}
