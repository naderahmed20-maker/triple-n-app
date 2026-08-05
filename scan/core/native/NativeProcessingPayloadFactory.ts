// scan/core/native/NativeProcessingPayloadFactory.ts
// Part 1/4
//
// Triple N - Native Processing Payload Factory
//
// هذا الملف مسؤول عن تحويل بيانات Scan Item وQueue
// إلى NativeProcessingJobPayload صغيرة وآمنة.
//
// مسؤولياته:
//
// 1) استقبال بيانات Job من Queue أو Service.
// 2) تطبيع مصدر الصورة.
// 3) تطبيع بيانات الدولاب.
// 4) تطبيع خيارات المعالجة.
// 5) إنشاء أسماء ملفات Output آمنة.
// 6) منع تمرير TypedArrays أو SegmentationResult.
// 7) منع تمرير Objects غير قابلة للتخزين.
// 8) التحقق من توافق المنصة.
// 9) إنتاج Payload متوافقة مع NativeProcessingContracts.
// 10) دعم Dependency Injection للاختبارات.
//
// هذا الملف لا يشغّل EdgeSAM.
// لا يستدعي Swift أو Kotlin.
// لا يحفظ في AsyncStorage.
// لا يجدول Native Job.
// لا يعدّل ProcessingQueue.
// لا يحدّث Wardrobe مباشرة.

import {
  Platform,
} from 'react-native';

import {
  NATIVE_PROCESSING_CONTRACT_VERSION,
  isNativeProcessingJobPayload,
  normalizeNativeProcessingTimestamp,
} from './NativeProcessingContracts';

import type {
  NativeProcessingImageSource,
  NativeProcessingJobPayload,
  NativeProcessingOptions,
  NativeProcessingWardrobeContext,
} from './NativeProcessingContracts';

import type {
  ProcessingBatchId,
  ProcessingJobId,
  ProcessingPlatform,
  ProcessingQueueId,
  ProcessingRequestId,
  ProcessingTimestamp,
  ProcessingWardrobeItemId,
} from '../queue/QueueTypes';

/* =========================================================
 * Constants
 * ======================================================= */

export const DEFAULT_NATIVE_PROCESSING_OUTPUT_FORMAT =
  'png' as const;

export const DEFAULT_NATIVE_PROCESSING_OUTPUT_QUALITY =
  1;

export const DEFAULT_NATIVE_PROCESSING_MAXIMUM_ATTEMPTS =
  3;

export const DEFAULT_NATIVE_PROCESSING_CURRENT_ATTEMPT =
  0;

export const DEFAULT_NATIVE_PROCESSING_PRIORITY =
  0;

export const DEFAULT_NATIVE_PROCESSING_OUTPUT_FILE_PREFIX =
  'triple-n-processed';

export const DEFAULT_NATIVE_PROCESSING_SOURCE_FORMAT =
  'unknown';

export const DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_ENTRIES =
  64;

export const DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_KEY_LENGTH =
  64;

export const DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_STRING_LENGTH =
  512;

export const DEFAULT_NATIVE_PROCESSING_MAXIMUM_FILE_NAME_LENGTH =
  180;

export const DEFAULT_NATIVE_PROCESSING_MINIMUM_OUTPUT_QUALITY =
  0;

export const DEFAULT_NATIVE_PROCESSING_MAXIMUM_OUTPUT_QUALITY =
  1;

export const DEFAULT_NATIVE_PROCESSING_MINIMUM_PRIORITY =
  -1000;

export const DEFAULT_NATIVE_PROCESSING_MAXIMUM_PRIORITY =
  1000;

/* =========================================================
 * Supported image formats
 * ======================================================= */

export type NativeProcessingSourceFormat =
  | 'jpg'
  | 'jpeg'
  | 'png'
  | 'heic'
  | 'heif'
  | 'webp'
  | 'bmp'
  | 'tiff'
  | 'unknown';

/* =========================================================
 * Serializable metadata
 * ======================================================= */

export type NativeProcessingMetadataValue =
  string |
  number |
  boolean |
  null;

export type NativeProcessingMetadata =
  Readonly<
    Record<
      string,
      NativeProcessingMetadataValue
    >
  >;

/* =========================================================
 * Source input
 * ======================================================= */

/**
 * مصدر الصورة الخام القادم من Scan Item.
 *
 * هذا النوع لا يسمح بتمرير:
 *
 * - Uint8Array
 * - Float32Array
 * - RGBA buffers
 * - Base64 image contents
 * - Decoder tensors
 */
export type NativeProcessingPayloadSourceInput = {
  uri:
    string;

  width?:
    number | null;

  height?:
    number | null;

  orientation?:
    number | null;

  format?:
    string | null;

  fileName?:
    string | null;

  mimeType?:
    string | null;

  fileSizeBytes?:
    number | null;

  sourceId?:
    string | null;

  createdAt?:
    number | null;
};

/* =========================================================
 * Wardrobe input
 * ======================================================= */

export type NativeProcessingPayloadWardrobeInput = {
  wardrobeType?:
    'male' | 'female' | null;

  category?:
    string | null;

  subcategory?:
    string | null;

  itemName?:
    string | null;

  color?:
    string | null;

  style?:
    string | null;

  season?:
    string | null;

  occasion?:
    string | null;

  isFavorite?:
    boolean | null;
};

/* =========================================================
 * Processing options input
 * ======================================================= */

export type NativeProcessingPayloadOptionsInput = {
  outputDirectoryUri?:
    string | null;

  outputFileName?:
    string | null;

  outputQuality?:
    number | null;

  maximumAttempts?:
    number | null;

  currentAttempt?:
    number | null;

  collectDiagnostics?:
    boolean | null;

  preserveSourceFile?:
    boolean | null;

  replaceExistingOutput?:
    boolean | null;

  allowForegroundFallback?:
    boolean | null;
};

/* =========================================================
 * Main factory input
 * ======================================================= */

export type NativeProcessingPayloadFactoryInput = {
  jobId:
    ProcessingJobId;

  queueId:
    ProcessingQueueId;

  batchId:
    ProcessingBatchId;

  requestId:
    ProcessingRequestId;

  wardrobeItemId:
    ProcessingWardrobeItemId;

  platform?:
    ProcessingPlatform | null;

  priority?:
    number | null;

  source:
    NativeProcessingPayloadSourceInput;

  wardrobe?:
    NativeProcessingPayloadWardrobeInput | null;

  options?:
    NativeProcessingPayloadOptionsInput | null;

  createdAt?:
    number | null;

  metadata?:
    Readonly<
      Record<
        string,
        unknown
      >
    > | null;
};

/* =========================================================
 * Partial factory input
 * ======================================================= */

/**
 * نسخة مرنة للاستخدام عند بناء البيانات تدريجيًا.
 *
 * يتم تحويلها لاحقًا إلى NativeProcessingPayloadFactoryInput
 * بعد التحقق من الحقول الأساسية.
 */
export type PartialNativeProcessingPayloadFactoryInput =
  Partial<
    Omit<
      NativeProcessingPayloadFactoryInput,
      'source'
    >
  > & {
    source?:
      Partial<
        NativeProcessingPayloadSourceInput
      > | null;
  };

/* =========================================================
 * Factory clock
 * ======================================================= */

export type NativeProcessingPayloadFactoryClock = {
  now():
    number;
};

/* =========================================================
 * Identifier factory
 * ======================================================= */

export type NativeProcessingPayloadIdentifierFactory = {
  createSourceId(
    input:
      NativeProcessingPayloadSourceInput,
    timestamp:
      ProcessingTimestamp
  ):
    string;

  createOutputFileName(
    input:
      NativeProcessingPayloadFactoryInput,
    timestamp:
      ProcessingTimestamp
  ):
    string;
};

/* =========================================================
 * Factory options
 * ======================================================= */

export type NativeProcessingPayloadFactoryOptions = {
  clock?:
    NativeProcessingPayloadFactoryClock;

  identifierFactory?:
    Partial<
      NativeProcessingPayloadIdentifierFactory
    >;

  defaultOutputDirectoryUri?:
    string | null;

  defaultOutputQuality?:
    number;

  defaultMaximumAttempts?:
    number;

  defaultCollectDiagnostics?:
    boolean;

  defaultPreserveSourceFile?:
    boolean;

  defaultReplaceExistingOutput?:
    boolean;

  defaultAllowForegroundFallback?:
    boolean;

  maximumMetadataEntries?:
    number;

  maximumMetadataKeyLength?:
    number;

  maximumMetadataStringLength?:
    number;

  maximumFileNameLength?:
    number;

  strictPlatformMatching?:
    boolean;

  enableDebugLogs?:
    boolean;
};

/* =========================================================
 * Normalized factory options
 * ======================================================= */

type NormalizedNativeProcessingPayloadFactoryOptions = {
  clock:
    NativeProcessingPayloadFactoryClock;

  identifierFactory:
    NativeProcessingPayloadIdentifierFactory;

  defaultOutputDirectoryUri:
    string | null;

  defaultOutputQuality:
    number;

  defaultMaximumAttempts:
    number;

  defaultCollectDiagnostics:
    boolean;

  defaultPreserveSourceFile:
    boolean;

  defaultReplaceExistingOutput:
    boolean;

  defaultAllowForegroundFallback:
    boolean;

  maximumMetadataEntries:
    number;

  maximumMetadataKeyLength:
    number;

  maximumMetadataStringLength:
    number;

  maximumFileNameLength:
    number;

  strictPlatformMatching:
    boolean;

  enableDebugLogs:
    boolean;
};

/* =========================================================
 * Validation issue
 * ======================================================= */

export type NativeProcessingPayloadValidationIssueCode =
  | 'INVALID_INPUT'
  | 'MISSING_JOB_ID'
  | 'MISSING_QUEUE_ID'
  | 'MISSING_BATCH_ID'
  | 'MISSING_REQUEST_ID'
  | 'MISSING_WARDROBE_ITEM_ID'
  | 'INVALID_PLATFORM'
  | 'PLATFORM_MISMATCH'
  | 'MISSING_SOURCE'
  | 'INVALID_SOURCE_URI'
  | 'INVALID_SOURCE_DIMENSIONS'
  | 'INVALID_SOURCE_ORIENTATION'
  | 'INVALID_SOURCE_FILE_SIZE'
  | 'INVALID_OUTPUT_DIRECTORY'
  | 'INVALID_OUTPUT_FILE_NAME'
  | 'INVALID_OUTPUT_QUALITY'
  | 'INVALID_MAXIMUM_ATTEMPTS'
  | 'INVALID_CURRENT_ATTEMPT'
  | 'INVALID_METADATA'
  | 'UNSAFE_VALUE'
  | 'PAYLOAD_VALIDATION_FAILED';

export type NativeProcessingPayloadValidationIssue = {
  code:
    NativeProcessingPayloadValidationIssueCode;

  field:
    string | null;

  message:
    string;

  fatal:
    boolean;

  valueType:
    string | null;
};

/* =========================================================
 * Validation result
 * ======================================================= */

export type NativeProcessingPayloadValidationResult = {
  valid:
    boolean;

  issues:
    readonly NativeProcessingPayloadValidationIssue[];

  fatalIssues:
    readonly NativeProcessingPayloadValidationIssue[];

  warnings:
    readonly NativeProcessingPayloadValidationIssue[];
};

/* =========================================================
 * Factory result
 * ======================================================= */

export type NativeProcessingPayloadFactoryResult = {
  payload:
    NativeProcessingJobPayload;

  validation:
    NativeProcessingPayloadValidationResult;

  createdAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type NativeProcessingPayloadFactoryDiagnostics = {
  createCount:
    number;

  successfulCreateCount:
    number;

  failedCreateCount:
    number;

  validationCount:
    number;

  normalizedSourceCount:
    number;

  normalizedWardrobeCount:
    number;

  normalizedOptionsCount:
    number;

  sanitizedMetadataCount:
    number;

  rejectedMetadataEntryCount:
    number;

  generatedSourceIdCount:
    number;

  generatedOutputFileNameCount:
    number;

  lastCreatedAt:
    ProcessingTimestamp | null;

  lastFailedAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;
};

/* =========================================================
 * Factory error
 * ======================================================= */

export class NativeProcessingPayloadFactoryError
  extends Error {
  public readonly code:
    NativeProcessingPayloadValidationIssueCode;

  public readonly issues:
    readonly NativeProcessingPayloadValidationIssue[];

  public constructor(
    code:
      NativeProcessingPayloadValidationIssueCode,
    message:
      string,
    issues:
      readonly NativeProcessingPayloadValidationIssue[] =
        []
  ) {
    super(
      message
    );

    this.name =
      'NativeProcessingPayloadFactoryError';

    this.code =
      code;

    this.issues =
      [
        ...issues,
      ];

    Object.setPrototypeOf(
      this,
      NativeProcessingPayloadFactoryError
        .prototype
    );
  }
}

/* =========================================================
 * General helpers
 * ======================================================= */

function defaultNow():
  number {
  return Date.now();
}

function getUnknownErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof
      Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
      'string'
  ) {
    return error;
  }

  try {
    const serialized =
      JSON.stringify(
        error
      );

    if (
      typeof serialized ===
        'string' &&
      serialized.length >
        0
    ) {
      return serialized;
    }
  } catch {
    // نستخدم String كحل أخير.
  }

  return String(
    error
  );
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

