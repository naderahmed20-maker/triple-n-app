alter table public.apple_external_purchase_tokens
    add column if not exists acquisition_external_purchase_id text,
    add column if not exists acquisition_token_created_at_ms bigint,
    add column if not exists acquisition_token_expires_at_ms bigint,

    add column if not exists services_external_purchase_id text,
    add column if not exists services_token_created_at_ms bigint,
    add column if not exists services_token_expires_at_ms bigint;

alter table public.apple_external_purchase_reports
    add column if not exists request_identifier uuid,
    add column if not exists line_item_id uuid,
    add column if not exists reference_line_item_id uuid,

    add column if not exists external_purchase_id text,
    add column if not exists subscription_event text,

    add column if not exists request_payload jsonb;

create unique index if not exists
apple_external_purchase_reports_request_identifier_idx
on public.apple_external_purchase_reports(request_identifier)
where request_identifier is not null;

create unique index if not exists
apple_external_purchase_reports_line_item_id_idx
on public.apple_external_purchase_reports(line_item_id)
where line_item_id is not null;

create index if not exists
apple_external_purchase_reports_external_purchase_id_idx
on public.apple_external_purchase_reports(external_purchase_id);
