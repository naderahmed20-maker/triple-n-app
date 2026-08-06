-- issue-reports.sql
--
-- Triple N - App Issue Reporting Database
--
-- المسؤوليات:
--
-- 1) تخزين المشكلات الخمس المعروضة للمستخدم.
-- 2) تسجيل المستخدم الذي ضغط على كل مشكلة.
-- 3) منع احتساب المستخدم أكثر من مرة ضمن عدد المستخدمين الفريدين.
-- 4) الاحتفاظ بعدد مرات الضغط الفعلي من المستخدم نفسه.
-- 5) حفظ أول وآخر وقت للإبلاغ.
-- 6) حفظ نسخة من البريد والمنصة وإصدار التطبيق والجهاز.
-- 7) توفير إحصائيات جاهزة لاستخدامها في Discord لاحقًا.
-- 8) حماية البيانات باستخدام Row Level Security.
-- 9) منع المستخدم من تزوير User ID أو البريد الإلكتروني.
-- 10) جعل التسجيل Atomic من خلال PostgreSQL RPC واحدة.

begin;

/* =========================================================
 * Required extensions
 * ======================================================= */

create extension if not exists pgcrypto;

/* =========================================================
 * Issue catalog
 * ======================================================= */

create table if not exists public.issue_report_options (
  issue_key text primary key,

  title_en text not null,

  description_en text not null,

  display_order integer not null,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint issue_report_options_key_format_check
    check (
      issue_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
    ),

  constraint issue_report_options_title_check
    check (
      char_length(trim(title_en)) between 3 and 120
    ),

  constraint issue_report_options_description_check
    check (
      char_length(trim(description_en)) between 3 and 500
    ),

  constraint issue_report_options_display_order_check
    check (
      display_order > 0
    )
);

/* =========================================================
 * Seed the five supported issues
 * ======================================================= */

insert into public.issue_report_options (
  issue_key,
  title_en,
  description_en,
  display_order,
  is_active
)
values
  (
    'scan_item_not_completed',
    'Scan Item did not complete',
    'The item stayed in processing or the scan did not finish successfully.',
    1,
    true
  ),
  (
    'processed_item_not_visible',
    'My processed item is not visible',
    'The scan finished, but the item or its image is missing from the wardrobe.',
    2,
    true
  ),
  (
    'background_removal_problem',
    'The background removal result is incorrect',
    'Part of the clothing item is missing, or unwanted background remains visible.',
    3,
    true
  ),
  (
    'app_slow_or_frozen',
    'The app is slow or frozen',
    'The app became unusually slow, stopped responding, or closed unexpectedly.',
    4,
    true
  ),
  (
    'outfit_or_wardrobe_problem',
    'Wardrobe or outfit features are not working',
    'A wardrobe item, outfit, favorite, filter, or related feature is not working correctly.',
    5,
    true
  )
on conflict (
  issue_key
)
do update
set
  title_en =
    excluded.title_en,

  description_en =
    excluded.description_en,

  display_order =
    excluded.display_order,

  is_active =
    excluded.is_active,

  updated_at =
    now();

/* =========================================================
 * User reports
 * ======================================================= */

create table if not exists public.issue_reports (
  id uuid primary key default gen_random_uuid(),

  issue_key text not null
    references public.issue_report_options (
      issue_key
    )
    on update cascade
    on delete restrict,

  user_id uuid not null
    references auth.users (
      id
    )
    on delete cascade,

  user_email text null,

  platform text not null default 'unknown',

  app_version text null,

  device_model text null,

  os_version text null,

  report_count bigint not null default 1,

  first_reported_at timestamptz not null default now(),

  last_reported_at timestamptz not null default now(),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint issue_reports_user_issue_unique
    unique (
      user_id,
      issue_key
    ),

  constraint issue_reports_platform_check
    check (
      platform in (
        'ios',
        'android',
        'unknown'
      )
    ),

  constraint issue_reports_report_count_check
    check (
      report_count >= 1
    ),

  constraint issue_reports_email_length_check
    check (
      user_email is null
      or char_length(user_email) <= 320
    ),

  constraint issue_reports_app_version_length_check
    check (
      app_version is null
      or char_length(app_version) <= 100
    ),

  constraint issue_reports_device_model_length_check
    check (
      device_model is null
      or char_length(device_model) <= 200
    ),

  constraint issue_reports_os_version_length_check
    check (
      os_version is null
      or char_length(os_version) <= 100
    )
);

/* =========================================================
 * Indexes
 * ======================================================= */

create index if not exists
  issue_report_options_active_order_index
on public.issue_report_options (
  is_active,
  display_order
);

create index if not exists
  issue_reports_issue_key_index
on public.issue_reports (
  issue_key
);

create index if not exists
  issue_reports_user_id_index
on public.issue_reports (
  user_id
);

create index if not exists
  issue_reports_last_reported_at_index
on public.issue_reports (
  last_reported_at desc
);

create index if not exists
  issue_reports_issue_last_reported_index
on public.issue_reports (
  issue_key,
  last_reported_at desc
);

/* =========================================================
 * Updated-at trigger
 * ======================================================= */

