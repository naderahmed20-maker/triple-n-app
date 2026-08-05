//
// EdgeSamNativeCandidateSelector.swift
//
// Triple N - Native EdgeSAM Candidate Selector
//
// مسؤوليات هذا الملف:
//
// 1) قراءة Mask Candidates الخارجة من الـDecoder.
// 2) مطابقة كل Candidate مع IoU Score.
// 3) رفض الـCandidates التالفة أو غير الصالحة.
// 4) حساب إحصائيات أولية لكل Mask.
// 5) اختيار أفضل Candidate بشكل حتمي.
// 6) إنشاء EdgeSamCandidateSelectionResult.
//
// هذا الملف لا يشغّل ONNX.
// هذا الملف لا يسترجع الـMask للحجم الأصلي.
// هذا الملف لا ينفذ Morphology أو Feather.
// هذا الملف لا يغيّر دقة أو Thresholds المعالجة.
//

import Foundation

// MARK: - Candidate selector configuration

struct EdgeSamNativeCandidateSelectorConfiguration:
  Equatable,
  Sendable {

  let minimumCandidateCount:
    Int

  let maximumCandidateCount:
    Int

  let minimumFiniteScore:
    Float

  let maximumFiniteScore:
    Float

  let minimumForegroundRatio:
    Float

  let maximumForegroundRatio:
    Float

  let binaryThreshold:
    Float

  let preferHigherIOUScore:
    Bool

  init(
    minimumCandidateCount:
      Int =
        1,
    maximumCandidateCount:
      Int =
        64,
    minimumFiniteScore:
      Float =
        -1,
    maximumFiniteScore:
      Float =
        1,
    minimumForegroundRatio:
      Float =
        0.0001,
    maximumForegroundRatio:
      Float =
        0.9999,
    binaryThreshold:
      Float =
        0,
    preferHigherIOUScore:
      Bool =
        true
  ) {
    self.minimumCandidateCount =
      minimumCandidateCount

    self.maximumCandidateCount =
      maximumCandidateCount

    self.minimumFiniteScore =
      minimumFiniteScore

    self.maximumFiniteScore =
      maximumFiniteScore

    self.minimumForegroundRatio =
      minimumForegroundRatio

    self.maximumForegroundRatio =
      maximumForegroundRatio

    self.binaryThreshold =
      binaryThreshold

    self.preferHigherIOUScore =
      preferHigherIOUScore
  }

  func validated()
    throws ->
      EdgeSamNativeCandidateSelectorConfiguration {
    guard minimumCandidateCount >
            0 else {
      throw EdgeSamNativeCandidateSelectorError
        .invalidMinimumCandidateCount(
          minimumCandidateCount
        )
    }

    guard maximumCandidateCount >=
            minimumCandidateCount else {
      throw EdgeSamNativeCandidateSelectorError
        .invalidMaximumCandidateCount(
          maximumCandidateCount
        )
    }

    guard minimumFiniteScore
            .isFinite,
          maximumFiniteScore
            .isFinite,
          minimumFiniteScore <=
            maximumFiniteScore else {
      throw EdgeSamNativeCandidateSelectorError
        .invalidScoreRange(
          minimum:
            minimumFiniteScore,
          maximum:
            maximumFiniteScore
        )
    }

    guard minimumForegroundRatio
            .isFinite,
          maximumForegroundRatio
            .isFinite,
          minimumForegroundRatio >=
            0,
          maximumForegroundRatio <=
            1,
          minimumForegroundRatio <
            maximumForegroundRatio else {
      throw EdgeSamNativeCandidateSelectorError
        .invalidForegroundRatioRange(
          minimum:
            minimumForegroundRatio,
          maximum:
            maximumForegroundRatio
        )
    }

    guard binaryThreshold
            .isFinite else {
      throw EdgeSamNativeCandidateSelectorError
        .invalidBinaryThreshold(
          binaryThreshold
        )
    }

    return self
  }
}

// MARK: - Candidate validity

enum EdgeSamNativeCandidateValidity:
  String,
  Codable,
  Equatable,
  Sendable {

  case valid

  case nonFiniteScore

  case nonFiniteMask

  case emptyMask

  case fullMask

  case foregroundRatioTooSmall

  case foregroundRatioTooLarge

  case invalidDimensions

  case invalidElementCount
}

