# AGENTS.md - OP OWNER / TradeOS

Applies to the whole repository. See `ARCHITECTURE.md`, `PROJECT_CONTEXT.md` and
`docs/developer-guide.md` for system context, and `AI_RULES.md` for AI behaviour rules.
Design decisions and their measured evidence live in `docs/UI_UX_REVIEW_2026_09_23.md`.

## UI and design system

Read this before changing any component. These rules were derived from a measured audit,
not preference; deviating reintroduces accessibility regressions that were already fixed.

### Tokens are the only source of colour

All colour tokens live in `src/app/globals.css` under `@theme inline`. Never hardcode a hex
value and never use a raw Tailwind palette colour (`text-orange-700`, `bg-emerald-500`) in a
component. If you need a new shade, add a semantic token and reference it.

Contrast is a requirement, not a nicety:

- Body and label text must reach 4.5:1 against every background it can land on.
- `text-primary`, `text-success` and `text-warning` must stay readable on tints
  (`bg-primary-light`, `bg-muted`, `bg-primary/10`), which is the tightest case. They are
  currently `#a44a2b`, `#35704f` and `#8a5c27`; do not lighten them without recomputing
  contrast against `#eceae5` and `#f5ece7`.
- `text-primary` is for light surfaces only. On `--color-panel` or any dark fill, use
  `text-primary-on-dark`.
- `border-input` is the 3:1 UI boundary for form controls. `border-border` is decorative and
  intentionally light - do not use it for inputs or other controls whose boundary carries
  meaning.
- Filled buttons use `text-primary-foreground` on `bg-primary`; keep
  `--color-primary-hover` darker than `--color-primary`.

If you change a light token, mirror it in the `.dark` block. `.dark` is not currently
enabled, but the block must stay internally consistent.

### Focus is never removed

If you write `focus-visible:outline-none`, you must pair it with a visible indicator in the
same className, normally `focus-visible:ring-2 focus-visible:ring-ring`. Focusable controls
that render at `opacity-0` are a bug, because keyboard users can reach them while they are
invisible.

### Hover is never the only way to reach an action

Do not use `opacity-0 group-hover:opacity-100` on interactive content. Use the
`.hover-reveal` utility from `globals.css`, which hides only under
`@media (hover: hover) and (pointer: fine)` and also reveals on `:focus-within`.

### Touch targets

- Minimum 44x44 CSS px for anything tapped on a phone; 24x24 is the absolute floor for
  pointer-only icon buttons.
- Page content must render inside an element carrying the `responsive-content` class (see
  `src/components/dashboard/DashboardLayout.tsx`). That class enforces 44px minimum heights
  for buttons, selects and inputs on phones, and 16px form text so iOS does not zoom on
  focus.
- Content outside `responsive-content` - dialogs, the mobile navigation panel, sidebars -
  receives none of that, so those controls must set their own `min-h-11 min-w-11` on mobile.

### Spacing and type rhythm

- Stick to the 4/8px scale. Card padding: `p-4` compact, `p-5` default, `p-6` feature.
- Section rhythm on dashboard-style screens: `space-y-5`. Grid gaps: `gap-3 sm:gap-4`.
- Do not go below `text-[11px]` for labels and badges, and do not shrink body text.
- Currency and quantity figures that update in place need `tabular-nums` to avoid width
  jitter.
- Wide tables go in an `overflow-x-auto` wrapper; long ids and URLs need
  `overflow-wrap: anywhere` rather than `word-break: break-all`.

## Verifying a change

Before reporting UI work as done, run:

```
npm run typecheck
npx eslint <changed files>
npm test
npm run build
```

Report contrast claims as computed ratios against the specific background, not as
impressions.

## House rules

- Use `apply_patch` for edits.
- Do not commit `.claude/`, and keep `validation-reports/` output out of commits.
- Give any SQL the user must run in Supabase as plain text, and keep destructive or
  irreversible migrations out of the same batch as additive ones.
