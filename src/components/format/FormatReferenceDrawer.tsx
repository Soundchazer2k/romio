// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search } from "lucide-react";
import type { FormatRule } from "@/types";
import { formatSupportLabel, cn } from "@/lib/utils";

const SUPPORT_STATES = [
  { label: "Supported",   desc: "File will work with this emulator as-is." },
  { label: "Deprecated",  desc: "File works but the format has been replaced. Rename recommended." },
  { label: "Unsupported", desc: "File will not work. Re-dump or convert required." },
  { label: "Conditional", desc: "Works only under specific conditions noted in the rule." },
];

interface Props {
  open:    boolean;
  rules:   FormatRule[];
  onClose: () => void;
}

export function FormatReferenceDrawer({ open, rules, onClose }: Props) {
  const [search, setSearch] = useState("");

  const filtered = rules.filter((r) => {
    const q = search.toLowerCase();
    return (
      r.system.toLowerCase().includes(q)    ||
      r.extension.toLowerCase().includes(q) ||
      r.emulator.toLowerCase().includes(q)
    );
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md
                       bg-romio-surface border-l border-border flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-semibold text-romio-cream">Format Rules Reference</h2>
                <p className="text-xs text-romio-gray mt-0.5">
                  Full compatibility matrix — {rules.length} rules loaded
                </p>
              </div>
              <button onClick={onClose} className="text-romio-gray hover:text-romio-cream">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Support state legend */}
            <div className="px-5 py-3 border-b border-border space-y-1.5 bg-black/20">
              <p className="text-xs text-romio-gray uppercase tracking-wider">Support states</p>
              {SUPPORT_STATES.map((s) => (
                <div key={s.label} className="flex gap-2 text-xs">
                  <span className={cn(
                    "font-medium flex-shrink-0 w-20",
                    s.label === "Supported"   ? "text-romio-green" :
                    s.label === "Deprecated"  ? "text-amber-400"   :
                    s.label === "Unsupported" ? "text-romio-red"   :
                    "text-romio-gray"
                  )}>{s.label}</span>
                  <span className="text-romio-gray/70">{s.desc}</span>
                </div>
              ))}
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg
                              bg-black/30 border border-border">
                <Search className="w-3.5 h-3.5 text-romio-gray flex-shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by system, extension, emulator…"
                  className="flex-1 bg-transparent text-sm text-romio-cream
                             placeholder:text-romio-gray/40 focus:outline-none"
                />
              </div>
            </div>

            {/* Rules table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-romio-surface border-b border-border">
                  <tr>
                    {["System", "Ext", "Emulator", "Support"].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-romio-gray font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((rule, i) => (
                    <tr key={i}
                      className="border-b border-border/50 hover:bg-white/3 transition-colors">
                      <td className="px-3 py-2 text-romio-gray">{rule.system}</td>
                      <td className="px-3 py-2 font-mono text-romio-cream">.{rule.extension}</td>
                      <td className="px-3 py-2 text-romio-gray">{rule.emulator}</td>
                      <td className={cn(
                        "px-3 py-2 font-medium",
                        rule.support === "supported"                                         ? "text-romio-green" :
                        typeof rule.support === "object" && "deprecated"  in rule.support    ? "text-amber-400"   :
                        typeof rule.support === "object" && "unsupported" in rule.support    ? "text-romio-red"   :
                        "text-romio-gray"
                      )}>
                        {formatSupportLabel(rule.support)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="text-center py-8 text-romio-gray text-sm">No rules match your filter.</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
