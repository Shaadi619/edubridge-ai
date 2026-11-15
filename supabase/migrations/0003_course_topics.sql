create type public.topic_weight as enum ('high', 'medium', 'low');

create table public.course_topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  weight public.topic_weight not null default 'medium',
  created_at timestamptz not null default now(),
  unique (course_id, name)
);

create index course_topics_course_idx on public.course_topics(course_id);

create policy "course teachers delete courses" on public.courses for delete
  using (teacher_id = auth.uid() or public.current_user_role() = 'admin');

alter table public.course_topics enable row level security;

create policy "course members read topics" on public.course_topics for select
  using (
    public.teaches_course(course_id)
    or public.is_approved_student(course_id)
    or public.current_user_role() = 'admin'
  );

create policy "course teachers create topics" on public.course_topics for insert
  with check (public.teaches_course(course_id));

create policy "course teachers update topics" on public.course_topics for update
  using (public.teaches_course(course_id) or public.current_user_role() = 'admin')
  with check (public.teaches_course(course_id) or public.current_user_role() = 'admin');

create policy "course teachers delete topics" on public.course_topics for delete
  using (public.teaches_course(course_id) or public.current_user_role() = 'admin');