// MARK: - Candidate evaluation

struct EdgeSamNativeCandidateEvaluation:
  Sendable {

  let index:
    Int

  let score:
    Float

  let validity:
    EdgeSamNativeCandidateValidity

  let foregroundPixelCount:
    Int

  let backgroundPixelCount:
    Int

  let foregroundRatio:
    Float

  let minimumValue:
    Float

  let maximumValue:
    Float

  let meanValue:
    Float

  let finiteValueCount:
    Int

  let nonFiniteValueCount:
    Int

  let selectionScore:
    Float

  let rejectionReasons:
    [String]

  var accepted:
    Bool {
    validity ==
      .valid
  }

  func asDictionary()
    -> [String: Any] {
    [
      "index":
        index,

      "score":
        score,

      "validity":
        validity.rawValue,

      "foregroundPixelCount":
        foregroundPixelCount,

      "backgroundPixelCount":
        backgroundPixelCount,

      "foregroundRatio":
        foregroundRatio,

      "minimumValue":
        minimumValue,

      "maximumValue":
        maximumValue,

      "meanValue":
        meanValue,

      "finiteValueCount":
        finiteValueCount,

      "nonFiniteValueCount":
        nonFiniteValueCount,

      "selectionScore":
        selectionScore,

      "rejectionReasons":
        rejectionReasons
    ]
  }
}

// MARK: - Selection diagnostics

struct EdgeSamNativeCandidateSelectionDiagnostics:
  Sendable {

  let candidateCount:
    Int

  let validCandidateCount:
    Int

  let rejectedCandidateCount:
    Int

  let selectedCandidateIndex:
    Int

  let selectedCandidateScore:
    Float

  let evaluations:
    [EdgeSamNativeCandidateEvaluation]

  let warnings:
    [String]

  let completedAt:
    NativeProcessingTimestamp

  func asDictionary()
    -> [String: Any] {
    [
      "candidateCount":
        candidateCount,

      "validCandidateCount":
        validCandidateCount,

      "rejectedCandidateCount":
        rejectedCandidateCount,

      "selectedCandidateIndex":
        selectedCandidateIndex,

      "selectedCandidateScore":
        selectedCandidateScore,

      "evaluations":
        evaluations.map {
          $0.asDictionary()
        },

      "warnings":
        warnings,

      "completedAt":
        completedAt
    ]
  }
}

// MARK: - Internal extracted candidate

private struct EdgeSamNativeExtractedCandidate:
  Sendable {

  let index:
    Int

  let score:
    Float

  let values:
    ContiguousArray<Float>

  let width:
    Int

  let height:
    Int

  let evaluation:
    EdgeSamNativeCandidateEvaluation
}

// MARK: - Candidate selector

