// scan/core/background/BackgroundProcessingBootstrap.ts
// Part 1/2
//
// Triple N - Background Processing Bootstrap
//
// هذا الملف هو نقطة التشغيل المركزية لنظام
// Scan Item Processing Queue بالكامل.
//
// مسؤولياته:
//
// 1) إنشاء LocalScanItemProcessingAdapter.
// 2) إنشاء ScanItemProcessingExecutor.
// 3) تسجيل Executor داخل ScanItemQueueService.
// 4) إنشاء وتسجيل iOS Background Driver.
// 5) إنشاء وتسجيل Android Background Driver.
// 6) إنشاء BackgroundProcessingService.
// 7) إنشاء BackgroundProcessingAppLifecycle.
// 8) تهيئة Queue واستعادة الصور السابقة.
// 9) ربط Queue وNative Background Processing بدورة حياة التطبيق.
// 10) بدء المعالجة تلقائيًا عند وجود Jobs معلقة.
// 11) منع تهيئة النظام أكثر من مرة.
// 12) توفير Snapshot وتشخيصات موحدة.
// 13) تنظيف كل الخدمات بالترتيب الصحيح.
//
// يجب تمرير دالة updateWardrobeItem الحقيقية عند التهيئة.

import {
  Platform,
} from 'react-native';

import type {
  ProcessingJob,
  ProcessingQueueSnapshot,
} from '../queue/QueueTypes';

import type {
  ProcessingQueueInitializeResult,
} from '../queue/ProcessingQueue';

import {
  createScanItemProcessingExecutor,
  type ScanItemProcessingExecutor,
  type ScanItemProcessingExecutorDiagnostics,
} from '../services/ScanItemProcessingExecutor';

import {
  getDefaultScanItemQueueService,
  type ScanItemQueueService,
  type ScanItemQueueServiceDiagnostics,
} from '../services/ScanItemQueueService';

import {
  createLocalScanItemProcessingAdapter,
  type LocalScanItemFileInspector,
  type LocalScanItemProcessingAdapter,
  type LocalScanItemProcessingAdapterDiagnostics,
  type LocalScanItemTemporaryFileCleaner,
  type LocalScanItemWardrobeUpdater,
} from '../services/LocalScanItemProcessingAdapter';

import type {
  BackgroundProcessingCapabilityResult,
  BackgroundProcessingService,
  BackgroundProcessingServiceDiagnostics,
  BackgroundProcessingServiceSnapshot,
} from '../services/BackgroundProcessingService';

import {
  createAndroidBackgroundProcessingDriver,
  type AndroidBackgroundProcessingDriver,
  type AndroidBackgroundProcessingDriverDiagnostics,
  type AndroidBackgroundProcessingDriverOptions,
} from './AndroidBackgroundProcessingDriver';

import {
  createIOSBackgroundProcessingDriver,
  type IOSBackgroundProcessingDriver,
  type IOSBackgroundProcessingDriverDiagnostics,
  type IOSBackgroundProcessingDriverOptions,
} from './IOSBackgroundProcessingDriver';

import {
  getDefaultBackgroundProcessingRegistry,
  type BackgroundProcessingRegistry,
  type BackgroundProcessingRegistryDiagnostics,
  type BackgroundProcessingRegistrySnapshot,
} from './BackgroundProcessingRegistry';

import {
  BackgroundProcessingAppLifecycle,
  type BackgroundProcessingAppLifecycleDiagnostics,
  type BackgroundProcessingAppLifecycleInitializeResult,
  type BackgroundProcessingAppLifecycleSnapshot,
  type PartialBackgroundProcessingAppLifecycleConfig,
} from './BackgroundProcessingAppLifecycle';

/* =========================================================
 * Bootstrap state
 * ======================================================= */

export type BackgroundProcessingBootstrapState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'failed'
  | 'disposing'
  | 'disposed';

/* =========================================================
 * Options
 * ======================================================= */