function getValueType(
  value:
    unknown
): string {
  if (
    value ===
      null
  ) {
    return 'null';
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return 'array';
  }

  const constructorName =
    isRecord(
      value
    ) &&
    typeof value
      .constructor ===
      'function'
      ? value
          .constructor
          .name
      : null;

  if (
    constructorName &&
    constructorName !==
      'Object'
  ) {
    return constructorName;
  }

  return typeof value;
}

function readString(
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

  return normalized.length >
    0
    ? normalized
    : null;
}

function readBoolean(
  value:
    unknown,
  fallback:
    boolean
): boolean {
  return typeof value ===
    'boolean'
    ? value
    : fallback;
}

function readFiniteNumber(
  value:
    unknown
): number | null {
  return (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    )
  )
    ? value
    : null;
}

function clampNumber(
  value:
    number,
  minimum:
    number,
  maximum:
    number
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function normalizeInteger(
  value:
    unknown,
  fallback:
    number
): number {
  const numberValue =
    readFiniteNumber(
      value
    );

  if (
    numberValue ===
      null
  ) {
    return Math.floor(
      fallback
    );
  }

  return Math.floor(
    numberValue
  );
}

function normalizePositiveInteger(
  value:
    unknown,
  fallback:
    number
): number {
  const normalized =
    normalizeInteger(
      value,
      fallback
    );

  return Math.max(
    1,
    normalized
  );
}

function normalizeNonNegativeInteger(
  value:
    unknown,
  fallback:
    number
): number {
  const normalized =
    normalizeInteger(
      value,
      fallback
    );

  return Math.max(
    0,
    normalized
  );
}

function truncateString(
  value:
    string,
  maximumLength:
    number
): string {
  if (
    value.length <=
      maximumLength
  ) {
    return value;
  }

  return value.slice(
    0,
    maximumLength
  );
}

function removeControlCharacters(
  value:
    string
): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001F\u007F]/g,
    ''
  );
}

function normalizeOptionalString(
  value:
    unknown,
  maximumLength =
    DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_STRING_LENGTH
): string | null {
  const normalized =
    readString(
      value
    );

  if (
    !normalized
  ) {
    return null;
  }

  return truncateString(
    removeControlCharacters(
      normalized
    ),
    maximumLength
  );
}

function normalizeIdentifier(
  value:
    unknown,
  fieldName:
    string
): string {
  const normalized =
    readString(
      value
    );

  if (
    !normalized
  ) {
    throw new NativeProcessingPayloadFactoryError(
      resolveMissingIdentifierIssueCode(
        fieldName
      ),
      `Native processing payload is missing a valid ${fieldName}.`,
      [
        {
          code:
            resolveMissingIdentifierIssueCode(
              fieldName
            ),

          field:
            fieldName,

          message:
            `${fieldName} must be a non-empty string.`,

          fatal:
            true,

          valueType:
            getValueType(
              value
            ),
        },
      ]
    );
  }

  return normalized;
}

function resolveMissingIdentifierIssueCode(
  fieldName:
    string
): NativeProcessingPayloadValidationIssueCode {
  switch (
    fieldName
  ) {
    case 'jobId':
      return 'MISSING_JOB_ID';

    case 'queueId':
      return 'MISSING_QUEUE_ID';

    case 'batchId':
      return 'MISSING_BATCH_ID';

    case 'requestId':
      return 'MISSING_REQUEST_ID';

    case 'wardrobeItemId':
      return 'MISSING_WARDROBE_ITEM_ID';

    default:
      return 'INVALID_INPUT';
  }
}

/* =========================================================
 * Platform helpers
 * ======================================================= */

export function resolveCurrentProcessingPlatform():
  ProcessingPlatform {
  if (
    Platform.OS ===
      'ios'
  ) {
    return 'ios';
  }

  if (
    Platform.OS ===
      'android'
  ) {
    return 'android';
  }

  return 'unknown';
}

function normalizeProcessingPlatform(
  value:
    unknown,
  fallback:
    ProcessingPlatform
): ProcessingPlatform {
  if (
    value ===
      'ios' ||
    value ===
      'android'
  ) {
    return value;
  }

  if (
    fallback ===
      'ios' ||
    fallback ===
      'android'
  ) {
    return fallback;
  }

  return 'unknown';
}

/* =========================================================
 * URI helpers
 * ======================================================= */

function stripUriQueryAndFragment(
  uri:
    string
): string {
  const queryIndex =
    uri.indexOf(
      '?'
    );

  const fragmentIndex =
    uri.indexOf(
      '#'
    );

  let endIndex =
    uri.length;

  if (
    queryIndex >=
      0
  ) {
    endIndex =
      Math.min(
        endIndex,
        queryIndex
      );
  }

  if (
    fragmentIndex >=
      0
  ) {
    endIndex =
      Math.min(
        endIndex,
        fragmentIndex
      );
  }

  return uri.slice(
    0,
    endIndex
  );
}

function getLastUriSegment(
  uri:
    string
): string | null {
  const cleanUri =
    stripUriQueryAndFragment(
      uri
    );

  const normalized =
    cleanUri.replace(
      /\\/g,
      '/'
    );

  const segments =
    normalized.split(
      '/'
    );

  for (
    let index =
      segments.length -
        1;
    index >=
      0;
    index -=
      1
  ) {
    const segment =
      normalizeOptionalString(
        segments[index],
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_FILE_NAME_LENGTH
      );

    if (
      segment
    ) {
      try {
        return decodeURIComponent(
          segment
        );
      } catch {
        return segment;
      }
    }
  }

  return null;
}

function getFileExtension(
  value:
    string | null
): string | null {
  if (
    !value
  ) {
    return null;
  }

  const cleanValue =
    stripUriQueryAndFragment(
      value
    );

  const lastDotIndex =
    cleanValue.lastIndexOf(
      '.'
    );

  if (
    lastDotIndex <
      0 ||
    lastDotIndex ===
      cleanValue.length -
        1
  ) {
    return null;
  }

  return cleanValue
    .slice(
      lastDotIndex +
        1
    )
    .trim()
    .toLowerCase();
}

function normalizeSourceFormat(
  explicitFormat:
    unknown,
  mimeType:
    string | null,
  fileName:
    string | null,
  uri:
    string
): NativeProcessingSourceFormat {
  const candidates =
    [
      normalizeOptionalString(
        explicitFormat,
        32
      ),
      mimeType
        ?.split(
          '/'
        )
        .pop() ??
        null,
      getFileExtension(
        fileName
      ),
      getFileExtension(
        uri
      ),
    ];

  for (
    const candidate of
    candidates
  ) {
    const normalized =
      candidate
        ?.toLowerCase()
        .replace(
          /^\./,
          ''
        );

    switch (
      normalized
    ) {
      case 'jpg':
        return 'jpg';

      case 'jpeg':
        return 'jpeg';

      case 'png':
        return 'png';

      case 'heic':
        return 'heic';

      case 'heif':
        return 'heif';

      case 'webp':
        return 'webp';

      case 'bmp':
        return 'bmp';

      case 'tif':
      case 'tiff':
        return 'tiff';
    }
  }

  return 'unknown';
}

function normalizeMimeType(
  value:
    unknown,
  format:
    NativeProcessingSourceFormat
): string | null {
  const explicit =
    normalizeOptionalString(
      value,
      128
    );

  if (
    explicit
  ) {
    return explicit.toLowerCase();
  }

  switch (
    format
  ) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';

    case 'png':
      return 'image/png';

    case 'heic':
      return 'image/heic';

    case 'heif':
      return 'image/heif';

    case 'webp':
      return 'image/webp';

    case 'bmp':
      return 'image/bmp';

    case 'tiff':
      return 'image/tiff';

    case 'unknown':
      return null;
  }
}

/* =========================================================
 * File name helpers
 * ======================================================= */

function sanitizeFileNameSegment(
  value:
    string,
  fallback:
    string
): string {
  const normalized =
    removeControlCharacters(
      value
    )
      .trim()
      .replace(
        /\s+/g,
        '-'
      )
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        '-'
      )
      .replace(
        /-+/g,
        '-'
      )
      .replace(
        /^[-._]+|[-._]+$/g,
        ''
      );

  return normalized.length >
    0
    ? normalized
    : fallback;
}

function removeFileExtension(
  value:
    string
): string {
  const lastDotIndex =
    value.lastIndexOf(
      '.'
    );

  if (
    lastDotIndex <=
      0
  ) {
    return value;
  }

  return value.slice(
    0,
    lastDotIndex
  );
}

function ensurePngExtension(
  value:
    string
): string {
  const withoutExtension =
    removeFileExtension(
      value
    );

  return `${withoutExtension}.png`;
}

function createDefaultSourceId(
  input:
    NativeProcessingPayloadSourceInput,
  timestamp:
    ProcessingTimestamp
): string {
  const explicitSourceId =
    normalizeOptionalString(
      input.sourceId,
      180
    );

  if (
    explicitSourceId
  ) {
    return explicitSourceId;
  }

  const fileName =
    normalizeOptionalString(
      input.fileName,
      120
    ) ??
    getLastUriSegment(
      input.uri
    ) ??
    'source';

  const safeFileName =
    sanitizeFileNameSegment(
      removeFileExtension(
        fileName
      ),
      'source'
    );

  return `${safeFileName}-${timestamp}`;
}

function createDefaultOutputFileName(
  input:
    NativeProcessingPayloadFactoryInput,
  timestamp:
    ProcessingTimestamp
): string {
  const sourceFileName =
    normalizeOptionalString(
      input.source
        .fileName,
      120
    ) ??
    getLastUriSegment(
      input.source.uri
    );

  const sourceBaseName =
    sourceFileName
      ? sanitizeFileNameSegment(
          removeFileExtension(
            sourceFileName
          ),
          'scan'
        )
      : 'scan';

  const jobIdSegment =
    sanitizeFileNameSegment(
      String(
        input.jobId
      ),
      'job'
    ).slice(
      0,
      48
    );

  return ensurePngExtension(
    `${DEFAULT_NATIVE_PROCESSING_OUTPUT_FILE_PREFIX}-${sourceBaseName}-${jobIdSegment}-${timestamp}`
  );
}

/* =========================================================
 * Factory option normalization
 * ======================================================= */

function normalizeFactoryOptions(
  options:
    NativeProcessingPayloadFactoryOptions
): NormalizedNativeProcessingPayloadFactoryOptions {
  const clock =
    options.clock ?? {
      now:
        defaultNow,
    };

  const identifierFactory:
    NativeProcessingPayloadIdentifierFactory = {
    createSourceId:
      options.identifierFactory
        ?.createSourceId ??
      createDefaultSourceId,

    createOutputFileName:
      options.identifierFactory
        ?.createOutputFileName ??
      createDefaultOutputFileName,
  };

  return {
    clock,

    identifierFactory,

    defaultOutputDirectoryUri:
      normalizeOptionalString(
        options
          .defaultOutputDirectoryUri,
        2048
      ),

    defaultOutputQuality:
      clampNumber(
        readFiniteNumber(
          options
            .defaultOutputQuality
        ) ??
        DEFAULT_NATIVE_PROCESSING_OUTPUT_QUALITY,
        DEFAULT_NATIVE_PROCESSING_MINIMUM_OUTPUT_QUALITY,
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_OUTPUT_QUALITY
      ),

    defaultMaximumAttempts:
      normalizePositiveInteger(
        options
          .defaultMaximumAttempts,
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_ATTEMPTS
      ),

    defaultCollectDiagnostics:
      readBoolean(
        options
          .defaultCollectDiagnostics,
        false
      ),

    defaultPreserveSourceFile:
      readBoolean(
        options
          .defaultPreserveSourceFile,
        true
      ),

    defaultReplaceExistingOutput:
      readBoolean(
        options
          .defaultReplaceExistingOutput,
        true
      ),

    defaultAllowForegroundFallback:
      readBoolean(
        options
          .defaultAllowForegroundFallback,
        true
      ),

    maximumMetadataEntries:
      normalizePositiveInteger(
        options
          .maximumMetadataEntries,
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_ENTRIES
      ),

    maximumMetadataKeyLength:
      normalizePositiveInteger(
        options
          .maximumMetadataKeyLength,
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_KEY_LENGTH
      ),

    maximumMetadataStringLength:
      normalizePositiveInteger(
        options
          .maximumMetadataStringLength,
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_STRING_LENGTH
      ),

    maximumFileNameLength:
      normalizePositiveInteger(
        options
          .maximumFileNameLength,
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_FILE_NAME_LENGTH
      ),

    strictPlatformMatching:
      readBoolean(
        options
          .strictPlatformMatching,
        true
      ),

    enableDebugLogs:
      readBoolean(
        options
          .enableDebugLogs,
        false
      ),
  };
}

