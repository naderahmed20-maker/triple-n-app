// scan/core/background/index.ts
//
// Triple N - Background Processing Public API
//
// هذا الملف هو نقطة التصدير الموحدة لكل نظام:
//
// - Queue Background Processing
// - iOS Native Background Driver
// - Android Native Background Driver
// - Notifications
// - Bootstrap
//
// أي ملف خارج مجلد background يستورد من هنا
// بدل الاستيراد من الملفات الداخلية مباشرة.

/* =========================================================
 * Background processing service registry
 * ======================================================= */

export {
    BackgroundProcessingRegistry,
    createRegisteredBackgroundProcessingService,
    disposeBackgroundProcessingRegistry,
    disposeRegisteredBackgroundProcessingService,
    getDefaultBackgroundProcessingRegistry,
    getRegisteredBackgroundProcessingService,
    registerAndroidBackgroundProcessingDriver,
    registerIOSBackgroundProcessingDriver,
    registerUnknownBackgroundProcessingDriver
} from './BackgroundProcessingRegistry';

export type {
    BackgroundProcessingDriverRegistration,
    BackgroundProcessingRegistryDiagnostics,
    BackgroundProcessingRegistrySnapshot,
    CreateRegisteredBackgroundProcessingServiceOptions,
    RegisterBackgroundProcessingDriverOptions
} from './BackgroundProcessingRegistry';

/* =========================================================
 * iOS driver
 * ======================================================= */

export {
    createIOSBackgroundProcessingDriver, IOSBackgroundProcessingDriver
} from './IOSBackgroundProcessingDriver';

export type {
    IOSBackgroundExpirationEvent,
    IOSBackgroundFailureEvent,
    IOSBackgroundNativeCapabilityResult,
    IOSBackgroundNativeStartRequest,
    IOSBackgroundNativeStartResult,
    IOSBackgroundNativeStopRequest,
    IOSBackgroundNativeUpdateRequest,
    IOSBackgroundProcessingDriverDiagnostics,
    IOSBackgroundProcessingDriverOptions,
    IOSBackgroundProcessingNativeModule,
    IOSBackgroundResumeRequestedEvent,
    IOSBackgroundStoppedEvent
} from './IOSBackgroundProcessingDriver';

/* =========================================================
 * Android driver
 * ======================================================= */

export {
    AndroidBackgroundProcessingDriver,
    createAndroidBackgroundProcessingDriver
} from './AndroidBackgroundProcessingDriver';

export type {
    AndroidBackgroundExecutionStrategy,
    AndroidBackgroundExpiredEvent,
    AndroidBackgroundFailureEvent,
    AndroidBackgroundNativeCapabilityResult,
    AndroidBackgroundNativeStartRequest,
    AndroidBackgroundNativeStartResult,
    AndroidBackgroundNativeStopRequest,
    AndroidBackgroundNativeUpdateRequest,
    AndroidBackgroundProcessingDriverDiagnostics,
    AndroidBackgroundProcessingDriverOptions,
    AndroidBackgroundProcessingNativeModule,
    AndroidBackgroundProgressEvent,
    AndroidBackgroundResumeRequestedEvent,
    AndroidBackgroundStoppedEvent
} from './AndroidBackgroundProcessingDriver';

/* =========================================================
 * Main background processing bootstrap
 * ======================================================= */

/* =========================================================
 * Main background processing bootstrap
 * ======================================================= */

export {
    BackgroundProcessingBootstrap,
    disposeScanItemBackgroundProcessing,
    getDefaultBackgroundProcessingBootstrap,
    getScanItemBackgroundProcessingDiagnostics,
    getScanItemBackgroundProcessingSnapshot,
    initializeScanItemBackgroundProcessing,
    pauseScanItemProcessingQueue,
    recoverPendingScanItemProcessing,
    resumeScanItemProcessingQueue,
    startScanItemBackgroundTask,
    startScanItemProcessingQueue,
    stopScanItemBackgroundTask,
    synchronizeScanItemBackgroundLifecycle
} from './BackgroundProcessingBootstrap';

