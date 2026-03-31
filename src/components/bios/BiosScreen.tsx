// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, ChevronDown, ChevronRight, ExternalLink,
  Copy, FolderOpen, RefreshCw, Pencil,
} from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type { BiosSystemResult, BiosEntryResult } from "@/types";
import { cn, biosStateColor, biosStateBg, biosStateLabel, truncatePath } from "@/lib/utils";

export function BiosScreen() {
  const queryClient = useQueryClient();
  const { activeProject, setActiveProject } = useAppStore();
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);

  const projectId = activeProject?.id ?? "";

  // Load persisted BIOS status — initialData avoids flash on first render
  const { data: status } = useQuery({
    queryKey:    ["bios_status", projectId],
    queryFn:     () => ipc.getBiosStatus(projectId),
    enabled:     !!activeProject?.biosRoot,
    initialData: activeProject ? {
      configured:      !!activeProject.biosRoot,
      validated:       !!activeProject.biosResults,
      results:         activeProject.biosResults ?? [],
      lastValidatedAt: activeProject.biosLastValidatedAt,
    } : undefined,
  });

  const revalidateMut = useMutation({
    mutationFn: () => ipc.revalidateBios(projectId),
    onSuccess: async () => {
      const updated = await ipc.getProject(projectId);
      setActiveProject(updated);
      queryClient.invalidateQueries({ queryKey: ["bios_status", projectId] });
    },
  });

  async function savePath() {
    const trimmed = pathInput.trim();
    await ipc.setBiosRoot(projectId, trimmed || null);
    const updated = await ipc.getProject(projectId);
    setActiveProject(updated);
    setEditingPath(false);
    setPathInput("");
  }

  if (!activeProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-romio-gray">No project open.</p>
      </div>
    );
  }

  const biosRoot     = activeProject.biosRoot;
  const configured   = !!biosRoot;
  const validated    = !!activeProject.biosResults;
  const results      = status?.results ?? [];

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
            Hash-first identification. Frontend-aware path rules.
          </p>
        </div>
      </div>

      {/* Path configuration row */}
      <div className="space-y-2">
        {!configured || editingPath ? (
          /* Not configured, or user clicked Edit */
          <div className="space-y-2">
            <label className="text-xs font-medium text-romio-gray/70 uppercase tracking-widest">
              BIOS directory
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1 flex items-center">
                <div className="absolute left-0 flex items-center h-full pl-3 pr-2.5
                                border-r border-white/10 pointer-events-none">
                  <FolderOpen className="w-4 h-4 text-romio-gray/50" />
                </div>
                <input
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && savePath()}
                  placeholder="/path/to/bios"
                  autoFocus
                  className="w-full pl-11 pr-3 py-2 rounded-lg bg-romio-surface border border-white/10
                             text-sm font-mono text-romio-cream placeholder:text-romio-gray/40
                             focus:outline-none focus:border-romio-green/40"
                />
              </div>
              <button
                onClick={savePath}
                disabled={!pathInput.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-romio-green text-white
                           hover:bg-romio-green/90 disabled:opacity-40 disabled:cursor-not-allowed
                           transition-colors"
              >
                Save
              </button>
              {editingPath && (
                <button
                  onClick={() => { setEditingPath(false); setPathInput(""); }}
                  className="px-3 py-2 rounded-lg text-sm text-romio-gray hover:text-romio-cream
                             border border-border transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
            {!configured && (
              <p className="text-xs text-romio-gray/60">
                Set your BIOS directory to enable validation and automatic sweep on scan.
              </p>
            )}
          </div>
        ) : (
          /* Configured path display */
          <div className="flex items-center justify-between p-3 rounded-lg
                          bg-romio-surface/50 border border-border">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="w-4 h-4 text-romio-gray/50 flex-shrink-0" />
              <span className="font-mono text-sm text-romio-cream truncate">{biosRoot}</span>
            </div>
            <button
              onClick={() => { setEditingPath(true); setPathInput(biosRoot ?? ""); }}
              className="flex items-center gap-1.5 ml-3 text-xs text-romio-gray
                         hover:text-romio-cream transition-colors flex-shrink-0"
            >
              <Pencil className="w-3 h-3" /> Edit path
            </button>
          </div>
        )}
      </div>

      {/* Action row — shown when configured */}
      {configured && !editingPath && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-romio-gray">
            {status?.lastValidatedAt
              ? `Last validated: ${new Date(status.lastValidatedAt).toLocaleString()}`
              : "Not yet validated"}
          </div>
          <button
            onClick={() => revalidateMut.mutate()}
            disabled={revalidateMut.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                       bg-romio-green/10 text-romio-green border border-romio-green/20
                       hover:bg-romio-green/20 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", revalidateMut.isPending && "animate-spin")} />
            {revalidateMut.isPending ? "Validating…" : validated ? "Revalidate BIOS" : "Validate Now"}
          </button>
        </div>
      )}

      {/* Not-yet-validated state */}
      {configured && !validated && !revalidateMut.isPending && (
        <div className="flex flex-col items-center justify-center py-10 text-center space-y-3
                        border border-dashed border-border rounded-xl">
          <Shield className="w-8 h-8 text-romio-gray/30" />
          <div>
            <p className="text-romio-cream font-medium text-sm">No validation results yet</p>
            <p className="text-romio-gray text-xs">Run a scan or click "Validate Now" to check your BIOS files.</p>
          </div>
        </div>
      )}

      {/* System results list */}
      {configured && results.length > 0 && (
        <div className="space-y-2">
          {results.map((result, i) => (
            <SystemResultRow
              key={result.system}
              result={result}
              index={i}
              expanded={expandedSystem === result.system}
              onToggle={() => setExpandedSystem(
                expandedSystem === result.system ? null : result.system
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SystemResultRow({ result, expanded, onToggle, index }: {
  result:   BiosSystemResult;
  index:    number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const allValid   = result.entries.length > 0 &&
                     result.entries.every(e => e.state === "PRESENT_VALID");
  const borderColor = result.errored   ? "border-amber-600/30 bg-amber-600/5"
                    : result.blocking  ? "border-romio-red/30 bg-romio-red/5"
                    : allValid         ? "border-romio-green/20"
                    :                   "border-border bg-romio-surface/40";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn("rounded-xl border transition-colors overflow-hidden", borderColor)}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3
                   hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown  className="w-4 h-4 text-romio-gray flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-romio-gray flex-shrink-0" />
          }
          <span className="font-medium text-sm text-romio-cream font-mono">{result.system}</span>
        </div>

        <div className="flex items-center gap-2">
          {result.errored && (
            <span className="text-xs font-medium text-amber-400">Validation error</span>
          )}
          {!result.errored && result.blocking && (
            <span className="text-xs font-medium text-romio-red">Blocking</span>
          )}
          {!result.errored && !result.blocking && allValid && (
            <span className="text-xs font-medium text-romio-green">All valid</span>
          )}
          {!result.errored && !result.blocking && !allValid && result.entries.length > 0 && (
            <span className="text-xs font-medium text-amber-400">
              {result.entries.filter(e =>
                e.state === "MISSING_REQUIRED" || e.state === "MISSING_OPTIONAL"
              ).length} missing
            </span>
          )}
          {result.entries.length === 0 && !result.errored && (
            <span className="text-xs text-romio-gray/50">Not in database</span>
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && result.entries.length > 0 && (
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
      entry.state === "PRESENT_VALID"    ? "border-romio-green/10"  :
      entry.state === "MISSING_REQUIRED" ? "border-romio-red/20"    :
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
               className="text-blue-400 hover:text-blue-300 transition-colors"
               title="Dumping guide">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
