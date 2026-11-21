-- =====================================================================
-- FORJA · 02 · TODO EXCEPTO AUTENTICACIÓN
-- Ejecuta este archivo DESPUÉS de 01_auth.sql (SQL Editor → New query).
-- Es seguro ejecutarlo varias veces (idempotente).
--
-- Contiene: estudio y colaboradores, proyectos/tareas (estilo Trello),
-- comentarios y chat, juegos, dispositivos (3DS / PC), almacenamiento,
-- seguridad por filas (RLS) y permisos de Realtime.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · TABLAS
-- ---------------------------------------------------------------------

-- Estudio (tu "cuenta de estudio"). Sus miembros gestionan TODO el estudio.
create table if not exists public.studios (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.studio_members (
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','admin','member')),
  added_at  timestamptz not null default now(),
  primary key (studio_id, user_id)
);
create index if not exists studio_members_user_idx on public.studio_members (user_id);

create table if not exists public.studio_invites (
  id         uuid primary key default gen_random_uuid(),
  studio_id  uuid not null references public.studios(id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('admin','member')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists studio_invites_uniq on public.studio_invites (studio_id, lower(email));

-- Proyectos de Tareas
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studios(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  color       text not null default '#7c5cff',
  archived    boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_studio_idx on public.projects (studio_id);

-- Colaboradores SOLO de un proyecto (no son del estudio)
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'editor' check (role in ('editor','viewer')),
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

create table if not exists public.project_invites (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email      text not null,
  role       text not null default 'editor' check (role in ('editor','viewer')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists project_invites_uniq on public.project_invites (project_id, lower(email));

create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  position   double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists lists_project_idx on public.lists (project_id);

create table if not exists public.cards (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  list_id      uuid not null references public.lists(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 300),
  description  text not null default '',
  position     double precision not null default 0,
  due_date     timestamptz,
  completed    boolean not null default false,
  completed_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cards_project_idx on public.cards (project_id);
create index if not exists cards_list_idx on public.cards (list_id);

create table if not exists public.project_labels (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null default '',
  color      text not null default '#7c5cff'
);
create index if not exists project_labels_project_idx on public.project_labels (project_id);

create table if not exists public.card_labels (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  label_id   uuid not null references public.project_labels(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  unique (card_id, label_id)
);
create index if not exists card_labels_project_idx on public.card_labels (project_id);

create table if not exists public.card_assignees (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  unique (card_id, user_id)
);
create index if not exists card_assignees_project_idx on public.card_assignees (project_id);
create index if not exists card_assignees_user_idx on public.card_assignees (user_id);

create table if not exists public.card_checklist (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 300),
  done       boolean not null default false,
  position   double precision not null default 0
);
create index if not exists card_checklist_project_idx on public.card_checklist (project_id);

create table if not exists public.card_comments (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index if not exists card_comments_project_idx on public.card_comments (project_id);
create index if not exists card_comments_card_idx on public.card_comments (card_id);

-- Chat del proyecto
create table if not exists public.project_messages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists project_messages_project_idx on public.project_messages (project_id, created_at);

-- Actividad (se rellena sola con triggers)
create table if not exists public.activity (
  id         uuid primary key default gen_random_uuid(),
  studio_id  uuid not null references public.studios(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  kind       text not null,
  title      text not null default '',
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_studio_idx on public.activity (studio_id, created_at desc);
create index if not exists activity_project_idx on public.activity (project_id, created_at desc);

-- Dispositivos: 3DS y PC (el "bridge" de bridge/ los atiende)
create table if not exists public.devices (
  id        uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 80),
  kind      text not null check (kind in ('3ds','pc')),
  config    jsonb not null default '{}'::jsonb,   -- 3DS: {ip, ftp_port, ftp_user, ftp_pass, input_port}
  info      jsonb not null default '{}'::jsonb,   -- lo rellena el bridge (SO, versión…)
  last_seen timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists devices_studio_idx on public.devices (studio_id);

-- Cola de órdenes app → bridge (listar carpetas, descargar, subir…)
create table if not exists public.device_commands (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices(id) on delete cascade,
  studio_id   uuid not null references public.studios(id) on delete cascade,
  issued_by   uuid references public.profiles(id) on delete set null,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending','running','done','error')),
  result      jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists device_commands_device_idx on public.device_commands (device_id, created_at desc);

-- Juegos del estudio
create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studios(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  platform    text not null default 'pc' check (platform in ('pc','3ds','switch','mobile','web','other')),
  status      text not null default 'dev' check (status in ('idea','dev','alpha','beta','released','paused')),
  description text not null default '',
  cover_url   text,
  version     text not null default '',
  repo_url    text not null default '',
  store_url   text not null default '',
  pc_path     text not null default '',            -- ruta en el PC (relativa a las raíces del bridge)
  device_id   uuid references public.devices(id) on delete set null,
  project_id  uuid references public.projects(id) on delete set null,  -- sincronizado con Tareas
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists games_studio_idx on public.games (studio_id);
create index if not exists games_project_idx on public.games (project_id);

-- ---------------------------------------------------------------------
-- 1 · FUNCIONES DE PERMISOS (usadas por RLS)
-- ---------------------------------------------------------------------

create or replace function public.is_studio_member(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.studio_members where studio_id = sid and user_id = auth.uid())
$$;

create or replace function public.is_studio_admin(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.studio_members
                 where studio_id = sid and user_id = auth.uid() and role in ('owner','admin'))
$$;

create or replace function public.can_access_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p
                 join public.studio_members m on m.studio_id = p.studio_id
                 where p.id = pid and m.user_id = auth.uid())
      or exists (select 1 from public.project_members pm where pm.project_id = pid and pm.user_id = auth.uid())
$$;

-- OJO: la política SELECT de projects no puede consultar projects (INSERT ... RETURNING
-- no vería la fila nueva), por eso usa is_studio_member(studio_id) + esta función.
create or replace function public.is_project_member(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = pid and user_id = auth.uid())
$$;

create or replace function public.can_edit_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p
                 join public.studio_members m on m.studio_id = p.studio_id
                 where p.id = pid and m.user_id = auth.uid())
      or exists (select 1 from public.project_members pm
                 where pm.project_id = pid and pm.user_id = auth.uid() and pm.role = 'editor')
$$;

create or replace function public.can_access_device(did uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.devices d
                 join public.studio_members m on m.studio_id = d.studio_id
                 where d.id = did and m.user_id = auth.uid())
$$;

-- ¿Comparto estudio o proyecto con esta persona? (para ver su perfil)
create or replace function public.shares_context(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.studio_members a
            join public.studio_members b on b.studio_id = a.studio_id
            where a.user_id = auth.uid() and b.user_id = other)
    or exists (select 1 from public.project_members pm
               where pm.user_id = other and public.can_access_project(pm.project_id))
    or exists (select 1 from public.project_members mine
               join public.projects p on p.id = mine.project_id
               join public.studio_members sm on sm.studio_id = p.studio_id
               where mine.user_id = auth.uid() and sm.user_id = other)
    or exists (select 1 from public.project_members mine
               join public.project_members theirs on theirs.project_id = mine.project_id
               where mine.user_id = auth.uid() and theirs.user_id = other)
$$;

-- Permisos de canales privados de Realtime: "device:<uuid>" y "project:<uuid>"
create or replace function public.rt_topic_allowed(topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if topic ~ '^device:[0-9a-f-]{36}$' then
    v_id := substring(topic from 8)::uuid;
    return public.can_access_device(v_id);
  elsif topic ~ '^project:[0-9a-f-]{36}$' then
    v_id := substring(topic from 9)::uuid;
    return public.can_access_project(v_id);
  end if;
  return false;
exception when others then
  return false;
end $$;

-- ---------------------------------------------------------------------
-- 2 · TRIGGERS
-- ---------------------------------------------------------------------

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
drop trigger if exists cards_updated_at on public.cards;
create trigger cards_updated_at before update on public.cards
  for each row execute function public.set_updated_at();
drop trigger if exists games_updated_at on public.games;
create trigger games_updated_at before update on public.games
  for each row execute function public.set_updated_at();

-- Un colaborador de proyecto no puede mover el proyecto a otro estudio
create or replace function public.lock_studio_id()
returns trigger language plpgsql as $$
begin
  if new.studio_id is distinct from old.studio_id then
    raise exception 'studio_id no se puede cambiar';
  end if;
  return new;
end $$;
drop trigger if exists projects_lock_studio on public.projects;
create trigger projects_lock_studio before update on public.projects
  for each row execute function public.lock_studio_id();
drop trigger if exists games_lock_studio on public.games;
create trigger games_lock_studio before update on public.games
  for each row execute function public.lock_studio_id();

-- project_id de los hijos de una tarjeta siempre sale de la tarjeta
create or replace function public.sync_project_from_card()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.cards where id = new.card_id;
  if new.project_id is null then
    raise exception 'tarjeta no encontrada';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['card_labels','card_assignees','card_checklist','card_comments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sync_project', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.sync_project_from_card()',
                   t || '_sync_project', t);
  end loop;
end $$;

-- Una tarjeta solo puede estar en listas de su propio proyecto
create or replace function public.check_card_list()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.lists where id = new.list_id and project_id = new.project_id) then
    raise exception 'la lista no pertenece a este proyecto';
  end if;
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'project_id no se puede cambiar';
  end if;
  if new.completed and (tg_op = 'INSERT' or not old.completed) then
    new.completed_at = now();
  elsif not new.completed then
    new.completed_at = null;
  end if;
  return new;
end $$;
drop trigger if exists cards_check_list on public.cards;
create trigger cards_check_list before insert or update on public.cards
  for each row execute function public.check_card_list();

-- Un juego solo se enlaza con proyectos/dispositivos de su estudio
create or replace function public.check_game_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null and not exists
     (select 1 from public.projects where id = new.project_id and studio_id = new.studio_id) then
    raise exception 'el proyecto no es de este estudio';
  end if;
  if new.device_id is not null and not exists
     (select 1 from public.devices where id = new.device_id and studio_id = new.studio_id) then
    raise exception 'el dispositivo no es de este estudio';
  end if;
  return new;
end $$;
drop trigger if exists games_check_links on public.games;
create trigger games_check_links before insert or update on public.games
  for each row execute function public.check_game_links();

-- Proyecto nuevo → listas y etiquetas por defecto
create or replace function public.seed_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.lists (project_id, name, position) values
    (new.id, 'Ideas', 1000), (new.id, 'Por hacer', 2000),
    (new.id, 'En curso', 3000), (new.id, 'Hecho', 4000);
  insert into public.project_labels (project_id, name, color) values
    (new.id, 'Bug', '#ef4444'), (new.id, 'Mejora', '#3b82f6'), (new.id, 'Arte', '#a855f7'),
    (new.id, 'Sonido', '#f59e0b'), (new.id, 'Urgente', '#f97316');
  return new;
end $$;
drop trigger if exists projects_seed on public.projects;
create trigger projects_seed after insert on public.projects
  for each row execute function public.seed_project();

-- Actividad automática
create or replace function public.log_card_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
  v_from text;
  v_to text;
begin
  select studio_id into v_studio from public.projects where id = new.project_id;
  if tg_op = 'INSERT' then
    insert into public.activity (studio_id, project_id, user_id, kind, title)
    values (v_studio, new.project_id, auth.uid(), 'card_created', new.title);
  else
    if new.list_id is distinct from old.list_id then
      select name into v_from from public.lists where id = old.list_id;
      select name into v_to from public.lists where id = new.list_id;
      insert into public.activity (studio_id, project_id, user_id, kind, title, meta)
      values (v_studio, new.project_id, auth.uid(), 'card_moved', new.title,
              jsonb_build_object('from', v_from, 'to', v_to));
    end if;
    if new.completed is distinct from old.completed then
      insert into public.activity (studio_id, project_id, user_id, kind, title)
      values (v_studio, new.project_id, auth.uid(),
              case when new.completed then 'card_completed' else 'card_reopened' end, new.title);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists cards_activity on public.cards;
create trigger cards_activity after insert or update on public.cards
  for each row execute function public.log_card_activity();

create or replace function public.log_comment_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
  v_title text;
begin
  select studio_id into v_studio from public.projects where id = new.project_id;
  select title into v_title from public.cards where id = new.card_id;
  insert into public.activity (studio_id, project_id, user_id, kind, title, meta)
  values (v_studio, new.project_id, new.user_id, 'comment', coalesce(v_title, ''),
          jsonb_build_object('excerpt', left(new.body, 140)));
  return null;
end $$;
drop trigger if exists card_comments_activity on public.card_comments;
create trigger card_comments_activity after insert on public.card_comments
  for each row execute function public.log_comment_activity();

-- Órdenes a dispositivos: studio_id sale del dispositivo; se purga lo viejo
create or replace function public.prepare_device_command()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select studio_id into new.studio_id from public.devices where id = new.device_id;
  if new.studio_id is null then
    raise exception 'dispositivo no encontrado';
  end if;
  new.issued_by = coalesce(new.issued_by, auth.uid());
  delete from public.device_commands
   where device_id = new.device_id and created_at < now() - interval '1 hour';
  return new;
end $$;
drop trigger if exists device_commands_prepare on public.device_commands;
create trigger device_commands_prepare before insert on public.device_commands
  for each row execute function public.prepare_device_command();

-- ---------------------------------------------------------------------
-- 3 · FUNCIONES (RPC) llamadas desde la app
-- ---------------------------------------------------------------------

-- Crea tu estudio y te hace propietario
create or replace function public.create_studio(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  insert into public.studios (name, owner_id) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into public.studio_members (studio_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;

-- Invita (o añade directamente si ya tiene cuenta) a alguien al ESTUDIO
create or replace function public.invite_to_studio(p_studio uuid, p_email text, p_role text default 'member')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if not public.is_studio_admin(p_studio) then raise exception 'sin permiso'; end if;
  if p_role not in ('admin','member') then raise exception 'rol no válido'; end if;
  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is not null then
    insert into public.studio_members (studio_id, user_id, role) values (p_studio, v_user, p_role)
    on conflict (studio_id, user_id) do nothing;
    return 'added';
  end if;
  insert into public.studio_invites (studio_id, email, role, invited_by)
  values (p_studio, v_email, p_role, auth.uid())
  on conflict (studio_id, lower(email)) do update set role = excluded.role;
  return 'invited';
end $$;

-- Invita a alguien SOLO a un proyecto de Tareas (no pasa a ser del estudio)
create or replace function public.invite_to_project(p_project uuid, p_email text, p_role text default 'editor')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if not public.can_edit_project(p_project) then raise exception 'sin permiso'; end if;
  if p_role not in ('editor','viewer') then raise exception 'rol no válido'; end if;
  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is not null then
    insert into public.project_members (project_id, user_id, role) values (p_project, v_user, p_role)
    on conflict (project_id, user_id) do update set role = excluded.role;
    return 'added';
  end if;
  insert into public.project_invites (project_id, email, role, invited_by)
  values (p_project, v_email, p_role, auth.uid())
  on conflict (project_id, lower(email)) do update set role = excluded.role;
  return 'invited';
end $$;

-- Al iniciar sesión: acepta las invitaciones pendientes para tu correo
create or replace function public.claim_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_n integer := 0;
  v_c integer;
begin
  select lower(email) into v_email from public.profiles where id = auth.uid();
  if v_email is null then return 0; end if;

  insert into public.studio_members (studio_id, user_id, role)
  select studio_id, auth.uid(), role from public.studio_invites where lower(email) = v_email
  on conflict (studio_id, user_id) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from public.studio_invites where lower(email) = v_email;

  insert into public.project_members (project_id, user_id, role)
  select project_id, auth.uid(), role from public.project_invites where lower(email) = v_email
  on conflict (project_id, user_id) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from public.project_invites where lower(email) = v_email;

  return v_n;
end $$;

-- Crea (o devuelve) el proyecto de Tareas enlazado a un juego
create or replace function public.create_project_for_game(p_game uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g public.games%rowtype;
  v_project uuid;
begin
  select * into g from public.games where id = p_game;
  if g.id is null or not public.is_studio_member(g.studio_id) then raise exception 'sin permiso'; end if;
  if g.project_id is not null then return g.project_id; end if;
  insert into public.projects (studio_id, name, description, created_by)
  values (g.studio_id, g.name, 'Tareas del juego ' || g.name, auth.uid())
  returning id into v_project;
  update public.games set project_id = v_project where id = p_game;
  return v_project;
end $$;

-- El bridge avisa de que está vivo (hora del servidor)
create or replace function public.device_heartbeat(p_device uuid, p_info jsonb default '{}'::jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := now();
begin
  if not public.can_access_device(p_device) then raise exception 'sin permiso'; end if;
  update public.devices set last_seen = v_now, info = coalesce(p_info, info) where id = p_device;
  return v_now;
end $$;


-- Agentes sin bridge (app homebrew de la 3DS y pestaña del navegador en el PC):
-- reclaman la siguiente orden y devuelven el resultado, todo con la sesión del usuario.
create or replace function public.device_command_claim(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.device_commands%rowtype;
begin
  if not public.can_access_device(p_device) then raise exception 'sin permiso'; end if;
  select * into c from public.device_commands
   where device_id = p_device and status = 'pending' and created_at > now() - interval '10 minutes'
   order by created_at limit 1 for update skip locked;
  if c.id is null then return null; end if;
  update public.device_commands set status = 'running' where id = c.id;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', c.id, 'studio_id', c.studio_id, 'type', c.type,
    'path', c.payload->>'path', 'to', c.payload->>'to', 'storage', c.payload->>'storage',
    'parts', (c.payload->>'parts')::int, 'size', (c.payload->>'size')::bigint, 'kind', c.payload->>'type'));
end $$;

create or replace function public.device_command_finish(
  p_id uuid, p_status text, p_result jsonb default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('done','error') then raise exception 'estado no válido'; end if;
  update public.device_commands
     set status = p_status, result = p_result, error = left(p_error, 400), finished_at = now()
   where id = p_id and public.can_access_device(device_id);
end $$;

-- ---------------------------------------------------------------------
-- 4 · VISTA DE PROGRESO (Tareas ↔ Juegos)
-- ---------------------------------------------------------------------
create or replace view public.project_stats with (security_invoker = true) as
select p.id as project_id,
       count(c.id)::int as total,
       (count(c.id) filter (where c.completed))::int as done,
       (count(c.id) filter (where not c.completed and c.due_date is not null and c.due_date < now()))::int as overdue
from public.projects p
left join public.cards c on c.project_id = p.id
group by p.id;

-- ---------------------------------------------------------------------
-- 5 · SEGURIDAD POR FILAS (RLS)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'studios','studio_members','studio_invites','projects','project_members','project_invites',
    'lists','cards','project_labels','card_labels','card_assignees','card_checklist','card_comments',
    'project_messages','activity','devices','device_commands','games'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Perfiles de compañeros (la propia ya existe en 01_auth.sql)
drop policy if exists "profiles: ver compañeros" on public.profiles;
create policy "profiles: ver compañeros" on public.profiles
  for select to authenticated using (public.shares_context(id));

-- Estudio
drop policy if exists "studios: ver" on public.studios;
create policy "studios: ver" on public.studios for select to authenticated
  using (public.is_studio_member(id));
drop policy if exists "studios: editar" on public.studios;
create policy "studios: editar" on public.studios for update to authenticated
  using (public.is_studio_admin(id)) with check (public.is_studio_admin(id));
drop policy if exists "studios: borrar" on public.studios;
create policy "studios: borrar" on public.studios for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "studio_members: ver" on public.studio_members;
create policy "studio_members: ver" on public.studio_members for select to authenticated
  using (public.is_studio_member(studio_id));
drop policy if exists "studio_members: cambiar rol" on public.studio_members;
create policy "studio_members: cambiar rol" on public.studio_members for update to authenticated
  using (public.is_studio_admin(studio_id) and role <> 'owner')
  with check (public.is_studio_admin(studio_id) and role in ('admin','member'));
drop policy if exists "studio_members: quitar o salir" on public.studio_members;
create policy "studio_members: quitar o salir" on public.studio_members for delete to authenticated
  using (role <> 'owner' and (public.is_studio_admin(studio_id) or user_id = auth.uid()));

drop policy if exists "studio_invites: ver" on public.studio_invites;
create policy "studio_invites: ver" on public.studio_invites for select to authenticated
  using (public.is_studio_admin(studio_id));
drop policy if exists "studio_invites: borrar" on public.studio_invites;
create policy "studio_invites: borrar" on public.studio_invites for delete to authenticated
  using (public.is_studio_admin(studio_id));

-- Proyectos
drop policy if exists "projects: ver" on public.projects;
create policy "projects: ver" on public.projects for select to authenticated
  using (public.is_studio_member(studio_id) or public.is_project_member(id));
drop policy if exists "projects: crear" on public.projects;
create policy "projects: crear" on public.projects for insert to authenticated
  with check (public.is_studio_member(studio_id) and created_by = auth.uid());
drop policy if exists "projects: editar" on public.projects;
create policy "projects: editar" on public.projects for update to authenticated
  using (public.can_edit_project(id)) with check (public.can_edit_project(id));
drop policy if exists "projects: borrar" on public.projects;
create policy "projects: borrar" on public.projects for delete to authenticated
  using (public.is_studio_member(studio_id));

drop policy if exists "project_members: ver" on public.project_members;
create policy "project_members: ver" on public.project_members for select to authenticated
  using (public.can_access_project(project_id));
drop policy if exists "project_members: cambiar rol" on public.project_members;
create policy "project_members: cambiar rol" on public.project_members for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
drop policy if exists "project_members: quitar o salir" on public.project_members;
create policy "project_members: quitar o salir" on public.project_members for delete to authenticated
  using (public.can_edit_project(project_id) or user_id = auth.uid());

drop policy if exists "project_invites: ver" on public.project_invites;
create policy "project_invites: ver" on public.project_invites for select to authenticated
  using (public.can_edit_project(project_id));
drop policy if exists "project_invites: borrar" on public.project_invites;
create policy "project_invites: borrar" on public.project_invites for delete to authenticated
  using (public.can_edit_project(project_id));

-- Contenido del tablero: ver = acceso al proyecto; escribir = poder editarlo
do $$
declare t text;
begin
  foreach t in array array['lists','cards','project_labels','card_labels','card_assignees','card_checklist'] loop
    execute format('drop policy if exists %I on public.%I', t || ': ver', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_project(project_id))',
                   t || ': ver', t);
    execute format('drop policy if exists %I on public.%I', t || ': crear', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_project(project_id))',
                   t || ': crear', t);
    execute format('drop policy if exists %I on public.%I', t || ': editar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id))',
                   t || ': editar', t);
    execute format('drop policy if exists %I on public.%I', t || ': borrar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_edit_project(project_id))',
                   t || ': borrar', t);
  end loop;
end $$;

-- Comentarios y chat: cualquiera con acceso (incluido lector) puede escribir
drop policy if exists "card_comments: ver" on public.card_comments;
create policy "card_comments: ver" on public.card_comments for select to authenticated
  using (public.can_access_project(project_id));
drop policy if exists "card_comments: crear" on public.card_comments;
create policy "card_comments: crear" on public.card_comments for insert to authenticated
  with check (public.can_access_project(project_id) and user_id = auth.uid());
drop policy if exists "card_comments: editar propio" on public.card_comments;
create policy "card_comments: editar propio" on public.card_comments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "card_comments: borrar" on public.card_comments;
create policy "card_comments: borrar" on public.card_comments for delete to authenticated
  using (user_id = auth.uid() or public.can_edit_project(project_id));

drop policy if exists "project_messages: ver" on public.project_messages;
create policy "project_messages: ver" on public.project_messages for select to authenticated
  using (public.can_access_project(project_id));
drop policy if exists "project_messages: crear" on public.project_messages;
create policy "project_messages: crear" on public.project_messages for insert to authenticated
  with check (public.can_access_project(project_id) and user_id = auth.uid());
drop policy if exists "project_messages: borrar" on public.project_messages;
create policy "project_messages: borrar" on public.project_messages for delete to authenticated
  using (user_id = auth.uid() or public.can_edit_project(project_id));

drop policy if exists "activity: ver" on public.activity;
create policy "activity: ver" on public.activity for select to authenticated
  using (public.can_access_project(project_id));

-- Juegos y dispositivos: solo miembros del estudio
drop policy if exists "games: ver" on public.games;
create policy "games: ver" on public.games for select to authenticated using (public.is_studio_member(studio_id));
drop policy if exists "games: crear" on public.games;
create policy "games: crear" on public.games for insert to authenticated
  with check (public.is_studio_member(studio_id) and created_by = auth.uid());
drop policy if exists "games: editar" on public.games;
create policy "games: editar" on public.games for update to authenticated
  using (public.is_studio_member(studio_id)) with check (public.is_studio_member(studio_id));
drop policy if exists "games: borrar" on public.games;
create policy "games: borrar" on public.games for delete to authenticated using (public.is_studio_member(studio_id));

drop policy if exists "devices: ver" on public.devices;
create policy "devices: ver" on public.devices for select to authenticated using (public.is_studio_member(studio_id));
drop policy if exists "devices: crear" on public.devices;
create policy "devices: crear" on public.devices for insert to authenticated
  with check (public.is_studio_member(studio_id) and created_by = auth.uid());
drop policy if exists "devices: editar" on public.devices;
create policy "devices: editar" on public.devices for update to authenticated
  using (public.is_studio_member(studio_id)) with check (public.is_studio_member(studio_id));
drop policy if exists "devices: borrar" on public.devices;
create policy "devices: borrar" on public.devices for delete to authenticated using (public.is_studio_member(studio_id));

drop policy if exists "device_commands: ver" on public.device_commands;
create policy "device_commands: ver" on public.device_commands for select to authenticated
  using (public.can_access_device(device_id));
drop policy if exists "device_commands: crear" on public.device_commands;
create policy "device_commands: crear" on public.device_commands for insert to authenticated
  with check (public.can_access_device(device_id));
drop policy if exists "device_commands: actualizar" on public.device_commands;
create policy "device_commands: actualizar" on public.device_commands for update to authenticated
  using (public.can_access_device(device_id)) with check (public.can_access_device(device_id));
drop policy if exists "device_commands: borrar" on public.device_commands;
create policy "device_commands: borrar" on public.device_commands for delete to authenticated
  using (public.can_access_device(device_id));

-- Permisos de las funciones: nada para anónimos
do $$
declare f text;
begin
  foreach f in array array[
    'is_studio_member(uuid)','is_studio_admin(uuid)','is_project_member(uuid)','can_access_project(uuid)','can_edit_project(uuid)',
    'can_access_device(uuid)','shares_context(uuid)','rt_topic_allowed(text)',
    'create_studio(text)','invite_to_studio(uuid,text,text)','invite_to_project(uuid,text,text)',
    'claim_invites()','create_project_for_game(uuid)','device_heartbeat(uuid,jsonb)',
    'device_command_claim(uuid)','device_command_finish(uuid,text,jsonb,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6 · REALTIME
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'lists','cards','project_labels','card_labels','card_assignees','card_checklist','card_comments',
    'project_messages','activity','projects','project_members','studio_members','games','devices','device_commands'
  ] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Canales privados (broadcast/presencia): señalización de pantalla, mando y "quién está en el tablero"
drop policy if exists "forja realtime: leer" on realtime.messages;
create policy "forja realtime: leer" on realtime.messages for select to authenticated
  using (public.rt_topic_allowed(realtime.topic()));
drop policy if exists "forja realtime: escribir" on realtime.messages;
create policy "forja realtime: escribir" on realtime.messages for insert to authenticated
  with check (public.rt_topic_allowed(realtime.topic()));

-- ---------------------------------------------------------------------
-- 7 · ALMACENAMIENTO (Storage)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('covers', 'covers', true, 5242880),
       ('avatars', 'avatars', true, 2097152),
       ('transfers', 'transfers', false, 52428800)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create or replace function public.storage_studio_allowed(object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_first text := (string_to_array(object_name, '/'))[1];
begin
  if v_first !~ '^[0-9a-f-]{36}$' then return false; end if;
  return public.is_studio_member(v_first::uuid);
exception when others then
  return false;
end $$;
revoke all on function public.storage_studio_allowed(text) from public, anon;
grant execute on function public.storage_studio_allowed(text) to authenticated;

-- covers: carpeta = id del estudio
drop policy if exists "forja covers: leer" on storage.objects;
create policy "forja covers: leer" on storage.objects for select using (bucket_id = 'covers');
drop policy if exists "forja covers: escribir" on storage.objects;
create policy "forja covers: escribir" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and public.storage_studio_allowed(name));
drop policy if exists "forja covers: actualizar" on storage.objects;
create policy "forja covers: actualizar" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and public.storage_studio_allowed(name));
drop policy if exists "forja covers: borrar" on storage.objects;
create policy "forja covers: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and public.storage_studio_allowed(name));

-- avatars: carpeta = id de la persona
drop policy if exists "forja avatars: leer" on storage.objects;
create policy "forja avatars: leer" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "forja avatars: escribir" on storage.objects;
create policy "forja avatars: escribir" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = auth.uid()::text);
drop policy if exists "forja avatars: actualizar" on storage.objects;
create policy "forja avatars: actualizar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = auth.uid()::text);
drop policy if exists "forja avatars: borrar" on storage.objects;
create policy "forja avatars: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = auth.uid()::text);

-- transfers (archivos 3DS/PC en tránsito, privado): carpeta = id del estudio
drop policy if exists "forja transfers: todo" on storage.objects;
create policy "forja transfers: todo" on storage.objects for all to authenticated
  using (bucket_id = 'transfers' and public.storage_studio_allowed(name))
  with check (bucket_id = 'transfers' and public.storage_studio_allowed(name));
