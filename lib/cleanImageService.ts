import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

const BACKEND_URL =
  'https://triplen-backend-production.up.railway.app';

const REQUEST_TIMEOUT_MS =
  120_000;

const QUEUE_REQUEST_TIMEOUT_MS =
  30_000;

const BATCH_REQUEST_TIMEOUT_MS =
  30_000;

const MAX_BATCH_IMAGES =
  100;

const DEFAULT_UPLOAD_CONCURRENCY =
  3;

const MAX_UPLOAD_CONCURRENCY =
  5;

export type ImageJobState =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WardrobeProcessingState =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export type ImageBatchState =
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export type QueueImageJobInput = {
  imageUri: string;

  category: string;

  subCategory?:
    | string
    | null;

  name?: string;

  color?: string;

  shade?:
    | string
    | null;
};

type QueueImageJobOptions = {
  batchId?:
    | string
    | null;

  batchIndex?:
    | number
    | null;

  batchTotal?:
    | number
    | null;
};

export type QueuedImageJob = {
  userId: string;

  wardrobeItemId: string;

  jobId: string;

  status:
    ImageJobState;

  batchId?:
    | string
    | null;

  batchIndex?:
    | number
    | null;

  duplicate?: boolean;

  cacheHit?: boolean;
};

export type ImageJobStatus = {
  id: string;

  status:
    ImageJobState;

  attempts: number;

  max_attempts: number;

  error_message?:
    | string
    | null;

  wardrobe_item_id: string;

  batch_id?:
    | string
    | null;

  batch_index?:
    | number
    | null;

  created_at?: string;

  updated_at?: string;

  processing_started_at?:
    | string
    | null;

  completed_at?:
    | string
    | null;

  wardrobe_items?: {
    id: string;

    image: string;

    processing_status:
      WardrobeProcessingState;

    processing_error?:
      | string
      | null;
  } | null;
};

export type CreatedImageBatch = {
  id: string;

  userId: string;

  status:
    ImageBatchState;

  totalImages: number;

  createdAt?: string;
};

export type ImageBatchStatus = {
  id: string;

  user_id?: string;

  status:
    ImageBatchState;

  total_images: number;

  uploaded_images: number;

  queued_images: number;

  processing_images: number;

  completed_images: number;

  failed_images: number;

  cancelled_images: number;

  upload_completed: boolean;

  notification_sent?: boolean;

  progress: number;

  created_at?: string;

  updated_at?: string;

  started_at?:
    | string
    | null;

  completed_at?:
    | string
    | null;

  error_message?:
    | string
    | null;

  jobs:
    ImageJobStatus[];
};

export type QueueImageBatchInput = {
  images:
    QueueImageJobInput[];

  concurrency?: number;

  onProgress?: (
    progress:
      QueueImageBatchProgress
  ) => void;
};

export type QueueImageBatchProgress = {
  batchId: string;

  uploaded: number;

  total: number;

  failed: number;

  percentage: number;

  currentIndex:
    number | null;
};

export type QueuedImageBatchResult = {
  batchId: string;

  total: number;

  uploaded: number;

  queued:
    QueuedImageJob[];

  failed: Array<{
    index: number;

    imageUri: string;

    error: string;
  }>;
};

type CreateBatchInput = {
  totalImages: number;
};

type WaitForBatchOptions = {
  intervalMs?: number;

  timeoutMs?: number;

  onStatus?: (
    status:
      ImageBatchStatus
  ) => void;
};

type BackendResult<T> = {
  success?: boolean;

  message?: string;

  error?: string;

  retryAfterSeconds?:
    number;

  data?: T;
};

function normalizeBackendUrl() {
  return BACKEND_URL.replace(
    /\/+$/,
    ''
  );
}

function getErrorMessage(
  error: unknown,
  fallback:
    string
) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  if (
    typeof error ===
      'string' &&
    error.trim()
  ) {
    return error;
  }

  return fallback;
}

function createAbortController(
  timeoutMs: number
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, timeoutMs);

  return {
    controller,

    clear() {
      clearTimeout(
        timeout
      );
    },
  };
}

