// scan/core/ai/Postprocessor.ts
//
// Compatibility bridge to PostprocessorV2.
//
// أي ملف قديم يستورد من:
//
// './Postprocessor'
//
// سيستخدم PostprocessorV2 تلقائيًا
// بدون تعديل باقي المشروع.

export type {
  SegmentationPostprocessorInput,
  SegmentationPostprocessorV2Input
} from './PostprocessorV2';

export {
  postprocessSegmentationMask,
  postprocessSegmentationMaskV2, SegmentationPostprocessor,
  SegmentationPostprocessorV2
} from './PostprocessorV2';

export {
  default
} from './PostprocessorV2';
