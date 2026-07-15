-- ══════════════════════════════════════════════════════════════
-- MAILONE — Schéma Supabase
-- Exécutez ce fichier dans Supabase → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════

-- ── EXTENSION UUID ───────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── TABLE USERS ──────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default uuid_generate_v4(),
  email         text unique not null,
  password_hash text not null,
  first_name    text,
  last_name     text,
  company       text,
  phone         text,
  sector        text,
  marketing     boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  last_login    timestamptz,
  is_active     boolean default true
);

-- ── TABLE SUBSCRIPTIONS ──────────────────────────────────────
create table if not exists subscriptions (
  id                    uuid primary key default uuid_generate_v4(),
  user_id               uuid references users(id) on delete cascade,
  stripe_customer_id    text unique,
  stripe_subscription_id text unique,
  plan                  text check (plan in ('solo','team','enterprise')),
  billing               text check (billing in ('monthly','annual')),
  status                text check (status in ('trialing','active','past_due','canceled','incomplete')),
  trial_end             timestamptz,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ── TABLE REFERRALS ──────────────────────────────────────────
create table if not exists referrals (
  id              uuid primary key default uuid_generate_v4(),
  referrer_id     uuid references users(id) on delete cascade,
  referee_id      uuid references users(id) on delete cascade,
  referral_code   text unique not null,
  status          text check (status in ('pending','trial','converted','rewarded')) default 'pending',
  reward_months   int default 0,
  reward_applied  boolean default false,
  created_at      timestamptz default now(),
  converted_at    timestamptz
);

-- ── TABLE EMAIL LOGS ─────────────────────────────────────────
create table if not exists email_logs (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references users(id) on delete set null,
  type        text not null,
  to_email    text not null,
  status      text default 'sent',
  resend_id   text,
  created_at  timestamptz default now()
);

-- ── TABLE SESSIONS (optionnel, si pas JWT) ───────────────────
create table if not exists sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references users(id) on delete cascade,
  token_hash  text unique not null,
  user_agent  text,
  ip_address  text,
  expires_at  timestamptz not null,
  created_at  timestamptz default now()
);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
alter table users enable row level security;
alter table subscriptions enable row level security;
alter table referrals enable row level security;

-- Policy : chaque user ne voit que ses propres données
create policy "Users can read own data" on users
  for select using (auth.uid()::text = id::text);

create policy "Users can update own data" on users
  for update using (auth.uid()::text = id::text);

create policy "Users can read own subscription" on subscriptions
  for select using (auth.uid()::text = user_id::text);

-- ── INDEXES ──────────────────────────────────────────────────
create index if not exists idx_users_email on users(email);
create index if not exists idx_subscriptions_user_id on subscriptions(user_id);
create index if not exists idx_subscriptions_stripe_customer on subscriptions(stripe_customer_id);
create index if not exists idx_referrals_code on referrals(referral_code);
create index if not exists idx_referrals_referrer on referrals(referrer_id);

-- ── TRIGGER updated_at ───────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_users_updated_at
  before update on users
  for each row execute function update_updated_at();

create trigger update_subscriptions_updated_at
  before update on subscriptions
  for each row execute function update_updated_at();

-- ── TABLE TEAMS ──────────────────────────────────────────────
create table if not exists teams (
  id         uuid primary key default uuid_generate_v4(),
  owner_id   uuid references users(id) on delete cascade,
  name       text not null,
  max_seats  int default 10,
  created_at timestamptz default now()
);

-- ── TABLE TEAM_MEMBERS ────────────────────────────────────────
create table if not exists team_members (
  id             uuid primary key default uuid_generate_v4(),
  team_id        uuid references teams(id) on delete cascade,
  user_id        uuid references users(id) on delete set null,
  role           text check (role in ('owner','admin','member')) default 'member',
  status         text check (status in ('invited','active','suspended')) default 'invited',
  invited_email  text,
  invite_token   text unique,
  joined_at      timestamptz,
  created_at     timestamptz default now()
);

-- ── TABLE PUSH_SUBSCRIPTIONS ──────────────────────────────────
create table if not exists push_subscriptions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references users(id) on delete cascade,
  endpoint   text unique not null,
  p256dh     text,
  auth       text,
  created_at timestamptz default now()
);

create index if not exists idx_team_members_team on team_members(team_id);
create index if not exists idx_team_members_user on team_members(user_id);
create index if not exists idx_push_subs_user on push_subscriptions(user_id);

