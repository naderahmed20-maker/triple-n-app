// scan/core/native/NativeProcessingStorage.ts
//
// Triple N - Native Processing Persistent Storage
//
// هذا الملف مسؤول عن التخزين الدائم لحالة
// Native Scan Item Processing.
//
// مسؤولياته:
//
// 1) حفظ Native Job Payload.
// 2) حفظ آخر Progress.
// 3) حفظ النتيجة النهائية.
// 4) استرجاع Jobs بعد إعادة فتح التطبيق.
// 5) منع الكتابة المتزامنة على نفس التخزين.
// 6) اكتشاف البيانات القديمة أو التالفة.
// 7) تنظيف Jobs المكتملة القديمة.
// 8) عدم تخزين TypedArrays أو SegmentationResult.
//
// هذا الملف لا يشغّل EdgeSAM.
// لا يبدأ Native Tasks.
// لا يحدّث الدولاب.
// لا يرسل إشعارات.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
    NATIVE_PROCESSING_CONTRACT_VERSION,
    NATIVE_PROCESSING_STATE_VERSION,
    createNativeProcessingPersistedRecord,
    isNativeProcessingJobPayload,
    isNativeProcessingJobResult,
    normalizeNativeProcessingTimestamp,
} from './NativeProcessingContracts';

import type {
    NativeProcessingError,
    NativeProcessingExecutorState,
    NativeProcessingJobPayload,
    NativeProcessingJobResult,
    NativeProcessingPersistedRecord,
    NativeProcessingProgress,
    NativeProcessingRuntime,
} from './NativeProcessingContracts';

import type {
    ProcessingJobId,
    ProcessingTimestamp,
} from '../queue/QueueTypes';

/* =========================================================
 * Constants
 * ======================================================= */

export const NATIVE_PROCESSING_STORAGE_KEY =
  'TRIPLE_N_NATIVE_PROCESSING_STORAGE_V1';

export const NATIVE_PROCESSING_STORAGE_SCHEMA_VERSION =
  1 as const;

export const DEFAULT_NATIVE_PROCESSING_RECORD_RETENTION_MS =
  7 *
  24 *
  60 *
  60 *
  1000;

export const DEFAULT_NATIVE_PROCESSING_MAXIMUM_RECORDS =
  100;

export const DEFAULT_NATIVE_PROCESSING_WRITE_DEBOUNCE_MS =
  100;

/* =========================================================
 * Types
 * ======================================================= */

export type NativeProcessingStorageSchemaVersion =
  typeof NATIVE_PROCESSING_STORAGE_SCHEMA_VERSION;

export type NativeProcessingStoredSnapshot = {
  schemaVersion:
    NativeProcessingStorageSchemaVersion;

  records:
    readonly NativeProcessingPersistedRecord[];

  createdAt:
    ProcessingTimestamp;

  updatedAt:
    ProcessingTimestamp;

  revision:
    number;
};

export type NativeProcessingStorageStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'clearing'
  | 'failed'
  | 'disposed';

export type NativeProcessingStorageDiagnostics = {
  status:
    NativeProcessingStorageStatus;

  initialized:
    boolean;

  disposed:
    boolean;

  recordCount:
    number;

  readCount:
    number;

  successfulReadCount:
    number;

  failedReadCount:
    number;

  writeCount:
    number;

  successfulWriteCount:
    number;

  failedWriteCount:
    number;

  removeCount:
    number;

  clearCount:
    number;

  cleanupCount:
    number;

  corruptedSnapshotCount:
    number;

  rejectedRecordCount:
    number;

  lastReadAt:
    ProcessingTimestamp | null;

  lastWriteAt:
    ProcessingTimestamp | null;

  lastRemoveAt:
    ProcessingTimestamp | null;

  lastClearAt:
    ProcessingTimestamp | null;

  lastCleanupAt:
    ProcessingTimestamp | null;

  lastError:
    string | null;
};

export type NativeProcessingStorageOptions = {
  storageKey:
    string;

  maximumRecords:
    number;

  completedRecordRetentionMs:
    number;

  writeDebounceMs:
    number;

  autoInitialize:
    boolean;

  enableDebugLogs:
    boolean;
};

export type PartialNativeProcessingStorageOptions =
  Partial<
    NativeProcessingStorageOptions
  >;

export type NativeProcessingStorageReadResult = {
  snapshot:
    NativeProcessingStoredSnapshot;

  restored:
    boolean;

  corrupted:
    boolean;

  rejectedRecordCount:
    number;
};

export type NativeProcessingStorageWriteResult = {
  saved:
    boolean;

  revision:
    number;

  recordCount:
    number;

  savedAt:
    ProcessingTimestamp;
};

export type NativeProcessingStorageRemoveResult = {
  removed:
    boolean;

  jobId:
    ProcessingJobId;

  remainingRecordCount:
    number;

  revision:
    number;
};

export type NativeProcessingStorageClearResult = {
  cleared:
    boolean;

  removedRecordCount:
    number;

  clearedAt:
    ProcessingTimestamp;
};

export type NativeProcessingStorageCleanupResult = {
  removedRecordCount:
    number;

  retainedRecordCount:
    number;

  cleanedAt:
    ProcessingTimestamp;

  revision:
    number;
};

/* =========================================================
 * Defaults
 * ======================================================= */

