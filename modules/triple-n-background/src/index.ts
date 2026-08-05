// modules/triple-n-background/src/index.ts
//
// Triple N - Shared Native Background Module Entry
//
// هذا الملف يربط JavaScript بالموديول المشترك:
//
// - iOS:
//   TripleNBackgroundModule.swift
//
// - Android:
//   TripleNBackgroundModule.kt
//
// ملاحظة:
//
// TripleNNativeProcessing الخاص بمعالجة EdgeSAM على iOS
// لا يتم تحميله من هذا الملف.
//
// الربط الخاص به موجود بالفعل داخل:
//
// scan/core/native/NativeProcessingBridge.ts
//
// وبذلك لا نحاول تحميل TripleNNativeProcessing على Android
// حيث إنه غير مسجل حاليًا كموديول Android مستقل.
//

import {
  NativeModule,
  requireNativeModule,
} from 'expo';

/* =========================================================
 * Shared contracts
 * ======================================================= */

export type TripleNBackgroundEventSubscription = {
  remove:
    () => void;
};

export type TripleNBackgroundPlatform =
  | 'ios'
  | 'android';

export type TripleNBackgroundDictionary =
  Record<
    string,
    unknown
  >;

export type TripleNBackgroundState =
  TripleNBackgroundDictionary;

export type TripleNBackgroundEventPayload =
  TripleNBackgroundState;

/* =========================================================
 * Availability result
 * ======================================================= */

export type TripleNBackgroundAvailabilityResult = {
  available:
    boolean;

  platform:
    TripleNBackgroundPlatform;

  executor:
    string;

  applicationState?:
    string;

  backgroundTimeRemaining?:
    number;

  [key:
    string]:
    unknown;
};

/* =========================================================
 * Event contract
 * ======================================================= */

export type TripleNBackgroundModuleEvents = {
  onBackgroundTaskStarted:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void;

  onBackgroundTaskProgress:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void;

  onBackgroundTaskExpired:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void;

  onBackgroundTaskStopped:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void;
};

/* =========================================================
 * Native module contract
 * ======================================================= */

declare class TripleNBackgroundNativeModule
  extends NativeModule<
    TripleNBackgroundModuleEvents
  > {

  readonly platform?:
    TripleNBackgroundPlatform;

  readonly available?:
    boolean;

  isAvailable():
    Promise<
      TripleNBackgroundAvailabilityResult
    >;

  startBackgroundTask(
    taskId:
      string,
    taskName?:
      string
  ):
    Promise<
      TripleNBackgroundState
    >;

  updateBackgroundTask(
    taskId:
      string,
    progress:
      number,
    stage?:
      string,
    message?:
      string
  ):
    Promise<
      TripleNBackgroundState
    >;

  stopBackgroundTask(
    taskId?:
      string
  ):
    Promise<
      TripleNBackgroundState
    >;

  getBackgroundTaskState():
    Promise<
      TripleNBackgroundState
    >;
}

/* =========================================================
 * Native module instance
 * ======================================================= */

const tripleNBackgroundNativeModule =
  requireNativeModule<
    TripleNBackgroundNativeModule
  >(
    'TripleNBackground'
  );

/* =========================================================
 * Public module export
 * ======================================================= */

export const TripleNBackground =
  tripleNBackgroundNativeModule;

/* =========================================================
 * Event listeners
 * ======================================================= */

export function addBackgroundTaskStartedListener(
  listener:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void
): TripleNBackgroundEventSubscription {
  return tripleNBackgroundNativeModule
    .addListener(
      'onBackgroundTaskStarted',
      listener
    );
}

export function addBackgroundTaskProgressListener(
  listener:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void
): TripleNBackgroundEventSubscription {
  return tripleNBackgroundNativeModule
    .addListener(
      'onBackgroundTaskProgress',
      listener
    );
}

export function addBackgroundTaskExpiredListener(
  listener:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void
): TripleNBackgroundEventSubscription {
  return tripleNBackgroundNativeModule
    .addListener(
      'onBackgroundTaskExpired',
      listener
    );
}

export function addBackgroundTaskStoppedListener(
  listener:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void
): TripleNBackgroundEventSubscription {
  return tripleNBackgroundNativeModule
    .addListener(
      'onBackgroundTaskStopped',
      listener
    );
}

/* =========================================================
 * Default export
 * ======================================================= */

export default tripleNBackgroundNativeModule;