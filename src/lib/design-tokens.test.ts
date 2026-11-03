import { describe, it, expect } from "vitest";
import designMd from "../../DESIGN.md?raw";
import { readFileSync } from "node:fs";

// Vitest hands back an empty string for `?raw` CSS imports, so read the file directly
const globalsCss = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

// DESIGN.md documents the tokens; the @theme block in globals.css is what the app uses.
// Fail when they drift.

// Every `--<prefix>-name: value;` in the @theme block, keyed by name
function themeTokens(prefix: string): Record<string, string> {
  const theme = globalsCss.replace(/\r\n/g, "\n").match(/@theme\s*{([\s\S]*?)\n}/)?.[1] ?? "";
  return Object.fromEntries(
    [...theme.matchAll(new RegExp(`--${prefix}-([\\w-]+):\\s*([^;]+);`, "g"))]
      .map(([, k, v]) => [k, v.trim().toUpperCase()])
  );
}

// Every `  key: value` line of a flat front matter block, quotes stripped
function designBlock(name: string): Record<string, string> {
  const block = designMd.replace(/\r\n/g, "\n").match(new RegExp(`^${name}:\\n((?: {2}.+\\n)+)`, "m"))?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/^ {2}([\w-]+): "?([^"\n]+)"?$/gm)].map(([, k, v]) => [k, v.toUpperCase()])
  );
}

describe("DESIGN.md tokens", () => {
  it("lists every Tailwind color with the same value", () => {
    const tailwind = themeTokens("color");
    expect(Object.keys(tailwind).length).toBeGreaterThan(0);
    const design = designBlock("colors");

    expect(Object.keys(design).length).toBeGreaterThan(0);
    // The comparison below is by exact string, so every color must be #RRGGBB
    expect(Object.entries(design).filter(([, v]) => !/^#[0-9A-F]{6}$/.test(v))).toEqual([]);
    expect(design).toMatchObject(tailwind);
    // on-fill is Tailwind's built-in `white`, so it has no entry in @theme
    expect(design["on-fill"]).toBe("#FFFFFF");
    const extra = Object.keys(design).filter((k) => !(k in tailwind) && k !== "on-fill");
    expect(extra).toEqual([]);
  });

  it("lists every Tailwind border radius with the same value", () => {
    const tailwind = themeTokens("radius");
    expect(Object.keys(tailwind).length).toBeGreaterThan(0);
    const design = designBlock("rounded");

    expect(tailwind).toEqual(design);
  });

  it("keeps the bare `rounded` default at the md radius", () => {
    // --radius has no name after it, so themeTokens("radius") can't see it
    const bare = globalsCss.match(/--radius:\s*([^;]+);/)?.[1].trim().toUpperCase();
    expect(bare).toBe(designBlock("rounded").md);
  });
});
