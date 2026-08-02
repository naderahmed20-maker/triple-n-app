import {
    NativeModule,
    requireNativeModule,
} from 'expo';

export type TripleNBackgroundEventSubscription = {
  remove:
    () => void;
};

export type TripleNBackgroundState =
  Record<
    string,
    unknown
  >;

export type TripleNBackgroundEventPayload =
  TripleNBackgroundState;

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

declare class TripleNBackgroundNativeModule
  extends NativeModule<
    TripleNBackgroundModuleEvents
  > {

  isAvailable():
    Promise<{
      available:
        boolean;

      platform:
        'ios';

      executor:
        string;

      applicationState:
        string;

      backgroundTimeRemaining:
        number;
    }>;

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

const nativeModule =
  requireNativeModule<
    TripleNBackgroundNativeModule
  >(
    'TripleNBackground'
  );

export const TripleNBackground =
  nativeModule;

export function addBackgroundTaskStartedListener(
  listener:
    (
      payload:
        TripleNBackgroundEventPayload
    ) => void
): TripleNBackgroundEventSubscription {
  return nativeModule
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
  return nativeModule
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
  return nativeModule
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
  return nativeModule
    .addListener(
      'onBackgroundTaskStopped',
      listener
    );
}

export default nativeModule;