export const DEFAULT_NATIVE_PROCESSING_STORAGE_OPTIONS:
  NativeProcessingStorageOptions = {
    storageKey:
      NATIVE_PROCESSING_STORAGE_KEY,

    maximumRecords:
      DEFAULT_NATIVE_PROCESSING_MAXIMUM_RECORDS,

    completedRecordRetentionMs:
      DEFAULT_NATIVE_PROCESSING_RECORD_RETENTION_MS,

    writeDebounceMs:
      DEFAULT_NATIVE_PROCESSING_WRITE_DEBOUNCE_MS,

    autoInitialize:
      true,

    enableDebugLogs:
      false,
  };

/* =========================================================
 * Internal helpers
 * ======================================================= */

function now():
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
      serialized
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

function normalizePositiveInteger(
  value:
    number,
  fallback:
    number
): number {
  if (
    !Number.isFinite(
      value
    ) ||
    value <=
      0
  ) {
    return Math.max(
      1,
      Math.floor(
        fallback
      )
    );
  }

  return Math.max(
    1,
    Math.floor(
      value
    )
  );
}

function normalizeNonNegativeDuration(
  value:
    number,
  fallback:
    number
): number {
  if (
    !Number.isFinite(
      value
    ) ||
    value <
      0
  ) {
    return Math.max(
      0,
      Math.floor(
        fallback
      )
    );
  }

  return Math.max(
    0,
    Math.floor(
      value
    )
  );
}

function normalizeOptions(
  options:
    PartialNativeProcessingStorageOptions
): NativeProcessingStorageOptions {
  const merged = {
    ...DEFAULT_NATIVE_PROCESSING_STORAGE_OPTIONS,
    ...options,
  };

  const storageKey =
    typeof merged.storageKey ===
      'string' &&
    merged.storageKey.trim().length >
      0
      ? merged.storageKey.trim()
      : NATIVE_PROCESSING_STORAGE_KEY;

  return {
    storageKey,

    maximumRecords:
      normalizePositiveInteger(
        merged.maximumRecords,
        DEFAULT_NATIVE_PROCESSING_MAXIMUM_RECORDS
      ),

    completedRecordRetentionMs:
      normalizeNonNegativeDuration(
        merged
          .completedRecordRetentionMs,
        DEFAULT_NATIVE_PROCESSING_RECORD_RETENTION_MS
      ),

    writeDebounceMs:
      normalizeNonNegativeDuration(
        merged.writeDebounceMs,
        DEFAULT_NATIVE_PROCESSING_WRITE_DEBOUNCE_MS
      ),

    autoInitialize:
      merged.autoInitialize,

    enableDebugLogs:
      merged.enableDebugLogs,
  };
}

function createEmptyStoredSnapshot(
  timestamp =
    now()
): NativeProcessingStoredSnapshot {
  const safeTimestamp =
    normalizeNativeProcessingTimestamp(
      timestamp
    );

  return {
    schemaVersion:
      NATIVE_PROCESSING_STORAGE_SCHEMA_VERSION,

    records:
      [],

    createdAt:
      safeTimestamp,

    updatedAt:
      safeTimestamp,

    revision:
      0,
  };
}

function cloneNativeProcessingError(
  error:
    NativeProcessingError | null
): NativeProcessingError | null {
  if (
    !error
  ) {
    return null;
  }

  return {
    ...error,

    metadata: {
      ...error.metadata,
    },
  };
}

