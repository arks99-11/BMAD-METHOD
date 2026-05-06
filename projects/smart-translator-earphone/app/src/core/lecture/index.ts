/**
 * Public surface of the core/lecture module (Epic 6 view-models).
 */

export {
  LectureViewModel,
  type LectureViewModelState,
  type LectureListener,
} from './lecture-viewmodel';

export {
  exportLecture,
  type LectureExportFormat,
  type LectureExportOptions,
} from './lecture-export';
