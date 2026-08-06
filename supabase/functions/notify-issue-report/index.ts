
// supabase/functions/notify-issue-report/index.ts
//
// Triple N - Discord Issue Report Notification
//
// المسؤوليات:
//
// 1. استقبال Database Webhook من جدول issue_reports.
// 2. التحقق من أن الحدث بلاغ جديد أو زيادة فعلية في العداد.
// 3. قراءة عنوان المشكلة وإحصائياتها الحالية.
// 4. إرسال إشعار منظم وآمن إلى Discord.
// 5. إبقاء المفاتيح السرية داخل Supabase Secrets.
// 6. منع كشف Discord Webhook أو Service Role داخل التطبيق.
// 7. إرجاع استجابة JSON واضحة للـDatabase Webhook.

import {
  createClient,
} from 'npm:@supabase/supabase-js@2.57.4';

/* =========================================================
 * Deno runtime declaration
 *
 * يمنع TypeScript الخاص بالمشروع من إظهار:
 * Cannot find name 'Deno'
 *
 * ولا يغيّر سلوك Supabase Edge Function.
 * ======================================================= */

declare const Deno: {
  env: {
    get(
      name:
        string
    ): string | undefined;
  };

  serve(
    handler:
      (
        request:
          Request
      ) =>
        Response |
        Promise<Response>
  ): void;
};

/* =========================================================
 * Types
 * ======================================================= */

type DatabaseWebhookEventType =
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE';

type IssueReportRecord = {
  id?:
    unknown;

  issue_key?:
    unknown;

  user_id?:
    unknown;

  user_email?:
    unknown;

  platform?:
    unknown;

  app_version?:
    unknown;

  device_model?:
    unknown;

  os_version?:
    unknown;

  report_count?:
    unknown;

  first_reported_at?:
    unknown;

  last_reported_at?:
    unknown;

  created_at?:
    unknown;

  updated_at?:
    unknown;
};

type DatabaseWebhookPayload = {
  type?:
    unknown;

  table?:
    unknown;

  schema?:
    unknown;

  record?:
    IssueReportRecord | null;

  old_record?:
    IssueReportRecord | null;
};

type IssueOptionRow = {
  issue_key?:
    unknown;

  title_en?:
    unknown;

  description_en?:
    unknown;
};

type IssueStatisticsRow = {
  issue_key?:
    unknown;

  unique_reporters?:
    unknown;

  total_reports?:
    unknown;

  ios_unique_reporters?:
    unknown;

  android_unique_reporters?:
    unknown;

  first_reported_at?:
    unknown;

  last_reported_at?:
    unknown;
};

type IssueOptionResult = {
  title:
    string;

  description:
    string;
};

type IssueStatisticsResult = {
  uniqueReporters:
    number;

  totalReports:
    number;

  iosUniqueReporters:
    number;

  androidUniqueReporters:
    number;

  firstReportedAt:
    string | null;

  lastReportedAt:
    string | null;
};

type DiscordEmbedField = {
  name:
    string;

  value:
    string;

  inline:
    boolean;
};

type EventValidationResult = {
  shouldProcess:
    boolean;

  reason:
    string;
};

/* =========================================================
 * Constants
 * ======================================================= */

const EXPECTED_SCHEMA =
  'public';

const EXPECTED_TABLE =
  'issue_reports';

const ISSUE_OPTIONS_TABLE =
  'issue_report_options';

const ISSUE_STATISTICS_VIEW =
  'issue_report_statistics';

const DISCORD_WEBHOOK_SECRET_HEADER =
  'x-triple-n-webhook-secret';

const MAXIMUM_DISCORD_FIELD_NAME_LENGTH =
  256;

const MAXIMUM_DISCORD_FIELD_VALUE_LENGTH =
  1024;

const MAXIMUM_DISCORD_DESCRIPTION_LENGTH =
  4096;

const MAXIMUM_ERROR_RESPONSE_LENGTH =
  1000;

const JSON_HEADERS:
  Readonly<
    Record<
      string,
      string
    >
  > = {
  'Content-Type':
    'application/json; charset=utf-8',
};

/* =========================================================
 * Environment
 * ======================================================= */

function getRequiredEnvironmentVariable(
  name:
    string
): string {
  const value =
    Deno.env
      .get(
        name
      )
      ?.trim();

  if (
    !value
  ) {
    throw new Error(
      `Missing required environment variable: ${name}`
    );
  }

  return value;
}