function cloneNativeProcessingPayload(
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

function cloneNativeProcessingProgress(
  progress:
    NativeProcessingProgress
): NativeProcessingProgress {
  return {
    ...progress,
  };
}

function cloneNativeProcessingResult(
  result:
    NativeProcessingJobResult | null
): NativeProcessingJobResult | null {
  if (
    !result
  ) {
    return null;
  }

  return {
    ...result,

    output:
      result.output
        ? {
            ...result.output,

            metadata: {
              ...result.output
                .metadata,
            },
          }
        : null,

    error:
      cloneNativeProcessingError(
        result.error
      ),
  };
}

function cloneNativeProcessingRecord(
  record:
    NativeProcessingPersistedRecord
): NativeProcessingPersistedRecord {
  return {
    ...record,

    payload:
      cloneNativeProcessingPayload(
        record.payload
      ),

    progress:
      cloneNativeProcessingProgress(
        record.progress
      ),

    result:
      cloneNativeProcessingResult(
        record.result
      ),
  };
}

function cloneStoredSnapshot(
  snapshot:
    NativeProcessingStoredSnapshot
): NativeProcessingStoredSnapshot {
  return {
    ...snapshot,

    records:
      snapshot.records.map(
        cloneNativeProcessingRecord
      ),
  };
}

function isNativeProcessingExecutorState(
  value:
    unknown
): value is NativeProcessingExecutorState {
  return (
    value ===
      'idle' ||
    value ===
      'scheduled' ||
    value ===
      'starting' ||
    value ===
      'running' ||
    value ===
      'suspending' ||
    value ===
      'suspended' ||
    value ===
      'resuming' ||
    value ===
      'finishing' ||
    value ===
      'completed' ||
    value ===
      'failed' ||
    value ===
      'cancelled' ||
    value ===
      'expired' ||
    value ===
      'interrupted'
  );
}

function isNativeProcessingRuntime(
  value:
    unknown
): value is NativeProcessingRuntime {
  return (
    value ===
      'ios-bg-processing' ||
    value ===
      'ios-continued-processing' ||
    value ===
      'android-work-manager' ||
    value ===
      'android-foreground-service' ||
    value ===
      'foreground-fallback' ||
    value ===
      'unknown'
  );
}

function isValidNativeProcessingProgress(
  value:
    unknown,
  expectedJobId:
    string
): value is NativeProcessingProgress {
  if (
    typeof value !==
      'object' ||
    value ===
      null
  ) {
    return false;
  }

  const progress =
    value as Partial<
      NativeProcessingProgress
    >;

  return (
    progress.contractVersion ===
      NATIVE_PROCESSING_CONTRACT_VERSION &&
    progress.jobId ===
      expectedJobId &&
    typeof progress.queueId ===
      'string' &&
    progress.queueId.length >
      0 &&
    typeof progress.batchId ===
      'string' &&
    progress.batchId.length >
      0 &&
    typeof progress.status ===
      'string' &&
    isNativeProcessingExecutorState(
      progress.executorState
    ) &&
    typeof progress.stage ===
      'string' &&
    typeof progress.progress ===
      'number' &&
    Number.isFinite(
      progress.progress
    ) &&
    typeof progress.percentage ===
      'number' &&
    Number.isFinite(
      progress.percentage
    ) &&
    typeof progress.message ===
      'string' &&
    typeof progress.updatedAt ===
      'number' &&
    Number.isFinite(
      progress.updatedAt
    ) &&
    isNativeProcessingRuntime(
      progress.runtime
    ) &&
    typeof progress.attempt ===
      'number' &&
    Number.isFinite(
      progress.attempt
    )
  );
}

function restoreNativeProcessingRecord(
  value:
    unknown
): NativeProcessingPersistedRecord | null {
  if (
    typeof value !==
      'object' ||
    value ===
      null
  ) {
    return null;
  }

  const record =
    value as Partial<
      NativeProcessingPersistedRecord
    >;

  if (
    record.stateVersion !==
      NATIVE_PROCESSING_STATE_VERSION ||
    !isNativeProcessingJobPayload(
      record.payload
    ) ||
    !isValidNativeProcessingProgress(
      record.progress,
      record.payload.jobId
    )
  ) {
    return null;
  }

  if (
    record.result !==
      null &&
    record.result !==
      undefined &&
    !isNativeProcessingJobResult(
      record.result
    )
  ) {
    return null;
  }

  const createdAt =
    normalizeNativeProcessingTimestamp(
      record.createdAt,
      record.payload.createdAt
    );

  const updatedAt =
    normalizeNativeProcessingTimestamp(
      record.updatedAt,
      createdAt
    );

  const revision =
    typeof record.revision ===
      'number' &&
    Number.isFinite(
      record.revision
    ) &&
    record.revision >=
      0
      ? Math.floor(
          record.revision
        )
      : 0;

  return {
    stateVersion:
      NATIVE_PROCESSING_STATE_VERSION,

    payload:
      cloneNativeProcessingPayload(
        record.payload
      ),

    progress:
      cloneNativeProcessingProgress(
        record.progress
      ),

    result:
      record.result
        ? cloneNativeProcessingResult(
            record.result
          )
        : null,

    createdAt,

    updatedAt,

    revision,
  };
}

function parseStoredSnapshot(
  raw:
    string | null
): NativeProcessingStorageReadResult {
  if (
    !raw
  ) {
    return {
      snapshot:
        createEmptyStoredSnapshot(),

      restored:
        false,

      corrupted:
        false,

      rejectedRecordCount:
        0,
    };
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw
      );
  } catch {
    return {
      snapshot:
        createEmptyStoredSnapshot(),

      restored:
        false,

      corrupted:
        true,

      rejectedRecordCount:
        0,
    };
  }

  if (
    typeof parsed !==
      'object' ||
    parsed ===
      null
  ) {
    return {
      snapshot:
        createEmptyStoredSnapshot(),

      restored:
        false,

      corrupted:
        true,

      rejectedRecordCount:
        0,
    };
  }

  const candidate =
    parsed as Partial<
      NativeProcessingStoredSnapshot
    >;

  if (
    candidate.schemaVersion !==
      NATIVE_PROCESSING_STORAGE_SCHEMA_VERSION ||
    !Array.isArray(
      candidate.records
    )
  ) {
    return {
      snapshot:
        createEmptyStoredSnapshot(),

      restored:
        false,

      corrupted:
        true,

      rejectedRecordCount:
        0,
    };
  }

  const restoredRecords:
    NativeProcessingPersistedRecord[] =
      [];

  let rejectedRecordCount =
    0;

  for (
    const rawRecord of
    candidate.records
  ) {
    const restored =
      restoreNativeProcessingRecord(
        rawRecord
      );

    if (
      restored
    ) {
      restoredRecords.push(
        restored
      );
    } else {
      rejectedRecordCount +=
        1;
    }
  }

  const createdAt =
    normalizeNativeProcessingTimestamp(
      candidate.createdAt
    );

  const updatedAt =
    normalizeNativeProcessingTimestamp(
      candidate.updatedAt,
      createdAt
    );

  const revision =
    typeof candidate.revision ===
      'number' &&
    Number.isFinite(
      candidate.revision
    ) &&
    candidate.revision >=
      0
      ? Math.floor(
          candidate.revision
        )
      : 0;

  return {
    snapshot: {
      schemaVersion:
        NATIVE_PROCESSING_STORAGE_SCHEMA_VERSION,

      records:
        restoredRecords,

      createdAt,

      updatedAt,

      revision,
    },

    restored:
      true,

    corrupted:
      false,

    rejectedRecordCount,
  };
}