export type BackgroundProcessingBootstrapOptions = {
  /**
   * الدالة الحقيقية المسؤولة عن تحديث
   * عنصر الدولاب بعد انتهاء المعالجة.
   */
  updateWardrobeItem:
    LocalScanItemWardrobeUpdater;

  /**
   * فحص وجود الملفات اختياري.
   */
  inspectFile?:
    LocalScanItemFileInspector;

  /**
   * حذف الملفات المؤقتة عند فشل Job.
   */
  cleanupTemporaryFile?:
    LocalScanItemTemporaryFileCleaner;

  /**
   * جودة PNG النهائية من 1 إلى 100.
   */
  transparentImageQuality?:
    number;

  /**
   * هل نجمع Diagnostics كاملة من EdgeSAM.
   */
  collectSegmentationDiagnostics?:
    boolean;

  /**
   * إعادة استخدام EdgeSAM Embedding.
   */
  reuseSegmentationSession?:
    boolean;

  /**
   * بداية اسم ملف الصورة النهائية.
   */
  processedFileNamePrefix?:
    string;

  /**
   * هل نبدأ Queue تلقائيًا بعد التهيئة
   * عندما يكون التطبيق في الواجهة.
   */
  autoStartQueue?:
    boolean;

  /**
   * هل نبدأ Native Background Processing
   * تلقائيًا عندما يدخل التطبيق الخلفية.
   */
  autoStartBackgroundProcessing?:
    boolean;

  /**
   * إعدادات دورة حياة التطبيق.
   *
   * القيم الخاصة بـautoStartQueue و
   * autoStartBackgroundProcessing لها الأولوية
   * في نقطتي التشغيل الأساسيتين.
   */
  lifecycle?:
    PartialBackgroundProcessingAppLifecycleConfig;

  /**
   * إعدادات iOS Driver.
   */
  ios?:
    IOSBackgroundProcessingDriverOptions;

  /**
   * إعدادات Android Driver.
   */
  android?:
    AndroidBackgroundProcessingDriverOptions;

  /**
   * طباعة Logs أثناء التطوير.
   */
  enableDebugLogs?:
    boolean;
};

/* =========================================================
 * Initialization result
 * ======================================================= */

export type BackgroundProcessingBootstrapResult = {
  initialized:
    boolean;

  state:
    BackgroundProcessingBootstrapState;

  platform:
    'ios' | 'android' | 'unknown';

  queue:
    ProcessingQueueInitializeResult;

  capability:
    BackgroundProcessingCapabilityResult;

  background:
    BackgroundProcessingServiceSnapshot;

  lifecycle:
    BackgroundProcessingAppLifecycleInitializeResult;

  queueStarted:
    boolean;

  backgroundStarted:
    boolean;

  restoredJobs:
    number;

  pendingJobs:
    number;

  durationMs:
    number;

  warnings:
    readonly string[];
};

/* =========================================================
 * Snapshot
 * ======================================================= */

export type BackgroundProcessingBootstrapSnapshot = {
  state:
    BackgroundProcessingBootstrapState;

  initialized:
    boolean;

  disposed:
    boolean;

  platform:
    'ios' | 'android' | 'unknown';

  queue:
    ProcessingQueueSnapshot | null;

  background:
    BackgroundProcessingServiceSnapshot | null;

  lifecycle:
    BackgroundProcessingAppLifecycleSnapshot | null;

  activeJob:
    ProcessingJob | null;

  initializedAt:
    number | null;

  lastUpdatedAt:
    number;

  lastError:
    string | null;

  warnings:
    readonly string[];
};

/* =========================================================
 * Diagnostics
 * ======================================================= */

export type BackgroundProcessingBootstrapDiagnostics = {
  initializeCount:
    number;

  initializeFailureCount:
    number;

  disposeCount:
    number;

  queueStartCount:
    number;

  backgroundStartCount:
    number;

  lastInitializeStartedAt:
    number | null;

  lastInitializeCompletedAt:
    number | null;

  lastDisposeAt:
    number | null;

  lastOperationAt:
    number | null;

  lastError:
    string | null;

  queue:
    ScanItemQueueServiceDiagnostics | null;

  adapter:
    LocalScanItemProcessingAdapterDiagnostics | null;

  executor:
    ScanItemProcessingExecutorDiagnostics | null;

  registry:
    BackgroundProcessingRegistryDiagnostics | null;

  iosDriver:
    IOSBackgroundProcessingDriverDiagnostics | null;

  androidDriver:
    AndroidBackgroundProcessingDriverDiagnostics | null;

  background:
    BackgroundProcessingServiceDiagnostics | null;

  lifecycle:
    BackgroundProcessingAppLifecycleDiagnostics | null;
};

