# Config Row Alignment & Polish — Design Spec
**Date:** 2026-03-24
**Scope:** `BiosScreen.tsx`, `FormatConfigBar.tsx` — config rows only

## Problem

The config rows in BIOS Validation and Format Check use `flex flex-wrap` containers
without bottom-alignment. When controls have different heights (label+input vs
label+select), they don't align at the bottom. Labels and inputs also lack the
bolder, card-like treatment shown in the design mockup.

## Goal

Fix vertical alignment and bring the config row visual style closer to the mockup:
bold labels, card-feel inputs, inset icon for the BIOS directory field.

## Out of Scope

- All other screens (Dashboard, Preflight, Saves, etc.)
- System list rows, status badges, or any other part of either screen
- Shared component extraction (deferred — not warranted for two screens)

## Changes

### 1. Alignment fix (both files)

Change the outer flex container class in both files:

| File | Landmark | Current | New |
|---|---|---|---|
| `BiosScreen.tsx` | `{/* Config row */}` block | `flex gap-3 flex-wrap` | `flex gap-3 flex-wrap items-end` |
| `FormatConfigBar.tsx` | root `<div>` of the component return | `flex gap-3 flex-wrap items-start` | `flex gap-3 flex-wrap items-end` |

Note: in `FormatConfigBar`, the "Library root" field has a nested inner flex row
(`<div className="flex gap-2">`) wrapping the input + browse button. That inner row
has no alignment class — its children are uniform height so no fix is needed there.
`items-end` applies only to the outer container.

### 2. Label styling (both files)

**Current:**
```
text-xs text-romio-gray uppercase tracking-wider
```
**New:**
```
text-xs font-medium text-romio-gray/70 uppercase tracking-widest
```

Affected labels:
- `BiosScreen`: "BIOS directory", "Frontend"
- `FormatConfigBar`: "Library root", "Frontend", "Emulator"

### 3. Input / select background (both files)

For all `<select>` elements and the `FormatConfigBar` `<input>` element, change only
`bg-black/30 border border-border` → `bg-romio-surface border border-white/10`.
All other classes on those elements (including `flex-1` on the Library root input)
are unchanged.

**Skip the `BiosScreen` `<input>` entirely in this section** — do not apply the
substitution to it. Section 4 provides a complete wholesale replacement of that
element (including the updated background classes). Applying Section 3 to it first
then Section 4 would be redundant; applying Section 3 and skipping Section 4 would
produce wrong output.

The scan button in `FormatConfigBar` is unchanged.

The browse button in `FormatConfigBar`: change only the `className` prop value
(leave `onClick`, `title`, and children intact) to:
```
px-3 py-2 rounded-lg bg-romio-surface border border-white/10
text-romio-gray hover:text-romio-cream hover:bg-white/5 transition-colors
```

### 4. Inset folder icon — BiosScreen only

Inside the existing `space-y-1` wrapper in the `{/* Config row */}` block, replace
**only the `<input>` element** with the following icon-wrapper + input structure.
The `space-y-1` wrapper itself is kept.

```tsx
<div className="relative flex items-center w-full">
  <div className="absolute left-0 flex items-center h-full pl-3 pr-2.5
                  border-r border-white/10 pointer-events-none">
    <FolderOpen className="w-4 h-4 text-romio-gray/50" />
  </div>
  <input
    value={biosRoot}
    onChange={(e) => setBiosRoot(e.target.value)}
    placeholder="/path/to/bios"
    className="w-full pl-11 pr-3 py-2 rounded-lg bg-romio-surface border border-white/10
               text-sm font-mono text-romio-cream placeholder:text-romio-gray/40
               focus:outline-none focus:border-romio-green/40"
  />
</div>
```

The `w-full` on the outer wrapper ensures the input stretches to fill available flex
space. `pl-11` (44px) provides comfortable clearance for the icon column.

`FormatConfigBar` already has a separate browse button — no icon inlining needed there.

## Files Changed

- `src/components/bios/BiosScreen.tsx` — config row only (`{/* Config row */}` block)
- `src/components/format/FormatConfigBar.tsx` — config row only (root container + all label/input/select/button classes)

## New Imports Required

No new packages. `FolderOpen` must be added to `BiosScreen`'s existing
`lucide-react` import line. The current import line is:

```ts
import { Shield, ChevronDown, ChevronRight, ExternalLink, Copy } from "lucide-react";
```

It should become:

```ts
import { Shield, ChevronDown, ChevronRight, ExternalLink, Copy, FolderOpen } from "lucide-react";
```

(`FolderOpen` is already present in `FormatConfigBar`'s import — no change needed there.)
