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
}

export function Modal({ onClose, className, children }: Props) {
  // No Dialog.Trigger here, so Radix can't return focus on close; remember the opener ourselves
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <Dialog.Content
            asChild
            onCloseAutoFocus={(e) => { e.preventDefault(); opener?.focus(); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
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