/* =========================================================
 * Internal runtime
 * ======================================================= */

type BackgroundProcessingRuntime = {
  queueService:
    ScanItemQueueService;

  adapter:
    LocalScanItemProcessingAdapter;

  executor:
    ScanItemProcessingExecutor;

  registry:
    BackgroundProcessingRegistry;

  iosDriver:
    IOSBackgroundProcessingDriver;

  androidDriver:
    AndroidBackgroundProcessingDriver;

  backgroundService:
    BackgroundProcessingService;

  lifecycle:
    BackgroundProcessingAppLifecycle;
};

/* =========================================================
 * Helpers
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
    // نستخدم String في النهاية.
  }

  return String(
    error
  );
}

function resolvePlatform():
  'ios' | 'android' | 'unknown' {
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

function cloneJob(
  job:
    ProcessingJob | null
): ProcessingJob | null {
  if (
    !job
  ) {
    return null;
  }

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

      retryableErrorCodes: [
        ...job.retryPolicy
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

function cloneRegistrySnapshot(
  snapshot:
    BackgroundProcessingRegistrySnapshot
): BackgroundProcessingRegistrySnapshot {
  return {
    ...snapshot,

    registrations:
      snapshot.registrations.map(
        registration => ({
          ...registration,

          metadata: {
            ...registration.metadata,
          },
        })
      ),
  };
}

function combineWarnings(
  ...collections:
    readonly (
      readonly string[]
    )[]
): string[] {
  const result:
    string[] =
      [];

  for (
    const collection of
      collections
  ) {
    for (
      const warning of
        collection
    ) {
      const normalized =
        warning.trim();

      if (
        normalized.length ===
          0 ||
        result.includes(
          normalized
        )
      ) {
        continue;
      }

      result.push(
        normalized
      );
    }
  }

  return result;
}

/* =========================================================
 * Bootstrap class
 * ======================================================= */

export class BackgroundProcessingBootstrap {
  private state:
    BackgroundProcessingBootstrapState =
      'uninitialized';

  private runtime:
    BackgroundProcessingRuntime | null =
      null;

  private initializePromise:
    Promise<
      BackgroundProcessingBootstrapResult
    > | null =
      null;

  private disposePromise:
    Promise<void> | null =
      null;

  private initializedAt:
    number | null =
      null;

  private lastUpdatedAt =
    now();

  private lastError:
    string | null =
      null;

  private warnings:
    string[] =
      [];

  private diagnostics:
    Omit<
      BackgroundProcessingBootstrapDiagnostics,
      | 'queue'
      | 'adapter'
      | 'executor'
      | 'registry'
      | 'iosDriver'
      | 'androidDriver'
      | 'background'
      | 'lifecycle'
    > = {
    initializeCount:
      0,

    initializeFailureCount:
      0,

    disposeCount:
      0,

    queueStartCount:
      0,

    backgroundStartCount:
      0,

    lastInitializeStartedAt:
      null,

    lastInitializeCompletedAt:
      null,

    lastDisposeAt:
      null,

    lastOperationAt:
      null,

    lastError:
      null,
  };

  /* =======================================================
   * Initialize
   * ===================================================== */

  public initialize(
    options:
      BackgroundProcessingBootstrapOptions
  ): Promise<
    BackgroundProcessingBootstrapResult
  > {
    if (
      this.state ===
        'disposed'
    ) {
      throw new Error(
        'Background processing bootstrap has already been disposed.'
      );
    }

    if (
      this.initializePromise
    ) {
      return this.initializePromise;
    }

    if (
      this.runtime &&
      (
        this.state ===
          'ready' ||
        this.state ===
          'running'
      )
    ) {
      return this.createExistingResult();
    }

    this.initializePromise =
      this.initializeInternal(
        options
      ).finally(
        () => {
          this.initializePromise =
            null;
        }
      );

    return this.initializePromise;
  }

