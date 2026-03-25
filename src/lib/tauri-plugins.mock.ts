// SPDX-License-Identifier: GPL-3.0
// Mock for @tauri-apps/plugin-fs and @tauri-apps/plugin-dialog.
// Both packages are aliased to this file when VITE_TEST_MODE=true.
// Add exports here when a new component directly imports from either plugin.

// ── plugin-fs ─────────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  path?: string;
}

// The system directory names returned at the first level. Used to detect
// second-level calls: if the path ends with one of these names we are
// inside a system folder and should return ROM files.
const FIXTURE_SYSTEM_NAMES = ["psx", "gba"];

// FormatScreen.tsx calls readDir(libraryPath) to enumerate ROM directories,
// then readDir(systemPath) to enumerate files within each system folder.
// Returns a realistic two-level structure for test assertions.
export async function readDir(path: string): Promise<DirEntry[]> {
  // Second-level call: path ends with a known system directory name
  const isSystemSubdir = FIXTURE_SYSTEM_NAMES.some(
    (s) => path.endsWith("/" + s) || path.endsWith("\\" + s)
  );
  if (isSystemSubdir) {
    return [
      { name: "game1.bin", isDirectory: false, isFile: true, isSymlink: false },
      { name: "game2.chd", isDirectory: false, isFile: true, isSymlink: false },
    ];
  }
  // First-level call: return system directories
  return [
    { name: "psx", isDirectory: true, isFile: false, isSymlink: false },
    { name: "gba", isDirectory: true, isFile: false, isSymlink: false },
  ];
}

// ── plugin-dialog ─────────────────────────────────────────────────────────────

interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

// FormatConfigBar.tsx and ProjectsScreen.tsx call open({ directory: true })
// to let the user pick a folder. Returns a stable fixture path.
export async function open(
  _options?: OpenDialogOptions
): Promise<string | string[] | null> {
  return "/fixture/selected/path";
}
