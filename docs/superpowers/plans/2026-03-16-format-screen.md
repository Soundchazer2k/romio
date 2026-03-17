# Format Screen Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Format Compatibility screen — an active ROM library scanner that surfaces format incompatibilities grouped by system, with a staged fix plan and a reference drawer.

**Architecture:** FormatScreen owns all local state (no new Zustand store). The scan walks the library directory using `@tauri-apps/plugin-fs`, infers system from folder names, looks up the recommended emulator per system from the emulator matrix IPC, then calls `checkFormatCompatibility` per file. Results are grouped client-side. Fixes are staged into a local list; the fix tray and plan modal appear when fixes are staged. Nothing is written to disk (execution is stubbed).

**Tech Stack:** React 18, TypeScript, Framer Motion, Lucide icons, @tanstack/react-query, @tauri-apps/plugin-fs, Vitest (for logic unit tests).

**Spec:** `docs/specs/format-screen.md`

---

## Chunk 1: Foundation — Types, IPC, Rust command, Utils

### Task 1: Add Rust `get_emulator_matrix` command

The frontend needs to know the recommended emulator per system for "auto" mode during scanning. The data is already in `src-tauri/data/emulator_matrix.json`. We add a thin Rust command to expose it.

**Files:**
- Create: `src-tauri/src/models/emulator.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/emulator.rs`
- Modify: `src-tauri/src/lib.rs` (register command)
- Modify: `src-tauri/src/db/mod.rs` or create `src-tauri/src/db/emulator.rs`

- [ ] **Step 1: Create the Rust model**

Add to `src-tauri/src/models/emulator.rs`:

```rust
// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorMatrixEntry {
    pub system:       String,
    pub recommended:  String,
    pub alternatives: Vec<String>,
    pub status:       String,
    pub bios_required: bool,
    pub notes:        Option<String>,
}
```

- [ ] **Step 2: Register the model in `src-tauri/src/models/mod.rs`**

```rust
pub mod emulator;
```

- [ ] **Step 3: Create the DB loader at `src-tauri/src/db/emulator.rs`**

```rust
// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use crate::models::emulator::EmulatorMatrixEntry;

const EMULATOR_DATA: &str = include_str!("../../data/emulator_matrix.json");

pub fn load_emulator_matrix() -> Result<Vec<EmulatorMatrixEntry>> {
    Ok(serde_json::from_str(EMULATOR_DATA)?)
}
```

- [ ] **Step 4: Register in `src-tauri/src/db/mod.rs`**

The current `src-tauri/src/db/mod.rs` has these module declarations at the top:
```
pub mod projects;
pub mod bios;
pub mod format;
pub mod save;
```
Add one line after `pub mod save;`:
```rust
pub mod emulator;
```

- [ ] **Step 5: Create `src-tauri/src/commands/emulator.rs`**

```rust
// SPDX-License-Identifier: GPL-3.0
use crate::models::emulator::EmulatorMatrixEntry;

#[tauri::command]
pub async fn get_emulator_matrix() -> Result<Vec<EmulatorMatrixEntry>, String> {
    crate::db::emulator::load_emulator_matrix().map_err(|e| e.to_string())
}
```

- [ ] **Step 6: Register in `src-tauri/src/commands/mod.rs`**

Add `pub mod emulator;` to the commands mod declarations.

- [ ] **Step 7: Register the command in `src-tauri/src/lib.rs`**

Find the `.invoke_handler(tauri::generate_handler![...])` call and add `commands::emulator::get_emulator_matrix`.

- [ ] **Step 8: Verify it compiles**

```bash
cargo check
```

Expected: warnings only (existing unused import warnings), no errors.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/models/emulator.rs src-tauri/src/commands/emulator.rs src-tauri/src/db/emulator.rs src-tauri/src/models/mod.rs src-tauri/src/commands/mod.rs src-tauri/src/db/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add get_emulator_matrix IPC command"
```

---

### Task 2: Add TypeScript types

**Files:**
- Modify: `src/types/index.ts`

The Rust models use `serde(rename_all = "camelCase")` so all fields arrive camelCase. `FormatSupport` is a tagged enum — Rust serializes as `"supported"` (string) or `{ "deprecated": { "replacement": "..." } }` etc.

- [ ] **Step 1: Add types to `src/types/index.ts`**

Add after the existing `// ── Frontend info ───` section:

```typescript
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
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add format screen and emulator matrix types"
```

---

### Task 3: Fix IPC return types and add `getEmulatorMatrix`

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Update the import block in `src/lib/ipc.ts`**

Add the new types to the import:

```typescript
import type {
  Project, CreateProjectRequest,
  BiosSystemResult, BiosRule,
  HostEnvironmentReport,
  SaveRoot, MigrationPlan, SaveCheckpoint,
  FrontendInfo,
  FormatRule, FormatCheckResult, EmulatorMatrixEntry,
} from "@/types";
```

- [ ] **Step 2: Fix the format IPC entries**

Replace the existing untyped format calls:

