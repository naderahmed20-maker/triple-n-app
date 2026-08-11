// lib/issueReportService.ts
//
// Triple N - Issue Report Service
//
// المسؤوليات:
//
// 1. تحميل المشكلات النشطة من قاعدة البيانات.
// 2. تسجيل بلاغ المستخدم من خلال RPC آمنة.
// 3. إرسال بيانات الجهاز والمنصة وإصدار التطبيق.
// 4. منع القيم الفارغة أو الطويلة وغير الصالحة.
// 5. قراءة إحصائيات المشكلات عند السماح بذلك.
// 6. توفير Types موحدة لشاشة Report Problem.
//
// قاعدة البيانات المستخدمة:
//
// - issue_report_options
// - issue_reports
// - issue_report_statistics
// - issue_report_details
//
// RPC:
//
// - report_app_issue

import {
    supabase,
} from '@/lib/supabase';

import Constants from 'expo-constants';

import * as Device from 'expo-device';

import {
    Platform,
} from 'react-native';

/* =========================================================
 * Public types
 * ======================================================= */

export type IssueReportPlatform =
  | 'ios'
  | 'android'
  | 'web'
  | 'unknown';

/**
 * قاعدة البيانات تقبل issue_key كنص.
 *
 * أبقيناه string حتى يظل متوافقًا مع مفاتيح
 * المشكلات الخمس الموجودة في قاعدة البيانات.
 */
export type IssueReportCode =
  string;

export type IssueReportOption = {
  issueKey:
    IssueReportCode;

  title:
    string;

  description:
    string;

  displayOrder:
    number;

  isActive:
    boolean;
};

export type IssueReportStatistics = {
  issueKey:
    IssueReportCode;

  title:
    string;

  description:
    string;

  displayOrder:
    number;

  isActive:
    boolean;

  uniqueReporters:
    number;

  totalReports:
    number;

  firstReportedAt:
    string | null;

  lastReportedAt:
    string | null;

  iosUniqueReporters:
    number;

  androidUniqueReporters:
    number;
};

export type IssueReportDetail = {
  id:
    string | null;

  issueKey:
    IssueReportCode;

  issueTitle:
    string;

  userId:
    string | null;

  userEmail:
    string | null;

  platform:
    IssueReportPlatform;

  appVersion:
    string | null;

  deviceModel:
    string | null;

  osVersion:
    string | null;

  reportCount:
    number;

  firstReportedAt:
    string | null;

  lastReportedAt:
    string | null;

  createdAt:
    string | null;

  updatedAt:
    string | null;
};

/**
 * يدعم أسماء الحقول المستخدمة حاليًا في
 * report-problem.tsx، مع دعم الأسماء القديمة.
 */
export type SubmitIssueReportInput = {
  /**
   * الاسم الأساسي المستخدم في شاشة البلاغ.
   */
  issueCode?:
    IssueReportCode;

  /**
   * الاسم المطابق مباشرة لقاعدة البيانات.
   */
  issueKey?:
    IssueReportCode;

  /**
   * دعم الاسم المستخدم في بعض أجزاء الشاشة.
   */
  problem?:
    IssueReportCode;

  /**
   * عنوان المشكلة المعروض للمستخدم.
   *
   * قاعدة البيانات تحصل على العنوان من
   * issue_report_options، لذلك لا يُرسل إلى RPC.
   */
  issueTitle?:
    string | null;

  /**
   * موجود للتوافق مع الشاشة في حالة إعادة إرسال
   * بلاغ معروف. RPC يحدد السجل من المستخدم والمشكلة.
   */
  reportId?:
    string | null;

  /**
   * قيم اختيارية للاختبارات أو الاستخدام الإداري.
   * عند عدم تمريرها تُقرأ تلقائيًا من الجهاز.
   */
  platform?:
    IssueReportPlatform | null;

  appVersion?:
    string | null;

  deviceModel?:
    string | null;

  osVersion?:
    string | null;
};

export type IssueReportSubmissionResult = {
  success:
    boolean;

  reportId:
    string | null;

  issueCode:
    IssueReportCode;

  issueKey:
    IssueReportCode;

  issueTitle:
    string | null;

  alreadyReported:
    boolean;

  reportCount:
    number;

  uniqueReporters:
    number;

  /**
   * الاسم المستخدم داخل report-problem.tsx.
   *
   * قيمته هي عدد المستخدمين المختلفين
   * الذين أبلغوا عن المشكلة.
   */
  totalUniqueReports:
    number;

  totalReports:
    number;

  message:
    string | null;

  rawResult:
    Readonly<
      Record<
        string,
        unknown
      >
    >;
};

