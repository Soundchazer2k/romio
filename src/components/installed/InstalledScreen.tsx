// SPDX-License-Identifier: GPL-3.0
import { useId, useState } from "react";
import { HardDrive, ChevronDown } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { useTool } from "@/lib/tool-scan";
import { cn } from "@/lib/utils";
import type { TitleCheck, TitleKind, ShortcutValidationResult } from "@/types";
import { ScanBar, ScanNotices } from "@/components/shared/ScanBar";

// Where each emulator keeps the titles it has installed
const EMULATORS: Record<string, { name: string; folder: string }> = {
  rpcs3:   { name: "RPCS3",   folder: "dev_hdd0/game inside the RPCS3 folder" },
  shadps4: { name: "shadPS4", folder: "the games folder set in shadPS4" },
  vita3k:  { name: "Vita3K",  folder: "ux0/app inside the Vita3K data folder" },
  cemu:    { name: "Cemu",    folder: "mlc01/usr/title/00050000 inside the Cemu folder (updates are in 0005000e)" },
};

const KIND_LABEL: Record<TitleKind, string> = {
  game:   "Game",
  update: "Update",
  data:   "Data only",
};

export function InstalledScreen() {
  const emulatorId = useId();
  const { session, inputs, stale, setInput, scan, stop } = useTool<TitleCheck[]>("installed", {
    dir: "", emulator: "rpcs3",
  });
  const titles = session.result;
  const flagged = titles?.filter((t) => t.issues.length > 0).length ?? 0;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-romio-green/10 flex items-center justify-center">
          <HardDrive className="w-5 h-5 text-romio-green" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">
            {titles && titles.length > 0
              ? `${titles.length} installed ${titles.length === 1 ? "title" : "titles"}, ${flagged} with problems`
              : "Installed Titles"}
          </h1>
          <p className="text-romio-gray text-sm mt-0.5">
            Check the titles an emulator has installed: each folder's title ID and the files the emulator needs.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <ScanBar
          label="Installed titles folder"
          placeholder="/path/to/installed/titles"
          path={inputs.dir}
          running={session.running}
          onPathChange={(v) => setInput("dir", v)}
          onScan={() => scan(() => ipc.checkInstalledTitles(inputs.dir, inputs.emulator))}
          onStop={stop}
        >
          <div className="space-y-1">
            <label htmlFor={emulatorId} className="text-xs font-semibold text-romio-gray">Emulator</label>
            <div className="relative">
              <select
                id={emulatorId}
                value={inputs.emulator}
                onChange={(e) => setInput("emulator", e.target.value)}
                className="appearance-none px-3 py-2 pr-8 rounded-lg bg-background-surface border border-white/10
                           text-sm text-romio-cream focus:outline-hidden focus:border-romio-green/40"
              >
                {Object.entries(EMULATORS).map(([id, e]) => <option key={id} value={id}>{e.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5
                                      text-romio-gray pointer-events-none" />
            </div>
          </div>
        </ScanBar>
        <p className="text-xs text-romio-gray">
          For {EMULATORS[inputs.emulator]?.name}, pick {EMULATORS[inputs.emulator]?.folder}.
        </p>
      </div>

      <ScanNotices session={session} stale={stale} reading="Reading installed titles…" />

      {titles && titles.length > 0 && (
        <div className="space-y-2">
          {titles.map((title) => <TitleRow key={title.path} title={title} />)}
        </div>
      )}

      {!session.running && !session.error && !session.stopped && !(titles && titles.length > 0) && (
        <div className="text-center py-12 text-romio-gray space-y-2">
          <HardDrive className="w-10 h-10 mx-auto opacity-30" />
          <p>{titles
            ? `No title folders in ${session.scanned?.dir}.`
            : "Pick an emulator's installed titles folder and scan it"}</p>
        </div>
      )}

      <LaunchCommandCheck />
    </div>
  );
}

function TitleRow({ title }: { title: TitleCheck }) {
  const ok = title.issues.length === 0;
  return (
    <div className={cn(
      "px-4 py-3 rounded-xl border space-y-1",
      ok ? "border-romio-green/20" : "border-romio-red/30 bg-romio-red/5"
    )}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium font-mono text-romio-cream truncate" title={title.path}>{title.folder}</p>
        <span className="flex gap-2 shrink-0">
          <span className="px-2 py-0.5 rounded-full text-xs bg-background-surface text-romio-gray">
            {KIND_LABEL[title.kind]}
          </span>
          <span className={cn(
            "px-2 py-0.5 rounded-full text-xs bg-background-surface",
            ok ? "text-romio-green" : "text-romio-red"
          )}>
            {ok ? "OK" : `${title.issues.length} ${title.issues.length === 1 ? "problem" : "problems"}`}
          </span>
        </span>
      </div>
      {title.issues.map((issue) => (
        <p key={issue} className="text-xs text-romio-red">{issue}</p>
      ))}
      {ok && title.kind === "data" && (
        <p className="text-xs text-romio-gray">
          No boot file here, so this is update data or add-on content, not a game to launch.
        </p>
      )}
    </div>
  );
}

/** Paste a shortcut's launch command to see whether it would resolve. */
function LaunchCommandCheck() {
  const id = useId();
  const [command, setCommand] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ShortcutValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await ipc.validateShortcutContent(command));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="pt-6 border-t border-border space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-romio-cream">Check a launch command</h2>
        <p className="text-sm text-romio-gray mt-0.5">
          Paste the command from a shortcut. Romio looks for variables that were never filled in,
          an emulator that isn't where the command says, and paths with spaces but no quotes.
        </p>
      </div>
      <div className="flex gap-3 items-end">
        <div className="flex-1 min-w-0 space-y-1">
          <label htmlFor={id} className="text-xs font-semibold text-romio-gray">Launch command</label>
          <input
            id={id}
            value={command}
            onChange={(e) => { setCommand(e.target.value); setResult(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && command.trim() && !checking) check(); }}
            placeholder={'"/path/to/emulator" --no-gui "/path/to/game"'}
            className="w-full px-3 py-2 rounded-lg bg-background-surface border border-white/10
                       text-sm font-mono text-romio-cream placeholder:text-romio-gray
                       focus:outline-hidden focus:border-romio-green/40"
          />
        </div>
        <button
          onClick={check}
          disabled={!command.trim() || checking}
          className="px-4 py-2 rounded-lg bg-background-surface border border-white/10
                     text-sm text-romio-cream hover:bg-white/5 transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Check
        </button>
      </div>

      <div aria-live="polite" className="space-y-2">
        {error && <p className="text-sm text-romio-red">{error}</p>}
        {result?.isValid && (
          <p className="text-sm text-romio-green">
            Nothing wrong found. Romio checked the variables, the emulator's path and its quoting, not the game's path.
          </p>
        )}
        {result?.issues.map((issue) => (
          <div key={issue.description}
               className="px-4 py-3 rounded-xl border border-romio-red/30 bg-romio-red/5 space-y-1">
            <p className="text-sm text-romio-red">{issue.description}</p>
            {issue.fix && <p className="text-xs text-romio-gray">{issue.fix}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