/* =========================================================
 * Factory class
 * ======================================================= */

export class NativeProcessingPayloadFactory {
  private readonly options:
    NormalizedNativeProcessingPayloadFactoryOptions;

  private diagnostics:
    NativeProcessingPayloadFactoryDiagnostics;

  public constructor(
    options:
      NativeProcessingPayloadFactoryOptions =
        {}
  ) {
    this.options =
      normalizeFactoryOptions(
        options
      );

    this.diagnostics = {
      createCount:
        0,

      successfulCreateCount:
        0,

      failedCreateCount:
        0,

      validationCount:
        0,

      normalizedSourceCount:
        0,

      normalizedWardrobeCount:
        0,

      normalizedOptionsCount:
        0,

      sanitizedMetadataCount:
        0,

      rejectedMetadataEntryCount:
        0,

      generatedSourceIdCount:
        0,

      generatedOutputFileNameCount:
        0,

      lastCreatedAt:
        null,

      lastFailedAt:
        null,

      lastError:
        null,
    };
  }

  /* =======================================================
   * Time
   * ===================================================== */

  private now():
    ProcessingTimestamp {
    return normalizeNativeProcessingTimestamp(
      this.options
        .clock
        .now()
    );
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    NativeProcessingPayloadFactoryDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  private updateDiagnostics(
    patch:
      Partial<
        NativeProcessingPayloadFactoryDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...patch,
    };
  }

  /*
   * Part 2/4 continues inside this class with:
   *
   * - normalizeSource()
   * - normalizeWardrobe()
   * - normalizeOptions()
   * - sanitizeMetadata()
   * - unsafe value detection
   * - source URI validation
   * - dimensions / orientation validation
   */
  /* =======================================================
   * Validation issue helpers
   * ===================================================== */

  private createValidationIssue(
    code:
      NativeProcessingPayloadValidationIssueCode,
    field:
      string | null,
    message:
      string,
    fatal:
      boolean,
    value:
      unknown
  ): NativeProcessingPayloadValidationIssue {
    return {
      code,

      field,

      message,

      fatal,

      valueType:
        getValueType(
          value
        ),
    };
  }

  private createValidationResult(
    issues:
      readonly NativeProcessingPayloadValidationIssue[]
  ): NativeProcessingPayloadValidationResult {
    const copiedIssues =
      [
        ...issues,
      ];

    const fatalIssues =
      copiedIssues.filter(
        issue =>
          issue.fatal
      );

    const warnings =
      copiedIssues.filter(
        issue =>
          !issue.fatal
      );

    return {
      valid:
        fatalIssues.length ===
        0,

      issues:
        copiedIssues,

      fatalIssues,

      warnings,
    };
  }

  private throwValidationError(
    issues:
      readonly NativeProcessingPayloadValidationIssue[],
    fallbackMessage =
      'Native processing payload validation failed.'
  ): never {
    const fatalIssues =
      issues.filter(
        issue =>
          issue.fatal
      );

    const primaryIssue =
      fatalIssues[0] ??
      issues[0] ??
      null;

    throw new NativeProcessingPayloadFactoryError(
      primaryIssue
        ?.code ??
      'PAYLOAD_VALIDATION_FAILED',
      primaryIssue
        ?.message ??
      fallbackMessage,
      issues
    );
  }

  /* =======================================================
   * Unsafe-value detection
   * ===================================================== */

  private isTypedArray(
    value:
      unknown
  ): boolean {
    if (
      typeof ArrayBuffer ===
        'undefined'
    ) {
      return false;
    }

    if (
      value instanceof
        ArrayBuffer
    ) {
      return true;
    }

    if (
      typeof ArrayBuffer
        .isView ===
        'function' &&
      ArrayBuffer.isView(
        value
      )
    ) {
      return true;
    }

    return false;
  }

  private isUnsafeObject(
    value:
      unknown
  ): boolean {
    if (
      this.isTypedArray(
        value
      )
    ) {
      return true;
    }

    if (
      value instanceof
        Date
    ) {
      return false;
    }

    if (
      value instanceof
        Error
    ) {
      return true;
    }

    if (
      typeof value ===
        'function' ||
      typeof value ===
        'symbol' ||
      typeof value ===
        'bigint'
    ) {
      return true;
    }

    if (
      isRecord(
        value
      )
    ) {
      const constructorName =
        value
          .constructor
          ?.name;

      if (
        constructorName &&
        constructorName !==
          'Object'
      ) {
        return true;
      }
    }

    return false;
  }

  private containsUnsafeValue(
    value:
      unknown,
    depth =
      0,
    visited =
      new Set<
        object
      >()
  ): boolean {
    if (
      depth >
        8
    ) {
      return true;
    }

    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return false;
    }

    if (
      typeof value ===
        'string' ||
      typeof value ===
        'number' ||
      typeof value ===
        'boolean'
    ) {
      return false;
    }

    if (
      this.isUnsafeObject(
        value
      )
    ) {
      return true;
    }

    if (
      typeof value !==
        'object'
    ) {
      return true;
    }

    if (
      visited.has(
        value
      )
    ) {
      return true;
    }

    visited.add(
      value
    );

    if (
      Array.isArray(
        value
      )
    ) {
      for (
        const entry of
        value
      ) {
        if (
          this.containsUnsafeValue(
            entry,
            depth +
              1,
            visited
          )
        ) {
          return true;
        }
      }

      return false;
    }

    if (
      value instanceof
        Date
    ) {
      return false;
    }

    for (
      const entry of
      Object.values(
        value
      )
    ) {
      if (
        this.containsUnsafeValue(
          entry,
          depth +
            1,
          visited
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /* =======================================================
   * Source URI validation
   * ===================================================== */

  private validateSourceUri(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): string {
    const uri =
      normalizeOptionalString(
        value,
        4096
      );

    if (
      !uri
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_URI',
          'source.uri',
          'Native processing source URI must be a non-empty string.',
          true,
          value
        )
      );

      return '';
    }

    if (
      uri.startsWith(
        'data:'
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          'source.uri',
          'Base64 and data URIs are not allowed in native processing payloads.',
          true,
          value
        )
      );

      return uri;
    }

    if (
      uri.startsWith(
        'blob:'
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_URI',
          'source.uri',
          'Blob URIs cannot be persisted or consumed safely by native background processing.',
          true,
          value
        )
      );

      return uri;
    }

    const supportedPrefixes =
      [
        'file://',
        'content://',
        'ph://',
        'assets-library://',
        'http://',
        'https://',
      ];

    const hasKnownPrefix =
      supportedPrefixes.some(
        prefix =>
          uri
            .toLowerCase()
            .startsWith(
              prefix
            )
      );

    const looksLikeAbsoluteFilePath =
      uri.startsWith(
        '/'
      ) ||
      /^[a-zA-Z]:[\\/]/.test(
        uri
      );

