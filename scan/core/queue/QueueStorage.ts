// scan/core/queue/QueueStorage.ts
//
// Triple N - Persistent Scan Item Queue Storage
//
// هذا الملف مسؤول عن التخزين الدائم لـQueue معالجة Scan Item.
//
// مسؤولياته:
//
// 1) حفظ Queue كاملة داخل AsyncStorage.
// 2) استرجاع Queue بعد إعادة فتح التطبيق.
// 3) تحويل Jobs إلى نسخة قابلة للتخزين.
// 4) استعادة Jobs التي توقفت أثناء المعالجة.
// 5) التحقق من صحة البيانات قبل استخدامها.
// 6) منع الكتابات المتداخلة.
// 7) الاحتفاظ بنسخة احتياطية آمنة.
// 8) حذف التخزين عند الحاجة.
// 9) توفير Diagnostics واضحة.
//
// هذا الملف لا يشغّل EdgeSAM.
// لا يدير ترتيب تنفيذ الصور.
// لا يرسل إشعارات.
// لا يعدّل عناصر الدولاب مباشرة.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
    ProcessingJob,
    ProcessingJobError,
    ProcessingQueueConfig,
    ProcessingQueueSnapshot,
    ProcessingQueueStatus,
    ProcessingQueueStorageVersion,
    ProcessingTimestamp,
    StoredProcessingJob,
    StoredProcessingQueueSnapshot,
} from './QueueTypes';

import {
    DEFAULT_PROCESSING_QUEUE_CONFIG,
    PROCESSING_QUEUE_SCHEMA_VERSION,
    PROCESSING_QUEUE_STORAGE_VERSION,
    calculateQueueStatistics,
    createInitialQueueSnapshot,
    isProcessingQueueStatus,
    isValidProcessingJob,
    normalizeProcessingTimestamp,
    restoreProcessingJob,
    toStoredProcessingJob,
} from './QueueTypes';

/* =========================================================
 * Storage constants
 * ======================================================= */

export const PROCESSING_QUEUE_STORAGE_KEY =
  '@triple-n/scan-item-processing-queue';

export const PROCESSING_QUEUE_BACKUP_STORAGE_KEY =
  '@triple-n/scan-item-processing-queue-backup';

export const PROCESSING_QUEUE_STORAGE_LOCK_TIMEOUT_MS =
  15_000;

export const PROCESSING_QUEUE_STORAGE_MAXIMUM_JSON_LENGTH =
  8_000_000;

export const PROCESSING_QUEUE_STORAGE_WRITE_DEBOUNCE_MS =
  150;

/* =========================================================
 * Storage types
 * ======================================================= */

export type ProcessingQueueStorageState =
  | 'idle'
  | 'reading'
  | 'writing'
  | 'clearing'
  | 'failed'
  | 'disposed';

export type ProcessingQueueStorageReadSource =
  | 'primary'
  | 'backup'
  | 'empty';

export type ProcessingQueueStorageReadResult = {
  snapshot:
    ProcessingQueueSnapshot;

  source:
    ProcessingQueueStorageReadSource;

  found:
    boolean;

  restored:
    boolean;

  recoveredFromBackup:
    boolean;

  warnings:
    readonly string[];

  durationMs:
    number;
};

export type ProcessingQueueStorageWriteResult = {
  saved:
    boolean;

  savedAt:
    ProcessingTimestamp;

  revision:
    number;

  bytes:
    number;

  durationMs:
    number;

  backupWritten:
    boolean;
};

export type ProcessingQueueStorageClearResult = {
  cleared:
    boolean;

  durationMs:
    number;
};

export type ProcessingQueueStorageDiagnostics = {
  state:
    ProcessingQueueStorageState;

  initialized:
    boolean;

  disposed:
    boolean;

  pendingWrite:
    boolean;

  writeInProgress:
    boolean;

  lastReadAt:
    ProcessingTimestamp | null;

  lastWriteAt:
    ProcessingTimestamp | null;

  lastClearAt:
    ProcessingTimestamp | null;

  lastReadSource:
    ProcessingQueueStorageReadSource | null;

  lastSavedRevision:
    number | null;

  lastSavedBytes:
    number | null;

  successfulReads:
    number;

  successfulWrites:
    number;

  failedReads:
    number;

  failedWrites:
    number;

  successfulClears:
    number;

  failedClears:
    number;

  lastError:
    ProcessingJobError | null;
};

