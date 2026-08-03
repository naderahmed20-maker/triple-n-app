// scan/core/queue/TimeEstimator.ts
//
// Triple N - Scan Item Processing Time Estimator
//
// هذا الملف مسؤول عن حساب الوقت المتوقع لمعالجة
// صور Scan Item داخل الـQueue.
//
// مسؤولياته:
//
// 1) حساب متوسط وقت معالجة الصورة.
// 2) التعلم من الصور المكتملة فعليًا.
// 3) حساب الوقت المتبقي للصورة الحالية.
// 4) حساب الوقت المتبقي للطابور بالكامل.
// 5) عرض الوقت بصيغة مناسبة للمستخدم.
// 6) التعامل مع الصور التي فشلت أو أُلغيت.
// 7) منع القيم غير المنطقية أو السالبة.
// 8) توفير Snapshot آمن للواجهة.
// 9) دعم استعادة العينات بعد إعادة فتح التطبيق.
// 10) توفير Singleton افتراضي للتطبيق.
//
// هذا الملف لا يشغّل EdgeSAM.
// لا يحفظ داخل AsyncStorage مباشرة.
// لا يعدّل Queue.
// لا يرسل إشعارات.

import type {
    ProcessingDurationMs,
    ProcessingJob,
    ProcessingJobId,
    ProcessingProgress,
    ProcessingQueueSnapshot,
    ProcessingTimestamp,
} from './QueueTypes';

import {
    DEFAULT_ESTIMATED_ITEM_PROCESSING_MS,
    clampProcessingProgress,
    normalizeProcessingDuration,
} from './QueueTypes';

import type {
    ProcessingTimeEstimatorConfig,
} from './ProcessingConfig';

import {
    DEFAULT_PROCESSING_TIME_ESTIMATOR_CONFIG,
} from './ProcessingConfig';

/* =========================================================
 * Constants
 * ======================================================= */

export const TIME_ESTIMATOR_SCHEMA_VERSION =
  1 as const;

export const TIME_ESTIMATOR_MINIMUM_DISPLAY_SECONDS =
  1;

export const TIME_ESTIMATOR_MINIMUM_DISPLAY_MINUTES =
  1;

export const TIME_ESTIMATOR_SECONDS_PER_MINUTE =
  60;

export const TIME_ESTIMATOR_MINUTES_PER_HOUR =
  60;

export const TIME_ESTIMATOR_HOURS_PER_DAY =
  24;

export const TIME_ESTIMATOR_MILLISECONDS_PER_SECOND =
  1_000;

export const TIME_ESTIMATOR_MILLISECONDS_PER_MINUTE =
  TIME_ESTIMATOR_MILLISECONDS_PER_SECOND *
  TIME_ESTIMATOR_SECONDS_PER_MINUTE;

export const TIME_ESTIMATOR_MILLISECONDS_PER_HOUR =
  TIME_ESTIMATOR_MILLISECONDS_PER_MINUTE *
  TIME_ESTIMATOR_MINUTES_PER_HOUR;

export const TIME_ESTIMATOR_MILLISECONDS_PER_DAY =
  TIME_ESTIMATOR_MILLISECONDS_PER_HOUR *
  TIME_ESTIMATOR_HOURS_PER_DAY;

/* =========================================================
 * Primitive types
 * ======================================================= */

export type ProcessingTimeEstimatorSchemaVersion =
  typeof TIME_ESTIMATOR_SCHEMA_VERSION;

export type ProcessingTimeSampleId =
  string;

/* =========================================================
 * Sample types
 * ======================================================= */

export type ProcessingTimeSampleSource =
  | 'completed-job'
  | 'restored-job'
  | 'manual'
  | 'unknown';

