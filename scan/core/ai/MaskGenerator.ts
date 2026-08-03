// scan/services/MaskGenerator.ts

import {
  type ScanBounds,
  type ScanPoint,
} from '../scanTypes';

/**
 * مصدر الصورة المطلوب إنشاء Mask له.
 *
 * يمكن استخدام:
 * - URI من الكاميرا أو المعرض.
 * - بيانات RGBA خام إذا كانت متاحة.
 */
export type MaskImageSource =
  | {
      type: 'uri';

      uri: string;

      width?: number;

      height?: number;
    }
  | {
      type: 'rgba';

      width: number;

      height: number;

      /**
       * ترتيب كل Pixel:
       * R, G, B, A
       */
      data: Uint8Array;
    };

/**
 * وضع إنشاء الـMask.
 *
 * automatic:
 * يترك اختيار الطريقة للـBackend.
 *
 * subject:
 * يحاول الاحتفاظ بأكبر جسم أمامي.
 *
 * alpha:
 * يعتمد على Alpha الموجود بالصورة.
 */
export type MaskGenerationMode =
  | 'automatic'
  | 'subject'
  | 'alpha';

/**
 * إعدادات تنظيف الـMask.
 */
export type MaskCleanupConfig = {
  /**
   * أقل Alpha يُعتبر Foreground.
   */
  alphaThreshold: number;

  /**
   * إزالة الأجزاء الصغيرة المنفصلة.
   */
  removeSmallComponents: boolean;

  /**
   * أصغر نسبة مساحة مسموح بها
   * للجزء المنفصل.
   */
  minimumComponentAreaRatio: number;

  /**
   * الاحتفاظ بأكبر جسم فقط.
   */
  keepLargestComponent: boolean;

  /**
   * ملء الثقوب المغلقة داخل الجسم.
   */
  fillHoles: boolean;

  /**
   * عدد مرات Erosion.
   */
  erosionIterations: number;

  /**
   * عدد مرات Dilation.
   */
  dilationIterations: number;

  /**
   * عدد مرات تنعيم الحواف.
   */
  smoothingIterations: number;

  /**
   * قوة تنعيم Alpha.
   */
  smoothingStrength: number;

  /**
   * مساحة آمنة حول الجسم.
   */
  boundsPadding: number;
};

/**
 * إعدادات MaskGenerator.
 */
export type MaskGeneratorConfig = {
  mode: MaskGenerationMode;

  cleanup: MaskCleanupConfig;

  /**
   * مهلة تنفيذ Backend الخارجي.
   */
  timeoutMs: number;

  /**
   * هل يسمح باستخدام Alpha الأصلي
   * كحل احتياطي؟
   */
  allowAlphaFallback: boolean;

  /**
   * أقل ثقة لقبول النتيجة.
   */
  minimumConfidence: number;
};

/**
 * بيانات الـMask الخام.
 *
 * كل Pixel يحتوي قيمة واحدة:
 * 0 = خلفية
 * 255 = جسم كامل
 */
export type AlphaMask = {
  width: number;

  height: number;

  data: Uint8Array;
};

/**
 * معلومات الجزء المتصل داخل الـMask.
 */
export type MaskComponent = {
  id: number;

  area: number;

  bounds: ScanBounds;

  centroid: ScanPoint;

  touchesImageEdge: boolean;
};

/**
 * إحصائيات الـMask.
 */
export type MaskStatistics = {
  foregroundPixelCount: number;

  backgroundPixelCount: number;

  foregroundRatio: number;

  bounds: ScanBounds;

  centroid: ScanPoint;

  touchesImageEdge: boolean;

  componentCount: number;

  largestComponentRatio: number;

  edgePixelCount: number;
};

/**
 * النتيجة النهائية.
 */
export type GeneratedMask = {
  mask: AlphaMask;

  statistics: MaskStatistics;

  confidence: number;

  backendId: string;

  usedFallback: boolean;

  processingMs: number;
};

/**
 * نتيجة Backend قبل التنظيف.
 */
export type MaskBackendResult = {
  mask: AlphaMask;

  confidence?: number;

  metadata?: Record<
    string,
    string | number | boolean | null
  >;
};

/**
 * أي Backend يقوم فعليًا بعزل الجسم.
 *
 * يمكن لاحقًا توصيل:
 * - Native segmentation
 * - TensorFlow Lite
 * - MediaPipe
 * - Apple Vision
 * - Android ML Kit
 * - Backend API
 */
export type MaskGenerationBackend = {
  id: string;

  supports(
    source: MaskImageSource
  ): boolean;

  generate(
    source: MaskImageSource,
    options: {
      mode: MaskGenerationMode;

      signal?: AbortSignal;
    }
  ): Promise<MaskBackendResult>;
};

/**
 * مدخل إنشاء Mask.
 */
export type GenerateMaskInput = {
  source: MaskImageSource;

  config?: Partial<MaskGeneratorConfig> & {
    cleanup?: Partial<MaskCleanupConfig>;
  };

  /**
   * Backend محدد لهذه العملية فقط.
   */
  backend?: MaskGenerationBackend;

  signal?: AbortSignal;
};

/**
 * النتيجة الآمنة.
 */
export type TryGenerateMaskResult =
  | {
      success: true;

      result: GeneratedMask;
    }
  | {
      success: false;

      error: MaskGeneratorError;
    };

export type MaskGeneratorErrorCode =
  | 'INVALID_SOURCE'
  | 'INVALID_MASK'
  | 'NO_BACKEND'
  | 'BACKEND_FAILED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'EMPTY_FOREGROUND'
  | 'LOW_CONFIDENCE';

/**
 * خطأ معروف من MaskGenerator.
 */
export class MaskGeneratorError extends Error {
  readonly code:
    MaskGeneratorErrorCode;

  readonly causeValue?:
    unknown;

  constructor(
    code: MaskGeneratorErrorCode,
    message: string,
    causeValue?: unknown
  ) {
    super(message);

    this.name =
      'MaskGeneratorError';

    this.code =
      code;

    this.causeValue =
      causeValue;
  }
}

const DEFAULT_MASK_CLEANUP_CONFIG: MaskCleanupConfig = {
  /**
   * يساوي تقريبًا 0.35 من مدى Alpha.
   *
   * Threshold منخفض نسبيًا لحماية:
   * الأشرطة، الكعب، الأربطة، أطراف الأكمام،
   * وحواف القماش الناعمة.
   */
  alphaThreshold: 89,

  removeSmallComponents: true,

  /**
   * إزالة Noise الصغيرة جدًا فقط.
   *
   * لا نريد حذف جزء حقيقي صغير
   * من قطعة الملابس.
   */
  minimumComponentAreaRatio: 0.00035,

  /**
   * القطعة قد تحتوي أجزاء منفصلة بصريًا،
   * مثل زوج أحذية أو حزام منفصل جزئيًا.
   */
  keepLargestComponent: false,

  /**
   * ملء كل الثقوب قد يغلق فتحات حقيقية:
   * فتحة الرقبة، مقبض الشنطة،
   * فتحات الصندل أو أجزاء الدانتيل.
   */
  fillHoles: false,

  /**
   * ممنوع تآكل حدود القطعة افتراضيًا.
   */
  erosionIterations: 0,

  /**
   * ممنوع توسيع الـMask إلى الخلفية.
   */
  dilationIterations: 0,

  smoothingIterations: 1,

  /**
   * Feather خفيف فقط.
   */
  smoothingStrength: 0.12,

  /**
   * لا نضيف مساحة من الخلفية حول الجسم.
   */
  boundsPadding: 0,
};