export type ProcessingQueueStorageOptions = {
  storageKey?:
    string;

  backupStorageKey?:
    string;

  enableBackup?:
    boolean;

  writeDebounceMs?:
    number;

  maximumJsonLength?:
    number;
};

/* =========================================================
 * Internal helpers
 * ======================================================= */

function now(): number {
  return Date.now();
}

function clampNonNegativeInteger(
  value:
    number,
  fallback =
    0
): number {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    return fallback;
  }

  return Math.floor(value);
}

function getUnknownErrorMessage(
  error:
    unknown
): string {
  if (
    error instanceof Error
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
      JSON.stringify(error);

    if (
      typeof serialized ===
        'string' &&
      serialized.length >
        0
    ) {
      return serialized;
    }
  } catch {
    // نستخدم String في النهاية.
  }

  return String(error);
}

function createStorageError(
  code:
    ProcessingJobError['code'],
  message:
    string,
  metadata:
    ProcessingJobError['metadata'] =
      {}
): ProcessingJobError {
  return {
    code,

    message,

    source:
      'storage',

    retryable:
      true,

    occurredAt:
      now(),

    attempt:
      0,

    stage:
      null,

    nativeCode:
      null,

    segmentationErrorCode:
      null,

    metadata,
  };
}

function cloneQueueConfig(
  config:
    ProcessingQueueConfig
): ProcessingQueueConfig {
  return {
    ...config,

    retryPolicy: {
      ...config.retryPolicy,

      retryableErrorCodes:
        [
          ...config
            .retryPolicy
            .retryableErrorCodes,
        ],
    },
  };
}

function cloneProcessingJob(
  job:
    ProcessingJob
): ProcessingJob {
  return {
    ...job,

    source: {
      ...job.source,

      metadata: {
        ...job.source.metadata,
      },
    },

    wardrobe: {
      ...job.wardrobe,

      metadata: {
        ...job.wardrobe.metadata,
      },
    },

    output:
      job.output
        ? {
            ...job.output,

            metadata: {
              ...job.output.metadata,
            },
          }
        : null,

    progress: {
      ...job.progress,

      segmentationProgress:
        job.progress
          .segmentationProgress
          ? {
              ...job.progress
                .segmentationProgress,

              metadata:
                job.progress
                  .segmentationProgress
                  .metadata
                  ? {
                      ...job
                        .progress
                        .segmentationProgress
                        .metadata,
                    }
                  : undefined,
            }
          : null,
    },

    timing: {
      ...job.timing,
    },

    retry: {
      ...job.retry,
    },

    retryPolicy: {
      ...job.retryPolicy,

      retryableErrorCodes:
        [
          ...job
            .retryPolicy
            .retryableErrorCodes,
        ],
    },

    background: {
      ...job.background,
    },

    error:
      job.error
        ? {
            ...job.error,

            metadata: {
              ...job.error.metadata,
            },
          }
        : null,

    metadata: {
      ...job.metadata,
    },
  };
}

function cloneQueueSnapshot(
  snapshot:
    ProcessingQueueSnapshot
): ProcessingQueueSnapshot {
  return {
    ...snapshot,

    jobs:
      snapshot.jobs.map(
        cloneProcessingJob
      ),

    config:
      cloneQueueConfig(
        snapshot.config
      ),

    statistics: {
      ...snapshot.statistics,
    },

    timing: {
      ...snapshot.timing,
    },

    lastError:
      snapshot.lastError
        ? {
            ...snapshot.lastError,

            metadata: {
              ...snapshot
                .lastError
                .metadata,
            },
          }
        : null,
  };
}

