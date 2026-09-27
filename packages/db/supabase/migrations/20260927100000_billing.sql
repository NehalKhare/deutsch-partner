-- Plans and payments: what a learner has paid for, the evidence that they
-- ordered it, and what each plan may spend on them.
--
-- billing-and-plans-spec.md S5 (entitlement), S7 (prices), S8 (the webhook),
-- S9 (money bounds) and S10 (data). Stripe is the source of truth for money;
-- these tables are the application's mirror of what Stripe last said, written
-- by exactly one path — the webhook, through the secret key — and read by the
-- learner under RLS. No table here stores a card, an IBAN, a billing address,
-- a name or an email. Invoices stay in Stripe.
--
-- Stripe ids are held to their prefixes, and every enumerated column to its
-- closed set, so a mistake in the webhook fails at the row rather than
-- granting something no plan sells.

-- ---------------------------------------------------------------------------
-- Learner-owned: select-only for the learner, written by the secret key
-- ---------------------------------------------------------------------------

-- The one mapping the webhook trusts to find a learner (spec S8). Written when
-- the server creates the customer for an authenticated session; metadata and
-- client_reference_id on Stripe's side are corroboration, never the key.
create table public.billing_customers (
  learner_id         uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique
                     check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at         timestamptz not null default now()
);

