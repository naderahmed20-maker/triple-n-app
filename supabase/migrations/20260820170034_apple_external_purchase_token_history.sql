create table if not exists public.apple_external_purchase_token_history (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    token_type text not null
        check (token_type in ('ACQUISITION', 'SERVICES')),

    external_purchase_id text not null,

    raw_token text not null,

    token_created_at_ms bigint not null,
    token_expires_at_ms bigint not null,

    report_status text
        check (
            report_status is null
            or report_status in (
                'LINE_ITEM',
                'NO_LINE_ITEM',
                'DUPLICATE_TOKEN'
            )
        ),

    report_request_identifier uuid,

    report_attempted_at timestamptz,
    report_submitted_at timestamptz,

    report_error text,
    apple_response jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique(external_purchase_id)
);

alter table public.apple_external_purchase_token_history
enable row level security;

revoke all
on table public.apple_external_purchase_token_history
from anon, authenticated;

create index if not exists
apple_external_purchase_token_history_user_idx
on public.apple_external_purchase_token_history(user_id);

create index if not exists
apple_external_purchase_token_history_expiry_idx
on public.apple_external_purchase_token_history(token_expires_at_ms);

create index if not exists
apple_external_purchase_token_history_unreported_idx
on public.apple_external_purchase_token_history(
    report_status,
    token_expires_at_ms
);
