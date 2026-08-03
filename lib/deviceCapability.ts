import * as Device from 'expo-device';

import * as FileSystem from 'expo-file-system/legacy';

import Constants from 'expo-constants';

export const MIN_ANDROID_RAM_GB = 4;

export const MIN_IOS_RAM_GB = 3;

export const CACHE_KEY =
  'TRIPLE_N_DEVICE_CAPABILITY_V1';

const CACHE_DURATION_MS =
  1000 * 60 * 60 * 24;

export type DeviceCapabilityReason =
  | 'supported'
  | 'low_ram'
  | 'unsupported_os'
  | 'simulator'
  | 'model_missing'
  | 'runtime_not_ready'
  | 'storage_unavailable'
  | 'unknown';

export type DeviceCapabilityResult = {
  supported: boolean;

  reason: DeviceCapabilityReason;

  message: string;

  totalMemoryGB: number;

  totalMemoryBytes: number;

  platform:
    | 'android'
    | 'ios'
    | 'unknown';

  brand: string;

  manufacturer: string;

  modelName: string;

  osName: string;

  osVersion: string;

  isDevice: boolean;

  appVersion: string;

  checkedAt: number;
};

type CachedCapability = {
  expiresAt: number;

  result: DeviceCapabilityResult;
};

let cachedResult:
  CachedCapability | null =
  null;

function bytesToGB(
  bytes: number
) {
  return Number(
    (
      bytes /
      1024 /
      1024 /
      1024
    ).toFixed(2)
  );
}

function createResult(
  partial: Partial<DeviceCapabilityResult>
): DeviceCapabilityResult {
  return {
    supported: false,

    reason: 'unknown',

    message: 'Unknown device state.',

    totalMemoryGB: 0,

    totalMemoryBytes: 0,

    platform: 'unknown',

    brand: '',

    manufacturer: '',

    modelName: '',

    osName: '',

    osVersion: '',

    isDevice: false,

    appVersion:
      Constants.expoConfig?.version ??
      '1.0.0',

    checkedAt:
      Date.now(),

    ...partial,
  };
}

export async function clearDeviceCapabilityCache() {
  cachedResult = null;
}

function getCachedResult() {
  if (!cachedResult) {
    return null;
  }

  if (
    cachedResult.expiresAt <
    Date.now()
  ) {
    cachedResult = null;

    return null;
  }

  return cachedResult.result;
}

function saveCache(
  result: DeviceCapabilityResult
) {
  cachedResult = {
    expiresAt:
      Date.now() +
      CACHE_DURATION_MS,

    result,
  };
}

async function checkStorage() {
  try {
    const info =
      await FileSystem.getFreeDiskStorageAsync();

    return info > 1024 * 1024 * 500;
  } catch {
    return false;
  }
}

function getPlatform():
  | 'android'
  | 'ios'
  | 'unknown' {
  switch (
    Device.osName?.toLowerCase()
  ) {
    case 'android':
      return 'android';

    case 'ios':
      return 'ios';

    default:
      return 'unknown';
  }
}

/**
 * الإعدادات الاختيارية لفحص الجهاز.
 */
export type CheckDeviceCapabilityOptions = {
  /**
   * تجاهل النتيجة المؤقتة المحفوظة
   * وتنفيذ فحص جديد بالكامل.
   */
  force?: boolean;

  /**
   * التأكد من أن Native ONNX Runtime
   * موجود ويمكن استيراده.
   *
   * هذا لا يحمل نموذج BiRefNet.
   */
  verifyModelRuntime?: boolean;

  /**
   * الحد الأدنى المطلوب من المساحة الحرة.
   *
   * القيمة الافتراضية 500 MB.
   */
  minimumFreeStorageBytes?: number;
};

type RuntimeCheckResult = {
  ready: boolean;

  error:
    | string
    | null;
};

type OperatingSystemCheckResult = {
  supported: boolean;

  version:
    string;

  majorVersion:
    number | null;
};

/**
 * أقل مساحة حرة نسمح عندها
 * بتشغيل Scan Item بأمان.
 *
 * نحتاج مساحة للنموذج، الصور المؤقتة،
 * الـRGBA buffers، والـPNG النهائي.
 */
const DEFAULT_MINIMUM_FREE_STORAGE_BYTES =
  500 *
  1024 *
  1024;

/**
 * الحد الأدنى المبدئي للنظام.
 *
 * لا نعتمد على هذا الفحص وحده؛
 * RAM وONNX Runtime هما العاملان الأهم.
 */
const MIN_ANDROID_OS_MAJOR =
  10;

const MIN_IOS_OS_MAJOR =
  15;

/**
 * يحول القيم غير المعروفة إلى نص آمن.
 */
function normalizeText(
  value:
    unknown
): string {
  if (
    typeof value !==
    'string'
  ) {
    return '';
  }

  return value.trim();
}

