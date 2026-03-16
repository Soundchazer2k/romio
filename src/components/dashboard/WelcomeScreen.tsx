// SPDX-License-Identifier: GPL-3.0
import { motion } from "framer-motion";
import { FolderOpen, Plus } from "lucide-react";
import { useAppStore } from "@/stores";

export function WelcomeScreen() {
  const { setScreen, setRomioState } = useAppStore();

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="max-w-md space-y-8"
      >
        {/* Hero image */}
        <motion.img
          src="/romio/romio_welcome.png"
          alt="Romio"
          className="w-40 h-40 object-contain mx-auto drop-shadow-2xl"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4, ease: "easeOut" }}
        />

        {/* Title */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-romio-cream tracking-tight">
            Welcome to Romio
          </h1>
          <p className="text-romio-gray text-lg leading-relaxed">
            Your retro library's best friend.
          </p>
        </div>

        {/* Value props */}
        <div className="grid grid-cols-1 gap-3 text-left">
          {[
            { icon: "🔍", text: "Validates BIOS files for any frontend" },
            { icon: "💾", text: "Protects your saves across emulator updates" },
            { icon: "🎮", text: "Fixes format and path issues before they bite" },
            { icon: "🖥️", text: "Checks your machine is ready to launch" },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.06 }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg
                         bg-white/[0.03] border border-border text-sm text-romio-cream/80"
            >
              <span className="text-base">{item.icon}</span>
              {item.text}
            </motion.div>
          ))}
        </div>

        {/* CTA buttons */}
        <motion.div
          className="flex gap-3 justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <button
            onClick={() => {
              setScreen("projects");
              setRomioState("tutorial");
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold
                       bg-romio-green text-white hover:bg-romio-green/90
                       transition-colors text-sm shadow-romio-sm"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
          <button
            onClick={() => {
              setScreen("projects");
              setRomioState("idle");
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium
                       bg-white/5 text-romio-cream hover:bg-white/10
                       transition-colors text-sm border border-border"
          >
            <FolderOpen className="w-4 h-4" />
            Open Project
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