final class EdgeSamNativeCandidateSelector:
  @unchecked Sendable {

  private let configuration:
    EdgeSamNativeCandidateSelectorConfiguration

  init(
    configuration:
      EdgeSamNativeCandidateSelectorConfiguration =
        EdgeSamNativeCandidateSelectorConfiguration()
  ) throws {
    self.configuration =
      try configuration
        .validated()
  }

  // MARK: - Public selection

  func selectBestCandidate(
    from decoderOutput:
      EdgeSamDecoderRawOutput
  ) throws ->
      EdgeSamCandidateSelectionResult {
    let validatedOutput =
      try decoderOutput
        .validated()

    try validateDecoderOutput(
      validatedOutput
    )

    let candidates =
      try extractCandidates(
        from:
          validatedOutput
      )

   guard !candidates.isEmpty else {
  throw EdgeSamNativeCandidateSelectorError
    .noValidCandidates
}

    let validCandidates =
      candidates
        .filter {
          $0.evaluation.accepted
        }

  guard !validCandidates.isEmpty else {
  throw EdgeSamNativeCandidateSelectorError
    .noValidCandidates
}

  let selectedCandidate =
  try selectBestCandidate(
    from:
      validCandidates
  )

    return try createSelectionResult(
  selected:
    selectedCandidate,
  allCandidates:
    candidates
)
  }
  // MARK: - Decoder output validation

  private func validateDecoderOutput(
    _ output:
      EdgeSamDecoderRawOutput
  ) throws {
    guard output.candidateCount >=
            configuration
              .minimumCandidateCount,
          output.candidateCount <=
            configuration
              .maximumCandidateCount else {
      throw EdgeSamNativeCandidateSelectorError
        .candidateCountOutOfRange(
          received:
            output.candidateCount,
          minimum:
            configuration
              .minimumCandidateCount,
          maximum:
            configuration
              .maximumCandidateCount
        )
    }

    guard output.maskWidth >
            0,
          output.maskHeight >
            0 else {
      throw EdgeSamNativeCandidateSelectorError
        .invalidMaskDimensions(
          width:
            output.maskWidth,
          height:
            output.maskHeight
        )
    }

    let maskPixelCountResult =
      output.maskWidth
        .multipliedReportingOverflow(
          by:
            output.maskHeight
        )

    guard !maskPixelCountResult
            .overflow,
          maskPixelCountResult
            .partialValue >
            0 else {
      throw EdgeSamNativeCandidateSelectorError
        .unsafeMaskPixelCount
    }

    let expectedMaskElementCountResult =
      maskPixelCountResult
        .partialValue
        .multipliedReportingOverflow(
          by:
            output.candidateCount
        )

    guard !expectedMaskElementCountResult
            .overflow else {
      throw EdgeSamNativeCandidateSelectorError
        .unsafeMaskElementCount
    }

    let expectedMaskElementCount =
      expectedMaskElementCountResult
        .partialValue

    guard output.masks
            .values
            .count ==
            expectedMaskElementCount else {
      throw EdgeSamNativeCandidateSelectorError
        .decoderMaskElementCountMismatch(
          expected:
            expectedMaskElementCount,
          received:
            output.masks
              .values
              .count
        )
    }

    guard output.iouPredictions
            .values
            .count >=
            output.candidateCount else {
      throw EdgeSamNativeCandidateSelectorError
        .decoderScoreElementCountMismatch(
          expectedMinimum:
            output.candidateCount,
          received:
            output.iouPredictions
              .values
              .count
        )
    }
  }

  // MARK: - Candidate extraction

  private func extractCandidates(
    from output:
      EdgeSamDecoderRawOutput
  ) throws ->
      [EdgeSamNativeExtractedCandidate] {
    let maskPixelCountResult =
      output.maskWidth
        .multipliedReportingOverflow(
          by:
            output.maskHeight
        )

    guard !maskPixelCountResult
            .overflow,
          maskPixelCountResult
            .partialValue >
            0 else {
      throw EdgeSamNativeCandidateSelectorError
        .unsafeMaskPixelCount
    }

    let maskPixelCount =
      maskPixelCountResult
        .partialValue

    var candidates:
      [EdgeSamNativeExtractedCandidate] =
        []

    candidates.reserveCapacity(
      output.candidateCount
    )

    for candidateIndex in
      0..<output.candidateCount {
      let startIndexResult =
        candidateIndex
          .multipliedReportingOverflow(
            by:
              maskPixelCount
          )

      guard !startIndexResult
              .overflow else {
        throw EdgeSamNativeCandidateSelectorError
          .candidateOffsetOverflow(
            candidateIndex:
              candidateIndex
          )
      }

      let startIndex =
        startIndexResult
          .partialValue

      let endIndexResult =
        startIndex
          .addingReportingOverflow(
            maskPixelCount
          )

      guard !endIndexResult
              .overflow else {
        throw EdgeSamNativeCandidateSelectorError
          .candidateOffsetOverflow(
            candidateIndex:
              candidateIndex
          )
      }

      let endIndex =
        endIndexResult
          .partialValue

      guard startIndex >=
              0,
            endIndex <=
              output.masks
                .values
                .count,
            startIndex <
              endIndex else {
        throw EdgeSamNativeCandidateSelectorError
          .candidateRangeOutOfBounds(
            candidateIndex:
              candidateIndex,
            start:
              startIndex,
            end:
              endIndex,
            available:
              output.masks
                .values
                .count
          )
      }

      let candidateValues =
        ContiguousArray(
          output.masks
            .values[
              startIndex..<endIndex
            ]
        )

      let score =
        output
          .iouPredictions
          .values[
            candidateIndex
          ]

      let evaluation =
        evaluateCandidate(
          index:
            candidateIndex,
          score:
            score,
          values:
            candidateValues,
          width:
            output.maskWidth,
          height:
            output.maskHeight
        )

      candidates.append(
        EdgeSamNativeExtractedCandidate(
          index:
            candidateIndex,
          score:
            score,
          values:
            candidateValues,
          width:
            output.maskWidth,
          height:
            output.maskHeight,
          evaluation:
            evaluation
        )
      )
    }

    return candidates
  }

  // MARK: - Candidate evaluation

  private func evaluateCandidate(
    index:
      Int,
    score:
      Float,
    values:
      ContiguousArray<Float>,
    width:
      Int,
    height:
      Int
  ) -> EdgeSamNativeCandidateEvaluation {
    let pixelCountResult =
      width
        .multipliedReportingOverflow(
          by:
            height
        )

    guard !pixelCountResult
            .overflow,
          pixelCountResult
            .partialValue >
            0 else {
      return createRejectedEvaluation(
        index:
          index,
        score:
          score,
        validity:
          .invalidDimensions,
        rejectionReasons:
          [
            "Candidate dimensions are invalid."
          ]
      )
    }

    let pixelCount =
      pixelCountResult
        .partialValue

    guard values.count ==
            pixelCount else {
      return createRejectedEvaluation(
        index:
          index,
        score:
          score,
        validity:
          .invalidElementCount,
        rejectionReasons:
          [
            "Candidate mask element count does not match its dimensions."
          ]
      )
    }

    guard score.isFinite else {
      return createRejectedEvaluation(
        index:
          index,
        score:
          score,
        validity:
          .nonFiniteScore,
        rejectionReasons:
          [
            "Candidate IoU score is not finite."
          ]
      )
    }

    var foregroundPixelCount =
      0

    var finiteValueCount =
      0

    var nonFiniteValueCount =
      0

    var minimumValue =
      Float.greatestFiniteMagnitude

    var maximumValue =
      -Float.greatestFiniteMagnitude

    var valueSum:
      Double =
        0

    for value in values {
      guard value.isFinite else {
        nonFiniteValueCount +=
          1

        continue
      }

      finiteValueCount +=
        1

      minimumValue =
        min(
          minimumValue,
          value
        )

      maximumValue =
        max(
          maximumValue,
          value
        )

      valueSum +=
        Double(
          value
        )

      if value >
          configuration
            .binaryThreshold {
        foregroundPixelCount +=
          1
      }
    }

    let backgroundPixelCount =
      max(
        0,
        pixelCount -
        foregroundPixelCount
      )

    let foregroundRatio =
      pixelCount >
        0
        ? Float(
            foregroundPixelCount
          ) /
          Float(
            pixelCount
          )
        : 0

    let meanValue =
      finiteValueCount >
        0
        ? Float(
            valueSum /
            Double(
              finiteValueCount
            )
          )
        : 0

    if nonFiniteValueCount >
        0 {
      return EdgeSamNativeCandidateEvaluation(
        index:
          index,
        score:
          score,
        validity:
          .nonFiniteMask,
        foregroundPixelCount:
          foregroundPixelCount,
        backgroundPixelCount:
          backgroundPixelCount,
        foregroundRatio:
          foregroundRatio,
        minimumValue:
          finiteValueCount >
            0
            ? minimumValue
            : 0,
        maximumValue:
          finiteValueCount >
            0
            ? maximumValue
            : 0,
        meanValue:
          meanValue,
        finiteValueCount:
          finiteValueCount,
        nonFiniteValueCount:
          nonFiniteValueCount,
        selectionScore:
          -Float.greatestFiniteMagnitude,
        rejectionReasons:
          [
            "Candidate mask contains non-finite values."
          ]
      )
    }

    if foregroundPixelCount ==
        0 {
      return EdgeSamNativeCandidateEvaluation(
        index:
          index,
        score:
          score,
        validity:
          .emptyMask,
        foregroundPixelCount:
          0,
        backgroundPixelCount:
          backgroundPixelCount,
        foregroundRatio:
          0,
        minimumValue:
          minimumValue,
        maximumValue:
          maximumValue,
        meanValue:
          meanValue,
        finiteValueCount:
          finiteValueCount,
        nonFiniteValueCount:
          0,
        selectionScore:
          -Float.greatestFiniteMagnitude,
        rejectionReasons:
          [
            "Candidate mask contains no foreground pixels."
          ]
      )
    }

    if backgroundPixelCount ==
        0 {
      return EdgeSamNativeCandidateEvaluation(
        index:
          index,
        score:
          score,
        validity:
          .fullMask,
        foregroundPixelCount:
          foregroundPixelCount,
        backgroundPixelCount:
          0,
        foregroundRatio:
          1,
        minimumValue:
          minimumValue,
        maximumValue:
          maximumValue,
        meanValue:
          meanValue,
        finiteValueCount:
          finiteValueCount,
        nonFiniteValueCount:
          0,
        selectionScore:
          -Float.greatestFiniteMagnitude,
        rejectionReasons:
          [
            "Candidate mask covers the entire image."
          ]
      )
    }

    if foregroundRatio <
        configuration
          .minimumForegroundRatio {
      return EdgeSamNativeCandidateEvaluation(
        index:
          index,
        score:
          score,
        validity:
          .foregroundRatioTooSmall,
        foregroundPixelCount:
          foregroundPixelCount,
        backgroundPixelCount:
          backgroundPixelCount,
        foregroundRatio:
          foregroundRatio,
        minimumValue:
          minimumValue,
        maximumValue:
          maximumValue,
        meanValue:
          meanValue,
        finiteValueCount:
          finiteValueCount,
        nonFiniteValueCount:
          0,
        selectionScore:
          -Float.greatestFiniteMagnitude,
        rejectionReasons:
          [
            "Candidate foreground ratio is below the configured minimum."
          ]
      )
    }

    if foregroundRatio >
        configuration
          .maximumForegroundRatio {
      return EdgeSamNativeCandidateEvaluation(
        index:
          index,
        score:
          score,
        validity:
          .foregroundRatioTooLarge,
        foregroundPixelCount:
          foregroundPixelCount,
        backgroundPixelCount:
          backgroundPixelCount,
        foregroundRatio:
          foregroundRatio,
        minimumValue:
          minimumValue,
        maximumValue:
          maximumValue,
        meanValue:
          meanValue,
        finiteValueCount:
          finiteValueCount,
        nonFiniteValueCount:
          0,
        selectionScore:
          -Float.greatestFiniteMagnitude,
        rejectionReasons:
          [
            "Candidate foreground ratio exceeds the configured maximum."
          ]
      )
    }

    let normalizedScore =
      min(
        configuration
          .maximumFiniteScore,
        max(
          configuration
            .minimumFiniteScore,
          score
        )
      )

    /*
     * الاختيار الأساسي يعتمد على IoU Score فقط.
     *
     * لا نضيف عقوبات أو Bonuses تغيّر سلوك
     * اختيار الـMask مقارنة بالموديل.
     */
    let selectionScore =
      configuration
        .preferHigherIOUScore
        ? normalizedScore
        : -normalizedScore

    return EdgeSamNativeCandidateEvaluation(
      index:
        index,
      score:
        score,
      validity:
        .valid,
      foregroundPixelCount:
        foregroundPixelCount,
      backgroundPixelCount:
        backgroundPixelCount,
      foregroundRatio:
        foregroundRatio,
      minimumValue:
        minimumValue,
      maximumValue:
        maximumValue,
      meanValue:
        meanValue,
      finiteValueCount:
        finiteValueCount,
      nonFiniteValueCount:
        0,
      selectionScore:
        selectionScore,
      rejectionReasons:
        []
    )
  }

  private func createRejectedEvaluation(
    index:
      Int,
    score:
      Float,
    validity:
      EdgeSamNativeCandidateValidity,
    rejectionReasons:
      [String]
  ) -> EdgeSamNativeCandidateEvaluation {
    EdgeSamNativeCandidateEvaluation(
      index:
        index,
      score:
        score,
      validity:
        validity,
      foregroundPixelCount:
        0,
      backgroundPixelCount:
        0,
      foregroundRatio:
        0,
      minimumValue:
        0,
      maximumValue:
        0,
      meanValue:
        0,
      finiteValueCount:
        0,
      nonFiniteValueCount:
        0,
      selectionScore:
        -Float.greatestFiniteMagnitude,
      rejectionReasons:
        rejectionReasons
    )
  }
  // MARK: - Deterministic selection

  private func selectBestCandidate(
    from candidates:
      [EdgeSamNativeExtractedCandidate]
  ) throws ->
      EdgeSamNativeExtractedCandidate {
    let validCandidates =
      candidates.filter {
        $0.evaluation.validity ==
          .valid
      }

    guard !validCandidates
            .isEmpty else {
      throw EdgeSamNativeCandidateSelectorError
        .noValidCandidates
    }

    let sorted =
      validCandidates.sorted {
        left,
        right in

        if left.evaluation
            .selectionScore !=
            right.evaluation
              .selectionScore {
          return left
              .evaluation
              .selectionScore >
            right
              .evaluation
              .selectionScore
        }

        if left.score !=
            right.score {
          return left.score >
            right.score
        }

        return left.index <
          right.index
      }

    guard let selected =
            sorted.first else {
      throw EdgeSamNativeCandidateSelectorError
        .noValidCandidates
    }

    return selected
  }

  // MARK: - Float mask creation

  private func createFloatMask(
    from candidate:
      EdgeSamNativeExtractedCandidate
  ) throws ->
      EdgeSamFloatMask {
    let pixelCountResult =
      candidate.width
        .multipliedReportingOverflow(
          by:
            candidate.height
        )

  guard !pixelCountResult
        .overflow,
      pixelCountResult
        .partialValue >
        0 else {
  throw EdgeSamNativeCandidateSelectorError
    .unsafeMaskPixelCount
}

    guard candidate.values.count ==
            pixelCountResult
              .partialValue else {
      throw EdgeSamNativeCandidateSelectorError
        .decoderMaskElementCountMismatch(
          expected:
            pixelCountResult
              .partialValue,
          received:
            candidate.values
              .count
        )
    }

    return EdgeSamFloatMask(
      width:
        candidate.width,
      height:
        candidate.height,
      values:
        candidate.values
    )
  }

  // MARK: - Result creation

  private func createSelectionResult(
    selected:
      EdgeSamNativeExtractedCandidate,
    allCandidates:
      [EdgeSamNativeExtractedCandidate]
  ) throws ->
      EdgeSamCandidateSelectionResult {
    let mask =
      try createFloatMask(
        from:
          selected
      )

    return EdgeSamCandidateSelectionResult(
      selectedMask:
        mask,
      selectedIndex:
        selected.index,
      selectedScore:
        selected.score,
      candidates:
        allCandidates.map {
          $0.evaluation
        }
    )
  }
}

