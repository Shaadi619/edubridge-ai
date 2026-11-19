-- Show Your Work is opt-in per course. Teachers turn it on for courses where
-- students' written working is useful evidence; it is off by default.
alter table public.courses
  add column if not exists show_work_enabled boolean not null default false;

comment on column public.courses.show_work_enabled is
  'When true, approved students can submit photos or PDFs of their working for analysis.';