  private async initializeInternal(
    options:
      BackgroundProcessingBootstrapOptions
  ): Promise<
    BackgroundProcessingBootstrapResult
  > {
    const startedAt =
      now();

    this.state =
      'initializing';

    this.lastUpdatedAt =
      startedAt;

    this.lastError =
      null;

    this.warnings =
      [];

    this.diagnostics = {
      ...this.diagnostics,

      initializeCount:
        this.diagnostics
          .initializeCount +
      1,

      lastInitializeStartedAt:
        startedAt,

      lastOperationAt:
        startedAt,

      lastError:
        null,
    };

    try {
      if (
        typeof options
          .updateWardrobeItem !==
        'function'
      ) {
        throw new Error(
          'BackgroundProcessingBootstrap requires updateWardrobeItem.'
        );
      }

      const enableDebugLogs =
        options.enableDebugLogs ??
        false;

      const autoStartQueue =
        options.autoStartQueue ??
        true;

      const autoStartBackgroundProcessing =
        options
          .autoStartBackgroundProcessing ??
        true;

      const queueService =
        getDefaultScanItemQueueService();

      const adapter =
        createLocalScanItemProcessingAdapter({
          updateWardrobeItem:
            options.updateWardrobeItem,

          inspectFile:
            options.inspectFile,

          cleanupTemporaryFile:
            options
              .cleanupTemporaryFile,

          quality:
            options
              .transparentImageQuality ??
            100,

          collectDiagnostics:
            options
              .collectSegmentationDiagnostics ??
            false,

          reuseSession:
            options
              .reuseSegmentationSession ??
            true,

          fileNamePrefix:
            options
              .processedFileNamePrefix ??
            'scan-item-queue',

          enableDebugLogs,
        });

      const executor =
        createScanItemProcessingExecutor(
          adapter,
          {
            enableDebugLogs,
          }
        );

      queueService.setExecutor(
        executor.getExecutor()
      );

      const registry =
        getDefaultBackgroundProcessingRegistry();

      const iosDriver =
        createIOSBackgroundProcessingDriver({
          ...(options.ios ??
          {}),

          enableDebugLogs:
            options.ios
              ?.enableDebugLogs ??
            enableDebugLogs,
        });

      const androidDriver =
        createAndroidBackgroundProcessingDriver({
          ...(options.android ??
          {}),

          enableDebugLogs:
            options.android
              ?.enableDebugLogs ??
            enableDebugLogs,
        });

      registry.registerIOS(
        iosDriver,
        {
          replaceExisting:
            true,

          metadata: {
            source:
              'BackgroundProcessingBootstrap',
          },
        }
      );

      registry.registerAndroid(
        androidDriver,
        {
          replaceExisting:
            true,

          metadata: {
            source:
              'BackgroundProcessingBootstrap',
          },
        }
      );

    const backgroundService =
  registry.createService({
    queueService,

    forceRecreate:
      true,

    autoInitialize:
      false,

    autoStartWhenPending:
      false,

    resumeQueueWhenApplicationBecomesActive:
      false,

    stopNativeTaskWhenQueueCompletes:
      true,

    manageApplicationStateInternally:
      false,

    enableDebugLogs,
  });

      const lifecycle =
        new BackgroundProcessingAppLifecycle({
          queueService,

          backgroundService,

          autoInitialize:
            false,

          config: {
            ...(options.lifecycle ??
            {}),

            resumeQueueWhenApplicationBecomesActive:
              autoStartQueue,

            startBackgroundTaskWhenApplicationEntersBackground:
              autoStartBackgroundProcessing,

            enableDebugLogs:
              options.lifecycle
                ?.enableDebugLogs ??
              enableDebugLogs,
          },
        });

      this.runtime = {
        queueService,

        adapter,

        executor,

        registry,

        iosDriver,

        androidDriver,

        backgroundService,

        lifecycle,
      };

      const queueResult =
        await queueService.initialize(
          false
        );

      const capability =
        await backgroundService
          .initialize();

      const lifecycleResult =
        await lifecycle.initialize();

      const finalQueueSnapshot =
        queueService.getSnapshot();

      const queueStarted =
        lifecycleResult
          .queueStarted ||
        lifecycleResult
          .queueResumed ||
        queueService.isRunning();

      const backgroundStarted =
        lifecycleResult
          .backgroundStarted ||
        backgroundService
          .isRunning();

      if (
        lifecycleResult
          .queueStarted ||
        lifecycleResult
          .queueResumed
      ) {
        this.diagnostics = {
          ...this.diagnostics,

          queueStartCount:
            this.diagnostics
              .queueStartCount +
          1,
        };
      }

      if (
        lifecycleResult
          .backgroundStarted
      ) {
        this.diagnostics = {
          ...this.diagnostics,

          backgroundStartCount:
            this.diagnostics
              .backgroundStartCount +
          1,
        };
      }

      this.warnings =
        combineWarnings(
          queueResult.warnings,
          capability.warnings,
          lifecycleResult
            .warnings
        );

      const completedAt =
        now();

      this.initializedAt =
        completedAt;

      this.lastUpdatedAt =
        completedAt;

      this.state =
        queueService.isRunning()
          ? 'running'
          : 'ready';

      this.diagnostics = {
        ...this.diagnostics,

        lastInitializeCompletedAt:
          completedAt,

        lastOperationAt:
          completedAt,

        lastError:
          null,
      };

      return {
        initialized:
          true,

        state:
          this.state,

        platform:
          resolvePlatform(),

        queue:
          queueResult,

        capability,

        background:
          backgroundService
            .getSnapshot(),

        lifecycle:
          lifecycleResult,

        queueStarted,

        backgroundStarted,

        restoredJobs:
          queueResult.restored
            ? finalQueueSnapshot
                .jobs
                .length
            : 0,

        pendingJobs:
          finalQueueSnapshot
            .statistics
            .pending +
          finalQueueSnapshot
            .statistics
            .active,

        durationMs:
          Math.max(
            0,
            completedAt -
            startedAt
          ),

        warnings: [
          ...this.warnings,
        ],
      };
   } catch (error) {
  const message =
    getUnknownErrorMessage(
      error
    );

  const failedRuntime =
    this.runtime;

  this.runtime =
    null;

  if (
    failedRuntime
  ) {
    await this.cleanupRuntime(
      failedRuntime
    );
  }

  this.state =
    'failed';

  this.initializedAt =
    null;

  this.lastError =
    message;

  this.lastUpdatedAt =
    now();

  this.diagnostics = {
    ...this.diagnostics,

    initializeFailureCount:
      this.diagnostics
        .initializeFailureCount +
    1,

    lastInitializeCompletedAt:
      this.lastUpdatedAt,

    lastOperationAt:
      this.lastUpdatedAt,

    lastError:
      message,
  };

  throw error;
}
  }
  /* =======================================================
   * Existing result
   * ===================================================== */

