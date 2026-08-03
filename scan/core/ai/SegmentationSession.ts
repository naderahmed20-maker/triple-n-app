// scan/core/ai/SegmentationSession.ts
// Part 1/3
//
// Triple N - EdgeSAM ONNX Session Manager
//
// هذا الملف يدير:
//
// - EdgeSAM Image Encoder Session.
// - EdgeSAM Mask Decoder Session.
// - نسخ موديلات ONNX من Native Bundle.
// - اختيار Execution Provider.
// - تشغيل Encoder.
// - تشغيل Decoder.
// - تحويل ONNX Tensors إلى الأنواع الداخلية.
// - منع تشغيل أكثر من عملية في نفس الوقت.
// - Timeout وCancellation.
// - Reload وDispose.
//
// لا يقوم هذا الملف بـ:
//
// - تجهيز الصورة.
// - إنشاء Prompt تلقائي.
// - اختيار أفضل Mask.
// - تحسين Alpha Mask.

import {
  Platform,
} from 'react-native';

import {
  Asset,
} from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

import {
  InferenceSession,
  Tensor,
} from 'onnxruntime-react-native';

import type {
  EdgeSamDecoderInputs,
  EdgeSamDecoderRawOutput,
  EdgeSamDecoderRunRequest,
  EdgeSamEncoderInput,
  EdgeSamEncoderRawOutput,
  EdgeSamEncoderRunRequest,
  EdgeSamImageEmbedding,
  EdgeSamSessionInfo,
  SegmentationCancellationSignal,
  SegmentationComponentSessionInfo,
  SegmentationExecutionProvider,
  SegmentationFloatTensor,
  SegmentationModelAsset,
  SegmentationModelComponent,
  SegmentationModelConfig,
  SegmentationProgressCallback,
  SegmentationSessionDiagnostics,
  SegmentationSessionLoadResult,
  SegmentationSessionModelInfo,
  SegmentationSessionState,
  SegmentationSessionTensorInfo,
  SegmentationTensor,
  SegmentationTensorData,
  SegmentationTensorDataType,
  SegmentationTensorLayout,
} from './types';

import {
  SegmentationError,
  createSegmentationProgressEvent,
  createSegmentationRequestId,
  getTensorElementCount,
  getUnknownErrorMessage,
  isSegmentationError
} from './types';

import {
  DEFAULT_SEGMENTATION_MODEL_CONFIG,
  assertSupportedNativePlatform,
  cloneSegmentationModelConfig,
  validateSegmentationModelConfig,
} from './modelConfig';

/* =========================================================
 * Public inputs
 * ======================================================= */

export type SegmentationSessionInitializeInput = {
  config?:
    SegmentationModelConfig;

  requestId?:
    string;

  onProgress?:
    SegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;

  forceReload?:
    boolean;

  warmup?:
    boolean;
};

export type SegmentationSessionDisposeOptions = {
  /**
   * حذف نسخ الموديلات المحلية.
   *
   * الوضع الافتراضي false حتى لا نعيد
   * نسخ الموديلات عند كل تشغيل.
   */
  removeCopiedModels?:
    boolean;

  /**
   * تفريغ Embedding Cache.
   */
  clearEmbeddingCache?:
    boolean;
};

export type EdgeSamEncoderSessionRunInput =
  EdgeSamEncoderRunRequest & {
    config?:
      SegmentationModelConfig;

    onProgress?:
      SegmentationProgressCallback;

    outputNames?:
      readonly string[];

    reuseEmbedding?:
      boolean;
  };

export type EdgeSamDecoderSessionRunInput =
  EdgeSamDecoderRunRequest & {
    config?:
      SegmentationModelConfig;

    onProgress?:
      SegmentationProgressCallback;

    outputNames?:
      readonly string[];
  };

/* =========================================================
 * ONNX aliases
 * ======================================================= */

type OrtSession =
  InferenceSession;

type OrtTensor =
  Tensor;

type OrtFeeds =
  Record<
    string,
    OrtTensor
  >;

type OrtResults =
  Record<
    string,
    OrtTensor
  >;

/* =========================================================
 * Internal structures
 * ======================================================= */

type PreparedModelAsset = {
  component:
    SegmentationModelComponent;

  sourceUri:
    string;

  localUri:
    string;

  fileSize:
    number | null;

  reused:
    boolean;

  asset:
    SegmentationModelAsset;
};

type SessionCreationAttempt = {
  label:
    string;

  provider:
    SegmentationExecutionProvider;

  options:
    InferenceSession.SessionOptions;
};

type LoadedComponentSession = {
  component:
    SegmentationModelComponent;

  session:
    OrtSession;

  asset:
    PreparedModelAsset;

  provider:
    SegmentationExecutionProvider;

  inputNames:
    readonly string[];

  outputNames:
    readonly string[];

  loadedAt:
    number;

  loadDurationMs:
    number;
};

type ComponentRuntimeState = {
  component:
    SegmentationModelComponent;

  state:
    SegmentationSessionState;

  session:
    OrtSession | null;

  inputNames:
    readonly string[];

  outputNames:
    readonly string[];

  provider:
    SegmentationExecutionProvider;

  modelPath:
    string | null;

  loadedAt:
    number | null;

  lastUsedAt:
    number | null;

  runCount:
    number;

  sessionLoadMs:
    number | null;

  lastInferenceMs:
    number | null;

  lastError:
    string | null;
};

type EmbeddingCacheRecord = {
  key:
    string;

  embedding:
    EdgeSamImageEmbedding;

  createdAt:
    number;

  lastUsedAt:
    number;

  hitCount:
    number;
};

/* =========================================================
 * Constants
 * ======================================================= */

const MODEL_DIRECTORY_NAME =
  'edge-sam-models';

const MODEL_VERSION_FILE_NAME =
  'edge-sam-model-versions.json';

const MINIMUM_ENCODER_FILE_BYTES =
  1 * 1024 * 1024;

const MINIMUM_DECODER_FILE_BYTES =
  64 * 1024;

const MAXIMUM_TENSOR_ELEMENTS =
  128_000_000;

const DEFAULT_MODEL_LOAD_TIMEOUT_MS =
  120_000;

const EMBEDDING_CACHE_PREFIX =
  'edgesam-embedding';

  /**
 * يجب أن تكون require ثابتة حتى يضم Metro
 * ملفات EdgeSAM داخل الـNative Build.
 */
const EDGESAM_ENCODER_ASSET_MODULE =
  require(
    '../../../assets/models/edgesam/edge_sam_3x_encoder.onnx'
  );

const EDGESAM_DECODER_ASSET_MODULE =
  require(
    '../../../assets/models/edgesam/edge_sam_3x_decoder.onnx'
  );

function getBundledModelModule(
  component:
    SegmentationModelComponent
): number {
  return component ===
    'encoder'
    ? EDGESAM_ENCODER_ASSET_MODULE
    : EDGESAM_DECODER_ASSET_MODULE;
}

/* =========================================================
 * Small helpers
 * ======================================================= */

function now():
  number {
  return Date.now();
}

function assertNotCancelled(
  signal?:
    SegmentationCancellationSignal
): void {
  signal?.throwIfCancelled();
}

function emitProgress(
  requestId:
    string,
  stage:
    | 'load-model-sessions'
    | 'run-image-encoder'
    | 'run-mask-decoder'
    | 'read-mask-candidates',
  message:
    string,
  startedAt:
    number,
  callback?:
    SegmentationProgressCallback,
  metadata?: Record<
    string,
    string | number | boolean | null
  >
): void {
  if (!callback) {
    return;
  }

  callback(
    createSegmentationProgressEvent(
      requestId,
      stage,
      startedAt,
      message,
      metadata
    )
  );
}

function createComponentState(
  component:
    SegmentationModelComponent,
  provider:
    SegmentationExecutionProvider
): ComponentRuntimeState {
  return {
    component,

    state:
      'uninitialized',

    session:
      null,

    inputNames:
      [],

    outputNames:
      [],

    provider,

    modelPath:
      null,

    loadedAt:
      null,

    lastUsedAt:
      null,

    runCount:
      0,

    sessionLoadMs:
      null,

    lastInferenceMs:
      null,

    lastError:
      null,
  };
}

function getWritableBaseDirectory():
  string {
  const directory =
    FileSystem.documentDirectory ??
    FileSystem.cacheDirectory;

  if (
    typeof directory !== 'string' ||
    directory.trim().length === 0
  ) {
    throw new SegmentationError(
      'MODEL_COPY_FAILED',
      'No writable application directory is available for EdgeSAM models.',
      {
        stage:
          'load-model-sessions',

        retryable:
          false,
      }
    );
  }

  return directory;
}

function getModelDirectory():
  string {
  return (
    `${getWritableBaseDirectory()}` +
    `${MODEL_DIRECTORY_NAME}/`
  );
}

function sanitizeFileName(
  value:
    string
): string {
  const sanitized =
    value.replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );

  return (
    sanitized.length > 0
      ? sanitized
      : 'edgesam-model.onnx'
  );
}

function getComponentLocalModelUri(
  asset:
    SegmentationModelAsset
): string {
  return (
    `${getModelDirectory()}` +
    `${sanitizeFileName(
      asset.component
    )}-` +
    `${sanitizeFileName(
      asset.version
    )}-` +
    `${sanitizeFileName(
      asset.fileName
    )}`
  );
}

function getVersionFileUri():
  string {
  return (
    `${getModelDirectory()}` +
    MODEL_VERSION_FILE_NAME
  );
}

function getMinimumModelFileBytes(
  component:
    SegmentationModelComponent
): number {
  return (
    component === 'encoder'
      ? MINIMUM_ENCODER_FILE_BYTES
      : MINIMUM_DECODER_FILE_BYTES
  );
}

function getComponentAsset(
  config:
    SegmentationModelConfig,
  component:
    SegmentationModelComponent
): SegmentationModelAsset {
  return (
    component === 'encoder'
      ? config.assets.encoder
      : config.assets.decoder
  );
}

function getComponentSessionConfig(
  config:
    SegmentationModelConfig,
  component:
    SegmentationModelComponent
) {
  return (
    component === 'encoder'
      ? config.encoder.session
      : config.decoder.session
  );
}

/* =========================================================
 * Configuration signatures
 * ======================================================= */

function createSessionConfigSignature(
  config:
    SegmentationModelConfig
): string {
  return JSON.stringify({
    modelId:
      config.id,

    modelVersion:
      config.version,

    encoder: {
      resourceName:
        config.assets.encoder
          .resourceName,

      bundledFileName:
        config.assets.encoder
          .bundledFileName,

      fileName:
        config.assets.encoder
          .fileName,

      assetVersion:
        config.assets.encoder
          .version,

      inputName:
        config.encoder.input.name,

      inputWidth:
        config.encoder.input.width,

      inputHeight:
        config.encoder.input.height,

      outputName:
        config.encoder.output
          .preferredName,

      session:
        config.encoder.session,
    },

    decoder: {
      resourceName:
        config.assets.decoder
          .resourceName,

      bundledFileName:
        config.assets.decoder
          .bundledFileName,

      fileName:
        config.assets.decoder
          .fileName,

      assetVersion:
        config.assets.decoder
          .version,

      inputNames:
        config.decoder.config
          .inputNames,

      outputNames:
        config.decoder.config
          .outputNames,

      session:
        config.decoder.session,
    },
  });
}

function areSessionConfigsEquivalent(
  first:
    SegmentationModelConfig,
  second:
    SegmentationModelConfig
): boolean {
  return (
    createSessionConfigSignature(
      first
    ) ===
    createSessionConfigSignature(
      second
    )
  );
}

/* =========================================================
 * File-system helpers
 * ======================================================= */

async function ensureDirectory(
  uri:
    string
): Promise<void> {
  const info =
    await FileSystem.getInfoAsync(
      uri
    );

  if (info.exists) {
    if (
      'isDirectory' in info &&
      !info.isDirectory
    ) {
      throw new SegmentationError(
        'MODEL_COPY_FAILED',
        'The EdgeSAM model directory path points to a file.',
        {
          stage:
            'load-model-sessions',

          retryable:
            false,

          metadata: {
            uri,
          },
        }
      );
    }

    return;
  }

  await FileSystem.makeDirectoryAsync(
    uri,
    {
      intermediates:
        true,
    }
  );
}

async function safelyDelete(
  uri:
    string
): Promise<void> {
  try {
    const info =
      await FileSystem.getInfoAsync(
        uri
      );

    if (!info.exists) {
      return;
    }

    await FileSystem.deleteAsync(
      uri,
      {
        idempotent:
          true,
      }
    );
  } catch {
    /**
     * فشل التنظيف لا يجب أن يكسر
     * العملية الأساسية.
     */
  }
}

