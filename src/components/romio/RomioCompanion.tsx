// SPDX-License-Identifier: GPL-3.0
// The Romio companion panel — displays the correct mascot state
// and a contextual message. Lives in the bottom-left of the sidebar.

import { motion, AnimatePresence } from "framer-motion";
import type { RomioState } from "@/types";

interface Props {
  state:   RomioState;
  message?: string;
}

// Maps each state to the correct image filename
const STATE_IMAGE: Record<RomioState, string> = {
  welcome:       "/romio/romio_welcome.png",
  tutorial:      "/romio/romio_tutorial.png",
  idle:          "/romio/romio_idle.png",
  working:       "/romio/romio_working.png",
  processing:    "/romio/romio_processing.png",
  pondering:     "/romio/romio_pondering.png",
  announcement:  "/romio/romio_announcement.png",
  concerned:     "/romio/romio_concerned.png",
  confused:      "/romio/romio_confused.png",
  difficult_save:"/romio/romio_difficult_save.png",
  error:         "/romio/romio_error.png",
  success:       "/romio/romio_success.png",
  accomplished:  "/romio/romio_accomplished.png",
};

// Default contextual messages for each state
const STATE_DEFAULT_MESSAGE: Record<RomioState, string> = {
  welcome:        "Hey! I'm Romio. Let's get your library sorted.",
  tutorial:       "Follow these steps and we'll have everything working.",
  idle:           "No project open. Create or open a project to get started.",
  working:        "On it. Running repairs now…",
  processing:     "Scanning your library. This may take a moment.",
  pondering:      "Analyzing results…",
  announcement:   "Heads up — something needs your attention.",
  concerned:      "Found some issues that will prevent games from launching.",
  confused:       "Some results need your input before I can continue.",
  difficult_save: "Save data at risk. Review this carefully before proceeding.",
  error:          "Critical error. No changes have been made.",
  success:        "All checks passed. Looking good!",
  accomplished:   "Library is clean. You're ready to play.",
};

export function RomioCompanion({ state, message }: Props) {
  const img = STATE_IMAGE[state];
  const msg = message ?? STATE_DEFAULT_MESSAGE[state];

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative"
        >
          <img
            src={img}
            alt={`Romio — ${state}`}
            className="w-24 h-24 object-contain drop-shadow-lg"
            draggable={false}
          />
          {/* Pulse ring for active states */}
          {(state === "working" || state === "processing") && (
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-romio-green/30"
              animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.p
          key={msg}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="text-xs text-center text-romio-gray leading-relaxed max-w-[180px]"
        >
          {msg}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