export type ProcessingTimeSample = {
  id:
    ProcessingTimeSampleId;

  jobId:
    ProcessingJobId | null;

  source:
    ProcessingTimeSampleSource;

  durationMs:
    ProcessingDurationMs;

  createdAt:
    ProcessingTimestamp;

  weight:
    number;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

/* =========================================================
 * Estimate results
 * ======================================================= */

export type ProcessingItemTimeEstimate = {
  jobId:
    ProcessingJobId;

  progress:
    ProcessingProgress;

  estimatedTotalMs:
    ProcessingDurationMs;

  elapsedMs:
    ProcessingDurationMs;

  estimatedRemainingMs:
    ProcessingDurationMs;

  estimatedCompletionAt:
    ProcessingTimestamp | null;

  basedOnCompletedSamples:
    boolean;
};

export type ProcessingQueueTimeEstimate = {
  totalJobs:
    number;

  completedJobs:
    number;

  activeJobs:
    number;

  pendingJobs:
    number;

  failedJobs:
    number;

  cancelledJobs:
    number;

  averageItemMs:
    ProcessingDurationMs;

  estimatedRemainingMs:
    ProcessingDurationMs;

  estimatedCompletionAt:
    ProcessingTimestamp | null;

  currentJobEstimate:
    ProcessingItemTimeEstimate | null;

  remainingEquivalentItems:
    number;

  basedOnCompletedSamples:
    boolean;

  calculatedAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Display types
 * ======================================================= */

export type ProcessingTimeDisplayUnit =
  | 'second'
  | 'minute'
  | 'hour'
  | 'day';

export type ProcessingFormattedTime = {
  milliseconds:
    ProcessingDurationMs;

  totalSeconds:
    number;

  days:
    number;

  hours:
    number;

  minutes:
    number;

  seconds:
    number;

  primaryValue:
    number;

  primaryUnit:
    ProcessingTimeDisplayUnit;

  compact:
    string;

  long:
    string;

  approximate:
    string;
};

/* =========================================================
 * Stored state
 * ======================================================= */

export type StoredProcessingTimeEstimatorState = {
  schemaVersion:
    ProcessingTimeEstimatorSchemaVersion;

  samples:
    readonly ProcessingTimeSample[];

  smoothedAverageItemMs:
    ProcessingDurationMs;

  createdAt:
    ProcessingTimestamp;

  updatedAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Runtime snapshot
 * ======================================================= */

export type ProcessingTimeEstimatorSnapshot = {
  schemaVersion:
    ProcessingTimeEstimatorSchemaVersion;

  sampleCount:
    number;

  samples:
    readonly ProcessingTimeSample[];

  averageItemMs:
    ProcessingDurationMs;

  arithmeticAverageItemMs:
    ProcessingDurationMs;

  smoothedAverageItemMs:
    ProcessingDurationMs;

  minimumSampleMs:
    ProcessingDurationMs | null;

  maximumSampleMs:
    ProcessingDurationMs | null;

  latestSampleMs:
    ProcessingDurationMs | null;

  hasEnoughSamples:
    boolean;

  createdAt:
    ProcessingTimestamp;

  updatedAt:
    ProcessingTimestamp;
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type ProcessingTimeEstimatorDiagnostics = {
  initialized:
    boolean;

  disposed:
    boolean;

  sampleCount:
    number;

  acceptedSampleCount:
    number;

  rejectedSampleCount:
    number;

  queueEstimateCount:
    number;

  itemEstimateCount:
    number;

  lastSampleAt:
    ProcessingTimestamp | null;

  lastEstimateAt:
    ProcessingTimestamp | null;

  lastAverageItemMs:
    ProcessingDurationMs;

  lastError:
    string | null;
};

/* =========================================================
 * Internal helpers
 * ======================================================= */

function now(): number {
  return Date.now();
}

function clampNumber(
  value:
    number,
  minimum:
    number,
  maximum:
    number,
  fallback:
    number
): number {
  if (
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function clampInteger(
  value:
    number,
  minimum:
    number,
  maximum:
    number,
  fallback:
    number
): number {
  return Math.floor(
    clampNumber(
      value,
      minimum,
      maximum,
      fallback
    )
  );
}

function createRandomPart(
  length:
    number
): string {
  return Math.random()
    .toString(36)
    .slice(
      2,
      2 +
        Math.max(
          4,
          Math.floor(length)
        )
    );
}

function createTimeSampleId():
  ProcessingTimeSampleId {
  return [
    'processing-time-sample',
    now().toString(36),
    createRandomPart(8),
  ].join('-');
}

function cloneMetadata(
  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >
): Readonly<
  Record<
    string,
    string | number | boolean | null
  >
> {
  return {
    ...metadata,
  };
}

function cloneSample(
  sample:
    ProcessingTimeSample
): ProcessingTimeSample {
  return {
    ...sample,

    metadata:
      cloneMetadata(
        sample.metadata
      ),
  };
}

function isActiveJob(
  job:
    ProcessingJob
): boolean {
  return (
    job.status ===
      'preparing' ||
    job.status ===
      'processing' ||
    job.status ===
      'finalizing'
  );
}

function isPendingJob(
  job:
    ProcessingJob
): boolean {
  return (
    job.status ===
      'queued' ||
    job.status ===
      'paused' ||
    job.status ===
      'interrupted' ||
    job.status ===
      'retry-scheduled'
  );
}

function isCompletedJob(
  job:
    ProcessingJob
): boolean {
  return (
    job.status ===
    'completed'
  );
}

function resolveJobElapsedMs(
  job:
    ProcessingJob,
  timestamp:
    ProcessingTimestamp
): ProcessingDurationMs {
  const storedElapsed =
    normalizeProcessingDuration(
      job.progress.elapsedMs
    );

  if (
    job.timing.startedAt ===
      null
  ) {
    return storedElapsed;
  }

  const liveElapsed =
    normalizeProcessingDuration(
      timestamp -
      job.timing.startedAt
    );

  return Math.max(
    storedElapsed,
    liveElapsed,
    job.timing
      .lastAttemptDurationMs
  );
}

function calculateWeightedAverage(
  samples:
    readonly ProcessingTimeSample[],
  fallback:
    ProcessingDurationMs
): ProcessingDurationMs {
  if (
    samples.length ===
    0
  ) {
    return fallback;
  }

  let weightedDuration =
    0;

  let totalWeight =
    0;

  for (
    const sample of samples
  ) {
    const weight =
      clampNumber(
        sample.weight,
        0.01,
        100,
        1
      );

    weightedDuration +=
      sample.durationMs *
      weight;

    totalWeight +=
      weight;
  }

  if (
    totalWeight <=
    0
  ) {
    return fallback;
  }

  return normalizeProcessingDuration(
    weightedDuration /
    totalWeight
  );
}

function calculateArithmeticAverage(
  samples:
    readonly ProcessingTimeSample[],
  fallback:
    ProcessingDurationMs
): ProcessingDurationMs {
  if (
    samples.length ===
    0
  ) {
    return fallback;
  }

  let total =
    0;

  for (
    const sample of samples
  ) {
    total +=
      sample.durationMs;
  }

  return normalizeProcessingDuration(
    total /
    samples.length
  );
}

function calculateSampleBounds(
  samples:
    readonly ProcessingTimeSample[]
): {
  minimum:
    ProcessingDurationMs | null;

  maximum:
    ProcessingDurationMs | null;
} {
  if (
    samples.length ===
    0
  ) {
    return {
      minimum:
        null,

      maximum:
        null,
    };
  }

  let minimum =
    samples[0]
      .durationMs;

  let maximum =
    samples[0]
      .durationMs;

  for (
    let index =
      1;
    index <
      samples.length;
    index +=
      1
  ) {
    const duration =
      samples[index]
        .durationMs;

    minimum =
      Math.min(
        minimum,
        duration
      );

    maximum =
      Math.max(
        maximum,
        duration
      );
  }

  return {
    minimum,

    maximum,
  };
}

/* =========================================================
 * Validation
 * ======================================================= */

export function isValidProcessingTimeSample(
  value:
    unknown
): value is ProcessingTimeSample {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const sample =
    value as Partial<
      ProcessingTimeSample
    >;

  return (
    typeof sample.id ===
      'string' &&
    sample.id.length >
      0 &&
    (
      sample.jobId ===
        null ||
      typeof sample.jobId ===
        'string'
    ) &&
    (
      sample.source ===
        'completed-job' ||
      sample.source ===
        'restored-job' ||
      sample.source ===
        'manual' ||
      sample.source ===
        'unknown'
    ) &&
    typeof sample.durationMs ===
      'number' &&
    Number.isFinite(
      sample.durationMs
    ) &&
    sample.durationMs >
      0 &&
    typeof sample.createdAt ===
      'number' &&
    Number.isFinite(
      sample.createdAt
    ) &&
    sample.createdAt >
      0 &&
    typeof sample.weight ===
      'number' &&
    Number.isFinite(
      sample.weight
    ) &&
    sample.weight >
      0
  );
}

export function isValidStoredProcessingTimeEstimatorState(
  value:
    unknown
): value is StoredProcessingTimeEstimatorState {
  if (
    typeof value !==
      'object' ||
    value === null
  ) {
    return false;
  }

  const state =
    value as Partial<
      StoredProcessingTimeEstimatorState
    >;

  return (
    state.schemaVersion ===
      TIME_ESTIMATOR_SCHEMA_VERSION &&
    Array.isArray(
      state.samples
    ) &&
    state.samples.every(
      isValidProcessingTimeSample
    ) &&
    typeof state
      .smoothedAverageItemMs ===
      'number' &&
    Number.isFinite(
      state
        .smoothedAverageItemMs
    ) &&
    typeof state.createdAt ===
      'number' &&
    Number.isFinite(
      state.createdAt
    ) &&
    typeof state.updatedAt ===
      'number' &&
    Number.isFinite(
      state.updatedAt
    )
  );
}

/* =========================================================
 * Formatting
 * ======================================================= */

export function formatProcessingDuration(
  durationMs:
    ProcessingDurationMs,
  options?: {
    roundMinutes?:
      boolean;

    includeSeconds?:
      boolean;

    approximatePrefix?:
      string;
  }
): ProcessingFormattedTime {
  const safeDuration =
    normalizeProcessingDuration(
      durationMs
    );

  const totalSeconds =
    Math.max(
      0,
      Math.ceil(
        safeDuration /
        TIME_ESTIMATOR_MILLISECONDS_PER_SECOND
      )
    );

  const days =
    Math.floor(
      totalSeconds /
      (
        TIME_ESTIMATOR_SECONDS_PER_MINUTE *
        TIME_ESTIMATOR_MINUTES_PER_HOUR *
        TIME_ESTIMATOR_HOURS_PER_DAY
      )
    );

  const remainingAfterDays =
    totalSeconds -
    (
      days *
      TIME_ESTIMATOR_SECONDS_PER_MINUTE *
      TIME_ESTIMATOR_MINUTES_PER_HOUR *
      TIME_ESTIMATOR_HOURS_PER_DAY
    );

  const hours =
    Math.floor(
      remainingAfterDays /
      (
        TIME_ESTIMATOR_SECONDS_PER_MINUTE *
        TIME_ESTIMATOR_MINUTES_PER_HOUR
      )
    );

  const remainingAfterHours =
    remainingAfterDays -
    (
      hours *
      TIME_ESTIMATOR_SECONDS_PER_MINUTE *
      TIME_ESTIMATOR_MINUTES_PER_HOUR
    );

  const minutes =
    Math.floor(
      remainingAfterHours /
      TIME_ESTIMATOR_SECONDS_PER_MINUTE
    );

  const seconds =
    remainingAfterHours -
    (
      minutes *
      TIME_ESTIMATOR_SECONDS_PER_MINUTE
    );

  const roundMinutes =
    options
      ?.roundMinutes ??
    true;

  const includeSeconds =
    options
      ?.includeSeconds ??
    false;

  const approximatePrefix =
    options
      ?.approximatePrefix ??
    'about';

  let primaryValue:
    number;

  let primaryUnit:
    ProcessingTimeDisplayUnit;

  if (
    days >
    0
  ) {
    primaryValue =
      days;

    primaryUnit =
      'day';
  } else if (
    hours >
    0
  ) {
    primaryValue =
      hours;

    primaryUnit =
      'hour';
  } else if (
    minutes >
    0 ||
    safeDuration >=
      TIME_ESTIMATOR_MILLISECONDS_PER_MINUTE
  ) {
    primaryValue =
      roundMinutes
        ? Math.max(
            TIME_ESTIMATOR_MINIMUM_DISPLAY_MINUTES,
            Math.ceil(
              safeDuration /
              TIME_ESTIMATOR_MILLISECONDS_PER_MINUTE
            )
          )
        : Math.max(
            TIME_ESTIMATOR_MINIMUM_DISPLAY_MINUTES,
            minutes
          );

    primaryUnit =
      'minute';
  } else {
    primaryValue =
      Math.max(
        TIME_ESTIMATOR_MINIMUM_DISPLAY_SECONDS,
        totalSeconds
      );

    primaryUnit =
      'second';
  }

  const compactParts:
    string[] =
    [];

  if (
    days >
    0
  ) {
    compactParts.push(
      `${days}d`
    );
  }

  if (
    hours >
    0
  ) {
    compactParts.push(
      `${hours}h`
    );
  }

  if (
    minutes >
    0 &&
    compactParts.length <
      2
  ) {
    compactParts.push(
      `${minutes}m`
    );
  }

  if (
    includeSeconds &&
    seconds >
      0 &&
    compactParts.length <
      2
  ) {
    compactParts.push(
      `${seconds}s`
    );
  }

  if (
    compactParts.length ===
    0
  ) {
    compactParts.push(
      `${Math.max(
        1,
        totalSeconds
      )}s`
    );
  }

  const longParts:
    string[] =
    [];

  if (
    days >
    0
  ) {
    longParts.push(
      `${days} ${
        days === 1
          ? 'day'
          : 'days'
      }`
    );
  }

  if (
    hours >
    0
  ) {
    longParts.push(
      `${hours} ${
        hours === 1
          ? 'hour'
          : 'hours'
      }`
    );
  }

  if (
    minutes >
    0 &&
    longParts.length <
      2
  ) {
    longParts.push(
      `${minutes} ${
        minutes === 1
          ? 'minute'
          : 'minutes'
      }`
    );
  }

  if (
    includeSeconds &&
    seconds >
      0 &&
    longParts.length <
      2
  ) {
    longParts.push(
      `${seconds} ${
        seconds === 1
          ? 'second'
          : 'seconds'
      }`
    );
  }

  if (
    longParts.length ===
    0
  ) {
    const displaySeconds =
      Math.max(
        1,
        totalSeconds
      );

    longParts.push(
      `${displaySeconds} ${
        displaySeconds ===
          1
          ? 'second'
          : 'seconds'
      }`
    );
  }

  const primaryUnitLabel =
    primaryValue ===
      1
      ? primaryUnit
      : `${primaryUnit}s`;

  return {
    milliseconds:
      safeDuration,

    totalSeconds,

    days,

    hours,

    minutes,

    seconds,

    primaryValue,

    primaryUnit,

    compact:
      compactParts.join(
        ' '
      ),

    long:
      longParts.join(
        ' '
      ),

    approximate:
      `${approximatePrefix} ${primaryValue} ${primaryUnitLabel}`,
  };
}

export function formatEstimatedProcessingTime(
  durationMs:
    ProcessingDurationMs
): string {
  return formatProcessingDuration(
    durationMs,
    {
      roundMinutes:
        true,

      includeSeconds:
        false,

      approximatePrefix:
        'about',
    }
  ).approximate;
}

export function formatEstimatedTimeRemaining(
  durationMs:
    ProcessingDurationMs
): string {
  return `Estimated time remaining: ${
    formatEstimatedProcessingTime(
      durationMs
    )
  }`;
}

/* =========================================================
 * Estimator class
 * ======================================================= */

export class ProcessingTimeEstimator {
  private readonly config:
    ProcessingTimeEstimatorConfig;

  private readonly samples:
    ProcessingTimeSample[] =
      [];

  private initialized =
    false;

  private disposed =
    false;

  private createdAt:
    ProcessingTimestamp =
      now();

  private updatedAt:
    ProcessingTimestamp =
      this.createdAt;

  private smoothedAverageItemMs:
    ProcessingDurationMs;

  private diagnostics:
    ProcessingTimeEstimatorDiagnostics;

  constructor(
    config:
      ProcessingTimeEstimatorConfig =
        DEFAULT_PROCESSING_TIME_ESTIMATOR_CONFIG
  ) {
    this.config = {
      ...config,

      initialEstimatedItemMs:
        this.normalizeEstimate(
          config
            .initialEstimatedItemMs
        ),

      minimumEstimatedItemMs:
        normalizeProcessingDuration(
          config
            .minimumEstimatedItemMs
        ),

      maximumEstimatedItemMs:
        normalizeProcessingDuration(
          config
            .maximumEstimatedItemMs
        ),

      minimumSampleCount:
        clampInteger(
          config
            .minimumSampleCount,
          1,
          1_000,
          1
        ),

      maximumSampleCount:
        clampInteger(
          config
            .maximumSampleCount,
          1,
          10_000,
          20
        ),

      smoothingFactor:
        clampNumber(
          config
            .smoothingFactor,
          0.01,
          1,
          0.35
        ),

      includeCurrentJobProgress:
        config
          .includeCurrentJobProgress,

      roundDisplayedMinutes:
        config
          .roundDisplayedMinutes,
    };

    if (
      this.config
        .maximumSampleCount <
      this.config
        .minimumSampleCount
    ) {
      this.config
        .maximumSampleCount =
        this.config
          .minimumSampleCount;
    }

    this.smoothedAverageItemMs =
      this.config
        .initialEstimatedItemMs;

    this.diagnostics = {
      initialized:
        false,

      disposed:
        false,

      sampleCount:
        0,

      acceptedSampleCount:
        0,

      rejectedSampleCount:
        0,

      queueEstimateCount:
        0,

      itemEstimateCount:
        0,

      lastSampleAt:
        null,

      lastEstimateAt:
        null,

      lastAverageItemMs:
        this.smoothedAverageItemMs,

      lastError:
        null,
    };
  }

  public initialize():
    void {
    this.assertNotDisposed();

    if (
      this.initialized
    ) {
      return;
    }

    this.initialized =
      true;

    this.diagnostics = {
      ...this.diagnostics,

      initialized:
        true,
    };
  }

  public addSample(
    durationMs:
      ProcessingDurationMs,
    options?: {
      jobId?:
        ProcessingJobId | null;

      source?:
        ProcessingTimeSampleSource;

      weight?:
        number;

      createdAt?:
        ProcessingTimestamp;

      metadata?:
        Readonly<
          Record<
            string,
            string | number | boolean | null
          >
        >;
    }
  ): ProcessingTimeSample | null {
    this.ensureInitialized();

    const normalizedDuration =
      this.normalizeEstimate(
        durationMs
      );

    if (
      normalizedDuration <=
      0
    ) {
      this.diagnostics = {
        ...this.diagnostics,

        rejectedSampleCount:
          this.diagnostics
            .rejectedSampleCount +
          1,

        lastError:
          'Processing time sample duration must be greater than zero.',
      };

      return null;
    }

    const sample:
      ProcessingTimeSample = {
        id:
          createTimeSampleId(),

        jobId:
          options?.jobId ??
          null,

        source:
          options?.source ??
          'unknown',

        durationMs:
          normalizedDuration,

        createdAt:
          typeof options
            ?.createdAt ===
            'number' &&
          Number.isFinite(
            options.createdAt
          )
            ? Math.floor(
                options.createdAt
              )
            : now(),

        weight:
          clampNumber(
            options?.weight ??
              1,
            0.01,
            100,
            1
          ),

        metadata: {
          ...(options
            ?.metadata ??
          {}),
        },
      };

    this.samples.push(
      sample
    );

    while (
      this.samples.length >
      this.config
        .maximumSampleCount
    ) {
      this.samples.shift();
    }

    this.smoothedAverageItemMs =
      this.calculateNextSmoothedAverage(
        normalizedDuration
      );

    this.updatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      sampleCount:
        this.samples.length,

      acceptedSampleCount:
        this.diagnostics
          .acceptedSampleCount +
        1,

      lastSampleAt:
        sample.createdAt,

      lastAverageItemMs:
        this.getAverageItemMs(),

      lastError:
        null,
    };

    return cloneSample(
      sample
    );
  }

  public addCompletedJob(
    job:
      ProcessingJob
  ): ProcessingTimeSample | null {
    this.ensureInitialized();

    if (
      job.status !==
        'completed'
    ) {
      return null;
    }

    const duration =
      Math.max(
        job.timing
          .totalProcessingMs,
        job.timing
          .lastAttemptDurationMs
      );

    if (
      duration <=
      0
    ) {
      return null;
    }

    const alreadyExists =
      this.samples.some(
        sample =>
          sample.jobId ===
          job.id
      );

    if (
      alreadyExists
    ) {
      return null;
    }

    return this.addSample(
      duration,
      {
        jobId:
          job.id,

        source:
          'completed-job',

        createdAt:
          job.timing
            .completedAt ??
          now(),

        metadata: {
          category:
            job.wardrobe
              .category,

          sourceKind:
            job.source.kind,

          attempt:
            job.retry.attempt,
        },
      }
    );
  }

  public addCompletedJobs(
    jobs:
      readonly ProcessingJob[]
  ): readonly ProcessingTimeSample[] {
    this.ensureInitialized();

    const added:
      ProcessingTimeSample[] =
      [];

    for (
      const job of jobs
    ) {
      const sample =
        this.addCompletedJob(
          job
        );

      if (
        sample
      ) {
        added.push(
          sample
        );
      }
    }

    return added;
  }

  public estimateJob(
    job:
      ProcessingJob,
    timestamp:
      ProcessingTimestamp =
        now()
  ): ProcessingItemTimeEstimate {
    this.ensureInitialized();

    const averageItemMs =
      this.getAverageItemMs();

    const progress =
      clampProcessingProgress(
        job.progress.progress
      );

    const elapsedMs =
      resolveJobElapsedMs(
        job,
        timestamp
      );

    let estimatedTotalMs =
      averageItemMs;

    if (
      progress >
        0.01 &&
      elapsedMs >
        0 &&
      this.config
        .includeCurrentJobProgress
    ) {
      const progressBasedTotal =
        normalizeProcessingDuration(
          elapsedMs /
          progress
        );

      estimatedTotalMs =
        this.normalizeEstimate(
          (
            averageItemMs *
            0.45
          ) +
          (
            progressBasedTotal *
            0.55
          )
        );
    }

    if (
      job.timing
        .estimatedProcessingMs >
      0
    ) {
      estimatedTotalMs =
        this.normalizeEstimate(
          (
            estimatedTotalMs *
            0.7
          ) +
          (
            job.timing
              .estimatedProcessingMs *
            0.3
          )
        );
    }

    const remainingProgress =
      Math.max(
        0,
        1 -
        progress
      );

    let estimatedRemainingMs =
      normalizeProcessingDuration(
        estimatedTotalMs *
        remainingProgress
      );

    if (
      isCompletedJob(
        job
      ) ||
      job.status ===
        'failed' ||
      job.status ===
        'cancelled'
    ) {
      estimatedRemainingMs =
        0;
    } else if (
      isActiveJob(
        job
      )
    ) {
      estimatedRemainingMs =
        Math.max(
          0,
          estimatedTotalMs -
          elapsedMs
        );
    }

    const calculatedAt =
      Math.max(
        1,
        Math.floor(
          timestamp
        )
      );

    const estimatedCompletionAt =
      estimatedRemainingMs >
        0
        ? calculatedAt +
          estimatedRemainingMs
        : (
            isCompletedJob(
              job
            )
              ? job.timing
                  .completedAt
              : null
          );

    this.diagnostics = {
      ...this.diagnostics,

      itemEstimateCount:
        this.diagnostics
          .itemEstimateCount +
        1,

      lastEstimateAt:
        calculatedAt,

      lastAverageItemMs:
        averageItemMs,
    };

    return {
      jobId:
        job.id,

      progress,

      estimatedTotalMs,

      elapsedMs,

      estimatedRemainingMs,

      estimatedCompletionAt,

      basedOnCompletedSamples:
        this.hasEnoughSamples(),
    };
  }

  public estimateQueue(
    snapshot:
      ProcessingQueueSnapshot,
    timestamp:
      ProcessingTimestamp =
        now()
  ): ProcessingQueueTimeEstimate {
    this.ensureInitialized();

    this.addCompletedJobs(
      snapshot.jobs
    );

    const averageItemMs =
      this.getAverageItemMs();

    let completedJobs =
      0;

    let activeJobs =
      0;

    let pendingJobs =
      0;

    let failedJobs =
      0;

    let cancelledJobs =
      0;

    let remainingEquivalentItems =
      0;

    let currentJobEstimate:
      ProcessingItemTimeEstimate | null =
        null;

    for (
      const job of snapshot.jobs
    ) {
      if (
        isCompletedJob(
          job
        )
      ) {
        completedJobs +=
          1;

        continue;
      }

      if (
        job.status ===
          'failed'
      ) {
        failedJobs +=
          1;

        continue;
      }

      if (
        job.status ===
          'cancelled'
      ) {
        cancelledJobs +=
          1;

        continue;
      }

      const progress =
        clampProcessingProgress(
          job.progress.progress
        );

      if (
        isActiveJob(
          job
        )
      ) {
        activeJobs +=
          1;

        const estimate =
          this.estimateJob(
            job,
            timestamp
          );

        remainingEquivalentItems +=
          averageItemMs >
            0
            ? estimate
                .estimatedRemainingMs /
              averageItemMs
            : (
                1 -
                progress
              );

        if (
          currentJobEstimate ===
            null ||
          job.id ===
            snapshot.activeJobId
        ) {
          currentJobEstimate =
            estimate;
        }

        continue;
      }

      if (
        isPendingJob(
          job
        )
      ) {
        pendingJobs +=
          1;

        remainingEquivalentItems +=
          Math.max(
            0,
            1 -
            progress
          );
      }
    }

    let estimatedRemainingMs =
      normalizeProcessingDuration(
        remainingEquivalentItems *
        averageItemMs
      );

    if (
      currentJobEstimate &&
      activeJobs >
        0
    ) {
      const pendingOnlyEquivalent =
        Math.max(
          0,
          remainingEquivalentItems -
          (
            currentJobEstimate
              .estimatedRemainingMs /
            Math.max(
              1,
              averageItemMs
            )
          )
        );

      estimatedRemainingMs =
        normalizeProcessingDuration(
          currentJobEstimate
            .estimatedRemainingMs +
          (
            pendingOnlyEquivalent *
            averageItemMs
          )
        );
    }

    const calculatedAt =
      Math.max(
        1,
        Math.floor(
          timestamp
        )
      );

    const estimatedCompletionAt =
      estimatedRemainingMs >
        0
        ? calculatedAt +
          estimatedRemainingMs
        : null;

    this.diagnostics = {
      ...this.diagnostics,

      queueEstimateCount:
        this.diagnostics
          .queueEstimateCount +
        1,

      lastEstimateAt:
        calculatedAt,

      lastAverageItemMs:
        averageItemMs,

      lastError:
        null,
    };

    return {
      totalJobs:
        snapshot.jobs.length,

      completedJobs,

      activeJobs,

      pendingJobs,

      failedJobs,

      cancelledJobs,

      averageItemMs,

      estimatedRemainingMs,

      estimatedCompletionAt,

      currentJobEstimate,

      remainingEquivalentItems,

      basedOnCompletedSamples:
        this.hasEnoughSamples(),

      calculatedAt,
    };
  }

  public getAverageItemMs():
    ProcessingDurationMs {
    this.ensureInitialized();

    if (
      this.samples.length ===
        0
    ) {
      return this.config
        .initialEstimatedItemMs;
    }

    const weightedAverage =
      calculateWeightedAverage(
        this.samples,
        this.config
          .initialEstimatedItemMs
      );

    return this.normalizeEstimate(
      (
        weightedAverage *
        0.45
      ) +
      (
        this.smoothedAverageItemMs *
        0.55
      )
    );
  }

  public hasEnoughSamples():
    boolean {
    return (
      this.samples.length >=
      this.config
        .minimumSampleCount
    );
  }

  public getSamples():
    readonly ProcessingTimeSample[] {
    return this.samples.map(
      cloneSample
    );
  }

  public removeSample(
    sampleId:
      ProcessingTimeSampleId
  ): boolean {
    this.ensureInitialized();

    const index =
      this.samples.findIndex(
        sample =>
          sample.id ===
          sampleId
      );

    if (
      index <
      0
    ) {
      return false;
    }

    this.samples.splice(
      index,
      1
    );

    this.recalculateSmoothedAverage();

    this.updatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      sampleCount:
        this.samples.length,

      lastAverageItemMs:
        this.getAverageItemMs(),
    };

    return true;
  }

  public removeSamplesForJob(
    jobId:
      ProcessingJobId
  ): number {
    this.ensureInitialized();

    const originalLength =
      this.samples.length;

    const remaining =
      this.samples.filter(
        sample =>
          sample.jobId !==
          jobId
      );

    const removedCount =
      originalLength -
      remaining.length;

    if (
      removedCount ===
      0
    ) {
      return 0;
    }

    this.samples.length =
      0;

    this.samples.push(
      ...remaining
    );

    this.recalculateSmoothedAverage();

    this.updatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      sampleCount:
        this.samples.length,

      lastAverageItemMs:
        this.getAverageItemMs(),
    };

    return removedCount;
  }

  public clearSamples():
    number {
    this.ensureInitialized();

    const count =
      this.samples.length;

    this.samples.length =
      0;

    this.smoothedAverageItemMs =
      this.config
        .initialEstimatedItemMs;

    this.updatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      sampleCount:
        0,

      lastAverageItemMs:
        this.smoothedAverageItemMs,
    };

    return count;
  }

  public createStoredState():
    StoredProcessingTimeEstimatorState {
    this.ensureInitialized();

    return {
      schemaVersion:
        TIME_ESTIMATOR_SCHEMA_VERSION,

      samples:
        this.samples.map(
          cloneSample
        ),

      smoothedAverageItemMs:
        this.smoothedAverageItemMs,

      createdAt:
        this.createdAt,

      updatedAt:
        this.updatedAt,
    };
  }

  public restoreStoredState(
    stored:
      StoredProcessingTimeEstimatorState
  ): void {
    this.ensureInitialized();

    if (
      !isValidStoredProcessingTimeEstimatorState(
        stored
      )
    ) {
      throw new Error(
        'Invalid processing time estimator state.'
      );
    }

    this.samples.length =
      0;

    const validSamples =
      stored.samples
        .filter(
          isValidProcessingTimeSample
        )
        .slice(
          -this.config
            .maximumSampleCount
        )
        .map(
          cloneSample
        );

    this.samples.push(
      ...validSamples
    );

    this.smoothedAverageItemMs =
      this.normalizeEstimate(
        stored
          .smoothedAverageItemMs
      );

    this.createdAt =
      Math.max(
        1,
        Math.floor(
          stored.createdAt
        )
      );

    this.updatedAt =
      Math.max(
        this.createdAt,
        Math.floor(
          stored.updatedAt
        )
      );

    this.diagnostics = {
      ...this.diagnostics,

      sampleCount:
        this.samples.length,

      lastAverageItemMs:
        this.getAverageItemMs(),

      lastSampleAt:
        this.samples.length >
          0
          ? this.samples[
              this.samples.length -
              1
            ].createdAt
          : null,

      lastError:
        null,
    };
  }

  public getSnapshot():
    ProcessingTimeEstimatorSnapshot {
    this.ensureInitialized();

    const bounds =
      calculateSampleBounds(
        this.samples
      );

    const arithmeticAverage =
      calculateArithmeticAverage(
        this.samples,
        this.config
          .initialEstimatedItemMs
      );

    return {
      schemaVersion:
        TIME_ESTIMATOR_SCHEMA_VERSION,

      sampleCount:
        this.samples.length,

      samples:
        this.samples.map(
          cloneSample
        ),

      averageItemMs:
        this.getAverageItemMs(),

      arithmeticAverageItemMs:
        arithmeticAverage,

      smoothedAverageItemMs:
        this.smoothedAverageItemMs,

      minimumSampleMs:
        bounds.minimum,

      maximumSampleMs:
        bounds.maximum,

      latestSampleMs:
        this.samples.length >
          0
          ? this.samples[
              this.samples.length -
              1
            ].durationMs
          : null,

      hasEnoughSamples:
        this.hasEnoughSamples(),

      createdAt:
        this.createdAt,

      updatedAt:
        this.updatedAt,
    };
  }

  public getDiagnostics():
    ProcessingTimeEstimatorDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  public dispose():
    void {
    if (
      this.disposed
    ) {
      return;
    }

    this.samples.length =
      0;

    this.initialized =
      false;

    this.disposed =
      true;

    this.diagnostics = {
      ...this.diagnostics,

      initialized:
        false,

      disposed:
        true,

      sampleCount:
        0,
    };
  }

  private calculateNextSmoothedAverage(
    latestDurationMs:
      ProcessingDurationMs
  ): ProcessingDurationMs {
    if (
      this.samples.length <=
      1
    ) {
      return this.normalizeEstimate(
        latestDurationMs
      );
    }

    const smoothingFactor =
      this.config
        .smoothingFactor;

    return this.normalizeEstimate(
      (
        latestDurationMs *
        smoothingFactor
      ) +
      (
        this.smoothedAverageItemMs *
        (
          1 -
          smoothingFactor
        )
      )
    );
  }

  private recalculateSmoothedAverage():
    void {
    if (
      this.samples.length ===
        0
    ) {
      this.smoothedAverageItemMs =
        this.config
          .initialEstimatedItemMs;

      return;
    }

    let average =
      this.config
        .initialEstimatedItemMs;

    for (
      const sample of this.samples
    ) {
      average =
        this.normalizeEstimate(
          (
            sample.durationMs *
            this.config
              .smoothingFactor
          ) +
          (
            average *
            (
              1 -
              this.config
                .smoothingFactor
            )
          )
        );
    }

    this.smoothedAverageItemMs =
      average;
  }

  private normalizeEstimate(
    value:
      number
  ): ProcessingDurationMs {
    const minimum =
      Math.max(
        1,
        normalizeProcessingDuration(
          this.config
            ?.minimumEstimatedItemMs ??
          DEFAULT_PROCESSING_TIME_ESTIMATOR_CONFIG
            .minimumEstimatedItemMs
        )
      );

    const maximum =
      Math.max(
        minimum,
        normalizeProcessingDuration(
          this.config
            ?.maximumEstimatedItemMs ??
          DEFAULT_PROCESSING_TIME_ESTIMATOR_CONFIG
            .maximumEstimatedItemMs
        )
      );

    const fallback =
      normalizeProcessingDuration(
        this.config
          ?.initialEstimatedItemMs ??
        DEFAULT_ESTIMATED_ITEM_PROCESSING_MS
      );

    if (
      !Number.isFinite(
        value
      ) ||
      value <=
        0
    ) {
      return clampInteger(
        fallback,
        minimum,
        maximum,
        DEFAULT_ESTIMATED_ITEM_PROCESSING_MS
      );
    }

    return clampInteger(
      value,
      minimum,
      maximum,
      fallback
    );
  }

  private ensureInitialized():
    void {
    this.assertNotDisposed();

    if (
      !this.initialized
    ) {
      this.initialize();
    }
  }

  private assertNotDisposed():
    void {
    if (
      this.disposed
    ) {
      throw new Error(
        'Processing time estimator has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultProcessingTimeEstimator:
  ProcessingTimeEstimator | null =
    null;

export function getDefaultProcessingTimeEstimator():
  ProcessingTimeEstimator {
  if (
    !defaultProcessingTimeEstimator
  ) {
    defaultProcessingTimeEstimator =
      new ProcessingTimeEstimator();

    defaultProcessingTimeEstimator
      .initialize();
  }

  return defaultProcessingTimeEstimator;
}

export function disposeDefaultProcessingTimeEstimator():
  void {
  if (
    !defaultProcessingTimeEstimator
  ) {
    return;
  }

  defaultProcessingTimeEstimator
    .dispose();

  defaultProcessingTimeEstimator =
    null;
}

/* =========================================================
 * Convenience helpers
 * ======================================================= */

export function estimateProcessingQueueTime(
  snapshot:
    ProcessingQueueSnapshot
): ProcessingQueueTimeEstimate {
  return getDefaultProcessingTimeEstimator()
    .estimateQueue(
      snapshot
    );
}

export function estimateProcessingJobTime(
  job:
    ProcessingJob
): ProcessingItemTimeEstimate {
  return getDefaultProcessingTimeEstimator()
    .estimateJob(
      job
    );
}

export function addCompletedProcessingJobTimeSample(
  job:
    ProcessingJob
): ProcessingTimeSample | null {
  return getDefaultProcessingTimeEstimator()
    .addCompletedJob(
      job
    );
}

export function getAverageProcessingItemMs():
  ProcessingDurationMs {
  return getDefaultProcessingTimeEstimator()
    .getAverageItemMs();
}