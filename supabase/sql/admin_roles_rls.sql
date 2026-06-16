-- =====================================================================
-- DataEncuesta · Roles reales + RLS para perfiles/encuestas y tablas
-- relacionadas + RPCs administrativas con auditoría server-side.
--
-- Ejecutar completo en el SQL Editor de Supabase (proyecto de producción
-- y, si existe, en el de staging). Es idempotente: se puede re-ejecutar
-- sin duplicar políticas ni funciones.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas de rol/estado en perfiles
-- ---------------------------------------------------------------------
alter table public.perfiles
  add column if not exists rol text not null default 'User'
    check (rol in ('User', 'Moderator', 'Admin', 'SuperAdmin')),
  add column if not exists estado text not null default 'activo'
    check (estado in ('activo', 'suspendido', 'bloqueado'));

-- Sembrar al SuperAdmin original (antes hardcodeado en el frontend).
update public.perfiles
set rol = 'SuperAdmin'
where lower(email) = 'klhetvintellez23@gmail.com'
  and rol <> 'SuperAdmin';

-- ---------------------------------------------------------------------
-- 2. Estado de moderación en encuestas (independiente del estado del
--    autor: borrador/activo/cerrado)
-- ---------------------------------------------------------------------
alter table public.encuestas
  add column if not exists moderacion_estado text not null default 'activo'
    check (moderacion_estado in ('activo', 'archivado', 'despublicado'));

-- ---------------------------------------------------------------------
-- 3. Helper: ¿el usuario actual es administrador activo?
--    SECURITY DEFINER para poder leer perfiles sin pasar por RLS
--    (evita recursión de políticas).
-- ---------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from perfiles
    where id = uid
      and rol in ('Moderator', 'Admin', 'SuperAdmin')
      and estado = 'activo'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 4. Trigger: solo administradores pueden modificar rol/estado de
--    perfiles. Cualquier intento de un usuario normal de cambiar su
--    propio rol/estado se revierte silenciosamente.
-- ---------------------------------------------------------------------
create or replace function public.proteger_columnas_privilegiadas_perfiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    new.rol := old.rol;
    new.estado := old.estado;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_perfiles on public.perfiles;
create trigger trg_proteger_perfiles
  before update on public.perfiles
  for each row execute function public.proteger_columnas_privilegiadas_perfiles();

-- ---------------------------------------------------------------------
-- 5. RLS: perfiles
--    - Cada usuario ve y edita su propio perfil.
--    - Los administradores activos pueden ver todos los perfiles
--      (necesario para el panel /admin).
-- ---------------------------------------------------------------------
alter table public.perfiles enable row level security;

drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select
  on public.perfiles for select
  using (id = auth.uid() or is_admin());

drop policy if exists perfiles_update_own on public.perfiles;
create policy perfiles_update_own
  on public.perfiles for update
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- 6. RLS: encuestas
--    - El propietario tiene control total sobre sus encuestas.
--    - Los administradores pueden ver/actualizar cualquier encuesta
--      (moderación).
--    - Cualquiera (incluido anónimo) puede leer encuestas activas y
--      no moderadas, necesario para que los encuestados respondan.
--
--    NOTA: esto permite enumerar título/descripción de encuestas
--    activas vía la API REST de Supabase (no solo por ID conocido).
--    Si se requiere evitar la enumeración, sustituir esta política
--    por una función RPC `get_survey_for_response(id)` y quitar el
--    acceso público directo a la tabla.
-- ---------------------------------------------------------------------
alter table public.encuestas enable row level security;

drop policy if exists encuestas_select on public.encuestas;
create policy encuestas_select
  on public.encuestas for select
  using (
    usuario_id = auth.uid()
    or is_admin()
    or (estado = 'activo' and moderacion_estado = 'activo')
  );

drop policy if exists encuestas_insert_own on public.encuestas;
create policy encuestas_insert_own
  on public.encuestas for insert
  with check (usuario_id = auth.uid());

drop policy if exists encuestas_update on public.encuestas;
create policy encuestas_update
  on public.encuestas for update
  using (usuario_id = auth.uid() or is_admin());

drop policy if exists encuestas_delete_own on public.encuestas;
create policy encuestas_delete_own
  on public.encuestas for delete
  using (usuario_id = auth.uid());

-- ---------------------------------------------------------------------
-- 7. RLS: preguntas / opciones_pregunta
--    La visibilidad/edición sigue la de la encuesta padre.
-- ---------------------------------------------------------------------
alter table public.preguntas enable row level security;

