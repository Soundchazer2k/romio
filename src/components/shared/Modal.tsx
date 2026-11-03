// SPDX-License-Identifier: GPL-3.0
// Accessible modal shell: focus trap, Escape to close, role="dialog".
// Children must render a <Dialog.Title> and a <Dialog.Description>.

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";

export { Dialog };

interface Props {
  onClose:   () => void;
  className: string;
  children:  React.ReactNode;
  /** "drawer" slides in from the right edge instead of popping in at the center */
  variant?:  "center" | "drawer";
}

export function Modal({ onClose, className, children, variant = "center" }: Props) {
  const drawer = variant === "drawer";
  // No Dialog.Trigger here, so Radix can't return focus on close; remember the opener ourselves
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={drawer
          ? "fixed inset-0 z-50 flex justify-end bg-black/40"
          : "fixed inset-0 z-50 flex items-center justify-center bg-black/70"}>
          <Dialog.Content
            asChild
            onCloseAutoFocus={(e) => { e.preventDefault(); opener?.focus(); }}
          >
            <motion.div
              initial={drawer ? { x: "100%" } : { opacity: 0, scale: 0.95 }}
              animate={drawer ? { x: 0 } : { opacity: 1, scale: 1 }}
              transition={drawer ? { type: "spring", stiffness: 300, damping: 30 } : undefined}
              className={className}
            >
              {children}
            </motion.div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