async function getFileSize(
  uri:
    string
): Promise<number | null> {
  try {
    const info =
      await FileSystem.getInfoAsync(
        uri
      );

    if (!info.exists) {
      return null;
    }

    if (
      'size' in info &&
      typeof info.size === 'number'
    ) {
      return info.size;
    }

    return null;
  } catch {
    return null;
  }
}

async function validateModelFile(
  uri:
    string,
  component:
    SegmentationModelComponent
): Promise<number | null> {
  const info =
    await FileSystem.getInfoAsync(
      uri
    );

  if (!info.exists) {
    throw new SegmentationError(
      'MODEL_ASSET_NOT_FOUND',
      `The EdgeSAM ${component} model file was not found.`,
      {
        stage:
          'load-model-sessions',

        component,

        retryable:
          false,

        metadata: {
          uri,
        },
      }
    );
  }

  if (
    'isDirectory' in info &&
    info.isDirectory
  ) {
    throw new SegmentationError(
      'MODEL_ASSET_INVALID',
      `The EdgeSAM ${component} model path points to a directory.`,
      {
        stage:
          'load-model-sessions',

        component,

        retryable:
          false,

        metadata: {
          uri,
        },
      }
    );
  }

  const fileSize =
    (
      'size' in info &&
      typeof info.size === 'number'
    )
      ? info.size
      : null;

  const minimumBytes =
    getMinimumModelFileBytes(
      component
    );

  if (
    fileSize !== null &&
    fileSize < minimumBytes
  ) {
    throw new SegmentationError(
      'MODEL_ASSET_INVALID',
      `The EdgeSAM ${component} model file is empty or incomplete.`,
      {
        stage:
          'load-model-sessions',

        component,

        retryable:
          false,

        metadata: {
          uri,

          fileSize,

          minimumBytes,
        },
      }
    );
  }

  return fileSize;
}

/* =========================================================
 * Stored version metadata
 * ======================================================= */

type StoredModelVersions = {
  encoder?:
    string;

  decoder?:
    string;
};

async function readStoredVersions():
  Promise<StoredModelVersions> {
  try {
    const uri =
      getVersionFileUri();

    const info =
      await FileSystem.getInfoAsync(
        uri
      );

    if (!info.exists) {
      return {};
    }

    const content =
      await FileSystem.readAsStringAsync(
        uri
      );

    const parsed =
      JSON.parse(
        content
      ) as unknown;

    if (
      typeof parsed !== 'object' ||
      parsed === null
    ) {
      return {};
    }

    const record =
      parsed as Record<
        string,
        unknown
      >;

    return {
      encoder:
        typeof record.encoder ===
          'string'
          ? record.encoder
          : undefined,

      decoder:
        typeof record.decoder ===
          'string'
          ? record.decoder
          : undefined,
    };
  } catch {
    return {};
  }
}

async function storeComponentVersion(
  component:
    SegmentationModelComponent,
  version:
    string
): Promise<void> {
  const current =
    await readStoredVersions();

  const next:
    StoredModelVersions = {
    ...current,

    [component]:
      version,
  };

  await FileSystem.writeAsStringAsync(
    getVersionFileUri(),
    JSON.stringify(
      next
    )
  );
}

/* =========================================================
 * Model asset preparation
 * ======================================================= */

async function prepareModelAsset(
  asset:
    SegmentationModelAsset,
  signal?:
    SegmentationCancellationSignal
): Promise<PreparedModelAsset> {
  assertNotCancelled(
    signal
  );

  const modelDirectory =
    getModelDirectory();

  const localUri =
    getComponentLocalModelUri(
      asset
    );

  try {
    await ensureDirectory(
      modelDirectory
    );
  } catch (error) {
    if (
      isSegmentationError(
        error
      )
    ) {
      throw error;
    }

    throw new SegmentationError(
      'MODEL_COPY_FAILED',
      `Could not create the EdgeSAM model directory: ${getUnknownErrorMessage(
        error
      )}`,
      {
        stage:
          'load-model-sessions',

        component:
          asset.component,

        retryable:
          true,

        cause:
          error,
      }
    );
  }

  assertNotCancelled(
    signal
  );

  /* -------------------------------------------------------
   * Resolve bundled Expo asset
   * ----------------------------------------------------- */

  let sourceUri:
    string;

  try {
    const assetModule =
      getBundledModelModule(
        asset.component
      );

    const bundledAsset =
      Asset.fromModule(
        assetModule
      );

    await bundledAsset
      .downloadAsync();

    assertNotCancelled(
      signal
    );

    const resolvedUri =
      bundledAsset.localUri ??
      bundledAsset.uri;

    if (
      typeof resolvedUri !==
        'string' ||
      resolvedUri.trim().length ===
        0
    ) {
      throw new SegmentationError(
        'MODEL_ASSET_NOT_FOUND',
        `Expo Asset did not provide a local URI for the EdgeSAM ${asset.component} model.`,
        {
          stage:
            'load-model-sessions',

          component:
            asset.component,

          retryable:
            false,

          metadata: {
            resourceName:
              asset.resourceName,

            configuredBundledFileName:
              asset.bundledFileName,
          },
        }
      );
    }

    sourceUri =
      resolvedUri;
  } catch (error) {
    if (
      isSegmentationError(
        error
      )
    ) {
      throw error;
    }

    throw new SegmentationError(
      'MODEL_ASSET_NOT_FOUND',
      `Could not resolve the bundled EdgeSAM ${asset.component} model: ${getUnknownErrorMessage(
        error
      )}`,
      {
        stage:
          'load-model-sessions',

        component:
          asset.component,

        retryable:
          false,

        cause:
          error,

        metadata: {
          resourceName:
            asset.resourceName,

          configuredBundledFileName:
            asset.bundledFileName,

          platform:
            Platform.OS,
        },
      }
    );
  }

  assertNotCancelled(
    signal
  );

  /**
   * نتأكد أن Expo Asset أنشأ ملفًا محليًا
   * صالحًا قبل محاولة نسخه.
   */
  await validateModelFile(
    sourceUri,
    asset.component
  );

  /* -------------------------------------------------------
   * Reuse existing copied model
   * ----------------------------------------------------- */

  const versions =
    await readStoredVersions();

  const storedVersion =
    asset.component ===
      'encoder'
      ? versions.encoder
      : versions.decoder;

  const existingInfo =
    await FileSystem.getInfoAsync(
      localUri
    );

  const minimumBytes =
    getMinimumModelFileBytes(
      asset.component
    );

  const existingFileIsValid =
    existingInfo.exists &&
    (
      !(
        'isDirectory' in
        existingInfo
      ) ||
      !existingInfo.isDirectory
    ) &&
    storedVersion ===
      asset.version &&
    (
      !(
        'size' in
        existingInfo
      ) ||
      typeof existingInfo.size !==
        'number' ||
      existingInfo.size >=
        minimumBytes
    );

  if (
    existingFileIsValid
  ) {
    const fileSize =
      await validateModelFile(
        localUri,
        asset.component
      );

    return {
      component:
        asset.component,

      sourceUri,

      localUri,

      fileSize,

      reused:
        true,

      asset,
    };
  }

  /* -------------------------------------------------------
   * Copy model to stable writable location
   * ----------------------------------------------------- */

  await safelyDelete(
    localUri
  );

  assertNotCancelled(
    signal
  );

  try {
    await FileSystem.copyAsync({
      from:
        sourceUri,

      to:
        localUri,
    });
  } catch (error) {
    throw new SegmentationError(
      'MODEL_COPY_FAILED',
      `Could not copy the EdgeSAM ${asset.component} model: ${getUnknownErrorMessage(
        error
      )}`,
      {
        stage:
          'load-model-sessions',

        component:
          asset.component,

        retryable:
          true,

        cause:
          error,

        metadata: {
          sourceUri,

          localUri,

          resourceName:
            asset.resourceName,

          platform:
            Platform.OS,
        },
      }
    );
  }

  assertNotCancelled(
    signal
  );

  const copiedSize =
    await validateModelFile(
      localUri,
      asset.component
    );

  const sourceSize =
    await getFileSize(
      sourceUri
    );

  if (
    sourceSize !== null &&
    copiedSize !== null &&
    sourceSize !== copiedSize
  ) {
    await safelyDelete(
      localUri
    );

    throw new SegmentationError(
      'MODEL_COPY_FAILED',
      `The copied EdgeSAM ${asset.component} size does not match the bundled model.`,
      {
        stage:
          'load-model-sessions',

        component:
          asset.component,

        retryable:
          true,

        metadata: {
          sourceSize,

          copiedSize,

          sourceUri,

          localUri,
        },
      }
    );
  }

  await storeComponentVersion(
    asset.component,
    asset.version
  );

  return {
    component:
      asset.component,

    sourceUri,

    localUri,

    fileSize:
      copiedSize,

    reused:
      false,

    asset,
  };
}

/* =========================================================
 * Session-option helpers
 * ======================================================= */

function mapLogSeverityLevel(
  level:
    SegmentationModelConfig[
      'encoder'
    ]['session']['logLevel']
): 0 | 1 | 2 | 3 | 4 {
  switch (level) {
    case 'debug':
      return 0;

    case 'info':
      return 1;

    case 'warning':
      return 2;

    case 'error':
      return 3;

    case 'none':
    default:
      return 4;
  }
}

function mapGraphOptimizationLevel(
  value:
    SegmentationModelConfig[
      'encoder'
    ]['session']['graphOptimizationLevel']
): 'disabled' | 'basic' | 'extended' | 'all' {
  switch (value) {
    case 'disabled':
      return 'disabled';

    case 'basic':
      return 'basic';

    case 'extended':
      return 'extended';

    case 'all':
    default:
      return 'all';
  }
}

function createBaseSessionOptions(
  config:
    SegmentationModelConfig,
  component:
    SegmentationModelComponent
): InferenceSession.SessionOptions {
  const sessionConfig =
    getComponentSessionConfig(
      config,
      component
    );

  return {
    graphOptimizationLevel:
      mapGraphOptimizationLevel(
        sessionConfig
          .graphOptimizationLevel
      ),

    executionMode:
      'sequential',

    intraOpNumThreads:
      Math.max(
        1,
        Math.round(
          sessionConfig
            .intraOpNumThreads
        )
      ),

    interOpNumThreads:
      Math.max(
        1,
        Math.round(
          sessionConfig
            .interOpNumThreads
        )
      ),

    enableCpuMemArena:
      sessionConfig
        .enableCpuMemArena,

    enableMemPattern:
      sessionConfig
        .enableMemPattern,

    enableProfiling:
      sessionConfig
        .enableProfiling,

    logSeverityLevel:
      mapLogSeverityLevel(
        sessionConfig.logLevel
      ),

    logId:
      `triplen-edgesam-${component}`,
  };
}

function createSessionAttempts(
  config:
    SegmentationModelConfig,
  component:
    SegmentationModelComponent
): SessionCreationAttempt[] {
  const sessionConfig =
    getComponentSessionConfig(
      config,
      component
    );

  const requestedProvider =
    sessionConfig.executionProvider;

  const baseOptions =
    createBaseSessionOptions(
      config,
      component
    );

  const attempts:
    SessionCreationAttempt[] =
      [];

  if (
    Platform.OS === 'ios' &&
    (
      requestedProvider === 'auto' ||
      requestedProvider === 'coreml'
    )
  ) {
    attempts.push({
      label:
        'coreml',

      provider:
        'coreml',

      options: {
        ...baseOptions,

        executionProviders: [
          {
            name:
              'coreml',

            enableOnSubgraph:
              false,

            /**
             * لا نفرض ANE فقط،
             * لأن بعض أجهزة iOS المدعومة
             * قد تحتاج CPU/GPU fallback.
             */
            onlyEnableDeviceWithANE:
              false,

            useCPUOnly:
              false,
          },
        ],
      },
    });
  }

  if (
    Platform.OS === 'android' &&
    requestedProvider === 'nnapi'
  ) {
    attempts.push({
      label:
        'nnapi',

      provider:
        'nnapi',

      options: {
        ...baseOptions,

        executionProviders: [
          'nnapi',
        ],
      },
    });
  }

  if (
    Platform.OS === 'android' &&
    requestedProvider === 'xnnpack'
  ) {
    attempts.push({
      label:
        'xnnpack',

      provider:
        'xnnpack',

      options: {
        ...baseOptions,

        executionProviders: [
          'xnnpack',
        ],
      },
    });
  }

  /**
   * CPU fallback موجود دائمًا.
   */
  attempts.push({
    label:
      'default-cpu',

    provider:
      'cpu',

    options:
      baseOptions,
  });

  return attempts;
}

/* =========================================================
 * Tensor helpers
 * ======================================================= */

