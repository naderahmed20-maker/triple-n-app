// scan/core/ShapeGeometry.ts

import {
  SCAN_CANVAS_SIZE,
  clampScanValue,
  type ScanBounds,
  type ScanPoint,
} from './scanTypes';

/**
 * نتيجة أقرب نقطة على خط.
 */
export type NearestPointOnSegmentResult = {
  point:
    ScanPoint;

  progress:
    number;

  distance:
    number;
};

/**
 * نتيجة أقرب نقطة داخل مجموعة نقاط.
 */
export type NearestPointResult = {
  point:
    ScanPoint;

  index:
    number;

  distance:
    number;
};

/**
 * معلومات هندسية كاملة لمحيط واحد.
 */
export type ScanContourGeometry = {
  bounds:
    ScanBounds;

  center:
    ScanPoint;

  centroid:
    ScanPoint;

  width:
    number;

  height:
    number;

  aspectRatio:
    number;

  area:
    number;

  absoluteArea:
    number;

  perimeter:
    number;

  fillRatio:
    number;

  roundness:
    number;

  clockwise:
    boolean;
};

/**
 * بيانات دوران نقطة أو مجموعة نقاط.
 */
export type ScanRotationInput = {
  angle:
    number;

  center?:
    ScanPoint;
};

/**
 * بيانات Scale لنقطة أو مجموعة نقاط.
 */
export type ScanScaleInput = {
  scaleX:
    number;

  scaleY:
    number;

  center?:
    ScanPoint;
};

/**
 * خيارات تنعيم المحيط.
 */
export type SmoothContourOptions = {
  iterations?:
    number;

  strength?:
    number;

  closed?:
    boolean;
};

/**
 * خيارات تبسيط المحيط.
 */
export type SimplifyContourOptions = {
  tolerance?:
    number;

  closed?:
    boolean;

  minimumPoints?:
    number;
};

/**
 * خيارات إعادة توزيع نقاط المحيط.
 */
export type ResampleContourOptions = {
  count:
    number;

  closed?:
    boolean;
};

/**
 * نتيجة مقارنة محيطين.
 */
export type ContourDistanceResult = {
  averageDistance:
    number;

  maximumDistance:
    number;

  minimumDistance:
    number;

  normalizedAverageDistance:
    number;

  similarity:
    number;
};

const EPSILON =
  0.000001;

const DEFAULT_SIMPLIFY_TOLERANCE =
  2;

const DEFAULT_SMOOTH_STRENGTH =
  0.25;

const DEFAULT_SMOOTH_ITERATIONS =
  1;

/**
 * التأكد من أن الرقم صالح.
 */
export function isFiniteScanNumber(
  value:
    number
) {
  return Number.isFinite(
    value
  );
}

/**
 * رقم صالح أو قيمة بديلة.
 */
export function finiteScanNumberOr(
  value:
    number,
  fallback:
    number
) {
  return isFiniteScanNumber(
    value
  )
    ? value
    : fallback;
}

/**
 * قسمة آمنة.
 */
export function safeScanDivide(
  numerator:
    number,
  denominator:
    number,
  fallback =
    0
) {
  if (
    !isFiniteScanNumber(
      numerator
    ) ||
    !isFiniteScanNumber(
      denominator
    ) ||
    Math.abs(
      denominator
    ) <=
      EPSILON
  ) {
    return fallback;
  }

  return (
    numerator /
    denominator
  );
}

/**
 * فحص صلاحية نقطة.
 */