    if (
      !hasKnownPrefix &&
      !looksLikeAbsoluteFilePath
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_URI',
          'source.uri',
          'The source URI uses an unknown scheme. Native execution may not be able to access it.',
          false,
          value
        )
      );
    }

    return uri;
  }

  /* =======================================================
   * Source dimension normalization
   * ===================================================== */

  private normalizeNullableDimension(
    value:
      unknown,
    field:
      'source.width' |
      'source.height',
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): number | null {
    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return null;
    }

    const numberValue =
      readFiniteNumber(
        value
      );

    if (
      numberValue ===
        null
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_DIMENSIONS',
          field,
          `${field} must be a finite positive number when provided.`,
          false,
          value
        )
      );

      return null;
    }

    const normalized =
      Math.floor(
        numberValue
      );

    if (
      normalized <=
        0
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_DIMENSIONS',
          field,
          `${field} must be greater than zero when provided.`,
          false,
          value
        )
      );

      return null;
    }

    if (
      normalized >
        16384
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_DIMENSIONS',
          field,
          `${field} exceeds the supported maximum image dimension.`,
          false,
          value
        )
      );
    }

    return normalized;
  }

  private normalizeOrientation(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): number | null {
    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return null;
    }

    const numberValue =
      readFiniteNumber(
        value
      );

    if (
      numberValue ===
        null
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_ORIENTATION',
          'source.orientation',
          'Source orientation must be an integer from 1 to 8 when provided.',
          false,
          value
        )
      );

      return null;
    }

    const normalized =
      Math.floor(
        numberValue
      );

    if (
      normalized <
        1 ||
      normalized >
        8
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_ORIENTATION',
          'source.orientation',
          'Source orientation must be between 1 and 8.',
          false,
          value
        )
      );

      return null;
    }

    return normalized;
  }

  private normalizeFileSizeBytes(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): number | null {
    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return null;
    }

    const numberValue =
      readFiniteNumber(
        value
      );

    if (
      numberValue ===
        null ||
      numberValue <
        0
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_FILE_SIZE',
          'source.fileSizeBytes',
          'Source file size must be a non-negative finite number when provided.',
          false,
          value
        )
      );

      return null;
    }

    return Math.floor(
      numberValue
    );
  }

  /* =======================================================
   * Source normalization
   * ===================================================== */

  private normalizeSource(
    input:
      NativeProcessingPayloadSourceInput,
    timestamp:
      ProcessingTimestamp,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): NativeProcessingImageSource {
    if (
      !isRecord(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_SOURCE',
          'source',
          'Native processing payload must contain a source object.',
          true,
          input
        )
      );

      return {
        uri:
          '',

        width:
          null,

        height:
          null,

        orientation:
          null,

        format:
          DEFAULT_NATIVE_PROCESSING_SOURCE_FORMAT,

        fileName:
          null,

        mimeType:
          null,

        fileSizeBytes:
          null,

        sourceId:
          `invalid-source-${timestamp}`,

        createdAt:
          timestamp,
      };
    }

    if (
      this.containsUnsafeValue(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          'source',
          'The source object contains an unsupported or non-serializable value.',
          true,
          input
        )
      );
    }

    const uri =
      this.validateSourceUri(
        input.uri,
        issues
      );

    const width =
      this.normalizeNullableDimension(
        input.width,
        'source.width',
        issues
      );

    const height =
      this.normalizeNullableDimension(
        input.height,
        'source.height',
        issues
      );

    if (
      (
        width ===
          null
      ) !==
      (
        height ===
          null
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_DIMENSIONS',
          'source',
          'Source width and height should either both be provided or both be null.',
          false,
          {
            width,
            height,
          }
        )
      );
    }

    const orientation =
      this.normalizeOrientation(
        input.orientation,
        issues
      );

    const explicitFileName =
      normalizeOptionalString(
        input.fileName,
        this.options
          .maximumFileNameLength
      );

    const uriFileName =
      uri
        ? getLastUriSegment(
            uri
          )
        : null;

    const rawFileName =
      explicitFileName ??
      uriFileName;

    const fileName =
      rawFileName
        ? truncateString(
            removeControlCharacters(
              rawFileName
            ),
            this.options
              .maximumFileNameLength
          )
        : null;

    const explicitMimeType =
      normalizeOptionalString(
        input.mimeType,
        128
      );

    const format =
      normalizeSourceFormat(
        input.format,
        explicitMimeType,
        fileName,
        uri
      );

    const mimeType =
      normalizeMimeType(
        explicitMimeType,
        format
      );

    const fileSizeBytes =
      this.normalizeFileSizeBytes(
        input.fileSizeBytes,
        issues
      );

    const createdAt =
      normalizeNativeProcessingTimestamp(
        readFiniteNumber(
          input.createdAt
        ),
        timestamp
      );

    let sourceId =
      normalizeOptionalString(
        input.sourceId,
        180
      );

    if (
      !sourceId
    ) {
      try {
        sourceId =
          normalizeOptionalString(
            this.options
              .identifierFactory
              .createSourceId(
                {
                  ...input,
                  uri,
                  fileName,
                  mimeType,
                  format,
                },
                timestamp
              ),
            180
          );
      } catch (error) {
        issues.push(
          this.createValidationIssue(
            'INVALID_INPUT',
            'source.sourceId',
            `Source identifier generation failed: ${getUnknownErrorMessage(
              error
            )}`,
            false,
            input.sourceId
          )
        );
      }

      this.updateDiagnostics({
        generatedSourceIdCount:
          this.diagnostics
            .generatedSourceIdCount +
        1,
      });
    }

    if (
      !sourceId
    ) {
      sourceId =
        `source-${timestamp}`;
    }

    this.updateDiagnostics({
      normalizedSourceCount:
        this.diagnostics
          .normalizedSourceCount +
      1,
    });

    return {
      uri,

      width,

      height,

      orientation,

      format,

      fileName,

      mimeType,

      fileSizeBytes,

      sourceId,

      createdAt,
    };
  }

  /* =======================================================
   * Wardrobe normalization
   * ===================================================== */

  private normalizeWardrobeType(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): 'male' | 'female' | null {
    if (
      value ===
        null ||
      value ===
        undefined ||
      value ===
        ''
    ) {
      return null;
    }

    if (
      value ===
        'male' ||
      value ===
        'female'
    ) {
      return value;
    }

    issues.push(
      this.createValidationIssue(
        'INVALID_INPUT',
        'wardrobe.wardrobeType',
        'Wardrobe type must be male, female, or null.',
        false,
        value
      )
    );

    return null;
  }

  private normalizeWardrobe(
    input:
      NativeProcessingPayloadWardrobeInput | null | undefined,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): NativeProcessingWardrobeContext {
    if (
      input !==
        null &&
      input !==
        undefined &&
      !isRecord(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_INPUT',
          'wardrobe',
          'Wardrobe context must be an object when provided.',
          false,
          input
        )
      );
    }

    const safeInput =
      isRecord(
        input
      )
        ? input as
            NativeProcessingPayloadWardrobeInput
        : {};

    if (
      this.containsUnsafeValue(
        safeInput
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          'wardrobe',
          'Wardrobe context contains a non-serializable value.',
          true,
          safeInput
        )
      );
    }

    const wardrobe:
      NativeProcessingWardrobeContext = {
      wardrobeType:
        this.normalizeWardrobeType(
          safeInput
            .wardrobeType,
          issues
        ),

      category:
        normalizeOptionalString(
          safeInput.category,
          128
        ),

      subcategory:
        normalizeOptionalString(
          safeInput.subcategory,
          128
        ),

      itemName:
        normalizeOptionalString(
          safeInput.itemName,
          256
        ),

      color:
        normalizeOptionalString(
          safeInput.color,
          128
        ),

      style:
        normalizeOptionalString(
          safeInput.style,
          128
        ),

      season:
        normalizeOptionalString(
          safeInput.season,
          128
        ),

      occasion:
        normalizeOptionalString(
          safeInput.occasion,
          128
        ),

      isFavorite:
        readBoolean(
          safeInput.isFavorite,
          false
        ),
    };

    this.updateDiagnostics({
      normalizedWardrobeCount:
        this.diagnostics
          .normalizedWardrobeCount +
      1,
    });

    return wardrobe;
  }

  /* =======================================================
   * Output directory normalization
   * ===================================================== */

  private normalizeOutputDirectoryUri(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): string | null {
    const normalized =
      normalizeOptionalString(
        value,
        4096
      );

    if (
      !normalized
    ) {
      return this.options
        .defaultOutputDirectoryUri;
    }

    if (
      normalized.startsWith(
        'data:'
      ) ||
      normalized.startsWith(
        'blob:'
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_OUTPUT_DIRECTORY',
          'options.outputDirectoryUri',
          'Output directory cannot use data or blob URI schemes.',
          true,
          value
        )
      );

      return this.options
        .defaultOutputDirectoryUri;
    }

    return normalized;
  }

  /* =======================================================
   * Output file-name normalization
   * ===================================================== */

  private normalizeOutputFileName(
    value:
      unknown,
    input:
      NativeProcessingPayloadFactoryInput,
    timestamp:
      ProcessingTimestamp,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): string {
    const explicitName =
      normalizeOptionalString(
        value,
        this.options
          .maximumFileNameLength
      );

    let candidate =
      explicitName;

    if (
      !candidate
    ) {
      try {
        candidate =
          this.options
            .identifierFactory
            .createOutputFileName(
              input,
              timestamp
            );

        this.updateDiagnostics({
          generatedOutputFileNameCount:
            this.diagnostics
              .generatedOutputFileNameCount +
          1,
        });
      } catch (error) {
        issues.push(
          this.createValidationIssue(
            'INVALID_OUTPUT_FILE_NAME',
            'options.outputFileName',
            `Output file-name generation failed: ${getUnknownErrorMessage(
              error
            )}`,
            false,
            value
          )
        );
      }
    }

    const normalizedCandidate =
      normalizeOptionalString(
        candidate,
        this.options
          .maximumFileNameLength
      );

    if (
      !normalizedCandidate
    ) {
      return ensurePngExtension(
        `${DEFAULT_NATIVE_PROCESSING_OUTPUT_FILE_PREFIX}-${timestamp}`
      );
    }

    const safeName =
      sanitizeFileNameSegment(
        normalizedCandidate,
        `${DEFAULT_NATIVE_PROCESSING_OUTPUT_FILE_PREFIX}-${timestamp}`
      );

    const pngFileName =
      ensurePngExtension(
        safeName
      );

    return truncateString(
      pngFileName,
      this.options
        .maximumFileNameLength
    );
  }

  /* =======================================================
   * Output-quality normalization
   * ===================================================== */

  private normalizeOutputQuality(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): number {
    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return this.options
        .defaultOutputQuality;
    }

    const numberValue =
      readFiniteNumber(
        value
      );

    if (
      numberValue ===
        null
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_OUTPUT_QUALITY',
          'options.outputQuality',
          'Output quality must be a finite number between 0 and 1.',
          false,
          value
        )
      );

      return this.options
        .defaultOutputQuality;
    }

    if (
      numberValue <
        DEFAULT_NATIVE_PROCESSING_MINIMUM_OUTPUT_QUALITY ||
      numberValue >
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_OUTPUT_QUALITY
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_OUTPUT_QUALITY',
          'options.outputQuality',
          'Output quality was clamped to the supported range from 0 to 1.',
          false,
          value
        )
      );
    }

    return clampNumber(
      numberValue,
      DEFAULT_NATIVE_PROCESSING_MINIMUM_OUTPUT_QUALITY,
      DEFAULT_NATIVE_PROCESSING_MAXIMUM_OUTPUT_QUALITY
    );
  }

  /* =======================================================
   * Attempt normalization
   * ===================================================== */

  private normalizeMaximumAttempts(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): number {
    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return this.options
        .defaultMaximumAttempts;
    }

    const numberValue =
      readFiniteNumber(
        value
      );

    if (
      numberValue ===
        null ||
      numberValue <
        1
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_MAXIMUM_ATTEMPTS',
          'options.maximumAttempts',
          'Maximum attempts must be an integer greater than or equal to 1.',
          false,
          value
        )
      );

      return this.options
        .defaultMaximumAttempts;
    }

    return Math.max(
      1,
      Math.floor(
        numberValue
      )
    );
  }

  private normalizeCurrentAttempt(
    value:
      unknown,
    maximumAttempts:
      number,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): number {
    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return DEFAULT_NATIVE_PROCESSING_CURRENT_ATTEMPT;
    }

    const numberValue =
      readFiniteNumber(
        value
      );

    if (
      numberValue ===
        null ||
      numberValue <
        0
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_CURRENT_ATTEMPT',
          'options.currentAttempt',
          'Current attempt must be a non-negative integer.',
          false,
          value
        )
      );

      return DEFAULT_NATIVE_PROCESSING_CURRENT_ATTEMPT;
    }

    const normalized =
      Math.floor(
        numberValue
      );

    if (
      normalized >
        maximumAttempts
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_CURRENT_ATTEMPT',
          'options.currentAttempt',
          'Current attempt exceeds maximum attempts and was clamped.',
          false,
          value
        )
      );

      return maximumAttempts;
    }

    return normalized;
  }

  /* =======================================================
   * Processing options normalization
   * ===================================================== */

  private normalizeProcessingOptions(
    input:
      NativeProcessingPayloadOptionsInput | null | undefined,
    factoryInput:
      NativeProcessingPayloadFactoryInput,
    timestamp:
      ProcessingTimestamp,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): NativeProcessingOptions {
    if (
      input !==
        null &&
      input !==
        undefined &&
      !isRecord(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_INPUT',
          'options',
          'Native processing options must be an object when provided.',
          false,
          input
        )
      );
    }

    const safeInput =
      isRecord(
        input
      )
        ? input as
            NativeProcessingPayloadOptionsInput
        : {};

    if (
      this.containsUnsafeValue(
        safeInput
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          'options',
          'Native processing options contain a non-serializable value.',
          true,
          safeInput
        )
      );
    }

    const maximumAttempts =
      this.normalizeMaximumAttempts(
        safeInput.maximumAttempts,
        issues
      );

    const currentAttempt =
      this.normalizeCurrentAttempt(
        safeInput.currentAttempt,
        maximumAttempts,
        issues
      );

    const options:
      NativeProcessingOptions = {
      outputDirectoryUri:
        this.normalizeOutputDirectoryUri(
          safeInput
            .outputDirectoryUri,
          issues
        ),

      outputFileName:
        this.normalizeOutputFileName(
          safeInput
            .outputFileName,
          factoryInput,
          timestamp,
          issues
        ),

      outputFormat:
        DEFAULT_NATIVE_PROCESSING_OUTPUT_FORMAT,

      outputQuality:
        this.normalizeOutputQuality(
          safeInput
            .outputQuality,
          issues
        ),

      maximumAttempts,

      currentAttempt,

      collectDiagnostics:
        readBoolean(
          safeInput
            .collectDiagnostics,
          this.options
            .defaultCollectDiagnostics
        ),

      preserveSourceFile:
        readBoolean(
          safeInput
            .preserveSourceFile,
          this.options
            .defaultPreserveSourceFile
        ),

      replaceExistingOutput:
        readBoolean(
          safeInput
            .replaceExistingOutput,
          this.options
            .defaultReplaceExistingOutput
        ),

      allowForegroundFallback:
        readBoolean(
          safeInput
            .allowForegroundFallback,
          this.options
            .defaultAllowForegroundFallback
        ),
    };

    this.updateDiagnostics({
      normalizedOptionsCount:
        this.diagnostics
          .normalizedOptionsCount +
      1,
    });

    return options;
  }

  /* =======================================================
   * Metadata-key normalization
   * ===================================================== */

  private normalizeMetadataKey(
    value:
      string
  ): string | null {
    const normalized =
      removeControlCharacters(
        value
      )
        .trim();

    if (
      normalized.length ===
        0
    ) {
      return null;
    }

    return truncateString(
      normalized,
      this.options
        .maximumMetadataKeyLength
    );
  }

  /* =======================================================
   * Metadata-value normalization
   * ===================================================== */

  private normalizeMetadataValue(
    value:
      unknown
  ): NativeProcessingMetadataValue | undefined {
    if (
      value ===
        null
    ) {
      return null;
    }

    if (
      typeof value ===
        'boolean'
    ) {
      return value;
    }

    if (
      typeof value ===
        'number'
    ) {
      return Number.isFinite(
        value
      )
        ? value
        : undefined;
    }

    if (
      typeof value ===
        'string'
    ) {
      return truncateString(
        removeControlCharacters(
          value
        ),
        this.options
          .maximumMetadataStringLength
      );
    }

    return undefined;
  }

  /* =======================================================
   * Metadata sanitization
   * ===================================================== */

  private sanitizeMetadata(
    input:
      Readonly<
        Record<
          string,
          unknown
        >
      > | null | undefined,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): NativeProcessingMetadata {
    if (
      input ===
        null ||
      input ===
        undefined
    ) {
      return {};
    }

    if (
      !isRecord(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_METADATA',
          'metadata',
          'Native processing metadata must be a plain object.',
          false,
          input
        )
      );

      return {};
    }

    if (
      this.isUnsafeObject(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          'metadata',
          'Native processing metadata must be a plain serializable object.',
          true,
          input
        )
      );

      return {};
    }

    const output:
      Record<
        string,
        NativeProcessingMetadataValue
      > = {};

    let acceptedCount =
      0;

    let rejectedCount =
      0;

    for (
      const [
        rawKey,
        rawValue,
      ] of Object.entries(
        input
      )
    ) {
      if (
        acceptedCount >=
          this.options
            .maximumMetadataEntries
      ) {
        rejectedCount +=
          1;

        continue;
      }

      const key =
        this.normalizeMetadataKey(
          rawKey
        );

      if (
        !key
      ) {
        rejectedCount +=
          1;

        continue;
      }

      const value =
        this.normalizeMetadataValue(
          rawValue
        );

      if (
        value ===
          undefined
      ) {
        rejectedCount +=
          1;

        issues.push(
          this.createValidationIssue(
            this.isUnsafeObject(
              rawValue
            )
              ? 'UNSAFE_VALUE'
              : 'INVALID_METADATA',
            `metadata.${key}`,
            'Metadata values must be string, finite number, boolean, or null.',
            false,
            rawValue
          )
        );

        continue;
      }

      output[key] =
        value;

      acceptedCount +=
        1;
    }

    if (
      rejectedCount >
        0
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_METADATA',
          'metadata',
          `${rejectedCount} metadata entr${
            rejectedCount ===
              1
              ? 'y was'
              : 'ies were'
          } rejected or omitted.`,
          false,
          input
        )
      );
    }

    this.updateDiagnostics({
      sanitizedMetadataCount:
        this.diagnostics
          .sanitizedMetadataCount +
      1,

      rejectedMetadataEntryCount:
        this.diagnostics
          .rejectedMetadataEntryCount +
      rejectedCount,
    });

    return output;
  }

  /* =======================================================
   * Priority normalization
   * ===================================================== */

  private normalizePriority(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): number {
    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return DEFAULT_NATIVE_PROCESSING_PRIORITY;
    }

    const numberValue =
      readFiniteNumber(
        value
      );

    if (
      numberValue ===
        null
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_INPUT',
          'priority',
          'Native processing priority must be a finite number.',
          false,
          value
        )
      );

      return DEFAULT_NATIVE_PROCESSING_PRIORITY;
    }

    const normalized =
      Math.floor(
        numberValue
      );

    if (
      normalized <
        DEFAULT_NATIVE_PROCESSING_MINIMUM_PRIORITY ||
      normalized >
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_PRIORITY
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_INPUT',
          'priority',
          'Native processing priority was clamped to the supported range.',
          false,
          value
        )
      );
    }

    return clampNumber(
      normalized,
      DEFAULT_NATIVE_PROCESSING_MINIMUM_PRIORITY,
      DEFAULT_NATIVE_PROCESSING_MAXIMUM_PRIORITY
    );
  }

  /* =======================================================
   * Platform validation
   * ===================================================== */

  private normalizeAndValidatePlatform(
    value:
      unknown,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): ProcessingPlatform {
    const currentPlatform =
      resolveCurrentProcessingPlatform();

    const platform =
      normalizeProcessingPlatform(
        value,
        currentPlatform
      );

    if (
      platform !==
        'ios' &&
      platform !==
        'android'
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_PLATFORM',
          'platform',
          'Native processing requires an iOS or Android platform.',
          true,
          value
        )
      );

      return platform;
    }

    if (
      this.options
        .strictPlatformMatching &&
      currentPlatform !==
        'unknown' &&
      platform !==
        currentPlatform
    ) {
      issues.push(
        this.createValidationIssue(
          'PLATFORM_MISMATCH',
          'platform',
          `Payload platform "${platform}" does not match the current runtime platform "${currentPlatform}".`,
          true,
          value
        )
      );
    }

    return platform;
  }

  /*
   * Part 3/4 continues inside this class with:
   *
   * - validateFactoryInput()
   * - validatePayload()
   * - create()
   * - createPayload()
   * - createFromPartialInput()
   * - safe creation result
   * - payload cloning
   * - serialization verification
   */
  /* =======================================================
   * Factory-input validation
   * ===================================================== */

  private validateFactoryInput(
    input:
      NativeProcessingPayloadFactoryInput
  ): NativeProcessingPayloadValidationResult {
    const issues:
      NativeProcessingPayloadValidationIssue[] =
      [];

    this.updateDiagnostics({
      validationCount:
        this.diagnostics
          .validationCount +
      1,
    });

    if (
      !isRecord(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_INPUT',
          null,
          'Native processing factory input must be a plain object.',
          true,
          input
        )
      );

      return this.createValidationResult(
        issues
      );
    }

    if (
      this.containsUnsafeValue(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          null,
          'Native processing factory input contains unsupported or non-serializable values.',
          true,
          input
        )
      );
    }

    const identifierFields:
      readonly {
        field:
          keyof Pick<
            NativeProcessingPayloadFactoryInput,
            | 'jobId'
            | 'queueId'
            | 'batchId'
            | 'requestId'
            | 'wardrobeItemId'
          >;

        code:
          NativeProcessingPayloadValidationIssueCode;
      }[] =
      [
        {
          field:
            'jobId',

          code:
            'MISSING_JOB_ID',
        },
        {
          field:
            'queueId',

          code:
            'MISSING_QUEUE_ID',
        },
        {
          field:
            'batchId',

          code:
            'MISSING_BATCH_ID',
        },
        {
          field:
            'requestId',

          code:
            'MISSING_REQUEST_ID',
        },
        {
          field:
            'wardrobeItemId',

          code:
            'MISSING_WARDROBE_ITEM_ID',
        },
      ];

    for (
      const {
        field,
        code,
      } of identifierFields
    ) {
      const value =
        input[field];

      if (
        typeof value !==
          'string' ||
        value.trim().length ===
          0
      ) {
        issues.push(
          this.createValidationIssue(
            code,
            field,
            `${field} must be a non-empty string.`,
            true,
            value
          )
        );
      }
    }

    if (
      !isRecord(
        input.source
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_SOURCE',
          'source',
          'Native processing factory input must contain a source object.',
          true,
          input.source
        )
      );
    } else if (
      typeof input.source
        .uri !==
        'string' ||
      input.source.uri
        .trim()
        .length ===
        0
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_URI',
          'source.uri',
          'Native processing source URI must be a non-empty string.',
          true,
          input.source.uri
        )
      );
    }

    if (
      input.platform !==
        undefined &&
      input.platform !==
        null &&
      input.platform !==
        'ios' &&
      input.platform !==
        'android' &&
      input.platform !==
        'unknown'
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_PLATFORM',
          'platform',
          'Platform must be ios, android, unknown, or null.',
          true,
          input.platform
        )
      );
    }

    if (
      input.metadata !==
        undefined &&
      input.metadata !==
        null &&
      !isRecord(
        input.metadata
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_METADATA',
          'metadata',
          'Metadata must be a plain object when provided.',
          false,
          input.metadata
        )
      );
    }

    return this.createValidationResult(
      issues
    );
  }

  /* =======================================================
   * Payload validation
   * ===================================================== */

  public validatePayload(
    payload:
      unknown
  ): NativeProcessingPayloadValidationResult {
    const issues:
      NativeProcessingPayloadValidationIssue[] =
      [];

    this.updateDiagnostics({
      validationCount:
        this.diagnostics
          .validationCount +
      1,
    });

    if (
      !isRecord(
        payload
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_INPUT',
          null,
          'Native processing payload must be a plain object.',
          true,
          payload
        )
      );

      return this.createValidationResult(
        issues
      );
    }

    if (
      this.containsUnsafeValue(
        payload
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          null,
          'Native processing payload contains unsupported or non-serializable values.',
          true,
          payload
        )
      );
    }

    if (
      payload.contractVersion !==
        NATIVE_PROCESSING_CONTRACT_VERSION
    ) {
      issues.push(
        this.createValidationIssue(
          'PAYLOAD_VALIDATION_FAILED',
          'contractVersion',
          `Native processing payload must use contract version ${NATIVE_PROCESSING_CONTRACT_VERSION}.`,
          true,
          payload.contractVersion
        )
      );
    }

    const payloadIdentifierFields =
      [
        {
          field:
            'jobId',

          code:
            'MISSING_JOB_ID',
        },
        {
          field:
            'queueId',

          code:
            'MISSING_QUEUE_ID',
        },
        {
          field:
            'batchId',

          code:
            'MISSING_BATCH_ID',
        },
        {
          field:
            'requestId',

          code:
            'MISSING_REQUEST_ID',
        },
        {
          field:
            'wardrobeItemId',

          code:
            'MISSING_WARDROBE_ITEM_ID',
        },
      ] as const;

    for (
      const {
        field,
        code,
      } of payloadIdentifierFields
    ) {
      const value =
        payload[field];

      if (
        typeof value !==
          'string' ||
        value.trim().length ===
          0
      ) {
        issues.push(
          this.createValidationIssue(
            code,
            field,
            `${field} must be a non-empty string.`,
            true,
            value
          )
        );
      }
    }

    if (
      payload.platform !==
        'ios' &&
      payload.platform !==
        'android'
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_PLATFORM',
          'platform',
          'Native processing payload platform must be ios or android.',
          true,
          payload.platform
        )
      );
    }

    const currentPlatform =
      resolveCurrentProcessingPlatform();

    if (
      this.options
        .strictPlatformMatching &&
      currentPlatform !==
        'unknown' &&
      (
        payload.platform ===
          'ios' ||
        payload.platform ===
          'android'
      ) &&
      payload.platform !==
        currentPlatform
    ) {
      issues.push(
        this.createValidationIssue(
          'PLATFORM_MISMATCH',
          'platform',
          `Payload platform "${String(
            payload.platform
          )}" does not match runtime platform "${currentPlatform}".`,
          true,
          payload.platform
        )
      );
    }

    if (
      !isRecord(
        payload.source
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_SOURCE',
          'source',
          'Native processing payload must contain a source object.',
          true,
          payload.source
        )
      );
    } else {
      if (
        typeof payload.source
          .uri !==
          'string' ||
        payload.source.uri
          .trim()
          .length ===
          0
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_SOURCE_URI',
            'source.uri',
            'Native processing source URI must be a non-empty string.',
            true,
            payload.source.uri
          )
        );
      }

      if (
        payload.source.width !==
          null &&
        (
          typeof payload.source.width !==
            'number' ||
          !Number.isFinite(
            payload.source.width
          ) ||
          payload.source.width <=
            0
        )
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_SOURCE_DIMENSIONS',
            'source.width',
            'Source width must be null or a positive finite number.',
            false,
            payload.source.width
          )
        );
      }

      if (
        payload.source.height !==
          null &&
        (
          typeof payload.source.height !==
            'number' ||
          !Number.isFinite(
            payload.source.height
          ) ||
          payload.source.height <=
            0
        )
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_SOURCE_DIMENSIONS',
            'source.height',
            'Source height must be null or a positive finite number.',
            false,
            payload.source.height
          )
        );
      }

      if (
        payload.source.orientation !==
          null &&
        (
          typeof payload.source.orientation !==
            'number' ||
          !Number.isFinite(
            payload.source.orientation
          ) ||
          payload.source.orientation <
            1 ||
          payload.source.orientation >
            8
        )
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_SOURCE_ORIENTATION',
            'source.orientation',
            'Source orientation must be null or an integer from 1 to 8.',
            false,
            payload.source.orientation
          )
        );
      }
    }

    if (
      !isRecord(
        payload.options
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_INPUT',
          'options',
          'Native processing payload must contain processing options.',
          true,
          payload.options
        )
      );
    } else {
      if (
        payload.options
          .outputFormat !==
        'png'
      ) {
        issues.push(
          this.createValidationIssue(
            'PAYLOAD_VALIDATION_FAILED',
            'options.outputFormat',
            'Native processing output format must be png.',
            true,
            payload.options
              .outputFormat
          )
        );
      }

      if (
        typeof payload.options
          .outputFileName !==
          'string' ||
        payload.options
          .outputFileName
          .trim()
          .length ===
          0
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_OUTPUT_FILE_NAME',
            'options.outputFileName',
            'Native processing output file name must be a non-empty string.',
            true,
            payload.options
              .outputFileName
          )
        );
      }

      if (
        typeof payload.options
          .outputQuality !==
          'number' ||
        !Number.isFinite(
          payload.options
            .outputQuality
        ) ||
        payload.options
          .outputQuality <
          0 ||
        payload.options
          .outputQuality >
          1
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_OUTPUT_QUALITY',
            'options.outputQuality',
            'Native processing output quality must be between 0 and 1.',
            true,
            payload.options
              .outputQuality
          )
        );
      }

      if (
        typeof payload.options
          .maximumAttempts !==
          'number' ||
        !Number.isFinite(
          payload.options
            .maximumAttempts
        ) ||
        payload.options
          .maximumAttempts <
          1
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_MAXIMUM_ATTEMPTS',
            'options.maximumAttempts',
            'Maximum attempts must be a finite number greater than or equal to 1.',
            true,
            payload.options
              .maximumAttempts
          )
        );
      }

      if (
        typeof payload.options
          .currentAttempt !==
          'number' ||
        !Number.isFinite(
          payload.options
            .currentAttempt
        ) ||
        payload.options
          .currentAttempt <
          0
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_CURRENT_ATTEMPT',
            'options.currentAttempt',
            'Current attempt must be a non-negative finite number.',
            true,
            payload.options
              .currentAttempt
          )
        );
      }
    }

    if (
      !isRecord(
        payload.metadata
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_METADATA',
          'metadata',
          'Native processing payload metadata must be a plain object.',
          false,
          payload.metadata
        )
      );
    } else {
      let metadataEntryCount =
        0;

      for (
        const [
          key,
          value,
        ] of Object.entries(
          payload.metadata
        )
      ) {
        metadataEntryCount +=
          1;

        if (
          key.length >
            this.options
              .maximumMetadataKeyLength
        ) {
          issues.push(
            this.createValidationIssue(
              'INVALID_METADATA',
              `metadata.${key}`,
              'Metadata key exceeds the configured maximum length.',
              false,
              key
            )
          );
        }

        if (
          value !==
            null &&
          typeof value !==
            'string' &&
          typeof value !==
            'number' &&
          typeof value !==
            'boolean'
        ) {
          issues.push(
            this.createValidationIssue(
              'INVALID_METADATA',
              `metadata.${key}`,
              'Metadata value must be string, finite number, boolean, or null.',
              false,
              value
            )
          );
        }

        if (
          typeof value ===
            'number' &&
          !Number.isFinite(
            value
          )
        ) {
          issues.push(
            this.createValidationIssue(
              'INVALID_METADATA',
              `metadata.${key}`,
              'Metadata numbers must be finite.',
              false,
              value
            )
          );
        }

        if (
          typeof value ===
            'string' &&
          value.length >
            this.options
              .maximumMetadataStringLength
        ) {
          issues.push(
            this.createValidationIssue(
              'INVALID_METADATA',
              `metadata.${key}`,
              'Metadata string exceeds the configured maximum length.',
              false,
              value
            )
          );
        }
      }

      if (
        metadataEntryCount >
          this.options
            .maximumMetadataEntries
      ) {
        issues.push(
          this.createValidationIssue(
            'INVALID_METADATA',
            'metadata',
            'Metadata contains more entries than the configured maximum.',
            false,
            metadataEntryCount
          )
        );
      }
    }

    if (
      typeof payload.createdAt !==
        'number' ||
      !Number.isFinite(
        payload.createdAt
      ) ||
      payload.createdAt <=
        0
    ) {
      issues.push(
        this.createValidationIssue(
          'PAYLOAD_VALIDATION_FAILED',
          'createdAt',
          'Native processing payload createdAt must be a positive timestamp.',
          true,
          payload.createdAt
        )
      );
    }

    if (
      !isNativeProcessingJobPayload(
        payload
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'PAYLOAD_VALIDATION_FAILED',
          null,
          'Payload does not satisfy NativeProcessingContracts validation.',
          true,
          payload
        )
      );
    }

    return this.createValidationResult(
      issues
    );
  }

  /* =======================================================
   * Payload cloning
   * ===================================================== */

  public clonePayload(
    payload:
      NativeProcessingJobPayload
  ): NativeProcessingJobPayload {
    return {
      ...payload,

      source: {
        ...payload.source,
      },

      wardrobe: {
        ...payload.wardrobe,
      },

      options: {
        ...payload.options,
      },

      metadata: {
        ...payload.metadata,
      },
    };
  }

  /* =======================================================
   * JSON serialization verification
   * ===================================================== */

  private verifyPayloadSerialization(
    payload:
      NativeProcessingJobPayload,
    issues:
      NativeProcessingPayloadValidationIssue[]
  ): void {
    let serialized:
      string;

    try {
      serialized =
        JSON.stringify(
          payload
        );
    } catch (error) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          null,
          `Native processing payload could not be serialized: ${getUnknownErrorMessage(
            error
          )}`,
          true,
          payload
        )
      );

      return;
    }

    if (
      typeof serialized !==
        'string' ||
      serialized.length ===
        0
    ) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          null,
          'Native processing payload produced an empty serialized value.',
          true,
          payload
        )
      );

      return;
    }

    try {
      const reparsed =
        JSON.parse(
          serialized
        );

      if (
        !isNativeProcessingJobPayload(
          reparsed
        )
      ) {
        issues.push(
          this.createValidationIssue(
            'PAYLOAD_VALIDATION_FAILED',
            null,
            'Serialized native processing payload could not be restored as a valid payload.',
            true,
            reparsed
          )
        );
      }
    } catch (error) {
      issues.push(
        this.createValidationIssue(
          'UNSAFE_VALUE',
          null,
          `Serialized native processing payload could not be parsed: ${getUnknownErrorMessage(
            error
          )}`,
          true,
          serialized
        )
      );
    }
  }

  /* =======================================================
   * Create factory result
   * ===================================================== */

  public create(
    input:
      NativeProcessingPayloadFactoryInput
  ): NativeProcessingPayloadFactoryResult {
    const operationStartedAt =
      this.now();

    this.updateDiagnostics({
      createCount:
        this.diagnostics
          .createCount +
      1,

      lastError:
        null,
    });

    try {
      const initialValidation =
        this.validateFactoryInput(
          input
        );

      if (
        !initialValidation
          .valid
      ) {
        this.throwValidationError(
          initialValidation
            .issues
        );
      }

      const issues:
        NativeProcessingPayloadValidationIssue[] =
        [
          ...initialValidation
            .warnings,
        ];

      const jobId =
        normalizeIdentifier(
          input.jobId,
          'jobId'
        ) as ProcessingJobId;

      const queueId =
        normalizeIdentifier(
          input.queueId,
          'queueId'
        ) as ProcessingQueueId;

      const batchId =
        normalizeIdentifier(
          input.batchId,
          'batchId'
        ) as ProcessingBatchId;

      const requestId =
        normalizeIdentifier(
          input.requestId,
          'requestId'
        ) as ProcessingRequestId;

      const wardrobeItemId =
        normalizeIdentifier(
          input.wardrobeItemId,
          'wardrobeItemId'
        ) as ProcessingWardrobeItemId;

      const createdAt =
        normalizeNativeProcessingTimestamp(
          readFiniteNumber(
            input.createdAt
          ),
          operationStartedAt
        );

      const platform =
        this.normalizeAndValidatePlatform(
          input.platform,
          issues
        );

      const normalizedFactoryInput:
        NativeProcessingPayloadFactoryInput = {
        ...input,

        jobId,

        queueId,

        batchId,

        requestId,

        wardrobeItemId,

        platform,

        createdAt,
      };

      const source =
        this.normalizeSource(
          input.source,
          createdAt,
          issues
        );

      const wardrobe =
        this.normalizeWardrobe(
          input.wardrobe,
          issues
        );

      const options =
        this.normalizeProcessingOptions(
          input.options,
          normalizedFactoryInput,
          createdAt,
          issues
        );

      const metadata =
        this.sanitizeMetadata(
          input.metadata,
          issues
        );

      const priority =
        this.normalizePriority(
          input.priority,
          issues
        );

      const payload:
        NativeProcessingJobPayload = {
        contractVersion:
          NATIVE_PROCESSING_CONTRACT_VERSION,

        jobId,

        queueId,

        batchId,

        requestId,

        wardrobeItemId,

        platform,

        priority,

        source,

        wardrobe,

        options,

        createdAt,

        metadata,
      };

      this.verifyPayloadSerialization(
        payload,
        issues
      );

      const finalValidation =
        this.validatePayload(
          payload
        );

      const combinedIssues =
        [
          ...issues,
          ...finalValidation
            .issues,
        ];

      const deduplicatedIssues =
        this.deduplicateValidationIssues(
          combinedIssues
        );

      const validation =
        this.createValidationResult(
          deduplicatedIssues
        );

      if (
        !validation.valid
      ) {
        this.throwValidationError(
          validation.issues
        );
      }

      this.updateDiagnostics({
        successfulCreateCount:
          this.diagnostics
            .successfulCreateCount +
        1,

        lastCreatedAt:
          createdAt,

        lastError:
          null,
      });

      return {
        payload:
          this.clonePayload(
            payload
          ),

        validation,

        createdAt,
      };
    } catch (error) {
      const failedAt =
        this.now();

      const message =
        getUnknownErrorMessage(
          error
        );

      this.updateDiagnostics({
        failedCreateCount:
          this.diagnostics
            .failedCreateCount +
        1,

        lastFailedAt:
          failedAt,

        lastError:
          message,
      });

      if (
        this.options
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NATIVE PROCESSING PAYLOAD FACTORY ERROR:',
          error
        );
      }

      throw error;
    }
  }

  /* =======================================================
   * Create payload only
   * ===================================================== */

  public createPayload(
    input:
      NativeProcessingPayloadFactoryInput
  ): NativeProcessingJobPayload {
    return this.create(
      input
    ).payload;
  }

  /* =======================================================
   * Create from partial input
   * ===================================================== */

  public createFromPartialInput(
    input:
      PartialNativeProcessingPayloadFactoryInput
  ): NativeProcessingPayloadFactoryResult {
    const issues:
      NativeProcessingPayloadValidationIssue[] =
      [];

    if (
      !isRecord(
        input
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_INPUT',
          null,
          'Partial native processing factory input must be a plain object.',
          true,
          input
        )
      );

      this.throwValidationError(
        issues
      );
    }

    const source =
      input.source;

    if (
      !isRecord(
        source
      )
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_SOURCE',
          'source',
          'Partial native processing factory input must contain a source object.',
          true,
          source
        )
      );
    }

    const jobId =
      readString(
        input.jobId
      );

    const queueId =
      readString(
        input.queueId
      );

    const batchId =
      readString(
        input.batchId
      );

    const requestId =
      readString(
        input.requestId
      );

    const wardrobeItemId =
      readString(
        input.wardrobeItemId
      );

    if (
      !jobId
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_JOB_ID',
          'jobId',
          'Partial input is missing jobId.',
          true,
          input.jobId
        )
      );
    }

    if (
      !queueId
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_QUEUE_ID',
          'queueId',
          'Partial input is missing queueId.',
          true,
          input.queueId
        )
      );
    }

    if (
      !batchId
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_BATCH_ID',
          'batchId',
          'Partial input is missing batchId.',
          true,
          input.batchId
        )
      );
    }

    if (
      !requestId
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_REQUEST_ID',
          'requestId',
          'Partial input is missing requestId.',
          true,
          input.requestId
        )
      );
    }

    if (
      !wardrobeItemId
    ) {
      issues.push(
        this.createValidationIssue(
          'MISSING_WARDROBE_ITEM_ID',
          'wardrobeItemId',
          'Partial input is missing wardrobeItemId.',
          true,
          input.wardrobeItemId
        )
      );
    }

    const sourceUri =
      isRecord(
        source
      )
        ? readString(
            source.uri
          )
        : null;

    if (
      !sourceUri
    ) {
      issues.push(
        this.createValidationIssue(
          'INVALID_SOURCE_URI',
          'source.uri',
          'Partial input is missing a valid source URI.',
          true,
          isRecord(
            source
          )
            ? source.uri
            : null
        )
      );
    }

    if (
      issues.some(
        issue =>
          issue.fatal
      )
    ) {
      this.throwValidationError(
        issues
      );
    }

    const completeInput:
      NativeProcessingPayloadFactoryInput = {
      jobId:
        jobId as ProcessingJobId,

      queueId:
        queueId as ProcessingQueueId,

      batchId:
        batchId as ProcessingBatchId,

      requestId:
        requestId as ProcessingRequestId,

      wardrobeItemId:
        wardrobeItemId as ProcessingWardrobeItemId,

      platform:
        input.platform ??
        null,

      priority:
        input.priority ??
        null,

      source: {
        ...(source as
          Partial<
            NativeProcessingPayloadSourceInput
          >),

        uri:
          sourceUri as string,
      },

      wardrobe:
        input.wardrobe ??
        null,

      options:
        input.options ??
        null,

      createdAt:
        input.createdAt ??
        null,

      metadata:
        input.metadata ??
        null,
    };

    return this.create(
      completeInput
    );
  }

  /* =======================================================
   * Safe creation
   * ===================================================== */

  public tryCreate(
    input:
      NativeProcessingPayloadFactoryInput
  ):
    | {
        success:
          true;

        result:
          NativeProcessingPayloadFactoryResult;

        error:
          null;
      }
    | {
        success:
          false;

        result:
          null;

        error:
          NativeProcessingPayloadFactoryError;
      } {
    try {
      return {
        success:
          true,

        result:
          this.create(
            input
          ),

        error:
          null,
      };
    } catch (error) {
      if (
        error instanceof
          NativeProcessingPayloadFactoryError
      ) {
        return {
          success:
            false,

          result:
            null,

          error,
        };
      }

      return {
        success:
          false,

        result:
          null,

        error:
          new NativeProcessingPayloadFactoryError(
            'PAYLOAD_VALIDATION_FAILED',
            getUnknownErrorMessage(
              error
            )
          ),
      };
    }
  }

  /* =======================================================
   * Validation issue deduplication
   * ===================================================== */

  private deduplicateValidationIssues(
    issues:
      readonly NativeProcessingPayloadValidationIssue[]
  ): NativeProcessingPayloadValidationIssue[] {
    const output:
      NativeProcessingPayloadValidationIssue[] =
      [];

    const seen =
      new Set<
        string
      >();

    for (
      const issue of
      issues
    ) {
      const identity =
        [
          issue.code,
          issue.field ??
            '',
          issue.message,
          issue.fatal
            ? 'fatal'
            : 'warning',
        ].join(
          '|'
        );

      if (
        seen.has(
          identity
        )
      ) {
        continue;
      }

      seen.add(
        identity
      );

      output.push(
        issue
      );
    }

    return output;
  }

  /*
   * Part 4/4 continues with:
   *
   * - createFromQueueJob()
   * - Queue-like structural adapters
   * - exported singleton
   * - factory helper functions
   * - payload serialization helpers
   * - final class closing brace
   * - default export
   */
  /* =======================================================
   * Queue-like source contracts
   * ===================================================== */

  /**
   * عقد مرن لاستقبال Queue Job بدون ربط هذا الملف
   * مباشرة بنوع ProcessingJob الكامل.
   *
   * الهدف:
   *
   * - منع circular dependencies.
   * - السماح بتغير QueueTypes مستقبلًا.
   * - قراءة الحقول المطلوبة فقط.
   */
  public createFromQueueJob(
    job:
      unknown,
    overrides: {
      queueId?:
        ProcessingQueueId | string | null;

      batchId?:
        ProcessingBatchId | string | null;

      requestId?:
        ProcessingRequestId | string | null;

      wardrobeItemId?:
        ProcessingWardrobeItemId | string | null;

      platform?:
        ProcessingPlatform | null;

      priority?:
        number | null;

      source?:
        Partial<
          NativeProcessingPayloadSourceInput
        > | null;

      wardrobe?:
        NativeProcessingPayloadWardrobeInput | null;

      options?:
        NativeProcessingPayloadOptionsInput | null;

      metadata?:
        Readonly<
          Record<
            string,
            unknown
          >
        > | null;

      createdAt?:
        number | null;
    } = {}
  ): NativeProcessingPayloadFactoryResult {
    if (
      !isRecord(
        job
      )
    ) {
      throw new NativeProcessingPayloadFactoryError(
        'INVALID_INPUT',
        'Queue job must be a plain object.',
        [
          this.createValidationIssue(
            'INVALID_INPUT',
            'job',
            'Queue job must be a plain object.',
            true,
            job
          ),
        ]
      );
    }

    const sourceContainer =
      this.resolveQueueJobSourceContainer(
        job
      );

    const wardrobeContainer =
      this.resolveQueueJobWardrobeContainer(
        job
      );

    const optionsContainer =
      this.resolveQueueJobOptionsContainer(
        job
      );

    const metadataContainer =
      this.resolveQueueJobMetadataContainer(
        job
      );

      const timingContainer =
      isRecord(
        job.timing
      )
        ? job.timing
        : {};

    const jobId =
      this.readQueueString(
        job,
        [
          'jobId',
          'id',
        ]
      );

    const queueId =
      readString(
        overrides.queueId
      ) ??
      this.readQueueString(
        job,
        [
          'queueId',
        ]
      );

    const batchId =
      readString(
        overrides.batchId
      ) ??
      this.readQueueString(
        job,
        [
          'batchId',
        ]
      );

    const requestId =
      readString(
        overrides.requestId
      ) ??
      this.readQueueString(
        job,
        [
          'requestId',
        ]
      );

    const wardrobeItemId =
      readString(
        overrides.wardrobeItemId
      ) ??
      this.readQueueString(
        job,
        [
          'wardrobeItemId',
          'itemId',
        ]
      );

    const sourceUri =
      normalizeOptionalString(
        overrides.source
          ?.uri,
        4096
      ) ??
      this.readQueueString(
        sourceContainer,
        [
          'uri',
          'sourceUri',
          'imageUri',
          'inputUri',
          'originalUri',
          'croppedUri',
        ]
      ) ??
      this.readQueueString(
        job,
        [
          'sourceUri',
          'imageUri',
          'inputUri',
          'originalUri',
          'uri',
        ]
      );

    const partialInput:
      PartialNativeProcessingPayloadFactoryInput = {
      jobId:
        jobId as
          ProcessingJobId | undefined,

      queueId:
        queueId as
          ProcessingQueueId | undefined,

      batchId:
        batchId as
          ProcessingBatchId | undefined,

      requestId:
        requestId as
          ProcessingRequestId | undefined,

      wardrobeItemId:
        wardrobeItemId as
          ProcessingWardrobeItemId | undefined,

      platform:
        overrides.platform ??
        this.readQueuePlatform(
          job
        ),

      priority:
        overrides.priority ??
        this.readQueueNumber(
          job,
          [
            'priority',
          ]
        ),

      source: {
        uri:
          sourceUri ?? undefined,

        width:
          overrides.source
            ?.width ??
          this.readQueueNumber(
            sourceContainer,
            [
              'width',
              'sourceWidth',
              'imageWidth',
              'photoWidth',
            ]
          ) ??
          this.readQueueNumber(
            job,
            [
              'sourceWidth',
              'imageWidth',
              'width',
            ]
          ),

        height:
          overrides.source
            ?.height ??
          this.readQueueNumber(
            sourceContainer,
            [
              'height',
              'sourceHeight',
              'imageHeight',
              'photoHeight',
            ]
          ) ??
          this.readQueueNumber(
            job,
            [
              'sourceHeight',
              'imageHeight',
              'height',
            ]
          ),

        orientation:
          overrides.source
            ?.orientation ??
          this.readQueueNumber(
            sourceContainer,
            [
              'orientation',
              'exifOrientation',
            ]
          ) ??
          this.readQueueNumber(
            job,
            [
              'orientation',
              'exifOrientation',
            ]
          ),

        format:
          overrides.source
            ?.format ??
          this.readQueueString(
            sourceContainer,
            [
              'format',
              'extension',
            ]
          ),

        fileName:
          overrides.source
            ?.fileName ??
          this.readQueueString(
            sourceContainer,
            [
              'fileName',
              'filename',
              'name',
            ]
          ),

        mimeType:
          overrides.source
            ?.mimeType ??
          this.readQueueString(
            sourceContainer,
            [
              'mimeType',
              'mime',
              'contentType',
            ]
          ),

        fileSizeBytes:
          overrides.source
            ?.fileSizeBytes ??
          this.readQueueNumber(
            sourceContainer,
            [
              'fileSizeBytes',
              'sizeBytes',
              'fileSize',
            ]
          ),

        sourceId:
          overrides.source
            ?.sourceId ??
          this.readQueueString(
            sourceContainer,
            [
              'sourceId',
              'assetId',
              'captureId',
            ]
          ),

        createdAt:
          overrides.source
            ?.createdAt ??
          this.readQueueNumber(
            sourceContainer,
            [
              'createdAt',
              'capturedAt',
              'timestamp',
            ]
          ),
      },

      wardrobe:
        overrides.wardrobe ??
        this.createWardrobeInputFromQueueRecord(
          wardrobeContainer,
          job
        ),

      options:
        overrides.options ??
        this.createOptionsInputFromQueueRecord(
          optionsContainer,
          job
        ),

      createdAt:
        overrides.createdAt ??
        this.readQueueNumber(
          timingContainer,
          [
            'createdAt',
            'enqueuedAt',
            'queuedAt',
            'timestamp',
          ]
        ) ??
        this.readQueueNumber(
          job,
          [
            'createdAt',
            'enqueuedAt',
            'queuedAt',
            'timestamp',
          ]
        ),

      metadata:
        overrides.metadata ??
        metadataContainer,
    };

    return this.createFromPartialInput(
      partialInput
    );
  }

  /* =======================================================
   * Queue record resolution
   * ===================================================== */

  private resolveQueueJobSourceContainer(
    job:
      Record<
        string,
        unknown
      >
  ): Record<
    string,
    unknown
  > {
    const candidates =
      [
        job.source,
        job.imageSource,
        job.input,
        job.image,
        job.capture,
        job.payload,
      ];

    for (
      const candidate of
      candidates
    ) {
      if (
        isRecord(
          candidate
        )
      ) {
        return candidate;
      }
    }

    return job;
  }

  private resolveQueueJobWardrobeContainer(
    job:
      Record<
        string,
        unknown
      >
  ): Record<
    string,
    unknown
  > {
    const candidates =
      [
        job.wardrobe,
        job.wardrobeContext,
        job.item,
        job.itemMetadata,
        job.metadata,
      ];

    for (
      const candidate of
      candidates
    ) {
      if (
        isRecord(
          candidate
        )
      ) {
        return candidate;
      }
    }

    return {};
  }

  private resolveQueueJobOptionsContainer(
    job:
      Record<
        string,
        unknown
      >
  ): Record<
    string,
    unknown
  > {
    const candidates =
      [
        job.options,
        job.processingOptions,
        job.nativeOptions,
        job.configuration,
        job.config,
      ];

    for (
      const candidate of
      candidates
    ) {
      if (
        isRecord(
          candidate
        )
      ) {
        return candidate;
      }
    }

    return {};
  }

  private resolveQueueJobMetadataContainer(
    job:
      Record<
        string,
        unknown
      >
  ): Readonly<
    Record<
      string,
      unknown
    >
  > | null {
    const candidates =
      [
        job.nativeMetadata,
        job.metadata,
        job.diagnosticsMetadata,
      ];

    for (
      const candidate of
      candidates
    ) {
      if (
        isRecord(
          candidate
        )
      ) {
        return candidate;
      }
    }

    return null;
  }

  /* =======================================================
   * Queue primitive readers
   * ===================================================== */

  private readQueueString(
    record:
      Record<
        string,
        unknown
      >,
    keys:
      readonly string[]
  ): string | null {
    for (
      const key of
      keys
    ) {
      const value =
        readString(
          record[key]
        );

      if (
        value
      ) {
        return value;
      }
    }

    return null;
  }

  private readQueueNumber(
    record:
      Record<
        string,
        unknown
      >,
    keys:
      readonly string[]
  ): number | null {
    for (
      const key of
      keys
    ) {
      const value =
        readFiniteNumber(
          record[key]
        );

      if (
        value !==
          null
      ) {
        return value;
      }
    }

    return null;
  }

  private readQueueBoolean(
    record:
      Record<
        string,
        unknown
      >,
    keys:
      readonly string[]
  ): boolean | null {
    for (
      const key of
      keys
    ) {
      const value =
        record[key];

      if (
        typeof value ===
          'boolean'
      ) {
        return value;
      }
    }

    return null;
  }

  private readQueuePlatform(
    record:
      Record<
        string,
        unknown
      >
  ): ProcessingPlatform | null {
    const value =
      this.readQueueString(
        record,
        [
          'platform',
          'processingPlatform',
          'targetPlatform',
        ]
      );

    if (
      value ===
        'ios' ||
      value ===
        'android' ||
      value ===
        'unknown'
    ) {
      return value;
    }

    return null;
  }

  /* =======================================================
   * Queue wardrobe adapter
   * ===================================================== */

  private createWardrobeInputFromQueueRecord(
    wardrobe:
      Record<
        string,
        unknown
      >,
    job:
      Record<
        string,
        unknown
      >
  ): NativeProcessingPayloadWardrobeInput {
    const wardrobeTypeValue =
      this.readQueueString(
        wardrobe,
        [
          'wardrobeType',
          'gender',
        ]
      ) ??
      this.readQueueString(
        job,
        [
          'wardrobeType',
          'gender',
        ]
      );

    const wardrobeType:
      'male' | 'female' | null =
      wardrobeTypeValue ===
        'male' ||
      wardrobeTypeValue ===
        'female'
        ? wardrobeTypeValue
        : null;

    return {
      wardrobeType,

      category:
        this.readQueueString(
          wardrobe,
          [
            'category',
            'itemCategory',
            'type',
          ]
        ) ??
        this.readQueueString(
          job,
          [
            'category',
            'itemCategory',
          ]
        ),

      subcategory:
        this.readQueueString(
          wardrobe,
          [
            'subcategory',
            'subCategory',
            'itemSubcategory',
            'itemSubCategory',
          ]
        ) ??
        this.readQueueString(
          job,
          [
            'subcategory',
            'subCategory',
          ]
        ),

      itemName:
        this.readQueueString(
          wardrobe,
          [
            'itemName',
            'name',
            'title',
          ]
        ) ??
        this.readQueueString(
          job,
          [
            'itemName',
            'name',
          ]
        ),

      color:
        this.readQueueString(
          wardrobe,
          [
            'color',
            'primaryColor',
          ]
        ) ??
        this.readQueueString(
          job,
          [
            'color',
          ]
        ),

      style:
        this.readQueueString(
          wardrobe,
          [
            'style',
            'fashionStyle',
          ]
        ) ??
        this.readQueueString(
          job,
          [
            'style',
          ]
        ),

      season:
        this.readQueueString(
          wardrobe,
          [
            'season',
          ]
        ) ??
        this.readQueueString(
          job,
          [
            'season',
          ]
        ),

      occasion:
        this.readQueueString(
          wardrobe,
          [
            'occasion',
          ]
        ) ??
        this.readQueueString(
          job,
          [
            'occasion',
          ]
        ),

      isFavorite:
        this.readQueueBoolean(
          wardrobe,
          [
            'isFavorite',
            'favorite',
          ]
        ) ??
        this.readQueueBoolean(
          job,
          [
            'isFavorite',
            'favorite',
          ]
        ) ??
        false,
    };
  }

  /* =======================================================
   * Queue processing-options adapter
   * ===================================================== */