```typescript
  // Format
  checkFormat:       (path: string, system: string, emulator: string, frontend: string) =>
                       invoke<FormatCheckResult>("check_format_compatibility", { path, system, emulator, frontend }),
  getFormatMatrix:   ()                                => invoke<FormatRule[]>("get_format_matrix"),
  getEmulatorMatrix: ()                                => invoke<EmulatorMatrixEntry[]>("get_emulator_matrix"),
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat(ipc): add typed format and emulator matrix calls"
```

---

### Task 4: Add format utility functions

**Files:**
- Modify: `src/lib/utils.ts`
- Create: `src/lib/utils.test.ts`

The format state helpers mirror the existing `biosState*` helpers. Write tests first.

- [ ] **Step 1: Set up vitest config**

Create `vitest.config.ts` in the project root:

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2: Write failing tests at `src/lib/utils.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import {
  formatStateColor,
  formatStateBg,
  formatStateLabel,
  formatSupportLabel,
  groupResultsBySystem,
} from "./utils";
import type { FormatCheckResult, FormatSystemGroup } from "@/types";

describe("formatStateColor", () => {
  it("returns green for Compatible", () =>
    expect(formatStateColor("Compatible")).toBe("text-romio-green"));
  it("returns amber for FormatDeprecated", () =>
    expect(formatStateColor("FormatDeprecated")).toBe("text-amber-400"));
  it("returns red for FormatIncompatible", () =>
    expect(formatStateColor("FormatIncompatible")).toBe("text-romio-red"));
  it("returns gray for Unknown", () =>
    expect(formatStateColor("Unknown")).toBe("text-romio-gray"));
  it("returns muted for NotApplicable", () =>
    expect(formatStateColor("NotApplicable")).toBe("text-romio-gray opacity-50"));
});

describe("formatStateBg", () => {
  it("returns green bg for Compatible", () =>
    expect(formatStateBg("Compatible")).toBe("bg-romio-green/10"));
  it("returns amber bg for FormatDeprecated", () =>
    expect(formatStateBg("FormatDeprecated")).toBe("bg-amber-400/10"));
  it("returns red bg for FormatIncompatible", () =>
    expect(formatStateBg("FormatIncompatible")).toBe("bg-romio-red/10"));
  it("returns empty for NotApplicable", () =>
    expect(formatStateBg("NotApplicable")).toBe(""));
});

describe("formatStateLabel", () => {
  it("labels Compatible", () => expect(formatStateLabel("Compatible")).toBe("Compatible"));
  it("labels FormatDeprecated", () => expect(formatStateLabel("FormatDeprecated")).toBe("Deprecated"));
  it("labels FormatIncompatible", () => expect(formatStateLabel("FormatIncompatible")).toBe("Incompatible"));
  it("labels Unknown", () => expect(formatStateLabel("Unknown")).toBe("Unknown"));
  it("labels NotApplicable", () => expect(formatStateLabel("NotApplicable")).toBe("N/A"));
});

describe("formatSupportLabel", () => {
  it("labels string supported", () =>
    expect(formatSupportLabel("supported")).toBe("Supported"));
  it("labels deprecated with replacement", () =>
    expect(formatSupportLabel({ deprecated: { replacement: "hypseus" } }))
      .toBe("Deprecated → .hypseus"));
  it("labels unsupported", () =>
    expect(formatSupportLabel({ unsupported: { reason: "No .rvz support" } }))
      .toBe("Unsupported"));
  it("labels conditional", () =>
    expect(formatSupportLabel({ conditional: { condition: "Requires BIOS" } }))
      .toBe("Conditional"));
});

describe("groupResultsBySystem", () => {
  it("groups results by system field", () => {
    const results: FormatCheckResult[] = [
      { path: "/a.rvz",    extension: "rvz",    system: "gamecube", emulator: "dolphin",  state: "Compatible" },
      { path: "/b.daphne", extension: "daphne", system: "daphne",   emulator: "hypseus",  state: "FormatDeprecated" },
      { path: "/c.rvz",    extension: "rvz",    system: "gamecube", emulator: "lr-dolphin", state: "FormatIncompatible" },
    ];
    const groups = groupResultsBySystem(results);
    expect(groups).toHaveLength(2);
    const gc = groups.find((g) => g.system === "gamecube")!;
    expect(gc.results).toHaveLength(2);
    const da = groups.find((g) => g.system === "daphne")!;
    expect(da.results).toHaveLength(1);
  });

  it("uses 'unknown' for results with no system", () => {
    const results: FormatCheckResult[] = [
      { path: "/a.bin", extension: "bin", state: "Unknown" },
    ];
    const groups = groupResultsBySystem(results);
    expect(groups[0].system).toBe("unknown");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm test
```

Expected: multiple failures — functions not yet defined.

- [ ] **Step 4: Update the import line at the top of `src/lib/utils.ts`**

The existing import is:
```typescript
import type { BiosValidationState, FindingSeverity, SaveMigrationState } from "@/types";
```
Replace it with:
```typescript
import type {
  BiosValidationState, FindingSeverity, SaveMigrationState,
  FormatCompatibilityState, FormatSupport, FormatCheckResult, FormatSystemGroup,
} from "@/types";
```