/* =========================================================
 * General helpers
 * ======================================================= */

function createJsonResponse(
  body:
    Readonly<
      Record<
        string,
        unknown
      >
    >,
  status =
    200
): Response {
  return new Response(
    JSON.stringify(
      body
    ),
    {
      status,

      headers:
        JSON_HEADERS,
    }
  );
}

function normalizeOptionalText(
  value:
    unknown,
  fallback =
    ''
): string {
  if (
    typeof value !==
      'string'
  ) {
    return fallback;
  }

  const normalized =
    value.trim();

  return normalized.length >
    0
    ? normalized
    : fallback;
}

function normalizeRequiredText(
  value:
    unknown,
  fieldName:
    string
): string {
  const normalized =
    normalizeOptionalText(
      value
    );

  if (
    normalized.length ===
      0
  ) {
    throw new Error(
      `${fieldName} is missing.`
    );
  }

  return normalized;
}

function normalizeInteger(
  value:
    unknown,
  fallback =
    0
): number {
  if (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    )
  ) {
    return Math.max(
      0,
      Math.floor(
        value
      )
    );
  }

  if (
    typeof value ===
      'string'
  ) {
    const normalized =
      value.trim();

    if (
      normalized.length >
        0
    ) {
      const parsed =
        Number(
          normalized
        );

      if (
        Number.isFinite(
          parsed
        )
      ) {
        return Math.max(
          0,
          Math.floor(
            parsed
          )
        );
      }
    }
  }

  return Math.max(
    0,
    Math.floor(
      fallback
    )
  );
}

function normalizeTimestamp(
  value:
    unknown
): string | null {
  const normalized =
    normalizeOptionalText(
      value
    );

  if (
    normalized.length ===
      0
  ) {
    return null;
  }

  const timestamp =
    Date.parse(
      normalized
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return null;
  }

  return new Date(
    timestamp
  ).toISOString();
}

function normalizeEventType(
  value:
    unknown
): DatabaseWebhookEventType | null {
  if (
    value ===
      'INSERT' ||
    value ===
      'UPDATE' ||
    value ===
      'DELETE'
  ) {
    return value;
  }

  return null;
}

function truncateText(
  value:
    string,
  maximumLength:
    number
): string {
  if (
    maximumLength <=
      0
  ) {
    return '';
  }

  if (
    value.length <=
      maximumLength
  ) {
    return value;
  }

  if (
    maximumLength ===
      1
  ) {
    return '…';
  }

  return `${value.slice(
    0,
    maximumLength -
      1
  )}…`;
}

function createDiscordField(
  name:
    string,
  value:
    string |
    number |
    null |
    undefined,
  inline =
    true
): DiscordEmbedField {
  const normalizedName =
    normalizeOptionalText(
      name,
      'Information'
    );

  const normalizedValue =
    value ===
      null ||
    value ===
      undefined
      ? 'Not available'
      : normalizeOptionalText(
          String(
            value
          ),
          'Not available'
        );

  return {
    name:
      truncateText(
        normalizedName,
        MAXIMUM_DISCORD_FIELD_NAME_LENGTH
      ),

    value:
      truncateText(
        normalizedValue,
        MAXIMUM_DISCORD_FIELD_VALUE_LENGTH
      ),

    inline,
  };
}

function getUnknownErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof
      Error
  ) {
    const message =
      error.message
        .trim();

    if (
      message.length >
        0
    ) {
      return truncateText(
        message,
        MAXIMUM_ERROR_RESPONSE_LENGTH
      );
    }
  }

  if (
    typeof error ===
      'string'
  ) {
    const message =
      error.trim();

    if (
      message.length >
        0
    ) {
      return truncateText(
        message,
        MAXIMUM_ERROR_RESPONSE_LENGTH
      );
    }
  }

  return 'Unknown issue notification error.';
}

function isRecord(
  value:
    unknown
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      'object' &&
    value !==
      null &&
    !Array.isArray(
      value
    )
  );
}

function parseWebhookPayload(
  value:
    unknown
): DatabaseWebhookPayload {
  if (
    !isRecord(
      value
    )
  ) {
    throw new Error(
      'Webhook body must be a JSON object.'
    );
  }

  const record =
    isRecord(
      value.record
    )
      ? value.record as
          IssueReportRecord
      : null;

  const oldRecord =
    isRecord(
      value.old_record
    )
      ? value.old_record as
          IssueReportRecord
      : null;

  return {
    type:
      value.type,

    table:
      value.table,

    schema:
      value.schema,

    record,

    old_record:
      oldRecord,
  };
}