private createOptionsInputFromQueueRecord(
    options:
      Record<
        string,
        unknown
      >,
    job:
      Record<
        string,
        unknown
      >
  ): NativeProcessingPayloadOptionsInput {
    const retry =
      isRecord(
        job.retry
      )
        ? job.retry
        : {};

    const retryPolicy =
      isRecord(
        job.retryPolicy
      )
        ? job.retryPolicy
        : {};

    const attempt =
      this.readQueueNumber(
        retry,
        [
          'attempt',
          'currentAttempt',
          'attemptCount',
        ]
      ) ??
      this.readQueueNumber(
        job,
        [
          'attempt',
          'currentAttempt',
          'attemptCount',
        ]
      );

    const maximumAttempts =
      this.readQueueNumber(
        retry,
        [
          'maximumAttempts',
          'maxAttempts',
        ]
      ) ??
      this.readQueueNumber(
        retryPolicy,
        [
          'maximumAttempts',
          'maxAttempts',
          'retryLimit',
        ]
      ) ??
      this.readQueueNumber(
        options,
        [
          'maximumAttempts',
          'maxAttempts',
          'retryLimit',
        ]
      ) ??
      this.readQueueNumber(
        job,
        [
          'maximumAttempts',
          'maxAttempts',
        ]
      );

    return {
      outputDirectoryUri:
        this.readQueueString(
          options,
          [
            'outputDirectoryUri',
            'outputDirectory',
            'destinationDirectoryUri',
          ]
        ),

      outputFileName:
        this.readQueueString(
          options,
          [
            'outputFileName',
            'fileName',
            'destinationFileName',
          ]
        ),

      outputQuality:
        this.readQueueNumber(
          options,
          [
            'outputQuality',
            'quality',
          ]
        ),

      maximumAttempts,

      currentAttempt:
        attempt,

      collectDiagnostics:
        this.readQueueBoolean(
          options,
          [
            'collectDiagnostics',
            'enableDiagnostics',
          ]
        ),

      preserveSourceFile:
        this.readQueueBoolean(
          options,
          [
            'preserveSourceFile',
            'keepSourceFile',
          ]
        ),

      replaceExistingOutput:
        this.readQueueBoolean(
          options,
          [
            'replaceExistingOutput',
            'overwrite',
          ]
        ),

      allowForegroundFallback:
        this.readQueueBoolean(
          options,
          [
            'allowForegroundFallback',
            'foregroundFallback',
          ]
        ),
    };
  }

  /* =======================================================
   * Serialize payload
   * ===================================================== */

  public serializePayload(
    payload:
      NativeProcessingJobPayload
  ): string {
    const validation =
      this.validatePayload(
        payload
      );

    if (
      !validation.valid
    ) {
      this.throwValidationError(
        validation.issues,
        'Cannot serialize an invalid native processing payload.'
      );
    }

    try {
      return JSON.stringify(
        payload
      );
    } catch (error) {
      throw new NativeProcessingPayloadFactoryError(
        'UNSAFE_VALUE',
        `Unable to serialize native processing payload: ${getUnknownErrorMessage(
          error
        )}`,
        [
          this.createValidationIssue(
            'UNSAFE_VALUE',
            null,
            'Native processing payload could not be serialized.',
            true,
            payload
          ),
        ]
      );
    }
  }

  /* =======================================================
   * Deserialize payload
   * ===================================================== */

  public deserializePayload(
    serialized:
      string
  ): NativeProcessingJobPayload {
    if (
      typeof serialized !==
        'string' ||
      serialized.trim().length ===
        0
    ) {
      throw new NativeProcessingPayloadFactoryError(
        'INVALID_INPUT',
        'Serialized native processing payload must be a non-empty string.'
      );
    }

    let parsed:
      unknown;

    try {
      parsed =
        JSON.parse(
          serialized
        );
    } catch (error) {
      throw new NativeProcessingPayloadFactoryError(
        'PAYLOAD_VALIDATION_FAILED',
        `Unable to parse native processing payload: ${getUnknownErrorMessage(
          error
        )}`
      );
    }

    const validation =
      this.validatePayload(
        parsed
      );

    if (
      !validation.valid
    ) {
      this.throwValidationError(
        validation.issues,
        'Serialized native processing payload is invalid.'
      );
    }

    return this.clonePayload(
      parsed as
        NativeProcessingJobPayload
    );
  }

  /* =======================================================
   * Payload byte-size estimation
   * ===================================================== */

  public estimateSerializedPayloadSizeBytes(
    payload:
      NativeProcessingJobPayload
  ): number {
    const serialized =
      this.serializePayload(
        payload
      );

    if (
      typeof TextEncoder !==
        'undefined'
    ) {
      try {
        return new TextEncoder()
          .encode(
            serialized
          )
          .byteLength;
      } catch {
        // نستخدم التقدير اليدوي.
      }
    }

    let byteLength =
      0;

    for (
      let index =
        0;
      index <
        serialized.length;
      index +=
        1
    ) {
      const code =
        serialized.charCodeAt(
          index
        );

      if (
        code <
          0x80
      ) {
        byteLength +=
          1;
      } else if (
        code <
          0x800
      ) {
        byteLength +=
          2;
      } else if (
        code >=
          0xd800 &&
        code <=
          0xdbff &&
        index +
          1 <
          serialized.length
      ) {
        const nextCode =
          serialized.charCodeAt(
            index +
              1
          );

        if (
          nextCode >=
            0xdc00 &&
          nextCode <=
            0xdfff
        ) {
          byteLength +=
            4;

          index +=
            1;
        } else {
          byteLength +=
            3;
        }
      } else {
        byteLength +=
          3;
      }
    }

    return byteLength;
  }

  /* =======================================================
   * Payload compatibility check
   * ===================================================== */

  public isCompatiblePayload(
    value:
      unknown
  ): value is NativeProcessingJobPayload {
    return this.validatePayload(
      value
    ).valid;
  }

  /* =======================================================
   * Payload equality
   * ===================================================== */

  public arePayloadsEquivalent(
    first:
      NativeProcessingJobPayload,
    second:
      NativeProcessingJobPayload
  ): boolean {
    if (
      first ===
        second
    ) {
      return true;
    }

    try {
      return (
        this.serializePayload(
          first
        ) ===
        this.serializePayload(
          second
        )
      );
    } catch {
      return false;
    }
  }
}

