import { describe, it, expect } from "vitest";
import designMd from "../../DESIGN.md?raw";

// DESIGN.md documents the tokens; tailwind.config.js is what the app uses. Fail when they drift.

type TokenTree = { [key: string]: string | TokenTree };

function flatten(tree: TokenTree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === "string") out[name] = value.toUpperCase();
    else Object.assign(out, flatten(value, name));
  }
  return out;
}

// Every `  key: value` line of a flat front matter block, quotes stripped
function designBlock(name: string): Record<string, string> {
  const block = designMd.replace(/\r\n/g, "\n").match(new RegExp(`^${name}:\\n((?: {2}.+\\n)+)`, "m"))?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/^ {2}([\w-]+): "?([^"\n]+)"?$/gm)].map(([, k, v]) => [k, v.toUpperCase()])
  );
}

async function tailwindTheme() {
  const configPath = "../../tailwind.config.js";
  const { default: config } = await import(/* @vite-ignore */ configPath);
  return config.theme.extend;
}

describe("DESIGN.md tokens", () => {
  it("lists every Tailwind color with the same value", async () => {
    const tailwind = flatten((await tailwindTheme()).colors);
    const design = designBlock("colors");

    expect(Object.keys(design).length).toBeGreaterThan(0);
    // The comparison below is by exact string, so every color must be #RRGGBB
    expect(Object.entries(design).filter(([, v]) => !/^#[0-9A-F]{6}$/.test(v))).toEqual([]);
    expect(design).toMatchObject(tailwind);
    // on-fill is Tailwind's built-in `white`, so it has no entry in the config
    expect(design["on-fill"]).toBe("#FFFFFF");
    const extra = Object.keys(design).filter((k) => !(k in tailwind) && k !== "on-fill");
    expect(extra).toEqual([]);
  });

  it("lists every Tailwind border radius with the same value", async () => {
    const { DEFAULT: _, ...radii } = (await tailwindTheme()).borderRadius;
    const tailwind = flatten(radii);
    const design = designBlock("rounded");

    expect(design).toMatchObject(tailwind);
    // full is Tailwind's built-in `rounded-full`
    expect(design.full).toBe("9999PX");
    expect(Object.keys(design).filter((k) => !(k in tailwind) && k !== "full")).toEqual([]);
  });
});
