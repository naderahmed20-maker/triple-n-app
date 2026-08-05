//
// NativeScanJob.swift
//
// Triple N - Native Scan Item Processing Job Contracts
//
// هذا الملف هو نسخة Swift المطابقة للعقد:
//
// scan/core/native/NativeProcessingContracts.ts
//
// مسؤولياته:
//
// 1) استقبال NativeProcessingJobPayload من JavaScript.
// 2) الاحتفاظ ببيانات صغيرة وقابلة للتخزين فقط.
// 3) منع تمرير Tensors أو Masks أو Decoder Outputs.
// 4) دعم Codable للتخزين والاسترجاع.
// 5) تطبيع وفحص بيانات الـJob قبل بدء المعالجة.
// 6) تحويل العقد إلى Dictionary آمنة للإرسال إلى JavaScript.
// 7) توفير Helpers ثابتة لبقية ملفات Native Processing.
//
// هذا الملف لا:
//
// - يشغّل EdgeSAM.
// - يدير Queue.
// - يبدأ Background Task.
// - يحتوي على Progress أو Result state.
//

import Foundation

// MARK: - Contract versions

enum NativeProcessingContractConstants {

  static let contractVersion:
    Int =
      1

  static let stateVersion:
    Int =
      1
}

// MARK: - Shared primitive contracts

typealias NativeProcessingTimestamp =
  Int64

typealias NativeProcessingMetadata =
  [String: NativeProcessingMetadataValue]

// MARK: - Contract limits

private enum NativeScanJobContractLimits {

  static let maximumIdentifierLength =
    512

  static let maximumURICharacterCount =
    32_768

  static let maximumFileNameLength =
    1_024

  static let maximumTextFieldLength =
    4_096

  static let maximumMetadataEntryCount =
    128

  static let maximumMetadataKeyLength =
    256

  static let maximumMetadataStringLength =
    16_384

  static let maximumPriority =
    1_000_000

  static let maximumAttemptCount =
    100

  static let maximumDeclaredDimension =
    16_384

  static let maximumDeclaredFileSizeBytes:
    Int64 =
      1_024 *
      1_024 *
      1_024
}

// MARK: - Metadata scalar

/// القيم الوحيدة المسموح بوجودها داخل metadata.
///
/// يطابق TypeScript:
///
/// string | number | boolean | null
enum NativeProcessingMetadataValue:
  Codable,
  Equatable,
  Hashable,
  Sendable {

  case string(
    String
  )

  case number(
    Double
  )

  case boolean(
    Bool
  )

  case null

  // MARK: Codable

  init(
    from decoder:
      Decoder
  ) throws {
    let container =
      try decoder
        .singleValueContainer()

    if container.decodeNil() {
      self =
        .null

      return
    }

    /*
     * يجب فحص Bool قبل Double لأن NSNumber القادم
     * من JSON قد يمثل Boolean أو Number.
     */
    if let value =
        try? container.decode(
          Bool.self
        ) {
      self =
        .boolean(
          value
        )

      return
    }

    if let value =
        try? container.decode(
          Double.self
        ) {
      guard value.isFinite else {
        throw DecodingError
          .dataCorruptedError(
            in:
              container,
            debugDescription:
              "Native processing metadata numbers must be finite."
          )
      }

      self =
        .number(
          value
        )

      return
    }

    if let value =
        try? container.decode(
          String.self
        ) {
      self =
        .string(
          value
        )

      return
    }

    throw DecodingError
      .dataCorruptedError(
        in:
          container,
        debugDescription:
          "Unsupported native processing metadata value."
      )
  }

  func encode(
    to encoder:
      Encoder
  ) throws {
    var container =
      encoder
        .singleValueContainer()

    switch self {
    case .string(
      let value
    ):
      try container.encode(
        value
      )

    case .number(
      let value
    ):
      guard value.isFinite else {
        throw EncodingError
          .invalidValue(
            value,
            EncodingError.Context(
              codingPath:
                encoder.codingPath,
              debugDescription:
                "Native processing metadata numbers must be finite."
            )
          )
      }

      try container.encode(
        value
      )

    case .boolean(
      let value
    ):
      try container.encode(
        value
      )

    case .null:
      try container
        .encodeNil()
    }
  }

  // MARK: Foundation conversion

  var foundationValue:
    Any {
    switch self {
    case .string(
      let value
    ):
      return value

    case .number(
      let value
    ):
      return value

    case .boolean(
      let value
    ):
      return value

    case .null:
      return NSNull()
    }
  }

  // MARK: Validation

  func validated()
    throws ->
      NativeProcessingMetadataValue {
    switch self {
    case .string(
      let value
    ):
      guard value.count <=
              NativeScanJobContractLimits
                .maximumMetadataStringLength else {
        throw NativeScanJobValidationError
          .metadataStringTooLong
      }

      return self

    case .number(
      let value
    ):
      guard value.isFinite else {
        throw NativeScanJobValidationError
          .invalidMetadataNumber
      }

      return self

    case .boolean,
         .null:
      return self
    }
  }
}