function normalizeTensorDataType(
  value:
    string
): SegmentationTensorDataType {
  switch (value) {
    case 'float32':
    case 'float64':
    case 'float16':
    case 'int32':
    case 'int64':
    case 'uint8':
    case 'int8':
    case 'bool':
      return value;

    default:
      return 'float32';
  }
}

function inferTensorLayout(
  dimensions:
    readonly number[]
): SegmentationTensorLayout {
  if (
    dimensions.length === 4
  ) {
    return 'NCHW';
  }

  if (
    dimensions.length === 3
  ) {
    return 'CHW';
  }

  if (
    dimensions.length === 2
  ) {
    return 'NC';
  }

  return 'unknown';
}

function convertOrtTensorData(
  tensor:
    OrtTensor
): SegmentationTensorData {
  const data =
    tensor.data;

  if (
    data instanceof Float32Array ||
    data instanceof Float64Array ||
    data instanceof Int32Array ||
    data instanceof Uint8Array ||
    data instanceof Int8Array
  ) {
    return data;
  }

  if (
    typeof BigInt64Array !== 'undefined' &&
    data instanceof BigInt64Array
  ) {
    return data;
  }

  if (
    Array.isArray(data) &&
    data.every(
      value =>
        typeof value === 'boolean'
    )
  ) {
    return data;
  }

  if (
    data &&
    typeof data.length === 'number'
  ) {
    const output =
      new Float32Array(
        data.length
      );

    for (
      let index = 0;
      index < data.length;
      index += 1
    ) {
      const item =
        data[index];

      const numericValue =
        typeof item === 'bigint'
          ? Number(item)
          : typeof item === 'boolean'
            ? (
                item
                  ? 1
                  : 0
              )
            : Number(item);

      if (
        !Number.isFinite(
          numericValue
        )
      ) {
        throw new SegmentationError(
          'INVALID_MODEL_OUTPUT',
          'The ONNX tensor contains a non-finite value.',
          {
            stage:
              'read-mask-candidates',

            retryable:
              false,

            metadata: {
              index,

              value:
                String(item),
            },
          }
        );
      }

      output[index] =
        numericValue;
    }

    return output;
  }

  throw new SegmentationError(
    'INVALID_MODEL_OUTPUT',
    'The ONNX tensor contains unsupported data.',
    {
      stage:
        'read-mask-candidates',

      retryable:
        false,
    }
  );
}

function convertOrtTensor(
  name:
    string,
  tensor:
    OrtTensor
): SegmentationTensor {
  const dimensions =
    Array.from(
      tensor.dims
    ).map(
      dimension =>
        Number(dimension)
    );

  if (
    dimensions.length === 0
  ) {
    throw new SegmentationError(
      'INVALID_MODEL_OUTPUT',
      `The ONNX tensor "${name}" has no dimensions.`,
      {
        stage:
          'read-mask-candidates',

        retryable:
          false,

        metadata: {
          tensorName:
            name,
        },
      }
    );
  }

  const elementCount =
    getTensorElementCount(
      dimensions
    );

  if (
    elementCount <= 0
  ) {
    throw new SegmentationError(
      'INVALID_MODEL_OUTPUT',
      `The ONNX tensor "${name}" has invalid dimensions.`,
      {
        stage:
          'read-mask-candidates',

        retryable:
          false,

        metadata: {
          dimensions:
            dimensions.join('x'),
        },
      }
    );
  }

  if (
    elementCount >
    MAXIMUM_TENSOR_ELEMENTS
  ) {
    throw new SegmentationError(
      'OUT_OF_MEMORY',
      `The ONNX tensor "${name}" is too large to process safely.`,
      {
        stage:
          'read-mask-candidates',

        retryable:
          false,

        metadata: {
          elementCount,
        },
      }
    );
  }

  const data =
    convertOrtTensorData(
      tensor
    );

  if (
    data.length !==
    elementCount
  ) {
    throw new SegmentationError(
      'INVALID_MODEL_OUTPUT',
      `The ONNX tensor "${name}" data length does not match its dimensions.`,
      {
        stage:
          'read-mask-candidates',

        retryable:
          false,

        metadata: {
          expectedElements:
            elementCount,

          actualElements:
            data.length,
        },
      }
    );
  }

  return {
    name,

    data,

    dimensions,

    dataType:
      normalizeTensorDataType(
        String(
          tensor.type
        )
      ),

    layout:
      inferTensorLayout(
        dimensions
      ),
  };
}

function convertToFloatTensor(
  tensor:
    SegmentationTensor,
  errorCode:
    | 'INVALID_ENCODER_OUTPUT'
    | 'INVALID_DECODER_OUTPUT'
): SegmentationFloatTensor {
  if (
    tensor.data instanceof
      Float32Array
  ) {
    return {
      name:
        tensor.name,

      data:
        tensor.data,

      dimensions:
        tensor.dimensions,

      dataType:
        'float32',

      layout:
        tensor.layout,
    };
  }

  const data =
    new Float32Array(
      tensor.data.length
    );

  for (
    let index = 0;
    index < tensor.data.length;
    index += 1
  ) {
    const value =
      tensor.data[index];

    const numericValue =
      typeof value === 'bigint'
        ? Number(value)
        : typeof value === 'boolean'
          ? (
              value
                ? 1
                : 0
            )
          : Number(value);

    if (
      !Number.isFinite(
        numericValue
      )
    ) {
      throw new SegmentationError(
        errorCode,
        `Tensor "${tensor.name}" contains a non-finite value.`,
        {
          retryable:
            false,

          metadata: {
            index,

            value:
              String(value),
          },
        }
      );
    }

    data[index] =
      numericValue;
  }

  return {
    name:
      tensor.name,

    data,

    dimensions:
      tensor.dimensions,

    dataType:
      'float32',

    layout:
      tensor.layout,
  };
}

/**
 * نهاية Part 1/3.
 *
 * الجزء الثاني يبدأ مباشرة من:
 *
 * - createOrtTensor
 * - Encoder validation
 * - Decoder feeds
 * - Session creation
 * - initialize()
 */
// scan/core/ai/SegmentationSession.ts
// Part 2/3
//
// يكمل مباشرة بعد:
//
// function convertToFloatTensor(
//   ...
// }

/* =========================================================
 * ONNX tensor creation
 * ======================================================= */

function tensorDataToNumberArray(
  data: SegmentationTensorData
): number[] {
  const result:
    number[] = new Array(
      data.length
    );

  for (
    let index = 0;
    index < data.length;
    index += 1
  ) {
    const value =
      data[index];

    const numberValue =
      typeof value === 'bigint'
        ? Number(value)
        : typeof value === 'boolean'
          ? value
            ? 1
            : 0
          : Number(value);

    if (
      !Number.isFinite(
        numberValue
      )
    ) {
      throw new SegmentationError(
        'TENSOR_CREATION_FAILED',
        'The EdgeSAM tensor contains a non-finite value.',
        {
          retryable:
            false,

          metadata: {
            index,

            value:
              String(value),
          },
        }
      );
    }

    result[index] =
      numberValue;
  }

  return result;
}

function tensorDataToBigIntArray(
  data: SegmentationTensorData
): bigint[] {
  const result:
    bigint[] = new Array(
      data.length
    );

  for (
    let index = 0;
    index < data.length;
    index += 1
  ) {
    const value =
      data[index];

    if (
      typeof value === 'bigint'
    ) {
      result[index] =
        value;

      continue;
    }

    const numberValue =
      typeof value === 'boolean'
        ? value
          ? 1
          : 0
        : Number(value);

    if (
      !Number.isFinite(
        numberValue
      )
    ) {
      throw new SegmentationError(
        'TENSOR_CREATION_FAILED',
        'The EdgeSAM int64 tensor contains a non-finite value.',
        {
          retryable:
            false,

          metadata: {
            index,

            value:
              String(value),
          },
        }
      );
    }

    result[index] =
      BigInt(
        Math.trunc(
          numberValue
        )
      );
  }

  return result;
}


function createOrtTensorFromSegmentationTensor(
  tensor:
    SegmentationTensor
): OrtTensor {
  const dimensions =
    Array.from(
      tensor.dimensions
    );

  try {
    switch (
      tensor.dataType
    ) {
      case 'float32':
        return new Tensor(
          'float32',

          tensor.data instanceof
            Float32Array
            ? tensor.data
            : new Float32Array(
                tensorDataToNumberArray(
                  tensor.data
                )
              ),

          dimensions
        );

      case 'float64':
        return new Tensor(
          'float64',

          tensor.data instanceof
            Float64Array
            ? tensor.data
            : new Float64Array(
                tensorDataToNumberArray(
                  tensor.data
                )
              ),

          dimensions
        );

      case 'int32':
        return new Tensor(
          'int32',

          tensor.data instanceof
            Int32Array
            ? tensor.data
            : new Int32Array(
                tensorDataToNumberArray(
                  tensor.data
                )
              ),

          dimensions
        );

      case 'int64': {
        if (
          typeof BigInt64Array ===
          'undefined'
        ) {
          throw new SegmentationError(
            'DECODER_INPUT_CREATION_FAILED',
            'BigInt64Array is unavailable for the EdgeSAM int64 tensor.',
            {
              retryable:
                false,

              metadata: {
                tensorName:
                  tensor.name,
              },
            }
          );
        }

        return new Tensor(
          'int64',

          tensor.data instanceof
            BigInt64Array
            ? tensor.data
            : new BigInt64Array(
                tensorDataToBigIntArray(
                  tensor.data
                )
              ),

          dimensions
        );
      }

      case 'uint8':
        return new Tensor(
          'uint8',

          tensor.data instanceof
            Uint8Array
            ? tensor.data
            : new Uint8Array(
                tensorDataToNumberArray(
                  tensor.data
                )
              ),

          dimensions
        );

      case 'int8':
        return new Tensor(
          'int8',

          tensor.data instanceof
            Int8Array
            ? tensor.data
            : new Int8Array(
                tensorDataToNumberArray(
                  tensor.data
                )
              ),

          dimensions
        );

      case 'bool': {
        const booleanData:
          boolean[] = new Array(
            tensor.data.length
          );

        for (
          let index = 0;
          index < tensor.data.length;
          index += 1
        ) {
          const value =
            tensor.data[index];

          booleanData[index] =
            typeof value === 'bigint'
              ? value !== BigInt(0)
              : typeof value === 'boolean'
                ? value
                : Number(value) !== 0;
        }

        return new Tensor(
          'bool',
          booleanData,
          dimensions
        );
      }

      case 'float16':
        throw new SegmentationError(
          'TENSOR_CREATION_FAILED',
          'Float16 EdgeSAM input tensors are not supported by the current React Native tensor builder.',
          {
            retryable:
              false,

            metadata: {
              tensorName:
                tensor.name,
            },
          }
        );

      default:
        throw new SegmentationError(
          'TENSOR_CREATION_FAILED',
          `Unsupported EdgeSAM tensor data type: ${String(
            tensor.dataType
          )}.`,
          {
            retryable:
              false,

            metadata: {
              tensorName:
                tensor.name,
            },
          }
        );
    }
  } catch (error) {
    if (
      isSegmentationError(
        error
      )
    ) {
      throw error;
    }

    throw new SegmentationError(
      'TENSOR_CREATION_FAILED',
      `Could not create ONNX tensor "${tensor.name}": ${getUnknownErrorMessage(
        error
      )}`,
      {
        retryable:
          false,

        cause:
          error,

        metadata: {
          tensorName:
            tensor.name,

          dimensions:
            dimensions.join('x'),

          dataType:
            tensor.dataType,
        },
      }
    );
  }
}

function createOrtFloatTensor(
  name:
    string,
  data:
    Float32Array,
  dimensions:
    readonly number[]
): OrtTensor {
  const expectedElements =
    getTensorElementCount(
      dimensions
    );

  if (
    expectedElements <= 0 ||
    data.length !==
      expectedElements
  ) {
    throw new SegmentationError(
      'TENSOR_CREATION_FAILED',
      `Tensor "${name}" has invalid dimensions or data length.`,
      {
        retryable:
          false,

        metadata: {
          tensorName:
            name,

          dimensions:
            dimensions.join('x'),

          expectedElements,

          actualElements:
            data.length,
        },
      }
    );
  }

  try {
    return new Tensor(
      'float32',
      data,
      Array.from(
        dimensions
      )
    );
  } catch (error) {
    throw new SegmentationError(
      'TENSOR_CREATION_FAILED',
      `Could not create float32 tensor "${name}": ${getUnknownErrorMessage(
        error
      )}`,
      {
        retryable:
          false,

        cause:
          error,

        metadata: {
          tensorName:
            name,
        },
      }
    );
  }
}