export const DEFAULT_MASK_GENERATOR_CONFIG: MaskGeneratorConfig = {
  mode: 'automatic',

  cleanup:
    DEFAULT_MASK_CLEANUP_CONFIG,

  timeoutMs: 30_000,

  allowAlphaFallback: true,

 /**
   * الثقة النهائية تعتمد أساسًا على BiRefNet.
   *
   * لا نرفض قطعة صحيحة لمجرد أنها:
   * صغيرة، رفيعة، طويلة، أو غير ممتلئة.
   */
  minimumConfidence: 0.3,
};

const MASK_BACKGROUND =
  0;

const MASK_FOREGROUND =
  255;

const MINIMUM_IMAGE_SIDE =
  2;

const MAXIMUM_IMAGE_PIXELS =
  40_000_000;

const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

const CARDINAL_OFFSETS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

function clamp(
  value: number,
  minimum: number,
  maximum: number
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function normalizeConfidence(
  value: number
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return clamp(
    value,
    0,
    1
  );
}

function resolveConfig(
  custom:
    GenerateMaskInput['config']
): MaskGeneratorConfig {
  return {
    ...DEFAULT_MASK_GENERATOR_CONFIG,
    ...custom,

    timeoutMs:
      Math.max(
        1_000,
        Number.isFinite(
          custom?.timeoutMs
        )
          ? Number(
              custom?.timeoutMs
            )
          : DEFAULT_MASK_GENERATOR_CONFIG
              .timeoutMs
      ),

    minimumConfidence:
      normalizeConfidence(
        custom?.minimumConfidence ??
          DEFAULT_MASK_GENERATOR_CONFIG
            .minimumConfidence
      ),

    cleanup: {
      ...DEFAULT_MASK_CLEANUP_CONFIG,
      ...custom?.cleanup,

      alphaThreshold:
        clamp(
          Math.round(
            custom?.cleanup
              ?.alphaThreshold ??
              DEFAULT_MASK_CLEANUP_CONFIG
                .alphaThreshold
          ),
          0,
          255
        ),

      minimumComponentAreaRatio:
        clamp(
          custom?.cleanup
            ?.minimumComponentAreaRatio ??
            DEFAULT_MASK_CLEANUP_CONFIG
              .minimumComponentAreaRatio,
          0,
          1
        ),

      erosionIterations:
        Math.max(
          0,
          Math.floor(
            custom?.cleanup
              ?.erosionIterations ??
              DEFAULT_MASK_CLEANUP_CONFIG
                .erosionIterations
          )
        ),

      dilationIterations:
        Math.max(
          0,
          Math.floor(
            custom?.cleanup
              ?.dilationIterations ??
              DEFAULT_MASK_CLEANUP_CONFIG
                .dilationIterations
          )
        ),

      smoothingIterations:
        Math.max(
          0,
          Math.floor(
            custom?.cleanup
              ?.smoothingIterations ??
              DEFAULT_MASK_CLEANUP_CONFIG
                .smoothingIterations
          )
        ),

      smoothingStrength:
        clamp(
          custom?.cleanup
            ?.smoothingStrength ??
            DEFAULT_MASK_CLEANUP_CONFIG
              .smoothingStrength,
          0,
          1
        ),

      boundsPadding:
        Math.max(
          0,
          Math.floor(
            custom?.cleanup
              ?.boundsPadding ??
              DEFAULT_MASK_CLEANUP_CONFIG
                .boundsPadding
          )
        ),
    },
  };
}

function getPixelIndex(
  x: number,
  y: number,
  width: number
) {
  return (
    y *
      width +
    x
  );
}

function isInsideImage(
  x: number,
  y: number,
  width: number,
  height: number
) {
  return (
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height
  );
}

function validateDimensions(
  width: number,
  height: number
) {
  if (
    !Number.isInteger(
      width
    ) ||
    !Number.isInteger(
      height
    ) ||
    width <
      MINIMUM_IMAGE_SIDE ||
    height <
      MINIMUM_IMAGE_SIDE
  ) {
    throw new MaskGeneratorError(
      'INVALID_SOURCE',
      'The image dimensions are invalid.'
    );
  }

  if (
    width *
      height >
    MAXIMUM_IMAGE_PIXELS
  ) {
    throw new MaskGeneratorError(
      'INVALID_SOURCE',
      'The image is too large for local mask processing.'
    );
  }
}

function validateSource(
  source: MaskImageSource
) {
  if (
    source.type ===
    'uri'
  ) {
    if (
      !source.uri ||
      !source.uri.trim()
    ) {
      throw new MaskGeneratorError(
        'INVALID_SOURCE',
        'The image URI is empty.'
      );
    }

    const hasWidth =
      source.width !==
      undefined;

    const hasHeight =
      source.height !==
      undefined;

    /**
     * إما أن تصل الأبعاد معًا،
     * أو يتركهما الـBackend ليقرأهما معًا.
     */
    if (
      hasWidth !==
      hasHeight
    ) {
      throw new MaskGeneratorError(
        'INVALID_SOURCE',
        'Image width and height must be provided together.'
      );
    }

    if (
      hasWidth &&
      hasHeight
    ) {
      validateDimensions(
        source.width as number,
        source.height as number
      );
    }

    return;
  }

  validateDimensions(
    source.width,
    source.height
  );

  const expectedLength =
    source.width *
    source.height *
    4;

  if (
    source.data.length !==
    expectedLength
  ) {
    throw new MaskGeneratorError(
      'INVALID_SOURCE',
      `RGBA data length must be ${expectedLength}, but received ${source.data.length}.`
    );
  }
}

export function validateAlphaMask(
  mask: AlphaMask
) {
  validateDimensions(
    mask.width,
    mask.height
  );

  const expectedLength =
    mask.width *
    mask.height;

  if (
    mask.data.length !==
    expectedLength
  ) {
    throw new MaskGeneratorError(
      'INVALID_MASK',
      `Mask data length must be ${expectedLength}, but received ${mask.data.length}.`
    );
  }
}

export function cloneAlphaMask(
  mask: AlphaMask
): AlphaMask {
  validateAlphaMask(
    mask
  );

  return {
    width:
      mask.width,

    height:
      mask.height,

    data:
      new Uint8Array(
        mask.data
      ),
  };
}

/**
 * Backend محلي يعتمد على Alpha
 * الموجود أصلًا في بيانات RGBA.
 *
 * يعمل فقط مع source.type = rgba.
 */
export const rgbaAlphaMaskBackend: MaskGenerationBackend = {
  id:
    'rgba-alpha',

  supports(
    source
  ) {
    return (
      source.type ===
      'rgba'
    );
  },

  async generate(
    source
  ) {
    if (
      source.type !==
      'rgba'
    ) {
      throw new MaskGeneratorError(
        'INVALID_SOURCE',
        'RGBA Alpha backend requires raw RGBA image data.'
      );
    }

    const pixelCount =
      source.width *
      source.height;

    const maskData =
      new Uint8Array(
        pixelCount
      );

    let transparentPixels =
      0;

    let partiallyTransparentPixels =
      0;

    let opaquePixels =
      0;

    let alphaTotal =
      0;

    for (
      let pixelIndex = 0;
      pixelIndex <
      pixelCount;
      pixelIndex += 1
    ) {
      const alpha =
        source.data[
          pixelIndex *
            4 +
          3
        ];

      maskData[
        pixelIndex
      ] =
        alpha;

      alphaTotal +=
        alpha;

      if (
        alpha ===
        0
      ) {
        transparentPixels +=
          1;
      } else if (
        alpha ===
        255
      ) {
        opaquePixels +=
          1;
      } else {
        partiallyTransparentPixels +=
          1;
      }
    }

    const transparentRatio =
      transparentPixels /
      pixelCount;

    const partialAlphaRatio =
      partiallyTransparentPixels /
      pixelCount;

    const opaqueRatio =
      opaquePixels /
      pixelCount;

    const averageAlpha =
      alphaTotal /
      (
        pixelCount *
        255
      );

    /**
     * صورة الكاميرا العادية تكون غالبًا
     * Alpha = 255 لكل Pixels.
     *
     * هذه ليست صورة معزولة ولا يجوز
     * استخدامها كـMask احتياطي.
     */
    const hasMeaningfulTransparency =
      transparentRatio >=
        0.001 ||
      partialAlphaRatio >=
        0.001;

    if (
      !hasMeaningfulTransparency ||
      opaqueRatio >=
        0.995
    ) {
      throw new MaskGeneratorError(
        'INVALID_MASK',
        'The RGBA source does not contain a meaningful transparency mask.'
      );
    }

    const foregroundRatio =
      1 -
      transparentRatio;

    const confidence =
      normalizeConfidence(
        0.55 +
        Math.min(
          0.3,
          partialAlphaRatio *
            2
        ) +
        (
          foregroundRatio >
            0.003 &&
          foregroundRatio <
            0.975
            ? 0.15
            : 0
        )
      );

    return {
      mask: {
        width:
          source.width,

        height:
          source.height,

        data:
          maskData,
      },

      confidence,

      metadata: {
        transparentRatio,

        partialAlphaRatio,

        opaqueRatio,

        averageAlpha,

        foregroundRatio,
      },
    };
  },
};


/**
 * تحويل Alpha تدريجي إلى Mask ثنائي.
 */
export function thresholdAlphaMask(
  mask: AlphaMask,
  threshold: number
): AlphaMask {
  validateAlphaMask(
    mask
  );

  const safeThreshold =
    clamp(
      Math.round(
        threshold
      ),
      0,
      255
    );

  const data =
    new Uint8Array(
      mask.data.length
    );

  for (
    let index = 0;
    index <
    mask.data.length;
    index += 1
  ) {
    data[index] =
      mask.data[index] >=
      safeThreshold
        ? MASK_FOREGROUND
        : MASK_BACKGROUND;
  }

  return {
    width:
      mask.width,

    height:
      mask.height,

    data,
  };
}

/**
 * تطبيق Support Mask ثنائي على Alpha الناعم.
 *
 * الـSupport يحدد أي Pixels تنتمي للجسم،
 * لكن قيم Alpha الأصلية تظل محفوظة
 * لحواف BiRefNet والـFeather.
 */
function applySupportMask(
  softMask:
    AlphaMask,
  supportMask:
    AlphaMask
): AlphaMask {
  validateAlphaMask(
    softMask
  );

  validateAlphaMask(
    supportMask
  );

  if (
    softMask.width !==
      supportMask.width ||
    softMask.height !==
      supportMask.height
  ) {
    throw new MaskGeneratorError(
      'INVALID_MASK',
      'Soft mask and support mask dimensions do not match.'
    );
  }

  const data =
    new Uint8Array(
      softMask.data.length
    );

  for (
    let index = 0;
    index <
    data.length;
    index += 1
  ) {
    data[index] =
      supportMask.data[index] >
        0
        ? softMask.data[index]
        : MASK_BACKGROUND;
  }

  return {
    width:
      softMask.width,

    height:
      softMask.height,

    data,
  };
}

/**
 * Dilation:
 * يوسع الجسم Pixel واحد في كل دورة.
 */
export function dilateAlphaMask(
  mask: AlphaMask,
  iterations = 1
): AlphaMask {
  validateAlphaMask(
    mask
  );

  let current =
    new Uint8Array(
      mask.data
    );

  const count =
    Math.max(
      0,
      Math.floor(
        iterations
      )
    );

  for (
    let iteration = 0;
    iteration <
    count;
    iteration += 1
  ) {
    const next =
      new Uint8Array(
        current
      );

    for (
      let y = 0;
      y <
      mask.height;
      y += 1
    ) {
      for (
        let x = 0;
        x <
        mask.width;
        x += 1
      ) {
        const index =
          getPixelIndex(
            x,
            y,
            mask.width
          );

        if (
          current[index] >
          0
        ) {
          next[index] =
            MASK_FOREGROUND;

          continue;
        }

        for (
          const [
            offsetX,
            offsetY,
          ] of NEIGHBOR_OFFSETS
        ) {
          const neighborX =
            x +
            offsetX;

          const neighborY =
            y +
            offsetY;

          if (
            !isInsideImage(
              neighborX,
              neighborY,
              mask.width,
              mask.height
            )
          ) {
            continue;
          }

          const neighborIndex =
            getPixelIndex(
              neighborX,
              neighborY,
              mask.width
            );

          if (
            current[
              neighborIndex
            ] >
            0
          ) {
            next[index] =
              MASK_FOREGROUND;

            break;
          }
        }
      }
    }

    current =
      next;
  }

  return {
    width:
      mask.width,

    height:
      mask.height,

    data:
      current,
  };
}

/**
 * Erosion:
 * يقلص الجسم Pixel واحد في كل دورة.
 */
export function erodeAlphaMask(
  mask: AlphaMask,
  iterations = 1
): AlphaMask {
  validateAlphaMask(
    mask
  );

  let current =
    new Uint8Array(
      mask.data
    );

  const count =
    Math.max(
      0,
      Math.floor(
        iterations
      )
    );

  for (
    let iteration = 0;
    iteration <
    count;
    iteration += 1
  ) {
    const next =
      new Uint8Array(
        current.length
      );

    for (
      let y = 0;
      y <
      mask.height;
      y += 1
    ) {
      for (
        let x = 0;
        x <
        mask.width;
        x += 1
      ) {
        const index =
          getPixelIndex(
            x,
            y,
            mask.width
          );

        if (
          current[index] ===
          0
        ) {
          continue;
        }

        let remainsForeground =
          true;

        for (
          const [
            offsetX,
            offsetY,
          ] of NEIGHBOR_OFFSETS
        ) {
          const neighborX =
            x +
            offsetX;

          const neighborY =
            y +
            offsetY;

          if (
            !isInsideImage(
              neighborX,
              neighborY,
              mask.width,
              mask.height
            )
          ) {
            remainsForeground =
              false;

            break;
          }

          const neighborIndex =
            getPixelIndex(
              neighborX,
              neighborY,
              mask.width
            );

          if (
            current[
              neighborIndex
            ] ===
            0
          ) {
            remainsForeground =
              false;

            break;
          }
        }

        if (
          remainsForeground
        ) {
          next[index] =
            MASK_FOREGROUND;
        }
      }
    }

    current =
      next;
  }

  return {
    width:
      mask.width,

    height:
      mask.height,

    data:
      current,
  };
}

/**
 * تنعيم Alpha بالحساب المتوسط
 * مع الحفاظ على الجسم الرئيسي.
 */
export function smoothAlphaMask(
  mask: AlphaMask,
  iterations = 1,
  strength = 0.3
): AlphaMask {
  validateAlphaMask(
    mask
  );

  let current =
    new Uint8Array(
      mask.data
    );

  const safeIterations =
    Math.max(
      0,
      Math.floor(
        iterations
      )
    );

  const safeStrength =
    clamp(
      strength,
      0,
      1
    );

  for (
    let iteration = 0;
    iteration <
    safeIterations;
    iteration += 1
  ) {
    const next =
      new Uint8Array(
        current.length
      );

    for (
      let y = 0;
      y <
      mask.height;
      y += 1
    ) {
      for (
        let x = 0;
        x <
        mask.width;
        x += 1
      ) {
        const index =
          getPixelIndex(
            x,
            y,
            mask.width
          );

        let total =
          current[index];

        let count =
          1;

        for (
          const [
            offsetX,
            offsetY,
          ] of NEIGHBOR_OFFSETS
        ) {
          const neighborX =
            x +
            offsetX;

          const neighborY =
            y +
            offsetY;

          if (
            !isInsideImage(
              neighborX,
              neighborY,
              mask.width,
              mask.height
            )
          ) {
            continue;
          }

          total +=
            current[
              getPixelIndex(
                neighborX,
                neighborY,
                mask.width
              )
            ];

          count +=
            1;
        }

        const average =
          total /
          count;

        next[index] =
          clamp(
            Math.round(
              current[index] *
                (
                  1 -
                  safeStrength
                ) +
              average *
                safeStrength
            ),
            0,
            255
          );
      }
    }

    current =
      next;
  }

  return {
    width:
      mask.width,

    height:
      mask.height,

    data:
      current,
  };
}

/**
 * استخراج Connected Components.
 */
export function findMaskComponents(
  mask: AlphaMask
): MaskComponent[] {
  validateAlphaMask(
    mask
  );

  const visited =
    new Uint8Array(
      mask.data.length
    );

  const components:
    MaskComponent[] = [];

  let componentId =
    0;

  for (
    let startY = 0;
    startY <
    mask.height;
    startY += 1
  ) {
    for (
      let startX = 0;
      startX <
      mask.width;
      startX += 1
    ) {
      const startIndex =
        getPixelIndex(
          startX,
          startY,
          mask.width
        );

      if (
        visited[
          startIndex
        ] ||
        mask.data[
          startIndex
        ] ===
          0
      ) {
        continue;
      }

      componentId +=
        1;

      const queueX:
        number[] = [
          startX,
        ];

      const queueY:
        number[] = [
          startY,
        ];

      visited[
        startIndex
      ] =
        1;

      let queueIndex =
        0;

      let area =
        0;

      let sumX =
        0;

      let sumY =
        0;

      let minimumX =
        startX;

      let maximumX =
        startX;

      let minimumY =
        startY;

      let maximumY =
        startY;

      let touchesImageEdge =
        false;

      while (
        queueIndex <
        queueX.length
      ) {
        const x =
          queueX[
            queueIndex
          ];

        const y =
          queueY[
            queueIndex
          ];

        queueIndex +=
          1;

        area +=
          1;

        sumX +=
          x;

        sumY +=
          y;

        minimumX =
          Math.min(
            minimumX,
            x
          );

        maximumX =
          Math.max(
            maximumX,
            x
          );

        minimumY =
          Math.min(
            minimumY,
            y
          );

        maximumY =
          Math.max(
            maximumY,
            y
          );

        if (
          x === 0 ||
          y === 0 ||
          x ===
            mask.width -
              1 ||
          y ===
            mask.height -
              1
        ) {
          touchesImageEdge =
            true;
        }

        for (
          const [
            offsetX,
            offsetY,
          ] of NEIGHBOR_OFFSETS
        ) {
          const neighborX =
            x +
            offsetX;

          const neighborY =
            y +
            offsetY;

          if (
            !isInsideImage(
              neighborX,
              neighborY,
              mask.width,
              mask.height
            )
          ) {
            continue;
          }

          const neighborIndex =
            getPixelIndex(
              neighborX,
              neighborY,
              mask.width
            );

          if (
            visited[
              neighborIndex
            ] ||
            mask.data[
              neighborIndex
            ] ===
              0
          ) {
            continue;
          }

          visited[
            neighborIndex
          ] =
            1;

          queueX.push(
            neighborX
          );

          queueY.push(
            neighborY
          );
        }
      }

      components.push({
        id:
          componentId,

        area,

        bounds: {
          x:
            minimumX,

          y:
            minimumY,

          width:
            maximumX -
            minimumX +
            1,

          height:
            maximumY -
            minimumY +
            1,
        },

        centroid: {
          x:
            sumX /
            area,

          y:
            sumY /
            area,
        },

        touchesImageEdge,
      });
    }
  }

  return components.sort(
    (
      first,
      second
    ) =>
      second.area -
      first.area
  );
}

function createComponentLabelMap(
  mask: AlphaMask
) {
  const labels =
    new Int32Array(
      mask.data.length
    );

  const components:
    MaskComponent[] = [];

  let componentId =
    0;

  for (
    let startY = 0;
    startY <
    mask.height;
    startY += 1
  ) {
    for (
      let startX = 0;
      startX <
      mask.width;
      startX += 1
    ) {
      const startIndex =
        getPixelIndex(
          startX,
          startY,
          mask.width
        );

      if (
        labels[
          startIndex
        ] !==
          0 ||
        mask.data[
          startIndex
        ] ===
          0
      ) {
        continue;
      }

      componentId +=
        1;

      const queue:
        number[] = [
          startIndex,
        ];

      labels[
        startIndex
      ] =
        componentId;

      let queueIndex =
        0;

      let area =
        0;

      let sumX =
        0;

      let sumY =
        0;

      let minimumX =
        startX;

      let maximumX =
        startX;

      let minimumY =
        startY;

      let maximumY =
        startY;

      let touchesImageEdge =
        false;

      while (
        queueIndex <
        queue.length
      ) {
        const index =
          queue[
            queueIndex
          ];

        queueIndex +=
          1;

        const x =
          index %
          mask.width;

        const y =
          Math.floor(
            index /
            mask.width
          );

        area +=
          1;

        sumX +=
          x;

        sumY +=
          y;

        minimumX =
          Math.min(
            minimumX,
            x
          );

        maximumX =
          Math.max(
            maximumX,
            x
          );

        minimumY =
          Math.min(
            minimumY,
            y
          );

        maximumY =
          Math.max(
            maximumY,
            y
          );

        if (
          x === 0 ||
          y === 0 ||
          x ===
            mask.width -
              1 ||
          y ===
            mask.height -
              1
        ) {
          touchesImageEdge =
            true;
        }

        for (
          const [
            offsetX,
            offsetY,
          ] of NEIGHBOR_OFFSETS
        ) {
          const neighborX =
            x +
            offsetX;

          const neighborY =
            y +
            offsetY;

          if (
            !isInsideImage(
              neighborX,
              neighborY,
              mask.width,
              mask.height
            )
          ) {
            continue;
          }

          const neighborIndex =
            getPixelIndex(
              neighborX,
              neighborY,
              mask.width
            );

          if (
            labels[
              neighborIndex
            ] !==
              0 ||
            mask.data[
              neighborIndex
            ] ===
              0
          ) {
            continue;
          }

          labels[
            neighborIndex
          ] =
            componentId;

          queue.push(
            neighborIndex
          );
        }
      }

      components.push({
        id:
          componentId,

        area,

        bounds: {
          x:
            minimumX,

          y:
            minimumY,

          width:
            maximumX -
            minimumX +
            1,

          height:
            maximumY -
            minimumY +
            1,
        },

        centroid: {
          x:
            sumX /
            area,

          y:
            sumY /
            area,
        },

        touchesImageEdge,
      });
    }
  }

  components.sort(
    (
      first,
      second
    ) =>
      second.area -
      first.area
  );

  return {
    labels,
    components,
  };
}

/**
 * إزالة Noise والأجزاء الصغيرة.
 */
export function removeSmallMaskComponents(
  mask: AlphaMask,
  minimumAreaRatio: number,
  keepLargestOnly: boolean
): AlphaMask {
  validateAlphaMask(
    mask
  );

  const {
    labels,
    components,
  } =
    createComponentLabelMap(
      mask
    );

  if (
    components.length ===
    0
  ) {
    return cloneAlphaMask(
      mask
    );
  }

  const totalPixels =
    mask.width *
    mask.height;

  const minimumArea =
    Math.max(
      1,
      Math.floor(
        totalPixels *
        clamp(
          minimumAreaRatio,
          0,
          1
        )
      )
    );

  const acceptedIds =
    new Set<number>();

  if (
    keepLargestOnly
  ) {
    acceptedIds.add(
      components[0].id
    );
  } else {
    for (
      const component
      of components
    ) {
      /**
       * حماية الأجزاء الحقيقية المنفصلة،
       * مثل الحذاء الثاني أو حزام الشنطة.
       */
      const relativeToLargest =
        components[0].area >
          0
          ? component.area /
            components[0].area
          : 0;

      if (
        component.area >=
          minimumArea ||
        relativeToLargest >=
          0.035
      ) {
        acceptedIds.add(
          component.id
        );
      }
    }

    if (
      acceptedIds.size ===
      0
    ) {
      acceptedIds.add(
        components[0].id
      );
    }
  }

  const data =
    new Uint8Array(
      mask.data.length
    );

  for (
    let index = 0;
    index <
    labels.length;
    index += 1
  ) {
    if (
      acceptedIds.has(
        labels[index]
      )
    ) {
      data[index] =
        MASK_FOREGROUND;
    }
  }

  return {
    width:
      mask.width,

    height:
      mask.height,

    data,
  };
}

/**
 * ملء الثقوب الموجودة داخل الجسم.
 *
 * نبدأ من خلفية حواف الصورة،
 * وأي Background لا يمكن الوصول إليه
 * من الحواف يعتبر Hole.
 */
export function fillAlphaMaskHoles(
  mask: AlphaMask
): AlphaMask {
  validateAlphaMask(
    mask
  );

  const reachableBackground =
    new Uint8Array(
      mask.data.length
    );

  const queue:
    number[] = [];

  function addBackgroundPixel(
    x: number,
    y: number
  ) {
    const index =
      getPixelIndex(
        x,
        y,
        mask.width
      );

    if (
      mask.data[index] >
        0 ||
      reachableBackground[
        index
      ]
    ) {
      return;
    }

    reachableBackground[
      index
    ] =
      1;

    queue.push(
      index
    );
  }

  for (
    let x = 0;
    x <
    mask.width;
    x += 1
  ) {
    addBackgroundPixel(
      x,
      0
    );

    addBackgroundPixel(
      x,
      mask.height -
        1
    );
  }

  for (
    let y = 1;
    y <
    mask.height -
      1;
    y += 1
  ) {
    addBackgroundPixel(
      0,
      y
    );

    addBackgroundPixel(
      mask.width -
        1,
      y
    );
  }

  let queueIndex =
    0;

  while (
    queueIndex <
    queue.length
  ) {
    const index =
      queue[
        queueIndex
      ];

    queueIndex +=
      1;

    const x =
      index %
      mask.width;

    const y =
      Math.floor(
        index /
        mask.width
      );

    for (
      const [
        offsetX,
        offsetY,
      ] of CARDINAL_OFFSETS
    ) {
      const neighborX =
        x +
        offsetX;

      const neighborY =
        y +
        offsetY;

      if (
        !isInsideImage(
          neighborX,
          neighborY,
          mask.width,
          mask.height
        )
      ) {
        continue;
      }

      addBackgroundPixel(
        neighborX,
        neighborY
      );
    }
  }

  const data =
    new Uint8Array(
      mask.data.length
    );

  for (
    let index = 0;
    index <
    mask.data.length;
    index += 1
  ) {
    data[index] =
      mask.data[index] >
        0 ||
      !reachableBackground[
        index
      ]
        ? MASK_FOREGROUND
        : MASK_BACKGROUND;
  }

  return {
    width:
      mask.width,

    height:
      mask.height,

    data,
  };
}

/**
 * استخراج إحصائيات كاملة.
 */
export function analyzeAlphaMask(
  mask: AlphaMask,
  boundsPadding = 0
): MaskStatistics {
  validateAlphaMask(
    mask
  );

  let foregroundPixelCount =
    0;

    let foregroundAlphaTotal =
    0;

  let minimumX =
    mask.width;

  let minimumY =
    mask.height;

  let maximumX =
    -1;

  let maximumY =
    -1;

  let sumX =
    0;

  let sumY =
    0;

  let touchesImageEdge =
    false;

  let edgePixelCount =
    0;

  for (
    let y = 0;
    y <
    mask.height;
    y += 1
  ) {
    for (
      let x = 0;
      x <
      mask.width;
      x += 1
    ) {
      const index =
        getPixelIndex(
          x,
          y,
          mask.width
        );

      if (
        mask.data[index] ===
        0
      ) {
        continue;
      }

      foregroundAlphaTotal +=
        mask.data[index] /
        255;

      foregroundPixelCount +=
        1;

      sumX +=
        x;

      sumY +=
        y;

      minimumX =
        Math.min(
          minimumX,
          x
        );

      minimumY =
        Math.min(
          minimumY,
          y
        );

      maximumX =
        Math.max(
          maximumX,
          x
        );

      maximumY =
        Math.max(
          maximumY,
          y
        );

      const isImageEdge =
        x === 0 ||
        y === 0 ||
        x ===
          mask.width -
            1 ||
        y ===
          mask.height -
            1;

      if (
        isImageEdge
      ) {
        touchesImageEdge =
          true;
      }

      let isMaskEdge =
        isImageEdge;

      if (
        !isMaskEdge
      ) {
        for (
          const [
            offsetX,
            offsetY,
          ] of CARDINAL_OFFSETS
        ) {
          const neighborIndex =
            getPixelIndex(
              x +
                offsetX,
              y +
                offsetY,
              mask.width
            );

          if (
            mask.data[
              neighborIndex
            ] ===
              0
          ) {
            isMaskEdge =
              true;

            break;
          }
        }
      }

      if (
        isMaskEdge
      ) {
        edgePixelCount +=
          1;
      }
    }
  }

  const totalPixels =
    mask.width *
    mask.height;

  if (
    foregroundPixelCount ===
    0
  ) {
    return {
      foregroundPixelCount:
        0,

      backgroundPixelCount:
        totalPixels,

      foregroundRatio:
        0,

      bounds: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },

      centroid: {
        x:
          mask.width /
          2,

        y:
          mask.height /
          2,
      },

      touchesImageEdge:
        false,

      componentCount:
        0,

      largestComponentRatio:
        0,

      edgePixelCount:
        0,
    };
  }

  const safePadding =
    Math.max(
      0,
      Math.floor(
        boundsPadding
      )
    );

  const boundsX =
    Math.max(
      0,
      minimumX -
        safePadding
    );

  const boundsY =
    Math.max(
      0,
      minimumY -
        safePadding
    );

  const boundsRight =
    Math.min(
      mask.width -
        1,
      maximumX +
        safePadding
    );

  const boundsBottom =
    Math.min(
      mask.height -
        1,
      maximumY +
        safePadding
    );

  const components =
    findMaskComponents(
      mask
    );

  return {
    foregroundPixelCount,

    backgroundPixelCount:
      totalPixels -
      foregroundPixelCount,

    foregroundRatio:
      foregroundAlphaTotal /
      totalPixels,

    bounds: {
      x:
        boundsX,

      y:
        boundsY,

      width:
        boundsRight -
        boundsX +
        1,

      height:
        boundsBottom -
        boundsY +
        1,
    },

    centroid: {
      x:
        sumX /
        foregroundPixelCount,

      y:
        sumY /
        foregroundPixelCount,
    },

    touchesImageEdge,

    componentCount:
      components.length,

    largestComponentRatio:
      components.length >
        0
        ? components[0]
            .area /
          foregroundPixelCount
        : 0,

    edgePixelCount,
  };
}