/* =========================================================
 * Shared factory
 * ======================================================= */

let sharedNativeProcessingPayloadFactory:
  NativeProcessingPayloadFactory | null =
    null;

export function getNativeProcessingPayloadFactory(
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): NativeProcessingPayloadFactory {
  if (
    !sharedNativeProcessingPayloadFactory
  ) {
    sharedNativeProcessingPayloadFactory =
      new NativeProcessingPayloadFactory(
        options
      );
  }

  return sharedNativeProcessingPayloadFactory;
}

/* =========================================================
 * Replace shared factory
 * ======================================================= */

export function setSharedNativeProcessingPayloadFactory(
  factory:
    NativeProcessingPayloadFactory | null
): void {
  sharedNativeProcessingPayloadFactory =
    factory;
}

/* =========================================================
 * Reset shared factory
 * ======================================================= */

export function resetNativeProcessingPayloadFactory():
  void {
  sharedNativeProcessingPayloadFactory =
    null;
}

/* =========================================================
 * Public creation helpers
 * ======================================================= */

export function createNativeProcessingPayload(
  input:
    NativeProcessingPayloadFactoryInput,
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): NativeProcessingJobPayload {
  if (
    Object.keys(
      options
    ).length >
      0
  ) {
    return new NativeProcessingPayloadFactory(
      options
    ).createPayload(
      input
    );
  }

  return getNativeProcessingPayloadFactory()
    .createPayload(
      input
    );
}