- [ ] **Step 5: Implement the utility functions in `src/lib/utils.ts`**

Add after the existing `migrationStateLabel` function (note: `FormatCompatibilityState` is already defined in `src/types/index.ts` at line 16 — do not add it again):

```typescript
// (no import needed here — types were added to the import block in Step 4)

export function formatStateColor(state: FormatCompatibilityState): string {
  switch (state) {
    case "Compatible":         return "text-romio-green";
    case "FormatDeprecated":   return "text-amber-400";
    case "FormatIncompatible": return "text-romio-red";
    case "Unknown":            return "text-romio-gray";
    case "NotApplicable":      return "text-romio-gray opacity-50";
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
```

Note: the import for `FormatCompatibilityState` etc. must be added to the existing import line at the top of `utils.ts`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts vitest.config.ts
git commit -m "feat(utils): add format state helpers and groupResultsBySystem with tests"
```

---

## Chunk 2: Components

### Task 5: `FormatConfigBar`

The config row with library path input, Browse button, frontend/emulator selects, and Scan button.

**Files:**
- Create: `src/components/format/FormatConfigBar.tsx`

- [ ] **Step 1: Create the component**

```typescript
// SPDX-License-Identifier: GPL-3.0
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import type { EmulatorMatrixEntry } from "@/types";
import { useAppStore } from "@/stores";

interface Props {
  path:        string;
  frontend:    string;
  emulator:    string;           // "auto" or specific emulator id
  emulatorMatrix: EmulatorMatrixEntry[];
  isScanning:  boolean;
  onPathChange:     (v: string) => void;
  onFrontendChange: (v: string) => void;
  onEmulatorChange: (v: string) => void;
  onScan:      () => void;
}

