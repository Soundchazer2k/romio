// SPDX-License-Identifier: GPL-3.0
// Typed wrappers around all Tauri IPC commands.
// Import from here — never call invoke() directly in components.

import { invoke } from "@tauri-apps/api/core";
import type {
  Project, CreateProjectRequest,
  BiosSystemResult, BiosRule, BiosStatusResponse,
  HostEnvironmentReport,
  SaveRoot, MigrationPlan, SaveCheckpoint, OperationLogEntry,
  FrontendInfo,
  FormatRule, FormatCheckResult, EmulatorMatrixEntry,
} from "@/types";

// ── Project ───────────────────────────────────────────────────────────────────

export const ipc = {
  // Projects
  createProject:    (req: CreateProjectRequest)       => invoke<Project>("create_project", { req }),
  openProject:      (id: string)                      => invoke<Project>("open_project", { id }),
  listProjects:     ()                                => invoke<Project[]>("list_projects"),
  getProject:       (id: string)                      => invoke<Project>("get_project", { id }),

  // Scan
  scanLibrary:      (projectId: string, roots: string[]) =>
                      invoke<void>("scan_library", { projectId, roots }),
  getScanStatus:    (projectId: string)               => invoke<{ isRunning: boolean; projectId: string }>("get_scan_status", { projectId }),
  cancelScan:       ()                                => invoke<void>("cancel_scan"),

  // Host environment
  checkHostEnv:     ()                                => invoke<HostEnvironmentReport>("check_host_environment"),

  // BIOS
  validateBios:     (system: string, biosRoot: string, frontend: string, emulator: string) =>
                      invoke<BiosSystemResult>("validate_bios", { system, biosRoot, frontend, emulator }),
  getBiosRules:     (system: string)                  => invoke<BiosRule[]>("get_bios_rules", { system }),
  getBiosStatus:  (projectId: string) =>
                  invoke<BiosStatusResponse>("get_bios_status", { projectId }),
  revalidateBios: (projectId: string) =>
                  invoke<BiosStatusResponse>("revalidate_bios", { projectId }),
  setBiosRoot:    (projectId: string, biosRoot: string | null) =>
                  invoke<void>("set_bios_root", { projectId, biosRoot }),

  // Format
  checkFormat:       (path: string, system: string, emulator: string, frontend: string) =>
                       invoke<FormatCheckResult>("check_format_compatibility", { path, system, emulator, frontend }),
  getFormatMatrix:   ()                                => invoke<FormatRule[]>("get_format_matrix"),
  getEmulatorMatrix: ()                                => invoke<EmulatorMatrixEntry[]>("get_emulator_matrix"),

  // Save migration
  discoverSaveRoots:    (frontendRoot: string)                                                     => invoke<SaveRoot[]>("discover_save_roots", { frontendRoot }),
  checkMigrationNeeded: (frontendRoot: string)                                                     => invoke<boolean>("check_migration_needed", { frontendRoot }),
  createMigrationPlan:  (projectId: string, source: string, destination: string, emulator: string) => invoke<MigrationPlan>("create_migration_plan", { projectId, source, destination, emulator }),
  createSaveCheckpoint: (projectId: string, source: string, emulator: string)                      => invoke<SaveCheckpoint>("create_save_checkpoint", { projectId, source, emulator }),
  getCheckpoints:       (projectId: string)                                                        => invoke<SaveCheckpoint[]>("get_checkpoints", { projectId }),

  // Multi-disc
  detectMultiDisc:  (root: string)                    => invoke("detect_multidisc_sets", { root }),
  generateM3u:      (set: unknown, outputDir: string, frontend: string) =>
                      invoke<string>("generate_m3u", { set, outputDir, frontend }),

  // ScummVM
  detectScummvm:    (root: string)                    => invoke("detect_scummvm_games", { root }),
  generatePointers: (games: unknown[], frontend: string) =>
                      invoke<string[]>("generate_pointer_files", { games, frontend }),

  // Installed titles
  validateInstalled:       (titles: unknown[])        => invoke("validate_installed_titles", { titles }),
  validateShortcutContent: (command: string)          => invoke("validate_shortcut_content", { command }),
  generateShortcuts:       (titles: unknown[], frontend: string) =>
                             invoke<string[]>("generate_shortcuts", { titles, frontend }),

  // Export
  getSupportedFrontends: ()                           => invoke<FrontendInfo[]>("get_supported_frontends"),
  planExport:            (projectId: string, frontend: string) =>
                           invoke("plan_export", { projectId, frontend }),
  executeExport:         (plan: unknown)              => invoke<void>("execute_export", { plan }),
  dryRunExport:          (projectId: string, frontend: string) =>
                           invoke("dry_run_export", { projectId, frontend }),

  // Rollback
  getOperationLog:  (projectId: string)               => invoke<OperationLogEntry[]>("get_operation_log", { projectId }),
  rollback:         (operationId: string)             => invoke<void>("rollback_operation", { operationId }),
};
