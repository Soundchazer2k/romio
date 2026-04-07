// SPDX-License-Identifier: GPL-3.0
// TypeScript types mirroring the Rust models.
// These must stay in sync with src-tauri/src/models/

// ── Artifact ─────────────────────────────────────────────────────────────────

export type ArtifactType =
  | "rom" | "bios" | "firmware_installer" | "multi_disc_component"
  | "m3u" | "scummvm_dir" | "scummvm_pointer" | "installed_title"
  | "shortcut" | "wrapper" | "save_root" | "helper" | "unknown";

export type BiosValidationState =
  | "PRESENT_VALID" | "PRESENT_WRONG_PATH" | "PRESENT_HASH_MISMATCH"
  | "MISSING_REQUIRED" | "MISSING_OPTIONAL" | "NOT_APPLICABLE";

export type FormatCompatibilityState =
  | "Compatible" | "FormatIncompatible" | "FormatDeprecated" | "Unknown" | "NotApplicable";

export type ScanVisibility = "visible" | "hidden" | "helper_only" | "export_only";
export type ExportStatus   = "not_exported" | "pending" | "exported" | "stale" | "error";

export type FindingSeverity = "blocking" | "error" | "warning" | "advisory" | "info";

export interface ValidationFinding {
  severity:          FindingSeverity;
  issueType:         string;
  description:       string;
  recommendedAction?: string;
  autoFixable:       boolean;
}

export interface Artifact {
  id:                   string;
  artifactType:         ArtifactType;
  sourcePath:           string;
  normalizedPath:       string;
  md5Hash?:             string;
  fileSize?:            number;
  detectedSystem?:      string;
  detectedFormat?:      string;
  biosState:            BiosValidationState;
  formatState:          FormatCompatibilityState;
  frontendTags:         string[];
  scanVisibility:       ScanVisibility;
  titleId?:             string;
  exportStatus:         ExportStatus;
  validationFindings:   ValidationFinding[];
  notes?:               string;
  scannedAt:            string;
}

// ── BIOS ──────────────────────────────────────────────────────────────────────

export type BiosRequirement = "required" | "optional" | "keys_crypto" | "not_required";

export interface BadDumpEntry { md5: string; label: string; }

export interface BiosRule {
  filename:          string;
  knownGoodMd5:      string[];
  knownBadMd5:       BadDumpEntry[];
  system:            string;
  region?:           string;
  requirement:       BiosRequirement;
  compressed:        boolean;
  defaultPath:       string;
  frontendPaths:     Record<string, string>;
  emulatorPaths:     Record<string, string>;
  notes?:            string;
  dumpingGuideUrl?:  string;
}

export interface BiosEntryResult {
  rule:           BiosRule;
  foundPath?:     string;
  foundMd5?:      string;
  state:          BiosValidationState;
  renameFrom?:    string;
  badDumpLabel?:  string;
}

export interface BiosSystemResult {
  system:   string;
  entries:  BiosEntryResult[];
  blocking: boolean;
  errored:  boolean;
}

// ── Project ───────────────────────────────────────────────────────────────────

export interface ScanStats {
  totalFiles:     number;
  classified:     number;
  blockingIssues: number;
  errors:         number;
  warnings:       number;
  advisories:     number;
}

export interface Project {
  id:               string;
  name:             string;
  libraryRoots:     string[];
  targetFrontends:  string[];
  emulatorPrefs:    Record<string, string>;
  createdAt:        string;
  lastScannedAt?:   string;
  scanStats?:       ScanStats;
  biosRoot?:            string;
  biosResults?:         BiosSystemResult[];
  biosLastValidatedAt?: string;
}

export interface BiosStatusResponse {
  configured:       boolean;
  validated:        boolean;
  results:          BiosSystemResult[];
  lastValidatedAt?: string;
}

export interface CreateProjectRequest {
  name:             string;
  libraryRoots:     string[];
  targetFrontends:  string[];
}

// ── Host Environment ──────────────────────────────────────────────────────────

export type DependencyState =
  | "present" | "present_wrong_version" | "missing" | "not_applicable" | "skipped";

export interface Remediation {
  description:  string;
  url?:         string;
  autoFixable:  boolean;
}

export interface DependencyCheck {
  id:                 string;
  name:               string;
  description:        string;
  affectedEmulators:  string[];
  state:              DependencyState;
  detectedVersion?:   string;
  minimumVersion?:    string;
  remediation?:       Remediation;
}

