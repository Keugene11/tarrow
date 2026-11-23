create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text,
  city text,
  timezone text not null default 'America/New_York',
  agent_style text not null default 'direct',
  life_file text not null default '',
  onboarded_at timestamptz,
  interview_conversation_id uuid,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null default 'chat',
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on conversations(user_id, updated_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  content text not null default '',
  run_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on messages(conversation_id, created_at);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  parent_run_id uuid references runs(id) on delete cascade,
  kind text not null default 'main',
  title text not null default '',
  effort text not null default 'auto',
  status text not null default 'queued',
  state jsonb not null default '{}'::jsonb,
  result text,
  error text,
  seq int not null default 0,
  lease_id text,
  lease_until timestamptz,
  deadline_at timestamptz,
  tokens_used int not null default 0,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists runs_user_idx on runs(user_id, created_at desc);
create index if not exists runs_parent_idx on runs(parent_run_id);
create index if not exists runs_active_idx on runs(status) where status in ('queued','running','waiting');

create table if not exists run_events (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  seq int not null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  category text not null default 'other',
  content text not null,
  source text not null default 'chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memories_user_idx on memories(user_id, category);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  why text,
  target_date date,
  status text not null default 'active',
  progress int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists goals_user_idx on goals(user_id, status);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  goal_id uuid references goals(id) on delete set null,
  title text not null,
  notes text,
  due_at timestamptz,
  status text not null default 'open',
  created_by text not null default 'user',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_user_idx on tasks(user_id, status, due_at);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  run_id uuid,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_user_idx on documents(user_id, created_at desc);

create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  prompt text not null,
  cadence text not null default 'weekly',
  weekday int,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  active boolean not null default true,
  conversation_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists routines_due_idx on routines(next_run_at) where active;

create table if not exists usage_daily (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  runs int not null default 0,
  tokens int not null default 0,
  primary key (user_id, day)
);

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null default 'idea',
  title text not null,
  body text not null default '',
  prompt text,
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists suggestions_user_idx on suggestions(user_id, dismissed, created_at desc);

create table if not exists auth_attempts (
  id bigserial primary key,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_key_idx on auth_attempts(key, created_at desc);

create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

alter table users alter column password_hash drop not null;
alter table users add column if not exists google_sub text;
alter table users add column if not exists avatar_url text;
create unique index if not exists users_google_sub_idx on users(google_sub) where google_sub is not null;

create table if not exists login_codes (
  code_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table login_codes add column if not exists challenge text;

alter table users add column if not exists apple_sub text;
create unique index if not exists users_apple_sub_idx on users(apple_sub) where apple_sub is not null;

-- Native push device tokens (iOS APNs today).
create table if not exists native_push_tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists native_push_tokens_user_idx on native_push_tokens(user_id);

-- Explicit permission to send personal data to third-party AI (App Store guideline 5.1.2(i)).
alter table users add column if not exists ai_consent_at timestamptz;

-- Paid plans. One row per store subscription (Stripe subscription, Apple original transaction, Google purchase token).
alter table users add column if not exists stripe_customer_id text;
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  external_id text not null,
  product text not null,
  status text not null,
  current_period_end timestamptz,
  will_renew boolean not null default true,
  environment text not null default 'production',
  checked_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists subscriptions_user_idx on subscriptions(user_id, current_period_end desc);

-- Coach persona (see src/lib/coaches.ts) and a pasted resume for job hunting.
alter table users add column if not exists coach text not null default 'tarrow';
alter table users add column if not exists coach_custom jsonb;
alter table users add column if not exists resume text not null default '';

-- Pipeline: people to reach out to and jobs to apply for, filled by the agent (find_people / find_jobs) and routines.
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  role text,
  company text,
  kind text not null default 'other',
  url text,
  email text,
  why text,
  channel text not null default 'dm',
  draft text,
  status text not null default 'to_contact',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_user_idx on contacts(user_id, status, created_at desc);
create unique index if not exists contacts_user_url_idx on contacts(user_id, lower(url)) where url is not null;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  company text not null,
  location text,
  url text not null,
  source text,
  salary text,
  fit int,
  why text,
  pitch text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_user_idx on jobs(user_id, status, created_at desc);
create unique index if not exists jobs_user_url_idx on jobs(user_id, lower(url));

-- Guests: logged-out visitors get a real account row on their first message (interview + a few tasks), merged into
-- their real account when they sign up or log in (src/lib/guest.ts). Unclaimed guests are deleted after 30 days.
alter table users add column if not exists is_guest boolean not null default false;
create index if not exists users_guest_idx on users(created_at) where is_guest;
-- Gmail connections (Settings → Connected accounts). Tokens are encrypted with GMAIL_TOKEN_KEY (lib/gmail.ts).
create table if not exists gmail_connections (
  user_id uuid primary key references users(id) on delete cascade,
  email text not null,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  scopes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
