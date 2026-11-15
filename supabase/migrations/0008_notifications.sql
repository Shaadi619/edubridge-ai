create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  type text not null check (type in ('enroll', 'flag', 'quiz', 'misconception', 'announcement')),
  title text not null,
  body text not null,
  metadata jsonb not null default '{}',
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc) where dismissed_at is null;

alter table public.notifications enable row level security;

create policy "users read own notifications" on public.notifications for select using (recipient_id = auth.uid());
create policy "users update own notifications" on public.notifications for update using (recipient_id = auth.uid());
