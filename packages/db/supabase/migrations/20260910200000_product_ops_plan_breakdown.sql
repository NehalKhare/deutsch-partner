-- The engineering breakdown, beside the plan it belongs to.
--
-- A plan's file lists are the coding agent's path allowlist and stay as they
-- are. What an operator also wants from the planning stage is what an
-- engineering manager would write: the requirements in build order and in
-- phases, a size on each, and where the current stack is the wrong tool. That
-- does not fit in the same 2000-token answer as the file lists, so it is a
-- second call in the same stage, and it is stored here as one document the
-- domain schema validates on the way out.
--
-- Nullable on purpose: a plan can exist before its breakdown does, and a
-- retry of the stage writes only the half that is missing. The page treats a
-- null as "not written yet", never as an error.

alter table public.implementation_plans
  add column breakdown jsonb;

-- Nothing new to grant. The table keeps its posture: row level security on,
-- no policy, reachable by the secret key alone. Stated so the revoke this
-- feature relies on is visible in the file that extends the table.
revoke all on public.implementation_plans from anon, authenticated;