-- One row per order placed on the order page, before any Checkout Session
-- exists: the offer, the terms shown, and the moment the learner asked for an
-- immediate start (§356(4), §357a(2) BGB). The evidence that the order and the
-- consent happened. A trial places no paid order and records no consent; it
-- is Premium's alone (spec S6).
create table public.billing_checkouts (
  id                         uuid primary key default gen_random_uuid(),
  learner_id                 uuid not null references public.profiles (id) on delete cascade,
  offer_key                  text not null check (offer_key in (
                               'dp_plus_month', 'dp_plus_year',
                               'dp_premium_month', 'dp_premium_year',
                               'dp_pass_plus', 'dp_pass_premium')),
  kind                       text not null check (kind in ('order', 'trial')),
  terms_version              text not null check (char_length(terms_version) between 1 and 40),
  early_start_consent_at     timestamptz,
  stripe_checkout_session_id text unique
                             check (stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  status                     text not null default 'created' check (status in (
                               'created', 'opened', 'completed', 'expired', 'failed')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint billing_checkouts_order_has_consent
    check (kind = 'trial' or early_start_consent_at is not null),
  constraint billing_checkouts_trial_is_premium
    check (kind = 'order' or offer_key in ('dp_premium_month', 'dp_premium_year'))
);

create index billing_checkouts_learner_idx
  on public.billing_checkouts (learner_id, created_at desc);

create trigger billing_checkouts_touch before update on public.billing_checkouts
  for each row execute function public.touch_updated_at();

-- One row per Stripe subscription, upserted from a fresh retrieve on every
-- subscription event (spec S8). stripe_synced_at is when that retrieve
-- happened, so a slower handler's older read can never overwrite a newer one.
create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  learner_id             uuid not null references public.profiles (id) on delete cascade,
  stripe_subscription_id text not null unique
                         check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_price_id        text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  plan_code              text not null check (plan_code in ('plus', 'premium')),
  status                 text not null check (status in (
                           'active', 'canceled', 'incomplete', 'incomplete_expired',
                           'past_due', 'paused', 'trialing', 'unpaid')),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  trial_end              timestamptz,
  canceled_at            timestamptz,
  stripe_synced_at       timestamptz not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index subscriptions_learner_idx on public.subscriptions (learner_id);

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- One row per paid pass: a plan for [starts_at, ends_at). Passes for the same
-- plan stack rather than overlap, so starts_at may lie in the future. A refund
-- revokes; nothing deletes, because the row is also the record of the sale.
create table public.plan_passes (
  id                         uuid primary key default gen_random_uuid(),
  learner_id                 uuid not null references public.profiles (id) on delete cascade,
  plan_code                  text not null check (plan_code in ('plus', 'premium')),
  starts_at                  timestamptz not null,
  ends_at                    timestamptz not null,
  stripe_checkout_session_id text not null unique
                             check (stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  stripe_payment_intent_id   text unique
                             check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  amount_minor               integer not null check (amount_minor >= 0),
  currency                   text not null check (currency ~ '^[a-z]{3}$'),
  revoked_at                 timestamptz,
  created_at                 timestamptz not null default now(),
  constraint plan_passes_window check (ends_at > starts_at),
  -- PASS_DAYS_MAX in packages/domain/src/billing.ts: longer than any pass
  -- sold, shorter than a typo in the Dashboard.
  constraint plan_passes_length check (ends_at <= starts_at + interval '730 days')
);

create index plan_passes_learner_idx on public.plan_passes (learner_id, ends_at desc);

alter table public.billing_customers enable row level security;
alter table public.billing_checkouts enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.plan_passes       enable row level security;

-- One policy each, and it reads. There is no insert, update or delete policy
-- and no privilege for one: a learner who could write here could grant
-- themselves a plan (spec S5).
create policy billing_customers_select on public.billing_customers
  for select to authenticated using ((select auth.uid()) = learner_id);
create policy billing_checkouts_select on public.billing_checkouts
  for select to authenticated using ((select auth.uid()) = learner_id);
create policy subscriptions_select on public.subscriptions
  for select to authenticated using ((select auth.uid()) = learner_id);
create policy plan_passes_select on public.plan_passes
  for select to authenticated using ((select auth.uid()) = learner_id);

revoke all on
  public.billing_customers,
  public.billing_checkouts,
  public.subscriptions,
  public.plan_passes
  from anon, authenticated;

grant select on
  public.billing_customers,
  public.billing_checkouts,
  public.subscriptions,
  public.plan_passes
  to authenticated;

-- ---------------------------------------------------------------------------
-- Operator scope: RLS on, no policy, nothing granted
-- ---------------------------------------------------------------------------

-- The active Stripe Prices, one row per price and currency (currency_options
-- are extra rows of the same price). Amounts in integer minor units, VAT
-- inclusive, stamped with when they were fetched: a price here is a mirror of
-- Stripe's, never a figure typed in (spec S7). Read server-side for the
-- pricing page.
create table public.billing_prices (
  stripe_price_id   text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  currency          text not null check (currency ~ '^[a-z]{3}$'),
  lookup_key        text not null check (lookup_key in (
                      'dp_plus_month', 'dp_plus_year',
                      'dp_premium_month', 'dp_premium_year',
                      'dp_pass_plus', 'dp_pass_premium')),
  plan_code         text not null check (plan_code in ('plus', 'premium')),
  kind              text not null check (kind in ('subscription', 'pass')),
  billing_interval  text check (billing_interval in ('month', 'year')),
  pass_days         integer check (pass_days between 1 and 730),
  unit_amount_minor integer not null check (unit_amount_minor >= 0),
  tax_behavior      text check (tax_behavior in ('inclusive', 'exclusive', 'unspecified')),
  active            boolean not null default true,
  fetched_at        timestamptz not null,
  primary key (stripe_price_id, currency),
  -- A subscription renews on an interval; a pass lasts a number of days.
  constraint billing_prices_shape check (
    (kind = 'subscription' and billing_interval is not null and pass_days is null)
    or (kind = 'pass' and billing_interval is null and pass_days is not null)
  )
);

-- Stripe keeps a lookup key on one Price at a time; the mirror keeps one
-- active row per offer and currency, so the pricing page never has to choose.
create unique index billing_prices_one_active_per_offer
  on public.billing_prices (lookup_key, currency)
  where active;

-- The webhook inbox: which events arrived, what became of them, and a closed
-- error code when something failed. Never an event body and never a Stripe
-- message, which can carry an email or a card's last four (spec S13).
create table public.billing_events (
  stripe_event_id   text primary key check (stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  event_type        text not null check (event_type ~ '^[a-z0-9_.]{1,100}$'),
  stripe_created_at timestamptz not null,
  status            text not null default 'received' check (status in (
                      'received', 'processed', 'failed', 'ignored')),
  error_code        text check (error_code ~ '^[a-z0-9_]{1,60}$'),
  attempts          integer not null default 1 check (attempts >= 1),
  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);

alter table public.billing_prices enable row level security;
alter table public.billing_events enable row level security;

revoke all on public.billing_prices, public.billing_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The webhook's writes
--
-- Each is one statement's worth of atomicity that PostgREST round trips
-- cannot give: a claim that cannot be taken twice, an upsert that cannot
-- regress, a grant and a refund that cannot happen twice. SECURITY INVOKER and
-- revoked from anon and authenticated, so only the secret key reaches them.
-- ---------------------------------------------------------------------------

-- Claims an event before it is applied (spec S8 step 2):
--   'new'       first sight; apply it.
--   'processed' already processed or ignored; acknowledge and do nothing.
--   'retry'     seen, not finished (a crash, a failure, Stripe's redelivery);
--               apply it again. Every application is idempotent, which is
--               what makes this safe.
create or replace function public.billing_claim_event(
  p_event_id   text,
  p_event_type text,
  p_created_at timestamptz
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  insert into public.billing_events (stripe_event_id, event_type, stripe_created_at)
  values (p_event_id, p_event_type, p_created_at)
  on conflict (stripe_event_id) do nothing;

  if found then
    return 'new';
  end if;

  select e.status into v_status
    from public.billing_events e
   where e.stripe_event_id = p_event_id
     for update;

  -- A duplicate of a finished event is not an attempt: nothing is done.
  if v_status in ('processed', 'ignored') then
    return 'processed';
  end if;

  update public.billing_events e
     set attempts = e.attempts + 1,
         status   = 'received'
   where e.stripe_event_id = p_event_id;

  return 'retry';
end;
$$;

revoke all on function public.billing_claim_event(text, text, timestamptz)
  from public, anon, authenticated;

-- Writes a subscription as Stripe says it is now, and returns the row as it
-- was and as it is, for the audit event (spec S13: from/to plan and status).
--
-- A read older than the stored one is not applied: two handlers can retrieve
-- the same subscription moments apart and finish in the other order, and the
-- later retrieve is the truth. A subscription never moves between learners —
-- a customer is one learner's, and a subscription one customer's — so an
-- attempt to is refused rather than quietly re-homed.
create or replace function public.billing_upsert_subscription(p_subscription jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row    public.subscriptions;
  v_before public.subscriptions;
  v_after  public.subscriptions;
begin
  -- Unknown keys are dropped; the row's shape is this table's.
  v_row := jsonb_populate_record(null::public.subscriptions, p_subscription);

  select * into v_before
    from public.subscriptions s
   where s.stripe_subscription_id = v_row.stripe_subscription_id
     for update;

  if v_before.id is not null and v_before.learner_id <> v_row.learner_id then
    raise exception 'a subscription cannot move between learners' using errcode = '42501';
  end if;

  if v_before.id is not null and v_before.stripe_synced_at > v_row.stripe_synced_at then
    return jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_before), 'applied', false);
  end if;

  insert into public.subscriptions (
    learner_id, stripe_subscription_id, stripe_price_id, plan_code, status,
    current_period_end, cancel_at_period_end, trial_end, canceled_at, stripe_synced_at
  ) values (
    v_row.learner_id, v_row.stripe_subscription_id, v_row.stripe_price_id,
    v_row.plan_code, v_row.status, v_row.current_period_end,
    coalesce(v_row.cancel_at_period_end, false), v_row.trial_end,
    v_row.canceled_at, v_row.stripe_synced_at
  )
  on conflict (stripe_subscription_id) do update
    set stripe_price_id      = excluded.stripe_price_id,
        plan_code            = excluded.plan_code,
        status               = excluded.status,
        current_period_end   = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        trial_end            = excluded.trial_end,
        canceled_at          = excluded.canceled_at,
        stripe_synced_at     = excluded.stripe_synced_at
    -- The same two rules again, for the first write of a subscription that a
    -- concurrent handler inserted between the lock above and this statement.
    where public.subscriptions.stripe_synced_at <= excluded.stripe_synced_at
      and public.subscriptions.learner_id = excluded.learner_id
  returning * into v_after;

  if v_after.id is null then
    select * into v_after
      from public.subscriptions s
     where s.stripe_subscription_id = v_row.stripe_subscription_id;
    return jsonb_build_object('before', to_jsonb(v_after), 'after', to_jsonb(v_after), 'applied', false);
  end if;

  return jsonb_build_object(
    'before',  case when v_before.id is null then null else to_jsonb(v_before) end,
    'after',   to_jsonb(v_after),
    'applied', true
  );
end;
$$;

revoke all on function public.billing_upsert_subscription(jsonb)
  from public, anon, authenticated;

-- Grants a pass once per Checkout Session. A redelivered completion finds the
-- pass already there and returns it as first granted, with created false, so
-- the webhook neither grants twice nor audits twice.
--
-- The window is decided here, not by the caller. Passes of the same plan
-- stack (packages/domain nextPassStart): the new one starts where the
-- learner's latest unrevoked pass of that plan ends, or at p_pass.at when
-- none is running. Reading that end and inserting after it happen under a
-- per-learner lock, so two purchases completed at the same moment — two
-- tabs, a card payment landing beside a SEPA pass's delayed success — queue
-- rather than both starting at the same instant and running side by side.
-- Days are 24 hours each, as the domain counts them.
create or replace function public.billing_grant_pass(p_pass jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row    public.plan_passes;
  v_days   integer     := (p_pass ->> 'pass_days')::integer;
  v_at     timestamptz := (p_pass ->> 'at')::timestamptz;
  v_starts timestamptz;
  v_pass   public.plan_passes;
begin
  v_row := jsonb_populate_record(null::public.plan_passes, p_pass);

  if v_days is null or v_days < 1 or v_at is null then
    raise exception 'a pass needs its days and the moment it was paid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plan_passes:' || v_row.learner_id::text, 0));

  select * into v_pass
    from public.plan_passes p
   where p.stripe_checkout_session_id = v_row.stripe_checkout_session_id;

  if v_pass.id is not null then
    return jsonb_build_object('pass', to_jsonb(v_pass), 'created', false);
  end if;

  select greatest(v_at, coalesce(max(p.ends_at), v_at)) into v_starts
    from public.plan_passes p
   where p.learner_id = v_row.learner_id
     and p.plan_code = v_row.plan_code
     and p.revoked_at is null;

  insert into public.plan_passes (
    learner_id, plan_code, starts_at, ends_at, stripe_checkout_session_id,
    stripe_payment_intent_id, amount_minor, currency
  ) values (
    v_row.learner_id, v_row.plan_code, v_starts, v_starts + v_days * interval '24 hours',
    v_row.stripe_checkout_session_id, v_row.stripe_payment_intent_id,
    v_row.amount_minor, v_row.currency
  )
  returning * into v_pass;

  return jsonb_build_object('pass', to_jsonb(v_pass), 'created', true);
end;
$$;

revoke all on function public.billing_grant_pass(jsonb)
  from public, anon, authenticated;

-- Revokes the pass a refunded payment bought. Returns what was revoked — the
-- pass, its learner and plan, never an amount — or null when there was
-- nothing left to revoke: an unknown payment, or a second refund event for
-- one already revoked. The first refund's time stands.
--
-- The learner's later passes of the same plan were stacked behind this one,
-- so they move forward by what of it was still to come: refunded on day 10
-- of 180, the next pass starts on day 10 rather than day 180, and a learner
-- holding a paid, unrevoked pass is never left on Free waiting out a window
-- that no longer exists. Under the same lock as a grant, so a pass cannot be
-- stacked against an end that is being moved.
create or replace function public.billing_revoke_pass(
  p_payment_intent_id text,
  p_at                timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_learner uuid;
  v_pass    public.plan_passes;
  v_unused  interval;
begin
  select p.learner_id into v_learner
    from public.plan_passes p
   where p.stripe_payment_intent_id = p_payment_intent_id;

  if v_learner is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plan_passes:' || v_learner::text, 0));

  update public.plan_passes p
     set revoked_at = p_at
   where p.stripe_payment_intent_id = p_payment_intent_id
     and p.revoked_at is null
  returning * into v_pass;

  if v_pass.id is null then
    return null;
  end if;

  v_unused := v_pass.ends_at - greatest(v_pass.starts_at, least(p_at, v_pass.ends_at));

  if v_unused > interval '0' then
    update public.plan_passes p
       set starts_at = p.starts_at - v_unused,
           ends_at   = p.ends_at - v_unused
     where p.learner_id = v_pass.learner_id
       and p.plan_code = v_pass.plan_code
       and p.revoked_at is null
       and p.id <> v_pass.id
       and p.starts_at >= v_pass.ends_at;
  end if;

  return jsonb_build_object('id', v_pass.id, 'learner_id', v_pass.learner_id, 'plan_code', v_pass.plan_code);
end;
$$;

revoke all on function public.billing_revoke_pass(text, timestamptz)
  from public, anon, authenticated;

-- Opens Premium's one trial: records the trial checkout, or says why not
-- (spec S6, "one 7-day trial per learner, ever").
--   'created' with the row's id: open the Checkout Session for it.
--   'open'    a trial checkout from the last p_open_for_seconds (the
--             session's lifetime, which the provider sets) could still be
--             completed on Stripe's page; a second would be a second trial.
--   'used'    a trial checkout completed, or the learner has any
--             subscription row at all.
-- Under a per-learner lock, so two presses of the button cannot both find
-- nothing and both open a session. A checkout that failed before a session
-- existed, or whose session expired, holds nothing. Five minutes beyond the
-- lifetime allow for a completion announced a little late.
create or replace function public.billing_open_trial_checkout(
  p_learner_id       uuid,
  p_offer_key        text,
  p_terms_version    text,
  p_open_for_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_open_for_seconds is null or p_open_for_seconds < 1 then
    raise exception 'a trial checkout has a lifetime' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('trial:' || p_learner_id::text, 0));

  if exists (select 1 from public.subscriptions s where s.learner_id = p_learner_id)
     or exists (
       select 1 from public.billing_checkouts c
        where c.learner_id = p_learner_id and c.kind = 'trial' and c.status = 'completed'
     ) then
    return jsonb_build_object('status', 'used');
  end if;

  if exists (
    select 1 from public.billing_checkouts c
     where c.learner_id = p_learner_id
       and c.kind = 'trial'
       and c.status in ('created', 'opened')
       and c.created_at > now() - make_interval(secs => p_open_for_seconds + 300)
  ) then
    return jsonb_build_object('status', 'open');
  end if;

  -- billing_checkouts_trial_is_premium holds the offer to Premium's.
  insert into public.billing_checkouts (learner_id, offer_key, kind, terms_version)
  values (p_learner_id, p_offer_key, 'trial', p_terms_version)
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

revoke all on function public.billing_open_trial_checkout(uuid, text, text, integer)
  from public, anon, authenticated;

-- Replaces the price mirror with what Stripe lists as active now, in one
-- transaction, so the pricing page never reads half a sync.
--
-- A price Stripe stopped listing is marked inactive rather than deleted: the
-- row is the record of what was on sale and when it was last seen. The
-- deactivation runs first, because a price change in Stripe is a new Price
-- that takes over the lookup key, and the new row may not be active beside
-- the old one.
create or replace function public.billing_replace_prices(
  p_prices     jsonb,
  p_fetched_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_upserted    integer;
  v_deactivated integer;
begin
  update public.billing_prices b
     set active     = false,
         fetched_at = p_fetched_at
   where b.active
     and not exists (
       select 1
         from jsonb_populate_recordset(null::public.billing_prices, coalesce(p_prices, '[]'::jsonb)) r
        where r.stripe_price_id = b.stripe_price_id
          and r.currency = b.currency
     );
  get diagnostics v_deactivated = row_count;

  insert into public.billing_prices (
    stripe_price_id, currency, lookup_key, plan_code, kind, billing_interval,
    pass_days, unit_amount_minor, tax_behavior, active, fetched_at
  )
  select
    r.stripe_price_id, r.currency, r.lookup_key, r.plan_code, r.kind, r.billing_interval,
    r.pass_days, r.unit_amount_minor, r.tax_behavior, true, p_fetched_at
  from jsonb_populate_recordset(null::public.billing_prices, coalesce(p_prices, '[]'::jsonb)) r
  on conflict (stripe_price_id, currency) do update
    set lookup_key        = excluded.lookup_key,
        plan_code         = excluded.plan_code,
        kind              = excluded.kind,
        billing_interval  = excluded.billing_interval,
        pass_days         = excluded.pass_days,
        unit_amount_minor = excluded.unit_amount_minor,
        tax_behavior      = excluded.tax_behavior,
        active            = true,
        fetched_at        = excluded.fetched_at;
  get diagnostics v_upserted = row_count;

  return jsonb_build_object('upserted', v_upserted, 'deactivated', v_deactivated);
end;
$$;

revoke all on function public.billing_replace_prices(jsonb, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A plan's own euro budget (spec S9)
-- ---------------------------------------------------------------------------
--
-- budget_limits already holds a learner's override in scope_key, keyed by the
-- ledger's pseudonym. A plan's default sits in the same column as
-- 'plan:<code>', so the gate stays one query, the counters stay keyed by the
-- learner, and a plan bounds each of its learners rather than all of them
-- together. Resolution per scope: the learner's own row, then their plan's,
-- then the scope's default.
--
-- The plan is passed by the gateway, which has it from the server's own
-- entitlement read; it is never a client claim (spec S3). A call that names
-- no plan resolves exactly as before this migration.

-- A new parameter changes the signature, so the old function is dropped
-- rather than overloaded: two budget_snapshots, one blind to plans, is a gate
-- that can be called around.
drop function public.budget_snapshot(text, timestamptz);

create function public.budget_snapshot(
  p_user_id_hash text        default null,
  p_now          timestamptz default now(),
  p_plan         text        default null
)
returns table (
  scope       text,
  scope_key   text,
  limit_eur   numeric,
  spent_eur   numeric,
  warn_pct    numeric,
  degrade_pct numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with applicable as (
    select distinct on (l.scope)
      l.scope,
      l.scope_key,
      l.limit_eur,
      l.warn_pct,
      l.degrade_pct
    from public.budget_limits l
    where l.active
      -- per_request is an accumulator on the request context, never a row.
      and l.scope <> 'per_request'
      and (
        l.scope_key is null
        or l.scope_key = p_user_id_hash
        -- A plan is a per-learner bound; the global scope is nobody's plan.
        or (l.scope like 'per\_user%' and l.scope_key = 'plan:' || p_plan)
      )
    -- The learner's own row, then their plan's, then the scope's default.
    order by
      l.scope,
      case
        when l.scope_key = p_user_id_hash then 0
        when l.scope_key is not null      then 1
        else 2
      end
  )
  select
    a.scope,
    case when a.scope like 'per\_user%' then p_user_id_hash else a.scope_key end,
    a.limit_eur,
    coalesce(c.spent_eur, 0),
    a.warn_pct,
    a.degrade_pct
  from applicable a
  left join public.budget_counters c
    on c.scope = a.scope
   -- Always the learner's own counter, whichever row set the limit.
   and c.scope_key is not distinct from
       (case when a.scope like 'per\_user%' then p_user_id_hash else a.scope_key end)
   and c.period_start = (
         case when a.scope = 'per_user_monthly'
              then date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'
              else date_trunc('day',   p_now at time zone 'UTC') at time zone 'UTC'
         end);
$$;

revoke all on function public.budget_snapshot(text, timestamptz, text)
  from public, anon, authenticated;

-- set_budget_limit, as before, with the key held to what budget_snapshot can
-- match: a learner's pseudonym or a plan. Anything else — an email, an
-- account id, a plan nobody sells — is a row the gate would never read. And a
-- plan's default, like a scope's, is lowered rather than switched off:
-- paused, every learner on the plan falls through to the scope's default, or
-- to no limit where the scope has none.
create or replace function public.set_budget_limit(
  p_scope       text,
  p_scope_key   text,
  p_limit_eur   numeric,
  p_warn_pct    numeric,
  p_degrade_pct numeric,
  p_active      boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.budget_limits;
  v_after  public.budget_limits;
begin
  if p_scope not in ('global_daily', 'per_user_daily', 'per_user_monthly') then
    raise exception 'budget scope % is not set from the table', p_scope
      using errcode = '22023';
  end if;

  if p_scope = 'global_daily' and p_scope_key is not null then
    raise exception 'the global scope takes no key' using errcode = '22023';
  end if;

  if p_scope_key is not null
     and p_scope_key !~ '^[0-9a-f]{32}$'
     and p_scope_key !~ '^plan:(free|plus|premium)$' then
    raise exception 'a key is a learner pseudonym or a plan' using errcode = '22023';
  end if;

  if p_scope_key is null and not coalesce(p_active, false) then
    raise exception 'a scope''s default cannot be switched off' using errcode = '22023';
  end if;

  if p_scope_key like 'plan:%' and not coalesce(p_active, false) then
    raise exception 'a plan''s default cannot be switched off' using errcode = '22023';
  end if;

  select * into v_before
    from public.budget_limits l
   where l.scope = p_scope
     and l.scope_key is not distinct from p_scope_key
     for update;

  insert into public.budget_limits
    (scope, scope_key, limit_eur, warn_pct, degrade_pct, active)
  values
    (p_scope, p_scope_key, p_limit_eur, p_warn_pct, p_degrade_pct, p_active)
  on conflict on constraint budget_limits_one_per_scope do update
    set limit_eur   = excluded.limit_eur,
        warn_pct    = excluded.warn_pct,
        degrade_pct = excluded.degrade_pct,
        active      = excluded.active
  returning * into v_after;

  return jsonb_build_object(
    'before', case when v_before.id is null then null else to_jsonb(v_before) end,
    'after',  to_jsonb(v_after)
  );
end;
$$;

revoke all on function public.set_budget_limit(text, text, numeric, numeric, numeric, boolean)
  from public, anon, authenticated;

-- remove_budget_override, as before, and never a plan's default: those are
-- defaults, lowered and raised but not removed.
create or replace function public.remove_budget_override(
  p_scope     text,
  p_scope_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with removed as (
    delete from public.budget_limits l
     where l.scope = p_scope
       and l.scope_key = p_scope_key
       and l.scope_key not like 'plan:%'
    returning l.*
  )
  select to_jsonb(removed) from removed;
$$;

revoke all on function public.remove_budget_override(text, text)
  from public, anon, authenticated;

-- The starting values of spec S9, below each paid plan's net monthly revenue
-- at the annual price, so no learner is served at a loss. Degraded one tier at
-- 90%, refused at 100%. The operator changes them on the budgets page; a
-- deployment that already set one keeps its own.
insert into public.budget_limits (scope, scope_key, limit_eur, warn_pct, degrade_pct)
values
  ('per_user_monthly', 'plan:free',    1.0000, 0.7, 0.9),
  ('per_user_monthly', 'plan:plus',    4.0000, 0.7, 0.9),
  ('per_user_monthly', 'plan:premium', 9.0000, 0.7, 0.9)
on conflict on constraint budget_limits_one_per_scope do nothing;

-- ---------------------------------------------------------------------------
-- The export (guardrails S16)
-- ---------------------------------------------------------------------------

-- As before, with the four billing tables: what a learner bought, the orders
-- and consents they placed, and the Stripe customer they are. A test holds
-- the keys here to every foreign key to profiles.
create or replace function public.ops_learner_export(p_learner_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when not exists (select 1 from public.profiles p where p.id = p_learner_id) then null
  else jsonb_build_object(
    'exportedAt', now(),
    'profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.profiles x where x.id = p_learner_id), '[]'::jsonb),
    'learner_states', coalesce((select jsonb_agg(to_jsonb(x)) from public.learner_states x where x.learner_id = p_learner_id), '[]'::jsonb),
    'learner_vocabulary', coalesce((select jsonb_agg(to_jsonb(x)) from public.learner_vocabulary x where x.learner_id = p_learner_id), '[]'::jsonb),
    'learner_errors', coalesce((select jsonb_agg(to_jsonb(x)) from public.learner_errors x where x.learner_id = p_learner_id), '[]'::jsonb),
    'learner_memories', coalesce((select jsonb_agg(to_jsonb(x)) from public.learner_memories x where x.learner_id = p_learner_id), '[]'::jsonb),
    'recommendations', coalesce((select jsonb_agg(to_jsonb(x)) from public.recommendations x where x.learner_id = p_learner_id), '[]'::jsonb),
    'assessments', coalesce((select jsonb_agg(to_jsonb(x)) from public.assessments x where x.learner_id = p_learner_id), '[]'::jsonb),
    'conversation_threads', coalesce((select jsonb_agg(to_jsonb(x)) from public.conversation_threads x where x.learner_id = p_learner_id), '[]'::jsonb),
    'level_performances', coalesce((select jsonb_agg(to_jsonb(x)) from public.level_performances x where x.learner_id = p_learner_id), '[]'::jsonb),
    'trainer_coaching_profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.trainer_coaching_profiles x where x.learner_id = p_learner_id), '[]'::jsonb),
    'trainer_feedback', coalesce((select jsonb_agg(to_jsonb(x)) from public.trainer_feedback x where x.learner_id = p_learner_id), '[]'::jsonb),
    'trainer_mined_sessions', coalesce((select jsonb_agg(to_jsonb(x)) from public.trainer_mined_sessions x where x.learner_id = p_learner_id), '[]'::jsonb),
    'billing_customers', coalesce((select jsonb_agg(to_jsonb(x)) from public.billing_customers x where x.learner_id = p_learner_id), '[]'::jsonb),
    'billing_checkouts', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.billing_checkouts x where x.learner_id = p_learner_id), '[]'::jsonb),
    'subscriptions', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.subscriptions x where x.learner_id = p_learner_id), '[]'::jsonb),
    'plan_passes', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from public.plan_passes x where x.learner_id = p_learner_id), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.ops_learner_export(uuid) from public, anon, authenticated;
