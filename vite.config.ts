import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// process.env is read at config evaluation time (NOT import.meta.env at runtime).
// This is the correct pattern for Vite module aliasing.
const isTestMode = process.env.VITE_TEST_MODE === "true";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // When VITE_TEST_MODE=true, swap real IPC and Tauri plugins for mocks
      // so Playwright can run against the Vite dev server without the Rust backend.
      ...(isTestMode
        ? {
            "@/lib/ipc": path.resolve(__dirname, "src/lib/ipc.mock.ts"),
            "@tauri-apps/plugin-fs": path.resolve(
              __dirname,
              "src/lib/tauri-plugins.mock.ts"
            ),
            "@tauri-apps/plugin-dialog": path.resolve(
              __dirname,
              "src/lib/tauri-plugins.mock.ts"
            ),
            "@tauri-apps/api/event": path.resolve(
              __dirname,
              "src/lib/tauri-api-event.mock.ts"
            ),
          }
        : {}),
    },
  },
  clearScreen: false,
  server: {
    port: 1444,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