/**
 * Alias للحفاظ على التوافق مع أي Import سابق.
 */
export type SubmitIssueReportResult =
  IssueReportSubmissionResult;

/* =========================================================
 * Internal database row types
 * ======================================================= */

type IssueReportOptionRow = {
  issue_key:
    unknown;

  title_en:
    unknown;

  description_en:
    unknown;

  display_order:
    unknown;

  is_active:
    unknown;
};

type IssueReportStatisticsRow = {
  issue_key:
    unknown;

  title_en:
    unknown;

  description_en:
    unknown;

  display_order:
    unknown;

  is_active:
    unknown;

  unique_reporters:
    unknown;

  total_reports:
    unknown;

  first_reported_at:
    unknown;

  last_reported_at:
    unknown;

  ios_unique_reporters:
    unknown;

  android_unique_reporters:
    unknown;
};

type IssueReportDetailRow = {
  id:
    unknown;

  issue_key:
    unknown;

  issue_title:
    unknown;

  user_id:
    unknown;

  user_email:
    unknown;

  platform:
    unknown;

  app_version:
    unknown;

  device_model:
    unknown;

  os_version:
    unknown;

  report_count:
    unknown;

  first_reported_at:
    unknown;

  last_reported_at:
    unknown;

  created_at:
    unknown;

  updated_at:
    unknown;
};

/* =========================================================
 * Constants
 * ======================================================= */

const MAXIMUM_ISSUE_KEY_LENGTH =
  100;

const MAXIMUM_ISSUE_TITLE_LENGTH =
  250;

const MAXIMUM_DESCRIPTION_LENGTH =
  1000;

const MAXIMUM_METADATA_TEXT_LENGTH =
  250;

const FALLBACK_APP_VERSION =
  'unknown';

const FALLBACK_DEVICE_MODEL =
  'Unknown device';

const FALLBACK_OS_VERSION =
  'Unknown OS';

const ISSUE_REPORT_SUBMISSION_ERROR =
  'We could not submit your report. Please try again.';

const ISSUE_REPORT_OPTIONS_ERROR =
  'We could not load the available problems. Please try again.';

const ISSUE_REPORT_STATISTICS_ERROR =
  'We could not load the issue statistics.';

const ISSUE_REPORT_DETAILS_ERROR =
  'We could not load the issue report details.';

/* =========================================================
 * General helpers
 * ======================================================= */

function getUnknownErrorMessage(
  error:
    unknown,
  fallback:
    string
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
      return message;
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
      return message;
    }
  }

  /*
   * Supabase/PostgREST errors are often plain objects rather
   * than native Error instances.
   */
  if (
    typeof error ===
      'object' &&
    error !==
      null
  ) {
    const record =
      error as Record<
        string,
        unknown
      >;

    const candidates = [
      record.message,
      record.details,
      record.hint,
      record.code,
    ];

    for (
      const candidate of
      candidates
    ) {
      if (
        typeof candidate ===
          'string' &&
        candidate
          .trim()
          .length >
          0
      ) {
        return candidate
          .trim();
      }
    }
  }

  return fallback;
}

function normalizeRequiredText(
  value:
    unknown,
  fieldName:
    string,
  maximumLength:
    number
): string {
  if (
    typeof value !==
      'string'
  ) {
    throw new Error(
      `${fieldName} is invalid.`
    );
  }

  const normalized =
    value.trim();

  if (
    normalized.length ===
      0
  ) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  if (
    normalized.length >
      maximumLength
  ) {
    throw new Error(
      `${fieldName} is too long.`
    );
  }

  return normalized;
}

function normalizeOptionalText(
  value:
    unknown,
  maximumLength =
    MAXIMUM_METADATA_TEXT_LENGTH
): string | null {
  if (
    typeof value !==
      'string'
  ) {
    return null;
  }

  const normalized =
    value.trim();

  if (
    normalized.length ===
      0
  ) {
    return null;
  }

  if (
    normalized.length >
      maximumLength
  ) {
    return normalized.slice(
      0,
      maximumLength
    );
  }

  return normalized;
}