export function FormatConfigBar({
  path, frontend, emulator, emulatorMatrix,
  isScanning, onPathChange, onFrontendChange, onEmulatorChange, onScan,
}: Props) {
  const { activeProject } = useAppStore();

  async function browse() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") onPathChange(selected);
  }

  // Collect all unique emulators from the matrix for the dropdown
  const emulators = ["auto", ...Array.from(
    new Set(emulatorMatrix.flatMap((e) => [e.recommended, ...e.alternatives]))
  ).sort()];

  const frontends = activeProject?.targetFrontends ?? ["esde"];

  return (
    <div className="flex gap-3 flex-wrap items-end">
      {/* Library path */}
      <div className="flex-1 min-w-48 space-y-1">
        <label className="text-xs text-romio-gray uppercase tracking-wider">Library root</label>
        <div className="flex gap-2">
          <input
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder="/path/to/roms"
            className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-border
                       text-sm font-mono text-romio-cream placeholder:text-romio-gray/40
                       focus:outline-none focus:border-romio-green/40"
          />
          <button
            onClick={browse}
            className="px-3 py-2 rounded-lg bg-black/30 border border-border
                       text-romio-gray hover:text-romio-cream hover:bg-white/5 transition-colors"
            title="Browse"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Frontend select */}
      <div className="space-y-1">
        <label className="text-xs text-romio-gray uppercase tracking-wider">Frontend</label>
        <select
          value={frontend}
          onChange={(e) => onFrontendChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-black/30 border border-border text-sm
                     text-romio-cream focus:outline-none focus:border-romio-green/40"
        >
          {frontends.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Emulator select */}
      <div className="space-y-1">
        <label className="text-xs text-romio-gray uppercase tracking-wider">Emulator</label>
        <select
          value={emulator}
          onChange={(e) => onEmulatorChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-black/30 border border-border text-sm
                     text-romio-cream focus:outline-none focus:border-romio-green/40"
        >
          {emulators.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      {/* Scan button */}
      <button
        onClick={onScan}
        disabled={!path || isScanning}
        className="px-4 py-2 rounded-lg bg-romio-green text-romio-dark text-sm font-semibold
                   hover:bg-romio-green/90 disabled:opacity-40 disabled:cursor-not-allowed
                   transition-colors flex items-center gap-2"
      >
        {isScanning
          ? <><div className="w-3 h-3 border-2 border-romio-dark/40 border-t-romio-dark
                               rounded-full animate-spin" /> Scanning…</>
          : "Scan ▶"
        }
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/format/FormatConfigBar.tsx
git commit -m "feat(format): add FormatConfigBar component"
```

---

### Task 6: `FormatImpactTable`

The expandable cross-emulator grid shown inside a file row when the user clicks "Impact".

**Files:**
- Create: `src/components/format/FormatImpactTable.tsx`

- [ ] **Step 1: Create the component**

```typescript
// SPDX-License-Identifier: GPL-3.0
import { Check, X, AlertTriangle, HelpCircle } from "lucide-react";
import { motion } from "framer-motion";
import type { FormatRule, FormatSupport } from "@/types";
import { formatSupportLabel } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Props {
  extension: string;
  system:    string;
  rules:     FormatRule[];  // the full matrix, filtered here
}

export function FormatImpactTable({ extension, system, rules }: Props) {
  // Filter rules to this extension + system combination
  const relevant = rules.filter(
    (r) => r.extension === extension && r.system === system
  );

  if (relevant.length === 0) {
    return (
      <p className="text-xs text-romio-gray/60 italic mt-2">
        No cross-emulator rules found for .{extension} on {system}.
      </p>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-2 overflow-hidden"
    >
      <p className="text-xs text-romio-gray uppercase tracking-wider mb-1.5">
        Impact across emulators
      </p>
      <div className="space-y-1">
        {relevant.map((rule, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-2.5 py-1.5 rounded-lg bg-black/20
                       border border-border text-xs"
          >
            <SupportIcon support={rule.support} />
            <span className="font-mono text-romio-cream flex-1">{rule.emulator}</span>
            {rule.frontend && (
              <span className="text-romio-gray border border-border px-1 rounded text-[10px]">
                {rule.frontend}
              </span>
            )}
            <span className={cn(
              "text-xs",
              rule.support === "supported" ? "text-romio-green" :
              "deprecated" in rule.support  ? "text-amber-400" :
              "unsupported" in rule.support  ? "text-romio-red" :
              "text-romio-gray"
            )}>
              {formatSupportLabel(rule.support)}
            </span>
          </div>
        ))}
      </div>
      {relevant.some((r) => "deprecated" in r.support || "unsupported" in r.support) && (
        <p className="text-[10px] text-romio-gray/60 mt-1.5">
          A fix for one emulator may break compatibility with another. Review before staging.
        </p>
      )}
    </motion.div>
  );
}

function SupportIcon({ support }: { support: FormatSupport }) {
  if (support === "supported")          return <Check       className="w-3 h-3 text-romio-green flex-shrink-0" />;
  if ("deprecated"  in support)         return <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />;
  if ("unsupported" in support)         return <X           className="w-3 h-3 text-romio-red flex-shrink-0" />;
  return                                       <HelpCircle  className="w-3 h-3 text-romio-gray flex-shrink-0" />;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/format/FormatImpactTable.tsx
git commit -m "feat(format): add FormatImpactTable component"
```

---

### Task 7: `FormatFileRow`

Individual file result row with state badge, fix suggestion, and expandable impact table.

**Files:**
- Create: `src/components/format/FormatFileRow.tsx`

- [ ] **Step 1: Create the component**

```typescript
// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import type { FormatCheckResult, FormatRule, StagedFix } from "@/types";
import { cn, formatStateColor, formatStateBg, formatStateLabel, truncatePath } from "@/lib/utils";
import { FormatImpactTable } from "./FormatImpactTable";

interface Props {
  result:       FormatCheckResult;
  rules:        FormatRule[];
  stagedFixes:  StagedFix[];
  onStageFix:   (fix: StagedFix) => void;
}

export function FormatFileRow({ result, rules, stagedFixes, onStageFix }: Props) {
  const [impactOpen, setImpactOpen] = useState(false);

  const hasIssue   = result.state !== "Compatible" && result.state !== "NotApplicable";
  const alreadyStaged = stagedFixes.some((s) => s.result.path === result.path);

  return (
    <div className={cn(
      "px-3 py-2.5 rounded-lg border text-sm",
      formatStateBg(result.state),
      result.state === "Compatible"         ? "border-romio-green/10" :
      result.state === "FormatIncompatible" ? "border-romio-red/20"   :
      result.state === "FormatDeprecated"   ? "border-amber-400/20"   :
      "border-border"
    )}>
      {/* Main row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-mono text-xs font-medium", formatStateColor(result.state))}>
              {result.path.split(/[/\\]/).pop()}
            </span>
            <span className={cn("text-xs", formatStateColor(result.state))}>
              {formatStateLabel(result.state)}
            </span>
            {result.fixAction && (
              <span className="text-xs text-romio-gray">
                .{result.extension} → {result.fixAction.newFilename ?? result.fixAction.description}
              </span>
            )}
          </div>

          {result.notes && (
            <p className="text-xs text-romio-gray/70 mt-0.5">{result.notes}</p>
          )}

          {truncatePath(result.path) !== result.path.split(/[/\\]/).pop() && (
            <p className="font-mono text-xs text-romio-gray/50 mt-0.5 truncate">
              {truncatePath(result.path)}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasIssue && result.fixAction && (
            <button
              onClick={() => onStageFix({ result, fix: result.fixAction! })}
              disabled={alreadyStaged}
              title={alreadyStaged ? "Already staged" : "Stage this fix"}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors",
                alreadyStaged
                  ? "text-romio-gray border-border cursor-default opacity-50"
                  : "text-romio-green border-romio-green/30 bg-romio-green/10 hover:bg-romio-green/20"
              )}
            >
              <Plus className="w-3 h-3" />
              {alreadyStaged ? "Staged" : "Stage fix"}
            </button>
          )}

          {hasIssue && result.system && (
            <button
              onClick={() => setImpactOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-romio-gray hover:text-romio-cream
                         transition-colors"
            >
              {impactOpen
                ? <ChevronDown  className="w-3.5 h-3.5" />
                : <ChevronRight className="w-3.5 h-3.5" />
              }
              Impact
            </button>
          )}
        </div>
      </div>

      {/* Impact table */}
      <AnimatePresence>
        {impactOpen && result.system && (
          <FormatImpactTable
            extension={result.extension}
            system={result.system}
            rules={rules}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/format/FormatFileRow.tsx
git commit -m "feat(format): add FormatFileRow component"
```

---

### Task 8: `FormatSystemRow`

Collapsible system-level row with badge. Mirrors BIOS `SystemRow` pattern exactly.

**Files:**
- Create: `src/components/format/FormatSystemRow.tsx`

- [ ] **Step 1: Create the component**

```typescript
// SPDX-License-Identifier: GPL-3.0
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FormatSystemGroup, FormatRule, StagedFix } from "@/types";
import { cn } from "@/lib/utils";
import { FormatFileRow } from "./FormatFileRow";

interface Props {
  group:       FormatSystemGroup;
  rules:       FormatRule[];
  stagedFixes: StagedFix[];
  expanded:    boolean;
  onToggle:    () => void;
  index:       number;
  onStageFix:  (fix: StagedFix) => void;
}

export function FormatSystemRow({
  group, rules, stagedFixes, expanded, onToggle, index, onStageFix
}: Props) {
  const issueCount = group.results.filter(
    (r) => r.state === "FormatIncompatible" || r.state === "FormatDeprecated"
  ).length;
  const hasRed    = group.results.some((r) => r.state === "FormatIncompatible");
  const hasAmber  = group.results.some((r) => r.state === "FormatDeprecated");
  const allOk     = issueCount === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(
        "rounded-xl border transition-colors overflow-hidden",
        hasRed   ? "border-romio-red/30 bg-romio-red/5" :
        hasAmber ? "border-amber-400/20 bg-amber-400/5" :
        allOk    ? "border-romio-green/20" :
                   "border-border bg-romio-surface/40"
      )}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3
                   hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown  className="w-4 h-4 text-romio-gray flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-romio-gray flex-shrink-0" />
          }
          <div>
            <span className="font-medium text-sm text-romio-cream capitalize">
              {group.system}
            </span>
            <span className="ml-2 text-xs text-romio-gray">
              {group.results.length} {group.results.length === 1 ? "file" : "files"}
            </span>
          </div>
        </div>

        <SystemBadge issueCount={issueCount} hasRed={hasRed} hasAmber={hasAmber} />
      </button>

      {/* Expanded rows */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-3 space-y-2">
              {group.results.map((result) => (
                <FormatFileRow
                  key={result.path}
                  result={result}
                  rules={rules}
                  stagedFixes={stagedFixes}
                  onStageFix={onStageFix}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SystemBadge({ issueCount, hasRed, hasAmber }: {
  issueCount: number; hasRed: boolean; hasAmber: boolean;
}) {
  if (issueCount === 0) {
    return <span className="text-xs font-medium text-romio-green">All OK</span>;
  }
  if (hasRed) {
    return (
      <span className="text-xs font-medium text-romio-red">
        {issueCount} {issueCount === 1 ? "issue" : "issues"}
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-amber-400">
      {issueCount} {issueCount === 1 ? "issue" : "issues"}
    </span>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/format/FormatSystemRow.tsx
git commit -m "feat(format): add FormatSystemRow component"
```

---

## Chunk 3: Fix Plan and Screen Assembly

### Task 9: `FormatFixTray`

Sticky bottom bar that animates up when fixes are staged.

**Files:**
- Create: `src/components/format/FormatFixTray.tsx`

- [ ] **Step 1: Create the component**

```typescript
// SPDX-License-Identifier: GPL-3.0
import { motion } from "framer-motion";
import { Trash2, ArrowRight } from "lucide-react";
import type { StagedFix } from "@/types";

interface Props {
  fixes:           StagedFix[];
  onClear:         () => void;
  onReviewPlan:    () => void;
}

export function FormatFixTray({ fixes, onClear, onReviewPlan }: Props) {
  // Note: parent mounts/unmounts this component — do NOT add a null guard here,
  // as that would prevent AnimatePresence from seeing the exit transition.
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0,  opacity: 1 }}
      exit={{   y: 80, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed bottom-0 left-0 right-0 z-40
                 border-t border-border bg-romio-surface/95 backdrop-blur-sm
                 px-6 py-3 flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm text-romio-cream font-medium">
          {fixes.length} {fixes.length === 1 ? "fix" : "fixes"} staged
        </span>
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-romio-gray hover:text-romio-cream
                     transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </button>
      </div>

      <button
        onClick={onReviewPlan}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                   bg-romio-green text-romio-dark hover:bg-romio-green/90 transition-colors"
      >
        Review plan <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/format/FormatFixTray.tsx
git commit -m "feat(format): add FormatFixTray sticky bottom bar"
```

---

### Task 10: `FormatFixPlanModal`

The review-before-write modal. Lists all staged fixes, shows impact warnings, and has a confirmation checkbox. Execute button shows the "not yet implemented" stub message.

**Files:**
- Create: `src/components/format/FormatFixPlanModal.tsx`

- [ ] **Step 1: Create the component**

```typescript
// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, FileEdit, X } from "lucide-react";
import type { StagedFix } from "@/types";
import { cn, truncatePath } from "@/lib/utils";

interface Props {
  fixes:    StagedFix[];
  onClose:  () => void;
}

export function FormatFixPlanModal({ fixes, onClose }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [executed,  setExecuted]  = useState(false);

  const unsafeFixes  = fixes.filter((f) => !f.fix.safe);
  const hasUnsafe    = unsafeFixes.length > 0;

  function handleExecute() {
    // Stub — execution not yet implemented
    setExecuted(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-romio-surface border border-border rounded-2xl
                   shadow-romio p-6 space-y-5 mx-4 max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileEdit className="w-5 h-5 text-romio-green flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-bold text-romio-cream">Fix Plan</h2>
              <p className="text-xs text-romio-gray mt-0.5">
                Review all changes before applying. Nothing will be written without your confirmation.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-romio-gray hover:text-romio-cream">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fixes list */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {fixes.map((staged, i) => (
            <div key={i}
              className={cn(
                "px-3 py-2.5 rounded-lg border text-xs",
                staged.fix.safe
                  ? "border-romio-green/20 bg-romio-green/5"
                  : "border-amber-400/20 bg-amber-400/5"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-romio-cream truncate">
                    {truncatePath(staged.result.path)}
                  </p>
                  <p className="text-romio-gray mt-0.5">{staged.fix.description}</p>
                </div>
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] border flex-shrink-0",
                  staged.fix.safe
                    ? "text-romio-green border-romio-green/20"
                    : "text-amber-400 border-amber-400/20"
                )}>
                  {staged.fix.actionType}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Unsafe warning */}
        {hasUnsafe && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg
                          bg-amber-600/10 border border-amber-600/20 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              {unsafeFixes.length} {unsafeFixes.length === 1 ? "fix requires" : "fixes require"} re-dumping
              or conversion — these cannot be automatically applied.
            </span>
          </div>
        )}

        {/* "Not yet implemented" notice */}
        {executed && (
          <div className="px-3 py-2.5 rounded-lg bg-black/20 border border-border text-xs text-romio-gray">
            Fix execution is not yet implemented. Your staged plan has been logged.
          </div>
        )}

        {/* Confirmation */}
        {!executed && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 accent-romio-green"
            />
            <span className="text-sm text-romio-cream">
              I have reviewed all changes. I understand rename operations will modify filenames
              in my library.
            </span>
          </label>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-romio-gray
                       border border-border hover:bg-white/5 transition-colors">
            {executed ? "Close" : "Cancel"}
          </button>
          {!executed && (
            <button
              onClick={handleExecute}
              disabled={!confirmed}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold
                         bg-romio-green text-romio-dark hover:bg-romio-green/90
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Apply Fixes
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/format/FormatFixPlanModal.tsx
git commit -m "feat(format): add FormatFixPlanModal with execution stub"
```

---

### Task 11: `FormatReferenceDrawer`

Slide-in panel from the right, opened via the `?` button. Shows the full matrix as a searchable table.

**Files:**
- Create: `src/components/format/FormatReferenceDrawer.tsx`

- [ ] **Step 1: Create the component**

```typescript
// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search } from "lucide-react";
import type { FormatRule } from "@/types";
import { formatSupportLabel, cn } from "@/lib/utils";

const SUPPORT_STATES = [
  { label: "Supported",   desc: "File will work with this emulator as-is." },
  { label: "Deprecated",  desc: "File works but the format has been replaced. Rename recommended." },
  { label: "Unsupported", desc: "File will not work. Re-dump or convert required." },
  { label: "Conditional", desc: "Works only under specific conditions noted in the rule." },
];

interface Props {
  open:    boolean;
  rules:   FormatRule[];
  onClose: () => void;
}

export function FormatReferenceDrawer({ open, rules, onClose }: Props) {
  const [search, setSearch] = useState("");

  const filtered = rules.filter((r) => {
    const q = search.toLowerCase();
    return (
      r.system.includes(q)    ||
      r.extension.includes(q) ||
      r.emulator.includes(q)
    );
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md
                       bg-romio-surface border-l border-border flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-semibold text-romio-cream">Format Rules Reference</h2>
                <p className="text-xs text-romio-gray mt-0.5">
                  Full compatibility matrix — {rules.length} rules loaded
                </p>
              </div>
              <button onClick={onClose} className="text-romio-gray hover:text-romio-cream">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Support state legend */}
            <div className="px-5 py-3 border-b border-border space-y-1.5 bg-black/20">
              <p className="text-xs text-romio-gray uppercase tracking-wider">Support states</p>
              {SUPPORT_STATES.map((s) => (
                <div key={s.label} className="flex gap-2 text-xs">
                  <span className={cn(
                    "font-medium flex-shrink-0 w-20",
                    s.label === "Supported"   ? "text-romio-green" :
                    s.label === "Deprecated"  ? "text-amber-400"   :
                    s.label === "Unsupported" ? "text-romio-red"   :
                    "text-romio-gray"
                  )}>{s.label}</span>
                  <span className="text-romio-gray/70">{s.desc}</span>
                </div>
              ))}
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg
                              bg-black/30 border border-border">
                <Search className="w-3.5 h-3.5 text-romio-gray flex-shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by system, extension, emulator…"
                  className="flex-1 bg-transparent text-sm text-romio-cream
                             placeholder:text-romio-gray/40 focus:outline-none"
                />
              </div>
            </div>

            {/* Rules table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-romio-surface border-b border-border">
                  <tr>
                    {["System", "Ext", "Emulator", "Support"].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-romio-gray font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((rule, i) => (
                    <tr key={i}
                      className="border-b border-border/50 hover:bg-white/3 transition-colors">
                      <td className="px-3 py-2 text-romio-gray">{rule.system}</td>
                      <td className="px-3 py-2 font-mono text-romio-cream">.{rule.extension}</td>
                      <td className="px-3 py-2 text-romio-gray">{rule.emulator}</td>
                      <td className={cn(
                        "px-3 py-2 font-medium",
                        rule.support === "supported"          ? "text-romio-green" :
                        "deprecated"  in rule.support         ? "text-amber-400"   :
                        "unsupported" in rule.support         ? "text-romio-red"   :
                        "text-romio-gray"
                      )}>
                        {formatSupportLabel(rule.support)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="text-center py-8 text-romio-gray text-sm">No rules match your filter.</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/format/FormatReferenceDrawer.tsx
git commit -m "feat(format): add FormatReferenceDrawer slide-in panel"
```

---

### Task 12: `FormatScreen` — assembly and scan logic

This is the top-level screen. It owns all state, loads the matrix on mount, walks the library directory using `@tauri-apps/plugin-fs`, runs the per-file checks, and assembles all child components.

**Files:**
- Create: `src/components/format/FormatScreen.tsx`

**How the scan works:**
1. `readDir(libraryPath)` — get top-level folders (each = a system)
2. For each system folder: `readDir(join(libraryPath, systemFolder))` — get ROM files
3. For each ROM file: determine emulator (from emulator matrix if "auto", else use selected)
4. Call `ipc.checkFormat(filePath, system, emulator, frontend)`
5. Collect all results → `groupResultsBySystem` → render

`path.join` equivalent: since this is Windows paths, just use `${root}\\${folderName}\\${fileName}` — but use a helper that handles both `/` and `\`.

- [ ] **Step 1: Create the screen**

```typescript
// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { readDir } from "@tauri-apps/plugin-fs";
import { FileSearch, HelpCircle, ShieldCheck } from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type {
  FormatSystemGroup, FormatRule, StagedFix,
  EmulatorMatrixEntry, FormatCheckResult,
} from "@/types";
import { groupResultsBySystem } from "@/lib/utils";
import { FormatConfigBar }       from "./FormatConfigBar";
import { FormatSystemRow }       from "./FormatSystemRow";
import { FormatFixTray }         from "./FormatFixTray";
import { FormatFixPlanModal }    from "./FormatFixPlanModal";
import { FormatReferenceDrawer } from "./FormatReferenceDrawer";

function joinPath(root: string, ...parts: string[]): string {
  const sep = root.includes("\\") ? "\\" : "/";
  return [root, ...parts].join(sep);
}

export function FormatScreen() {
  const { activeProject } = useAppStore();

  // Config state
  const [libraryPath, setLibraryPath] = useState(
    activeProject?.libraryRoots[0] ?? ""
  );
  const [frontend, setFrontend] = useState(
    activeProject?.targetFrontends[0] ?? "esde"
  );
  const [emulatorOverride, setEmulatorOverride] = useState("auto");

  // Scan state
  const [isScanning,  setIsScanning]  = useState(false);
  const [scanError,   setScanError]   = useState<string | null>(null);
  const [groups,      setGroups]      = useState<FormatSystemGroup[]>([]);
  const [expandedSys, setExpandedSys] = useState<string | null>(null);

  // Fix plan state
  const [stagedFixes,  setStagedFixes]  = useState<StagedFix[]>([]);
  const [planOpen,     setPlanOpen]     = useState(false);
  const [drawerOpen,   setDrawerOpen]   = useState(false);

  // Load the format matrix on mount (used by impact tables + reference drawer)
  const { data: rules = [] } = useQuery<FormatRule[]>({
    queryKey: ["format-matrix"],
    queryFn:  () => ipc.getFormatMatrix(),
  });

  // Load emulator matrix on mount (used for "auto" emulator resolution)
  const { data: emulatorMatrix = [] } = useQuery<EmulatorMatrixEntry[]>({
    queryKey: ["emulator-matrix"],
    queryFn:  () => ipc.getEmulatorMatrix(),
  });

  async function runScan() {
    if (!libraryPath) return;
    setIsScanning(true);
    setScanError(null);
    setGroups([]);
    setStagedFixes([]);

    try {
      const allResults: FormatCheckResult[] = [];

      // Walk one level: top-level folders = systems
      const systemEntries = await readDir(libraryPath);
      const systemFolders = systemEntries.filter((e) => e.isDirectory && e.name);

      for (const sysEntry of systemFolders) {
        const systemId = sysEntry.name!;
        const systemPath = joinPath(libraryPath, systemId);

        // Determine emulator for this system
        const emu = emulatorOverride === "auto"
          ? (emulatorMatrix.find((m) => m.system === systemId)?.recommended ?? "unknown")
          : emulatorOverride;

        // Walk files in this system folder (non-recursive)
        let fileEntries;
        try {
          fileEntries = await readDir(systemPath);
        } catch {
          continue; // skip unreadable system dirs
        }

        const files = fileEntries.filter((e) => e.isFile && e.name);

        for (const file of files) {
          const filePath = joinPath(systemPath, file.name!);
          try {
            const result = await ipc.checkFormat(filePath, systemId, emu, frontend);
            allResults.push(result);
          } catch {
            // Per-file error: push Unknown result
            const ext = file.name!.includes(".")
              ? file.name!.split(".").pop() ?? ""
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

      setGroups(groupResultsBySystem(allResults));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  }

  function stageFix(fix: StagedFix) {
    setStagedFixes((prev) =>
      prev.some((f) => f.result.path === fix.result.path)
        ? prev
        : [...prev, fix]
    );
  }

  const hasResults = groups.length > 0;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-romio-green/10 border border-romio-green/20">
            <FileSearch className="w-5 h-5 text-romio-green" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-romio-cream">Format Compatibility</h1>
            <p className="text-romio-gray text-sm mt-0.5">
              Scan your library for format issues before they cause silent launch failures.
            </p>
          </div>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          title="Format rules reference"
          className="p-2 rounded-lg text-romio-gray hover:text-romio-cream
                     hover:bg-white/5 transition-colors flex-shrink-0"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      </div>

      {/* Config bar */}
      <FormatConfigBar
        path={libraryPath}
        frontend={frontend}
        emulator={emulatorOverride}
        emulatorMatrix={emulatorMatrix}
        isScanning={isScanning}
        onPathChange={setLibraryPath}
        onFrontendChange={setFrontend}
        onEmulatorChange={setEmulatorOverride}
        onScan={runScan}
      />

      {/* Scan error banner */}
      {scanError && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3 rounded-xl bg-romio-red/10 border border-romio-red/20
                     text-sm text-romio-red"
        >
          {scanError}
        </motion.div>
      )}

      {/* Results */}
      {hasResults && (
        <div className="space-y-2">
          {groups.map((group, i) => (
            <FormatSystemRow
              key={group.system}
              group={group}
              rules={rules}
              stagedFixes={stagedFixes}
              expanded={expandedSys === group.system}
              onToggle={() => setExpandedSys(
                expandedSys === group.system ? null : group.system
              )}
              index={i}
              onStageFix={stageFix}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!hasResults && !isScanning && !scanError && (
        <div className="text-center py-16 text-romio-gray space-y-2">
          <ShieldCheck className="w-10 h-10 mx-auto opacity-30" />
          <p>Run a scan to check your library</p>
        </div>
      )}

      {/* Fix tray — conditionally mounted so AnimatePresence can animate exit */}
      <AnimatePresence>
        {stagedFixes.length > 0 && (
          <FormatFixTray
            fixes={stagedFixes}
            onClear={() => setStagedFixes([])}
            onReviewPlan={() => setPlanOpen(true)}
          />
        )}
      </AnimatePresence>

      {/* Fix plan modal */}
      {planOpen && (
        <FormatFixPlanModal
          fixes={stagedFixes}
          onClose={() => setPlanOpen(false)}
        />
      )}

      {/* Reference drawer */}
      <FormatReferenceDrawer
        open={drawerOpen}
        rules={rules}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/format/FormatScreen.tsx
git commit -m "feat(format): add FormatScreen with scan logic and component assembly"
```

---

### Task 13: Wire `FormatScreen` into `App.tsx`

Replace the placeholder with the real screen.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import**

After the existing `BiosScreen` import line add:

```typescript
import { FormatScreen }    from "@/components/format/FormatScreen";
```

- [ ] **Step 2: Replace the placeholder in the SCREENS map**

Change:
```typescript
format:     () => <PlaceholderScreen name="Format Compatibility" />,
```
To:
```typescript
format:     FormatScreen,
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Run the app and manually verify**

```bash
pnpm tauri dev
```

Manually verify:
- Format screen loads without errors
- Config bar shows project path and frontend pre-filled
- `?` button opens reference drawer with rules table
- Scan runs and groups results by system folder
- Expanding a system row shows file rows
- Clicking "Impact" on a deprecated/incompatible file shows the cross-emulator grid
- Staging a fix shows the tray animating up from the bottom
- "Review plan →" opens the modal
- Confirming and clicking "Apply Fixes" shows the stub message

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire FormatScreen into App, replace placeholder"
```

---

## Post-implementation

- [ ] **Run `cargo fix --lib -p romio`** to clean up pre-existing unused import warnings (mentioned in CLAUDE.md)
- [ ] **Run full test suite**: `pnpm test` — all logic tests should pass
- [ ] **Run typecheck**: `pnpm typecheck`
- [ ] **Commit cleanup if any**
