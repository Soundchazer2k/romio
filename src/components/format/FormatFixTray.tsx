// SPDX-License-Identifier: GPL-3.0
import { motion } from "framer-motion";
import { Trash2, ArrowRight } from "lucide-react";
import type { FormatFixType, StagedFix } from "@/types";

const FIX_NOUN: Record<FormatFixType, [string, string]> = {
  rename:  ["rename", "renames"],
  convert: ["convert", "converts"],
  redump:  ["re-dump", "re-dumps"],
};

interface Props {
  fixes:        StagedFix[];
  onClear:      () => void;
  onReviewPlan: () => void;
}

export function FormatFixTray({ fixes, onClear, onReviewPlan }: Props) {
  const breakdown = (Object.keys(FIX_NOUN) as FormatFixType[])
    .map((type) => [type, fixes.filter((f) => f.fix.actionType === type).length] as const)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${n} ${FIX_NOUN[type][n === 1 ? 0 : 1]}`)
    .join(", ");

  // Note: parent mounts/unmounts this component — do NOT add a null guard here,
  // as that would prevent AnimatePresence from seeing the exit transition.
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0,  opacity: 1 }}
      exit={{   y: 80, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed bottom-0 left-0 right-0 z-40
                 border-t-2 border-romio-green bg-background-surface
                 px-6 py-3 flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        <div>
          <p className="text-xs font-semibold text-romio-green">Step 1 of 2: stage fixes</p>
          <p className="text-sm text-romio-cream font-medium">
            {fixes.length} {fixes.length === 1 ? "fix" : "fixes"} staged
            {breakdown && <span className="ml-2 font-mono text-xs font-normal text-romio-gray">{breakdown}</span>}
          </p>
        </div>
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
                   bg-romio-green-fill text-white hover:bg-romio-green-fill/90 transition-colors"
      >
        Review plan <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}