function normalizeConcurrency(
  concurrency?: number
) {
  const value =
    Number.isFinite(
      concurrency
    )
      ? Number(
          concurrency
        )
      : DEFAULT_UPLOAD_CONCURRENCY;

  return Math.max(
    1,
    Math.min(
      Math.floor(
        value
      ),
      MAX_UPLOAD_CONCURRENCY
    )
  );
}

function validateImageInput(
  input:
    QueueImageJobInput
) {
  if (
    !input.imageUri ||
    !input.imageUri.trim()
  ) {
    throw new Error(
      'Image file is missing'
    );
  }

  if (
    !input.category ||
    !input.category.trim()
  ) {
    throw new Error(
      'Please select an image category'
    );
  }
}

function validateBatchImages(
  images:
    QueueImageJobInput[]
) {
  if (
    !Array.isArray(
      images
    ) ||
    images.length === 0
  ) {
    throw new Error(
      'Please select at least one image'
    );
  }

  if (
    images.length >
    MAX_BATCH_IMAGES
  ) {
    throw new Error(
      `You can upload up to ${MAX_BATCH_IMAGES} images at once`
    );
  }

  images.forEach(
    (
      image,
      index
    ) => {
      try {
        validateImageInput(
          image
        );
      } catch (
        error
      ) {
        throw new Error(
          `Image ${index + 1}: ${getErrorMessage(
            error,
            'Invalid image'
          )}`
        );
      }
    }
  );
}

function normalizeJobStatus(
  value: unknown
): ImageJobState {
  switch (value) {
    case 'processing':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return value;

    default:
      return 'queued';
  }
}

function normalizeBatchState(
  value: unknown
): ImageBatchState {
  switch (value) {
    case 'processing':
    case 'completed':
    case 'completed_with_errors':
    case 'failed':
    case 'cancelled':
      return value;

    default:
      return 'uploading';
  }
}

function normalizeBatchStatus(
  data: any
): ImageBatchStatus {
  const jobs:
    ImageJobStatus[] =
    Array.isArray(
      data?.jobs
    )
      ? data.jobs
      : [];

  const totalImages =
    Math.max(
      0,
      Number(
        data?.total_images ??
          data?.totalImages ??
          0
      ) || 0
    );

  const uploadedImages =
    Math.max(
      0,
      Number(
        data?.uploaded_images ??
          data?.uploadedImages ??
          jobs.length ??
          0
      ) || 0
    );

  const completedImages =
    Math.max(
      0,
      Number(
        data?.completed_images ??
          data?.completedImages ??
          jobs.filter(
            (job) =>
              job.status ===
              'completed'
          ).length
      ) || 0
    );

  const failedImages =
    Math.max(
      0,
      Number(
        data?.failed_images ??
          data?.failedImages ??
          jobs.filter(
            (job) =>
              job.status ===
              'failed'
          ).length
      ) || 0
    );

  const cancelledImages =
    Math.max(
      0,
      Number(
        data?.cancelled_images ??
          data?.cancelledImages ??
          jobs.filter(
            (job) =>
              job.status ===
              'cancelled'
          ).length
      ) || 0
    );

  const queuedImages =
    jobs.length > 0
      ? jobs.filter(
          (job) =>
            job.status ===
            'queued'
        ).length
      : Math.max(
          0,
          uploadedImages -
            completedImages -
            failedImages -
            cancelledImages
        );

  const processingImages =
    jobs.length > 0
      ? jobs.filter(
          (job) =>
            job.status ===
            'processing'
        ).length
      : 0;

  const finishedImages =
    completedImages +
    failedImages +
    cancelledImages;

  const progressBase =
    totalImages > 0
      ? totalImages
      : uploadedImages;

  const progress =
    progressBase > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (
                finishedImages /
                progressBase
              ) *
                100
            )
          )
        )
      : 0;

  return {
    id:
      String(
        data?.id ??
          data?.batchId ??
          ''
      ),

    user_id:
      data?.user_id ??
      data?.userId,

    status:
      normalizeBatchState(
        data?.status
      ),

    total_images:
      totalImages,

    uploaded_images:
      uploadedImages,

    queued_images:
      queuedImages,

    processing_images:
      processingImages,

    completed_images:
      completedImages,

    failed_images:
      failedImages,

    cancelled_images:
      cancelledImages,

    upload_completed:
      Boolean(
        data?.upload_completed ??
          data?.uploadCompleted
      ),

    notification_sent:
      Boolean(
        data?.notification_sent ??
          data?.notificationSent
      ),

    progress,

    created_at:
      data?.created_at ??
      data?.createdAt,

    updated_at:
      data?.updated_at ??
      data?.updatedAt,

    started_at:
      data?.started_at ??
      data?.startedAt ??
      null,

    completed_at:
      data?.completed_at ??
      data?.completedAt ??
      null,

    error_message:
      data?.error_message ??
      data?.errorMessage ??
      null,

    jobs,
  };
}

