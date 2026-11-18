# Authentication setup

## Supabase project

1. Create a Supabase project.
2. Run the SQL files in `supabase/migrations` in numeric order.
3. In Authentication settings, set the site URL to the frontend URL. For local
   development use `http://localhost:5173`.
4. Add `http://localhost:5173` to allowed redirect URLs.
5. Keep email verification enabled for non-demo environments.

## Frontend environment

Create `apps/web/.env`:

```dotenv
VITE_API_URL=http://localhost:8000/api/v1
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

The publishable/anon key is designed for browser use. Never put the service-role
key in a `VITE_` variable.

## API environment

Create a root `.env` from `.env.example` and set `SUPABASE_URL`. Modern Supabase
projects publish signing keys through JWKS, so `SUPABASE_JWT_SECRET` normally stays
empty. The service-role key will be added later for trusted ingestion operations
and must remain server-only.

## Account behavior

- Student signups receive the `student` role.
- Teacher signups receive the `teacher` role with no approval timestamp.
- Unapproved teachers can authenticate but only see the approval-pending screen.
- An administrator promotes a teacher by setting `teacher_approved_at`.
- Database row-level security remains the source of authorization truth.
- Routine session renewal updates the in-memory token without reloading the
  dashboard. A sign-in identity change still rechecks the profile and role.
- Student quiz drafts are scoped to the signed-in account and course in the
  current browser tab. They survive navigation and reload, expire after a day
  without being accessed, and are cleared on explicit sign-out. They do not
  sync between tabs or devices. Graded submissions are saved on the server.
- Course Q&A restores the user's latest saved conversation in the approved
  course. Chat history is loaded from the API, not stored in browser drafts.