  private async createExistingResult():
    Promise<
      BackgroundProcessingBootstrapResult
    > {
    const runtime =
      this.requireRuntime();

    const queueSnapshot =
      runtime.queueService
        .getSnapshot();

    const backgroundSnapshot =
      runtime.backgroundService
        .getSnapshot();

    const lifecycleSnapshot =
      runtime.lifecycle
        .getSnapshot();

    return {
      initialized:
        true,

      state:
        this.state,

      platform:
        resolvePlatform(),

      queue: {
        initialized:
          true,

        restored:
          queueSnapshot
            .restoredFromStorage,

        recoveredFromBackup:
          false,

        snapshot:
          queueSnapshot,

        warnings:
          [],

        durationMs:
          0,
      },

      capability:
        runtime.backgroundService
          .getCapability(),

      background:
        backgroundSnapshot,

      lifecycle: {
        initialized:
          lifecycleSnapshot
            .initialized,

        state:
          lifecycleSnapshot
            .state,

        applicationState:
          lifecycleSnapshot
            .applicationState,

        queue:
          queueSnapshot,

        background:
          backgroundSnapshot,

        capability:
          runtime.backgroundService
            .getCapability(),

        queueStarted:
          false,

        queueResumed:
          false,

        backgroundStarted:
          backgroundSnapshot
            .running,

        durationMs:
          0,

        warnings:
          lifecycleSnapshot
            .warnings,
      },

      queueStarted:
        runtime.queueService
          .isRunning(),

      backgroundStarted:
        backgroundSnapshot
          .running,

      restoredJobs:
        queueSnapshot
          .restoredFromStorage
          ? queueSnapshot.jobs.length
          : 0,

      pendingJobs:
        queueSnapshot
          .statistics
          .pending +
        queueSnapshot
          .statistics
          .active,

      durationMs:
        0,

      warnings: [
        ...this.warnings,
      ],
    };
  }