function sortRecordsForStorage(
  records:
    readonly NativeProcessingPersistedRecord[]
): NativeProcessingPersistedRecord[] {
  return [
    ...records,
  ].sort(
    (
      first,
      second
    ) => {
      const firstTerminal =
        first.result !==
          null;

      const secondTerminal =
        second.result !==
          null;

      if (
        firstTerminal !==
        secondTerminal
      ) {
        return firstTerminal
          ? 1
          : -1;
      }

      return (
        second.updatedAt -
        first.updatedAt
      );
    }
  );
}

function enforceRecordLimit(
  records:
    readonly NativeProcessingPersistedRecord[],
  maximumRecords:
    number
): NativeProcessingPersistedRecord[] {
  const sorted =
    sortRecordsForStorage(
      records
    );

  if (
    sorted.length <=
      maximumRecords
  ) {
    return sorted;
  }

  const activeRecords =
    sorted.filter(
      record =>
        record.result ===
          null
    );

  const terminalRecords =
    sorted.filter(
      record =>
        record.result !==
          null
    );

  const remainingCapacity =
    Math.max(
      0,
      maximumRecords -
        activeRecords.length
    );

  return [
    ...activeRecords,
    ...terminalRecords.slice(
      0,
      remainingCapacity
    ),
  ];
}

/* =========================================================
 * Storage class
 * ======================================================= */

export class NativeProcessingStorage {
  private readonly options:
    NativeProcessingStorageOptions;

  private snapshot:
    NativeProcessingStoredSnapshot =
      createEmptyStoredSnapshot();

  private diagnostics:
    NativeProcessingStorageDiagnostics;

  private initialized =
    false;

  private disposed =
    false;

  private operationChain:
    Promise<void> =
      Promise.resolve();

  private pendingWriteTimer:
    ReturnType<
      typeof setTimeout
    > | null =
      null;

  private pendingWritePromise:
    Promise<
      NativeProcessingStorageWriteResult
    > | null =
      null;

  private pendingWriteResolve:
    (
      value:
        NativeProcessingStorageWriteResult
    ) => void =
      () => {};

  private pendingWriteReject:
    (
      reason?:
        unknown
    ) => void =
      () => {};

  public constructor(
    options:
      PartialNativeProcessingStorageOptions =
        {}
  ) {
    this.options =
      normalizeOptions(
        options
      );

    this.diagnostics = {
      status:
        'idle',

      initialized:
        false,

      disposed:
        false,

      recordCount:
        0,

      readCount:
        0,

      successfulReadCount:
        0,

      failedReadCount:
        0,

      writeCount:
        0,

      successfulWriteCount:
        0,

      failedWriteCount:
        0,

      removeCount:
        0,

      clearCount:
        0,

      cleanupCount:
        0,

      corruptedSnapshotCount:
        0,

      rejectedRecordCount:
        0,

      lastReadAt:
        null,

      lastWriteAt:
        null,

      lastRemoveAt:
        null,

      lastClearAt:
        null,

      lastCleanupAt:
        null,

      lastError:
        null,
    };

    if (
      this.options
        .autoInitialize
    ) {
      void this.initialize()
        .catch(
          error => {
            if (
              this.options
                .enableDebugLogs
            ) {
              console.warn(
                'TRIPLE N NATIVE PROCESSING STORAGE INITIALIZATION ERROR:',
                error
              );
            }
          }
        );
    }
  }

  /* =======================================================
   * Initialization
   * ===================================================== */

  public async initialize():
    Promise<
      NativeProcessingStorageReadResult
    > {
    this.assertNotDisposed();

    return this.enqueueOperation(
      async () => {
        if (
          this.initialized
        ) {
          return {
            snapshot:
              cloneStoredSnapshot(
                this.snapshot
              ),

            restored:
              true,

            corrupted:
              false,

            rejectedRecordCount:
              0,
          };
        }

        this.updateDiagnostics({
          status:
            'loading',

          readCount:
            this.diagnostics
              .readCount +
            1,

          lastError:
            null,
        });

        try {
          const raw =
            await AsyncStorage
              .getItem(
                this.options
                  .storageKey
              );

          const result =
            parseStoredSnapshot(
              raw
            );

          this.snapshot =
            cloneStoredSnapshot(
              result.snapshot
            );

          this.initialized =
            true;

          const readAt =
            now();

          this.updateDiagnostics({
            status:
              'ready',

            initialized:
              true,

            recordCount:
              this.snapshot
                .records
                .length,

            successfulReadCount:
              this.diagnostics
                .successfulReadCount +
              1,

            corruptedSnapshotCount:
              this.diagnostics
                .corruptedSnapshotCount +
              (
                result.corrupted
                  ? 1
                  : 0
              ),

            rejectedRecordCount:
              this.diagnostics
                .rejectedRecordCount +
              result
                .rejectedRecordCount,

            lastReadAt:
              readAt,

            lastError:
              null,
          });

          if (
            result.corrupted
          ) {
            await AsyncStorage
              .removeItem(
                this.options
                  .storageKey
              );

            this.snapshot =
              createEmptyStoredSnapshot(
                readAt
              );
          }

          return {
            ...result,

            snapshot:
              cloneStoredSnapshot(
                this.snapshot
              ),
          };
        } catch (error) {
          const message =
            getUnknownErrorMessage(
              error
            );

          this.updateDiagnostics({
            status:
              'failed',

            failedReadCount:
              this.diagnostics
                .failedReadCount +
              1,

            lastReadAt:
              now(),

            lastError:
              message,
          });

          throw new Error(
            `Unable to load native processing storage: ${message}`
          );
        }
      }
    );
  }