async function getAccessToken() {
  const {
    data: {
      session,
    },
    error,
  } =
    await supabase.auth.getSession();

  if (error) {
    throw new Error(
      'Could not verify login session'
    );
  }

  if (
    !session
      ?.access_token
  ) {
    throw new Error(
      'Please sign in again'
    );
  }

  return session.access_token;
}

async function readImageBase64(
  imageUri: string
) {
  if (
    !imageUri ||
    !imageUri.trim()
  ) {
    throw new Error(
      'Image file is missing'
    );
  }

  try {
    const base64 =
      await FileSystem.readAsStringAsync(
        imageUri,
        {
          encoding:
            'base64' as any,
        }
      );

    if (
      !base64 ||
      base64.length === 0
    ) {
      throw new Error(
        'Could not read the selected image'
      );
    }

    return base64;
  } catch (
    error
  ) {
    console.log(
      'READ IMAGE ERROR:',
      error
    );

    throw new Error(
      'Could not read the selected image'
    );
  }
}

async function readJsonResponse<
  T = any,
>(
  response: Response
): Promise<
  BackendResult<T>
> {
  const text =
    await response.text();

  if (
    !text ||
    !text.trim()
  ) {
    throw new Error(
      'Backend returned an empty response'
    );
  }

  try {
    return JSON.parse(
      text
    ) as BackendResult<T>;
  } catch {
    console.log(
      'BACKEND RAW RESPONSE:',
      text
    );

    throw new Error(
      'Backend returned invalid JSON'
    );
  }
}

function throwResponseError(
  response: Response,
  result:
    BackendResult<any>
): never {
  if (
    response.status ===
    400
  ) {
    throw new Error(
      result?.message ||
        result?.error ||
        'Invalid request'
    );
  }

  if (
    response.status ===
    401
  ) {
    throw new Error(
      'Session expired. Please sign in again'
    );
  }

  if (
    response.status ===
    403
  ) {
    throw new Error(
      result?.message ||
        result?.error ||
        'You are not allowed to perform this action'
    );
  }

  if (
    response.status ===
    404
  ) {
    throw new Error(
      result?.message ||
        result?.error ||
        'The requested image job was not found'
    );
  }

  if (
    response.status ===
    409
  ) {
    throw new Error(
      result?.message ||
        result?.error ||
        'The image job already exists'
    );
  }

  if (
    response.status ===
    413
  ) {
    throw new Error(
      'Image is too large'
    );
  }

  if (
    response.status ===
    429
  ) {
    throw new Error(
      result?.message ||
        result?.error ||
        'Too many requests. Please wait and try again'
    );
  }

  if (
    response.status >=
    500
  ) {
    throw new Error(
      result?.message ||
        result?.error ||
        'Image processing service is temporarily unavailable'
    );
  }

  throw new Error(
    result?.message ||
      result?.error ||
      'Something went wrong'
  );
}

/**
 * إنشاء Batch جديد قبل رفع الصور.
 */
export async function createImageBatch(
  input:
    CreateBatchInput
): Promise<
  CreatedImageBatch
