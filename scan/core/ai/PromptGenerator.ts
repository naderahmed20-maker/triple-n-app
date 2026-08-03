// scan/core/ai/PromptGenerator.ts
// Part 1.1
//
// Triple N - EdgeSAM Prompt Generator
//
// هذا الملف مسؤول عن:
// 1. إنشاء نقاط الـForeground الإيجابية.
// 2. إنشاء نقاط الـBackground السلبية.
// 3. إنشاء Bounding Box آمن حول القطعة.
// 4. تخصيص توزيع النقاط حسب شكل القطعة الصيفية.
// 5. تحويل الإحداثيات إلى نظام Decoder الخاص بـEdgeSAM.
// 6. إنشاء جميع Tensors المطلوبة لتشغيل Decoder.
// 7. دعم الـAutomatic Prompts والـManual Prompts.
// 8. منع النقاط المكررة أو غير الصالحة.
// 9. توفير Fallbacks آمنة عند ضعف تحليل الصورة.
// 10. الحفاظ على استهلاك ذاكرة مناسب للموبايل.

import type {
  EdgeSamAutomaticPromptConfig,
  EdgeSamAutomaticPromptSource,
  EdgeSamBoxPrompt,
  EdgeSamPointCoordinatesTensor,
  EdgeSamPointLabelsTensor,
  EdgeSamPreviousMaskPrompt,
  EdgeSamPrompt,
  EdgeSamPromptGenerationDiagnostics,
  EdgeSamPromptGenerationInput,
  EdgeSamPromptGenerationResult,
  EdgeSamPromptPoint,
  SegmentationBoxCoordinates,
  SegmentationCancellationSignal,
  SegmentationCoordinateSpace,
  SegmentationModelConfig,
  SegmentationPipelineStage,
  SegmentationPoint,
  SegmentationProgressCallback,
  SegmentationPromptMode,
  SegmentationRect,
  SegmentationTransform
} from './types';

import {
  SEGMENTATION_STAGE_INDEX,
  SEGMENTATION_TOTAL_STAGES,
  SegmentationError,
  clampUnitValue,
  createEdgeSamPromptId,
  createSegmentationRequestId,
  getSegmentationProgress,
} from './types';

import {
  DEFAULT_SEGMENTATION_MODEL_CONFIG,
  cloneSegmentationModelConfig,
  validateSegmentationModelConfig,
} from './modelConfig';

/* =========================================================
 * Constants
 * ======================================================= */

/**
 * أقصى عدد Pixels يمكن فحصه مباشرة أثناء تحليل الصورة.
 *
 * الصور الأكبر يتم تحليلها باستخدام Sampling Step
 * لتقليل الوقت واستهلاك الذاكرة على الهاتف.
 */
const MAXIMUM_DIRECT_ANALYSIS_PIXELS =
  1_500_000;

/**
 * الحد الأقصى لعدد عينات الصورة المستخدمة
 * في تقدير لون الخلفية والـForeground.
 */
const MAXIMUM_IMAGE_ANALYSIS_SAMPLES =
  220_000;

/**
 * الحد الأدنى المقبول لعرض أو ارتفاع الصورة.
 */
const MINIMUM_IMAGE_DIMENSION =
  2;

/**
 * الحد الأقصى الآمن لأي بُعد صورة.
 *
 * لا يعني أن الموديل سيعمل بهذا المقاس؛
 * بل يمنع إدخال قيم غير منطقية أو تالفة.
 */
const MAXIMUM_IMAGE_DIMENSION =
  32_768;

/**
 * EdgeSAM يستخدم:
 *
 * 0 = Background Point
 * 1 = Foreground Point
 *
 * القيمتان 2 و3 مخصصتان لنقطتي الـBounding Box
 * في بعض نسخ SAM Decoder.
 */
const NEGATIVE_POINT_LABEL =
  0;

const POSITIVE_POINT_LABEL =
  1;

const BOX_TOP_LEFT_LABEL =
  2;

const BOX_BOTTOM_RIGHT_LABEL =
  3;

/**
 * الحد الأدنى لعدد النقاط الإيجابية.
 */
const MINIMUM_POSITIVE_POINT_COUNT =
  1;

/**
 * الحد الأقصى الآمن للنقاط الإيجابية.
 *
 * زيادة النقاط جدًا لا تعني جودة أفضل،
 * وقد تسبب ارتباكًا للـDecoder.
 */
const MAXIMUM_POSITIVE_POINT_COUNT =
  12;

/**
 * الحد الأقصى الآمن للنقاط السلبية.
 */
const MAXIMUM_NEGATIVE_POINT_COUNT =
  16;

/**
 * أقصى عدد إجمالي للنقاط، دون نقطتي الـBox.
 */
const MAXIMUM_TOTAL_POINT_COUNT =
  MAXIMUM_POSITIVE_POINT_COUNT +
  MAXIMUM_NEGATIVE_POINT_COUNT;

/**
 * مسافة دنيا نسبية بين النقاط بعد تحويلها
 * إلى مساحة الصورة الأصلية.
 */
const DEFAULT_MINIMUM_NORMALIZED_POINT_DISTANCE =
  0.025;

/**
 * هامش أمان افتراضي يمنع وضع نقاط سالبة
 * فوق حدود القطعة مباشرة.
 */
const DEFAULT_BOUNDARY_SAFETY_MARGIN_RATIO =
  0.018;

/**
 * أقل مساحة مسموح بها للـBounding Box
 * كنسبة من مساحة الصورة.
 */
const MINIMUM_BOUNDING_BOX_AREA_RATIO =
  0.0025;

/**
 * أقصى مساحة مسموح بها للـBounding Box.
 *
 * نترك Margin حول الصورة بدل تغطيتها كاملة.
 */
const MAXIMUM_BOUNDING_BOX_AREA_RATIO =
  0.99;

/**
 * أقل عرض أو ارتفاع نسبي للـBounding Box.
 */
const MINIMUM_BOUNDING_BOX_DIMENSION_RATIO =
  0.025;

/**
 * الحد الأدنى لقبول تقدير الـForeground.
 */
const MINIMUM_FOREGROUND_CONFIDENCE =
  0.16;

/**
 * الحد الأدنى لقبول تحليل الخلفية.
 */
const MINIMUM_BACKGROUND_CONFIDENCE =
  0.12;

/**
 * الحد الأدنى للفرق اللوني بين Pixel
 * ومتوسط الخلفية حتى يعتبر مرشح Foreground.
 */
const MINIMUM_BACKGROUND_DISTANCE =
  0.075;

/**
 * فرق لوني قوي يشير غالبًا إلى Foreground واضح.
 */
const STRONG_BACKGROUND_DISTANCE =
  0.22;

/**
 * أقصى فرق RGB بعد التطبيع.
 */
const MAXIMUM_NORMALIZED_RGB_DISTANCE =
  Math.sqrt(
    3
  );

/**
 * قيمة صغيرة لمنع القسمة على صفر.
 */
const NUMERIC_EPSILON =
  1e-8;

/**
 * عدد قنوات RGB.
 */
const RGB_CHANNEL_COUNT =
  3;

/**
 * عدد قنوات RGBA.
 */
const RGBA_CHANNEL_COUNT =
  4;

/**
 * عدد نقاط الزوايا المستخدمة عند تقدير الخلفية.
 */
const BACKGROUND_CORNER_REGION_COUNT =
  4;

/**
 * عدد المواضع الأساسية داخل القطعة
 * قبل تطبيق Profile النوع.
 */
const BASE_FOREGROUND_GRID_SIZE =
  5;

/**
 * حد داخلي يمنع إنشاء Arrays ضخمة
 * نتيجة بيانات تالفة.
 */
const MAXIMUM_SAFE_COORDINATE_VALUES =
  64;

/**
 * النطاق الافتراضي لقيم Alpha.
 */
const MAXIMUM_ALPHA_BYTE =
  255;

/**
 * الـProgress stage index الخاص بتوليد الـPrompt.
 *
 * القيمة محلية ولا تغيّر ترتيب مراحل النظام الأساسي.
 */
const PROMPT_GENERATION_STAGE_INDEX =
  1;

/**
 * عدد مراحل PromptGenerator الداخلية.
 */
const PROMPT_GENERATION_STAGE_COUNT =
  8;

/* =========================================================
 * Core local primitive types
 * ======================================================= */

/**
 * نقطة داخل مساحة Pixel.
 *
 * الإحداثيات تبدأ من أعلى اليسار:
 *
 * x يتحرك يمينًا.
 * y يتحرك إلى أسفل.
 */
export type EdgeSamPixelPoint = {
  x: number;

  y: number;
};

/**
 * نقطة مطبّعة داخل النطاق من 0 إلى 1.
 */
export type EdgeSamNormalizedPoint = {
  x: number;

  y: number;
};

/**
 * مستطيل بصيغة:
 *
 * x = موضع اليسار
 * y = موضع الأعلى
 * width = العرض
 * height = الارتفاع
 */
export type EdgeSamPixelBounds = {
  x: number;

  y: number;

  width: number;

  height: number;
};

/**
 * مستطيل بنقاط الزوايا.
 */
export type EdgeSamCoordinateBox = {
  x1: number;

  y1: number;

  x2: number;

  y2: number;
};

/**
 * نقطة Prompt قبل تحويلها إلى Tensor.
 */
export type EdgeSamGeneratedPromptPoint = {
  x: number;

  y: number;

  label:
    | typeof NEGATIVE_POINT_LABEL
    | typeof POSITIVE_POINT_LABEL;

  kind:
    | 'positive'
    | 'negative';

  source:
    EdgeSamPromptPointSource;

  confidence: number;

  normalizedX: number;

  normalizedY: number;
};

/**
 * مصدر النقطة، مهم للـDiagnostics
 * وفهم سبب اختيار مكانها.
 */
export type EdgeSamPromptPointSource =
  | 'manual'
  | 'subject-center'
  | 'profile-anchor'
  | 'foreground-grid'
  | 'foreground-peak'
  | 'foreground-interior'
  | 'background-corner'
  | 'background-edge'
  | 'box-exterior'
  | 'boundary-protection'
  | 'fallback-center'
  | 'fallback-background';

/**
 * بيانات لون RGB مطبّعة إلى 0..1.
 */
type NormalizedRgbColor = {
  red: number;

  green: number;

  blue: number;
};

/**
 * Pixel مقروء من الصورة.
 */
type SampledPixel = NormalizedRgbColor & {
  x: number;

  y: number;

  alpha: number;

  luminance: number;
};

/**
 * نتيجة تقدير الخلفية.
 */
type BackgroundEstimate = {
  color:
    NormalizedRgbColor;

  luminance:
    number;

  confidence:
    number;

  sampleCount:
    number;

  variance:
    number;

  cornerConsistency:
    number;

  isUsable:
    boolean;
};

/**
 * نتيجة تحليل الـForeground الأولي.
 */
type ForegroundEstimate = {
  bounds:
    EdgeSamPixelBounds;

  centroid:
    EdgeSamPixelPoint;

  weightedCentroid:
    EdgeSamPixelPoint;

  confidence:
    number;

  foregroundPixelCount:
    number;

  sampledPixelCount:
    number;

  foregroundRatio:
    number;

  touchesLeft:
    boolean;

  touchesTop:
    boolean;

  touchesRight:
    boolean;

  touchesBottom:
    boolean;

  strongPoints:
    readonly EdgeSamPixelPoint[];

  interiorPoints:
    readonly EdgeSamPixelPoint[];

  warnings:
    readonly string[];
};

/**
 * نتيجة بناء نقاط Prompt داخليًا.
 */
type GeneratedPromptDraft = {
  positivePoints:
    EdgeSamGeneratedPromptPoint[];

  negativePoints:
    EdgeSamGeneratedPromptPoint[];

  boundingBox:
    EdgeSamCoordinateBox | null;

  foreground:
    ForegroundEstimate | null;

  background:
    BackgroundEstimate | null;

  confidence:
    number;

  warnings:
    string[];

  usedFallback:
    boolean;

  profileId:
    SummerClothingPromptProfileId;
};

/**
 * نتيجة التحقق من مجموعة نقاط.
 */
type PointValidationResult = {
  valid:
    boolean;

  points:
    EdgeSamGeneratedPromptPoint[];

  removedInvalidCount:
    number;

  removedDuplicateCount:
    number;

  removedOutOfBoundsCount:
    number;

  warnings:
    string[];
};

/**
 * نتيجة التحقق من Bounding Box.
 */
type BoundingBoxValidationResult = {
  valid:
    boolean;

  box:
    EdgeSamCoordinateBox | null;

  wasClamped:
    boolean;

  wasExpanded:
    boolean;

  warning:
    string | null;
};

/**
 * البيانات الداخلية اللازمة لتوليد Prompt.
 */
type PromptGenerationContext = {
  requestId:
    string;

  startedAt:
    number;

  imageWidth:
    number;

  imageHeight:
    number;

  sourceWidth:
    number;

  sourceHeight:
    number;

  rgba:
    Uint8Array | Uint8ClampedArray;

  config: EdgeSamAutomaticPromptConfig;

  profile:
    SummerClothingPromptProfile;

  transform:
    SegmentationTransform | null;

  onProgress?:
    SegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;

  warnings:
    string[];
};

/* =========================================================
 * Summer clothing profile types
 * ======================================================= */

/**
 * مجموعات الأشكال الأساسية لقطع الصيف.
 *
 * التصنيف هنا لا يستبدل تصنيف الـWardrobe.
 * هو فقط يحدد هندسة توزيع نقاط EdgeSAM.
 */
export type SummerClothingPromptFamily =
  | 'upper-body'
  | 'lower-body'
  | 'full-body'
  | 'footwear'
  | 'bag'
  | 'headwear'
  | 'small-accessory';

/**
 * اتجاه القطعة المتوقع داخل الصورة.
 */
export type SummerClothingPromptOrientation =
  | 'flat-lay'
  | 'front'
  | 'back'
  | 'side'
  | 'pair-side'
  | 'vertical'
  | 'horizontal'
  | 'unknown';

/**
 * شكل توزيع النقاط الأساسي.
 */
export type SummerClothingPointPattern =
  | 'upper-body-standard'
  | 'upper-body-wide'
  | 'upper-body-sleeveless'
  | 'lower-body-two-leg'
  | 'lower-body-short'
  | 'skirt-standard'
  | 'dress-standard'
  | 'dress-wide'
  | 'footwear-single'
  | 'footwear-pair'
  | 'bag-standard'
  | 'headwear-standard'
  | 'small-centered'
  | 'elongated-accessory';

/**
 * جميع أنواع الملابس الصيفية المدعومة
 * في PromptGenerator.
 *
 * هذه الأنواع شاملة للرجال والنساء والإكسسوارات
 * الصيفية المطلوبة للنسخة الأولى.
 */
export type SummerClothingPromptProfileId =
  | 'generic-summer-item'

  // Male and unisex upper body
  | 'tshirt-regular'
  | 'tshirt-slim'
  | 'tshirt-oversized'
  | 'polo'
  | 'shirt-short-sleeve'
  | 'shirt-long-sleeve'
  | 'tank-top'
  | 'sleeveless-top'
  | 'crop-top'
  | 'blouse'
  | 'women-top'

  // Lower body
  | 'shorts-short'
  | 'shorts-regular'
  | 'shorts-long'
  | 'shorts-wide'
  | 'pants-regular'
  | 'pants-wide'
  | 'jeans'
  | 'cargo-pants'
  | 'joggers'
  | 'leggings'

  // Skirts
  | 'skirt-mini'
  | 'skirt-midi'
  | 'skirt-maxi'
  | 'skirt-pleated'

  // Dresses
  | 'dress-mini'
  | 'dress-midi'
  | 'dress-maxi'
  | 'dress-bodycon'
  | 'dress-a-line'
  | 'dress-wide'

  // Footwear
  | 'sneakers-slim'
  | 'sneakers-regular'
  | 'sneakers-chunky'
  | 'shoes-classic'
  | 'shoes-loafer'
  | 'sandals-flat'
  | 'sandals-strap'
  | 'heels-pump'
  | 'heels-sandal'
  | 'flats'

  // Bags
  | 'backpack'
  | 'handbag'
  | 'shoulder-bag'
  | 'crossbody-bag'
  | 'tote-bag'

  // Headwear
  | 'cap'
  | 'hat'
  | 'bucket-hat'

  // Accessories
  | 'watch'
  | 'glasses'
  | 'sunglasses'
  | 'belt'
  | 'necklace'
  | 'bracelet'
  | 'scarf';

/**
 * Anchor نسبي داخل Bounding Box.
 *
 * x وy في النطاق من 0 إلى 1 بالنسبة
 * لحدود القطعة، وليس الصورة بالكامل.
 */
export type SummerClothingPromptAnchor = {
  x: number;

  y: number;

  weight: number;

  role:
    | 'core'
    | 'left-extension'
    | 'right-extension'
    | 'top-extension'
    | 'bottom-extension'
    | 'left-leg'
    | 'right-leg'
    | 'sole'
    | 'toe'
    | 'heel'
    | 'strap'
    | 'handle'
    | 'crown'
    | 'brim'
    | 'accessory-center';
};

/**
 * إعداد توزيع نقاط كل نوع قطعة.
 */
export type SummerClothingPromptProfile = {
  id:
    SummerClothingPromptProfileId;

  family:
    SummerClothingPromptFamily;

  orientation:
    SummerClothingPromptOrientation;

  pointPattern:
    SummerClothingPointPattern;

  /**
   * أسماء محتملة قادمة من:
   *
   * category
   * subCategory
   * templateId
   * selected item type
   */
  aliases:
    readonly string[];

  /**
   * النقاط الإيجابية النسبية المناسبة للقطعة.
   */
  positiveAnchors:
    readonly SummerClothingPromptAnchor[];

  /**
   * عدد النقاط الإيجابية المفضل.
   */
  preferredPositivePointCount:
    number;

  /**
   * عدد النقاط السلبية المفضل.
   */
  preferredNegativePointCount:
    number;

  /**
   * توسيع Bounding Box أفقيًا.
   */
  horizontalExpansionRatio:
    number;

  /**
   * توسيع Bounding Box رأسيًا.
   */
  verticalExpansionRatio:
    number;

  /**
   * هامش حماية إضافي حول حدود القطعة.
   */
  boundarySafetyRatio:
    number;

  /**
   * القطعة تحتوي غالبًا على منطقتين منفصلتين بصريًا،
   * مثل زوج حذاء ظاهر بجانب بعضه.
   */
  supportsSeparatedRegions:
    boolean;

  /**
   * الحفاظ على الامتدادات الرفيعة مثل:
   *
   * الأحزمة
   * أربطة الصندل
   * يد الحقيبة
   * أذرع النظارة
   */
  preserveThinStructures:
    boolean;

  /**
   * تفضيل Bounding Box كإشارة أساسية للـDecoder.
   */
  preferBoundingBox:
    boolean;

  /**
   * أقل ثقة مطلوبة لقبول التحليل التلقائي.
   */
  minimumAutomaticConfidence:
    number;
};

/* =========================================================
 * Profile anchor helpers
 * ======================================================= */

function createPromptAnchor(
  x:
    number,
  y:
    number,
  role:
    SummerClothingPromptAnchor['role'],
  weight =
    1
): SummerClothingPromptAnchor {
  return {
    x:
      clampUnitValue(
        x
      ),

    y:
      clampUnitValue(
        y
      ),

    weight:
      Math.max(
        0,
        Number.isFinite(
          weight
        )
          ? weight
          : 0
      ),

    role,
  };
}

const UPPER_BODY_STANDARD_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.45,
      'core',
      1
    ),

    createPromptAnchor(
      0.5,
      0.68,
      'core',
      0.94
    ),

    createPromptAnchor(
      0.26,
      0.34,
      'left-extension',
      0.84
    ),

    createPromptAnchor(
      0.74,
      0.34,
      'right-extension',
      0.84
    ),

    createPromptAnchor(
      0.5,
      0.2,
      'top-extension',
      0.7
    ),
  ];

const UPPER_BODY_WIDE_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.47,
      'core',
      1
    ),

    createPromptAnchor(
      0.5,
      0.7,
      'core',
      0.94
    ),

    createPromptAnchor(
      0.19,
      0.36,
      'left-extension',
      0.92
    ),

    createPromptAnchor(
      0.81,
      0.36,
      'right-extension',
      0.92
    ),

    createPromptAnchor(
      0.34,
      0.24,
      'top-extension',
      0.72
    ),

    createPromptAnchor(
      0.66,
      0.24,
      'top-extension',
      0.72
    ),
  ];

const UPPER_BODY_SLEEVELESS_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.4,
      'core',
      1
    ),

    createPromptAnchor(
      0.5,
      0.68,
      'core',
      0.96
    ),

    createPromptAnchor(
      0.36,
      0.28,
      'left-extension',
      0.75
    ),

    createPromptAnchor(
      0.64,
      0.28,
      'right-extension',
      0.75
    ),

    createPromptAnchor(
      0.5,
      0.16,
      'top-extension',
      0.66
    ),
  ];

const LOWER_BODY_TWO_LEG_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.25,
      'core',
      1
    ),

    createPromptAnchor(
      0.34,
      0.55,
      'left-leg',
      0.96
    ),

    createPromptAnchor(
      0.66,
      0.55,
      'right-leg',
      0.96
    ),

    createPromptAnchor(
      0.32,
      0.82,
      'left-leg',
      0.9
    ),

    createPromptAnchor(
      0.68,
      0.82,
      'right-leg',
      0.9
    ),
  ];

const LOWER_BODY_SHORT_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.3,
      'core',
      1
    ),

    createPromptAnchor(
      0.32,
      0.62,
      'left-leg',
      0.94
    ),

    createPromptAnchor(
      0.68,
      0.62,
      'right-leg',
      0.94
    ),

    createPromptAnchor(
      0.5,
      0.48,
      'core',
      0.82
    ),
  ];

const SKIRT_STANDARD_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.22,
      'top-extension',
      0.9
    ),

    createPromptAnchor(
      0.5,
      0.48,
      'core',
      1
    ),

    createPromptAnchor(
      0.36,
      0.72,
      'left-extension',
      0.86
    ),

    createPromptAnchor(
      0.64,
      0.72,
      'right-extension',
      0.86
    ),

    createPromptAnchor(
      0.5,
      0.84,
      'bottom-extension',
      0.76
    ),
  ];

const DRESS_STANDARD_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.15,
      'top-extension',
      0.82
    ),

    createPromptAnchor(
      0.5,
      0.35,
      'core',
      1
    ),

    createPromptAnchor(
      0.5,
      0.58,
      'core',
      0.98
    ),

    createPromptAnchor(
      0.36,
      0.8,
      'left-extension',
      0.86
    ),

    createPromptAnchor(
      0.64,
      0.8,
      'right-extension',
      0.86
    ),
  ];

const DRESS_WIDE_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.14,
      'top-extension',
      0.8
    ),

    createPromptAnchor(
      0.5,
      0.36,
      'core',
      1
    ),

    createPromptAnchor(
      0.5,
      0.58,
      'core',
      0.98
    ),

    createPromptAnchor(
      0.27,
      0.81,
      'left-extension',
      0.94
    ),

    createPromptAnchor(
      0.73,
      0.81,
      'right-extension',
      0.94
    ),

    createPromptAnchor(
      0.5,
      0.88,
      'bottom-extension',
      0.82
    ),
  ];

const FOOTWEAR_SINGLE_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.43,
      'core',
      1
    ),

    createPromptAnchor(
      0.72,
      0.46,
      'toe',
      0.96
    ),

    createPromptAnchor(
      0.27,
      0.42,
      'heel',
      0.94
    ),

    createPromptAnchor(
      0.5,
      0.61,
      'sole',
      0.88
    ),

    createPromptAnchor(
      0.5,
      0.29,
      'core',
      0.84
    ),
  ];

const FOOTWEAR_PAIR_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.28,
      0.46,
      'core',
      1
    ),

    createPromptAnchor(
      0.72,
      0.46,
      'core',
      1
    ),

    createPromptAnchor(
      0.16,
      0.48,
      'heel',
      0.82
    ),

    createPromptAnchor(
      0.84,
      0.48,
      'toe',
      0.9
    ),

    createPromptAnchor(
      0.5,
      0.72,
      'sole',
      0.86
    ),
  ];

const BAG_STANDARD_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.55,
      'core',
      1
    ),

    createPromptAnchor(
      0.3,
      0.62,
      'left-extension',
      0.88
    ),

    createPromptAnchor(
      0.7,
      0.62,
      'right-extension',
      0.88
    ),

    createPromptAnchor(
      0.5,
      0.2,
      'handle',
      0.84
    ),
  ];

const HEADWEAR_STANDARD_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.45,
      0.42,
      'crown',
      1
    ),

    createPromptAnchor(
      0.68,
      0.64,
      'brim',
      0.94
    ),

    createPromptAnchor(
      0.32,
      0.62,
      'brim',
      0.78
    ),
  ];

const SMALL_CENTERED_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.5,
      'accessory-center',
      1
    ),

    createPromptAnchor(
      0.38,
      0.5,
      'left-extension',
      0.72
    ),

    createPromptAnchor(
      0.62,
      0.5,
      'right-extension',
      0.72
    ),
  ];

const ELONGATED_ACCESSORY_ANCHORS:
  readonly SummerClothingPromptAnchor[] = [
    createPromptAnchor(
      0.5,
      0.5,
      'accessory-center',
      1
    ),

    createPromptAnchor(
      0.25,
      0.5,
      'left-extension',
      0.88
    ),

    createPromptAnchor(
      0.75,
      0.5,
      'right-extension',
      0.88
    ),

    createPromptAnchor(
      0.5,
      0.28,
      'top-extension',
      0.66
    ),

    createPromptAnchor(
      0.5,
      0.72,
      'bottom-extension',
      0.66
    ),
  ];

/* =========================================================
 * Profile factory
 * ======================================================= */

function createSummerClothingProfile(
  input: {
    id:
      SummerClothingPromptProfileId;

    family:
      SummerClothingPromptFamily;

    orientation:
      SummerClothingPromptOrientation;

    pointPattern:
      SummerClothingPointPattern;

    aliases:
      readonly string[];

    positiveAnchors:
      readonly SummerClothingPromptAnchor[];

    preferredPositivePointCount:
      number;

    preferredNegativePointCount:
      number;

    horizontalExpansionRatio:
      number;

    verticalExpansionRatio:
      number;

    boundarySafetyRatio:
      number;

    supportsSeparatedRegions?:
      boolean;

    preserveThinStructures?:
      boolean;

    preferBoundingBox?:
      boolean;

    minimumAutomaticConfidence?:
      number;
  }
): SummerClothingPromptProfile {
  return {
    id:
      input.id,

    family:
      input.family,

    orientation:
      input.orientation,

    pointPattern:
      input.pointPattern,

    aliases:
      input.aliases.map(
        alias =>
          alias
            .trim()
            .toLowerCase()
      ),

    positiveAnchors:
      input.positiveAnchors.map(
        anchor => ({
          ...anchor,
        })
      ),

    preferredPositivePointCount:
      Math.max(
        MINIMUM_POSITIVE_POINT_COUNT,
        Math.min(
          MAXIMUM_POSITIVE_POINT_COUNT,
          Math.round(
            input
              .preferredPositivePointCount
          )
        )
      ),

    preferredNegativePointCount:
      Math.max(
        0,
        Math.min(
          MAXIMUM_NEGATIVE_POINT_COUNT,
          Math.round(
            input
              .preferredNegativePointCount
          )
        )
      ),

    horizontalExpansionRatio:
      Math.max(
        0,
        Math.min(
          0.35,
          input
            .horizontalExpansionRatio
        )
      ),

    verticalExpansionRatio:
      Math.max(
        0,
        Math.min(
          0.35,
          input
            .verticalExpansionRatio
        )
      ),

    boundarySafetyRatio:
      Math.max(
        0,
        Math.min(
          0.2,
          input
            .boundarySafetyRatio
        )
      ),

    supportsSeparatedRegions:
      input
        .supportsSeparatedRegions ??
      false,

    preserveThinStructures:
      input
        .preserveThinStructures ??
      false,

    preferBoundingBox:
      input.preferBoundingBox ??
      true,

    minimumAutomaticConfidence:
      clampUnitValue(
        input
          .minimumAutomaticConfidence ??
        0.3
      ),
  };
}

/* =========================================================
 * End of Part 1.1
 * ======================================================= */
/* =========================================================
 * Summer clothing profiles registry
 * ======================================================= */

/**
 * الـProfile العام المستخدم عندما لا نستطيع
 * تحديد نوع القطعة بشكل صريح.
 */
const GENERIC_SUMMER_ITEM_PROFILE =
  createSummerClothingProfile({
    id:
      'generic-summer-item',

    family:
      'upper-body',

    orientation:
      'unknown',

    pointPattern:
      'small-centered',

    aliases: [
      'generic',
      'summer-item',
      'summer item',
      'clothing',
      'clothes',
      'garment',
      'item',
      'unknown',
    ],

    positiveAnchors:
      SMALL_CENTERED_ANCHORS,

    preferredPositivePointCount:
      3,

    preferredNegativePointCount:
      6,

    horizontalExpansionRatio:
      0.06,

    verticalExpansionRatio:
      0.06,

    boundarySafetyRatio:
      0.026,

    supportsSeparatedRegions:
      false,

    preserveThinStructures:
      false,

    preferBoundingBox:
      true,

    minimumAutomaticConfidence:
      0.26,
  });

/**
 * جميع Profiles الخاصة بقطع الصيف.
 *
 * ترتيب العناصر مهم:
 *
 * الأنواع الأكثر تحديدًا تأتي أولًا
 * حتى لا يطابق Alias عام قبل Alias أدق.
 */
export const SUMMER_CLOTHING_PROMPT_PROFILES:
  readonly SummerClothingPromptProfile[] = [
    /* =====================================================
     * Upper body
     * =================================================== */

    createSummerClothingProfile({
      id:
        'tshirt-regular',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-standard',

      aliases: [
        'tshirt-regular',
        'male-tshirt-regular',
        'female-tshirt-regular',
        'regular-tshirt',
        'regular-t-shirt',
        'regular tshirt',
        'regular t-shirt',
        'tshirt',
        't-shirt',
        'tee',
        'regular tee',
        'تيشيرت',
        'تي شيرت',
      ],

      positiveAnchors:
        UPPER_BODY_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.055,

      verticalExpansionRatio:
        0.045,

      boundarySafetyRatio:
        0.022,

      minimumAutomaticConfidence:
        0.28,
    }),

    createSummerClothingProfile({
      id:
        'tshirt-slim',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-standard',

      aliases: [
        'tshirt-slim',
        'male-tshirt-slim',
        'female-tshirt-slim',
        'slim-tshirt',
        'slim-t-shirt',
        'slim tshirt',
        'fitted-tshirt',
        'fitted tee',
        'تيشيرت سليم',
        'تيشيرت ضيق',
      ],

      positiveAnchors:
        UPPER_BODY_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.045,

      verticalExpansionRatio:
        0.042,

      boundarySafetyRatio:
        0.02,

      minimumAutomaticConfidence:
        0.3,
    }),

    createSummerClothingProfile({
      id:
        'tshirt-oversized',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-wide',

      aliases: [
        'tshirt-oversized',
        'male-tshirt-oversized',
        'female-tshirt-oversized',
        'oversized-tshirt',
        'oversized-t-shirt',
        'oversized tshirt',
        'oversize tee',
        'wide-tshirt',
        'wide tee',
        'تيشيرت اوفر سايز',
        'تيشيرت واسع',
      ],

      positiveAnchors:
        UPPER_BODY_WIDE_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.072,

      verticalExpansionRatio:
        0.05,

      boundarySafetyRatio:
        0.024,

      minimumAutomaticConfidence:
        0.28,
    }),

    createSummerClothingProfile({
      id:
        'polo',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-standard',

      aliases: [
        'polo',
        'male-polo',
        'female-polo',
        'polo-shirt',
        'polo shirt',
        'short-sleeve-polo',
        'بولو',
        'تيشيرت بولو',
      ],

      positiveAnchors:
        UPPER_BODY_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.054,

      verticalExpansionRatio:
        0.048,

      boundarySafetyRatio:
        0.023,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'shirt-short-sleeve',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-standard',

      aliases: [
        'shirt-short-sleeve',
        'male-shirt-short-sleeve',
        'female-shirt-short-sleeve',
        'short-sleeve-shirt',
        'short sleeve shirt',
        'summer-shirt',
        'summer shirt',
        'half-sleeve-shirt',
        'قميص نصف كم',
        'قميص صيفي',
      ],

      positiveAnchors:
        UPPER_BODY_STANDARD_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.06,

      verticalExpansionRatio:
        0.05,

      boundarySafetyRatio:
        0.024,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.28,
    }),

    createSummerClothingProfile({
      id:
        'shirt-long-sleeve',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-wide',

      aliases: [
        'shirt-long-sleeve',
        'male-shirt-long-sleeve',
        'female-shirt-long-sleeve',
        'long-sleeve-shirt',
        'long sleeve shirt',
        'button-shirt-long-sleeve',
        'قميص كم طويل',
        'قميص طويل',
      ],

      positiveAnchors:
        UPPER_BODY_WIDE_ANCHORS,

      preferredPositivePointCount:
        7,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.075,

      verticalExpansionRatio:
        0.052,

      boundarySafetyRatio:
        0.026,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'tank-top',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-sleeveless',

      aliases: [
        'tank-top',
        'tank top',
        'male-tank-top',
        'female-tank-top',
        'vest-top',
        'summer-vest',
        'singlet',
        'فانلة كت',
        'توب كت',
      ],

      positiveAnchors:
        UPPER_BODY_SLEEVELESS_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.047,

      verticalExpansionRatio:
        0.047,

      boundarySafetyRatio:
        0.021,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.3,
    }),

    createSummerClothingProfile({
      id:
        'sleeveless-top',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-sleeveless',

      aliases: [
        'sleeveless-top',
        'sleeveless top',
        'female-sleeveless-top',
        'women-sleeveless-top',
        'no-sleeve-top',
        'توب بدون أكمام',
        'بلوزة بدون أكمام',
      ],

      positiveAnchors:
        UPPER_BODY_SLEEVELESS_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.05,

      verticalExpansionRatio:
        0.05,

      boundarySafetyRatio:
        0.022,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.3,
    }),

    createSummerClothingProfile({
      id:
        'crop-top',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-sleeveless',

      aliases: [
        'crop-top',
        'crop top',
        'female-crop-top',
        'cropped-top',
        'cropped top',
        'short-top',
        'توب قصير',
        'كروب توب',
      ],

      positiveAnchors:
        UPPER_BODY_SLEEVELESS_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.052,

      verticalExpansionRatio:
        0.045,

      boundarySafetyRatio:
        0.021,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'blouse',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-standard',

      aliases: [
        'blouse',
        'female-blouse',
        'women-blouse',
        'summer-blouse',
        'بلوزة',
        'بلوزه',
      ],

      positiveAnchors:
        UPPER_BODY_STANDARD_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.065,

      verticalExpansionRatio:
        0.052,

      boundarySafetyRatio:
        0.024,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.28,
    }),

    createSummerClothingProfile({
      id:
        'women-top',

      family:
        'upper-body',

      orientation:
        'flat-lay',

      pointPattern:
        'upper-body-standard',

      aliases: [
        'women-top',
        'woman-top',
        'female-top',
        'female top',
        'women top',
        'ladies-top',
        'top-women',
        'توب حريمي',
        'توب نسائي',
      ],

      positiveAnchors:
        UPPER_BODY_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.058,

      verticalExpansionRatio:
        0.05,

      boundarySafetyRatio:
        0.023,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.28,
    }),

    /* =====================================================
     * Shorts
     * =================================================== */

    createSummerClothingProfile({
      id:
        'shorts-short',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-short',

      aliases: [
        'shorts-short',
        'short-shorts',
        'short shorts',
        'male-short-shorts',
        'female-short-shorts',
        'mini-shorts',
        'hot-pants',
        'شورت قصير',
      ],

      positiveAnchors:
        LOWER_BODY_SHORT_ANCHORS,

      preferredPositivePointCount:
        4,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.058,

      verticalExpansionRatio:
        0.052,

      boundarySafetyRatio:
        0.023,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'shorts-regular',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-short',

      aliases: [
        'shorts-regular',
        'regular-shorts',
        'regular shorts',
        'male-shorts',
        'female-shorts',
        'shorts',
        'summer-shorts',
        'شورت',
        'شورت عادي',
      ],

      positiveAnchors:
        LOWER_BODY_SHORT_ANCHORS,

      preferredPositivePointCount:
        4,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.06,

      verticalExpansionRatio:
        0.054,

      boundarySafetyRatio:
        0.024,

      minimumAutomaticConfidence:
        0.28,
    }),

    createSummerClothingProfile({
      id:
        'shorts-long',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-two-leg',

      aliases: [
        'shorts-long',
        'long-shorts',
        'long shorts',
        'male-long-shorts',
        'female-long-shorts',
        'bermuda-shorts',
        'bermuda',
        'knee-shorts',
        'شورت طويل',
        'برمودا',
      ],

      positiveAnchors:
        LOWER_BODY_TWO_LEG_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.06,

      verticalExpansionRatio:
        0.056,

      boundarySafetyRatio:
        0.024,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'shorts-wide',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-short',

      aliases: [
        'shorts-wide',
        'wide-shorts',
        'wide shorts',
        'loose-shorts',
        'loose shorts',
        'female-wide-shorts',
        'flowy-shorts',
        'شورت واسع',
      ],

      positiveAnchors:
        LOWER_BODY_SHORT_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.075,

      verticalExpansionRatio:
        0.056,

      boundarySafetyRatio:
        0.025,

      minimumAutomaticConfidence:
        0.28,
    }),

    /* =====================================================
     * Pants
     * =================================================== */

    createSummerClothingProfile({
      id:
        'pants-regular',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-two-leg',

      aliases: [
        'pants-regular',
        'regular-pants',
        'regular pants',
        'male-pants',
        'female-pants',
        'pants',
        'trousers',
        'بنطلون',
        'بنطلون عادي',
      ],

      positiveAnchors:
        LOWER_BODY_TWO_LEG_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.052,

      verticalExpansionRatio:
        0.046,

      boundarySafetyRatio:
        0.022,

      minimumAutomaticConfidence:
        0.3,
    }),

    createSummerClothingProfile({
      id:
        'pants-wide',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-two-leg',

      aliases: [
        'pants-wide',
        'wide-pants',
        'wide pants',
        'wide-leg-pants',
        'wide leg pants',
        'female-wide-pants',
        'palazzo',
        'palazzo-pants',
        'بنطلون واسع',
        'بالازو',
      ],

      positiveAnchors:
        LOWER_BODY_TWO_LEG_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.07,

      verticalExpansionRatio:
        0.05,

      boundarySafetyRatio:
        0.025,

      minimumAutomaticConfidence:
        0.28,
    }),

    createSummerClothingProfile({
      id:
        'jeans',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-two-leg',

      aliases: [
        'jeans',
        'male-jeans',
        'female-jeans',
        'denim',
        'denim-pants',
        'blue-jeans',
        'جينز',
        'بنطلون جينز',
      ],

      positiveAnchors:
        LOWER_BODY_TWO_LEG_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.052,

      verticalExpansionRatio:
        0.046,

      boundarySafetyRatio:
        0.022,

      minimumAutomaticConfidence:
        0.3,
    }),

    createSummerClothingProfile({
      id:
        'cargo-pants',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-two-leg',

      aliases: [
        'cargo-pants',
        'cargo pants',
        'male-cargo',
        'female-cargo',
        'cargo',
        'utility-pants',
        'بنطلون كارجو',
        'كارجو',
      ],

      positiveAnchors:
        LOWER_BODY_TWO_LEG_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.062,

      verticalExpansionRatio:
        0.05,

      boundarySafetyRatio:
        0.024,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'joggers',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-two-leg',

      aliases: [
        'joggers',
        'male-joggers',
        'female-joggers',
        'jogger-pants',
        'jogger pants',
        'sweatpants',
        'تريننج',
        'بنطلون رياضي',
      ],

      positiveAnchors:
        LOWER_BODY_TWO_LEG_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.058,

      verticalExpansionRatio:
        0.05,

      boundarySafetyRatio:
        0.023,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'leggings',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'lower-body-two-leg',

      aliases: [
        'leggings',
        'female-leggings',
        'women-leggings',
        'sport-leggings',
        'yoga-pants',
        'ليجن',
        'ليجنز',
      ],

      positiveAnchors:
        LOWER_BODY_TWO_LEG_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.044,

      verticalExpansionRatio:
        0.044,

      boundarySafetyRatio:
        0.02,

      minimumAutomaticConfidence:
        0.31,
    }),

    /* =====================================================
     * Skirts
     * =================================================== */

    createSummerClothingProfile({
      id:
        'skirt-mini',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'skirt-standard',

      aliases: [
        'skirt-mini',
        'mini-skirt',
        'mini skirt',
        'female-mini-skirt',
        'short-skirt',
        'جيبة قصيرة',
        'تنورة قصيرة',
      ],

      positiveAnchors:
        SKIRT_STANDARD_ANCHORS,

      preferredPositivePointCount:
        4,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.06,

      verticalExpansionRatio:
        0.052,

      boundarySafetyRatio:
        0.023,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'skirt-midi',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'skirt-standard',

      aliases: [
        'skirt-midi',
        'midi-skirt',
        'midi skirt',
        'female-midi-skirt',
        'medium-skirt',
        'جيبة ميدي',
        'تنورة متوسطة',
      ],

      positiveAnchors:
        SKIRT_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.062,

      verticalExpansionRatio:
        0.052,

      boundarySafetyRatio:
        0.024,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'skirt-maxi',

      family:
        'lower-body',

      orientation:
        'vertical',

      pointPattern:
        'skirt-standard',

      aliases: [
        'skirt-maxi',
        'maxi-skirt',
        'maxi skirt',
        'female-maxi-skirt',
        'long-skirt',
        'جيبة طويلة',
        'تنورة طويلة',
      ],

      positiveAnchors:
        SKIRT_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.062,

      verticalExpansionRatio:
        0.048,

      boundarySafetyRatio:
        0.024,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.3,
    }),

    createSummerClothingProfile({
      id:
        'skirt-pleated',

      family:
        'lower-body',

      orientation:
        'flat-lay',

      pointPattern:
        'skirt-standard',

      aliases: [
        'skirt-pleated',
        'pleated-skirt',
        'pleated skirt',
        'female-pleated-skirt',
        'accordion-skirt',
        'جيبة بليسيه',
        'تنورة بليسيه',
      ],

      positiveAnchors:
        SKIRT_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.07,

      verticalExpansionRatio:
        0.054,

      boundarySafetyRatio:
        0.026,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.28,
    }),

    /* =====================================================
     * Dresses
     * =================================================== */

    createSummerClothingProfile({
      id:
        'dress-mini',

      family:
        'full-body',

      orientation:
        'vertical',

      pointPattern:
        'dress-standard',

      aliases: [
        'dress-mini',
        'mini-dress',
        'mini dress',
        'female-mini-dress',
        'short-dress',
        'فستان قصير',
      ],

      positiveAnchors:
        DRESS_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.06,

      verticalExpansionRatio:
        0.048,

      boundarySafetyRatio:
        0.024,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'dress-midi',

      family:
        'full-body',

      orientation:
        'vertical',

      pointPattern:
        'dress-standard',

      aliases: [
        'dress-midi',
        'midi-dress',
        'midi dress',
        'female-midi-dress',
        'medium-dress',
        'فستان ميدي',
      ],

      positiveAnchors:
        DRESS_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.062,

      verticalExpansionRatio:
        0.048,

      boundarySafetyRatio:
        0.024,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.29,
    }),

    createSummerClothingProfile({
      id:
        'dress-maxi',

      family:
        'full-body',

      orientation:
        'vertical',

      pointPattern:
        'dress-standard',

      aliases: [
        'dress-maxi',
        'maxi-dress',
        'maxi dress',
        'female-maxi-dress',
        'long-dress',
        'فستان طويل',
        'فستان ماكسي',
      ],

      positiveAnchors:
        DRESS_STANDARD_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.064,

      verticalExpansionRatio:
        0.045,

      boundarySafetyRatio:
        0.025,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.3,
    }),

    createSummerClothingProfile({
      id:
        'dress-bodycon',

      family:
        'full-body',

      orientation:
        'vertical',

      pointPattern:
        'dress-standard',

      aliases: [
        'dress-bodycon',
        'bodycon-dress',
        'bodycon dress',
        'female-bodycon-dress',
        'fitted-dress',
        'tight-dress',
        'فستان ضيق',
        'فستان بوديكون',
      ],

      positiveAnchors:
        DRESS_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.046,

      verticalExpansionRatio:
        0.044,

      boundarySafetyRatio:
        0.021,

      minimumAutomaticConfidence:
        0.31,
    }),

    createSummerClothingProfile({
      id:
        'dress-a-line',

      family:
        'full-body',

      orientation:
        'vertical',

      pointPattern:
        'dress-wide',

      aliases: [
        'dress-a-line',
        'a-line-dress',
        'a line dress',
        'female-a-line-dress',
        'aline-dress',
        'flare-dress',
        'فستان ايه لاين',
        'فستان واسع من الأسفل',
      ],

      positiveAnchors:
        DRESS_WIDE_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.072,

      verticalExpansionRatio:
        0.05,

      boundarySafetyRatio:
        0.026,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.28,
    }),

    createSummerClothingProfile({
      id:
        'dress-wide',

      family:
        'full-body',

      orientation:
        'vertical',

      pointPattern:
        'dress-wide',

      aliases: [
        'dress-wide',
        'wide-dress',
        'wide dress',
        'female-wide-dress',
        'loose-dress',
        'flowy-dress',
        'فستان واسع',
        'فستان فضفاض',
      ],

      positiveAnchors:
        DRESS_WIDE_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.082,

      verticalExpansionRatio:
        0.052,

      boundarySafetyRatio:
        0.028,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.27,
    }),

 /* =====================================================
 * Footwear
 * =================================================== */

createSummerClothingProfile({
  id:
    'sneakers-slim',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'sneakers-slim',
    'male-sneakers-slim',
    'female-sneakers-slim',
    'slim-sneakers',
    'slim sneakers',
    'low-profile-sneakers',
    'كوتشي سليم',
    'سنيكرز سليم',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    5,

  preferredNegativePointCount:
    8,

  horizontalExpansionRatio:
    0.032,

  verticalExpansionRatio:
    0.032,

  boundarySafetyRatio:
    0.017,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.28,
}),

createSummerClothingProfile({
  id:
    'sneakers-regular',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'sneakers-regular',
    'male-sneakers',
    'female-sneakers',
    'regular-sneakers',
    'regular sneakers',
    'sneakers',
    'sneaker',
    'trainers',
    'كوتشي',
    'سنيكرز',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    5,

  preferredNegativePointCount:
    8,

  horizontalExpansionRatio:
    0.035,

  verticalExpansionRatio:
    0.035,

  boundarySafetyRatio:
    0.018,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.28,
}),

createSummerClothingProfile({
  id:
    'sneakers-chunky',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'sneakers-chunky',
    'male-sneakers-chunky',
    'female-sneakers-chunky',
    'chunky-sneakers',
    'chunky sneakers',
    'chunky-shoes',
    'thick-sole-sneakers',
    'كوتشي تشانكي',
    'سنيكرز تشانكي',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    5,

  preferredNegativePointCount:
    8,

  horizontalExpansionRatio:
    0.04,

  verticalExpansionRatio:
    0.042,

  boundarySafetyRatio:
    0.02,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.27,
}),

createSummerClothingProfile({
  id:
    'shoes-classic',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'shoes-classic',
    'male-shoes-classic',
    'female-shoes-classic',
    'classic-shoes',
    'classic shoes',
    'formal-shoes',
    'dress-shoes',
    'حذاء كلاسيك',
    'جزمة كلاسيك',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    5,

  preferredNegativePointCount:
    8,

  horizontalExpansionRatio:
    0.032,

  verticalExpansionRatio:
    0.034,

  boundarySafetyRatio:
    0.017,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.29,
}),

createSummerClothingProfile({
  id:
    'shoes-loafer',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'shoes-loafer',
    'male-shoes-loafer',
    'female-shoes-loafer',
    'loafer',
    'loafers',
    'loafer-shoes',
    'slip-on-shoes',
    'حذاء لوفر',
    'لوفر',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    5,

  preferredNegativePointCount:
    8,

  horizontalExpansionRatio:
    0.032,

  verticalExpansionRatio:
    0.034,

  boundarySafetyRatio:
    0.017,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.29,
}),

createSummerClothingProfile({
  id:
    'sandals-flat',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'sandals-flat',
    'flat-sandals',
    'flat sandals',
    'female-flat-sandals',
    'male-flat-sandals',
    'summer-sandals',
    'صندل مسطح',
    'صندل',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    6,

  preferredNegativePointCount:
    9,

  horizontalExpansionRatio:
    0.038,

  verticalExpansionRatio:
    0.04,

  boundarySafetyRatio:
    0.02,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.27,
}),

createSummerClothingProfile({
  id:
    'sandals-strap',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'sandals-strap',
    'strap-sandals',
    'strappy-sandals',
    'strappy sandals',
    'female-strap-sandals',
    'sandals-with-straps',
    'صندل بأربطة',
    'صندل حزام',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    6,

  preferredNegativePointCount:
    9,

  horizontalExpansionRatio:
    0.04,

  verticalExpansionRatio:
    0.042,

  boundarySafetyRatio:
    0.021,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.26,
}),

createSummerClothingProfile({
  id:
    'heels-pump',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'heels-pump',
    'pump-heels',
    'pump heels',
    'female-pump-heels',
    'high-heels',
    'high heels',
    'pumps',
    'كعب عالي',
    'حذاء بكعب',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    6,

  preferredNegativePointCount:
    9,

  horizontalExpansionRatio:
    0.038,

  verticalExpansionRatio:
    0.045,

  boundarySafetyRatio:
    0.021,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.27,
}),

createSummerClothingProfile({
  id:
    'heels-sandal',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'heels-sandal',
    'heel-sandals',
    'heeled-sandals',
    'heeled sandals',
    'female-heel-sandals',
    'strappy-heels',
    'صندل بكعب',
    'كعب بصندل',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    6,

  preferredNegativePointCount:
    9,

  horizontalExpansionRatio:
    0.042,

  verticalExpansionRatio:
    0.048,

  boundarySafetyRatio:
    0.022,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.25,
}),

createSummerClothingProfile({
  id:
    'flats',

  family:
    'footwear',

  orientation:
    'side',

  pointPattern:
    'footwear-single',

  aliases: [
    'flats',
    'female-flats',
    'flat-shoes',
    'flat shoes',
    'ballet-flats',
    'ballet flats',
    'حذاء فلات',
    'فلات',
  ],

  positiveAnchors:
    FOOTWEAR_SINGLE_ANCHORS,

  preferredPositivePointCount:
    5,

  preferredNegativePointCount:
    8,

  horizontalExpansionRatio:
    0.034,

  verticalExpansionRatio:
    0.036,

  boundarySafetyRatio:
    0.018,

  supportsSeparatedRegions:
    false,

  preserveThinStructures:
    true,

  minimumAutomaticConfidence:
    0.28,
}),

    /* =====================================================
     * Bags
     * =================================================== */

    createSummerClothingProfile({
      id:
        'backpack',

      family:
        'bag',

      orientation:
        'front',

      pointPattern:
        'bag-standard',

      aliases: [
        'backpack',
        'male-backpack',
        'female-backpack',
        'rucksack',
        'school-backpack',
        'شنطة ظهر',
        'حقيبة ظهر',
      ],

      positiveAnchors:
        BAG_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.065,

      verticalExpansionRatio:
        0.065,

      boundarySafetyRatio:
        0.028,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.27,
    }),

    createSummerClothingProfile({
      id:
        'handbag',

      family:
        'bag',

      orientation:
        'front',

      pointPattern:
        'bag-standard',

      aliases: [
        'handbag',
        'female-handbag',
        'women-handbag',
        'purse',
        'ladies-bag',
        'شنطة يد',
        'حقيبة يد',
      ],

      positiveAnchors:
        BAG_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.068,

      verticalExpansionRatio:
        0.072,

      boundarySafetyRatio:
        0.03,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.27,
    }),

    createSummerClothingProfile({
      id:
        'shoulder-bag',

      family:
        'bag',

      orientation:
        'front',

      pointPattern:
        'bag-standard',

      aliases: [
        'shoulder-bag',
        'shoulder bag',
        'female-shoulder-bag',
        'women-shoulder-bag',
        'شنطة كتف',
        'حقيبة كتف',
      ],

      positiveAnchors:
        BAG_STANDARD_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.07,

      verticalExpansionRatio:
        0.08,

      boundarySafetyRatio:
        0.032,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.26,
    }),

    createSummerClothingProfile({
      id:
        'crossbody-bag',

      family:
        'bag',

      orientation:
        'front',

      pointPattern:
        'bag-standard',

      aliases: [
        'crossbody-bag',
        'crossbody bag',
        'female-crossbody-bag',
        'male-crossbody-bag',
        'side-bag',
        'messenger-bag',
        'شنطة كروس',
        'حقيبة كروس',
      ],

      positiveAnchors:
        BAG_STANDARD_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.075,

      verticalExpansionRatio:
        0.085,

      boundarySafetyRatio:
        0.034,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.25,
    }),

    createSummerClothingProfile({
      id:
        'tote-bag',

      family:
        'bag',

      orientation:
        'front',

      pointPattern:
        'bag-standard',

      aliases: [
        'tote-bag',
        'tote bag',
        'female-tote-bag',
        'canvas-tote',
        'shopping-bag',
        'شنطة توت',
        'شنطة كبيرة',
      ],

      positiveAnchors:
        BAG_STANDARD_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.072,

      verticalExpansionRatio:
        0.078,

      boundarySafetyRatio:
        0.031,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.27,
    }),

    /* =====================================================
     * Headwear
     * =================================================== */

    createSummerClothingProfile({
      id:
        'cap',

      family:
        'headwear',

      orientation:
        'side',

      pointPattern:
        'headwear-standard',

      aliases: [
        'cap',
        'male-cap',
        'female-cap',
        'baseball-cap',
        'baseball cap',
        'summer-cap',
        'كاب',
        'قبعة كاب',
      ],

      positiveAnchors:
        HEADWEAR_STANDARD_ANCHORS,

      preferredPositivePointCount:
        4,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.075,

      verticalExpansionRatio:
        0.07,

      boundarySafetyRatio:
        0.028,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.28,
    }),

    createSummerClothingProfile({
      id:
        'hat',

      family:
        'headwear',

      orientation:
        'front',

      pointPattern:
        'headwear-standard',

      aliases: [
        'hat',
        'male-hat',
        'female-hat',
        'summer-hat',
        'sun-hat',
        'sun hat',
        'قبعة',
        'قبعة شمس',
      ],

      positiveAnchors:
        HEADWEAR_STANDARD_ANCHORS,

      preferredPositivePointCount:
        4,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.085,

      verticalExpansionRatio:
        0.075,

      boundarySafetyRatio:
        0.03,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.27,
    }),

    createSummerClothingProfile({
      id:
        'bucket-hat',

      family:
        'headwear',

      orientation:
        'front',

      pointPattern:
        'headwear-standard',

      aliases: [
        'bucket-hat',
        'bucket hat',
        'male-bucket-hat',
        'female-bucket-hat',
        'fisherman-hat',
        'قبعة باكيت',
        'باكيت هات',
      ],

      positiveAnchors:
        HEADWEAR_STANDARD_ANCHORS,

      preferredPositivePointCount:
        4,

      preferredNegativePointCount:
        7,

      horizontalExpansionRatio:
        0.08,

      verticalExpansionRatio:
        0.074,

      boundarySafetyRatio:
        0.029,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.28,
    }),

    /* =====================================================
     * Small accessories
     * =================================================== */

    createSummerClothingProfile({
      id:
        'watch',

      family:
        'small-accessory',

      orientation:
        'horizontal',

      pointPattern:
        'elongated-accessory',

      aliases: [
        'watch',
        'male-watch',
        'female-watch',
        'wrist-watch',
        'wristwatch',
        'ساعة',
        'ساعة يد',
      ],

      positiveAnchors:
        ELONGATED_ACCESSORY_ANCHORS,

      preferredPositivePointCount:
        5,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.08,

      verticalExpansionRatio:
        0.08,

      boundarySafetyRatio:
        0.035,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.26,
    }),

    createSummerClothingProfile({
      id:
        'glasses',

      family:
        'small-accessory',

      orientation:
        'horizontal',

      pointPattern:
        'elongated-accessory',

      aliases: [
        'glasses',
        'eyeglasses',
        'eye-glasses',
        'optical-glasses',
        'spectacles',
        'نظارة',
        'نظارة نظر',
      ],

      positiveAnchors:
        ELONGATED_ACCESSORY_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.09,

      verticalExpansionRatio:
        0.09,

      boundarySafetyRatio:
        0.04,

      supportsSeparatedRegions:
        true,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.24,
    }),

    createSummerClothingProfile({
      id:
        'sunglasses',

      family:
        'small-accessory',

      orientation:
        'horizontal',

      pointPattern:
        'elongated-accessory',

      aliases: [
        'sunglasses',
        'sun-glasses',
        'male-sunglasses',
        'female-sunglasses',
        'shades',
        'نظارة شمس',
        'نظارة شمسية',
      ],

      positiveAnchors:
        ELONGATED_ACCESSORY_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.09,

      verticalExpansionRatio:
        0.09,

      boundarySafetyRatio:
        0.04,

      supportsSeparatedRegions:
        true,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.24,
    }),

    createSummerClothingProfile({
      id:
        'belt',

      family:
        'small-accessory',

      orientation:
        'horizontal',

      pointPattern:
        'elongated-accessory',

      aliases: [
        'belt',
        'male-belt',
        'female-belt',
        'waist-belt',
        'leather-belt',
        'حزام',
        'حزام وسط',
      ],

      positiveAnchors:
        ELONGATED_ACCESSORY_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.08,

      verticalExpansionRatio:
        0.1,

      boundarySafetyRatio:
        0.04,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.24,
    }),

    createSummerClothingProfile({
      id:
        'necklace',

      family:
        'small-accessory',

      orientation:
        'vertical',

      pointPattern:
        'elongated-accessory',

      aliases: [
        'necklace',
        'female-necklace',
        'male-necklace',
        'chain',
        'pendant-necklace',
        'عقد',
        'سلسلة',
      ],

      positiveAnchors:
        ELONGATED_ACCESSORY_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.1,

      verticalExpansionRatio:
        0.1,

      boundarySafetyRatio:
        0.045,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.22,
    }),

    createSummerClothingProfile({
      id:
        'bracelet',

      family:
        'small-accessory',

      orientation:
        'unknown',

      pointPattern:
        'small-centered',

      aliases: [
        'bracelet',
        'female-bracelet',
        'male-bracelet',
        'bangle',
        'wrist-bracelet',
        'سوار',
        'أسورة',
      ],

      positiveAnchors:
        SMALL_CENTERED_ANCHORS,

      preferredPositivePointCount:
        4,

      preferredNegativePointCount:
        8,

      horizontalExpansionRatio:
        0.1,

      verticalExpansionRatio:
        0.1,

      boundarySafetyRatio:
        0.042,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.23,
    }),

    createSummerClothingProfile({
      id:
        'scarf',

      family:
        'small-accessory',

      orientation:
        'vertical',

      pointPattern:
        'elongated-accessory',

      aliases: [
        'scarf',
        'male-scarf',
        'female-scarf',
        'summer-scarf',
        'neck-scarf',
        'وشاح',
        'سكارف',
      ],

      positiveAnchors:
        ELONGATED_ACCESSORY_ANCHORS,

      preferredPositivePointCount:
        6,

      preferredNegativePointCount:
        9,

      horizontalExpansionRatio:
        0.085,

      verticalExpansionRatio:
        0.085,

      boundarySafetyRatio:
        0.036,

      preserveThinStructures:
        true,

      minimumAutomaticConfidence:
        0.25,
    }),
  ];

/* =========================================================
 * Profile lookup tables
 * ======================================================= */

/**
 * Map مباشر للوصول إلى Profile باستخدام الـID.
 */
const SUMMER_PROFILE_BY_ID =
  new Map<
    SummerClothingPromptProfileId,
    SummerClothingPromptProfile
  >();

/**
 * Map للوصول إلى Profile باستخدام Alias طبيعي.
 */
const SUMMER_PROFILE_BY_ALIAS =
  new Map<
    string,
    SummerClothingPromptProfile
  >();

/**
 * تحويل النص إلى صيغة موحدة للبحث.
 */
function normalizeProfileLookupValue(
  value:
    string
): string {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /[_\s]+/g,
      '-'
    )
    .replace(
      /-+/g,
      '-'
    )
    .replace(
      /^-+|-+$/g,
      ''
    );
}

/**
 * تسجيل Profile داخل جداول البحث.
 */
function registerSummerClothingProfile(
  profile:
    SummerClothingPromptProfile
): void {
  SUMMER_PROFILE_BY_ID.set(
    profile.id,
    profile
  );

  const lookupValues =
    new Set<string>([
      profile.id,
      ...profile.aliases,
    ]);

  for (
    const rawValue
    of lookupValues
  ) {
    const normalizedValue =
      normalizeProfileLookupValue(
        rawValue
      );

    if (
      normalizedValue.length ===
      0
    ) {
      continue;
    }

    if (
      !SUMMER_PROFILE_BY_ALIAS.has(
        normalizedValue
      )
    ) {
      SUMMER_PROFILE_BY_ALIAS.set(
        normalizedValue,
        profile
      );
    }

    /**
     * نخزن أيضًا نسخة بدون الشرطات
     * لالتقاط أسماء مثل:
     *
     * maleTshirtRegular
     * tshirtregular
     */
    const compactValue =
      normalizedValue.replace(
        /-/g,
        ''
      );

    if (
      compactValue.length >
        0 &&
      !SUMMER_PROFILE_BY_ALIAS.has(
        compactValue
      )
    ) {
      SUMMER_PROFILE_BY_ALIAS.set(
        compactValue,
        profile
      );
    }
  }
}

registerSummerClothingProfile(
  GENERIC_SUMMER_ITEM_PROFILE
);

for (
  const profile
  of SUMMER_CLOTHING_PROMPT_PROFILES
) {
  registerSummerClothingProfile(
    profile
  );
}

/* =========================================================
 * Public profile access helpers
 * ======================================================= */

/**
 * إرجاع نسخة آمنة من Profile.
 *
 * الهدف منع أي كود خارجي من تعديل Registry الأصلي.
 */
export function cloneSummerClothingPromptProfile(
  profile:
    SummerClothingPromptProfile
): SummerClothingPromptProfile {
  return {
    ...profile,

    aliases:
      [...profile.aliases],

    positiveAnchors:
      profile
        .positiveAnchors
        .map(
          anchor => ({
            ...anchor,
          })
        ),
  };
}

/**
 * الحصول على Profile باستخدام ID صريح.
 */
export function getSummerClothingPromptProfileById(
  profileId:
    SummerClothingPromptProfileId
): SummerClothingPromptProfile {
  const profile =
    SUMMER_PROFILE_BY_ID.get(
      profileId
    );

  return cloneSummerClothingPromptProfile(
    profile ??
    GENERIC_SUMMER_ITEM_PROFILE
  );
}

/**
 * محاولة الحصول على Profile باستخدام:
 *
 * ID
 * Alias
 * Template ID
 * Category
 * Subcategory
 */
export function tryResolveSummerClothingPromptProfile(
  value:
    string | null | undefined
): SummerClothingPromptProfile | null {
  if (
    typeof value !==
      'string' ||
    value.trim().length ===
      0
  ) {
    return null;
  }

  const normalizedValue =
    normalizeProfileLookupValue(
      value
    );

  const directProfile =
    SUMMER_PROFILE_BY_ALIAS.get(
      normalizedValue
    );

  if (
    directProfile
  ) {
    return cloneSummerClothingPromptProfile(
      directProfile
    );
  }

  const compactValue =
    normalizedValue.replace(
      /-/g,
      ''
    );

  const compactProfile =
    SUMMER_PROFILE_BY_ALIAS.get(
      compactValue
    );

  if (
    compactProfile
  ) {
    return cloneSummerClothingPromptProfile(
      compactProfile
    );
  }

  /**
   * بعض القيم قد تحتوي Prefix أو Suffix إضافيًا:
   *
   * template-male-tshirt-regular
   * scan-female-dress-maxi-mask
   *
   * نبحث حينها عن أطول Alias مطابق داخل النص.
   */
  let bestProfile:
    SummerClothingPromptProfile | null =
      null;

  let bestMatchLength =
    0;

  for (
    const [
      alias,
      profile,
    ]
    of SUMMER_PROFILE_BY_ALIAS
  ) {
    if (
      alias.length <=
        bestMatchLength ||
      alias.length <
        4
    ) {
      continue;
    }

    if (
      normalizedValue.includes(
        alias
      ) ||
      compactValue.includes(
        alias.replace(
          /-/g,
          ''
        )
      )
    ) {
      bestProfile =
        profile;

      bestMatchLength =
        alias.length;
    }
  }

  if (
    bestProfile
  ) {
    return cloneSummerClothingPromptProfile(
      bestProfile
    );
  }

  return null;
}

/**
 * Resolver متعدد القيم.
 *
 * يفضّل القيم بالترتيب:
 *
 * profileId
 * templateId
 * subCategory
 * category
 * itemType
 */
export function resolveSummerClothingPromptProfile(
  values?: {
    profileId?:
      SummerClothingPromptProfileId | null;

    templateId?:
      string | null;

    subCategory?:
      string | null;

    category?:
      string | null;

    itemType?:
      string | null;
  }
): SummerClothingPromptProfile {
  if (
    values?.profileId
  ) {
    const explicitProfile =
      SUMMER_PROFILE_BY_ID.get(
        values.profileId
      );

    if (
      explicitProfile
    ) {
      return cloneSummerClothingPromptProfile(
        explicitProfile
      );
    }
  }

  const candidates:
    readonly (
      string | null | undefined
    )[] = [
      values?.templateId,
      values?.subCategory,
      values?.itemType,
      values?.category,
    ];

  for (
    const candidate
    of candidates
  ) {
    const resolved =
      tryResolveSummerClothingPromptProfile(
        candidate
      );

    if (
      resolved
    ) {
      return resolved;
    }
  }

  return cloneSummerClothingPromptProfile(
    GENERIC_SUMMER_ITEM_PROFILE
  );
}

/**
 * إرجاع جميع Profiles كنسخ مستقلة.
 */
export function getAllSummerClothingPromptProfiles():
  readonly SummerClothingPromptProfile[] {
  return [
    cloneSummerClothingPromptProfile(
      GENERIC_SUMMER_ITEM_PROFILE
    ),

    ...SUMMER_CLOTHING_PROMPT_PROFILES
      .map(
        cloneSummerClothingPromptProfile
      ),
  ];
}

/**
 * إرجاع Profiles عائلة معينة.
 */
export function getSummerClothingPromptProfilesByFamily(
  family:
    SummerClothingPromptFamily
): readonly SummerClothingPromptProfile[] {
  return SUMMER_CLOTHING_PROMPT_PROFILES
    .filter(
      profile =>
        profile.family ===
        family
    )
    .map(
      cloneSummerClothingPromptProfile
    );
}

/**
 * التحقق أن القيمة ID صالح.
 */
export function isSummerClothingPromptProfileId(
  value:
    unknown
): value is SummerClothingPromptProfileId {
  return (
    typeof value ===
      'string' &&
    SUMMER_PROFILE_BY_ID.has(
      value as
        SummerClothingPromptProfileId
    )
  );
}

/* =========================================================
 * Profile registry validation
 * ======================================================= */

type SummerProfileRegistryValidationResult = {
  valid:
    boolean;

  errors:
    readonly string[];

  warnings:
    readonly string[];

  profileCount:
    number;

  aliasCount:
    number;
};

/**
 * التحقق من سلامة Profile واحد.
 */
function validateSummerClothingPromptProfile(
  profile:
    SummerClothingPromptProfile
): {
  errors:
    string[];

  warnings:
    string[];
} {
  const errors:
    string[] = [];

  const warnings:
    string[] = [];

  if (
    profile.id.trim().length ===
    0
  ) {
    errors.push(
      'Summer clothing profile id cannot be empty.'
    );
  }

  if (
    profile.aliases.length ===
    0
  ) {
    warnings.push(
      `Profile "${profile.id}" has no aliases.`
    );
  }

  if (
    profile.positiveAnchors.length ===
    0
  ) {
    errors.push(
      `Profile "${profile.id}" must contain at least one positive anchor.`
    );
  }

  if (
    profile.preferredPositivePointCount <
      MINIMUM_POSITIVE_POINT_COUNT ||
    profile.preferredPositivePointCount >
      MAXIMUM_POSITIVE_POINT_COUNT
  ) {
    errors.push(
      `Profile "${profile.id}" has an invalid preferred positive point count.`
    );
  }

  if (
    profile.preferredNegativePointCount <
      0 ||
    profile.preferredNegativePointCount >
      MAXIMUM_NEGATIVE_POINT_COUNT
  ) {
    errors.push(
      `Profile "${profile.id}" has an invalid preferred negative point count.`
    );
  }

  if (
    !Number.isFinite(
      profile.horizontalExpansionRatio
    ) ||
    profile.horizontalExpansionRatio <
      0 ||
    profile.horizontalExpansionRatio >
      0.35
  ) {
    errors.push(
      `Profile "${profile.id}" has an invalid horizontal expansion ratio.`
    );
  }

  if (
    !Number.isFinite(
      profile.verticalExpansionRatio
    ) ||
    profile.verticalExpansionRatio <
      0 ||
    profile.verticalExpansionRatio >
      0.35
  ) {
    errors.push(
      `Profile "${profile.id}" has an invalid vertical expansion ratio.`
    );
  }

  if (
    !Number.isFinite(
      profile.boundarySafetyRatio
    ) ||
    profile.boundarySafetyRatio <
      0 ||
    profile.boundarySafetyRatio >
      0.2
  ) {
    errors.push(
      `Profile "${profile.id}" has an invalid boundary safety ratio.`
    );
  }

  if (
    !Number.isFinite(
      profile.minimumAutomaticConfidence
    ) ||
    profile.minimumAutomaticConfidence <
      0 ||
    profile.minimumAutomaticConfidence >
      1
  ) {
    errors.push(
      `Profile "${profile.id}" has an invalid automatic confidence threshold.`
    );
  }

  for (
    let index = 0;
    index <
      profile
        .positiveAnchors
        .length;
    index +=
      1
  ) {
    const anchor =
      profile
        .positiveAnchors[
        index
      ];

    if (
      !Number.isFinite(
        anchor.x
      ) ||
      !Number.isFinite(
        anchor.y
      ) ||
      anchor.x <
        0 ||
      anchor.x >
        1 ||
      anchor.y <
        0 ||
      anchor.y >
        1
    ) {
      errors.push(
        `Profile "${profile.id}" contains an invalid anchor at index ${index}.`
      );
    }

    if (
      !Number.isFinite(
        anchor.weight
      ) ||
      anchor.weight <
        0
    ) {
      errors.push(
        `Profile "${profile.id}" contains an invalid anchor weight at index ${index}.`
      );
    }
  }

  return {
    errors,
    warnings,
  };
}

/**
 * فحص الـRegistry بالكامل.
 */
export function validateSummerClothingPromptProfileRegistry():
  SummerProfileRegistryValidationResult {
  const errors:
    string[] = [];

  const warnings:
    string[] = [];

  const usedIds =
    new Set<string>();

  const usedAliases =
    new Map<
      string,
      string
    >();

  const profiles = [
    GENERIC_SUMMER_ITEM_PROFILE,
    ...SUMMER_CLOTHING_PROMPT_PROFILES,
  ];

  for (
    const profile
    of profiles
  ) {
    if (
      usedIds.has(
        profile.id
      )
    ) {
      errors.push(
        `Duplicate summer clothing profile id: "${profile.id}".`
      );
    } else {
      usedIds.add(
        profile.id
      );
    }

    const profileValidation =
      validateSummerClothingPromptProfile(
        profile
      );

    errors.push(
      ...profileValidation
        .errors
    );

    warnings.push(
      ...profileValidation
        .warnings
    );

    const aliases = [
      profile.id,
      ...profile.aliases,
    ];

    for (
      const rawAlias
      of aliases
    ) {
      const normalizedAlias =
        normalizeProfileLookupValue(
          rawAlias
        );

      if (
        normalizedAlias.length ===
        0
      ) {
        warnings.push(
          `Profile "${profile.id}" contains an empty alias.`
        );

        continue;
      }

      const existingProfileId =
        usedAliases.get(
          normalizedAlias
        );

      if (
        existingProfileId &&
        existingProfileId !==
          profile.id
      ) {
        warnings.push(
          `Alias "${normalizedAlias}" is shared by profiles "${existingProfileId}" and "${profile.id}".`
        );

        continue;
      }

      usedAliases.set(
        normalizedAlias,
        profile.id
      );
    }
  }

  return {
    valid:
      errors.length ===
      0,

    errors,

    warnings,

    profileCount:
      profiles.length,

    aliasCount:
      usedAliases.size,
  };
}

/* =========================================================
 * Registry initialization guard
 * ======================================================= */

const SUMMER_PROFILE_REGISTRY_VALIDATION =
  validateSummerClothingPromptProfileRegistry();

if (
  !SUMMER_PROFILE_REGISTRY_VALIDATION.valid
) {
  throw new Error(
    [
      'Invalid Summer Clothing Prompt Profile Registry.',
      ...SUMMER_PROFILE_REGISTRY_VALIDATION
        .errors,
    ].join(
      '\n'
    )
  );
}

/* =========================================================
 * End of Part 1.2
 * ======================================================= */
/* =========================================================
 * Numeric helpers
 * ======================================================= */

/**
 * قفل قيمة رقمية داخل نطاق محدد.
 */
function clampNumber(
  value:
    number,
  minimum:
    number,
  maximum:
    number
): number {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return minimum;
  }

  if (
    value <
      minimum
  ) {
    return minimum;
  }

  if (
    value >
      maximum
  ) {
    return maximum;
  }

  return value;
}

/**
 * قفل قيمة داخل نطاق 0..1.
 */
function clampNormalizedValue(
  value:
    number
): number {
  return clampNumber(
    value,
    0,
    1
  );
}

/**
 * تحويل قيمة إلى عدد صحيح آمن.
 */
function toSafeInteger(
  value:
    number,
  fallback =
    0
): number {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return fallback;
  }

  return Math.trunc(
    value
  );
}

/**
 * تحويل قيمة إلى عدد صحيح موجب.
 */
function toSafePositiveInteger(
  value:
    number,
  fallback =
    1
): number {
  const integerValue =
    toSafeInteger(
      value,
      fallback
    );

  return Math.max(
    1,
    integerValue
  );
}

/**
 * المقارنة التقريبية بين رقمين.
 */
function areNumbersApproximatelyEqual(
  first:
    number,
  second:
    number,
  epsilon =
    NUMERIC_EPSILON
): boolean {
  return (
    Math.abs(
      first -
      second
    ) <=
    Math.max(
      NUMERIC_EPSILON,
      epsilon
    )
  );
}

/**
 * قسمة آمنة.
 */
function safeDivide(
  numerator:
    number,
  denominator:
    number,
  fallback =
    0
): number {
  if (
    !Number.isFinite(
      numerator
    ) ||
    !Number.isFinite(
      denominator
    ) ||
    Math.abs(
      denominator
    ) <=
      NUMERIC_EPSILON
  ) {
    return fallback;
  }

  const result =
    numerator /
    denominator;

  return Number.isFinite(
    result
  )
    ? result
    : fallback;
}

/**
 * Linear interpolation.
 */
function interpolateNumber(
  start:
    number,
  end:
    number,
  ratio:
    number
): number {
  const normalizedRatio =
    clampNormalizedValue(
      ratio
    );

  return (
    start +
    (
      end -
      start
    ) *
      normalizedRatio
  );
}

/**
 * تحويل نسبة من مجال إلى مجال آخر.
 */
function remapNumber(
  value:
    number,
  inputMinimum:
    number,
  inputMaximum:
    number,
  outputMinimum:
    number,
  outputMaximum:
    number
): number {
  const inputRange =
    inputMaximum -
    inputMinimum;

  if (
    Math.abs(
      inputRange
    ) <=
    NUMERIC_EPSILON
  ) {
    return outputMinimum;
  }

  const ratio =
    clampNormalizedValue(
      (
        value -
        inputMinimum
      ) /
        inputRange
    );

  return interpolateNumber(
    outputMinimum,
    outputMaximum,
    ratio
  );
}

/**
 * حساب المتوسط.
 */
function calculateAverage(
  values:
    readonly number[]
): number {
  if (
    values.length ===
    0
  ) {
    return 0;
  }

  let sum =
    0;

  let validCount =
    0;

  for (
    const value
    of values
  ) {
    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

    sum +=
      value;

    validCount +=
      1;
  }

  return validCount >
    0
    ? sum /
        validCount
    : 0;
}

/**
 * حساب الـVariance.
 */
function calculateVariance(
  values:
    readonly number[],
  knownAverage?:
    number
): number {
  if (
    values.length <
    2
  ) {
    return 0;
  }

  const average =
    Number.isFinite(
      knownAverage
    )
      ? (
          knownAverage as number
        )
      : calculateAverage(
          values
        );

  let squaredDifferenceSum =
    0;

  let validCount =
    0;

  for (
    const value
    of values
  ) {
    if (
      !Number.isFinite(
        value
      )
    ) {
      continue;
    }

    const difference =
      value -
      average;

    squaredDifferenceSum +=
      difference *
      difference;

    validCount +=
      1;
  }

  return validCount >
    1
    ? squaredDifferenceSum /
        validCount
    : 0;
}

/**
 * حساب الانحراف المعياري.
 */
function calculateStandardDeviation(
  values:
    readonly number[],
  knownAverage?:
    number
): number {
  return Math.sqrt(
    Math.max(
      0,
      calculateVariance(
        values,
        knownAverage
      )
    )
  );
}

/**
 * حساب Median بدون تعديل الـArray الأصلي.
 */
function calculateMedian(
  values:
    readonly number[]
): number {
  const sortedValues =
    values
      .filter(
        Number.isFinite
      )
      .slice()
      .sort(
        (
          first,
          second
        ) =>
          first -
          second
      );

  if (
    sortedValues.length ===
    0
  ) {
    return 0;
  }

  const middleIndex =
    Math.floor(
      sortedValues.length /
        2
    );

  if (
    sortedValues.length %
      2 ===
    1
  ) {
    return sortedValues[
      middleIndex
    ];
  }

  return (
    sortedValues[
      middleIndex -
      1
    ] +
    sortedValues[
      middleIndex
    ]
  ) /
    2;
}

/**
 * حساب قيمة Percentile.
 */
function calculatePercentile(
  values:
    readonly number[],
  percentile:
    number
): number {
  const sortedValues =
    values
      .filter(
        Number.isFinite
      )
      .slice()
      .sort(
        (
          first,
          second
        ) =>
          first -
          second
      );

  if (
    sortedValues.length ===
    0
  ) {
    return 0;
  }

  if (
    sortedValues.length ===
    1
  ) {
    return sortedValues[
      0
    ];
  }

  const normalizedPercentile =
    clampNormalizedValue(
      percentile
    );

  const exactIndex =
    normalizedPercentile *
    (
      sortedValues.length -
      1
    );

  const lowerIndex =
    Math.floor(
      exactIndex
    );

  const upperIndex =
    Math.ceil(
      exactIndex
    );

  if (
    lowerIndex ===
    upperIndex
  ) {
    return sortedValues[
      lowerIndex
    ];
  }

  return interpolateNumber(
    sortedValues[
      lowerIndex
    ],
    sortedValues[
      upperIndex
    ],
    exactIndex -
      lowerIndex
  );
}

/* =========================================================
 * General validation helpers
 * ======================================================= */

/**
 * التحقق من أن القيمة رقم حقيقي.
 */
function isFiniteNumber(
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
 * التحقق من أبعاد الصورة.
 */
function areValidImageDimensions(
  width:
    unknown,
  height:
    unknown
): width is number {
  return (
    isFiniteNumber(
      width
    ) &&
    isFiniteNumber(
      height
    ) &&
    width >=
      MINIMUM_IMAGE_DIMENSION &&
    height >=
      MINIMUM_IMAGE_DIMENSION &&
    width <=
      MAXIMUM_IMAGE_DIMENSION &&
    height <=
      MAXIMUM_IMAGE_DIMENSION
  );
}

/**
 * التحقق من أن حاصل ضرب الأبعاد آمن.
 */
function isSafePixelCount(
  width:
    number,
  height:
    number
): boolean {
  if (
    !Number.isSafeInteger(
      width
    ) ||
    !Number.isSafeInteger(
      height
    ) ||
    width <=
      0 ||
    height <=
      0
  ) {
    return false;
  }

  const pixelCount =
    width *
    height;

  return (
    Number.isSafeInteger(
      pixelCount
    ) &&
    pixelCount >
      0 &&
    pixelCount <=
      MAXIMUM_IMAGE_DIMENSION *
      MAXIMUM_IMAGE_DIMENSION
  );
}

/**
 * تحديد عدد قنوات بيانات الصورة.
 */
function resolveImageChannelCount(
  dataLength:
    number,
  width:
    number,
  height:
    number
): number | null {
  if (
    !isSafePixelCount(
      width,
      height
    )
  ) {
    return null;
  }

  const pixelCount =
    width *
    height;

  if (
    dataLength ===
    pixelCount *
      RGBA_CHANNEL_COUNT
  ) {
    return RGBA_CHANNEL_COUNT;
  }

  if (
    dataLength ===
    pixelCount *
      RGB_CHANNEL_COUNT
  ) {
    return RGB_CHANNEL_COUNT;
  }

  return null;
}

/**
 * التحقق من بيانات RGB أو RGBA.
 */
function validateRawImageData(
  data:
    Uint8Array | Uint8ClampedArray,
  width:
    number,
  height:
    number
): {
  channelCount:
    number;

  pixelCount:
    number;
} {
  if (
    !(
      data instanceof
        Uint8Array ||
      data instanceof
        Uint8ClampedArray
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'PromptGenerator expected RGB or RGBA byte data.'
    );
  }

  if (
    !areValidImageDimensions(
      width,
      height
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      `PromptGenerator received invalid image dimensions: ${String(
        width
      )}x${String(
        height
      )}.`
    );
  }

  const safeWidth =
    toSafePositiveInteger(
      width
    );

  const safeHeight =
    toSafePositiveInteger(
      height
    );

  if (
    !isSafePixelCount(
      safeWidth,
      safeHeight
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'PromptGenerator image pixel count is invalid or unsafe.'
    );
  }

  const channelCount =
    resolveImageChannelCount(
      data.length,
      safeWidth,
      safeHeight
    );

  if (
    channelCount ===
    null
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      [
        'PromptGenerator received an unexpected image buffer length.',
        `Expected ${
          safeWidth *
          safeHeight *
          RGB_CHANNEL_COUNT
        } RGB bytes or ${
          safeWidth *
          safeHeight *
          RGBA_CHANNEL_COUNT
        } RGBA bytes, but received ${data.length}.`,
      ].join(
        ' '
      )
    );
  }

  return {
    channelCount,

    pixelCount:
      safeWidth *
      safeHeight,
  };
}

/* =========================================================
 * Cancellation helpers
 * ======================================================= */

/**
 * التحقق من طلب الإلغاء.
 */
function isCancellationRequested(
  cancellationSignal?:
    SegmentationCancellationSignal
): boolean {
  if (
    !cancellationSignal
  ) {
    return false;
  }

  const signal =
    cancellationSignal as
      SegmentationCancellationSignal & {
        cancelled?:
          boolean;

        aborted?:
          boolean;

        isCancelled?:
          boolean | (() => boolean);

        isAborted?:
          boolean | (() => boolean);
      };

  if (
    signal.cancelled ===
      true ||
    signal.aborted ===
      true
  ) {
    return true;
  }

  if (
    typeof signal
      .isCancelled ===
    'boolean' &&
    signal.isCancelled
  ) {
    return true;
  }

  if (
    typeof signal
      .isCancelled ===
    'function' &&
    signal.isCancelled()
  ) {
    return true;
  }

  if (
    typeof signal
      .isAborted ===
    'boolean' &&
    signal.isAborted
  ) {
    return true;
  }

  if (
    typeof signal
      .isAborted ===
    'function' &&
    signal.isAborted()
  ) {
    return true;
  }

  return false;
}

/**
 * رمي Error فوري عند الإلغاء.
 */
function throwIfPromptGenerationCancelled(
  cancellationSignal?:
    SegmentationCancellationSignal,
  requestId?:
    string
): void {
  if (
    !isCancellationRequested(
      cancellationSignal
    )
  ) {
    return;
  }

  throw new SegmentationError(
    'CANCELLED',
    requestId
      ? `Prompt generation request "${requestId}" was cancelled.`
      : 'Prompt generation was cancelled.'
  );
}

/* =========================================================
 * Progress helpers
 * ======================================================= */

/**
 * إرسال Progress بدون السماح لخطأ UI
 * أن يكسر توليد الـPrompt.
 */
function reportPromptGenerationProgress(
  context:
    Pick<
      PromptGenerationContext,
      | 'requestId'
      | 'onProgress'
    >,
  internalStageIndex:
    number,
  message:
    string
): void {
  if (
    !context.onProgress
  ) {
    return;
  }

  const stage:
    SegmentationPipelineStage =
      'create-segmentation-prompt';

  const safeStageIndex =
    clampNumber(
      internalStageIndex,
      0,
      PROMPT_GENERATION_STAGE_COUNT -
        1
    );

  const normalizedStageProgress =
    PROMPT_GENERATION_STAGE_COUNT >
      1
      ? safeStageIndex /
        (
          PROMPT_GENERATION_STAGE_COUNT -
          1
        )
      : 1;

  const stageNumber =
    SEGMENTATION_STAGE_INDEX[
      stage
    ];

  const stageStartProgress =
    clampNormalizedValue(
      safeDivide(
        stageNumber -
          1,
        SEGMENTATION_TOTAL_STAGES,
        0
      )
    );

  const stageEndProgress =
    getSegmentationProgress(
      stage
    );

  const progress =
    clampNormalizedValue(
      interpolateNumber(
        stageStartProgress,
        stageEndProgress,
        normalizedStageProgress
      )
    );

  try {
    context.onProgress({
      requestId:
        context.requestId,

      stage,

      stageNumber,

      totalStages:
        SEGMENTATION_TOTAL_STAGES,

      progress,

      message,

      elapsedMs:
        0,

      metadata: {
        promptStageIndex:
          Math.round(
            safeStageIndex
          ),

        promptStageCount:
          PROMPT_GENERATION_STAGE_COUNT,
      },
    });
  } catch {
    /**
     * Progress callbacks يجب ألا توقف المعالجة.
     */
  }
}

/* =========================================================
 * Point geometry helpers
 * ======================================================= */

/**
 * إنشاء نقطة Pixel آمنة.
 */
function createPixelPoint(
  x:
    number,
  y:
    number
): EdgeSamPixelPoint {
  return {
    x:
      Number.isFinite(
        x
      )
        ? x
        : 0,

    y:
      Number.isFinite(
        y
      )
        ? y
        : 0,
  };
}

/**
 * إنشاء نقطة Normalized.
 */
function createNormalizedPoint(
  x:
    number,
  y:
    number
): EdgeSamNormalizedPoint {
  return {
    x:
      clampNormalizedValue(
        x
      ),

    y:
      clampNormalizedValue(
        y
      ),
  };
}

/**
 * نسخ نقطة Pixel.
 */
function clonePixelPoint(
  point:
    EdgeSamPixelPoint
): EdgeSamPixelPoint {
  return {
    x:
      point.x,

    y:
      point.y,
  };
}

/**
 * التحقق من نقطة Pixel.
 */
function isValidPixelPoint(
  point:
    unknown
): point is EdgeSamPixelPoint {
  if (
    typeof point !==
      'object' ||
    point ===
      null
  ) {
    return false;
  }

  const candidate =
    point as
      Partial<EdgeSamPixelPoint>;

  return (
    isFiniteNumber(
      candidate.x
    ) &&
    isFiniteNumber(
      candidate.y
    )
  );
}

/**
 * التحقق من نقطة مطبّعة.
 */
function isValidNormalizedPoint(
  point:
    unknown
): point is EdgeSamNormalizedPoint {
  return (
    isValidPixelPoint(
      point
    ) &&
    point.x >=
      0 &&
    point.x <=
      1 &&
    point.y >=
      0 &&
    point.y <=
      1
  );
}

/**
 * قفل نقطة داخل الصورة.
 */
function clampPixelPointToImage(
  point:
    EdgeSamPixelPoint,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint {
  const maximumX =
    Math.max(
      0,
      imageWidth -
      1
    );

  const maximumY =
    Math.max(
      0,
      imageHeight -
      1
    );

  return {
    x:
      clampNumber(
        point.x,
        0,
        maximumX
      ),

    y:
      clampNumber(
        point.y,
        0,
        maximumY
      ),
  };
}

/**
 * تحويل Pixel Point إلى Normalized Point.
 */
function pixelPointToNormalizedPoint(
  point:
    EdgeSamPixelPoint,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamNormalizedPoint {
  const maximumX =
    Math.max(
      1,
      imageWidth -
      1
    );

  const maximumY =
    Math.max(
      1,
      imageHeight -
      1
    );

  return createNormalizedPoint(
    safeDivide(
      point.x,
      maximumX,
      0
    ),
    safeDivide(
      point.y,
      maximumY,
      0
    )
  );
}

/**
 * تحويل Normalized Point إلى Pixel Point.
 */
function normalizedPointToPixelPoint(
  point:
    EdgeSamNormalizedPoint,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint {
  const maximumX =
    Math.max(
      0,
      imageWidth -
      1
    );

  const maximumY =
    Math.max(
      0,
      imageHeight -
      1
    );

  return clampPixelPointToImage(
    {
      x:
        clampNormalizedValue(
          point.x
        ) *
        maximumX,

      y:
        clampNormalizedValue(
          point.y
        ) *
        maximumY,
    },
    imageWidth,
    imageHeight
  );
}

/**
 * المسافة التربيعية بين نقطتين.
 */
function calculateSquaredPointDistance(
  first:
    EdgeSamPixelPoint,
  second:
    EdgeSamPixelPoint
): number {
  const deltaX =
    first.x -
    second.x;

  const deltaY =
    first.y -
    second.y;

  return (
    deltaX *
      deltaX +
    deltaY *
      deltaY
  );
}

/**
 * المسافة الإقليدية بين نقطتين.
 */
function calculatePointDistance(
  first:
    EdgeSamPixelPoint,
  second:
    EdgeSamPixelPoint
): number {
  return Math.sqrt(
    calculateSquaredPointDistance(
      first,
      second
    )
  );
}

/**
 * المسافة المطبعة نسبةً لقطر الصورة.
 */
function calculateNormalizedPointDistance(
  first:
    EdgeSamPixelPoint,
  second:
    EdgeSamPixelPoint,
  imageWidth:
    number,
  imageHeight:
    number
): number {
  const diagonal =
    Math.sqrt(
      imageWidth *
        imageWidth +
      imageHeight *
        imageHeight
    );

  return safeDivide(
    calculatePointDistance(
      first,
      second
    ),
    diagonal,
    0
  );
}

/**
 * نقطة المنتصف.
 */
function calculatePointMidpoint(
  first:
    EdgeSamPixelPoint,
  second:
    EdgeSamPixelPoint
): EdgeSamPixelPoint {
  return {
    x:
      (
        first.x +
        second.x
      ) /
      2,

    y:
      (
        first.y +
        second.y
      ) /
      2,
  };
}

/**
 * Interpolation بين نقطتين.
 */
function interpolatePoint(
  first:
    EdgeSamPixelPoint,
  second:
    EdgeSamPixelPoint,
  ratio:
    number
): EdgeSamPixelPoint {
  return {
    x:
      interpolateNumber(
        first.x,
        second.x,
        ratio
      ),

    y:
      interpolateNumber(
        first.y,
        second.y,
        ratio
      ),
  };
}

/**
 * مركز مجموعة نقاط.
 */
function calculatePointsCentroid(
  points:
    readonly EdgeSamPixelPoint[]
): EdgeSamPixelPoint {
  if (
    points.length ===
    0
  ) {
    return {
      x:
        0,

      y:
        0,
    };
  }

  let sumX =
    0;

  let sumY =
    0;

  let validCount =
    0;

  for (
    const point
    of points
  ) {
    if (
      !isValidPixelPoint(
        point
      )
    ) {
      continue;
    }

    sumX +=
      point.x;

    sumY +=
      point.y;

    validCount +=
      1;
  }

  if (
    validCount ===
    0
  ) {
    return {
      x:
        0,

      y:
        0,
    };
  }

  return {
    x:
      sumX /
      validCount,

    y:
      sumY /
      validCount,
  };
}

/**
 * Weighted centroid.
 */
function calculateWeightedPointsCentroid(
  points:
    readonly {
      point:
        EdgeSamPixelPoint;

      weight:
        number;
    }[]
): EdgeSamPixelPoint {
  if (
    points.length ===
    0
  ) {
    return {
      x:
        0,

      y:
        0,
    };
  }

  let weightedX =
    0;

  let weightedY =
    0;

  let totalWeight =
    0;

  for (
    const item
    of points
  ) {
    if (
      !isValidPixelPoint(
        item.point
      )
    ) {
      continue;
    }

    const weight =
      Math.max(
        0,
        Number.isFinite(
          item.weight
        )
          ? item.weight
          : 0
      );

    if (
      weight <=
      NUMERIC_EPSILON
    ) {
      continue;
    }

    weightedX +=
      item.point.x *
      weight;

    weightedY +=
      item.point.y *
      weight;

    totalWeight +=
      weight;
  }

  if (
    totalWeight <=
    NUMERIC_EPSILON
  ) {
    return calculatePointsCentroid(
      points.map(
        item =>
          item.point
      )
    );
  }

  return {
    x:
      weightedX /
      totalWeight,

    y:
      weightedY /
      totalWeight,
  };
}

/* =========================================================
 * Bounds geometry helpers
 * ======================================================= */

/**
 * إنشاء Pixel Bounds آمنة.
 */
function createPixelBounds(
  x:
    number,
  y:
    number,
  width:
    number,
  height:
    number
): EdgeSamPixelBounds {
  return {
    x:
      Number.isFinite(
        x
      )
        ? x
        : 0,

    y:
      Number.isFinite(
        y
      )
        ? y
        : 0,

    width:
      Math.max(
        0,
        Number.isFinite(
          width
        )
          ? width
          : 0
      ),

    height:
      Math.max(
        0,
        Number.isFinite(
          height
        )
          ? height
          : 0
      ),
  };
}

/**
 * إنشاء Coordinate Box.
 */
function createCoordinateBox(
  x1:
    number,
  y1:
    number,
  x2:
    number,
  y2:
    number
): EdgeSamCoordinateBox {
  const safeX1 =
    Number.isFinite(
      x1
    )
      ? x1
      : 0;

  const safeY1 =
    Number.isFinite(
      y1
    )
      ? y1
      : 0;

  const safeX2 =
    Number.isFinite(
      x2
    )
      ? x2
      : safeX1;

  const safeY2 =
    Number.isFinite(
      y2
    )
      ? y2
      : safeY1;

  return {
    x1:
      Math.min(
        safeX1,
        safeX2
      ),

    y1:
      Math.min(
        safeY1,
        safeY2
      ),

    x2:
      Math.max(
        safeX1,
        safeX2
      ),

    y2:
      Math.max(
        safeY1,
        safeY2
      ),
  };
}

/**
 * تحويل Pixel Bounds إلى Coordinate Box.
 */
function pixelBoundsToCoordinateBox(
  bounds:
    EdgeSamPixelBounds
): EdgeSamCoordinateBox {
  return createCoordinateBox(
    bounds.x,
    bounds.y,
    bounds.x +
      bounds.width,
    bounds.y +
      bounds.height
  );
}

/**
 * تحويل Coordinate Box إلى Pixel Bounds.
 */
function coordinateBoxToPixelBounds(
  box:
    EdgeSamCoordinateBox
): EdgeSamPixelBounds {
  const normalizedBox =
    createCoordinateBox(
      box.x1,
      box.y1,
      box.x2,
      box.y2
    );

  return createPixelBounds(
    normalizedBox.x1,
    normalizedBox.y1,
    normalizedBox.x2 -
      normalizedBox.x1,
    normalizedBox.y2 -
      normalizedBox.y1
  );
}

/**
 * عرض Coordinate Box.
 */
function getCoordinateBoxWidth(
  box:
    EdgeSamCoordinateBox
): number {
  return Math.max(
    0,
    box.x2 -
      box.x1
  );
}

/**
 * ارتفاع Coordinate Box.
 */
function getCoordinateBoxHeight(
  box:
    EdgeSamCoordinateBox
): number {
  return Math.max(
    0,
    box.y2 -
      box.y1
  );
}

/**
 * مساحة Coordinate Box.
 */
function getCoordinateBoxArea(
  box:
    EdgeSamCoordinateBox
): number {
  return (
    getCoordinateBoxWidth(
      box
    ) *
    getCoordinateBoxHeight(
      box
    )
  );
}

/**
 * مركز Coordinate Box.
 */
function getCoordinateBoxCenter(
  box:
    EdgeSamCoordinateBox
): EdgeSamPixelPoint {
  return {
    x:
      (
        box.x1 +
        box.x2
      ) /
      2,

    y:
      (
        box.y1 +
        box.y2
      ) /
      2,
  };
}

/**
 * التحقق من صلاحية Bounds.
 */
function isValidPixelBounds(
  bounds:
    unknown
): bounds is EdgeSamPixelBounds {
  if (
    typeof bounds !==
      'object' ||
    bounds ===
      null
  ) {
    return false;
  }

  const candidate =
    bounds as
      Partial<EdgeSamPixelBounds>;

  return (
    isFiniteNumber(
      candidate.x
    ) &&
    isFiniteNumber(
      candidate.y
    ) &&
    isFiniteNumber(
      candidate.width
    ) &&
    isFiniteNumber(
      candidate.height
    ) &&
    candidate.width >
      0 &&
    candidate.height >
      0
  );
}

/**
 * التحقق من Coordinate Box.
 */
function isValidCoordinateBox(
  box:
    unknown
): box is EdgeSamCoordinateBox {
  if (
    typeof box !==
      'object' ||
    box ===
      null
  ) {
    return false;
  }

  const candidate =
    box as
      Partial<EdgeSamCoordinateBox>;

  return (
    isFiniteNumber(
      candidate.x1
    ) &&
    isFiniteNumber(
      candidate.y1
    ) &&
    isFiniteNumber(
      candidate.x2
    ) &&
    isFiniteNumber(
      candidate.y2
    ) &&
    candidate.x2 >
      candidate.x1 &&
    candidate.y2 >
      candidate.y1
  );
}

/**
 * قفل Box داخل حدود الصورة.
 */
function clampCoordinateBoxToImage(
  box:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamCoordinateBox {
  const maximumX =
    Math.max(
      0,
      imageWidth -
      1
    );

  const maximumY =
    Math.max(
      0,
      imageHeight -
      1
    );

  const normalizedBox =
    createCoordinateBox(
      box.x1,
      box.y1,
      box.x2,
      box.y2
    );

  return createCoordinateBox(
    clampNumber(
      normalizedBox.x1,
      0,
      maximumX
    ),
    clampNumber(
      normalizedBox.y1,
      0,
      maximumY
    ),
    clampNumber(
      normalizedBox.x2,
      0,
      maximumX
    ),
    clampNumber(
      normalizedBox.y2,
      0,
      maximumY
    )
  );
}

/**
 * التحقق أن نقطة داخل Box.
 */
function isPointInsideCoordinateBox(
  point:
    EdgeSamPixelPoint,
  box:
    EdgeSamCoordinateBox,
  inclusive =
    true
): boolean {
  if (
    inclusive
  ) {
    return (
      point.x >=
        box.x1 &&
      point.x <=
        box.x2 &&
      point.y >=
        box.y1 &&
      point.y <=
        box.y2
    );
  }

  return (
    point.x >
      box.x1 &&
    point.x <
      box.x2 &&
    point.y >
      box.y1 &&
    point.y <
      box.y2
  );
}

/**
 * التحقق أن نقطة داخل الصورة.
 */
function isPointInsideImage(
  point:
    EdgeSamPixelPoint,
  imageWidth:
    number,
  imageHeight:
    number
): boolean {
  return (
    point.x >=
      0 &&
    point.y >=
      0 &&
    point.x <
      imageWidth &&
    point.y <
      imageHeight
  );
}

/**
 * توسيع Coordinate Box.
 */
function expandCoordinateBox(
  box:
    EdgeSamCoordinateBox,
  horizontalRatio:
    number,
  verticalRatio:
    number
): EdgeSamCoordinateBox {
  const width =
    getCoordinateBoxWidth(
      box
    );

  const height =
    getCoordinateBoxHeight(
      box
    );

  const horizontalExpansion =
    width *
    Math.max(
      0,
      horizontalRatio
    );

  const verticalExpansion =
    height *
    Math.max(
      0,
      verticalRatio
    );

  return createCoordinateBox(
    box.x1 -
      horizontalExpansion,
    box.y1 -
      verticalExpansion,
    box.x2 +
      horizontalExpansion,
    box.y2 +
      verticalExpansion
  );
}

/**
 * توسيع Box بعدد Pixels.
 */
function expandCoordinateBoxByPixels(
  box:
    EdgeSamCoordinateBox,
  horizontalPixels:
    number,
  verticalPixels:
    number
): EdgeSamCoordinateBox {
  const safeHorizontalPixels =
    Math.max(
      0,
      horizontalPixels
    );

  const safeVerticalPixels =
    Math.max(
      0,
      verticalPixels
    );

  return createCoordinateBox(
    box.x1 -
      safeHorizontalPixels,
    box.y1 -
      safeVerticalPixels,
    box.x2 +
      safeHorizontalPixels,
    box.y2 +
      safeVerticalPixels
  );
}

/**
 * تقليص Box إلى الداخل.
 */
function insetCoordinateBox(
  box:
    EdgeSamCoordinateBox,
  horizontalRatio:
    number,
  verticalRatio:
    number
): EdgeSamCoordinateBox {
  const width =
    getCoordinateBoxWidth(
      box
    );

  const height =
    getCoordinateBoxHeight(
      box
    );

  const maximumHorizontalInset =
    width /
    2 -
    NUMERIC_EPSILON;

  const maximumVerticalInset =
    height /
    2 -
    NUMERIC_EPSILON;

  const horizontalInset =
    clampNumber(
      width *
      Math.max(
        0,
        horizontalRatio
      ),
      0,
      Math.max(
        0,
        maximumHorizontalInset
      )
    );

  const verticalInset =
    clampNumber(
      height *
      Math.max(
        0,
        verticalRatio
      ),
      0,
      Math.max(
        0,
        maximumVerticalInset
      )
    );

  return createCoordinateBox(
    box.x1 +
      horizontalInset,
    box.y1 +
      verticalInset,
    box.x2 -
      horizontalInset,
    box.y2 -
      verticalInset
  );
}

/**
 * تقاطع Boxين.
 */
function intersectCoordinateBoxes(
  first:
    EdgeSamCoordinateBox,
  second:
    EdgeSamCoordinateBox
): EdgeSamCoordinateBox | null {
  const intersection =
    createCoordinateBox(
      Math.max(
        first.x1,
        second.x1
      ),
      Math.max(
        first.y1,
        second.y1
      ),
      Math.min(
        first.x2,
        second.x2
      ),
      Math.min(
        first.y2,
        second.y2
      )
    );

  if (
    intersection.x2 <=
      intersection.x1 ||
    intersection.y2 <=
      intersection.y1
  ) {
    return null;
  }

  return intersection;
}

/**
 * Union بين Boxين.
 */
function unionCoordinateBoxes(
  first:
    EdgeSamCoordinateBox,
  second:
    EdgeSamCoordinateBox
): EdgeSamCoordinateBox {
  return createCoordinateBox(
    Math.min(
      first.x1,
      second.x1
    ),
    Math.min(
      first.y1,
      second.y1
    ),
    Math.max(
      first.x2,
      second.x2
    ),
    Math.max(
      first.y2,
      second.y2
    )
  );
}

/**
 * Intersection over Union.
 */
function calculateCoordinateBoxIoU(
  first:
    EdgeSamCoordinateBox,
  second:
    EdgeSamCoordinateBox
): number {
  const intersection =
    intersectCoordinateBoxes(
      first,
      second
    );

  if (
    !intersection
  ) {
    return 0;
  }

  const intersectionArea =
    getCoordinateBoxArea(
      intersection
    );

  const unionArea =
    getCoordinateBoxArea(
      first
    ) +
    getCoordinateBoxArea(
      second
    ) -
    intersectionArea;

  return clampNormalizedValue(
    safeDivide(
      intersectionArea,
      unionArea,
      0
    )
  );
}

/**
 * إنشاء Bounds من مجموعة نقاط.
 */
function createCoordinateBoxFromPoints(
  points:
    readonly EdgeSamPixelPoint[]
): EdgeSamCoordinateBox | null {
  if (
    points.length ===
    0
  ) {
    return null;
  }

  let minimumX =
    Number.POSITIVE_INFINITY;

  let minimumY =
    Number.POSITIVE_INFINITY;

  let maximumX =
    Number.NEGATIVE_INFINITY;

  let maximumY =
    Number.NEGATIVE_INFINITY;

  let validPointCount =
    0;

  for (
    const point
    of points
  ) {
    if (
      !isValidPixelPoint(
        point
      )
    ) {
      continue;
    }

    minimumX =
      Math.min(
        minimumX,
        point.x
      );

    minimumY =
      Math.min(
        minimumY,
        point.y
      );

    maximumX =
      Math.max(
        maximumX,
        point.x
      );

    maximumY =
      Math.max(
        maximumY,
        point.y
      );

    validPointCount +=
      1;
  }

  if (
    validPointCount ===
    0 ||
    !Number.isFinite(
      minimumX
    ) ||
    !Number.isFinite(
      minimumY
    ) ||
    !Number.isFinite(
      maximumX
    ) ||
    !Number.isFinite(
      maximumY
    )
  ) {
    return null;
  }

  return createCoordinateBox(
    minimumX,
    minimumY,
    maximumX,
    maximumY
  );
}

/**
 * حساب نسبة مساحة Box داخل الصورة.
 */
function calculateBoundingBoxAreaRatio(
  box:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number
): number {
  const imageArea =
    imageWidth *
    imageHeight;

  return clampNormalizedValue(
    safeDivide(
      getCoordinateBoxArea(
        box
      ),
      imageArea,
      0
    )
  );
}

/**
 * تحويل Anchor نسبي إلى Pixel Point داخل Box.
 */
function anchorToPixelPoint(
  anchor:
    Pick<
      SummerClothingPromptAnchor,
      | 'x'
      | 'y'
    >,
  box:
    EdgeSamCoordinateBox
): EdgeSamPixelPoint {
  return {
    x:
      interpolateNumber(
        box.x1,
        box.x2,
        anchor.x
      ),

    y:
      interpolateNumber(
        box.y1,
        box.y2,
        anchor.y
      ),
  };
}

/* =========================================================
 * Bounding box validation
 * ======================================================= */

/**
 * التحقق من Bounding Box وإصلاحه عند الإمكان.
 */
function validateAndNormalizeBoundingBox(
  box:
    EdgeSamCoordinateBox | null,
  imageWidth:
    number,
  imageHeight:
    number,
  minimumWidthRatio =
    MINIMUM_BOUNDING_BOX_DIMENSION_RATIO,
  minimumHeightRatio =
    MINIMUM_BOUNDING_BOX_DIMENSION_RATIO
): BoundingBoxValidationResult {
  if (
    !box ||
    !isValidCoordinateBox(
      box
    )
  ) {
    return {
      valid:
        false,

      box:
        null,

      wasClamped:
        false,

      wasExpanded:
        false,

      warning:
        'Bounding box is missing or invalid.',
    };
  }

  const normalizedInputBox =
    createCoordinateBox(
      box.x1,
      box.y1,
      box.x2,
      box.y2
    );

  let normalizedBox =
    clampCoordinateBoxToImage(
      normalizedInputBox,
      imageWidth,
      imageHeight
    );

  const wasClamped =
    !areNumbersApproximatelyEqual(
      normalizedInputBox.x1,
      normalizedBox.x1
    ) ||
    !areNumbersApproximatelyEqual(
      normalizedInputBox.y1,
      normalizedBox.y1
    ) ||
    !areNumbersApproximatelyEqual(
      normalizedInputBox.x2,
      normalizedBox.x2
    ) ||
    !areNumbersApproximatelyEqual(
      normalizedInputBox.y2,
      normalizedBox.y2
    );

  const minimumWidth =
    Math.max(
      2,
      imageWidth *
      clampNumber(
        minimumWidthRatio,
        0,
        1
      )
    );

  const minimumHeight =
    Math.max(
      2,
      imageHeight *
      clampNumber(
        minimumHeightRatio,
        0,
        1
      )
    );

  let wasExpanded =
    false;

  const currentWidth =
    getCoordinateBoxWidth(
      normalizedBox
    );

  const currentHeight =
    getCoordinateBoxHeight(
      normalizedBox
    );

  if (
    currentWidth <
      minimumWidth ||
    currentHeight <
      minimumHeight
  ) {
    const center =
      getCoordinateBoxCenter(
        normalizedBox
      );

    const targetWidth =
      Math.max(
        currentWidth,
        minimumWidth
      );

    const targetHeight =
      Math.max(
        currentHeight,
        minimumHeight
      );

    normalizedBox =
      clampCoordinateBoxToImage(
        createCoordinateBox(
          center.x -
            targetWidth /
              2,
          center.y -
            targetHeight /
              2,
          center.x +
            targetWidth /
              2,
          center.y +
            targetHeight /
              2
        ),
        imageWidth,
        imageHeight
      );

    wasExpanded =
      true;
  }

  const width =
    getCoordinateBoxWidth(
      normalizedBox
    );

  const height =
    getCoordinateBoxHeight(
      normalizedBox
    );

  const areaRatio =
    calculateBoundingBoxAreaRatio(
      normalizedBox,
      imageWidth,
      imageHeight
    );

  const valid =
    width >=
      1 &&
    height >=
      1 &&
    areaRatio >=
      MINIMUM_BOUNDING_BOX_AREA_RATIO &&
    areaRatio <=
      MAXIMUM_BOUNDING_BOX_AREA_RATIO;

  let warning:
    string | null =
      null;

  if (
    !valid
  ) {
    warning =
      `Bounding box area ratio ${areaRatio.toFixed(
        4
      )} is outside the supported range.`;
  } else if (
    wasClamped &&
    wasExpanded
  ) {
    warning =
      'Bounding box was clamped and expanded to remain valid.';
  } else if (
    wasClamped
  ) {
    warning =
      'Bounding box was clamped to image boundaries.';
  } else if (
    wasExpanded
  ) {
    warning =
      'Bounding box was expanded to the minimum safe size.';
  }

  return {
    valid,

    box:
      valid
        ? normalizedBox
        : null,

    wasClamped,

    wasExpanded,

    warning,
  };
}

/* =========================================================
 * Generated prompt point helpers
 * ======================================================= */

/**
 * إنشاء Prompt Point كاملة.
 */
function createGeneratedPromptPoint(
  input: {
    point:
      EdgeSamPixelPoint;

    label:
      | typeof NEGATIVE_POINT_LABEL
      | typeof POSITIVE_POINT_LABEL;

    source:
      EdgeSamPromptPointSource;

    confidence:
      number;

    imageWidth:
      number;

    imageHeight:
      number;
  }
): EdgeSamGeneratedPromptPoint {
  const clampedPoint =
    clampPixelPointToImage(
      input.point,
      input.imageWidth,
      input.imageHeight
    );

  const normalizedPoint =
    pixelPointToNormalizedPoint(
      clampedPoint,
      input.imageWidth,
      input.imageHeight
    );

  return {
    x:
      clampedPoint.x,

    y:
      clampedPoint.y,

    label:
      input.label,

    kind:
      input.label ===
        POSITIVE_POINT_LABEL
        ? 'positive'
        : 'negative',

    source:
      input.source,

    confidence:
      clampNormalizedValue(
        input.confidence
      ),

    normalizedX:
      normalizedPoint.x,

    normalizedY:
      normalizedPoint.y,
  };
}

/**
 * نسخ Prompt Point.
 */
function cloneGeneratedPromptPoint(
  point:
    EdgeSamGeneratedPromptPoint
): EdgeSamGeneratedPromptPoint {
  return {
    ...point,
  };
}

/**
 * التحقق من Prompt Point.
 */
function isValidGeneratedPromptPoint(
  point:
    unknown
): point is EdgeSamGeneratedPromptPoint {
  if (
    typeof point !==
      'object' ||
    point ===
      null
  ) {
    return false;
  }

  const candidate =
    point as
      Partial<EdgeSamGeneratedPromptPoint>;

  return (
    isFiniteNumber(
      candidate.x
    ) &&
    isFiniteNumber(
      candidate.y
    ) &&
    (
      candidate.label ===
        NEGATIVE_POINT_LABEL ||
      candidate.label ===
        POSITIVE_POINT_LABEL
    ) &&
    (
      candidate.kind ===
        'positive' ||
      candidate.kind ===
        'negative'
    ) &&
    typeof candidate.source ===
      'string' &&
    isFiniteNumber(
      candidate.confidence
    ) &&
    isFiniteNumber(
      candidate.normalizedX
    ) &&
    isFiniteNumber(
      candidate.normalizedY
    )
  );
}

/**
 * تحديد هل نقطتان مكررتان أو قريبتان جدًا.
 */
function arePromptPointsTooClose(
  first:
    EdgeSamGeneratedPromptPoint,
  second:
    EdgeSamGeneratedPromptPoint,
  imageWidth:
    number,
  imageHeight:
    number,
  minimumNormalizedDistance:
    number
): boolean {
  return (
    calculateNormalizedPointDistance(
      first,
      second,
      imageWidth,
      imageHeight
    ) <
    Math.max(
      0,
      minimumNormalizedDistance
    )
  );
}

/**
 * مقارنة أولوية نقطتين.
 *
 * الأعلى ثقة يفوز، والنقطة اليدوية لها أولوية
 * عند تساوي الثقة.
 */
function comparePromptPointPriority(
  first:
    EdgeSamGeneratedPromptPoint,
  second:
    EdgeSamGeneratedPromptPoint
): number {
  const confidenceDifference =
    second.confidence -
    first.confidence;

  if (
    Math.abs(
      confidenceDifference
    ) >
    NUMERIC_EPSILON
  ) {
    return confidenceDifference;
  }

  const firstManual =
    first.source ===
    'manual';

  const secondManual =
    second.source ===
    'manual';

  if (
    firstManual &&
    !secondManual
  ) {
    return -1;
  }

  if (
    secondManual &&
    !firstManual
  ) {
    return 1;
  }

  if (
    first.kind !==
    second.kind
  ) {
    return first.kind ===
      'positive'
      ? -1
      : 1;
  }

  return 0;
}

/**
 * إزالة النقاط غير الصالحة والمكررة.
 */
function validateAndDeduplicatePromptPoints(
  points:
    readonly EdgeSamGeneratedPromptPoint[],
  imageWidth:
    number,
  imageHeight:
    number,
  options?: {
    minimumNormalizedDistance?:
      number;

    maximumCount?:
      number;

    expectedKind?:
      'positive' | 'negative';
  }
): PointValidationResult {
  const warnings:
    string[] = [];

  let removedInvalidCount =
    0;

  let removedDuplicateCount =
    0;

  let removedOutOfBoundsCount =
    0;

  const minimumNormalizedDistance =
    Math.max(
      0,
      options
        ?.minimumNormalizedDistance ??
      DEFAULT_MINIMUM_NORMALIZED_POINT_DISTANCE
    );

  const maximumCount =
    Math.max(
      0,
      Math.min(
        MAXIMUM_TOTAL_POINT_COUNT,
        Math.round(
          options
            ?.maximumCount ??
          MAXIMUM_TOTAL_POINT_COUNT
        )
      )
    );

  const candidates:
    EdgeSamGeneratedPromptPoint[] = [];

  for (
    const point
    of points
  ) {
    if (
      !isValidGeneratedPromptPoint(
        point
      )
    ) {
      removedInvalidCount +=
        1;

      continue;
    }

    if (
      options?.expectedKind &&
      point.kind !==
        options.expectedKind
    ) {
      removedInvalidCount +=
        1;

      continue;
    }

    if (
      !isPointInsideImage(
        point,
        imageWidth,
        imageHeight
      )
    ) {
      removedOutOfBoundsCount +=
        1;

      continue;
    }

    candidates.push(
      cloneGeneratedPromptPoint(
        point
      )
    );
  }

  candidates.sort(
    comparePromptPointPriority
  );

  const accepted:
    EdgeSamGeneratedPromptPoint[] = [];

  for (
    const candidate
    of candidates
  ) {
    let duplicate =
      false;

    for (
      const existing
      of accepted
    ) {
      if (
        candidate.kind !==
        existing.kind
      ) {
        continue;
      }

      if (
        arePromptPointsTooClose(
          candidate,
          existing,
          imageWidth,
          imageHeight,
          minimumNormalizedDistance
        )
      ) {
        duplicate =
          true;

        break;
      }
    }

    if (
      duplicate
    ) {
      removedDuplicateCount +=
        1;

      continue;
    }

    accepted.push(
      candidate
    );

    if (
      accepted.length >=
      maximumCount
    ) {
      break;
    }
  }

  if (
    removedInvalidCount >
    0
  ) {
    warnings.push(
      `Removed ${removedInvalidCount} invalid prompt point${
        removedInvalidCount ===
        1
          ? ''
          : 's'
      }.`
    );
  }

  if (
    removedOutOfBoundsCount >
    0
  ) {
    warnings.push(
      `Removed ${removedOutOfBoundsCount} out-of-bounds prompt point${
        removedOutOfBoundsCount ===
        1
          ? ''
          : 's'
      }.`
    );
  }

  if (
    removedDuplicateCount >
    0
  ) {
    warnings.push(
      `Removed ${removedDuplicateCount} duplicate or overly close prompt point${
        removedDuplicateCount ===
        1
          ? ''
          : 's'
      }.`
    );
  }

  return {
    valid:
      accepted.length >
      0,

    points:
      accepted,

    removedInvalidCount,

    removedDuplicateCount,

    removedOutOfBoundsCount,

    warnings,
  };
}

/**
 * فصل النقاط إلى Positive وNegative.
 */
function splitPromptPointsByKind(
  points:
    readonly EdgeSamGeneratedPromptPoint[]
): {
  positivePoints:
    EdgeSamGeneratedPromptPoint[];

  negativePoints:
    EdgeSamGeneratedPromptPoint[];
} {
  const positivePoints:
    EdgeSamGeneratedPromptPoint[] = [];

  const negativePoints:
    EdgeSamGeneratedPromptPoint[] = [];

  for (
    const point
    of points
  ) {
    if (
      point.kind ===
      'positive'
    ) {
      positivePoints.push(
        cloneGeneratedPromptPoint(
          point
        )
      );
    } else {
      negativePoints.push(
        cloneGeneratedPromptPoint(
          point
        )
      );
    }
  }

  return {
    positivePoints,

    negativePoints,
  };
}

/**
 * اختيار النقاط الأعلى جودة مع الحفاظ
 * على انتشار هندسي جيد.
 */
function selectSpatiallyDistributedPromptPoints(
  points:
    readonly EdgeSamGeneratedPromptPoint[],
  maximumCount:
    number,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamGeneratedPromptPoint[] {
  const targetCount =
    Math.max(
      0,
      Math.min(
        points.length,
        Math.round(
          maximumCount
        )
      )
    );

  if (
    targetCount ===
    0
  ) {
    return [];
  }

  if (
    points.length <=
    targetCount
  ) {
    return points.map(
      cloneGeneratedPromptPoint
    );
  }

  const remaining =
    points
      .map(
        cloneGeneratedPromptPoint
      )
      .sort(
        comparePromptPointPriority
      );

  const selected:
    EdgeSamGeneratedPromptPoint[] = [];

  /**
   * نبدأ بأعلى نقطة ثقة.
   */
  const firstPoint =
    remaining.shift();

  if (
    firstPoint
  ) {
    selected.push(
      firstPoint
    );
  }

  while (
    selected.length <
      targetCount &&
    remaining.length >
      0
  ) {
    let bestIndex =
      0;

    let bestScore =
      Number.NEGATIVE_INFINITY;

    for (
      let index = 0;
      index <
        remaining.length;
      index +=
        1
    ) {
      const candidate =
        remaining[
          index
        ];

      let minimumDistanceToSelected =
        Number.POSITIVE_INFINITY;

      for (
        const existing
        of selected
      ) {
        minimumDistanceToSelected =
          Math.min(
            minimumDistanceToSelected,
            calculateNormalizedPointDistance(
              candidate,
              existing,
              imageWidth,
              imageHeight
            )
          );
      }

      const spatialScore =
        clampNormalizedValue(
          minimumDistanceToSelected *
          2.5
        );

      const score =
        candidate.confidence *
          0.66 +
        spatialScore *
          0.34;

      if (
        score >
        bestScore
      ) {
        bestScore =
          score;

        bestIndex =
          index;
      }
    }

    const [
      selectedPoint,
    ] =
      remaining.splice(
        bestIndex,
        1
      );

    if (
      selectedPoint
    ) {
      selected.push(
        selectedPoint
      );
    }
  }

  return selected;
}

/* =========================================================
 * Point-to-box distance helpers
 * ======================================================= */

/**
 * أقل مسافة بين نقطة وحدود Box.
 *
 * القيمة سالبة منطقيًا لا تستخدم؛
 * النقطة داخل الـBox تعيد مسافة أقرب حافة.
 */
function calculatePointDistanceToBoxBoundary(
  point:
    EdgeSamPixelPoint,
  box:
    EdgeSamCoordinateBox
): number {
  if (
    isPointInsideCoordinateBox(
      point,
      box,
      true
    )
  ) {
    return Math.min(
      Math.abs(
        point.x -
        box.x1
      ),
      Math.abs(
        box.x2 -
        point.x
      ),
      Math.abs(
        point.y -
        box.y1
      ),
      Math.abs(
        box.y2 -
        point.y
      )
    );
  }

  const clampedX =
    clampNumber(
      point.x,
      box.x1,
      box.x2
    );

  const clampedY =
    clampNumber(
      point.y,
      box.y1,
      box.y2
    );

  return calculatePointDistance(
    point,
    {
      x:
        clampedX,

      y:
        clampedY,
    }
  );
}

/**
 * هل النقطة قريبة من حدود الـBox.
 */
function isPointNearBoxBoundary(
  point:
    EdgeSamPixelPoint,
  box:
    EdgeSamCoordinateBox,
  marginPixels:
    number
): boolean {
  return (
    calculatePointDistanceToBoxBoundary(
      point,
      box
    ) <=
    Math.max(
      0,
      marginPixels
    )
  );
}

/**
 * نقل نقطة إلى داخل الـBox بعيدًا عن الحواف.
 */
function movePointInsideBox(
  point:
    EdgeSamPixelPoint,
  box:
    EdgeSamCoordinateBox,
  insetRatio:
    number
): EdgeSamPixelPoint {
  const insetBox =
    insetCoordinateBox(
      box,
      insetRatio,
      insetRatio
    );

  return {
    x:
      clampNumber(
        point.x,
        insetBox.x1,
        insetBox.x2
      ),

    y:
      clampNumber(
        point.y,
        insetBox.y1,
        insetBox.y2
      ),
  };
}

/* =========================================================
 * Image-space sampling helpers
 * ======================================================= */

/**
 * حساب Sampling Step مناسب لحجم الصورة.
 */
function calculateImageSamplingStep(
  imageWidth:
    number,
  imageHeight:
    number,
  maximumSampleCount =
    MAXIMUM_IMAGE_ANALYSIS_SAMPLES
): number {
  const pixelCount =
    imageWidth *
    imageHeight;

  if (
    pixelCount <=
    maximumSampleCount
  ) {
    return 1;
  }

  const requiredStep =
    Math.sqrt(
      pixelCount /
      Math.max(
        1,
        maximumSampleCount
      )
    );

  return Math.max(
    1,
    Math.ceil(
      requiredStep
    )
  );
}

/**
 * حساب Sampling Step للتحليل المباشر.
 */
function calculateDirectAnalysisStep(
  imageWidth:
    number,
  imageHeight:
    number
): number {
  const pixelCount =
    imageWidth *
    imageHeight;

  if (
    pixelCount <=
    MAXIMUM_DIRECT_ANALYSIS_PIXELS
  ) {
    return 1;
  }

  return Math.max(
    1,
    Math.ceil(
      Math.sqrt(
        pixelCount /
        MAXIMUM_DIRECT_ANALYSIS_PIXELS
      )
    )
  );
}

/**
 * تحويل x/y إلى Pixel Index.
 */
function calculatePixelIndex(
  x:
    number,
  y:
    number,
  imageWidth:
    number,
  channelCount:
    number
): number {
  return (
    (
      y *
      imageWidth +
      x
    ) *
    channelCount
  );
}

/**
 * قراءة Pixel بأمان.
 */
function readSampledPixel(
  data:
    Uint8Array | Uint8ClampedArray,
  x:
    number,
  y:
    number,
  imageWidth:
    number,
  imageHeight:
    number,
  channelCount:
    number
): SampledPixel {
  const safeX =
    clampNumber(
      Math.round(
        x
      ),
      0,
      imageWidth -
        1
    );

  const safeY =
    clampNumber(
      Math.round(
        y
      ),
      0,
      imageHeight -
        1
    );

  const index =
    calculatePixelIndex(
      safeX,
      safeY,
      imageWidth,
      channelCount
    );

  const red =
    clampNormalizedValue(
      safeDivide(
        data[
          index
        ] ??
        0,
        MAXIMUM_ALPHA_BYTE,
        0
      )
    );

  const green =
    clampNormalizedValue(
      safeDivide(
        data[
          index +
          1
        ] ??
        0,
        MAXIMUM_ALPHA_BYTE,
        0
      )
    );

  const blue =
    clampNormalizedValue(
      safeDivide(
        data[
          index +
          2
        ] ??
        0,
        MAXIMUM_ALPHA_BYTE,
        0
      )
    );

  const alpha =
    channelCount ===
      RGBA_CHANNEL_COUNT
      ? clampNormalizedValue(
          safeDivide(
            data[
              index +
              3
            ] ??
            MAXIMUM_ALPHA_BYTE,
            MAXIMUM_ALPHA_BYTE,
            1
          )
        )
      : 1;

  const luminance =
    red *
      0.2126 +
    green *
      0.7152 +
    blue *
      0.0722;

  return {
    x:
      safeX,

    y:
      safeY,

    red,

    green,

    blue,

    alpha,

    luminance,
  };
}

/* =========================================================
 * End of Part 1.3
 * ======================================================= */
/* =========================================================
 * Color helpers
 * ======================================================= */

/**
 * إنشاء لون RGB مطبّع.
 */
function createNormalizedRgbColor(
  red:
    number,
  green:
    number,
  blue:
    number
): NormalizedRgbColor {
  return {
    red:
      clampNormalizedValue(
        red
      ),

    green:
      clampNormalizedValue(
        green
      ),

    blue:
      clampNormalizedValue(
        blue
      ),
  };
}

/**
 * نسخ لون RGB.
 */
function cloneNormalizedRgbColor(
  color:
    NormalizedRgbColor
): NormalizedRgbColor {
  return {
    red:
      color.red,

    green:
      color.green,

    blue:
      color.blue,
  };
}

/**
 * حساب Luminance للون مطبّع.
 */
function calculateRgbLuminance(
  color:
    NormalizedRgbColor
): number {
  return clampNormalizedValue(
    color.red *
      0.2126 +
    color.green *
      0.7152 +
    color.blue *
      0.0722
  );
}

/**
 * حساب متوسط مجموعة ألوان.
 */
function calculateAverageRgbColor(
  colors:
    readonly NormalizedRgbColor[]
): NormalizedRgbColor {
  if (
    colors.length ===
    0
  ) {
    return createNormalizedRgbColor(
      0,
      0,
      0
    );
  }

  let redSum =
    0;

  let greenSum =
    0;

  let blueSum =
    0;

  let validCount =
    0;

  for (
    const color
    of colors
  ) {
    if (
      !isFiniteNumber(
        color.red
      ) ||
      !isFiniteNumber(
        color.green
      ) ||
      !isFiniteNumber(
        color.blue
      )
    ) {
      continue;
    }

    redSum +=
      color.red;

    greenSum +=
      color.green;

    blueSum +=
      color.blue;

    validCount +=
      1;
  }

  if (
    validCount ===
    0
  ) {
    return createNormalizedRgbColor(
      0,
      0,
      0
    );
  }

  return createNormalizedRgbColor(
    redSum /
      validCount,
    greenSum /
      validCount,
    blueSum /
      validCount
  );
}

/**
 * متوسط ألوان موزون.
 */
function calculateWeightedAverageRgbColor(
  colors:
    readonly {
      color:
        NormalizedRgbColor;

      weight:
        number;
    }[]
): NormalizedRgbColor {
  let redSum =
    0;

  let greenSum =
    0;

  let blueSum =
    0;

  let totalWeight =
    0;

  for (
    const item
    of colors
  ) {
    const weight =
      Math.max(
        0,
        isFiniteNumber(
          item.weight
        )
          ? item.weight
          : 0
      );

    if (
      weight <=
      NUMERIC_EPSILON
    ) {
      continue;
    }

    redSum +=
      item.color.red *
      weight;

    greenSum +=
      item.color.green *
      weight;

    blueSum +=
      item.color.blue *
      weight;

    totalWeight +=
      weight;
  }

  if (
    totalWeight <=
    NUMERIC_EPSILON
  ) {
    return calculateAverageRgbColor(
      colors.map(
        item =>
          item.color
      )
    );
  }

  return createNormalizedRgbColor(
    redSum /
      totalWeight,
    greenSum /
      totalWeight,
    blueSum /
      totalWeight
  );
}

/**
 * المسافة الإقليدية بين لونين RGB.
 */
function calculateRgbDistance(
  first:
    NormalizedRgbColor,
  second:
    NormalizedRgbColor
): number {
  const redDifference =
    first.red -
    second.red;

  const greenDifference =
    first.green -
    second.green;

  const blueDifference =
    first.blue -
    second.blue;

  return Math.sqrt(
    redDifference *
      redDifference +
    greenDifference *
      greenDifference +
    blueDifference *
      blueDifference
  );
}

/**
 * RGB distance مطبّعة إلى 0..1.
 */
function calculateNormalizedRgbDistance(
  first:
    NormalizedRgbColor,
  second:
    NormalizedRgbColor
): number {
  return clampNormalizedValue(
    safeDivide(
      calculateRgbDistance(
        first,
        second
      ),
      MAXIMUM_NORMALIZED_RGB_DISTANCE,
      0
    )
  );
}

/**
 * فرق Luminance بين لونين.
 */
function calculateLuminanceDifference(
  first:
    NormalizedRgbColor,
  second:
    NormalizedRgbColor
): number {
  return Math.abs(
    calculateRgbLuminance(
      first
    ) -
    calculateRgbLuminance(
      second
    )
  );
}

/**
 * حساب Chromatic Spread.
 *
 * يقيس مدى اختلاف قنوات اللون عن بعضها.
 */
function calculateColorChromaticSpread(
  color:
    NormalizedRgbColor
): number {
  const maximumChannel =
    Math.max(
      color.red,
      color.green,
      color.blue
    );

  const minimumChannel =
    Math.min(
      color.red,
      color.green,
      color.blue
    );

  return clampNormalizedValue(
    maximumChannel -
    minimumChannel
  );
}

/**
 * تقدير Saturation مبسط.
 */
function calculateColorSaturation(
  color:
    NormalizedRgbColor
): number {
  const maximumChannel =
    Math.max(
      color.red,
      color.green,
      color.blue
    );

  const minimumChannel =
    Math.min(
      color.red,
      color.green,
      color.blue
    );

  if (
    maximumChannel <=
    NUMERIC_EPSILON
  ) {
    return 0;
  }

  return clampNormalizedValue(
    safeDivide(
      maximumChannel -
      minimumChannel,
      maximumChannel,
      0
    )
  );
}

/**
 * هل اللون قريب من الأبيض.
 */
function isNearWhiteColor(
  color:
    NormalizedRgbColor,
  threshold =
    0.88
): boolean {
  return (
    color.red >=
      threshold &&
    color.green >=
      threshold &&
    color.blue >=
      threshold
  );
}

/**
 * هل اللون قريب من الأسود.
 */
function isNearBlackColor(
  color:
    NormalizedRgbColor,
  threshold =
    0.12
): boolean {
  return (
    color.red <=
      threshold &&
    color.green <=
      threshold &&
    color.blue <=
      threshold
  );
}

/**
 * هل اللون رمادي أو شبه محايد.
 */
function isNearNeutralColor(
  color:
    NormalizedRgbColor,
  maximumSpread =
    0.065
): boolean {
  return (
    calculateColorChromaticSpread(
      color
    ) <=
    maximumSpread
  );
}

/**
 * تحويل SampledPixel إلى RGB.
 */
function sampledPixelToRgbColor(
  pixel:
    SampledPixel
): NormalizedRgbColor {
  return createNormalizedRgbColor(
    pixel.red,
    pixel.green,
    pixel.blue
  );
}

/**
 * Alpha-composite فوق خلفية معينة.
 *
 * مهم للصور التي تحتوي Alpha حقيقي.
 */
function compositePixelOverBackground(
  pixel:
    SampledPixel,
  background:
    NormalizedRgbColor
): NormalizedRgbColor {
  const alpha =
    clampNormalizedValue(
      pixel.alpha
    );

  const inverseAlpha =
    1 -
    alpha;

  return createNormalizedRgbColor(
    pixel.red *
      alpha +
    background.red *
      inverseAlpha,

    pixel.green *
      alpha +
    background.green *
      inverseAlpha,

    pixel.blue *
      alpha +
    background.blue *
      inverseAlpha
  );
}

/* =========================================================
 * Robust color statistics
 * ======================================================= */

/**
 * حذف القيم اللونية المتطرفة ثم حساب المتوسط.
 *
 * مفيد عندما تحتوي حواف الصورة على جزء صغير
 * من القطعة أو ظل قوي.
 */
function calculateTrimmedAverageRgbColor(
  colors:
    readonly NormalizedRgbColor[],
  trimRatio =
    0.12
): NormalizedRgbColor {
  if (
    colors.length ===
    0
  ) {
    return createNormalizedRgbColor(
      0,
      0,
      0
    );
  }

  if (
    colors.length <
    8
  ) {
    return calculateAverageRgbColor(
      colors
    );
  }

  const safeTrimRatio =
    clampNumber(
      trimRatio,
      0,
      0.35
    );

  const reds =
    colors
      .map(
        color =>
          color.red
      )
      .sort(
        (
          first,
          second
        ) =>
          first -
          second
      );

  const greens =
    colors
      .map(
        color =>
          color.green
      )
      .sort(
        (
          first,
          second
        ) =>
          first -
          second
      );

  const blues =
    colors
      .map(
        color =>
          color.blue
      )
      .sort(
        (
          first,
          second
        ) =>
          first -
          second
      );

  const trimCount =
    Math.floor(
      colors.length *
      safeTrimRatio
    );

  const startIndex =
    Math.min(
      trimCount,
      colors.length -
      1
    );

  const endIndex =
    Math.max(
      startIndex +
        1,
      colors.length -
        trimCount
    );

  return createNormalizedRgbColor(
    calculateAverage(
      reds.slice(
        startIndex,
        endIndex
      )
    ),
    calculateAverage(
      greens.slice(
        startIndex,
        endIndex
      )
    ),
    calculateAverage(
      blues.slice(
        startIndex,
        endIndex
      )
    )
  );
}

/**
 * لون Median للقنوات.
 */
function calculateMedianRgbColor(
  colors:
    readonly NormalizedRgbColor[]
): NormalizedRgbColor {
  if (
    colors.length ===
    0
  ) {
    return createNormalizedRgbColor(
      0,
      0,
      0
    );
  }

  return createNormalizedRgbColor(
    calculateMedian(
      colors.map(
        color =>
          color.red
      )
    ),
    calculateMedian(
      colors.map(
        color =>
          color.green
      )
    ),
    calculateMedian(
      colors.map(
        color =>
          color.blue
      )
    )
  );
}

/**
 * دمج Median وTrimmed Mean.
 *
 * Median يقاوم القيم المتطرفة.
 * Trimmed Mean يحتفظ بتفاصيل اللون الحقيقية.
 */
function calculateRobustRgbColor(
  colors:
    readonly NormalizedRgbColor[]
): NormalizedRgbColor {
  if (
    colors.length ===
    0
  ) {
    return createNormalizedRgbColor(
      0,
      0,
      0
    );
  }

  const medianColor =
    calculateMedianRgbColor(
      colors
    );

  const trimmedColor =
    calculateTrimmedAverageRgbColor(
      colors
    );

  return calculateWeightedAverageRgbColor([
    {
      color:
        medianColor,

      weight:
        0.58,
    },
    {
      color:
        trimmedColor,

      weight:
        0.42,
    },
  ]);
}

/**
 * حساب Variance لونية حول لون مرجعي.
 */
function calculateRgbColorVariance(
  colors:
    readonly NormalizedRgbColor[],
  referenceColor:
    NormalizedRgbColor
): number {
  if (
    colors.length ===
    0
  ) {
    return 0;
  }

  const distances =
    colors.map(
      color =>
        calculateNormalizedRgbDistance(
          color,
          referenceColor
        )
    );

  return calculateVariance(
    distances
  );
}

/**
 * حساب متوسط المسافة إلى لون مرجعي.
 */
function calculateAverageDistanceToColor(
  colors:
    readonly NormalizedRgbColor[],
  referenceColor:
    NormalizedRgbColor
): number {
  if (
    colors.length ===
    0
  ) {
    return 0;
  }

  return calculateAverage(
    colors.map(
      color =>
        calculateNormalizedRgbDistance(
          color,
          referenceColor
        )
    )
  );
}

/* =========================================================
 * Background sampling types
 * ======================================================= */

type BackgroundRegionSample = {
  name:
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | 'top-edge'
    | 'bottom-edge'
    | 'left-edge'
    | 'right-edge';

  colors:
    NormalizedRgbColor[];

  luminances:
    number[];

  transparentRatio:
    number;

  color:
    NormalizedRgbColor;

  luminance:
    number;

  variance:
    number;

  confidence:
    number;
};

type BackgroundSamplingResult = {
  cornerRegions:
    readonly BackgroundRegionSample[];

  edgeRegions:
    readonly BackgroundRegionSample[];

  allRegions:
    readonly BackgroundRegionSample[];

  totalSampleCount:
    number;

  transparentSampleCount:
    number;
};

/* =========================================================
 * Background region sampling
 * ======================================================= */

/**
 * قراءة عينات داخل مستطيل.
 */
function sampleImageRegion(
  input: {
    data:
      Uint8Array | Uint8ClampedArray;

    imageWidth:
      number;

    imageHeight:
      number;

    channelCount:
      number;

    x1:
      number;

    y1:
      number;

    x2:
      number;

    y2:
      number;

    maximumSamples:
      number;
  }
): {
  colors:
    NormalizedRgbColor[];

  luminances:
    number[];

  transparentCount:
    number;
} {
  const minimumX =
    clampNumber(
      Math.floor(
        Math.min(
          input.x1,
          input.x2
        )
      ),
      0,
      input.imageWidth -
        1
    );

  const maximumX =
    clampNumber(
      Math.ceil(
        Math.max(
          input.x1,
          input.x2
        )
      ),
      minimumX,
      input.imageWidth -
        1
    );

  const minimumY =
    clampNumber(
      Math.floor(
        Math.min(
          input.y1,
          input.y2
        )
      ),
      0,
      input.imageHeight -
        1
    );

  const maximumY =
    clampNumber(
      Math.ceil(
        Math.max(
          input.y1,
          input.y2
        )
      ),
      minimumY,
      input.imageHeight -
        1
    );

  const regionWidth =
    maximumX -
    minimumX +
    1;

  const regionHeight =
    maximumY -
    minimumY +
    1;

  const regionPixelCount =
    regionWidth *
    regionHeight;

  const samplingStep =
    regionPixelCount <=
      input.maximumSamples
      ? 1
      : Math.max(
          1,
          Math.ceil(
            Math.sqrt(
              regionPixelCount /
              Math.max(
                1,
                input.maximumSamples
              )
            )
          )
        );

  const colors:
    NormalizedRgbColor[] = [];

  const luminances:
    number[] = [];

  let transparentCount =
    0;

  for (
    let y =
      minimumY;
    y <=
      maximumY;
    y +=
      samplingStep
  ) {
    for (
      let x =
        minimumX;
      x <=
        maximumX;
      x +=
        samplingStep
    ) {
      const pixel =
        readSampledPixel(
          input.data,
          x,
          y,
          input.imageWidth,
          input.imageHeight,
          input.channelCount
        );

      if (
        pixel.alpha <=
        0.02
      ) {
        transparentCount +=
          1;

        /**
         * Pixel شفاف تمامًا لا يحمل لون خلفية موثوق.
         */
        continue;
      }

      const color =
        sampledPixelToRgbColor(
          pixel
        );

      colors.push(
        color
      );

      luminances.push(
        pixel.luminance
      );
    }
  }

  return {
    colors,

    luminances,

    transparentCount,
  };
}

/**
 * بناء نتيجة Region واحدة.
 */
function createBackgroundRegionSample(
  input: {
    name:
      BackgroundRegionSample['name'];

    colors:
      NormalizedRgbColor[];

    luminances:
      number[];

    transparentCount:
      number;
  }
): BackgroundRegionSample {
  const sampleCount =
    input.colors.length +
    input.transparentCount;

  const color =
    calculateRobustRgbColor(
      input.colors
    );

  const luminance =
    input.luminances.length >
      0
      ? calculateMedian(
          input.luminances
        )
      : calculateRgbLuminance(
          color
        );

  const variance =
    calculateRgbColorVariance(
      input.colors,
      color
    );

  const transparentRatio =
    clampNormalizedValue(
      safeDivide(
        input.transparentCount,
        sampleCount,
        0
      )
    );

  /**
   * كلما قل الـVariance زادت ثقة أن المنطقة خلفية موحدة.
   */
  const uniformityScore =
    clampNormalizedValue(
      1 -
      variance *
      8
    );

  const sampleScore =
    clampNormalizedValue(
      safeDivide(
        input.colors.length,
        48,
        0
      )
    );

  const transparencyScore =
    transparentRatio >
      0.92
      ? 1
      : transparentRatio >
          0.5
        ? 0.75
        : 0;

  const confidence =
    clampNormalizedValue(
      uniformityScore *
        0.58 +
      sampleScore *
        0.27 +
      transparencyScore *
        0.15
    );

  return {
    name:
      input.name,

    colors:
      input.colors,

    luminances:
      input.luminances,

    transparentRatio,

    color,

    luminance,

    variance,

    confidence,
  };
}

/**
 * أخذ عينات من زوايا وحواف الصورة.
 */
function sampleBackgroundRegions(
  data:
    Uint8Array | Uint8ClampedArray,
  imageWidth:
    number,
  imageHeight:
    number,
  channelCount:
    number
): BackgroundSamplingResult {
  const minimumDimension =
    Math.min(
      imageWidth,
      imageHeight
    );

  /**
   * حجم الزوايا:
   *
   * كبير بما يكفي للاستقرار،
   * وصغير بما يكفي لتجنب الدخول داخل القطعة.
   */
  const cornerRatio =
    clampNumber(
      remapNumber(
        minimumDimension,
        128,
        2048,
        0.14,
        0.075
      ),
      0.07,
      0.15
    );

  const cornerWidth =
    Math.max(
      4,
      imageWidth *
      cornerRatio
    );

  const cornerHeight =
    Math.max(
      4,
      imageHeight *
      cornerRatio
    );

  /**
   * سمك شريط الحافة.
   */
  const edgeThicknessRatio =
    clampNumber(
      remapNumber(
        minimumDimension,
        128,
        2048,
        0.07,
        0.025
      ),
      0.022,
      0.075
    );

  const horizontalEdgeThickness =
    Math.max(
      3,
      imageHeight *
      edgeThicknessRatio
    );

  const verticalEdgeThickness =
    Math.max(
      3,
      imageWidth *
      edgeThicknessRatio
    );

  /**
   * نستبعد الزوايا من شرائط الحواف
   * حتى لا تتكرر نفس العينات.
   */
  const horizontalEdgeInset =
    imageWidth *
    0.18;

  const verticalEdgeInset =
    imageHeight *
    0.18;

  const regionDefinitions:
    readonly {
      name:
        BackgroundRegionSample['name'];

      x1:
        number;

      y1:
        number;

      x2:
        number;

      y2:
        number;

      maximumSamples:
        number;
    }[] = [
      {
        name:
          'top-left',

        x1:
          0,

        y1:
          0,

        x2:
          cornerWidth,

        y2:
          cornerHeight,

        maximumSamples:
          2_400,
      },
      {
        name:
          'top-right',

        x1:
          imageWidth -
          cornerWidth,

        y1:
          0,

        x2:
          imageWidth -
          1,

        y2:
          cornerHeight,

        maximumSamples:
          2_400,
      },
      {
        name:
          'bottom-left',

        x1:
          0,

        y1:
          imageHeight -
          cornerHeight,

        x2:
          cornerWidth,

        y2:
          imageHeight -
          1,

        maximumSamples:
          2_400,
      },
      {
        name:
          'bottom-right',

        x1:
          imageWidth -
          cornerWidth,

        y1:
          imageHeight -
          cornerHeight,

        x2:
          imageWidth -
          1,

        y2:
          imageHeight -
          1,

        maximumSamples:
          2_400,
      },
      {
        name:
          'top-edge',

        x1:
          horizontalEdgeInset,

        y1:
          0,

        x2:
          imageWidth -
          horizontalEdgeInset,

        y2:
          horizontalEdgeThickness,

        maximumSamples:
          3_200,
      },
      {
        name:
          'bottom-edge',

        x1:
          horizontalEdgeInset,

        y1:
          imageHeight -
          horizontalEdgeThickness,

        x2:
          imageWidth -
          horizontalEdgeInset,

        y2:
          imageHeight -
          1,

        maximumSamples:
          3_200,
      },
      {
        name:
          'left-edge',

        x1:
          0,

        y1:
          verticalEdgeInset,

        x2:
          verticalEdgeThickness,

        y2:
          imageHeight -
          verticalEdgeInset,

        maximumSamples:
          3_200,
      },
      {
        name:
          'right-edge',

        x1:
          imageWidth -
          verticalEdgeThickness,

        y1:
          verticalEdgeInset,

        x2:
          imageWidth -
          1,

        y2:
          imageHeight -
          verticalEdgeInset,

        maximumSamples:
          3_200,
      },
    ];

  const allRegions:
    BackgroundRegionSample[] = [];

  let totalSampleCount =
    0;

  let transparentSampleCount =
    0;

  for (
    const definition
    of regionDefinitions
  ) {
    const sampled =
      sampleImageRegion({
        data,

        imageWidth,

        imageHeight,

        channelCount,

        x1:
          definition.x1,

        y1:
          definition.y1,

        x2:
          definition.x2,

        y2:
          definition.y2,

        maximumSamples:
          definition
            .maximumSamples,
      });

    const region =
      createBackgroundRegionSample({
        name:
          definition.name,

        colors:
          sampled.colors,

        luminances:
          sampled.luminances,

        transparentCount:
          sampled
            .transparentCount,
      });

    allRegions.push(
      region
    );

    totalSampleCount +=
      sampled.colors.length +
      sampled.transparentCount;

    transparentSampleCount +=
      sampled.transparentCount;
  }

  const cornerNames =
    new Set<
      BackgroundRegionSample['name']
    >([
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]);

  const cornerRegions =
    allRegions.filter(
      region =>
        cornerNames.has(
          region.name
        )
    );

  const edgeRegions =
    allRegions.filter(
      region =>
        !cornerNames.has(
          region.name
        )
    );

  return {
    cornerRegions,

    edgeRegions,

    allRegions,

    totalSampleCount,

    transparentSampleCount,
  };
}

/* =========================================================
 * Region consistency analysis
 * ======================================================= */

/**
 * متوسط اختلاف الألوان بين Regions.
 */
function calculateRegionColorDisagreement(
  regions:
    readonly BackgroundRegionSample[]
): number {
  if (
    regions.length <
    2
  ) {
    return 0;
  }

  const distances:
    number[] = [];

  for (
    let firstIndex = 0;
    firstIndex <
      regions.length;
    firstIndex +=
      1
  ) {
    for (
      let secondIndex =
        firstIndex +
        1;
      secondIndex <
        regions.length;
      secondIndex +=
        1
    ) {
      distances.push(
        calculateNormalizedRgbDistance(
          regions[
            firstIndex
          ].color,
          regions[
            secondIndex
          ].color
        )
      );
    }
  }

  return calculateAverage(
    distances
  );
}

/**
 * اتساق الزوايا.
 */
function calculateCornerConsistency(
  cornerRegions:
    readonly BackgroundRegionSample[]
): number {
  if (
    cornerRegions.length <
    BACKGROUND_CORNER_REGION_COUNT
  ) {
    return 0;
  }

  const disagreement =
    calculateRegionColorDisagreement(
      cornerRegions
    );

  const averageVariance =
    calculateAverage(
      cornerRegions.map(
        region =>
          region.variance
      )
    );

  const averageConfidence =
    calculateAverage(
      cornerRegions.map(
        region =>
          region.confidence
      )
    );

  const colorAgreementScore =
    clampNormalizedValue(
      1 -
      disagreement *
      4.2
    );

  const uniformityScore =
    clampNormalizedValue(
      1 -
      averageVariance *
      9
    );

  return clampNormalizedValue(
    colorAgreementScore *
      0.5 +
    uniformityScore *
      0.28 +
    averageConfidence *
      0.22
  );
}

/**
 * قياس اتفاق الحواف مع الزوايا.
 */
function calculateEdgeToCornerAgreement(
  cornerColor:
    NormalizedRgbColor,
  edgeRegions:
    readonly BackgroundRegionSample[]
): number {
  if (
    edgeRegions.length ===
    0
  ) {
    return 0;
  }

  const distances =
    edgeRegions.map(
      region =>
        calculateNormalizedRgbDistance(
          region.color,
          cornerColor
        )
    );

  const medianDistance =
    calculateMedian(
      distances
    );

  return clampNormalizedValue(
    1 -
    medianDistance *
    4
  );
}

/* =========================================================
 * Dominant background helpers
 * ======================================================= */

/**
 * اختيار Regions الأكثر احتمالًا لتمثيل الخلفية.
 *
 * المناطق ذات Variance منخفض واتفاق أعلى
 * تحصل على أولوية.
 */
function selectReliableBackgroundRegions(
  regions:
    readonly BackgroundRegionSample[]
): BackgroundRegionSample[] {
  if (
    regions.length ===
    0
  ) {
    return [];
  }

  const sortedRegions =
    regions
      .slice()
      .sort(
        (
          first,
          second
        ) => {
          const firstScore =
            first.confidence *
              0.7 +
            (
              1 -
              clampNormalizedValue(
                first.variance *
                10
              )
            ) *
              0.3;

          const secondScore =
            second.confidence *
              0.7 +
            (
              1 -
              clampNormalizedValue(
                second.variance *
                10
              )
            ) *
              0.3;

          return (
            secondScore -
            firstScore
          );
        }
      );

  const maximumSelectedCount =
    Math.max(
      2,
      Math.ceil(
        sortedRegions.length *
        0.75
      )
    );

  return sortedRegions.slice(
    0,
    maximumSelectedCount
  );
}

/**
 * استخراج لون Background من Regions.
 */
function calculateBackgroundColorFromRegions(
  regions:
    readonly BackgroundRegionSample[]
): NormalizedRgbColor {
  if (
    regions.length ===
    0
  ) {
    return createNormalizedRgbColor(
      1,
      1,
      1
    );
  }

  const weightedColors =
    regions.map(
      region => ({
        color:
          region.color,

        weight:
          Math.max(
            0.05,
            region.confidence *
            (
              1 -
              clampNormalizedValue(
                region.variance *
                8
              )
            )
          ),
      })
    );

  return calculateWeightedAverageRgbColor(
    weightedColors
  );
}

/* =========================================================
 * Transparent background detection
 * ======================================================= */

/**
 * هل الصورة تعتمد أساسًا على Alpha كخلفية.
 */
function isPredominantlyTransparentBackground(
  sampling:
    BackgroundSamplingResult
): boolean {
  if (
    sampling.totalSampleCount <=
    0
  ) {
    return false;
  }

  const transparentRatio =
    safeDivide(
      sampling.transparentSampleCount,
      sampling.totalSampleCount,
      0
    );

  const transparentRegionCount =
    sampling.allRegions.filter(
      region =>
        region.transparentRatio >=
        0.72
    ).length;

  return (
    transparentRatio >=
      0.62 ||
    transparentRegionCount >=
      5
  );
}

/**
 * لون خلفية افتراضي عند وجود Alpha.
 *
 * اللون نفسه لا يستخدم للفصل،
 * لكن نحتاج قيمة مستقرة للـDiagnostics.
 */
function createTransparentBackgroundEstimate(
  sampling:
    BackgroundSamplingResult
): BackgroundEstimate {
  const transparentRatio =
    clampNormalizedValue(
      safeDivide(
        sampling.transparentSampleCount,
        sampling.totalSampleCount,
        0
      )
    );

  return {
    color:
      createNormalizedRgbColor(
        0,
        0,
        0
      ),

    luminance:
      0,

    confidence:
      clampNormalizedValue(
        0.72 +
        transparentRatio *
        0.28
      ),

    sampleCount:
      sampling.totalSampleCount,

    variance:
      0,

    cornerConsistency:
      transparentRatio,

    isUsable:
      true,
  };
}

/* =========================================================
 * Background estimate
 * ======================================================= */

/**
 * تقدير لون الخلفية من الزوايا والحواف.
 */
function estimateImageBackground(
  data:
    Uint8Array | Uint8ClampedArray,
  imageWidth:
    number,
  imageHeight:
    number,
  channelCount:
    number,
  cancellationSignal?:
    SegmentationCancellationSignal,
  requestId?:
    string
): BackgroundEstimate {
  throwIfPromptGenerationCancelled(
    cancellationSignal,
    requestId
  );

  const sampling =
    sampleBackgroundRegions(
      data,
      imageWidth,
      imageHeight,
      channelCount
    );

  throwIfPromptGenerationCancelled(
    cancellationSignal,
    requestId
  );

  if (
    isPredominantlyTransparentBackground(
      sampling
    )
  ) {
    return createTransparentBackgroundEstimate(
      sampling
    );
  }

  const reliableCornerRegions =
    selectReliableBackgroundRegions(
      sampling.cornerRegions
    );

  const reliableEdgeRegions =
    selectReliableBackgroundRegions(
      sampling.edgeRegions
    );

  const cornerColor =
    calculateBackgroundColorFromRegions(
      reliableCornerRegions
    );

  const edgeColor =
    calculateBackgroundColorFromRegions(
      reliableEdgeRegions
    );

  const cornerConsistency =
    calculateCornerConsistency(
      sampling.cornerRegions
    );

  const edgeAgreement =
    calculateEdgeToCornerAgreement(
      cornerColor,
      sampling.edgeRegions
    );

  /**
   * عندما تكون الزوايا متفقة نثق بها أكثر.
   * عندما تكون ضعيفة نسمح للحواف بالمساهمة أكثر.
   */
  const cornerWeight =
    interpolateNumber(
      0.55,
      0.78,
      cornerConsistency
    );

  const edgeWeight =
    1 -
    cornerWeight;

  const backgroundColor =
    calculateWeightedAverageRgbColor([
      {
        color:
          cornerColor,

        weight:
          cornerWeight,
      },
      {
        color:
          edgeColor,

        weight:
          edgeWeight,
      },
    ]);

  const allReliableRegions = [
    ...reliableCornerRegions,
    ...reliableEdgeRegions,
  ];

  const averageVariance =
    calculateAverage(
      allReliableRegions.map(
        region =>
          region.variance
      )
    );

  const regionConfidence =
    calculateAverage(
      allReliableRegions.map(
        region =>
          region.confidence
      )
    );

  const cornerToEdgeDistance =
    calculateNormalizedRgbDistance(
      cornerColor,
      edgeColor
    );

  const crossRegionAgreement =
    clampNormalizedValue(
      1 -
      cornerToEdgeDistance *
      3.5
    );

  const uniformityScore =
    clampNormalizedValue(
      1 -
      averageVariance *
      9
    );

  /**
   * الخلفيات البيضاء والسوداء والرمادية الموحدة
   * عادة أكثر سهولة وثباتًا.
   */
  const neutralBackgroundBonus =
    isNearNeutralColor(
      backgroundColor,
      0.08
    )
      ? 0.06
      : 0;

  const extremeBackgroundBonus =
    isNearWhiteColor(
      backgroundColor,
      0.9
    ) ||
    isNearBlackColor(
      backgroundColor,
      0.1
    )
      ? 0.045
      : 0;

  const confidence =
    clampNormalizedValue(
      cornerConsistency *
        0.28 +
      edgeAgreement *
        0.2 +
      crossRegionAgreement *
        0.18 +
      uniformityScore *
        0.18 +
      regionConfidence *
        0.16 +
      neutralBackgroundBonus +
      extremeBackgroundBonus
    );

  return {
    color:
      backgroundColor,

    luminance:
      calculateRgbLuminance(
        backgroundColor
      ),

    confidence,

    sampleCount:
      sampling.totalSampleCount,

    variance:
      averageVariance,

    cornerConsistency,

    isUsable:
      confidence >=
      MINIMUM_BACKGROUND_CONFIDENCE,
  };
}

/* =========================================================
 * Background type diagnostics
 * ======================================================= */

type EstimatedBackgroundType =
  | 'transparent'
  | 'white'
  | 'black'
  | 'light-neutral'
  | 'dark-neutral'
  | 'neutral'
  | 'colored'
  | 'mixed'
  | 'unknown';

/**
 * تحديد نوع الخلفية لأغراض الـDiagnostics
 * وضبط حساسية الـForeground.
 */
function classifyEstimatedBackground(
  background:
    BackgroundEstimate
): EstimatedBackgroundType {
  if (
    background.sampleCount <=
      0 ||
    !background.isUsable
  ) {
    return 'unknown';
  }

  if (
    background.variance <=
      NUMERIC_EPSILON &&
    background.color.red <=
      NUMERIC_EPSILON &&
    background.color.green <=
      NUMERIC_EPSILON &&
    background.color.blue <=
      NUMERIC_EPSILON &&
    background.confidence >=
      0.72
  ) {
    /**
     * قد تكون خلفية سوداء حقيقية أو شفافة.
     *
     * تقدير الشفافية سيتم تمريره بشكل منفصل
     * في مراحل التحليل التالية.
     */
    return 'black';
  }

  if (
    background.variance >
      0.025 &&
    background.cornerConsistency <
      0.42
  ) {
    return 'mixed';
  }

  if (
    isNearWhiteColor(
      background.color,
      0.9
    )
  ) {
    return 'white';
  }

  if (
    isNearBlackColor(
      background.color,
      0.1
    )
  ) {
    return 'black';
  }

  if (
    isNearNeutralColor(
      background.color,
      0.075
    )
  ) {
    if (
      background.luminance >=
      0.72
    ) {
      return 'light-neutral';
    }

    if (
      background.luminance <=
      0.28
    ) {
      return 'dark-neutral';
    }

    return 'neutral';
  }

  return 'colored';
}

/* =========================================================
 * Adaptive foreground threshold helpers
 * ======================================================= */

type ForegroundThresholds = {
  minimumDistance:
    number;

  strongDistance:
    number;

  minimumLuminanceDifference:
    number;

  minimumAlpha:
    number;

  chromaticCompensation:
    number;
};

/**
 * إنشاء Thresholds متكيفة مع نوع الخلفية.
 */
function createAdaptiveForegroundThresholds(
  background:
    BackgroundEstimate
): ForegroundThresholds {
  const backgroundType =
    classifyEstimatedBackground(
      background
    );

  let minimumDistance =
    MINIMUM_BACKGROUND_DISTANCE;

  let strongDistance =
    STRONG_BACKGROUND_DISTANCE;

  let minimumLuminanceDifference =
    0.035;

  let chromaticCompensation =
    0.18;

  switch (
    backgroundType
  ) {
    case 'white':
      minimumDistance =
        0.055;

      strongDistance =
        0.16;

      minimumLuminanceDifference =
        0.035;

      chromaticCompensation =
        0.2;

      break;

    case 'black':
      minimumDistance =
        0.05;

      strongDistance =
        0.15;

      minimumLuminanceDifference =
        0.03;

      chromaticCompensation =
        0.21;

      break;

    case 'light-neutral':
      minimumDistance =
        0.06;

      strongDistance =
        0.175;

      minimumLuminanceDifference =
        0.035;

      chromaticCompensation =
        0.2;

      break;

    case 'dark-neutral':
      minimumDistance =
        0.058;

      strongDistance =
        0.17;

      minimumLuminanceDifference =
        0.032;

      chromaticCompensation =
        0.2;

      break;

    case 'neutral':
      minimumDistance =
        0.067;

      strongDistance =
        0.19;

      minimumLuminanceDifference =
        0.04;

      chromaticCompensation =
        0.18;

      break;

    case 'colored':
      minimumDistance =
        0.075;

      strongDistance =
        0.21;

      minimumLuminanceDifference =
        0.045;

      chromaticCompensation =
        0.16;

      break;

    case 'mixed':
      minimumDistance =
        0.095;

      strongDistance =
        0.25;

      minimumLuminanceDifference =
        0.055;

      chromaticCompensation =
        0.14;

      break;

    case 'transparent':
      minimumDistance =
        0;

      strongDistance =
        0;

      minimumLuminanceDifference =
        0;

      chromaticCompensation =
        0;

      break;

    case 'unknown':
    default:
      minimumDistance =
        0.09;

      strongDistance =
        0.24;

      minimumLuminanceDifference =
        0.05;

      chromaticCompensation =
        0.15;

      break;
  }

  /**
   * ضعف ثقة الخلفية يرفع Threshold لمنع
   * اعتبار تفاصيل الخلفية Foreground.
   */
  const confidencePenalty =
    clampNormalizedValue(
      1 -
      background.confidence
    );

  minimumDistance +=
    confidencePenalty *
    0.035;

  strongDistance +=
    confidencePenalty *
    0.045;

  return {
    minimumDistance:
      clampNumber(
        minimumDistance,
        0,
        0.35
      ),

    strongDistance:
      clampNumber(
        Math.max(
          strongDistance,
          minimumDistance +
          0.045
        ),
        0.05,
        0.5
      ),

    minimumLuminanceDifference:
      clampNumber(
        minimumLuminanceDifference,
        0,
        0.2
      ),

    minimumAlpha:
      0.025,

    chromaticCompensation:
      clampNumber(
        chromaticCompensation,
        0,
        0.4
      ),
  };
}

/* =========================================================
 * Foreground pixel score
 * ======================================================= */

/**
 * حساب احتمالية أن Pixel جزء من القطعة.
 */
function calculateForegroundPixelScore(
  pixel:
    SampledPixel,
  background:
    BackgroundEstimate,
  thresholds:
    ForegroundThresholds
): number {
  /**
   * الصور التي تحتوي Alpha حقيقي:
   * الشفافية هي أقوى إشارة للفصل.
   */
  if (
    pixel.alpha <
    0.999
  ) {
    if (
      pixel.alpha <=
      thresholds.minimumAlpha
    ) {
      return 0;
    }

    const alphaScore =
      clampNormalizedValue(
        remapNumber(
          pixel.alpha,
          thresholds.minimumAlpha,
          1,
          0,
          1
        )
      );

    if (
      background.confidence >=
        0.72 &&
      background.variance <=
        NUMERIC_EPSILON
    ) {
      return alphaScore;
    }
  }

  const pixelColor =
    sampledPixelToRgbColor(
      pixel
    );

  const colorDistance =
    calculateNormalizedRgbDistance(
      pixelColor,
      background.color
    );

  const luminanceDifference =
    Math.abs(
      pixel.luminance -
      background.luminance
    );

  const pixelSaturation =
    calculateColorSaturation(
      pixelColor
    );

  const backgroundSaturation =
    calculateColorSaturation(
      background.color
    );

  const saturationDifference =
    Math.abs(
      pixelSaturation -
      backgroundSaturation
    );

  const channelRedDifference =
    Math.abs(
      pixelColor.red -
      background.color.red
    );

  const channelGreenDifference =
    Math.abs(
      pixelColor.green -
      background.color.green
    );

  const channelBlueDifference =
    Math.abs(
      pixelColor.blue -
      background.color.blue
    );

  const chromaticDifference =
    Math.max(
      channelRedDifference,
      channelGreenDifference,
      channelBlueDifference
    ) -
    Math.min(
      channelRedDifference,
      channelGreenDifference,
      channelBlueDifference
    );

  /**
   * منع اختلافات الخلفية الطفيفة والظلال الناعمة
   * من التحول إلى Foreground.
   */
  const hasMeaningfulColorDifference =
    colorDistance >=
    thresholds.minimumDistance;

  const hasMeaningfulLuminanceDifference =
    luminanceDifference >=
    thresholds.minimumLuminanceDifference;

  const hasMeaningfulChromaticDifference =
    saturationDifference >=
      0.055 ||
    chromaticDifference >=
      0.045;

  if (
    !hasMeaningfulColorDifference &&
    !hasMeaningfulLuminanceDifference &&
    !hasMeaningfulChromaticDifference
  ) {
    return 0;
  }

  const distanceScore =
    clampNormalizedValue(
      remapNumber(
        colorDistance,
        thresholds.minimumDistance,
        thresholds.strongDistance,
        0,
        1
      )
    );

  const luminanceScore =
    clampNormalizedValue(
      remapNumber(
        luminanceDifference,
        thresholds
          .minimumLuminanceDifference,
        Math.max(
          thresholds
            .minimumLuminanceDifference +
            0.2,
          0.24
        ),
        0,
        1
      )
    );

  const saturationScore =
    clampNormalizedValue(
      remapNumber(
        saturationDifference,
        0.04,
        0.3,
        0,
        1
      )
    );

  const chromaticScore =
    clampNormalizedValue(
      remapNumber(
        chromaticDifference,
        0.035,
        0.24,
        0,
        1
      )
    );

  /**
   * الأوزان يجب أن يكون مجموعها 1.
   *
   * المسافة اللونية هي الإشارة الأساسية،
   * مع استخدام الإضاءة والتشبع لحماية القطع
   * القريبة من لون الخلفية.
   */
  const chromaticWeight =
    clampNumber(
      thresholds
        .chromaticCompensation,
      0.12,
      0.22
    );

  const saturationWeight =
    0.14;

  const luminanceWeight =
    0.18;

  const distanceWeight =
    Math.max(
      0,
      1 -
      chromaticWeight -
      saturationWeight -
      luminanceWeight
    );

  let score =
    distanceScore *
      distanceWeight +
    luminanceScore *
      luminanceWeight +
    saturationScore *
      saturationWeight +
    chromaticScore *
      chromaticWeight;

  /**
   * Pixel الذي يختلف فقط في الإضاءة غالبًا قد يكون ظلًا.
   * نخفضه إن لم يوجد اختلاف لوني أو تشبع كافٍ.
   */
  const looksLikeBackgroundShadow =
    luminanceDifference >=
      thresholds.minimumLuminanceDifference &&
    colorDistance <
      thresholds.minimumDistance *
      1.18 &&
    saturationDifference <
      0.05 &&
    chromaticDifference <
      0.04;

  if (
    looksLikeBackgroundShadow
  ) {
    score *=
      0.52;
  }

  /**
   * الاختلاف اللوني القوي يحصل على دعم إضافي،
   * خصوصًا عند الملابس الداكنة فوق خلفية فاتحة.
   */
  if (
    colorDistance >=
      thresholds.strongDistance
  ) {
    score =
      Math.max(
        score,
        0.72 +
        clampNormalizedValue(
          (
            colorDistance -
            thresholds.strongDistance
          ) *
          0.8
        ) *
        0.2
      );
  }

  /**
   * Alpha المنخفض يقلل الثقة حتى لو اختلف اللون.
   */
  const alphaMultiplier =
    pixel.alpha <
      0.999
      ? interpolateNumber(
          0.3,
          1,
          pixel.alpha
        )
      : 1;

  return clampNormalizedValue(
    score *
    alphaMultiplier
  );
}

/**
 * هل Pixel مرشح Foreground عادي.
 */
function isForegroundPixelCandidate(
  pixel:
    SampledPixel,
  background:
    BackgroundEstimate,
  thresholds:
    ForegroundThresholds
): boolean {
  return (
    calculateForegroundPixelScore(
      pixel,
      background,
      thresholds
    ) >=
    0.46
  );
}

/**
 * هل Pixel Foreground قوي.
 */
function isStrongForegroundPixelCandidate(
  pixel:
    SampledPixel,
  background:
    BackgroundEstimate,
  thresholds:
    ForegroundThresholds
): boolean {
  return (
    calculateForegroundPixelScore(
      pixel,
      background,
      thresholds
    ) >=
    0.72
  );
}

/* =========================================================
 * Edge contamination helpers
 * ======================================================= */

/**
 * هل موضع Pixel قريب من حافة الصورة.
 */
function isPixelNearImageEdge(
  x:
    number,
  y:
    number,
  imageWidth:
    number,
  imageHeight:
    number,
  edgeRatio =
    0.025
): boolean {
  const horizontalMargin =
    imageWidth *
    clampNumber(
      edgeRatio,
      0,
      0.25
    );

  const verticalMargin =
    imageHeight *
    clampNumber(
      edgeRatio,
      0,
      0.25
    );

  return (
    x <=
      horizontalMargin ||
    x >=
      imageWidth -
      1 -
      horizontalMargin ||
    y <=
      verticalMargin ||
    y >=
      imageHeight -
      1 -
      verticalMargin
  );
}

/**
 * تخفيض Foreground score قرب الحواف
 * عندما تكون الخلفية غير موثوقة.
 */
function applyImageEdgeForegroundPenalty(
  score:
    number,
  x:
    number,
  y:
    number,
  imageWidth:
    number,
  imageHeight:
    number,
  background:
    BackgroundEstimate
): number {
  if (
    !isPixelNearImageEdge(
      x,
      y,
      imageWidth,
      imageHeight
    )
  ) {
    return clampNormalizedValue(
      score
    );
  }

  /**
   * لو الخلفية موثوقة جدًا، لا نخفض النتيجة كثيرًا.
   */
  const penalty =
    interpolateNumber(
      0.5,
      0.93,
      background.confidence
    );

  return clampNormalizedValue(
    score *
    penalty
  );
}

/* =========================================================
 * Image transparency diagnostics
 * ======================================================= */

/**
 * حساب نسبة Alpha الشفاف باستخدام Sampling.
 */
function estimateTransparentPixelRatio(
  data:
    Uint8Array | Uint8ClampedArray,
  imageWidth:
    number,
  imageHeight:
    number,
  channelCount:
    number
): number {
  if (
    channelCount !==
    RGBA_CHANNEL_COUNT
  ) {
    return 0;
  }

  const samplingStep =
    calculateImageSamplingStep(
      imageWidth,
      imageHeight,
      80_000
    );

  let transparentCount =
    0;

  let sampledCount =
    0;

  for (
    let y = 0;
    y <
      imageHeight;
    y +=
      samplingStep
  ) {
    for (
      let x = 0;
      x <
        imageWidth;
      x +=
        samplingStep
    ) {
      const index =
        calculatePixelIndex(
          x,
          y,
          imageWidth,
          channelCount
        );

      const alpha =
        data[
          index +
          3
        ] ??
        MAXIMUM_ALPHA_BYTE;

      if (
        alpha <=
        8
      ) {
        transparentCount +=
          1;
      }

      sampledCount +=
        1;
    }
  }

  return clampNormalizedValue(
    safeDivide(
      transparentCount,
      sampledCount,
      0
    )
  );
}

/**
 * هل Alpha يمكن استخدامه كقناع أولي.
 */
function canUseImageAlphaAsForegroundSignal(
  data:
    Uint8Array | Uint8ClampedArray,
  imageWidth:
    number,
  imageHeight:
    number,
  channelCount:
    number
): boolean {
  if (
    channelCount !==
    RGBA_CHANNEL_COUNT
  ) {
    return false;
  }

  const transparentRatio =
    estimateTransparentPixelRatio(
      data,
      imageWidth,
      imageHeight,
      channelCount
    );

  /**
   * نحتاج بعض الشفافية، لكن لا نريد صورة فارغة تقريبًا.
   */
  return (
    transparentRatio >=
      0.01 &&
    transparentRatio <=
      0.985
  );
}

/* =========================================================
 * Background debug summary
 * ======================================================= */

/**
 * ملخص نصي لتقدير الخلفية.
 */
function getBackgroundEstimateDebugSummary(
  background:
    BackgroundEstimate
): string {
  const backgroundType =
    classifyEstimatedBackground(
      background
    );

  return [
    `type=${backgroundType}`,
    `confidence=${background.confidence.toFixed(
      3
    )}`,
    `rgb=${background.color.red.toFixed(
      3
    )},${background.color.green.toFixed(
      3
    )},${background.color.blue.toFixed(
      3
    )}`,
    `luminance=${background.luminance.toFixed(
      3
    )}`,
    `variance=${background.variance.toFixed(
      5
    )}`,
    `cornerConsistency=${background.cornerConsistency.toFixed(
      3
    )}`,
    `samples=${background.sampleCount}`,
    `usable=${String(
      background.isUsable
    )}`,
  ].join(
    ' | '
  );
}

/* =========================================================
 * End of Part 1.4
 * ======================================================= */
/* =========================================================
 * Foreground density analysis types
 * ======================================================= */

type ForegroundDensityCell = {
  column:
    number;

  row:
    number;

  x1:
    number;

  y1:
    number;

  x2:
    number;

  y2:
    number;

  center:
    EdgeSamPixelPoint;

  sampleCount:
    number;

  foregroundSampleCount:
    number;

  strongForegroundSampleCount:
    number;

  weightedScoreSum:
    number;

  averageScore:
    number;

  foregroundRatio:
    number;

  strongForegroundRatio:
    number;

  confidence:
    number;
};

type ForegroundDensityGrid = {
  columns:
    number;

  rows:
    number;

  cells:
    ForegroundDensityCell[];

  cellWidth:
    number;

  cellHeight:
    number;

  sampledPixelCount:
    number;

  foregroundSampleCount:
    number;

  strongForegroundSampleCount:
    number;

  maximumCellScore:
    number;

  averageCellScore:
    number;
};

type ForegroundScanAccumulator = {
  minimumX:
    number;

  minimumY:
    number;

  maximumX:
    number;

  maximumY:
    number;

  weightedXSum:
    number;

  weightedYSum:
    number;

  totalWeight:
    number;

  unweightedXSum:
    number;

  unweightedYSum:
    number;

  foregroundPixelCount:
    number;

  strongForegroundPixelCount:
    number;

  sampledPixelCount:
    number;

  leftEdgeForegroundCount:
    number;

  topEdgeForegroundCount:
    number;

  rightEdgeForegroundCount:
    number;

  bottomEdgeForegroundCount:
    number;

  strongCandidates:
    {
      point:
        EdgeSamPixelPoint;

      score:
        number;
    }[];

  interiorCandidates:
    {
      point:
        EdgeSamPixelPoint;

      score:
        number;
    }[];
};

type ForegroundGridComponent = {
  cellIndexes:
    number[];

  bounds:
    EdgeSamCoordinateBox;

  weightedCenter:
    EdgeSamPixelPoint;

  totalConfidence:
    number;

  averageConfidence:
    number;

  foregroundSampleCount:
    number;

  areaInCells:
    number;
};

type ForegroundDensityAnalysis = {
  grid:
    ForegroundDensityGrid;

  activeCellIndexes:
    readonly number[];

  components:
    readonly ForegroundGridComponent[];

  primaryComponent:
    ForegroundGridComponent | null;

  secondaryComponent:
    ForegroundGridComponent | null;

  separatedRegionConfidence:
    number;
};

/* =========================================================
 * Density grid creation
 * ======================================================= */

/**
 * تحديد أبعاد Grid التحليل.
 *
 * نحافظ على عدد خلايا محدود حتى لا يزيد
 * استهلاك الذاكرة أو زمن التحليل على الموبايل.
 */
function resolveForegroundDensityGridSize(
  imageWidth:
    number,
  imageHeight:
    number
): {
  columns:
    number;

  rows:
    number;
} {
  const aspectRatio =
    safeDivide(
      imageWidth,
      imageHeight,
      1
    );

  const approximateCellCount =
    clampNumber(
      Math.round(
        Math.sqrt(
          imageWidth *
          imageHeight
        ) /
        18
      ),
      420,
      1_600
    );

  let columns =
    Math.round(
      Math.sqrt(
        approximateCellCount *
        aspectRatio
      )
    );

  let rows =
    Math.round(
      safeDivide(
        approximateCellCount,
        Math.max(
          1,
          columns
        ),
        1
      )
    );

  columns =
    clampNumber(
      columns,
      16,
      52
    );

  rows =
    clampNumber(
      rows,
      16,
      52
    );

  return {
    columns:
      Math.max(
        1,
        Math.round(
          columns
        )
      ),

    rows:
      Math.max(
        1,
        Math.round(
          rows
        )
      ),
  };
}

/**
 * إنشاء Cell فارغة.
 */
function createForegroundDensityCell(
  column:
    number,
  row:
    number,
  columns:
    number,
  rows:
    number,
  imageWidth:
    number,
  imageHeight:
    number
): ForegroundDensityCell {
  const x1 =
    safeDivide(
      column *
      imageWidth,
      columns,
      0
    );

  const y1 =
    safeDivide(
      row *
      imageHeight,
      rows,
      0
    );

  const x2 =
    safeDivide(
      (
        column +
        1
      ) *
      imageWidth,
      columns,
      imageWidth
    );

  const y2 =
    safeDivide(
      (
        row +
        1
      ) *
      imageHeight,
      rows,
      imageHeight
    );

  return {
    column,

    row,

    x1,

    y1,

    x2,

    y2,

    center: {
      x:
        (
          x1 +
          x2
        ) /
        2,

      y:
        (
          y1 +
          y2
        ) /
        2,
    },

    sampleCount:
      0,

    foregroundSampleCount:
      0,

    strongForegroundSampleCount:
      0,

    weightedScoreSum:
      0,

    averageScore:
      0,

    foregroundRatio:
      0,

    strongForegroundRatio:
      0,

    confidence:
      0,
  };
}

/**
 * إنشاء Grid كاملة.
 */
function createForegroundDensityGrid(
  imageWidth:
    number,
  imageHeight:
    number
): ForegroundDensityGrid {
  const {
    columns,
    rows,
  } =
    resolveForegroundDensityGridSize(
      imageWidth,
      imageHeight
    );

  const cells:
    ForegroundDensityCell[] = [];

  for (
    let row = 0;
    row <
      rows;
    row +=
      1
  ) {
    for (
      let column = 0;
      column <
        columns;
      column +=
        1
    ) {
      cells.push(
        createForegroundDensityCell(
          column,
          row,
          columns,
          rows,
          imageWidth,
          imageHeight
        )
      );
    }
  }

  return {
    columns,

    rows,

    cells,

    cellWidth:
      safeDivide(
        imageWidth,
        columns,
        imageWidth
      ),

    cellHeight:
      safeDivide(
        imageHeight,
        rows,
        imageHeight
      ),

    sampledPixelCount:
      0,

    foregroundSampleCount:
      0,

    strongForegroundSampleCount:
      0,

    maximumCellScore:
      0,

    averageCellScore:
      0,
  };
}

/**
 * تحديد Index الخلية التي يقع داخلها Pixel.
 */
function getForegroundDensityCellIndex(
  x:
    number,
  y:
    number,
  grid:
    ForegroundDensityGrid,
  imageWidth:
    number,
  imageHeight:
    number
): number {
  const column =
    clampNumber(
      Math.floor(
        safeDivide(
          x,
          Math.max(
            1,
            imageWidth
          ),
          0
        ) *
        grid.columns
      ),
      0,
      grid.columns -
        1
    );

  const row =
    clampNumber(
      Math.floor(
        safeDivide(
          y,
          Math.max(
            1,
            imageHeight
          ),
          0
        ) *
        grid.rows
      ),
      0,
      grid.rows -
        1
    );

  return (
    Math.round(
      row
    ) *
      grid.columns +
    Math.round(
      column
    )
  );
}

/* =========================================================
 * Foreground accumulator helpers
 * ======================================================= */

/**
 * إنشاء Accumulator فارغ.
 */
function createForegroundScanAccumulator():
  ForegroundScanAccumulator {
  return {
    minimumX:
      Number.POSITIVE_INFINITY,

    minimumY:
      Number.POSITIVE_INFINITY,

    maximumX:
      Number.NEGATIVE_INFINITY,

    maximumY:
      Number.NEGATIVE_INFINITY,

    weightedXSum:
      0,

    weightedYSum:
      0,

    totalWeight:
      0,

    unweightedXSum:
      0,

    unweightedYSum:
      0,

    foregroundPixelCount:
      0,

    strongForegroundPixelCount:
      0,

    sampledPixelCount:
      0,

    leftEdgeForegroundCount:
      0,

    topEdgeForegroundCount:
      0,

    rightEdgeForegroundCount:
      0,

    bottomEdgeForegroundCount:
      0,

    strongCandidates:
      [],

    interiorCandidates:
      [],
  };
}

/**
 * الاحتفاظ بأفضل Candidate Points دون إنشاء Array ضخمة.
 */
function insertRankedForegroundCandidate(
  candidates:
    {
      point:
        EdgeSamPixelPoint;

      score:
        number;
    }[],
  candidate:
    {
      point:
        EdgeSamPixelPoint;

      score:
        number;
    },
  maximumCount:
    number
): void {
  if (
    maximumCount <=
      0 ||
    !isValidPixelPoint(
      candidate.point
    ) ||
    !Number.isFinite(
      candidate.score
    )
  ) {
    return;
  }

  if (
    candidates.length <
    maximumCount
  ) {
    candidates.push({
      point:
        clonePixelPoint(
          candidate.point
        ),

      score:
        clampNormalizedValue(
          candidate.score
        ),
    });

    candidates.sort(
      (
        first,
        second
      ) =>
        second.score -
        first.score
    );

    return;
  }

  const weakestIndex =
    candidates.length -
    1;

  if (
    candidate.score <=
    candidates[
      weakestIndex
    ].score
  ) {
    return;
  }

  candidates[
    weakestIndex
  ] = {
    point:
      clonePixelPoint(
        candidate.point
      ),

    score:
      clampNormalizedValue(
        candidate.score
      ),
  };

  candidates.sort(
    (
      first,
      second
    ) =>
      second.score -
      first.score
  );
}

/**
 * تحديث Accumulator باستخدام Pixel مرشح.
 */
function accumulateForegroundPixel(
  accumulator:
    ForegroundScanAccumulator,
  point:
    EdgeSamPixelPoint,
  score:
    number,
  imageWidth:
    number,
  imageHeight:
    number,
  samplingStep:
    number
): void {
  const safeScore =
    clampNormalizedValue(
      score
    );

  const sampleAreaWeight =
    Math.max(
      1,
      samplingStep *
      samplingStep
    );

  accumulator.minimumX =
    Math.min(
      accumulator.minimumX,
      point.x
    );

  accumulator.minimumY =
    Math.min(
      accumulator.minimumY,
      point.y
    );

  accumulator.maximumX =
    Math.max(
      accumulator.maximumX,
      point.x
    );

  accumulator.maximumY =
    Math.max(
      accumulator.maximumY,
      point.y
    );

  accumulator.weightedXSum +=
    point.x *
    safeScore *
    sampleAreaWeight;

  accumulator.weightedYSum +=
    point.y *
    safeScore *
    sampleAreaWeight;

  accumulator.totalWeight +=
    safeScore *
    sampleAreaWeight;

  accumulator.unweightedXSum +=
    point.x *
    sampleAreaWeight;

  accumulator.unweightedYSum +=
    point.y *
    sampleAreaWeight;

  accumulator.foregroundPixelCount +=
    sampleAreaWeight;

  if (
    safeScore >=
    0.72
  ) {
    accumulator.strongForegroundPixelCount +=
      sampleAreaWeight;
  }

  const edgeMarginX =
    Math.max(
      1,
      imageWidth *
      0.018
    );

  const edgeMarginY =
    Math.max(
      1,
      imageHeight *
      0.018
    );

  if (
    point.x <=
    edgeMarginX
  ) {
    accumulator.leftEdgeForegroundCount +=
      sampleAreaWeight;
  }

  if (
    point.x >=
    imageWidth -
      1 -
      edgeMarginX
  ) {
    accumulator.rightEdgeForegroundCount +=
      sampleAreaWeight;
  }

  if (
    point.y <=
    edgeMarginY
  ) {
    accumulator.topEdgeForegroundCount +=
      sampleAreaWeight;
  }

  if (
    point.y >=
    imageHeight -
      1 -
      edgeMarginY
  ) {
    accumulator.bottomEdgeForegroundCount +=
      sampleAreaWeight;
  }
}

/* =========================================================
 * Density grid scoring
 * ======================================================= */

/**
 * تحديث خلية باستخدام Sample واحدة.
 */
function accumulateForegroundDensityCell(
  cell:
    ForegroundDensityCell,
  score:
    number
): void {
  const safeScore =
    clampNormalizedValue(
      score
    );

  cell.sampleCount +=
    1;

  cell.weightedScoreSum +=
    safeScore;

  if (
    safeScore >=
    0.46
  ) {
    cell.foregroundSampleCount +=
      1;
  }

  if (
    safeScore >=
    0.72
  ) {
    cell.strongForegroundSampleCount +=
      1;
  }
}

/**
 * إنهاء حساب قيم Grid.
 */
function finalizeForegroundDensityGrid(
  grid:
    ForegroundDensityGrid
): void {
  let cellScoreSum =
    0;

  let nonEmptyCellCount =
    0;

  grid.sampledPixelCount =
    0;

  grid.foregroundSampleCount =
    0;

  grid.strongForegroundSampleCount =
    0;

  grid.maximumCellScore =
    0;

  for (
    const cell
    of grid.cells
  ) {
    if (
      cell.sampleCount <=
      0
    ) {
      cell.averageScore =
        0;

      cell.foregroundRatio =
        0;

      cell.strongForegroundRatio =
        0;

      cell.confidence =
        0;

      continue;
    }

    cell.averageScore =
      clampNormalizedValue(
        safeDivide(
          cell.weightedScoreSum,
          cell.sampleCount,
          0
        )
      );

    cell.foregroundRatio =
      clampNormalizedValue(
        safeDivide(
          cell.foregroundSampleCount,
          cell.sampleCount,
          0
        )
      );

    cell.strongForegroundRatio =
      clampNormalizedValue(
        safeDivide(
          cell
            .strongForegroundSampleCount,
          cell.sampleCount,
          0
        )
      );

    const sampleReliability =
      clampNormalizedValue(
        safeDivide(
          cell.sampleCount,
          6,
          0
        )
      );

    cell.confidence =
      clampNormalizedValue(
        cell.averageScore *
          0.48 +
        cell.foregroundRatio *
          0.34 +
        cell.strongForegroundRatio *
          0.12 +
        sampleReliability *
          0.06
      );

    grid.sampledPixelCount +=
      cell.sampleCount;

    grid.foregroundSampleCount +=
      cell.foregroundSampleCount;

    grid.strongForegroundSampleCount +=
      cell
        .strongForegroundSampleCount;

    grid.maximumCellScore =
      Math.max(
        grid.maximumCellScore,
        cell.confidence
      );

    cellScoreSum +=
      cell.confidence;

    nonEmptyCellCount +=
      1;
  }

  grid.averageCellScore =
    nonEmptyCellCount >
      0
      ? cellScoreSum /
        nonEmptyCellCount
      : 0;
}

/* =========================================================
 * Cell neighbourhood helpers
 * ======================================================= */

/**
 * Index آمن لخلية داخل Grid.
 */
function getDensityGridCellIndex(
  column:
    number,
  row:
    number,
  grid:
    ForegroundDensityGrid
): number | null {
  if (
    column <
      0 ||
    row <
      0 ||
    column >=
      grid.columns ||
    row >=
      grid.rows
  ) {
    return null;
  }

  return (
    row *
      grid.columns +
    column
  );
}

/**
 * إرجاع جيران الخلية.
 */
function getDensityGridNeighbourIndexes(
  cellIndex:
    number,
  grid:
    ForegroundDensityGrid,
  includeDiagonal =
    true
): number[] {
  const cell =
    grid.cells[
      cellIndex
    ];

  if (
    !cell
  ) {
    return [];
  }

  const offsets =
    includeDiagonal
      ? [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1],
        ] as const
      : [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ] as const;

  const indexes:
    number[] = [];

  for (
    const [
      columnOffset,
      rowOffset,
    ]
    of offsets
  ) {
    const neighbourIndex =
      getDensityGridCellIndex(
        cell.column +
          columnOffset,
        cell.row +
          rowOffset,
        grid
      );

    if (
      neighbourIndex !==
      null
    ) {
      indexes.push(
        neighbourIndex
      );
    }
  }

  return indexes;
}

/**
 * حساب متوسط Confidence للجيران.
 */
function calculateNeighbourhoodConfidence(
  cellIndex:
    number,
  grid:
    ForegroundDensityGrid
): number {
  const neighbourIndexes =
    getDensityGridNeighbourIndexes(
      cellIndex,
      grid,
      true
    );

  if (
    neighbourIndexes.length ===
    0
  ) {
    return 0;
  }

  return calculateAverage(
    neighbourIndexes.map(
      index =>
        grid.cells[
          index
        ]?.confidence ??
        0
    )
  );
}

/**
 * تنعيم خفيف لخريطة الكثافة.
 *
 * لا ينشئ Mask كاملة؛ فقط يعدّل Score الخلايا.
 */
function smoothForegroundDensityGrid(
  grid:
    ForegroundDensityGrid,
  iterations =
    1
): void {
  const safeIterationCount =
    clampNumber(
      Math.round(
        iterations
      ),
      0,
      3
    );

  for (
    let iteration = 0;
    iteration <
      safeIterationCount;
    iteration +=
      1
  ) {
    const updatedConfidences =
      new Float32Array(
        grid.cells.length
      );

    for (
      let index = 0;
      index <
        grid.cells.length;
      index +=
        1
    ) {
      const cell =
        grid.cells[
          index
        ];

      const neighbourConfidence =
        calculateNeighbourhoodConfidence(
          index,
          grid
        );

      updatedConfidences[
        index
      ] =
        clampNormalizedValue(
          cell.confidence *
            0.68 +
          neighbourConfidence *
            0.32
        );
    }

    for (
      let index = 0;
      index <
        grid.cells.length;
      index +=
        1
    ) {
      grid.cells[
        index
      ].confidence =
        updatedConfidences[
          index
        ];
    }
  }

  grid.maximumCellScore =
    grid.cells.reduce(
      (
        maximum,
        cell
      ) =>
        Math.max(
          maximum,
          cell.confidence
        ),
      0
    );

  grid.averageCellScore =
    calculateAverage(
      grid.cells.map(
        cell =>
          cell.confidence
      )
    );
}

/* =========================================================
 * Active cell detection
 * ======================================================= */

/**
 * تحديد Threshold الخلايا النشطة.
 */
function resolveActiveDensityCellThreshold(
  grid:
    ForegroundDensityGrid,
  profile:
    SummerClothingPromptProfile
): number {
  const maximumScore =
    grid.maximumCellScore;

  const averageScore =
    grid.averageCellScore;

  let threshold =
    Math.max(
      0.22,
      averageScore *
        1.35,
      maximumScore *
        0.34
    );

  if (
    profile.preserveThinStructures
  ) {
    threshold -=
      0.035;
  }

  if (
    profile.supportsSeparatedRegions
  ) {
    threshold -=
      0.02;
  }

  if (
    profile.family ===
      'small-accessory'
  ) {
    threshold -=
      0.025;
  }

  return clampNumber(
    threshold,
    0.16,
    0.62
  );
}

/**
 * اختيار الخلايا النشطة.
 */
function selectActiveForegroundDensityCells(
  grid:
    ForegroundDensityGrid,
  profile:
    SummerClothingPromptProfile
): number[] {
  const threshold =
    resolveActiveDensityCellThreshold(
      grid,
      profile
    );

  const activeIndexes:
    number[] = [];

  for (
    let index = 0;
    index <
      grid.cells.length;
    index +=
      1
  ) {
    const cell =
      grid.cells[
        index
      ];

    const neighbourhoodConfidence =
      calculateNeighbourhoodConfidence(
        index,
        grid
      );

    const supportedByNeighbours =
      neighbourhoodConfidence >=
      threshold *
      0.72;

    const strongLocalEvidence =
      cell.strongForegroundRatio >=
        0.18 ||
      cell.averageScore >=
        threshold +
        0.12;

    if (
      cell.confidence >=
        threshold &&
      (
        supportedByNeighbours ||
        strongLocalEvidence
      )
    ) {
      activeIndexes.push(
        index
      );
    }
  }

  /**
   * Fallback: لو لم نجد خلايا كافية، نختار الأعلى.
   */
  if (
    activeIndexes.length ===
    0
  ) {
    const rankedIndexes =
      grid.cells
        .map(
          (
            cell,
            index
          ) => ({
            index,

            confidence:
              cell.confidence,
          })
        )
        .filter(
          item =>
            item.confidence >
            0.08
        )
        .sort(
          (
            first,
            second
          ) =>
            second.confidence -
            first.confidence
        );

    const fallbackCount =
      Math.min(
        6,
        rankedIndexes.length
      );

    for (
      let index = 0;
      index <
        fallbackCount;
      index +=
        1
    ) {
      activeIndexes.push(
        rankedIndexes[
          index
        ].index
      );
    }
  }

  return activeIndexes;
}

/* =========================================================
 * Connected components on density grid
 * ======================================================= */

/**
 * بناء Component من مجموعة خلايا.
 */
function createForegroundGridComponent(
  cellIndexes:
    readonly number[],
  grid:
    ForegroundDensityGrid
): ForegroundGridComponent | null {
  if (
    cellIndexes.length ===
    0
  ) {
    return null;
  }

  let bounds:
    EdgeSamCoordinateBox | null =
      null;

  const weightedPoints:
    {
      point:
        EdgeSamPixelPoint;

      weight:
        number;
    }[] = [];

  let totalConfidence =
    0;

  let foregroundSampleCount =
    0;

  for (
    const cellIndex
    of cellIndexes
  ) {
    const cell =
      grid.cells[
        cellIndex
      ];

    if (
      !cell
    ) {
      continue;
    }

    const cellBounds =
      createCoordinateBox(
        cell.x1,
        cell.y1,
        cell.x2,
        cell.y2
      );

    bounds =
      bounds
        ? unionCoordinateBoxes(
            bounds,
            cellBounds
          )
        : cellBounds;

    weightedPoints.push({
      point:
        cell.center,

      weight:
        Math.max(
          0.01,
          cell.confidence
        ),
    });

    totalConfidence +=
      cell.confidence;

    foregroundSampleCount +=
      cell.foregroundSampleCount;
  }

  if (
    !bounds ||
    weightedPoints.length ===
    0
  ) {
    return null;
  }

  return {
    cellIndexes:
      [...cellIndexes],

    bounds,

    weightedCenter:
      calculateWeightedPointsCentroid(
        weightedPoints
      ),

    totalConfidence,

    averageConfidence:
      safeDivide(
        totalConfidence,
        weightedPoints.length,
        0
      ),

    foregroundSampleCount,

    areaInCells:
      weightedPoints.length,
  };
}

/**
 * استخراج Components من الخلايا النشطة.
 */
function extractForegroundGridComponents(
  activeCellIndexes:
    readonly number[],
  grid:
    ForegroundDensityGrid
): ForegroundGridComponent[] {
  if (
    activeCellIndexes.length ===
    0
  ) {
    return [];
  }

  const activeSet =
    new Set<number>(
      activeCellIndexes
    );

  const visited =
    new Set<number>();

  const components:
    ForegroundGridComponent[] = [];

  for (
    const startIndex
    of activeCellIndexes
  ) {
    if (
      visited.has(
        startIndex
      )
    ) {
      continue;
    }

    const queue:
      number[] = [
        startIndex,
      ];

    const componentIndexes:
      number[] = [];

    visited.add(
      startIndex
    );

    while (
      queue.length >
      0
    ) {
      const currentIndex =
        queue.shift();

      if (
        currentIndex ===
        undefined
      ) {
        continue;
      }

      componentIndexes.push(
        currentIndex
      );

      const neighbourIndexes =
        getDensityGridNeighbourIndexes(
          currentIndex,
          grid,
          true
        );

      for (
        const neighbourIndex
        of neighbourIndexes
      ) {
        if (
          !activeSet.has(
            neighbourIndex
          ) ||
          visited.has(
            neighbourIndex
          )
        ) {
          continue;
        }

        visited.add(
          neighbourIndex
        );

        queue.push(
          neighbourIndex
        );
      }
    }

    const component =
      createForegroundGridComponent(
        componentIndexes,
        grid
      );

    if (
      component
    ) {
      components.push(
        component
      );
    }
  }

  components.sort(
    (
      first,
      second
    ) => {
      const firstScore =
        first.areaInCells *
          0.45 +
        first.totalConfidence *
          0.35 +
        first.foregroundSampleCount *
          0.2;

      const secondScore =
        second.areaInCells *
          0.45 +
        second.totalConfidence *
          0.35 +
        second.foregroundSampleCount *
          0.2;

      return (
        secondScore -
        firstScore
      );
    }
  );

  return components;
}

/* =========================================================
 * Component relationship helpers
 * ======================================================= */

/**
 * المسافة بين مركزي Component نسبة إلى قطر الصورة.
 */
function calculateNormalizedComponentDistance(
  first:
    ForegroundGridComponent,
  second:
    ForegroundGridComponent,
  imageWidth:
    number,
  imageHeight:
    number
): number {
  return calculateNormalizedPointDistance(
    first.weightedCenter,
    second.weightedCenter,
    imageWidth,
    imageHeight
  );
}

/**
 * تشابه حجم Componentين.
 */
function calculateComponentSizeSimilarity(
  first:
    ForegroundGridComponent,
  second:
    ForegroundGridComponent
): number {
  const largerArea =
    Math.max(
      first.areaInCells,
      second.areaInCells
    );

  const smallerArea =
    Math.min(
      first.areaInCells,
      second.areaInCells
    );

  return clampNormalizedValue(
    safeDivide(
      smallerArea,
      largerArea,
      0
    )
  );
}

/**
 * تشابه المحاذاة الرأسية.
 *
 * مهم لزوج الأحذية أو النظارات.
 */
function calculateComponentHorizontalPairAlignment(
  first:
    ForegroundGridComponent,
  second:
    ForegroundGridComponent,
  imageHeight:
    number
): number {
  const verticalDifference =
    Math.abs(
      first.weightedCenter.y -
      second.weightedCenter.y
    );

  return clampNormalizedValue(
    1 -
    safeDivide(
      verticalDifference,
      Math.max(
        1,
        imageHeight *
        0.35
      ),
      1
    )
  );
}

/**
 * ثقة أن أول Componentين يمثلان منطقتين
 * صحيحتين لنفس القطعة.
 */
function calculateSeparatedRegionConfidence(
  primary:
    ForegroundGridComponent | null,
  secondary:
    ForegroundGridComponent | null,
  profile:
    SummerClothingPromptProfile,
  imageWidth:
    number,
  imageHeight:
    number
): number {
  if (
    !primary ||
    !secondary ||
    !profile.supportsSeparatedRegions
  ) {
    return 0;
  }

  const sizeSimilarity =
    calculateComponentSizeSimilarity(
      primary,
      secondary
    );

  const horizontalAlignment =
    calculateComponentHorizontalPairAlignment(
      primary,
      secondary,
      imageHeight
    );

  const normalizedDistance =
    calculateNormalizedComponentDistance(
      primary,
      secondary,
      imageWidth,
      imageHeight
    );

  const distanceScore =
    clampNormalizedValue(
      remapNumber(
        normalizedDistance,
        0.03,
        0.65,
        0.2,
        1
      )
    );

  const secondaryStrength =
    clampNormalizedValue(
      safeDivide(
        secondary.totalConfidence,
        Math.max(
          NUMERIC_EPSILON,
          primary.totalConfidence
        ),
        0
      )
    );

  return clampNormalizedValue(
    sizeSimilarity *
      0.28 +
    horizontalAlignment *
      0.26 +
    distanceScore *
      0.18 +
    secondaryStrength *
      0.28
  );
}

/* =========================================================
 * Density analysis orchestration
 * ======================================================= */

/**
 * تحليل Components داخل Density Grid.
 */
function analyzeForegroundDensityGrid(
  grid:
    ForegroundDensityGrid,
  profile:
    SummerClothingPromptProfile,
  imageWidth:
    number,
  imageHeight:
    number
): ForegroundDensityAnalysis {
  finalizeForegroundDensityGrid(
    grid
  );

  smoothForegroundDensityGrid(
    grid,
    profile.preserveThinStructures
      ? 1
      : 2
  );

  const activeCellIndexes =
    selectActiveForegroundDensityCells(
      grid,
      profile
    );

  const components =
    extractForegroundGridComponents(
      activeCellIndexes,
      grid
    );

  const primaryComponent =
    components[
      0
    ] ??
    null;

  const secondaryComponent =
    components[
      1
    ] ??
    null;

  const separatedRegionConfidence =
    calculateSeparatedRegionConfidence(
      primaryComponent,
      secondaryComponent,
      profile,
      imageWidth,
      imageHeight
    );

  return {
    grid,

    activeCellIndexes,

    components,

    primaryComponent,

    secondaryComponent,

    separatedRegionConfidence,
  };
}

/* =========================================================
 * Foreground scanning
 * ======================================================= */

/**
 * حساب نقطة داخلية آمنة من Pixel.
 *
 * تقل الثقة قرب حواف الصورة وحدود الخلفية.
 */
function calculateInteriorCandidateScore(
  foregroundScore:
    number,
  x:
    number,
  y:
    number,
  imageWidth:
    number,
  imageHeight:
    number
): number {
  const horizontalEdgeDistance =
    Math.min(
      x,
      imageWidth -
        1 -
        x
    );

  const verticalEdgeDistance =
    Math.min(
      y,
      imageHeight -
        1 -
        y
    );

  const normalizedHorizontalDistance =
    clampNormalizedValue(
      safeDivide(
        horizontalEdgeDistance,
        Math.max(
          1,
          imageWidth *
          0.18
        ),
        0
      )
    );

  const normalizedVerticalDistance =
    clampNormalizedValue(
      safeDivide(
        verticalEdgeDistance,
        Math.max(
          1,
          imageHeight *
          0.18
        ),
        0
      )
    );

  const interiorScore =
    Math.min(
      normalizedHorizontalDistance,
      normalizedVerticalDistance
    );

  return clampNormalizedValue(
    foregroundScore *
      0.76 +
    interiorScore *
      0.24
  );
}

/**
 * مسح الصورة وتعبئة Density Grid والـAccumulator.
 */
function scanImageForegroundCandidates(
  input: {
    data:
      Uint8Array | Uint8ClampedArray;

    imageWidth:
      number;

    imageHeight:
      number;

    channelCount:
      number;

    background:
      BackgroundEstimate;

    profile:
      SummerClothingPromptProfile;

    cancellationSignal?:
      SegmentationCancellationSignal;

    requestId?:
      string;
  }
): {
  accumulator:
    ForegroundScanAccumulator;

  grid:
    ForegroundDensityGrid;

  samplingStep:
    number;
} {
  const accumulator =
    createForegroundScanAccumulator();

  const grid =
    createForegroundDensityGrid(
      input.imageWidth,
      input.imageHeight
    );

  const thresholds =
    createAdaptiveForegroundThresholds(
      input.background
    );

  const directAnalysisStep =
    calculateDirectAnalysisStep(
      input.imageWidth,
      input.imageHeight
    );

  const samplingStep =
    Math.max(
      directAnalysisStep,
      calculateImageSamplingStep(
        input.imageWidth,
        input.imageHeight,
        MAXIMUM_IMAGE_ANALYSIS_SAMPLES
      )
    );

  const useAlphaSignal =
    canUseImageAlphaAsForegroundSignal(
      input.data,
      input.imageWidth,
      input.imageHeight,
      input.channelCount
    );

  let processedRowCount =
    0;

  for (
    let y = 0;
    y <
      input.imageHeight;
    y +=
      samplingStep
  ) {
    if (
      processedRowCount %
        24 ===
      0
    ) {
      throwIfPromptGenerationCancelled(
        input.cancellationSignal,
        input.requestId
      );
    }

    processedRowCount +=
      1;

    for (
      let x = 0;
      x <
        input.imageWidth;
      x +=
        samplingStep
    ) {
      const pixel =
        readSampledPixel(
          input.data,
          x,
          y,
          input.imageWidth,
          input.imageHeight,
          input.channelCount
        );

      let score:
        number;

      if (
        useAlphaSignal
      ) {
        score =
          clampNormalizedValue(
            remapNumber(
              pixel.alpha,
              0.025,
              1,
              0,
              1
            )
          );
      } else {
        score =
          calculateForegroundPixelScore(
            pixel,
            input.background,
            thresholds
          );

        score =
          applyImageEdgeForegroundPenalty(
            score,
            x,
            y,
            input.imageWidth,
            input.imageHeight,
            input.background
          );
      }

      const densityCellIndex =
        getForegroundDensityCellIndex(
          x,
          y,
          grid,
          input.imageWidth,
          input.imageHeight
        );

      const densityCell =
        grid.cells[
          densityCellIndex
        ];

      if (
        densityCell
      ) {
        accumulateForegroundDensityCell(
          densityCell,
          score
        );
      }

      accumulator.sampledPixelCount +=
        Math.max(
          1,
          samplingStep *
          samplingStep
        );

      /**
       * نفس Threshold المستخدم في
       * isForegroundPixelCandidate.
       */
      if (
        score <
        0.46
      ) {
        continue;
      }

      const point =
        createPixelPoint(
          x,
          y
        );

      accumulateForegroundPixel(
        accumulator,
        point,
        score,
        input.imageWidth,
        input.imageHeight,
        samplingStep
      );

      if (
        score >=
        0.72
      ) {
        insertRankedForegroundCandidate(
          accumulator
            .strongCandidates,
          {
            point,

            score,
          },
          180
        );
      }

      const interiorScore =
        calculateInteriorCandidateScore(
          score,
          x,
          y,
          input.imageWidth,
          input.imageHeight
        );

      if (
        interiorScore >=
        0.58
      ) {
        insertRankedForegroundCandidate(
          accumulator
            .interiorCandidates,
          {
            point,

            score:
              interiorScore,
          },
          240
        );
      }
    }
  }

  return {
    accumulator,

    grid,

    samplingStep,
  };
}

/* =========================================================
 * Foreground bounds refinement
 * ======================================================= */

/**
 * إنشاء Bounds من Accumulator.
 */
function createForegroundBoundsFromAccumulator(
  accumulator:
    ForegroundScanAccumulator,
  imageWidth:
    number,
  imageHeight:
    number,
  samplingStep:
    number
): EdgeSamPixelBounds | null {
  if (
    accumulator.foregroundPixelCount <=
      0 ||
    !Number.isFinite(
      accumulator.minimumX
    ) ||
    !Number.isFinite(
      accumulator.minimumY
    ) ||
    !Number.isFinite(
      accumulator.maximumX
    ) ||
    !Number.isFinite(
      accumulator.maximumY
    )
  ) {
    return null;
  }

  const halfStep =
    Math.max(
      0.5,
      samplingStep /
      2
    );

  const box =
    clampCoordinateBoxToImage(
      createCoordinateBox(
        accumulator.minimumX -
          halfStep,
        accumulator.minimumY -
          halfStep,
        accumulator.maximumX +
          halfStep,
        accumulator.maximumY +
          halfStep
      ),
      imageWidth,
      imageHeight
    );

  if (
    !isValidCoordinateBox(
      box
    )
  ) {
    return null;
  }

  return coordinateBoxToPixelBounds(
    box
  );
}

/**
 * دمج Bounds الـAccumulator مع Bounds
 * الـPrimary Component.
 */
function refineForegroundBoundsUsingDensity(
  rawBounds:
    EdgeSamPixelBounds | null,
  densityAnalysis:
    ForegroundDensityAnalysis,
  profile:
    SummerClothingPromptProfile,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelBounds | null {
  const primaryComponent =
    densityAnalysis
      .primaryComponent;

  const secondaryComponent =
    densityAnalysis
      .secondaryComponent;

  let densityBounds =
    primaryComponent
      ?.bounds ??
    null;

  /**
   * لا نضم المنطقة الثانية إلا للفئات التي
   * تدعم فعلًا أجزاء منفصلة، وبثقة قوية.
   */
  if (
    profile.supportsSeparatedRegions &&
    densityBounds &&
    secondaryComponent &&
    densityAnalysis
      .separatedRegionConfidence >=
      0.56
  ) {
    densityBounds =
      unionCoordinateBoxes(
        densityBounds,
        secondaryComponent.bounds
      );
  }

  if (
    !rawBounds &&
    !densityBounds
  ) {
    return null;
  }

  const rawBox =
    rawBounds
      ? pixelBoundsToCoordinateBox(
          rawBounds
        )
      : null;

  let selectedBox:
    EdgeSamCoordinateBox;

  if (
    rawBox &&
    densityBounds
  ) {
    const overlap =
      calculateCoordinateBoxIoU(
        rawBox,
        densityBounds
      );

    const densityConfidence =
      primaryComponent
        ?.averageConfidence ??
      0;

    /**
     * Density Bounds أكثر مقاومة للنقاط
     * المتناثرة والظلال من Raw Bounds.
     */
    if (
      densityConfidence >=
        0.4
    ) {
      if (
        overlap >=
        0.28
      ) {
        /**
         * عند الاتفاق نستخدم Density Bounds أساسًا،
         * ولا نعمل Union كامل مع Raw Bounds حتى لا
         * تعود نقاط الخلفية المتطرفة.
         */
        selectedBox =
          densityBounds;
      } else {
        selectedBox =
          densityBounds;
      }
    } else {
      selectedBox =
        rawBox;
    }
  } else {
    selectedBox =
      densityBounds ??
      (
        rawBox as
          EdgeSamCoordinateBox
      );
  }

  /**
   * التوسيع يتم مرة واحدة فقط بعد اختيار
   * أفضل Box، وبالنسب الخاصة بكل Profile.
   */
  const expandedBox =
    expandCoordinateBox(
      selectedBox,
      profile
        .horizontalExpansionRatio,
      profile
        .verticalExpansionRatio
    );

  const clampedBox =
    clampCoordinateBoxToImage(
      expandedBox,
      imageWidth,
      imageHeight
    );

  const validation =
    validateAndNormalizeBoundingBox(
      clampedBox,
      imageWidth,
      imageHeight
    );

  return validation.box
    ? coordinateBoxToPixelBounds(
        validation.box
      )
    : null;
}

/* =========================================================
 * Foreground centroid helpers
 * ======================================================= */

/**
 * حساب Centroid غير موزون.
 */
function calculateAccumulatorCentroid(
  accumulator:
    ForegroundScanAccumulator,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint {
  if (
    accumulator.foregroundPixelCount <=
    0
  ) {
    return {
      x:
        imageWidth /
        2,

      y:
        imageHeight /
        2,
    };
  }

  return clampPixelPointToImage(
    {
      x:
        safeDivide(
          accumulator.unweightedXSum,
          accumulator.foregroundPixelCount,
          imageWidth /
            2
        ),

      y:
        safeDivide(
          accumulator.unweightedYSum,
          accumulator.foregroundPixelCount,
          imageHeight /
            2
        ),
    },
    imageWidth,
    imageHeight
  );
}

/**
 * حساب Centroid موزون بقوة Foreground.
 */
function calculateAccumulatorWeightedCentroid(
  accumulator:
    ForegroundScanAccumulator,
  fallback:
    EdgeSamPixelPoint,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint {
  if (
    accumulator.totalWeight <=
    NUMERIC_EPSILON
  ) {
    return clonePixelPoint(
      fallback
    );
  }

  return clampPixelPointToImage(
    {
      x:
        safeDivide(
          accumulator.weightedXSum,
          accumulator.totalWeight,
          fallback.x
        ),

      y:
        safeDivide(
          accumulator.weightedYSum,
          accumulator.totalWeight,
          fallback.y
        ),
    },
    imageWidth,
    imageHeight
  );
}

/**
 * دمج Centroid العام مع مركز Component.
 */
function refineForegroundWeightedCentroid(
  weightedCentroid:
    EdgeSamPixelPoint,
  densityAnalysis:
    ForegroundDensityAnalysis,
  profile:
    SummerClothingPromptProfile,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint {
  const primaryCenter =
    densityAnalysis
      .primaryComponent
      ?.weightedCenter;

  if (
    !primaryCenter
  ) {
    return clampPixelPointToImage(
      weightedCentroid,
      imageWidth,
      imageHeight
    );
  }

  let componentCenter =
    primaryCenter;

  if (
    profile.supportsSeparatedRegions &&
    densityAnalysis
      .secondaryComponent &&
    densityAnalysis
      .separatedRegionConfidence >=
      0.46
  ) {
    componentCenter =
      calculateWeightedPointsCentroid([
        {
          point:
            primaryCenter,

          weight:
            Math.max(
              0.01,
              densityAnalysis
                .primaryComponent
                ?.totalConfidence ??
              0
            ),
        },
        {
          point:
            densityAnalysis
              .secondaryComponent
              .weightedCenter,

          weight:
            Math.max(
              0.01,
              densityAnalysis
                .secondaryComponent
                .totalConfidence
            ),
        },
      ]);
  }

  return clampPixelPointToImage(
    interpolatePoint(
      weightedCentroid,
      componentCenter,
      0.42
    ),
    imageWidth,
    imageHeight
  );
}

/* =========================================================
 * Touching-edge diagnostics
 * ======================================================= */

/**
 * حساب هل Foreground يلمس حافة معينة.
 */
function calculateForegroundEdgeTouch(
  edgeForegroundCount:
    number,
  totalForegroundCount:
    number
): boolean {
  const ratio =
    safeDivide(
      edgeForegroundCount,
      totalForegroundCount,
      0
    );

  return (
    edgeForegroundCount >
      0 &&
    ratio >=
      0.008
  );
}

/* =========================================================
 * Candidate conversion helpers
 * ======================================================= */

/**
 * تحويل أفضل Candidates إلى نقاط فقط.
 */
function convertForegroundCandidatesToPoints(
  candidates:
    readonly {
      point:
        EdgeSamPixelPoint;

      score:
        number;
    }[],
  maximumCount:
    number,
  imageWidth:
    number,
  imageHeight:
    number,
  minimumNormalizedDistance:
    number
): EdgeSamPixelPoint[] {
  const selected:
    {
      point:
        EdgeSamPixelPoint;

      score:
        number;
    }[] = [];

  const sortedCandidates =
    candidates
      .slice()
      .sort(
        (
          first,
          second
        ) =>
          second.score -
          first.score
      );

  for (
    const candidate
    of sortedCandidates
  ) {
    let tooClose =
      false;

    for (
      const existing
      of selected
    ) {
      if (
        calculateNormalizedPointDistance(
          candidate.point,
          existing.point,
          imageWidth,
          imageHeight
        ) <
        minimumNormalizedDistance
      ) {
        tooClose =
          true;

        break;
      }
    }

    if (
      tooClose
    ) {
      continue;
    }

    selected.push({
      point:
        clonePixelPoint(
          candidate.point
        ),

      score:
        candidate.score,
    });

    if (
      selected.length >=
      maximumCount
    ) {
      break;
    }
  }

  return selected.map(
    item =>
      item.point
  );
}

/* =========================================================
 * Foreground confidence
 * ======================================================= */

/**
 * حساب الثقة العامة في تقدير Foreground.
 */
function calculateForegroundEstimateConfidence(
  input: {
    accumulator:
      ForegroundScanAccumulator;

    bounds:
      EdgeSamPixelBounds;

    densityAnalysis:
      ForegroundDensityAnalysis;

    background:
      BackgroundEstimate;

    profile:
      SummerClothingPromptProfile;

    imageWidth:
      number;

    imageHeight:
      number;
  }
): number {
  const sampledForegroundRatio =
    clampNormalizedValue(
      safeDivide(
        input.accumulator
          .foregroundPixelCount,
        input.accumulator
          .sampledPixelCount,
        0
      )
    );

  const strongForegroundRatio =
    clampNormalizedValue(
      safeDivide(
        input.accumulator
          .strongForegroundPixelCount,
        Math.max(
          1,
          input.accumulator
            .foregroundPixelCount
        ),
        0
      )
    );

  const boundsAreaRatio =
    clampNormalizedValue(
      safeDivide(
        input.bounds.width *
          input.bounds.height,
        input.imageWidth *
          input.imageHeight,
        0
      )
    );

  const plausibleAreaScore =
    boundsAreaRatio >=
      0.025 &&
    boundsAreaRatio <=
      0.94
      ? 1
      : boundsAreaRatio <
          0.025
        ? clampNormalizedValue(
            safeDivide(
              boundsAreaRatio,
              0.025,
              0
            )
          )
        : clampNormalizedValue(
            safeDivide(
              1 -
              boundsAreaRatio,
              0.06,
              0
            )
          );

  const primaryComponentScore =
    clampNormalizedValue(
      input.densityAnalysis
        .primaryComponent
        ?.averageConfidence ??
      0
    );

  const activeCellCoverage =
    clampNormalizedValue(
      safeDivide(
        input.densityAnalysis
          .activeCellIndexes
          .length,
        Math.max(
          1,
          input.densityAnalysis
            .grid.cells.length *
            0.42
        ),
        0
      )
    );

  const foregroundPresenceScore =
    clampNormalizedValue(
      remapNumber(
        sampledForegroundRatio,
        0.006,
        0.32,
        0,
        1
      )
    );

  const backgroundContribution =
    input.background
      .isUsable
      ? input.background
          .confidence
      : 0.18;

  let confidence =
    foregroundPresenceScore *
      0.2 +
    strongForegroundRatio *
      0.16 +
    plausibleAreaScore *
      0.18 +
    primaryComponentScore *
      0.24 +
    activeCellCoverage *
      0.1 +
    backgroundContribution *
      0.12;

  if (
    input.profile
      .supportsSeparatedRegions &&
    input.densityAnalysis
      .separatedRegionConfidence >=
      0.46
  ) {
    confidence +=
      input.densityAnalysis
        .separatedRegionConfidence *
      0.08;
  }

  if (
    input.profile
      .preserveThinStructures &&
    sampledForegroundRatio <
      0.03 &&
    strongForegroundRatio >
      0.42
  ) {
    confidence +=
      0.04;
  }

  return clampNormalizedValue(
    confidence
  );
}

/* =========================================================
 * Foreground warning generation
 * ======================================================= */

/**
 * إنشاء تحذيرات تحليل Foreground.
 */
function createForegroundEstimateWarnings(
  input: {
    accumulator:
      ForegroundScanAccumulator;

    bounds:
      EdgeSamPixelBounds;

    confidence:
      number;

    foregroundRatio:
      number;

    densityAnalysis:
      ForegroundDensityAnalysis;

    profile:
      SummerClothingPromptProfile;

    touchesLeft:
      boolean;

    touchesTop:
      boolean;

    touchesRight:
      boolean;

    touchesBottom:
      boolean;
  }
): string[] {
  const warnings:
    string[] = [];

  if (
    input.confidence <
    MINIMUM_FOREGROUND_CONFIDENCE
  ) {
    warnings.push(
      `Automatic foreground confidence is low (${input.confidence.toFixed(
        3
      )}).`
    );
  }

  if (
    input.foregroundRatio <
    0.006
  ) {
    warnings.push(
      'Very little foreground was detected in the image.'
    );
  }

  if (
    input.foregroundRatio >
    0.94
  ) {
    warnings.push(
      'Foreground detection covers almost the entire image.'
    );
  }

  const touchedEdgeCount = [
    input.touchesLeft,
    input.touchesTop,
    input.touchesRight,
    input.touchesBottom,
  ].filter(
    Boolean
  ).length;

  if (
    touchedEdgeCount >=
    2
  ) {
    warnings.push(
      `Detected foreground touches ${touchedEdgeCount} image edges.`
    );
  }

  if (
    input.densityAnalysis
      .components.length >
      3 &&
    !input.profile
      .supportsSeparatedRegions
  ) {
    warnings.push(
      'Foreground appears fragmented into multiple regions.'
    );
  }

  if (
    input.profile
      .supportsSeparatedRegions &&
    input.densityAnalysis
      .secondaryComponent &&
    input.densityAnalysis
      .separatedRegionConfidence <
      0.3
  ) {
    warnings.push(
      'A secondary region was detected, but its relationship to the main item is uncertain.'
    );
  }

  if (
    input.accumulator
      .strongCandidates.length ===
    0
  ) {
    warnings.push(
      'No strong foreground point candidates were found.'
    );
  }

  return warnings;
}

/* =========================================================
 * Main foreground estimation
 * ======================================================= */

/**
 * تقدير حدود ومركز القطعة تلقائيًا.
 */
function estimateImageForeground(
  input: {
    data:
      Uint8Array | Uint8ClampedArray;

    imageWidth:
      number;

    imageHeight:
      number;

    channelCount:
      number;

    background:
      BackgroundEstimate;

    profile:
      SummerClothingPromptProfile;

    cancellationSignal?:
      SegmentationCancellationSignal;

    requestId?:
      string;
  }
): ForegroundEstimate | null {
  throwIfPromptGenerationCancelled(
    input.cancellationSignal,
    input.requestId
  );

  const {
    accumulator,
    grid,
    samplingStep,
  } =
    scanImageForegroundCandidates({
      data:
        input.data,

      imageWidth:
        input.imageWidth,

      imageHeight:
        input.imageHeight,

      channelCount:
        input.channelCount,

      background:
        input.background,

      profile:
        input.profile,

      cancellationSignal:
        input.cancellationSignal,

      requestId:
        input.requestId,
    });

  throwIfPromptGenerationCancelled(
    input.cancellationSignal,
    input.requestId
  );

  if (
    accumulator.foregroundPixelCount <=
      0
  ) {
    return null;
  }

  const densityAnalysis =
    analyzeForegroundDensityGrid(
      grid,
      input.profile,
      input.imageWidth,
      input.imageHeight
    );

  const rawBounds =
    createForegroundBoundsFromAccumulator(
      accumulator,
      input.imageWidth,
      input.imageHeight,
      samplingStep
    );

  const refinedBounds =
    refineForegroundBoundsUsingDensity(
      rawBounds,
      densityAnalysis,
      input.profile,
      input.imageWidth,
      input.imageHeight
    );

  if (
    !refinedBounds
  ) {
    return null;
  }

  const centroid =
    calculateAccumulatorCentroid(
      accumulator,
      input.imageWidth,
      input.imageHeight
    );

  const rawWeightedCentroid =
    calculateAccumulatorWeightedCentroid(
      accumulator,
      centroid,
      input.imageWidth,
      input.imageHeight
    );

  const weightedCentroid =
    refineForegroundWeightedCentroid(
      rawWeightedCentroid,
      densityAnalysis,
      input.profile,
      input.imageWidth,
      input.imageHeight
    );

  const foregroundRatio =
    clampNormalizedValue(
      safeDivide(
        accumulator
          .foregroundPixelCount,
        input.imageWidth *
          input.imageHeight,
        0
      )
    );

  const touchesLeft =
    calculateForegroundEdgeTouch(
      accumulator
        .leftEdgeForegroundCount,
      accumulator
        .foregroundPixelCount
    );

  const touchesTop =
    calculateForegroundEdgeTouch(
      accumulator
        .topEdgeForegroundCount,
      accumulator
        .foregroundPixelCount
    );

  const touchesRight =
    calculateForegroundEdgeTouch(
      accumulator
        .rightEdgeForegroundCount,
      accumulator
        .foregroundPixelCount
    );

  const touchesBottom =
    calculateForegroundEdgeTouch(
      accumulator
        .bottomEdgeForegroundCount,
      accumulator
        .foregroundPixelCount
    );

  const confidence =
    calculateForegroundEstimateConfidence({
      accumulator,

      bounds:
        refinedBounds,

      densityAnalysis,

      background:
        input.background,

      profile:
        input.profile,

      imageWidth:
        input.imageWidth,

      imageHeight:
        input.imageHeight,
    });

  const strongPoints =
    convertForegroundCandidatesToPoints(
      accumulator
        .strongCandidates,
      24,
      input.imageWidth,
      input.imageHeight,
      0.035
    );

  const interiorPoints =
    convertForegroundCandidatesToPoints(
      accumulator
        .interiorCandidates,
      36,
      input.imageWidth,
      input.imageHeight,
      0.027
    );

  const warnings =
    createForegroundEstimateWarnings({
      accumulator,

      bounds:
        refinedBounds,

      confidence,

      foregroundRatio,

      densityAnalysis,

      profile:
        input.profile,

      touchesLeft,

      touchesTop,

      touchesRight,

      touchesBottom,
    });

  return {
    bounds:
      refinedBounds,

    centroid,

    weightedCentroid,

    confidence,

    foregroundPixelCount:
      accumulator
        .foregroundPixelCount,

    sampledPixelCount:
      accumulator
        .sampledPixelCount,

    foregroundRatio,

    touchesLeft,

    touchesTop,

    touchesRight,

    touchesBottom,

    strongPoints,

    interiorPoints,

    warnings,
  };
}

/* =========================================================
 * Foreground fallback bounds
 * ======================================================= */

/**
 * إنشاء Bounds افتراضية حسب عائلة القطعة.
 *
 * تستخدم فقط عند فشل التحليل التلقائي بالكامل.
 */
function createFallbackForegroundBounds(
  profile:
    SummerClothingPromptProfile,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelBounds {
  let widthRatio =
    0.68;

  let heightRatio =
    0.72;

  let centerYRatio =
    0.5;

  switch (
    profile.family
  ) {
    case 'upper-body':
      widthRatio =
        profile.pointPattern ===
        'upper-body-wide'
          ? 0.82
          : 0.7;

      heightRatio =
        0.68;

      centerYRatio =
        0.49;

      break;

    case 'lower-body':
      widthRatio =
        profile.pointPattern ===
        'skirt-standard'
          ? 0.66
          : 0.58;

      heightRatio =
        profile.pointPattern ===
        'lower-body-short'
          ? 0.54
          : 0.82;

      centerYRatio =
        0.52;

      break;

    case 'full-body':
      widthRatio =
        profile.pointPattern ===
        'dress-wide'
          ? 0.76
          : 0.62;

      heightRatio =
        0.86;

      centerYRatio =
        0.51;

      break;

   case 'footwear':
  /**
   * النظام الحالي يتعامل مع فردة حذاء واحدة
   * وليست زوج أحذية.
   */
  widthRatio =
    profile.pointPattern ===
    'footwear-pair'
      ? 0.84
      : 0.74;

  heightRatio =
    profile.pointPattern ===
    'footwear-pair'
      ? 0.42
      : 0.36;

  centerYRatio =
    0.56;

  break;

    case 'bag':
      widthRatio =
        0.62;

      heightRatio =
        0.68;

      centerYRatio =
        0.52;

      break;

    case 'headwear':
      widthRatio =
        0.64;

      heightRatio =
        0.48;

      centerYRatio =
        0.5;

      break;

    case 'small-accessory':
      widthRatio =
        profile.orientation ===
        'horizontal'
          ? 0.72
          : 0.52;

      heightRatio =
        profile.orientation ===
        'vertical'
          ? 0.72
          : 0.46;

      centerYRatio =
        0.5;

      break;

    default:
      break;
  }

  const width =
    imageWidth *
    clampNumber(
      widthRatio,
      0.15,
      0.95
    );

  const height =
    imageHeight *
    clampNumber(
      heightRatio,
      0.15,
      0.95
    );

  const centerX =
    imageWidth /
    2;

  const centerY =
    imageHeight *
    centerYRatio;

  const box =
    clampCoordinateBoxToImage(
      createCoordinateBox(
        centerX -
          width /
          2,
        centerY -
          height /
          2,
        centerX +
          width /
          2,
        centerY +
          height /
          2
      ),
      imageWidth,
      imageHeight
    );

  return coordinateBoxToPixelBounds(
    box
  );
}

/**
 * إنشاء Foreground Estimate افتراضي.
 */
function createFallbackForegroundEstimate(
  profile:
    SummerClothingPromptProfile,
  imageWidth:
    number,
  imageHeight:
    number,
  warning:
    string
): ForegroundEstimate {
  const bounds =
    createFallbackForegroundBounds(
      profile,
      imageWidth,
      imageHeight
    );

  const box =
    pixelBoundsToCoordinateBox(
      bounds
    );

  const center =
    getCoordinateBoxCenter(
      box
    );

  const interiorPoints =
    profile
      .positiveAnchors
      .map(
        anchor =>
          anchorToPixelPoint(
            anchor,
            box
          )
      );

  return {
    bounds,

    centroid:
      center,

    weightedCentroid:
      center,

    confidence:
      0.14,

    foregroundPixelCount:
      0,

    sampledPixelCount:
      imageWidth *
      imageHeight,

    foregroundRatio:
      clampNormalizedValue(
        safeDivide(
          bounds.width *
            bounds.height,
          imageWidth *
            imageHeight,
          0
        )
      ),

    touchesLeft:
      false,

    touchesTop:
      false,

    touchesRight:
      false,

    touchesBottom:
      false,

    strongPoints:
      [],

    interiorPoints,

    warnings: [
      warning,
      'A geometry-based fallback foreground estimate was used.',
    ],
  };
}

/* =========================================================
 * Foreground diagnostics
 * ======================================================= */

/**
 * ملخص نصي لتحليل Foreground.
 */
function getForegroundEstimateDebugSummary(
  foreground:
    ForegroundEstimate | null
): string {
  if (
    !foreground
  ) {
    return 'foreground=unavailable';
  }

  return [
    `confidence=${foreground.confidence.toFixed(
      3
    )}`,
    `ratio=${foreground.foregroundRatio.toFixed(
      4
    )}`,
    `bounds=${foreground.bounds.x.toFixed(
      1
    )},${foreground.bounds.y.toFixed(
      1
    )},${foreground.bounds.width.toFixed(
      1
    )},${foreground.bounds.height.toFixed(
      1
    )}`,
    `centroid=${foreground.centroid.x.toFixed(
      1
    )},${foreground.centroid.y.toFixed(
      1
    )}`,
    `weightedCentroid=${foreground.weightedCentroid.x.toFixed(
      1
    )},${foreground.weightedCentroid.y.toFixed(
      1
    )}`,
    `strongPoints=${foreground.strongPoints.length}`,
    `interiorPoints=${foreground.interiorPoints.length}`,
    `touches=${[
      foreground.touchesLeft
        ? 'L'
        : '',
      foreground.touchesTop
        ? 'T'
        : '',
      foreground.touchesRight
        ? 'R'
        : '',
      foreground.touchesBottom
        ? 'B'
        : '',
    ]
      .filter(
        value =>
          value.length >
          0
      )
      .join(
        ''
      ) || 'none'}`,
  ].join(
    ' | '
  );
}

/* =========================================================
 * End of Part 1.5
 * ======================================================= */
/* =========================================================
 * Prompt generation option types
 * ======================================================= */

type PositivePromptGenerationOptions = {
  maximumPointCount:
    number;

  minimumNormalizedDistance:
    number;

  includeSubjectCenter:
    boolean;

  includeProfileAnchors:
    boolean;

  includeStrongCandidates:
    boolean;

  includeInteriorCandidates:
    boolean;
};

type NegativePromptGenerationOptions = {
  maximumPointCount:
    number;

  minimumNormalizedDistance:
    number;

  boundarySafetyRatio:
    number;

  includeCorners:
    boolean;

  includeEdges:
    boolean;

  includeBoxExterior:
    boolean;
};

type PromptBoxBuildResult = {
  box:
    EdgeSamCoordinateBox;

  usedFallback:
    boolean;

  warnings:
    string[];
};

/* =========================================================
 * Positive point candidate helpers
 * ======================================================= */

/**
 * إضافة Positive Point إلى القائمة.
 */
function appendPositivePromptCandidate(
  candidates:
    EdgeSamGeneratedPromptPoint[],
  point:
    EdgeSamPixelPoint,
  source:
    EdgeSamPromptPointSource,
  confidence:
    number,
  imageWidth:
    number,
  imageHeight:
    number
): void {
  candidates.push(
    createGeneratedPromptPoint({
      point,

      label:
        POSITIVE_POINT_LABEL,

      source,

      confidence,

      imageWidth,

      imageHeight,
    })
  );
}

/**
 * إضافة Negative Point إلى القائمة.
 */
function appendNegativePromptCandidate(
  candidates:
    EdgeSamGeneratedPromptPoint[],
  point:
    EdgeSamPixelPoint,
  source:
    EdgeSamPromptPointSource,
  confidence:
    number,
  imageWidth:
    number,
  imageHeight:
    number
): void {
  candidates.push(
    createGeneratedPromptPoint({
      point,

      label:
        NEGATIVE_POINT_LABEL,

      source,

      confidence,

      imageWidth,

      imageHeight,
    })
  );
}

/**
 * حساب ثقة Anchor حسب دورها ونوع القطعة.
 */
function calculateProfileAnchorConfidence(
  anchor:
    SummerClothingPromptAnchor,
  profile:
    SummerClothingPromptProfile,
  foregroundConfidence:
    number
): number {
  let roleMultiplier =
    1;

  switch (
    anchor.role
  ) {
    case 'core':
      roleMultiplier =
        1;

      break;

    case 'left-leg':
    case 'right-leg':
      roleMultiplier =
        profile.family ===
        'lower-body'
          ? 0.98
          : 0.82;

      break;

    case 'toe':
    case 'heel':
    case 'sole':
      roleMultiplier =
        profile.family ===
        'footwear'
          ? 0.98
          : 0.78;

      break;

    case 'strap':
    case 'handle':
      roleMultiplier =
        profile
          .preserveThinStructures
          ? 0.92
          : 0.72;

      break;

    case 'crown':
    case 'brim':
      roleMultiplier =
        profile.family ===
        'headwear'
          ? 0.94
          : 0.76;

      break;

    case 'accessory-center':
      roleMultiplier =
        profile.family ===
        'small-accessory'
          ? 1
          : 0.82;

      break;

    case 'left-extension':
    case 'right-extension':
    case 'top-extension':
    case 'bottom-extension':
    default:
      roleMultiplier =
        0.88;

      break;
  }

  return clampNormalizedValue(
    (
      0.46 +
      foregroundConfidence *
      0.54
    ) *
    clampNumber(
      anchor.weight,
      0,
      1.5
    ) *
    roleMultiplier
  );
}

/**
 * نقل Anchor إلى أقرب نقطة داخلية موثوقة.
 *
 * الـAnchor الهندسية ممتازة للتوزيع،
 * لكن قد تقع أحيانًا فوق فتحة أو فراغ بين ساقين.
 */
function snapAnchorToNearestInteriorPoint(
  anchorPoint:
    EdgeSamPixelPoint,
  interiorPoints:
    readonly EdgeSamPixelPoint[],
  boundingBox:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number,
  maximumNormalizedDistance =
    0.12
): EdgeSamPixelPoint {
  if (
    interiorPoints.length ===
    0
  ) {
    return movePointInsideBox(
      anchorPoint,
      boundingBox,
      0.025
    );
  }

  let nearestPoint:
    EdgeSamPixelPoint | null =
      null;

  let nearestDistance =
    Number.POSITIVE_INFINITY;

  for (
    const candidate
    of interiorPoints
  ) {
    if (
      !isPointInsideCoordinateBox(
        candidate,
        boundingBox,
        true
      )
    ) {
      continue;
    }

    const distance =
      calculateNormalizedPointDistance(
        anchorPoint,
        candidate,
        imageWidth,
        imageHeight
      );

    if (
      distance <
      nearestDistance
    ) {
      nearestDistance =
        distance;

      nearestPoint =
        candidate;
    }
  }

  if (
    nearestPoint &&
    nearestDistance <=
      maximumNormalizedDistance
  ) {
    return interpolatePoint(
      anchorPoint,
      nearestPoint,
      0.68
    );
  }

  return movePointInsideBox(
    anchorPoint,
    boundingBox,
    0.03
  );
}

/**
 * ترتيب Anchors حسب الأهمية.
 */
function sortProfileAnchorsByPriority(
  anchors:
    readonly SummerClothingPromptAnchor[]
): SummerClothingPromptAnchor[] {
  const rolePriority:
    Record<
      SummerClothingPromptAnchor['role'],
      number
    > = {
      core:
        100,

      'left-leg':
        94,

      'right-leg':
        94,

      sole:
        92,

      toe:
        90,

      heel:
        90,

      'accessory-center':
        90,

      handle:
        84,

      strap:
        84,

      crown:
        84,

      brim:
        82,

      'left-extension':
        78,

      'right-extension':
        78,

      'top-extension':
        76,

      'bottom-extension':
        76,
    };

  return anchors
    .slice()
    .sort(
      (
        first,
        second
      ) => {
        const firstScore =
          (
            rolePriority[
              first.role
            ] ??
            0
          ) +
          first.weight *
          10;

        const secondScore =
          (
            rolePriority[
              second.role
            ] ??
            0
          ) +
          second.weight *
          10;

        return (
          secondScore -
          firstScore
        );
      }
    );
}

/**
 * توزيع خاص لفردة حذاء واحدة من الجانب.
 *
 * يضع النقاط داخل جسم الحذاء بعيدًا عن الأرضية،
 * مع تغطية منطقة الكعب والمقدمة والنعل.
 */
function createSingleFootwearPositivePoints(
  box:
    EdgeSamCoordinateBox,
  foreground:
    ForegroundEstimate,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint[] {
  const width =
    getCoordinateBoxWidth(
      box
    );

  const height =
    getCoordinateBoxHeight(
      box
    );

  const center =
    createPixelPoint(
      box.x1 +
        width *
        0.5,
      box.y1 +
        height *
        0.43
    );

  const heel =
    createPixelPoint(
      box.x1 +
        width *
        0.27,
      box.y1 +
        height *
        0.44
    );

  const toe =
    createPixelPoint(
      box.x1 +
        width *
        0.73,
      box.y1 +
        height *
        0.47
    );

  const upper =
    createPixelPoint(
      box.x1 +
        width *
        0.5,
      box.y1 +
        height *
        0.29
    );

  const sole =
    createPixelPoint(
      box.x1 +
        width *
        0.5,
      box.y1 +
        height *
        0.61
    );

  return [
    snapAnchorToNearestInteriorPoint(
      center,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.12
    ),

    snapAnchorToNearestInteriorPoint(
      heel,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.13
    ),

    snapAnchorToNearestInteriorPoint(
      toe,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.13
    ),

    snapAnchorToNearestInteriorPoint(
      upper,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.12
    ),

    snapAnchorToNearestInteriorPoint(
      sole,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.11
    ),
  ];
}

/* =========================================================
 * Specialized positive prompt patterns
 * ======================================================= */

/**
 * توزيع خاص لزوج أحذية أو منطقتين أفقيتين.
 */
function createSeparatedHorizontalPositivePoints(
  box:
    EdgeSamCoordinateBox,
  foreground:
    ForegroundEstimate,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint[] {
  const width =
    getCoordinateBoxWidth(
      box
    );

  const height =
    getCoordinateBoxHeight(
      box
    );

  const leftRegionCenter =
    createPixelPoint(
      box.x1 +
      width *
      0.28,
      box.y1 +
      height *
      0.5
    );

  const rightRegionCenter =
    createPixelPoint(
      box.x1 +
      width *
      0.72,
      box.y1 +
      height *
      0.5
    );

  const lowerCenter =
    createPixelPoint(
      box.x1 +
      width *
      0.5,
      box.y1 +
      height *
      0.72
    );

  return [
    snapAnchorToNearestInteriorPoint(
      leftRegionCenter,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.16
    ),

    snapAnchorToNearestInteriorPoint(
      rightRegionCenter,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.16
    ),

    snapAnchorToNearestInteriorPoint(
      lowerCenter,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.14
    ),
  ];
}

/**
 * توزيع خاص للبناطيل والشورت ذي الساقين.
 */
function createTwoLegPositivePoints(
  box:
    EdgeSamCoordinateBox,
  foreground:
    ForegroundEstimate,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint[] {
  const width =
    getCoordinateBoxWidth(
      box
    );

  const height =
    getCoordinateBoxHeight(
      box
    );

  const upperCore =
    createPixelPoint(
      box.x1 +
      width *
      0.5,
      box.y1 +
      height *
      0.27
    );

  const leftLeg =
    createPixelPoint(
      box.x1 +
      width *
      0.34,
      box.y1 +
      height *
      0.68
    );

  const rightLeg =
    createPixelPoint(
      box.x1 +
      width *
      0.66,
      box.y1 +
      height *
      0.68
    );

  return [
    snapAnchorToNearestInteriorPoint(
      upperCore,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.13
    ),

    snapAnchorToNearestInteriorPoint(
      leftLeg,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.14
    ),

    snapAnchorToNearestInteriorPoint(
      rightLeg,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.14
    ),
  ];
}

/**
 * توزيع خاص للملابس العلوية.
 */
function createUpperBodyPositivePoints(
  box:
    EdgeSamCoordinateBox,
  foreground:
    ForegroundEstimate,
  imageWidth:
    number,
  imageHeight:
    number,
  wide:
    boolean
): EdgeSamPixelPoint[] {
  const width =
    getCoordinateBoxWidth(
      box
    );

  const height =
    getCoordinateBoxHeight(
      box
    );

  /**
   * القطع الواسعة تحتاج نقاط أقرب للأكمام،
   * بينما القطع العادية تكون النقاط أقرب للجسم.
   */
  const upperSideRatio =
    wide
      ? 0.2
      : 0.27;

  const lowerSideRatio =
    wide
      ? 0.3
      : 0.34;

  const upperCore =
    createPixelPoint(
      box.x1 +
        width *
          0.5,
      box.y1 +
        height *
          0.26
    );

  const centerCore =
    createPixelPoint(
      box.x1 +
        width *
          0.5,
      box.y1 +
        height *
          0.47
    );

  const leftUpper =
    createPixelPoint(
      box.x1 +
        width *
          upperSideRatio,
      box.y1 +
        height *
          0.35
    );

  const rightUpper =
    createPixelPoint(
      box.x1 +
        width *
          (
            1 -
            upperSideRatio
          ),
      box.y1 +
        height *
          0.35
    );

  const leftLower =
    createPixelPoint(
      box.x1 +
        width *
          lowerSideRatio,
      box.y1 +
        height *
          0.67
    );

  const rightLower =
    createPixelPoint(
      box.x1 +
        width *
          (
            1 -
            lowerSideRatio
          ),
      box.y1 +
        height *
          0.67
    );

  const lowerCore =
    createPixelPoint(
      box.x1 +
        width *
          0.5,
      box.y1 +
        height *
          0.78
    );

  return [
    /**
     * أعلى الصدر:
     * بعيد قليلًا عن الياقة حتى لا تدخل النقطة
     * داخل فتحة الرقبة أو الخلفية.
     */
    snapAnchorToNearestInteriorPoint(
      upperCore,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.09
    ),

    /**
     * قلب القطعة هو أقوى Positive Point.
     */
    snapAnchorToNearestInteriorPoint(
      centerCore,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.085
    ),

    /**
     * الكتف والكم الأيسر.
     */
    snapAnchorToNearestInteriorPoint(
      leftUpper,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      wide
        ? 0.105
        : 0.095
    ),

    /**
     * الكتف والكم الأيمن.
     */
    snapAnchorToNearestInteriorPoint(
      rightUpper,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      wide
        ? 0.105
        : 0.095
    ),

    /**
     * الجزء السفلي الأيسر من جسم القطعة.
     */
    snapAnchorToNearestInteriorPoint(
      leftLower,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.09
    ),

    /**
     * الجزء السفلي الأيمن من جسم القطعة.
     */
    snapAnchorToNearestInteriorPoint(
      rightLower,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.09
    ),

    /**
     * أسفل المنتصف لتثبيت نهاية التيشيرت
     * أو القميص ومنع ضم الخلفية تحته.
     */
    snapAnchorToNearestInteriorPoint(
      lowerCore,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.085
    ),
  ];
}

/**
 * توزيع خاص للفساتين والتنانير.
 */
function createVerticalGarmentPositivePoints(
  box:
    EdgeSamCoordinateBox,
  foreground:
    ForegroundEstimate,
  imageWidth:
    number,
  imageHeight:
    number,
  wideBottom:
    boolean
): EdgeSamPixelPoint[] {
  const width =
    getCoordinateBoxWidth(
      box
    );

  const height =
    getCoordinateBoxHeight(
      box
    );

  const topCore =
    createPixelPoint(
      box.x1 +
      width *
      0.5,
      box.y1 +
      height *
      0.24
    );

  const middleCore =
    createPixelPoint(
      box.x1 +
      width *
      0.5,
      box.y1 +
      height *
      0.5
    );

  const bottomLeft =
    createPixelPoint(
      box.x1 +
      width *
      (
        wideBottom
          ? 0.28
          : 0.38
      ),
      box.y1 +
      height *
      0.8
    );

  const bottomRight =
    createPixelPoint(
      box.x1 +
      width *
      (
        wideBottom
          ? 0.72
          : 0.62
      ),
      box.y1 +
      height *
      0.8
    );

  return [
    snapAnchorToNearestInteriorPoint(
      topCore,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.13
    ),

    snapAnchorToNearestInteriorPoint(
      middleCore,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.13
    ),

    snapAnchorToNearestInteriorPoint(
      bottomLeft,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.15
    ),

    snapAnchorToNearestInteriorPoint(
      bottomRight,
      foreground
        .interiorPoints,
      box,
      imageWidth,
      imageHeight,
      0.15
    ),
  ];
}

/**
 * اختيار Pattern إضافي مناسب للقطعة.
 */
function createPatternSpecificPositivePoints(
  profile:
    SummerClothingPromptProfile,
  box:
    EdgeSamCoordinateBox,
  foreground:
    ForegroundEstimate,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint[] {
  switch (
    profile.pointPattern
  ) {
    case 'footwear-single':
      return createSingleFootwearPositivePoints(
        box,
        foreground,
        imageWidth,
        imageHeight
      );

    case 'footwear-pair':
      return createSeparatedHorizontalPositivePoints(
        box,
        foreground,
        imageWidth,
        imageHeight
      );

    case 'lower-body-two-leg':
      return createTwoLegPositivePoints(
        box,
        foreground,
        imageWidth,
        imageHeight
      );

    case 'upper-body-wide':
      return createUpperBodyPositivePoints(
        box,
        foreground,
        imageWidth,
        imageHeight,
        true
      );

    case 'upper-body-standard':
    case 'upper-body-sleeveless':
      return createUpperBodyPositivePoints(
        box,
        foreground,
        imageWidth,
        imageHeight,
        false
      );

    case 'dress-wide':
      return createVerticalGarmentPositivePoints(
        box,
        foreground,
        imageWidth,
        imageHeight,
        true
      );

    case 'dress-standard':
    case 'skirt-standard':
      return createVerticalGarmentPositivePoints(
        box,
        foreground,
        imageWidth,
        imageHeight,
        false
      );

    case 'lower-body-short':
    case 'bag-standard':
    case 'headwear-standard':
    case 'small-centered':
    case 'elongated-accessory':
    default:
      return [];
  }
}

/* =========================================================
 * Positive prompt generation
 * ======================================================= */

/**
 * إنشاء Positive Points من Profile Anchors.
 */
function createProfileAnchorPositivePoints(
  profile:
    SummerClothingPromptProfile,
  foreground:
    ForegroundEstimate,
  boundingBox:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamGeneratedPromptPoint[] {
  const candidates:
    EdgeSamGeneratedPromptPoint[] = [];

  const sortedAnchors =
    sortProfileAnchorsByPriority(
      profile
        .positiveAnchors
    );

  for (
    const anchor
    of sortedAnchors
  ) {
    const rawPoint =
      anchorToPixelPoint(
        anchor,
        boundingBox
      );

    const snappedPoint =
      snapAnchorToNearestInteriorPoint(
        rawPoint,
        foreground
          .interiorPoints,
        boundingBox,
        imageWidth,
        imageHeight,
        profile
          .preserveThinStructures
          ? 0.17
          : 0.12
      );

    appendPositivePromptCandidate(
      candidates,
      snappedPoint,
      'profile-anchor',
      calculateProfileAnchorConfidence(
        anchor,
        profile,
        foreground.confidence
      ),
      imageWidth,
      imageHeight
    );
  }

  return candidates;
}

/**
 * إنشاء Positive Points من أفضل Pixels المكتشفة.
 */
function createDetectedPositivePoints(
  foreground:
    ForegroundEstimate,
  boundingBox:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamGeneratedPromptPoint[] {
  const candidates:
    EdgeSamGeneratedPromptPoint[] = [];

  for (
    let index = 0;
    index <
      foreground
        .strongPoints
        .length;
    index +=
      1
  ) {
    const point =
      foreground
        .strongPoints[
        index
      ];

    if (
      !isPointInsideCoordinateBox(
        point,
        boundingBox,
        true
      )
    ) {
      continue;
    }

    appendPositivePromptCandidate(
      candidates,
      point,
      'foreground-peak',
      clampNormalizedValue(
        0.94 -
        index *
        0.012
      ),
      imageWidth,
      imageHeight
    );
  }

  for (
    let index = 0;
    index <
      foreground
        .interiorPoints
        .length;
    index +=
      1
  ) {
    const point =
      foreground
        .interiorPoints[
        index
      ];

    if (
      !isPointInsideCoordinateBox(
        point,
        boundingBox,
        true
      )
    ) {
      continue;
    }

    appendPositivePromptCandidate(
      candidates,
      point,
      'foreground-interior',
      clampNormalizedValue(
        0.82 -
        index *
        0.008
      ),
      imageWidth,
      imageHeight
    );
  }

  return candidates;
}

/**
 * إنشاء Positive Points الخاصة بالـPattern.
 */
function createPatternPositivePromptPoints(
  profile:
    SummerClothingPromptProfile,
  foreground:
    ForegroundEstimate,
  boundingBox:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamGeneratedPromptPoint[] {
  const points =
    createPatternSpecificPositivePoints(
      profile,
      boundingBox,
      foreground,
      imageWidth,
      imageHeight
    );

  return points.map(
    (
      point,
      index
    ) =>
      createGeneratedPromptPoint({
        point,

        label:
          POSITIVE_POINT_LABEL,

        source:
          'profile-anchor',

        confidence:
          clampNormalizedValue(
            0.9 -
            index *
            0.035 +
            foreground
              .confidence *
            0.08
          ),

        imageWidth,

        imageHeight,
      })
  );
}

/**
 * إنشاء Positive Points النهائية.
 */
function generatePositivePromptPoints(
  profile:
    SummerClothingPromptProfile,
  foreground:
    ForegroundEstimate,
  boundingBox:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number,
  options:
    PositivePromptGenerationOptions
): {
  points:
    EdgeSamGeneratedPromptPoint[];

  warnings:
    string[];
} {
  const candidates:
    EdgeSamGeneratedPromptPoint[] = [];

  const warnings:
    string[] = [];

  if (
    options.includeSubjectCenter
  ) {
    const safeCenter =
      movePointInsideBox(
        foreground
          .weightedCentroid,
        boundingBox,
        0.035
      );

    appendPositivePromptCandidate(
      candidates,
      safeCenter,
      'subject-center',
      clampNormalizedValue(
        0.78 +
        foreground
          .confidence *
        0.2
      ),
      imageWidth,
      imageHeight
    );
  }

  if (
    options.includeProfileAnchors
  ) {
    candidates.push(
      ...createProfileAnchorPositivePoints(
        profile,
        foreground,
        boundingBox,
        imageWidth,
        imageHeight
      )
    );

    candidates.push(
      ...createPatternPositivePromptPoints(
        profile,
        foreground,
        boundingBox,
        imageWidth,
        imageHeight
      )
    );
  }

  if (
    options.includeStrongCandidates ||
    options.includeInteriorCandidates
  ) {
    const detectedCandidates =
      createDetectedPositivePoints(
        foreground,
        boundingBox,
        imageWidth,
        imageHeight
      );

    for (
      const candidate
      of detectedCandidates
    ) {
      if (
        candidate.source ===
          'foreground-peak' &&
        !options.includeStrongCandidates
      ) {
        continue;
      }

      if (
        candidate.source ===
          'foreground-interior' &&
        !options.includeInteriorCandidates
      ) {
        continue;
      }

      candidates.push(
        candidate
      );
    }
  }

  const validation =
    validateAndDeduplicatePromptPoints(
      candidates,
      imageWidth,
      imageHeight,
      {
        minimumNormalizedDistance:
          options
            .minimumNormalizedDistance,

        maximumCount:
          MAXIMUM_POSITIVE_POINT_COUNT,

        expectedKind:
          'positive',
      }
    );

  warnings.push(
    ...validation.warnings
  );

  let selectedPoints =
    selectSpatiallyDistributedPromptPoints(
      validation.points,
      options
        .maximumPointCount,
      imageWidth,
      imageHeight
    );

  /**
   * يجب أن توجد نقطة Positive واحدة على الأقل.
   */
  if (
    selectedPoints.length <
    MINIMUM_POSITIVE_POINT_COUNT
  ) {
    const fallbackPoint =
      movePointInsideBox(
        getCoordinateBoxCenter(
          boundingBox
        ),
        boundingBox,
        0.04
      );

    selectedPoints = [
      createGeneratedPromptPoint({
        point:
          fallbackPoint,

        label:
          POSITIVE_POINT_LABEL,

        source:
          'fallback-center',

        confidence:
          0.42,

        imageWidth,

        imageHeight,
      }),
    ];

    warnings.push(
      'Positive prompt generation used a fallback center point.'
    );
  }

  return {
    points:
      selectedPoints,

    warnings,
  };
}

/* =========================================================
 * Negative point geometry
 * ======================================================= */

/**
 * إنشاء نقاط زوايا الخلفية.
 */
function createBackgroundCornerPoints(
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint[] {
  const horizontalInset =
    Math.max(
      1,
      imageWidth *
      0.045
    );

  const verticalInset =
    Math.max(
      1,
      imageHeight *
      0.045
    );

  return [
    createPixelPoint(
      horizontalInset,
      verticalInset
    ),

    createPixelPoint(
      imageWidth -
        1 -
        horizontalInset,
      verticalInset
    ),

    createPixelPoint(
      horizontalInset,
      imageHeight -
        1 -
        verticalInset
    ),

    createPixelPoint(
      imageWidth -
        1 -
        horizontalInset,
      imageHeight -
        1 -
        verticalInset
    ),
  ];
}

/**
 * إنشاء نقاط منتصف حواف الصورة.
 */
function createBackgroundEdgePoints(
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamPixelPoint[] {
  const horizontalInset =
    Math.max(
      1,
      imageWidth *
      0.025
    );

  const verticalInset =
    Math.max(
      1,
      imageHeight *
      0.025
    );

  return [
    createPixelPoint(
      imageWidth *
      0.5,
      verticalInset
    ),

    createPixelPoint(
      imageWidth *
      0.5,
      imageHeight -
        1 -
        verticalInset
    ),

    createPixelPoint(
      horizontalInset,
      imageHeight *
      0.5
    ),

    createPixelPoint(
      imageWidth -
        1 -
        horizontalInset,
      imageHeight *
      0.5
    ),
  ];
}

/**
 * إنشاء نقاط خارج Bounding Box مباشرة.
 */
function createBoxExteriorPoints(
  box:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number,
  safetyMarginRatio:
    number
): EdgeSamPixelPoint[] {
  const boxWidth =
    getCoordinateBoxWidth(
      box
    );

  const boxHeight =
    getCoordinateBoxHeight(
      box
    );

  const horizontalMargin =
    Math.max(
      imageWidth *
        safetyMarginRatio,
      boxWidth *
        0.055,
      3
    );

  const verticalMargin =
    Math.max(
      imageHeight *
        safetyMarginRatio,
      boxHeight *
        0.055,
      3
    );

  const center =
    getCoordinateBoxCenter(
      box
    );

  const rawPoints = [
    createPixelPoint(
      center.x,
      box.y1 -
        verticalMargin
    ),

    createPixelPoint(
      center.x,
      box.y2 +
        verticalMargin
    ),

    createPixelPoint(
      box.x1 -
        horizontalMargin,
      center.y
    ),

    createPixelPoint(
      box.x2 +
        horizontalMargin,
      center.y
    ),

    createPixelPoint(
      box.x1 -
        horizontalMargin,
      box.y1 -
        verticalMargin
    ),

    createPixelPoint(
      box.x2 +
        horizontalMargin,
      box.y1 -
        verticalMargin
    ),

    createPixelPoint(
      box.x1 -
        horizontalMargin,
      box.y2 +
        verticalMargin
    ),

    createPixelPoint(
      box.x2 +
        horizontalMargin,
      box.y2 +
        verticalMargin
    ),
  ];

  return rawPoints.map(
    point =>
      clampPixelPointToImage(
        point,
        imageWidth,
        imageHeight
      )
  );
}

/**
 * هل Negative Point آمنة بالنسبة للـForeground Box.
 */
function isSafeNegativePoint(
  point:
    EdgeSamPixelPoint,
  foregroundBox:
    EdgeSamCoordinateBox,
  imageWidth:
    number,
  imageHeight:
    number,
  safetyMarginRatio:
    number
): boolean {
  if (
    !isPointInsideImage(
      point,
      imageWidth,
      imageHeight
    )
  ) {
    return false;
  }

  if (
    isPointInsideCoordinateBox(
      point,
      foregroundBox,
      true
    )
  ) {
    return false;
  }

  const safetyMarginPixels =
    Math.max(
      2,
      Math.min(
        imageWidth,
        imageHeight
      ) *
      safetyMarginRatio
    );

  if (
    isPointNearBoxBoundary(
      point,
      foregroundBox,
      safetyMarginPixels
    )
  ) {
    return false;
  }

  return true;
}

/**
 * إبعاد Negative Point عن أقرب Positive Point.
 */
function isNegativePointSeparatedFromPositivePoints(
  negativePoint:
    EdgeSamPixelPoint,
  positivePoints:
    readonly EdgeSamGeneratedPromptPoint[],
  imageWidth:
    number,
  imageHeight:
    number,
  minimumNormalizedDistance:
    number
): boolean {
  for (
    const positivePoint
    of positivePoints
  ) {
    if (
      calculateNormalizedPointDistance(
        negativePoint,
        positivePoint,
        imageWidth,
        imageHeight
      ) <
      minimumNormalizedDistance
    ) {
      return false;
    }
  }

  return true;
}

/* =========================================================
 * Negative prompt generation
 * ======================================================= */

/**
 * إنشاء Negative Points النهائية.
 */
function generateNegativePromptPoints(
  profile:
    SummerClothingPromptProfile,
  foreground:
    ForegroundEstimate,
  boundingBox:
    EdgeSamCoordinateBox,
  positivePoints:
    readonly EdgeSamGeneratedPromptPoint[],
  imageWidth:
    number,
  imageHeight:
    number,
  options:
    NegativePromptGenerationOptions
): {
  points:
    EdgeSamGeneratedPromptPoint[];

  warnings:
    string[];
} {
  const candidates:
    EdgeSamGeneratedPromptPoint[] = [];

  const warnings:
    string[] = [];

  const safeMarginRatio =
    Math.max(
      DEFAULT_BOUNDARY_SAFETY_MARGIN_RATIO,
      options
        .boundarySafetyRatio,
      profile
        .boundarySafetyRatio
    );

  const tryAppendPoint = (
    point:
      EdgeSamPixelPoint,
    source:
      EdgeSamPromptPointSource,
    confidence:
      number
  ): void => {
    if (
      !isSafeNegativePoint(
        point,
        boundingBox,
        imageWidth,
        imageHeight,
        safeMarginRatio
      )
    ) {
      return;
    }

    if (
      !isNegativePointSeparatedFromPositivePoints(
        point,
        positivePoints,
        imageWidth,
        imageHeight,
        Math.max(
          0.035,
          options
            .minimumNormalizedDistance
        )
      )
    ) {
      return;
    }

    appendNegativePromptCandidate(
      candidates,
      point,
      source,
      confidence,
      imageWidth,
      imageHeight
    );
  };

  if (
    options.includeCorners
  ) {
    for (
      const point
      of createBackgroundCornerPoints(
        imageWidth,
        imageHeight
      )
    ) {
      tryAppendPoint(
        point,
        'background-corner',
        0.92
      );
    }
  }

  if (
    options.includeEdges
  ) {
    for (
      const point
      of createBackgroundEdgePoints(
        imageWidth,
        imageHeight
      )
    ) {
      tryAppendPoint(
        point,
        'background-edge',
        0.86
      );
    }
  }

  if (
    options.includeBoxExterior
  ) {
    for (
      const point
      of createBoxExteriorPoints(
        boundingBox,
        imageWidth,
        imageHeight,
        safeMarginRatio
      )
    ) {
      tryAppendPoint(
        point,
        'box-exterior',
        0.82
      );
    }
  }

  /**
   * عند لمس القطعة إحدى الحواف،
   * لا نضع نقطة سالبة على نفس الحافة.
   */
  const filteredCandidates =
    candidates.filter(
      point => {
        const normalized =
          pixelPointToNormalizedPoint(
            point,
            imageWidth,
            imageHeight
          );

        if (
          foreground.touchesLeft &&
          normalized.x <
            0.08
        ) {
          return false;
        }

        if (
          foreground.touchesRight &&
          normalized.x >
            0.92
        ) {
          return false;
        }

        if (
          foreground.touchesTop &&
          normalized.y <
            0.08
        ) {
          return false;
        }

        if (
          foreground.touchesBottom &&
          normalized.y >
            0.92
        ) {
          return false;
        }

        return true;
      }
    );

  const validation =
    validateAndDeduplicatePromptPoints(
      filteredCandidates,
      imageWidth,
      imageHeight,
      {
        minimumNormalizedDistance:
          options
            .minimumNormalizedDistance,

        maximumCount:
          MAXIMUM_NEGATIVE_POINT_COUNT,

        expectedKind:
          'negative',
      }
    );

  warnings.push(
    ...validation.warnings
  );

  let selectedPoints =
    selectSpatiallyDistributedPromptPoints(
      validation.points,
      options
        .maximumPointCount,
      imageWidth,
      imageHeight
    );

  if (
    selectedPoints.length ===
    0
  ) {
    const fallbackCandidates =
      createBackgroundCornerPoints(
        imageWidth,
        imageHeight
      );

    for (
      const fallbackPoint
      of fallbackCandidates
    ) {
      if (
        isPointInsideCoordinateBox(
          fallbackPoint,
          boundingBox,
          true
        )
      ) {
        continue;
      }

      selectedPoints.push(
        createGeneratedPromptPoint({
          point:
            fallbackPoint,

          label:
            NEGATIVE_POINT_LABEL,

          source:
            'fallback-background',

          confidence:
            0.5,

          imageWidth,

          imageHeight,
        })
      );

      break;
    }

    if (
      selectedPoints.length >
      0
    ) {
      warnings.push(
        'Negative prompt generation used a fallback background point.'
      );
    }
  }

  return {
    points:
      selectedPoints,

    warnings,
  };
}

/* =========================================================
 * Bounding box generation
 * ======================================================= */

/**
 * توسيع Box حسب Profile مع حماية الحواف.
 */
function expandPromptBoundingBoxForProfile(
  box:
    EdgeSamCoordinateBox,
  profile:
    SummerClothingPromptProfile,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamCoordinateBox {
  let horizontalExpansion =
    profile
      .horizontalExpansionRatio;

  let verticalExpansion =
    profile
      .verticalExpansionRatio;

  if (
    profile
      .preserveThinStructures
  ) {
    horizontalExpansion +=
      0.012;

    verticalExpansion +=
      0.012;
  }

  if (
    profile.family ===
      'footwear'
  ) {
    verticalExpansion +=
      0.018;
  }

  if (
    profile.family ===
      'bag'
  ) {
    verticalExpansion +=
      0.012;
  }

  if (
    profile.family ===
      'small-accessory'
  ) {
    horizontalExpansion +=
      0.018;

    verticalExpansion +=
      0.018;
  }

  return clampCoordinateBoxToImage(
    expandCoordinateBox(
      box,
      horizontalExpansion,
      verticalExpansion
    ),
    imageWidth,
    imageHeight
  );
}

/**
 * ضمان أن جميع Positive Points داخل الـBox.
 */
function includePositivePointsInBoundingBox(
  box:
    EdgeSamCoordinateBox,
  positivePoints:
    readonly EdgeSamGeneratedPromptPoint[],
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamCoordinateBox {
  const pointsBox =
    createCoordinateBoxFromPoints(
      positivePoints
    );

  if (
    !pointsBox
  ) {
    return box;
  }

  const expandedPointsBox =
    expandCoordinateBoxByPixels(
      pointsBox,
      Math.max(
        2,
        imageWidth *
        0.012
      ),
      Math.max(
        2,
        imageHeight *
        0.012
      )
    );

  return clampCoordinateBoxToImage(
    unionCoordinateBoxes(
      box,
      expandedPointsBox
    ),
    imageWidth,
    imageHeight
  );
}

function tightenPromptBoundingBoxForProfile(
  sourceBox:
    EdgeSamCoordinateBox,
  profile:
    SummerClothingPromptProfile,
  positivePoints:
    readonly EdgeSamGeneratedPromptPoint[],
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamCoordinateBox {
  const boxWidth =
    getCoordinateBoxWidth(
      sourceBox
    );

  const boxHeight =
    getCoordinateBoxHeight(
      sourceBox
    );

  if (
    boxWidth <= 0 ||
    boxHeight <= 0
  ) {
    return clampCoordinateBoxToImage(
      sourceBox,
      imageWidth,
      imageHeight
    );
  }

  /**
   * نستخدم فقط النقاط الموجودة فعلًا داخل
   * صندوق الـForeground الأساسي.
   */
  const reliablePoints =
    positivePoints.filter(
      point =>
        isPointInsideCoordinateBox(
          point,
          sourceBox,
          true
        )
    );

  let pointMinimumX =
    Number.POSITIVE_INFINITY;

  let pointMinimumY =
    Number.POSITIVE_INFINITY;

  let pointMaximumX =
    Number.NEGATIVE_INFINITY;

  let pointMaximumY =
    Number.NEGATIVE_INFINITY;

  for (
    const point of
      reliablePoints
  ) {
    pointMinimumX =
      Math.min(
        pointMinimumX,
        point.x
      );

    pointMinimumY =
      Math.min(
        pointMinimumY,
        point.y
      );

    pointMaximumX =
      Math.max(
        pointMaximumX,
        point.x
      );

    pointMaximumY =
      Math.max(
        pointMaximumY,
        point.y
      );
  }

  const hasPointEnvelope =
    reliablePoints.length >=
      3 &&
    Number.isFinite(
      pointMinimumX
    ) &&
    Number.isFinite(
      pointMinimumY
    ) &&
    Number.isFinite(
      pointMaximumX
    ) &&
    Number.isFinite(
      pointMaximumY
    );

  /**
   * مقدار المساحة المحيطة بالنقاط.
   *
   * الملابس الواسعة تحتاج Padding أكبر،
   * والإكسسوارات تحتاج صندوقًا أكثر إحكامًا.
   */
  let horizontalPaddingRatio =
    0.16;

  let verticalPaddingRatio =
    0.15;

  let maximumWidthRatio =
    1;

  let maximumHeightRatio =
    1;

  switch (
    profile.pointPattern
  ) {
    case 'upper-body-wide':
      horizontalPaddingRatio =
        0.2;

      verticalPaddingRatio =
        0.16;

      maximumWidthRatio =
        0.9;

      maximumHeightRatio =
        0.9;

      break;

    case 'upper-body-standard':
    case 'upper-body-sleeveless':
      horizontalPaddingRatio =
        0.17;

      verticalPaddingRatio =
        0.15;

      maximumWidthRatio =
        0.82;

      maximumHeightRatio =
        0.88;

      break;

    case 'lower-body-two-leg':
      horizontalPaddingRatio =
        0.18;

      verticalPaddingRatio =
        0.13;

      maximumWidthRatio =
        0.82;

      maximumHeightRatio =
        0.94;

      break;

    case 'lower-body-short':
      horizontalPaddingRatio =
        0.18;

      verticalPaddingRatio =
        0.17;

      maximumWidthRatio =
        0.86;

      maximumHeightRatio =
        0.86;

      break;

    case 'dress-wide':
      horizontalPaddingRatio =
        0.2;

      verticalPaddingRatio =
        0.13;

      maximumWidthRatio =
        0.9;

      maximumHeightRatio =
        0.95;

      break;

    case 'dress-standard':
    case 'skirt-standard':
      horizontalPaddingRatio =
        0.17;

      verticalPaddingRatio =
        0.14;

      maximumWidthRatio =
        0.84;

      maximumHeightRatio =
        0.94;

      break;

    case 'bag-standard':
      horizontalPaddingRatio =
        0.18;

      verticalPaddingRatio =
        0.2;

      maximumWidthRatio =
        0.82;

      maximumHeightRatio =
        0.84;

      break;

    case 'headwear-standard':
      horizontalPaddingRatio =
        0.19;

      verticalPaddingRatio =
        0.19;

      maximumWidthRatio =
        0.8;

      maximumHeightRatio =
        0.82;

      break;

    case 'small-centered':
    case 'elongated-accessory':
      horizontalPaddingRatio =
        0.22;

      verticalPaddingRatio =
        0.22;

      maximumWidthRatio =
        0.78;

      maximumHeightRatio =
        0.78;

      break;

    case 'footwear-single':
    case 'footwear-pair':
      /**
       * الكوتشي نجح بالفعل، فلا نضغط صندوقه
       * بنفس قوة باقي الفئات.
       */
      horizontalPaddingRatio =
        0.2;

      verticalPaddingRatio =
        0.18;

      maximumWidthRatio =
        0.96;

      maximumHeightRatio =
        0.94;

      break;

    default:
      break;
  }

  if (
    !hasPointEnvelope
  ) {
    return clampCoordinateBoxToImage(
      sourceBox,
      imageWidth,
      imageHeight
    );
  }

  const pointEnvelopeWidth =
    Math.max(
      1,
      pointMaximumX -
        pointMinimumX
    );

  const pointEnvelopeHeight =
    Math.max(
      1,
      pointMaximumY -
        pointMinimumY
    );

  const horizontalPadding =
    Math.max(
      boxWidth *
        0.035,
      pointEnvelopeWidth *
        horizontalPaddingRatio
    );

  const verticalPadding =
    Math.max(
      boxHeight *
        0.035,
      pointEnvelopeHeight *
        verticalPaddingRatio
    );

  let tightenedBox =
    createCoordinateBox(
      pointMinimumX -
        horizontalPadding,
      pointMinimumY -
        verticalPadding,
      pointMaximumX +
        horizontalPadding,
      pointMaximumY +
        verticalPadding
    );

  /**
   * منع صندوق النقاط من التمدد لمساحة ضخمة
   * من صندوق الـForeground الأصلي.
   */
  const tightenedWidth =
    getCoordinateBoxWidth(
      tightenedBox
    );

  const tightenedHeight =
    getCoordinateBoxHeight(
      tightenedBox
    );

  const center =
    getCoordinateBoxCenter(
      tightenedBox
    );

  const maximumWidth =
    boxWidth *
    maximumWidthRatio;

  const maximumHeight =
    boxHeight *
    maximumHeightRatio;

  if (
    tightenedWidth >
    maximumWidth
  ) {
    tightenedBox =
      createCoordinateBox(
        center.x -
          maximumWidth /
            2,
        tightenedBox.y1,
        center.x +
          maximumWidth /
            2,
        tightenedBox.y2
      );
  }

  if (
    tightenedHeight >
    maximumHeight
  ) {
    const updatedCenter =
      getCoordinateBoxCenter(
        tightenedBox
      );

    tightenedBox =
      createCoordinateBox(
        tightenedBox.x1,
        updatedCenter.y -
          maximumHeight /
            2,
        tightenedBox.x2,
        updatedCenter.y +
          maximumHeight /
            2
      );
  }

  /**
   * لا نسمح للصندوق الجديد بالخروج خارج
   * الـForeground الأساسي.
   */
  tightenedBox =
    createCoordinateBox(
      Math.max(
        sourceBox.x1,
        tightenedBox.x1
      ),
      Math.max(
        sourceBox.y1,
        tightenedBox.y1
      ),
      Math.min(
        sourceBox.x2,
        tightenedBox.x2
      ),
      Math.min(
        sourceBox.y2,
        tightenedBox.y2
      )
    );

  return clampCoordinateBoxToImage(
    tightenedBox,
    imageWidth,
    imageHeight
  );
}

/**
 * إنشاء Bounding Box النهائي للـPrompt.
 */
function buildPromptBoundingBox(
  profile:
    SummerClothingPromptProfile,
  foreground:
    ForegroundEstimate | null,
  positivePoints:
    readonly EdgeSamGeneratedPromptPoint[],
  imageWidth:
    number,
  imageHeight:
    number
): PromptBoxBuildResult {
  const warnings:
    string[] = [];

  let usedFallback =
    false;

  let box:
    EdgeSamCoordinateBox;

  if (
    foreground &&
    isValidPixelBounds(
      foreground.bounds
    )
  ) {
    /**
     * نبدأ من حدود الـForeground الحقيقية،
     * ثم نضيف هامش أمان مناسب لنوع القطعة.
     *
     * لا نضيّق الصندوق حول الـPositive Points
     * لأن ده ممكن يقص الأكمام أو الأطراف.
     */
    box =
      expandPromptBoundingBoxForProfile(
        pixelBoundsToCoordinateBox(
          foreground.bounds
        ),
        profile,
        imageWidth,
        imageHeight
      );
  } else {
    const fallbackBounds =
      createFallbackForegroundBounds(
        profile,
        imageWidth,
        imageHeight
      );

    box =
      expandPromptBoundingBoxForProfile(
        pixelBoundsToCoordinateBox(
          fallbackBounds
        ),
        profile,
        imageWidth,
        imageHeight
      );

    usedFallback =
      true;

    warnings.push(
      'Prompt bounding box used geometry-based fallback bounds.'
    );
  }

  /**
   * نسمح للنقاط الإيجابية القريبة من مركز
   * الصندوق بتوسيعه حتى لا تخرج الأكمام
   * أو أطراف القطعة الحقيقية خارجه.
   */
  const nearbyPositivePoints =
    positivePoints.filter(
      point => {
        if (
          isPointInsideCoordinateBox(
            point,
            box,
            true
          )
        ) {
          return true;
        }

        const normalizedDistance =
          calculateNormalizedPointDistance(
            point,
            getCoordinateBoxCenter(
              box
            ),
            imageWidth,
            imageHeight
          );

        return (
          normalizedDistance <=
          0.42
        );
      }
    );

  box =
    includePositivePointsInBoundingBox(
      box,
      nearbyPositivePoints,
      imageWidth,
      imageHeight
    );

  box =
    clampCoordinateBoxToImage(
      box,
      imageWidth,
      imageHeight
    );

  const validation =
    validateAndNormalizeBoundingBox(
      box,
      imageWidth,
      imageHeight
    );

  if (
    validation.warning
  ) {
    warnings.push(
      validation.warning
    );
  }

  if (
    validation.valid &&
    validation.box
  ) {
    return {
      box:
        validation.box,

      usedFallback,

      warnings,
    };
  }

  const fallbackBounds =
    createFallbackForegroundBounds(
      profile,
      imageWidth,
      imageHeight
    );

  const fallbackBox =
    expandPromptBoundingBoxForProfile(
      pixelBoundsToCoordinateBox(
        fallbackBounds
      ),
      profile,
      imageWidth,
      imageHeight
    );

  const fallbackValidation =
    validateAndNormalizeBoundingBox(
      fallbackBox,
      imageWidth,
      imageHeight
    );

  if (
    fallbackValidation.valid &&
    fallbackValidation.box
  ) {
    return {
      box:
        fallbackValidation.box,

      usedFallback:
        true,

      warnings: [
        ...warnings,
        'Prompt bounding box validation failed and fallback bounds were used.',
      ],
    };
  }

  const finalBox =
    clampCoordinateBoxToImage(
      createCoordinateBox(
        imageWidth *
          0.1,
        imageHeight *
          0.1,
        imageWidth *
          0.9,
        imageHeight *
          0.9
      ),
      imageWidth,
      imageHeight
    );

  return {
    box:
      finalBox,

    usedFallback:
      true,

    warnings: [
      ...warnings,
      'Prompt bounding box required the final image-centered fallback.',
    ],
  };
}

/* =========================================================
 * Prompt count configuration
 * ======================================================= */

/**
 * تحديد عدد Positive Points النهائي.
 */
function resolvePositivePromptPointCount(
  profile:
    SummerClothingPromptProfile,
  foreground:
    ForegroundEstimate
): number {
  let count =
    profile
      .preferredPositivePointCount;

  if (
    foreground.confidence <
    profile
      .minimumAutomaticConfidence
  ) {
    count =
      Math.max(
        2,
        count -
        1
      );
  }

  if (
    profile
      .supportsSeparatedRegions
  ) {
    count =
      Math.max(
        count,
        5
      );
  }

  if (
    profile
      .preserveThinStructures
  ) {
    count +=
      1;
  }

  return Math.max(
    MINIMUM_POSITIVE_POINT_COUNT,
    Math.min(
      MAXIMUM_POSITIVE_POINT_COUNT,
      count
    )
  );
}

/**
 * تحديد عدد Negative Points النهائي.
 */
function resolveNegativePromptPointCount(
  profile:
    SummerClothingPromptProfile,
  foreground:
    ForegroundEstimate
): number {
  let count =
    profile
      .preferredNegativePointCount;

  if (
    foreground.confidence <
    profile
      .minimumAutomaticConfidence
  ) {
    count +=
      1;
  }

  const touchedEdgeCount = [
    foreground.touchesLeft,
    foreground.touchesTop,
    foreground.touchesRight,
    foreground.touchesBottom,
  ].filter(
    Boolean
  ).length;

  count =
    Math.max(
      1,
      count -
      touchedEdgeCount
    );

  return Math.min(
    MAXIMUM_NEGATIVE_POINT_COUNT,
    count
  );
}

/* =========================================================
 * Prompt draft generation
 * ======================================================= */

/**
 * إنشاء Draft تلقائي كامل.
 */
function generateAutomaticPromptDraft(
  context:
    PromptGenerationContext,
  background:
    BackgroundEstimate,
  foreground:
    ForegroundEstimate | null
): GeneratedPromptDraft {
  const warnings:
    string[] = [];

  let usedFallback =
    false;

  let safeForeground =
    foreground;

  if (
    !safeForeground
  ) {
    safeForeground =
      createFallbackForegroundEstimate(
        context.profile,
        context.imageWidth,
        context.imageHeight,
        'Automatic foreground analysis did not return a usable result.'
      );

    usedFallback =
      true;
  }

  warnings.push(
    ...safeForeground
      .warnings
  );

  const preliminaryBoxResult =
    buildPromptBoundingBox(
      context.profile,
      safeForeground,
      [],
      context.imageWidth,
      context.imageHeight
    );

  warnings.push(
    ...preliminaryBoxResult
      .warnings
  );

  usedFallback =
    usedFallback ||
    preliminaryBoxResult
      .usedFallback;

  const positivePointCount =
    resolvePositivePromptPointCount(
      context.profile,
      safeForeground
    );

  const positiveResult =
    generatePositivePromptPoints(
      context.profile,
      safeForeground,
      preliminaryBoxResult
        .box,
      context.imageWidth,
      context.imageHeight,
      {
        maximumPointCount:
          positivePointCount,

        minimumNormalizedDistance:
          context.profile
            .preserveThinStructures
            ? 0.02
            : DEFAULT_MINIMUM_NORMALIZED_POINT_DISTANCE,

        includeSubjectCenter:
          true,

        includeProfileAnchors:
          true,

        includeStrongCandidates:
          true,

        includeInteriorCandidates:
          true,
      }
    );

  warnings.push(
    ...positiveResult
      .warnings
  );

  const finalBoxResult =
    buildPromptBoundingBox(
      context.profile,
      safeForeground,
      positiveResult.points,
      context.imageWidth,
      context.imageHeight
    );

  warnings.push(
    ...finalBoxResult
      .warnings
  );

  usedFallback =
    usedFallback ||
    finalBoxResult
      .usedFallback;

  const negativePointCount =
    resolveNegativePromptPointCount(
      context.profile,
      safeForeground
    );

  const negativeResult =
    generateNegativePromptPoints(
      context.profile,
      safeForeground,
      finalBoxResult.box,
      positiveResult.points,
      context.imageWidth,
      context.imageHeight,
      {
        maximumPointCount:
          negativePointCount,

        minimumNormalizedDistance:
          DEFAULT_MINIMUM_NORMALIZED_POINT_DISTANCE,

        boundarySafetyRatio:
          context.profile
            .boundarySafetyRatio,

        includeCorners:
          true,

        includeEdges:
          true,

        includeBoxExterior:
          true,
      }
    );

  warnings.push(
    ...negativeResult
      .warnings
  );

  const pointConfidence =
    calculateAverage([
      ...positiveResult
        .points
        .map(
          point =>
            point.confidence
        ),

      ...negativeResult
        .points
        .map(
          point =>
            point.confidence
        ),
    ]);

  const confidence =
    clampNormalizedValue(
      safeForeground
        .confidence *
        0.46 +
      background.confidence *
        0.2 +
      pointConfidence *
        0.24 +
      (
        finalBoxResult
          .usedFallback
          ? 0.32
          : 0.92
      ) *
        0.1
    );

  return {
    positivePoints:
      positiveResult.points,

    negativePoints:
      negativeResult.points,

    boundingBox:
      context.profile
        .preferBoundingBox
        ? finalBoxResult
            .box
        : null,

    foreground:
      safeForeground,

    background,

    confidence,

    warnings,

    usedFallback,

    profileId:
      context.profile.id,
  };
}

/* =========================================================
 * Prompt draft diagnostics
 * ======================================================= */

/**
 * ملخص Draft لأغراض Debug.
 */
function getPromptDraftDebugSummary(
  draft:
    GeneratedPromptDraft
): string {
  const boxSummary =
    draft.boundingBox
      ? [
          draft.boundingBox
            .x1
            .toFixed(
              1
            ),
          draft.boundingBox
            .y1
            .toFixed(
              1
            ),
          draft.boundingBox
            .x2
            .toFixed(
              1
            ),
          draft.boundingBox
            .y2
            .toFixed(
              1
            ),
        ].join(
          ','
        )
      : 'none';

  return [
    `profile=${draft.profileId}`,
    `positive=${draft.positivePoints.length}`,
    `negative=${draft.negativePoints.length}`,
    `box=${boxSummary}`,
    `confidence=${draft.confidence.toFixed(
      3
    )}`,
    `fallback=${String(
      draft.usedFallback
    )}`,
    `warnings=${draft.warnings.length}`,
  ].join(
    ' | '
  );
}

/* =========================================================
 * End of Part 1.6
 * ======================================================= */
/* =========================================================
 * Manual prompt compatibility types
 * ======================================================= */

/**
 * صيغة مرنة لقراءة النقاط اليدوية.
 *
 * العقد الرسمي موجود في types.ts، لكننا نقرأ
 * القيم دفاعيًا لمنع انهيار المحرك لو وصلت
 * بيانات قديمة أو ناقصة من الـUI.
 */
type ManualPromptPointLike = {
  x?:
    number;

  y?:
    number;

  label?:
    number | string;

  kind?:
    string;

  confidence?:
    number;

  coordinateSpace?:
    string;
};

/**
 * صيغة مرنة لقراءة Bounding Box يدوي.
 */
type ManualPromptBoxLike = {
  box?: {
    x1?:
      number;

    y1?:
      number;

    x2?:
      number;

    y2?:
      number;
  };

  x1?:
    number;

  y1?:
    number;

  x2?:
    number;

  y2?:
    number;

  confidence?:
    number;

  expansionRatio?:
    number;

  coordinateSpace?:
    string;
};

type ResolvedManualPrompts = {
  positivePoints:
    EdgeSamGeneratedPromptPoint[];

  negativePoints:
    EdgeSamGeneratedPromptPoint[];

  boundingBox:
    EdgeSamCoordinateBox | null;

  warnings:
    string[];

  providedPointCount:
    number;

  acceptedPointCount:
    number;

  usedManualBoundingBox:
    boolean;
};

/* =========================================================
 * Coordinate space helpers
 * ======================================================= */

/**
 * التحقق من Coordinate Space.
 */
function isKnownPromptCoordinateSpace(
  value:
    unknown
): value is SegmentationCoordinateSpace {
  return (
    value ===
      'original-image' ||
    value ===
      'oriented-image' ||
    value ===
      'model-input' ||
    value ===
      'normalized'
  );
}

/**
 * تحديد Coordinate Space آمنة.
 */
function resolvePromptCoordinateSpace(
  value:
    unknown,
  fallback:
    SegmentationCoordinateSpace =
      'original-image'
): SegmentationCoordinateSpace {
  return isKnownPromptCoordinateSpace(
    value
  )
    ? value
    : fallback;
}

/**
 * إرجاع حجم Coordinate Space.
 */
function getCoordinateSpaceSize(
  coordinateSpace:
    SegmentationCoordinateSpace,
  transform:
    SegmentationTransform
): {
  width:
    number;

  height:
    number;
} {
  switch (
    coordinateSpace
  ) {
    case 'model-input':
      return {
        width:
          transform
            .modelInputSize
            .width,

        height:
          transform
            .modelInputSize
            .height,
      };

    case 'oriented-image':
      return {
        width:
          transform
            .orientedSize
            .width,

        height:
          transform
            .orientedSize
            .height,
      };

    case 'normalized':
      return {
        width:
          1,

        height:
          1,
      };

    case 'original-image':
    default:
      return {
        width:
          transform
            .originalSize
            .width,

        height:
          transform
            .originalSize
            .height,
      };
  }
}

/* =========================================================
 * Original ↔ oriented conversion
 * ======================================================= */

/**
 * تحويل نقطة من الصورة الأصلية إلى الصورة
 * بعد تصحيح EXIF orientation.
 */
function convertOriginalPointToOrientedPoint(
  point:
    EdgeSamPixelPoint,
  transform:
    SegmentationTransform
): EdgeSamPixelPoint {
  const originalWidth =
    transform
      .originalSize
      .width;

  const originalHeight =
    transform
      .originalSize
      .height;

  const orientedWidth =
    transform
      .orientedSize
      .width;

  const orientedHeight =
    transform
      .orientedSize
      .height;

  const maximumOriginalX =
    Math.max(
      0,
      originalWidth -
      1
    );

  const maximumOriginalY =
    Math.max(
      0,
      originalHeight -
      1
    );

  const maximumOrientedX =
    Math.max(
      0,
      orientedWidth -
      1
    );

  const maximumOrientedY =
    Math.max(
      0,
      orientedHeight -
      1
    );

  const safePoint =
    clampPixelPointToImage(
      point,
      originalWidth,
      originalHeight
    );

  switch (
    transform.orientationApplied
  ) {
    case 2:
      return {
        x:
          maximumOrientedX -
          safePoint.x,

        y:
          safePoint.y,
      };

    case 3:
      return {
        x:
          maximumOrientedX -
          safePoint.x,

        y:
          maximumOrientedY -
          safePoint.y,
      };

    case 4:
      return {
        x:
          safePoint.x,

        y:
          maximumOrientedY -
          safePoint.y,
      };

    case 5:
      return {
        x:
          safePoint.y,

        y:
          safePoint.x,
      };

    case 6:
      return {
        x:
          maximumOriginalY -
          safePoint.y,

        y:
          safePoint.x,
      };

    case 7:
      return {
        x:
          maximumOriginalY -
          safePoint.y,

        y:
          maximumOriginalX -
          safePoint.x,
      };

    case 8:
      return {
        x:
          safePoint.y,

        y:
          maximumOriginalX -
          safePoint.x,
      };

    case 1:
    default:
      return clampPixelPointToImage(
        safePoint,
        orientedWidth,
        orientedHeight
      );
  }
}

/**
 * التحويل العكسي من الصورة الموجّهة
 * إلى الصورة الأصلية.
 */
function convertOrientedPointToOriginalPoint(
  point:
    EdgeSamPixelPoint,
  transform:
    SegmentationTransform
): EdgeSamPixelPoint {
  const originalWidth =
    transform
      .originalSize
      .width;

  const originalHeight =
    transform
      .originalSize
      .height;

  const orientedWidth =
    transform
      .orientedSize
      .width;

  const orientedHeight =
    transform
      .orientedSize
      .height;

  const maximumOriginalX =
    Math.max(
      0,
      originalWidth -
      1
    );

  const maximumOriginalY =
    Math.max(
      0,
      originalHeight -
      1
    );

  const maximumOrientedX =
    Math.max(
      0,
      orientedWidth -
      1
    );

  const maximumOrientedY =
    Math.max(
      0,
      orientedHeight -
      1
    );

  const safePoint =
    clampPixelPointToImage(
      point,
      orientedWidth,
      orientedHeight
    );

  switch (
    transform.orientationApplied
  ) {
    case 2:
      return {
        x:
          maximumOriginalX -
          safePoint.x,

        y:
          safePoint.y,
      };

    case 3:
      return {
        x:
          maximumOriginalX -
          safePoint.x,

        y:
          maximumOriginalY -
          safePoint.y,
      };

    case 4:
      return {
        x:
          safePoint.x,

        y:
          maximumOriginalY -
          safePoint.y,
      };

    case 5:
      return {
        x:
          safePoint.y,

        y:
          safePoint.x,
      };

    case 6:
      return {
        x:
          safePoint.y,

        y:
          maximumOriginalY -
          safePoint.x,
      };

    case 7:
      return {
        x:
          maximumOriginalX -
          safePoint.y,

        y:
          maximumOriginalY -
          safePoint.x,
      };

    case 8:
      return {
        x:
          maximumOriginalX -
          safePoint.y,

        y:
          safePoint.x,
      };

    case 1:
    default:
      return clampPixelPointToImage(
        safePoint,
        originalWidth,
        originalHeight
      );
  }
}

/* =========================================================
 * Oriented ↔ model conversion
 * ======================================================= */

/**
 * تحويل نقطة من مساحة الصورة الموجهة
 * إلى مساحة Encoder Model Input.
 */
function convertOrientedPointToModelPoint(
  point:
    EdgeSamPixelPoint,
  transform:
    SegmentationTransform
): EdgeSamPixelPoint {
  const orientedWidth =
    transform
      .orientedSize
      .width;

  const orientedHeight =
    transform
      .orientedSize
      .height;

  const modelWidth =
    transform
      .modelInputSize
      .width;

  const modelHeight =
    transform
      .modelInputSize
      .height;

  const safePoint =
    clampPixelPointToImage(
      point,
      orientedWidth,
      orientedHeight
    );

  const scaleX =
    Number.isFinite(
      transform.scale.x
    ) &&
    transform.scale.x >
      0
      ? transform.scale.x
      : safeDivide(
          transform
            .resizedSize
            .width,
          orientedWidth,
          1
        );

  const scaleY =
    Number.isFinite(
      transform.scale.y
    ) &&
    transform.scale.y >
      0
      ? transform.scale.y
      : safeDivide(
          transform
            .resizedSize
            .height,
          orientedHeight,
          1
        );

  const modelPoint = {
    x:
      safePoint.x *
        scaleX +
      transform.padding.left,

    y:
      safePoint.y *
        scaleY +
      transform.padding.top,
  };

  return clampPixelPointToImage(
    modelPoint,
    modelWidth,
    modelHeight
  );
}

/**
 * التحويل العكسي من Model Input
 * إلى الصورة الموجهة.
 */
function convertModelPointToOrientedPoint(
  point:
    EdgeSamPixelPoint,
  transform:
    SegmentationTransform
): EdgeSamPixelPoint {
  const modelWidth =
    transform
      .modelInputSize
      .width;

  const modelHeight =
    transform
      .modelInputSize
      .height;

  const orientedWidth =
    transform
      .orientedSize
      .width;

  const orientedHeight =
    transform
      .orientedSize
      .height;

  const safePoint =
    clampPixelPointToImage(
      point,
      modelWidth,
      modelHeight
    );

  const scaleX =
    Number.isFinite(
      transform.scale.x
    ) &&
    transform.scale.x >
      0
      ? transform.scale.x
      : safeDivide(
          transform
            .resizedSize
            .width,
          orientedWidth,
          1
        );

  const scaleY =
    Number.isFinite(
      transform.scale.y
    ) &&
    transform.scale.y >
      0
      ? transform.scale.y
      : safeDivide(
          transform
            .resizedSize
            .height,
          orientedHeight,
          1
        );

  const orientedPoint = {
    x:
      safeDivide(
        safePoint.x -
          transform.padding.left,
        scaleX,
        0
      ),

    y:
      safeDivide(
        safePoint.y -
          transform.padding.top,
        scaleY,
        0
      ),
  };

  return clampPixelPointToImage(
    orientedPoint,
    orientedWidth,
    orientedHeight
  );
}

/* =========================================================
 * Generic point conversion
 * ======================================================= */

/**
 * تحويل نقطة من أي Coordinate Space
 * إلى مساحة الصورة الأصلية.
 */
function convertPointToOriginalImageSpace(
  point:
    EdgeSamPixelPoint,
  from:
    SegmentationCoordinateSpace,
  transform:
    SegmentationTransform
): EdgeSamPixelPoint {
  switch (
    from
  ) {
    case 'original-image':
      return clampPixelPointToImage(
        point,
        transform
          .originalSize
          .width,
        transform
          .originalSize
          .height
      );

    case 'oriented-image':
      return convertOrientedPointToOriginalPoint(
        point,
        transform
      );

    case 'model-input':
      return convertOrientedPointToOriginalPoint(
        convertModelPointToOrientedPoint(
          point,
          transform
        ),
        transform
      );

    case 'normalized': {
      const orientedPoint =
        normalizedPointToPixelPoint(
          createNormalizedPoint(
            point.x,
            point.y
          ),
          transform
            .orientedSize
            .width,
          transform
            .orientedSize
            .height
        );

      return convertOrientedPointToOriginalPoint(
        orientedPoint,
        transform
      );
    }

    default:
      return clampPixelPointToImage(
        point,
        transform
          .originalSize
          .width,
        transform
          .originalSize
          .height
      );
  }
}

/**
 * تحويل نقطة من مساحة الصورة الأصلية
 * إلى Coordinate Space مطلوبة.
 */
function convertOriginalPointToCoordinateSpace(
  point:
    EdgeSamPixelPoint,
  to:
    SegmentationCoordinateSpace,
  transform:
    SegmentationTransform
): EdgeSamPixelPoint {
  const originalPoint =
    clampPixelPointToImage(
      point,
      transform
        .originalSize
        .width,
      transform
        .originalSize
        .height
    );

  switch (
    to
  ) {
    case 'original-image':
      return originalPoint;

    case 'oriented-image':
      return convertOriginalPointToOrientedPoint(
        originalPoint,
        transform
      );

    case 'model-input':
      return convertOrientedPointToModelPoint(
        convertOriginalPointToOrientedPoint(
          originalPoint,
          transform
        ),
        transform
      );

    case 'normalized': {
      const orientedPoint =
        convertOriginalPointToOrientedPoint(
          originalPoint,
          transform
        );

      const normalizedPoint =
        pixelPointToNormalizedPoint(
          orientedPoint,
          transform
            .orientedSize
            .width,
          transform
            .orientedSize
            .height
        );

      return {
        x:
          normalizedPoint.x,

        y:
          normalizedPoint.y,
      };
    }

    default:
      return originalPoint;
  }
}

/**
 * تحويل نقطة بين أي مساحتين.
 */
function convertPromptPointCoordinateSpace(
  point:
    EdgeSamPixelPoint,
  from:
    SegmentationCoordinateSpace,
  to:
    SegmentationCoordinateSpace,
  transform:
    SegmentationTransform
): EdgeSamPixelPoint {
  if (
    from ===
    to
  ) {
    const size =
      getCoordinateSpaceSize(
        to,
        transform
      );

    if (
      to ===
      'normalized'
    ) {
      return {
        x:
          clampNormalizedValue(
            point.x
          ),

        y:
          clampNormalizedValue(
            point.y
          ),
      };
    }

    return clampPixelPointToImage(
      point,
      size.width,
      size.height
    );
  }

  const originalPoint =
    convertPointToOriginalImageSpace(
      point,
      from,
      transform
    );

  return convertOriginalPointToCoordinateSpace(
    originalPoint,
    to,
    transform
  );
}

/* =========================================================
 * Box coordinate conversion
 * ======================================================= */

/**
 * تحويل Bounding Box باستخدام تحويل
 * الأربع زوايا ثم استخراج Box جديدة.
 *
 * هذا الأسلوب آمن مع دوران EXIF.
 */
function convertPromptBoxCoordinateSpace(
  box:
    EdgeSamCoordinateBox,
  from:
    SegmentationCoordinateSpace,
  to:
    SegmentationCoordinateSpace,
  transform:
    SegmentationTransform
): EdgeSamCoordinateBox {
  const normalizedBox =
    createCoordinateBox(
      box.x1,
      box.y1,
      box.x2,
      box.y2
    );

  const corners: readonly EdgeSamPixelPoint[] = [
    {
      x:
        normalizedBox.x1,

      y:
        normalizedBox.y1,
    },
    {
      x:
        normalizedBox.x2,

      y:
        normalizedBox.y1,
    },
    {
      x:
        normalizedBox.x1,

      y:
        normalizedBox.y2,
    },
    {
      x:
        normalizedBox.x2,

      y:
        normalizedBox.y2,
    },
  ];

  const convertedCorners =
    corners.map(
      point =>
        convertPromptPointCoordinateSpace(
          point,
          from,
          to,
          transform
        )
    );

  const convertedBox =
    createCoordinateBoxFromPoints(
      convertedCorners
    );

  if (
    convertedBox
  ) {
    return convertedBox;
  }

  const targetSize =
    getCoordinateSpaceSize(
      to,
      transform
    );

  return createCoordinateBox(
    0,
    0,
    Math.max(
      0,
      targetSize.width -
      (
        to ===
        'normalized'
          ? 0
          : 1
      )
    ),
    Math.max(
      0,
      targetSize.height -
      (
        to ===
        'normalized'
          ? 0
          : 1
      )
    )
  );
}

/* =========================================================
 * Manual point parsing
 * ======================================================= */

/**
 * تحديد Label النقطة اليدوية.
 */
function resolveManualPointLabel(
  point:
    ManualPromptPointLike
):
  | typeof POSITIVE_POINT_LABEL
  | typeof NEGATIVE_POINT_LABEL
  | null {
  if (
    point.label ===
      POSITIVE_POINT_LABEL ||
    point.label ===
      '1' ||
    point.kind ===
      'positive'
  ) {
    return POSITIVE_POINT_LABEL;
  }

  if (
    point.label ===
      NEGATIVE_POINT_LABEL ||
    point.label ===
      '0' ||
    point.kind ===
      'negative'
  ) {
    return NEGATIVE_POINT_LABEL;
  }

  return null;
}

/**
 * قراءة نقطة يدوية واحدة وتحويلها
 * إلى مساحة الصورة الأصلية.
 */
function resolveManualPromptPoint(
  rawPoint:
    ManualPromptPointLike,
  transform:
    SegmentationTransform,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamGeneratedPromptPoint | null {
  if (
    !isFiniteNumber(
      rawPoint.x
    ) ||
    !isFiniteNumber(
      rawPoint.y
    )
  ) {
    return null;
  }

  const label =
    resolveManualPointLabel(
      rawPoint
    );

  if (
    label ===
    null
  ) {
    return null;
  }

  const coordinateSpace =
    resolvePromptCoordinateSpace(
      rawPoint
        .coordinateSpace,
      'original-image'
    );

  const originalPoint =
    convertPromptPointCoordinateSpace(
      {
        x:
          rawPoint.x,

        y:
          rawPoint.y,
      },
      coordinateSpace,
      'original-image',
      transform
    );

  if (
    !isPointInsideImage(
      originalPoint,
      imageWidth,
      imageHeight
    )
  ) {
    return null;
  }

  return createGeneratedPromptPoint({
    point:
      originalPoint,

    label,

    source:
      'manual',

    confidence:
      isFiniteNumber(
        rawPoint.confidence
      )
        ? clampNormalizedValue(
            rawPoint.confidence
          )
        : 1,

    imageWidth,

    imageHeight,
  });
}

/* =========================================================
 * Manual box parsing
 * ======================================================= */

/**
 * استخراج إحداثيات Box من الصيغة اليدوية.
 */
function readManualPromptBoxCoordinates(
  input:
    ManualPromptBoxLike
): EdgeSamCoordinateBox | null {
  const source =
    input.box ??
    input;

  if (
    !isFiniteNumber(
      source.x1
    ) ||
    !isFiniteNumber(
      source.y1
    ) ||
    !isFiniteNumber(
      source.x2
    ) ||
    !isFiniteNumber(
      source.y2
    )
  ) {
    return null;
  }

  const box =
    createCoordinateBox(
      source.x1,
      source.y1,
      source.x2,
      source.y2
    );

  return isValidCoordinateBox(
    box
  )
    ? box
    : null;
}

/**
 * قراءة Bounding Box يدوي وتحويله
 * إلى مساحة الصورة الأصلية.
 */
function resolveManualPromptBox(
  rawBox:
    ManualPromptBoxLike,
  transform:
    SegmentationTransform,
  imageWidth:
    number,
  imageHeight:
    number
): EdgeSamCoordinateBox | null {
  const box =
    readManualPromptBoxCoordinates(
      rawBox
    );

  if (
    !box
  ) {
    return null;
  }

  const coordinateSpace =
    resolvePromptCoordinateSpace(
      rawBox.coordinateSpace,
      'original-image'
    );

  const originalBox =
    convertPromptBoxCoordinateSpace(
      box,
      coordinateSpace,
      'original-image',
      transform
    );

  const validation =
    validateAndNormalizeBoundingBox(
      originalBox,
      imageWidth,
      imageHeight
    );

  return validation.box;
}

/* =========================================================
 * Manual prompt extraction
 * ======================================================= */

/**
 * استخراج الـManual Prompt من العقد الرسمي.
 */
function resolveManualPrompts(
  input:
    EdgeSamPromptGenerationInput,
  imageWidth:
    number,
  imageHeight:
    number
): ResolvedManualPrompts {
  const warnings:
    string[] = [];

  const positivePoints:
    EdgeSamGeneratedPromptPoint[] = [];

  const negativePoints:
    EdgeSamGeneratedPromptPoint[] = [];

  const manualPrompt =
    input.manualPrompt;

  if (
    !manualPrompt
  ) {
    return {
      positivePoints,

      negativePoints,

      boundingBox:
        null,

      warnings,

      providedPointCount:
        0,

      acceptedPointCount:
        0,

      usedManualBoundingBox:
        false,
    };
  }

  const rawPoints =
    Array.isArray(
      manualPrompt.points
    )
      ? manualPrompt.points
      : [];

  for (
    const rawPoint
    of rawPoints
  ) {
    const resolvedPoint =
      resolveManualPromptPoint(
        rawPoint as
          ManualPromptPointLike,
        input.transform,
        imageWidth,
        imageHeight
      );

    if (
      !resolvedPoint
    ) {
      warnings.push(
        'An invalid manual prompt point was ignored.'
      );

      continue;
    }

    if (
      resolvedPoint.kind ===
      'positive'
    ) {
      positivePoints.push(
        resolvedPoint
      );
    } else {
      negativePoints.push(
        resolvedPoint
      );
    }
  }

  const positiveValidation =
    validateAndDeduplicatePromptPoints(
      positivePoints,
      imageWidth,
      imageHeight,
      {
        minimumNormalizedDistance:
          Math.max(
            0.006,
            input.config
              .minimumPointDistanceRatio *
              0.5
          ),

        maximumCount:
          MAXIMUM_POSITIVE_POINT_COUNT,

        expectedKind:
          'positive',
      }
    );

  const negativeValidation =
    validateAndDeduplicatePromptPoints(
      negativePoints,
      imageWidth,
      imageHeight,
      {
        minimumNormalizedDistance:
          Math.max(
            0.006,
            input.config
              .minimumPointDistanceRatio *
              0.5
          ),

        maximumCount:
          MAXIMUM_NEGATIVE_POINT_COUNT,

        expectedKind:
          'negative',
      }
    );

  warnings.push(
    ...positiveValidation
      .warnings,
    ...negativeValidation
      .warnings
  );

  let boundingBox:
    EdgeSamCoordinateBox | null =
      null;

  let usedManualBoundingBox =
    false;

  if (
    manualPrompt.box
  ) {
    boundingBox =
      resolveManualPromptBox(
        manualPrompt.box as
          ManualPromptBoxLike,
        input.transform,
        imageWidth,
        imageHeight
      );

    if (
      boundingBox
    ) {
      usedManualBoundingBox =
        true;
    } else {
      warnings.push(
        'The manual bounding box was invalid and was ignored.'
      );
    }
  }

  return {
    positivePoints:
      positiveValidation.points,

    negativePoints:
      negativeValidation.points,

    boundingBox,

    warnings,

    providedPointCount:
      rawPoints.length,

    acceptedPointCount:
      positiveValidation
        .points.length +
      negativeValidation
        .points.length,

    usedManualBoundingBox,
  };
}

/* =========================================================
 * Manual and automatic point merge
 * ======================================================= */

/**
 * دمج النقاط اليدوية مع التلقائية.
 *
 * النقاط اليدوية لها الأولوية القصوى،
 * ثم نملأ العدد المتبقي بالنقاط التلقائية.
 */
function mergeManualAndAutomaticPoints(
  manualPoints:
    readonly EdgeSamGeneratedPromptPoint[],
  automaticPoints:
    readonly EdgeSamGeneratedPromptPoint[],
  kind:
    'positive' | 'negative',
  maximumCount:
    number,
  imageWidth:
    number,
  imageHeight:
    number,
  minimumNormalizedDistance:
    number
): {
  points:
    EdgeSamGeneratedPromptPoint[];

  warnings:
    string[];
} {
  const warnings:
    string[] = [];

  const manualValidation =
    validateAndDeduplicatePromptPoints(
      manualPoints,
      imageWidth,
      imageHeight,
      {
        minimumNormalizedDistance:
          minimumNormalizedDistance,

        maximumCount,

        expectedKind:
          kind,
      }
    );

  warnings.push(
    ...manualValidation
      .warnings
  );

  const selected:
    EdgeSamGeneratedPromptPoint[] =
      manualValidation
        .points
        .slice(
          0,
          maximumCount
        );

  if (
    selected.length >=
    maximumCount
  ) {
    return {
      points:
        selected,

      warnings,
    };
  }

  const rankedAutomatic =
    automaticPoints
      .filter(
        point =>
          point.kind ===
          kind
      )
      .slice()
      .sort(
        comparePromptPointPriority
      );

  for (
    const candidate
    of rankedAutomatic
  ) {
    let tooClose =
      false;

    for (
      const existing
      of selected
    ) {
      if (
        calculateNormalizedPointDistance(
          candidate,
          existing,
          imageWidth,
          imageHeight
        ) <
        minimumNormalizedDistance
      ) {
        tooClose =
          true;

        break;
      }
    }

    if (
      tooClose
    ) {
      continue;
    }

    selected.push(
      cloneGeneratedPromptPoint(
        candidate
      )
    );

    if (
      selected.length >=
      maximumCount
    ) {
      break;
    }
  }

  return {
    points:
      selected,

    warnings,
  };
}

/* =========================================================
 * Manual and automatic box merge
 * ======================================================= */

/**
 * دمج Box اليدوية مع Box التلقائية.
 *
 * اليدوية تستخدم كما هي، لكن نضمن احتواء
 * جميع Positive Points داخلها.
 */
function mergeManualAndAutomaticBoundingBox(
  manualBox:
    EdgeSamCoordinateBox | null,
  automaticBox:
    EdgeSamCoordinateBox | null,
  positivePoints:
    readonly EdgeSamGeneratedPromptPoint[],
  imageWidth:
    number,
  imageHeight:
    number
): {
  box:
    EdgeSamCoordinateBox | null;

  usedManualBox:
    boolean;

  warnings:
    string[];
} {
  const warnings:
    string[] = [];

  let box =
    manualBox ??
    automaticBox;

  if (
    !box
  ) {
    return {
      box:
        null,

      usedManualBox:
        false,

      warnings,
    };
  }

  const usedManualBox =
    manualBox !==
    null;

  if (
    positivePoints.length >
    0
  ) {
    const pointsBox =
      createCoordinateBoxFromPoints(
        positivePoints
      );

    if (
      pointsBox
    ) {
      const pointsOutsideBox =
        positivePoints.some(
          point =>
            !isPointInsideCoordinateBox(
              point,
              box as
                EdgeSamCoordinateBox,
              true
            )
        );

      if (
        pointsOutsideBox
      ) {
        box =
          unionCoordinateBoxes(
            box,
            expandCoordinateBoxByPixels(
              pointsBox,
              Math.max(
                2,
                imageWidth *
                0.01
              ),
              Math.max(
                2,
                imageHeight *
                0.01
              )
            )
          );

        warnings.push(
          usedManualBox
            ? 'The manual bounding box was expanded to include all positive points.'
            : 'The automatic bounding box was expanded to include all positive points.'
        );
      }
    }
  }

  const validation =
    validateAndNormalizeBoundingBox(
      box,
      imageWidth,
      imageHeight
    );

  if (
    validation.warning
  ) {
    warnings.push(
      validation.warning
    );
  }

  return {
    box:
      validation.box,

    usedManualBox:
      usedManualBox &&
      validation.box !==
        null,

    warnings,
  };
}

/* =========================================================
 * Final prompt coordinate conversion
 * ======================================================= */

/**
 * تحويل Generated Point من الصورة الأصلية
 * إلى Model Input.
 */
function convertGeneratedPromptPointToModelSpace(
  point:
    EdgeSamGeneratedPromptPoint,
  transform:
    SegmentationTransform
): EdgeSamGeneratedPromptPoint {
  const modelPoint =
    convertPromptPointCoordinateSpace(
      point,
      'original-image',
      'model-input',
      transform
    );

  const modelSize =
    transform
      .modelInputSize;

  const normalizedPoint =
    pixelPointToNormalizedPoint(
      modelPoint,
      modelSize.width,
      modelSize.height
    );

  return {
    ...point,

    x:
      modelPoint.x,

    y:
      modelPoint.y,

    normalizedX:
      normalizedPoint.x,

    normalizedY:
      normalizedPoint.y,
  };
}

/**
 * تحويل كل النقاط إلى Model Input.
 */
function convertGeneratedPromptPointsToModelSpace(
  points:
    readonly EdgeSamGeneratedPromptPoint[],
  transform:
    SegmentationTransform
): EdgeSamGeneratedPromptPoint[] {
  return points.map(
    point =>
      convertGeneratedPromptPointToModelSpace(
        point,
        transform
      )
  );
}

/**
 * تحويل Bounding Box إلى Model Input.
 */
function convertPromptBoundingBoxToModelSpace(
  box:
    EdgeSamCoordinateBox | null,
  transform:
    SegmentationTransform
): EdgeSamCoordinateBox | null {
  if (
    !box
  ) {
    return null;
  }

  const convertedBox =
    convertPromptBoxCoordinateSpace(
      box,
      'original-image',
      'model-input',
      transform
    );

  const validation =
    validateAndNormalizeBoundingBox(
      convertedBox,
      transform
        .modelInputSize
        .width,
      transform
        .modelInputSize
        .height
    );

  return validation.box;
}

/* =========================================================
 * Prompt mode resolution
 * ======================================================= */

/**
 * تحديد Prompt Mode النهائي حسب البيانات المتاحة.
 */
function resolveGeneratedPromptMode(
  hasPoints:
    boolean,
  hasBox:
    boolean,
  hasPreviousMask:
    boolean
): SegmentationPromptMode {
  if (
    hasPreviousMask
  ) {
    return 'previous-mask';
  }

  if (
    hasPoints &&
    hasBox
  ) {
    return 'box-and-points';
  }

  if (
    hasBox
  ) {
    return 'box';
  }

  return 'points';
}

/* =========================================================
 * Previous mask resolution
 * ======================================================= */

/**
 * قراءة Previous Mask اليدوي إن وُجد.
 *
 * لا نعدل بياناته هنا؛ التحقق الكامل يتم
 * عند بناء Decoder Inputs.
 */
function resolveManualPreviousMask(
  input:
    EdgeSamPromptGenerationInput
): EdgeSamPreviousMaskPrompt | null {
  const previousMask =
    input.manualPrompt
      ?.previousMask;

  if (
    !previousMask
  ) {
    return null;
  }

  if (
    !Number.isInteger(
      previousMask.width
    ) ||
    previousMask.width <=
      0 ||
    !Number.isInteger(
      previousMask.height
    ) ||
    previousMask.height <=
      0 ||
    !(
      previousMask.data instanceof
      Float32Array
    ) ||
    previousMask.data.length ===
      0 ||
    !Array.isArray(
      previousMask.dimensions
    )
  ) {
    return null;
  }

  return {
    ...previousMask,

    id:
      createSegmentationRequestId(),

    generatedAutomatically:
      false,
  };
}

/* =========================================================
 * Draft merge orchestration
 * ======================================================= */

/**
 * دمج الـManual Prompt مع Draft التلقائية.
 */
function mergeManualPromptWithAutomaticDraft(
  input:
    EdgeSamPromptGenerationInput,
  automaticDraft:
    GeneratedPromptDraft
): {
  positivePoints:
    EdgeSamGeneratedPromptPoint[];

  negativePoints:
    EdgeSamGeneratedPromptPoint[];

  boundingBox:
    EdgeSamCoordinateBox | null;

  previousMask:
    EdgeSamPreviousMaskPrompt | null;

  generatedAutomatically:
    boolean;

  warnings:
    string[];
} {
  const imageWidth =
    input.orientedImage
      .width;

  const imageHeight =
    input.orientedImage
      .height;

  const manual =
    resolveManualPrompts(
      input,
      imageWidth,
      imageHeight
    );

  const warnings = [
    ...automaticDraft
      .warnings,
    ...manual.warnings,
  ];

  /**
   * لا نسمح للـConfig العام بتقليل عدد النقاط
   * التي اختارها Profile المتخصص بالفعل.
   *
   * كذلك نحافظ على جميع النقاط اليدوية الصالحة
   * ضمن الحد الآمن.
   */
  const configuredPositivePointCount =
    Math.max(
      MINIMUM_POSITIVE_POINT_COUNT,
      1 +
      input.config
        .additionalPositivePoints
    );

  const maximumPositivePoints =
    Math.max(
      MINIMUM_POSITIVE_POINT_COUNT,
      Math.min(
        MAXIMUM_POSITIVE_POINT_COUNT,
        Math.max(
          configuredPositivePointCount,
          automaticDraft
            .positivePoints
            .length,
          manual
            .positivePoints
            .length
        )
      )
    );

  const maximumNegativePoints =
    Math.max(
      0,
      Math.min(
        MAXIMUM_NEGATIVE_POINT_COUNT,
        input.config
          .maximumNegativePoints
      )
    );

  const minimumPointDistance =
    clampNumber(
      input.config
        .minimumPointDistanceRatio,
      0.004,
      0.25
    );

  const positiveMerge =
    mergeManualAndAutomaticPoints(
      manual.positivePoints,
      automaticDraft
        .positivePoints,
      'positive',
      maximumPositivePoints,
      imageWidth,
      imageHeight,
      minimumPointDistance
    );

  const negativeMerge =
    mergeManualAndAutomaticPoints(
      manual.negativePoints,
      automaticDraft
        .negativePoints,
      'negative',
      maximumNegativePoints,
      imageWidth,
      imageHeight,
      minimumPointDistance
    );

  warnings.push(
    ...positiveMerge
      .warnings,
    ...negativeMerge
      .warnings
  );

  /**
   * مرحلة دمج النوعين كانت تسمح أحيانًا
   * بنقطة Negative قريبة جدًا من Positive.
   *
   * هذا التعارض قد يجعل EdgeSAM يقضم الحواف
   * أو يحذف جزءًا رفيعًا من القطعة.
   */
  const crossKindSafetyDistance =
    Math.max(
      0.04,
      minimumPointDistance *
        1.25
    );

  const safeNegativePoints =
    negativeMerge
      .points
      .filter(
        negativePoint =>
          isNegativePointSeparatedFromPositivePoints(
            negativePoint,
            positiveMerge.points,
            imageWidth,
            imageHeight,
            crossKindSafetyDistance
          )
      );

  const removedConflictingNegativeCount =
    negativeMerge
      .points
      .length -
    safeNegativePoints
      .length;

  if (
    removedConflictingNegativeCount >
    0
  ) {
    warnings.push(
      `Removed ${removedConflictingNegativeCount} negative prompt point${
        removedConflictingNegativeCount ===
        1
          ? ''
          : 's'
      } that conflicted with positive points.`
    );
  }

  const boxMerge =
    mergeManualAndAutomaticBoundingBox(
      manual.boundingBox,
      input.config
        .includeBoundingBox
        ? automaticDraft
            .boundingBox
        : null,
      positiveMerge.points,
      imageWidth,
      imageHeight
    );

  warnings.push(
    ...boxMerge.warnings
  );

  const previousMask =
    resolveManualPreviousMask(
      input
    );

  const hasManualContent =
    manual
      .acceptedPointCount >
      0 ||
    manual
      .usedManualBoundingBox ||
    previousMask !==
      null;

  return {
    positivePoints:
      positiveMerge.points,

    negativePoints:
      safeNegativePoints,

    boundingBox:
      boxMerge.box,

    previousMask,

    generatedAutomatically:
      !hasManualContent,

    warnings,
  };
}

/* =========================================================
 * Prompt coordinate diagnostics
 * ======================================================= */

/**
 * ملخص تحويلات Prompt.
 */
function getPromptCoordinateConversionDebugSummary(
  input:
    EdgeSamPromptGenerationInput,
  positivePoints:
    readonly EdgeSamGeneratedPromptPoint[],
  negativePoints:
    readonly EdgeSamGeneratedPromptPoint[],
  boundingBox:
    EdgeSamCoordinateBox | null
): string {
  return [
    `original=${input.transform.originalSize.width}x${input.transform.originalSize.height}`,
    `oriented=${input.transform.orientedSize.width}x${input.transform.orientedSize.height}`,
    `model=${input.transform.modelInputSize.width}x${input.transform.modelInputSize.height}`,
    `resized=${input.transform.resizedSize.width}x${input.transform.resizedSize.height}`,
    `padding=${input.transform.padding.left},${input.transform.padding.top},${input.transform.padding.right},${input.transform.padding.bottom}`,
    `positive=${positivePoints.length}`,
    `negative=${negativePoints.length}`,
    `box=${boundingBox ? 'yes' : 'no'}`,
  ].join(
    ' | '
  );
}

/* =========================================================
 * End of Part 1.7
 * ======================================================= */
/* =========================================================
 * Official EdgeSAM prompt point creation
 * ======================================================= */

/**
 * تحويل Generated Point الداخلية إلى العقد الرسمي
 * الموجود في types.ts.
 */
function createOfficialEdgeSamPromptPoint(
  point:
    EdgeSamGeneratedPromptPoint,
  generatedAutomatically:
    boolean
): EdgeSamPromptPoint {
  return {
    id:
      createEdgeSamPromptId(
        'point'
      ),

    x:
      point.x,

    y:
      point.y,

    label:
      point.label,

    kind:
      point.kind,

    coordinateSpace:
      'model-input',

    confidence:
      clampNormalizedValue(
        point.confidence
      ),

    generatedAutomatically:
      generatedAutomatically &&
      point.source !==
        'manual',
  };
}

/**
 * تحويل مجموعة Generated Points
 * إلى EdgeSamPromptPoint الرسمية.
 */
function createOfficialEdgeSamPromptPoints(
  points:
    readonly EdgeSamGeneratedPromptPoint[],
  generatedAutomatically:
    boolean
): EdgeSamPromptPoint[] {
  return points.map(
    point =>
      createOfficialEdgeSamPromptPoint(
        point,
        generatedAutomatically
      )
  );
}

/* =========================================================
 * Official EdgeSAM box prompt creation
 * ======================================================= */

/**
 * إنشاء Box Prompt رسمية في مساحة Model Input.
 */
function createOfficialEdgeSamBoxPrompt(
  box:
    EdgeSamCoordinateBox | null,
  generatedAutomatically:
    boolean,
  expansionRatio:
    number,
  confidence:
    number
): EdgeSamBoxPrompt | null {
  if (
    !box ||
    !isValidCoordinateBox(
      box
    )
  ) {
    return null;
  }

  return {
    id:
      createEdgeSamPromptId(
        'box'
      ),

    box: {
      x1:
        box.x1,

      y1:
        box.y1,

      x2:
        box.x2,

      y2:
        box.y2,
    },

    coordinateSpace:
      'model-input',

    confidence:
      clampNormalizedValue(
        confidence
      ),

    generatedAutomatically,

    expansionRatio:
      Math.max(
        0,
        expansionRatio
      ),
  };
}

/* =========================================================
 * Prompt point statistics
 * ======================================================= */

/**
 * عدد النقاط الموجبة.
 */
function countPositivePromptPoints(
  points:
    readonly EdgeSamPromptPoint[]
): number {
  let count =
    0;

  for (
    const point
    of points
  ) {
    if (
      point.label ===
      POSITIVE_POINT_LABEL
    ) {
      count +=
        1;
    }
  }

  return count;
}

/**
 * عدد النقاط السالبة.
 */
function countNegativePromptPoints(
  points:
    readonly EdgeSamPromptPoint[]
): number {
  let count =
    0;

  for (
    const point
    of points
  ) {
    if (
      point.label ===
      NEGATIVE_POINT_LABEL
    ) {
      count +=
        1;
    }
  }

  return count;
}

/**
 * متوسط ثقة النقاط الرسمية.
 */
function calculateOfficialPromptPointConfidence(
  points:
    readonly EdgeSamPromptPoint[]
): number {
  if (
    points.length ===
    0
  ) {
    return 0;
  }

  return clampNormalizedValue(
    calculateAverage(
      points.map(
        point =>
          clampNormalizedValue(
            point.confidence ??
            0.5
          )
      )
    )
  );
}

/* =========================================================
 * Prompt warning normalization
 * ======================================================= */

/**
 * تنظيف التحذيرات ومنع التكرار.
 */
function normalizePromptWarnings(
  warnings:
    readonly string[]
): string[] {
  const normalizedWarnings:
    string[] = [];

  const seen =
    new Set<string>();

  for (
    const warning
    of warnings
  ) {
    if (
      typeof warning !==
      'string'
    ) {
      continue;
    }

    const normalized =
      warning.trim();

    if (
      normalized.length ===
      0 ||
      seen.has(
        normalized
      )
    ) {
      continue;
    }

    seen.add(
      normalized
    );

    normalizedWarnings.push(
      normalized
    );
  }

  return normalizedWarnings;
}

/* =========================================================
 * Final prompt validation
 * ======================================================= */

type FinalPromptValidationResult = {
  valid:
    boolean;

  warnings:
    string[];

  positivePointCount:
    number;

  negativePointCount:
    number;

  hasBoundingBox:
    boolean;

  hasPreviousMask:
    boolean;
};

/**
 * التحقق من Prompt النهائية قبل إرجاعها.
 */
function validateFinalEdgeSamPrompt(
  prompt:
    EdgeSamPrompt
): FinalPromptValidationResult {
  const warnings:
    string[] = [];

  const positivePointCount =
    countPositivePromptPoints(
      prompt.points
    );

  const negativePointCount =
    countNegativePromptPoints(
      prompt.points
    );

  const hasBoundingBox =
    prompt.box !==
    null;

  const hasPreviousMask =
    prompt.previousMask !==
    null;

  if (
    prompt.points.length >
    MAXIMUM_TOTAL_POINT_COUNT
  ) {
    warnings.push(
      `Prompt point count ${prompt.points.length} exceeds the safe maximum of ${MAXIMUM_TOTAL_POINT_COUNT}.`
    );
  }

  if (
    positivePointCount ===
      0 &&
    !hasBoundingBox &&
    !hasPreviousMask
  ) {
    warnings.push(
      'Prompt does not contain a positive point, bounding box, or previous mask.'
    );
  }

  for (
    const point
    of prompt.points
  ) {
    if (
      !Number.isFinite(
        point.x
      ) ||
      !Number.isFinite(
        point.y
      )
    ) {
      warnings.push(
        `Prompt point "${point.id}" contains invalid coordinates.`
      );

      continue;
    }

    if (
      point.x <
        0 ||
      point.y <
        0 ||
      point.x >
        prompt.sourceSize
          .width -
          1 ||
      point.y >
        prompt.sourceSize
          .height -
          1
    ) {
      warnings.push(
        `Prompt point "${point.id}" is outside the model-input bounds.`
      );
    }

    if (
      point.label !==
        POSITIVE_POINT_LABEL &&
      point.label !==
        NEGATIVE_POINT_LABEL
    ) {
      warnings.push(
        `Prompt point "${point.id}" contains an unsupported label.`
      );
    }

    if (
      point.kind ===
        'positive' &&
      point.label !==
        POSITIVE_POINT_LABEL
    ) {
      warnings.push(
        `Prompt point "${point.id}" has mismatched positive kind and label.`
      );
    }

    if (
      point.kind ===
        'negative' &&
      point.label !==
        NEGATIVE_POINT_LABEL
    ) {
      warnings.push(
        `Prompt point "${point.id}" has mismatched negative kind and label.`
      );
    }
  }

  if (
    prompt.box
  ) {
    const box =
      prompt.box.box;

    if (
      !isValidCoordinateBox(
        box
      )
    ) {
      warnings.push(
        'Prompt bounding box is invalid.'
      );
    } else if (
      box.x1 <
        0 ||
      box.y1 <
        0 ||
      box.x2 >
        prompt.sourceSize
          .width -
          1 ||
      box.y2 >
        prompt.sourceSize
          .height -
          1
    ) {
      warnings.push(
        'Prompt bounding box is outside the model-input bounds.'
      );
    }
  }

  if (
  prompt.mode ===
    'points' &&
  positivePointCount ===
    0
) {
  warnings.push(
    'Points prompt mode was selected without a positive point.'
  );
}

  if (
    prompt.mode ===
      'box' &&
    !prompt.box
  ) {
    warnings.push(
      'Box prompt mode was selected without a bounding box.'
    );
  }

  if (
  prompt.mode ===
    'box-and-points' &&
  (
    !prompt.box ||
    positivePointCount ===
      0
  )
) {
  warnings.push(
    'Box-and-points mode requires a box and at least one positive point.'
  );
}

  if (
    prompt.mode ===
      'previous-mask' &&
    !prompt.previousMask
  ) {
    warnings.push(
      'Previous-mask prompt mode was selected without a previous mask.'
    );
  }

  const fatalInvalid =
  (
    positivePointCount ===
      0 &&
    !hasBoundingBox &&
    !hasPreviousMask
  ) ||
  (
    prompt.mode ===
      'points' &&
    positivePointCount ===
      0
  ) ||
  (
    prompt.mode ===
      'box' &&
    !prompt.box
  ) ||
  (
    prompt.mode ===
      'box-and-points' &&
    (
      !prompt.box ||
      positivePointCount ===
        0
    )
  ) ||
  (
    prompt.mode ===
      'previous-mask' &&
    !prompt.previousMask
  );

  return {
    valid:
      !fatalInvalid,

    warnings:
      normalizePromptWarnings(
        warnings
      ),

    positivePointCount,

    negativePointCount,

    hasBoundingBox,

    hasPreviousMask,
  };
}

/* =========================================================
 * Prompt mode safety
 * ======================================================= */

/**
 * تصحيح Prompt Mode عند غياب أحد المدخلات.
 */
function normalizeFinalPromptMode(
  requestedMode:
    SegmentationPromptMode,
  points:
    readonly EdgeSamPromptPoint[],
  box:
    EdgeSamBoxPrompt | null,
  previousMask:
    EdgeSamPreviousMaskPrompt | null
): SegmentationPromptMode {
  if (
    previousMask
  ) {
    return 'previous-mask';
  }

  /**
   * Negative Points وحدها لا تكفي لإنشاء
   * Points Prompt صالحة لـEdgeSAM.
   */
  const hasPositivePoints =
    points.some(
      point =>
        point.label ===
          POSITIVE_POINT_LABEL &&
        point.kind ===
          'positive'
    );

  const hasBox =
    box !==
    null;

  if (
    requestedMode ===
      'box-and-points' &&
    hasPositivePoints &&
    hasBox
  ) {
    return 'box-and-points';
  }

  if (
    requestedMode ===
      'box' &&
    hasBox
  ) {
    return 'box';
  }

  if (
    requestedMode ===
      'points' &&
    hasPositivePoints
  ) {
    return 'points';
  }

  if (
    hasPositivePoints &&
    hasBox
  ) {
    return 'box-and-points';
  }

  if (
    hasBox
  ) {
    return 'box';
  }

  return 'points';
}

/* =========================================================
 * Diagnostics source resolution
 * ======================================================= */

/**
 * تحديد المصدر التشخيصي الأقرب
 * لطريقة إنشاء Prompt.
 */
function resolveAutomaticPromptDiagnosticSource(
  input:
    EdgeSamPromptGenerationInput,
  draft:
    GeneratedPromptDraft,
  generatedAutomatically:
    boolean
): EdgeSamAutomaticPromptSource {
  if (
    !generatedAutomatically
  ) {
    return 'manual-fallback';
  }

  if (
    draft.usedFallback
  ) {
    return 'manual-fallback';
  }

  const foreground =
    draft.foreground;

  if (
    foreground &&
    foreground
      .strongPoints.length >
      0
  ) {
    return 'foreground-estimate';
  }

  if (
    foreground &&
    foreground
      .interiorPoints.length >
      0
  ) {
    return 'contrast-region';
  }

  if (
    input.config
      .includePositiveCenterPoint
  ) {
    return 'image-center';
  }

  return 'saliency';
}

/* =========================================================
 * Detected region conversion
 * ======================================================= */

/**
 * تحويل Foreground Bounds إلى SegmentationRect.
 */
function createDetectedSegmentationRegion(
  foreground:
    ForegroundEstimate | null
): SegmentationRect | null {
  if (
    !foreground ||
    !isValidPixelBounds(
      foreground.bounds
    )
  ) {
    return null;
  }

  return {
    x:
      foreground
        .bounds.x,

    y:
      foreground
        .bounds.y,

    width:
      foreground
        .bounds.width,

    height:
      foreground
        .bounds.height,
  };
}

/* =========================================================
 * Prompt diagnostics creation
 * ======================================================= */

/**
 * إنشاء Diagnostics الرسمية.
 */
function createPromptGenerationDiagnostics(
  input:
    EdgeSamPromptGenerationInput,
  automaticDraft:
    GeneratedPromptDraft,
  prompt:
    EdgeSamPrompt,
  generatedAutomatically:
    boolean,
  usedCenterFallback:
    boolean,
  warnings:
    readonly string[]
): EdgeSamPromptGenerationDiagnostics {
  const positivePointCount =
    countPositivePromptPoints(
      prompt.points
    );

  const negativePointCount =
    countNegativePromptPoints(
      prompt.points
    );

  const centerConfidence =
    automaticDraft
      .foreground
      ? clampNormalizedValue(
          automaticDraft
            .foreground
            .confidence *
          0.72 +
          automaticDraft
            .confidence *
          0.28
        )
      : 0;

  return {
    source:
      resolveAutomaticPromptDiagnosticSource(
        input,
        automaticDraft,
        generatedAutomatically
      ),

    detectedRegion:
      createDetectedSegmentationRegion(
        automaticDraft
          .foreground
      ),

    regionConfidence:
      clampNormalizedValue(
        automaticDraft
          .foreground
          ?.confidence ??
        0
      ),

    centerConfidence,

    positivePointsCreated:
      positivePointCount,

    negativePointsCreated:
      negativePointCount,

    usedCenterFallback,

    warnings:
      normalizePromptWarnings(
        warnings
      ),
  };
}

/* =========================================================
 * Final EdgeSAM prompt assembly
 * ======================================================= */

/**
 * بناء EdgeSamPrompt الرسمية بعد:
 *
 * - التحليل التلقائي.
 * - دمج Manual Prompt.
 * - تحويل الإحداثيات إلى Model Input.
 */
function buildFinalEdgeSamPrompt(
  input:
    EdgeSamPromptGenerationInput,
  automaticDraft:
    GeneratedPromptDraft
): {
  prompt:
    EdgeSamPrompt;

  generatedAutomatically:
    boolean;

  usedCenterFallback:
    boolean;

  warnings:
    string[];
} {
  const mergedDraft =
    mergeManualPromptWithAutomaticDraft(
      input,
      automaticDraft
    );

  const modelPositivePoints =
    convertGeneratedPromptPointsToModelSpace(
      mergedDraft
        .positivePoints,
      input.transform
    );

  const modelNegativePoints =
    convertGeneratedPromptPointsToModelSpace(
      mergedDraft
        .negativePoints,
      input.transform
    );

  const generatedPoints = [
    ...modelPositivePoints,
    ...modelNegativePoints,
  ];

  const officialPoints =
    createOfficialEdgeSamPromptPoints(
      generatedPoints,
      mergedDraft
        .generatedAutomatically
    );

  const modelBoundingBox =
    convertPromptBoundingBoxToModelSpace(
      mergedDraft
        .boundingBox,
      input.transform
    );

  const officialBox =
    createOfficialEdgeSamBoxPrompt(
      modelBoundingBox,
      mergedDraft
        .generatedAutomatically,
      input.config
        .boxExpansionRatio,
      automaticDraft
        .confidence
    );

 const hasOfficialPositivePoints =
  officialPoints.some(
    point =>
      point.label ===
        POSITIVE_POINT_LABEL &&
      point.kind ===
        'positive'
  );

const requestedMode =
  resolveGeneratedPromptMode(
    hasOfficialPositivePoints,
    officialBox !==
      null,
    mergedDraft
      .previousMask !==
      null
  );

  const finalMode =
    normalizeFinalPromptMode(
      requestedMode,
      officialPoints,
      officialBox,
      mergedDraft
        .previousMask
    );

  const preliminaryWarnings =
    normalizePromptWarnings([
      ...mergedDraft
        .warnings,

      ...automaticDraft
        .warnings,
  ]);

  const prompt:
    EdgeSamPrompt = {
      mode:
        finalMode,

      points:
        officialPoints,

      box:
        officialBox,

      previousMask:
        mergedDraft
          .previousMask,

      generatedAutomatically:
        mergedDraft
          .generatedAutomatically,

      coordinateSpace:
        'model-input',

      sourceSize: {
        width:
          input.transform
            .modelInputSize
            .width,

        height:
          input.transform
            .modelInputSize
            .height,
      },

      warnings:
        preliminaryWarnings,
    };

  const validation =
    validateFinalEdgeSamPrompt(
      prompt
    );

  const finalWarnings =
    normalizePromptWarnings([
      ...preliminaryWarnings,
      ...validation.warnings,
  ]);

  const validatedPrompt:
    EdgeSamPrompt = {
      ...prompt,

      warnings:
        finalWarnings,
  };

  if (
    !validation.valid
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      [
        'EdgeSAM prompt validation failed.',
        finalWarnings.join(
          ' '
        ),
      ]
        .filter(
          value =>
            value.length >
            0
        )
        .join(
          ' '
        ),
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  const usedCenterFallback =
    automaticDraft
      .usedFallback ||
    automaticDraft
      .positivePoints
      .some(
        point =>
          point.source ===
          'fallback-center'
      );

  return {
    prompt:
      validatedPrompt,

    generatedAutomatically:
      mergedDraft
        .generatedAutomatically,

    usedCenterFallback,

    warnings:
      finalWarnings,
  };
}

/* =========================================================
 * Prompt confidence validation
 * ======================================================= */

/**
 * التأكد من أن ثقة Prompt التلقائية
 * تحقق الحد الأدنى في الإعدادات.
 */
function validateAutomaticPromptConfidence(
  input:
    EdgeSamPromptGenerationInput,
  draft:
    GeneratedPromptDraft,
  hasManualPrompt:
    boolean
): string[] {
  const warnings:
    string[] = [];

  if (
    hasManualPrompt
  ) {
    return warnings;
  }

  const minimumConfidence =
    clampNormalizedValue(
      input.config
        .minimumPromptConfidence
    );

  if (
    draft.confidence <
    minimumConfidence
  ) {
    warnings.push(
      `Automatic prompt confidence ${draft.confidence.toFixed(
        3
      )} is below the configured minimum ${minimumConfidence.toFixed(
        3
      )}.`
    );
  }

  return warnings;
}

/* =========================================================
 * Main prompt result creation
 * ======================================================= */

/**
 * إنشاء EdgeSamPromptGenerationResult الرسمية.
 */
function createPromptGenerationResult(
  input:
    EdgeSamPromptGenerationInput,
  automaticDraft:
    GeneratedPromptDraft,
  startedAt:
    number
): EdgeSamPromptGenerationResult {
  const finalAssembly =
    buildFinalEdgeSamPrompt(
      input,
      automaticDraft
    );

  const hasManualPrompt =
    input.manualPrompt !==
      null &&
    input.manualPrompt !==
      undefined;

  const confidenceWarnings =
    validateAutomaticPromptConfidence(
      input,
      automaticDraft,
      hasManualPrompt
    );

  const warnings =
    normalizePromptWarnings([
      ...finalAssembly
        .warnings,
      ...confidenceWarnings,
    ]);

  const prompt:
    EdgeSamPrompt = {
      ...finalAssembly.prompt,

      warnings,
  };

  const diagnostics =
    createPromptGenerationDiagnostics(
      input,
      automaticDraft,
      prompt,
      finalAssembly
        .generatedAutomatically,
      finalAssembly
        .usedCenterFallback,
      warnings
    );

  return {
    prompt,

    diagnostics,

    durationMs:
      Math.max(
        0,
        Date.now() -
        startedAt
      ),
  };
}

/* =========================================================
 * Prompt generation input validation
 * ======================================================= */

/**
 * التحقق من EdgeSamPromptGenerationInput.
 */
function validatePromptGenerationInput(
  input:
    EdgeSamPromptGenerationInput
): void {
  if (
    !input ||
    typeof input !==
      'object'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'PromptGenerator received an invalid input object.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !input.orientedImage ||
    !areValidImageDimensions(
      input.orientedImage
        .width,
      input.orientedImage
        .height
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'PromptGenerator received invalid oriented image dimensions.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !(
      input.orientedImage
        .rgba instanceof
      Uint8Array
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'PromptGenerator requires oriented RGBA image data.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  const expectedRgbaLength =
    input.orientedImage
      .width *
    input.orientedImage
      .height *
    RGBA_CHANNEL_COUNT;

  if (
    input.orientedImage
      .rgba.length !==
    expectedRgbaLength
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      [
        'PromptGenerator oriented RGBA buffer length is invalid.',
        `Expected ${expectedRgbaLength}, received ${input.orientedImage.rgba.length}.`,
      ].join(
        ' '
      ),
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !input.modelImage ||
    !areValidImageDimensions(
      input.modelImage
        .width,
      input.modelImage
        .height
    )
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'PromptGenerator received invalid model image dimensions.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !input.transform ||
    !input.transform
      .originalSize ||
    !input.transform
      .orientedSize ||
    !input.transform
      .modelInputSize
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'PromptGenerator received an invalid image transform.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !input.config ||
    typeof input.config !==
      'object'
  ) {
    throw new SegmentationError(
      'INVALID_INPUT',
      'PromptGenerator received invalid automatic prompt configuration.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }
}

/* =========================================================
 * Automatic draft creation orchestration
 * ======================================================= */

/**
 * تشغيل تحليل الصورة وإنشاء Draft تلقائية.
 */
function createAutomaticPromptDraftFromInput(
  input:
    EdgeSamPromptGenerationInput,
  context:
    PromptGenerationContext
): GeneratedPromptDraft {
  reportPromptGenerationProgress(
    context,
    1,
    'Estimating image background.'
  );

  throwIfPromptGenerationCancelled(
    context
      .cancellationSignal,
    context.requestId
  );

  const background =
    estimateImageBackground(
      input.orientedImage
        .rgba,
      input.orientedImage
        .width,
      input.orientedImage
        .height,
      RGBA_CHANNEL_COUNT,
      context
        .cancellationSignal,
      context.requestId
    );

  reportPromptGenerationProgress(
    context,
    2,
    'Estimating clothing foreground.'
  );

  throwIfPromptGenerationCancelled(
    context
      .cancellationSignal,
    context.requestId
  );

  let foreground =
    estimateImageForeground({
      data:
        input.orientedImage
          .rgba,

      imageWidth:
        input.orientedImage
          .width,

      imageHeight:
        input.orientedImage
          .height,

      channelCount:
        RGBA_CHANNEL_COUNT,

      background,

      profile:
        context.profile,

      cancellationSignal:
        context
          .cancellationSignal,

      requestId:
        context.requestId,
    });

  if (
    !foreground &&
    input.config
      .allowCenterFallback
  ) {
    foreground =
      createFallbackForegroundEstimate(
        context.profile,
        input.orientedImage
          .width,
        input.orientedImage
          .height,
        'Foreground estimation failed and center fallback was enabled.'
      );
  }

  reportPromptGenerationProgress(
    context,
    3,
    'Generating positive and negative prompt points.'
  );

  const draft =
    generateAutomaticPromptDraft(
      context,
      background,
      foreground
    );

  reportPromptGenerationProgress(
    context,
    4,
    'Automatic prompt draft completed.'
  );

  return draft;
}

/* =========================================================
 * End of Part 1.8
 * ======================================================= */
/* =========================================================
 * Decoder prompt tensor preparation types
 * ======================================================= */

type DecoderPromptTensorEntry = {
  x:
    number;

  y:
    number;

  label:
    number;

  source:
    | 'point'
    | 'box-top-left'
    | 'box-bottom-right'
    | 'padding';
};

type DecoderPromptTensorPreparationResult = {
  entries:
    DecoderPromptTensorEntry[];

  pointCoordinates:
    EdgeSamPointCoordinatesTensor;

  pointLabels:
    EdgeSamPointLabelsTensor;

  warnings:
    string[];
};

/* =========================================================
 * Decoder prompt tensor constants
 * ======================================================= */

/**
 * Labels الرسمية التي يفهمها SAM Decoder.
 *
 * 0  = Negative Point
 * 1  = Positive Point
 * 2  = Box Top-Left
 * 3  = Box Bottom-Right
 * -1 = Padding Point
 */
const DECODER_NEGATIVE_POINT_LABEL =
  0;

const DECODER_POSITIVE_POINT_LABEL =
  1;

const DECODER_BOX_TOP_LEFT_LABEL =
  2;

const DECODER_BOX_BOTTOM_RIGHT_LABEL =
  3;

const DECODER_PADDING_POINT_LABEL =
  -1;

/**
 * EdgeSAM Decoder يحتاج نقطة واحدة على الأقل.
 *
 * عند عدم وجود نقاط حقيقية نرسل Padding Point،
 * لكن هذا لا يحدث عادة لأن الـPrompt validation
 * يمنع Prompt فارغة.
 */
const MINIMUM_DECODER_POINT_COUNT =
  1;

/**
 * حد أمان يمنع إنشاء Tensor كبيرة بسبب
 * بيانات Manual Prompt غير سليمة.
 */
const MAXIMUM_DECODER_POINT_COUNT =
  MAXIMUM_TOTAL_POINT_COUNT +
  2;

/* =========================================================
 * Decoder prompt entry creation
 * ======================================================= */

/**
 * إنشاء Entry آمنة.
 */
function createDecoderPromptTensorEntry(
  x:
    number,
  y:
    number,
  label:
    number,
  source:
    DecoderPromptTensorEntry['source']
): DecoderPromptTensorEntry {
  return {
    x:
      Number.isFinite(
        x
      )
        ? x
        : 0,

    y:
      Number.isFinite(
        y
      )
        ? y
        : 0,

    label:
      Number.isFinite(
        label
      )
        ? label
        : DECODER_PADDING_POINT_LABEL,

    source,
  };
}

/**
 * تحويل EdgeSamPromptPoint إلى Entry.
 */
function createDecoderEntryFromPromptPoint(
  point:
    EdgeSamPromptPoint,
  modelWidth:
    number,
  modelHeight:
    number
): DecoderPromptTensorEntry | null {
  if (
    !Number.isFinite(
      point.x
    ) ||
    !Number.isFinite(
      point.y
    )
  ) {
    return null;
  }

  if (
    point.label !==
      POSITIVE_POINT_LABEL &&
    point.label !==
      NEGATIVE_POINT_LABEL
  ) {
    return null;
  }

  const clampedPoint =
    clampPixelPointToImage(
      {
        x:
          point.x,

        y:
          point.y,
      },
      modelWidth,
      modelHeight
    );

  return createDecoderPromptTensorEntry(
    clampedPoint.x,
    clampedPoint.y,
    point.label ===
      POSITIVE_POINT_LABEL
      ? DECODER_POSITIVE_POINT_LABEL
      : DECODER_NEGATIVE_POINT_LABEL,
    'point'
  );
}

/**
 * إنشاء Entries الخاصة بالـBounding Box.
 */
function createDecoderEntriesFromBoxPrompt(
  boxPrompt:
    EdgeSamBoxPrompt,
  modelWidth:
    number,
  modelHeight:
    number
): readonly [
  DecoderPromptTensorEntry,
  DecoderPromptTensorEntry,
] | null {
  const validation =
    validateAndNormalizeBoundingBox(
      boxPrompt.box,
      modelWidth,
      modelHeight
    );

  if (
    !validation.valid ||
    !validation.box
  ) {
    return null;
  }

  const box =
    validation.box;

  return [
    createDecoderPromptTensorEntry(
      box.x1,
      box.y1,
      DECODER_BOX_TOP_LEFT_LABEL,
      'box-top-left'
    ),

    createDecoderPromptTensorEntry(
      box.x2,
      box.y2,
      DECODER_BOX_BOTTOM_RIGHT_LABEL,
      'box-bottom-right'
    ),
  ];
}

/**
 * إنشاء Padding Entry.
 */
function createDecoderPaddingEntry():
  DecoderPromptTensorEntry {
  return createDecoderPromptTensorEntry(
    0,
    0,
    DECODER_PADDING_POINT_LABEL,
    'padding'
  );
}

/* =========================================================
 * Decoder entry ordering
 * ======================================================= */

/**
 * ترتيب Entries بالشكل المتوقع:
 *
 * 1) Positive Points
 * 2) Negative Points
 * 3) Box Top-Left
 * 4) Box Bottom-Right
 * 5) Padding
 */
function getDecoderPromptEntryPriority(
  entry:
    DecoderPromptTensorEntry
): number {
  switch (
    entry.label
  ) {
    case DECODER_POSITIVE_POINT_LABEL:
      return 10;

    case DECODER_NEGATIVE_POINT_LABEL:
      return 20;

    case DECODER_BOX_TOP_LEFT_LABEL:
      return 30;

    case DECODER_BOX_BOTTOM_RIGHT_LABEL:
      return 40;

    case DECODER_PADDING_POINT_LABEL:
    default:
      return 50;
  }
}

/**
 * ترتيب Entries دون تعديل Array الأصلية.
 */
function sortDecoderPromptEntries(
  entries:
    readonly DecoderPromptTensorEntry[]
): DecoderPromptTensorEntry[] {
  return entries
    .slice()
    .sort(
      (
        first,
        second
      ) =>
        getDecoderPromptEntryPriority(
          first
        ) -
        getDecoderPromptEntryPriority(
          second
        )
    );
}

/* =========================================================
 * Decoder entry deduplication
 * ======================================================= */

/**
 * تحديد هل Entry نقطية عادية.
 */
function isDecoderPointEntry(
  entry:
    DecoderPromptTensorEntry
): boolean {
  return (
    entry.label ===
      DECODER_POSITIVE_POINT_LABEL ||
    entry.label ===
      DECODER_NEGATIVE_POINT_LABEL
  );
}

/**
 * إزالة Point Entries المكررة.
 *
 * لا نحذف Box Entries لأن Label كل Corner مختلف.
 */
function deduplicateDecoderPromptEntries(
  entries:
    readonly DecoderPromptTensorEntry[],
  modelWidth:
    number,
  modelHeight:
    number,
  minimumDistanceRatio:
    number
): {
  entries:
    DecoderPromptTensorEntry[];

  removedCount:
    number;
} {
  const accepted:
    DecoderPromptTensorEntry[] = [];

  let removedCount =
    0;

  const minimumDistance =
    Math.max(
      0,
      minimumDistanceRatio
    );

  for (
    const entry
    of entries
  ) {
    if (
      !isDecoderPointEntry(
        entry
      )
    ) {
      accepted.push({
        ...entry,
      });

      continue;
    }

    let duplicate =
      false;

    for (
      const existing
      of accepted
    ) {
      if (
        !isDecoderPointEntry(
          existing
        ) ||
        existing.label !==
          entry.label
      ) {
        continue;
      }

      const distance =
        calculateNormalizedPointDistance(
          entry,
          existing,
          modelWidth,
          modelHeight
        );

      if (
        distance <
        minimumDistance
      ) {
        duplicate =
          true;

        break;
      }
    }

    if (
      duplicate
    ) {
      removedCount +=
        1;

      continue;
    }

    accepted.push({
      ...entry,
    });
  }

  return {
    entries:
      accepted,

    removedCount,
  };
}

/* =========================================================
 * Prompt to decoder entries
 * ======================================================= */

/**
 * تحويل EdgeSamPrompt كاملة إلى Entries.
 */
function createDecoderPromptEntries(
  prompt:
    EdgeSamPrompt,
  minimumPointDistanceRatio:
    number
): {
  entries:
    DecoderPromptTensorEntry[];

  warnings:
    string[];
} {
  const warnings:
    string[] = [];

  const modelWidth =
    prompt.sourceSize.width;

  const modelHeight =
    prompt.sourceSize.height;

  const entries:
    DecoderPromptTensorEntry[] = [];

  for (
    const point
    of prompt.points
  ) {
    const entry =
      createDecoderEntryFromPromptPoint(
        point,
        modelWidth,
        modelHeight
      );

    if (
      !entry
    ) {
      warnings.push(
        `Prompt point "${point.id}" could not be added to decoder tensors.`
      );

      continue;
    }

    entries.push(
      entry
    );
  }

  if (
    prompt.box
  ) {
    const boxEntries =
      createDecoderEntriesFromBoxPrompt(
        prompt.box,
        modelWidth,
        modelHeight
      );

    if (
      boxEntries
    ) {
      entries.push(
        ...boxEntries
      );
    } else {
      warnings.push(
        'Prompt bounding box could not be added to decoder tensors.'
      );
    }
  }

  const deduplicated =
    deduplicateDecoderPromptEntries(
      entries,
      modelWidth,
      modelHeight,
      minimumPointDistanceRatio
    );

  if (
    deduplicated
      .removedCount >
    0
  ) {
    warnings.push(
      `Removed ${deduplicated.removedCount} duplicate decoder prompt entr${
        deduplicated.removedCount ===
        1
          ? 'y'
          : 'ies'
      }.`
    );
  }

  let finalEntries =
    sortDecoderPromptEntries(
      deduplicated.entries
    );

  if (
    finalEntries.length >
    MAXIMUM_DECODER_POINT_COUNT
  ) {
    finalEntries =
      finalEntries.slice(
        0,
        MAXIMUM_DECODER_POINT_COUNT
      );

    warnings.push(
      `Decoder prompt entries were limited to ${MAXIMUM_DECODER_POINT_COUNT}.`
    );
  }

  if (
    finalEntries.length <
    MINIMUM_DECODER_POINT_COUNT
  ) {
    finalEntries.push(
      createDecoderPaddingEntry()
    );

    warnings.push(
      'A decoder padding point was inserted because no prompt entries were available.'
    );
  }

  return {
    entries:
      finalEntries,

    warnings:
      normalizePromptWarnings(
        warnings
      ),
  };
}

/* =========================================================
 * Point coordinates tensor creation
 * ======================================================= */

/**
 * إنشاء Tensor الإحداثيات:
 *
 * Shape: [1, N, 2]
 */
function createPointCoordinatesTensor(
  entries:
    readonly DecoderPromptTensorEntry[],
  tensorName:
    string
): EdgeSamPointCoordinatesTensor {
  const pointCount =
    Math.max(
      MINIMUM_DECODER_POINT_COUNT,
      entries.length
    );

  const data =
    new Float32Array(
      pointCount *
      2
    );

  for (
    let index = 0;
    index <
      pointCount;
    index +=
      1
  ) {
    const entry =
      entries[
        index
      ] ??
      createDecoderPaddingEntry();

    const offset =
      index *
      2;

    data[
      offset
    ] =
      Number.isFinite(
        entry.x
      )
        ? entry.x
        : 0;

    data[
      offset +
      1
    ] =
      Number.isFinite(
        entry.y
      )
        ? entry.y
        : 0;
  }

  return {
    name:
      tensorName,

    data,

    dimensions: [
      1,
      pointCount,
      2,
    ],

    dataType:
      'float32',

    layout:
      'unknown',

    pointCount,
  };
}

/* =========================================================
 * Point labels tensor creation
 * ======================================================= */

/**
 * إنشاء Tensor الـLabels:
 *
 * Shape: [1, N]
 */
function createPointLabelsTensor(
  entries:
    readonly DecoderPromptTensorEntry[],
  tensorName:
    string
): EdgeSamPointLabelsTensor {
  const pointCount =
    Math.max(
      MINIMUM_DECODER_POINT_COUNT,
      entries.length
    );

  const data =
    new Float32Array(
      pointCount
    );

  for (
    let index = 0;
    index <
      pointCount;
    index +=
      1
  ) {
    const entry =
      entries[
        index
      ] ??
      createDecoderPaddingEntry();

    data[
      index
    ] =
      entry.label;
  }

  return {
    name:
      tensorName,

    data,

    dimensions: [
      1,
      pointCount,
    ],

    dataType:
      'float32',

    layout:
      'unknown',

    pointCount,
  };
}

/* =========================================================
 * Tensor pair validation
 * ======================================================= */

/**
 * التحقق أن Coordinate Tensor وLabel Tensor
 * متطابقتان في عدد النقاط.
 */
function validatePromptTensorPair(
  coordinates:
    EdgeSamPointCoordinatesTensor,
  labels:
    EdgeSamPointLabelsTensor
): string[] {
  const warnings:
    string[] = [];

  if (
    coordinates.pointCount !==
    labels.pointCount
  ) {
    warnings.push(
      'Decoder point-coordinate and point-label tensors have different point counts.'
    );
  }

  if (
    coordinates.data.length !==
    coordinates.pointCount *
      2
  ) {
    warnings.push(
      'Decoder point-coordinate tensor data length is invalid.'
    );
  }

  if (
    labels.data.length !==
    labels.pointCount
  ) {
    warnings.push(
      'Decoder point-label tensor data length is invalid.'
    );
  }

  if (
    coordinates.dimensions[
      0
    ] !==
      1 ||
    coordinates.dimensions[
      1
    ] !==
      coordinates.pointCount ||
    coordinates.dimensions[
      2
    ] !==
      2
  ) {
    warnings.push(
      'Decoder point-coordinate tensor dimensions are invalid.'
    );
  }

  if (
    labels.dimensions[
      0
    ] !==
      1 ||
    labels.dimensions[
      1
    ] !==
      labels.pointCount
  ) {
    warnings.push(
      'Decoder point-label tensor dimensions are invalid.'
    );
  }

  return warnings;
}

/* =========================================================
 * Prompt tensor preparation
 * ======================================================= */

/**
 * بناء Tensor الإحداثيات والـLabels للـDecoder.
 */
function prepareDecoderPromptTensors(
  prompt:
    EdgeSamPrompt,
  modelConfig:
    SegmentationModelConfig
): DecoderPromptTensorPreparationResult {
  const pointCoordinatesName =
    modelConfig
      .decoder
      .config
      .inputNames
      .pointCoordinates;

  const pointLabelsName =
    modelConfig
      .decoder
      .config
      .inputNames
      .pointLabels;

  const entryResult =
    createDecoderPromptEntries(
      prompt,
      modelConfig
        .automaticPrompt
        .minimumPointDistanceRatio
    );

  const pointCoordinates =
    createPointCoordinatesTensor(
      entryResult.entries,
      pointCoordinatesName
    );

  const pointLabels =
    createPointLabelsTensor(
      entryResult.entries,
      pointLabelsName
    );

  const validationWarnings =
    validatePromptTensorPair(
      pointCoordinates,
      pointLabels
    );

  const warnings =
    normalizePromptWarnings([
      ...entryResult.warnings,
      ...validationWarnings,
    ]);

  if (
    validationWarnings.length >
    0
  ) {
    throw new SegmentationError(
      'DECODER_INPUT_CREATION_FAILED',
      [
        'Failed to build valid EdgeSAM prompt tensors.',
        ...validationWarnings,
      ].join(
        ' '
      ),
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

  return {
    entries:
      entryResult.entries,

    pointCoordinates,

    pointLabels,

    warnings,
  };
}

/* =========================================================
 * Public prompt tensor build result
 * ======================================================= */

export type EdgeSamPromptTensorBuildResult = {
  pointCoordinates:
    EdgeSamPointCoordinatesTensor;

  pointLabels:
    EdgeSamPointLabelsTensor;

  pointCount:
    number;

  positivePointCount:
    number;

  negativePointCount:
    number;

  boxPointCount:
    number;

  paddingPointCount:
    number;

  warnings:
    readonly string[];

  durationMs:
    number;
};

/* =========================================================
 * Public prompt tensor builder
 * ======================================================= */

/**
 * تحويل EdgeSamPrompt جاهزة إلى Tensors
 * يمكن تمريرها إلى Mask Decoder.
 */
export function buildEdgeSamPromptTensors(
  prompt:
    EdgeSamPrompt,
  config:
    SegmentationModelConfig =
      DEFAULT_SEGMENTATION_MODEL_CONFIG
): EdgeSamPromptTensorBuildResult {
  const startedAt =
    Date.now();

  const safeConfig =
    cloneSegmentationModelConfig(
      config
    );

  validateSegmentationModelConfig(
    safeConfig
  );

  const promptValidation =
    validateFinalEdgeSamPrompt(
      prompt
    );

  if (
    !promptValidation.valid
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      [
        'Cannot build decoder tensors from an invalid EdgeSAM prompt.',
        ...promptValidation
          .warnings,
      ].join(
        ' '
      ),
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

  const prepared =
    prepareDecoderPromptTensors(
      prompt,
      safeConfig
    );

  let positivePointCount =
    0;

  let negativePointCount =
    0;

  let boxPointCount =
    0;

  let paddingPointCount =
    0;

  for (
    const entry
    of prepared.entries
  ) {
    switch (
      entry.label
    ) {
      case DECODER_POSITIVE_POINT_LABEL:
        positivePointCount +=
          1;

        break;

      case DECODER_NEGATIVE_POINT_LABEL:
        negativePointCount +=
          1;

        break;

      case DECODER_BOX_TOP_LEFT_LABEL:
      case DECODER_BOX_BOTTOM_RIGHT_LABEL:
        boxPointCount +=
          1;

        break;

      case DECODER_PADDING_POINT_LABEL:
      default:
        paddingPointCount +=
          1;

        break;
    }
  }

  return {
    pointCoordinates:
      prepared
        .pointCoordinates,

    pointLabels:
      prepared
        .pointLabels,

    pointCount:
      prepared
        .pointCoordinates
        .pointCount,

    positivePointCount,

    negativePointCount,

    boxPointCount,

    paddingPointCount,

    warnings:
      prepared.warnings,

    durationMs:
      Math.max(
        0,
        Date.now() -
        startedAt
      ),
  };
}

/* =========================================================
 * Prompt tensor diagnostics
 * ======================================================= */

/**
 * ملخص Tensors لأغراض Debug.
 */
export function getEdgeSamPromptTensorDebugSummary(
  result:
    EdgeSamPromptTensorBuildResult
): string {
  return [
    `points=${result.pointCount}`,
    `positive=${result.positivePointCount}`,
    `negative=${result.negativePointCount}`,
    `box=${result.boxPointCount}`,
    `padding=${result.paddingPointCount}`,
    `coordinateShape=${result.pointCoordinates.dimensions.join(
      'x'
    )}`,
    `labelShape=${result.pointLabels.dimensions.join(
      'x'
    )}`,
    `durationMs=${result.durationMs.toFixed(
      2
    )}`,
    `warnings=${result.warnings.length}`,
  ].join(
    ' | '
  );
}

/* =========================================================
 * End of Part 1.9
 * ======================================================= */
/* =========================================================
 * Public prompt generator options
 * ======================================================= */

export type EdgeSamPromptGeneratorOptions = {
  /**
   * معرف العملية.
   */
  requestId?:
    string;

  /**
   * Profile محدد للقطعة إن كان معروفًا.
   */
  profileId?:
    string | null;

  /**
   * قيم إضافية تساعد في تحديد Profile.
   */
  category?:
    string | null;

  subCategory?:
    string | null;

  templateId?:
    string | null;

  clothingType?:
    string | null;

  onProgress?:
    SegmentationProgressCallback;

  cancellationSignal?:
    SegmentationCancellationSignal;
};

/* =========================================================
 * Source metadata helpers
 * ======================================================= */

/**
 * قراءة Metadata من مصدر الصورة.
 */
function getPromptSourceMetadata(
  source:
    EdgeSamPromptGenerationInput['source']
): Record<
  string,
  string | number | boolean | null
> {
  if (
    !source ||
    typeof source !==
      'object' ||
    !(
      'metadata' in
      source
    ) ||
    !source.metadata ||
    typeof source.metadata !==
      'object'
  ) {
    return {};
  }

  return {
    ...source.metadata,
  };
}

/**
 * قراءة قيمة نصية من Metadata.
 */
function readPromptMetadataString(
  metadata:
    Record<
      string,
      string | number | boolean | null
    >,
  keys:
    readonly string[]
): string | null {
  for (
    const key
    of keys
  ) {
    const value =
      metadata[
        key
      ];

    if (
      typeof value ===
      'string' &&
    value.trim().length >
      0
    ) {
      return value.trim();
    }
  }

  return null;
}

/* =========================================================
 * Profile lookup candidate collection
 * ======================================================= */

/**
 * تجميع كل القيم المحتملة التي قد تشير
 * إلى Profile القطعة.
 */
function collectPromptProfileLookupCandidates(
  input:
    EdgeSamPromptGenerationInput,
  options?:
    EdgeSamPromptGeneratorOptions
): string[] {
  const metadata =
    getPromptSourceMetadata(
      input.source
    );

  const candidates = [
    options?.profileId,
    options?.templateId,
    options?.clothingType,
    options?.subCategory,
    options?.category,

    readPromptMetadataString(
      metadata,
      [
        'promptProfileId',
        'prompt_profile_id',
        'profileId',
        'profile_id',
      ]
    ),

    readPromptMetadataString(
      metadata,
      [
        'templateId',
        'template_id',
        'maskId',
        'mask_id',
      ]
    ),

    readPromptMetadataString(
      metadata,
      [
        'subCategory',
        'sub_category',
        'subcategory',
        'clothingType',
        'clothing_type',
        'itemType',
        'item_type',
      ]
    ),

    readPromptMetadataString(
      metadata,
      [
        'category',
        'scanCategory',
        'scan_category',
        'wardrobeCategory',
        'wardrobe_category',
      ]
    ),
  ];

  const normalizedCandidates:
    string[] = [];

  const seen =
    new Set<string>();

  for (
    const candidate
    of candidates
  ) {
    if (
      typeof candidate !==
      'string'
    ) {
      continue;
    }

    const normalized =
      candidate.trim();

    if (
      normalized.length ===
      0
    ) {
      continue;
    }

    const lookupKey =
      normalizeProfileLookupValue(
        normalized
      );

    if (
      lookupKey.length ===
        0 ||
      seen.has(
        lookupKey
      )
    ) {
      continue;
    }

    seen.add(
      lookupKey
    );

    normalizedCandidates.push(
      normalized
    );
  }

  return normalizedCandidates;
}

/* =========================================================
 * Profile resolution
 * ======================================================= */

/**
 * تحديد أفضل Summer Profile للطلب.
 */
function resolvePromptGenerationProfile(
  input:
    EdgeSamPromptGenerationInput,
  options?:
    EdgeSamPromptGeneratorOptions
): {
  profile:
    SummerClothingPromptProfile;

  matchedCandidate:
    string | null;

  usedGenericFallback:
    boolean;

  warnings:
    string[];
} {
  const warnings:
    string[] = [];

  const lookupCandidates =
    collectPromptProfileLookupCandidates(
      input,
      options
    );

  for (
    const candidate
    of lookupCandidates
  ) {
    const resolvedProfile =
      tryResolveSummerClothingPromptProfile(
        candidate
      );

    if (
      resolvedProfile
    ) {
      return {
        profile:
          resolvedProfile,

        matchedCandidate:
          candidate,

        usedGenericFallback:
          false,

        warnings,
      };
    }
  }

  if (
    lookupCandidates.length >
    0
  ) {
    warnings.push(
      [
        'No exact summer clothing prompt profile matched:',
        lookupCandidates.join(
          ', '
        ),
        'The generic summer item profile was used.',
      ].join(
        ' '
      )
    );
  } else {
    warnings.push(
      'No clothing profile metadata was provided. The generic summer item profile was used.'
    );
  }

  return {
    profile:
      cloneSummerClothingPromptProfile(
        GENERIC_SUMMER_ITEM_PROFILE
      ),

    matchedCandidate:
      null,

    usedGenericFallback:
      true,

    warnings,
  };
}

/* =========================================================
 * Prompt generation context creation
 * ======================================================= */

/**
 * إنشاء Context داخلي موحد.
 */
function createPromptGenerationContext(
  input:
    EdgeSamPromptGenerationInput,
  profile:
    SummerClothingPromptProfile,
  options?:
    EdgeSamPromptGeneratorOptions
): PromptGenerationContext {
  const requestId =
    options
      ?.requestId
      ?.trim() ||
    createSegmentationRequestId();

  return {
  requestId,

  startedAt:
    Date.now(),

  imageWidth:
    input.orientedImage.width,

  imageHeight:
    input.orientedImage.height,

  sourceWidth:
    input.orientedImage.width,

  sourceHeight:
    input.orientedImage.height,

  rgba:
    input.orientedImage.rgba,

  config:
    input.config,

  profile,

  transform:
    input.transform,

  onProgress:
    options?.onProgress,

  cancellationSignal:
    options?.cancellationSignal,

  warnings:
    [],
};

}

/* =========================================================
 * Manual-only configuration helpers
 * ======================================================= */

/**
 * هل الطلب يحتوي Manual Prompt حقيقية.
 */
function hasUsableManualPromptInput(
  input:
    EdgeSamPromptGenerationInput
): boolean {
  const manualPrompt =
    input.manualPrompt;

  if (
    !manualPrompt
  ) {
    return false;
  }

  const hasPoints =
    Array.isArray(
      manualPrompt.points
    ) &&
    manualPrompt.points.length >
      0;

  const hasBox =
    manualPrompt.box !==
      undefined &&
    manualPrompt.box !==
      null;

  const hasPreviousMask =
    manualPrompt
      .previousMask !==
      undefined &&
    manualPrompt
      .previousMask !==
      null;

  return (
    hasPoints ||
    hasBox ||
    hasPreviousMask
  );
}

/**
 * هل يجب تشغيل التحليل التلقائي.
 */
function shouldGenerateAutomaticPromptDraft(
  input:
    EdgeSamPromptGenerationInput
): boolean {
  if (
    input.config.enabled
  ) {
    return true;
  }

  /**
   * لو التوليد التلقائي متوقف لكن لا يوجد
   * Manual Prompt، نحتاج Fallback آمن.
   */
  return !hasUsableManualPromptInput(
    input
  );
}

/* =========================================================
 * Manual-only fallback draft
 * ======================================================= */

/**
 * إنشاء Draft خفيفة عندما يكون التوليد
 * التلقائي متوقفًا ويوجد Manual Prompt.
 *
 * هذه الـDraft لا تستبدل البيانات اليدوية؛
 * دورها فقط توفير Diagnostics وFallback داخلي.
 */
function createManualOnlyPromptDraft(
  context:
    PromptGenerationContext
): GeneratedPromptDraft {
  const foreground =
    createFallbackForegroundEstimate(
      context.profile,
      context.imageWidth,
      context.imageHeight,
      'Automatic prompt generation was disabled for this request.'
    );

  const background:
    BackgroundEstimate = {
    color:
      createNormalizedRgbColor(
        0,
        0,
        0
      ),

    luminance:
      0,

    confidence:
      0,

    sampleCount:
      0,

    variance:
      0,

    cornerConsistency:
      0,

    isUsable:
      false,
  };

  return {
    positivePoints:
      [],

    negativePoints:
      [],

    boundingBox:
      null,

    foreground,

    background,

    confidence:
      0,

    warnings: [
      'Automatic image analysis was skipped because automatic prompt generation is disabled.',
    ],

    usedFallback:
      true,

    profileId:
      context.profile.id,
  };
}

/* =========================================================
 * Prompt generation result warning merge
 * ======================================================= */

/**
 * إضافة تحذيرات Profile إلى النتيجة النهائية.
 */
function appendPromptResultWarnings(
  result:
    EdgeSamPromptGenerationResult,
  additionalWarnings:
    readonly string[]
): EdgeSamPromptGenerationResult {
  const warnings =
    normalizePromptWarnings([
      ...result.prompt
        .warnings,
      ...result.diagnostics
        .warnings,
      ...additionalWarnings,
    ]);

  return {
    ...result,

    prompt: {
      ...result.prompt,

      warnings,
    },

    diagnostics: {
      ...result.diagnostics,

      warnings,
    },
  };
}

/* =========================================================
 * Prompt generation execution
 * ======================================================= */

/**
 * تنفيذ Prompt Generation بالكامل.
 */
function executeEdgeSamPromptGeneration(
  input:
    EdgeSamPromptGenerationInput,
  options?:
    EdgeSamPromptGeneratorOptions
): EdgeSamPromptGenerationResult {
  const startedAt =
    Date.now();

  validatePromptGenerationInput(
    input
  );

  const profileResolution =
    resolvePromptGenerationProfile(
      input,
      options
    );

  const context =
    createPromptGenerationContext(
      input,
      profileResolution
        .profile,
      options
    );

  throwIfPromptGenerationCancelled(
    context
      .cancellationSignal,
    context.requestId
  );

  reportPromptGenerationProgress(
    context,
    0,
    'Starting EdgeSAM prompt generation.'
  );

  let automaticDraft:
    GeneratedPromptDraft;

  if (
    shouldGenerateAutomaticPromptDraft(
      input
    )
  ) {
    automaticDraft =
      createAutomaticPromptDraftFromInput(
        input,
        context
      );
  } else {
    automaticDraft =
      createManualOnlyPromptDraft(
        context
      );
  }

  throwIfPromptGenerationCancelled(
    context
      .cancellationSignal,
    context.requestId
  );

  reportPromptGenerationProgress(
    context,
    5,
    'Merging automatic and manual prompts.'
  );

  const result =
    createPromptGenerationResult(
      input,
      automaticDraft,
      startedAt
    );

  reportPromptGenerationProgress(
    context,
    PROMPT_GENERATION_STAGE_COUNT -
      1,
    'EdgeSAM prompt generation completed.'
  );

  return appendPromptResultWarnings(
    result,
    profileResolution
      .warnings
  );
}

/* =========================================================
 * Public prompt generator
 * ======================================================= */

/**
 * إنشاء Prompt كاملة لـEdgeSAM.
 *
 * هذا هو المدخل العام الأساسي للملف.
 */
export function generateEdgeSamPrompt(
  input:
    EdgeSamPromptGenerationInput,
  options?:
    EdgeSamPromptGeneratorOptions
): EdgeSamPromptGenerationResult {
  try {
    return executeEdgeSamPromptGeneration(
      input,
      options
    );
  } catch (
    error
  ) {
    if (
      error instanceof
      SegmentationError
    ) {
      throw error;
    }

    const message =
      error instanceof
        Error
        ? error.message
        : String(
            error
          );

    throw new SegmentationError(
      'PROMPT_GENERATION_FAILED',
      message
        ? `EdgeSAM prompt generation failed. ${message}`
        : 'EdgeSAM prompt generation failed.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,

        cause:
          error,

        requestId:
          options
            ?.requestId,
      }
    );
  }
}

/* =========================================================
 * Safe public prompt generator
 * ======================================================= */

export type EdgeSamPromptGenerationAttemptResult =
  | {
      success:
        true;

      result:
        EdgeSamPromptGenerationResult;

      error:
        null;
    }
  | {
      success:
        false;

      result:
        null;

      error:
        SegmentationError;
    };

/**
 * نسخة آمنة لا ترمي Error.
 */
export function tryGenerateEdgeSamPrompt(
  input:
    EdgeSamPromptGenerationInput,
  options?:
    EdgeSamPromptGeneratorOptions
): EdgeSamPromptGenerationAttemptResult {
  try {
    return {
      success:
        true,

      result:
        generateEdgeSamPrompt(
          input,
          options
        ),

      error:
        null,
    };
  } catch (
    error
  ) {
    if (
      error instanceof
      SegmentationError
    ) {
      return {
        success:
          false,

        result:
          null,

        error,
      };
    }

    return {
      success:
        false,

      result:
        null,

      error:
        new SegmentationError(
          'PROMPT_GENERATION_FAILED',
          error instanceof
            Error
            ? error.message
            : String(
                error
              ),
          {
            stage:
              'create-segmentation-prompt',

            retryable:
              false,

            cause:
              error,

            requestId:
              options
                ?.requestId,
          }
        ),
    };
  }
}

/* =========================================================
 * PromptGenerator class
 * ======================================================= */

/**
 * Class خفيفة لتسهيل إعادة استخدام
 * الإعدادات والـProfile بين عدة Requests.
 */
export class EdgeSamPromptGenerator {
  private readonly defaultOptions:
    EdgeSamPromptGeneratorOptions;

  constructor(
    defaultOptions:
      EdgeSamPromptGeneratorOptions = {}
  ) {
    this.defaultOptions = {
      ...defaultOptions,
    };
  }

  /**
   * إنشاء Prompt.
   */
  generate(
    input:
      EdgeSamPromptGenerationInput,
    options:
      EdgeSamPromptGeneratorOptions = {}
  ): EdgeSamPromptGenerationResult {
    return generateEdgeSamPrompt(
      input,
      {
        ...this.defaultOptions,
        ...options,

        requestId:
          options.requestId ??
          this.defaultOptions
            .requestId,

        onProgress:
          options.onProgress ??
          this.defaultOptions
            .onProgress,

        cancellationSignal:
          options
            .cancellationSignal ??
          this.defaultOptions
            .cancellationSignal,
      }
    );
  }

  /**
   * إنشاء Prompt دون رمي Error.
   */
  tryGenerate(
    input:
      EdgeSamPromptGenerationInput,
    options:
      EdgeSamPromptGeneratorOptions = {}
  ): EdgeSamPromptGenerationAttemptResult {
    try {
      return {
        success:
          true,

        result:
          this.generate(
            input,
            options
          ),

        error:
          null,
      };
    } catch (
      error
    ) {
      if (
        error instanceof
        SegmentationError
      ) {
        return {
          success:
            false,

          result:
            null,

          error,
        };
      }

      return {
        success:
          false,

        result:
          null,

        error:
          new SegmentationError(
            'PROMPT_GENERATION_FAILED',
            error instanceof
              Error
              ? error.message
              : String(
                  error
                ),
            {
              stage:
                'create-segmentation-prompt',

              retryable:
                false,

              cause:
                error,
            }
          ),
      };
    }
  }
}

/* =========================================================
 * Default generator instance
 * ======================================================= */

/**
 * Instance افتراضية قابلة لإعادة الاستخدام.
 */
export const DEFAULT_EDGE_SAM_PROMPT_GENERATOR =
  new EdgeSamPromptGenerator();

/**
 * Alias قصير للاستخدام داخل SegmentationEngine.
 */
export const PromptGenerator =
  EdgeSamPromptGenerator;

/* =========================================================
 * Full prompt debug summary
 * ======================================================= */

/**
 * إنشاء ملخص كامل للنتيجة.
 */
export function getEdgeSamPromptGenerationDebugSummary(
  result:
    EdgeSamPromptGenerationResult
): string {
  const prompt =
    result.prompt;

  const positivePointCount =
    countPositivePromptPoints(
      prompt.points
    );

  const negativePointCount =
    countNegativePromptPoints(
      prompt.points
    );

  const boxSummary =
    prompt.box
      ? [
          prompt.box.box.x1.toFixed(
            1
          ),
          prompt.box.box.y1.toFixed(
            1
          ),
          prompt.box.box.x2.toFixed(
            1
          ),
          prompt.box.box.y2.toFixed(
            1
          ),
        ].join(
          ','
        )
      : 'none';

  return [
    `mode=${prompt.mode}`,
    `automatic=${String(
      prompt.generatedAutomatically
    )}`,
    `space=${prompt.coordinateSpace}`,
    `size=${prompt.sourceSize.width}x${prompt.sourceSize.height}`,
    `positive=${positivePointCount}`,
    `negative=${negativePointCount}`,
    `box=${boxSummary}`,
    `previousMask=${String(
      prompt.previousMask !==
      null
    )}`,
    `source=${result.diagnostics.source}`,
    `regionConfidence=${result.diagnostics.regionConfidence.toFixed(
      3
    )}`,
    `centerConfidence=${result.diagnostics.centerConfidence.toFixed(
      3
    )}`,
    `fallback=${String(
      result.diagnostics.usedCenterFallback
    )}`,
    `durationMs=${result.durationMs.toFixed(
      2
    )}`,
    `warnings=${prompt.warnings.length}`,
  ].join(
    ' | '
  );
}

/* =========================================================
 * End of Part 1.10
 * ======================================================= */
/* =========================================================
 * Public coordinate conversion helpers
 * ======================================================= */

/**
 * تحويل نقطة بين مساحات إحداثيات EdgeSAM.
 *
 * المساحات المدعومة:
 *
 * - original-image
 * - oriented-image
 * - model-input
 * - normalized
 */
export function convertEdgeSamPromptPoint(
  point:
    SegmentationPoint,
  from:
    SegmentationCoordinateSpace,
  to:
    SegmentationCoordinateSpace,
  transform:
    SegmentationTransform
): SegmentationPoint {
  if (
    !isValidPixelPoint(
      point
    )
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'Cannot convert an invalid EdgeSAM prompt point.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !isKnownPromptCoordinateSpace(
      from
    ) ||
    !isKnownPromptCoordinateSpace(
      to
    )
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'Cannot convert an EdgeSAM prompt point using an unsupported coordinate space.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,

        metadata: {
          from:
            String(
              from
            ),

          to:
            String(
              to
            ),
        },
      }
    );
  }

  return convertPromptPointCoordinateSpace(
    point,
    from,
    to,
    transform
  );
}

/**
 * تحويل Bounding Box بين مساحات إحداثيات EdgeSAM.
 */
export function convertEdgeSamPromptBox(
  box:
    SegmentationBoxCoordinates,
  from:
    SegmentationCoordinateSpace,
  to:
    SegmentationCoordinateSpace,
  transform:
    SegmentationTransform
): SegmentationBoxCoordinates {
  if (
    !isValidCoordinateBox(
      box
    )
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'Cannot convert an invalid EdgeSAM prompt bounding box.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,
      }
    );
  }

  if (
    !isKnownPromptCoordinateSpace(
      from
    ) ||
    !isKnownPromptCoordinateSpace(
      to
    )
  ) {
    throw new SegmentationError(
      'PROMPT_INVALID',
      'Cannot convert an EdgeSAM prompt bounding box using an unsupported coordinate space.',
      {
        stage:
          'create-segmentation-prompt',

        retryable:
          false,

        metadata: {
          from:
            String(
              from
            ),

          to:
            String(
              to
            ),
        },
      }
    );
  }

  return convertPromptBoxCoordinateSpace(
    box,
    from,
    to,
    transform
  );
}

/* =========================================================
 * Public prompt validation
 * ======================================================= */

export type EdgeSamPromptValidationResult = {
  valid:
    boolean;

  positivePointCount:
    number;

  negativePointCount:
    number;

  hasBoundingBox:
    boolean;

  hasPreviousMask:
    boolean;

  warnings:
    readonly string[];
};

/**
 * التحقق من EdgeSamPrompt جاهزة.
 *
 * لا ترمي Error، بل تعيد نتيجة واضحة.
 */
export function validateEdgeSamPrompt(
  prompt:
    EdgeSamPrompt
): EdgeSamPromptValidationResult {
  const result =
    validateFinalEdgeSamPrompt(
      prompt
    );

  return {
    valid:
      result.valid,

    positivePointCount:
      result
        .positivePointCount,

    negativePointCount:
      result
        .negativePointCount,

    hasBoundingBox:
      result
        .hasBoundingBox,

    hasPreviousMask:
      result
        .hasPreviousMask,

    warnings:
      result.warnings,
  };
}

/**
 * التحقق من Prompt ورمي Error عند عدم صلاحيتها.
 */
export function assertValidEdgeSamPrompt(
  prompt:
    EdgeSamPrompt
): void {
  const validation =
    validateFinalEdgeSamPrompt(
      prompt
    );

  if (
    validation.valid
  ) {
    return;
  }

  throw new SegmentationError(
    'PROMPT_INVALID',
    [
      'EdgeSAM prompt is invalid.',
      ...validation.warnings,
    ].join(
      ' '
    ),
    {
      stage:
        'create-segmentation-prompt',

      retryable:
        false,
    }
  );
}

/* =========================================================
 * Prompt cloning
 * ======================================================= */

/**
 * نسخ Previous Mask دون مشاركة الـFloat32Array.
 */
function cloneEdgeSamPreviousMaskPrompt(
  previousMask:
    EdgeSamPreviousMaskPrompt | null
): EdgeSamPreviousMaskPrompt | null {
  if (
    !previousMask
  ) {
    return null;
  }

  return {
    ...previousMask,

    data:
      new Float32Array(
        previousMask.data
      ),

    dimensions:
      [
        ...previousMask
          .dimensions,
      ],
  };
}

/**
 * نسخ EdgeSamPrompt بالكامل.
 */
export function cloneEdgeSamPrompt(
  prompt:
    EdgeSamPrompt
): EdgeSamPrompt {
  return {
    ...prompt,

    points:
      prompt.points.map(
        point => ({
          ...point,
        })
      ),

    box:
      prompt.box
        ? {
            ...prompt.box,

            box: {
              ...prompt.box.box,
            },
          }
        : null,

    previousMask:
      cloneEdgeSamPreviousMaskPrompt(
        prompt.previousMask
      ),

    sourceSize: {
      ...prompt.sourceSize,
    },

    warnings: [
      ...prompt.warnings,
    ],
  };
}

/**
 * نسخ نتيجة Prompt Generation بالكامل.
 */
export function cloneEdgeSamPromptGenerationResult(
  result:
    EdgeSamPromptGenerationResult
): EdgeSamPromptGenerationResult {
  return {
    prompt:
      cloneEdgeSamPrompt(
        result.prompt
      ),

    diagnostics: {
      ...result.diagnostics,

      detectedRegion:
        result.diagnostics
          .detectedRegion
          ? {
              ...result
                .diagnostics
                .detectedRegion,
            }
          : null,

      warnings: [
        ...result
          .diagnostics
          .warnings,
      ],
    },

    durationMs:
      result.durationMs,
  };
}

/* =========================================================
 * Prompt tensor cloning
 * ======================================================= */

/**
 * نسخ نتيجة Prompt Tensors.
 */
export function cloneEdgeSamPromptTensorBuildResult(
  result:
    EdgeSamPromptTensorBuildResult
): EdgeSamPromptTensorBuildResult {
  return {
    pointCoordinates: {
      ...result
        .pointCoordinates,

      data:
        new Float32Array(
          result
            .pointCoordinates
            .data
        ),

      dimensions: [
        ...result
          .pointCoordinates
          .dimensions,
      ] as [
        1,
        number,
        2,
      ],
    },

    pointLabels: {
      ...result
        .pointLabels,

      data:
        new Float32Array(
          result
            .pointLabels
            .data
        ),

      dimensions: [
        ...result
          .pointLabels
          .dimensions,
      ] as [
        1,
        number,
      ],
    },

    pointCount:
      result.pointCount,

    positivePointCount:
      result
        .positivePointCount,

    negativePointCount:
      result
        .negativePointCount,

    boxPointCount:
      result.boxPointCount,

    paddingPointCount:
      result
        .paddingPointCount,

    warnings: [
      ...result.warnings,
    ],

    durationMs:
      result.durationMs,
  };
}

/* =========================================================
 * Profile diagnostics
 * ======================================================= */

export type EdgeSamPromptProfileSummary = {
  id:
    string;

  family:
    SummerClothingPromptProfile['family'];

  orientation:
    SummerClothingPromptProfile['orientation'];

  pointPattern:
    SummerClothingPromptProfile['pointPattern'];

  preferredPositivePointCount:
    number;

  preferredNegativePointCount:
    number;

  preserveThinStructures:
    boolean;

  supportsSeparatedRegions:
    boolean;

  preferBoundingBox:
    boolean;

  aliases:
    readonly string[];
};

/**
 * إنشاء ملخص Profile خفيف للاختبارات والـUI.
 */
export function getEdgeSamPromptProfileSummary(
  profile:
    SummerClothingPromptProfile
): EdgeSamPromptProfileSummary {
  return {
    id:
      profile.id,

    family:
      profile.family,

    orientation:
      profile.orientation,

    pointPattern:
      profile.pointPattern,

    preferredPositivePointCount:
      profile
        .preferredPositivePointCount,

    preferredNegativePointCount:
      profile
        .preferredNegativePointCount,

    preserveThinStructures:
      profile
        .preserveThinStructures,

    supportsSeparatedRegions:
      profile
        .supportsSeparatedRegions,

    preferBoundingBox:
      profile.preferBoundingBox,

    aliases: [
      ...profile.aliases,
    ],
  };
}

/**
 * إرجاع ملخصات جميع Profiles الصيفية.
 */
export function getAllEdgeSamPromptProfileSummaries():
  readonly EdgeSamPromptProfileSummary[] {
  return getAllSummerClothingPromptProfiles()
    .map(
      profile =>
        getEdgeSamPromptProfileSummary(
          profile
        )
    );
}

/* =========================================================
 * Runtime validation
 * ======================================================= */

export type PromptGeneratorRuntimeValidationResult = {
  valid:
    boolean;

  profileCount:
    number;

  registryWarnings:
    readonly string[];

  errors:
    readonly string[];
};

/**
 * فحص داخلي سريع للتأكد أن PromptGenerator
 * جاهز قبل تشغيل التطبيق.
 */
export function validatePromptGeneratorRuntime():
  PromptGeneratorRuntimeValidationResult {
  const errors:
    string[] = [];

  const registryWarnings:
    string[] = [];

  const registryValidation =
    validateSummerClothingPromptProfileRegistry();

  if (
    !registryValidation.valid
  ) {
    errors.push(
      ...registryValidation.errors
    );
  }

  registryWarnings.push(
    ...registryValidation.warnings
  );

  const profiles =
    getAllSummerClothingPromptProfiles();

  if (
    profiles.length ===
    0
  ) {
    errors.push(
      'PromptGenerator does not contain any registered summer clothing profiles.'
    );
  }

  const genericValidation =
    validateSummerClothingPromptProfile(
      GENERIC_SUMMER_ITEM_PROFILE
    );

  if (
  genericValidation.errors.length >
  0
) {
    errors.push(
      ...genericValidation.errors.map(
        error =>
          `Generic profile: ${error}`
      )
    );
  }

  registryWarnings.push(
    ...genericValidation
      .warnings
      .map(
        warning =>
          `Generic profile: ${warning}`
      )
  );

  return {
    valid:
      errors.length ===
      0,

    profileCount:
      profiles.length,

    registryWarnings:
      normalizePromptWarnings(
        registryWarnings
      ),

    errors:
      normalizePromptWarnings(
        errors
      ),
  };
}

/**
 * رمي Error لو Registry أو العقود الداخلية غير سليمة.
 */
export function assertPromptGeneratorRuntimeValid():
  void {
  const validation =
    validatePromptGeneratorRuntime();

  if (
    validation.valid
  ) {
    return;
  }

  throw new SegmentationError(
    'PROMPT_GENERATION_FAILED',
    [
      'PromptGenerator runtime validation failed.',
      ...validation.errors,
    ].join(
      ' '
    ),
    {
      stage:
        'create-segmentation-prompt',

      retryable:
        false,

      metadata: {
        profileCount:
          validation.profileCount,
      },
    }
  );
}

/* =========================================================
 * Complete PromptGenerator diagnostics
 * ======================================================= */

export type EdgeSamPromptGeneratorDiagnostics = {
  profileCount:
    number;

  runtimeValid:
    boolean;

  registryWarnings:
    readonly string[];

  runtimeErrors:
    readonly string[];

  maximumPositivePointCount:
    number;

  maximumNegativePointCount:
    number;

  maximumTotalPointCount:
    number;

  promptGenerationStageCount:
    number;

  modelFamily:
    'edgesam';
};

/**
 * Diagnostics ثابتة للملف نفسه.
 */
export function getEdgeSamPromptGeneratorDiagnostics():
  EdgeSamPromptGeneratorDiagnostics {
  const runtimeValidation =
    validatePromptGeneratorRuntime();

  return {
    profileCount:
      runtimeValidation
        .profileCount,

    runtimeValid:
      runtimeValidation
        .valid,

    registryWarnings:
      runtimeValidation
        .registryWarnings,

    runtimeErrors:
      runtimeValidation
        .errors,

    maximumPositivePointCount:
      MAXIMUM_POSITIVE_POINT_COUNT,

    maximumNegativePointCount:
      MAXIMUM_NEGATIVE_POINT_COUNT,

    maximumTotalPointCount:
      MAXIMUM_TOTAL_POINT_COUNT,

    promptGenerationStageCount:
      PROMPT_GENERATION_STAGE_COUNT,

    modelFamily:
      'edgesam',
  };
}

/* =========================================================
 * Startup runtime guard
 * ======================================================= */

const PROMPT_GENERATOR_RUNTIME_VALIDATION =
  validatePromptGeneratorRuntime();

if (
  !PROMPT_GENERATOR_RUNTIME_VALIDATION
    .valid
) {
  throw new SegmentationError(
    'PROMPT_GENERATION_FAILED',
    [
      'PromptGenerator failed startup validation.',
      ...PROMPT_GENERATOR_RUNTIME_VALIDATION
        .errors,
    ].join(
      ' '
    ),
    {
      stage:
        'create-segmentation-prompt',

      retryable:
        false,

      metadata: {
        profileCount:
          PROMPT_GENERATOR_RUNTIME_VALIDATION
            .profileCount,
      },
    }
  );
}

/* =========================================================
 * Default public API
 * ======================================================= */

/**
 * API مجمعة اختيارية لمن يفضل استيراد
 * PromptGenerator ككائن واحد.
 */
export const EdgeSamPromptGeneratorApi = {
  generate:
    generateEdgeSamPrompt,

  tryGenerate:
    tryGenerateEdgeSamPrompt,

  buildTensors:
    buildEdgeSamPromptTensors,

  validate:
    validateEdgeSamPrompt,

  assertValid:
    assertValidEdgeSamPrompt,

  clonePrompt:
    cloneEdgeSamPrompt,

  cloneResult:
    cloneEdgeSamPromptGenerationResult,

  convertPoint:
    convertEdgeSamPromptPoint,

  convertBox:
    convertEdgeSamPromptBox,

  resolveProfile:
    resolveSummerClothingPromptProfile,

  tryResolveProfile:
    tryResolveSummerClothingPromptProfile,

  getProfiles:
    getAllSummerClothingPromptProfiles,

  getDiagnostics:
    getEdgeSamPromptGeneratorDiagnostics,
} as const;

/* =========================================================
 * End of PromptGenerator.ts
 * ======================================================= */