export function createNativeProcessingPayloadResult(
  input:
    NativeProcessingPayloadFactoryInput,
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): NativeProcessingPayloadFactoryResult {
  if (
    Object.keys(
      options
    ).length >
      0
  ) {
    return new NativeProcessingPayloadFactory(
      options
    ).create(
      input
    );
  }

  return getNativeProcessingPayloadFactory()
    .create(
      input
    );
}

export function createNativeProcessingPayloadFromPartialInput(
  input:
    PartialNativeProcessingPayloadFactoryInput,
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): NativeProcessingPayloadFactoryResult {
  if (
    Object.keys(
      options
    ).length >
      0
  ) {
    return new NativeProcessingPayloadFactory(
      options
    ).createFromPartialInput(
      input
    );
  }

  return getNativeProcessingPayloadFactory()
    .createFromPartialInput(
      input
    );
}

export function createNativeProcessingPayloadFromQueueJob(
  job:
    unknown,
  overrides:
    Parameters<
      NativeProcessingPayloadFactory[
        'createFromQueueJob'
      ]
    >[1] =
      {},
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): NativeProcessingPayloadFactoryResult {
  if (
    Object.keys(
      options
    ).length >
      0
  ) {
    return new NativeProcessingPayloadFactory(
      options
    ).createFromQueueJob(
      job,
      overrides
    );
  }

  return getNativeProcessingPayloadFactory()
    .createFromQueueJob(
      job,
      overrides
    );
}

