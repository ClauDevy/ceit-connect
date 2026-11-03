# UI polish pass

Owner-approved pre-presentation UI-only work on `feature/ui-polish`. The complete Claude visual pass stays: circular theme reveal, smoother shared motion, auth alert and revised login presentation/copy, Event Management tiles, progress visibility fixes, and page entrances.

## Protected behavior

- No migration, Supabase command, route, reader, writer, data-shape, permission, or RLS change.
- Sign-in, magic-link, password-reset, Google, and invite-only behavior/copy stay unchanged. A new attempt suppresses the server-provided initial alert, and dismissing a current error cannot reveal it again. Magic-link settlement always clears its busy state.
- Desktop `TigerMascot` size 200 and phone sizes 104/60 all keep `mark`; each rendered layout exposes one labelled mascot treatment to assistive technology.
- Event-board lane observation continues to depend on `hasTasks` and `query.isPending`; phase/completion/DnD dependencies intentionally rebuild the disconnected observer when its board node changes.
- Sortable task wrappers replay opacity only. Eligible non-sortable items keep opacity/transform replay, and dnd-kit's transform remains authoritative.

## Motion contract

Owner-approved amendment: 520 ms entrances, 450 ms panels/disclosures, 320 ms interactions/exits, and 1100 ms determinate progress. CSS/TypeScript duration parity is automated. Reduced motion disables all decorative and spatial animation while exposing final states immediately.

## Gate

Run only `npx.cmd tsc --noEmit`, `npm.cmd run test`, and `npm.cmd run lint`. Browser-check login alerts and all sign-in paths, responsive mascot/hero layout, theme switching, event-board phase replay/drag, progress reveals, Event Management, and reduced motion. No build or Supabase command.

Local result: all 991 tests across 90 files and lint pass. The CSS/TypeScript duration parity test reports no mismatch. Direct TypeScript checking reaches only the known missing Next-generated `PageProps`/`LayoutProps` globals while `.next` is absent; no build or type-generation command was run.
