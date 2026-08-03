// scan/core/background/BackgroundProcessingRegistry.ts
//
// Triple N - Background Processing Registry
//
// هذا الملف هو السجل المركزي المسؤول عن:
//
// 1) تسجيل Driver الخاص بـiOS.
// 2) تسجيل Driver الخاص بـAndroid.
// 3) اختيار Driver الصحيح حسب المنصة.
// 4) إنشاء BackgroundProcessingService بالـDrivers المسجلة.
// 5) منع إنشاء أكثر من نسخة متعارضة.
// 6) استبدال Driver أثناء التطوير والاختبارات.
// 7) حذف Drivers عند Dispose.
// 8) توفير Diagnostics واضحة.
//
// هذا الملف لا يحتوي أي Native Code.
//
// ملفات Native القادمة ستقوم بالتسجيل هنا:
//
// - IOSBackgroundProcessingDriver.ts
// - AndroidBackgroundProcessingDriver.ts

import {
    Platform,
} from 'react-native';

import type {
    ProcessingPlatform,
} from '../queue/QueueTypes';

import type {
    ScanItemQueueService,
} from '../services/ScanItemQueueService';

import {
    getDefaultScanItemQueueService,
} from '../services/ScanItemQueueService';

import type {
    BackgroundProcessingDriver,
    BackgroundProcessingServiceOptions,
} from '../services/BackgroundProcessingService';

import {
    BackgroundProcessingService,
} from '../services/BackgroundProcessingService';

/* =========================================================
 * Public types
 * ======================================================= */

