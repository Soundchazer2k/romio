// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Save, AlertTriangle, ArrowRight, ShieldCheck, Link2,
  Archive, CheckCircle2, ChevronDown, ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type { SaveRoot, MigrationPlan, SaveCheckpoint, OperationLogEntry } from "@/types";
import { cn, formatBytes, migrationStateLabel } from "@/lib/utils";

// ── Screen ───────────────────────────────────────────────────────────────────

export function SavesScreen() {
  const { activeProject, setRomioState } = useAppStore();
  const queryClient = useQueryClient();
  const [frontendRoot, setFrontendRoot] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<MigrationPlan | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<SaveRoot | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);

  const projectId = activeProject?.id ?? "";

  // ── Project guard ─────────────────────────────────────────────────────────
  if (!activeProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-romio-gray">Open a project to use Save Migration.</p>
      </div>
    );
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: roots = [], isLoading } = useQuery({
    queryKey: ["save-roots", frontendRoot],
    queryFn:  () => ipc.discoverSaveRoots(frontendRoot),
    enabled:  frontendRoot.length > 0,
  });

  const { data: log = [] } = useQuery({
    queryKey: ["operation-log", projectId],
    queryFn:  () => ipc.getOperationLog(projectId),
    enabled:  !!activeProject,
  });

  // ── Derived state ─────────────────────────────────────────────────────────
  const atRisk = roots.filter((r) => r.migrationState === "migration_needed");
  if (atRisk.length > 0)     setRomioState("difficult_save");
  else if (roots.length > 0) setRomioState("success");

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-xl bg-amber-600/10 border border-amber-600/20">
          <Save className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">Save Migration</h1>
          <p className="text-romio-gray text-sm mt-0.5">
            Protects save data across emulator and frontend version updates.
            No operation executes without your confirmation and a backup step.
          </p>
        </div>
      </div>

      {/* Risk banner */}
      {atRisk.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 px-4 py-3 rounded-xl
                     bg-romio-red/10 border border-romio-red/20"
        >
          <AlertTriangle className="w-5 h-5 text-romio-red flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-romio-cream">
              {atRisk.length} save {atRisk.length === 1 ? "root" : "roots"} at risk
            </p>
            <p className="text-xs text-romio-gray mt-0.5">
              These emulators have moved their save directories. Migrate before updating.
            </p>
          </div>
        </motion.div>
      )}

      {/* Frontend root input */}
      <div className="space-y-1.5">
        <label className="text-xs text-romio-gray uppercase tracking-wider">
          Frontend installation root
        </label>
        <input
          value={frontendRoot}
          onChange={(e) => setFrontendRoot(e.target.value)}
          placeholder="C:\RetroBat  or  /home/user/retrobat"
          className="w-full px-3 py-2.5 rounded-lg bg-black/30 border border-border
                     font-mono text-sm text-romio-cream placeholder:text-romio-gray/40
                     focus:outline-none focus:border-romio-green/40"
        />
      </div>

      {/* Save roots list */}
      {isLoading && (
        <div className="flex items-center gap-2 text-romio-gray text-sm">
          <div className="w-3 h-3 border-2 border-romio-green border-t-transparent rounded-full animate-spin" />
          Discovering save roots…
        </div>
      )}

      {roots.length > 0 && (
        <div className="space-y-3">
          {roots.map((root, i) => (
            <SaveRootCard
              key={root.path}
              root={root}
              index={i}
              onMigrate={async () => {
                if (!root.expectedDestination) return; // hard stop
                const plan = await ipc.createMigrationPlan(
                  activeProject.id,
                  root.path,
                  root.expectedDestination,
                  root.emulator,
                );
                setSelectedRoot(root);
                setSelectedPlan(plan);
              }}
            />
          ))}
        </div>
      )}

      {frontendRoot && !isLoading && roots.length === 0 && (
        <div className="text-center py-12 text-romio-gray space-y-2">
          <ShieldCheck className="w-10 h-10 mx-auto opacity-30" />
          <p>No save roots found at risk in this directory.</p>
        </div>
      )}

      {/* Migration plan modal */}
      {selectedPlan && (
        <MigrationPlanModal
          plan={selectedPlan}
          projectId={activeProject.id}
          sourcePath={selectedRoot?.path ?? selectedPlan.sourcePath}
          emulator={selectedPlan.emulator}
          onClose={() => { setSelectedPlan(null); setSelectedRoot(null); }}
          onCheckpointSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["checkpoints", projectId] });
            queryClient.invalidateQueries({ queryKey: ["operation-log", projectId] });
          }}
        />
      )}

      {/* Migration history */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setLogExpanded((x) => !x)}
          className="w-full flex items-center justify-between px-4 py-3
                     hover:bg-white/5 transition-colors text-left"
        >
          <span className="text-sm font-medium text-romio-cream">Migration History</span>
          <div className="flex items-center gap-2">
            {log.length > 0 && (
              <span className="text-xs text-romio-gray">{log.length} entries</span>
            )}
            {logExpanded
              ? <ChevronDown  className="w-4 h-4 text-romio-gray" />
              : <ChevronRight className="w-4 h-4 text-romio-gray" />
            }
          </div>
        </button>
        {logExpanded && (
          <div className="border-t border-border px-4 py-3 space-y-2">
            {log.length === 0
              ? <p className="text-romio-gray text-sm">No migration operations recorded yet.</p>
              : log.map((entry) => <OperationLogRow key={entry.id} entry={entry} />)
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── SaveRootCard ──────────────────────────────────────────────────────────────

function SaveRootCard({ root, index, onMigrate }: {
  root: SaveRoot; index: number; onMigrate: () => void;
}) {
  const stateColors: Record<string, string> = {
    migration_needed:  "border-romio-red/30 bg-romio-red/5",
    conflict_detected: "border-amber-600/30 bg-amber-600/5",
    already_migrated:  "border-romio-green/20 bg-romio-green/5",
    not_applicable:    "border-border",
  };

  const canPlan = root.migrationState === "migration_needed" && !!root.expectedDestination;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn("rounded-xl border px-4 py-4 space-y-3", stateColors[root.migrationState])}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-romio-cream">{root.emulator}</span>
            <MigrationStateBadge state={root.migrationState} />
            {root.isSymlink && (
              <span className="flex items-center gap-1 text-xs text-amber-400 border
                               border-amber-600/30 px-1.5 py-0.5 rounded">
                <Link2 className="w-3 h-3" /> Symlink
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-romio-gray mt-1 truncate">{root.path}</p>
          {root.realPath && root.realPath !== root.path && (
            <p className="font-mono text-xs text-romio-gray/60 truncate">→ {root.realPath}</p>
          )}
          {root.expectedDestination && (
            <p className="font-mono text-xs text-romio-gray/60 mt-0.5 truncate">
              → {root.expectedDestination}
            </p>
          )}
        </div>
        <div className="text-right text-xs text-romio-gray flex-shrink-0">
          <p>{root.fileCount.toLocaleString()} files</p>
          <p>{formatBytes(root.sizeBytes)}</p>
        </div>
      </div>

      {root.migrationState === "migration_needed" && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-romio-red">
            Saves exist at old path. Emulator now expects a different location.
          </p>
          <button
            onClick={onMigrate}
            disabled={!canPlan}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold",
              "rounded-lg border flex-shrink-0 ml-3 transition-colors",
              canPlan
                ? "bg-amber-600/20 text-amber-400 border-amber-600/30 hover:bg-amber-600/30"
                : "opacity-40 cursor-not-allowed bg-white/5 text-romio-gray border-border"
            )}
          >
            Plan Migration <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {root.migrationState === "conflict_detected" && (
        <p className="text-xs text-amber-400">
          Saves found at both old and new paths. Manual review required before migrating.
        </p>
      )}

      {root.isSymlink && (
        <p className="text-xs text-amber-400/80">
          ⚠ This path is a symlink. A move operation may redirect the symlink target
          rather than move the actual files. Review carefully.
        </p>
      )}
    </motion.div>
  );
}

// ── MigrationStateBadge ───────────────────────────────────────────────────────

function MigrationStateBadge({ state }: { state: SaveRoot["migrationState"] }) {
  const styles: Record<string, string> = {
    migration_needed:  "bg-romio-red/15 text-romio-red border-romio-red/20",
    conflict_detected: "bg-amber-600/15 text-amber-400 border-amber-600/20",
    already_migrated:  "bg-romio-green/15 text-romio-green border-romio-green/20",
    not_applicable:    "bg-white/5 text-romio-gray border-border",
  };
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border", styles[state])}>
      {migrationStateLabel(state)}
    </span>
  );
}

// ── MigrationPlanModal ────────────────────────────────────────────────────────

function MigrationPlanModal({
  plan, projectId, sourcePath, emulator, onClose, onCheckpointSuccess,
}: {
  plan:                 MigrationPlan;
  projectId:            string;
  sourcePath:           string;
  emulator:             string;
  onClose:              () => void;
  onCheckpointSuccess:  () => void;
}) {
  const [checkpoint, setCheckpoint]   = useState<SaveCheckpoint | null>(null);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);

  const checkpointMut = useMutation({
    mutationFn: () => ipc.createSaveCheckpoint(projectId, sourcePath, emulator),
    onSuccess: (cp) => {
      setCheckpoint(cp);
      setCheckpointError(null);
      onCheckpointSuccess();
    },
    onError: (e: unknown) => {
      setCheckpointError(e instanceof Error ? e.message : String(e));
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-romio-surface border border-border rounded-2xl
                   shadow-romio p-6 space-y-5 mx-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="font-bold text-romio-cream">Migration Plan — {plan.emulator}</h2>
            <p className="text-xs text-romio-gray mt-0.5">
              Review all steps. Create a checkpoint before proceeding.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="px-3 py-2 rounded-lg bg-black/20 border border-border">
            <p className="text-xs text-romio-gray">Files</p>
            <p className="font-semibold text-romio-cream">{plan.fileCount.toLocaleString()}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-black/20 border border-border">
            <p className="text-xs text-romio-gray">Size</p>
            <p className="font-semibold text-romio-cream">{formatBytes(plan.sizeBytes)}</p>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {plan.steps.map((step) => (
            <div key={step.order} className="flex items-start gap-3 px-3 py-2.5 rounded-lg
                                              bg-black/20 border border-border text-sm">
              <span className="w-5 h-5 rounded-full bg-romio-green/20 text-romio-green
                               flex items-center justify-center text-xs font-bold flex-shrink-0">
                {step.order}
              </span>
              <div>
                <p className="text-romio-cream text-xs">{step.description}</p>
                {!step.reversible && (
                  <p className="text-xs text-amber-400/70 mt-0.5">Not reversible</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Symlink warning */}
        {plan.symlinkWarning && (
          <div className="px-3 py-2.5 rounded-lg bg-amber-600/10 border border-amber-600/20
                          text-xs text-amber-400">
            ⚠ {plan.symlinkWarning}
          </div>
        )}

        {/* Checkpoint step */}
        <div className="rounded-lg border border-border bg-black/20 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-romio-gray" />
              <span className="text-sm font-medium text-romio-cream">Create Checkpoint</span>
            </div>
            {checkpoint && (
              <CheckCircle2 className="w-4 h-4 text-romio-green" />
            )}
          </div>

          {checkpoint ? (
            <div className="text-xs text-romio-gray space-y-0.5">
              <p className="font-mono truncate">{checkpoint.archivePath}</p>
              <p>{checkpoint.fileCount} files · {formatBytes(checkpoint.sizeBytes)}</p>
            </div>
          ) : checkpointError ? (
            <div className="text-xs text-romio-red">
              <p>Checkpoint failed: {checkpointError}</p>
              <button
                onClick={() => checkpointMut.mutate()}
                className="mt-1 text-romio-gray hover:text-romio-cream underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <button
              onClick={() => checkpointMut.mutate()}
              disabled={checkpointMut.isPending}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg",
                "transition-colors border",
                checkpointMut.isPending
                  ? "opacity-60 cursor-not-allowed bg-white/5 text-romio-gray border-border"
                  : "bg-romio-green/10 text-romio-green border-romio-green/20 hover:bg-romio-green/20"
              )}
            >
              {checkpointMut.isPending ? (
                <>
                  <div className="w-3 h-3 border-2 border-romio-green/40 border-t-romio-green rounded-full animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Checkpoint"
              )}
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-romio-gray
                       border border-border hover:bg-white/5 transition-colors">
            Close
          </button>
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-2
                          rounded-lg border border-border bg-black/10 text-center opacity-50
                          cursor-not-allowed select-none">
            <span className="text-xs font-semibold text-romio-gray">Execute Migration</span>
            <span className="text-xs text-romio-gray/50 mt-0.5">Execution not yet available</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── OperationLogRow ───────────────────────────────────────────────────────────

function OperationLogRow({ entry }: { entry: OperationLogEntry }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-black/10 border border-border text-xs">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-romio-cream">{entry.operation}</span>
          {entry.rolledBack && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-amber-600/10 text-amber-400 border border-amber-600/20">
              rolled back
            </span>
          )}
        </div>
        <p className="text-romio-gray mt-0.5">{entry.description}</p>
        <p className="text-romio-gray/50 mt-0.5">{new Date(entry.createdAt).toLocaleString()}</p>
      </div>
    </div>
  );
}