function normalizeBoolean(
  value:
    unknown,
  fallback =
    false
): boolean {
  if (
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    value ===
      1 ||
    value ===
      '1' ||
    value ===
      'true'
  ) {
    return true;
  }

  if (
    value ===
      0 ||
    value ===
      '0' ||
    value ===
      'false'
  ) {
    return false;
  }

  return fallback;
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
      'string' &&
    value.trim().length >
      0
  ) {
    const parsed =
      Number(
        value
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
  if (
    typeof value !==
      'string'
  ) {
    return null;
  }

  const normalized =
    value.trim();

  if (
    normalized.length ===
      0
  ) {
    return null;
  }

  const parsed =
    Date.parse(
      normalized
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return null;
  }

  return normalized;
}

function normalizePlatform(
  value:
    unknown
): IssueReportPlatform {
  if (
    value ===
      'ios' ||
    value ===
      'android' ||
    value ===
      'web'
  ) {
    return value;
  }

  return 'unknown';
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

function readFirstAvailableValue(
  source:
    Readonly<
      Record<
        string,
        unknown
      >
    >,
  keys:
    readonly string[]
): unknown {
  for (
    const key of
    keys
  ) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(
          source,
          key
        )
    ) {
      const value =
        source[
          key
        ];

      if (
        value !==
          undefined
      ) {
        return value;
      }
    }
  }

  return undefined;
}

function resolveInputIssueCode(
  input:
    IssueReportCode |
    SubmitIssueReportInput
): IssueReportCode {
  const rawIssueCode =
    typeof input ===
      'string'
      ? input
      : (
          input.issueCode ??
          input.issueKey ??
          input.problem ??
          ''
        );

  return normalizeRequiredText(
    rawIssueCode,
    'Issue code',
    MAXIMUM_ISSUE_KEY_LENGTH
  );
}

function resolveInputIssueTitle(
  input:
    IssueReportCode |
    SubmitIssueReportInput
): string | null {
  if (
    typeof input ===
      'string'
  ) {
    return null;
  }

  return normalizeOptionalText(
    input.issueTitle,
    MAXIMUM_ISSUE_TITLE_LENGTH
  );
}

function resolveInputReportId(
  input:
    IssueReportCode |
    SubmitIssueReportInput
): string | null {
  if (
    typeof input ===
      'string'
  ) {
    return null;
  }

  return normalizeOptionalText(
    input.reportId,
    100
  );
}

/* =========================================================
 * Device metadata
 * ======================================================= */

function getCurrentPlatform():
  IssueReportPlatform {
  return normalizePlatform(
    Platform.OS
  );
}

function getAppVersion():
  string {
  const expoVersion =
    Constants
      .expoConfig
      ?.version;

  if (
    typeof expoVersion ===
      'string' &&
    expoVersion.trim().length >
      0
  ) {
    return expoVersion.trim();
  }

  return FALLBACK_APP_VERSION;
}

function getDeviceModel():
  string {
  const modelName =
    Device.modelName;

  if (
    typeof modelName ===
      'string' &&
    modelName.trim().length >
      0
  ) {
    return modelName.trim();
  }

  return FALLBACK_DEVICE_MODEL;
}

function getOsVersion():
  string {
  const deviceOsVersion =
    Device.osVersion;

  if (
    typeof deviceOsVersion ===
      'string' &&
    deviceOsVersion
      .trim()
      .length >
      0
  ) {
    return deviceOsVersion
      .trim();
  }

  const platformVersion =
    Platform.Version;

  if (
    typeof platformVersion ===
      'string' ||
    typeof platformVersion ===
      'number'
  ) {
    const normalized =
      String(
        platformVersion
      ).trim();

    if (
      normalized.length >
      0
    ) {
      return normalized;
    }
  }

  return FALLBACK_OS_VERSION;
}