/**
 * تقييم جودة الـMask الناتج.
 */
export function calculateMaskConfidence(
  statistics:
    MaskStatistics,
  backendConfidence =
    1
) {
  if (
    statistics
      .foregroundPixelCount ===
    0
  ) {
    return 0;
  }

  /**
   * أي قطعة بين 0.3% و97.5%
   * قد تكون صحيحة.
   *
   * لا نفرض أن القطعة تملأ 4% على الأقل،
   * لأن الإكسسوارات والأحزمة قد تكون أصغر.
   */
  const foregroundRatioScore =
    statistics
      .foregroundRatio >=
        0.003 &&
    statistics
      .foregroundRatio <=
        0.975
      ? 1
      : statistics
            .foregroundRatio <
          0.003
        ? clamp(
            statistics
              .foregroundRatio /
              0.003,
            0,
            1
          )
        : clamp(
            (
              1 -
              statistics
                .foregroundRatio
            ) /
              0.025,
            0,
            1
          );

  /**
   * تعدد الأجزاء لا يعني فشلًا.
   * المهم أن يكون هناك جسم رئيسي واضح.
   */
  const componentScore =
    clamp(
      statistics
        .largestComponentRatio *
        1.35,
      0,
      1
    );

  /**
   * ملامسة الحافة تقلل الثقة،
   * لكنها لا تُلغي نتيجة BiRefNet وحدها.
   */
  const edgeScore =
    statistics
      .touchesImageEdge
      ? 0.55
      : 1;

  const normalizedBackendConfidence =
    normalizeConfidence(
      backendConfidence
    );

  return normalizeConfidence(
    normalizedBackendConfidence *
      0.58 +
    foregroundRatioScore *
      0.2 +
    componentScore *
      0.14 +
    edgeScore *
      0.08
  );
}