enum EdgeSamNativeCandidateSelectorError:
  LocalizedError,
  Sendable,
  Equatable {

  case candidateCountOutOfRange(
    received: Int,
    minimum: Int,
    maximum: Int
  )

  case invalidMaskDimensions(
    width: Int,
    height: Int
  )

  case unsafeMaskPixelCount

  case unsafeMaskElementCount

  case decoderMaskElementCountMismatch(
    expected: Int,
    received: Int
  )

  case decoderScoreElementCountMismatch(
    expectedMinimum: Int,
    received: Int
  )

  case candidateOffsetOverflow(
    candidateIndex: Int
  )

  case candidateRangeOutOfBounds(
    candidateIndex: Int,
    start: Int,
    end: Int,
    available: Int
  )

  case noValidCandidates

  var errorDescription: String? {
    switch self {

    case let .candidateCountOutOfRange(
      received,
      minimum,
      maximum
    ):
      return
        "Decoder produced \(received) candidates. Expected \(minimum)...\(maximum)."

    case let .invalidMaskDimensions(
      width,
      height
    ):
      return
        "Invalid decoder mask size \(width)x\(height)."

    case .unsafeMaskPixelCount:
      return
        "Unsafe decoder mask pixel count."

    case .unsafeMaskElementCount:
      return
        "Unsafe decoder mask element count."

    case let .decoderMaskElementCountMismatch(
      expected,
      received
    ):
      return
        "Decoder mask element mismatch. Expected \(expected), received \(received)."

    case let .decoderScoreElementCountMismatch(
      expectedMinimum,
      received
    ):
      return
        "Decoder score element mismatch. Expected at least \(expectedMinimum), received \(received)."

    case let .candidateOffsetOverflow(
      candidateIndex
    ):
      return
        "Candidate \(candidateIndex) offset overflow."

    case let .candidateRangeOutOfBounds(
      candidateIndex,
      start,
      end,
      available
    ):
      return
        "Candidate \(candidateIndex) range \(start)..<\(end) exceeds available \(available)."

    case .noValidCandidates:
      return
        "No valid EdgeSAM candidate mask could be selected."
    }
  }
}