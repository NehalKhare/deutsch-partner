-- Move pgvector out of the public schema.
--
-- The earlier migration created it in public, which Supabase's linter flags:
-- an extension in public puts its functions and operators on the API surface
-- alongside application tables. The convention is a dedicated `extensions`
-- schema, which is already on the search_path for the API roles, so existing
-- vector columns and the HNSW index keep resolving.
--
-- Guarded rather than unconditional: this must be a no-op on a database where
-- the extension is already elsewhere, or is not installed at all.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions')
     and exists (
       select 1
       from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
       where e.extname = 'vector' and n.nspname = 'public'
     )
  then
    alter extension vector set schema extensions;
  end if;
end $$;
