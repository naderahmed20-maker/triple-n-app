// scan/core/scanTypes.ts

/**
 * الأنواع المركزية لمحرك Triple N Scan Item.
 *
 * النظام الحالي Universal Scan:
 *
 * صورة القطعة
 * → فصل الخلفية
 * → Alpha Mask
 * → اكتشاف الحدود الحقيقية
 * → PNG شفاف
 *
 * لا توجد قوالب أو مطابقة Shapes جاهزة.
 */

export const SCAN_CANVAS_SIZE =
  1000 as const;

export const SCAN_VIEW_BOX =
  '0 0 1000 1000' as const;

export type ScanCanvasSize =
  typeof SCAN_CANVAS_SIZE;

/* =========================================================
 * Wardrobe metadata
 * ======================================================= */

/**
 * نوع دولاب المستخدم.
 *
 * لا يؤثر على اكتشاف حدود القطعة،
 * لكنه يُحفظ كبيانات مرتبطة بالقطعة.
 */
export type ScanGender =
  | 'male'
  | 'female';

/**
 * الفئات التي يدعمها Triple N.
 *
 * Scan Item لا يحتاج قالبًا مختلفًا
 * لكل فئة؛ الفئة تستخدم كبيانات فقط.
 */
export type ScanCategory =
  | 'Tops'
  | 'Pants'
  | 'Shorts'
  | 'Shoes'
  | 'Sneakers'
  | 'Jackets'
  | 'Accessories'
  | 'Dresses'
  | 'Skirts'
  | 'Heels'
  | 'Flats'
  | 'Sandals'
  | 'Bags';

/**
 * اتجاه ظهور القطعة داخل الصورة.
 *
 * القيمة اختيارية للمساعدة في التحليل
 * والتشخيص فقط، وليست لاختيار قالب.
 */
export type ScanViewDirection =
  | 'left-profile'
  | 'right-profile'
  | 'front'
  | 'back'
  | 'top'
  | 'flat-lay'
  | 'unknown';

/* =========================================================
 * Geometry
 * ======================================================= */

/**
 * نقطة ثنائية الأبعاد.
 */
export type ScanPoint = {
  x:
    number;

  y:
    number;
};

/**
 * مستطيل حدود القطعة.
 */
export type ScanBounds = {
  x:
    number;

  y:
    number;

  width:
    number;

  height:
    number;
};

/**
 * قياسات عامة مستخرجة من حدود القطعة
 * الحقيقية.
 *
 * لا تحتوي على أي قياسات خاصة بقالب
 * أو نوع حذاء معين.
 */
export type ScanShapeMeasurements = {
  /**
   * العرض ÷ الارتفاع.
   */
  aspectRatio:
    number;

  /**
   * عرض حدود القطعة داخل Canvas.
   */
  width:
    number;

  /**
   * ارتفاع حدود القطعة داخل Canvas.
   */
  height:
    number;

  /**
   * مساحة المحيط الفعلية.
   */
  area:
    number;

  /**
   * طول المحيط التقريبي.
   */
  perimeter:
    number;

  /**
   * مساحة الجسم داخل Bounds.
   */
  fillRatio:
    number;

  /**
   * استدارة الشكل.
   *
   * تستخدم للتشخيص فقط ولا تؤثر
   * على قبول تصميم غير تقليدي.
   */
  contourRoundness:
    number;

  /**
   * مركز القطعة أفقيًا من 0 إلى 1.
   */
  centerXRatio:
    number;

  /**
   * مركز القطعة رأسيًا من 0 إلى 1.
   */
  centerYRatio:
    number;
};

/**
 * الحدود النهائية المكتشفة من Alpha Mask.
 *
 * هذه الحدود هي شكل القطعة الحقيقي،
 * وليست نتيجة ضبط قالب جاهز.
 */
export type DetectedScanContour = {
  /**
   * SVG Path ناتج مباشرة من حدود القطعة.
   */
  path:
    string;

  bounds:
    ScanBounds;

  direction:
    ScanViewDirection;

  measurements:
    ScanShapeMeasurements;

  /**
   * نقاط موزعة على المحيط الحقيقي.
   */
  sampledPoints:
    readonly ScanPoint[];

  /**
   * ثقة فصل القطعة عن الخلفية.
   */
  foregroundConfidence:
    number;

  /**
   * ثقة جودة المحيط.
   */
  contourConfidence:
    number;

  /**
   * هل القطعة مقصوصة أو تلامس الحافة؟
   */
  touchesImageEdge:
    boolean;

  /**
   * هل الخلفية مناسبة للفصل؟
   */
  backgroundIsUsable:
    boolean;
};

