// SPDX-License-Identifier: GPL-3.0
// One scan session per project and tool screen (Multi-Disc, ScummVM, Installed Titles).
// Lives outside the components so inputs, results and a running scan survive leaving the
// screen. Sessions last until the app closes.

import { create } from "zustand";
import { useAppStore } from "@/stores";

export interface ToolSession<T = unknown> {
  inputs:  Record<string, string>;
  /** The inputs the current result or error came from */
  scanned: Record<string, string> | null;
  running: boolean;
  stopped: boolean;
  error:   string | null;
  result:  T | null;
}

const EMPTY: ToolSession = { inputs: {}, scanned: null, running: false, stopped: false, error: null, result: null };

interface ToolStore {
  sessions: Record<string, ToolSession>;
  patch: (key: string, patch: Partial<ToolSession>) => void;
}

export const useToolStore = create<ToolStore>((set) => ({
  sessions: {},
  patch: (key, patch) => set((s) => ({
    sessions: { ...s.sessions, [key]: { ...(s.sessions[key] ?? EMPTY), ...patch } },
  })),
}));

// Latest run per session. A stopped or replaced run finds a newer id and reports nothing.
const runs: Record<string, number> = {};

export function runTool(key: string, inputs: Record<string, string>, call: () => Promise<unknown>) {
  const { sessions, patch } = useToolStore.getState();
  if (sessions[key]?.running) return;
  const run = (runs[key] = (runs[key] ?? 0) + 1);
  const current = () => runs[key] === run;

  patch(key, { running: true, stopped: false, error: null, result: null, scanned: { ...inputs } });
  call()
    .then((result) => { if (current()) patch(key, { result }); })
    .catch((err) => { if (current()) patch(key, { error: err instanceof Error ? err.message : String(err) }); })
    .finally(() => { if (current()) patch(key, { running: false }); });
}

/** Drops the run at once. The backend call isn't cancelled; whatever it returns is ignored. */
export function stopTool(key: string) {
  if (!useToolStore.getState().sessions[key]?.running) return;
  runs[key] = (runs[key] ?? 0) + 1;
  useToolStore.getState().patch(key, { running: false, stopped: true });
}

/** A tool screen's session for the active project, with `defaults` under anything typed. */
export function useTool<T>(tool: string, defaults: Record<string, string>) {
  const projectId = useAppStore((s) => s.activeProject?.id ?? "");
  const key = `${projectId}:${tool}`;
  const session = useToolStore((s) => s.sessions[key] ?? EMPTY) as ToolSession<T>;
  const inputs = { ...defaults, ...session.inputs };
  // Only results can be out of date: a stopped or failed scan left none
  const stale = !session.running && session.scanned !== null && session.result !== null
    && Object.keys(inputs).some((k) => inputs[k] !== session.scanned?.[k]);

  return {
    session,
    inputs,
    stale,
    setInput: (name: string, value: string) =>
      useToolStore.getState().patch(key, { inputs: { ...session.inputs, [name]: value } }),
    scan: (call: () => Promise<T>) => runTool(key, inputs, call),
    stop: () => stopTool(key),
  };
}