export function isValidScanPoint(
  point:
    ScanPoint
) {
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
 * فحص صلاحية Bounds.
 */
export function isValidScanBounds(
  bounds:
    ScanBounds
) {
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
 * إنشاء نسخة من نقطة.
 */
export function cloneScanPoint(
  point:
    ScanPoint
): ScanPoint {
  return {
    x:
      point.x,

    y:
      point.y,
  };
}

/**
 * تنظيف مجموعة نقاط من القيم غير الصالحة.
 */
export function sanitizeScanPoints(
  points:
    readonly ScanPoint[]
): ScanPoint[] {
  return points
    .filter(
      isValidScanPoint
    )
    .map(
      cloneScanPoint
    );
}

/**
 * جمع نقطتين.
 */
export function addScanPoints(
  first:
    ScanPoint,
  second:
    ScanPoint
): ScanPoint {
  return {
    x:
      first.x +
      second.x,

    y:
      first.y +
      second.y,
  };
}

/**
 * طرح نقطتين.
 */
export function subtractScanPoints(
  first:
    ScanPoint,
  second:
    ScanPoint
): ScanPoint {
  return {
    x:
      first.x -
      second.x,

    y:
      first.y -
      second.y,
  };
}

/**
 * ضرب نقطة في رقم.
 */
export function multiplyScanPoint(
  point:
    ScanPoint,
  amount:
    number
): ScanPoint {
  return {
    x:
      point.x *
      amount,

    y:
      point.y *
      amount,
  };
}

/**
 * قسمة نقطة على رقم.
 */
export function divideScanPoint(
  point:
    ScanPoint,
  amount:
    number
): ScanPoint {
  if (
    Math.abs(
      amount
    ) <=
    EPSILON
  ) {
    return {
      x: 0,
      y: 0,
    };
  }

  return {
    x:
      point.x /
      amount,

    y:
      point.y /
      amount,
  };
}

/**
 * حاصل الضرب الداخلي.
 */
export function dotScanPoints(
  first:
    ScanPoint,
  second:
    ScanPoint
) {
  return (
    first.x *
      second.x +
    first.y *
      second.y
  );
}

/**
 * Cross product ثنائي الأبعاد.
 */
export function crossScanPoints(
  first:
    ScanPoint,
  second:
    ScanPoint
) {
  return (
    first.x *
      second.y -
    first.y *
      second.x
  );
}

/**
 * طول Vector.
 */
export function getScanVectorLength(
  vector:
    ScanPoint
) {
  return Math.sqrt(
    vector.x *
      vector.x +
    vector.y *
      vector.y
  );
}

/**
 * تحويل Vector إلى طول 1.
 */
export function normalizeScanVector(
  vector:
    ScanPoint
): ScanPoint {
  const length =
    getScanVectorLength(
      vector
    );

  if (
    length <=
    EPSILON
  ) {
    return {
      x: 0,
      y: 0,
    };
  }

  return {
    x:
      vector.x /
      length,

    y:
      vector.y /
      length,
  };
}

/**
 * Vector عمودي.
 */
export function getPerpendicularScanVector(
  vector:
    ScanPoint
): ScanPoint {
  return {
    x:
      -vector.y,

    y:
      vector.x,
  };
}

/**
 * المسافة بين نقطتين.
 */
export function getScanPointDistance(
  first:
    ScanPoint,
  second:
    ScanPoint
) {
  const deltaX =
    first.x -
    second.x;

  const deltaY =
    first.y -
    second.y;

  return Math.sqrt(
    deltaX *
      deltaX +
    deltaY *
      deltaY
  );
}

/**
 * مربع المسافة، أسرع عند المقارنات.
 */
export function getScanPointDistanceSquared(
  first:
    ScanPoint,
  second:
    ScanPoint
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

/**
 * Interpolation بين رقمين.
 */
export function lerpScanNumber(
  first:
    number,
  second:
    number,
  progress:
    number
) {
  return (
    first +
    (
      second -
      first
    ) *
      progress
  );
}

/**
 * Interpolation بين نقطتين.
 */
export function lerpScanPoint(
  first:
    ScanPoint,
  second:
    ScanPoint,
  progress:
    number
): ScanPoint {
  return {
    x:
      lerpScanNumber(
        first.x,
        second.x,
        progress
      ),

    y:
      lerpScanNumber(
        first.y,
        second.y,
        progress
      ),
  };
}

/**
 * منتصف نقطتين.
 */
export function getScanMidpoint(
  first:
    ScanPoint,
  second:
    ScanPoint
): ScanPoint {
  return lerpScanPoint(
    first,
    second,
    0.5
  );
}

/**
 * زاوية الخط بين نقطتين بالدرجات.
 */
export function getScanAngleBetweenPoints(
  first:
    ScanPoint,
  second:
    ScanPoint
) {
  return (
    Math.atan2(
      second.y -
        first.y,
      second.x -
        first.x
    ) *
    180 /
    Math.PI
  );
}

/**
 * فرق زاويتين في النطاق -180 إلى 180.
 */
export function getSmallestScanAngleDifference(
  firstAngle:
    number,
  secondAngle:
    number
) {
  let difference =
    (
      secondAngle -
      firstAngle
    ) %
    360;

  if (
    difference >
    180
  ) {
    difference -=
      360;
  }

  if (
    difference <
    -180
  ) {
    difference +=
      360;
  }

  return difference;
}

/**
 * تحويل درجة إلى Radian.
 */
export function scanDegreesToRadians(
  degrees:
    number
) {
  return (
    degrees *
    Math.PI /
    180
  );
}

/**
 * تحويل Radian إلى درجة.
 */
export function scanRadiansToDegrees(
  radians:
    number
) {
  return (
    radians *
    180 /
    Math.PI
  );
}

/**
 * مركز Bounds.
 */
export function getScanBoundsCenter(
  bounds:
    ScanBounds
): ScanPoint {
  return {
    x:
      bounds.x +
      bounds.width /
        2,

    y:
      bounds.y +
      bounds.height /
        2,
  };
}

/**
 * إنشاء Bounds من مجموعة نقاط.
 */
export function getScanPointsBounds(
  inputPoints:
    readonly ScanPoint[],
  fallbackBounds:
    ScanBounds = {
      x: 0,
      y: 0,
      width:
        SCAN_CANVAS_SIZE,
      height:
        SCAN_CANVAS_SIZE,
    }
): ScanBounds {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length ===
    0
  ) {
    return {
      ...fallbackBounds,
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
        EPSILON,
        maximumX -
          minimumX
      ),

    height:
      Math.max(
        EPSILON,
        maximumY -
          minimumY
      ),
  };
}

/**
 * توسيع Bounds بمقدار معين.
 */
export function expandScanBounds(
  bounds:
    ScanBounds,
  padding:
    number
): ScanBounds {
  const safePadding =
    Math.max(
      0,
      finiteScanNumberOr(
        padding,
        0
      )
    );

  return {
    x:
      bounds.x -
      safePadding,

    y:
      bounds.y -
      safePadding,

    width:
      bounds.width +
      safePadding *
        2,

    height:
      bounds.height +
      safePadding *
        2,
  };
}

/**
 * دمج Bounds متعددة.
 */
export function mergeScanBounds(
  boundsList:
    readonly ScanBounds[]
): ScanBounds {
  const validBounds =
    boundsList.filter(
      isValidScanBounds
    );

  if (
    validBounds.length ===
    0
  ) {
    return {
      x: 0,
      y: 0,
      width:
        SCAN_CANVAS_SIZE,
      height:
        SCAN_CANVAS_SIZE,
    };
  }

  const points:
    ScanPoint[] = [];

  for (
    const bounds
    of validBounds
  ) {
    points.push(
      {
        x:
          bounds.x,

        y:
          bounds.y,
      },
      {
        x:
          bounds.x +
          bounds.width,

        y:
          bounds.y +
          bounds.height,
      }
    );
  }

  return getScanPointsBounds(
    points
  );
}

/**
 * هل النقطة داخل Bounds؟
 */
export function isScanPointInsideBounds(
  point:
    ScanPoint,
  bounds:
    ScanBounds,
  padding =
    0
) {
  return (
    point.x >=
      bounds.x -
        padding &&
    point.x <=
      bounds.x +
        bounds.width +
        padding &&
    point.y >=
      bounds.y -
        padding &&
    point.y <=
      bounds.y +
        bounds.height +
        padding
  );
}

/**
 * هل Bounds متقاطعة؟
 */
export function doScanBoundsIntersect(
  first:
    ScanBounds,
  second:
    ScanBounds
) {
  return !(
    first.x +
      first.width <
      second.x ||
    second.x +
      second.width <
      first.x ||
    first.y +
      first.height <
      second.y ||
    second.y +
      second.height <
      first.y
  );
}

/**
 * مساحة التقاطع بين Bounds.
 */
export function getScanBoundsIntersectionArea(
  first:
    ScanBounds,
  second:
    ScanBounds
) {
  const intersectionWidth =
    Math.max(
      0,
      Math.min(
        first.x +
          first.width,
        second.x +
          second.width
      ) -
      Math.max(
        first.x,
        second.x
      )
    );

  const intersectionHeight =
    Math.max(
      0,
      Math.min(
        first.y +
          first.height,
        second.y +
          second.height
      ) -
      Math.max(
        first.y,
        second.y
      )
    );

  return (
    intersectionWidth *
    intersectionHeight
  );
}

/**
 * Intersection over Union.
 */
export function getScanBoundsIoU(
  first:
    ScanBounds,
  second:
    ScanBounds
) {
  const intersection =
    getScanBoundsIntersectionArea(
      first,
      second
    );

  const firstArea =
    Math.max(
      0,
      first.width
    ) *
    Math.max(
      0,
      first.height
    );

  const secondArea =
    Math.max(
      0,
      second.width
    ) *
    Math.max(
      0,
      second.height
    );

  const union =
    firstArea +
    secondArea -
    intersection;

  return clampScanValue(
    safeScanDivide(
      intersection,
      union,
      0
    ),
    0,
    1
  );
}

/**
 * مساحة Polygon باستخدام Shoelace.
 *
 * الإشارة تحدد اتجاه النقاط:
 * موجب أو سالب حسب ترتيب المحيط.
 */
export function getSignedScanPolygonArea(
  inputPoints:
    readonly ScanPoint[]
) {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

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
 * المساحة المطلقة للمحيط.
 */
export function getScanPolygonArea(
  points:
    readonly ScanPoint[]
) {
  return Math.abs(
    getSignedScanPolygonArea(
      points
    )
  );
}

/**
 * هل ترتيب النقاط Clockwise؟
 *
 * في إحداثيات الشاشة، محور Y يتجه لأسفل،
 * لذلك الإشارة تختلف عن الرسم الرياضي.
 */
export function isScanPolygonClockwise(
  points:
    readonly ScanPoint[]
) {
  return (
    getSignedScanPolygonArea(
      points
    ) >
    0
  );
}

/**
 * عكس ترتيب المحيط عند الحاجة.
 */
export function ensureScanPolygonDirection(
  inputPoints:
    readonly ScanPoint[],
  clockwise:
    boolean
): ScanPoint[] {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  const currentlyClockwise =
    isScanPolygonClockwise(
      points
    );

  if (
    currentlyClockwise ===
    clockwise
  ) {
    return points;
  }

  return [
    ...points,
  ].reverse();
}

/**
 * محيط Polygon.
 */
export function getScanPolygonPerimeter(
  inputPoints:
    readonly ScanPoint[],
  closed =
    true
) {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length <
    2
  ) {
    return 0;
  }

  let total =
    0;

  const segmentCount =
    closed
      ? points.length
      : points.length -
        1;

  for (
    let index = 0;
    index <
      segmentCount;
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
      getScanPointDistance(
        current,
        next
      );
  }

  return total;
}

/**
 * Centroid حقيقي للمضلع.
 */
export function getScanPolygonCentroid(
  inputPoints:
    readonly ScanPoint[]
): ScanPoint {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length ===
    0
  ) {
    return {
      x: 0,
      y: 0,
    };
  }

  if (
    points.length <
    3
  ) {
    return {
      x:
        points.reduce(
          (
            total,
            point
          ) =>
            total +
            point.x,
          0
        ) /
        points.length,

      y:
        points.reduce(
          (
            total,
            point
          ) =>
            total +
            point.y,
          0
        ) /
        points.length,
    };
  }

  let crossTotal =
    0;

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

    crossTotal +=
      cross;

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

  if (
    Math.abs(
      crossTotal
    ) <=
    EPSILON
  ) {
    const bounds =
      getScanPointsBounds(
        points
      );

    return getScanBoundsCenter(
      bounds
    );
  }

  const divisor =
    3 *
    crossTotal;

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
 * Roundness:
 *
 * 1 تقريبًا = دائرة.
 * قيمة أقل = شكل طويل أو معقد.
 */
export function getScanPolygonRoundness(
  points:
    readonly ScanPoint[]
) {
  const area =
    getScanPolygonArea(
      points
    );

  const perimeter =
    getScanPolygonPerimeter(
      points,
      true
    );

  if (
    perimeter <=
    EPSILON
  ) {
    return 0;
  }

  return clampScanValue(
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
  );
}

/**
 * استخراج كل القياسات الهندسية العامة.
 */
export function analyzeScanContourGeometry(
  inputPoints:
    readonly ScanPoint[]
): ScanContourGeometry {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  const bounds =
    getScanPointsBounds(
      points
    );

  const area =
    getSignedScanPolygonArea(
      points
    );

  const absoluteArea =
    Math.abs(
      area
    );

  const perimeter =
    getScanPolygonPerimeter(
      points,
      true
    );

  const boundsArea =
    bounds.width *
    bounds.height;

  return {
    bounds,

    center:
      getScanBoundsCenter(
        bounds
      ),

    centroid:
      getScanPolygonCentroid(
        points
      ),

    width:
      bounds.width,

    height:
      bounds.height,

    aspectRatio:
      safeScanDivide(
        bounds.width,
        bounds.height,
        1
      ),

    area,

    absoluteArea,

    perimeter,

    fillRatio:
      clampScanValue(
        safeScanDivide(
          absoluteArea,
          boundsArea,
          0
        ),
        0,
        1
      ),

    roundness:
      getScanPolygonRoundness(
        points
      ),

    clockwise:
      isScanPolygonClockwise(
        points
      ),
  };
}

/**
 * فحص هل نقطة داخل Polygon.
 */
export function isScanPointInsidePolygon(
  point:
    ScanPoint,
  inputPolygon:
    readonly ScanPoint[]
) {
  const polygon =
    sanitizeScanPoints(
      inputPolygon
    );

  if (
    polygon.length <
    3
  ) {
    return false;
  }

  let inside =
    false;

  for (
    let currentIndex = 0,
      previousIndex =
        polygon.length -
        1;
    currentIndex <
      polygon.length;
    previousIndex =
      currentIndex,
      currentIndex +=
        1
  ) {
    const current =
      polygon[
        currentIndex
      ];

    const previous =
      polygon[
        previousIndex
      ];

    const intersects =
      (
        current.y >
        point.y
      ) !==
        (
          previous.y >
          point.y
        ) &&
      point.x <
        (
          (
            previous.x -
            current.x
          ) *
            (
              point.y -
              current.y
            )
        ) /
          (
            previous.y -
              current.y +
            EPSILON
          ) +
        current.x;

    if (
      intersects
    ) {
      inside =
        !inside;
    }
  }

  return inside;
}

/**
 * أقرب نقطة على Segment.
 */
export function getNearestPointOnScanSegment(
  requestedPoint:
    ScanPoint,
  segmentStart:
    ScanPoint,
  segmentEnd:
    ScanPoint
): NearestPointOnSegmentResult {
  const segment =
    subtractScanPoints(
      segmentEnd,
      segmentStart
    );

  const segmentLengthSquared =
    dotScanPoints(
      segment,
      segment
    );

  if (
    segmentLengthSquared <=
    EPSILON
  ) {
    return {
      point:
        cloneScanPoint(
          segmentStart
        ),

      progress:
        0,

      distance:
        getScanPointDistance(
          requestedPoint,
          segmentStart
        ),
    };
  }

  const requestedVector =
    subtractScanPoints(
      requestedPoint,
      segmentStart
    );

  const progress =
    clampScanValue(
      dotScanPoints(
        requestedVector,
        segment
      ) /
        segmentLengthSquared,
      0,
      1
    );

  const point =
    lerpScanPoint(
      segmentStart,
      segmentEnd,
      progress
    );

  return {
    point,

    progress,

    distance:
      getScanPointDistance(
        requestedPoint,
        point
      ),
  };
}

/**
 * أقرب نقطة داخل Array.
 */
export function findNearestScanPoint(
  requestedPoint:
    ScanPoint,
  inputPoints:
    readonly ScanPoint[]
): NearestPointResult | null {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length ===
    0
  ) {
    return null;
  }

  let nearestIndex =
    0;

  let nearestDistanceSquared =
    Number.POSITIVE_INFINITY;

  for (
    let index = 0;
    index <
      points.length;
    index += 1
  ) {
    const distanceSquared =
      getScanPointDistanceSquared(
        requestedPoint,
        points[index]
      );

    if (
      distanceSquared <
      nearestDistanceSquared
    ) {
      nearestDistanceSquared =
        distanceSquared;

      nearestIndex =
        index;
    }
  }

  return {
    point:
      points[
        nearestIndex
      ],

    index:
      nearestIndex,

    distance:
      Math.sqrt(
        nearestDistanceSquared
      ),
  };
}

/**
 * أقرب نقطة حقيقية على محيط Polygon،
 * وليس فقط أقرب Sample.
 */
export function findNearestPointOnScanContour(
  requestedPoint:
    ScanPoint,
  inputPoints:
    readonly ScanPoint[],
  closed =
    true
): NearestPointOnSegmentResult & {
  segmentIndex:
    number;
} | null {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length <
    2
  ) {
    return null;
  }

  const segmentCount =
    closed
      ? points.length
      : points.length -
        1;

  let best:
    (
      NearestPointOnSegmentResult & {
        segmentIndex:
          number;
      }
    ) | null =
    null;

  for (
    let index = 0;
    index <
      segmentCount;
    index += 1
  ) {
    const result =
      getNearestPointOnScanSegment(
        requestedPoint,
        points[index],
        points[
          (
            index +
            1
          ) %
          points.length
        ]
      );

    if (
      !best ||
      result.distance <
        best.distance
    ) {
      best = {
        ...result,

        segmentIndex:
          index,
      };
    }
  }

  return best;
}