/* =========================================================
 * Scan status and result
 * ======================================================= */

/**
 * حالة تحليل صورة واحدة.
 */
export type ScanAnalysisStatus =
  | 'idle'
  | 'preparing'
  | 'detecting'
  | 'finalizing'
  | 'ready'
  | 'failed';

/**
 * النتيجة النهائية لتحليل Scan Item.
 *
 * لا تحتوي على:
 *
 * - match
 * - profile
 * - fittedShape
 * - candidate
 * - template
 */
export type ScanAnalysisResult = {
  status:
    'ready';

  gender:
    ScanGender;

  /**
   * الفئة المرسلة من التطبيق.
   *
   * لا تستخدم لاختيار قالب.
   */
  requestedCategory:
    ScanCategory;

  requestedSubCategory?:
    string | null;

  /**
   * الحدود الحقيقية المكتشفة.
   */
  detectedContour:
    DetectedScanContour;

  /**
   * في النظام الحالي تساوي الفئة
   * التي اختارها المستخدم.
   */
  finalCategory:
    ScanCategory;

  finalSubCategory:
    string | null;

  processedAt:
    number;

  processingTimeMs:
    number;
};

/* =========================================================
 * Errors
 * ======================================================= */

/**
 * أخطاء Scan Item الفعلية.
 *
 * تم حذف أخطاء:
 *
 * NO_MATCH_FOUND
 * LOW_MATCH_CONFIDENCE
 * FIT_FAILED
 *
 * لأنها كانت تخص نظام القوالب القديم.
 */
export type ScanErrorCode =
  | 'INVALID_IMAGE'
  | 'IMAGE_NOT_FOUND'
  | 'UNSUPPORTED_CATEGORY'
  | 'FOREGROUND_NOT_FOUND'
  | 'MULTIPLE_ITEMS_FOUND'
  | 'ITEM_TOUCHES_EDGE'
  | 'BACKGROUND_TOO_COMPLEX'
  | 'LOW_CONTOUR_CONFIDENCE'
  | 'EXPORT_FAILED'
  | 'MODEL_NOT_AVAILABLE'
  | 'INFERENCE_FAILED'
  | 'DEVICE_UNSUPPORTED'
  | 'CANCELLED'
  | 'UNKNOWN_ERROR';

/**
 * نتيجة فشل موحدة.
 */
export type ScanFailure = {
  status:
    'failed';

  code:
    ScanErrorCode;

  message:
    string;

  recoverable:
    boolean;

  shouldRetake:
    boolean;

  details?:
    Record<
      string,
      string | number | boolean | null
    >;
};

/**
 * نتيجة المحرك سواء نجح أو فشل.
 */
export type ScanEngineResult =
  | ScanAnalysisResult
  | ScanFailure;

/* =========================================================
 * Camera flow
 * ======================================================= */

/**
 * البيانات التي تنتقل من شاشة الكاميرا
 * إلى شاشة تجهيز الصورة.
 *
 * لا تحتوي على templateId.
 */
export type PendingScanCapture = {
  uri:
    string;

  photoWidth:
    number;

  photoHeight:
    number;

  previewWidth:
    number;

  previewHeight:
    number;

  frameX:
    number;

  frameY:
    number;

  frameWidth:
    number;

  frameHeight:
    number;

  scanMode:
    'universal';

  gender?:
    ScanGender;

  requestedCategory?:
    ScanCategory;

  requestedSubCategory?:
    string | null;

  preferredDirection?:
    ScanViewDirection;

  capturedAt:
    number;
};

/**
 * الصورة بعد قص مساحة الكاميرا
 * وقبل تشغيل الفصل المحلي.
 */
export type PreparedScanCapture = {
  croppedUri:
    string;

  originalUri:
    string;

  width:
    number;

  height:
    number;

  category?:
    ScanCategory;

  subCategory?:
    string;

  capturedAt:
    number;
};

/**
 * البيانات النهائية للصورة الشفافة
 * التي تستلمها شاشة إضافة القطعة.
 */
export type StoredScanImage = {
  uri:
    string;

  sourceUri?:
    string;

  category?:
    ScanCategory;

  subCategory?:
    string;

  foregroundConfidence?:
    number;

  contourConfidence?:
    number;

  contourPath?:
    string;

  contourBounds?:
    ScanBounds;

  processed:
    true;

  transparent:
    true;

  scanCompleted:
    true;

  outputWidth:
    number;

  outputHeight:
    number;

  capturedAt:
    number;

  processedAt:
    number;
};