  private async ensureInitialized():
    Promise<void> {
    if (
      this.initialized
    ) {
      return;
    }

    await this.initialize();
  }

  /* =======================================================
   * Read
   * ===================================================== */

  public async readSnapshot():
    Promise<
      NativeProcessingStoredSnapshot
    > {
    this.assertNotDisposed();

    await this.ensureInitialized();

    return cloneStoredSnapshot(
      this.snapshot
    );
  }

  public async getAllRecords():
    Promise<
      NativeProcessingPersistedRecord[]
    > {
    const snapshot =
      await this.readSnapshot();

    return snapshot.records.map(
      cloneNativeProcessingRecord
    );
  }

  public async getRecord(
    jobId:
      ProcessingJobId
  ): Promise<
    NativeProcessingPersistedRecord | null
  > {
    this.assertNotDisposed();

    await this.ensureInitialized();

    const record =
      this.snapshot
        .records
        .find(
          candidate =>
            candidate
              .payload
              .jobId ===
            jobId
        );

    return record
      ? cloneNativeProcessingRecord(
          record
        )
      : null;
  }

  public async getPendingRecords():
    Promise<
      NativeProcessingPersistedRecord[]
    > {
    const records =
      await this.getAllRecords();

    return records.filter(
      record =>
        record.result ===
          null
    );
  }

  public async getCompletedRecords():
    Promise<
      NativeProcessingPersistedRecord[]
    > {
    const records =
      await this.getAllRecords();

    return records.filter(
      record =>
        record.result !==
          null
    );
  }

  /* =======================================================
   * Upsert payload
   * ===================================================== */

  public async upsertPayload(
    payload:
      NativeProcessingJobPayload,
    options: {
      flushImmediately?:
        boolean;
    } = {}
  ): Promise<
    NativeProcessingPersistedRecord
  > {
    this.assertNotDisposed();

    if (
      !isNativeProcessingJobPayload(
        payload
      )
    ) {
      throw new Error(
        'The native processing payload is invalid.'
      );
    }

    await this.ensureInitialized();

    const existingIndex =
      this.snapshot
        .records
        .findIndex(
          record =>
            record
              .payload
              .jobId ===
            payload.jobId
        );

    const timestamp =
      now();

    let record:
      NativeProcessingPersistedRecord;

    if (
      existingIndex >=
        0
    ) {
      const existing =
        this.snapshot
          .records[
            existingIndex
          ];

      record = {
        ...existing,

        payload:
          cloneNativeProcessingPayload(
            payload
          ),

        updatedAt:
          timestamp,

        revision:
          existing.revision +
          1,
      };
    } else {
      record =
        createNativeProcessingPersistedRecord(
          cloneNativeProcessingPayload(
            payload
          )
        );
    }

    const nextRecords =
      [
        ...this.snapshot.records,
      ];

    if (
      existingIndex >=
        0
    ) {
      nextRecords[
        existingIndex
      ] =
        record;
    } else {
      nextRecords.push(
        record
      );
    }

    this.replaceRecords(
      nextRecords,
      timestamp
    );

    await this.requestWrite(
      options.flushImmediately ===
        true
    );

    return cloneNativeProcessingRecord(
      record
    );
  }

  /* =======================================================
   * Update progress
   * ===================================================== */

  public async updateProgress(
    progress:
      NativeProcessingProgress,
    options: {
      flushImmediately?:
        boolean;
    } = {}
  ): Promise<
    NativeProcessingPersistedRecord
  > {
    this.assertNotDisposed();

    await this.ensureInitialized();

    const recordIndex =
      this.snapshot
        .records
        .findIndex(
          record =>
            record
              .payload
              .jobId ===
            progress.jobId
        );

    if (
      recordIndex <
        0
    ) {
      throw new Error(
        `Native processing record was not found for job ${progress.jobId}.`
      );
    }

    const current =
      this.snapshot
        .records[
          recordIndex
        ];

    if (
      !isValidNativeProcessingProgress(
        progress,
        current
          .payload
          .jobId
      )
    ) {
      throw new Error(
        'The native processing progress is invalid.'
      );
    }

    const timestamp =
      now();

    const updatedRecord:
      NativeProcessingPersistedRecord = {
        ...current,

        progress:
          cloneNativeProcessingProgress(
            progress
          ),

        updatedAt:
          timestamp,

        revision:
          current.revision +
          1,
    };

    const nextRecords =
      [
        ...this.snapshot.records,
      ];

    nextRecords[
      recordIndex
    ] =
      updatedRecord;

    this.replaceRecords(
      nextRecords,
      timestamp
    );

    await this.requestWrite(
      options.flushImmediately ===
        true
    );

    return cloneNativeProcessingRecord(
      updatedRecord
    );
  }

  /* =======================================================
   * Complete result
   * ===================================================== */

