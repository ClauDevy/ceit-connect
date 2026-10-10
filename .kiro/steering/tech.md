# Technology Stack — CEIT Connect

(Security and workflow rules are in the root `AGENTS.md` — do not repeat them here.)

- **Framework:** Next.js 16.3 App Router, React 19, TypeScript. Server Components by default. `src/proxy.ts` (Next 16's renamed middleware) only refreshes the Supabase session.
- **Styling:** Tailwind v4 with CSS-first config in `src/app/globals.css`; shadcn-style components in `src/components/ui`; Base UI primitives; Lucide icons. Semantic color tokens only (OKLCH variables), light and dark.
- **Data:** Supabase (Postgres + Auth + Storage + RLS). Clients: `src/lib/supabase/client.ts` (browser), `server.ts` (`createClient`, and `createServiceRoleClient` for server-only admin work). Auth helpers in `src/lib/auth.ts` (`requireUser` for "logged in", `getActiveProfileForRoles` for role + `is_active` checks).
- **Client libs:** React Query, react-hook-form + zod, zustand, dnd-kit, react-easy-crop, browser-image-compression, react-mentions, date-fns.
- **Hosting:** Vercel (auto-deploys `main`). Two Supabase projects: Dev (local `.env.local`) and Prod (live).
- **Email:** Supabase custom SMTP via a Gmail App Password (interim).
- **Package manager:** npm. Commands: `npm run dev`, `npm run build`, `npm run lint`, `npx supabase migration new <n>`.
- **OS/shell the owner uses:** Windows with Git Bash and VSCode.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL` (bare project URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `ALLOWED_EMAIL_DOMAINS`.