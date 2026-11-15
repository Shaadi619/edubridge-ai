create table if not exists public.course_announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180),
  body text not null check (char_length(body) between 1 and 5000),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists course_announcements_course_created_idx
  on public.course_announcements (course_id, created_at desc);

alter table public.course_announcements enable row level security;

create policy "course members read announcements" on public.course_announcements for select using (
  public.teaches_course(course_id) or public.is_approved_student(course_id)
);

create policy "teachers manage announcements" on public.course_announcements for all using (
  public.teaches_course(course_id)
) with check (
  public.teaches_course(course_id) and author_id = auth.uid()
);