// MARK: - Image source

struct NativeScanImageSource:
  Codable,
  Equatable,
  Hashable,
  Sendable {

  let uri:
    String

  let width:
    Int?

  let height:
    Int?

  let orientation:
    Int?

  let format:
    String

  let fileName:
    String?

  let mimeType:
    String?

  let fileSizeBytes:
    Int64?

  let sourceId:
    String

  let createdAt:
    NativeProcessingTimestamp

  enum CodingKeys:
    String,
    CodingKey {

    case uri
    case width
    case height
    case orientation
    case format
    case fileName
    case mimeType
    case fileSizeBytes
    case sourceId
    case createdAt
  }

  // MARK: Validation

  func validated()
    throws ->
      NativeScanImageSource {
    let normalizedURI =
      try NativeScanContractNormalizer
        .requireNonEmptyText(
          uri,
          field:
            "source.uri",
          maximumLength:
            NativeScanJobContractLimits
              .maximumURICharacterCount
        )

    let normalizedSourceId =
      try NativeScanContractNormalizer
        .requireIdentifier(
          sourceId,
          field:
            "source.sourceId"
        )

    if let width {
      guard width > 0,
            width <=
              NativeScanJobContractLimits
                .maximumDeclaredDimension else {
        throw NativeScanJobValidationError
          .invalidSourceWidth
      }
    }

    if let height {
      guard height > 0,
            height <=
              NativeScanJobContractLimits
                .maximumDeclaredDimension else {
        throw NativeScanJobValidationError
          .invalidSourceHeight
      }
    }

    if let orientation {
      guard orientation >= 1,
            orientation <= 8 else {
        throw NativeScanJobValidationError
          .invalidSourceOrientation
      }
    }

    if let fileSizeBytes {
      guard fileSizeBytes >= 0,
            fileSizeBytes <=
              NativeScanJobContractLimits
                .maximumDeclaredFileSizeBytes else {
        throw NativeScanJobValidationError
          .invalidSourceFileSize
      }
    }

    guard createdAt > 0 else {
      throw NativeScanJobValidationError
        .invalidCreatedAt
    }

    let normalizedFormat =
      try NativeScanContractNormalizer
        .normalizeRequiredText(
          format,
          field:
            "source.format",
          maximumLength:
            128,
          lowercase:
            true
        )

    let normalizedFileName =
      try NativeScanContractNormalizer
        .normalizeOptionalText(
          fileName,
          maximumLength:
            NativeScanJobContractLimits
              .maximumFileNameLength
        )

    let normalizedMimeType =
      try NativeScanContractNormalizer
        .normalizeOptionalText(
          mimeType,
          maximumLength:
            256,
          lowercase:
            true
        )

    return NativeScanImageSource(
      uri:
        normalizedURI,
      width:
        width,
      height:
        height,
      orientation:
        orientation,
      format:
        normalizedFormat,
      fileName:
        normalizedFileName,
      mimeType:
        normalizedMimeType,
      fileSizeBytes:
        fileSizeBytes,
      sourceId:
        normalizedSourceId,
      createdAt:
        createdAt
    )
  }

  // MARK: Dictionary conversion

  func asDictionary()
    -> [String: Any] {
    [
      "uri":
        uri,

      "width":
        width ??
        NSNull(),

      "height":
        height ??
        NSNull(),

      "orientation":
        orientation ??
        NSNull(),

      "format":
        format,

      "fileName":
        fileName ??
        NSNull(),

      "mimeType":
        mimeType ??
        NSNull(),

      "fileSizeBytes":
        fileSizeBytes ??
        NSNull(),

      "sourceId":
        sourceId,

      "createdAt":
        createdAt
    ]
  }
}

