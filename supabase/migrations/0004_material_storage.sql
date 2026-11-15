insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-materials',
  'course-materials',
  false,
  52428800,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "course teachers upload material objects" on storage.objects for insert
to authenticated
with check (
  bucket_id = 'course-materials'
  and public.teaches_course(((storage.foldername(name))[1])::uuid)
);

create policy "course members read material objects" on storage.objects for select
to authenticated
using (
  bucket_id = 'course-materials'
  and (
    public.teaches_course(((storage.foldername(name))[1])::uuid)
    or public.is_approved_student(((storage.foldername(name))[1])::uuid)
  )
);

create policy "course teachers update material objects" on storage.objects for update
to authenticated
using (
  bucket_id = 'course-materials'
  and public.teaches_course(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'course-materials'
  and public.teaches_course(((storage.foldername(name))[1])::uuid)
);

create policy "course teachers delete material objects" on storage.objects for delete
to authenticated
using (
  bucket_id = 'course-materials'
  and public.teaches_course(((storage.foldername(name))[1])::uuid)
);