function normalizeStorageKey(
  value:
    string | undefined,
  fallback:
    string
): string {
  const normalized =
    value?.trim();

  return normalized
    ? normalized
    : fallback;
}

function isPlainObject(
  value:
    unknown
): value is Record<string, unknown> {
  return (
    typeof value ===
      'object' &&
    value !==
      null &&
    !Array.isArray(value)
  );
}

function isValidStorageVersion(
  value:
    unknown
): value is ProcessingQueueStorageVersion {
  return (
    value ===
    PROCESSING_QUEUE_STORAGE_VERSION
  );
}

function isStoredProcessingJobLike(
  value:
    unknown
): value is StoredProcessingJob {
  if (
    !isPlainObject(value)
  ) {
    return false;
  }

  const possibleJob =
    value as Partial<
      StoredProcessingJob
    >;

  return (
    possibleJob.schemaVersion ===
      PROCESSING_QUEUE_SCHEMA_VERSION &&
    typeof possibleJob.id ===
      'string' &&
    possibleJob.id.length >
      0 &&
    typeof possibleJob.queueId ===
      'string' &&
    possibleJob.queueId.length >
      0 &&
    typeof possibleJob.batchId ===
      'string' &&
    possibleJob.batchId.length >
      0 &&
    typeof possibleJob.requestId ===
      'string' &&
    possibleJob.requestId.length >
      0 &&
    typeof possibleJob
      .wardrobeItemId ===
      'string' &&
    possibleJob
      .wardrobeItemId
      .length >
      0 &&
    typeof possibleJob.source ===
      'object' &&
    possibleJob.source !==
      null &&
    typeof possibleJob.progress ===
      'object' &&
    possibleJob.progress !==
      null &&
    typeof possibleJob.timing ===
      'object' &&
    possibleJob.timing !==
      null
  );
}

function isStoredQueueSnapshotLike(
  value:
    unknown
): value is StoredProcessingQueueSnapshot {
  if (
    !isPlainObject(value)
  ) {
    return false;
  }

  const possibleSnapshot =
    value as Partial<
      StoredProcessingQueueSnapshot
    >;

  return (
    isValidStorageVersion(
      possibleSnapshot
        .storageVersion
    ) &&
    possibleSnapshot
      .schemaVersion ===
      PROCESSING_QUEUE_SCHEMA_VERSION &&
    typeof possibleSnapshot.queueId ===
      'string' &&
    possibleSnapshot.queueId.length >
      0 &&
    isProcessingQueueStatus(
      possibleSnapshot.status
    ) &&
    Array.isArray(
      possibleSnapshot.jobs
    ) &&
    possibleSnapshot.jobs.every(
      isStoredProcessingJobLike
    ) &&
    typeof possibleSnapshot.config ===
      'object' &&
    possibleSnapshot.config !==
      null &&
    typeof possibleSnapshot.timing ===
      'object' &&
    possibleSnapshot.timing !==
      null &&
    typeof possibleSnapshot.revision ===
      'number' &&
    Number.isFinite(
      possibleSnapshot.revision
    ) &&
    typeof possibleSnapshot.savedAt ===
      'number' &&
    Number.isFinite(
      possibleSnapshot.savedAt
    )
  );
}

function normalizeRestoredQueueStatus(
  status:
    ProcessingQueueStatus,
  jobs:
    readonly ProcessingJob[]
): ProcessingQueueStatus {
  const hasActiveOrPendingJobs =
    jobs.some(
      job =>
        job.status ===
          'queued' ||
        job.status ===
          'preparing' ||
        job.status ===
          'processing' ||
        job.status ===
          'finalizing' ||
        job.status ===
          'paused' ||
        job.status ===
          'interrupted' ||
        job.status ===
          'retry-scheduled'
    );

  if (
    hasActiveOrPendingJobs
  ) {
    return 'stopped';
  }

  if (
    jobs.length >
      0 &&
    jobs.every(
      job =>
        job.status ===
          'completed' ||
        job.status ===
          'failed' ||
        job.status ===
          'cancelled'
    )
  ) {
    return 'completed';
  }

  if (
    status ===
      'disposed'
  ) {
    return 'stopped';
  }

  return status;
}

