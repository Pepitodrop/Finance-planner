# Finance Planner design foundation

`src/design-foundation.css` is the canonical source for shared visual tokens and low-level utilities. It is imported immediately after the original base stylesheet and before legacy feature/page styles. That position is deliberate: new work can use the foundation now, while existing page layers continue to own their current layouts until their scoped redesigns.

## Token usage

- Use `--fp-color-*` by semantic role. Do not use income green or expense red for category decoration.
- Use `--fp-color-chart-current` or a neutral for current/available projection segments and `--fp-color-chart-projection` for future projections.
- Use `--fp-space-*`, control heights, panel padding, radii and shadows instead of adding one-off values.
- Use the `--fp-z-*` layer scale for new overlays. Existing runtime layers retain legacy values until their behavior is migrated in a dedicated PR.
- Use `--fp-duration-*` and `--fp-ease-*` for restrained interaction feedback.
- Use `.fp-money` or `.fp-tabular-numbers` for monetary and other aligned numeric values.
- Use `.fp-safe-page` and `.fp-app-canvas` for new page shells. Do not apply them to existing pages until that page is intentionally migrated.
- Use `.fp-panel-surface` and `.fp-interactive-surface` only for genuinely shared surfaces; page-specific composition stays with the page.

## Responsive policy

The canonical viewport ranges for new work are:

| Range | Width |
| --- | --- |
| Mobile | up to 768px |
| Compact/tablet | 769px through 1023px |
| Desktop | 1024px and above |
| Wide refinement | 1280px and above |
| Maximum application canvas | 1600px |

CSS custom properties document these values, but media-query conditions use literal widths because custom properties are not valid in media-query expressions.

Legacy page and runtime styles still contain breakpoints at 390, 420, 480, 520, 560, 640, 680, 700, 720, 760, 820, 900, 980, 1050, 1100, 1180, 1250 and 1280px. They are intentionally unchanged here. Each page PR should remove or consolidate only the rules it takes ownership of.

## Accessibility and layers

The foundation supplies a visible focus ring, coarse-pointer target minimums, overflow-safe text defaults, safe-area values, reduced-motion handling and forced-colours fallbacks.

New layer assignments must use the semantic z-index scale. Do not translate existing arbitrary runtime values mechanically: fixed mobile navigation, connectivity, service-worker updates, drawers and dialogs need behavioral consolidation before their old layers can be removed safely.

## Scope boundary

This foundation does not redesign Dashboard, Transactions or any other page. It does not change navigation ownership, providers, authentication, vault behavior, cloud synchronization, service workers, Android delivery or financial calculations.