  /* =======================================================
   * Runtime queries
   * ===================================================== */

  public getQueueService():
    ScanItemQueueService {
    return this.requireRuntime()
      .queueService;
  }

  public getAdapter():
    LocalScanItemProcessingAdapter {
    return this.requireRuntime()
      .adapter;
  }

  public getExecutor():
    ScanItemProcessingExecutor {
    return this.requireRuntime()
      .executor;
  }

  public getRegistry():
    BackgroundProcessingRegistry {
    return this.requireRuntime()
      .registry;
  }

  public getIOSDriver():
    IOSBackgroundProcessingDriver {
    return this.requireRuntime()
      .iosDriver;
  }

  public getAndroidDriver():
    AndroidBackgroundProcessingDriver {
    return this.requireRuntime()
      .androidDriver;
  }

  public getBackgroundService():
    BackgroundProcessingService {
    return this.requireRuntime()
      .backgroundService;
  }

  public getLifecycle():
    BackgroundProcessingAppLifecycle {
    return this.requireRuntime()
      .lifecycle;
  }

  /* =======================================================
   * Manual runtime controls
   * ===================================================== */

  public async startQueue():
    Promise<
      ProcessingQueueSnapshot
    > {
    const runtime =
      this.requireRuntime();

    const snapshot =
      await runtime.queueService
        .start();

    this.state =
      'running';

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      queueStartCount:
        this.diagnostics
          .queueStartCount +
      1,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        null,
    };

