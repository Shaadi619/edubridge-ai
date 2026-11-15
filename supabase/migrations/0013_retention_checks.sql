alter table public.misconceptions
  add column if not exists retention_status text not null default 'not_scheduled'
    check (retention_status in ('not_scheduled', 'scheduled', 'due', 'retained', 'needs_review')),
  add column if not exists retention_due_at timestamptz,
  add column if not exists retained_at timestamptz;

create table if not exists public.retention_checks (
  id uuid primary key default gen_random_uuid(),
  misconception_id uuid not null references public.misconceptions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  question text not null,
  evidence jsonb not null default '[]',
  student_response text,
  verdict text check (verdict is null or verdict in ('still_present', 'improving', 'corrected')),
  feedback text,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists retention_checks_student_course_idx
  on public.retention_checks (student_id, course_id, created_at desc);

alter table public.retention_checks enable row level security;

create policy "students read own retention checks"
  on public.retention_checks for select
  using (student_id = auth.uid());

create policy "teachers read course retention checks"
  on public.retention_checks for select
  using (
    exists (
      select 1 from public.courses
      where courses.id = retention_checks.course_id
        and courses.teacher_id = auth.uid()
    )
  );

update public.misconceptions
set retention_status = 'due', retention_due_at = now()
where learning_status = 'verified'
  and retention_status = 'not_scheduled';
