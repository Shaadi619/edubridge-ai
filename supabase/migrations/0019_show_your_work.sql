insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-work',
  'student-work',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.work_submissions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  filename text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size integer not null check (byte_size between 1 and 8388608),
  context text not null,
  status text not null default 'analyzing' check (status in ('analyzing', 'analyzed', 'failed')),
  analysis jsonb,
  processing_error text,
  review_status text not null default 'not_required' check (review_status in ('not_required', 'pending', 'approved', 'dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  misconception_id uuid references public.misconceptions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_submissions_student_idx
  on public.work_submissions (student_id, course_id, created_at desc);
create index if not exists work_submissions_teacher_review_idx
  on public.work_submissions (course_id, review_status, created_at desc);

alter table public.work_submissions enable row level security;

create policy "students read own work submissions" on public.work_submissions for select
  using (student_id = auth.uid() and public.is_approved_student(course_id));
create policy "teachers read course work submissions" on public.work_submissions for select
  using (public.teaches_course(course_id));

create policy "students upload own work objects" on storage.objects for insert to authenticated
with check (
  bucket_id = 'student-work'
  and public.is_approved_student(((storage.foldername(name))[1])::uuid)
  and (storage.foldername(name))[2] = auth.uid()::text
);
create policy "students and teachers read work objects" on storage.objects for select to authenticated
using (
  bucket_id = 'student-work'
  and (
    ((storage.foldername(name))[2] = auth.uid()::text and public.is_approved_student(((storage.foldername(name))[1])::uuid))
    or public.teaches_course(((storage.foldername(name))[1])::uuid)
  )
);

create or replace function public.touch_work_submission_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_work_submission_updated_at on public.work_submissions;
create trigger set_work_submission_updated_at
before update on public.work_submissions
for each row execute procedure public.touch_work_submission_updated_at();
