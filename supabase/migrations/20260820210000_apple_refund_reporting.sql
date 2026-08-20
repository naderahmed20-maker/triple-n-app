create table if not exists public.apple_external_purchase_refund_reports (
    id uuid primary key default gen_random_uuid(),

    user_id uuid
        references auth.users(id)
        on delete set null,

    stripe_refund_id text not null unique,
    stripe_invoice_id text not null,
    stripe_subscription_id text,

    request_identifier uuid not null unique,
    refund_line_item_id uuid not null unique,
    reference_line_item_id uuid not null,

    external_purchase_id text not null,

    refund_amount_inclusive_minor bigint not null,
    refund_amount_exclusive_minor bigint not null,
    refund_tax_minor bigint not null,

    status text not null
        check (
            status in (
                'pending',
                'submitted',
                'failed'
            )
        ),

    request_payload jsonb,
    apple_response jsonb,
    error_message text,

    attempted_at timestamptz,
    submitted_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.apple_external_purchase_refund_reports
enable row level security;

revoke all
on table public.apple_external_purchase_refund_reports
from anon, authenticated;

create index if not exists
apple_external_purchase_refund_invoice_idx
on public.apple_external_purchase_refund_reports(
    stripe_invoice_id
);

create index if not exists
apple_external_purchase_refund_status_idx
on public.apple_external_purchase_refund_reports(
    status
);