function createStoredSnapshot(
  snapshot:
    ProcessingQueueSnapshot,
  savedAt =
    now()
): StoredProcessingQueueSnapshot {
  return {
    storageVersion:
      PROCESSING_QUEUE_STORAGE_VERSION,

    schemaVersion:
      PROCESSING_QUEUE_SCHEMA_VERSION,

    queueId:
      snapshot.queueId,

    status:
      snapshot.status,

    jobs:
      snapshot.jobs
        .filter(
          job =>
            job.persist &&
            !job.deletionRequested
        )
        .map(
          toStoredProcessingJob
        ),

    activeJobId:
      snapshot.activeJobId,

    currentBatchId:
      snapshot.currentBatchId,

    config:
      cloneQueueConfig(
        snapshot.config
      ),

    timing: {
      ...snapshot.timing,
    },

    lastError:
      snapshot.lastError
        ? {
            ...snapshot.lastError,

            metadata: {
              ...snapshot
                .lastError
                .metadata,
            },
          }
        : null,

    revision:
      clampNonNegativeInteger(
        snapshot.revision
      ),

    savedAt:
      normalizeProcessingTimestamp(
        savedAt
      ),
  };
}

function restoreSnapshot(
  stored:
    StoredProcessingQueueSnapshot
): ProcessingQueueSnapshot {
  const restoredJobs =
    stored.jobs
      .map(
        restoreProcessingJob
      )
      .filter(
        isValidProcessingJob
      );

  const statistics =
    calculateQueueStatistics(
      restoredJobs,
      stored.config
        .estimatedItemProcessingMs
    );

  const restoredStatus =
    normalizeRestoredQueueStatus(
      stored.status,
      restoredJobs
    );

  const activeJobStillExists =
    stored.activeJobId !==
      null &&
    restoredJobs.some(
      job =>
        job.id ===
        stored.activeJobId &&
        (
          job.status ===
            'preparing' ||
          job.status ===
            'processing' ||
          job.status ===
            'finalizing'
        )
    );

  return {
    schemaVersion:
      PROCESSING_QUEUE_SCHEMA_VERSION,

    queueId:
      stored.queueId,

    status:
      restoredStatus,

    jobs:
      restoredJobs,

    activeJobId:
      activeJobStillExists
        ? stored.activeJobId
        : null,

    currentBatchId:
      stored.currentBatchId,

    config:
      cloneQueueConfig(
        stored.config
      ),

    statistics,

    timing: {
      ...stored.timing,

      lastUpdatedAt:
        normalizeProcessingTimestamp(
          stored.timing
            .lastUpdatedAt,
          stored.savedAt
        ),

      estimatedRemainingMs:
        statistics
          .estimatedRemainingMs,
    },

    lastError:
      stored.lastError
        ? {
            ...stored.lastError,

            metadata: {
              ...stored
                .lastError
                .metadata,
            },
          }
        : null,

    revision:
      clampNonNegativeInteger(
        stored.revision
      ),

    restoredFromStorage:
      true,
  };
}

function parseStoredSnapshot(
  serialized:
    string,
  maximumJsonLength:
    number
): StoredProcessingQueueSnapshot {
  if (
    serialized.length >
    maximumJsonLength
  ) {
    throw new Error(
      'Stored queue data exceeds the maximum allowed size.'
    );
  }

  const parsed:
    unknown =
      JSON.parse(serialized);

  if (
    !isStoredQueueSnapshotLike(
      parsed
    )
  ) {
    throw new Error(
      'Stored queue data is invalid or uses an unsupported schema.'
    );
  }

  return parsed;
}

/* =========================================================
 * Queue storage class
 * ======================================================= */

export class ProcessingQueueStorage {
  private readonly storageKey:
    string;

  private readonly backupStorageKey:
    string;

  private readonly enableBackup:
    boolean;

  private readonly writeDebounceMs:
    number;

  private readonly maximumJsonLength:
    number;