  public async setResult(
    result:
      NativeProcessingJobResult,
    options: {
      flushImmediately?:
        boolean;
    } = {
      flushImmediately:
        true,
    }
  ): Promise<
    NativeProcessingPersistedRecord
  > {
    this.assertNotDisposed();

    if (
      !isNativeProcessingJobResult(
        result
      )
    ) {
      throw new Error(
        'The native processing result is invalid.'
      );
    }

    await this.ensureInitialized();

    const recordIndex =
      this.snapshot
        .records
        .findIndex(
          record =>
            record
              .payload
              .jobId ===
            result.jobId
        );

    if (
      recordIndex <
        0
    ) {
      throw new Error(
        `Native processing record was not found for job ${result.jobId}.`
      );
    }

    const current =
      this.snapshot
        .records[
          recordIndex
        ];

    const timestamp =
      now();

    const executorState:
      NativeProcessingExecutorState =
      result.succeeded
        ? 'completed'
        : result.cancelled
          ? 'cancelled'
          : result.expired
            ? 'expired'
            : result.interrupted
              ? 'interrupted'
              : 'failed';

    const finalProgress:
      NativeProcessingProgress = {
        ...current.progress,

        status:
          result.succeeded
            ? 'completed'
            : result.cancelled
              ? 'cancelled'
              : result.interrupted
                ? 'interrupted'
                : 'failed',

        executorState,

        stage:
          result.succeeded
            ? 'complete'
            : result.cancelled
              ? 'cancelled'
              : 'failed',

        progress:
          result.succeeded
            ? 1
            : current.progress
                .progress,

        percentage:
          result.succeeded
            ? 100
            : current.progress
                .percentage,

        message:
          result.succeeded
            ? 'Native processing completed.'
            : result.error
                ?.message ??
              (
                result.cancelled
                  ? 'Native processing was cancelled.'
                  : result.expired
                    ? 'Native processing expired.'
                    : result.interrupted
                      ? 'Native processing was interrupted.'
                      : 'Native processing failed.'
              ),

        updatedAt:
          timestamp,

        elapsedMs:
          result.startedAt
            ? Math.max(
                0,
                result.completedAt -
                  result.startedAt
              )
            : current.progress
                .elapsedMs,

        estimatedRemainingMs:
          0,

        nativeTaskId:
          result.nativeTaskId,

        runtime:
          result.runtime,

        attempt:
          result.attempt,
      };

    const updatedRecord:
      NativeProcessingPersistedRecord = {
        ...current,

        progress:
          finalProgress,

        result:
          cloneNativeProcessingResult(
            result
          ),

        updatedAt:
          timestamp,

        revision:
          current.revision +
          1,
    };

    const nextRecords =
      [
        ...this.snapshot.records,
      ];

    nextRecords[
      recordIndex
    ] =
      updatedRecord;

    this.replaceRecords(
      nextRecords,
      timestamp
    );

    await this.requestWrite(
      options.flushImmediately !==
        false
    );

    return cloneNativeProcessingRecord(
      updatedRecord
    );
  }

  /* =======================================================
   * Remove
   * ===================================================== */

  public async removeRecord(
    jobId:
      ProcessingJobId,
    options: {
      flushImmediately?:
        boolean;
    } = {
      flushImmediately:
        true,
    }
  ): Promise<
    NativeProcessingStorageRemoveResult
  > {
    this.assertNotDisposed();

    await this.ensureInitialized();

    const beforeCount =
      this.snapshot
        .records
        .length;

    const nextRecords =
      this.snapshot
        .records
        .filter(
          record =>
            record
              .payload
              .jobId !==
            jobId
        );

    const removed =
      nextRecords.length !==
      beforeCount;

    if (
      removed
    ) {
      const timestamp =
        now();

      this.replaceRecords(
        nextRecords,
        timestamp
      );

      this.updateDiagnostics({
        removeCount:
          this.diagnostics
            .removeCount +
          1,

        lastRemoveAt:
          timestamp,
      });

      await this.requestWrite(
        options.flushImmediately !==
          false
      );
    }

    return {
      removed,

      jobId,

      remainingRecordCount:
        nextRecords.length,

      revision:
        this.snapshot.revision,
    };
  }

  /* =======================================================
   * Cleanup
   * ===================================================== */

  public async cleanupOldRecords(
    input: {
      now?:
        number;

      completedRecordRetentionMs?:
        number;

      maximumRecords?:
        number;

      flushImmediately?:
        boolean;
    } = {}
  ): Promise<
    NativeProcessingStorageCleanupResult
  > {
    this.assertNotDisposed();

    await this.ensureInitialized();

    const cleanupTimestamp =
      normalizeNativeProcessingTimestamp(
        input.now
      );

    const retentionMs =
      normalizeNonNegativeDuration(
        input
          .completedRecordRetentionMs ??
        this.options
          .completedRecordRetentionMs,
        this.options
          .completedRecordRetentionMs
      );

    const maximumRecords =
      normalizePositiveInteger(
        input.maximumRecords ??
        this.options
          .maximumRecords,
        this.options
          .maximumRecords
      );

    const cutoff =
      cleanupTimestamp -
      retentionMs;

    const retainedByAge =
      this.snapshot
        .records
        .filter(
          record => {
            if (
              record.result ===
                null
            ) {
              return true;
            }

            return (
              record.updatedAt >=
              cutoff
            );
          }
        );

    const retainedRecords =
      enforceRecordLimit(
        retainedByAge,
        maximumRecords
      );

    const removedRecordCount =
      this.snapshot
        .records
        .length -
      retainedRecords.length;

    if (
      removedRecordCount >
        0
    ) {
      this.replaceRecords(
        retainedRecords,
        cleanupTimestamp
      );

      await this.requestWrite(
        input.flushImmediately !==
          false
      );
    }

    this.updateDiagnostics({
      cleanupCount:
        this.diagnostics
          .cleanupCount +
        1,

      lastCleanupAt:
        cleanupTimestamp,
    });

    return {
      removedRecordCount,

      retainedRecordCount:
        retainedRecords.length,

      cleanedAt:
        cleanupTimestamp,

      revision:
        this.snapshot.revision,
    };
  }