/**
 * إزالة النقاط المتكررة المتجاورة.
 */
export function removeDuplicateScanPoints(
  inputPoints:
    readonly ScanPoint[],
  minimumDistance =
    0.5,
  closed =
    false
): ScanPoint[] {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length <=
    1
  ) {
    return points;
  }

  const output:
    ScanPoint[] = [
      points[0],
    ];

  for (
    let index = 1;
    index <
      points.length;
    index += 1
  ) {
    const previous =
      output[
        output.length -
          1
      ];

    const current =
      points[index];

    if (
      getScanPointDistance(
        previous,
        current
      ) >=
      minimumDistance
    ) {
      output.push(
        current
      );
    }
  }

  if (
    closed &&
    output.length >
      2 &&
    getScanPointDistance(
      output[0],
      output[
        output.length -
          1
      ]
    ) <
      minimumDistance
  ) {
    output.pop();
  }

  return output;
}

/**
 * إعادة توزيع نقاط خط أو محيط
 * حسب طول المسار الحقيقي.
 */
export function resampleScanContour(
  inputPoints:
    readonly ScanPoint[],
  options:
    ResampleContourOptions
): ScanPoint[] {
  const targetCount =
    Math.max(
      1,
      Math.floor(
        finiteScanNumberOr(
          options.count,
          1
        )
      )
    );

  const closed =
    options.closed ??
    true;

  const points =
    removeDuplicateScanPoints(
      inputPoints,
      EPSILON,
      closed
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
          targetCount,
      },
      () =>
        cloneScanPoint(
          points[0]
        )
    );
  }

  const extendedPoints =
    closed
      ? [
          ...points,
          points[0],
        ]
      : points;

  const cumulativeLengths:
    number[] = [
      0,
    ];

  let totalLength =
    0;

  for (
    let index = 1;
    index <
      extendedPoints.length;
    index += 1
  ) {
    totalLength +=
      getScanPointDistance(
        extendedPoints[
          index -
            1
        ],
        extendedPoints[
          index
        ]
      );

    cumulativeLengths.push(
      totalLength
    );
  }

  if (
    totalLength <=
    EPSILON
  ) {
    return Array.from(
      {
        length:
          targetCount,
      },
      () =>
        cloneScanPoint(
          points[0]
        )
    );
  }

  const divisor =
    closed
      ? targetCount
      : Math.max(
          1,
          targetCount -
            1
        );

  const output:
    ScanPoint[] = [];

  let segmentIndex =
    1;

  for (
    let sampleIndex = 0;
    sampleIndex <
      targetCount;
    sampleIndex += 1
  ) {
    const requestedLength =
      (
        sampleIndex /
        divisor
      ) *
      totalLength;

    while (
      segmentIndex <
        cumulativeLengths.length -
          1 &&
      cumulativeLengths[
        segmentIndex
      ] <
        requestedLength
    ) {
      segmentIndex +=
        1;
    }

    const previousLength =
      cumulativeLengths[
        segmentIndex -
          1
      ];

    const nextLength =
      cumulativeLengths[
        segmentIndex
      ];

    const segmentLength =
      nextLength -
      previousLength;

    const progress =
      segmentLength >
        EPSILON
        ? (
            requestedLength -
            previousLength
          ) /
          segmentLength
        : 0;

    output.push(
      lerpScanPoint(
        extendedPoints[
          segmentIndex -
            1
        ],
        extendedPoints[
          segmentIndex
        ],
        clampScanValue(
          progress,
          0,
          1
        )
      )
    );
  }

  return output;
}