  private state:
    ProcessingQueueStorageState =
      'idle';

  private initialized =
    false;

  private disposed =
    false;

  private pendingSnapshot:
    ProcessingQueueSnapshot | null =
      null;

  private pendingWritePromise:
    Promise<ProcessingQueueStorageWriteResult> | null =
      null;

  private writeTimer:
    ReturnType<typeof setTimeout> | null =
      null;

  private writeChain:
    Promise<void> =
      Promise.resolve();

  private diagnostics:
    ProcessingQueueStorageDiagnostics = {
      state:
        'idle',

      initialized:
        false,

      disposed:
        false,

      pendingWrite:
        false,

      writeInProgress:
        false,

      lastReadAt:
        null,

      lastWriteAt:
        null,

      lastClearAt:
        null,

      lastReadSource:
        null,

      lastSavedRevision:
        null,

      lastSavedBytes:
        null,

      successfulReads:
        0,

      successfulWrites:
        0,

      failedReads:
        0,

      failedWrites:
        0,

      successfulClears:
        0,

      failedClears:
        0,

      lastError:
        null,
    };

  constructor(
    options:
      ProcessingQueueStorageOptions =
        {}
  ) {
    this.storageKey =
      normalizeStorageKey(
        options.storageKey,
        PROCESSING_QUEUE_STORAGE_KEY
      );

    this.backupStorageKey =
      normalizeStorageKey(
        options.backupStorageKey,
        PROCESSING_QUEUE_BACKUP_STORAGE_KEY
      );

    this.enableBackup =
      options.enableBackup ??
      true;

    this.writeDebounceMs =
      Math.max(
        0,
        clampNonNegativeInteger(
          options.writeDebounceMs ??
            PROCESSING_QUEUE_STORAGE_WRITE_DEBOUNCE_MS
        )
      );

    this.maximumJsonLength =
      Math.max(
        100_000,
        clampNonNegativeInteger(
          options.maximumJsonLength ??
            PROCESSING_QUEUE_STORAGE_MAXIMUM_JSON_LENGTH,
          PROCESSING_QUEUE_STORAGE_MAXIMUM_JSON_LENGTH
        )
      );
  }

  public initialize(): void {
    this.assertNotDisposed();

    if (
      this.initialized
    ) {
      return;
    }

    this.initialized =
      true;

    this.updateDiagnostics({
      initialized:
        true,
    });
  }

  public getState():
    ProcessingQueueStorageState {
    return this.state;
  }

  public getDiagnostics():
    ProcessingQueueStorageDiagnostics {
    return {
      ...this.diagnostics,

      lastError:
        this.diagnostics
          .lastError
          ? {
              ...this
                .diagnostics
                .lastError,

              metadata: {
                ...this
                  .diagnostics
                  .lastError
                  .metadata,
              },
            }
          : null,
    };
  }

