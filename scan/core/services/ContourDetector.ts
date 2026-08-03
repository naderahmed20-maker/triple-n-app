// scan/core/services/ContourDetector.ts

import {
    type ScanBounds,
    type ScanPoint,
} from '../scanTypes';

import {
    analyzeAlphaMask,
    thresholdAlphaMask,
    validateAlphaMask,
    type AlphaMask,
    type MaskStatistics,
} from '../ai/MaskGenerator';

/**
 * طريقة استخراج المحيط.
 *
 * boundary:
 * يتتبع Pixels الخارجية للجسم مباشرة.
 *
 * marchingSquares:
 * ينشئ محيطًا أكثر سلاسة بين Pixels.
 *
 * automatic:
 * يختار الطريقة الأنسب تلقائيًا.
 */
export type ContourDetectionMethod =
  | 'automatic'
  | 'boundary'
  | 'marchingSquares';

/**
 * اتجاه ترتيب نقاط المحيط.
 */
export type ContourDirection =
  | 'clockwise'
  | 'counterclockwise'
  | 'preserve';

/**
 * إعدادات تنظيف وتجهيز المحيط.
 */
export type ContourCleanupConfig = {
  /**
   * إزالة النقاط المتقاربة والمتكررة.
   */
  removeDuplicatePoints: boolean;

  /**
   * أقل مسافة بين نقطتين متتاليتين.
   */
  minimumPointDistance: number;

  /**
   * تبسيط المحيط بخوارزمية
   * Ramer–Douglas–Peucker.
   */
  simplify: boolean;

  /**
   * مقدار التبسيط بوحدة Pixel.
   */
  simplifyTolerance: number;

  /**
   * تنعيم المحيط.
   */
  smooth: boolean;

  /**
   * عدد دورات التنعيم.
   */
  smoothingIterations: number;

  /**
   * قوة التنعيم من 0 إلى 0.5.
   */
  smoothingStrength: number;

  /**
   * إعادة توزيع النقاط بعدد ثابت.
   *
   * null يعني الاحتفاظ بعدد النقاط الناتج.
   */
  resamplePointCount: number | null;

  /**
   * أقل عدد نقاط مسموح به.
   */
  minimumPointCount: number;

  /**
   * أكبر عدد نقاط مسموح به.
   */
  maximumPointCount: number;

  /**
   * اتجاه نقاط المحيط النهائي.
   */
  direction: ContourDirection;

  /**
   * يبدأ المحيط من أقصى نقطة يسارًا
   * لتثبيت ترتيب المقارنة.
   */
  normalizeStartPoint: boolean;
};

/**
 * إعدادات ContourDetector.
 */
export type ContourDetectorConfig = {
  method: ContourDetectionMethod;

  /**
   * الحد الذي تتحول بعده قيمة الـMask
   * إلى Foreground.
   */
  threshold: number;

  /**
   * استخراج أكبر محيط فقط.
   */
  keepLargestContour: boolean;

  /**
   * أقل مساحة للمحيط كنسبة من الصورة.
   */
  minimumAreaRatio: number;

  /**
   * تجاهل المحيطات التي تلامس
   * حافة الصورة.
   */
  rejectEdgeTouchingContour: boolean;

  /**
   * المسافة المسموح بها من الحافة
   * قبل اعتبار المحيط ملامسًا لها.
   */
  edgeMargin: number;

  cleanup: ContourCleanupConfig;

  /**
   * أقل ثقة لقبول النتيجة.
   */
  minimumConfidence: number;
};

/**
 * معلومات هندسية لمحيط واحد.
 */
export type ContourGeometry = {
  bounds: ScanBounds;

  center: ScanPoint;

  centroid: ScanPoint;

  area: number;

  signedArea: number;

  perimeter: number;

  aspectRatio: number;

  fillRatio: number;

  roundness: number;

  clockwise: boolean;

  touchesImageEdge: boolean;
};

/**
 * محيط مكتشف.
 */
export type DetectedContour = {
  id: string;

  points: ScanPoint[];

  geometry: ContourGeometry;

  confidence: number;

  pointCount: number;

  sourceMethod:
    | 'boundary'
    | 'marchingSquares';
};

/**
 * نتيجة اكتشاف كل المحيطات.
 */
export type ContourDetectionResult = {
  /**
   * المحيط الرئيسي الذي سيُرسل
   * إلى ShapeMatcher.
   */
  contour: DetectedContour;

  /**
   * جميع المحيطات المقبولة.
   */
  contours: DetectedContour[];

  maskStatistics: MaskStatistics;

  confidence: number;

  processingMs: number;

  method:
    | 'boundary'
    | 'marchingSquares';
};

/**
 * مدخل الاكتشاف.
 */
export type DetectContourInput = {
  mask: AlphaMask;

  config?: Partial<ContourDetectorConfig> & {
    cleanup?: Partial<ContourCleanupConfig>;
  };

  signal?: AbortSignal;
};

/**
 * نتيجة آمنة لا ترمي Error.
 */
export type TryDetectContourResult =
  | {
      success: true;

      result: ContourDetectionResult;
    }
  | {
      success: false;

      error: ContourDetectorError;
    };

export type ContourDetectorErrorCode =
  | 'INVALID_MASK'
  | 'EMPTY_MASK'
  | 'ABORTED'
  | 'NO_CONTOUR'
  | 'CONTOUR_TOO_SMALL'
  | 'CONTOUR_TOUCHES_EDGE'
  | 'LOW_CONFIDENCE'
  | 'DETECTION_FAILED';

/**
 * Error معروف من ContourDetector.
 */
export class ContourDetectorError extends Error {
  readonly code: ContourDetectorErrorCode;

  readonly causeValue?: unknown;

  constructor(
    code: ContourDetectorErrorCode,
    message: string,
    causeValue?: unknown
  ) {
    super(message);

    this.name =
      'ContourDetectorError';

    this.code =
      code;

    this.causeValue =
      causeValue;
  }
}

const EPSILON =
  0.000001;

const DEFAULT_CONTOUR_CLEANUP_CONFIG: ContourCleanupConfig = {
  removeDuplicatePoints: true,

  minimumPointDistance: 0.75,

  simplify: true,

  simplifyTolerance: 1.5,

  smooth: true,

  smoothingIterations: 1,

  smoothingStrength: 0.16,

  resamplePointCount: 128,

  minimumPointCount: 16,

  maximumPointCount: 512,

  direction: 'clockwise',

  normalizeStartPoint: true,
};

export const DEFAULT_CONTOUR_DETECTOR_CONFIG: ContourDetectorConfig = {
  method: 'automatic',

  threshold: 120,

  keepLargestContour: true,

  minimumAreaRatio: 0.0025,

  rejectEdgeTouchingContour: false,

  edgeMargin: 1,

  cleanup:
    DEFAULT_CONTOUR_CLEANUP_CONFIG,

  minimumConfidence: 0.38,
};

/**
 * اتجاهات الجيران الثمانية
 * بترتيب Clockwise.
 */