/**
 * تنفيذ خطوات التنظيف بالترتيب.
 */
export function cleanupAlphaMask(
  inputMask:
    AlphaMask,
  config:
    MaskCleanupConfig
): AlphaMask {
  validateAlphaMask(
    inputMask
  );

  /**
   * softMask يحتفظ بقيم Alpha الأصلية
   * الناتجة من BiRefNet.
   */
  let softMask =
    cloneAlphaMask(
      inputMask
    );

  /**
   * supportMask يستخدم فقط للعمليات
   * الهندسية واختيار المكونات.
   */
  let supportMask =
    thresholdAlphaMask(
      inputMask,
      config.alphaThreshold
    );

  if (
    config.removeSmallComponents ||
    config.keepLargestComponent
  ) {
    supportMask =
      removeSmallMaskComponents(
        supportMask,
        config
          .minimumComponentAreaRatio,
        config
          .keepLargestComponent
      );
  }

  /**
   * لا يُنصح بتفعيلها افتراضيًا؛
   * لأنها قد تغلق فتحات حقيقية.
   */
  if (
    config.fillHoles
  ) {
    supportMask =
      fillAlphaMaskHoles(
        supportMask
      );
  }

  if (
    config
      .erosionIterations >
    0
  ) {
    supportMask =
      erodeAlphaMask(
        supportMask,
        config
          .erosionIterations
      );
  }

  if (
    config
      .dilationIterations >
    0
  ) {
    supportMask =
      dilateAlphaMask(
        supportMask,
        config
          .dilationIterations
      );
  }

  /**
   * تنعيم Alpha الأصلي وليس الـBinary Mask.
   *
   * بذلك نحتفظ بـFeather حقيقي
   * بدل تحويل الحافة إلى 0 أو 255 فقط.
   */
  if (
    config
      .smoothingIterations >
    0 &&
    config
      .smoothingStrength >
    0
  ) {
    softMask =
      smoothAlphaMask(
        softMask,
        config
          .smoothingIterations,
        config
          .smoothingStrength
      );
  }

  /**
   * نستخدم الـBinary Support لإزالة Noise،
   * مع الاحتفاظ بقيم Alpha الناعمة
   * داخل الجسم الحقيقي.
   */
  return applySupportMask(
    softMask,
    supportMask
  );
}