/**
 * قراءة أول رقم من إصدار النظام.
 *
 * أمثلة:
 * "18.5"      => 18
 * "15"        => 15
 * "Android 14" => 14
 */
function parseMajorVersion(
  value:
    unknown
): number | null {
  if (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    )
  ) {
    return Math.floor(
      value
    );
  }

  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const match =
    value.match(
      /\d+/
    );

  if (!match) {
    return null;
  }

  const parsed =
    Number(
      match[0]
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return null;
  }

  return Math.floor(
    parsed
  );
}

/**
 * يمنع ظهور NaN أو أرقام سالبة
 * في نتيجة فحص الذاكرة.
 */
function normalizeMemoryBytes(
  value:
    unknown
): number {
  if (
    typeof value !==
      'number' ||
    !Number.isFinite(
      value
    ) ||
    value <= 0
  ) {
    return 0;
  }

  return Math.floor(
    value
  );
}

/**
 * تحديد الحد الأدنى المطلوب من RAM
 * حسب نظام التشغيل.
 */
function getMinimumRamGB(
  platform:
    DeviceCapabilityResult['platform']
): number {
  if (
    platform ===
    'android'
  ) {
    return MIN_ANDROID_RAM_GB;
  }

  if (
    platform ===
    'ios'
  ) {
    return MIN_IOS_RAM_GB;
  }

  return Number.POSITIVE_INFINITY;
}

/**
 * فحص إصدار نظام التشغيل.
 */
function checkOperatingSystem(
  platform:
    DeviceCapabilityResult['platform'],
  rawVersion:
    unknown
): OperatingSystemCheckResult {
  const version =
    normalizeText(
      rawVersion
    );

  const majorVersion =
    parseMajorVersion(
      rawVersion
    );

  if (
    platform ===
    'android'
  ) {
    return {
      supported:
        majorVersion !==
          null &&
        majorVersion >=
          MIN_ANDROID_OS_MAJOR,

      version,

      majorVersion,
    };
  }

  if (
    platform ===
    'ios'
  ) {
    return {
      supported:
        majorVersion !==
          null &&
        majorVersion >=
          MIN_IOS_OS_MAJOR,

      version,

      majorVersion,
    };
  }

  return {
    supported:
      false,

    version,

    majorVersion,
  };
}

/**
 * التأكد أن onnxruntime-react-native
 * موجود داخل الـNative Build.
 *
 * هذا الفحص يفشل داخل Expo Go لأن
 * نموذج المشروع يحتاج Development Build
 * يحتوي على Native ONNX Runtime.
 */
async function checkOnnxRuntime():
  Promise<RuntimeCheckResult> {
  try {
    const runtime =
      await import(
        'onnxruntime-react-native'
      );

    const hasInferenceSession =
      Boolean(
        runtime
          .InferenceSession
      );

    const hasTensor =
      Boolean(
        runtime.Tensor
      );

    if (
      !hasInferenceSession ||
      !hasTensor
    ) {
      return {
        ready:
          false,

        error:
          'ONNX Runtime loaded without the required APIs.',
      };
    }

    if (
      typeof runtime
        .InferenceSession
        .create !==
      'function'
    ) {
      return {
        ready:
          false,

        error:
          'ONNX InferenceSession.create is unavailable.',
      };
    }

    return {
      ready:
        true,

      error:
        null,
    };
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.message
        : String(
            error
          );

    return {
      ready:
        false,

      error:
        message,
    };
  }
}

/**
 * فحص المساحة الحرة بالقيمة المطلوبة.
 */
async function checkRequiredStorage(
  minimumBytes:
    number
): Promise<boolean> {
  try {
    const freeBytes =
      await FileSystem
        .getFreeDiskStorageAsync();

    return (
      Number.isFinite(
        freeBytes
      ) &&
      freeBytes >=
        minimumBytes
    );
  } catch (
    error
  ) {
    console.log(
      'DEVICE STORAGE CHECK ERROR:',
      error
    );

    return false;
  }
}

/**
 * إنشاء البيانات الأساسية المشتركة
 * بين كل نتائج الفحص.
 */
function createBaseDeviceResult(): Omit<
  DeviceCapabilityResult,
  | 'supported'
  | 'reason'
  | 'message'
> {
  const platform =
    getPlatform();

  const totalMemoryBytes =
    normalizeMemoryBytes(
      Device.totalMemory
    );

  return {
    totalMemoryGB:
      bytesToGB(
        totalMemoryBytes
      ),

    totalMemoryBytes,

    platform,

    brand:
      normalizeText(
        Device.brand
      ),

    manufacturer:
      normalizeText(
        Device.manufacturer
      ),

    modelName:
      normalizeText(
        Device.modelName
      ),

    osName:
      normalizeText(
        Device.osName
      ),

    osVersion:
      normalizeText(
        Device.osVersion
      ),

    isDevice:
      Device.isDevice ===
      true,

    appVersion:
      Constants.expoConfig
        ?.version ??
      Constants.nativeAppVersion ??
      '1.0.0',

    checkedAt:
      Date.now(),
  };
}

