import type { JSONContent } from '@tiptap/core'

export type SourcePage = { number: number; text: string; sourceId?: string; sourceTitle?: string; sourcePage?: number }
export type BundleContext = { version: 1; folderId: string; folderName: string; capturedAt: number; sources: { id: string; title: string; path: string; pages: SourcePage[]; chapters: { title: string; sourcePages: number[] }[] }[] }
export type TemplateSample = { title: string; paragraphs: { id: string; text: string }[]; rules: string[] }
export type TemplateDefinition = { name: string; audience: string; organization: string }
export type WritingTemplate = TemplateDefinition & { id: string; layout: 'narrative' | 'structured' | 'exercise' | 'custom'; defaultSample: TemplateSample; personalSample: TemplateSample; selectedSample: 'default' | 'personal'; editCount: number; undo?: { personalSample: TemplateSample; selectedSample: 'default' | 'personal'; editCount: number } }
export type TemplateLibrary = { version: 2; revision: number; templates: WritingTemplate[] }
export type WritingTemplateSnapshot = TemplateDefinition & { version: 1; id: string; layout: WritingTemplate['layout']; libraryRevision: number; sample: TemplateSample; sampleChoice: 'default' | 'personal'; reason: string; routing?: { task: string; material: string; fit: 'direct' | 'adapted'; adaptation: string } }
export type LearningSettings = { mode: 'translation' | 'adaptive'; difficulty: 'foundation' | 'standard' | 'advanced'; style: 'clear' | 'academic' | 'derivation'; template?: 'translation-v1' | 'guided-v1' | 'guided-v2' | 'guided-v3' | 'legacy'; writingTemplate?: WritingTemplateSnapshot; regenerationFeedback?: string }
export type ReadMaterial = { id: string; documentId?: string; title: string; category: 'intro' | 'method' | 'theory' | 'application'; concepts: string[]; note: string; readAt: number }
export type LearnerProfile = { background: string; foundations: string[] }
export type Knowledge = LearnerProfile & { materials: ReadMaterial[] }
export type CourseSample = { baseVersion: string; paragraphs: { id: string; text: string }[]; rules: string[]; updatedAt: number; editCount: number; lastRequest: string }
export type CourseStylePreferences = { version: 1; revision: number; selected: 'default' | 'personal'; personal: CourseSample; undo?: { selected: 'default' | 'personal'; personal: CourseSample } }
export type WorkflowReview = { version: 1; id: string; attempt: number; chapterId: string; totalChapters: number; completedChapters: number; reviewPolicy: 'always' | 'on-anomaly'; priorDiagnoses: string[] }
export type BundleBlueprint = import('zod').infer<typeof import('../shared/bundle-blueprint.mjs').bundleBlueprintSchema>
export type Preparation = { startedAt: number; completedAt?: number; status: 'running' | 'paused' | 'partial' | 'complete'; completedIds: string[]; errors: Record<string, string>; currentErrorIds?: string[]; settings: LearningSettings; knowledge?: LearnerProfile; templateRouting?: 'pending' | 'selected'; planningId?: string; sourceContext?: BundleContext; interruption?: { code: string; chapterId: string; message: string }; workflow?: import('zod').infer<typeof import('../shared/workflow-review.mjs').workflowStateSchema> }
export type StudyStatus = 'imported' | 'studying' | 'completed'
export type TreeConcept = { label: string; description: string; chapterIds: string[] }
export type StudyTreeData = { version: 'study-tree-v1'; generatedAt: number; fingerprint: string; model: string;
  classificationVersion?: 'folder-topics-v2';
  branches: { label: string; description: string; folderId?: string | null; documentIds: string[] }[];
  documents: { documentId: string; description: string; concepts: TreeConcept[] }[] }
export type CollectionFolder = { id: string; name: string; kind?: 'folder' | 'bundle'; inTree?: boolean; parentId?: string | null }
export type Collection = { version: 1; folders: CollectionFolder[]; items: Record<string, { folderId: string | null; status: StudyStatus; inTree: boolean }>; tree?: StudyTreeData }
export type Chapter = {
  id: string; title: string; subtitle?: string; sourcePages: number[];
  content: JSONContent; status: 'empty' | 'ready';
  teachingRecord?: import('zod').infer<typeof import('../shared/teaching-plan.mjs').teachingRecordSchema>;
}
export type Version = { id: string; time: number; label: string; chapters: Chapter[] }
export type LearningDocument = {
  storageIssue?: { missing: string[]; notePath: string; sourcePath?: string | null; error?: string };
  id: string; title: string; subtitle: string; filename: string; kind: 'pdf' | 'text'; sourceWarnings?: string[];
  sourceState?: 'deferred' | 'ready'; readingPolicy?: 'manual' | 'automatic';
  entryType?: 'note'; sourceContext?: BundleContext; composition?: { version: 1; planned: boolean; plan?: BundleBlueprint };
  intent: string; createdAt: number; updatedAt: number; revision: number;
  intentSource?: 'default' | 'user';
  pages: SourcePage[]; chapters: Chapter[]; currentChapter: string; currentPage: number;
  readingAnchor?: { chapterId: string; blockId: string; fraction: number };
  library?: { id: string; label: string; year: string; authors: string; group: string; order: number;
    placement?: { folder: CollectionFolder; inTree: boolean } };
  demo?: boolean; versions: Version[];
  preparation?: Preparation;
  formulaLayoutVersion?: number;
  mathTypesetVersion?: number;
  noteFormatVersion?: number;
  activeNotebookId?: string;
  notebookDefaultsVersion?: number;
  notebooks?: Record<string, Notebook>;
}
export type Notebook = Pick<LearningDocument, 'chapters' | 'revision' | 'updatedAt' | 'currentChapter' | 'currentPage' | 'readingAnchor' | 'versions' | 'preparation' | 'formulaLayoutVersion' | 'mathTypesetVersion' | 'noteFormatVersion'> & { id: string; label: string; createdAt: number; settings: LearningSettings }
export type StudyTreeEntry = Pick<LearningDocument, 'id' | 'title' | 'subtitle' | 'library' | 'pages' | 'chapters'> & {
  kind: 'pdf' | 'text' | 'bundle'; bundleFolderId?: string; members?: { id: string; title: string; pageCount: number }[];
}
export type ReaderStartupMode = 'manual' | 'translation' | 'adaptive'
export type ModelConfig = { baseUrl: string; model: string; configured: boolean; token: string; workspaceToken?: string; startupMode?: ReaderStartupMode; storage?: 'env'; fileStorage?: boolean; generationProgressVersion?: number }
export type SelectionContext = { from: number; to: number; text: string; anchorId: string; label: string }
export type SourcePosition = { page: number; fraction: number; quote: string; approximate: boolean; readingOffset?: number }
export type EditRequest = {
  action: 'explain' | 'rewrite' | 'generate' | 'style';
  scope: 'selection' | 'chapter' | 'document';
  instruction: string; revision: number; chapterId: string; anchorId?: string; selection?: string;
  learning?: LearningSettings; knowledge?: LearnerProfile; documentId?: string;
  notebookId?: string;
  bundleContext?: BundleContext; composition?: boolean; taskPlan?: BundleBlueprint; workflow?: WorkflowReview;
  document: Pick<LearningDocument, 'title' | 'intent' | 'chapters' | 'pages'>;
}
