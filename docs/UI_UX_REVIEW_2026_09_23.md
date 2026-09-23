# UI and interaction review - 23 September 2026

Audit of the design tokens and the shared dashboard surfaces against the accessibility,
touch and layout rules in the installed `ui-ux-pro-max` skill. Contrast ratios below were
computed from the token values in `src/app/globals.css`, not estimated by eye.

## Fixed confirmed issues

**Text contrast on tinted surfaces (WCAG AA, 4.5:1)**

`text-primary` is used in roughly 380 places, many of them as a chip or badge on a tinted
background, where it measured below AA: 4.21 on `bg-muted`, 4.35 on `bg-primary-light` and
4.43 on `bg-primary/10` on card. Rather than edit each call site, the token itself was
darkened so every existing usage becomes compliant at once.

| Token | Before | After | Worst measured background |
|-------|--------|-------|---------------------------|
| `--color-primary` | `#b25232` | `#a44a2b` | `bg-muted` 4.86 (was 4.21) |
| `--color-primary-hover` | `#a84f2f` | `#934026` | still darker than base |
| `--color-success` | `#3d7a5a` | `#35704f` | `bg-muted` 4.88 (was 4.23) |
| `--color-warning` | `#92622a` | `#8a5c27` | `bg-muted` 4.80 (was 4.36) |

White on the new primary rose from 5.07 to 5.84, so filled buttons improved as well.
`--color-primary-hover` had to move with it, otherwise hover would have been lighter than
the resting state.

**Form-control boundaries (WCAG 1.4.11, 3:1 for UI components)**

`--color-input` was `#e4e1da`, which is 1.31:1 against a card - far below the 3:1 required
to identify an input boundary. It is now `#8f8b84` (3.39:1 against card, 3.05:1 against
the page background), which fixes all 36 `border-input` controls. `--color-border` stays
light on purpose: decorative card outlines are not UI component boundaries.

**Primary on dark surfaces**

`src/components/ui/auth-fuse.tsx:227` drew a primary icon on the dark auth panel where it
measured 2.87:1, and darkening the primary would have made it 2.56:1. Added a dedicated
`--color-primary-on-dark` token (`#e8a98c`, 7.25:1) for primary-colored content on dark
fills.

**Hover-only actions were unreachable on touch and invisible to keyboard users**

`src/components/ai/AIAssistant.tsx:83` revealed the Copy and Retry controls with
`opacity-0 group-hover:opacity-100`. On a touch screen they were permanently invisible, and
keyboard users could focus them while they rendered at zero opacity, which breaks the
visible-focus requirement. Added a `.hover-reveal` utility in `globals.css` that only hides
under `@media (hover: hover) and (pointer: fine)` and also reveals on `:focus-within`.
The message-action container now uses it.

**Undersized touch and pointer targets**

- `AIAssistant.tsx` copy/retry measured about 14px tall and clear-chat about 22px, all below
  the 24x24 CSS px minimum. Now 24px or more with a focus ring.
- `src/components/dashboard/Sidebar.tsx:263` and `:271` were `p-1` icon buttons at roughly
  22px. The sidebar renders inside the mobile navigation dialog, which is outside
  `.responsive-content`, so the global mobile 44px rule did not reach them. They are now
  44px on mobile and 32px from the `sm` breakpoint up.
- `src/components/dashboard/DashboardWidget.tsx` remove control was 28px tall; now 36px, and
  44px on mobile via the shared rule.
- `src/components/dashboard/widgets/RecentActivity.tsx:43` "View all" had no padding, so its
  hit area was only the text. It also had no focus-visible style; both are fixed.

**Numeric alignment**

KPI values (`widgets/KPICard.tsx`) and activity amounts (`widgets/RecentActivity.tsx`) now use
`tabular-nums`, so figures stop shifting width as values change in a business dashboard that
is mostly currency.

**Badge legibility**

The activity-type badge in `widgets/RecentActivity.tsx` was 10px, below the 11px floor used
by the rest of the badge scale.

**Dashboard spacing**

`src/components/dashboard/DashboardView.tsx` - the greeting sat lower than it needed to on
phones (`pt-4` plus centered alignment against a 44px button). The page header is now
`pt-3` on mobile, the row top-aligns below `sm`, the heading uses `leading-tight`, and the KPI
grid follows the 4/8 rhythm with `gap-3 sm:gap-4`.

**Dark-mode token set completed**

The `.dark` block defined only some tokens, so switching it on would have rendered a cream
`--color-primary-light` chip on a dark card, among other mismatches. `primary`,
`primary-foreground`, `primary-hover`, `primary-light`, `success`, `warning`, `body`,
`light-text`, `destructive-bg` and `input` are now all overridden with verified ratios.
The `.dark` class is not currently applied anywhere in the app; this only makes the block
internally consistent.

## Known gaps, not addressed here

- `min-h-screen` is used in 18 places against `min-h-dvh` in 5. On iOS Safari the `100vh`
  form overflows behind the collapsing address bar. Worth migrating, but it changes layout on
  many screens and needs per-page visual confirmation.
- Card padding has no single rhythm: `p-2` (41), `p-3` (117), `p-4` (232), `p-5` (105),
  `p-6` (36), `p-8` (9). A canonical scale would be `p-4` compact, `p-5` default and `p-6`
  feature cards, but that is a large sweep and should be done screen by screen.
- Roughly 15 hardcoded palette colors remain in components (`text-orange-700` x4,
  `text-amber-500` x2, plus `text-teal-500`, `text-pink-500`, `text-cyan-500`,
  `text-indigo-500`, `text-violet-500`, `text-orange-500`). They bypass the token system and
  should become semantic tokens.
- Two pre-existing lint warnings in touched files: `AIAssistant.tsx:142` calls `setState`
  synchronously inside an effect (cascading renders), and `auth-fuse.tsx:475` lists `router`
  as an unnecessary `useCallback` dependency.

## Validation

`npm run typecheck` clean; `npx eslint` over the eight changed files reported 0 errors (7
warnings, all pre-existing and on untouched lines); `npm test` exit 0; `npm run build`
exit 0. Confirmed in the compiled CSS chunk that the new values ship:
`--color-primary:#a44a2b`, `.text-primary-on-dark{color:#e8a98c}`,
`.hover\:bg-primary-hover:hover{#934026}`, `.border-success{#35704f}`,
`.border-warning{#8a5c27}` and `.hover-reveal`. Contrast ratios were computed from the token
values with the WCAG relative-luminance formula.

Files changed: `src/app/globals.css`, `src/components/ai/AIAssistant.tsx`,
`src/components/dashboard/DashboardView.tsx`, `src/components/dashboard/DashboardWidget.tsx`,
`src/components/dashboard/Sidebar.tsx`,
`src/components/dashboard/widgets/KPICard.tsx`,
`src/components/dashboard/widgets/RecentActivity.tsx`, `src/components/ui/auth-fuse.tsx`.

No SQL changes.
