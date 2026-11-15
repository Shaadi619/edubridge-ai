alter table public.course_topic_prerequisites
  add column if not exists source text not null default 'manual',
  add column if not exists reason text,
  add column if not exists confidence numeric(4,3),
  add column if not exists evidence jsonb not null default '[]'::jsonb;

alter table public.course_topic_prerequisites
  drop constraint if exists course_topic_prerequisites_source_check;
alter table public.course_topic_prerequisites
  add constraint course_topic_prerequisites_source_check check (source in ('manual', 'ai_suggested'));

alter table public.course_topic_prerequisites
  drop constraint if exists course_topic_prerequisites_confidence_check;
alter table public.course_topic_prerequisites
  add constraint course_topic_prerequisites_confidence_check
  check (confidence is null or confidence between 0 and 1);