> {
  const totalImages =
    Math.floor(
      input.totalImages
    );

  if (
    totalImages < 1
  ) {
    throw new Error(
      'Please select at least one image'
    );
  }

  if (
    totalImages >
    MAX_BATCH_IMAGES
  ) {
    throw new Error(
      `You can upload up to ${MAX_BATCH_IMAGES} images at once`
    );
  }

  const accessToken =
    await getAccessToken();

  const {
    controller,
    clear,
  } =
    createAbortController(
      BATCH_REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `${normalizeBackendUrl()}/upload/image-batch`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${accessToken}`,
          },

          signal:
            controller.signal,

          body:
            JSON.stringify({
              totalImages,
            }),
        }
      );

    const result =
      await readJsonResponse<any>(
        response
      );

    if (
      !response.ok ||
      !result?.success
    ) {
      throwResponseError(
        response,
        result
      );
    }

    const batchId =
      result.data
        ?.batchId ||
      result.data?.id;

    if (!batchId) {
      throw new Error(
        'Backend did not return the batch ID'
      );
    }

    return {
      id:
        batchId,

      userId:
        result.data
          ?.userId ||
        result.data
          ?.user_id ||
        '',

      status:
        normalizeBatchState(
          result.data
            ?.status
        ),

      totalImages:
        Number(
          result.data
            ?.totalImages ??
            result.data
              ?.total_images ??
            totalImages
        ),

      createdAt:
        result.data
          ?.createdAt ??
        result.data
          ?.created_at,
    };
  } catch (
    error: any
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        'Creating the image batch took too long'
      );
    }

    if (
      error instanceof
      TypeError
    ) {
      throw new Error(
        'Could not connect to the server'
      );
    }

    throw error;
  } finally {
    clear();
  }
}

/**
 * إبلاغ الـBackend بأن رفع صور الـBatch انتهى.
 */
export async function completeImageBatchUpload(
  batchId: string
): Promise<
  ImageBatchStatus
> {
  if (
    !batchId ||
    !batchId.trim()
  ) {
    throw new Error(
      'Image batch ID is missing'
    );
  }

  const accessToken =
    await getAccessToken();

  const {
    controller,
    clear,
  } =
    createAbortController(
      BATCH_REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `${normalizeBackendUrl()}/upload/image-batch/${encodeURIComponent(
          batchId
        )}/complete-upload`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${accessToken}`,
          },

          signal:
            controller.signal,

          body:
            JSON.stringify(
              {}
            ),
        }
      );

    const result =
      await readJsonResponse<any>(
        response
      );

    if (
      !response.ok ||
      !result?.success
    ) {
      throwResponseError(
        response,
        result
      );
    }

    if (
      !result.data
    ) {
      throw new Error(
        'Backend returned an empty image batch'
      );
    }

    return normalizeBatchStatus(
      result.data
    );
  } catch (
    error: any
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        'Completing the image batch upload took too long'
      );
    }

    if (
      error instanceof
      TypeError
    ) {
      throw new Error(
        'Could not connect to the server'
      );
    }

    throw error;
  } finally {
    clear();
  }
}

/**
 * رفع صورة واحدة وإنشاء Wardrobe Item وJob.
 */
export async function queueImageJob(
  input:
    QueueImageJobInput,

  options:
    QueueImageJobOptions = {}
): Promise<
  QueuedImageJob