  /* =======================================================
   * Clear
   * ===================================================== */

  public async clear():
    Promise<
      NativeProcessingStorageClearResult
    > {
    this.assertNotDisposed();

    return this.enqueueOperation(
      async () => {
        await this.cancelPendingWrite();

        const removedRecordCount =
          this.snapshot
            .records
            .length;

        const clearedAt =
          now();

        this.updateDiagnostics({
          status:
            'clearing',

          lastError:
            null,
        });

        try {
          await AsyncStorage
            .removeItem(
              this.options
                .storageKey
            );

          this.snapshot =
            createEmptyStoredSnapshot(
              clearedAt
            );

          this.initialized =
            true;

          this.updateDiagnostics({
            status:
              'ready',

            initialized:
              true,

            recordCount:
              0,

            clearCount:
              this.diagnostics
                .clearCount +
              1,

            lastClearAt:
              clearedAt,

            lastError:
              null,
          });

          return {
            cleared:
              true,

            removedRecordCount,

            clearedAt,
          };
        } catch (error) {
          const message =
            getUnknownErrorMessage(
              error
            );

          this.updateDiagnostics({
            status:
              'failed',

            lastClearAt:
              clearedAt,

            lastError:
              message,
          });

          throw new Error(
            `Unable to clear native processing storage: ${message}`
          );
        }
      }
    );
  }

  /* =======================================================
   * Flush
   * ===================================================== */

  public async flush():
    Promise<
      NativeProcessingStorageWriteResult
    > {
    this.assertNotDisposed();

    await this.ensureInitialized();

    await this.cancelPendingWrite();

    return this.writeSnapshot();
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    NativeProcessingStorageDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  public isInitialized():
    boolean {
    return this.initialized;
  }

  public isDisposed():
    boolean {
    return this.disposed;
  }

  /* =======================================================
   * Dispose
   * ===================================================== */

  public async dispose():
    Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    try {
      if (
        this.initialized
      ) {
        await this.flush();
      } else {
        await this.cancelPendingWrite();
      }
    } catch (error) {
      if (
        this.options
          .enableDebugLogs
      ) {
        console.warn(
          'TRIPLE N NATIVE PROCESSING STORAGE DISPOSE FLUSH ERROR:',
          error
        );
      }
    }

    this.disposed =
      true;

    this.updateDiagnostics({
      status:
        'disposed',

      disposed:
        true,
    });
  }

  /* =======================================================
   * Internal state operations
   * ===================================================== */

  private replaceRecords(
    records:
      readonly NativeProcessingPersistedRecord[],
    timestamp:
      number
  ): void {
    const limitedRecords =
      enforceRecordLimit(
        records,
        this.options
          .maximumRecords
      );

    this.snapshot = {
      ...this.snapshot,

      records:
        limitedRecords.map(
          cloneNativeProcessingRecord
        ),

      updatedAt:
        normalizeNativeProcessingTimestamp(
          timestamp
        ),

      revision:
        this.snapshot.revision +
        1,
    };

    this.updateDiagnostics({
      recordCount:
        this.snapshot
          .records
          .length,
    });
  }

  private requestWrite(
    flushImmediately:
      boolean
  ): Promise<
    NativeProcessingStorageWriteResult
  > {
    if (
      flushImmediately ||
      this.options
        .writeDebounceMs <=
        0
    ) {
      return this.flush();
    }

    if (
      this.pendingWritePromise
    ) {
      return this.pendingWritePromise;
    }

    this.pendingWritePromise =
      new Promise<
        NativeProcessingStorageWriteResult
      >(
        (
          resolve,
          reject
        ) => {
          this.pendingWriteResolve =
            resolve;

          this.pendingWriteReject =
            reject;
        }
      );

    this.pendingWriteTimer =
      setTimeout(
        () => {
          const resolve =
            this.pendingWriteResolve;

          const reject =
            this.pendingWriteReject;

          this.pendingWriteTimer =
            null;

          this.pendingWritePromise =
            null;

          void this.writeSnapshot()
            .then(
              resolve
            )
            .catch(
              reject
            );
        },
        this.options
          .writeDebounceMs
      );

    return this.pendingWritePromise;
  }

  private async cancelPendingWrite():
    Promise<void> {
    if (
      this.pendingWriteTimer
    ) {
      clearTimeout(
        this.pendingWriteTimer
      );

      this.pendingWriteTimer =
        null;
    }

    if (
      this.pendingWritePromise
    ) {
      const resolve =
        this.pendingWriteResolve;

      this.pendingWritePromise =
        null;

      resolve({
        saved:
          false,

        revision:
          this.snapshot
            .revision,

        recordCount:
          this.snapshot
            .records
            .length,

        savedAt:
          now(),
      });
    }

    this.pendingWriteResolve =
      () => {};

    this.pendingWriteReject =
      () => {};
  }