/* =========================================================
 * Encoder input validation
 * ======================================================= */

function validateEncoderInput(
  input:
    EdgeSamEncoderInput,
  config:
    SegmentationModelConfig
): void {
  const tensor =
    input.image;

  if (
    !(
      tensor.data instanceof
      Float32Array
    )
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'The EdgeSAM encoder input must contain Float32Array data.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,
      }
    );
  }

  if (
    tensor.dataType !==
    'float32'
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'The EdgeSAM encoder tensor data type must be float32.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,

        metadata: {
          dataType:
            tensor.dataType,
        },
      }
    );
  }

  if (
    tensor.layout !==
      'NCHW'
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'The EdgeSAM encoder tensor layout must be NCHW.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,

        metadata: {
          layout:
            tensor.layout,
        },
      }
    );
  }

  const expectedDimensions =
    [
      1,
      3,
      config.encoder.input.height,
      config.encoder.input.width,
    ] as const;

  if (
    tensor.dimensions.length !==
    expectedDimensions.length
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'The EdgeSAM encoder tensor must contain four dimensions.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,

        metadata: {
          actualDimensions:
            tensor.dimensions
              .join('x'),

          expectedDimensions:
            expectedDimensions
              .join('x'),
        },
      }
    );
  }

  for (
    let index = 0;
    index <
      expectedDimensions.length;
    index += 1
  ) {
    if (
      tensor.dimensions[
        index
      ] !==
      expectedDimensions[
        index
      ]
    ) {
      throw new SegmentationError(
        'ENCODER_TENSOR_CREATION_FAILED',
        'The EdgeSAM encoder tensor dimensions do not match the configuration.',
        {
          stage:
            'run-image-encoder',

          component:
            'encoder',

          retryable:
            false,

          metadata: {
            actualDimensions:
              tensor.dimensions
                .join('x'),

            expectedDimensions:
              expectedDimensions
                .join('x'),
          },
        }
      );
    }
  }

  const expectedElements =
    getTensorElementCount(
      tensor.dimensions
    );

  if (
    expectedElements <= 0 ||
    tensor.data.length !==
      expectedElements
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'The EdgeSAM encoder tensor data length does not match its dimensions.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,

        metadata: {
          expectedElements,

          actualElements:
            tensor.data.length,
        },
      }
    );
  }

  if (
    tensor.width !==
      config.encoder.input.width ||
    tensor.height !==
      config.encoder.input.height ||
    tensor.channels !==
      3 ||
    tensor.batchSize !==
      1
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'The EdgeSAM encoder tensor metadata does not match the model configuration.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,

        metadata: {
          tensorWidth:
            tensor.width,

          tensorHeight:
            tensor.height,

          channels:
            tensor.channels,

          batchSize:
            tensor.batchSize,
        },
      }
    );
  }

  if (
    typeof tensor.name !==
      'string' ||
    tensor.name.trim()
      .length === 0
  ) {
    throw new SegmentationError(
      'ENCODER_TENSOR_CREATION_FAILED',
      'The EdgeSAM encoder tensor must contain a valid input name.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Decoder input validation
 * ======================================================= */

function validateDecoderInputs(
  inputs:
    EdgeSamDecoderInputs,
  config:
    SegmentationModelConfig
): void {
  const embedding =
    inputs.imageEmbedding;

  if (
    !(
      embedding.data instanceof
      Float32Array
    ) ||
    embedding.data.length === 0
  ) {
    throw new SegmentationError(
      'EMBEDDING_INVALID',
      'The EdgeSAM decoder received an invalid image embedding.',
      {
        stage:
          'create-decoder-inputs',

        component:
          'decoder',

        retryable:
          false,
      }
    );
  }

  if (
    embedding.dimensions.length <
      3
  ) {
    throw new SegmentationError(
      'EMBEDDING_INVALID',
      'The EdgeSAM image embedding has an unsupported shape.',
      {
        stage:
          'create-decoder-inputs',

        component:
          'decoder',

        retryable:
          false,

        metadata: {
          dimensions:
            embedding.dimensions
              .join('x'),
        },
      }
    );
  }

  if (
    inputs.pointCoordinates
      .pointCount <= 0
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'EdgeSAM requires at least one prompt coordinate.',
      {
        stage:
          'create-decoder-inputs',

        component:
          'decoder',

        retryable:
          false,
      }
    );
  }

  if (
    inputs.pointLabels
      .pointCount !==
    inputs.pointCoordinates
      .pointCount
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'EdgeSAM point coordinates and labels must contain the same number of points.',
      {
        stage:
          'create-decoder-inputs',

        component:
          'decoder',

        retryable:
          false,

        metadata: {
          coordinateCount:
            inputs.pointCoordinates
              .pointCount,

          labelCount:
            inputs.pointLabels
              .pointCount,
        },
      }
    );
  }

  const expectedMaskWidth =
    config.decoder.config
      .maskInputSize.width;

  const expectedMaskHeight =
    config.decoder.config
      .maskInputSize.height;

  if (
    inputs.maskInput.width !==
      expectedMaskWidth ||
    inputs.maskInput.height !==
      expectedMaskHeight
  ) {
    throw new SegmentationError(
      'DECODER_INPUT_CREATION_FAILED',
      'The EdgeSAM mask-input dimensions do not match the decoder configuration.',
      {
        stage:
          'create-decoder-inputs',

        component:
          'decoder',

        retryable:
          false,

        metadata: {
          maskWidth:
            inputs.maskInput.width,

          maskHeight:
            inputs.maskInput.height,

          expectedMaskWidth,

          expectedMaskHeight,
        },
      }
    );
  }

  const feedNames =
    Object.keys(
      inputs.feeds
    );

  if (
    feedNames.length ===
    0
  ) {
    throw new SegmentationError(
      'DECODER_INPUT_CREATION_FAILED',
      'The EdgeSAM decoder feed dictionary is empty.',
      {
        stage:
          'create-decoder-inputs',

        component:
          'decoder',

        retryable:
          false,
      }
    );
  }

  for (
    const [
      name,
      tensor,
    ] of Object.entries(
      inputs.feeds
    )
  ) {
    if (
      typeof name !==
        'string' ||
      name.trim().length ===
        0
    ) {
      throw new SegmentationError(
        'DECODER_INPUT_CREATION_FAILED',
        'The EdgeSAM decoder contains an invalid feed name.',
        {
          stage:
            'create-decoder-inputs',

          component:
            'decoder',

          retryable:
            false,
        }
      );
    }

    const expectedElements =
      getTensorElementCount(
        tensor.dimensions
      );

    if (
      expectedElements <= 0 ||
      tensor.data.length !==
        expectedElements
    ) {
      throw new SegmentationError(
        'DECODER_INPUT_CREATION_FAILED',
        `Decoder tensor "${name}" has invalid dimensions or data length.`,
        {
          stage:
            'create-decoder-inputs',

          component:
            'decoder',

          retryable:
            false,

          metadata: {
            tensorName:
              name,

            dimensions:
              tensor.dimensions
                .join('x'),

            expectedElements,

            actualElements:
              tensor.data.length,
          },
        }
      );
    }
  }
}

/* =========================================================
 * Feed creation
 * ======================================================= */

function createEncoderFeeds(
  session:
    OrtSession,
  input:
    EdgeSamEncoderInput,
  config:
    SegmentationModelConfig
): OrtFeeds {
  const availableNames =
    Array.from(
      session.inputNames
    );

  const preferredName =
    input.image.name ||
    config.encoder.input.name;

  const actualName =
    availableNames.includes(
      preferredName
    )
      ? preferredName
      : availableNames[0];

  if (!actualName) {
    throw new SegmentationError(
      'SESSION_NOT_READY',
      'The EdgeSAM encoder session contains no usable input name.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,
      }
    );
  }

  return {
    [actualName]:
      createOrtFloatTensor(
        actualName,
        input.image.data,
        input.image.dimensions
      ),
  };
}

function createDecoderFeeds(
  session:
    OrtSession,
  inputs:
    EdgeSamDecoderInputs,
  config:
    SegmentationModelConfig
): OrtFeeds {
  const availableNames =
    Array.from(
      session.inputNames
    );

  const configuredNames =
    config.decoder.config
      .inputNames;

  /**
   * الـDecoder الموجود فعليًا يحتوي فقط على:
   *
   * - image_embeddings
   * - point_coords
   * - point_labels
   *
   * لذلك نبني Feeds بناءً على Inputs الفعلية
   * الموجودة داخل ملف ONNX، ونتجاهل أي
   * Inputs إضافية جهزتها الطبقات العامة مثل:
   *
   * - mask_input
   * - has_mask_input
   * - orig_im_size
   */
  const aliases:
    Record<
      string,
      readonly string[]
    > = {
    image_embeddings: [
      configuredNames
        .imageEmbeddings,
      'image_embeddings',
      'image_embedding',
      'embeddings',
    ],

    point_coords: [
      configuredNames
        .pointCoordinates,
      'point_coords',
      'point_coordinates',
      'coords',
    ],

    point_labels: [
      configuredNames
        .pointLabels,
      'point_labels',
      'labels',
    ],

    mask_input: [
      configuredNames
        .maskInput,
      'mask_input',
      'mask_inputs',
    ],

    has_mask_input: [
      configuredNames
        .hasMaskInput,
      'has_mask_input',
      'has_mask',
    ],

    orig_im_size: [
      configuredNames
        .originalImageSize,
      'orig_im_size',
      'original_image_size',
      'image_size',
    ],
  };

  const sourceFeeds =
    inputs.feeds;

  const feeds:
    OrtFeeds = {};

  for (
    const actualName of
      availableNames
  ) {
    const candidates =
      aliases[
        actualName
      ] ?? [
        actualName,
      ];

    let sourceTensor:
      SegmentationTensor | null =
      null;

    for (
      const candidateName of
        candidates
    ) {
      const candidateTensor =
        sourceFeeds[
          candidateName
        ];

      if (
        candidateTensor
      ) {
        sourceTensor =
          candidateTensor;

        break;
      }
    }

    if (
      !sourceTensor
    ) {
      throw new SegmentationError(
        'DECODER_INPUT_CREATION_FAILED',
        `The required EdgeSAM decoder input "${actualName}" was not provided.`,
        {
          stage:
            'create-decoder-inputs',

          component:
            'decoder',

          retryable:
            false,

          metadata: {
            requiredInput:
              actualName,

            availableModelInputs:
              availableNames
                .join(','),

            providedInputs:
              Object.keys(
                sourceFeeds
              ).join(','),
          },
        }
      );
    }

    feeds[
      actualName
    ] =
      createOrtTensorFromSegmentationTensor({
        ...sourceTensor,

        name:
          actualName,
      });
  }

  return feeds;
}

/* =========================================================
 * Output-name helpers
 * ======================================================= */

function resolveRequestedOutputs(
  session:
    OrtSession,
  requestedNames:
    readonly string[] |
    undefined,
  preferredNames:
    readonly (
      string | null
    )[]
): readonly string[] |
  undefined {
  const availableNames =
    Array.from(
      session.outputNames
    );

  if (
    requestedNames &&
    requestedNames.length > 0
  ) {
    const invalid =
      requestedNames.filter(
        name =>
          !availableNames.includes(
            name
          )
      );

    if (
      invalid.length > 0
    ) {
      throw new SegmentationError(
        'INVALID_MODEL_OUTPUT',
        'One or more requested EdgeSAM outputs do not exist in the loaded model.',
        {
          retryable:
            false,

          metadata: {
            invalidOutputs:
              invalid.join(','),

            availableOutputs:
              availableNames
                .join(','),
          },
        }
      );
    }

    return [
      ...requestedNames,
    ];
  }

  const preferredAvailable =
    preferredNames.filter(
      (
        name
      ): name is string =>
        typeof name ===
          'string' &&
        name.length > 0 &&
        availableNames.includes(
          name
        )
    );

  if (
    preferredAvailable.length >
    0
  ) {
    return Array.from(
      new Set(
        preferredAvailable
      )
    );
  }

  return undefined;
}

/* =========================================================
 * Output selection
 * ======================================================= */

