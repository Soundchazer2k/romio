// SPDX-License-Identifier: GPL-3.0
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FormatSystemGroup, FormatRule, StagedFix } from "@/types";
import { cn } from "@/lib/utils";
import { FormatFileRow } from "./FormatFileRow";

interface Props {
  group:       FormatSystemGroup;
  rules:       FormatRule[];
  stagedFixes: StagedFix[];
  expanded:    boolean;
  onToggle:    () => void;
  index:       number;
  onStageFix:  (fix: StagedFix) => void;
}

export function FormatSystemRow({
  group, rules, stagedFixes, expanded, onToggle, index, onStageFix
}: Props) {
  const issueCount = group.results.filter(
    (r) => r.state === "FormatIncompatible" || r.state === "FormatDeprecated"
  ).length;
  const hasRed   = group.results.some((r) => r.state === "FormatIncompatible");
  const hasAmber = group.results.some((r) => r.state === "FormatDeprecated");
  const allOk    = issueCount === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(
        "rounded-xl border transition-colors overflow-hidden",
        hasRed   ? "border-romio-red/30 bg-romio-red/5" :
        hasAmber ? "border-amber-400/20 bg-amber-400/5" :
        allOk    ? "border-romio-green/20" :
                   "border-border bg-romio-surface/40"
      )}
    >
      {/* Header */}
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
          <div>
            <span className="font-medium text-sm text-romio-cream capitalize">
              {group.system}
            </span>
            <span className="ml-2 text-xs text-romio-gray">
              {group.results.length} {group.results.length === 1 ? "file" : "files"}
            </span>
          </div>
        </div>

        <SystemBadge issueCount={issueCount} hasRed={hasRed} hasAmber={hasAmber} />
      </button>

      {/* Expanded rows */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-3 space-y-2">
              {group.results.map((result) => (
                <FormatFileRow
                  key={result.path}
                  result={result}
                  rules={rules}
                  stagedFixes={stagedFixes}
                  onStageFix={onStageFix}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SystemBadge({ issueCount, hasRed, hasAmber: _hasAmber }: {
  issueCount: number; hasRed: boolean; hasAmber: boolean;
}) {
  if (issueCount === 0) {
    return <span className="text-xs font-medium text-romio-green">All OK</span>;
  }
  if (hasRed) {
    return (
      <span className="text-xs font-medium text-romio-red">
        {issueCount} {issueCount === 1 ? "issue" : "issues"}
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-amber-400">
      {issueCount} {issueCount === 1 ? "issue" : "issues"}
    </span>
  );
}
