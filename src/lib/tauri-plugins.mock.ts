// SPDX-License-Identifier: GPL-3.0
// Mock for @tauri-apps/plugin-fs and @tauri-apps/plugin-dialog.
// Both packages are aliased to this file when VITE_TEST_MODE=true.
// Add exports here when a new component directly imports from either plugin.

// ── plugin-fs ─────────────────────────────────────────────────────────────────
// Nothing imports plugin-fs directly any more: FormatScreen lists folders through
// ipc.listLibraryFolders (mocked in ipc.mock.ts), because the plugin's scope only
// reaches one level below a picked folder.

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