-- ── COLONNES MANQUANTES SUR USERS ────────────────────────────
-- À exécuter si la table users existait déjà sans ces colonnes
alter table users add column if not exists reset_token          text;
alter table users add column if not exists reset_token_expires  timestamptz;
alter table users add column if not exists avatar_url           text;

-- ══════════════════════════════════════════════════════════════
-- ✅ Schéma créé avec succès
-- Prochaine étape : déployez le backend et configurez les variables .env
-- ══════════════════════════════════════════════════════════════

-- ── TABLE AI_USAGE (quotas fair use) ─────────────────────────
-- Ajoutez cette table à votre schéma existant
create table if not exists ai_usage (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references users(id) on delete cascade,
  month_key   text not null,   -- format : "2025-03"
  count       int default 0,
  updated_at  timestamptz default now(),
  unique(user_id, month_key)
);

create index if not exists idx_ai_usage_user_month on ai_usage(user_id, month_key);

-- ── OPTION 3 : BASCULE AUTOMATIQUE VERS AGENT LOCAL ──────────
-- Commentaire dans le code frontend :
-- Quand l'API retourne { code: 'QUOTA_EXCEEDED', fallback: 'local_agent' }
-- Le frontend bascule automatiquement sur AGENT.type() local
-- L'utilisateur voit un message : "Quota mensuel atteint — agent local activé"

-- ── TABLE EMAIL_SEQUENCE (tracking emails onboarding) ────────
-- Ajoutez cette table pour tracker quels emails ont été envoyés
create table if not exists email_sequence (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references users(id) on delete cascade,
  welcome_sent    boolean default false,
  welcome_sent_at timestamptz,
  j3_sent         boolean default false,
  j3_sent_at      timestamptz,
  j11_sent        boolean default false,
  j11_sent_at     timestamptz,
  j14_sent        boolean default false,
  j14_sent_at     timestamptz,
  created_at      timestamptz default now(),
  unique(user_id)
);

create index if not exists idx_email_sequence_user on email_sequence(user_id);

-- Trigger : créer automatiquement une ligne email_sequence à chaque inscription
create or replace function create_email_sequence()
returns trigger as $$
begin
  insert into email_sequence (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql;

create trigger on_user_created_email_sequence
  after insert on users
  for each row execute function create_email_sequence();

-- ── TABLE MAIL_STATUS (dashboard triage) ─────────────────────
-- Mémorise uniquement l'identifiant du mail + son statut (traité/ignoré).
-- AUCUN contenu de mail n'est stocké — cohérent avec la promesse
-- « zéro donnée stockée sur nos serveurs » de la FAQ.
create table if not exists mail_status (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references users(id) on delete cascade,
  mail_id    text not null,
  status     text check (status in ('handled','dismissed')) not null,
  handled_at timestamptz default now(),
  unique(user_id, mail_id)
);

create index if not exists idx_mail_status_user on mail_status(user_id);

-- ── TABLE EVENTS (agenda) ────────────────────────────────────
-- Rendez-vous créés par l'utilisateur — titre + date uniquement.
create table if not exists events (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references users(id) on delete cascade,
  title      text not null,
  starts_at  timestamptz not null,
  mail_id    text,
  created_at timestamptz default now()
);

create index if not exists idx_events_user on events(user_id, starts_at);

-- ── TABLE CONTACTS (carnet clients) ──────────────────────────
-- Coordonnées extraites des mails — JAMAIS le contenu des emails.
create table if not exists contacts (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references users(id) on delete cascade,
  name       text,
  email      text not null,
  phone      text,
  address    text,
  first_seen timestamptz default now(),
  last_seen  timestamptz default now(),
  unique(user_id, email)
);
create index if not exists idx_contacts_user on contacts(user_id, last_seen);

-- ── TABLE PROSPECTS (agent veille/relance commerciale) ───────
create table if not exists prospects (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid references users(id) on delete cascade,
  name           text not null,
  metier         text,
  ville          text,
  canal          text default 'email',
  statut         text check (statut in ('a_contacter','contacte','relance','repondu','client','perdu')) default 'a_contacter',
  notes          text,
  last_action_at timestamptz,
  created_at     timestamptz default now()
);
create index if not exists idx_prospects_user on prospects(user_id, created_at);
