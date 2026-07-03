-- =====================================================================
-- DataEncuesta · Garantiza una fila en perfiles para todo usuario nuevo
--
-- Bug: usuarios recién registrados (por email u OAuth de Google) no
-- podían crear encuestas ("error de conexión o de base de datos"). La
-- app nunca insertaba una fila en public.perfiles tras el registro, y
-- public.encuestas.usuario_id depende de esa fila (FK) — si no existe
-- todavía, el insert en encuestas falla.
--
-- Este script agrega un trigger en auth.users que crea la fila de
-- perfiles en la MISMA transacción del registro (email o Google),
-- eliminando la condición de carrera de raíz. El cliente (Angular)
-- también hace un upsert best-effort al iniciar sesión como refuerzo,
-- pero este trigger es la corrección real y definitiva.
--
-- Ejecutar completo en el SQL Editor de Supabase (producción y, si
-- existe, staging). Es idempotente: se puede re-ejecutar sin duplicar
-- el trigger ni la función.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permitir que cada usuario cree su propia fila de perfil (necesario
--    tanto para el trigger de abajo, que corre como el usuario que
--    dispara el insert en auth.users vía SECURITY DEFINER, como para el
--    upsert de refuerzo que hace el cliente).
-- ---------------------------------------------------------------------
drop policy if exists perfiles_insert_own on public.perfiles;
create policy perfiles_insert_own
  on public.perfiles for insert
  with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. Función + trigger: crea la fila de perfiles apenas se crea el
--    usuario en auth.users (cubre signup por email y por Google, es el
--    único punto común a ambos flujos).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre_completo)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1), 'Usuario')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. Backfill: crea la fila de perfiles para cualquier usuario que ya
--    se haya registrado antes de este fix y por eso quedó sin poder
--    crear encuestas.
-- ---------------------------------------------------------------------
insert into public.perfiles (id, email, nombre_completo)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email, ''), '@', 1), 'Usuario')
from auth.users u
left join public.perfiles p on p.id = u.id
where p.id is null;
