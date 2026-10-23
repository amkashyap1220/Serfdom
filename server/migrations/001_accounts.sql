-- Phase 7a: accounts and login sessions (D-058).

create table accounts (
  id bigint generated always as identity primary key,
  -- Stored normalized (trimmed, lowercase); unique.
  email text not null unique,
  -- scrypt hash with its parameters and salt; never the password itself.
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  -- SHA-256 of the token the client holds. A leaked database therefore
  -- does not hand out working logins.
  token_hash bytea primary key,
  account_id bigint not null references accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index sessions_account_id_idx on sessions (account_id);
