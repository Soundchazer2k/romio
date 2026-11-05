// SPDX-License-Identifier: GPL-3.0
import { Fragment, useState } from "react";
import { X, Search } from "lucide-react";
import type { FormatRule } from "@/types";
import { formatSupportLabel, cn } from "@/lib/utils";
import { Modal, Dialog } from "@/components/shared/Modal";

const SUPPORT_STATES = [
  { label: "Supported",   desc: "This emulator reads this format. Romio checks the format, not the file." },
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
  // Mount only while open so Modal records the opener and returns focus to it on close
  if (!open) return null;
  return <DrawerContent rules={rules} onClose={onClose} />;
}

function DrawerContent({ rules, onClose }: Omit<Props, "open">) {
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
    <Modal
      variant="drawer"
      onClose={onClose}
      className="h-full w-full max-w-md bg-background-surface border-l border-border
                 flex flex-col shadow-2xl focus:outline-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <Dialog.Title className="font-semibold text-romio-cream">Format rules reference</Dialog.Title>
          <Dialog.Description className="text-xs text-romio-gray mt-0.5">
            Full compatibility matrix: {rules.length} rules loaded.
          </Dialog.Description>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="text-xs text-romio-gray border border-border rounded px-1.5 font-sans">Esc</kbd>
          <Dialog.Close aria-label="Close" className="text-romio-gray hover:text-romio-cream">
            <X className="w-4 h-4" />
          </Dialog.Close>
        </div>
      </div>

      {/* Search */}
      <div className="px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/30 border border-border
                        focus-within:border-romio-green focus-within:ring-2 focus-within:ring-romio-green/30">
          <Search className="w-3.5 h-3.5 text-romio-gray shrink-0" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter rules"
            placeholder="Filter by system, extension, emulator…"
            className="flex-1 bg-transparent text-sm text-romio-cream
                       placeholder:text-romio-gray focus:outline-hidden"
          />
        </div>
      </div>

      {/* Support state legend: background reading, kept one click away */}
      <details className="px-5 py-3 border-b border-border bg-black/20 text-xs">
        <summary className="cursor-pointer font-semibold text-romio-green">
          From the manual: support states
        </summary>
        <div className="mt-2 space-y-1.5">
          {SUPPORT_STATES.map((s) => (
            <div key={s.label} className="flex gap-2">
              <span className={cn(
                "font-medium shrink-0 w-20",
                s.label === "Supported"   ? "text-romio-green" :
                s.label === "Unsupported" ? "text-romio-red"   :
                "text-amber-400"
              )}>{s.label}</span>
              <span className="text-romio-gray">{s.desc}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Rules table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background-surface border-b border-border">
            <tr>
              {["System", "Ext", "Emulator", "Support"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-romio-gray font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((rule, i) => {
              const condition = typeof rule.support === "object" && "conditional" in rule.support
                ? rule.support.conditional.condition
                : typeof rule.support === "object" && "unsupported" in rule.support
                  ? rule.support.unsupported.reason
                  : null;
              const hasDetail = condition || rule.notes;
              return (
                <Fragment key={i}>
                  <tr className={cn("hover:bg-white/3 transition-colors", !hasDetail && "border-b border-border/50")}>
                    <td className="px-3 py-2 text-romio-gray">{rule.system}</td>
                    <td className="px-3 py-2 font-mono text-romio-cream">.{rule.extension}</td>
                    <td className="px-3 py-2 text-romio-gray">{rule.emulator}</td>
                    <td className={cn(
                      "px-3 py-2 font-medium",
                      rule.support === "supported"                                      ? "text-romio-green" :
                      typeof rule.support === "object" && "unsupported" in rule.support ? "text-romio-red"   :
                      "text-amber-400"
                    )}>
                      {formatSupportLabel(rule.support)}
                    </td>
                  </tr>
                  {hasDetail && (
                    <tr className="border-b border-border/50">
                      <td colSpan={4} className="px-3 pb-2 space-y-1">
                        {condition && <p className="text-romio-cream">{condition}</p>}
                        {rule.notes && <p className="text-romio-gray">{rule.notes}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center py-8 text-romio-gray text-sm">No rules match your filter.</p>
        )}
      </div>
    </Modal>
  );
}
