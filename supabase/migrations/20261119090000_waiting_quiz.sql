-- One quiz per student per course can be written ahead of time and wait to be
-- handed out, so "Create quiz" opens instantly.
--   prepared_state null      : an ordinary quiz the student has received
--   prepared_state 'preparing': being written in the background
--   prepared_state 'waiting'  : written and checked, not yet handed out
alter table public.quizzes add column if not exists prepared_state text
  check (prepared_state is null or prepared_state in ('preparing', 'waiting'));
alter table public.quizzes add column if not exists difficulty_mode text;
alter table public.quizzes add column if not exists focus_concept text;
alter table public.quizzes add column if not exists prerequisite_concepts text[] not null default '{}';

-- Citations (with the verified quote) so a stored quiz can light the right line later.
alter table public.quiz_questions add column if not exists citations jsonb not null default '[]'::jsonb;

create unique index if not exists quizzes_one_waiting_per_student
  on public.quizzes (course_id, student_id) where prepared_state is not null;
