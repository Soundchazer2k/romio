// SPDX-License-Identifier: GPL-3.0
import { Check, X, AlertTriangle, HelpCircle } from "lucide-react";
import { motion } from "framer-motion";
import type { FormatRule, FormatSupport } from "@/types";
import { formatSupportLabel, cn } from "@/lib/utils";

interface Props {
  extension: string;
  system:    string;
  rules:     FormatRule[];
}

export function FormatImpactTable({ extension, system, rules }: Props) {
  const relevant = rules.filter(
    (r) => r.extension === extension && r.system === system
  );

  if (relevant.length === 0) {
    return (
      <p className="text-xs text-romio-gray/60 italic mt-2">
        No cross-emulator rules found for .{extension} on {system}.
      </p>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-2 overflow-hidden"
    >
      <p className="text-xs text-romio-gray uppercase tracking-wider mb-1.5">
        Impact across emulators
      </p>
      <div className="space-y-1">
        {relevant.map((rule, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-2.5 py-1.5 rounded-lg bg-black/20
                       border border-border text-xs"
          >
            <SupportIcon support={rule.support} />
            <span className="font-mono text-romio-cream flex-1">{rule.emulator}</span>
            {rule.frontend && (
              <span className="text-romio-gray border border-border px-1 rounded text-[10px]">
                {rule.frontend}
              </span>
            )}
            <span className={cn(
              "text-xs",
              rule.support === "supported"           ? "text-romio-green" :
              typeof rule.support === "object" && "deprecated"  in rule.support ? "text-amber-400" :
              typeof rule.support === "object" && "unsupported" in rule.support ? "text-romio-red" :
              "text-romio-gray"
            )}>
              {formatSupportLabel(rule.support)}
            </span>
          </div>
        ))}
      </div>
      {relevant.some((r) => typeof r.support === "object" && ("deprecated" in r.support || "unsupported" in r.support)) && (
        <p className="text-[10px] text-romio-gray/60 mt-1.5">
          A fix for one emulator may break compatibility with another. Review before staging.
        </p>
      )}
    </motion.div>
  );
}

function SupportIcon({ support }: { support: FormatSupport }) {
  if (support === "supported")                                    return <Check        className="w-3 h-3 text-romio-green flex-shrink-0" />;
  if (typeof support === "object" && "deprecated"  in support)   return <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />;
  if (typeof support === "object" && "unsupported" in support)   return <X            className="w-3 h-3 text-romio-red flex-shrink-0" />;
  return                                                                <HelpCircle   className="w-3 h-3 text-romio-gray flex-shrink-0" />;
}