async function withTimeout<T>(
  operation: (
    signal:
      AbortSignal
  ) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller =
    new AbortController();

  let timedOut =
    false;

  const timeout =
    setTimeout(
      () => {
        timedOut =
          true;

        controller.abort();
      },
      timeoutMs
    );

  const abortHandler =
    () => {
      controller.abort();
    };

  externalSignal?.addEventListener(
    'abort',
    abortHandler,
    {
      once: true,
    }
  );

  try {
    if (
      externalSignal?.aborted
    ) {
      throw new MaskGeneratorError(
        'ABORTED',
        'Mask generation was aborted.'
      );
    }

    return await operation(
      controller.signal
    );
  } catch (
    error: unknown
  ) {
    if (
      timedOut
    ) {
      throw new MaskGeneratorError(
        'TIMEOUT',
        `Mask generation exceeded ${timeoutMs}ms.`,
        error
      );
    }

    if (
      externalSignal?.aborted
    ) {
      throw new MaskGeneratorError(
        'ABORTED',
        'Mask generation was aborted.',
        error
      );
    }

    throw error;
  } finally {
    clearTimeout(
      timeout
    );

    externalSignal?.removeEventListener(
      'abort',
      abortHandler
    );
  }
}

/**
 * Registry داخلي للـBackends.
 */