    return snapshot;
  }

  public async resumeQueue():
    Promise<
      ProcessingQueueSnapshot
    > {
    const runtime =
      this.requireRuntime();

    const snapshot =
      await runtime.queueService
        .resume();

    this.state =
      'running';

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      queueStartCount:
        this.diagnostics
          .queueStartCount +
      1,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        null,
    };

    return snapshot;
  }

  public async pauseQueue():
    Promise<
      ProcessingQueueSnapshot
    > {
    const runtime =
      this.requireRuntime();

    const snapshot =
      await runtime.queueService
        .pause();

    this.state =
      'ready';

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        null,
    };

    return snapshot;
  }

  public async startBackgroundProcessing():
    Promise<boolean> {
    const runtime =
      this.requireRuntime();

    const result =
      await runtime.lifecycle
        .startBackgroundProcessing();

    this.warnings =
      combineWarnings(
        this.warnings,
        result.warnings
      );

    if (
      result.started &&
      !result.alreadyRunning
    ) {
      this.diagnostics = {
        ...this.diagnostics,

        backgroundStartCount:
          this.diagnostics
            .backgroundStartCount +
        1,
      };
    }

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        null,
    };

    return (
      result.started ||
      result.alreadyRunning
    );
  }

  public async stopBackgroundProcessing(
    reason =
      'Background processing stopped manually.'
  ): Promise<boolean> {
    const runtime =
      this.requireRuntime();

    const result =
      await runtime.lifecycle
        .stopBackgroundProcessing(
          reason
        );

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        null,
    };

    return result.stopped;
  }

  public async synchronizeLifecycle():
    Promise<void> {
    const runtime =
      this.requireRuntime();

    await runtime.lifecycle
      .synchronizeWithCurrentAppState();

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        null,
    };
  }

  public async recoverPendingProcessing():
    Promise<boolean> {
    const runtime =
      this.requireRuntime();

    const recovered =
      await runtime.lifecycle
        .recover();

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        recovered
          ? null
          : this.diagnostics
              .lastError,
    };

    return recovered;
  }

  /* =======================================================
   * Snapshot
   * ===================================================== */

  public getSnapshot():
    BackgroundProcessingBootstrapSnapshot {
    const runtime =
      this.runtime;

    const queueSnapshot =
      runtime
        ? runtime.queueService
            .getSnapshot()
        : null;

    const backgroundSnapshot =
      runtime
        ? runtime.backgroundService
            .getSnapshot()
        : null;

    const lifecycleSnapshot =
      runtime
        ? runtime.lifecycle
            .getSnapshot()
        : null;

    const activeJobId =
      queueSnapshot
        ?.activeJobId ??
      null;

    const activeJob =
      runtime &&
      activeJobId
        ? runtime.queueService
            .getJob(
              activeJobId
            )
        : null;

    return {
      state:
        this.state,

      initialized:
        runtime !==
          null &&
        (
          this.state ===
            'ready' ||
          this.state ===
            'running'
        ),

      disposed:
        this.state ===
          'disposed',

      platform:
        resolvePlatform(),

      queue:
        queueSnapshot,

      background:
        backgroundSnapshot,

      lifecycle:
        lifecycleSnapshot,

      activeJob:
        cloneJob(
          activeJob
        ),

      initializedAt:
        this.initializedAt,

      lastUpdatedAt:
        this.lastUpdatedAt,

      lastError:
        this.lastError,

      warnings: [
        ...this.warnings,
      ],
    };
  }

  /* =======================================================
   * Diagnostics
   * ===================================================== */

  public getDiagnostics():
    BackgroundProcessingBootstrapDiagnostics {
    const runtime =
      this.runtime;

    return {
      ...this.diagnostics,

      lastError:
        this.lastError ??
        this.diagnostics
          .lastError,

      queue:
        runtime
          ? runtime.queueService
              .getDiagnostics()
          : null,

      adapter:
        runtime
          ? runtime.adapter
              .getDiagnostics()
          : null,

      executor:
        runtime
          ? runtime.executor
              .getDiagnostics()
          : null,

      registry:
        runtime
          ? runtime.registry
              .getDiagnostics()
          : null,

      iosDriver:
        runtime
          ? runtime.iosDriver
              .getDiagnostics()
          : null,

      androidDriver:
        runtime
          ? runtime.androidDriver
              .getDiagnostics()
          : null,

      background:
        runtime
          ? runtime
              .backgroundService
              .getDiagnostics()
          : null,

      lifecycle:
        runtime
          ? runtime.lifecycle
              .getDiagnostics()
          : null,
    };
  }

  public getRegistrySnapshot():
    BackgroundProcessingRegistrySnapshot | null {
    if (
      !this.runtime
    ) {
      return null;
    }

    return cloneRegistrySnapshot(
      this.runtime
        .registry
        .getSnapshot()
    );
  }

  /* =======================================================
   * State queries
   * ===================================================== */

  public getState():
    BackgroundProcessingBootstrapState {
    return this.state;
  }

  public isInitialized():
    boolean {
    return (
      this.runtime !==
        null &&
      (
        this.state ===
          'ready' ||
        this.state ===
          'running'
      )
    );
  }

  public isRunning():
    boolean {
    return (
      this.runtime
        ?.queueService
        .isRunning() ??
      false
    );
  }

  public isBackgroundRunning():
    boolean {
    return (
      this.runtime
        ?.backgroundService
        .isRunning() ??
      false
    );
  }

  public hasPendingJobs():
    boolean {
    if (
      !this.runtime
    ) {
      return false;
    }

    const snapshot =
      this.runtime
        .queueService
        .getSnapshot();

    return (
      snapshot.statistics
        .pending >
        0 ||
      snapshot.statistics
        .active >
        0
    );
  }

  private async cleanupRuntime(
  runtime:
    BackgroundProcessingRuntime
): Promise<void> {
  try {
    await runtime.lifecycle
      .dispose();
  } catch {
    // لا نوقف التنظيف إذا فشل Lifecycle.
  }

  try {
    await runtime.queueService
      .flush();
  } catch {
    // لا نوقف التنظيف إذا فشل حفظ Queue.
  }

  try {
    await runtime.registry
      .disposeAll();
  } catch {
    // لا نوقف التنظيف إذا فشل Driver.
  }
}

  public isDisposed():
    boolean {
    return (
      this.state ===
        'disposed'
    );
  }

  /* =======================================================
   * Warnings
   * ===================================================== */

  public getWarnings():
    readonly string[] {
    return [
      ...this.warnings,
    ];
  }

  public clearWarnings():
    void {
    this.warnings =
      [];
  }

  /* =======================================================
   * Dispose
   * ===================================================== */

  public dispose():
    Promise<void> {
    if (
      this.disposePromise
    ) {
      return this.disposePromise;
    }

    this.disposePromise =
      this.disposeInternal()
        .finally(
          () => {
            this.disposePromise =
              null;
          }
        );

    return this.disposePromise;
  }

  private async disposeInternal():
    Promise<void> {
    if (
      this.state ===
        'disposed'
    ) {
      return;
    }

    this.state =
      'disposing';

    this.lastUpdatedAt =
      now();

    const runtime =
      this.runtime;

    this.runtime =
      null;

   if (
  runtime
) {
  await this.cleanupRuntime(
    runtime
  );
}

    this.state =
      'disposed';

    this.initializedAt =
      null;

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      disposeCount:
        this.diagnostics
          .disposeCount +
      1,

      lastDisposeAt:
        this.lastUpdatedAt,

      lastOperationAt:
        this.lastUpdatedAt,
    };
  }

  /* =======================================================
   * Runtime guard
   * ===================================================== */

  private requireRuntime():
    BackgroundProcessingRuntime {
    if (
      this.state ===
        'disposed'
    ) {
      throw new Error(
        'Background processing bootstrap has already been disposed.'
      );
    }

    if (
      !this.runtime
    ) {
      throw new Error(
        'Background processing has not been initialized.'
      );
    }

    return this.runtime;
  }
}