export type BackgroundProcessingDriverRegistration = {
  platform:
    ProcessingPlatform;

  driver:
    BackgroundProcessingDriver;

  registeredAt:
    number;

  registrationId:
    string;

  metadata:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type RegisterBackgroundProcessingDriverOptions = {
  replaceExisting?:
    boolean;

  metadata?:
    Readonly<
      Record<
        string,
        string | number | boolean | null
      >
    >;
};

export type BackgroundProcessingRegistrySnapshot = {
  platform:
    ProcessingPlatform;

  iosRegistered:
    boolean;

  androidRegistered:
    boolean;

  unknownRegistered:
    boolean;

  registrations:
    readonly {
      platform:
        ProcessingPlatform;

      registrationId:
        string;

      registeredAt:
        number;

      metadata:
        Readonly<
          Record<
            string,
            string | number | boolean | null
          >
        >;
    }[];

  serviceCreated:
    boolean;

  servicePlatform:
    ProcessingPlatform | null;

  revision:
    number;

  lastUpdatedAt:
    number;
};

export type BackgroundProcessingRegistryDiagnostics = {
  registerCount:
    number;

  replaceCount:
    number;

  unregisterCount:
    number;

  serviceCreateCount:
    number;

  serviceDisposeCount:
    number;

  driverDisposeCount:
    number;

  lastRegisteredPlatform:
    ProcessingPlatform | null;

  lastUnregisteredPlatform:
    ProcessingPlatform | null;

  lastOperationAt:
    number | null;

  lastError:
    string | null;
};

export type CreateRegisteredBackgroundProcessingServiceOptions =
  Omit<
    BackgroundProcessingServiceOptions,
    | 'iosDriver'
    | 'androidDriver'
    | 'unknownPlatformDriver'
    | 'queueService'
  > & {
    queueService?:
      ScanItemQueueService;

    forceRecreate?:
      boolean;
  };

/* =========================================================
 * Internal helpers
 * ======================================================= */

function now():
  number {
  return Date.now();
}

function createRegistrationId(
  platform:
    ProcessingPlatform
): string {
  return [
    'background-driver',
    platform,
    Date.now()
      .toString(36),
    Math.random()
      .toString(36)
      .slice(
        2,
        10
      ),
  ].join(
    '-'
  );
}

function resolveCurrentPlatform():
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

function assertSupportedRegistryPlatform(
  platform:
    ProcessingPlatform
): void {
  if (
    platform ===
      'ios' ||
    platform ===
      'android' ||
    platform ===
      'unknown'
  ) {
    return;
  }

  throw new Error(
    `Unsupported background driver platform: ${platform}`
  );
}

function assertDriverMatchesPlatform(
  platform:
    ProcessingPlatform,
  driver:
    BackgroundProcessingDriver
): void {
  if (
    driver.platform !==
    platform
  ) {
    throw new Error(
      `Background driver platform mismatch. Expected ${platform}, received ${driver.platform}.`
    );
  }
}

/* =========================================================
 * Registry
 * ======================================================= */

export class BackgroundProcessingRegistry {
  private registrations =
    new Map<
      ProcessingPlatform,
      BackgroundProcessingDriverRegistration
    >();

  private service:
    BackgroundProcessingService | null =
      null;

  private servicePlatform:
    ProcessingPlatform | null =
      null;

  private revision =
    0;

  private lastUpdatedAt =
    now();

  private diagnostics:
    BackgroundProcessingRegistryDiagnostics = {
    registerCount:
      0,

    replaceCount:
      0,

    unregisterCount:
      0,

    serviceCreateCount:
      0,

    serviceDisposeCount:
      0,

    driverDisposeCount:
      0,

    lastRegisteredPlatform:
      null,

    lastUnregisteredPlatform:
      null,

    lastOperationAt:
      null,

    lastError:
      null,
  };

  /* =======================================================
   * Register
   * ===================================================== */

  public register(
    platform:
      ProcessingPlatform,
    driver:
      BackgroundProcessingDriver,
    options:
      RegisterBackgroundProcessingDriverOptions =
        {}
  ): BackgroundProcessingDriverRegistration {
    assertSupportedRegistryPlatform(
      platform
    );

    assertDriverMatchesPlatform(
      platform,
      driver
    );

    const existing =
      this.registrations.get(
        platform
      );

    if (
      existing &&
      !options.replaceExisting
    ) {
      throw new Error(
        `A background processing driver is already registered for ${platform}.`
      );
    }

    const registration:
      BackgroundProcessingDriverRegistration = {
      platform,

      driver,

      registeredAt:
        now(),

      registrationId:
        createRegistrationId(
          platform
        ),

      metadata: {
        ...(options.metadata ??
        {}),
      },
    };

    this.registrations.set(
      platform,
      registration
    );

    this.revision +=
      1;

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      registerCount:
        this.diagnostics
          .registerCount +
        1,

      replaceCount:
        this.diagnostics
          .replaceCount +
        (
          existing
            ? 1
            : 0
        ),

      lastRegisteredPlatform:
        platform,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        null,
    };

    return {
      ...registration,

      metadata: {
        ...registration.metadata,
      },
    };
  }

  public registerIOS(
    driver:
      BackgroundProcessingDriver,
    options:
      RegisterBackgroundProcessingDriverOptions =
        {}
  ): BackgroundProcessingDriverRegistration {
    return this.register(
      'ios',
      driver,
      options
    );
  }

  public registerAndroid(
    driver:
      BackgroundProcessingDriver,
    options:
      RegisterBackgroundProcessingDriverOptions =
        {}
  ): BackgroundProcessingDriverRegistration {
    return this.register(
      'android',
      driver,
      options
    );
  }

  public registerUnknownPlatform(
    driver:
      BackgroundProcessingDriver,
    options:
      RegisterBackgroundProcessingDriverOptions =
        {}
  ): BackgroundProcessingDriverRegistration {
    return this.register(
      'unknown',
      driver,
      options
    );
  }

  /* =======================================================
   * Unregister
   * ===================================================== */

  public async unregister(
    platform:
      ProcessingPlatform,
    disposeDriver =
      false
  ): Promise<boolean> {
    assertSupportedRegistryPlatform(
      platform
    );

    const registration =
      this.registrations.get(
        platform
      );

    if (
      !registration
    ) {
      return false;
    }

    this.registrations.delete(
      platform
    );

    if (
      disposeDriver
    ) {
      try {
        await registration.driver
          .dispose?.();

        this.diagnostics = {
          ...this.diagnostics,

          driverDisposeCount:
            this.diagnostics
              .driverDisposeCount +
            1,
        };
      } catch (error) {
        this.diagnostics = {
          ...this.diagnostics,

          lastError:
            getUnknownErrorMessage(
              error
            ),
        };
      }
    }

    this.revision +=
      1;

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      unregisterCount:
        this.diagnostics
          .unregisterCount +
        1,

      lastUnregisteredPlatform:
        platform,

      lastOperationAt:
        this.lastUpdatedAt,
    };

    return true;
  }

  /* =======================================================
   * Driver queries
   * ===================================================== */

  public getDriver(
    platform:
      ProcessingPlatform
  ): BackgroundProcessingDriver | null {
    assertSupportedRegistryPlatform(
      platform
    );

    return (
      this.registrations.get(
        platform
      )?.driver ??
      null
    );
  }

  public getCurrentPlatformDriver():
    BackgroundProcessingDriver | null {
    return this.getDriver(
      resolveCurrentPlatform()
    );
  }

  public hasDriver(
    platform:
      ProcessingPlatform
  ): boolean {
    return (
      this.getDriver(
        platform
      ) !==
      null
    );
  }

  public hasCurrentPlatformDriver():
    boolean {
    return (
      this.getCurrentPlatformDriver() !==
      null
    );
  }

  /* =======================================================
   * Service creation
   * ===================================================== */

  public createService(
    options:
      CreateRegisteredBackgroundProcessingServiceOptions =
        {}
  ): BackgroundProcessingService {
    const currentPlatform =
      resolveCurrentPlatform();

    if (
      this.service &&
      !options.forceRecreate
    ) {
      return this.service;
    }

    if (
      this.service &&
      options.forceRecreate
    ) {
      void this.disposeService();
    }

    const queueService =
      options.queueService ??
      getDefaultScanItemQueueService();

    this.service =
      new BackgroundProcessingService({
        queueService,

        iosDriver:
          this.getDriver(
            'ios'
          ),

        androidDriver:
          this.getDriver(
            'android'
          ),

        unknownPlatformDriver:
          this.getDriver(
            'unknown'
          ),

        autoInitialize:
          options.autoInitialize,

        autoStartWhenPending:
          options.autoStartWhenPending,

        resumeQueueWhenApplicationBecomesActive:
          options
            .resumeQueueWhenApplicationBecomesActive,

        stopNativeTaskWhenQueueCompletes:
          options
            .stopNativeTaskWhenQueueCompletes,

        enableDebugLogs:
          options.enableDebugLogs,
      });

    this.servicePlatform =
      currentPlatform;

    this.revision +=
      1;

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      serviceCreateCount:
        this.diagnostics
          .serviceCreateCount +
        1,

      lastOperationAt:
        this.lastUpdatedAt,

      lastError:
        null,
    };

    return this.service;
  }

  public getService():
    BackgroundProcessingService | null {
    return this.service;
  }

  public getOrCreateService(
    options:
      CreateRegisteredBackgroundProcessingServiceOptions =
        {}
  ): BackgroundProcessingService {
    return (
      this.service ??
      this.createService(
        options
      )
    );
  }

  /* =======================================================
   * Service disposal
   * ===================================================== */

  public async disposeService():
    Promise<void> {
    if (
      !this.service
    ) {
      return;
    }

    const service =
      this.service;

    this.service =
      null;

    this.servicePlatform =
      null;

    try {
      await service.dispose();
    } finally {
      this.revision +=
        1;

      this.lastUpdatedAt =
        now();

      this.diagnostics = {
        ...this.diagnostics,

        serviceDisposeCount:
          this.diagnostics
            .serviceDisposeCount +
        1,

        lastOperationAt:
          this.lastUpdatedAt,
      };
    }
  }

  /* =======================================================
   * Full disposal
   * ===================================================== */

  public async disposeAll():
    Promise<void> {
    await this.disposeService();

    const registrations =
      [
        ...this.registrations
          .values(),
      ];

    this.registrations.clear();

    for (
      const registration of
      registrations
    ) {
      try {
        await registration.driver
          .dispose?.();

        this.diagnostics = {
          ...this.diagnostics,

          driverDisposeCount:
            this.diagnostics
              .driverDisposeCount +
          1,
        };
      } catch (error) {
        this.diagnostics = {
          ...this.diagnostics,

          lastError:
            getUnknownErrorMessage(
              error
            ),
        };
      }
    }

    this.revision +=
      1;

    this.lastUpdatedAt =
      now();

    this.diagnostics = {
      ...this.diagnostics,

      lastOperationAt:
        this.lastUpdatedAt,
    };
  }

  /* =======================================================
   * Snapshot
   * ===================================================== */

  public getSnapshot():
    BackgroundProcessingRegistrySnapshot {
    const registrations =
      [
        ...this.registrations
          .values(),
      ]
        .sort(
          (
            first,
            second
          ) =>
            first.platform
              .localeCompare(
                second.platform
              )
        )
        .map(
          registration => ({
            platform:
              registration.platform,

            registrationId:
              registration
                .registrationId,

            registeredAt:
              registration
                .registeredAt,

            metadata: {
              ...registration
                .metadata,
            },
          })
        );

    return {
      platform:
        resolveCurrentPlatform(),

      iosRegistered:
        this.registrations
          .has(
            'ios'
          ),

      androidRegistered:
        this.registrations
          .has(
            'android'
          ),

      unknownRegistered:
        this.registrations
          .has(
            'unknown'
          ),

      registrations,

      serviceCreated:
        this.service !==
        null,

      servicePlatform:
        this.servicePlatform,

      revision:
        this.revision,

      lastUpdatedAt:
        this.lastUpdatedAt,
    };
  }

  public getDiagnostics():
    BackgroundProcessingRegistryDiagnostics {
    return {
      ...this.diagnostics,
    };
  }
}