/**
 * إنشاء نتيجة فشل موحدة مع الحفاظ
 * على جميع بيانات الجهاز المقروءة.
 */
function createFailureResult(
  base:
    Omit<
      DeviceCapabilityResult,
      | 'supported'
      | 'reason'
      | 'message'
    >,
  reason:
    Exclude<
      DeviceCapabilityReason,
      'supported'
    >,
  message:
    string
): DeviceCapabilityResult {
  return createResult({
    ...base,

    supported:
      false,

    reason,

    message,

    checkedAt:
      Date.now(),
  });
}

/**
 * إنشاء نتيجة نجاح موحدة.
 */
function createSupportedResult(
  base:
    Omit<
      DeviceCapabilityResult,
      | 'supported'
      | 'reason'
      | 'message'
    >
): DeviceCapabilityResult {
  return createResult({
    ...base,

    supported:
      true,

    reason:
      'supported',

    message:
      'This device supports Triple N Scan Item.',

    checkedAt:
      Date.now(),
  });
}

/**
 * الفحص الرئيسي لقدرة الجهاز.
 *
 * ترتيب الفحوص مهم:
 *
 * 1. منصة مدعومة.
 * 2. جهاز حقيقي.
 * 3. إصدار النظام.
 * 4. إجمالي RAM.
 * 5. المساحة الحرة.
 * 6. توفر Native ONNX Runtime.
 */
export async function checkDeviceCapability(
  options:
    CheckDeviceCapabilityOptions = {}
): Promise<DeviceCapabilityResult> {
  const {
    force =
      false,

    verifyModelRuntime =
      true,

    minimumFreeStorageBytes =
      DEFAULT_MINIMUM_FREE_STORAGE_BYTES,
  } =
    options;

  if (!force) {
    const saved =
      getCachedResult();

    if (saved) {
      return saved;
    }
  }

  const base =
    createBaseDeviceResult();

  /**
   * Triple N Mobile يدعم Android وiOS فقط.
   */
  if (
    base.platform ===
    'unknown'
  ) {
    const result =
      createFailureResult(
        base,
        'unsupported_os',
        'Triple N Scan Item is supported only on Android and iOS devices.'
      );

    saveCache(
      result
    );

    return result;
  }

  /**
   * لا نعتمد المحاكي كجهاز مدعوم؛
   * قياسات الذاكرة والأداء عليه لا تمثل
   * جهاز المستخدم الحقيقي.
   */
  if (
    !base.isDevice
  ) {
    const result =
      createFailureResult(
        base,
        'simulator',
        'Triple N Scan Item requires a physical device.'
      );

    saveCache(
      result
    );

    return result;
  }

  const osCheck =
    checkOperatingSystem(
      base.platform,
      base.osVersion
    );

  if (
    !osCheck.supported
  ) {
    const minimumVersion =
      base.platform ===
      'android'
        ? MIN_ANDROID_OS_MAJOR
        : MIN_IOS_OS_MAJOR;

    const platformName =
      base.platform ===
      'android'
        ? 'Android'
        : 'iOS';

    const result =
      createFailureResult(
        base,
        'unsupported_os',
        `${platformName} ${minimumVersion} or later is required.`
      );

    saveCache(
      result
    );

    return result;
  }

  const minimumRamGB =
    getMinimumRamGB(
      base.platform
    );

  /**
   * totalMemory = 0 يعني أن النظام
   * لم يوفر قراءة موثوقة للذاكرة.
   *
   * لا نسمح بتجاوز الفحص لأن Scan Item
   * هو الوظيفة الأساسية للتطبيق.
   */
  if (
    base.totalMemoryBytes <=
    0
  ) {
    const result =
      createFailureResult(
        base,
        'unknown',
        'Triple N could not verify the device memory.'
      );

    saveCache(
      result
    );

    return result;
  }

  if (
    base.totalMemoryGB <
    minimumRamGB
  ) {
    const result =
      createFailureResult(
        base,
        'low_ram',
        `This device has ${base.totalMemoryGB} GB RAM. At least ${minimumRamGB} GB is required.`
      );

    saveCache(
      result
    );

    return result;
  }

  const normalizedMinimumStorage =
    Number.isFinite(
      minimumFreeStorageBytes
    )
      ? Math.max(
          0,
          Math.floor(
            minimumFreeStorageBytes
          )
        )
      : DEFAULT_MINIMUM_FREE_STORAGE_BYTES;

  const storageReady =
    await checkRequiredStorage(
      normalizedMinimumStorage
    );

  if (
    !storageReady
  ) {
    const result =
      createFailureResult(
        base,
        'storage_unavailable',
        'Not enough free storage is available to run Triple N Scan Item safely.'
      );

    saveCache(
      result
    );

    return result;
  }

  if (
    verifyModelRuntime
  ) {
    const runtime =
      await checkOnnxRuntime();

    if (
      !runtime.ready
    ) {
      console.log(
        'ONNX RUNTIME CHECK ERROR:',
        runtime.error
      );

      const result =
        createFailureResult(
          base,
          'runtime_not_ready',
          'The Scan Item AI runtime is unavailable in this build.'
        );

      saveCache(
        result
      );

      return result;
    }
  }

  const result =
    createSupportedResult(
      base
    );

  saveCache(
    result
  );

  return result;
}

