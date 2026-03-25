import { test, expect } from "@playwright/test";

// This test only verifies the infrastructure is wired correctly:
// - Vite dev server starts with VITE_TEST_MODE=true
// - The app loads without a crash
// - The IPC mock alias is active (no "invoke is not a function" errors in console)
test("app loads without errors in test mode", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  // App shell should render
  await expect(page.locator("body")).not.toBeEmpty();

  // No IPC errors — if the alias isn't working, we'd see "invoke is not a function"
  const ipcErrors = consoleErrors.filter((e) =>
    e.includes("invoke is not a function")
  );
  expect(ipcErrors).toHaveLength(0);
});
