# Format Screen — Design Spec

**Date:** 2026-03-16
**Status:** Approved, ready for implementation
**Approach:** A (BIOS-mirror pattern)

---

## Overview

The Format screen is an active ROM compatibility scanner. It checks a user's library files against Romio's format rules database, surfaces incompatibilities grouped by system, and lets users stage fix actions into a change plan that is reviewed before anything is written to disk.

A secondary **Format Rules Reference** drawer is available via a `?` button in the header, providing the full rules matrix as a contextual help and tutorial element.

---

## User Flow

1. Screen opens — current project path and frontend pre-filled in the config bar
2. User adjusts overrides if needed, clicks **Scan**
3. Results appear grouped by system with color-coded badges
4. User expands a system row to see individual file results
5. For a file with an issue, user expands the **Impact** section to see cross-emulator compatibility
6. User clicks **Stage fix** — fix is added to the plan, `FormatFixTray` animates in
7. User clicks **Review plan →** — modal shows all staged fixes with impact warnings
8. User confirms — execution stub returns "not yet implemented" (consistent with saves screen)

---

## Component Structure

```
src/components/format/
  FormatScreen.tsx          ← top-level screen, owns all state
  FormatConfigBar.tsx       ← path input + frontend/emulator overrides + Scan button
  FormatSystemRow.tsx       ← collapsible row per system (mirrors BIOS SystemRow pattern)
  FormatFileRow.tsx         ← individual file result inside a system row
  FormatImpactTable.tsx     ← inline cross-emulator compatibility grid (expand on demand)
  FormatFixTray.tsx         ← sticky bottom bar, animates in when fixes are staged
  FormatReferenceDrawer.tsx ← slide-in rules matrix, opened via ? button in header
```

State lives entirely in `FormatScreen` local state — no new Zustand store. Scan results are transient (not persisted across sessions).

---

## Data Flow

```
Mount
  └─ useQuery("format-matrix") → ipc.getFormatMatrix()
       └─ stores rules[] in local state
            (used by reference drawer + impact tables — no repeat IPC calls)

Scan triggered
  └─ for each file in library path:
       ipc.checkFormatCompatibility(filePath, system, emulator, frontend)
  └─ results grouped client-side by system → SystemGroup[]
  └─ loading state shown during scan

File row expanded (issue present)
  └─ FormatImpactTable filters rules[] by (extension + system)
       → renders cross-emulator grid — no additional IPC call

Fix staged
  └─ StagedFix appended to stagedFixes[]
  └─ FormatFixTray animates in

"Review plan →" clicked
  └─ FormatFixPlanModal — shows staged fixes + impact warnings
  └─ Confirm → IPC execution stub (not yet implemented)
```

---

## UI Layout

```
┌─ FormatScreen ──────────────────────────────────────── [?] ─┐
│  "Format Compatibility"   subtitle                           │
├──────────────────────────────────────────────────────────────┤
│  FormatConfigBar                                             │
│  [Library path ──────────────────────────────] [Browse]     │
│  Frontend: [ES-DE ▾]   Emulator: [auto ▾]       [Scan ▶]   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ▶ Nintendo DS          3 files   [1 issue]   ← amber       │
│  ▶ Game Boy             12 files  [All OK]    ← green       │
│  ▼ Daphne               2 files   [2 issues]  ← red         │
│    └─ game.daphne   [Deprecated]  .daphne → .hypseus        │
│       [+ Stage fix]   [▾ Impact]                            │
│       ▼ Impact across emulators:                            │
│           hypseus-singe   .hypseus   ✓ Supported            │
│           lr-daphne       .daphne    ✗ Deprecated           │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  Empty state:  "Run a scan to check your library"           │
│  Error state:  inline banner below config bar               │
└──────────────────────────────────────────────────────────────┘

  FormatFixTray (animates up from bottom when fixes staged)
┌─────────────────────────────────────────────────────────────┐
│  2 fixes staged   [Clear]                [Review plan →]    │
└─────────────────────────────────────────────────────────────┘
```

**[?] button** (top-right of header): opens `FormatReferenceDrawer`, a slide-in panel from the right. Contains the full rules matrix as a searchable/filterable table, plus a brief explanation of each support state (supported / deprecated / unsupported / conditional).

---

## Badge States

| Badge | Color token | Condition |
|---|---|---|
| All OK | `romio-green` | Zero issues in system |
| N issues | `state-warning` | Deprecated or conditional matches |
| N issues | `romio-red` | Incompatible matches |

Mirrors the existing BIOS screen badge pattern exactly.

---

## TypeScript Types

Add to `src/types/index.ts`:

```typescript
export interface FormatRule {
  system: string;
  extension: string;
  emulator: string;
  frontend?: string | null;
  support: FormatSupport;
  notes?: string;
}

export type FormatSupport =
  | "supported"
  | { deprecated: { replacement: string } }
  | { unsupported: { reason: string } }
  | { conditional: { condition: string } };

export interface FormatCheckResult {
  path: string;
  extension: string;
  system?: string;
  emulator?: string;
  state: FormatCompatibilityState;
  notes?: string;
  fix_action?: FormatFixAction;
}

export interface FormatFixAction {
  action_type: "Rename" | "Convert" | "Redump";
  description: string;
  safe: boolean;
  new_filename?: string;
}

// Client-side grouping (not from Rust)
export interface FormatSystemGroup {
  system: string;
  results: FormatCheckResult[];
}

// Staged fix plan entry (client-side only)
export interface StagedFix {
  result: FormatCheckResult;
  fix: FormatFixAction;
}
```

Also update `src/lib/ipc.ts` return types:
```typescript
checkFormatCompatibility: (...) => invoke<FormatCheckResult>(...)
getFormatMatrix: () => invoke<FormatRule[]>(...)
```

---

## Error Handling

| Error | Behavior |
|---|---|
| Path not found / unreadable | Inline error banner below config bar; scan button re-enables |
| IPC error on individual file | File row shows `Unknown` state; error as tooltip; scan continues |
| Matrix load failure | Reference drawer shows error state; scan still works; impact tables show "rules unavailable" |

---

## Out of Scope (this iteration)

- Fix execution (apply renames/converts) — stub returns "not yet implemented"
- Batch scan progress indicator (simple spinner is sufficient for now)
- Persisting scan results across sessions