/* =========================================================
 * Public validation helpers
 * ======================================================= */

export function validateNativeProcessingPayload(
  payload:
    unknown,
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): NativeProcessingPayloadValidationResult {
  if (
    Object.keys(
      options
    ).length >
      0
  ) {
    return new NativeProcessingPayloadFactory(
      options
    ).validatePayload(
      payload
    );
  }

  return getNativeProcessingPayloadFactory()
    .validatePayload(
      payload
    );
}

export function isValidNativeProcessingPayload(
  payload:
    unknown,
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): payload is NativeProcessingJobPayload {
  return validateNativeProcessingPayload(
    payload,
    options
  ).valid;
}

/* =========================================================
 * Public serialization helpers
 * ======================================================= */

export function serializeNativeProcessingPayload(
  payload:
    NativeProcessingJobPayload,
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): string {
  if (
    Object.keys(
      options
    ).length >
      0
  ) {
    return new NativeProcessingPayloadFactory(
      options
    ).serializePayload(
      payload
    );
  }

  return getNativeProcessingPayloadFactory()
    .serializePayload(
      payload
    );
}

export function deserializeNativeProcessingPayload(
  serialized:
    string,
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): NativeProcessingJobPayload {
  if (
    Object.keys(
      options
    ).length >
      0
  ) {
    return new NativeProcessingPayloadFactory(
      options
    ).deserializePayload(
      serialized
    );
  }

  return getNativeProcessingPayloadFactory()
    .deserializePayload(
      serialized
    );
}

export function estimateNativeProcessingPayloadSizeBytes(
  payload:
    NativeProcessingJobPayload,
  options:
    NativeProcessingPayloadFactoryOptions =
      {}
): number {
  if (
    Object.keys(
      options
    ).length >
      0
  ) {
    return new NativeProcessingPayloadFactory(
      options
    ).estimateSerializedPayloadSizeBytes(
      payload
    );
  }

  return getNativeProcessingPayloadFactory()
    .estimateSerializedPayloadSizeBytes(
      payload
    );
}

/* =========================================================
 * Default export
 * ======================================================= */

export default
  NativeProcessingPayloadFactory;