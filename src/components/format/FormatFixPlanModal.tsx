// SPDX-License-Identifier: GPL-3.0
import { AlertTriangle, FileEdit, X } from "lucide-react";
import { Modal, Dialog } from "@/components/shared/Modal";
import type { StagedFix } from "@/types";
import { cn, truncatePath } from "@/lib/utils";

interface Props {
  fixes:   StagedFix[];
  onClose: () => void;
}

export function FormatFixPlanModal({ fixes, onClose }: Props) {
  const unsafeFixes = fixes.filter((f) => !f.fix.safe);
  const hasUnsafe   = unsafeFixes.length > 0;

  return (
    <Modal
      onClose={onClose}
      className="w-full max-w-lg bg-background-surface border border-border rounded-2xl
                 shadow-romio p-6 space-y-5 mx-4 max-h-[80vh] flex flex-col"
    >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileEdit className="w-5 h-5 text-romio-green shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-romio-green">Step 2 of 2: review plan</p>
              <Dialog.Title className="font-bold text-romio-cream">Fix Plan</Dialog.Title>
              <Dialog.Description className="text-xs text-romio-gray mt-0.5">
                Review what each fix would do. Applying fixes isn't built yet, so nothing will change.
              </Dialog.Description>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-romio-gray hover:text-romio-cream">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fixes list */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {fixes.map((staged) => (
            <div key={staged.result.path}
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
                  "px-1.5 py-0.5 rounded text-[10px] border shrink-0",
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
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {unsafeFixes.length} {unsafeFixes.length === 1 ? "fix requires" : "fixes require"} re-dumping
              or conversion, which Romio can't do for you.
            </span>
          </div>
        )}

        {/* Actions */}
        <button onClick={onClose}
          className="w-full px-4 py-2 rounded-lg text-sm text-romio-gray
                     border border-border hover:bg-white/5 transition-colors">
          Close
        </button>
    </Modal>
  );
}
