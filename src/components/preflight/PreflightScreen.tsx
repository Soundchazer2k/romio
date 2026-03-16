// SPDX-License-Identifier: GPL-3.0
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, AlertCircle, ExternalLink, ArrowRight } from "lucide-react";
import { useAppStore, usePreflightStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type { DependencyCheck, DependencyState } from "@/types";
import { cn } from "@/lib/utils";

export function PreflightScreen() {
  const { setScreen, setRomioState } = useAppStore();
  const { setReport, setCompleted } = usePreflightStore();

  const { data: report, isLoading } = useQuery({
    queryKey: ["preflight"],
    queryFn:  () => ipc.checkHostEnv(),
  });

  useEffect(() => {
    if (report) {
      setReport(report);
      // Update Romio state based on results
      if (report.blockingCount > 0) setRomioState("concerned");
      else if (!report.allPass)      setRomioState("announcement");
      else                           setRomioState("success");
    }
  }, [report, setReport, setRomioState]);

  function proceed() {
    setCompleted(true);
    setScreen("dashboard");
    setRomioState("pondering");
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-romio-cream">Pre-flight Check</h1>
        <p className="text-romio-gray text-sm mt-1">
          Verifying your machine has the runtime dependencies emulators need.
          This runs before the library scan.
        </p>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : report ? (
        <>
          {/* Summary banner */}
          <SummaryBanner
            allPass={report.allPass}
            blockingCount={report.blockingCount}
            total={report.checks.length}
          />

          {/* Dependency list */}
          <div className="space-y-2">
            <AnimatePresence>
              {report.checks.map((check, i) => (
                <motion.div
                  key={check.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <DependencyRow check={check} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Continue button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={proceed}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm",
                "transition-colors",
                report.blockingCount > 0
                  ? "bg-amber-600/20 text-amber-400 border border-amber-600/30 hover:bg-amber-600/30"
                  : "bg-romio-green text-white hover:bg-romio-green/90"
              )}
            >
              {report.blockingCount > 0
                ? "Continue anyway (some emulators may not work)"
                : "Continue to scan"
              }
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-3 py-8 text-romio-gray">
      <div className="w-4 h-4 rounded-full border-2 border-romio-green border-t-transparent animate-spin" />
      <span className="text-sm">Checking host environment…</span>
    </div>
  );
}

function SummaryBanner({ allPass, blockingCount, total }: {
  allPass: boolean; blockingCount: number; total: number;
}) {
  if (allPass) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl
                      bg-romio-green/10 border border-romio-green/20">
        <CheckCircle className="w-5 h-5 text-romio-green flex-shrink-0" />
        <p className="text-sm text-romio-cream">
          All {total} checks passed. Your machine is ready.
        </p>
      </div>
    );
  }
  if (blockingCount > 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl
                      bg-romio-red/10 border border-romio-red/20">
        <XCircle className="w-5 h-5 text-romio-red flex-shrink-0" />
        <p className="text-sm text-romio-cream">
          <strong>{blockingCount}</strong> missing {blockingCount === 1 ? "dependency" : "dependencies"} will
          prevent some emulators from launching. Fix before scanning.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl
                    bg-amber-600/10 border border-amber-600/20">
      <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
      <p className="text-sm text-romio-cream">
        Some optional dependencies are missing. Certain features may be limited.
      </p>
    </div>
  );
}

function DependencyRow({ check }: { check: DependencyCheck }) {
  const icon = stateIcon(check.state);
  return (
    <div className={cn(
      "px-4 py-3 rounded-lg border transition-colors",
      check.state === "present"              ? "border-border bg-romio-surface/50" :
      check.state === "missing"              ? "border-romio-red/20 bg-romio-red/5" :
      check.state === "present_wrong_version"? "border-amber-600/20 bg-amber-600/5" :
      "border-border bg-romio-surface/30"
    )}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-romio-cream">{check.name}</p>
            {check.detectedVersion && (
              <span className="text-xs text-romio-gray font-mono">{check.detectedVersion}</span>
            )}
          </div>
          <p className="text-xs text-romio-gray mt-0.5">{check.description}</p>

          {check.affectedEmulators.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {check.affectedEmulators.map((e) => (
                <span key={e} className="px-1.5 py-0.5 text-xs rounded
                                          bg-white/5 text-romio-gray border border-border">
                  {e}
                </span>
              ))}
            </div>
          )}

          {check.remediation && check.state !== "present" && (
            <div className="mt-2 flex items-center gap-2">
              <p className="text-xs text-amber-400">{check.remediation.description}</p>
              {check.remediation.url && (
                <a href={check.remediation.url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
                  Download <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function stateIcon(state: DependencyState) {
  switch (state) {
    case "present":               return <CheckCircle className="w-4 h-4 text-romio-green" />;
    case "missing":               return <XCircle className="w-4 h-4 text-romio-red" />;
    case "present_wrong_version": return <AlertCircle className="w-4 h-4 text-amber-400" />;
    default:                      return <AlertCircle className="w-4 h-4 text-romio-gray" />;
  }
}
