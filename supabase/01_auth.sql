-- =====================================================================
-- FORJA · 01 · SOLO AUTENTICACIÓN
-- Ejecuta este archivo PRIMERO en Supabase → SQL Editor → New query.
-- Es seguro ejecutarlo varias veces (idempotente).
--
-- Qué hace: perfil público de cada cuenta (tabla `profiles`) enlazado a
-- `auth.users`, creado automáticamente al registrarse, con RLS.
-- Todo lo demás (tareas, estudio, juegos, dispositivos…) está en 02_app.sql.
-- =====================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  username     text,
  display_name text,
  avatar_url   text,
  color        text not null default '#7c5cff',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_]{3,24}$')
);

create unique index if not exists profiles_username_key on public.profiles (lower(username));
create index if not exists profiles_email_idx on public.profiles (lower(email));

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Crea el perfil al registrarse (correo, Google, GitHub, enlace mágico…)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    split_part(coalesce(new.email, 'usuario'), '@', 1)
  );
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    lower(new.email),
    v_name,
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantiene el correo del perfil sincronizado si la cuenta lo cambia
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Perfiles de cuentas que ya existieran antes de ejecutar este archivo
insert into public.profiles (id, email, display_name)
select u.id, lower(u.email), split_part(coalesce(u.email, 'usuario'), '@', 1)
from auth.users u
on conflict (id) do nothing;

-- Seguridad (RLS): cada persona ve y edita SOLO su propio perfil.
-- (02_app.sql añade la política para ver a tus compañeros de estudio/proyecto.)
alter table public.profiles enable row level security;

drop policy if exists "profiles: ver el propio" on public.profiles;
create policy "profiles: ver el propio" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "profiles: editar el propio" on public.profiles;
create policy "profiles: editar el propio" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Solo se pueden editar estas columnas desde la app (el correo lo gestiona Auth)
revoke update on public.profiles from authenticated, anon;
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_url, color) on public.profiles to authenticated;
