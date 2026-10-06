"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Preferred popover height (px) when viewport space allows. */
export const SUGGESTION_POPOVER_MAX_HEIGHT = 256;
/** Below-space threshold (px) under which the popover flips above the field. */
const FLIP_THRESHOLD_PX = 180;

/**
 * Pure placement decision, unit-tested separately: open below the field when
 * there is enough room; otherwise open above when there is more room there.
 */
export function decideSuggestionPlacement(
  spaceAbovePx: number,
  spaceBelowPx: number,
): "above" | "below" {
  if (spaceBelowPx >= FLIP_THRESHOLD_PX) return "below";
  if (spaceAbovePx > spaceBelowPx) return "above";
  return "below";
}

/**
 * Pure height clamp, unit-tested separately: the popover never exceeds the
 * space actually available on its side — no minimum is enforced beyond that
 * space, so a cramped viewport (e.g. phone keyboard open) cannot push the
 * popover outside the visual viewport. Options stay scrollable inside.
 */
export function clampPopoverHeight(availablePx: number): number {
  return Math.max(0, Math.min(SUGGESTION_POPOVER_MAX_HEIGHT, availablePx));
}

/**
 * Keeps an autocomplete popover inside the viewport, including on phones with
 * the software keyboard open (visualViewport shrinks, so available space is
 * measured against it). Returns a ref to attach to the relatively-positioned
 * field wrapper, the chosen placement, and a pixel max-height that never
 * exceeds the space actually available on the chosen side.
 */
export function useSuggestionPlacement(open: boolean): {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  placement: "above" | "below";
  maxHeightPx: number;
} {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const [maxHeightPx, setMaxHeightPx] = useState(SUGGESTION_POPOVER_MAX_HEIGHT);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const spaceAbove = rect.top;
      const spaceBelow = viewportHeight - rect.bottom;
      const next = decideSuggestionPlacement(spaceAbove, spaceBelow);
      setPlacement(next);
      const available = (next === "below" ? spaceBelow : spaceAbove) - 12;
      setMaxHeightPx(clampPopoverHeight(available));
    };
    measure();
    window.visualViewport?.addEventListener("resize", measure);
    window.addEventListener("resize", measure);
    return () => {
      window.visualViewport?.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
    };
  }, [open ]);

  return { anchorRef, placement, maxHeightPx };
}