// MARK: - Wardrobe context

struct NativeScanWardrobeContext:
  Codable,
  Equatable,
  Hashable,
  Sendable {

  let wardrobeType:
    String?

  let category:
    String?

  let subcategory:
    String?

  let itemName:
    String?

  let color:
    String?

  let style:
    String?

  let season:
    String?

  let occasion:
    String?

  let isFavorite:
    Bool

  enum CodingKeys:
    String,
    CodingKey {

    case wardrobeType
    case category
    case subcategory
    case itemName
    case color
    case style
    case season
    case occasion
    case isFavorite
  }

  // MARK: Validation

  func validated()
    throws ->
      NativeScanWardrobeContext {
    let normalizedWardrobeType =
      try NativeScanContractNormalizer
        .normalizeOptionalText(
          wardrobeType,
          maximumLength:
            32,
          lowercase:
            true
        )

    if let normalizedWardrobeType {
      guard normalizedWardrobeType ==
              "male" ||
            normalizedWardrobeType ==
              "female" else {
        throw NativeScanJobValidationError
          .invalidWardrobeType
      }
    }

    return NativeScanWardrobeContext(
      wardrobeType:
        normalizedWardrobeType,
      category:
        try NativeScanContractNormalizer
          .normalizeOptionalText(
            category
          ),
      subcategory:
        try NativeScanContractNormalizer
          .normalizeOptionalText(
            subcategory
          ),
      itemName:
        try NativeScanContractNormalizer
          .normalizeOptionalText(
            itemName
          ),
      color:
        try NativeScanContractNormalizer
          .normalizeOptionalText(
            color
          ),
      style:
        try NativeScanContractNormalizer
          .normalizeOptionalText(
            style
          ),
      season:
        try NativeScanContractNormalizer
          .normalizeOptionalText(
            season
          ),
      occasion:
        try NativeScanContractNormalizer
          .normalizeOptionalText(
            occasion
          ),
      isFavorite:
        isFavorite
    )
  }

  // MARK: Dictionary conversion

  func asDictionary()
    -> [String: Any] {
    [
      "wardrobeType":
        wardrobeType ??
        NSNull(),

      "category":
        category ??
        NSNull(),

      "subcategory":
        subcategory ??
        NSNull(),

      "itemName":
        itemName ??
        NSNull(),

      "color":
        color ??
        NSNull(),

      "style":
        style ??
        NSNull(),

      "season":
        season ??
        NSNull(),

      "occasion":
        occasion ??
        NSNull(),

      "isFavorite":
        isFavorite
    ]
  }
}

// MARK: - Processing options

