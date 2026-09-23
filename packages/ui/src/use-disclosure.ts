"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The behaviour behind a menu that hangs off a button.
 *
 * Escape closes it and puts focus back on the trigger — Escape that drops
 * focus to the document is Escape that strands a keyboard at the top of the
 * page — and a pointer landing anywhere outside closes it too. That is the
 * whole of it, and it is the part that is easy to get subtly wrong, so it is
 * written once here rather than in each menu.
 *
 * Deliberately not an ARIA menu. A disclosure holding ordinary links and
 * buttons already has Tab and Enter; `role="menu"` would take those away and
 * owe arrow keys, a roving tabindex and typeahead in return. What each caller
 * keeps for itself is the drawing: a header menu opens downward against the
 * right edge, a sidebar's opens upward and fills its rail, and neither is a
 * variant of the other worth a prop.
 */
export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && container.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return { open, setOpen, container, trigger };
}