/**
 * يمنع تنفيذ أكثر من فحص فعلي
 * فى نفس الوقت.
 */
let pendingCheck:
  Promise<DeviceCapabilityResult> | null =
  null;

/**
 * تنفيذ فحص الجهاز مع منع
 * الفحوص المتزامنة.
 */
export async function checkDeviceCapabilitySafe(
  options: CheckDeviceCapabilityOptions = {}
): Promise<DeviceCapabilityResult> {
  if (pendingCheck) {
    return pendingCheck;
  }

  pendingCheck =
    checkDeviceCapability(options);

  try {
    return await pendingCheck;
  } finally {
    pendingCheck = null;
  }
}

/**
 * هل الجهاز مدعوم؟
 */
export async function isDeviceSupported(
  force = false
): Promise<boolean> {
  const result =
    await checkDeviceCapabilitySafe({
      force,
    });

  return result.supported;
}

/**
 * أقل RAM مطلوبة حسب المنصة.
 */
export function getRequiredRamGB(
  platform:
    DeviceCapabilityResult['platform']
): number {
  return getMinimumRamGB(
    platform
  );
}

/**
 * رسالة مناسبة للمستخدم
 * حسب سبب الرفض.
 */
export function getCapabilityMessage(
  result: DeviceCapabilityResult
): string {
  switch (
    result.reason
  ) {
    case 'supported':
      return 'Your device is ready.';

    case 'low_ram':
      return `Your device has ${result.totalMemoryGB} GB RAM. More memory is required for Triple N Scan Item.`;

    case 'unsupported_os':
      return 'Please update your operating system to continue.';

    case 'simulator':
      return 'Triple N Scan Item works only on physical devices.';

    case 'storage_unavailable':
      return 'Free some storage space and try again.';

    case 'runtime_not_ready':
      return 'The AI engine is not available in this application build.';

    case 'model_missing':
      return 'The Scan Item model could not be found.';

    default:
      return result.message;
  }
}

/**
 * رسالة مختصرة
 * تستخدم فى Splash Screen.
 */
export function getShortCapabilityMessage(
  result: DeviceCapabilityResult
): string {
  switch (
    result.reason
  ) {
    case 'supported':
      return 'Ready';

    case 'low_ram':
      return 'Not enough memory';

    case 'unsupported_os':
      return 'Unsupported OS';

    case 'simulator':
      return 'Simulator';

    case 'runtime_not_ready':
      return 'AI unavailable';

    case 'storage_unavailable':
      return 'Storage full';

    case 'model_missing':
      return 'Model missing';

    default:
      return 'Unknown';
  }
}

/**
 * يعيد ملخصًا
 * يستخدم فى الـLogs.
 */
export function getCapabilitySummary(
  result: DeviceCapabilityResult
) {
  return {
    supported:
      result.supported,

    reason:
      result.reason,

    platform:
      result.platform,

    ramGB:
      result.totalMemoryGB,

    os:
      result.osVersion,

    model:
      result.modelName,

    manufacturer:
      result.manufacturer,

    checkedAt:
      result.checkedAt,
  };
}

/**
 * يستخدم عند
 * Resume من Background.
 */
export async function recheckDeviceCapability() {
  return checkDeviceCapabilitySafe({
    force: true,
    verifyModelRuntime: true,
  });
}

/**
 * هل يحتاج الجهاز
 * إلى إظهار شاشة Unsupported.
 */
export function shouldBlockApplication(
  result: DeviceCapabilityResult
) {
  return !result.supported;
}

/**
 * يستخدم فى شاشة
 * Device Not Supported.
 */
export function getMinimumRequirements() {
  return {
    androidRamGB:
      MIN_ANDROID_RAM_GB,

    iosRamGB:
      MIN_IOS_RAM_GB,

    androidVersion:
      MIN_ANDROID_OS_MAJOR,

    iosVersion:
      MIN_IOS_OS_MAJOR,

    freeStorageMB:
      Math.floor(
        DEFAULT_MINIMUM_FREE_STORAGE_BYTES /
          1024 /
          1024
      ),
  };
}