  public async read(
    fallbackConfig:
      ProcessingQueueConfig =
        DEFAULT_PROCESSING_QUEUE_CONFIG
  ): Promise<
    ProcessingQueueStorageReadResult
  > {
    this.ensureInitialized();

    const startedAt =
      now();

    this.setState(
      'reading'
    );

    const warnings:
      string[] =
      [];

    try {
      const primary =
        await AsyncStorage.getItem(
          this.storageKey
        );

      if (
        primary !==
          null
      ) {
        try {
          const stored =
            parseStoredSnapshot(
              primary,
              this.maximumJsonLength
            );

          const snapshot =
            restoreSnapshot(
              stored
            );

          this.setState(
            'idle'
          );

          this.updateDiagnostics({
            lastReadAt:
              now(),

            lastReadSource:
              'primary',

            successfulReads:
              this.diagnostics
                .successfulReads +
              1,

            lastError:
              null,
          });

          return {
            snapshot,

            source:
              'primary',

            found:
              true,

            restored:
              true,

            recoveredFromBackup:
              false,

            warnings,

            durationMs:
              Math.max(
                0,
                now() -
                  startedAt
              ),
          };
        } catch (error) {
          warnings.push(
            `Primary queue storage could not be restored: ${getUnknownErrorMessage(
              error
            )}`
          );
        }
      }

      if (
        this.enableBackup
      ) {
        const backup =
          await AsyncStorage.getItem(
            this.backupStorageKey
          );

        if (
          backup !==
            null
        ) {
          try {
            const storedBackup =
              parseStoredSnapshot(
                backup,
                this.maximumJsonLength
              );

            const snapshot =
              restoreSnapshot(
                storedBackup
              );

            warnings.push(
              'The processing queue was recovered from its backup.'
            );

            this.setState(
              'idle'
            );

            this.updateDiagnostics({
              lastReadAt:
                now(),

              lastReadSource:
                'backup',

              successfulReads:
                this.diagnostics
                  .successfulReads +
                1,

              lastError:
                null,
            });

            return {
              snapshot,

              source:
                'backup',

              found:
                true,

              restored:
                true,

              recoveredFromBackup:
                true,

              warnings,

              durationMs:
                Math.max(
                  0,
                  now() -
                    startedAt
                ),
            };
          } catch (error) {
            warnings.push(
              `Backup queue storage could not be restored: ${getUnknownErrorMessage(
                error
              )}`
            );
          }
        }
      }

      const emptySnapshot =
        createInitialQueueSnapshot(
          fallbackConfig
        );

      this.setState(
        'idle'
      );

      this.updateDiagnostics({
        lastReadAt:
          now(),

        lastReadSource:
          'empty',

        successfulReads:
          this.diagnostics
            .successfulReads +
          1,

        lastError:
          null,
      });

      return {
        snapshot:
          emptySnapshot,

        source:
          'empty',

        found:
          false,

        restored:
          false,

        recoveredFromBackup:
          false,

        warnings,

        durationMs:
          Math.max(
            0,
            now() -
              startedAt
          ),
      };
    } catch (error) {
      const storageError =
        createStorageError(
          'STORAGE_READ_FAILED',
          `Unable to read the processing queue: ${getUnknownErrorMessage(
            error
          )}`
        );

      this.setState(
        'failed'
      );

      this.updateDiagnostics({
        failedReads:
          this.diagnostics
            .failedReads +
          1,

        lastError:
          storageError,
      });

      throw storageError;
    }
  }

  public save(
    snapshot:
      ProcessingQueueSnapshot
  ): Promise<
    ProcessingQueueStorageWriteResult
  > {
    this.ensureInitialized();

    this.pendingSnapshot =
      cloneQueueSnapshot(
        snapshot
      );

    this.updateDiagnostics({
      pendingWrite:
        true,
    });

    if (
      this.pendingWritePromise
    ) {
      return this.pendingWritePromise;
    }

    this.pendingWritePromise =
      new Promise<
        ProcessingQueueStorageWriteResult
      >(
        (
          resolve,
          reject
        ) => {
          const execute =
            async (): Promise<void> => {
              this.writeTimer =
                null;

              try {
                const result =
                  await this.flush();

                resolve(
                  result
                );
              } catch (error) {
                reject(
                  error
                );
              } finally {
                this.pendingWritePromise =
                  null;
              }
            };

          if (
            this.writeDebounceMs >
            0
          ) {
            this.writeTimer =
              setTimeout(
                () => {
                  void execute();
                },
                this.writeDebounceMs
              );
          } else {
            void execute();
          }
        }
      );

    return this.pendingWritePromise;
  }

