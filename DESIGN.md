---
version: alpha
name: Romio
description: A retro library hygiene tool that reads like a good late-80s game manual, guided by a cheeky robot sidekick.
colors:
  romio-black: "#1C1C1E"
  romio-cream: "#F5F0E8"
  romio-red: "#FF6060"
  romio-green: "#58A76E"
  romio-green-fill: "#437F53"
  romio-gray: "#999999"
  background: "#0F0F11"
  background-surface: "#1C1C1E"
  border: "#2E2E32"
  on-fill: "#FFFFFF"
typography:
  display:
    fontFamily: Nunito
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 2rem
  title:
    fontFamily: Nunito
    fontSize: 1.125rem
    fontWeight: 700
    lineHeight: 1.75rem
  body-md:
    fontFamily: Nunito
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Nunito
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
  label:
    fontFamily: Nunito
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1rem
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.25rem
rounded:
  sm: 0.375rem
  md: 0.5rem
  lg: 0.75rem
  xl: 1rem
  full: 9999px
spacing:
  xs: 0.25rem
  sm: 0.5rem
  md: 1rem
  lg: 1.5rem
  xl: 2rem
components:
  button-primary:
    backgroundColor: "{colors.romio-green-fill}"
    textColor: "{colors.on-fill}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: 10px 20px
  button-secondary:
    backgroundColor: "{colors.background-surface}"
    textColor: "{colors.romio-cream}"
    rounded: "{rounded.lg}"
    padding: 10px 20px
  panel:
    backgroundColor: "{colors.background-surface}"
    textColor: "{colors.romio-cream}"
    rounded: "{rounded.xl}"
    padding: 16px
  dialog:
    backgroundColor: "{colors.background-surface}"
    textColor: "{colors.romio-cream}"
    rounded: "{rounded.xl}"
    padding: 24px
  badge-valid:
    backgroundColor: "{colors.background-surface}"
    textColor: "{colors.romio-green}"
    rounded: "{rounded.full}"
  badge-error:
    backgroundColor: "{colors.background-surface}"
    textColor: "{colors.romio-red}"
    rounded: "{rounded.full}"
  titlebar:
    backgroundColor: "{colors.romio-black}"
    textColor: "{colors.romio-cream}"
    typography: "{typography.label}"
    height: 40px
  path-text:
    textColor: "{colors.romio-gray}"
    typography: "{typography.data-mono}"
---

## Overview

Romio checks a retro game library before something breaks: BIOS files, ROM formats, save locations, and the host machine. It is not an emulator or a frontend.

**One word: playful. Never toy-like.** Romio treats people's saves and libraries as serious, so the playfulness lives in the guide character and the manual-style presentation, never in the data. A file path, a hash, or a count is always shown plainly and exactly.

### Who it is for

Romio serves three moments. The welcome screen asks which one the person is in. The answer picks where Romio starts after a project opens and the order of the dashboard's checks (`src/lib/scenario.ts`), and the dashboard's "Your situation" menu changes it. *(Companion tone does not follow the scenario yet.)*

| Scenario | The person | What Romio leads with | Companion tone |
|:--|:--|:--|:--|
| Curator before a change | A PC power user with a big library across frontends, about to update an emulator, switch frontends, or rescan | Save risk and a checkpoint, then the full sweep | Cheeky, brisk |
| First-time handheld setup | Someone setting up a Steam Deck, Retroid, or Batocera box who wants it to just work | Pre-flight, then BIOS, one step at a time | Cheeky, patient, explains terms once |
| Rescuer after breakage | Someone whose games or saves just stopped working after an update | What changed and the one fix that matters most | Cheeky dialed down; calm and direct until the fix lands |

Voice stays the same in all three; tone follows the moment.

### North star: late-80s and early-90s game manuals

The reference is the printed game manual of the late 1980s and early 1990s. Ultima IV's manual set (the *History of Britannia* and *Book of Mystic Wisdom*, plus a cloth map) is the high-water mark for depth, but it is too dense for a newcomer, so Romio keeps that depth one click away instead of on the page.

What the manuals contribute, following Arnold Hendrick's "Manuals: They Can Be Good" (Game Developer):

- **Built for reference, not reading.** People open a manual mid-game to find one answer. Every Romio screen has a clear heading and the sidebar works as the table of contents; the Format Rules drawer is the reference section.
- **Operating instructions first, lore later.** How-to steps, background, and data live in separate places. Background goes in optional "From the manual" asides, never in the way of a fix.
- **Numbered steps for anything in sequence.** Repair and migration flows use big, numbered steps, like a manual's setup page.
- **Call-outs sit outside the picture.** Labels point at data from beside it with a line or arrow; they never cover it.
- **The guide character points at things.** Like a manual mascot, the Romio companion appears beside the step it is talking about, not as decoration.

## Colors