/**
 * المسافة العمودية من نقطة إلى خط.
 */
function getPerpendicularDistanceToLine(
  point:
    ScanPoint,
  lineStart:
    ScanPoint,
  lineEnd:
    ScanPoint
) {
  return getNearestPointOnScanSegment(
    point,
    lineStart,
    lineEnd
  ).distance;
}

/**
 * Ramer–Douglas–Peucker.
 */
function simplifyScanLineRdp(
  points:
    readonly ScanPoint[],
  tolerance:
    number
): ScanPoint[] {
  if (
    points.length <=
    2
  ) {
    return [
      ...points,
    ];
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
    const distance =
      getPerpendicularDistanceToLine(
        points[index],
        first,
        last
      );

    if (
      distance >
      maximumDistance
    ) {
      maximumDistance =
        distance;

      splitIndex =
        index;
    }
  }

  if (
    maximumDistance >
    tolerance
  ) {
    const left =
      simplifyScanLineRdp(
        points.slice(
          0,
          splitIndex +
            1
        ),
        tolerance
      );

    const right =
      simplifyScanLineRdp(
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
    first,
    last,
  ];
}

/**
 * تبسيط المحيط مع الحفاظ على الشكل.
 */
export function simplifyScanContour(
  inputPoints:
    readonly ScanPoint[],
  options:
    SimplifyContourOptions = {}
): ScanPoint[] {
  const closed =
    options.closed ??
    true;

  const tolerance =
    Math.max(
      0,
      finiteScanNumberOr(
        options.tolerance ??
          DEFAULT_SIMPLIFY_TOLERANCE,
        DEFAULT_SIMPLIFY_TOLERANCE
      )
    );

  const minimumPoints =
    Math.max(
      closed
        ? 3
        : 2,
      Math.floor(
        options.minimumPoints ??
          (
            closed
              ? 8
              : 2
          )
      )
    );

  const points =
    removeDuplicateScanPoints(
      inputPoints,
      EPSILON,
      closed
    );

  if (
    points.length <=
    minimumPoints
  ) {
    return points;
  }

  if (!closed) {
    const simplified =
      simplifyScanLineRdp(
        points,
        tolerance
      );

    return simplified.length >=
      minimumPoints
      ? simplified
      : resampleScanContour(
          points,
          {
            count:
              minimumPoints,

            closed:
              false,
          }
        );
  }

  /**
   * نختار نقطتين بعيدتين لتقسيم
   * المحيط المغلق إلى خطين مفتوحين.
   */
  const firstIndex =
    points.reduce(
      (
        minimumIndex,
        point,
        index
      ) =>
        point.x <
        points[
          minimumIndex
        ].x
          ? index
          : minimumIndex,
      0
    );

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
    const distance =
      getScanPointDistanceSquared(
        points[
          firstIndex
        ],
        points[index]
      );

    if (
      distance >
      maximumDistance
    ) {
      maximumDistance =
        distance;

      oppositeIndex =
        index;
    }
  }

  const firstPath:
    ScanPoint[] = [];

  let index =
    firstIndex;

  while (
    index !==
    oppositeIndex
  ) {
    firstPath.push(
      points[index]
    );

    index =
      (
        index +
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

  index =
    oppositeIndex;

  while (
    index !==
    firstIndex
  ) {
    secondPath.push(
      points[index]
    );

    index =
      (
        index +
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
    simplifyScanLineRdp(
      firstPath,
      tolerance
    );

  const simplifiedSecond =
    simplifyScanLineRdp(
      secondPath,
      tolerance
    );

  const simplified = [
    ...simplifiedFirst.slice(
      0,
      -1
    ),
    ...simplifiedSecond.slice(
      0,
      -1
    ),
  ];

  if (
    simplified.length <
    minimumPoints
  ) {
    return resampleScanContour(
      points,
      {
        count:
          minimumPoints,

        closed:
          true,
      }
    );
  }

  return simplified;
}

/**
 * Chaikin smoothing.
 */
function smoothScanContourOnce(
  inputPoints:
    readonly ScanPoint[],
  strength:
    number,
  closed:
    boolean
): ScanPoint[] {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length <
    2
  ) {
    return points;
  }

  const amount =
    clampScanValue(
      strength,
      0,
      0.5
    );

  const output:
    ScanPoint[] = [];

  if (!closed) {
    output.push(
      cloneScanPoint(
        points[0]
      )
    );
  }

  const segmentCount =
    closed
      ? points.length
      : points.length -
        1;

  for (
    let index = 0;
    index <
      segmentCount;
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
      lerpScanPoint(
        current,
        next,
        amount
      ),
      lerpScanPoint(
        current,
        next,
        1 -
          amount
      )
    );
  }

  if (!closed) {
    output.push(
      cloneScanPoint(
        points[
          points.length -
            1
        ]
      )
    );
  }

  return output;
}

/**
 * تنعيم المحيط بعدد Iterations.
 */
export function smoothScanContour(
  inputPoints:
    readonly ScanPoint[],
  options:
    SmoothContourOptions = {}
): ScanPoint[] {
  const closed =
    options.closed ??
    true;

  const strength =
    clampScanValue(
      finiteScanNumberOr(
        options.strength ??
          DEFAULT_SMOOTH_STRENGTH,
        DEFAULT_SMOOTH_STRENGTH
      ),
      0,
      0.5
    );

  const iterations =
    Math.max(
      0,
      Math.floor(
        finiteScanNumberOr(
          options.iterations ??
            DEFAULT_SMOOTH_ITERATIONS,
          DEFAULT_SMOOTH_ITERATIONS
        )
      )
    );

  let result =
    sanitizeScanPoints(
      inputPoints
    );

  for (
    let iteration = 0;
    iteration <
      iterations;
    iteration += 1
  ) {
    result =
      smoothScanContourOnce(
        result,
        strength,
        closed
      );
  }

  return result;
}

/**
 * تجهيز محيط للاستخدام في المطابقة:
 *
 * تنظيف
 * → إزالة التكرار
 * → تنعيم
 * → تبسيط
 * → إعادة توزيع
 */
export function prepareScanContour(
  inputPoints:
    readonly ScanPoint[],
  {
    outputPointCount =
      128,
    smoothingIterations =
      1,
    smoothingStrength =
      0.18,
    simplifyTolerance =
      1.5,
    clockwise,
  }: {
    outputPointCount?:
      number;

    smoothingIterations?:
      number;

    smoothingStrength?:
      number;

    simplifyTolerance?:
      number;

    clockwise?:
      boolean;
  } = {}
): ScanPoint[] {
  let points =
    removeDuplicateScanPoints(
      inputPoints,
      0.25,
      true
    );

  if (
    points.length <
    3
  ) {
    return points;
  }

  points =
    smoothScanContour(
      points,
      {
        iterations:
          smoothingIterations,

        strength:
          smoothingStrength,

        closed:
          true,
      }
    );

  points =
    simplifyScanContour(
      points,
      {
        tolerance:
          simplifyTolerance,

        closed:
          true,

        minimumPoints:
          12,
      }
    );

  points =
    resampleScanContour(
      points,
      {
        count:
          Math.max(
            12,
            outputPointCount
          ),

        closed:
          true,
      }
    );

  if (
    clockwise !==
    undefined
  ) {
    points =
      ensureScanPolygonDirection(
        points,
        clockwise
      );
  }

  return points;
}

/**
 * Cubic Bézier.
 */
export function evaluateCubicScanBezier(
  start:
    ScanPoint,
  firstControl:
    ScanPoint,
  secondControl:
    ScanPoint,
  end:
    ScanPoint,
  progress:
    number
): ScanPoint {
  const t =
    clampScanValue(
      progress,
      0,
      1
    );

  const inverse =
    1 -
    t;

  const inverseSquared =
    inverse *
    inverse;

  const inverseCubed =
    inverseSquared *
    inverse;

  const tSquared =
    t *
    t;

  const tCubed =
    tSquared *
    t;

  return {
    x:
      inverseCubed *
        start.x +
      3 *
        inverseSquared *
        t *
        firstControl.x +
      3 *
        inverse *
        tSquared *
        secondControl.x +
      tCubed *
        end.x,

    y:
      inverseCubed *
        start.y +
      3 *
        inverseSquared *
        t *
        firstControl.y +
      3 *
        inverse *
        tSquared *
        secondControl.y +
      tCubed *
        end.y,
  };
}

/**
 * Quadratic Bézier.
 */
export function evaluateQuadraticScanBezier(
  start:
    ScanPoint,
  control:
    ScanPoint,
  end:
    ScanPoint,
  progress:
    number
): ScanPoint {
  const t =
    clampScanValue(
      progress,
      0,
      1
    );

  const inverse =
    1 -
    t;

  return {
    x:
      inverse *
        inverse *
        start.x +
      2 *
        inverse *
        t *
        control.x +
      t *
        t *
        end.x,

    y:
      inverse *
        inverse *
        start.y +
      2 *
        inverse *
        t *
        control.y +
      t *
        t *
        end.y,
  };
}

/**
 * اشتقاق Cubic Bézier.
 */
export function evaluateCubicScanBezierDerivative(
  start:
    ScanPoint,
  firstControl:
    ScanPoint,
  secondControl:
    ScanPoint,
  end:
    ScanPoint,
  progress:
    number
): ScanPoint {
  const t =
    clampScanValue(
      progress,
      0,
      1
    );

  const inverse =
    1 -
    t;

  return {
    x:
      3 *
        inverse *
        inverse *
        (
          firstControl.x -
          start.x
        ) +
      6 *
        inverse *
        t *
        (
          secondControl.x -
          firstControl.x
        ) +
      3 *
        t *
        t *
        (
          end.x -
          secondControl.x
        ),

    y:
      3 *
        inverse *
        inverse *
        (
          firstControl.y -
          start.y
        ) +
      6 *
        inverse *
        t *
        (
          secondControl.y -
          firstControl.y
        ) +
      3 *
        t *
        t *
        (
          end.y -
          secondControl.y
        ),
  };
}

/**
 * أخذ Samples من Cubic Bézier.
 */
export function sampleCubicScanBezier(
  start:
    ScanPoint,
  firstControl:
    ScanPoint,
  secondControl:
    ScanPoint,
  end:
    ScanPoint,
  sampleCount =
    20
): ScanPoint[] {
  const count =
    Math.max(
      2,
      Math.floor(
        sampleCount
      )
    );

  return Array.from(
    {
      length:
        count,
    },
    (
      _,
      index
    ) =>
      evaluateCubicScanBezier(
        start,
        firstControl,
        secondControl,
        end,
        index /
          (
            count -
            1
          )
      )
  );
}

/**
 * أخذ Samples من Quadratic Bézier.
 */
export function sampleQuadraticScanBezier(
  start:
    ScanPoint,
  control:
    ScanPoint,
  end:
    ScanPoint,
  sampleCount =
    16
): ScanPoint[] {
  const count =
    Math.max(
      2,
      Math.floor(
        sampleCount
      )
    );

  return Array.from(
    {
      length:
        count,
    },
    (
      _,
      index
    ) =>
      evaluateQuadraticScanBezier(
        start,
        control,
        end,
        index /
          (
            count -
            1
          )
      )
  );
}

/**
 * تحويل نقطة بالدوران حول مركز.
 */
export function rotateScanPoint(
  point:
    ScanPoint,
  input:
    ScanRotationInput
): ScanPoint {
  const center =
    input.center ?? {
      x: 0,
      y: 0,
    };

  const radians =
    scanDegreesToRadians(
      input.angle
    );

  const cosine =
    Math.cos(
      radians
    );

  const sine =
    Math.sin(
      radians
    );

  const relativeX =
    point.x -
    center.x;

  const relativeY =
    point.y -
    center.y;

  return {
    x:
      relativeX *
        cosine -
      relativeY *
        sine +
      center.x,

    y:
      relativeX *
        sine +
      relativeY *
        cosine +
      center.y,
  };
}

/**
 * دوران مجموعة نقاط.
 */
export function rotateScanPoints(
  points:
    readonly ScanPoint[],
  input:
    ScanRotationInput
): ScanPoint[] {
  return sanitizeScanPoints(
    points
  ).map(
    point =>
      rotateScanPoint(
        point,
        input
      )
  );
}

/**
 * Scale لنقطة حول مركز.
 */
export function scaleScanPoint(
  point:
    ScanPoint,
  input:
    ScanScaleInput
): ScanPoint {
  const center =
    input.center ?? {
      x: 0,
      y: 0,
    };

  return {
    x:
      center.x +
      (
        point.x -
        center.x
      ) *
        input.scaleX,

    y:
      center.y +
      (
        point.y -
        center.y
      ) *
        input.scaleY,
  };
}

/**
 * Scale لمجموعة نقاط.
 */
export function scaleScanPoints(
  points:
    readonly ScanPoint[],
  input:
    ScanScaleInput
): ScanPoint[] {
  return sanitizeScanPoints(
    points
  ).map(
    point =>
      scaleScanPoint(
        point,
        input
      )
  );
}

/**
 * تحريك نقطة.
 */
export function translateScanPoint(
  point:
    ScanPoint,
  translateX:
    number,
  translateY:
    number
): ScanPoint {
  return {
    x:
      point.x +
      translateX,

    y:
      point.y +
      translateY,
  };
}

/**
 * تحريك مجموعة نقاط.
 */
export function translateScanPoints(
  points:
    readonly ScanPoint[],
  translateX:
    number,
  translateY:
    number
): ScanPoint[] {
  return sanitizeScanPoints(
    points
  ).map(
    point =>
      translateScanPoint(
        point,
        translateX,
        translateY
      )
  );
}

/**
 * عكس نقطة أفقيًا.
 */
export function mirrorScanPointHorizontally(
  point:
    ScanPoint,
  centerX =
    SCAN_CANVAS_SIZE /
      2
): ScanPoint {
  return {
    x:
      centerX *
        2 -
      point.x,

    y:
      point.y,
  };
}

/**
 * عكس نقطة رأسيًا.
 */
export function mirrorScanPointVertically(
  point:
    ScanPoint,
  centerY =
    SCAN_CANVAS_SIZE /
      2
): ScanPoint {
  return {
    x:
      point.x,

    y:
      centerY *
        2 -
      point.y,
  };
}

/**
 * تحويل نقطة بين Bounds مختلفة.
 */
export function mapScanPointBetweenBounds(
  point:
    ScanPoint,
  sourceBounds:
    ScanBounds,
  targetBounds:
    ScanBounds
): ScanPoint {
  const normalizedX =
    safeScanDivide(
      point.x -
        sourceBounds.x,
      sourceBounds.width,
      0.5
    );

  const normalizedY =
    safeScanDivide(
      point.y -
        sourceBounds.y,
      sourceBounds.height,
      0.5
    );

  return {
    x:
      targetBounds.x +
      normalizedX *
        targetBounds.width,

    y:
      targetBounds.y +
      normalizedY *
        targetBounds.height,
  };
}

/**
 * تحويل مجموعة نقاط بين Bounds.
 */
export function mapScanPointsBetweenBounds(
  points:
    readonly ScanPoint[],
  sourceBounds:
    ScanBounds,
  targetBounds:
    ScanBounds
): ScanPoint[] {
  return sanitizeScanPoints(
    points
  ).map(
    point =>
      mapScanPointBetweenBounds(
        point,
        sourceBounds,
        targetBounds
      )
  );
}

/**
 * Normalize نقاط داخل Bounds إلى 0–1.
 */
export function normalizeScanPointsToUnitBounds(
  points:
    readonly ScanPoint[],
  bounds?:
    ScanBounds
): ScanPoint[] {
  const sourceBounds =
    bounds ??
    getScanPointsBounds(
      points
    );

  return mapScanPointsBetweenBounds(
    points,
    sourceBounds,
    {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }
  );
}

/**
 * إدخال المحيط داخل Canvas مع Padding
 * مع الحفاظ على Aspect Ratio.
 */
export function fitScanPointsInsideBounds(
  inputPoints:
    readonly ScanPoint[],
  targetBounds:
    ScanBounds,
  padding =
    0
): ScanPoint[] {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length ===
    0
  ) {
    return [];
  }

  const sourceBounds =
    getScanPointsBounds(
      points
    );

  const safePadding =
    Math.max(
      0,
      padding
    );

  const availableWidth =
    Math.max(
      EPSILON,
      targetBounds.width -
        safePadding *
          2
    );

  const availableHeight =
    Math.max(
      EPSILON,
      targetBounds.height -
        safePadding *
          2
    );

  const scale =
    Math.min(
      safeScanDivide(
        availableWidth,
        sourceBounds.width,
        1
      ),
      safeScanDivide(
        availableHeight,
        sourceBounds.height,
        1
      )
    );

  const sourceCenter =
    getScanBoundsCenter(
      sourceBounds
    );

  const targetCenter =
    getScanBoundsCenter(
      targetBounds
    );

  return points.map(
    point => ({
      x:
        targetCenter.x +
        (
          point.x -
          sourceCenter.x
        ) *
          scale,

      y:
        targetCenter.y +
        (
          point.y -
          sourceCenter.y
        ) *
          scale,
    })
  );
}

/**
 * حصر نقطة داخل Canvas.
 */
export function clampScanPointToCanvas(
  point:
    ScanPoint,
  canvasSize =
    SCAN_CANVAS_SIZE
): ScanPoint {
  return {
    x:
      clampScanValue(
        point.x,
        0,
        canvasSize
      ),

    y:
      clampScanValue(
        point.y,
        0,
        canvasSize
      ),
  };
}

/**
 * حصر مجموعة نقاط داخل Canvas.
 */
export function clampScanPointsToCanvas(
  points:
    readonly ScanPoint[],
  canvasSize =
    SCAN_CANVAS_SIZE
): ScanPoint[] {
  return sanitizeScanPoints(
    points
  ).map(
    point =>
      clampScanPointToCanvas(
        point,
        canvasSize
      )
  );
}

/**
 * بدء المحيط من نقطة ثابتة.
 *
 * مفيد جدًا قبل مقارنة محيطين،
 * لأن نفس الشكل قد يبدأ من Index مختلف.
 */
export function rotateScanContourStart(
  inputPoints:
    readonly ScanPoint[],
  startIndex:
    number
): ScanPoint[] {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length ===
    0
  ) {
    return [];
  }

  const normalizedIndex =
    (
      Math.floor(
        startIndex
      ) %
        points.length +
      points.length
    ) %
    points.length;

  return [
    ...points.slice(
      normalizedIndex
    ),
    ...points.slice(
      0,
      normalizedIndex
    ),
  ];
}

