# CEIT Connect

CEIT Connect is the task delegation and tracking system for the CEIT Student Council of Cavite State University. The production site is [ceitconnect.site](https://ceitconnect.site).

## Tech stack

- Next.js 16.3.4 and React 19.2.8
- TypeScript `^5` and Tailwind CSS `^4`
- Supabase JS `^2.116.0` with Postgres, Auth, and Row Level Security
- Vitest `^3.2.4`
- Web Push 3.6.7

## Main features

- Event planning and task boards
- Admin, Co-Admin, and Member roles
- Committee-based work coordination
- Activity log
- In-app notifications and optional device push notifications
- In-app help at `/help`

## Getting started

1. Install dependencies with `npm install`.
2. Create `.env.local` and request the real values from the project owner.
3. Start the development server with `npm run dev`.

The application uses exactly these environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server only
- `ALLOWED_EMAIL_DOMAINS` — server only
- `NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY`
- `PUSH_VAPID_PRIVATE_KEY` — server only
- `PUSH_VAPID_SUBJECT` — server only
- `PUSH_DB_CAPABILITY` — server only
- `PUSH_WAKE_SECRET` — server only

Do not commit `.env.local` or share its values.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build |
| `npm run start` | Run the production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run the Vitest suite |

## Project layout

- `src/app/` — App Router pages and API routes
- `src/components/` — shared and feature UI
- `src/lib/` — application logic and integrations
- `supabase/migrations/` — tracked database migrations
- `docs/` — architecture, plans, progress, and operating notes

Start with [PROGRESS](docs/PROGRESS.md), then consult [ARCHITECTURE](docs/ARCHITECTURE.md), [DATABASE](docs/DATABASE.md), [GOTCHAS](docs/GOTCHAS.md), [BACKUP](docs/BACKUP.md), and [AGENTS](AGENTS.md).

## Working rules

- Every database change is a new tracked file in `supabase/migrations/`.
- The owner applies migrations; an applied migration is never edited.
- Users are deactivated or anonymized, never hard-deleted.
- Service-role access stays in verified server-only boundaries; it is never a shortcut around authorization.

## Credits

Built by eduCache.on.

© 2026 CEIT Student Council, Cavite State University. All rights reserved.

Read the [Draft Terms](https://ceitconnect.site/terms).

## License

[license to be confirmed]
