# Step 2 tests: UI redesign shell

**Branch:** `feature/ui-redesign-shell`  
**Status:** Automated gate passed locally; real-browser account checklist pending  
**Database impact:** None. No SQL or Supabase command is part of this batch.

## Automated coverage

- `src/lib/nav.test.ts` pins the exact `all`, `pinned`, and `more` navigation inventories for Admin, Co-Admin, and Member. It proves removing identity from the phone More sheet does not remove or reclassify any navigation item.
- The same test covers exact and nested active-route matching without sibling-prefix false positives.
- `src/components/shared/ui-regressions.test.tsx` continues to distinguish every route loading state and now checks the labeled Home action skeleton geometry.
- TypeScript was also checked directly with `tsc --noEmit` while integrating the Base UI menu.

## Command gate

- `npm test` — passed: 27 files, 267 tests.
- `npm run build` — passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` — passed with zero reported errors or warnings.

## Inspected contracts

- The avatar menu receives only the existing safe `CurrentUser` fields and renders full name, role, avatar, Settings, and Sign out. It does not receive or render email or another profile field.
- Phone Sign out remains a native `<form method="post" action="/auth/signout">`. The Base UI menu item renders the submit `<button>` itself, so there is no nested button or other nested interactive element.
- The Sign out item uses `closeOnClick={false}` so Base UI does not unmount the form before the browser starts its native POST navigation. Successful navigation to the existing sign-out route closes the menu with the page transition.
- CodeRabbit follow-up: the rendered submit button now sets Base UI 1.8.0's `nativeButton` prop. The installed `Menu.Item` and `useButton` sources confirm Enter is left to the browser's native button activation, while composite-menu Space dispatches one click on keydown and prevents the native keyup duplicate. Mouse/touch still use the button's native click; Escape, outside dismissal, and trigger focus return remain owned by the unchanged menu root and `FloatingFocusManager`.
- The desktop sidebar still uses `useSidebarCollapsed()`, including its existing local-storage key and expanded server snapshot, so the current choice remains remembered and the default stays expanded.
- Home retains its existing `requireUser()`, leadership lookup, RLS-scoped event query, event ordering, incomplete-task counts, links, and role conditions.

## Manual three-account checklist

These checks require real authenticated browser sessions and are not claimed complete by the automated gate.

- [ ] At desktop and phone widths, sign in as **Claudee** (Admin), **Claude HAAAA** (Co-Admin), and **tv** (Member). Confirm each account sees only its allowed navigation and Home actions.
- [ ] Confirm Create Event is a labeled primary button for Claudee and Claude HAAAA and is absent for tv. Confirm Home contains events only and Active/Draft event links and actions behave as before.
- [ ] Expand and collapse the desktop sidebar. Confirm expanded labels, collapsed accessible names/tooltips, active states, and the separate Sign out action; reload and confirm the saved collapsed/expanded choice remains.
- [ ] In both light and dark themes, verify the sidebar, desktop theme/avatar/full-name/role cluster, phone header, avatar menu, cards, badges, borders, muted text, primary/supporting/destructive buttons, skeletons, and focus rings have readable contrast.
- [ ] On a phone, open the avatar menu by tap and keyboard. Verify full name, role, Settings, and Sign out; verify no email or other profile field appears.
- [ ] From the phone avatar menu, activate **Sign out** by tap and keyboard. Confirm the existing native `POST /auth/signout` completes, the user reaches `/login`, the session is cleared, and the menu closes through navigation without cancelling the submit or producing a nested-interactive console/accessibility warning.
- [ ] Repeat keyboard Sign out separately with Enter and Space while watching the Network panel. Confirm each key produces exactly one `POST /auth/signout`, with no duplicate request.
- [ ] Verify Escape and outside press dismiss the avatar menu, focus returns to the avatar trigger, arrow-key navigation works, and Settings navigates successfully.
- [ ] Open the phone More sheet for all three roles and confirm every item expected by `navForRole()` remains present. Confirm the duplicate identity/sign-out block is gone and navigation still dismisses the sheet.
- [ ] Measure phone theme, avatar, menu actions, bottom tabs, and More controls; each target must be at least 44 by 44 CSS pixels.
- [ ] Check a narrow phone with long display names and both safe-area insets. Confirm the top and bottom bars clear the content, menu actions remain reachable, text truncates safely, and no page or menu creates horizontal overflow.
- [ ] Navigate through the Home loading state and the dashboard fallback. Confirm skeleton geometry matches the final header/cards, the loading label is announced, and reduced-motion settings suppress decorative animation.
- [ ] Confirm empty and error Home states remain distinct and do not reveal raw database errors.

## Changed files

- `src/app/(dashboard)/home/page.tsx`
- `src/app/(dashboard)/home/loading.tsx`
- `src/components/layout/app-shell.tsx`
- `src/components/layout/avatar-menu.tsx`
- `src/components/layout/desktop-header.tsx`
- `src/components/layout/desktop-sidebar.tsx`
- `src/components/layout/mobile-nav.tsx`
- `src/components/layout/mobile-topbar.tsx`
- `src/components/layout/user-card.tsx`
- `src/components/shared/page-skeleton.tsx`
- `src/components/shared/ui-regressions.test.tsx`
- `src/components/theme/theme-toggle.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/lib/nav.test.ts`
- `docs/phase-4b/step-2.md`
- `docs/phase-4b/step-2-tests.md`
- `docs/PROGRESS.md`