export interface HostEnvironmentReport {
  platform:       string;
  checks:         DependencyCheck[];
  allPass:        boolean;
  blockingCount:  number;
}

// ── Save Migration ────────────────────────────────────────────────────────────

export type SaveMigrationState =
  | "migration_needed" | "conflict_detected" | "already_migrated" | "not_applicable";

export interface SaveRoot {
  path:                 string;
  emulator:             string;
  isSymlink:            boolean;
  realPath?:            string;
  fileCount:            number;
  sizeBytes:            number;
  migrationState:       SaveMigrationState;
  expectedDestination?: string;
}

export type MigrationAction =
  | "create_checkpoint" | "copy_files" | "move_files" | "update_config" | "verify_destination";

export interface MigrationStep {
  order:       number;
  action:      MigrationAction;
  description: string;
  reversible:  boolean;
}

export interface MigrationPlan {
  sourcePath:      string;
  destinationPath: string;
  fileCount:       number;
  sizeBytes:       number;
  emulator:        string;
  requiresBackup:  boolean;
  symlinkWarning?: string;
  steps:           MigrationStep[];
}

export interface SaveCheckpoint {
  id:          string;
  projectId:   string;
  emulator:    string;
  sourcePath:  string;
  archivePath: string;
  createdAt:   string;
  fileCount:   number;
  sizeBytes:   number;
}

export type MigrationBlocker =
  | "no_active_project"
  | "checkpoint_required"
  | "plan_required"
  | "conflict_detected";

export interface OperationLogEntry {
  id:             string;
  projectId:      string;
  operation:      string;
  description:    string;
  affectedPaths:  string[];
  reversible:     boolean;
  rolledBack:     boolean;
  createdAt:      string;
}

// ── Scan ──────────────────────────────────────────────────────────────────────

export type ScanPhase = "enumerating" | "hashing" | "classifying" | "complete";

export interface ScanProgress {
  filesScanned: number;
  filesTotal?:  number;
  currentPath:  string;
  phase:        ScanPhase;
}

// ── Romio mascot states ───────────────────────────────────────────────────────

export type RomioState =
  | "welcome"       // First launch / onboarding
  | "tutorial"      // Guided workflow / tips
  | "idle"          // No project open / waiting (sleeping)
  | "working"       // Repair operations running (wrench)
  | "processing"    // Scan / hash in progress (loading dots)
  | "pondering"     // Analysis running (chin stroke)
  | "announcement"  // Important warning / update (exclamation)
  | "concerned"     // BIOS missing / preflight failure (wide eyes)
  | "confused"      // Ambiguous results / needs input (spiral eyes)
  | "difficult_save" // Save migration warning (facepalm + floppy)
  | "error"         // Critical failure / save data at risk (cracked, crying)
  | "success"       // Validation passed (peace sign)
  | "accomplished"; // Library fully clean (sunglasses)

// ── Frontend info ─────────────────────────────────────────────────────────────

export interface FrontendInfo {
  id:   string;
  name: string;
  tier: number;
}

// ── Format compatibility ──────────────────────────────────────────────────────

export type FormatSupport =
  | "supported"
  | { deprecated:   { replacement: string } }
  | { unsupported:  { reason: string } }
  | { conditional:  { condition: string } };

export type FormatFixType = "rename" | "convert" | "redump";

export interface FormatRule {
  system:       string;
  extension:    string;
  emulator:     string;
  frontend?:    string | null;
  support:      FormatSupport;
  notes?:       string;
  sinceVersion?: string | null;
}

export interface FormatFixAction {
  actionType:   FormatFixType;
  description:  string;
  safe:         boolean;
  newFilename?: string;
}

export interface FormatCheckResult {
  path:       string;
  extension:  string;
  system?:    string;
  emulator?:  string;
  state:      FormatCompatibilityState;
  notes?:     string;
  fixAction?: FormatFixAction;
}

// Client-side only — not from Rust
export interface FormatSystemGroup {
  system:  string;
  results: FormatCheckResult[];
}

export interface StagedFix {
  result: FormatCheckResult;
  fix:    FormatFixAction;
}

// ── Emulator matrix ────────────────────────────────────────────────────────────

export interface EmulatorMatrixEntry {
  system:       string;
  recommended:  string;
  alternatives: string[];
  status:       string;
  biosRequired: boolean;
  notes?:       string | null;
}