function selectEncoderOutput(
  outputs:
    Record<
      string,
      SegmentationTensor
    >,
  config:
    SegmentationModelConfig
): SegmentationFloatTensor {
  const names =
    Object.keys(
      outputs
    );

  if (
    names.length === 0
  ) {
    throw new SegmentationError(
      'INVALID_ENCODER_OUTPUT',
      'The EdgeSAM encoder returned no output tensors.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          true,
      }
    );
  }

  const preferredName =
    config.encoder.output
      .preferredName;

  if (
    preferredName &&
    outputs[
      preferredName
    ]
  ) {
    return convertToFloatTensor(
      outputs[
        preferredName
      ],
      'INVALID_ENCODER_OUTPUT'
    );
  }

  let selected:
    SegmentationTensor | null =
      null;

  let selectedScore =
    Number.NEGATIVE_INFINITY;

  for (
    const name of names
  ) {
    const candidate =
      outputs[
        name
      ];

    const dimensions =
      candidate.dimensions;

    let score =
      0;

    const normalizedName =
      name.toLowerCase();

    if (
      normalizedName.includes(
        'embedding'
      )
    ) {
      score +=
        10_000;
    }

    if (
      normalizedName.includes(
        'image'
      )
    ) {
      score +=
        1_000;
    }

    if (
      dimensions.length ===
      4
    ) {
      score +=
        2_000;
    }

    if (
      dimensions[
        0
      ] === 1
    ) {
      score +=
        500;
    }

    if (
      dimensions.includes(
        256
      )
    ) {
      score +=
        1_000;
    }

    score +=
      Math.min(
        1_000,
        candidate.data.length /
          10_000
      );

    if (
      score >
      selectedScore
    ) {
      selected =
        candidate;

      selectedScore =
        score;
    }
  }

  if (!selected) {
    throw new SegmentationError(
      'INVALID_ENCODER_OUTPUT',
      'No usable EdgeSAM encoder output was found.',
      {
        stage:
          'run-image-encoder',

        component:
          'encoder',

        retryable:
          false,
      }
    );
  }

  return convertToFloatTensor(
    selected,
    'INVALID_ENCODER_OUTPUT'
  );
}

function findDecoderOutput(
  outputs:
    Record<
      string,
      SegmentationTensor
    >,
  preferredName:
    string | null,
  keywords:
    readonly string[],
  minimumDimensions:
    number
): SegmentationFloatTensor | null {
  if (
    preferredName &&
    outputs[
      preferredName
    ]
  ) {
    return convertToFloatTensor(
      outputs[
        preferredName
      ],
      'INVALID_DECODER_OUTPUT'
    );
  }

  const entries =
    Object.entries(
      outputs
    );

  let selected:
    SegmentationTensor | null =
      null;

  let selectedScore =
    Number.NEGATIVE_INFINITY;

  for (
    const [
      name,
      tensor,
    ] of entries
  ) {
    if (
      tensor.dimensions.length <
      minimumDimensions
    ) {
      continue;
    }

    const normalizedName =
      name.toLowerCase();

    let score =
      0;

    for (
      const keyword of
        keywords
    ) {
      if (
        normalizedName.includes(
          keyword
        )
      ) {
        score +=
          10_000;
      }
    }

    score +=
      tensor.dimensions.length *
      100;

    score +=
      Math.min(
        1_000,
        tensor.data.length /
          10_000
      );

    if (
      score >
      selectedScore
    ) {
      selected =
        tensor;

      selectedScore =
        score;
    }
  }

  return selected
    ? convertToFloatTensor(
        selected,
        'INVALID_DECODER_OUTPUT'
      )
    : null;
}

/* =========================================================
 * Timeout helper
 * ======================================================= */

async function runWithTimeout<T>(
  operation:
    Promise<T>,
  timeoutMs:
    number,
  errorFactory:
    () => SegmentationError
): Promise<T> {
  let timeoutHandle:
    ReturnType<
      typeof setTimeout
    > | null =
      null;

  const timeoutPromise =
    new Promise<never>(
      (
        _resolve,
        reject
      ) => {
        timeoutHandle =
          setTimeout(
            () => {
              reject(
                errorFactory()
              );
            },
            Math.max(
              1,
              Math.round(
                timeoutMs
              )
            )
          );
      }
    );

  try {
    return await Promise.race([
      operation,
      timeoutPromise,
    ]);
  } finally {
    if (
      timeoutHandle !==
      null
    ) {
      clearTimeout(
        timeoutHandle
      );
    }
  }
}

/* =========================================================
 * Session metadata
 * ======================================================= */

function createSessionTensorInfos(
  names:
    readonly string[]
): readonly SegmentationSessionTensorInfo[] {
  return names.map(
    name => ({
      name,

      dimensions: [
        'dynamic',
      ],

      dataType:
        'float32',

      layout:
        'unknown',
    })
  );
}

function createSessionModelInfo(
  loaded:
    LoadedComponentSession
): SegmentationSessionModelInfo {
  return {
    component:
      loaded.component,

    assetPath:
      loaded.asset.localUri,

    inputNames: [
      ...loaded.inputNames,
    ],

    outputNames: [
      ...loaded.outputNames,
    ],

    inputs:
      createSessionTensorInfos(
        loaded.inputNames
      ),

    outputs:
      createSessionTensorInfos(
        loaded.outputNames
      ),
  };
}

/* =========================================================
 * Main session manager
 * ======================================================= */

export class SegmentationSession {
  private config:
    SegmentationModelConfig;

  private state:
    SegmentationSessionState =
      'uninitialized';

  private encoder:
    ComponentRuntimeState;

  private decoder:
    ComponentRuntimeState;

  private initializationPromise:
    Promise<
      SegmentationSessionLoadResult
    > | null =
      null;

  private initializedAt:
    number | null =
      null;

  private lastUsedAt:
    number | null =
      null;

  private lastError:
    string | null =
      null;

  private sessionConfigSignature:
    string | null =
      null;

  private lifecycleGeneration =
    0;

  private operationQueue:
    Promise<void> =
      Promise.resolve();

  private embeddingCache =
    new Map<
      string,
      EmbeddingCacheRecord
    >();

  private embeddingCacheHits =
    0;

  private embeddingCacheMisses =
    0;

  private embeddingCacheEvictions =
    0;

    private embeddingCacheBytes =
    0;

  constructor(
    config:
      SegmentationModelConfig =
        DEFAULT_SEGMENTATION_MODEL_CONFIG
  ) {
    this.config =
      validateSegmentationModelConfig(
        cloneSegmentationModelConfig(
          config
        )
      );

    this.encoder =
      createComponentState(
        'encoder',
        this.config.encoder
          .session
          .executionProvider
      );

    this.decoder =
      createComponentState(
        'decoder',
        this.config.decoder
          .session
          .executionProvider
      );
  }

  getConfig():
    SegmentationModelConfig {
    return cloneSegmentationModelConfig(
      this.config
    );
  }

  getState():
    SegmentationSessionState {
    return this.state;
  }

  isReady():
    boolean {
    return (
      this.state ===
        'ready' &&
      this.encoder.session !==
        null &&
      this.decoder.session !==
        null
    );
  }

  private isDisposed():
    boolean {
    return (
      this.state ===
      'disposed'
    );
  }

  private getComponentState(
    component:
      SegmentationModelComponent
  ): ComponentRuntimeState {
    return (
      component === 'encoder'
        ? this.encoder
        : this.decoder
    );
  }

  private setComponentState(
    component:
      SegmentationModelComponent,
    state:
      ComponentRuntimeState
  ): void {
    if (
      component === 'encoder'
    ) {
      this.encoder =
        state;
    } else {
      this.decoder =
        state;
    }
  }

  getInfo():
    EdgeSamSessionInfo {
    return {
      state:
        this.state,

      encoder:
        this.createComponentInfo(
          this.encoder
        ),

      decoder:
        this.createComponentInfo(
          this.decoder
        ),

      initializedAt:
        this.initializedAt,

      lastUsedAt:
        this.lastUsedAt,

      totalEncoderRuns:
        this.encoder.runCount,

      totalDecoderRuns:
        this.decoder.runCount,

      executionProvider:
        this.encoder.provider,

      lastError:
        this.lastError,
    };
  }

  private createComponentInfo(
    component:
      ComponentRuntimeState
  ): SegmentationComponentSessionInfo {
    return {
      component:
        component.component,

      state:
        component.state,

      modelId:
        this.config.id,

      modelVersion:
        this.config.version,

      loadedAt:
        component.loadedAt,

      lastUsedAt:
        component.lastUsedAt,

      runCount:
        component.runCount,

      inputNames: [
        ...component.inputNames,
      ],

      outputNames: [
        ...component.outputNames,
      ],

      executionProvider:
        component.provider,

      modelPath:
        component.modelPath,

      sessionLoadMs:
        component.sessionLoadMs,

      lastInferenceMs:
        component.lastInferenceMs,

      lastError:
        component.lastError,
    };
  }

  getDiagnostics():
    SegmentationSessionDiagnostics {
    return {
      state:
        this.state,

      encoderState:
        this.encoder.state,

      decoderState:
        this.decoder.state,

      executionProvider:
        this.encoder.provider,

      encoderModelPath:
        this.encoder.modelPath,

      decoderModelPath:
        this.decoder.modelPath,

      encoderLoadMs:
        this.encoder.sessionLoadMs,

      decoderLoadMs:
        this.decoder.sessionLoadMs,

      encoderRunCount:
        this.encoder.runCount,

      decoderRunCount:
        this.decoder.runCount,

      currentMemoryUsageBytes:
        null,

      peakMemoryUsageBytes:
        null,

      embeddingCache: {
        enabled:
          this.config
            .embeddingCache
            .policy !==
          'disabled',

        policy:
          this.config
            .embeddingCache
            .policy,

        entries:
          this.embeddingCache.size,

        totalBytes:
          this.embeddingCacheBytes,

        maximumEntries:
          this.config
            .embeddingCache
            .maximumEntries,

        maximumBytes:
          this.config
            .embeddingCache
            .maximumBytes,

        hits:
          this.embeddingCacheHits,

        misses:
          this.embeddingCacheMisses,

        evictions:
          this.embeddingCacheEvictions,
      },

      warnings: [],

      lastError:
        this.lastError,
    };
  }

