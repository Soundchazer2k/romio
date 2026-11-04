// SPDX-License-Identifier: GPL-3.0
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type {
  BiosEntryResult, BiosValidationState, FindingSeverity, SaveMigrationState,
  FormatCompatibilityState, FormatSupport, FormatCheckResult, FormatSystemGroup,
} from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Frontend roms/ folder names that differ from Romio's system IDs.
// Sources: ES-DE es_systems.xml, RetroBat es_systems.cfg, Batocera es_systems.yml.
const FOLDER_ALIASES: Record<string, string> = {
  psx: "ps1",
  gc: "gamecube",
  n3ds: "3ds",
  megadrive: "genesis", megadrivejp: "genesis",
  megacd: "segacd", megacdjp: "segacd",
  sega32xjp: "sega32x", sega32xna: "sega32x",
  saturnjp: "saturn",
  sfc: "snes", snesna: "snes",
  famicom: "nes",
  pcenginecd: "tg16cd", "tg-cd": "tg16cd",
  amiga500: "amiga", amiga1200: "amiga",
  mame: "arcade",
  atarijaguar: "jaguar",
  tg16: "pcengine",
  neogeocdjp: "neogeocd",
  naomigd: "naomi",
  doom: "gzdoom",
};

/** Romio system ID for a frontend's roms/ folder name */
export function systemForFolder(folder: string): string {
  const name = folder.toLowerCase();
  // Own keys only: a folder named "constructor" must not resolve to Object.prototype.constructor
  return Object.prototype.hasOwnProperty.call(FOLDER_ALIASES, name) ? FOLDER_ALIASES[name] : name;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function biosStateColor(state: BiosValidationState): string {
  switch (state) {
    case "PRESENT_VALID":         return "text-romio-green";
    case "PRESENT_WRONG_PATH":    return "text-amber-500";
    case "PRESENT_HASH_MISMATCH": return "text-romio-red";
    case "MISSING_REQUIRED":      return "text-romio-red";
    case "MISSING_OPTIONAL":      return "text-romio-gray";
    case "NOT_APPLICABLE":        return "text-romio-gray";
  }
}

export function biosStateBg(state: BiosValidationState): string {
  switch (state) {
    case "PRESENT_VALID":         return "bg-romio-green/10";
    case "PRESENT_WRONG_PATH":    return "bg-amber-500/10";
    case "PRESENT_HASH_MISMATCH": return "bg-romio-red/10";
    case "MISSING_REQUIRED":      return "bg-romio-red/10";
    case "MISSING_OPTIONAL":      return "bg-romio-gray/10";
    case "NOT_APPLICABLE":        return "";
  }
}

export function biosStateLabel(state: BiosValidationState): string {
  switch (state) {
    case "PRESENT_VALID":         return "Valid";
    case "PRESENT_WRONG_PATH":    return "Wrong path";
    case "PRESENT_HASH_MISMATCH": return "Hash mismatch";
    case "MISSING_REQUIRED":      return "Missing — required";
    case "MISSING_OPTIONAL":      return "Missing — optional";
    case "NOT_APPLICABLE":        return "Not applicable";
  }
}

/** A regional file that isn't needed once another region is complete says so plainly */
export function biosEntryLabel(entry: BiosEntryResult): string {
  if (entry.state === "MISSING_OPTIONAL" && entry.rule.region && entry.rule.requirement === "required") {
    return `Missing — needed for ${entry.rule.region} games`;
  }
  return biosStateLabel(entry.state);
}

/** Summary for entries that aren't blocking but aren't all fine; null when nothing is wrong */
export function biosIssueLabel(entries: BiosEntryResult[]): string | null {
  const toCheck = entries.filter((e) =>
    e.state === "PRESENT_HASH_MISMATCH" || e.state === "PRESENT_WRONG_PATH").length;
  const missing = entries.filter((e) =>
    e.state === "MISSING_REQUIRED" || e.state === "MISSING_OPTIONAL").length;
  if (toCheck > 0) return `${toCheck} to check`;
  if (missing > 0) return `${missing} missing`;
  return null;
}

export function severityColor(severity: FindingSeverity): string {
  switch (severity) {
    case "blocking": return "text-romio-red";
    case "error":    return "text-romio-red";
    case "warning":  return "text-amber-500";
    case "advisory": return "text-romio-gray";
    case "info":     return "text-blue-400";
  }
}

export function migrationStateLabel(state: SaveMigrationState): string {
  switch (state) {
    case "migration_needed":   return "Migration needed";
    case "conflict_detected":  return "Conflict — saves at both paths";
    case "already_migrated":   return "Already migrated";
    case "not_applicable":     return "No migration rule";
    case "unreadable":         return "Can't read";
  }
}

export function truncatePath(path: string, maxLen = 60): string {
  if (path.length <= maxLen) return path;
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep);
  if (parts.length <= 2) return "…" + sep + parts[parts.length - 1];
  return "…" + sep + parts.slice(-2).join(sep);
}

// ── Format state helpers ───────────────────────────────────────────────────────

export function formatStateColor(state: FormatCompatibilityState): string {
  switch (state) {
    case "Compatible":         return "text-romio-green";
    case "FormatDeprecated":   return "text-amber-400";
    case "FormatIncompatible": return "text-romio-red";
    case "Unknown":            return "text-romio-gray";
    case "NotApplicable":      return "text-romio-gray";
  }
}

export function formatStateBg(state: FormatCompatibilityState): string {
  switch (state) {
    case "Compatible":         return "bg-romio-green/10";
    case "FormatDeprecated":   return "bg-amber-400/10";
    case "FormatIncompatible": return "bg-romio-red/10";
    case "Unknown":            return "bg-black/10";
    case "NotApplicable":      return "";
  }
}

export function formatStateLabel(state: FormatCompatibilityState): string {
  switch (state) {
    case "Compatible":         return "Compatible";
    case "FormatDeprecated":   return "Deprecated";
    case "FormatIncompatible": return "Incompatible";
    case "Unknown":            return "Unknown";
    case "NotApplicable":      return "N/A";
  }
}

export function formatSupportLabel(support: FormatSupport): string {
  if (support === "supported") return "Supported";
  if ("deprecated"  in support) return `Deprecated → .${support.deprecated.replacement}`;
  if ("unsupported" in support) return "Unsupported";
  if ("conditional" in support) return "Conditional";
  return "Unknown";
}

export function groupResultsBySystem(results: FormatCheckResult[]): FormatSystemGroup[] {
  const map = new Map<string, FormatCheckResult[]>();
  for (const r of results) {
    const key = r.system ?? "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries()).map(([system, results]) => ({ system, results }));
}