function resolveSubmissionMetadata(
  input:
    IssueReportCode |
    SubmitIssueReportInput
): {
  platform:
    IssueReportPlatform;

  appVersion:
    string;

  deviceModel:
    string;

  osVersion:
    string;
} {
  if (
    typeof input ===
      'string'
  ) {
    return {
      platform:
        getCurrentPlatform(),

      appVersion:
        getAppVersion(),

      deviceModel:
        getDeviceModel(),

      osVersion:
        getOsVersion(),
    };
  }

  return {
    platform:
      input.platform
        ? normalizePlatform(
            input.platform
          )
        : getCurrentPlatform(),

    appVersion:
      normalizeOptionalText(
        input.appVersion
      ) ??
      getAppVersion(),

    deviceModel:
      normalizeOptionalText(
        input.deviceModel
      ) ??
      getDeviceModel(),

    osVersion:
      normalizeOptionalText(
        input.osVersion
      ) ??
      getOsVersion(),
  };
}

/* =========================================================
 * Row mapping
 * ======================================================= */

function mapIssueReportOption(
  row:
    IssueReportOptionRow
): IssueReportOption {
  return {
    issueKey:
      normalizeRequiredText(
        row.issue_key,
        'Issue key',
        MAXIMUM_ISSUE_KEY_LENGTH
      ),

    title:
      normalizeRequiredText(
        row.title_en,
        'Issue title',
        MAXIMUM_ISSUE_TITLE_LENGTH
      ),

    description:
      normalizeRequiredText(
        row.description_en,
        'Issue description',
        MAXIMUM_DESCRIPTION_LENGTH
      ),

    displayOrder:
      normalizeInteger(
        row.display_order
      ),

    isActive:
      normalizeBoolean(
        row.is_active
      ),
  };
}

function mapIssueReportStatistics(
  row:
    IssueReportStatisticsRow
): IssueReportStatistics {
  return {
    issueKey:
      normalizeRequiredText(
        row.issue_key,
        'Issue key',
        MAXIMUM_ISSUE_KEY_LENGTH
      ),

    title:
      normalizeRequiredText(
        row.title_en,
        'Issue title',
        MAXIMUM_ISSUE_TITLE_LENGTH
      ),

    description:
      normalizeRequiredText(
        row.description_en,
        'Issue description',
        MAXIMUM_DESCRIPTION_LENGTH
      ),

    displayOrder:
      normalizeInteger(
        row.display_order
      ),

    isActive:
      normalizeBoolean(
        row.is_active
      ),

    uniqueReporters:
      normalizeInteger(
        row.unique_reporters
      ),

    totalReports:
      normalizeInteger(
        row.total_reports
      ),

    firstReportedAt:
      normalizeTimestamp(
        row.first_reported_at
      ),

    lastReportedAt:
      normalizeTimestamp(
        row.last_reported_at
      ),

    iosUniqueReporters:
      normalizeInteger(
        row.ios_unique_reporters
      ),

    androidUniqueReporters:
      normalizeInteger(
        row.android_unique_reporters
      ),
  };
}

function mapIssueReportDetail(
  row:
    IssueReportDetailRow
): IssueReportDetail {
  return {
    id:
      normalizeOptionalText(
        row.id,
        100
      ),

    issueKey:
      normalizeRequiredText(
        row.issue_key,
        'Issue key',
        MAXIMUM_ISSUE_KEY_LENGTH
      ),

    issueTitle:
      normalizeRequiredText(
        row.issue_title,
        'Issue title',
        MAXIMUM_ISSUE_TITLE_LENGTH
      ),

    userId:
      normalizeOptionalText(
        row.user_id,
        100
      ),

    userEmail:
      normalizeOptionalText(
        row.user_email,
        320
      ),

    platform:
      normalizePlatform(
        row.platform
      ),

    appVersion:
      normalizeOptionalText(
        row.app_version
      ),

    deviceModel:
      normalizeOptionalText(
        row.device_model
      ),

    osVersion:
      normalizeOptionalText(
        row.os_version
      ),

    reportCount:
      normalizeInteger(
        row.report_count
      ),

    firstReportedAt:
      normalizeTimestamp(
        row.first_reported_at
      ),

    lastReportedAt:
      normalizeTimestamp(
        row.last_reported_at
      ),

    createdAt:
      normalizeTimestamp(
        row.created_at
      ),

    updatedAt:
      normalizeTimestamp(
        row.updated_at
      ),
  };
}

/* =========================================================
 * Authentication
 * ======================================================= */

