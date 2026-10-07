-- Cancellation and withdrawal notices (billing-and-plans-spec.md S11, B10).
--
-- The §312k BGB cancellation button works without signing in, so a notice
-- is a record keyed by the email it was sent from, not by a learner. The
-- §356a BGB withdrawal button sits behind sign-in and records the learner
-- too — as a plain id, not a foreign key, because the notice must outlive the
-- account it is about: a learner who withdraws and then deletes their account
-- has still withdrawn, and the record is the proof.
--
-- Written only through the secret key, like the billing ledger: RLS is on
-- and there is no policy, so neither anon nor a learner can read another's
-- notice or forge one. The reference is what the confirmation shows and what
-- a learner quotes when they write in.

create table public.contract_notices (
  id           uuid primary key default gen_random_uuid(),
  -- Short, public, unguessable enough: what the confirmation prints.
  reference    text not null unique check (reference ~ '^[A-Z0-9]{10}$'),
  kind         text not null check (kind in ('cancellation', 'withdrawal')),
  email        text not null check (char_length(email) between 3 and 254),
  -- What the notice is about, as the consumer described it. 'unknown' when
  -- the cancellation form could not tell; it is still a valid notice (§312k).
  contract     text not null check (contract in ('subscription', 'pass', 'unknown')),
  -- Anything the consumer added to identify the contract. Short and free,
  -- because the law lets them describe it in their own words.
  detail       text check (char_length(detail) <= 500),
  learner_id   uuid,
  -- The time the notice reached us: what §312k(4) and §355(1) are counted from.
  received_at  timestamptz not null default now(),
  -- When the text-form confirmation was sent. Null until an email sender exists.
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index contract_notices_email_idx on public.contract_notices (email, received_at desc);
create index contract_notices_learner_idx on public.contract_notices (learner_id) where learner_id is not null;

alter table public.contract_notices enable row level security;

revoke all on public.contract_notices from anon, authenticated;
