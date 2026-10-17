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
 * Pure space computation, unit-tested separately (including nonzero viewport
 * offsets). The anchor rectangle from getBoundingClientRect() is converted
 * from the layout viewport's coordinate space into the visual viewport's
 * space by subtracting the visual viewport's offset; the result compares
 * directly against the visual viewport height. Outside pinch-zoom the offset
 * is 0 and the computation reduces to rect edges vs. viewport height.
 */
export function computeSuggestionSpaces(
  rectTop: number,
  rectBottom: number,
  viewportHeight: number,
  viewportOffsetTop = 0,
): { spaceAbove: number; spaceBelow: number } {
  const top = rectTop - viewportOffsetTop;
  const bottom = rectBottom - viewportOffsetTop;
  return { spaceAbove: top, spaceBelow: viewportHeight - bottom };
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
    // Captured once so add/removeEventListener stay symmetric even if the
    // visual viewport appears or disappears mid-effect.
    const viewport = window.visualViewport ?? null;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight = viewport?.height ?? window.innerHeight;
      // The visual viewport's offset converts the anchor rectangle into
      // visual-viewport coordinates; recomputed when the viewport pans
      // (pinch-zoom) or the keyboard changes its dimensions.
      const offsetTop = viewport?.offsetTop ?? 0;
      const { spaceAbove, spaceBelow } = computeSuggestionSpaces(rect.top, rect.bottom, viewportHeight, offsetTop);
      const next = decideSuggestionPlacement(spaceAbove, spaceBelow);
      setPlacement(next);
      const available = (next === "below" ? spaceBelow : spaceAbove) - 12;
      setMaxHeightPx(clampPopoverHeight(available));
    };
    // Re-measure when the page or an ancestor container scrolls: the field's
    // viewport-relative position — and therefore the available space — has
    // changed. Scrolls inside the popover itself (the option list) are
    // ignored; the popover moves with its field, so option scrolling needs no
    // re-measurement. Throttled with rAF because scroll events fire rapidly.
    let scrollRaf = 0;
    const handleScroll = (event: Event) => {
      if (anchorRef.current?.contains(event.target as Node | null)) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        measure();
      });
    };
    // The visual viewport pans (pinch-zoom) and resizes (keyboard) on its own
    // events, independent of page scroll.
    const handleViewportChange = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        measure();
      });
    };
    measure();
    viewport?.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("scroll", handleViewportChange);
    window.addEventListener("resize", measure);
    // Capture phase: scroll events do not bubble, but they do capture from window.
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      viewport?.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open ]);

  return { anchorRef, placement, maxHeightPx };
}