  private async writeSnapshot():
    Promise<
      NativeProcessingStorageWriteResult
    > {
    return this.enqueueOperation(
      async () => {
        this.assertNotDisposed();

        this.updateDiagnostics({
          status:
            'saving',

          writeCount:
            this.diagnostics
              .writeCount +
            1,

          lastError:
            null,
        });

        const savedAt =
          now();

        const snapshotToSave:
          NativeProcessingStoredSnapshot = {
            ...cloneStoredSnapshot(
              this.snapshot
            ),

            updatedAt:
              savedAt,
          };

        try {
          await AsyncStorage
            .setItem(
              this.options
                .storageKey,
              JSON.stringify(
                snapshotToSave
              )
            );

          this.snapshot =
            snapshotToSave;

          this.updateDiagnostics({
            status:
              'ready',

            successfulWriteCount:
              this.diagnostics
                .successfulWriteCount +
              1,

            lastWriteAt:
              savedAt,

            recordCount:
              snapshotToSave
                .records
                .length,

            lastError:
              null,
          });

          return {
            saved:
              true,

            revision:
              snapshotToSave
                .revision,

            recordCount:
              snapshotToSave
                .records
                .length,

            savedAt,
          };
        } catch (error) {
          const message =
            getUnknownErrorMessage(
              error
            );

          this.updateDiagnostics({
            status:
              'failed',

            failedWriteCount:
              this.diagnostics
                .failedWriteCount +
              1,

            lastWriteAt:
              savedAt,

            lastError:
              message,
          });

          throw new Error(
            `Unable to save native processing storage: ${message}`
          );
        }
      }
    );
  }

  private enqueueOperation<
    TResult
  >(
    operation:
      () => Promise<TResult>
  ): Promise<TResult> {
    const resultPromise =
      this.operationChain
        .then(
          operation,
          operation
        );

    this.operationChain =
      resultPromise
        .then(
          () => {},
          () => {}
        );

    return resultPromise;
  }

  private updateDiagnostics(
    patch:
      Partial<
        NativeProcessingStorageDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...patch,

      initialized:
        patch.initialized ??
        this.initialized,

      disposed:
        patch.disposed ??
        this.disposed,
    };
  }

  private assertNotDisposed():
    void {
    if (
      this.disposed
    ) {
      throw new Error(
        'Native processing storage has already been disposed.'
      );
    }
  }
}

/* =========================================================
 * Shared storage instance
 * ======================================================= */

let sharedNativeProcessingStorage:
  NativeProcessingStorage | null =
    null;

export function getNativeProcessingStorage(
  options:
    PartialNativeProcessingStorageOptions =
      {}
): NativeProcessingStorage {
  if (
    !sharedNativeProcessingStorage ||
    sharedNativeProcessingStorage
      .isDisposed()
  ) {
    sharedNativeProcessingStorage =
      new NativeProcessingStorage(
        options
      );
  }

  return sharedNativeProcessingStorage;
}

export async function initializeNativeProcessingStorage(
  options:
    PartialNativeProcessingStorageOptions =
      {}
): Promise<
  NativeProcessingStorageReadResult
> {
  return getNativeProcessingStorage(
    options
  ).initialize();
}

export async function getNativeProcessingRecord(
  jobId:
    ProcessingJobId
): Promise<
  NativeProcessingPersistedRecord | null
> {
  return getNativeProcessingStorage()
    .getRecord(
      jobId
    );
}

export async function getPendingNativeProcessingRecords():
  Promise<
    NativeProcessingPersistedRecord[]
  > {
  return getNativeProcessingStorage()
    .getPendingRecords();
}

export async function persistNativeProcessingPayload(
  payload:
    NativeProcessingJobPayload,
  options: {
    flushImmediately?:
      boolean;
  } = {}
): Promise<
  NativeProcessingPersistedRecord
> {
  return getNativeProcessingStorage()
    .upsertPayload(
      payload,
      options
    );
}

export async function persistNativeProcessingProgress(
  progress:
    NativeProcessingProgress,
  options: {
    flushImmediately?:
      boolean;
  } = {}
): Promise<
  NativeProcessingPersistedRecord
> {
  return getNativeProcessingStorage()
    .updateProgress(
      progress,
      options
    );
}

export async function persistNativeProcessingResult(
  result:
    NativeProcessingJobResult
): Promise<
  NativeProcessingPersistedRecord
> {
  return getNativeProcessingStorage()
    .setResult(
      result,
      {
        flushImmediately:
          true,
      }
    );
}

export async function removeNativeProcessingRecord(
  jobId:
    ProcessingJobId
): Promise<
  NativeProcessingStorageRemoveResult
> {
  return getNativeProcessingStorage()
    .removeRecord(
      jobId,
      {
        flushImmediately:
          true,
      }
    );
}

export async function flushNativeProcessingStorage():
  Promise<
    NativeProcessingStorageWriteResult
  > {
  return getNativeProcessingStorage()
    .flush();
}

export async function clearNativeProcessingStorage():
  Promise<
    NativeProcessingStorageClearResult
  > {
  return getNativeProcessingStorage()
    .clear();
}

export async function disposeNativeProcessingStorage():
  Promise<void> {
  const storage =
    sharedNativeProcessingStorage;

  sharedNativeProcessingStorage =
    null;

  if (
    storage
  ) {
    await storage.dispose();
  }
}