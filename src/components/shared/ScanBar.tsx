// SPDX-License-Identifier: GPL-3.0
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import type { ToolSession } from "@/lib/tool-scan";

interface Props {
  label:       string;
  placeholder: string;
  path:        string;
  running:     boolean;
  onPathChange: (v: string) => void;
  onScan:       () => void;
  onStop:       () => void;
  /** Extra fields, shown between the folder and the buttons */
  children?: React.ReactNode;
}

/** Folder field with Browse, Scan and Stop, for screens that read a folder on demand. */
export function ScanBar({ label, placeholder, path, running, onPathChange, onScan, onStop, children }: Props) {
  const id = useId();
  const scanButton = useRef<HTMLButtonElement>(null);
  const [browsing, setBrowsing] = useState(false);

  async function browse() {
    setBrowsing(true);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") onPathChange(selected);
    } finally {
      setBrowsing(false);
    }
  }

  // Stop is disabled once clicked, so hand focus to Scan rather than lose it
  function stop() {
    flushSync(onStop);
    scanButton.current?.focus();
  }

  return (
    <div className="flex gap-3 flex-wrap items-end">
      <div className="flex-1 min-w-48 space-y-1">
        <label htmlFor={id} className="text-xs font-semibold text-romio-gray">{label}</label>
        <div className="flex gap-2">
          <input
            id={id}
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && path.trim() && !running) onScan(); }}
            placeholder={placeholder}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-background-surface border border-white/10
                       text-sm font-mono text-romio-cream placeholder:text-romio-gray
                       focus:outline-hidden focus:border-romio-green/40"
          />
          <button
            onClick={browse}
            disabled={browsing}
            className="px-3 py-2 rounded-lg bg-background-surface border border-white/10
                       text-romio-gray hover:text-romio-cream hover:bg-white/5 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
            title="Browse"
            aria-label="Browse"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>
      </div>

      {children}

      {/* Fixed width and an always-mounted Stop, so starting a scan doesn't move the row */}
      <button
        ref={scanButton}
        onClick={onScan}
        disabled={!path.trim() || running}
        className="min-w-32 px-4 py-2 rounded-lg bg-romio-green-fill text-white text-sm font-semibold
                   hover:bg-romio-green-fill/90 disabled:opacity-40 disabled:cursor-not-allowed
                   transition-colors flex items-center justify-center gap-2"
      >
        {running
          ? <><div className="w-3 h-3 border-2 border-white/40 border-t-white
                               rounded-full animate-spin" /> Scanning…</>
          : "Scan ▶"
        }
      </button>
      <button
        onClick={stop}
        disabled={!running}
        className="px-4 py-2 rounded-lg bg-background-surface border border-white/10
                   text-sm text-romio-cream hover:bg-white/5 transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Stop
      </button>
    </div>
  );
}

/** Running, stopped, failed and out-of-date notices for a tool session. */
export function ScanNotices({ session, stale, reading }: { session: ToolSession; stale: boolean; reading: string }) {
  return (
    <>
      {/* Always mounted: screen readers announce changes inside a live region more reliably than a new one */}
      <div aria-live="polite" aria-atomic="true" className="empty:absolute">
        {session.running && (
          <p className="font-mono text-sm text-romio-gray">{reading}</p>
        )}
        {session.stopped && (
          <p className="px-4 py-3 rounded-xl bg-background-surface border border-border
                        text-sm text-romio-gray">
            You stopped the scan, so there are no results. Romio may finish reading the folder in the background, but it ignores what it finds. Scan again when you're ready.
          </p>
        )}
      </div>

      {session.error && (
        <div role="alert"
             className="px-4 py-3 rounded-xl bg-romio-red/10 border border-romio-red/20
                        text-sm text-romio-red">
          {session.error}
        </div>
      )}

      {stale && (
        <p role="status"
           className="px-4 py-3 rounded-xl bg-amber-400/10 border border-amber-400/20
                      text-sm text-amber-400">
          You changed the settings, so these results are out of date. Scan again to update them.
        </p>
      )}
    </>
  );
}
