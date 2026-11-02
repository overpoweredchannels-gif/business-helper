# Aankh workspace design

## Direction

Keep the Aankh eye, licorice navigation, and earthy warmth. Warm paper provides
the canvas, white cards contain records, and terracotta identifies primary actions.
The shared tokens apply to owner, staff, inventory, customers, purchasing, and money
screens. Existing permissions, business calculations, and saved dashboard choices
remain the source of behavior.

## Color and contrast

All colors are semantic tokens in `src/app/globals.css`, mirrored in `.dark`.
Computed WCAG contrast ratios in the light palette:

| Foreground | White card | Paper canvas | Muted surface | Primary tint |
| --- | --- | --- | --- | --- |
| Primary `#a44a2b` | 5.84:1 | 5.36:1 | 4.91:1 | 5.02:1 |
| Success `#35704f` | 5.86:1 | 5.37:1 | 4.93:1 | 5.03:1 |
| Warning text `#8a5c27` | 5.77:1 | 5.29:1 | 4.85:1 | 4.95:1 |
| Secondary text `#6c665d` | 5.68:1 | 5.21:1 | 4.78:1 | 4.88:1 |

The canvas is `#f6f5f1`, muted surface `#eeebe5`, and primary tint `#f5ece7`.
Input border `#898178` measures 3.52:1 against the canvas and 3.84:1 against white.
White primary-button text measures 5.84:1 against terracotta.

## Cards and motion

- `aankh-card`: subtle, token-derived depth shared by dashboard widgets.
- `aankh-metric`: aligned balance cards; single column below 375px, two on phones,
  and three from the tablet breakpoint.
- `aankh-action`: compact quick actions with press feedback and visible focus.
- CSS entry motion lasts 360ms, chart reveals 500ms, and a decorative CSS cube
  enters once over 700ms. No video, WebGL runtime, or new dependency is required.
- Reduced-motion preferences disable entry and chart animation. Hover movement
  requires a fine pointer and a no-preference motion setting.
- Charts expose their values through an accessible SVG title; axis labels remain
  HTML text at 11px rather than shrinking with the SVG.

## Navigation and section panels

The sidebar uses espresso `#26221e`, an inset surface `#312b25`, and muted labels
`#c4b9ac`. Label contrast measures 8.18:1 on espresso and 7.24:1 on the inset
surface. Selected pages use `#713d27` on `#f0dfcd` (6.73:1), with both a colored
marker and `aria-current`. The input boundary is `#8c8173` (3.66:1 on the inset
surface). The focus ring is `#e8a98c` (7.88:1 on espresso).

Task groups have explicit icons, chevrons, expanded states, and touch targets.
The sidebar and Business Overview reuse the same icon registry. Menu filtering,
saved ordering, permission filtering, keyboard access, and mobile dismissal keep
their existing behavior.

The main owner page uses `workspace-section` for 46 workflow panels and
`workspace-panel` for 65 nested cards. Sections share a white surface, 12px
corners, 20px vertical rhythm, a constrained width, and 16–24px padding. Table
rows have consistent breathing room, and form boundaries use the input token.
Staff cards and dropped dashboard summaries use the same sizing conventions.
The setup prompt presents its action beside the description on larger screens.
Sparse dashboards expand their remaining column rather than reserve an empty rail.

Navigation expansion and workflow entry use 180–280ms transform animations;
reduced-motion settings disable both. No skill installation or runtime dependency
is needed for these patterns.

## Verification

The redesign was checked against 320, 390, 768, 1024, and 1440px viewports, including
shared navigation, readable chart rendering, reduced motion, and dashboard
loading, empty, failure, retry, and organization-switch states.
