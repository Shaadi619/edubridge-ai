alter table public.quiz_answers
  add column if not exists confidence smallint
    check (confidence is null or confidence between 1 and 3);

comment on column public.quiz_answers.confidence is
  'Student self-reported confidence before answer feedback: 1=not sure, 2=somewhat sure, 3=very sure.';

create index if not exists quiz_answers_confidence_gap_idx
  on public.quiz_answers (attempt_id, confidence)
  where confidence = 3 and is_correct = false;