/* =========================================================
 * Default registry
 * ======================================================= */

let defaultBackgroundProcessingRegistry:
  BackgroundProcessingRegistry | null =
    null;

export function getDefaultBackgroundProcessingRegistry():
  BackgroundProcessingRegistry {
  if (
    !defaultBackgroundProcessingRegistry
  ) {
    defaultBackgroundProcessingRegistry =
      new BackgroundProcessingRegistry();
  }

  return defaultBackgroundProcessingRegistry;
}

/* =========================================================
 * Registration helpers
 * ======================================================= */

export function registerIOSBackgroundProcessingDriver(
  driver:
    BackgroundProcessingDriver,
  options:
    RegisterBackgroundProcessingDriverOptions =
      {}
): BackgroundProcessingDriverRegistration {
  return getDefaultBackgroundProcessingRegistry()
    .registerIOS(
      driver,
      options
    );
}

export function registerAndroidBackgroundProcessingDriver(
  driver:
    BackgroundProcessingDriver,
  options:
    RegisterBackgroundProcessingDriverOptions =
      {}
): BackgroundProcessingDriverRegistration {
  return getDefaultBackgroundProcessingRegistry()
    .registerAndroid(
      driver,
      options
    );
}

export function registerUnknownBackgroundProcessingDriver(
  driver:
    BackgroundProcessingDriver,
  options:
    RegisterBackgroundProcessingDriverOptions =
      {}
): BackgroundProcessingDriverRegistration {
  return getDefaultBackgroundProcessingRegistry()
    .registerUnknownPlatform(
      driver,
      options
    );
}

/* =========================================================
 * Service helpers
 * ======================================================= */

export function createRegisteredBackgroundProcessingService(
  options:
    CreateRegisteredBackgroundProcessingServiceOptions =
      {}
): BackgroundProcessingService {
  return getDefaultBackgroundProcessingRegistry()
    .createService(
      options
    );
}

export function getRegisteredBackgroundProcessingService(
  options:
    CreateRegisteredBackgroundProcessingServiceOptions =
      {}
): BackgroundProcessingService {
  return getDefaultBackgroundProcessingRegistry()
    .getOrCreateService(
      options
    );
}

/* =========================================================
 * Disposal helpers
 * ======================================================= */

export async function disposeRegisteredBackgroundProcessingService():
  Promise<void> {
  await getDefaultBackgroundProcessingRegistry()
    .disposeService();
}

export async function disposeBackgroundProcessingRegistry():
  Promise<void> {
  if (
    !defaultBackgroundProcessingRegistry
  ) {
    return;
  }

  await defaultBackgroundProcessingRegistry
    .disposeAll();

  defaultBackgroundProcessingRegistry =
    null;
}