struct NativeScanProcessingOptions:
  Codable,
  Equatable,
  Hashable,
  Sendable {

  let outputDirectoryUri:
    String?

  let outputFileName:
    String

  let outputFormat:
    String

  let outputQuality:
    Double

  let maximumAttempts:
    Int

  let currentAttempt:
    Int

  let collectDiagnostics:
    Bool

  let preserveSourceFile:
    Bool

  let replaceExistingOutput:
    Bool

  let allowForegroundFallback:
    Bool

  enum CodingKeys:
    String,
    CodingKey {

    case outputDirectoryUri
    case outputFileName
    case outputFormat
    case outputQuality
    case maximumAttempts
    case currentAttempt
    case collectDiagnostics
    case preserveSourceFile
    case replaceExistingOutput
    case allowForegroundFallback
  }

  // MARK: Validation

  func validated()
    throws ->
      NativeScanProcessingOptions {
    let normalizedOutputDirectoryURI =
      try NativeScanContractNormalizer
        .normalizeOptionalText(
          outputDirectoryUri,
          maximumLength:
            NativeScanJobContractLimits
              .maximumURICharacterCount
        )

    let normalizedOutputFileName =
      try NativeScanContractNormalizer
        .requireNonEmptyText(
          outputFileName,
          field:
            "options.outputFileName",
          maximumLength:
            NativeScanJobContractLimits
              .maximumFileNameLength
        )

    let normalizedOutputFormat =
      try NativeScanContractNormalizer
        .normalizeRequiredText(
          outputFormat,
          field:
            "options.outputFormat",
          maximumLength:
            32,
          lowercase:
            true
        )

    guard normalizedOutputFormat ==
            "png" else {
      throw NativeScanJobValidationError
        .unsupportedOutputFormat
    }

    guard outputQuality.isFinite,
          outputQuality >= 0,
          outputQuality <= 1 else {
      throw NativeScanJobValidationError
        .invalidOutputQuality
    }

    guard maximumAttempts >= 1,
          maximumAttempts <=
            NativeScanJobContractLimits
              .maximumAttemptCount else {
      throw NativeScanJobValidationError
        .invalidMaximumAttempts
    }

    guard currentAttempt >= 1,
          currentAttempt <=
            maximumAttempts else {
      throw NativeScanJobValidationError
        .invalidCurrentAttempt
    }

    return NativeScanProcessingOptions(
      outputDirectoryUri:
        normalizedOutputDirectoryURI,
      outputFileName:
        normalizedOutputFileName,
      outputFormat:
        "png",
      outputQuality:
        outputQuality,
      maximumAttempts:
        maximumAttempts,
      currentAttempt:
        currentAttempt,
      collectDiagnostics:
        collectDiagnostics,
      preserveSourceFile:
        preserveSourceFile,
      replaceExistingOutput:
        replaceExistingOutput,
      allowForegroundFallback:
        allowForegroundFallback
    )
  }

  // MARK: Dictionary conversion

  func asDictionary()
    -> [String: Any] {
    [
      "outputDirectoryUri":
        outputDirectoryUri ??
        NSNull(),

      "outputFileName":
        outputFileName,

      "outputFormat":
        outputFormat,

      "outputQuality":
        outputQuality,

      "maximumAttempts":
        maximumAttempts,

      "currentAttempt":
        currentAttempt,

      "collectDiagnostics":
        collectDiagnostics,

      "preserveSourceFile":
        preserveSourceFile,

      "replaceExistingOutput":
        replaceExistingOutput,

      "allowForegroundFallback":
        allowForegroundFallback
    ]
  }
}

// MARK: - Native scan job

