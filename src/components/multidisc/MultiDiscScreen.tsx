// SPDX-License-Identifier: GPL-3.0
import { Disc3 } from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import { useTool } from "@/lib/tool-scan";
import { cn, truncatePath } from "@/lib/utils";
import type { MultiDiscSet, M3uState } from "@/types";
import { ScanBar, ScanNotices } from "@/components/shared/ScanBar";

const M3U_LABEL: Record<M3uState, string> = {
  missing:    "No playlist",
  complete:   "Playlist complete",
  incomplete: "Playlist incomplete",
};

function needsWork(set: MultiDiscSet) {
  return set.m3uState !== "complete" || set.discs.some((d) => d.missingTracks.length > 0 || d.problem);
}

export function MultiDiscScreen() {
  const { activeProject } = useAppStore();
  const { session, inputs, stale, setInput, scan, stop } = useTool<MultiDiscSet[]>("multidisc", {
    root: activeProject?.libraryRoots[0] ?? "",
  });
  const sets = session.result;
  const open = sets?.filter(needsWork).length ?? 0;

  // Sets arrive sorted by folder, so each system's sets are already together
  const systems = Array.from(new Set(sets?.map((s) => s.system)));

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-romio-green/10 flex items-center justify-center">
          <Disc3 className="w-5 h-5 text-romio-green" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">
            {sets && sets.length > 0
              ? `${sets.length} multi-disc ${sets.length === 1 ? "set" : "sets"}, ${open} ${open === 1 ? "needs" : "need"} attention`
              : "Multi-Disc Toolkit"}
          </h1>
          <p className="text-romio-gray text-sm mt-0.5">
            Find games that span several discs and check each one has a playlist, so it shows as one entry.
          </p>
        </div>
      </div>

      <ScanBar
        label="Library root"
        placeholder="/path/to/roms"
        path={inputs.root}
        running={session.running}
        onPathChange={(v) => setInput("root", v)}
        onScan={() => scan(() => ipc.detectMultiDisc(inputs.root))}
        onStop={stop}
      />

      <ScanNotices session={session} stale={stale} reading="Looking for disc sets…" />

      {sets && sets.length > 0 && (
        <>
          <p className="text-sm text-romio-gray">
            Romio only reports here. It doesn't write playlists or group discs yet.
          </p>
          {systems.map((system) => (
            <section key={system} className="space-y-2">
              <h2 className="text-sm font-semibold text-romio-gray">{system}</h2>
              {sets.filter((s) => s.system === system).map((set) => (
                <SetRow key={`${set.folder}/${set.name}`} set={set} />
              ))}
            </section>
          ))}
        </>
      )}

      {!session.running && !session.error && !session.stopped && !(sets && sets.length > 0) && (
        <div className="text-center py-16 text-romio-gray space-y-2">
          <Disc3 className="w-10 h-10 mx-auto opacity-30" />
          <p>{sets
            ? `No multi-disc sets found in ${session.scanned?.root}. Romio looks for names with a tag such as (Disc 1).`
            : "Run a scan to find multi-disc games"}</p>
        </div>
      )}
    </div>
  );
}

function SetRow({ set }: { set: MultiDiscSet }) {
  const broken = set.discs.some((d) => d.missingTracks.length > 0);
  return (
    <details className={cn(
      "rounded-xl border overflow-hidden",
      broken                        ? "border-romio-red/30 bg-romio-red/5" :
      set.m3uState === "complete"   ? "border-romio-green/20" :
                                      "border-amber-400/20 bg-amber-400/5"
    )}>
      <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer
                          hover:bg-white/5 transition-colors">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-romio-cream truncate">{set.name}</span>
          <span className="block text-xs text-romio-gray">
            {set.discs.length} discs: {set.discs.map((d) => d.disc).join(", ")}
          </span>
        </span>
        <span className="flex gap-2 shrink-0">
          {broken && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-background-surface text-romio-red">
              Track files missing
            </span>
          )}
          <span className={cn(
            "px-2 py-0.5 rounded-full text-xs bg-background-surface",
            set.m3uState === "complete" ? "text-romio-green" : "text-amber-400"
          )}>
            {M3U_LABEL[set.m3uState]}
          </span>
        </span>
      </summary>

      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border">
        <ul className="space-y-1.5">
          {set.discs.map((disc) => (
            <li key={disc.path}>
              <p className="text-xs font-mono text-romio-gray" title={disc.path}>
                Disc {disc.disc}: {truncatePath(disc.path)}
              </p>
              {disc.problem && <p className="text-xs text-amber-400 mt-0.5">{disc.problem}</p>}
              {disc.missingTracks.length > 0 && (
                <p className="text-xs text-romio-red mt-0.5">
                  This sheet needs {disc.missingTracks.length === 1 ? "a file that isn't" : "files that aren't"} there:{" "}
                  <span className="font-mono">{disc.missingTracks.join(", ")}</span>. The disc won't load until {disc.missingTracks.length === 1 ? "it is" : "they are"} back.
                </p>
              )}
            </li>
          ))}
        </ul>

        {set.m3uState === "missing" ? (
          <p className="text-xs text-amber-400">
            No playlist lists these discs, so most frontends show each disc as its own game.
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs font-mono text-romio-gray" title={set.m3uPath ?? undefined}>
              Playlist: {truncatePath(set.m3uPath ?? "")}
            </p>
            {set.m3uProblems.map((problem) => (
              <p key={problem} className="text-xs text-amber-400">{problem}</p>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