/* =========================================================
 * Request security
 * ======================================================= */

function validateSharedSecret(
  request:
    Request
): boolean {
  const expectedSecret =
    Deno.env
      .get(
        'ISSUE_REPORT_WEBHOOK_SECRET'
      )
      ?.trim();

  /**
   * أثناء أول إعداد فقط يمكن تشغيل الـFunction
   * بدون Secret.
   *
   * عند إضافة ISSUE_REPORT_WEBHOOK_SECRET
   * يصبح الـHeader إلزاميًا تلقائيًا.
   */
  if (
    !expectedSecret
  ) {
    return true;
  }

  const receivedSecret =
    request.headers
      .get(
        DISCORD_WEBHOOK_SECRET_HEADER
      )
      ?.trim();

  return (
    receivedSecret ===
    expectedSecret
  );
}

/* =========================================================
 * Event validation
 * ======================================================= */

function shouldProcessEvent(
  payload:
    DatabaseWebhookPayload
): EventValidationResult {
  const eventType =
    normalizeEventType(
      payload.type
    );

  if (
    eventType !==
      'INSERT' &&
    eventType !==
      'UPDATE'
  ) {
    return {
      shouldProcess:
        false,

      reason:
        'Unsupported event type.',
    };
  }

  if (
    payload.schema !==
      EXPECTED_SCHEMA
  ) {
    return {
      shouldProcess:
        false,

      reason:
        'Unexpected database schema.',
    };
  }

  if (
    payload.table !==
      EXPECTED_TABLE
  ) {
    return {
      shouldProcess:
        false,

      reason:
        'Unexpected database table.',
    };
  }

  if (
    !payload.record
  ) {
    return {
      shouldProcess:
        false,

      reason:
        'Event record is missing.',
    };
  }

  if (
    eventType ===
      'UPDATE'
  ) {
    const currentReportCount =
      normalizeInteger(
        payload.record
          .report_count
      );

    const previousReportCount =
      normalizeInteger(
        payload.old_record
          ?.report_count
      );

    if (
      currentReportCount <=
        previousReportCount
    ) {
      return {
        shouldProcess:
          false,

        reason:
          'Report count did not increase.',
      };
    }
  }

  return {
    shouldProcess:
      true,

    reason:
      'Accepted.',
  };
}

/* =========================================================
 * Supabase client
 * ======================================================= */

function createSupabaseAdminClient(
  supabaseUrl:
    string,
  serviceRoleKey:
    string
) {
  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken:
          false,

        persistSession:
          false,

        detectSessionInUrl:
          false,
      },
    }
  );
}

/* =========================================================
 * Database reads
 *
 * لا نمرر SupabaseClient كـparameter.
 * بذلك نتجنب تعارض Generics بين نسخ supabase-js.
 * ======================================================= */

async function getIssueOption(
  input: {
    supabaseUrl:
      string;

    serviceRoleKey:
      string;

    issueKey:
      string;
  }
): Promise<
  IssueOptionResult
> {
  const supabaseAdmin =
    createSupabaseAdminClient(
      input.supabaseUrl,
      input.serviceRoleKey
    );

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        ISSUE_OPTIONS_TABLE
      )
      .select(
        [
          'issue_key',
          'title_en',
          'description_en',
        ].join(
          ','
        )
      )
      .eq(
        'issue_key',
        input.issueKey
      )
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `Could not read issue option: ${error.message}`
    );
  }

  const row =
    (
      data ??
      null
    ) as
      IssueOptionRow | null;

  return {
    title:
      normalizeOptionalText(
        row?.title_en,
        input.issueKey
      ),

    description:
      normalizeOptionalText(
        row?.description_en,
        'A user reported this issue.'
      ),
  };
}

async function getIssueStatistics(
  input: {
    supabaseUrl:
      string;

    serviceRoleKey:
      string;

    issueKey:
      string;
  }
): Promise<
  IssueStatisticsResult