export type {
    BackgroundProcessingBootstrapDiagnostics,
    BackgroundProcessingBootstrapOptions,
    BackgroundProcessingBootstrapResult,
    BackgroundProcessingBootstrapSnapshot,
    BackgroundProcessingBootstrapState
} from './BackgroundProcessingBootstrap';


/* =========================================================
 * Application lifecycle coordination
 * ======================================================= */

export {
    BackgroundProcessingAppLifecycle,
    DEFAULT_BACKGROUND_PROCESSING_APP_LIFECYCLE_CONFIG,
    disposeBackgroundProcessingAppLifecycle,
    getBackgroundProcessingAppLifecycleDiagnostics,
    getBackgroundProcessingAppLifecycleSnapshot,
    getDefaultBackgroundProcessingAppLifecycle,
    initializeBackgroundProcessingAppLifecycle,
    recoverBackgroundProcessingAppLifecycle,
    synchronizeBackgroundProcessingAppLifecycle
} from './BackgroundProcessingAppLifecycle';

export type {
    BackgroundProcessingAppLifecycleConfig,
    BackgroundProcessingAppLifecycleDiagnostics,
    BackgroundProcessingAppLifecycleInitializeResult,
    BackgroundProcessingAppLifecycleOptions,
    BackgroundProcessingAppLifecycleSnapshot,
    BackgroundProcessingAppLifecycleState,
    BackgroundProcessingAppLifecycleTransition,
    BackgroundProcessingAppLifecycleTransitionReason,
    PartialBackgroundProcessingAppLifecycleConfig
} from './BackgroundProcessingAppLifecycle';

/* =========================================================
 * Notifications manager
 * ======================================================= */

export {
    BackgroundProcessingNotifications, createBackgroundProcessingNotifications, DEFAULT_BACKGROUND_PROCESSING_NOTIFICATIONS_CONFIG, disposeBackgroundProcessingNotifications,
    getDefaultBackgroundProcessingNotifications
} from './BackgroundProcessingNotifications';

export type {
    BackgroundProcessingNotificationsConfig,
    BackgroundProcessingNotificationsDiagnostics,
    BackgroundProcessingNotificationsOptions,
    BackgroundProcessingNotificationsSnapshot,
    BackgroundProcessingNotificationsState,
    PartialBackgroundProcessingNotificationsConfig,
    ProcessingNotificationAdapter,
    ProcessingNotificationPermissionResult,
    ProcessingNotificationPermissionStatus,
    ProcessingNotificationResponse,
    ProcessingNotificationSendResult
} from './BackgroundProcessingNotifications';

/* =========================================================
 * Expo notifications adapter
 * ======================================================= */

export {
    createExpoNotificationsAdapter, ExpoNotificationsAdapter
} from './ExpoNotificationsAdapter';

export type {
    ExpoNotificationsAdapterDiagnostics,
    ExpoNotificationsAdapterOptions
} from './ExpoNotificationsAdapter';

/* =========================================================
 * Notifications bootstrap
 * ======================================================= */

export {
    BackgroundProcessingNotificationsBootstrap,
    disposeBackgroundNotificationsBootstrap,
    getBackgroundProcessingNotificationsDiagnostics,
    getBackgroundProcessingNotificationsSnapshot,
    getDefaultBackgroundNotificationsBootstrap,
    initializeBackgroundProcessingNotifications,
    requestBackgroundNotificationPermission
} from './BackgroundProcessingNotificationsBootstrap';

export type {
    BackgroundNotificationRouteHandler,
    BackgroundNotificationsBootstrapDiagnostics,
    BackgroundNotificationsBootstrapOptions,
    BackgroundNotificationsBootstrapResult,
    BackgroundNotificationsBootstrapSnapshot,
    BackgroundNotificationsBootstrapState
} from './BackgroundProcessingNotificationsBootstrap';