create or replace function public.set_issue_report_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at :=
    now();

  return new;
end;
$$;

drop trigger if exists
  set_issue_report_options_updated_at
on public.issue_report_options;

create trigger
  set_issue_report_options_updated_at
before update
on public.issue_report_options
for each row
execute function
  public.set_issue_report_updated_at();

drop trigger if exists
  set_issue_reports_updated_at
on public.issue_reports;

create trigger
  set_issue_reports_updated_at
before update
on public.issue_reports
for each row
execute function
  public.set_issue_report_updated_at();

/* =========================================================
 * Row Level Security
 * ======================================================= */

alter table public.issue_report_options
  enable row level security;

alter table public.issue_reports
  enable row level security;

/*
 * أي مستخدم مسجل يستطيع قراءة قائمة المشكلات النشطة فقط.
 */
drop policy if exists
  "Authenticated users can read active issue options"
on public.issue_report_options;

create policy
  "Authenticated users can read active issue options"
on public.issue_report_options
for select
to authenticated
using (
  is_active = true
);

/*
 * يستطيع المستخدم قراءة بلاغاته فقط.
 *
 * التسجيل نفسه سيتم من خلال RPC الآمنة بالأسفل،
 * وليس بإرسال user_id من التطبيق.
 */
drop policy if exists
  "Users can read their own issue reports"
on public.issue_reports;

create policy
  "Users can read their own issue reports"
on public.issue_reports
for select
to authenticated
using (
  user_id = auth.uid()
);

/* =========================================================
 * Permissions
 * ======================================================= */

revoke all
on table public.issue_report_options
from anon;

revoke all
on table public.issue_reports
from anon;

revoke insert,
       update,
       delete
on table public.issue_report_options
from authenticated;

revoke insert,
       update,
       delete
on table public.issue_reports
from authenticated;

grant select
on table public.issue_report_options
to authenticated;

grant select
on table public.issue_reports
to authenticated;

/* =========================================================
 * Safe text normalizer
 * ======================================================= */

create or replace function public.normalize_issue_report_text(
  input_value text,
  maximum_length integer
)
returns text
language plpgsql
immutable
security invoker
as $$
declare
  normalized_value text;
begin
  if input_value is null then
    return null;
  end if;

  normalized_value :=
    trim(input_value);

  if normalized_value = '' then
    return null;
  end if;

  return left(
    normalized_value,
    greatest(
      1,
      maximum_length
    )
  );
end;
$$;

/* =========================================================
 * Report issue RPC
 * ======================================================= */