> {
  const supabaseAdmin =
    createSupabaseAdminClient(
      input.supabaseUrl,
      input.serviceRoleKey
    );

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        ISSUE_STATISTICS_VIEW
      )
      .select(
        [
          'issue_key',
          'unique_reporters',
          'total_reports',
          'ios_unique_reporters',
          'android_unique_reporters',
          'first_reported_at',
          'last_reported_at',
        ].join(
          ','
        )
      )
      .eq(
        'issue_key',
        input.issueKey
      )
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `Could not read issue statistics: ${error.message}`
    );
  }

  const row =
    (
      data ??
      null
    ) as
      IssueStatisticsRow | null;

  return {
    uniqueReporters:
      normalizeInteger(
        row?.unique_reporters
      ),

    totalReports:
      normalizeInteger(
        row?.total_reports
      ),

    iosUniqueReporters:
      normalizeInteger(
        row?.ios_unique_reporters
      ),

    androidUniqueReporters:
      normalizeInteger(
        row?.android_unique_reporters
      ),

    firstReportedAt:
      normalizeTimestamp(
        row?.first_reported_at
      ),

    lastReportedAt:
      normalizeTimestamp(
        row?.last_reported_at
      ),
  };
}

/* =========================================================
 * Discord notification
 * ======================================================= */

async function sendDiscordNotification(
  input: {
    discordWebhookUrl:
      string;

    eventType:
      DatabaseWebhookEventType;

    record:
      IssueReportRecord;

    issueKey:
      string;

    issueTitle:
      string;

    issueDescription:
      string;

    uniqueReporters:
      number;

    totalReports:
      number;

    iosUniqueReporters:
      number;

    androidUniqueReporters:
      number;

    firstReportedAt:
      string | null;

    lastReportedAt:
      string | null;
  }
): Promise<void> {
  const userId =
    normalizeOptionalText(
      input.record
        .user_id,
      'Unknown user'
    );

  const userEmail =
    normalizeOptionalText(
      input.record
        .user_email,
      'Not available'
    );

  const platform =
    normalizeOptionalText(
      input.record
        .platform,
      'unknown'
    );

  const appVersion =
    normalizeOptionalText(
      input.record
        .app_version,
      'unknown'
    );

  const deviceModel =
    normalizeOptionalText(
      input.record
        .device_model,
      'Unknown device'
    );

  const osVersion =
    normalizeOptionalText(
      input.record
        .os_version,
      'Unknown OS'
    );

  const userReportCount =
    normalizeInteger(
      input.record
        .report_count,
      1
    );

  const reportTimestamp =
    normalizeTimestamp(
      input.record
        .last_reported_at
    ) ??
    normalizeTimestamp(
      input.record
        .updated_at
    ) ??
    normalizeTimestamp(
      input.record
        .created_at
    ) ??
    new Date()
      .toISOString();

  const repeatedReport =
    userReportCount >
      1;

  const notificationTitle =
    repeatedReport
      ? 'Triple N issue reported again'
      : 'New Triple N issue report';

  const notificationDescription =
    truncateText(
      [
        `**${input.issueTitle}**`,
        '',
        input.issueDescription,
        '',
        repeatedReport
          ? `This user has now reported this issue ${userReportCount} times.`
          : 'A user reported this issue for the first time.',
      ].join(
        '\n'
      ),
      MAXIMUM_DISCORD_DESCRIPTION_LENGTH
    );

  const fields:
    DiscordEmbedField[] = [
      createDiscordField(
        'Issue key',
        input.issueKey,
        false
      ),

      createDiscordField(
        'User email',
        userEmail,
        false
      ),

      createDiscordField(
        'User ID',
        userId,
        false
      ),

      createDiscordField(
        'Platform',
        platform
      ),

      createDiscordField(
        'App version',
        appVersion
      ),

      createDiscordField(
        'User report count',
        userReportCount
      ),

      createDiscordField(
        'Device',
        deviceModel
      ),

      createDiscordField(
        'OS version',
        osVersion
      ),

      createDiscordField(
        'Database event',
        input.eventType
      ),

      createDiscordField(
        'Unique users',
        input.uniqueReporters
      ),

      createDiscordField(
        'Total reports',
        input.totalReports
      ),

      createDiscordField(
        'iOS users',
        input.iosUniqueReporters
      ),

      createDiscordField(
        'Android users',
        input.androidUniqueReporters
      ),

      createDiscordField(
        'First reported',
        input.firstReportedAt,
        false
      ),

      createDiscordField(
        'Last reported',
        input.lastReportedAt ??
          reportTimestamp,
        false
      ),
    ];

  const discordPayload = {
    username:
      'Triple N Support',

    allowed_mentions: {
      parse: [],
    },

    embeds: [
      {
        title:
          notificationTitle,

        description:
          notificationDescription,

        color:
          repeatedReport
            ? 16753920
            : 15851464,

        fields,

        footer: {
          text:
            'Triple N secure issue reporting',
        },

        timestamp:
          reportTimestamp,
      },
    ],
  };

  const response =
    await fetch(
      input.discordWebhookUrl,
      {
        method:
          'POST',

        headers:
          JSON_HEADERS,

        body:
          JSON.stringify(
            discordPayload
          ),
      }
    );

  if (
    response.ok
  ) {
    return;
  }

  const responseText =
    await response
      .text()
      .catch(
        () =>
          ''
      );

  const discordError =
    responseText.trim().length >
      0
      ? `: ${truncateText(
          responseText.trim(),
          MAXIMUM_ERROR_RESPONSE_LENGTH
        )}`
      : '';

  throw new Error(
    `Discord rejected the notification with status ${response.status}${discordError}`
  );
}