/// النسخة الوحيدة المسموح بإرسالها من JavaScript إلى Native.
///
/// ممنوع إضافة:
///
/// - SegmentationResult
/// - Float32Array
/// - Uint8Array
/// - Encoder embedding
/// - Decoder outputs
/// - Alpha mask
/// - RGBA pixel buffers
struct NativeScanJob:
  Codable,
  Equatable,
  Hashable,
  Sendable,
  Identifiable {

  let contractVersion:
    Int

  let jobId:
    String

  let queueId:
    String

  let batchId:
    String

  let requestId:
    String

  let wardrobeItemId:
    String

  let platform:
    String

  let priority:
    Int

  let source:
    NativeScanImageSource

  let wardrobe:
    NativeScanWardrobeContext

  let options:
    NativeScanProcessingOptions

  let createdAt:
    NativeProcessingTimestamp

  let metadata:
    NativeProcessingMetadata

  var id:
    String {
    jobId
  }

  enum CodingKeys:
    String,
    CodingKey {

    case contractVersion
    case jobId
    case queueId
    case batchId
    case requestId
    case wardrobeItemId
    case platform
    case priority
    case source
    case wardrobe
    case options
    case createdAt
    case metadata
  }

  // MARK: Computed properties

  var normalizedPlatform:
    String {
    platform
      .trimmingCharacters(
        in:
          .whitespacesAndNewlines
      )
      .lowercased()
  }

  var isIOS:
    Bool {
    normalizedPlatform ==
      "ios"
  }

  var isAndroid:
    Bool {
    normalizedPlatform ==
      "android"
  }

  var hasOutputDirectory:
    Bool {
    guard let outputDirectoryUri =
            options
              .outputDirectoryUri else {
      return false
    }

    return !outputDirectoryUri
      .trimmingCharacters(
        in:
          .whitespacesAndNewlines
      )
      .isEmpty
  }

  // MARK: Validation

  func validated()
    throws ->
      NativeScanJob {
    guard contractVersion ==
            NativeProcessingContractConstants
              .contractVersion else {
      throw NativeScanJobValidationError
        .unsupportedContractVersion(
          received:
            contractVersion
        )
    }

    let normalizedJobId =
      try NativeScanContractNormalizer
        .requireIdentifier(
          jobId,
          field:
            "jobId"
        )

    let normalizedQueueId =
      try NativeScanContractNormalizer
        .requireIdentifier(
          queueId,
          field:
            "queueId"
        )

    let normalizedBatchId =
      try NativeScanContractNormalizer
        .requireIdentifier(
          batchId,
          field:
            "batchId"
        )

    let normalizedRequestId =
      try NativeScanContractNormalizer
        .requireIdentifier(
          requestId,
          field:
            "requestId"
        )

    let normalizedWardrobeItemId =
      try NativeScanContractNormalizer
        .requireIdentifier(
          wardrobeItemId,
          field:
            "wardrobeItemId"
        )

    let normalizedPlatform =
      try NativeScanContractNormalizer
        .normalizeRequiredText(
          platform,
          field:
            "platform",
          maximumLength:
            64,
          lowercase:
            true
        )

    /*
     * ProcessingPlatform يأتي من QueueTypes.
     *
     * Swift يقبل iOS أو Android فقط لأن هذا العقد
     * خاص بالتنفيذ Native على المنصتين.
     */
    guard normalizedPlatform ==
            "ios" ||
          normalizedPlatform ==
            "android" else {
      throw NativeScanJobValidationError
        .unsupportedPlatform(
          received:
            normalizedPlatform
        )
    }

    guard priority >= 0,
          priority <=
            NativeScanJobContractLimits
              .maximumPriority else {
      throw NativeScanJobValidationError
        .invalidPriority
    }

    guard createdAt > 0 else {
      throw NativeScanJobValidationError
        .invalidCreatedAt
    }

    let validatedSource =
      try source
        .validated()

    let validatedWardrobe =
      try wardrobe
        .validated()

    let validatedOptions =
      try options
        .validated()

    let validatedMetadata =
      try Self
        .validateMetadata(
          metadata
        )

    return NativeScanJob(
      contractVersion:
        NativeProcessingContractConstants
          .contractVersion,
      jobId:
        normalizedJobId,
      queueId:
        normalizedQueueId,
      batchId:
        normalizedBatchId,
      requestId:
        normalizedRequestId,
      wardrobeItemId:
        normalizedWardrobeItemId,
      platform:
        normalizedPlatform,
      priority:
        priority,
      source:
        validatedSource,
      wardrobe:
        validatedWardrobe,
      options:
        validatedOptions,
      createdAt:
        createdAt,
      metadata:
        validatedMetadata
    )
  }

  // MARK: Dictionary conversion

  func asDictionary()
    -> [String: Any] {
    [
      "contractVersion":
        contractVersion,

      "jobId":
        jobId,

      "queueId":
        queueId,

      "batchId":
        batchId,

      "requestId":
        requestId,

      "wardrobeItemId":
        wardrobeItemId,

      "platform":
        platform,

      "priority":
        priority,

      "source":
        source
          .asDictionary(),

      "wardrobe":
        wardrobe
          .asDictionary(),

      "options":
        options
          .asDictionary(),

      "createdAt":
        createdAt,

      "metadata":
        Self
          .createMetadataDictionary(
            metadata
          )
    ]
  }

  // MARK: JSON decoding

  static func decode(
    from data:
      Data
  ) throws ->
      NativeScanJob {
    guard !data.isEmpty else {
      throw NativeScanJobValidationError
        .emptyPayloadData
    }

    let decoder =
      JSONDecoder()

    let decodedJob:
      NativeScanJob

    do {
      decodedJob =
        try decoder.decode(
          NativeScanJob.self,
          from:
            data
        )
    } catch {
      throw NativeScanJobValidationError
        .payloadDecodingFailed(
          message:
            error.localizedDescription
        )
    }

    return try decodedJob
      .validated()
  }

  static func decode(
    from dictionary:
      [String: Any]
  ) throws ->
      NativeScanJob {
    guard JSONSerialization
            .isValidJSONObject(
              dictionary
            ) else {
      throw NativeScanJobValidationError
        .invalidJSONObject
    }

    let data:
      Data

    do {
      data =
        try JSONSerialization
          .data(
            withJSONObject:
              dictionary,
            options:
              []
          )
    } catch {
      throw NativeScanJobValidationError
        .payloadEncodingFailed(
          message:
            error.localizedDescription
        )
    }

    return try decode(
      from:
        data
    )
  }

  // MARK: JSON encoding

  func encodedData()
    throws ->
      Data {
    let validatedJob =
      try validated()

    let encoder =
      JSONEncoder()

    encoder.outputFormatting =
      [
        .sortedKeys
      ]

    do {
      return try encoder.encode(
        validatedJob
      )
    } catch {
      throw NativeScanJobValidationError
        .payloadEncodingFailed(
          message:
            error.localizedDescription
        )
    }
  }

  func encodedJSONString()
    throws ->
      String {
    let data =
      try encodedData()

    guard let string =
            String(
              data:
                data,
              encoding:
                .utf8
            ) else {
      throw NativeScanJobValidationError
        .failedToCreateJSONString
    }

    return string
  }

  // MARK: Metadata helpers

  private static func validateMetadata(
    _ metadata:
      NativeProcessingMetadata
  ) throws ->
      NativeProcessingMetadata {
    guard metadata.count <=
            NativeScanJobContractLimits
              .maximumMetadataEntryCount else {
      throw NativeScanJobValidationError
        .tooManyMetadataEntries
    }

    var validatedMetadata:
      NativeProcessingMetadata =
        [:]

    validatedMetadata
      .reserveCapacity(
        metadata.count
      )

    for (
      rawKey,
      rawValue
    ) in metadata {
      let normalizedKey =
        rawKey
          .trimmingCharacters(
            in:
              .whitespacesAndNewlines
          )

      guard !normalizedKey.isEmpty else {
        throw NativeScanJobValidationError
          .emptyMetadataKey
      }

      guard normalizedKey.count <=
              NativeScanJobContractLimits
                .maximumMetadataKeyLength else {
        throw NativeScanJobValidationError
          .metadataKeyTooLong
      }

      guard validatedMetadata[
              normalizedKey
            ] == nil else {
        throw NativeScanJobValidationError
          .duplicateNormalizedMetadataKey(
            key:
              normalizedKey
          )
      }

      validatedMetadata[
        normalizedKey
      ] =
        try rawValue
          .validated()
    }

    return validatedMetadata
  }

  private static func createMetadataDictionary(
    _ metadata:
      NativeProcessingMetadata
  ) -> [String: Any] {
    var dictionary:
      [String: Any] =
        [:]

    dictionary
      .reserveCapacity(
        metadata.count
      )

    for (
      key,
      value
    ) in metadata {
      dictionary[
        key
      ] =
        value
          .foundationValue
    }

    return dictionary
  }
}