Colors come from the mascot (black body, cream face, red antenna and high-tops, green floppy disk), adjusted so every text color meets WCAG AA (4.5:1) on every surface, including the lightest hover tint (#252528).

- **romio-cream (#F5F0E8):** primary text. The mascot's face.
- **romio-gray (#999999):** secondary text, captions, file paths. Never fade it with opacity; the faded versions failed contrast.
- **romio-green (#58A76E):** valid states, active navigation, links, tints. The floppy disk.
- **romio-green-fill (#437F53):** solid buttons that carry white text. Darker than `romio-green` so white passes 4.5:1.
- **romio-red (#FF6060):** errors and blocking problems. Brighter than the mascot's #E03030, which fails 4.5:1 on dark surfaces.
- **background (#0F0F11) / background-surface (#1C1C1E):** two surface levels, warm near-black. Hover and selected states tint these with white or green at low opacity.
- **romio-black (#1C1C1E):** the titlebar.
- **border (#2E2E32):** every divider and outline.

BIOS validation states keep one color each on every screen (`biosStateColor` in `src/lib/utils.ts`):

| State | Color |
|:--|:--|
| Present, valid | romio-green |
| Present, wrong path | amber |
| Hash mismatch / missing required | romio-red |
| Missing optional / not applicable | romio-gray |

Amber (Tailwind `amber-400`/`amber-500`/`amber-600`) is used for warnings and conflicts across screens; it is not a token yet.

## Typography

- **Nunito** for all interface text. Its rounded terminals carry the playful side.
- **JetBrains Mono** for anything a person might copy or compare: file paths, hashes, file names, version numbers. This is the "not toy-like" side: exact data looks exact.
- Both fonts ship with the app (`@fontsource`); nothing loads from Google.
- Headings state the point ("3 BIOS files missing"), not the topic ("BIOS overview").

## Layout

- Screens are single-column, `max-w-3xl` (48rem) by default and `max-w-4xl` for the dashboard, with the sidebar as the table of contents.
- Lists of results group by system, then by file.
- Spacing follows the scale in the front matter; 4px is the base unit.

## Shapes

- Panels and dialogs use `rounded.xl`; buttons and rows use `rounded.lg`; badges and pills use `rounded.full`.
- Corners vary by role on purpose. Do not put one large radius on everything.

## Components

- **button-primary:** one per screen, for the action that moves the person forward.
- **dialog:** built on the shared `Modal` component (`src/components/shared/Modal.tsx`), which traps focus, closes on Escape, and returns focus to the opener. Every dialog has a title and a description.
- **path-text:** monospace, secondary color. Long paths keep their last two segments (`truncatePath` in `src/lib/utils.ts`) so the file name always shows.
- **Companion:** the mascot plus one line of text in the sidebar. Its 13 states map to app moments (`src/components/romio/RomioCompanion.tsx`).

## Voice

**Cheeky sidekick.** Romio is a small robot who has seen every way a retro setup can break and finds most of them a little funny, except when your saves are at risk.

- Second person, present tense ("You have 3 BIOS files missing").
- Real numbers and real file names in every message that reports a problem.
- One term per concept: a "save root" is always a save root.
- Cheek goes in the framing, never in the facts. The file name and the fix are always plain.
- No more than one exclamation mark per screen. None when data is at risk.

Draft sample lines (to be replaced with lines the team writes):

- Scan clean: "Not a single bad dump. Suspicious, honestly. Ready to play."
- BIOS missing: "PS1 is missing `scph5501.bin`. DuckStation won't boot US discs without it."
- Saves at risk: "Hold up. 2 save folders are about to move. Make a checkpoint first, then we'll do it together."

## Motion

- Motion explains a change of state (a step completing, a dialog opening). It is never decoration on data.
- One designed moment: the "accomplished" state after a clean scan. Everything else stays quiet.
- Respect reduced motion: `MotionConfig reducedMotion="user"` covers framer-motion, and a CSS rule stops spinners and pulses.

## Do's and Don'ts

Do:

- Use tokens from this file or the `@theme` block in `src/styles/globals.css`. No raw hex in components.
- Keep every text color at 4.5:1 or better against the tinted background it actually sits on. Never put an opacity modifier on text (`text-romio-green/60`); tint the background instead.
- Show exact data (paths, hashes, counts) in `data-mono`.
- Put background and lore in optional asides; keep fixes on the page.
- Give every interactive element a keyboard path and a label.

Don't:

- Emoji as icons. Use `lucide-react`.
- Uppercase labels with wide letter spacing.
- Purple or indigo gradients, glowing gradients, glassmorphism or `backdrop-blur`.
- Pulsing dots or "Live" badges on things that are not happening right now. The scan indicator is allowed because a scan is running.
- Inter or Roboto.
- Text or labels laid over screenshots or data.
- Fade-ins on every element, or motion that ignores reduced motion.
- Sidebar items that lead to "Coming soon". Hide unfinished screens.
- A centered hero with a row of identical feature cards.

## Open questions

- Should headings get a display face with more manual character (Nunito stays for body text)?
- Who writes the final companion lines? The drafts above are placeholders.