/* =========================================================
 * Edge Function handler
 * ======================================================= */

async function handleRequest(
  request:
    Request
): Promise<Response> {
  if (
    request.method !==
      'POST'
  ) {
    return createJsonResponse(
      {
        success:
          false,

        message:
          'Method not allowed.',
      },
      405
    );
  }

  if (
    !validateSharedSecret(
      request
    )
  ) {
    return createJsonResponse(
      {
        success:
          false,

        message:
          'Unauthorized webhook request.',
      },
      401
    );
  }

  try {
    const requestBody =
      await request
        .json();

    const payload =
      parseWebhookPayload(
        requestBody
      );

    const validation =
      shouldProcessEvent(
        payload
      );

    if (
      !validation
        .shouldProcess
    ) {
      return createJsonResponse({
        success:
          true,

        skipped:
          true,

        reason:
          validation.reason,
      });
    }

    const record =
      payload.record;

    if (
      !record
    ) {
      throw new Error(
        'Issue report record is missing.'
      );
    }

    const eventType =
      normalizeEventType(
        payload.type
      );

    if (
      !eventType
    ) {
      throw new Error(
        'Webhook event type is invalid.'
      );
    }

    const issueKey =
      normalizeRequiredText(
        record.issue_key,
        'Issue key'
      );

    const supabaseUrl =
      getRequiredEnvironmentVariable(
        'SUPABASE_URL'
      );

    const serviceRoleKey =
      getRequiredEnvironmentVariable(
        'SUPABASE_SERVICE_ROLE_KEY'
      );

    const discordWebhookUrl =
      getRequiredEnvironmentVariable(
        'DISCORD_ISSUE_REPORT_WEBHOOK_URL'
      );

    const [
      issueOption,
      statistics,
    ] =
      await Promise.all([
        getIssueOption({
          supabaseUrl,

          serviceRoleKey,

          issueKey,
        }),

        getIssueStatistics({
          supabaseUrl,

          serviceRoleKey,

          issueKey,
        }),
      ]);

    await sendDiscordNotification({
      discordWebhookUrl,

      eventType,

      record,

      issueKey,

      issueTitle:
        issueOption.title,

      issueDescription:
        issueOption.description,

      uniqueReporters:
        statistics
          .uniqueReporters,

      totalReports:
        statistics
          .totalReports,

      iosUniqueReporters:
        statistics
          .iosUniqueReporters,

      androidUniqueReporters:
        statistics
          .androidUniqueReporters,

      firstReportedAt:
        statistics
          .firstReportedAt,

      lastReportedAt:
        statistics
          .lastReportedAt,
    });

    return createJsonResponse({
      success:
        true,

      skipped:
        false,

      issueKey,

      eventType,

      message:
        'Discord notification sent successfully.',
    });
  } catch (
    error:
      unknown
  ) {
    const message =
      getUnknownErrorMessage(
        error
      );

    console.error(
      'TRIPLE N ISSUE REPORT NOTIFICATION ERROR:',
      message
    );

    return createJsonResponse(
      {
        success:
          false,

        message,
      },
      500
    );
  }
}

/* =========================================================
 * Start Edge Function
 * ======================================================= */

Deno.serve(
  handleRequest
);