class MaskBackendRegistry {
  private readonly backends =
    new Map<
      string,
      MaskGenerationBackend
    >();

  register(
    backend:
      MaskGenerationBackend
  ) {
    if (
      !backend.id ||
      !backend.id.trim()
    ) {
      throw new MaskGeneratorError(
        'INVALID_SOURCE',
        'Mask backend must have a valid ID.'
      );
    }

    if (
      typeof backend.supports !==
        'function' ||
      typeof backend.generate !==
        'function'
    ) {
      throw new MaskGeneratorError(
        'INVALID_SOURCE',
        `Mask backend "${backend.id}" is invalid.`
      );
    }

    const normalizedBackendId =
      backend.id.trim();

    const existingBackend =
      this.backends.get(
        normalizedBackendId
      );

    if (
      existingBackend &&
      existingBackend !==
        backend
    ) {
      throw new MaskGeneratorError(
        'INVALID_SOURCE',
        `Mask backend "${normalizedBackendId}" is already registered.`
      );
    }

   this.backends.set(
      normalizedBackendId,
      backend
    );
  }

  unregister(
    backendId: string
  ) {
    return this.backends.delete(
      backendId.trim()
    );
  }

 get(
    backendId: string
  ) {
    return this.backends.get(
      backendId.trim()
    );
  }

