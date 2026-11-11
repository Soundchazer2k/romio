// SPDX-License-Identifier: GPL-3.0
import { MousePointerClick } from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import { useTool } from "@/lib/tool-scan";
import { cn, truncatePath } from "@/lib/utils";
import type { ScummVmGame, ScummVmReport } from "@/types";
import { ScanBar, ScanNotices } from "@/components/shared/ScanBar";

export function ScummVmScreen() {
  const { activeProject } = useAppStore();
  const { session, inputs, stale, setInput, scan, stop } = useTool<ScummVmReport>("scummvm", {
    root: activeProject?.libraryRoots[0] ?? "",
  });
  const report = session.result;
  const games = report?.games ?? [];
  const unpointed = games.filter((g) => !g.pointerPath).length;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-romio-green/10 flex items-center justify-center">
          <MousePointerClick className="w-5 h-5 text-romio-green" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">
            {games.length > 0
              ? `${games.length} ScummVM ${games.length === 1 ? "folder" : "folders"}, ${unpointed} without a pointer file`
              : "ScummVM Workspace"}
          </h1>
          <p className="text-romio-gray text-sm mt-0.5">
            Check each ScummVM game folder has the pointer file your frontend launches it through.
          </p>
        </div>
      </div>

      <ScanBar
        label="Library root"
        placeholder="/path/to/roms"
        path={inputs.root}
        running={session.running}
        onPathChange={(v) => setInput("root", v)}
        onScan={() => scan(() => ipc.detectScummvm(inputs.root))}
        onStop={stop}
      />

      <ScanNotices session={session} stale={stale} reading="Reading the scummvm folder…" />

      {games.length > 0 && (
        <>
          <p className="text-sm text-romio-gray">
            Romio only reports here. It doesn't write pointer files yet.
          </p>
          <div className="space-y-2">
            {games.map((game) => <GameRow key={game.path} game={game} />)}
          </div>
          <aside className="px-4 py-3 rounded-xl bg-background-surface border border-border
                            text-sm text-romio-gray space-y-1">
            <p className="font-semibold text-romio-cream">From the manual</p>
            <p>
              ES-DE, RetroBat and Batocera launch a ScummVM game through a <span className="font-mono">.scummvm</span> file
              in its folder, holding the game's ID. Some games that run in standalone ScummVM show a black screen
              or lose audio in the libretro core, so a pointer file alone doesn't prove a game will start.
            </p>
          </aside>
        </>
      )}

      {!session.running && !session.error && !session.stopped && games.length === 0 && (
        <div className="text-center py-16 text-romio-gray space-y-2">
          <MousePointerClick className="w-10 h-10 mx-auto opacity-30" />
          <p>{!report ? "Run a scan to list your ScummVM games"
            : report.folder ? `No game folders in ${report.folder}.`
            : `No scummvm folder in ${session.scanned?.root}. Point it at your frontend folder or its roms folder.`}</p>
        </div>
      )}
    </div>
  );
}

function GameRow({ game }: { game: ScummVmGame }) {
  const emptyPointer = game.pointerPath && !game.pointerId;
  const ok = game.pointerPath && !emptyPointer;
  return (
    <div className={cn(
      "px-4 py-3 rounded-xl border space-y-1",
      ok ? "border-romio-green/20" : "border-amber-400/20 bg-amber-400/5"
    )}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium font-mono text-romio-cream truncate" title={game.path}>{game.name}</p>
        <span className="flex gap-2 shrink-0">
          <span className="px-2 py-0.5 rounded-full text-xs bg-background-surface text-romio-gray">
            {game.engine ? `${game.engine} data` : "Files not recognised"}
          </span>
          <span className={cn(
            "px-2 py-0.5 rounded-full text-xs bg-background-surface",
            ok ? "text-romio-green" : "text-amber-400"
          )}>
            {!game.pointerPath ? "No pointer file" : emptyPointer ? "Pointer is empty" : "Pointer file found"}
          </span>
        </span>
      </div>

      {game.pointerPath && (
        <p className="text-xs font-mono text-romio-gray" title={game.pointerPath}>
          {truncatePath(game.pointerPath)}{game.pointerId ? ` → ${game.pointerId}` : ""}
        </p>
      )}
      {emptyPointer && (
        <p className="text-xs text-amber-400">
          With no game ID in the file, ScummVM detects the game by itself and can pick the wrong language or version.
        </p>
      )}
      {!game.engine && (
        <p className="text-xs text-romio-gray">
          Romio doesn't recognise this folder's files as a ScummVM game. It may still be one.
        </p>
      )}
    </div>
  );
}