drop policy if exists preguntas_select on public.preguntas;
create policy preguntas_select
  on public.preguntas for select
  using (
    exists (select 1 from encuestas e where e.id = preguntas.encuesta_id)
  );

drop policy if exists preguntas_modify on public.preguntas;
create policy preguntas_modify
  on public.preguntas for all
  using (
    exists (
      select 1 from encuestas e
      where e.id = preguntas.encuesta_id
        and (e.usuario_id = auth.uid() or is_admin())
    )
  )
  with check (
    exists (
      select 1 from encuestas e
      where e.id = preguntas.encuesta_id
        and (e.usuario_id = auth.uid() or is_admin())
    )
  );

alter table public.opciones_pregunta enable row level security;

drop policy if exists opciones_select on public.opciones_pregunta;
create policy opciones_select
  on public.opciones_pregunta for select
  using (
    exists (select 1 from preguntas p where p.id = opciones_pregunta.pregunta_id)
  );

drop policy if exists opciones_modify on public.opciones_pregunta;
create policy opciones_modify
  on public.opciones_pregunta for all
  using (
    exists (
      select 1 from preguntas p
      join encuestas e on e.id = p.encuesta_id
      where p.id = opciones_pregunta.pregunta_id
        and (e.usuario_id = auth.uid() or is_admin())
    )
  )
  with check (
    exists (
      select 1 from preguntas p
      join encuestas e on e.id = p.encuesta_id
      where p.id = opciones_pregunta.pregunta_id
        and (e.usuario_id = auth.uid() or is_admin())
    )
  );

-- ---------------------------------------------------------------------
-- 8. RLS: envios / respuestas
--    - Cualquiera puede insertar (responder) si la encuesta está
--      activa y no moderada.
--    - Solo el propietario de la encuesta o un administrador puede
--      leer los envíos/respuestas.
-- ---------------------------------------------------------------------
alter table public.envios enable row level security;

drop policy if exists envios_insert_public on public.envios;
create policy envios_insert_public
  on public.envios for insert
  with check (
    exists (
      select 1 from encuestas e
      where e.id = envios.encuesta_id
        and e.estado = 'activo'
        and e.moderacion_estado = 'activo'
    )
  );

drop policy if exists envios_select on public.envios;
create policy envios_select
  on public.envios for select
  using (
    is_admin()
    or exists (
      select 1 from encuestas e
      where e.id = envios.encuesta_id and e.usuario_id = auth.uid()
    )
  );

alter table public.respuestas enable row level security;

drop policy if exists respuestas_insert_public on public.respuestas;
create policy respuestas_insert_public
  on public.respuestas for insert
  with check (
    exists (
      select 1 from envios v
      join encuestas e on e.id = v.encuesta_id
      where v.id = respuestas.envio_id
        and e.estado = 'activo'
        and e.moderacion_estado = 'activo'
    )
  );

