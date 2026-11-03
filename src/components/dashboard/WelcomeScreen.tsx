// SPDX-License-Identifier: GPL-3.0
import { motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useAppStore } from "@/stores";
import { SCENARIOS, SCENARIO_ORDER, type Scenario } from "@/lib/scenario";
import { cn } from "@/lib/utils";

export function WelcomeScreen() {
  const { setScreen, setRomioState, scenario, setScenario } = useAppStore();

  function choose(s: Scenario) {
    setScenario(s);
    setScreen("projects");
    setRomioState(s === "handheld" ? "tutorial" : "idle");
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="max-w-md w-full space-y-8"
      >
        <div className="flex items-center gap-4">
          <img
            src="/romio/romio_welcome.png"
            alt="Romio"
            className="w-24 h-24 object-contain flex-shrink-0"
          />
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-romio-cream">Welcome to Romio</h1>
            <p className="text-romio-gray text-sm">
              Romio checks your BIOS files, ROM formats, saves and system before something breaks.
            </p>
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-lg font-bold text-romio-cream mb-3">What brings you here?</legend>
          {SCENARIO_ORDER.map((id) => {
            const s = SCENARIOS[id];
            const current = scenario === id;
            return (
              <button
                key={id}
                onClick={() => choose(id)}
                aria-current={current || undefined}
                className={cn(
                  "group w-full flex items-start gap-3 px-4 py-3 rounded-lg border text-left transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-romio-green",
                  current
                    ? "border-romio-green/40 bg-romio-green/10"
                    : "border-border bg-background-surface hover:border-romio-green/30 hover:bg-romio-green/5"
                )}
              >
                <div className="flex-1">
                  <p className="text-sm font-semibold text-romio-cream">{s.title}</p>
                  <p className="text-xs text-romio-gray mt-0.5">{s.description}</p>
                </div>
                {current
                  ? <Check className="w-4 h-4 text-romio-green flex-shrink-0 mt-0.5" aria-label="Your last choice" />
                  : <ArrowRight className="w-4 h-4 text-romio-gray group-hover:text-romio-green flex-shrink-0 mt-0.5" aria-hidden />}
              </button>
            );
          })}
        </fieldset>

        <p className="text-xs text-romio-gray">You can change this later from the dashboard.</p>
      </motion.div>
    </div>
  );
}