/**
 * إيجاد أكثر نقطة يسارًا.
 */
export function findLeftmostScanPointIndex(
  points:
    readonly ScanPoint[]
) {
  if (
    points.length ===
    0
  ) {
    return -1;
  }

  let result =
    0;

  for (
    let index = 1;
    index <
      points.length;
    index += 1
  ) {
    if (
      points[index].x <
        points[result].x ||
      (
        points[index].x ===
          points[result].x &&
        points[index].y <
          points[result].y
      )
    ) {
      result =
        index;
    }
  }

  return result;
}

/**
 * توحيد بداية واتجاه محيط للمقارنة.
 */
export function normalizeScanContourOrder(
  inputPoints:
    readonly ScanPoint[],
  clockwise =
    true
): ScanPoint[] {
  let points =
    ensureScanPolygonDirection(
      inputPoints,
      clockwise
    );

  const startIndex =
    findLeftmostScanPointIndex(
      points
    );

  if (
    startIndex <
    0
  ) {
    return [];
  }

  points =
    rotateScanContourStart(
      points,
      startIndex
    );

  return points;
}

/**
 * مقارنة محيطين بعد Normalize وResample.
 */
export function compareScanContours(
  firstInput:
    readonly ScanPoint[],
  secondInput:
    readonly ScanPoint[],
  sampleCount =
    96
): ContourDistanceResult {
  const count =
    Math.max(
      8,
      Math.floor(
        sampleCount
      )
    );

  const first =
    normalizeScanContourOrder(
      resampleScanContour(
        normalizeScanPointsToUnitBounds(
          firstInput
        ),
        {
          count,

          closed:
            true,
        }
      ),
      true
    );

  const second =
    normalizeScanContourOrder(
      resampleScanContour(
        normalizeScanPointsToUnitBounds(
          secondInput
        ),
        {
          count,

          closed:
            true,
        }
      ),
      true
    );

  if (
    first.length !==
      count ||
    second.length !==
      count
  ) {
    return {
      averageDistance:
        1,

      maximumDistance:
        1,

      minimumDistance:
        1,

      normalizedAverageDistance:
        1,

      similarity:
        0,
    };
  }

  const distances =
    first.map(
      (
        point,
        index
      ) =>
        getScanPointDistance(
          point,
          second[index]
        )
    );

  const averageDistance =
    distances.reduce(
      (
        total,
        distance
      ) =>
        total +
        distance,
      0
    ) /
    distances.length;

  const maximumDistance =
    Math.max(
      ...distances
    );

  const minimumDistance =
    Math.min(
      ...distances
    );

  /**
   * أقصى مسافة ممكنة داخل Unit Square
   * تقريبًا sqrt(2).
   */
  const normalizedAverageDistance =
    clampScanValue(
      averageDistance /
        Math.SQRT2,
      0,
      1
    );

  return {
    averageDistance,

    maximumDistance,

    minimumDistance,

    normalizedAverageDistance,

    similarity:
      clampScanValue(
        1 -
          normalizedAverageDistance,
        0,
        1
      ),
  };
}