create or replace function public.report_app_issue(
  p_issue_key text,
  p_platform text default 'unknown',
  p_app_version text default null,
  p_device_model text default null,
  p_os_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  authenticated_user_id uuid;

  authenticated_user_email text;

  normalized_issue_key text;

  normalized_platform text;

  selected_issue
    public.issue_report_options%rowtype;

  saved_report
    public.issue_reports%rowtype;

  unique_reporter_count bigint;

  total_report_count bigint;
begin
  authenticated_user_id :=
    auth.uid();

  if authenticated_user_id is null then
    raise exception
      using
        errcode =
          '42501',

        message =
          'Authentication is required to report an issue.';
  end if;

  normalized_issue_key :=
    lower(
      trim(
        coalesce(
          p_issue_key,
          ''
        )
      )
    );

  if normalized_issue_key = '' then
    raise exception
      using
        errcode =
          '22023',

        message =
          'The issue key is required.';
  end if;

  select
    *
  into
    selected_issue
  from public.issue_report_options
  where
    issue_key =
      normalized_issue_key
    and is_active =
      true
  limit 1;

  if not found then
    raise exception
      using
        errcode =
          '22023',

        message =
          'The selected issue is unavailable.';
  end if;

  normalized_platform :=
    lower(
      trim(
        coalesce(
          p_platform,
          'unknown'
        )
      )
    );

  if normalized_platform not in (
    'ios',
    'android'
  ) then
    normalized_platform :=
      'unknown';
  end if;

  authenticated_user_email :=
    public.normalize_issue_report_text(
      coalesce(
        auth.jwt() ->> 'email',
        ''
      ),
      320
    );

  /*
   * المستخدم نفسه يُحتسب مرة واحدة فقط
   * ضمن عدد المستخدمين الفريدين.
   *
   * عند الضغط مرة أخرى:
   *
   * - لا ننشئ صفًا جديدًا.
   * - نزيد report_count.
   * - نحدّث last_reported_at.
   * - نحدّث معلومات الجهاز والإصدار.
   */
  insert into public.issue_reports (
    issue_key,
    user_id,
    user_email,
    platform,
    app_version,
    device_model,
    os_version,
    report_count,
    first_reported_at,
    last_reported_at
  )
  values (
    selected_issue.issue_key,
    authenticated_user_id,
    authenticated_user_email,
    normalized_platform,

    public.normalize_issue_report_text(
      p_app_version,
      100
    ),

    public.normalize_issue_report_text(
      p_device_model,
      200
    ),

    public.normalize_issue_report_text(
      p_os_version,
      100
    ),

    1,
    now(),
    now()
  )
  on conflict (
    user_id,
    issue_key
  )
  do update
  set
    user_email =
      coalesce(
        excluded.user_email,
        public.issue_reports.user_email
      ),

    platform =
      excluded.platform,

    app_version =
      coalesce(
        excluded.app_version,
        public.issue_reports.app_version
      ),

    device_model =
      coalesce(
        excluded.device_model,
        public.issue_reports.device_model
      ),

    os_version =
      coalesce(
        excluded.os_version,
        public.issue_reports.os_version
      ),

    report_count =
      public.issue_reports.report_count +
      1,

    last_reported_at =
      now(),

    updated_at =
      now()
  returning
    *
  into
    saved_report;

  select
    count(*),
    coalesce(
      sum(
        report_count
      ),
      0
    )
  into
    unique_reporter_count,
    total_report_count
  from public.issue_reports
  where
    issue_key =
      selected_issue.issue_key;

  return jsonb_build_object(
    'success',
      true,

    'report',
      jsonb_build_object(
        'id',
          saved_report.id,

        'issueKey',
          saved_report.issue_key,

        'issueTitle',
          selected_issue.title_en,

        'userId',
          saved_report.user_id,

        'platform',
          saved_report.platform,

        'appVersion',
          saved_report.app_version,

        'deviceModel',
          saved_report.device_model,

        'osVersion',
          saved_report.os_version,

        'userReportCount',
          saved_report.report_count,

        'firstReportedAt',
          saved_report.first_reported_at,

        'lastReportedAt',
          saved_report.last_reported_at
      ),

    'statistics',
      jsonb_build_object(
        'uniqueReporters',
          unique_reporter_count,

        'totalReports',
          total_report_count
      ),

    'message',
      'Thank you for reporting this issue. We sincerely apologize for the inconvenience. Our team will work to resolve it within the coming days, and we promise you a valuable gift after the issue is fixed. Thank you for your patience.'
  );
end;
$$;

revoke all
on function public.report_app_issue(
  text,
  text,
  text,
  text,
  text
)
from public;

grant execute
on function public.report_app_issue(
  text,
  text,
  text,
  text,
  text
)
to authenticated;

/* =========================================================
 * Issue statistics view
 *
 * هذه الـView مخصصة للـBackend أو Discord worker
 * باستخدام service_role فقط.
 * ======================================================= */

create or replace view public.issue_report_statistics
with (
  security_invoker =
    true
)
as
select
  option_row.issue_key,

  option_row.title_en,

  option_row.description_en,

  option_row.display_order,

  option_row.is_active,

  count(
    report_row.id
  )::bigint as unique_reporters,

  coalesce(
    sum(
      report_row.report_count
    ),
    0
  )::bigint as total_reports,

  min(
    report_row.first_reported_at
  ) as first_reported_at,

  max(
    report_row.last_reported_at
  ) as last_reported_at,

  count(
    report_row.id
  ) filter (
    where
      report_row.platform =
        'ios'
  )::bigint as ios_unique_reporters,

  count(
    report_row.id
  ) filter (
    where
      report_row.platform =
        'android'
  )::bigint as android_unique_reporters

from public.issue_report_options
  as option_row

left join public.issue_reports
  as report_row
on
  report_row.issue_key =
    option_row.issue_key

group by
  option_row.issue_key,
  option_row.title_en,
  option_row.description_en,
  option_row.display_order,
  option_row.is_active

order by
  option_row.display_order asc;

/* =========================================================
 * Latest reports view
 *
 * تمكن الـBackend من معرفة أول المستخدمين
 * وآخر المستخدمين الذين أبلغوا عن المشكلة.
 * ======================================================= */

create or replace view public.issue_report_details
with (
  security_invoker =
    true
)
as
select
  report_row.id,

  report_row.issue_key,

  option_row.title_en
    as issue_title,

  report_row.user_id,

  report_row.user_email,

  report_row.platform,

  report_row.app_version,

  report_row.device_model,

  report_row.os_version,

  report_row.report_count,

  report_row.first_reported_at,

  report_row.last_reported_at,

  report_row.created_at,

  report_row.updated_at

from public.issue_reports
  as report_row

inner join public.issue_report_options
  as option_row
on
  option_row.issue_key =
    report_row.issue_key;

/*
 * الإحصائيات والتفاصيل الكاملة لا تكون متاحة
 * مباشرة لمستخدم التطبيق.
 *
 * الـBackend أو Edge Function سيقرأها بمفتاح
 * service_role لإرسالها إلى Discord.
 */
revoke all
on table public.issue_report_statistics
from anon,
     authenticated;

revoke all
on table public.issue_report_details
from anon,
     authenticated;

grant select
on table public.issue_report_statistics
to service_role;

grant select
on table public.issue_report_details
to service_role;

/* =========================================================
 * Verification
 * ======================================================= */

do $$
declare
  active_issue_count integer;
begin
  select
    count(*)
  into
    active_issue_count
  from public.issue_report_options
  where
    is_active =
      true;

  if active_issue_count <> 5 then
    raise exception
      'Expected exactly 5 active issue options, but found %.',
      active_issue_count;
  end if;
end;
$$;

commit;