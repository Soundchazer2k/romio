import { describe, it, expect } from "vitest";
import designMd from "../../DESIGN.md?raw";

// DESIGN.md documents the tokens; tailwind.config.js is what the app uses. Fail when they drift.

type ColorTree = { [key: string]: string | ColorTree };

function flatten(tree: ColorTree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === "string") out[name] = value.toUpperCase();
    else Object.assign(out, flatten(value, name));
  }
  return out;
}

function designColors(): Record<string, string> {
  const block = designMd.replace(/\r\n/g, "\n").match(/^colors:\n((?: {2}.+\n)+)/m)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/^ {2}([\w-]+): "(#[0-9A-Fa-f]{6})"$/gm)].map(([, k, v]) => [k, v.toUpperCase()])
  );
}

describe("DESIGN.md tokens", () => {
  it("lists every Tailwind color with the same value", async () => {
    const configPath = "../../tailwind.config.js";
    const { default: config } = await import(/* @vite-ignore */ configPath);
    const tailwind = flatten(config.theme.extend.colors);
    const design = designColors();

    expect(Object.keys(design).length).toBeGreaterThan(0);
    expect(design).toMatchObject(tailwind);
    // on-fill is Tailwind's built-in `white`, so it has no entry in the config
    const extra = Object.keys(design).filter((k) => !(k in tailwind) && k !== "on-fill");
    expect(extra).toEqual([]);
  });
});
