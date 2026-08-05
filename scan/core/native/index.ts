// scan/core/native/index.ts
//
// Triple N - Native Processing Public API

export * from './NativeProcessingBridge';
export * from './NativeProcessingContracts';
export * from './NativeProcessingPayloadFactory';
export * from './NativeProcessingQueueExecutor';
export * from './NativeProcessingStorage';

export {
  createNativeProcessingPayloadFromPartialInput,
  createNativeProcessingPayloadFromQueueJob,
  createNativeProcessingPayloadResult, DEFAULT_NATIVE_PROCESSING_CURRENT_ATTEMPT,
  DEFAULT_NATIVE_PROCESSING_MAXIMUM_ATTEMPTS,
  DEFAULT_NATIVE_PROCESSING_MAXIMUM_FILE_NAME_LENGTH,
  DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_ENTRIES,
  DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_KEY_LENGTH,
  DEFAULT_NATIVE_PROCESSING_MAXIMUM_METADATA_STRING_LENGTH,
  DEFAULT_NATIVE_PROCESSING_MAXIMUM_OUTPUT_QUALITY,
  DEFAULT_NATIVE_PROCESSING_MAXIMUM_PRIORITY,
  DEFAULT_NATIVE_PROCESSING_MINIMUM_OUTPUT_QUALITY,
  DEFAULT_NATIVE_PROCESSING_MINIMUM_PRIORITY,
  DEFAULT_NATIVE_PROCESSING_OUTPUT_FILE_PREFIX,
  DEFAULT_NATIVE_PROCESSING_OUTPUT_FORMAT,
  DEFAULT_NATIVE_PROCESSING_OUTPUT_QUALITY,
  DEFAULT_NATIVE_PROCESSING_PRIORITY,
  DEFAULT_NATIVE_PROCESSING_SOURCE_FORMAT, deserializeNativeProcessingPayload,
  estimateNativeProcessingPayloadSizeBytes,
  getNativeProcessingPayloadFactory,
  isValidNativeProcessingPayload, NativeProcessingPayloadFactory,
  NativeProcessingPayloadFactoryError, resetNativeProcessingPayloadFactory,
  resolveCurrentProcessingPlatform,
  serializeNativeProcessingPayload,
  setSharedNativeProcessingPayloadFactory,
  validateNativeProcessingPayload
} from './NativeProcessingPayloadFactory';

export type {
  NativeProcessingMetadata,
  NativeProcessingMetadataValue,
  NativeProcessingPayloadFactoryClock,
  NativeProcessingPayloadFactoryDiagnostics,
  NativeProcessingPayloadFactoryInput,
  NativeProcessingPayloadIdentifierFactory,
  NativeProcessingPayloadOptionsInput,
  NativeProcessingPayloadSourceInput,
  NativeProcessingPayloadWardrobeInput,
  NativeProcessingSourceFormat,
  PartialNativeProcessingPayloadFactoryInput
} from './NativeProcessingPayloadFactory';