  public async flush():
    Promise<
      ProcessingQueueStorageWriteResult
    > {
    this.ensureInitialized();

    if (
      this.writeTimer
    ) {
      clearTimeout(
        this.writeTimer
      );

      this.writeTimer =
        null;
    }

    const snapshot =
      this.pendingSnapshot;

    if (
      !snapshot
    ) {
      return {
        saved:
          false,

        savedAt:
          now(),

        revision:
          this.diagnostics
            .lastSavedRevision ??
          0,

        bytes:
          0,

        durationMs:
          0,

        backupWritten:
          false,
      };
    }

    this.pendingSnapshot =
      null;

    const operation =
      this.writeSnapshot(
        snapshot
      );

    let result:
      ProcessingQueueStorageWriteResult | null =
        null;

    let operationError:
      unknown =
        null;

    this.writeChain =
      this.writeChain.then(
        async () => {
          try {
            result =
              await operation;
          } catch (error) {
            operationError =
              error;
          }
        }
      );

    await this.writeChain;

    if (
      operationError
    ) {
      throw operationError;
    }

    if (
      !result
    ) {
      throw createStorageError(
        'STORAGE_WRITE_FAILED',
        'The processing queue write completed without a result.'
      );
    }

    return result;
  }

  public async clear():
    Promise<
      ProcessingQueueStorageClearResult
    > {
    this.ensureInitialized();

    const startedAt =
      now();

    this.setState(
      'clearing'
    );

    if (
      this.writeTimer
    ) {
      clearTimeout(
        this.writeTimer
      );

      this.writeTimer =
        null;
    }

    this.pendingSnapshot =
      null;

    this.updateDiagnostics({
      pendingWrite:
        false,
    });

    try {
      const keys =
        this.enableBackup
          ? [
              this.storageKey,
              this.backupStorageKey,
            ]
          : [
              this.storageKey,
            ];

      await AsyncStorage.multiRemove(
        keys
      );

      this.setState(
        'idle'
      );

      this.updateDiagnostics({
        lastClearAt:
          now(),

        successfulClears:
          this.diagnostics
            .successfulClears +
          1,

        lastSavedRevision:
          null,

        lastSavedBytes:
          null,

        lastError:
          null,
      });

      return {
        cleared:
          true,

        durationMs:
          Math.max(
            0,
            now() -
              startedAt
          ),
      };
    } catch (error) {
      const storageError =
        createStorageError(
          'STORAGE_WRITE_FAILED',
          `Unable to clear the processing queue: ${getUnknownErrorMessage(
            error
          )}`
        );

      this.setState(
        'failed'
      );

      this.updateDiagnostics({
        failedClears:
          this.diagnostics
            .failedClears +
          1,

        lastError:
          storageError,
      });

      throw storageError;
    }
  }

  public async hasStoredQueue():
    Promise<boolean> {
    this.ensureInitialized();

    const primary =
      await AsyncStorage.getItem(
        this.storageKey
      );

    if (
      primary !==
        null
    ) {
      return true;
    }

    if (
      !this.enableBackup
    ) {
      return false;
    }

    const backup =
      await AsyncStorage.getItem(
        this.backupStorageKey
      );

    return backup !==
      null;
  }

  public async getStoredQueueSize():
    Promise<number> {
    this.ensureInitialized();

    const primary =
      await AsyncStorage.getItem(
        this.storageKey
      );

    return primary?.length ??
      0;
  }

  public async dispose():
    Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    if (
      this.writeTimer
    ) {
      clearTimeout(
        this.writeTimer
      );

      this.writeTimer =
        null;
    }

    if (
      this.pendingSnapshot
    ) {
      try {
        await this.flush();
      } catch {
        // لا نرمي خطأ أثناء dispose.
      }
    }

    this.disposed =
      true;

    this.initialized =
      false;

    this.pendingSnapshot =
      null;

    this.pendingWritePromise =
      null;

    this.setState(
      'disposed'
    );

