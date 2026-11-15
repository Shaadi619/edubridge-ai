create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
begin
  requested_role := case
    when new.raw_user_meta_data ->> 'requested_role' = 'teacher' then 'teacher'::public.user_role
    else 'student'::public.user_role
  end;

  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    requested_role,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'New user')
  );
  return new;
end;
$$;

