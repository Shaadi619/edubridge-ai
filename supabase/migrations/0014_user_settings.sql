alter table public.profiles
  add column if not exists headline text,
  add column if not exists organization text;

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create or replace function public.touch_user_preferences_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop policy if exists "users read own preferences" on public.user_preferences;
create policy "users read own preferences"
  on public.user_preferences for select
  using (user_id = auth.uid());

drop policy if exists "users create own preferences" on public.user_preferences;
create policy "users create own preferences"
  on public.user_preferences for insert
  with check (user_id = auth.uid());

drop policy if exists "users update own preferences" on public.user_preferences;
create policy "users update own preferences"
  on public.user_preferences for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists set_user_preferences_updated_at on public.user_preferences;
create trigger set_user_preferences_updated_at
before update on public.user_preferences
for each row execute procedure public.touch_user_preferences_updated_at();
