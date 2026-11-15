alter table public.misconceptions
  add column if not exists learning_status text not null default 'open'
    check (learning_status in ('open', 'improving', 'verified')),
  add column if not exists verified_at timestamptz;

create table if not exists public.misconception_verifications (
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

create index if not exists misconception_verifications_student_idx
  on public.misconception_verifications (student_id, course_id, created_at desc);

alter table public.misconception_verifications enable row level security;

create policy "students read own misconception verifications"
  on public.misconception_verifications for select
  using (student_id = auth.uid());

create policy "teachers read course misconception verifications"
  on public.misconception_verifications for select
  using (
    exists (
      select 1 from public.courses
      where courses.id = misconception_verifications.course_id
        and courses.teacher_id = auth.uid()
    )
  );

insert into public.student_concept_mastery (
  course_id, student_id, concept, mastery_score, confidence,
  open_misconceptions, last_practiced_at, review_due_at
)
select
  course_id, student_id, concept, 25, 0.35,
  count(*) :: integer, max(created_at), now() + interval '2 days'
from public.misconceptions
where learning_status <> 'verified'
group by course_id, student_id, concept
on conflict (course_id, student_id, concept) do update set
  open_misconceptions = excluded.open_misconceptions,
  review_due_at = excluded.review_due_at,
  updated_at = now();

update public.student_concept_mastery mastery
set
  open_misconceptions = evidence.open_count,
  mastery_score = greatest(
    0,
    case when mastery.total_answers = 0 then 25
      else round(mastery.correct_answers * 100.0 / mastery.total_answers, 2)
    end - least(evidence.open_count * 15, 30)
  ),
  review_due_at = now() + interval '2 days',
  updated_at = now()
from (
  select course_id, student_id, concept, count(*) :: integer as open_count
  from public.misconceptions
  where learning_status <> 'verified'
  group by course_id, student_id, concept
) evidence
where mastery.course_id = evidence.course_id
  and mastery.student_id = evidence.student_id
  and lower(mastery.concept) = lower(evidence.concept);