/**
 * حساب متوسط مجموعة نقاط.
 */
export function getAverageScanPoint(
  inputPoints:
    readonly ScanPoint[]
): ScanPoint {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length ===
    0
  ) {
    return {
      x: 0,
      y: 0,
    };
  }

  return {
    x:
      points.reduce(
        (
          total,
          point
        ) =>
          total +
          point.x,
        0
      ) /
      points.length,

    y:
      points.reduce(
        (
          total,
          point
        ) =>
          total +
          point.y,
        0
      ) /
      points.length,
  };
}

/**
 * حساب Principal Axis تقريبي للمحيط.
 *
 * النتيجة بالدرجات.
 */
export function estimateScanContourAngle(
  inputPoints:
    readonly ScanPoint[]
) {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length <
    2
  ) {
    return 0;
  }

  const center =
    getAverageScanPoint(
      points
    );

  let covarianceXX =
    0;

  let covarianceYY =
    0;

  let covarianceXY =
    0;

  for (
    const point
    of points
  ) {
    const deltaX =
      point.x -
      center.x;

    const deltaY =
      point.y -
      center.y;

    covarianceXX +=
      deltaX *
      deltaX;

    covarianceYY +=
      deltaY *
      deltaY;

    covarianceXY +=
      deltaX *
      deltaY;
  }

  covarianceXX /=
    points.length;

  covarianceYY /=
    points.length;

  covarianceXY /=
    points.length;

  const radians =
    0.5 *
    Math.atan2(
      2 *
        covarianceXY,
      covarianceXX -
        covarianceYY
    );

  return scanRadiansToDegrees(
    radians
  );
}