> {
  validateImageInput(
    input
  );

  const accessToken =
    await getAccessToken();

  const imageBase64 =
    await readImageBase64(
      input.imageUri
    );

  console.log(
    '━━━━━━━━━━━━━━━━━━━━'
  );

  console.log(
    'QUEUEING IMAGE JOB...'
  );

  console.log(
    'Category:',
    input.category
  );

  console.log(
    'Batch ID:',
    options.batchId ??
      'none'
  );

  console.log(
    'Batch index:',
    options.batchIndex ??
      'none'
  );

  console.log(
    'Base64 length:',
    imageBase64.length
  );

  const {
    controller,
    clear,
  } =
    createAbortController(
      QUEUE_REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `${normalizeBackendUrl()}/upload/image-job`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${accessToken}`,
          },

          signal:
            controller.signal,

          body:
            JSON.stringify({
              imageBase64,

              category:
                input.category.trim(),

              subCategory:
                input.subCategory
                  ?.trim() ||
                null,

              name:
                input.name
                  ?.trim() ||
                null,

              color:
                input.color
                  ?.trim() ||
                null,

              shade:
                input.shade
                  ?.trim() ||
                null,

              batchId:
                options.batchId ??
                null,

              batchIndex:
                options.batchIndex ??
                null,

              batchTotal:
                options.batchTotal ??
                null,
            }),
        }
      );

    const result =
      await readJsonResponse<any>(
        response
      );

    if (
      !response.ok ||
      !result?.success
    ) {
      throwResponseError(
        response,
        result
      );
    }

    const data =
      result?.data;

    if (
      !data?.jobId ||
      !data
        ?.wardrobeItemId
    ) {
      throw new Error(
        'Backend did not return the image job'
      );
    }

    console.log(
      `IMAGE JOB QUEUED | job=${data.jobId} | batch=${data.batchId ?? options.batchId ?? 'none'} | status=${data.status ?? 'queued'}`
    );

    return {
      userId:
        data.userId ||
        '',

      wardrobeItemId:
        data.wardrobeItemId,

      jobId:
        data.jobId,

      status:
        normalizeJobStatus(
          data.status
        ),

      batchId:
        data.batchId ??
        options.batchId ??
        null,

      batchIndex:
        data.batchIndex ??
        options.batchIndex ??
        null,

      duplicate:
        Boolean(
          data.duplicate
        ),

      cacheHit:
        Boolean(
          data.cacheHit
        ),
    };
  } catch (
    error: any
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        'Uploading the image took too long'
      );
    }

    if (
      error instanceof
      TypeError
    ) {
      throw new Error(
        'Could not connect to the server'
      );
    }

    throw error;
  } finally {
    clear();
  }
}

/**
 * إنشاء Batch حقيقي ورفع من صورة واحدة إلى 100 صورة.
 */
export async function queueImageJobs(
  input:
    QueueImageBatchInput
): Promise<
  QueuedImageBatchResult
> {
  validateBatchImages(
    input.images
  );

  const images =
    [...input.images];

  const concurrency =
    normalizeConcurrency(
      input.concurrency
    );

  const batch =
    await createImageBatch({
      totalImages:
        images.length,
    });

    input.onProgress?.({
  batchId:
    batch.id,

  uploaded: 0,

  total:
    images.length,

  failed: 0,

  percentage: 0,

  currentIndex:
    null,
});

  const queuedByIndex =
    new Map<
      number,
      QueuedImageJob
    >();

  const failed:
    QueuedImageBatchResult['failed'] =
      [];

  let nextIndex =
    0;

  let completedRequests =
    0;

  async function worker() {
    while (true) {
      const currentIndex =
        nextIndex;

      nextIndex += 1;

      if (
        currentIndex >=
        images.length
      ) {
        return;
      }

      const imageInput =
        images[
          currentIndex
        ];

      try {
        const result =
          await queueImageJob(
            imageInput,
            {
              batchId:
                batch.id,

              batchIndex:
                currentIndex,

              batchTotal:
                images.length,
            }
          );

        queuedByIndex.set(
          currentIndex,
          result
        );
      } catch (
        error
      ) {
        failed.push({
          index:
            currentIndex,

          imageUri:
            imageInput.imageUri,

          error:
            getErrorMessage(
              error,
              'Could not upload image'
            ),
        });
      } finally {
        completedRequests += 1;

        const percentage =
          Math.min(
            100,
            Math.round(
              (
                completedRequests /
                images.length
              ) *
                100
            )
          );

        input.onProgress?.({
          batchId:
            batch.id,

          uploaded:
            completedRequests,

          total:
            images.length,

          failed:
            failed.length,

          percentage,

          currentIndex,
        });
      }
    }
  }

  const workers =
    Array.from(
      {
        length:
          Math.min(
            concurrency,
            images.length
          ),
      },
      () => worker()
    );

  await Promise.all(
    workers
  );

  const queued =
    [...queuedByIndex.entries()]
      .sort(
        (
          first,
          second
        ) =>
          first[0] -
          second[0]
      )
      .map(
        (
          [
            ,
            job,
          ]
        ) => job
      );

  failed.sort(
    (
      first,
      second
    ) =>
      first.index -
      second.index
  );

  if (
    queued.length >
    0
  ) {
    await completeImageBatchUpload(
      batch.id
    );
  } else {
    try {
      await cancelImageBatch(
        batch.id
      );
    } catch (
      cancelError
    ) {
      console.warn(
        'EMPTY BATCH CANCEL ERROR:',
        getErrorMessage(
          cancelError,
          'Could not cancel empty image batch'
        )
      );
    }
  }

  return {
    batchId:
      batch.id,

    total:
      images.length,

    uploaded:
      queued.length,

    queued,

    failed,
  };
}

/**
 * Alias واضح للشاشات الجديدة.
 */
export async function queueImageBatch(
  input:
    QueueImageBatchInput
) {
  return queueImageJobs(
    input
  );
}

/**
 * قراءة حالة Job واحدة.
 */
export async function getImageJobStatus(
  jobId: string
): Promise<
  ImageJobStatus
> {
  if (
    !jobId ||
    !jobId.trim()
  ) {
    throw new Error(
      'Image job ID is missing'
    );
  }

  const accessToken =
    await getAccessToken();

  const {
    controller,
    clear,
  } =
    createAbortController(
      QUEUE_REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `${normalizeBackendUrl()}/upload/image-job/${encodeURIComponent(
          jobId
        )}`,
        {
          method:
            'GET',

          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },

          signal:
            controller.signal,
        }
      );

    const result =
      await readJsonResponse<ImageJobStatus>(
        response
      );

    if (
      !response.ok ||
      !result?.success
    ) {
      throwResponseError(
        response,
        result
      );
    }

    if (
      !result.data
    ) {
      throw new Error(
        'Backend returned an empty image job'
      );
    }

    return result.data;
  } catch (
    error: any
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        'Reading the image job took too long'
      );
    }

    if (
      error instanceof
      TypeError
    ) {
      throw new Error(
        'Could not connect to the server'
      );
    }

    throw error;
  } finally {
    clear();
  }
}

/**
 * قراءة حالة Batch بالكامل.
 */
export async function getImageBatchStatus(
  batchId: string
): Promise<
  ImageBatchStatus
> {
  if (
    !batchId ||
    !batchId.trim()
  ) {
    throw new Error(
      'Image batch ID is missing'
    );
  }

  const accessToken =
    await getAccessToken();

  const {
    controller,
    clear,
  } =
    createAbortController(
      BATCH_REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `${normalizeBackendUrl()}/upload/image-batch/${encodeURIComponent(
          batchId
        )}`,
        {
          method:
            'GET',

          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },

          signal:
            controller.signal,
        }
      );

    const result =
      await readJsonResponse<any>(
        response
      );

    if (
      !response.ok ||
      !result?.success
    ) {
      throwResponseError(
        response,
        result
      );
    }

    if (
      !result.data
    ) {
      throw new Error(
        'Backend returned an empty image batch'
      );
    }

    return normalizeBatchStatus(
      result.data
    );
  } catch (
    error: any
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        'Reading the image batch took too long'
      );
    }

    if (
      error instanceof
      TypeError
    ) {
      throw new Error(
        'Could not connect to the server'
      );
    }

    throw error;
  } finally {
    clear();
  }
}

/**
 * متابعة Batch حتى ينتهي.
 */
export async function waitForImageBatch(
  batchId: string,

  options:
    WaitForBatchOptions = {}
): Promise<
  ImageBatchStatus
> {
  const intervalMs =
    Math.max(
      1_500,
      options.intervalMs ??
        3_000
    );

  const timeoutMs =
    Math.max(
      intervalMs,
      options.timeoutMs ??
        30 * 60 * 1000
    );

  const startedAt =
    Date.now();

  while (true) {
    const status =
      await getImageBatchStatus(
        batchId
      );

    options.onStatus?.(
      status
    );

    if (
      status.status ===
        'completed' ||
      status.status ===
        'completed_with_errors' ||
      status.status ===
        'failed' ||
      status.status ===
        'cancelled'
    ) {
      return status;
    }

    if (
      Date.now() -
        startedAt >=
      timeoutMs
    ) {
      throw new Error(
        'Image processing is still running in the background'
      );
    }

    await new Promise<void>(
      (
        resolve
      ) => {
        setTimeout(
          resolve,
          intervalMs
        );
      }
    );
  }
}

/**
 * إلغاء Batch عند الحاجة.
 */
export async function cancelImageBatch(
  batchId: string
): Promise<
  ImageBatchStatus
> {
  if (
    !batchId ||
    !batchId.trim()
  ) {
    throw new Error(
      'Image batch ID is missing'
    );
  }

  const accessToken =
    await getAccessToken();

  const {
    controller,
    clear,
  } =
    createAbortController(
      BATCH_REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `${normalizeBackendUrl()}/upload/image-batch/${encodeURIComponent(
          batchId
        )}/cancel`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${accessToken}`,
          },

          signal:
            controller.signal,

          body:
            JSON.stringify(
              {}
            ),
        }
      );

    const result =
      await readJsonResponse<any>(
        response
      );

    if (
      !response.ok ||
      !result?.success
    ) {
      throwResponseError(
        response,
        result
      );
    }

    if (
      !result.data
    ) {
      throw new Error(
        'Backend returned an empty image batch'
      );
    }

    return normalizeBatchStatus({
      id:
        result.data.id ??
        result.data.batchId ??
        batchId,

      ...result.data,
    });
  } catch (
    error: any
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        'Cancelling the image batch took too long'
      );
    }

    if (
      error instanceof
      TypeError
    ) {
      throw new Error(
        'Could not connect to the server'
      );
    }

    throw error;
  } finally {
    clear();
  }
}