// MARK: - Contract normalization

private enum NativeScanContractNormalizer {

  static func requireIdentifier(
    _ value:
      String,
    field:
      String
  ) throws ->
      String {
    try requireNonEmptyText(
      value,
      field:
        field,
      maximumLength:
        NativeScanJobContractLimits
          .maximumIdentifierLength
    )
  }

  static func requireNonEmptyText(
    _ value:
      String,
    field:
      String,
    maximumLength:
      Int =
        NativeScanJobContractLimits
          .maximumTextFieldLength
  ) throws ->
      String {
    let normalized =
      value
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalized.isEmpty else {
      throw NativeScanJobValidationError
        .missingRequiredValue(
          field:
            field
        )
    }

    guard normalized.count <=
            maximumLength else {
      throw NativeScanJobValidationError
        .valueTooLong(
          field:
            field,
          maximumLength:
            maximumLength
        )
    }

    return normalized
  }

  static func normalizeRequiredText(
    _ value:
      String,
    field:
      String,
    maximumLength:
      Int =
        NativeScanJobContractLimits
          .maximumTextFieldLength,
    lowercase:
      Bool =
        false
  ) throws ->
      String {
    let normalized =
      try requireNonEmptyText(
        value,
        field:
          field,
        maximumLength:
          maximumLength
      )

    return lowercase
      ? normalized.lowercased()
      : normalized
  }

