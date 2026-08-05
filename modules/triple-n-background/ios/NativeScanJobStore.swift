//
// NativeScanJobStore.swift
//
// Triple N - Native Scan Job Persistent Store
//
// المسؤوليات:
//
// 1) تخزين NativeScanJob على القرص.
// 2) استرجاع Jobs بعد إعادة تشغيل التطبيق.
// 3) تخزين Progress Records والنتائج والتشخيصات.
// 4) تنفيذ كتابة ذرية آمنة ضد انقطاع التطبيق.
// 5) دعم استعادة العمل أثناء قفل الشاشة بعد أول فتح للجهاز.
// 6) عزل الملفات التالفة دون تعطيل بقية Jobs.
// 7) منع عمليات القراءة والكتابة المتزامنة غير الآمنة.
// 8) توفير تنظيف انتقائي وآمن للملفات القديمة.
// 9) توفير Diagnostics دقيقة لحالة التخزين.
//
// هذا الملف لا:
//
// - يشغّل EdgeSAM.
// - يبدأ Background Task.
// - يرسل Events إلى JavaScript.
// - يفسّر NativeScanPersistedRecord أو NativeScanJobResult.
//

import Foundation

// MARK: - Stored file kind

enum NativeScanStoredFileKind:
  String,
  CaseIterable,
  Codable,
  Equatable,
  Hashable,
  Sendable {

  case jobs

  case records

  case results

  case diagnostics
}

// MARK: - Stored file information

struct NativeScanStoredFileInfo:
  Equatable,
  Hashable,
  Sendable {

  let jobId:
    String

  let kind:
    NativeScanStoredFileKind

  let fileURL:
    URL

  let fileSizeBytes:
    Int64

  let createdAt:
    NativeProcessingTimestamp?

  let modifiedAt:
    NativeProcessingTimestamp?

  func asDictionary()
    -> [String: Any] {
    [
      "jobId":
        jobId,

      "kind":
        kind.rawValue,

      "path":
        fileURL.path,

      "fileURL":
        fileURL.absoluteString,

      "fileSizeBytes":
        fileSizeBytes,

      "createdAt":
        createdAt ??
        NSNull(),

      "modifiedAt":
        modifiedAt ??
        NSNull()
    ]
  }
}

// MARK: - Store diagnostics

struct NativeScanJobStoreDiagnostics:
  Equatable,
  Sendable {

  let initialized:
    Bool

  let rootDirectory:
    String

  let savedJobCount:
    Int

  let savedRecordCount:
    Int

  let savedResultCount:
    Int

  let savedDiagnosticsCount:
    Int

  let quarantinedFileCount:
    Int

  let totalFileCount:
    Int

  let totalSizeBytes:
    Int64

  let lastReadAt:
    NativeProcessingTimestamp?

  let lastWriteAt:
    NativeProcessingTimestamp?

  let lastDeleteAt:
    NativeProcessingTimestamp?

  let lastQuarantineAt:
    NativeProcessingTimestamp?

  let lastError:
    String?

  func asDictionary()
    -> [String: Any] {
    [
      "initialized":
        initialized,

      "rootDirectory":
        rootDirectory,

      "savedJobCount":
        savedJobCount,

      "savedRecordCount":
        savedRecordCount,

      "savedResultCount":
        savedResultCount,

      "savedDiagnosticsCount":
        savedDiagnosticsCount,

      "quarantinedFileCount":
        quarantinedFileCount,

      "totalFileCount":
        totalFileCount,

      "totalSizeBytes":
        totalSizeBytes,

      "lastReadAt":
        lastReadAt ??
        NSNull(),

      "lastWriteAt":
        lastWriteAt ??
        NSNull(),

      "lastDeleteAt":
        lastDeleteAt ??
        NSNull(),

      "lastQuarantineAt":
        lastQuarantineAt ??
        NSNull(),

      "lastError":
        lastError ??
        NSNull()
    ]
  }
}

// MARK: - Job store

