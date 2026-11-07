// SPDX-License-Identifier: GPL-3.0
import { ipc } from "@/lib/ipc";
import { emulatorForSystem, groupResultsBySystem } from "@/lib/utils";
import { formatSessionOf, useFormatStore } from "@/stores";
import type { EmulatorMatrixEntry, FormatCheckResult, Project } from "@/types";

/**
 * Lives outside FormatScreen so a scan keeps running after the screen unmounts.
 * Results go to the session of the project the scan started in, whatever is
 * active by the time it ends. One scan per project at a time.
 */
export async function runFormatScan(project: Project | null, emulatorMatrix: EmulatorMatrixEntry[]) {
  const { libraryPath, frontend, emulatorOverride, isScanning } = formatSessionOf(project);
  if (!libraryPath || isScanning) return;

  const update = useFormatStore.getState().updateSession;
  update(project, {
    isScanning:     true,
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

    for (const folder of folders) {
      const systemId = folder.system;

      const emu = emulatorForSystem(systemId, emulatorOverride, emulatorMatrix);

      for (const filePath of folder.files) {
        const name = filePath.split(/[\/]/).pop() ?? filePath;
        try {
          const result = await ipc.checkFormat(filePath, systemId, emu, frontend);
          allResults.push(result);
        } catch {
          // Per-file error: push Unknown result
          const ext = name.includes(".")
            ? name.split(".").pop() ?? ""
            : "";
          allResults.push({
            path:      filePath,
            extension: ext,
            system:    systemId,
            emulator:  emu,
            state:     "Unknown",
            notes:     "Check failed — file may be unreadable",
          });
        }
      }
    }

    update(project, {
      groups:         groupResultsBySystem(allResults),
      partialSystems: folders.filter((f) => f.error || f.uncheckedSubfolders).map((f) => f.system),
      limitedFolders: folders.filter((f) => f.uncheckedSubfolders).map((f) => f.name),
      scanned:        true,
      scanError:      unreadable.length > 0
        ? `Romio couldn't finish reading these folders, so some of their games may not be checked: ${unreadable.join(", ")}.`
        : null,
    });
  } catch (err) {
    update(project, { scanError: err instanceof Error ? err.message : String(err) });
  } finally {
    update(project, { isScanning: false });
  }
}
