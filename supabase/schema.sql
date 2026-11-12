-- ============================================================
-- Control de dispositivos — esquema Supabase
-- Pegar completo en Supabase → SQL Editor → Run. Se puede re-ejecutar.
-- ============================================================

-- ---------- Tablas ----------
create table if not exists public.eventos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) > 0),
  creado_at   timestamptz not null default now(),
  creado_por  uuid references auth.users (id) default auth.uid()
);

create table if not exists public.prestamos (
  id                    uuid primary key default gen_random_uuid(),
  evento_id             uuid not null references public.eventos (id) on delete cascade,
  sn                    text not null check (length(sn) > 0),
  dni                   text not null default '',
  nombre                text not null default '',
  estado                text not null default 'entregado' check (estado in ('entregado', 'devuelto')),
  entregado_at          timestamptz not null default now(),
  entregado_por         uuid references auth.users (id),
  entregado_por_nombre  text,
  devuelto_at           timestamptz,
  devuelto_por          uuid references auth.users (id),
  devuelto_por_nombre   text,
  forzado               boolean not null default false,
  dni_devolucion        text
);

-- Un mismo SN no puede estar entregado dos veces a la vez en el mismo evento
-- (cubre el caso de dos celulares entregando el mismo equipo sin señal).
create unique index if not exists prestamos_sn_activo
  on public.prestamos (evento_id, sn) where estado = 'entregado';
create index if not exists prestamos_evento on public.prestamos (evento_id);

-- ---------- Quién hizo cada cosa (lo pone la base, no el celular) ----------
create or replace function public.nombre_operador(uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(u.raw_user_meta_data ->> 'nombre', split_part(u.email, '@', 1))
  from auth.users u where u.id = uid
$$;
revoke all on function public.nombre_operador(uuid) from public, anon;

create or replace function public.prestamos_auditoria()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.entregado_por := auth.uid();
    new.entregado_por_nombre := public.nombre_operador(auth.uid());
    new.devuelto_por := null;
    new.devuelto_por_nombre := null;
    if new.estado = 'devuelto' then
      new.devuelto_por := auth.uid();
      new.devuelto_por_nombre := public.nombre_operador(auth.uid());
    end if;
  elsif tg_op = 'UPDATE' then
    -- la entrega original no se puede reescribir
    new.entregado_por := old.entregado_por;
    new.entregado_por_nombre := old.entregado_por_nombre;
    new.entregado_at := old.entregado_at;
    if new.estado = 'devuelto' and old.estado <> 'devuelto' then
      new.devuelto_por := auth.uid();
      new.devuelto_por_nombre := public.nombre_operador(auth.uid());
    elsif new.estado = old.estado then
      new.devuelto_por := old.devuelto_por;
      new.devuelto_por_nombre := old.devuelto_por_nombre;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists prestamos_auditoria on public.prestamos;
create trigger prestamos_auditoria before insert or update on public.prestamos
  for each row execute function public.prestamos_auditoria();

-- ---------- Seguridad: solo usuarios logueados ----------
-- La URL y la clave pública están en el código (repo público). Estas políticas
-- son lo que impide que alguien sin usuario lea los DNI.
alter table public.eventos   enable row level security;
alter table public.prestamos enable row level security;

drop policy if exists "eventos_select" on public.eventos;
drop policy if exists "eventos_insert" on public.eventos;
drop policy if exists "eventos_update" on public.eventos;
create policy "eventos_select" on public.eventos for select to authenticated using (true);
create policy "eventos_insert" on public.eventos for insert to authenticated with check (true);
create policy "eventos_update" on public.eventos for update to authenticated using (true) with check (true);

drop policy if exists "prestamos_select" on public.prestamos;
drop policy if exists "prestamos_insert" on public.prestamos;
drop policy if exists "prestamos_update" on public.prestamos;
drop policy if exists "prestamos_delete" on public.prestamos;
create policy "prestamos_select" on public.prestamos for select to authenticated using (true);
create policy "prestamos_insert" on public.prestamos for insert to authenticated with check (true);
create policy "prestamos_update" on public.prestamos for update to authenticated using (true) with check (true);
create policy "prestamos_delete" on public.prestamos for delete to authenticated using (true);

revoke all on public.eventos, public.prestamos from anon;
grant select, insert, update on public.eventos to authenticated;
grant select, insert, update, delete on public.prestamos to authenticated;

-- ---------- Tiempo real ----------
do $$ begin
  begin alter publication supabase_realtime add table public.eventos;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.prestamos; exception when duplicate_object then null; end;
end $$;
