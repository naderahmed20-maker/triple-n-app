create table if not exists public.apple_external_purchase_tokens (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    acquisition_token text,
    services_token text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique(user_id)
);

alter table public.apple_external_purchase_tokens
enable row level security;

revoke all
on table public.apple_external_purchase_tokens
from anon, authenticated;

create index if not exists
apple_external_purchase_tokens_user_id_idx
on public.apple_external_purchase_tokens(user_id);