  list() {
    return Array.from(
      this.backends.values()
    );
  }

  findSupported(
    source: MaskImageSource
  ) {
    return this.list().find(
      backend =>
        backend.supports(
          source
        )
    );
  }
}

const backendRegistry =
  new MaskBackendRegistry();

backendRegistry.register(
  rgbaAlphaMaskBackend
);

export function registerMaskBackend(
  backend:
    MaskGenerationBackend
) {
  backendRegistry.register(
    backend
  );
}

export function unregisterMaskBackend(
  backendId: string
) {
  return backendRegistry.unregister(
    backendId
  );
}

export function getMaskBackend(
  backendId: string
) {
  return backendRegistry.get(
    backendId
  );
}

export function listMaskBackends() {
  return backendRegistry.list();
}

function resolveBackend(
  input: GenerateMaskInput,
  config: MaskGeneratorConfig
): {
  backend:
    MaskGenerationBackend;

  usedFallback:
    boolean;
} {
  if (
    input.backend
  ) {
    if (
      !input.backend.supports(
        input.source
      )
    ) {
      throw new MaskGeneratorError(
        'NO_BACKEND',
        `Mask backend "${input.backend.id}" does not support this image source.`
      );
    }

    return {
      backend:
        input.backend,

      usedFallback:
        false,
    };
  }

  const registered =
    backendRegistry.findSupported(
      input.source
    );

  if (
    registered
  ) {
    return {
      backend:
        registered,

      usedFallback:
        registered.id ===
          rgbaAlphaMaskBackend.id,
    };
  }

  if (
    config.allowAlphaFallback &&
    input.source.type ===
      'rgba'
  ) {
    return {
      backend:
        rgbaAlphaMaskBackend,

      usedFallback:
        true,
    };
  }

  throw new MaskGeneratorError(
    'NO_BACKEND',
    input.source.type ===
      'uri'
      ? 'No URI segmentation backend is registered. Register a native or remote segmentation backend before generating the mask.'
      : 'No compatible mask-generation backend is registered.'
  );
}

/**
 * إنشاء Mask وتنظيفه وتحليله.
 */