  static func normalizeOptionalText(
    _ value:
      String?,
    maximumLength:
      Int =
        NativeScanJobContractLimits
          .maximumTextFieldLength,
    lowercase:
      Bool =
        false
  ) throws ->
      String? {
    guard let value else {
      return nil
    }

    let normalized =
      value
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    if normalized.isEmpty {
      return nil
    }

    guard normalized.count <=
            maximumLength else {
      throw NativeScanJobValidationError
        .optionalValueTooLong(
          maximumLength:
            maximumLength
        )
    }

    return lowercase
      ? normalized.lowercased()
      : normalized
  }
}

// MARK: - Job validation errors

enum NativeScanJobValidationError:
  LocalizedError,
  Equatable,
  Sendable {

  case unsupportedContractVersion(
    received:
      Int
  )

  case missingRequiredValue(
    field:
      String
  )

  case valueTooLong(
    field:
      String,
    maximumLength:
      Int
  )

  case optionalValueTooLong(
    maximumLength:
      Int
  )

  case unsupportedPlatform(
    received:
      String
  )

  case invalidPriority

  case invalidSourceWidth

  case invalidSourceHeight

  case invalidSourceOrientation

  case invalidSourceFileSize

  case invalidWardrobeType

  case unsupportedOutputFormat

  case invalidOutputQuality

  case invalidMaximumAttempts

  case invalidCurrentAttempt

  case invalidCreatedAt

  case tooManyMetadataEntries

  case emptyMetadataKey

  case metadataKeyTooLong

  case metadataStringTooLong

  case invalidMetadataNumber

  case duplicateNormalizedMetadataKey(
    key:
      String
  )

  case emptyPayloadData

  case invalidJSONObject

  case payloadDecodingFailed(
    message:
      String
  )

  case payloadEncodingFailed(
    message:
      String
  )

  case failedToCreateJSONString

  var errorDescription:
    String? {
    switch self {
    case .unsupportedContractVersion(
      let received
    ):
      return
        """
        Unsupported native processing contract version: \(received). Expected version \(NativeProcessingContractConstants.contractVersion).
        """

    case .missingRequiredValue(
      let field
    ):
      return
        """
        Native processing job is missing the required value \(field).
        """

    case .valueTooLong(
      let field,
      let maximumLength
    ):
      return
        """
        Native processing value \(field) exceeds the maximum length of \(maximumLength) characters.
        """

    case .optionalValueTooLong(
      let maximumLength
    ):
      return
        """
        A native processing optional text value exceeds the maximum length of \(maximumLength) characters.
        """

    case .unsupportedPlatform(
      let received
    ):
      return
        """
        Native processing platform \(received) is unsupported. Expected ios or android.
        """

    case .invalidPriority:
      return
        """
        Native processing priority is outside the supported range.
        """

    case .invalidSourceWidth:
      return
        """
        Native processing source width must be greater than zero and within the supported image limit.
        """

    case .invalidSourceHeight:
      return
        """
        Native processing source height must be greater than zero and within the supported image limit.
        """

    case .invalidSourceOrientation:
      return
        """
        Native processing source orientation must be between 1 and 8.
        """

    case .invalidSourceFileSize:
      return
        """
        Native processing source file size is outside the supported range.
        """

    case .invalidWardrobeType:
      return
        """
        Native processing wardrobeType must be male, female or null.
        """

    case .unsupportedOutputFormat:
      return
        """
        Native processing currently supports PNG output only.
        """

    case .invalidOutputQuality:
      return
        """
        Native processing output quality must be a finite value between zero and one.
        """

    case .invalidMaximumAttempts:
      return
        """
        Native processing maximumAttempts is outside the supported range.
        """

    case .invalidCurrentAttempt:
      return
        """
        Native processing currentAttempt must be between one and maximumAttempts.
        """

    case .invalidCreatedAt:
      return
        """
        Native processing createdAt must be greater than zero.
        """

    case .tooManyMetadataEntries:
      return
        """
        Native processing metadata contains too many entries.
        """

    case .emptyMetadataKey:
      return
        """
        Native processing metadata contains an empty key.
        """

    case .metadataKeyTooLong:
      return
        """
        Native processing metadata contains a key that is too long.
        """

    case .metadataStringTooLong:
      return
        """
        Native processing metadata contains a string value that is too long.
        """

    case .invalidMetadataNumber:
      return
        """
        Native processing metadata contains a non-finite numeric value.
        """

    case .duplicateNormalizedMetadataKey(
      let key
    ):
      return
        """
        Native processing metadata contains duplicate normalized key \(key).
        """

    case .emptyPayloadData:
      return
        """
        Native processing payload data is empty.
        """

    case .invalidJSONObject:
      return
        """
        Native processing payload is not a valid JSON object.
        """

    case .payloadDecodingFailed(
      let message
    ):
      return
        """
        Native processing payload decoding failed: \(message)
        """

    case .payloadEncodingFailed(
      let message
    ):
      return
        """
        Native processing payload encoding failed: \(message)
        """

    case .failedToCreateJSONString:
      return
        """
        Native processing payload could not be converted to a JSON string.
        """
    }
  }
}

// MARK: - Time helpers

enum NativeProcessingTime {

  static func now()
    -> NativeProcessingTimestamp {
    let milliseconds =
      Date()
        .timeIntervalSince1970 *
      1_000

    guard milliseconds.isFinite,
          milliseconds > 0,
          milliseconds <=
            Double(
              Int64.max
            ) else {
      return 1
    }

    return NativeProcessingTimestamp(
      milliseconds
        .rounded(
          .down
        )
    )
  }

  static func normalize(
    _ value:
      NativeProcessingTimestamp?,
    fallback:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) -> NativeProcessingTimestamp {
    guard let value,
          value > 0 else {
      return max(
        1,
        fallback
      )
    }

    return value
  }

  static func normalizeDuration(
    _ value:
      Int64?
  ) -> Int64 {
    guard let value,
          value >= 0 else {
      return 0
    }

    return value
  }

  static func duration(
    from startedAt:
      NativeProcessingTimestamp?,
    to completedAt:
      NativeProcessingTimestamp =
        NativeProcessingTime.now()
  ) -> Int64 {
    guard let startedAt,
          startedAt > 0,
          completedAt >=
            startedAt else {
      return 0
    }

    return completedAt -
      startedAt
  }
}