async function requireAuthenticatedUser() {
  const {
    data,
    error,
  } =
    await supabase.auth
      .getUser();

  if (
    error
  ) {
    throw error;
  }

  if (
    !data.user
  ) {
    throw new Error(
      'Please sign in before reporting a problem.'
    );
  }

  return data.user;
}

/* =========================================================
 * Load active issue options
 * ======================================================= */

export async function getActiveIssueReportOptions():
  Promise<
    IssueReportOption[]
  > {
  try {
    await requireAuthenticatedUser();

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'issue_report_options'
        )
        .select(
          [
            'issue_key',
            'title_en',
            'description_en',
            'display_order',
            'is_active',
          ].join(
            ','
          )
        )
        .eq(
          'is_active',
          true
        )
        .order(
          'display_order',
          {
            ascending:
              true,
          }
        );

    if (
      error
    ) {
      throw error;
    }

    const rows =
      (
        data ??
        []
      ) as unknown as
        IssueReportOptionRow[];

    return rows.map(
      mapIssueReportOption
    );
  } catch (
    error:
      unknown
  ) {
    throw new Error(
      getUnknownErrorMessage(
        error,
        ISSUE_REPORT_OPTIONS_ERROR
      )
    );
  }
}

/* =========================================================
 * Submit issue report
 * ======================================================= */

export async function submitIssueReport(
  input:
    IssueReportCode |
    SubmitIssueReportInput
): Promise<
  IssueReportSubmissionResult
> {
  const issueCode =
    resolveInputIssueCode(
      input
    );

  const inputIssueTitle =
    resolveInputIssueTitle(
      input
    );

  const inputReportId =
    resolveInputReportId(
      input
    );

  try {
    await requireAuthenticatedUser();

    const metadata =
      resolveSubmissionMetadata(
        input
      );

    const {
      data,
      error,
    } =
      await supabase.rpc(
        'report_app_issue',
        {
          p_issue_key:
            issueCode,

          p_platform:
            metadata.platform,

          p_app_version:
            metadata.appVersion,

          p_device_model:
            metadata.deviceModel,

          p_os_version:
            metadata.osVersion,
        }
      );

    if (
      error
    ) {
      throw error;
    }

    if (
      !isRecord(
        data
      )
    ) {
      throw new Error(
        'The issue reporting service returned an invalid response.'
      );
    }

    const reportData =
      isRecord(
        data.report
      )
        ? data.report
        : {};

    const statisticsData =
      isRecord(
        data.statistics
      )
        ? data.statistics
        : {};

    const successValue =
      readFirstAvailableValue(
        data,
        [
          'success',
          'submitted',
          'recorded',
        ]
      );

    const success =
      successValue ===
        undefined
        ? true
        : normalizeBoolean(
            successValue,
            false
          );

    const message =
      normalizeOptionalText(
        readFirstAvailableValue(
          data,
          [
            'message',
            'status_message',
            'result_message',
          ]
        ),
        1000
      );

    if (
      !success
    ) {
      throw new Error(
        message ??
        ISSUE_REPORT_SUBMISSION_ERROR
      );
    }

    const reportId =
      normalizeOptionalText(
        readFirstAvailableValue(
          reportData,
          [
            'report_id',
            'reportId',
            'id',
          ]
        ),
        100
      ) ??
      inputReportId;

    const resultIssueCode =
      normalizeOptionalText(
        readFirstAvailableValue(
          reportData,
          [
            'issue_code',
            'issueCode',
            'issue_key',
            'issueKey',
          ]
        ),
        MAXIMUM_ISSUE_KEY_LENGTH
      ) ??
      issueCode;

    const issueTitle =
      normalizeOptionalText(
        readFirstAvailableValue(
          reportData,
          [
            'issue_title',
            'issueTitle',
            'title',
          ]
        ),
        MAXIMUM_ISSUE_TITLE_LENGTH
      ) ??
      inputIssueTitle;

    const reportCount =
      normalizeInteger(
        readFirstAvailableValue(
          reportData,
          [
            'report_count',
            'reportCount',
            'user_report_count',
            'userReportCount',
          ]
        ),
        1
      );

    const uniqueReporters =
      normalizeInteger(
        readFirstAvailableValue(
          statisticsData,
          [
            'unique_reporters',
            'uniqueReporters',
            'unique_users',
            'uniqueUsers',
          ]
        )
      );

    const totalReports =
      normalizeInteger(
        readFirstAvailableValue(
          statisticsData,
          [
            'total_reports',
            'totalReports',
            'all_reports',
            'allReports',
          ]
        ),
        reportCount
      );

    const explicitAlreadyReported =
      readFirstAvailableValue(
        data,
        [
          'already_reported',
          'alreadyReported',
          'existing_report',
          'existingReport',
          'was_existing',
          'wasExisting',
        ]
      );

    /**
     * عند عدم إرسال RPC لقيمة صريحة:
     *
     * report_count أكبر من 1 يعني أن نفس المستخدم
     * أبلغ عن المشكلة سابقًا وتمت زيادة عداد بلاغه.
     */
    const alreadyReported =
      explicitAlreadyReported ===
        undefined
        ? reportCount >
            1
        : normalizeBoolean(
            explicitAlreadyReported,
            false
          );

    return {
      success:
        true,

      reportId,

      issueCode:
        resultIssueCode,

      issueKey:
        resultIssueCode,

      issueTitle,

      alreadyReported,

      reportCount,

     uniqueReporters,

      totalUniqueReports:
        uniqueReporters,

      totalReports,

      message,

      rawResult: {
        ...data,
      },
    };
  } catch (
    error:
      unknown
  ) {
    throw new Error(
      getUnknownErrorMessage(
        error,
        ISSUE_REPORT_SUBMISSION_ERROR
      )
    );
  }
}

