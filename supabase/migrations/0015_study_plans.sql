create table if not exists public.study_plan_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  concept text not null,
  concept_key text not null,
  action text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  source text not null check (source in ('misconception', 'retention', 'mastery')),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  evidence_version integer not null default 0 check (evidence_version >= 0),
  due_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, student_id, concept_key)
);

create index if not exists study_plan_student_course_idx
  on public.study_plan_items (student_id, course_id, status, due_at);
create index if not exists study_plan_teacher_overdue_idx
  on public.study_plan_items (course_id, status, due_at);

alter table public.study_plan_items enable row level security;

create policy "students read own study plan"
  on public.study_plan_items for select
  using (student_id = auth.uid() and public.is_approved_student(course_id));

create policy "students update own study plan"
  on public.study_plan_items for update
  using (student_id = auth.uid() and public.is_approved_student(course_id))
  with check (student_id = auth.uid() and public.is_approved_student(course_id));

create policy "teachers read course study plans"
  on public.study_plan_items for select
  using (public.teaches_course(course_id));

create or replace function public.touch_study_plan_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_study_plan_updated_at on public.study_plan_items;
create trigger set_study_plan_updated_at
before update on public.study_plan_items
for each row execute procedure public.touch_study_plan_updated_at();
