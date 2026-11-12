// SPDX-License-Identifier: GPL-3.0
import { ipc } from "@/lib/ipc";
import { emulatorForSystem, groupResultsBySystem } from "@/lib/utils";
import { formatSessionOf, useFormatStore, type FormatSession } from "@/stores";
import type { EmulatorMatrixEntry, FormatCheckResult, Project } from "@/types";

// Small enough that the count keeps moving inside one big folder
const CHECK_CHUNK_SIZE = 200;

let lastRun = 0;

/**
 * Lives outside FormatScreen so a scan keeps running after the screen unmounts.
 * Results go to the session of the project the scan started in, whatever is
 * active by the time it ends. One scan per project at a time. Once stopped, a
 * run sends no more chunks and its updates are dropped.
 */
export async function runFormatScan(project: Project | null, emulatorMatrix: EmulatorMatrixEntry[]) {
  const { libraryPath, frontend, emulatorOverride, isScanning } = formatSessionOf(project);
  if (!libraryPath || isScanning) return;

  const run = ++lastRun;
  const isCurrent = () => formatSessionOf(project).scanRun === run;
  const updateSession = useFormatStore.getState().updateSession;
  const update = (patch: Partial<FormatSession>) => {
    if (isCurrent()) updateSession(project, patch);
  };

  updateSession(project, {
    isScanning:     true,
    scanRun:        run,
    stopped:        false,
    progress:       null,
    scanError:      null,
    groups:         [],
    scanned:        false,
    stagedFixes:    [],
    partialSystems: [],
    limitedFolders: [],
    scannedWith:    { path: libraryPath, frontend, emulator: emulatorOverride },
  });

  try {
    const allResults: FormatCheckResult[] = [];

    // System folders and their game files, listed by the backend (uses roms/ when present)
    const folders = await ipc.listLibraryFolders(libraryPath);
    const unreadable = folders.filter((f) => f.error).map((f) => f.name);

    const total = folders.reduce((sum, f) => sum + f.files.length, 0);
    let checked = 0;
    update({ progress: { checked, total } });

    for (const folder of folders) {
      const systemId = folder.system;

      const emu = emulatorForSystem(systemId, emulatorOverride, emulatorMatrix);

      for (let i = 0; i < folder.files.length; i += CHECK_CHUNK_SIZE) {
        if (!isCurrent()) return;
        const chunk = folder.files.slice(i, i + CHECK_CHUNK_SIZE);
        try {
          allResults.push(...await ipc.checkFormatBatch(chunk, systemId, emu, frontend));
        } catch (err) {
          // Failed call: its files become Unknown results, and the scan goes on
          const reason = err instanceof Error ? err.message : String(err);
          for (const filePath of chunk) {
            const name = filePath.split(/[\\/]/).pop() ?? filePath;
            const ext = name.includes(".")
              ? name.split(".").pop() ?? ""
              : "";
            allResults.push({
              path:      filePath,
              extension: ext,
              system:    systemId,
              emulator:  emu,
              state:     "Unknown",
              notes:     `Check failed: ${reason}`,
            });
          }
        }
        checked += chunk.length;
        update({ progress: { checked, total } });
      }
    }

    update({
      groups:         groupResultsBySystem(allResults),
      partialSystems: folders.filter((f) => f.error || f.uncheckedSubfolders).map((f) => f.system),
      limitedFolders: folders.filter((f) => f.uncheckedSubfolders).map((f) => f.name),
      scanned:        true,
      scanError:      unreadable.length > 0
        ? `Romio couldn't finish reading these folders, so some of their games may not be checked: ${unreadable.join(", ")}.`
        : null,
    });
  } catch (err) {
    update({ scanError: err instanceof Error ? err.message : String(err) });
  } finally {
    update({ isScanning: false, scanRun: null });
  }
}

/**
 * Lets go of the running scan so a new one can start. A backend call already in
 * flight can't be cancelled: it carries on and its answer is ignored.
 */
export function stopFormatScan(project: Project | null) {
  useFormatStore.getState().updateSession(project, {
    isScanning: false,
    scanRun:    null,
    stopped:    true,
    progress:   null,
  });
}