/* =========================================================
 * Engine configuration
 * ======================================================= */

/**
 * إعدادات ScanEngine العامة.
 *
 * لا توجد إعدادات Matcher أو Fitter.
 */
export type ScanEngineConfig = {
  canvasSize:
    ScanCanvasSize;

  viewBox:
    typeof SCAN_VIEW_BOX;

  minimumForegroundConfidence:
    number;

  minimumContourConfidence:
    number;
};

/**
 * إعدادات المحرك الافتراضية.
 */
export const DEFAULT_SCAN_ENGINE_CONFIG:
  ScanEngineConfig = {
    canvasSize:
      SCAN_CANVAS_SIZE,

    viewBox:
      SCAN_VIEW_BOX,

    minimumForegroundConfidence:
      0.65,

    minimumContourConfidence:
      0.68,
  };

/* =========================================================
 * Validation helpers
 * ======================================================= */

/**
 * فحص أن القيمة رقم صالح.
 */
export function isFiniteScanNumber(
  value:
    unknown
): value is number {
  return (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    )
  );
}

/**
 * حصر قيمة بين حدين.
 */
export function clampScanValue(
  value:
    number,
  minimum:
    number,
  maximum:
    number
) {
  return Math.min(
    Math.max(
      value,
      minimum
    ),
    maximum
  );
}

/**
 * حصر درجة الثقة بين 0 و1.
 */
export function normalizeConfidence(
  value:
    number
) {
  return clampScanValue(
    value,
    0,
    1
  );
}

/**
 * التأكد من صحة نقطة.
 */
export function isValidScanPoint(
  value:
    unknown
): value is ScanPoint {
  if (
    typeof value !==
      'object' ||
    value ===
      null
  ) {
    return false;
  }

  const point =
    value as Partial<
      ScanPoint
    >;

  return (
    isFiniteScanNumber(
      point.x
    ) &&
    isFiniteScanNumber(
      point.y
    )
  );
}

/**
 * التأكد من صحة Bounds.
 */
export function isValidScanBounds(
  value:
    unknown
): value is ScanBounds {
  if (
    typeof value !==
      'object' ||
    value ===
      null
  ) {
    return false;
  }

  const bounds =
    value as Partial<
      ScanBounds
    >;

  return (
    isFiniteScanNumber(
      bounds.x
    ) &&
    isFiniteScanNumber(
      bounds.y
    ) &&
    isFiniteScanNumber(
      bounds.width
    ) &&
    isFiniteScanNumber(
      bounds.height
    ) &&
    bounds.width >
      0 &&
    bounds.height >
      0
  );
}

/**
 * التحقق من نتيجة Contour.
 */
export function validateDetectedScanContour(
  contour:
    DetectedScanContour
): string[] {
  const errors:
    string[] = [];

  if (
    !contour ||
    typeof contour !==
      'object'
  ) {
    return [
      'Detected contour is missing.',
    ];
  }

  if (
    typeof contour.path !==
      'string' ||
    contour.path
      .trim()
      .length ===
      0
  ) {
    errors.push(
      'Detected contour path is missing.'
    );
  }

  if (
    !isValidScanBounds(
      contour.bounds
    )
  ) {
    errors.push(
      'Detected contour bounds are invalid.'
    );
  }

  if (
    !Array.isArray(
      contour.sampledPoints
    ) ||
    contour.sampledPoints
      .length <
      3
  ) {
    errors.push(
      'Detected contour must contain at least three points.'
    );
  } else if (
    contour.sampledPoints
      .some(
        point =>
          !isValidScanPoint(
            point
          )
      )
  ) {
    errors.push(
      'Detected contour contains invalid points.'
    );
  }

  if (
    !isFiniteScanNumber(
      contour
        .foregroundConfidence
    ) ||
    contour
      .foregroundConfidence <
      0 ||
    contour
      .foregroundConfidence >
      1
  ) {
    errors.push(
      'Foreground confidence must be between 0 and 1.'
    );
  }

  if (
    !isFiniteScanNumber(
      contour
        .contourConfidence
    ) ||
    contour
      .contourConfidence <
      0 ||
    contour
      .contourConfidence >
      1
  ) {
    errors.push(
      'Contour confidence must be between 0 and 1.'
    );
  }

  return errors;
}