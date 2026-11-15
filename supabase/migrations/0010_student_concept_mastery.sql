create table if not exists public.student_concept_mastery (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  concept text not null,
  mastery_score numeric(5,2) not null default 0 check (mastery_score between 0 and 100),
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  correct_answers integer not null default 0 check (correct_answers >= 0),
  total_answers integer not null default 0 check (total_answers >= 0),
  open_misconceptions integer not null default 0 check (open_misconceptions >= 0),
  last_practiced_at timestamptz,
  review_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, student_id, concept)
);

create index if not exists student_concept_mastery_student_course_idx
  on public.student_concept_mastery (student_id, course_id, mastery_score);

alter table public.student_concept_mastery enable row level security;

create policy "students read own concept mastery" on public.student_concept_mastery
  for select using (student_id = auth.uid());

create policy "teachers read course concept mastery" on public.student_concept_mastery
  for select using (
    exists (
      select 1 from public.courses
      where courses.id = student_concept_mastery.course_id
        and courses.teacher_id = auth.uid()
    )
  );

with evidence as (
  select
    q.course_id,
    qa.student_id,
    qq.concept,
    count(*) filter (where ans.is_correct) :: integer as correct_answers,
    count(*) :: integer as total_answers,
    (
      select count(*) :: integer
      from public.misconceptions m
      where m.course_id = q.course_id
        and m.student_id = qa.student_id
        and lower(m.concept) = lower(qq.concept)
        and m.status = 'open'
    ) as open_misconceptions,
    max(ans.answered_at) as last_practiced_at
  from public.quiz_answers ans
  join public.quiz_attempts qa on qa.id = ans.attempt_id
  join public.quiz_questions qq on qq.id = ans.question_id
  join public.quizzes q on q.id = qa.quiz_id
  group by q.course_id, qa.student_id, qq.concept
), scored as (
  select *, greatest(
    0,
    round(correct_answers * 100.0 / total_answers, 2) - least(open_misconceptions * 15, 30)
  ) as mastery_score
  from evidence
)
insert into public.student_concept_mastery (
  course_id, student_id, concept, mastery_score, confidence,
  correct_answers, total_answers, open_misconceptions,
  last_practiced_at, review_due_at
)
select
  course_id, student_id, concept, mastery_score,
  least(0.95, total_answers / 6.0),
  correct_answers, total_answers, open_misconceptions,
  last_practiced_at,
  last_practiced_at + case
    when open_misconceptions > 0 or mastery_score < 60 then interval '2 days'
    when mastery_score < 85 then interval '7 days'
    else interval '14 days'
  end
from scored
on conflict (course_id, student_id, concept) do update set
  mastery_score = excluded.mastery_score,
  confidence = excluded.confidence,
  correct_answers = excluded.correct_answers,
  total_answers = excluded.total_answers,
  open_misconceptions = excluded.open_misconceptions,
  last_practiced_at = excluded.last_practiced_at,
  review_due_at = excluded.review_due_at,
  updated_at = now();

insert into public.student_concept_mastery (
  course_id, student_id, concept, mastery_score, confidence,
  open_misconceptions, last_practiced_at, review_due_at
)
select
  course_id, student_id, concept, 25, 0.35,
  count(*) :: integer, max(created_at), max(created_at) + interval '2 days'
from public.misconceptions
where status = 'open'
group by course_id, student_id, concept
on conflict (course_id, student_id, concept) do nothing;