drop policy if exists respuestas_select on public.respuestas;
create policy respuestas_select
  on public.respuestas for select
  using (
    is_admin()
    or exists (
      select 1 from envios v
      join encuestas e on e.id = v.encuesta_id
      where v.id = respuestas.envio_id and e.usuario_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- 9. Tabla de auditoría real (server-side, no falsificable desde el
--    cliente: solo se escribe desde las RPCs SECURITY DEFINER de abajo)
-- ---------------------------------------------------------------------
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  creado_el timestamptz not null default now(),
  admin_id uuid not null references auth.users(id),
  admin_nombre text not null,
  admin_email text not null,
  admin_rol text not null,
  accion text not null,
  objetivo text not null,
  detalles text not null,
  ip text
);

alter table public.admin_audit_logs enable row level security;

drop policy if exists admin_audit_logs_select on public.admin_audit_logs;
create policy admin_audit_logs_select
  on public.admin_audit_logs for select
  using (is_admin());

-- Sin políticas de insert/update/delete: el cliente no puede escribir
-- directamente, solo a través de las funciones SECURITY DEFINER.

create or replace function public.registrar_auditoria_admin(
  p_accion text,
  p_objetivo text,
  p_detalles text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_ip text;
begin
  select nombre_completo, email, rol into v_admin
  from perfiles where id = auth.uid();

  v_ip := coalesce(
    (current_setting('request.headers', true)::json->>'x-forwarded-for'),
    'desconocida'
  );

  insert into admin_audit_logs (admin_id, admin_nombre, admin_email, admin_rol, accion, objetivo, detalles, ip)
  values (auth.uid(), coalesce(v_admin.nombre_completo, ''), coalesce(v_admin.email, ''), coalesce(v_admin.rol, ''), p_accion, p_objetivo, p_detalles, v_ip);
end;
$$;

revoke all on function public.registrar_auditoria_admin(text, text, text) from public;
grant execute on function public.registrar_auditoria_admin(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. RPCs administrativas (SECURITY DEFINER): verifican el rol del
--     llamador en el servidor antes de aplicar cualquier cambio.
-- ---------------------------------------------------------------------

-- 10.1 Cambiar el rol de un usuario
create or replace function public.admin_set_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_target_role text;
begin
  select rol into v_caller_role from perfiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('Moderator', 'Admin', 'SuperAdmin') then
    raise exception 'No autorizado';
  end if;

  if p_new_role not in ('User', 'Moderator', 'Admin', 'SuperAdmin') then
    raise exception 'Rol inválido: %', p_new_role;
  end if;

  select rol into v_target_role from perfiles where id = p_user_id;
  if v_target_role is null then
    raise exception 'Usuario no encontrado';
  end if;

  if (v_target_role = 'SuperAdmin' or p_new_role = 'SuperAdmin') and v_caller_role <> 'SuperAdmin' then
    raise exception 'Solo un SuperAdmin puede modificar cuentas SuperAdmin';
  end if;

  update perfiles set rol = p_new_role where id = p_user_id;

  perform registrar_auditoria_admin(
    'ROLE_CHANGE',
    p_user_id::text,
    format('Rol modificado de %s a %s.', v_target_role, p_new_role)
  );
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text) from public;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

-- 10.2 Cambiar el estado de cuenta de un usuario (activo/suspendido/bloqueado)
create or replace function public.admin_set_user_status(p_user_id uuid, p_new_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_target_role text;
  v_action text;
begin
  select rol into v_caller_role from perfiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('Moderator', 'Admin', 'SuperAdmin') then
    raise exception 'No autorizado';
  end if;

  if p_new_status not in ('activo', 'suspendido', 'bloqueado') then
    raise exception 'Estado inválido: %', p_new_status;
  end if;

  select rol into v_target_role from perfiles where id = p_user_id;
  if v_target_role is null then
    raise exception 'Usuario no encontrado';
  end if;

  if v_target_role in ('Admin', 'SuperAdmin') and v_caller_role <> 'SuperAdmin' then
    raise exception 'Solo un SuperAdmin puede cambiar el estado de cuentas Admin/SuperAdmin';
  end if;

  update perfiles set estado = p_new_status where id = p_user_id;

  v_action := case p_new_status
    when 'suspendido' then 'USER_SUSPENSION'
    when 'bloqueado' then 'USER_BLOCK'
    else 'USER_ACTIVATION'
  end;

  perform registrar_auditoria_admin(
    v_action,
    p_user_id::text,
    coalesce(p_reason, format('Estado cambiado a %s.', p_new_status))
  );
end;
$$;

revoke all on function public.admin_set_user_status(uuid, text, text) from public;
grant execute on function public.admin_set_user_status(uuid, text, text) to authenticated;

-- 10.3 Cambiar el estado de moderación de una encuesta
create or replace function public.admin_set_survey_moderation(p_survey_id uuid, p_new_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_title text;
  v_action text;
begin
  select rol into v_caller_role from perfiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('Moderator', 'Admin', 'SuperAdmin') then
    raise exception 'No autorizado';
  end if;

  if p_new_status not in ('activo', 'archivado', 'despublicado') then
    raise exception 'Estado de moderación inválido: %', p_new_status;
  end if;

  select titulo into v_title from encuestas where id = p_survey_id;
  if v_title is null then
    raise exception 'Encuesta no encontrada';
  end if;

  update encuestas set moderacion_estado = p_new_status where id = p_survey_id;

  v_action := case p_new_status
    when 'archivado' then 'SURVEY_ARCHIVE'
    when 'despublicado' then 'SURVEY_UNPUBLISH'
    else 'SURVEY_RESTORE'
  end;

  perform registrar_auditoria_admin(
    v_action,
    format('%s (%s)', v_title, p_survey_id::text),
    coalesce(p_reason, format('Estado de moderación cambiado a %s.', p_new_status))
  );
end;
$$;

revoke all on function public.admin_set_survey_moderation(uuid, text, text) from public;
grant execute on function public.admin_set_survey_moderation(uuid, text, text) to authenticated;
