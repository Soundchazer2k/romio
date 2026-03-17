// SPDX-License-Identifier: GPL-3.0
import { motion } from "framer-motion";
import { Trash2, ArrowRight } from "lucide-react";
import type { StagedFix } from "@/types";

interface Props {
  fixes:        StagedFix[];
  onClear:      () => void;
  onReviewPlan: () => void;
}

export function FormatFixTray({ fixes, onClear, onReviewPlan }: Props) {
  // Note: parent mounts/unmounts this component — do NOT add a null guard here,
  // as that would prevent AnimatePresence from seeing the exit transition.
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0,  opacity: 1 }}
      exit={{   y: 80, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed bottom-0 left-0 right-0 z-40
                 border-t border-border bg-romio-surface/95 backdrop-blur-sm
                 px-6 py-3 flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm text-romio-cream font-medium">
          {fixes.length} {fixes.length === 1 ? "fix" : "fixes"} staged
        </span>
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-romio-gray hover:text-romio-cream
                     transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </button>
      </div>

      <button
        onClick={onReviewPlan}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                   bg-romio-green text-romio-dark hover:bg-romio-green/90 transition-colors"
      >
        Review plan <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}
