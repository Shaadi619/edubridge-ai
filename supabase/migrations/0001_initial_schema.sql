create extension if not exists pgcrypto;
create extension if not exists vector;

create type public.user_role as enum ('admin', 'teacher', 'student');
create type public.enrollment_status as enum ('pending', 'approved', 'denied');
create type public.material_status as enum ('uploaded', 'processing', 'ready', 'failed');
create type public.misconception_status as enum ('open', 'addressed', 'dismissed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'student',
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_url text,
  teacher_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  subject text not null,
  description text,
  enrollment_code text not null unique,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status public.enrollment_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (course_id, student_id)
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  storage_path text not null unique,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  page_count integer check (page_count is null or page_count >= 0),
  status public.material_status not null default 'uploaded',
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  page_number integer check (page_number is null or page_number >= 1),
  content text not null,
  token_count integer check (token_count is null or token_count >= 0),
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (material_id, chunk_index)
);

create index material_chunks_course_idx on public.material_chunks(course_id);
create index material_chunks_embedding_idx on public.material_chunks
  using hnsw (embedding vector_cosine_ops);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_role text not null check (author_role in ('student', 'assistant')),
  content text not null,
  grounded boolean,
  model_tier text check (model_tier is null or model_tier in ('fast', 'reasoning')),
  created_at timestamptz not null default now()
);

create table public.message_citations (
  message_id uuid not null references public.messages(id) on delete cascade,
  chunk_id uuid not null references public.material_chunks(id) on delete restrict,
  quote_start integer,
  quote_end integer,
  primary key (message_id, chunk_id)
);

create table public.misconceptions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  source_message_id uuid references public.messages(id) on delete set null,
  concept text not null,
  label text not null,
  explanation text not null,
  student_evidence text not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  recommended_intervention text,
  status public.misconception_status not null default 'open',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  target_concepts text[] not null default '{}',
  created_by text not null check (created_by in ('ai', 'teacher')),
  created_at timestamptz not null default now()
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position integer not null check (position >= 0),
  prompt text not null,
  options jsonb not null,
  correct_option integer not null check (correct_option >= 0),
  explanation text not null,
  concept text not null,
  difficulty integer not null check (difficulty between 1 and 5),
  unique (quiz_id, position)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score numeric(5,2) check (score is null or score between 0 and 100),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.quiz_answers (
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  selected_option integer,
  free_text_reasoning text,
  is_correct boolean,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.teacher_insights (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  summary text not null,
  evidence jsonb not null default '[]',
  recommended_actions jsonb not null default '[]',
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now()
);

create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    'student',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'New student')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create function public.protect_profile_authorization_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and public.current_user_role() <> 'admin' then
    new.role := old.role;
    new.teacher_approved_at := old.teacher_approved_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger protect_profile_authorization_fields
before update on public.profiles
for each row execute procedure public.protect_profile_authorization_fields();

create function public.teaches_course(requested_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.courses
    where id = requested_course_id and teacher_id = auth.uid()
  )
$$;

create function public.is_approved_student(requested_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.enrollments
    where course_id = requested_course_id
      and student_id = auth.uid()
      and status = 'approved'
  )
$$;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.materials enable row level security;
alter table public.material_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_citations enable row level security;
alter table public.misconceptions enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.teacher_insights enable row level security;

create policy "profile self read" on public.profiles for select using (id = auth.uid());
create policy "profile self update" on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid());
create policy "admins manage profiles" on public.profiles for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "course members read courses" on public.courses for select using (
  teacher_id = auth.uid() or public.is_approved_student(id) or public.current_user_role() = 'admin'
);
create policy "approved teachers create courses" on public.courses for insert with check (
  teacher_id = auth.uid() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'teacher' and p.teacher_approved_at is not null
  )
);
create policy "course teachers manage courses" on public.courses for update
  using (teacher_id = auth.uid() or public.current_user_role() = 'admin');

create policy "students request and read own enrollment" on public.enrollments for select
  using (student_id = auth.uid() or public.teaches_course(course_id) or public.current_user_role() = 'admin');
create policy "students request enrollment" on public.enrollments for insert
  with check (student_id = auth.uid() and status = 'pending');
create policy "teachers review enrollment" on public.enrollments for update
  using (public.teaches_course(course_id) or public.current_user_role() = 'admin');

create policy "course members read materials" on public.materials for select
  using (public.teaches_course(course_id) or public.is_approved_student(course_id));
create policy "teachers manage materials" on public.materials for all
  using (public.teaches_course(course_id)) with check (public.teaches_course(course_id));
create policy "course members read chunks" on public.material_chunks for select
  using (public.teaches_course(course_id) or public.is_approved_student(course_id));

create policy "students manage own conversations" on public.conversations for all
  using (student_id = auth.uid() and public.is_approved_student(course_id))
  with check (student_id = auth.uid() and public.is_approved_student(course_id));
create policy "teachers read course conversations" on public.conversations for select
  using (public.teaches_course(course_id));
create policy "conversation participants read messages" on public.messages for select using (
  exists (select 1 from public.conversations c where c.id = conversation_id and
    (c.student_id = auth.uid() or public.teaches_course(c.course_id)))
);

create policy "students read own misconceptions" on public.misconceptions for select
  using (student_id = auth.uid());
create policy "teachers manage course misconceptions" on public.misconceptions for all
  using (public.teaches_course(course_id));

create policy "course members read quizzes" on public.quizzes for select using (
  public.teaches_course(course_id) or
  (public.is_approved_student(course_id) and (student_id is null or student_id = auth.uid()))
);
create policy "students read own attempts" on public.quiz_attempts for select
  using (student_id = auth.uid());
create policy "teachers read course attempts" on public.quiz_attempts for select using (
  exists (select 1 from public.quizzes q where q.id = quiz_id and public.teaches_course(q.course_id))
);
create policy "teachers read insights" on public.teacher_insights for select
  using (public.teaches_course(course_id) or public.current_user_role() = 'admin');

-- Message/question writes and ingestion writes go through the API service role.
-- The service validates course membership before bypassing RLS.