export async function generateMask(
  input: GenerateMaskInput
): Promise<GeneratedMask> {
  const startedAt =
    Date.now();

  validateSource(
    input.source
  );

  const config =
    resolveConfig(
      input.config
    );

  const {
    backend,
    usedFallback,
  } =
    resolveBackend(
      input,
      config
    );

  let backendResult:
    MaskBackendResult;

  try {
    backendResult =
      await withTimeout(
        signal =>
          backend.generate(
            input.source,
            {
              mode:
                config.mode,

              signal,
            }
          ),
        config.timeoutMs,
        input.signal
      );
  } catch (
    error: unknown
  ) {
    if (
      error instanceof
      MaskGeneratorError
    ) {
      throw error;
    }

    throw new MaskGeneratorError(
      'BACKEND_FAILED',
      `Mask backend "${backend.id}" failed.`,
      error
    );
  }

  validateAlphaMask(
    backendResult.mask
  );

  const cleanedMask =
    cleanupAlphaMask(
      backendResult.mask,
      config.cleanup
    );

    let maximumAlpha =
    0;

  let strongForegroundPixels =
    0;

  for (
    let index = 0;
    index <
    cleanedMask.data.length;
    index += 1
  ) {
    const alpha =
      cleanedMask.data[index];

    maximumAlpha =
      Math.max(
        maximumAlpha,
        alpha
      );

    if (
      alpha >=
      config.cleanup
        .alphaThreshold
    ) {
      strongForegroundPixels +=
        1;
    }
  }

  const strongForegroundRatio =
    strongForegroundPixels /
    cleanedMask.data.length;

  if (
    maximumAlpha <
      config.cleanup
        .alphaThreshold ||
    strongForegroundPixels ===
      0
  ) {
    throw new MaskGeneratorError(
      'EMPTY_FOREGROUND',
      'The generated mask does not contain a strong foreground region.'
    );
  }

  const statistics =
    analyzeAlphaMask(
      cleanedMask,
      config.cleanup
        .boundsPadding
    );

  if (
    statistics
      .foregroundPixelCount ===
    0
  ) {
    throw new MaskGeneratorError(
      'EMPTY_FOREGROUND',
      'No foreground object was detected in the image.'
    );
  }

  const confidence =
    calculateMaskConfidence(
      statistics,
      backendResult
        .confidence ??
        1
    );

 if (
    confidence <
    config.minimumConfidence
  ) {
    throw new MaskGeneratorError(
      'LOW_CONFIDENCE',
      `The generated mask confidence is too low (${confidence.toFixed(
        3
      )}); strong foreground ratio: ${strongForegroundRatio.toFixed(
        4
      )}.`
    );
  }

  return {
    mask:
      cleanedMask,

    statistics,

    confidence,

    backendId:
      backend.id,

    usedFallback,

    processingMs:
      Date.now() -
      startedAt,
  };
}

/**
 * نسخة آمنة لا ترمي Error.
 */
export async function tryGenerateMask(
  input: GenerateMaskInput
): Promise<TryGenerateMaskResult> {
  try {
    return {
      success:
        true,

      result:
        await generateMask(
          input
        ),
    };
  } catch (
    error: unknown
  ) {
    return {
      success:
        false,

      error:
        error instanceof
        MaskGeneratorError
          ? error
          : new MaskGeneratorError(
              'BACKEND_FAILED',
              'Unknown mask-generation error.',
              error
            ),
    };
  }
}

/**
 * تطبيق الـMask مباشرة على RGBA Buffer.
 *
 * هذه النسخة لا تنشئ نسخة إضافية من الصورة،
 * ولذلك تقلل Peak Memory أثناء تصدير PNG.
 *
 * مهم:
 * الدالة تعدّل rgbaData نفسها.
 */
export function applyMaskToRgbaInPlace(
  rgbaData:
    Uint8Array,
  mask:
    AlphaMask
): Uint8Array {
  validateAlphaMask(
    mask
  );

  const expectedLength =
    mask.width *
    mask.height *
    4;

  if (
    rgbaData.length !==
    expectedLength
  ) {
    throw new MaskGeneratorError(
      'INVALID_SOURCE',
      `RGBA data length must be ${expectedLength}.`
    );
  }

  const maskData =
    mask.data;

  for (
    let pixelIndex = 0;
    pixelIndex <
    maskData.length;
    pixelIndex += 1
  ) {
    const alphaIndex =
      pixelIndex *
      4 +
      3;

    const sourceAlpha =
      rgbaData[
        alphaIndex
      ];

    const maskAlpha =
      maskData[
        pixelIndex
      ];

    rgbaData[
      alphaIndex
    ] =
      clamp(
        Math.round(
          sourceAlpha *
          (
            maskAlpha /
            255
          )
        ),
        0,
        255
      );
  }

  return rgbaData;
}

/**
 * النسخة العامة القديمة تظل غير معدّلة
 * بالنسبة للمستخدم: لا تغيّر rgbaData الأصلية.
 *
 * نحافظ عليها حتى لا نكسر أي مكان آخر
 * يعتمد على السلوك القديم.
 */
export function applyMaskToRgba(
  rgbaData:
    Uint8Array,
  mask:
    AlphaMask
): Uint8Array {
  return applyMaskToRgbaInPlace(
    new Uint8Array(
      rgbaData
    ),
    mask
  );
}

/**
 * تحويل Binary Mask إلى RGBA
 * للـDebug أو Preview.
 */
export function alphaMaskToRgba(
  mask: AlphaMask,
  {
    foreground = {
      r: 255,
      g: 255,
      b: 255,
      a: 255,
    },

    background = {
      r: 0,
      g: 0,
      b: 0,
      a: 255,
    },
  }: {
    foreground?: {
      r: number;
      g: number;
      b: number;
      a: number;
    };

    background?: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  } = {}
): Uint8Array {
  validateAlphaMask(
    mask
  );

  const output =
    new Uint8Array(
      mask.width *
      mask.height *
      4
    );

  for (
    let pixelIndex = 0;
    pixelIndex <
    mask.data.length;
    pixelIndex += 1
  ) {
    const maskAlpha =
      mask.data[
        pixelIndex
      ] /
      255;

    const selected =
      maskAlpha >
        0
        ? foreground
        : background;

    const outputIndex =
      pixelIndex *
      4;

    output[
      outputIndex
    ] =
      clamp(
        selected.r,
        0,
        255
      );

    output[
      outputIndex +
        1
    ] =
      clamp(
        selected.g,
        0,
        255
      );

    output[
      outputIndex +
        2
    ] =
      clamp(
        selected.b,
        0,
        255
      );

   output[
      outputIndex +
        3
    ] =
      clamp(
        Math.round(
          selected ===
            foreground
            ? selected.a *
              maskAlpha
            : selected.a
        ),
        0,
        255
      );
  }

  return output;
}

/**
 * ملخص مناسب للـDebug.
 */
export function getMaskDebugSummary(
  result: GeneratedMask
) {
  return {
    backendId:
      result.backendId,

    usedFallback:
      result.usedFallback,

    confidence:
      result.confidence,

    processingMs:
      result.processingMs,

    width:
      result.mask.width,

    height:
      result.mask.height,

    foregroundRatio:
      result.statistics
        .foregroundRatio,

    bounds:
      result.statistics
        .bounds,

    centroid:
      result.statistics
        .centroid,

    componentCount:
      result.statistics
        .componentCount,

    largestComponentRatio:
      result.statistics
        .largestComponentRatio,

    touchesImageEdge:
      result.statistics
        .touchesImageEdge,

    edgePixelCount:
      result.statistics
        .edgePixelCount,
  };
}

/**
 * تسجيل Backend الخاص بصور الكاميرا والمعرض.
 *
 * وضعناه في آخر الملف لتجنب Circular Dependency
 * أثناء تهيئة MaskGenerator.
 */
export async function registerDefaultUriMaskBackend() {
  const {
    skiaUriMaskBackend,
  } = await import(
    '../services/SkiaUriMaskBackend'
  );

  const existingBackend =
    getMaskBackend(
      skiaUriMaskBackend.id
    );

  if (
    !existingBackend
  ) {
    registerMaskBackend(
      skiaUriMaskBackend
    );
  }

  return skiaUriMaskBackend;
}