/**
 * النظام القديم يظل موجودًا كـFallback.
 */
export async function cleanImage(
  imageUri: string,
  userId: string,
  category: string
) {
  const startedAt =
    Date.now();

  if (
    !userId ||
    !userId.trim()
  ) {
    throw new Error(
      'User ID is missing'
    );
  }

  if (
    !category ||
    !category.trim()
  ) {
    throw new Error(
      'Please select an image category'
    );
  }

  const accessToken =
    await getAccessToken();

  const base64 =
    await readImageBase64(
      imageUri
    );

  console.log(
    '━━━━━━━━━━━━━━━━━━━━'
  );

  console.log(
    'Uploading image...'
  );

  console.log(
    'Category:',
    category
  );

  console.log(
    'Base64 length:',
    base64.length
  );

  const {
    controller,
    clear,
  } =
    createAbortController(
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `${normalizeBackendUrl()}/upload/image`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${accessToken}`,
          },

          signal:
            controller.signal,

          body:
            JSON.stringify({
              imageBase64:
                base64,

              userId,

              category:
                category.trim(),
            }),
        }
      );

    const result =
      await readJsonResponse<{
        cleanedImage?:
          string;
      }>(response);

    if (
      !response.ok ||
      !result?.success
    ) {
      throwResponseError(
        response,
        result
      );
    }

    const cleanedImage =
      result?.data
        ?.cleanedImage;

    if (
      typeof cleanedImage !==
        'string' ||
      cleanedImage.length ===
        0
    ) {
      throw new Error(
        'Backend returned an empty image'
      );
    }

    console.log(
      `Finished in ${(
        (
          Date.now() -
          startedAt
        ) /
        1000
      ).toFixed(2)}s`
    );

    return cleanedImage;
  } catch (
    error: any
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        'Request timed out'
      );
    }

    if (
      error instanceof
      TypeError
    ) {
      throw new Error(
        'Could not connect to the server'
      );
    }

    throw error;
  } finally {
    clear();
  }
}