  private async enqueue<T>(
    operation:
      () => Promise<T>
  ): Promise<T> {
    const previous =
      this.operationQueue;

    let release:
      () => void =
      () => {};

    this.operationQueue =
      new Promise<void>(
        resolve => {
          release =
            resolve;
        }
      );

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  async initialize(
    input:
      SegmentationSessionInitializeInput = {}
  ): Promise<
    SegmentationSessionLoadResult
  > {
    return this.enqueue(
      () =>
        this.initializeInternal(
          input
        )
    );
  }

  private async initializeInternal(
    input:
      SegmentationSessionInitializeInput
  ): Promise<
    SegmentationSessionLoadResult
  > {
    const requestId =
      input.requestId ??
      createSegmentationRequestId();

    const startedAt =
      now();

    const signal =
      input
        .cancellationSignal;

    assertNotCancelled(
      signal
    );

    if (
      this.isDisposed()
    ) {
      throw new SegmentationError(
        'SESSION_DISPOSED',
        'The EdgeSAM session manager has been disposed.',
        {
          requestId,

          stage:
            'load-model-sessions',

          retryable:
            false,
        }
      );
    }

    const nextConfig =
      input.config
        ? validateSegmentationModelConfig(
            cloneSegmentationModelConfig(
              input.config
            )
          )
        : this.config;

    const configChanged =
      !areSessionConfigsEquivalent(
        nextConfig,
        this.config
      );

    if (
      configChanged &&
      (
        this.encoder.session ||
        this.decoder.session
      )
    ) {
      throw new SegmentationError(
        'SESSION_CREATE_FAILED',
        'The EdgeSAM session configuration cannot change after native sessions are loaded. Use reload instead.',
        {
          requestId,

          stage:
            'load-model-sessions',

          retryable:
            false,
        }
      );
    }

    if (
      configChanged
    ) {
      this.config =
        nextConfig;
    }

    assertSupportedNativePlatform();

    if (
      input.forceReload
    ) {
      await this.releaseSessions();
    }

    const requiredSignature =
      createSessionConfigSignature(
        this.config
      );

    if (
      this.isReady() &&
      this.sessionConfigSignature ===
        requiredSignature
    ) {
      return {
        encoderLoaded:
          true,

        decoderLoaded:
          true,

        encoderReused:
          true,

        decoderReused:
          true,

        encoderInfo:
          this.createCurrentModelInfo(
            'encoder'
          ),

        decoderInfo:
          this.createCurrentModelInfo(
            'decoder'
          ),

        timings: {
          encoderAssetResolveMs:
            0,

          decoderAssetResolveMs:
            0,

          encoderSessionCreateMs:
            0,

          decoderSessionCreateMs:
            0,

          warmupMs:
            0,

          totalMs:
            Math.max(
              0,
              now() - startedAt
            ),
        },

        warnings: [],
      };
    }

    if (
      this.initializationPromise
    ) {
      return this
        .initializationPromise;
    }

    this.state =
      'loading';

    this.encoder.state =
      'loading';

    this.decoder.state =
      'loading';

    this.lastError =
      null;

    const generation =
      this.lifecycleGeneration;

    emitProgress(
      requestId,
      'load-model-sessions',
      'Preparing EdgeSAM encoder and decoder sessions.',
      startedAt,
      input.onProgress
    );

    this.initializationPromise =
      this.createBothSessions(
        requestId,
        startedAt,
        generation,
        input.onProgress,
        signal,
        input.warmup ??
          false
      );

    try {
      const result =
        await this
          .initializationPromise;

      if (
        generation !==
          this.lifecycleGeneration ||
        this.isDisposed()
      ) {
        throw new SegmentationError(
          'SESSION_DISPOSED',
          'The EdgeSAM session lifecycle changed while the models were loading.',
          {
            requestId,

            stage:
              'load-model-sessions',

            retryable:
              true,
          }
        );
      }

      this.sessionConfigSignature =
        requiredSignature;

      this.state =
        'ready';

      this.encoder.state =
        'ready';

      this.decoder.state =
        'ready';

      this.initializedAt =
        now();

      this.lastUsedAt =
        now();

      this.lastError =
        null;

      return result;
    } catch (error) {
      const normalized =
        isSegmentationError(
          error
        )
          ? error
          : new SegmentationError(
              'SESSION_CREATE_FAILED',
              `Could not initialize EdgeSAM sessions: ${getUnknownErrorMessage(
                error
              )}`,
              {
                requestId,

                stage:
                  'load-model-sessions',

                retryable:
                  true,

                cause:
                  error,
              }
            );

      if (
        generation ===
          this.lifecycleGeneration &&
        !this.isDisposed()
      ) {
        this.state =
          'failed';

        this.lastError =
          normalized.message;

        if (
          !this.encoder.session
        ) {
          this.encoder.state =
            'failed';

          this.encoder.lastError =
            normalized.message;
        }

        if (
          !this.decoder.session
        ) {
          this.decoder.state =
            'failed';

          this.decoder.lastError =
            normalized.message;
        }
      }

      throw normalized;
    } finally {
      if (
        generation ===
          this.lifecycleGeneration
      ) {
        this.initializationPromise =
          null;
      }
    }
  }

  private createCurrentModelInfo(
    component:
      SegmentationModelComponent
  ): SegmentationSessionModelInfo {
    const runtime =
      this.getComponentState(
        component
      );

    if (
      !runtime.modelPath
    ) {
      throw new SegmentationError(
        'SESSION_NOT_READY',
        `The EdgeSAM ${component} session model information is unavailable.`,
        {
          component,

          retryable:
            false,
        }
      );
    }

    return {
      component,

      assetPath:
        runtime.modelPath,

      inputNames: [
        ...runtime.inputNames,
      ],

      outputNames: [
        ...runtime.outputNames,
      ],

      inputs:
        createSessionTensorInfos(
          runtime.inputNames
        ),

      outputs:
        createSessionTensorInfos(
          runtime.outputNames
        ),
    };
  }

  private async createBothSessions(
    requestId:
      string,
    startedAt:
      number,
    generation:
      number,
    onProgress?:
      SegmentationProgressCallback,
    signal?:
      SegmentationCancellationSignal,
    warmup =
      false
  ): Promise<
    SegmentationSessionLoadResult
  > {
    const encoderAssetStartedAt =
      now();

    const encoderAsset =
      await prepareModelAsset(
        getComponentAsset(
          this.config,
          'encoder'
        ),
        signal
      );

    const encoderAssetResolveMs =
      Math.max(
        0,
        now() -
          encoderAssetStartedAt
      );

    assertNotCancelled(
      signal
    );

    const decoderAssetStartedAt =
      now();

    const decoderAsset =
      await prepareModelAsset(
        getComponentAsset(
          this.config,
          'decoder'
        ),
        signal
      );

    const decoderAssetResolveMs =
      Math.max(
        0,
        now() -
          decoderAssetStartedAt
      );

    if (
      generation !==
        this.lifecycleGeneration ||
      this.isDisposed()
    ) {
      throw new SegmentationError(
        'SESSION_DISPOSED',
        'The EdgeSAM session lifecycle changed before native session creation.',
        {
          requestId,

          stage:
            'load-model-sessions',

          retryable:
            true,
        }
      );
    }

    const encoderLoaded =
      await this.createComponentSession(
        encoderAsset,
        requestId,
        startedAt,
        generation,
        onProgress,
        signal
      );

    try {
      const decoderLoaded =
        await this.createComponentSession(
          decoderAsset,
          requestId,
          startedAt,
          generation,
          onProgress,
          signal
        );

      this.applyLoadedComponent(
        encoderLoaded
      );

      this.applyLoadedComponent(
        decoderLoaded
      );

      let warmupMs =
        0;

      if (warmup) {
        const warmupStartedAt =
          now();

        warmupMs =
          Math.max(
            0,
            now() -
              warmupStartedAt
          );
      }

      return {
        encoderLoaded:
          true,

        decoderLoaded:
          true,

        encoderReused:
          encoderAsset.reused,

        decoderReused:
          decoderAsset.reused,

        encoderInfo:
          createSessionModelInfo(
            encoderLoaded
          ),

        decoderInfo:
          createSessionModelInfo(
            decoderLoaded
          ),

        timings: {
          encoderAssetResolveMs,

          decoderAssetResolveMs,

          encoderSessionCreateMs:
            encoderLoaded
              .loadDurationMs,

          decoderSessionCreateMs:
            decoderLoaded
              .loadDurationMs,

          warmupMs,

          totalMs:
            Math.max(
              0,
              now() - startedAt
            ),
        },

        warnings: [],
      };
    } catch (error) {
      try {
        await Promise.resolve(
          encoderLoaded
            .session
            .release()
        );
      } catch {
        // نحافظ على الخطأ الأساسي.
      }

      throw error;
    }
  }

  private async createComponentSession(
    asset:
      PreparedModelAsset,
    requestId:
      string,
    startedAt:
      number,
    generation:
      number,
    onProgress?:
      SegmentationProgressCallback,
    signal?:
      SegmentationCancellationSignal
  ): Promise<
    LoadedComponentSession
  > {
    const attempts =
      createSessionAttempts(
        this.config,
        asset.component
      );

    const sessionConfig =
      getComponentSessionConfig(
        this.config,
        asset.component
      );

    let lastError:
      unknown =
        null;

    for (
      let index = 0;
      index < attempts.length;
      index += 1
    ) {
      const attempt =
        attempts[index];

      assertNotCancelled(
        signal
      );

      emitProgress(
        requestId,
        'load-model-sessions',
        `Loading EdgeSAM ${asset.component} using ${attempt.label}.`,
        startedAt,
        onProgress,
        {
          component:
            asset.component,

          provider:
            attempt.provider,
        }
      );

      const creationStartedAt =
        now();

      try {
        const nativePromise =
          InferenceSession.create(
            asset.localUri,
            attempt.options
          );

        const createdSession =
          await runWithTimeout<
            OrtSession
          >(
            nativePromise,
            sessionConfig
              .sessionLoadTimeoutMs ||
              DEFAULT_MODEL_LOAD_TIMEOUT_MS,
            () =>
              new SegmentationError(
                'SESSION_CREATE_FAILED',
                `Loading the EdgeSAM ${asset.component} session exceeded the allowed time.`,
                {
                  requestId,

                  stage:
                    'load-model-sessions',

                  component:
                    asset.component,

                  retryable:
                    true,

                  metadata: {
                    timeoutMs:
                      sessionConfig
                        .sessionLoadTimeoutMs,
                  },
                }
              )
          );

        assertNotCancelled(
          signal
        );

        if (
          generation !==
            this.lifecycleGeneration ||
          this.isDisposed()
        ) {
          await Promise.resolve(
            createdSession
              .release()
          );

          throw new SegmentationError(
            'SESSION_DISPOSED',
            `The EdgeSAM ${asset.component} session lifecycle changed while loading.`,
            {
              requestId,

              stage:
                'load-model-sessions',

              component:
                asset.component,

              retryable:
                true,
            }
          );
        }

        const inputNames =
          Array.from(
            createdSession
              .inputNames
          );

        const outputNames =
          Array.from(
            createdSession
              .outputNames
          );

        if (
          inputNames.length ===
          0
        ) {
          await Promise.resolve(
            createdSession
              .release()
          );

          throw new SegmentationError(
            'SESSION_CREATE_FAILED',
            `The EdgeSAM ${asset.component} model contains no input nodes.`,
            {
              requestId,

              stage:
                'load-model-sessions',

              component:
                asset.component,

              retryable:
                false,
            }
          );
        }

        if (
          outputNames.length ===
          0
        ) {
          await Promise.resolve(
            createdSession
              .release()
          );

          throw new SegmentationError(
            'SESSION_CREATE_FAILED',
            `The EdgeSAM ${asset.component} model contains no output nodes.`,
            {
              requestId,

              stage:
                'load-model-sessions',

              component:
                asset.component,

              retryable:
                false,
            }
          );
        }

        return {
          component:
            asset.component,

          session:
            createdSession,

          asset,

          provider:
            attempt.provider,

          inputNames,

          outputNames,

          loadedAt:
            now(),

          loadDurationMs:
            Math.max(
              0,
              now() -
                creationStartedAt
            ),
        };
      } catch (error) {
        lastError =
          error;

        if (
          isSegmentationError(
            error
          ) &&
          (
            error.code ===
              'REQUEST_CANCELLED' ||
            error.code ===
              'CANCELLED' ||
            error.code ===
              'SESSION_DISPOSED'
          )
        ) {
          throw error;
        }

        if (
          index <
          attempts.length - 1
        ) {
          continue;
        }
      }
    }

    const errorCode =
      asset.component ===
        'encoder'
        ? 'ENCODER_SESSION_CREATE_FAILED'
        : 'DECODER_SESSION_CREATE_FAILED';

    throw new SegmentationError(
      errorCode,
      `All EdgeSAM ${asset.component} session creation attempts failed: ${getUnknownErrorMessage(
        lastError
      )}`,
      {
        requestId,

        stage:
          'load-model-sessions',

        component:
          asset.component,

        retryable:
          true,

        cause:
          lastError,

        metadata: {
          modelFile:
            asset.asset.fileName,

          modelSize:
            asset.fileSize,

          modelReused:
            asset.reused,

          platform:
            Platform.OS,
        },
      }
    );
  }

  private applyLoadedComponent(
    loaded:
      LoadedComponentSession
  ): void {
    const previous =
      this.getComponentState(
        loaded.component
      );

    this.setComponentState(
      loaded.component,
      {
        ...previous,

        state:
          'ready',

        session:
          loaded.session,

        inputNames: [
          ...loaded.inputNames,
        ],

        outputNames: [
          ...loaded.outputNames,
        ],

        provider:
          loaded.provider,

        modelPath:
          loaded.asset.localUri,

        loadedAt:
          loaded.loadedAt,

        sessionLoadMs:
          loaded.loadDurationMs,

        lastError:
          null,
      }
    );
  }
  private convertNativeResults(
    results:
      OrtResults,
    component:
      SegmentationModelComponent
  ): Record<
    string,
    SegmentationTensor
  > {
    const entries =
      Object.entries(
        results
      );

    if (
      entries.length ===
      0
    ) {
      throw new SegmentationError(
        component ===
          'encoder'
          ? 'INVALID_ENCODER_OUTPUT'
          : 'INVALID_DECODER_OUTPUT',
        `EdgeSAM ${component} returned no output tensors.`,
        {
          component,

          stage:
            component ===
              'encoder'
              ? 'run-image-encoder'
              : 'read-mask-candidates',

          retryable:
            true,
        }
      );
    }

    const outputs:
      Record<
        string,
        SegmentationTensor
      > = {};

    for (
      const [
        name,
        tensor,
      ] of entries
    ) {
      outputs[name] =
        convertOrtTensor(
          name,
          tensor
        );
    }

    return outputs;
  }

  private createEmbeddingCacheKey(
    sourceId:
      string
  ): string {
    return [
      EMBEDDING_CACHE_PREFIX,
      this.config.id,
      this.config.version,
      sourceId,
      this.config.encoder.input.width,
      this.config.encoder.input.height,
    ].join(':');
  }

  private getCachedEmbedding(
    key:
      string
  ): EdgeSamImageEmbedding | null {
    if (
      this.config.embeddingCache
        .policy ===
      'disabled'
    ) {
      return null;
    }

    const record =
      this.embeddingCache.get(
        key
      );

    if (!record) {
      this.embeddingCacheMisses +=
        1;

      return null;
    }

    const maximumAgeMs =
      this.config.embeddingCache
        .maximumAgeMs;

   if (
      maximumAgeMs > 0 &&
      now() -
        record.createdAt >
        maximumAgeMs
    ) {
      const deleted =
        this.embeddingCache.delete(
          key
        );

      if (
        deleted
      ) {
        this.embeddingCacheBytes =
          Math.max(
            0,
            this.embeddingCacheBytes -
              record.embedding
                .byteLength
          );

        this.embeddingCacheEvictions +=
          1;
      }

      this.embeddingCacheMisses +=
        1;

      return null;
    }

    record.lastUsedAt =
      now();

    record.hitCount +=
      1;

    this.embeddingCacheHits +=
      1;

    return record.embedding;
  }

private storeEmbedding(
  key:
    string,
  embedding:
    EdgeSamImageEmbedding
): void {
  const cacheConfig =
    this.config.embeddingCache;

  if (
    cacheConfig.policy ===
      'disabled' ||
    cacheConfig.maximumEntries <=
      0 ||
    cacheConfig.maximumBytes <=
      0
  ) {
    return;
  }

  /**
   * نحتفظ بـEmbedding صورة واحدة فقط.
   *
   * قبل تخزين الصورة الجديدة نمسح القديمة،
   * عشان ما تتراكمش Embeddings كبيرة في الذاكرة.
   *
   * ده لا يغيّر نتيجة القص نهائيًا.
   * التأثير الوحيد:
   * لو رجعنا نعالج صورة أقدم، الـEncoder
   * هيحسبها من جديد بدل استخدامها من الـCache.
   */
  if (
    this.embeddingCache.size >
      0 &&
    !this.embeddingCache.has(
      key
    )
  ) {
    this.embeddingCacheEvictions +=
      this.embeddingCache.size;

    this.embeddingCache.clear();
  }

  this.embeddingCache.set(
    key,
    {
      key,

      embedding,

      createdAt:
        now(),

      lastUsedAt:
        now(),

      hitCount:
        0,
    }
  );

  this.enforceEmbeddingCacheLimits();
}

 private getEmbeddingCacheByteLength():
    number {
    return this.embeddingCacheBytes;
  }

  private enforceEmbeddingCacheLimits():
    void {
    const cacheConfig =
      this.config.embeddingCache;

    if (
      cacheConfig.policy ===
      'disabled'
    ) {
      this.clearEmbeddingCache();

      return;
    }

    while (
      this.embeddingCache.size >
        cacheConfig.maximumEntries ||
      this.getEmbeddingCacheByteLength() >
        cacheConfig.maximumBytes
    ) {
      let oldestKey:
        string | null =
          null;

      let oldestUsedAt =
        Number.POSITIVE_INFINITY;

      for (
        const [
          key,
          record,
        ] of this.embeddingCache
          .entries()
      ) {
        if (
          record.lastUsedAt <
          oldestUsedAt
        ) {
          oldestUsedAt =
            record.lastUsedAt;

          oldestKey =
            key;
        }
      }

      if (!oldestKey) {
        break;
      }

      const oldestRecord =
        this.embeddingCache.get(
          oldestKey
        );

      const deleted =
        this.embeddingCache.delete(
          oldestKey
        );

      if (
        deleted
      ) {
        if (
          oldestRecord
        ) {
          this.embeddingCacheBytes =
            Math.max(
              0,
              this.embeddingCacheBytes -
                oldestRecord
                  .embedding
                  .byteLength
            );
        }

        this.embeddingCacheEvictions +=
          1;
      }
    }
  }

 clearEmbeddingCache():
    void {
    this.embeddingCache.clear();

    this.embeddingCacheBytes =
      0;
  }

  private createImageEmbedding(
    tensor:
      SegmentationFloatTensor,
    sourceId:
      string,
    transform:
      EdgeSamEncoderRunRequest[
        'transform'
      ]
  ): EdgeSamImageEmbedding {
    const dimensions =
      tensor.dimensions;

    if (
      dimensions.length <
      3
    ) {
      throw new SegmentationError(
        'INVALID_ENCODER_OUTPUT',
        'The EdgeSAM encoder output must contain at least three dimensions.',
        {
          component:
            'encoder',

          stage:
            'run-image-encoder',

          retryable:
            false,

          metadata: {
            dimensions:
              dimensions.join('x'),
          },
        }
      );
    }

    let batchSize =
      1;

    let channels =
      1;

    let height =
      1;

    let width =
      1;

    if (
      dimensions.length ===
      4
    ) {
      batchSize =
        dimensions[0];

      if (
        tensor.layout ===
        'NHWC'
      ) {
        height =
          dimensions[1];

        width =
          dimensions[2];

        channels =
          dimensions[3];
      } else {
        channels =
          dimensions[1];

        height =
          dimensions[2];

        width =
          dimensions[3];
      }
    } else if (
      dimensions.length ===
      3
    ) {
      channels =
        dimensions[0];

      height =
        dimensions[1];

      width =
        dimensions[2];
    } else {
      const lastIndex =
        dimensions.length -
        1;

      width =
        dimensions[
          lastIndex
        ];

      height =
        dimensions[
          lastIndex - 1
        ];

      channels =
        dimensions[
          lastIndex - 2
        ];

      batchSize =
        dimensions.length > 3
          ? dimensions[0]
          : 1;
    }

    const shapeValues = [
      batchSize,
      channels,
      width,
      height,
    ];

    if (
      shapeValues.some(
        value =>
          !Number.isInteger(
            value
          ) ||
          value <= 0
      )
    ) {
      throw new SegmentationError(
        'INVALID_ENCODER_OUTPUT',
        'The EdgeSAM encoder embedding dimensions are invalid.',
        {
          component:
            'encoder',

          stage:
            'run-image-encoder',

          retryable:
            false,

          metadata: {
            dimensions:
              dimensions.join('x'),
          },
        }
      );
    }

    const expectedElements =
      getTensorElementCount(
        dimensions
      );

    if (
      expectedElements <= 0 ||
      tensor.data.length !==
        expectedElements
    ) {
      throw new SegmentationError(
        'EMBEDDING_INVALID',
        'The EdgeSAM embedding data length does not match its dimensions.',
        {
          component:
            'encoder',

          stage:
            'run-image-encoder',

          retryable:
            false,

          metadata: {
            expectedElements,

            actualElements:
              tensor.data.length,
          },
        }
      );
    }

    return {
      name:
        tensor.name,

      data:
        tensor.data,

      dimensions: [
        ...tensor.dimensions,
      ],

      dataType:
        'float32',

      layout:
        tensor.layout,

      batchSize,

      channels,

      width,

      height,

      sourceId,

      createdAt:
        now(),

      byteLength:
        tensor.data.byteLength,

      transform,
    };
  }

  async runEncoder(
    input:
      EdgeSamEncoderSessionRunInput
  ): Promise<{
    rawOutput:
      EdgeSamEncoderRawOutput;

    embedding:
      EdgeSamImageEmbedding;

    sessionReused:
      boolean;

    cacheHit:
      boolean;
  }> {
    return this.enqueue(
      () =>
        this.runEncoderInternal(
          input
        )
    );
  }

  private async runEncoderInternal(
    input:
      EdgeSamEncoderSessionRunInput
  ): Promise<{
    rawOutput:
      EdgeSamEncoderRawOutput;

    embedding:
      EdgeSamImageEmbedding;

    sessionReused:
      boolean;

    cacheHit:
      boolean;
  }> {
    const requestId =
      input.requestId ??
      createSegmentationRequestId();

    const startedAt =
      now();

    const signal =
      input.cancellationSignal;

    assertNotCancelled(
      signal
    );

    if (
      this.isDisposed()
    ) {
      throw new SegmentationError(
        'SESSION_DISPOSED',
        'The EdgeSAM session manager has been disposed.',
        {
          requestId,

          component:
            'encoder',

          stage:
            'run-image-encoder',

          retryable:
            false,
        }
      );
    }

    const nextConfig =
      input.config
        ? validateSegmentationModelConfig(
            cloneSegmentationModelConfig(
              input.config
            )
          )
        : this.config;

    if (
      !areSessionConfigsEquivalent(
        nextConfig,
        this.config
      ) &&
      (
        this.encoder.session ||
        this.decoder.session
      )
    ) {
      throw new SegmentationError(
        'SESSION_CREATE_FAILED',
        'EdgeSAM configuration changed after the sessions were loaded. Reload the session before running.',
        {
          requestId,

          component:
            'encoder',

          stage:
            'run-image-encoder',

          retryable:
            false,
        }
      );
    }

    this.config =
      nextConfig;

    validateEncoderInput(
      input.input,
      this.config
    );

    const cacheKey =
      this.createEmbeddingCacheKey(
        input.sourceId
      );

    if (
      input.reuseEmbedding !==
      false
    ) {
      const cachedEmbedding =
        this.getCachedEmbedding(
          cacheKey
        );

      if (cachedEmbedding) {
        const selectedTensor:
          SegmentationFloatTensor = {
          name:
            cachedEmbedding.name,

          data:
            cachedEmbedding.data,

          dimensions: [
            ...cachedEmbedding
              .dimensions,
          ],

          dataType:
            'float32',

          layout:
            cachedEmbedding.layout,
        };

        return {
          rawOutput: {
            selectedOutputName:
              cachedEmbedding.name,

            selectedTensor,

            outputs: {
              [cachedEmbedding.name]:
                selectedTensor,
            },

            inferenceMs:
              0,
          },

          embedding:
            cachedEmbedding,

          sessionReused:
            this.isReady(),

          cacheHit:
            true,
        };
      }
    }

    const sessionWasReady =
      this.isReady();

    await this.initializeInternal({
      config:
        this.config,

      requestId,

      onProgress:
        input.onProgress,

      cancellationSignal:
        signal,
    });

    assertNotCancelled(
      signal
    );

    const session =
      this.encoder.session;

    if (!session) {
      throw new SegmentationError(
        'SESSION_NOT_READY',
        'The EdgeSAM encoder session is not ready.',
        {
          requestId,

          component:
            'encoder',

          stage:
            'run-image-encoder',

          retryable:
            true,
        }
      );
    }

    const feeds =
      createEncoderFeeds(
        session,
        input.input,
        this.config
      );

    const requestedOutputs =
      resolveRequestedOutputs(
        session,
        input.outputNames,
        [
          this.config.encoder
            .output
            .preferredName,
        ]
      );

    emitProgress(
      requestId,
      'run-image-encoder',
      'Running the EdgeSAM image encoder.',
      startedAt,
      input.onProgress
    );

    this.state =
      'running';

    this.encoder.state =
      'running';

    const inferenceStartedAt =
      now();

    try {
      const nativePromise:
        Promise<OrtResults> =
        requestedOutputs &&
        requestedOutputs.length >
          0
          ? session.run(
              feeds,
              Array.from(
                requestedOutputs
              )
            )
          : session.run(
              feeds
            );

      const rawResults =
        await runWithTimeout<
          OrtResults
        >(
          nativePromise,
          this.config.encoder
            .session
            .inferenceTimeoutMs,
          () =>
            new SegmentationError(
              'INFERENCE_TIMEOUT',
              'EdgeSAM encoder inference exceeded the allowed time.',
              {
                requestId,

                component:
                  'encoder',

                stage:
                  'run-image-encoder',

                retryable:
                  true,

                metadata: {
                  timeoutMs:
                    this.config.encoder
                      .session
                      .inferenceTimeoutMs,
                },
              }
            )
        );

      assertNotCancelled(
        signal
      );

      const inferenceMs =
        Math.max(
          0,
          now() -
            inferenceStartedAt
        );

      const outputs =
        this.convertNativeResults(
          rawResults,
          'encoder'
        );

      const selectedTensor =
        selectEncoderOutput(
          outputs,
          this.config
        );

      const embedding =
        this.createImageEmbedding(
          selectedTensor,
          input.sourceId,
          input.transform
        );

      this.storeEmbedding(
        cacheKey,
        embedding
      );

      this.encoder.runCount +=
        1;

      this.encoder.lastUsedAt =
        now();

      this.encoder.lastInferenceMs =
        inferenceMs;

      this.encoder.lastError =
        null;

      this.encoder.state =
        'ready';

      this.lastUsedAt =
        now();

      this.lastError =
        null;

      this.state =
        'ready';

      return {
        rawOutput: {
          selectedOutputName:
            selectedTensor.name,

          selectedTensor,

          outputs,

          inferenceMs,
        },

        embedding,

        sessionReused:
          sessionWasReady,

        cacheHit:
          false,
      };
    } catch (error) {
      const normalized =
        isSegmentationError(
          error
        )
          ? error
          : new SegmentationError(
              'ENCODER_INFERENCE_FAILED',
              `EdgeSAM encoder inference failed: ${getUnknownErrorMessage(
                error
              )}`,
              {
                requestId,

                component:
                  'encoder',

                stage:
                  'run-image-encoder',

                retryable:
                  true,

                cause:
                  error,
              }
            );

      this.encoder.lastError =
        normalized.message;

      this.lastError =
        normalized.message;

      this.encoder.state =
        this.encoder.session
          ? 'ready'
          : 'failed';

      this.state =
        this.encoder.session &&
        this.decoder.session
          ? 'ready'
          : 'failed';

      throw normalized;
    }
  }

  async runDecoder(
    input:
      EdgeSamDecoderSessionRunInput
  ): Promise<
    EdgeSamDecoderRawOutput
  > {
    return this.enqueue(
      () =>
        this.runDecoderInternal(
          input
        )
    );
  }

  private async runDecoderInternal(
    input:
      EdgeSamDecoderSessionRunInput
  ): Promise<
    EdgeSamDecoderRawOutput
  > {
    const requestId =
      input.requestId ??
      createSegmentationRequestId();

    const startedAt =
      now();

    const signal =
      input.cancellationSignal;

    assertNotCancelled(
      signal
    );

    if (
      this.isDisposed()
    ) {
      throw new SegmentationError(
        'SESSION_DISPOSED',
        'The EdgeSAM session manager has been disposed.',
        {
          requestId,

          component:
            'decoder',

          stage:
            'run-mask-decoder',

          retryable:
            false,
        }
      );
    }

    const nextConfig =
      input.config
        ? validateSegmentationModelConfig(
            cloneSegmentationModelConfig(
              input.config
            )
          )
        : this.config;

    if (
      !areSessionConfigsEquivalent(
        nextConfig,
        this.config
      ) &&
      (
        this.encoder.session ||
        this.decoder.session
      )
    ) {
      throw new SegmentationError(
        'SESSION_CREATE_FAILED',
        'EdgeSAM configuration changed after the sessions were loaded. Reload the session before running.',
        {
          requestId,

          component:
            'decoder',

          stage:
            'run-mask-decoder',

          retryable:
            false,
        }
      );
    }

    this.config =
      nextConfig;

    validateDecoderInputs(
      input.inputs,
      this.config
    );

    await this.initializeInternal({
      config:
        this.config,

      requestId,

      onProgress:
        input.onProgress,

      cancellationSignal:
        signal,
    });

    assertNotCancelled(
      signal
    );

    const session =
      this.decoder.session;

    if (!session) {
      throw new SegmentationError(
        'SESSION_NOT_READY',
        'The EdgeSAM decoder session is not ready.',
        {
          requestId,

          component:
            'decoder',

          stage:
            'run-mask-decoder',

          retryable:
            true,
        }
      );
    }

    const feeds =
      createDecoderFeeds(
        session,
        input.inputs,
        this.config
      );

    const outputConfig =
      this.config.decoder
        .config
        .outputNames;

    const requestedOutputs =
      resolveRequestedOutputs(
        session,
        input.outputNames,
        [
          outputConfig.masks,
          outputConfig
            .iouPredictions,
          outputConfig
            .lowResolutionMasks,
        ]
      );

    emitProgress(
      requestId,
      'run-mask-decoder',
      'Running the EdgeSAM mask decoder.',
      startedAt,
      input.onProgress
    );

    this.state =
      'running';

    this.decoder.state =
      'running';

    const inferenceStartedAt =
      now();

    try {
      const nativePromise:
        Promise<OrtResults> =
        requestedOutputs &&
        requestedOutputs.length >
          0
          ? session.run(
              feeds,
              Array.from(
                requestedOutputs
              )
            )
          : session.run(
              feeds
            );

      const rawResults =
        await runWithTimeout<
          OrtResults
        >(
          nativePromise,
          this.config.decoder
            .session
            .inferenceTimeoutMs,
          () =>
            new SegmentationError(
              'INFERENCE_TIMEOUT',
              'EdgeSAM decoder inference exceeded the allowed time.',
              {
                requestId,

                component:
                  'decoder',

                stage:
                  'run-mask-decoder',

                retryable:
                  true,

                metadata: {
                  timeoutMs:
                    this.config.decoder
                      .session
                      .inferenceTimeoutMs,
                },
              }
            )
        );

      assertNotCancelled(
        signal
      );

      const inferenceMs =
        Math.max(
          0,
          now() -
            inferenceStartedAt
        );

      emitProgress(
        requestId,
        'read-mask-candidates',
        'Reading EdgeSAM mask candidates.',
        startedAt,
        input.onProgress
      );

      const outputs =
        this.convertNativeResults(
          rawResults,
          'decoder'
        );

      const masksTensor =
        findDecoderOutput(
          outputs,
          outputConfig.masks,
          [
            'mask',
            'masks',
          ],
          3
        );

      if (!masksTensor) {
        throw new SegmentationError(
          'INVALID_DECODER_OUTPUT',
          'No valid mask tensor was returned by the EdgeSAM decoder.',
          {
            requestId,

            component:
              'decoder',

            stage:
              'read-mask-candidates',

            retryable:
              false,
          }
        );
      }

      const scoresTensor =
        findDecoderOutput(
          outputs,
          outputConfig
            .iouPredictions,
          [
            'iou',
            'score',
            'quality',
          ],
          1
        );

      const lowResolutionMasksTensor =
        findDecoderOutput(
          outputs,
          outputConfig
            .lowResolutionMasks,
          [
            'low_res',
            'lowres',
            'low_resolution',
          ],
          3
        );

      this.decoder.runCount +=
        1;

      this.decoder.lastUsedAt =
        now();

      this.decoder.lastInferenceMs =
        inferenceMs;

      this.decoder.lastError =
        null;

      this.decoder.state =
        'ready';

      this.lastUsedAt =
        now();

      this.lastError =
        null;

      this.state =
        'ready';

      return {
        selectedMasksOutputName:
          masksTensor.name,

        selectedScoresOutputName:
          scoresTensor?.name ??
          null,

        selectedLowResolutionMasksOutputName:
          lowResolutionMasksTensor
            ?.name ??
          null,

        masksTensor,

        scoresTensor,

        lowResolutionMasksTensor,

        outputs,

        inferenceMs,
      };
    } catch (error) {
      const normalized =
        isSegmentationError(
          error
        )
          ? error
          : new SegmentationError(
              'DECODER_INFERENCE_FAILED',
              `EdgeSAM decoder inference failed: ${getUnknownErrorMessage(
                error
              )}`,
              {
                requestId,

                component:
                  'decoder',

                stage:
                  'run-mask-decoder',

                retryable:
                  true,

                cause:
                  error,
              }
            );

      this.decoder.lastError =
        normalized.message;

      this.lastError =
        normalized.message;

      this.decoder.state =
        this.decoder.session
          ? 'ready'
          : 'failed';

      this.state =
        this.encoder.session &&
        this.decoder.session
          ? 'ready'
          : 'failed';

      throw normalized;
    } finally {
      if (
        this.config.embeddingCache
          .disposeAfterRequest
      ) {
        this.clearEmbeddingCache();
      }
    }
  }

  async reload(
    input:
      Omit<
        SegmentationSessionInitializeInput,
        'forceReload'
      > = {}
  ): Promise<
    SegmentationSessionLoadResult
  > {
    return this.enqueue(
      async () => {
        if (
          this.state ===
          'disposed'
        ) {
          this.state =
            'uninitialized';
        }

        this.lifecycleGeneration +=
          1;

        await this.releaseSessions();

        if (input.config) {
          this.config =
            validateSegmentationModelConfig(
              cloneSegmentationModelConfig(
                input.config
              )
            );
        }

        this.encoder =
          createComponentState(
            'encoder',
            this.config.encoder
              .session
              .executionProvider
          );

        this.decoder =
          createComponentState(
            'decoder',
            this.config.decoder
              .session
              .executionProvider
          );

        return this.initializeInternal({
          ...input,

          forceReload:
            false,
        });
      }
    );
  }

  private async releaseComponentSession(
    component:
      SegmentationModelComponent
  ): Promise<void> {
    const runtime =
      this.getComponentState(
        component
      );

    const session =
      runtime.session;

    runtime.session =
      null;

    runtime.inputNames =
      [];

    runtime.outputNames =
      [];

    runtime.loadedAt =
      null;

    runtime.lastUsedAt =
      null;

    runtime.modelPath =
      null;

    runtime.sessionLoadMs =
      null;

    runtime.lastInferenceMs =
      null;

    runtime.state =
      this.state ===
        'disposed'
        ? 'disposed'
        : 'uninitialized';

    if (!session) {
      return;
    }

    try {
      await Promise.resolve(
        session.release()
      );
    } catch (error) {
      console.log(
        `EDGESAM ${component.toUpperCase()} SESSION RELEASE ERROR:`,
        error
      );
    }
  }

  private async releaseSessions():
    Promise<void> {
    await this.releaseComponentSession(
      'encoder'
    );

    await this.releaseComponentSession(
      'decoder'
    );

    this.initializedAt =
      null;

    this.lastUsedAt =
      null;

    this.sessionConfigSignature =
      null;

    if (
      this.state !==
      'disposed'
    ) {
      this.state =
        'uninitialized';
    }
  }

  async dispose(
    options:
      SegmentationSessionDisposeOptions = {}
  ): Promise<void> {
    return this.enqueue(
      async () => {
        this.lifecycleGeneration +=
          1;

        this.state =
          'disposed';

        this.encoder.state =
          'disposed';

        this.decoder.state =
          'disposed';

        this.initializationPromise =
          null;

        await this.releaseSessions();

        this.state =
          'disposed';

        this.encoder.state =
          'disposed';

        this.decoder.state =
          'disposed';

        if (
          options.clearEmbeddingCache !==
          false
        ) {
          this.clearEmbeddingCache();
        }

        if (
          options.removeCopiedModels
        ) {
          await safelyDelete(
            getComponentLocalModelUri(
              this.config.assets.encoder
            )
          );

          await safelyDelete(
            getComponentLocalModelUri(
              this.config.assets.decoder
            )
          );

          await safelyDelete(
            getVersionFileUri()
          );
        }
      }
    );
  }
}

let sharedSession:
  SegmentationSession | null =
    null;

export function getSharedSegmentationSession(
  config:
    SegmentationModelConfig =
      DEFAULT_SEGMENTATION_MODEL_CONFIG
): SegmentationSession {
  if (
    !sharedSession ||
    sharedSession.getState() ===
      'disposed'
  ) {
    sharedSession =
      new SegmentationSession(
        config
      );
  }

  return sharedSession;
}

export async function initializeSegmentationSession(
  input:
    SegmentationSessionInitializeInput = {}
): Promise<
  SegmentationSessionLoadResult
> {
  const manager =
    getSharedSegmentationSession(
      input.config ??
      DEFAULT_SEGMENTATION_MODEL_CONFIG
    );

  return manager.initialize(
    input
  );
}

export async function runEdgeSamEncoder(
  input:
    EdgeSamEncoderSessionRunInput
): Promise<{
  rawOutput:
    EdgeSamEncoderRawOutput;

  embedding:
    EdgeSamImageEmbedding;

  sessionReused:
    boolean;

  cacheHit:
    boolean;
}> {
  const manager =
    getSharedSegmentationSession(
      input.config ??
      DEFAULT_SEGMENTATION_MODEL_CONFIG
    );

  return manager.runEncoder(
    input
  );
}

export async function runEdgeSamDecoder(
  input:
    EdgeSamDecoderSessionRunInput
): Promise<
  EdgeSamDecoderRawOutput
> {
  const manager =
    getSharedSegmentationSession(
      input.config ??
      DEFAULT_SEGMENTATION_MODEL_CONFIG
    );

  return manager.runDecoder(
    input
  );
}

export function getSharedSegmentationSessionInfo():
  EdgeSamSessionInfo | null {
  return (
    sharedSession?.getInfo() ??
    null
  );
}

export function getSharedSegmentationSessionDiagnostics():
  SegmentationSessionDiagnostics | null {
  return (
    sharedSession
      ?.getDiagnostics() ??
    null
  );
}

export function clearSharedSegmentationEmbeddingCache():
  void {
  sharedSession
    ?.clearEmbeddingCache();
}

export async function reloadSharedSegmentationSession(
  input:
    Omit<
      SegmentationSessionInitializeInput,
      'forceReload'
    > = {}
): Promise<
  SegmentationSessionLoadResult
> {
  const manager =
    getSharedSegmentationSession(
      input.config ??
      DEFAULT_SEGMENTATION_MODEL_CONFIG
    );

  return manager.reload(
    input
  );
}

export async function disposeSharedSegmentationSession(
  options:
    SegmentationSessionDisposeOptions = {}
): Promise<void> {
  if (!sharedSession) {
    return;
  }

  await sharedSession.dispose(
    options
  );

  sharedSession =
    null;
}

export default
  SegmentationSession;