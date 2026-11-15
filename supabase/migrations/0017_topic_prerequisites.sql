create table if not exists public.course_topic_prerequisites (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  topic_id uuid not null references public.course_topics(id) on delete cascade,
  prerequisite_topic_id uuid not null references public.course_topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (topic_id <> prerequisite_topic_id),
  unique (course_id, topic_id, prerequisite_topic_id)
);

create index if not exists topic_prerequisites_course_idx
  on public.course_topic_prerequisites (course_id);

create or replace function public.validate_topic_prerequisite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.course_topics where id = new.topic_id and course_id = new.course_id)
     or not exists (select 1 from public.course_topics where id = new.prerequisite_topic_id and course_id = new.course_id) then
    raise exception 'Both topics must belong to the selected course';
  end if;

  if exists (
    with recursive ancestors(topic_id) as (
      select new.prerequisite_topic_id
      union
      select link.prerequisite_topic_id
      from public.course_topic_prerequisites link
      join ancestors on link.topic_id = ancestors.topic_id
      where link.course_id = new.course_id
    )
    select 1 from ancestors where topic_id = new.topic_id
  ) then
    raise exception 'This prerequisite would create a cycle';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_topic_prerequisite_trigger on public.course_topic_prerequisites;
create trigger validate_topic_prerequisite_trigger
before insert or update on public.course_topic_prerequisites
for each row execute procedure public.validate_topic_prerequisite();

alter table public.course_topic_prerequisites enable row level security;

create policy "course members read prerequisites"
  on public.course_topic_prerequisites for select
  using (
    public.teaches_course(course_id)
    or public.is_approved_student(course_id)
    or public.current_user_role() = 'admin'
  );

create policy "course teachers create prerequisites"
  on public.course_topic_prerequisites for insert
  with check (public.teaches_course(course_id));

create policy "course teachers delete prerequisites"
  on public.course_topic_prerequisites for delete
  using (public.teaches_course(course_id) or public.current_user_role() = 'admin');