const CLOCKWISE_NEIGHBORS = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
] as const;

/**
 * الجيران الأربعة.
 */
const CARDINAL_NEIGHBORS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
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

function throwIfAborted(
  signal?: AbortSignal
) {
  if (
    signal?.aborted
  ) {
    throw new ContourDetectorError(
      'ABORTED',
      'Contour detection was aborted.'
    );
  }
}

function resolveConfig(
  custom:
    DetectContourInput['config']
): ContourDetectorConfig {
  const cleanup = {
    ...DEFAULT_CONTOUR_CLEANUP_CONFIG,
    ...custom?.cleanup,
  };

  return {
    ...DEFAULT_CONTOUR_DETECTOR_CONFIG,
    ...custom,

    threshold:
      clamp(
        Math.round(
          custom?.threshold ??
            DEFAULT_CONTOUR_DETECTOR_CONFIG
              .threshold
        ),
        0,
        255
      ),

    minimumAreaRatio:
      clamp(
        custom?.minimumAreaRatio ??
          DEFAULT_CONTOUR_DETECTOR_CONFIG
            .minimumAreaRatio,
        0,
        1
      ),

    edgeMargin:
      Math.max(
        0,
        Math.floor(
          custom?.edgeMargin ??
            DEFAULT_CONTOUR_DETECTOR_CONFIG
              .edgeMargin
        )
      ),

    minimumConfidence:
      normalizeConfidence(
        custom?.minimumConfidence ??
          DEFAULT_CONTOUR_DETECTOR_CONFIG
            .minimumConfidence
      ),

    cleanup: {
      ...cleanup,

      minimumPointDistance:
        Math.max(
          0,
          Number.isFinite(
            cleanup.minimumPointDistance
          )
            ? cleanup.minimumPointDistance
            : DEFAULT_CONTOUR_CLEANUP_CONFIG
                .minimumPointDistance
        ),

      simplifyTolerance:
        Math.max(
          0,
          Number.isFinite(
            cleanup.simplifyTolerance
          )
            ? cleanup.simplifyTolerance
            : DEFAULT_CONTOUR_CLEANUP_CONFIG
                .simplifyTolerance
        ),

      smoothingIterations:
        Math.max(
          0,
          Math.floor(
            Number.isFinite(
              cleanup.smoothingIterations
            )
              ? cleanup.smoothingIterations
              : DEFAULT_CONTOUR_CLEANUP_CONFIG
                  .smoothingIterations
          )
        ),

      smoothingStrength:
        clamp(
          Number.isFinite(
            cleanup.smoothingStrength
          )
            ? cleanup.smoothingStrength
            : DEFAULT_CONTOUR_CLEANUP_CONFIG
                .smoothingStrength,
          0,
          0.5
        ),

      resamplePointCount:
        cleanup.resamplePointCount ===
          null
          ? null
          : Math.max(
              3,
              Math.floor(
                Number.isFinite(
                  cleanup.resamplePointCount
                )
                  ? cleanup.resamplePointCount
                  : DEFAULT_CONTOUR_CLEANUP_CONFIG
                      .resamplePointCount ??
                    128
              )
            ),

      minimumPointCount:
        Math.max(
          3,
          Math.floor(
            Number.isFinite(
              cleanup.minimumPointCount
            )
              ? cleanup.minimumPointCount
              : DEFAULT_CONTOUR_CLEANUP_CONFIG
                  .minimumPointCount
          )
        ),

      maximumPointCount:
        Math.max(
          3,
          Math.floor(
            Number.isFinite(
              cleanup.maximumPointCount
            )
              ? cleanup.maximumPointCount
              : DEFAULT_CONTOUR_CLEANUP_CONFIG
                  .maximumPointCount
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

function isForeground(
  mask: AlphaMask,
  x: number,
  y: number
) {
  if (
    !isInsideImage(
      x,
      y,
      mask.width,
      mask.height
    )
  ) {
    return false;
  }

  return (
    mask.data[
      getPixelIndex(
        x,
        y,
        mask.width
      )
    ] >
    0
  );
}

function clonePoint(
  point: ScanPoint
): ScanPoint {
  return {
    x:
      point.x,

    y:
      point.y,
  };
}

function distanceSquared(
  first: ScanPoint,
  second: ScanPoint
) {
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

function distance(
  first: ScanPoint,
  second: ScanPoint
) {
  return Math.sqrt(
    distanceSquared(
      first,
      second
    )
  );
}

/**
 * هل Pixel من Pixels حافة الجسم؟
 */
function isBoundaryPixel(
  mask: AlphaMask,
  x: number,
  y: number
) {
  if (
    !isForeground(
      mask,
      x,
      y
    )
  ) {
    return false;
  }

  for (
    const neighbor
    of CARDINAL_NEIGHBORS
  ) {
    if (
      !isForeground(
        mask,
        x +
          neighbor.x,
        y +
          neighbor.y
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * استخراج مجموعات Foreground المتصلة.
 */
type PixelComponent = {
  pixels: number[];

  area: number;

  bounds: ScanBounds;

  touchesImageEdge: boolean;
};

function findForegroundComponents(
  mask: AlphaMask,
  signal?: AbortSignal
): PixelComponent[] {
  const visited =
    new Uint8Array(
      mask.data.length
    );

  const components:
    PixelComponent[] = [];

  for (
    let startY = 0;
    startY <
      mask.height;
    startY += 1
  ) {
    throwIfAborted(
      signal
    );

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

      const queue: number[] = [
        startIndex,
      ];

      const pixels: number[] = [];

      visited[
        startIndex
      ] =
        1;

      let queueIndex =
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
        if (
          queueIndex %
            4096 ===
          0
        ) {
          throwIfAborted(
            signal
          );
        }

        const index =
          queue[
            queueIndex
          ];

        queueIndex +=
          1;

        pixels.push(
          index
        );

        const x =
          index %
          mask.width;

        const y =
          Math.floor(
            index /
            mask.width
          );

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
          const neighbor
          of CLOCKWISE_NEIGHBORS
        ) {
          const neighborX =
            x +
            neighbor.x;

          const neighborY =
            y +
            neighbor.y;

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

          queue.push(
            neighborIndex
          );
        }
      }

      components.push({
        pixels,

        area:
          pixels.length,

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

/**
 * إنشاء Mask منفصل لمكوّن واحد.
 */
function createComponentMask(
  sourceMask: AlphaMask,
  component: PixelComponent
): AlphaMask {
  const data =
    new Uint8Array(
      sourceMask.data.length
    );

  for (
    const index
    of component.pixels
  ) {
    data[index] =
      255;
  }

  return {
    width:
      sourceMask.width,

    height:
      sourceMask.height,

    data,
  };
}

/**
 * إيجاد أول Pixel خارجية.
 */
function findBoundaryStart(
  mask: AlphaMask
): ScanPoint | null {
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
      if (
        isBoundaryPixel(
          mask,
          x,
          y
        )
      ) {
        return {
          x,
          y,
        };
      }
    }
  }

  return null;
}

function getNeighborDirectionIndex(
  center: ScanPoint,
  neighbor: ScanPoint
) {
  const deltaX =
    Math.sign(
      neighbor.x -
      center.x
    );

  const deltaY =
    Math.sign(
      neighbor.y -
      center.y
    );

  return CLOCKWISE_NEIGHBORS.findIndex(
    direction =>
      direction.x ===
        deltaX &&
      direction.y ===
        deltaY
  );
}

/**
 * Moore Neighbor Tracing.
 *
 * يتتبع Pixels الخارجية
 * في ترتيب متصل.
 */
function traceBoundaryContour(
  mask: AlphaMask,
  signal?: AbortSignal
): ScanPoint[] {
  const start =
    findBoundaryStart(
      mask
    );

  if (!start) {
    return [];
  }

  const contour: ScanPoint[] = [];

  let current =
    clonePoint(
      start
    );

  let backtrack: ScanPoint = {
    x:
      start.x -
      1,

    y:
      start.y,
  };

  const firstBacktrack =
    clonePoint(
      backtrack
    );

  const maximumSteps =
    Math.max(
      64,
      mask.width *
        mask.height *
        4
    );

  let step =
    0;

  do {
    if (
      step %
        2048 ===
      0
    ) {
      throwIfAborted(
        signal
      );
    }

    contour.push(
      clonePoint(
        current
      )
    );

    const backtrackDirection =
      getNeighborDirectionIndex(
        current,
        backtrack
      );

    const startDirection =
      backtrackDirection >=
        0
        ? (
            backtrackDirection +
            1
          ) %
          CLOCKWISE_NEIGHBORS
            .length
        : 0;

    let nextPoint:
      ScanPoint | null =
      null;

    let nextBacktrack:
      ScanPoint | null =
      null;

    for (
      let offset = 0;
      offset <
        CLOCKWISE_NEIGHBORS
          .length;
      offset += 1
    ) {
      const directionIndex =
        (
          startDirection +
          offset
        ) %
        CLOCKWISE_NEIGHBORS
          .length;

      const direction =
        CLOCKWISE_NEIGHBORS[
          directionIndex
        ];

      const candidate: ScanPoint = {
        x:
          current.x +
          direction.x,

        y:
          current.y +
          direction.y,
      };

      if (
        isForeground(
          mask,
          candidate.x,
          candidate.y
        )
      ) {
        nextPoint =
          candidate;

        const previousDirectionIndex =
          (
            directionIndex -
            1 +
            CLOCKWISE_NEIGHBORS
              .length
          ) %
          CLOCKWISE_NEIGHBORS
            .length;

        const previousDirection =
          CLOCKWISE_NEIGHBORS[
            previousDirectionIndex
          ];

        nextBacktrack = {
          x:
            current.x +
            previousDirection.x,

          y:
            current.y +
            previousDirection.y,
        };

        break;
      }
    }

    if (
      !nextPoint ||
      !nextBacktrack
    ) {
      break;
    }

    backtrack =
      nextBacktrack;

    current =
      nextPoint;

    step +=
      1;

    if (
      step >
      maximumSteps
    ) {
      break;
    }
  } while (
    !(
      current.x ===
        start.x &&
      current.y ===
        start.y &&
      backtrack.x ===
        firstBacktrack.x &&
      backtrack.y ===
        firstBacktrack.y
    )
  );

  return contour;
}

/**
 * Marching Squares segments.
 */
type Segment = {
  start: ScanPoint;

  end: ScanPoint;
};

function getMarchingSquareSegments(
  mask: AlphaMask,
  signal?: AbortSignal
): Segment[] {
  const segments: Segment[] = [];

  function top(
    x: number,
    y: number
  ): ScanPoint {
    return {
      x:
        x +
        0.5,

      y,
    };
  }

  function right(
    x: number,
    y: number
  ): ScanPoint {
    return {
      x:
        x +
        1,

      y:
        y +
        0.5,
    };
  }

  function bottom(
    x: number,
    y: number
  ): ScanPoint {
    return {
      x:
        x +
        0.5,

      y:
        y +
        1,
    };
  }

  function left(
    x: number,
    y: number
  ): ScanPoint {
    return {
      x,

      y:
        y +
        0.5,
    };
  }

  function add(
    start: ScanPoint,
    end: ScanPoint
  ) {
    segments.push({
      start,
      end,
    });
  }

  for (
    let y = -1;
    y <
      mask.height;
    y += 1
  ) {
    throwIfAborted(
      signal
    );

    for (
      let x = -1;
      x <
        mask.width;
      x += 1
    ) {
      const topLeft =
        isForeground(
          mask,
          x,
          y
        )
          ? 1
          : 0;

      const topRight =
        isForeground(
          mask,
          x +
            1,
          y
        )
          ? 2
          : 0;

      const bottomRight =
        isForeground(
          mask,
          x +
            1,
          y +
            1
        )
          ? 4
          : 0;

      const bottomLeft =
        isForeground(
          mask,
          x,
          y +
            1
        )
          ? 8
          : 0;

      const state =
        topLeft |
        topRight |
        bottomRight |
        bottomLeft;

      switch (
        state
      ) {
        case 0:
        case 15:
          break;

        case 1:
          add(
            left(
              x,
              y
            ),
            top(
              x,
              y
            )
          );
          break;

        case 2:
          add(
            top(
              x,
              y
            ),
            right(
              x,
              y
            )
          );
          break;

        case 3:
          add(
            left(
              x,
              y
            ),
            right(
              x,
              y
            )
          );
          break;

        case 4:
          add(
            right(
              x,
              y
            ),
            bottom(
              x,
              y
            )
          );
          break;

        case 5:
          add(
            left(
              x,
              y
            ),
            top(
              x,
              y
            )
          );

          add(
            right(
              x,
              y
            ),
            bottom(
              x,
              y
            )
          );
          break;

        case 6:
          add(
            top(
              x,
              y
            ),
            bottom(
              x,
              y
            )
          );
          break;

        case 7:
          add(
            left(
              x,
              y
            ),
            bottom(
              x,
              y
            )
          );
          break;

        case 8:
          add(
            bottom(
              x,
              y
            ),
            left(
              x,
              y
            )
          );
          break;

        case 9:
          add(
            bottom(
              x,
              y
            ),
            top(
              x,
              y
            )
          );
          break;

        case 10:
          add(
            top(
              x,
              y
            ),
            right(
              x,
              y
            )
          );

          add(
            bottom(
              x,
              y
            ),
            left(
              x,
              y
            )
          );
          break;

        case 11:
          add(
            bottom(
              x,
              y
            ),
            right(
              x,
              y
            )
          );
          break;

        case 12:
          add(
            right(
              x,
              y
            ),
            left(
              x,
              y
            )
          );
          break;

        case 13:
          add(
            top(
              x,
              y
            ),
            right(
              x,
              y
            )
          );
          break;

        case 14:
          add(
            left(
              x,
              y
            ),
            top(
              x,
              y
            )
          );
          break;
      }
    }
  }

  return segments;
}

function pointKey(
  point: ScanPoint
) {
  return `${point.x.toFixed(
    3
  )},${point.y.toFixed(
    3
  )}`;
}

/**
 * ربط Segments الناتجة من
 * Marching Squares إلى محيطات مغلقة.
 */
function connectSegmentsToContours(
  segments: Segment[],
  signal?: AbortSignal
): ScanPoint[][] {
  const pointToSegments =
    new Map<
      string,
      number[]
    >();

  for (
    let index = 0;
    index <
      segments.length;
    index += 1
  ) {
    const segment =
      segments[index];

    const startKey =
      pointKey(
        segment.start
      );

    const endKey =
      pointKey(
        segment.end
      );

    const startList =
      pointToSegments.get(
        startKey
      ) ?? [];

    startList.push(
      index
    );

    pointToSegments.set(
      startKey,
      startList
    );

    const endList =
      pointToSegments.get(
        endKey
      ) ?? [];

    endList.push(
      index
    );

    pointToSegments.set(
      endKey,
      endList
    );
  }

  const used =
    new Uint8Array(
      segments.length
    );

  const contours:
    ScanPoint[][] = [];

  for (
    let startIndex = 0;
    startIndex <
      segments.length;
    startIndex += 1
  ) {
    throwIfAborted(
      signal
    );

    if (
      used[
        startIndex
      ]
    ) {
      continue;
    }

    const firstSegment =
      segments[
        startIndex
      ];

    used[
      startIndex
    ] =
      1;

    const contour:
      ScanPoint[] = [
        clonePoint(
          firstSegment.start
        ),
        clonePoint(
          firstSegment.end
        ),
      ];

    const startKey =
      pointKey(
        firstSegment.start
      );

    let currentKey =
      pointKey(
        firstSegment.end
      );

    let safety =
      0;

    while (
      currentKey !==
        startKey &&
      safety <
        segments.length +
          10
    ) {
      const candidates =
        pointToSegments.get(
          currentKey
        ) ?? [];

      let selectedIndex =
        -1;

      for (
        const candidateIndex
        of candidates
      ) {
        if (
          !used[
            candidateIndex
          ]
        ) {
          selectedIndex =
            candidateIndex;

          break;
        }
      }

      if (
        selectedIndex <
        0
      ) {
        break;
      }

      used[
        selectedIndex
      ] =
        1;

      const selected =
        segments[
          selectedIndex
        ];

      const selectedStartKey =
        pointKey(
          selected.start
        );

      const selectedEndKey =
        pointKey(
          selected.end
        );

      const nextPoint =
        selectedStartKey ===
          currentKey
          ? selected.end
          : selected.start;

      contour.push(
        clonePoint(
          nextPoint
        )
      );

      currentKey =
        selectedStartKey ===
          currentKey
          ? selectedEndKey
          : selectedStartKey;

      safety +=
        1;
    }

    if (
      contour.length >=
      4
    ) {
      const first =
        contour[0];

      const last =
        contour[
          contour.length -
            1
        ];

      if (
        distanceSquared(
          first,
          last
        ) <=
        0.001
      ) {
        contour.pop();
      }

      contours.push(
        contour
      );
    }
  }

  return contours;
}

/**
 * استخراج المحيط بطريقة
 * Marching Squares.
 */
function detectMarchingSquareContours(
  mask: AlphaMask,
  signal?: AbortSignal
) {
  const segments =
    getMarchingSquareSegments(
      mask,
      signal
    );

  return connectSegmentsToContours(
    segments,
    signal
  );
}

/**
 * إزالة النقاط المتكررة والمتقاربة.
 */
export function removeDuplicateContourPoints(
  inputPoints:
    readonly ScanPoint[],
  minimumDistance = 0.75
): ScanPoint[] {
  if (
    inputPoints.length ===
    0
  ) {
    return [];
  }

  const safeDistance =
    Math.max(
      0,
      minimumDistance
    );

  const safeDistanceSquared =
    safeDistance *
    safeDistance;

  const output:
    ScanPoint[] = [
      clonePoint(
        inputPoints[0]
      ),
    ];

  for (
    let index = 1;
    index <
      inputPoints.length;
    index += 1
  ) {
    const current =
      inputPoints[
        index
      ];

    const previous =
      output[
        output.length -
          1
      ];

    if (
      distanceSquared(
        current,
        previous
      ) >=
      safeDistanceSquared
    ) {
      output.push(
        clonePoint(
          current
        )
      );
    }
  }

  if (
    output.length >
      2 &&
    distanceSquared(
      output[0],
      output[
        output.length -
          1
      ]
    ) <
      safeDistanceSquared
  ) {
    output.pop();
  }

  return output;
}

/**
 * أقرب مسافة بين نقطة وخط.
 */
function perpendicularDistance(
  point: ScanPoint,
  lineStart: ScanPoint,
  lineEnd: ScanPoint
) {
  const lineDeltaX =
    lineEnd.x -
    lineStart.x;

  const lineDeltaY =
    lineEnd.y -
    lineStart.y;

  const lengthSquared =
    lineDeltaX *
      lineDeltaX +
    lineDeltaY *
      lineDeltaY;

  if (
    lengthSquared <=
    EPSILON
  ) {
    return distance(
      point,
      lineStart
    );
  }

  const progress =
    clamp(
      (
        (
          point.x -
          lineStart.x
        ) *
          lineDeltaX +
        (
          point.y -
          lineStart.y
        ) *
          lineDeltaY
      ) /
        lengthSquared,
      0,
      1
    );

  const projected: ScanPoint = {
    x:
      lineStart.x +
      progress *
        lineDeltaX,

    y:
      lineStart.y +
      progress *
        lineDeltaY,
  };

  return distance(
    point,
    projected
  );
}

/**
 * Ramer–Douglas–Peucker
 * لمجموعة نقاط مفتوحة.
 */
function simplifyOpenLine(
  points:
    readonly ScanPoint[],
  tolerance: number
): ScanPoint[] {
  if (
    points.length <=
    2
  ) {
    return points.map(
      clonePoint
    );
  }

  let maximumDistance =
    0;

  let splitIndex =
    0;

  const first =
    points[0];

  const last =
    points[
      points.length -
        1
    ];

  for (
    let index = 1;
    index <
      points.length -
        1;
    index += 1
  ) {
    const currentDistance =
      perpendicularDistance(
        points[index],
        first,
        last
      );

    if (
      currentDistance >
      maximumDistance
    ) {
      maximumDistance =
        currentDistance;

      splitIndex =
        index;
    }
  }

  if (
    maximumDistance >
    tolerance
  ) {
    const left =
      simplifyOpenLine(
        points.slice(
          0,
          splitIndex +
            1
        ),
        tolerance
      );

    const right =
      simplifyOpenLine(
        points.slice(
          splitIndex
        ),
        tolerance
      );

    return [
      ...left.slice(
        0,
        -1
      ),
      ...right,
    ];
  }

  return [
    clonePoint(
      first
    ),
    clonePoint(
      last
    ),
  ];
}

/**
 * تبسيط محيط مغلق.
 */
export function simplifyContour(
  inputPoints:
    readonly ScanPoint[],
  tolerance = 1.5
): ScanPoint[] {
  const points =
    inputPoints.map(
      clonePoint
    );

  if (
    points.length <=
    4
  ) {
    return points;
  }

  const safeTolerance =
    Math.max(
      0,
      tolerance
    );

  /**
   * اختيار نقطتين بعيدتين
   * لتقسيم المحيط إلى خطين.
   */
  let firstIndex =
    0;

  for (
    let index = 1;
    index <
      points.length;
    index += 1
  ) {
    if (
      points[index].x <
        points[
          firstIndex
        ].x
    ) {
      firstIndex =
        index;
    }
  }

  let oppositeIndex =
    firstIndex;

  let maximumDistance =
    -1;

  for (
    let index = 0;
    index <
      points.length;
    index += 1
  ) {
    const currentDistance =
      distanceSquared(
        points[
          firstIndex
        ],
        points[index]
      );

    if (
      currentDistance >
      maximumDistance
    ) {
      maximumDistance =
        currentDistance;

      oppositeIndex =
        index;
    }
  }

  const firstPath:
    ScanPoint[] = [];

  let currentIndex =
    firstIndex;

  while (
    currentIndex !==
    oppositeIndex
  ) {
    firstPath.push(
      points[
        currentIndex
      ]
    );

    currentIndex =
      (
        currentIndex +
        1
      ) %
      points.length;
  }

  firstPath.push(
    points[
      oppositeIndex
    ]
  );

  const secondPath:
    ScanPoint[] = [];

  currentIndex =
    oppositeIndex;

  while (
    currentIndex !==
    firstIndex
  ) {
    secondPath.push(
      points[
        currentIndex
      ]
    );

    currentIndex =
      (
        currentIndex +
        1
      ) %
      points.length;
  }

  secondPath.push(
    points[
      firstIndex
    ]
  );

  const simplifiedFirst =
    simplifyOpenLine(
      firstPath,
      safeTolerance
    );

  const simplifiedSecond =
    simplifyOpenLine(
      secondPath,
      safeTolerance
    );

  return [
    ...simplifiedFirst.slice(
      0,
      -1
    ),
    ...simplifiedSecond.slice(
      0,
      -1
    ),
  ];
}

/**
 * تنعيم Chaikin لدورة واحدة.
 */
function smoothContourOnce(
  points:
    readonly ScanPoint[],
  strength: number
): ScanPoint[] {
  if (
    points.length <
    3
  ) {
    return points.map(
      clonePoint
    );
  }

  const safeStrength =
    clamp(
      strength,
      0,
      0.5
    );

  const output:
    ScanPoint[] = [];

  for (
    let index = 0;
    index <
      points.length;
    index += 1
  ) {
    const current =
      points[index];

    const next =
      points[
        (
          index +
          1
        ) %
        points.length
      ];

    output.push(
      {
        x:
          current.x +
          (
            next.x -
            current.x
          ) *
            safeStrength,

        y:
          current.y +
          (
            next.y -
            current.y
          ) *
            safeStrength,
      },
      {
        x:
          current.x +
          (
            next.x -
            current.x
          ) *
            (
              1 -
              safeStrength
            ),

        y:
          current.y +
          (
            next.y -
            current.y
          ) *
            (
              1 -
              safeStrength
            ),
      }
    );
  }

  return output;
}

/**
 * تنعيم المحيط.
 */
export function smoothContour(
  inputPoints:
    readonly ScanPoint[],
  iterations = 1,
  strength = 0.16
): ScanPoint[] {
  let points =
    inputPoints.map(
      clonePoint
    );

  const safeIterations =
    Math.max(
      0,
      Math.floor(
        iterations
      )
    );

  for (
    let iteration = 0;
    iteration <
      safeIterations;
    iteration += 1
  ) {
    points =
      smoothContourOnce(
        points,
        strength
      );
  }

  return points;
}

/**
 * حساب طول المحيط.
 */
export function calculateContourPerimeter(
  points:
    readonly ScanPoint[]
) {
  if (
    points.length <
    2
  ) {
    return 0;
  }

  let perimeter =
    0;

  for (
    let index = 0;
    index <
      points.length;
    index += 1
  ) {
    perimeter +=
      distance(
        points[index],
        points[
          (
            index +
            1
          ) %
          points.length
        ]
      );
  }

  return perimeter;
}

/**
 * إعادة توزيع نقاط المحيط
 * بالتساوي على طول المسار.
 */
export function resampleContour(
  inputPoints:
    readonly ScanPoint[],
  requestedCount: number
): ScanPoint[] {
  const points =
    removeDuplicateContourPoints(
      inputPoints,
      EPSILON
    );

  const count =
    Math.max(
      3,
      Math.floor(
        requestedCount
      )
    );

  if (
    points.length ===
    0
  ) {
    return [];
  }

  if (
    points.length ===
    1
  ) {
    return Array.from(
      {
        length:
          count,
      },
      () =>
        clonePoint(
          points[0]
        )
    );
  }

  const segmentLengths:
    number[] = [];

  let totalLength =
    0;

  for (
    let index = 0;
    index <
      points.length;
    index += 1
  ) {
    const segmentLength =
      distance(
        points[index],
        points[
          (
            index +
            1
          ) %
          points.length
        ]
      );

    segmentLengths.push(
      segmentLength
    );

    totalLength +=
      segmentLength;
  }

  if (
    totalLength <=
    EPSILON
  ) {
    return Array.from(
      {
        length:
          count,
      },
      () =>
        clonePoint(
          points[0]
        )
    );
  }

  const interval =
    totalLength /
    count;

  const output:
    ScanPoint[] = [];

  let segmentIndex =
    0;

  let segmentStartDistance =
    0;

  for (
    let sampleIndex = 0;
    sampleIndex <
      count;
    sampleIndex += 1
  ) {
    const targetDistance =
      sampleIndex *
      interval;

    while (
      segmentIndex <
        segmentLengths.length -
          1 &&
      segmentStartDistance +
        segmentLengths[
          segmentIndex
        ] <
        targetDistance
    ) {
      segmentStartDistance +=
        segmentLengths[
          segmentIndex
        ];

      segmentIndex +=
        1;
    }

    const segmentLength =
      segmentLengths[
        segmentIndex
      ];

    const progress =
      segmentLength <=
        EPSILON
        ? 0
        : clamp(
            (
              targetDistance -
              segmentStartDistance
            ) /
              segmentLength,
            0,
            1
          );

    const start =
      points[
        segmentIndex
      ];

    const end =
      points[
        (
          segmentIndex +
          1
        ) %
        points.length
      ];

    output.push({
      x:
        start.x +
        (
          end.x -
          start.x
        ) *
          progress,

      y:
        start.y +
        (
          end.y -
          start.y
        ) *
          progress,
    });
  }

  return output;
}

/**
 * المساحة الموقعة للمحيط.
 */
export function calculateSignedContourArea(
  points:
    readonly ScanPoint[]
) {
  if (
    points.length <
    3
  ) {
    return 0;
  }

  let total =
    0;

  for (
    let index = 0;
    index <
      points.length;
    index += 1
  ) {
    const current =
      points[index];

    const next =
      points[
        (
          index +
          1
        ) %
        points.length
      ];

    total +=
      current.x *
        next.y -
      next.x *
        current.y;
  }

  return (
    total /
    2
  );
}

/**
 * في إحداثيات الشاشة Y يتجه لأسفل،
 * ولذلك المساحة الموجبة تعني Clockwise.
 */
export function isContourClockwise(
  points:
    readonly ScanPoint[]
) {
  return (
    calculateSignedContourArea(
      points
    ) >
    0
  );
}

/**
 * حساب Bounds.
 */
export function calculateContourBounds(
  points:
    readonly ScanPoint[]
): ScanBounds {
  if (
    points.length ===
    0
  ) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
  }

  let minimumX =
    Number.POSITIVE_INFINITY;

  let minimumY =
    Number.POSITIVE_INFINITY;

  let maximumX =
    Number.NEGATIVE_INFINITY;

  let maximumY =
    Number.NEGATIVE_INFINITY;

  for (
    const point
    of points
  ) {
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
  }

  return {
    x:
      minimumX,

    y:
      minimumY,

    width:
      Math.max(
        0,
        maximumX -
          minimumX
      ),

    height:
      Math.max(
        0,
        maximumY -
          minimumY
      ),
  };
}

/**
 * Centroid الحقيقي للمضلع.
 */
export function calculateContourCentroid(
  points:
    readonly ScanPoint[]
): ScanPoint {
  if (
    points.length ===
    0
  ) {
    return {
      x: 0,
      y: 0,
    };
  }

  const signedArea =
    calculateSignedContourArea(
      points
    );

  if (
    Math.abs(
      signedArea
    ) <=
    EPSILON
  ) {
    const sum =
      points.reduce(
        (
          result,
          point
        ) => ({
          x:
            result.x +
            point.x,

          y:
            result.y +
            point.y,
        }),
        {
          x: 0,
          y: 0,
        }
      );

    return {
      x:
        sum.x /
        points.length,

      y:
        sum.y /
        points.length,
    };
  }

  let centerX =
    0;

  let centerY =
    0;

  for (
    let index = 0;
    index <
      points.length;
    index += 1
  ) {
    const current =
      points[index];

    const next =
      points[
        (
          index +
          1
        ) %
        points.length
      ];

    const cross =
      current.x *
        next.y -
      next.x *
        current.y;

    centerX +=
      (
        current.x +
        next.x
      ) *
      cross;

    centerY +=
      (
        current.y +
        next.y
      ) *
      cross;
  }

  const divisor =
    6 *
    signedArea;

  return {
    x:
      centerX /
      divisor,

    y:
      centerY /
      divisor,
  };
}

/**
 * هل المحيط يلامس حواف الصورة؟
 */
export function doesContourTouchImageEdge(
  points:
    readonly ScanPoint[],
  width: number,
  height: number,
  margin = 0
) {
  const safeMargin =
    Math.max(
      0,
      margin
    );

  return points.some(
    point =>
      point.x <=
        safeMargin ||
      point.y <=
        safeMargin ||
      point.x >=
        width -
          1 -
          safeMargin ||
      point.y >=
        height -
          1 -
          safeMargin
  );
}

/**
 * تحليل هندسة المحيط.
 */
export function analyzeContourGeometry(
  points:
    readonly ScanPoint[],
  imageWidth: number,
  imageHeight: number,
  edgeMargin = 0
): ContourGeometry {
  const bounds =
    calculateContourBounds(
      points
    );

  const signedArea =
    calculateSignedContourArea(
      points
    );

  const area =
    Math.abs(
      signedArea
    );

  const perimeter =
    calculateContourPerimeter(
      points
    );

  const boundsArea =
    bounds.width *
    bounds.height;

  const roundness =
    perimeter >
      EPSILON
      ? clamp(
          (
            4 *
            Math.PI *
            area
          ) /
            (
              perimeter *
              perimeter
            ),
          0,
          1
        )
      : 0;

  return {
    bounds,

    center: {
      x:
        bounds.x +
        bounds.width /
          2,

      y:
        bounds.y +
        bounds.height /
          2,
    },

    centroid:
      calculateContourCentroid(
        points
      ),

    area,

    signedArea,

    perimeter,

    aspectRatio:
      bounds.height >
        EPSILON
        ? bounds.width /
          bounds.height
        : 0,

    fillRatio:
      boundsArea >
        EPSILON
        ? clamp(
            area /
              boundsArea,
            0,
            1
          )
        : 0,

    roundness,

    clockwise:
      signedArea >
      0,

    touchesImageEdge:
      doesContourTouchImageEdge(
        points,
        imageWidth,
        imageHeight,
        edgeMargin
      ),
  };
}

/**
 * تغيير اتجاه المحيط.
 */
export function normalizeContourDirection(
  inputPoints:
    readonly ScanPoint[],
  direction: ContourDirection
): ScanPoint[] {
  const points =
    inputPoints.map(
      clonePoint
    );

  if (
    direction ===
    'preserve'
  ) {
    return points;
  }

  const clockwise =
    isContourClockwise(
      points
    );

  const shouldBeClockwise =
    direction ===
    'clockwise';

  return clockwise ===
    shouldBeClockwise
    ? points
    : points.reverse();
}

/**
 * يبدأ المحيط من أقصى نقطة يسارًا.
 */
export function normalizeContourStartPoint(
  inputPoints:
    readonly ScanPoint[]
): ScanPoint[] {
  const points =
    inputPoints.map(
      clonePoint
    );

  if (
    points.length ===
    0
  ) {
    return [];
  }

  let startIndex =
    0;

  for (
    let index = 1;
    index <
      points.length;
    index += 1
  ) {
    const current =
      points[index];

    const selected =
      points[
        startIndex
      ];

    if (
      current.x <
        selected.x ||
      (
        current.x ===
          selected.x &&
        current.y <
          selected.y
      )
    ) {
      startIndex =
        index;
    }
  }

  return [
    ...points.slice(
      startIndex
    ),
    ...points.slice(
      0,
      startIndex
    ),
  ];
}

/**
 * تجهيز المحيط النهائي.
 */
export function cleanupContourPoints(
  inputPoints:
    readonly ScanPoint[],
  config: ContourCleanupConfig
): ScanPoint[] {
  let points =
    inputPoints.map(
      clonePoint
    );

  if (
    config.removeDuplicatePoints
  ) {
    points =
      removeDuplicateContourPoints(
        points,
        config
          .minimumPointDistance
      );
  }

  if (
    config.simplify &&
    points.length >
      config.minimumPointCount
  ) {
    points =
      simplifyContour(
        points,
        config
          .simplifyTolerance
      );
  }

  if (
    config.smooth &&
    config
      .smoothingIterations >
      0
  ) {
    points =
      smoothContour(
        points,
        config
          .smoothingIterations,
        config
          .smoothingStrength
      );
  }

  let requestedPointCount =
    config.resamplePointCount;

  if (
    requestedPointCount ===
    null &&
    points.length >
      config.maximumPointCount
  ) {
    requestedPointCount =
      config.maximumPointCount;
  }

  if (
    requestedPointCount !==
    null
  ) {
    requestedPointCount =
      clamp(
        Math.floor(
          requestedPointCount
        ),
        config.minimumPointCount,
        config.maximumPointCount
      );

    points =
      resampleContour(
        points,
        requestedPointCount
      );
  } else if (
    points.length <
    config.minimumPointCount
  ) {
    points =
      resampleContour(
        points,
        config
          .minimumPointCount
      );
  }

  points =
    normalizeContourDirection(
      points,
      config.direction
    );

  if (
    config.normalizeStartPoint
  ) {
    points =
      normalizeContourStartPoint(
        points
      );
  }

  return points;
}

/**
 * تقييم جودة محيط واحد.
 */
export function calculateContourConfidence(
  geometry: ContourGeometry,
  pointCount: number,
  imageWidth: number,
  imageHeight: number
) {
  const imageArea =
    imageWidth *
    imageHeight;

  const areaRatio =
    imageArea >
      0
      ? geometry.area /
        imageArea
      : 0;

  const areaScore =
    areaRatio >=
      0.02 &&
    areaRatio <=
      0.9
      ? 1
      : areaRatio <
          0.02
        ? clamp(
            areaRatio /
              0.02,
            0,
            1
          )
        : clamp(
            (
              1 -
              areaRatio
            ) /
              0.1,
            0,
            1
          );

  const pointScore =
    pointCount >=
      24
      ? 1
      : clamp(
          pointCount /
            24,
          0,
          1
        );

  const fillScore =
    geometry.fillRatio >=
      0.12
      ? clamp(
          geometry.fillRatio /
            0.55,
          0,
          1
        )
      : clamp(
          geometry.fillRatio /
            0.12,
          0,
          1
        ) *
        0.55;

  const perimeterScore =
    geometry.perimeter >
      10
      ? 1
      : clamp(
          geometry.perimeter /
            10,
          0,
          1
        );

  const edgeScore =
    geometry
      .touchesImageEdge
      ? 0.38
      : 1;

  const validBoundsScore =
    geometry.bounds.width >
      1 &&
    geometry.bounds.height >
      1
      ? 1
      : 0;

  return normalizeConfidence(
    areaScore *
      0.26 +
    pointScore *
      0.17 +
    fillScore *
      0.17 +
    perimeterScore *
      0.12 +
    edgeScore *
      0.18 +
    validBoundsScore *
      0.1
  );
}

function createContourId(
  index: number,
  geometry: ContourGeometry
) {
  const area =
    Math.round(
      geometry.area
    );

  const centerX =
    Math.round(
      geometry.centroid.x
    );

  const centerY =
    Math.round(
      geometry.centroid.y
    );

  return `contour-${index + 1}-${area}-${centerX}-${centerY}`;
}

/**
 * تحويل مجموعة نقاط خام إلى
 * DetectedContour نهائي.
 */
function createDetectedContour(
  rawPoints:
    readonly ScanPoint[],
  index: number,
  method:
    | 'boundary'
    | 'marchingSquares',
  mask: AlphaMask,
  config: ContourDetectorConfig
): DetectedContour | null {
  const points =
    cleanupContourPoints(
      rawPoints,
      config.cleanup
    );

  if (
    points.length <
    config.cleanup
      .minimumPointCount
  ) {
    return null;
  }

  const geometry =
    analyzeContourGeometry(
      points,
      mask.width,
      mask.height,
      config.edgeMargin
    );

  const imageArea =
    mask.width *
    mask.height;

  const areaRatio =
    imageArea >
      0
      ? geometry.area /
        imageArea
      : 0;

  if (
    areaRatio <
    config.minimumAreaRatio
  ) {
    return null;
  }

  if (
    config
      .rejectEdgeTouchingContour &&
    geometry
      .touchesImageEdge
  ) {
    return null;
  }

  const confidence =
    calculateContourConfidence(
      geometry,
      points.length,
      mask.width,
      mask.height
    );

  return {
    id:
      createContourId(
        index,
        geometry
      ),

    points,

    geometry,

    confidence,

    pointCount:
      points.length,

    sourceMethod:
      method,
  };
}

/**
 * تحديد طريقة الكشف المناسبة.
 */
function resolveDetectionMethod(
  config: ContourDetectorConfig,
  statistics: MaskStatistics
):
  | 'boundary'
  | 'marchingSquares' {
  if (
    config.method ===
    'boundary'
  ) {
    return 'boundary';
  }

  if (
    config.method ===
    'marchingSquares'
  ) {
    return 'marchingSquares';
  }

  /**
   * Marching Squares أفضل افتراضيًا
   * للحواف السلسة، بينما Boundary
   * أخف للمناطق الكبيرة جدًا.
   */
  const foregroundPixels =
    statistics
      .foregroundPixelCount;

  if (
    foregroundPixels >
    2_000_000
  ) {
    return 'boundary';
  }

  return 'marchingSquares';
}

/**
 * استخراج المحيطات الخام.
 */
function detectRawContours(
  mask: AlphaMask,
  method:
    | 'boundary'
    | 'marchingSquares',
  keepLargestContour: boolean,
  signal?: AbortSignal
): ScanPoint[][] {
  if (
    method ===
    'marchingSquares'
  ) {
    return detectMarchingSquareContours(
      mask,
      signal
    );
  }

  const components =
    findForegroundComponents(
      mask,
      signal
    );

  const selectedComponents =
    keepLargestContour
      ? components.slice(
          0,
          1
        )
      : components;

  return selectedComponents
    .map(
      component =>
        traceBoundaryContour(
          createComponentMask(
            mask,
            component
          ),
          signal
        )
    )
    .filter(
      contour =>
        contour.length >=
        3
    );
}

/**
 * الدالة الأساسية:
 *
 * AlphaMask
 * → Binary Mask
 * → Components
 * → Contour
 * → Cleanup
 * → Geometry
 * → Confidence
 */
export async function detectContour(
  input: DetectContourInput
): Promise<ContourDetectionResult> {
  const startedAt =
    Date.now();

  throwIfAborted(
    input.signal
  );

  try {
    validateAlphaMask(
      input.mask
    );
  } catch (
    error: unknown
  ) {
    throw new ContourDetectorError(
      'INVALID_MASK',
      'The supplied alpha mask is invalid.',
      error
    );
  }

  const config =
    resolveConfig(
      input.config
    );

  const binaryMask =
    thresholdAlphaMask(
      input.mask,
      config.threshold
    );

  const maskStatistics =
    analyzeAlphaMask(
      binaryMask,
      config.edgeMargin
    );

  if (
    maskStatistics
      .foregroundPixelCount ===
    0
  ) {
    throw new ContourDetectorError(
      'EMPTY_MASK',
      'The mask does not contain any foreground pixels.'
    );
  }

  throwIfAborted(
    input.signal
  );

  const method =
    resolveDetectionMethod(
      config,
      maskStatistics
    );

  const rawContours =
    detectRawContours(
      binaryMask,
      method,
      config.keepLargestContour,
      input.signal
    );

  if (
    rawContours.length ===
    0
  ) {
    throw new ContourDetectorError(
      'NO_CONTOUR',
      'No valid contour could be extracted from the mask.'
    );
  }

  throwIfAborted(
    input.signal
  );

  const detectedContours =
    rawContours
      .map(
        (
          rawContour,
          index
        ) =>
          createDetectedContour(
            rawContour,
            index,
            method,
            binaryMask,
            config
          )
      )
      .filter(
        (
          contour
        ): contour is DetectedContour =>
          contour !==
          null
      )
      .sort(
        (
          first,
          second
        ) =>
          second.geometry
            .area -
          first.geometry
            .area
      );

  if (
    detectedContours.length ===
    0
  ) {
    const smallestRequiredArea =
      binaryMask.width *
      binaryMask.height *
      config.minimumAreaRatio;

    throw new ContourDetectorError(
      'CONTOUR_TOO_SMALL',
      `All detected contours were smaller than the required area of ${Math.round(
        smallestRequiredArea
      )} pixels.`
    );
  }

  const acceptedContours =
    config.keepLargestContour
      ? detectedContours.slice(
          0,
          1
        )
      : detectedContours;

  const primaryContour =
    acceptedContours[0];

  if (
    config
      .rejectEdgeTouchingContour &&
    primaryContour.geometry
      .touchesImageEdge
  ) {
    throw new ContourDetectorError(
      'CONTOUR_TOUCHES_EDGE',
      'The detected object touches the image edge. Retake the photo with more space around the item.'
    );
  }

  const maskQualityScore =
    clamp(
      maskStatistics
        .largestComponentRatio,
      0,
      1
    );

  const combinedConfidence =
    normalizeConfidence(
      primaryContour
        .confidence *
        0.76 +
      maskQualityScore *
        0.24
    );

  if (
    combinedConfidence <
    config.minimumConfidence
  ) {
    throw new ContourDetectorError(
      'LOW_CONFIDENCE',
      `Contour confidence is too low (${combinedConfidence.toFixed(
        3
      )}).`
    );
  }

  return {
    contour:
      primaryContour,

    contours:
      acceptedContours,

    maskStatistics,

    confidence:
      combinedConfidence,

    processingMs:
      Date.now() -
      startedAt,

    method,
  };
}

/**
 * نسخة آمنة لا ترمي Error.
 */
export async function tryDetectContour(
  input: DetectContourInput
): Promise<TryDetectContourResult> {
  try {
    return {
      success:
        true,

      result:
        await detectContour(
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
        ContourDetectorError
          ? error
          : new ContourDetectorError(
              'DETECTION_FAILED',
              'An unknown contour-detection error occurred.',
              error
            ),
    };
  }
}

/**
 * تحويل المحيط إلى SVG Path
 * للمعاينة والـDebug.
 */
export function contourToSvgPath(
  points:
    readonly ScanPoint[],
  {
    close = true,
    decimalPlaces = 2,
  }: {
    close?: boolean;

    decimalPlaces?: number;
  } = {}
) {
  if (
    points.length ===
    0
  ) {
    return '';
  }

  const safeDecimalPlaces =
    Math.max(
      0,
      Math.floor(
        decimalPlaces
      )
    );

  function format(
    value: number
  ) {
    const rounded =
      Number(
        value.toFixed(
          safeDecimalPlaces
        )
      );

    return String(
      Object.is(
        rounded,
        -0
      )
        ? 0
        : rounded
    );
  }

  const commands: string[] = [
    `M ${format(
      points[0].x
    )} ${format(
      points[0].y
    )}`,
  ];

  for (
    let index = 1;
    index <
      points.length;
    index += 1
  ) {
    commands.push(
      `L ${format(
        points[index].x
      )} ${format(
        points[index].y
      )}`
    );
  }

  if (
    close
  ) {
    commands.push(
      'Z'
    );
  }

  return commands.join(
    ' '
  );
}

/**
 * تحويل نقاط المحيط إلى إحداثيات
 * من 0 إلى 1 داخل Bounds الخاصة به.
 */
export function normalizeContourToUnitBounds(
  points:
    readonly ScanPoint[]
): ScanPoint[] {
  const bounds =
    calculateContourBounds(
      points
    );

  if (
    bounds.width <=
      EPSILON ||
    bounds.height <=
      EPSILON
  ) {
    return points.map(
      () => ({
        x: 0.5,
        y: 0.5,
      })
    );
  }

  return points.map(
    point => ({
      x:
        (
          point.x -
          bounds.x
        ) /
        bounds.width,

      y:
        (
          point.y -
          bounds.y
        ) /
        bounds.height,
    })
  );
}

/**
 * ملخص مناسب للـDebug.
 */
export function getContourDebugSummary(
  result: ContourDetectionResult
) {
  return {
    method:
      result.method,

    confidence:
      result.confidence,

    processingMs:
      result.processingMs,

    contourCount:
      result.contours.length,

    primaryContour: {
      id:
        result.contour.id,

      pointCount:
        result.contour
          .pointCount,

      confidence:
        result.contour
          .confidence,

      area:
        result.contour
          .geometry.area,

      perimeter:
        result.contour
          .geometry.perimeter,

      bounds:
        result.contour
          .geometry.bounds,

      centroid:
        result.contour
          .geometry.centroid,

      aspectRatio:
        result.contour
          .geometry
          .aspectRatio,

      fillRatio:
        result.contour
          .geometry.fillRatio,

      roundness:
        result.contour
          .geometry.roundness,

      clockwise:
        result.contour
          .geometry.clockwise,

      touchesImageEdge:
        result.contour
          .geometry
          .touchesImageEdge,
    },

    mask: {
      width:
        result.maskStatistics
          .bounds.width,

      height:
        result.maskStatistics
          .bounds.height,

      foregroundPixelCount:
        result.maskStatistics
          .foregroundPixelCount,

      foregroundRatio:
        result.maskStatistics
          .foregroundRatio,

      componentCount:
        result.maskStatistics
          .componentCount,

      largestComponentRatio:
        result.maskStatistics
          .largestComponentRatio,
    },
  };
}