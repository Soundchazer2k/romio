// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import type { FormatCheckResult, FormatRule, StagedFix } from "@/types";
import { cn, formatStateColor, formatStateBg, formatStateLabel, truncatePath } from "@/lib/utils";
import { FormatImpactTable } from "./FormatImpactTable";

interface Props {
  result:       FormatCheckResult;
  rules:        FormatRule[];
  stagedFixes:  StagedFix[];
  onStageFix:   (fix: StagedFix) => void;
}

export function FormatFileRow({ result, rules, stagedFixes, onStageFix }: Props) {
  const [impactOpen, setImpactOpen] = useState(false);

  const hasIssue      = result.state !== "Compatible" && result.state !== "NotApplicable";
  const alreadyStaged = stagedFixes.some((s) => s.result.path === result.path);

  return (
    <div className={cn(
      "px-3 py-2.5 rounded-lg border text-sm",
      formatStateBg(result.state),
      result.state === "Compatible"         ? "border-romio-green/10" :
      result.state === "FormatIncompatible" ? "border-romio-red/20"   :
      result.state === "FormatDeprecated"   ? "border-amber-400/20"   :
      "border-border"
    )}>
      {/* Main row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-mono text-xs font-medium", formatStateColor(result.state))}>
              {result.path.split(/[/\\]/).pop()}
            </span>
            <span className={cn("text-xs", formatStateColor(result.state))}>
              {formatStateLabel(result.state)}
            </span>
            {result.fixAction && (
              <span className="text-xs text-romio-gray">
                .{result.extension} → {result.fixAction.newFilename ?? result.fixAction.description}
              </span>
            )}
          </div>

          {result.notes && (
            <p className="text-xs text-romio-gray/70 mt-0.5">{result.notes}</p>
          )}

          {truncatePath(result.path) !== result.path.split(/[/\\]/).pop() && (
            <p className="font-mono text-xs text-romio-gray/50 mt-0.5 truncate">
              {truncatePath(result.path)}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasIssue && result.fixAction && (
            <button
              onClick={() => onStageFix({ result, fix: result.fixAction! })}
              disabled={alreadyStaged}
              title={alreadyStaged ? "Already staged" : "Stage this fix"}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors",
                alreadyStaged
                  ? "text-romio-gray border-border cursor-default opacity-50"
                  : "text-romio-green border-romio-green/30 bg-romio-green/10 hover:bg-romio-green/20"
              )}
            >
              <Plus className="w-3 h-3" />
              {alreadyStaged ? "Staged" : "Stage fix"}
            </button>
          )}

          {hasIssue && result.system && (
            <button
              onClick={() => setImpactOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-romio-gray hover:text-romio-cream
                         transition-colors"
            >
              {impactOpen
                ? <ChevronDown  className="w-3.5 h-3.5" />
                : <ChevronRight className="w-3.5 h-3.5" />
              }
              Impact
            </button>
          )}
        </div>
      </div>

      {/* Impact table */}
      <AnimatePresence>
        {impactOpen && result.system && (
          <FormatImpactTable
            extension={result.extension}
            system={result.system}
            rules={rules}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