/* =========================================================
 * Default singleton
 * ======================================================= */

let defaultBackgroundProcessingBootstrap:
  BackgroundProcessingBootstrap | null =
    null;

export function getDefaultBackgroundProcessingBootstrap():
  BackgroundProcessingBootstrap {
  if (
    !defaultBackgroundProcessingBootstrap
  ) {
    defaultBackgroundProcessingBootstrap =
      new BackgroundProcessingBootstrap();
  }

  return defaultBackgroundProcessingBootstrap;
}

/* =========================================================
 * Initialization helper
 * ======================================================= */

export function initializeScanItemBackgroundProcessing(
  options:
    BackgroundProcessingBootstrapOptions
): Promise<
  BackgroundProcessingBootstrapResult
> {
  return getDefaultBackgroundProcessingBootstrap()
    .initialize(
      options
    );
}

/* =========================================================
 * Runtime helpers
 * ======================================================= */

export function startScanItemProcessingQueue():
  Promise<
    ProcessingQueueSnapshot
  > {
  return getDefaultBackgroundProcessingBootstrap()
    .startQueue();
}

export function resumeScanItemProcessingQueue():
  Promise<
    ProcessingQueueSnapshot
  > {
  return getDefaultBackgroundProcessingBootstrap()
    .resumeQueue();
}

export function pauseScanItemProcessingQueue():
  Promise<
    ProcessingQueueSnapshot
  > {
  return getDefaultBackgroundProcessingBootstrap()
    .pauseQueue();
}

export function startScanItemBackgroundTask():
  Promise<boolean> {
  return getDefaultBackgroundProcessingBootstrap()
    .startBackgroundProcessing();
}

export function stopScanItemBackgroundTask(
  reason?:
    string
): Promise<boolean> {
  return getDefaultBackgroundProcessingBootstrap()
    .stopBackgroundProcessing(
      reason
    );
}

export function synchronizeScanItemBackgroundLifecycle():
  Promise<void> {
  return getDefaultBackgroundProcessingBootstrap()
    .synchronizeLifecycle();
}

export function recoverPendingScanItemProcessing():
  Promise<boolean> {
  return getDefaultBackgroundProcessingBootstrap()
    .recoverPendingProcessing();
}

/* =========================================================
 * Snapshot helpers
 * ======================================================= */

export function getScanItemBackgroundProcessingSnapshot():
  BackgroundProcessingBootstrapSnapshot {
  return getDefaultBackgroundProcessingBootstrap()
    .getSnapshot();
}

export function getScanItemBackgroundProcessingDiagnostics():
  BackgroundProcessingBootstrapDiagnostics {
  return getDefaultBackgroundProcessingBootstrap()
    .getDiagnostics();
}

/* =========================================================
 * Disposal helper
 * ======================================================= */

export async function disposeScanItemBackgroundProcessing():
  Promise<void> {
  if (
    !defaultBackgroundProcessingBootstrap
  ) {
    return;
  }

  await defaultBackgroundProcessingBootstrap
    .dispose();

  defaultBackgroundProcessingBootstrap =
    null;
}

export default
  BackgroundProcessingBootstrap;