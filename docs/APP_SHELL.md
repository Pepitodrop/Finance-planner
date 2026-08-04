# Finance Planner application shell

`src/app/navigation.ts` is the sole destination model for the state-driven application. `ApplicationShell` renders that model as a persistent desktop sidebar, a compact tablet rail, and mobile bottom navigation with a focus-managed More sheet. URL routing and deep linking remain deliberately out of scope.

## Responsive ownership

- Mobile (`<= 768px`): Dashboard, Transactions, Goals, Connections, and More appear in the fixed bottom navigation. More contains Recurring, AI Categorisation, Finance Assistant, Receipt Review, and Data and Backup.
- Compact/tablet (`769px–1023px`): the same desktop destinations appear in an icon rail with accessible names and native title tooltips.
- Desktop (`>= 1024px`): the full labelled sidebar remains visible.
- Wide (`>= 1280px`): the sidebar receives a small spacing refinement; page layouts are unchanged.

Connections is intentionally a temporary mobile primary destination. It will be replaced by Accounts only after an Accounts page exists. Unsupported destinations such as Investments, Reports, Net Worth, and Settings are not exposed.

## Runtime ownership

The former DOM-observer navigation synchronizer, DOM-injected quick actions, query-parameter navigation, synthetic sidebar clicks, and swipe-to-change-page behavior were removed. `MobileExperience` retains viewport-keyboard measurement and passive image/idle enhancements only. Authentication, vault, providers, synchronization, PWA, service-worker, and Android behavior are not changed.

## Remaining legacy overlap

Page-specific responsive rules, legacy `.sidebar` declarations, page topbars, cards, charts, tables, and feature CSS remain for their dedicated redesign pull requests. `app-shell.css` is imported last so it owns current shell/navigation presentation without mechanically rewriting those page layers.