final class NativeScanJobStore:
  @unchecked Sendable {

  // MARK: Limits

  private static let maximumJobIdLength =
    512

  private static let maximumOpaqueDataBytes:
    Int64 =
      64 *
      1_024 *
      1_024

  private static let maximumStoredFileCount =
    100_000

  // MARK: Directory names

  private static let storeDirectoryName =
    "TripleNNativeProcessing"

  private static let temporaryDirectoryName =
    "Temporary"

  private static let quarantineDirectoryName =
    "Quarantine"

  // MARK: File extensions

  private static let jobFileExtension =
    "job.json"

  private static let recordFileExtension =
    "record.json"

  private static let resultFileExtension =
    "result.json"

  private static let diagnosticsFileExtension =
    "diagnostics.json"

  private static let quarantineMetadataExtension =
    "quarantine.json"

  // MARK: Dependencies

  private let fileManager:
    FileManager

  private let storageQueue:
    DispatchQueue

  // MARK: Directories

  private let rootDirectoryURL:
    URL

  private let jobsDirectoryURL:
    URL

  private let recordsDirectoryURL:
    URL

  private let resultsDirectoryURL:
    URL

  private let diagnosticsDirectoryURL:
    URL

  private let temporaryDirectoryURL:
    URL

  private let quarantineDirectoryURL:
    URL

  // MARK: State

  private var isInitialized =
    false

  private var lastReadAt:
    NativeProcessingTimestamp?

  private var lastWriteAt:
    NativeProcessingTimestamp?

  private var lastDeleteAt:
    NativeProcessingTimestamp?

  private var lastQuarantineAt:
    NativeProcessingTimestamp?

  private var lastError:
    String?

  // MARK: Initialization

  init(
    fileManager:
      FileManager =
        .default,
    baseDirectoryURL:
      URL? =
        nil
  ) throws {
    self.fileManager =
      fileManager

    self.storageQueue =
      DispatchQueue(
        label:
          "com.naderahmed22.triplen.native-processing.store",
        qos:
          .utility
      )

    let resolvedBaseDirectory =
      try Self.resolveBaseDirectory(
        fileManager:
          fileManager,
        override:
          baseDirectoryURL
      )

    let resolvedRootDirectory =
      resolvedBaseDirectory
        .appendingPathComponent(
          Self.storeDirectoryName,
          isDirectory:
            true
        )
        .standardizedFileURL

    self.rootDirectoryURL =
      resolvedRootDirectory

    self.jobsDirectoryURL =
      resolvedRootDirectory
        .appendingPathComponent(
          NativeScanStoredFileKind
            .jobs
            .rawValue,
          isDirectory:
            true
        )

    self.recordsDirectoryURL =
      resolvedRootDirectory
        .appendingPathComponent(
          NativeScanStoredFileKind
            .records
            .rawValue,
          isDirectory:
            true
        )

    self.resultsDirectoryURL =
      resolvedRootDirectory
        .appendingPathComponent(
          NativeScanStoredFileKind
            .results
            .rawValue,
          isDirectory:
            true
        )

    self.diagnosticsDirectoryURL =
      resolvedRootDirectory
        .appendingPathComponent(
          NativeScanStoredFileKind
            .diagnostics
            .rawValue,
          isDirectory:
            true
        )

    self.temporaryDirectoryURL =
      resolvedRootDirectory
        .appendingPathComponent(
          Self.temporaryDirectoryName,
          isDirectory:
            true
        )

    self.quarantineDirectoryURL =
      resolvedRootDirectory
        .appendingPathComponent(
          Self.quarantineDirectoryName,
          isDirectory:
            true
        )

    try initialize()
  }

  // MARK: Public initialization

  func initialize()
    throws {
    try storageQueue.sync {
      if isInitialized {
        return
      }

      do {
        try createRequiredDirectoriesLocked()

        try excludeFromBackupLocked(
          directoryURL:
            rootDirectoryURL
        )

        try removeTemporaryFilesLocked()

        isInitialized =
          true

        lastError =
          nil
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Save job

  func saveJob(
    _ job:
      NativeScanJob
  ) throws {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let validatedJob =
          try job.validated()

        let data =
          try validatedJob
            .encodedData()

        try validateDataSizeLocked(
          data,
          kind:
            .jobs
        )

        let destinationURL =
          fileURLLocked(
            for:
              validatedJob.jobId,
            kind:
              .jobs
          )

        try writeDataAtomicallyLocked(
          data,
          to:
            destinationURL
        )

        lastWriteAt =
          NativeProcessingTime.now()

        lastError =
          nil
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Load job

  func loadJob(
    jobId:
      String
  ) throws ->
      NativeScanJob? {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let normalizedJobId =
          try normalizeJobIdLocked(
            jobId
          )

        let fileURL =
          fileURLLocked(
            for:
              normalizedJobId,
            kind:
              .jobs
          )

        guard fileManager
                .fileExists(
                  atPath:
                    fileURL.path
                ) else {
          lastReadAt =
            NativeProcessingTime.now()

          lastError =
            nil

          return nil
        }

        let data =
          try readDataLocked(
            from:
              fileURL,
            kind:
              .jobs
          )

        let job =
          try NativeScanJob.decode(
            from:
              data
          )

        guard job.jobId ==
                normalizedJobId else {
          throw NativeScanJobStoreError
            .jobIdentifierMismatch(
              expected:
                normalizedJobId,
              received:
                job.jobId
            )
        }

        lastReadAt =
          NativeProcessingTime.now()

        lastError =
          nil

        return job
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Load all jobs

  func loadAllJobs()
    throws ->
      [NativeScanJob] {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let fileURLs =
          try storedFileURLsLocked(
            kind:
              .jobs
          )

        var jobs:
          [NativeScanJob] =
            []

        jobs.reserveCapacity(
          fileURLs.count
        )

        for fileURL in fileURLs {
          do {
            let data =
              try readDataLocked(
                from:
                  fileURL,
                kind:
                  .jobs
              )

            let job =
              try NativeScanJob.decode(
                from:
                  data
              )

            guard let encodedJobId =
                    decodeJobIdLocked(
                      from:
                        fileURL,
                      kind:
                        .jobs
                    ) else {
              throw NativeScanJobStoreError
                .invalidStoredFileName(
                  path:
                    fileURL.path
                )
            }

            guard encodedJobId ==
                    job.jobId else {
              throw NativeScanJobStoreError
                .jobIdentifierMismatch(
                  expected:
                    encodedJobId,
                  received:
                    job.jobId
                )
            }

            jobs.append(
              job
            )
          } catch {
            try? quarantineCorruptedFileLocked(
              fileURL:
                fileURL,
              kind:
                .jobs,
              reason:
                error.localizedDescription
            )
          }
        }

        jobs.sort {
          if $0.priority !=
              $1.priority {
            return $0.priority >
              $1.priority
          }

          if $0.createdAt !=
              $1.createdAt {
            return $0.createdAt <
              $1.createdAt
          }

          return $0.jobId <
            $1.jobId
        }

        lastReadAt =
          NativeProcessingTime.now()

        lastError =
          nil

        return jobs
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Contains job

  func containsJob(
    jobId:
      String
  ) throws ->
      Bool {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let normalizedJobId =
          try normalizeJobIdLocked(
            jobId
          )

        let fileURL =
          fileURLLocked(
            for:
              normalizedJobId,
            kind:
              .jobs
          )

        let exists =
          fileManager
            .fileExists(
              atPath:
                fileURL.path
            )

        lastReadAt =
          NativeProcessingTime.now()

        lastError =
          nil

        return exists
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Remove job

  func removeJob(
    jobId:
      String,
    includeRecord:
      Bool =
        true,
    includeResult:
      Bool =
        false,
    includeDiagnostics:
      Bool =
        false
  ) throws {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let normalizedJobId =
          try normalizeJobIdLocked(
            jobId
          )

        try removeFileIfExistsLocked(
          fileURLLocked(
            for:
              normalizedJobId,
            kind:
              .jobs
          )
        )

        if includeRecord {
          try removeFileIfExistsLocked(
            fileURLLocked(
              for:
                normalizedJobId,
              kind:
                .records
            )
          )
        }

        if includeResult {
          try removeFileIfExistsLocked(
            fileURLLocked(
              for:
                normalizedJobId,
              kind:
                .results
            )
          )
        }

        if includeDiagnostics {
          try removeFileIfExistsLocked(
            fileURLLocked(
              for:
                normalizedJobId,
              kind:
                .diagnostics
            )
          )
        }

        lastDeleteAt =
          NativeProcessingTime.now()

        lastError =
          nil
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Record data

  func saveRecordData(
    _ data:
      Data,
    jobId:
      String
  ) throws {
    try saveOpaqueData(
      data,
      jobId:
        jobId,
      kind:
        .records
    )
  }

  func loadRecordData(
    jobId:
      String
  ) throws ->
      Data? {
    try loadOpaqueData(
      jobId:
        jobId,
      kind:
        .records
    )
  }

  func removeRecordData(
    jobId:
      String
  ) throws {
    try removeOpaqueData(
      jobId:
        jobId,
      kind:
        .records
    )
  }

  func saveRecord(
  _ record: NativeScanPersistedRecord
) throws {
  try saveRecordData(
    try record.encodedData(),
    jobId: record.payload.jobId
  )
}

func loadRecord(
  jobId: String
) throws -> NativeScanPersistedRecord? {
  guard let data =
    try loadRecordData(jobId: jobId)
  else {
    return nil
  }

  return try NativeScanPersistedRecord.decode(
    from: data
  )
}

  // MARK: Result data

  func saveResultData(
    _ data:
      Data,
    jobId:
      String
  ) throws {
    try saveOpaqueData(
      data,
      jobId:
        jobId,
      kind:
        .results
    )
  }

  func loadResultData(
    jobId:
      String
  ) throws ->
      Data? {
    try loadOpaqueData(
      jobId:
        jobId,
      kind:
        .results
    )
  }

  func removeResultData(
    jobId:
      String
  ) throws {
    try removeOpaqueData(
      jobId:
        jobId,
      kind:
        .results
    )
  }

  func saveResult(
  _ result: NativeScanJobResult
) throws {
  try saveResultData(
    try result.encodedData(),
    jobId: result.jobId
  )
}

func loadResult(
  jobId: String
) throws -> NativeScanJobResult? {
  guard let data =
    try loadResultData(jobId: jobId)
  else {
    return nil
  }

  return try NativeScanJobResult.decode(
    from: data
  )
}

  // MARK: Diagnostics data

  func saveDiagnosticsData(
    _ data:
      Data,
    jobId:
      String
  ) throws {
    try saveOpaqueData(
      data,
      jobId:
        jobId,
      kind:
        .diagnostics
    )
  }

  func loadDiagnosticsData(
    jobId:
      String
  ) throws ->
      Data? {
    try loadOpaqueData(
      jobId:
        jobId,
      kind:
        .diagnostics
    )
  }

  func removeDiagnosticsData(
    jobId:
      String
  ) throws {
    try removeOpaqueData(
      jobId:
        jobId,
      kind:
        .diagnostics
    )
  }
  // MARK: Generic Codable storage

  func saveCodable<Value>(
    _ value:
      Value,
    jobId:
      String,
    kind:
      NativeScanStoredFileKind,
    encoder:
      JSONEncoder =
        JSONEncoder()
  ) throws
  where Value:
    Encodable {
    encoder.outputFormatting =
      [
        .sortedKeys
      ]

    let data:
      Data

    do {
      data =
        try encoder.encode(
          value
        )
    } catch {
      throw NativeScanJobStoreError
        .encodingFailed(
          kind:
            kind,
          reason:
            error.localizedDescription
        )
    }

    try saveOpaqueData(
      data,
      jobId:
        jobId,
      kind:
        kind
    )
  }

  func loadCodable<Value>(
    _ type:
      Value.Type,
    jobId:
      String,
    kind:
      NativeScanStoredFileKind,
    decoder:
      JSONDecoder =
        JSONDecoder()
  ) throws ->
      Value?
  where Value:
    Decodable {
    guard let data =
            try loadOpaqueData(
              jobId:
                jobId,
              kind:
                kind
            ) else {
      return nil
    }

    do {
      return try decoder.decode(
        type,
        from:
          data
      )
    } catch {
      throw NativeScanJobStoreError
        .decodingFailed(
          kind:
            kind,
          reason:
            error.localizedDescription
        )
    }
  }

  // MARK: List stored files

  func listStoredFiles(
    kind:
      NativeScanStoredFileKind
  ) throws ->
      [NativeScanStoredFileInfo] {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let fileURLs =
          try storedFileURLsLocked(
            kind:
              kind
          )

        var result:
          [NativeScanStoredFileInfo] =
            []

        result.reserveCapacity(
          fileURLs.count
        )

        for fileURL in fileURLs {
          guard let jobId =
                  decodeJobIdLocked(
                    from:
                      fileURL,
                    kind:
                      kind
                  ) else {
            continue
          }

          let attributes =
            try fileManager
              .attributesOfItem(
                atPath:
                  fileURL.path
              )

          let fileSizeBytes =
            (
              attributes[
                .size
              ] as? NSNumber
            )?
            .int64Value ??
            0

          let creationDate =
            attributes[
              .creationDate
            ] as? Date

          let modificationDate =
            attributes[
              .modificationDate
            ] as? Date

          result.append(
            NativeScanStoredFileInfo(
              jobId:
                jobId,
              kind:
                kind,
              fileURL:
                fileURL,
              fileSizeBytes:
                max(
                  0,
                  fileSizeBytes
                ),
              createdAt:
                creationDate
                  .map(
                    Self.timestamp
                  ),
              modifiedAt:
                modificationDate
                  .map(
                    Self.timestamp
                  )
            )
          )
        }

        result.sort {
          let leftTimestamp =
            $0.modifiedAt ??
            $0.createdAt ??
            0

          let rightTimestamp =
            $1.modifiedAt ??
            $1.createdAt ??
            0

          if leftTimestamp !=
              rightTimestamp {
            return leftTimestamp <
              rightTimestamp
          }

          if $0.kind !=
              $1.kind {
            return $0.kind.rawValue <
              $1.kind.rawValue
          }

          return $0.jobId <
            $1.jobId
        }

        lastReadAt =
          NativeProcessingTime.now()

        lastError =
          nil

        return result
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Count stored files

  func storedFileCount(
    kind:
      NativeScanStoredFileKind
  ) throws ->
      Int {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let count =
          try storedFileURLsLocked(
            kind:
              kind
          )
          .count

        lastReadAt =
          NativeProcessingTime.now()

        lastError =
          nil

        return count
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Clear storage

  func clear(
    kind:
      NativeScanStoredFileKind
  ) throws {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let fileURLs =
          try storedFileURLsLocked(
            kind:
              kind
          )

        for fileURL in fileURLs {
          try removeFileIfExistsLocked(
            fileURL
          )
        }

        if !fileURLs.isEmpty {
          lastDeleteAt =
            NativeProcessingTime.now()
        }

        lastError =
          nil
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  func clearAll()
    throws {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        var removedAnyFile =
          false

        for kind in
          NativeScanStoredFileKind
            .allCases {
          let fileURLs =
            try storedFileURLsLocked(
              kind:
                kind
            )

          if !fileURLs.isEmpty {
            removedAnyFile =
              true
          }

          for fileURL in fileURLs {
            try removeFileIfExistsLocked(
              fileURL
            )
          }
        }

        let quarantineFiles =
          try contentsLocked(
            of:
              quarantineDirectoryURL
          )

        if !quarantineFiles.isEmpty {
          removedAnyFile =
            true
        }

        for fileURL in quarantineFiles {
          try removeFileIfExistsLocked(
            fileURL
          )
        }

        try removeTemporaryFilesLocked()

        if removedAnyFile {
          lastDeleteAt =
            NativeProcessingTime.now()
        }

        lastError =
          nil
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Cleanup

  func removeFiles(
    olderThan timestamp:
      NativeProcessingTimestamp,
    kinds:
      Set<NativeScanStoredFileKind> =
        Set(
          NativeScanStoredFileKind
            .allCases
        )
  ) throws ->
      Int {
    try storageQueue.sync {
      try assertInitializedLocked()

      guard timestamp > 0 else {
        throw NativeScanJobStoreError
          .invalidCleanupTimestamp
      }

      do {
        var removedCount =
          0

        for kind in kinds {
          let fileURLs =
            try storedFileURLsLocked(
              kind:
                kind
            )

          for fileURL in fileURLs {
            let attributes =
              try fileManager
                .attributesOfItem(
                  atPath:
                    fileURL.path
                )

            guard let modificationDate =
                    attributes[
                      .modificationDate
                    ] as? Date else {
              continue
            }

            let modificationTimestamp =
              Self.timestamp(
                modificationDate
              )

            guard modificationTimestamp <
                    timestamp else {
              continue
            }

            try removeFileIfExistsLocked(
              fileURL
            )

            removedCount +=
              1
          }
        }

        if removedCount > 0 {
          lastDeleteAt =
            NativeProcessingTime.now()
        }

        lastError =
          nil

        return removedCount
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  func removeQuarantinedFiles(
    olderThan timestamp:
      NativeProcessingTimestamp?
        = nil
  ) throws ->
      Int {
    try storageQueue.sync {
      try assertInitializedLocked()

      if let timestamp,
         timestamp <= 0 {
        throw NativeScanJobStoreError
          .invalidCleanupTimestamp
      }

      do {
        let files =
          try contentsLocked(
            of:
              quarantineDirectoryURL
          )

        var removedCount =
          0

        for fileURL in files {
          if let timestamp {
            let attributes =
              try fileManager
                .attributesOfItem(
                  atPath:
                    fileURL.path
                )

            guard let modificationDate =
                    attributes[
                      .modificationDate
                    ] as? Date else {
              continue
            }

            let modifiedAt =
              Self.timestamp(
                modificationDate
              )

            guard modifiedAt <
                    timestamp else {
              continue
            }
          }

          try removeFileIfExistsLocked(
            fileURL
          )

          removedCount +=
            1
        }

        if removedCount > 0 {
          lastDeleteAt =
            NativeProcessingTime.now()
        }

        lastError =
          nil

        return removedCount
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Diagnostics

  func diagnostics()
    throws ->
      NativeScanJobStoreDiagnostics {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let jobFiles =
          try storedFileURLsLocked(
            kind:
              .jobs
          )

        let recordFiles =
          try storedFileURLsLocked(
            kind:
              .records
          )

        let resultFiles =
          try storedFileURLsLocked(
            kind:
              .results
          )

        let diagnosticsFiles =
          try storedFileURLsLocked(
            kind:
              .diagnostics
          )

        let quarantinedFiles =
          try contentsLocked(
            of:
              quarantineDirectoryURL
          )

        let allFiles =
          jobFiles +
          recordFiles +
          resultFiles +
          diagnosticsFiles +
          quarantinedFiles

        var totalSizeBytes:
          Int64 =
            0

        for fileURL in allFiles {
          let attributes =
            try fileManager
              .attributesOfItem(
                atPath:
                  fileURL.path
              )

          let fileSizeBytes =
            (
              attributes[
                .size
              ] as? NSNumber
            )?
            .int64Value ??
            0

          let safeFileSize =
            max(
              0,
              fileSizeBytes
            )

          let addition =
            totalSizeBytes
              .addingReportingOverflow(
                safeFileSize
              )

          if addition.overflow {
            totalSizeBytes =
              Int64.max

            break
          }

          totalSizeBytes =
            addition.partialValue
        }

        lastReadAt =
          NativeProcessingTime.now()

        lastError =
          nil

        return NativeScanJobStoreDiagnostics(
          initialized:
            isInitialized,
          rootDirectory:
            rootDirectoryURL.path,
          savedJobCount:
            jobFiles.count,
          savedRecordCount:
            recordFiles.count,
          savedResultCount:
            resultFiles.count,
          savedDiagnosticsCount:
            diagnosticsFiles.count,
          quarantinedFileCount:
            quarantinedFiles.count,
          totalFileCount:
            allFiles.count,
          totalSizeBytes:
            totalSizeBytes,
          lastReadAt:
            lastReadAt,
          lastWriteAt:
            lastWriteAt,
          lastDeleteAt:
            lastDeleteAt,
          lastQuarantineAt:
            lastQuarantineAt,
          lastError:
            lastError
        )
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Private opaque data methods

  private func saveOpaqueData(
    _ data:
      Data,
    jobId:
      String,
    kind:
      NativeScanStoredFileKind
  ) throws {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let normalizedJobId =
          try normalizeJobIdLocked(
            jobId
          )

        try validateDataSizeLocked(
          data,
          kind:
            kind
        )

        let destinationURL =
          fileURLLocked(
            for:
              normalizedJobId,
            kind:
              kind
          )

        try writeDataAtomicallyLocked(
          data,
          to:
            destinationURL
        )

        lastWriteAt =
          NativeProcessingTime.now()

        lastError =
          nil
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  private func loadOpaqueData(
    jobId:
      String,
    kind:
      NativeScanStoredFileKind
  ) throws ->
      Data? {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let normalizedJobId =
          try normalizeJobIdLocked(
            jobId
          )

        let fileURL =
          fileURLLocked(
            for:
              normalizedJobId,
            kind:
              kind
          )

        guard fileManager
                .fileExists(
                  atPath:
                    fileURL.path
                ) else {
          lastReadAt =
            NativeProcessingTime.now()

          lastError =
            nil

          return nil
        }

        let data =
          try readDataLocked(
            from:
              fileURL,
            kind:
              kind
          )

        lastReadAt =
          NativeProcessingTime.now()

        lastError =
          nil

        return data
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  private func removeOpaqueData(
    jobId:
      String,
    kind:
      NativeScanStoredFileKind
  ) throws {
    try storageQueue.sync {
      try assertInitializedLocked()

      do {
        let normalizedJobId =
          try normalizeJobIdLocked(
            jobId
          )

        let fileURL =
          fileURLLocked(
            for:
              normalizedJobId,
            kind:
              kind
          )

        let existed =
          fileManager
            .fileExists(
              atPath:
                fileURL.path
            )

        try removeFileIfExistsLocked(
          fileURL
        )

        if existed {
          lastDeleteAt =
            NativeProcessingTime.now()
        }

        lastError =
          nil
      } catch {
        lastError =
          error.localizedDescription

        throw error
      }
    }
  }

  // MARK: Data reading

  private func readDataLocked(
    from fileURL:
      URL,
    kind:
      NativeScanStoredFileKind
  ) throws ->
      Data {
    let standardizedURL =
      fileURL
        .standardizedFileURL

    guard fileManager
            .fileExists(
              atPath:
                standardizedURL.path
            ) else {
      throw NativeScanJobStoreError
        .fileNotFound(
          path:
            standardizedURL.path
        )
    }

    guard fileManager
            .isReadableFile(
              atPath:
                standardizedURL.path
            ) else {
      throw NativeScanJobStoreError
        .fileNotReadable(
          path:
            standardizedURL.path
        )
    }

    let attributes =
      try fileManager
        .attributesOfItem(
          atPath:
            standardizedURL.path
        )

    let fileSizeBytes =
      (
        attributes[
          .size
        ] as? NSNumber
      )?
      .int64Value ??
      0

    guard fileSizeBytes >= 0 else {
      throw NativeScanJobStoreError
        .invalidStoredFileSize(
          path:
            standardizedURL.path
        )
    }

    guard fileSizeBytes <=
            Self
              .maximumOpaqueDataBytes else {
      throw NativeScanJobStoreError
        .storedFileTooLarge(
          path:
            standardizedURL.path,
          fileSizeBytes:
            fileSizeBytes,
          maximumBytes:
            Self
              .maximumOpaqueDataBytes
        )
    }

    do {
      let data =
        try Data(
          contentsOf:
            standardizedURL,
          options:
            [
              .mappedIfSafe,
              .uncached
            ]
        )

      try validateDataSizeLocked(
        data,
        kind:
          kind
      )

      return data
    } catch let storeError as
      NativeScanJobStoreError {
      throw storeError
    } catch {
      throw NativeScanJobStoreError
        .readFailed(
          path:
            standardizedURL.path,
          reason:
            error.localizedDescription
        )
    }
  }

  // MARK: Data validation

  private func validateDataSizeLocked(
    _ data:
      Data,
    kind:
      NativeScanStoredFileKind
  ) throws {
    guard !data.isEmpty else {
      throw NativeScanJobStoreError
        .emptyData(
          kind:
            kind
        )
    }

    let dataSizeBytes =
      Int64(
        data.count
      )

    guard dataSizeBytes <=
            Self
              .maximumOpaqueDataBytes else {
      throw NativeScanJobStoreError
        .dataTooLarge(
          kind:
            kind,
          dataSizeBytes:
            dataSizeBytes,
          maximumBytes:
            Self
              .maximumOpaqueDataBytes
        )
    }
  }
  // MARK: Private directory setup

  private func createRequiredDirectoriesLocked()
    throws {
    let directories =
      [
        rootDirectoryURL,
        jobsDirectoryURL,
        recordsDirectoryURL,
        resultsDirectoryURL,
        diagnosticsDirectoryURL,
        temporaryDirectoryURL,
        quarantineDirectoryURL
      ]

    for directoryURL in directories {
      do {
        try fileManager
          .createDirectory(
            at:
              directoryURL,
            withIntermediateDirectories:
              true,
            attributes:
              nil
          )
      } catch {
        throw NativeScanJobStoreError
          .directoryCreationFailed(
            path:
              directoryURL.path,
            reason:
              error.localizedDescription
          )
      }
    }
  }

  private func excludeFromBackupLocked(
    directoryURL:
      URL
  ) throws {
    var mutableURL =
      directoryURL

    var resourceValues =
      URLResourceValues()

    resourceValues
      .isExcludedFromBackup =
        true

    do {
      try mutableURL
        .setResourceValues(
          resourceValues
        )
    } catch {
      throw NativeScanJobStoreError
        .backupExclusionFailed(
          path:
            directoryURL.path,
          reason:
            error.localizedDescription
        )
    }
  }

  // MARK: Atomic writing

  private func writeDataAtomicallyLocked(
    _ data:
      Data,
    to destinationURL:
      URL
  ) throws {
    try validateDestinationURLLocked(
      destinationURL
    )

    let temporaryFileName =
      "\(UUID().uuidString).tmp"

    let temporaryURL =
      temporaryDirectoryURL
        .appendingPathComponent(
          temporaryFileName,
          isDirectory:
            false
        )

    do {
      /*
       * UntilFirstUserAuthentication يسمح بقراءة الملفات
       * بعد أول فتح للجهاز، بما في ذلك أثناء قفل الشاشة.
       */
      try data.write(
        to:
          temporaryURL,
        options:
          [
            .atomic,
            .completeFileProtectionUntilFirstUserAuthentication
          ]
      )

      guard fileManager
              .fileExists(
                atPath:
                  temporaryURL.path
              ) else {
        throw NativeScanJobStoreError
          .temporaryFileMissing(
            path:
              temporaryURL.path
          )
      }

      if fileManager
          .fileExists(
            atPath:
              destinationURL.path
          ) {
        _ =
          try fileManager
            .replaceItemAt(
              destinationURL,
              withItemAt:
                temporaryURL,
              backupItemName:
                nil,
              options:
                []
            )
      } else {
        try fileManager
          .moveItem(
            at:
              temporaryURL,
            to:
              destinationURL
          )
      }

      guard fileManager
              .fileExists(
                atPath:
                  destinationURL.path
              ) else {
        throw NativeScanJobStoreError
          .writeVerificationFailed(
            path:
              destinationURL.path
          )
      }

      try applyFileProtectionLocked(
        fileURL:
          destinationURL
      )
    } catch let storeError as
      NativeScanJobStoreError {
      try? removeFileIfExistsLocked(
        temporaryURL
      )

      throw storeError
    } catch {
      try? removeFileIfExistsLocked(
        temporaryURL
      )

      throw NativeScanJobStoreError
        .writeFailed(
          path:
            destinationURL.path,
          reason:
            error.localizedDescription
        )
    }
  }

  private func applyFileProtectionLocked(
    fileURL:
      URL
  ) throws {
    do {
      try fileManager
        .setAttributes(
          [
            .protectionKey:
              FileProtectionType
                .completeUntilFirstUserAuthentication
          ],
          ofItemAtPath:
            fileURL.path
        )
    } catch {
      throw NativeScanJobStoreError
        .fileProtectionFailed(
          path:
            fileURL.path,
          reason:
            error.localizedDescription
        )
    }
  }

  private func validateDestinationURLLocked(
    _ destinationURL:
      URL
  ) throws {
    let standardizedDestination =
      destinationURL
        .standardizedFileURL

    let standardizedRoot =
      rootDirectoryURL
        .standardizedFileURL

    let rootPath =
      standardizedRoot.path
        .hasSuffix(
          "/"
        )
        ? standardizedRoot.path
        : standardizedRoot.path +
          "/"

    guard standardizedDestination
            .path
            .hasPrefix(
              rootPath
            ) else {
      throw NativeScanJobStoreError
        .destinationOutsideStore(
          path:
            standardizedDestination.path
        )
    }

    let parentDirectory =
      standardizedDestination
        .deletingLastPathComponent()

    guard fileManager
            .fileExists(
              atPath:
                parentDirectory.path
            ) else {
      throw NativeScanJobStoreError
        .destinationDirectoryMissing(
          path:
            parentDirectory.path
        )
    }
  }

  // MARK: Corrupted files

  private func quarantineCorruptedFileLocked(
    fileURL:
      URL,
    kind:
      NativeScanStoredFileKind,
    reason:
      String
  ) throws {
    guard fileManager
            .fileExists(
              atPath:
                fileURL.path
            ) else {
      return
    }

    let timestamp =
      NativeProcessingTime.now()

    let uniqueIdentifier =
      UUID()
        .uuidString

    let quarantineBaseName =
      [
        "corrupted",
        String(
          timestamp
        ),
        uniqueIdentifier,
        fileURL
          .lastPathComponent
      ]
      .joined(
        separator:
          "-"
      )

    let quarantineURL =
      quarantineDirectoryURL
        .appendingPathComponent(
          quarantineBaseName,
          isDirectory:
            false
        )

    do {
      try fileManager
        .moveItem(
          at:
            fileURL,
          to:
            quarantineURL
        )

      try applyFileProtectionLocked(
        fileURL:
          quarantineURL
      )

      let metadataURL =
        quarantineDirectoryURL
          .appendingPathComponent(
            quarantineBaseName,
            isDirectory:
              false
          )
          .appendingPathExtension(
            Self
              .quarantineMetadataExtension
          )

      let metadata:
        [String: Any] =
          [
            "kind":
              kind.rawValue,

            "originalFileName":
              fileURL
                .lastPathComponent,

            "originalPath":
              fileURL.path,

            "quarantinedPath":
              quarantineURL.path,

            "reason":
              reason,

            "quarantinedAt":
              timestamp
          ]

      if JSONSerialization
          .isValidJSONObject(
            metadata
          ) {
        let metadataData =
          try JSONSerialization
            .data(
              withJSONObject:
                metadata,
              options:
                [
                  .sortedKeys
                ]
            )

        try writeDataAtomicallyLocked(
          metadataData,
          to:
            metadataURL
        )
      }

      lastQuarantineAt =
        timestamp
    } catch {
      throw NativeScanJobStoreError
        .quarantineFailed(
          path:
            fileURL.path,
          reason:
            error.localizedDescription
        )
    }
  }

  // MARK: Temporary cleanup

  private func removeTemporaryFilesLocked()
    throws {
    let temporaryFiles =
      try contentsLocked(
        of:
          temporaryDirectoryURL
      )

    for fileURL in temporaryFiles {
      try removeFileIfExistsLocked(
        fileURL
      )
    }
  }

  // MARK: File paths

  private func fileURLLocked(
    for jobId:
      String,
    kind:
      NativeScanStoredFileKind
  ) -> URL {
    let encodedJobId =
      Self.encodeFileName(
        jobId
      )

    let fileExtension =
      fileExtensionLocked(
        for:
          kind
      )

    return directoryURLLocked(
      for:
        kind
    )
    .appendingPathComponent(
      encodedJobId,
      isDirectory:
        false
    )
    .appendingPathExtension(
      fileExtension
    )
  }

  private func directoryURLLocked(
    for kind:
      NativeScanStoredFileKind
  ) -> URL {
    switch kind {
    case .jobs:
      return jobsDirectoryURL

    case .records:
      return recordsDirectoryURL

    case .results:
      return resultsDirectoryURL

    case .diagnostics:
      return diagnosticsDirectoryURL
    }
  }

  private func fileExtensionLocked(
    for kind:
      NativeScanStoredFileKind
  ) -> String {
    switch kind {
    case .jobs:
      return Self.jobFileExtension

    case .records:
      return Self.recordFileExtension

    case .results:
      return Self.resultFileExtension

    case .diagnostics:
      return Self.diagnosticsFileExtension
    }
  }

  private func storedFileURLsLocked(
    kind:
      NativeScanStoredFileKind
  ) throws ->
      [URL] {
    let directoryURL =
      directoryURLLocked(
        for:
          kind
      )

    let expectedSuffix =
      ".\(fileExtensionLocked(for: kind))"

    let fileURLs =
      try contentsLocked(
        of:
          directoryURL
      )
      .filter {
        $0
          .lastPathComponent
          .hasSuffix(
            expectedSuffix
          )
      }

    guard fileURLs.count <=
            Self
              .maximumStoredFileCount else {
      throw NativeScanJobStoreError
        .tooManyStoredFiles(
          kind:
            kind,
          count:
            fileURLs.count,
          maximumCount:
            Self
              .maximumStoredFileCount
        )
    }

    return fileURLs
      .sorted {
        $0.lastPathComponent <
          $1.lastPathComponent
      }
  }

  private func decodeJobIdLocked(
    from fileURL:
      URL,
    kind:
      NativeScanStoredFileKind
  ) -> String? {
    let expectedSuffix =
      ".\(fileExtensionLocked(for: kind))"

    let fileName =
      fileURL
        .lastPathComponent

    guard fileName
            .hasSuffix(
              expectedSuffix
            ) else {
      return nil
    }

    let encodedJobId =
      String(
        fileName
          .dropLast(
            expectedSuffix
              .count
          )
      )

    guard !encodedJobId
            .isEmpty else {
      return nil
    }

    return Self.decodeFileName(
      encodedJobId
    )
  }

  // MARK: File operations

  private func contentsLocked(
    of directoryURL:
      URL
  ) throws ->
      [URL] {
    do {
      let contents =
        try fileManager
          .contentsOfDirectory(
            at:
              directoryURL,
            includingPropertiesForKeys:
              [
                .isRegularFileKey,
                .creationDateKey,
                .contentModificationDateKey,
                .fileSizeKey
              ],
            options:
              [
                .skipsHiddenFiles
              ]
          )

      return contents
        .filter {
          fileURL in

          let resourceValues =
            try? fileURL
              .resourceValues(
                forKeys:
                  [
                    .isRegularFileKey
                  ]
              )

          return resourceValues?
            .isRegularFile ==
            true
        }
    } catch {
      throw NativeScanJobStoreError
        .directoryReadFailed(
          path:
            directoryURL.path,
          reason:
            error.localizedDescription
        )
    }
  }

  private func removeFileIfExistsLocked(
    _ fileURL:
      URL
  ) throws {
    guard fileManager
            .fileExists(
              atPath:
                fileURL.path
            ) else {
      return
    }

    do {
      try fileManager
        .removeItem(
          at:
            fileURL
        )
    } catch {
      throw NativeScanJobStoreError
        .deleteFailed(
          path:
            fileURL.path,
          reason:
            error.localizedDescription
        )
    }
  }

  // MARK: Validation

  private func assertInitializedLocked()
    throws {
    guard isInitialized else {
      throw NativeScanJobStoreError
        .notInitialized
    }
  }

  private func normalizeJobIdLocked(
    _ jobId:
      String
  ) throws ->
      String {
    let normalized =
      jobId
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalized
            .isEmpty else {
      throw NativeScanJobStoreError
        .missingJobId
    }

    guard normalized.count <=
            Self
              .maximumJobIdLength else {
      throw NativeScanJobStoreError
        .jobIdTooLong(
          maximumLength:
            Self
              .maximumJobIdLength
        )
    }

    return normalized
  }

  // MARK: File name encoding

  private static func encodeFileName(
    _ value:
      String
  ) -> String {
    Data(
      value.utf8
    )
    .base64EncodedString()
    .replacingOccurrences(
      of:
        "+",
      with:
        "-"
    )
    .replacingOccurrences(
      of:
        "/",
      with:
        "_"
    )
    .replacingOccurrences(
      of:
        "=",
      with:
        ""
    )
  }

  private static func decodeFileName(
    _ value:
      String
  ) -> String? {
    var base64 =
      value
        .replacingOccurrences(
          of:
            "-",
          with:
            "+"
        )
        .replacingOccurrences(
          of:
            "_",
          with:
            "/"
        )

    let remainder =
      base64.count %
      4

    if remainder != 0 {
      base64 +=
        String(
          repeating:
            "=",
          count:
            4 -
            remainder
        )
    }

    guard let data =
            Data(
              base64Encoded:
                base64
            ),
          let decodedValue =
            String(
              data:
                data,
              encoding:
                .utf8
            ) else {
      return nil
    }

    let normalized =
      decodedValue
        .trimmingCharacters(
          in:
            .whitespacesAndNewlines
        )

    guard !normalized
            .isEmpty,
          normalized.count <=
            maximumJobIdLength else {
      return nil
    }

    return normalized
  }

  // MARK: Base directory

  private static func resolveBaseDirectory(
    fileManager:
      FileManager,
    override:
      URL?
  ) throws ->
      URL {
    if let override {
      let standardizedOverride =
        override
          .standardizedFileURL

      guard standardizedOverride
              .isFileURL else {
        throw NativeScanJobStoreError
          .invalidBaseDirectory(
            path:
              standardizedOverride
                .absoluteString
          )
      }

      return standardizedOverride
    }

    if let applicationSupportDirectory =
        fileManager
          .urls(
            for:
              .applicationSupportDirectory,
            in:
              .userDomainMask
          )
          .first {
      return applicationSupportDirectory
        .standardizedFileURL
    }

    if let cachesDirectory =
        fileManager
          .urls(
            for:
              .cachesDirectory,
            in:
              .userDomainMask
          )
          .first {
      return cachesDirectory
        .standardizedFileURL
    }

    throw NativeScanJobStoreError
      .baseDirectoryUnavailable
  }

  // MARK: Timestamp

  private static func timestamp(
    _ date:
      Date
  ) -> NativeProcessingTimestamp {
    let milliseconds =
      date
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
}

// MARK: - Store errors

enum NativeScanJobStoreError:
  LocalizedError,
  Equatable,
  Sendable {

  case notInitialized

  case baseDirectoryUnavailable

  case invalidBaseDirectory(
    path:
      String
  )

  case missingJobId

  case jobIdTooLong(
    maximumLength:
      Int
  )

  case invalidCleanupTimestamp

  case jobIdentifierMismatch(
    expected:
      String,
    received:
      String
  )

  case invalidStoredFileName(
    path:
      String
  )

  case directoryCreationFailed(
    path:
      String,
    reason:
      String
  )

  case directoryReadFailed(
    path:
      String,
    reason:
      String
  )

  case backupExclusionFailed(
    path:
      String,
    reason:
      String
  )

  case fileNotFound(
    path:
      String
  )

  case fileNotReadable(
    path:
      String
  )

  case invalidStoredFileSize(
    path:
      String
  )

  case storedFileTooLarge(
    path:
      String,
    fileSizeBytes:
      Int64,
    maximumBytes:
      Int64
  )

  case emptyData(
    kind:
      NativeScanStoredFileKind
  )

  case dataTooLarge(
    kind:
      NativeScanStoredFileKind,
    dataSizeBytes:
      Int64,
    maximumBytes:
      Int64
  )

  case encodingFailed(
    kind:
      NativeScanStoredFileKind,
    reason:
      String
  )

  case decodingFailed(
    kind:
      NativeScanStoredFileKind,
    reason:
      String
  )

  case readFailed(
    path:
      String,
    reason:
      String
  )

  case writeFailed(
    path:
      String,
    reason:
      String
  )

  case temporaryFileMissing(
    path:
      String
  )

  case writeVerificationFailed(
    path:
      String
  )

  case fileProtectionFailed(
    path:
      String,
    reason:
      String
  )

  case destinationOutsideStore(
    path:
      String
  )

  case destinationDirectoryMissing(
    path:
      String
  )

  case deleteFailed(
    path:
      String,
    reason:
      String
  )

  case quarantineFailed(
    path:
      String,
    reason:
      String
  )

  case tooManyStoredFiles(
    kind:
      NativeScanStoredFileKind,
    count:
      Int,
    maximumCount:
      Int
  )

  var errorDescription:
    String? {
    switch self {
    case .notInitialized:
      return
        """
        Native scan job store has not been initialized.
        """

    case .baseDirectoryUnavailable:
      return
        """
        Native scan job store could not resolve a writable base directory.
        """

    case .invalidBaseDirectory(
      let path
    ):
      return
        """
        Native scan job store base directory is invalid: \(path).
        """

    case .missingJobId:
      return
        """
        Native scan job store requires a non-empty jobId.
        """

    case .jobIdTooLong(
      let maximumLength
    ):
      return
        """
        Native scan job ID exceeds the maximum length of \(maximumLength) characters.
        """

    case .invalidCleanupTimestamp:
      return
        """
        Native scan job cleanup timestamp must be greater than zero.
        """

    case .jobIdentifierMismatch(
      let expected,
      let received
    ):
      return
        """
        Stored native scan job identifier mismatch. Expected \(expected), received \(received).
        """

    case .invalidStoredFileName(
      let path
    ):
      return
        """
        Native scan job store found an invalid stored file name at \(path).
        """

    case .directoryCreationFailed(
      let path,
      let reason
    ):
      return
        """
        Native scan job store could not create directory \(path): \(reason)
        """

    case .directoryReadFailed(
      let path,
      let reason
    ):
      return
        """
        Native scan job store could not read directory \(path): \(reason)
        """

    case .backupExclusionFailed(
      let path,
      let reason
    ):
      return
        """
        Native scan job store could not exclude \(path) from device backup: \(reason)
        """

    case .fileNotFound(
      let path
    ):
      return
        """
        Native scan job store file was not found at \(path).
        """

    case .fileNotReadable(
      let path
    ):
      return
        """
        Native scan job store cannot read file at \(path).
        """

    case .invalidStoredFileSize(
      let path
    ):
      return
        """
        Native scan job store found an invalid file size at \(path).
        """

    case .storedFileTooLarge(
      let path,
      let fileSizeBytes,
      let maximumBytes
    ):
      return
        """
        Native scan job store file \(path) is too large: \(fileSizeBytes) bytes. Maximum allowed size is \(maximumBytes) bytes.
        """

    case .emptyData(
      let kind
    ):
      return
        """
        Native scan job store cannot save empty \(kind.rawValue) data.
        """

    case .dataTooLarge(
      let kind,
      let dataSizeBytes,
      let maximumBytes
    ):
      return
        """
        Native scan job store \(kind.rawValue) data is too large: \(dataSizeBytes) bytes. Maximum allowed size is \(maximumBytes) bytes.
        """

    case .encodingFailed(
      let kind,
      let reason
    ):
      return
        """
        Native scan job store could not encode \(kind.rawValue) data: \(reason)
        """

    case .decodingFailed(
      let kind,
      let reason
    ):
      return
        """
        Native scan job store could not decode \(kind.rawValue) data: \(reason)
        """

    case .readFailed(
      let path,
      let reason
    ):
      return
        """
        Native scan job store could not read \(path): \(reason)
        """

    case .writeFailed(
      let path,
      let reason
    ):
      return
        """
        Native scan job store could not write \(path): \(reason)
        """

    case .temporaryFileMissing(
      let path
    ):
      return
        """
        Native scan job store temporary file was not created at \(path).
        """

    case .writeVerificationFailed(
      let path
    ):
      return
        """
        Native scan job store could not verify the written file at \(path).
        """

    case .fileProtectionFailed(
      let path,
      let reason
    ):
      return
        """
        Native scan job store could not apply file protection to \(path): \(reason)
        """

    case .destinationOutsideStore(
      let path
    ):
      return
        """
        Native scan job store rejected a destination outside its root directory: \(path).
        """

    case .destinationDirectoryMissing(
      let path
    ):
      return
        """
        Native scan job store destination directory does not exist at \(path).
        """

    case .deleteFailed(
      let path,
      let reason
    ):
      return
        """
        Native scan job store could not delete \(path): \(reason)
        """

    case .quarantineFailed(
      let path,
      let reason
    ):
      return
        """
        Native scan job store could not quarantine corrupted file \(path): \(reason)
        """

    case .tooManyStoredFiles(
      let kind,
      let count,
      let maximumCount
    ):
      return
        """
        Native scan job store contains too many \(kind.rawValue) files: \(count). Maximum allowed count is \(maximumCount).
        """
    }
  }
}