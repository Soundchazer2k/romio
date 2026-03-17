// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, FileEdit, X } from "lucide-react";
import type { StagedFix } from "@/types";
import { cn, truncatePath } from "@/lib/utils";

interface Props {
  fixes:   StagedFix[];
  onClose: () => void;
}

export function FormatFixPlanModal({ fixes, onClose }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [executed,  setExecuted]  = useState(false);

  const unsafeFixes = fixes.filter((f) => !f.fix.safe);
  const hasUnsafe   = unsafeFixes.length > 0;

  function handleExecute() {
    // Stub — execution not yet implemented
    setExecuted(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-romio-surface border border-border rounded-2xl
                   shadow-romio p-6 space-y-5 mx-4 max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileEdit className="w-5 h-5 text-romio-green flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-bold text-romio-cream">Fix Plan</h2>
              <p className="text-xs text-romio-gray mt-0.5">
                Review all changes before applying. Nothing will be written without your confirmation.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-romio-gray hover:text-romio-cream">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fixes list */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {fixes.map((staged, i) => (
            <div key={i}
              className={cn(
                "px-3 py-2.5 rounded-lg border text-xs",
                staged.fix.safe
                  ? "border-romio-green/20 bg-romio-green/5"
                  : "border-amber-400/20 bg-amber-400/5"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-romio-cream truncate">
                    {truncatePath(staged.result.path)}
                  </p>
                  <p className="text-romio-gray mt-0.5">{staged.fix.description}</p>
                </div>
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] border flex-shrink-0",
                  staged.fix.safe
                    ? "text-romio-green border-romio-green/20"
                    : "text-amber-400 border-amber-400/20"
                )}>
                  {staged.fix.actionType}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Unsafe warning */}
        {hasUnsafe && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg
                          bg-amber-600/10 border border-amber-600/20 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              {unsafeFixes.length} {unsafeFixes.length === 1 ? "fix requires" : "fixes require"} re-dumping
              or conversion — these cannot be automatically applied.
            </span>
          </div>
        )}

        {/* Not-yet-implemented notice */}
        {executed && (
          <div className="px-3 py-2.5 rounded-lg bg-black/20 border border-border text-xs text-romio-gray">
            Fix execution is not yet implemented. Your staged plan has been logged.
          </div>
        )}

        {/* Confirmation checkbox */}
        {!executed && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 accent-romio-green"
            />
            <span className="text-sm text-romio-cream">
              I have reviewed all changes. I understand rename operations will modify filenames
              in my library.
            </span>
          </label>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-romio-gray
                       border border-border hover:bg-white/5 transition-colors">
            {executed ? "Close" : "Cancel"}
          </button>
          {!executed && (
            <button
              onClick={handleExecute}
              disabled={!confirmed}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold
                         bg-romio-green text-romio-dark hover:bg-romio-green/90
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Apply Fixes
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