/* =========================================================
 * Statistics
 *
 * هذه الدالة مفيدة للوحة الإدارة أو الفحص الداخلي.
 * نجاحها يعتمد على سياسات RLS المطبقة على الـView.
 * ======================================================= */

export async function getIssueReportStatistics():
  Promise<
    IssueReportStatistics[]
  > {
  try {
    await requireAuthenticatedUser();

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'issue_report_statistics'
        )
        .select(
          [
            'issue_key',
            'title_en',
            'description_en',
            'display_order',
            'is_active',
            'unique_reporters',
            'total_reports',
            'first_reported_at',
            'last_reported_at',
            'ios_unique_reporters',
            'android_unique_reporters',
          ].join(
            ','
          )
        )
        .order(
          'display_order',
          {
            ascending:
              true,
          }
        );

    if (
      error
    ) {
      throw error;
    }

    const rows =
      (
        data ??
        []
      ) as unknown as
        IssueReportStatisticsRow[];

    return rows.map(
      mapIssueReportStatistics
    );
  } catch (
    error:
      unknown
  ) {
    throw new Error(
      getUnknownErrorMessage(
        error,
        ISSUE_REPORT_STATISTICS_ERROR
      )
    );
  }
}

/* =========================================================
 * Reporter details
 *
 * لا تُستخدم داخل شاشة المستخدم العادي.
 * هي مخصصة فقط للوحة إدارة آمنة إذا سمحت RLS بذلك.
 * ======================================================= */

export async function getIssueReportDetails(
  issueKey?:
    string
): Promise<
  IssueReportDetail[]
> {
  try {
    await requireAuthenticatedUser();

    let query =
      supabase
        .from(
          'issue_report_details'
        )
        .select(
          [
            'id',
            'issue_key',
            'issue_title',
            'user_id',
            'user_email',
            'platform',
            'app_version',
            'device_model',
            'os_version',
            'report_count',
            'first_reported_at',
            'last_reported_at',
            'created_at',
            'updated_at',
          ].join(
            ','
          )
        )
        .order(
          'last_reported_at',
          {
            ascending:
              false,
          }
        );

    if (
      typeof issueKey ===
        'string' &&
      issueKey.trim().length >
        0
    ) {
      query =
        query.eq(
          'issue_key',
          normalizeRequiredText(
            issueKey,
            'Issue key',
            MAXIMUM_ISSUE_KEY_LENGTH
          )
        );
    }

    const {
      data,
      error,
    } =
      await query;

    if (
      error
    ) {
      throw error;
    }

    const rows =
      (
        data ??
        []
      ) as unknown as
        IssueReportDetailRow[];

    return rows.map(
      mapIssueReportDetail
    );
  } catch (
    error:
      unknown
  ) {
    throw new Error(
      getUnknownErrorMessage(
        error,
        ISSUE_REPORT_DETAILS_ERROR
      )
    );
  }
}