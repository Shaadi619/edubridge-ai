alter table public.misconceptions
  add column if not exists occurrence_count integer not null default 1 check (occurrence_count >= 1),
  add column if not exists last_detected_at timestamptz not null default now();

create index if not exists misconceptions_open_student_concept_idx
  on public.misconceptions (course_id, student_id, status, lower(concept));
