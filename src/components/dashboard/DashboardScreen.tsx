// SPDX-License-Identifier: GPL-3.0
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Play, AlertTriangle, XCircle, Info, CheckCircle2 } from "lucide-react";
import { useAppStore, useScanStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
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
  const missingCount  = results
    .flatMap(r => r.entries)
    .filter(e => e.state === "MISSING_REQUIRED" || e.state === "MISSING_OPTIONAL")
    .length;

  if (blockingCount > 0) return { label: `${blockingCount} blocking`,          color: "red"   };
  if (erroredCount  > 0) return { label: `${erroredCount} systems incomplete`, color: "amber" };
  if (missingCount  > 0) return { label: `${missingCount} missing`,            color: "amber" };
  return { label: "All valid", color: "green" };
}

export function DashboardScreen() {
  const { activeProject, setActiveProject, setScreen, setRomioState } = useAppStore();
  const { isScanning, setScanning, progress } = useScanStore();

  const scanMut = useMutation({
    mutationFn: async () => {
      if (!activeProject) return;
      setScanning(true);
      setRomioState("processing");
      await ipc.scanLibrary(activeProject.id, activeProject.libraryRoots);
    },
    onSuccess: async () => {
      setScanning(false);
      setRomioState("pondering");
      // Re-fetch project so scanStats and lastScannedAt reflect persisted data.
      if (activeProject) {
        const updated = await ipc.getProject(activeProject.id);
        setActiveProject(updated);
      }
    },
    onError: () => {
      setScanning(false);
      setRomioState("concerned");
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
          onClick={() => scanMut.mutate()}
          disabled={isScanning}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm",
            "transition-all shadow-romio-sm",
            isScanning
              ? "bg-romio-green/20 text-romio-green/60 cursor-not-allowed"
              : "bg-romio-green text-white hover:bg-romio-green/90"
          )}
        >
          {isScanning ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-romio-green/40
                               border-t-romio-green animate-spin" />
              Scanning…
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
      {isScanning && progress && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex justify-between text-xs text-romio-gray">
            <span className="font-mono truncate max-w-xs">{progress.currentPath || "Scanning…"}</span>
            <span>{progress.filesScanned.toLocaleString()} files</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className="h-full bg-romio-green rounded-full"
              animate={{ width: progress.filesTotal
                ? `${Math.min(100, (progress.filesScanned / progress.filesTotal) * 100)}%`
                : "60%" }}
              transition={{ ease: "easeOut" }}
            />
          </div>
        </motion.div>
      )}

      {/* Stats cards */}
      {stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Blocking" value={stats.blockingIssues}
            color={stats.blockingIssues > 0 ? "error" : "ok"}
            icon={<XCircle className="w-4 h-4" />}
            onClick={() => setScreen("bios")}
          />
          <StatCard
            label="Errors" value={stats.errors}
            color={stats.errors > 0 ? "warning" : "ok"}
            icon={<AlertTriangle className="w-4 h-4" />}
            onClick={() => setScreen("bios")}
          />
          <StatCard
            label="Warnings" value={stats.warnings}
            color="advisory"
            icon={<AlertTriangle className="w-4 h-4" />}
          />
          <StatCard
            label="Total Files" value={stats.totalFiles}
            color="info"
            icon={<Info className="w-4 h-4" />}
          />
        </div>
      ) : (
        <NoScanState onScan={() => scanMut.mutate()} />
      )}

      {/* Quick-action cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(() => {
            const bBadge = biosBadge(activeProject);
            const biosStatus = bBadge.color === "red"   ? "error"
                             : bBadge.color === "green" ? "ok"
                             : "warning";
            return (
              <ActionCard
                title="BIOS Validation"
                description="Check all BIOS files for your target frontend"
                status={biosStatus}
                onClick={() => setScreen("bios")}
                badge={bBadge}
              />
            );
          })()}
          <ActionCard
            title="Save Migration"
            description="Check for save roots at risk after emulator updates"
            status="info"
            onClick={() => setScreen("saves")}
          />
          <ActionCard
            title="Format Check"
            description="Validate ROM container formats against active emulators"
            status="info"
            onClick={() => setScreen("format")}
          />
          <ActionCard
            title="Export"
            description="Generate frontend-compatible artifacts from your library"
            status={stats.blockingIssues > 0 ? "warning" : "ok"}
            onClick={() => setScreen("export")}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon, onClick }: {
  label: string; value: number; color: string;
  icon: React.ReactNode; onClick?: () => void;
}) {
  const colorMap: Record<string, string> = {
    error:   "border-romio-red/30 bg-romio-red/5 text-romio-red",
    warning: "border-amber-600/30 bg-amber-600/5 text-amber-400",
    advisory:"border-border bg-romio-surface/50 text-romio-gray",
    info:    "border-border bg-romio-surface/50 text-romio-cream",
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
      <p className="text-xs opacity-70">{label}</p>
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
      className="px-5 py-4 rounded-xl border border-border bg-romio-surface/50
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
        {status === "error" && <XCircle className="w-4 h-4 text-romio-red flex-shrink-0 mt-0.5" />}
        {status === "ok"    && <CheckCircle2 className="w-4 h-4 text-romio-green flex-shrink-0 mt-0.5" />}
      </div>
    </button>
  );
}

function NoScanState({ onScan }: { onScan: () => void }) {
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
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                   bg-romio-green text-white hover:bg-romio-green/90 transition-colors"
      >
        <Play className="w-3.5 h-3.5" /> Scan Now
      </button>
    </div>
  );
}