/**
 * إزالة دوران المحيط المكتشف
 * ليصبح مناسبًا للمطابقة.
 */
export function straightenScanContour(
  inputPoints:
    readonly ScanPoint[]
): {
  points:
    ScanPoint[];

  originalAngle:
    number;
} {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  const angle =
    estimateScanContourAngle(
      points
    );

  const center =
    getScanPolygonCentroid(
      points
    );

  return {
    points:
      rotateScanPoints(
        points,
        {
          angle:
            -angle,

          center,
        }
      ),

    originalAngle:
      angle,
  };
}

/**
 * تحويل Polygon إلى SVG Path بسيط.
 *
 * يستخدم L commands فقط، مناسب
 * للـDebug والاختبارات.
 */
export function scanPointsToSvgPath(
  inputPoints:
    readonly ScanPoint[],
  closed =
    true,
  decimalPlaces =
    2
) {
  const points =
    sanitizeScanPoints(
      inputPoints
    );

  if (
    points.length ===
    0
  ) {
    return '';
  }

  const format = (
    value:
      number
  ) => {
    const rounded =
      Number(
        value.toFixed(
          Math.max(
            0,
            decimalPlaces
          )
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
  };

  const commands = [
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
    closed
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
 * ملخص هندسي للـDebug.
 */
export function getScanGeometryDebugSummary(
  points:
    readonly ScanPoint[]
) {
  const geometry =
    analyzeScanContourGeometry(
      points
    );

  return {
    pointCount:
      points.length,

    bounds:
      geometry.bounds,

    center:
      geometry.center,

    centroid:
      geometry.centroid,

    aspectRatio:
      geometry.aspectRatio,

    area:
      geometry.absoluteArea,

    perimeter:
      geometry.perimeter,

    fillRatio:
      geometry.fillRatio,

    roundness:
      geometry.roundness,

    clockwise:
      geometry.clockwise,

    estimatedAngle:
      estimateScanContourAngle(
        points
      ),
  };
}