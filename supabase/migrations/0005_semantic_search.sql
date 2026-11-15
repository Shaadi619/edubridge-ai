create or replace function public.match_course_material_chunks(
  query_embedding vector(1536),
  target_course_id uuid,
  match_count integer default 6
)
returns table (
  chunk_id uuid,
  material_id uuid,
  material_title text,
  page_number integer,
  content text,
  similarity double precision
)
language sql stable security definer set search_path = public
as $$
  select mc.id, mc.material_id, m.title, mc.page_number, mc.content,
    1 - (mc.embedding <=> query_embedding) as similarity
  from public.material_chunks mc
  join public.materials m on m.id = mc.material_id
  where mc.course_id = target_course_id
    and mc.embedding is not null
    and m.status = 'ready'
  order by mc.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 12)
$$;

revoke all on function public.match_course_material_chunks(vector, uuid, integer) from public, anon, authenticated;
grant execute on function public.match_course_material_chunks(vector, uuid, integer) to service_role;
