// SPDX-License-Identifier: GPL-3.0
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { BiosValidationState, FindingSeverity, SaveMigrationState } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
    case "NOT_APPLICABLE":        return "text-romio-gray opacity-50";
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
    case "NOT_APPLICABLE":        return "N/A";
  }
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
  }
}

export function truncatePath(path: string, maxLen = 60): string {
  if (path.length <= maxLen) return path;
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep);
  if (parts.length <= 2) return "…" + sep + parts[parts.length - 1];
  return "…" + sep + parts.slice(-2).join(sep);
}
