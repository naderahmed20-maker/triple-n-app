// scan/core/ai/index.ts
//
// Triple N - EdgeSAM AI Module
//
// نقطة التصدير الرئيسية لنظام
// EdgeSAM Segmentation المحلي.
//
// استخدم هذا الملف بدل استيراد كل
// جزء من مساره الداخلي بشكل منفصل.

/* =========================================================
 * Shared types, utilities and errors
 * ======================================================= */

export * from './types';

/* =========================================================
 * Model configuration
 * ======================================================= */

export * from './modelConfig';

/* =========================================================
 * Image preprocessing
 * ======================================================= */

export * from './Preprocessor';

export * from './PromptGenerator';

/* =========================================================
 * ONNX sessions and inference
 * ======================================================= */

export * from './SegmentationSession';

/* =========================================================
 * Mask postprocessing
 * ======================================================= */

export * from './Postprocessor';

/* =========================================================
 * Legacy and shared alpha-mask utilities
 * ======================================================= */

/**
 * نستخدم Named Exports بدل export *
 * لمنع تعارض cloneAlphaMask مع النسخة
 * المصدّرة بالفعل من types.ts.
 */

export {
    alphaMaskToRgba,
    analyzeAlphaMask,
    applyMaskToRgba,
    calculateMaskConfidence,
    cleanupAlphaMask, DEFAULT_MASK_GENERATOR_CONFIG, dilateAlphaMask,
    erodeAlphaMask,
    fillAlphaMaskHoles,
    findMaskComponents,
    generateMask,
    getMaskBackend,
    getMaskDebugSummary,
    listMaskBackends, MaskGeneratorError, registerDefaultUriMaskBackend,
    registerMaskBackend,
    removeSmallMaskComponents,
    rgbaAlphaMaskBackend,
    smoothAlphaMask,
    thresholdAlphaMask,
    tryGenerateMask,
    unregisterMaskBackend,
    validateAlphaMask
} from './MaskGenerator';

export type {
    AlphaMask, GeneratedMask, GenerateMaskInput, MaskBackendResult,
    MaskCleanupConfig,
    MaskComponent,
    MaskGenerationBackend,
    MaskGenerationMode,
    MaskGeneratorConfig,
    MaskGeneratorErrorCode,
    MaskImageSource,
    MaskStatistics,
    TryGenerateMaskResult
} from './MaskGenerator';

/* =========================================================
 * Main EdgeSAM segmentation engine
 * ======================================================= */

export * from './SegmentationEngine';

/* =========================================================
 * Local segmentation and PNG export service
 * ======================================================= */

export * from './LocalSegmentationService';