    this.updateDiagnostics({
      initialized:
        false,

      disposed:
        true,

      pendingWrite:
        false,

      writeInProgress:
        false,
    });
  }

  private async writeSnapshot(
    snapshot:
      ProcessingQueueSnapshot
  ): Promise<
    ProcessingQueueStorageWriteResult
  > {
    const startedAt =
      now();

    this.setState(
      'writing'
    );

    this.updateDiagnostics({
      pendingWrite:
        false,

      writeInProgress:
        true,
    });

    try {
      const storedSnapshot =
        createStoredSnapshot(
          snapshot
        );

      const serialized =
        JSON.stringify(
          storedSnapshot
        );

      if (
        serialized.length >
        this.maximumJsonLength
      ) {
        throw new Error(
          `Serialized queue data is too large: ${serialized.length} characters.`
        );
      }

      let backupWritten =
        false;

      if (
        this.enableBackup
      ) {
        const existingPrimary =
          await AsyncStorage.getItem(
            this.storageKey
          );

        if (
          existingPrimary !==
            null
        ) {
          await AsyncStorage.setItem(
            this.backupStorageKey,
            existingPrimary
          );

          backupWritten =
            true;
        }
      }

      await AsyncStorage.setItem(
        this.storageKey,
        serialized
      );

      const completedAt =
        now();

      this.setState(
        'idle'
      );

      this.updateDiagnostics({
        pendingWrite:
          this.pendingSnapshot !==
          null,

        writeInProgress:
          false,

        lastWriteAt:
          completedAt,

        lastSavedRevision:
          storedSnapshot
            .revision,

        lastSavedBytes:
          serialized.length,

        successfulWrites:
          this.diagnostics
            .successfulWrites +
          1,

        lastError:
          null,
      });

      return {
        saved:
          true,

        savedAt:
          storedSnapshot.savedAt,

        revision:
          storedSnapshot.revision,

        bytes:
          serialized.length,

        durationMs:
          Math.max(
            0,
            completedAt -
              startedAt
          ),

        backupWritten,
      };
    } catch (error) {
      const storageError =
        createStorageError(
          'STORAGE_WRITE_FAILED',
          `Unable to save the processing queue: ${getUnknownErrorMessage(
            error
          )}`,
          {
            queueId:
              snapshot.queueId,

            revision:
              snapshot.revision,
          }
        );

      this.setState(
        'failed'
      );

      this.updateDiagnostics({
        writeInProgress:
          false,

        failedWrites:
          this.diagnostics
            .failedWrites +
          1,

        lastError:
          storageError,
      });

      throw storageError;
    }
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
      throw createStorageError(
        'QUEUE_DISPOSED',
        'Processing queue storage has already been disposed.'
      );
    }
  }

  private setState(
    state:
      ProcessingQueueStorageState
  ): void {
    this.state =
      state;

    this.updateDiagnostics({
      state,
    });
  }

  private updateDiagnostics(
    updates:
      Partial<
        ProcessingQueueStorageDiagnostics
      >
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...updates,
    };
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultProcessingQueueStorage:
  ProcessingQueueStorage | null =
    null;

export function getDefaultProcessingQueueStorage():
  ProcessingQueueStorage {
  if (
    !defaultProcessingQueueStorage
  ) {
    defaultProcessingQueueStorage =
      new ProcessingQueueStorage();

    defaultProcessingQueueStorage
      .initialize();
  }

  return defaultProcessingQueueStorage;
}

export async function disposeDefaultProcessingQueueStorage():
  Promise<void> {
  if (
    !defaultProcessingQueueStorage
  ) {
    return;
  }

  await defaultProcessingQueueStorage
    .dispose();

  defaultProcessingQueueStorage =
    null;
}

/* =========================================================
 * Convenience functions
 * ======================================================= */

export async function loadProcessingQueue(
  config:
    ProcessingQueueConfig =
      DEFAULT_PROCESSING_QUEUE_CONFIG
): Promise<
  ProcessingQueueStorageReadResult
> {
  return getDefaultProcessingQueueStorage()
    .read(
      config
    );
}

export async function saveProcessingQueue(
  snapshot:
    ProcessingQueueSnapshot
): Promise<
  ProcessingQueueStorageWriteResult
> {
  return getDefaultProcessingQueueStorage()
    .save(
      snapshot
    );
}

export async function flushProcessingQueueStorage():
  Promise<
    ProcessingQueueStorageWriteResult
  > {
  return getDefaultProcessingQueueStorage()
    .flush();
}

export async function clearProcessingQueueStorage():
  Promise<
    ProcessingQueueStorageClearResult
  > {
  return getDefaultProcessingQueueStorage()
    .clear();
}