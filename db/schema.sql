create extension if not exists pgcrypto;

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text        not null,

  username_ci   text        not null unique,
  password_hash text        not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create table if not exists profiles (
  user_id    uuid primary key references users(id) on delete cascade,
  loadout    jsonb       not null default '[]'::jsonb,
  settings   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists stats (
  user_id       uuid primary key references users(id) on delete cascade,
  kills         integer     not null default 0,
  deaths        integer     not null default 0,
  wins          integer     not null default 0,
  matches       integer     not null default 0,
  best_district integer     not null default 0,
  best_zombies  integer     not null default 0,
  updated_at    timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text        primary key,
  user_id    uuid        not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sessions_user_idx    on sessions (user_id);
create index if not exists sessions_expires_idx on sessions (expires_at);
create index if not exists stats_kills_idx      on stats (kills desc);
create index if not exists stats_wins_idx       on stats (wins desc);
