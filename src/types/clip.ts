export type ClipFormat = 'vertical' | 'horizontal';

export type GenerationScope = 'vertical' | 'horizontal' | 'both';

export type AnalysisMode = 'ai_full' | 'local_offline';

export type CaptionPresetId =
  | 'classico'
  | 'destaque'
  | 'faixa'
  | 'minimalista'
  | 'impacto';

export type FilenamePreset = 'head_only' | 'index_head' | 'head_format';

export type VerticalFraming = 'crop' | 'fit';

export type HeadAlignment = 'left' | 'center' | 'right';

export interface HeadStyleConfig {
  align: HeadAlignment;
  fontSize: number; // 16..38 base editor size
  textColor: string; // hex e.g. '#FFFFFF'
  hasBackground: boolean;
  backgroundColor: string; // hex e.g. '#090D16'
}

export interface CaptionSegment {
  id: string;
  start: number; // seconds in source video
  end: number;   // seconds in source video
  text: string;
}

export interface ClipItem {
  id: string;
  index: number;
  head: string;
  reason: string;
  score: number; // 0-100 relevance score
  format: ClipFormat;
  startTime: number; // seconds
  endTime: number;   // seconds
  captionPreset: CaptionPresetId;
  showHeadOverlay: boolean;
  headStyle?: HeadStyleConfig;
  verticalFraming: VerticalFraming;
  captions: CaptionSegment[];
  selected: boolean;
}

export interface AnalysisSettings {
  scope: GenerationScope;
  shortTargetSeconds: number; // 30, 60, 90, 120, 180 (até 3 min)
  longTargetMinutes: number;  // 3, 5, 10, 15
  defaultPreset: CaptionPresetId;
  verticalFraming: VerticalFraming;
  showHeadOverlay: boolean;
  analysisMode: AnalysisMode;
}

export interface VideoProject {
  projectId: string;
  fileName: string;
  mediaUrl: string;
  duration: number;
  width: number;
  height: number;
  fps?: number;
  isDemo: boolean;
  hasServerMedia: boolean;
  overallTopic: string;
  clips: ClipItem[];
}

export type RenderStatus = 'queued' | 'rendering' | 'done' | 'error';

export interface RenderJobItem {
  jobId: string;
  clipId: string;
  head: string;
  format: ClipFormat;
  outputFilename: string;
  status: RenderStatus;
  progress: number;
  fileSize?: number;
  downloadUrl?: string;
  blob?: Blob;
  error?: string;
}

export interface CaptionPresetConfig {
  id: CaptionPresetId;
  name: string;
  description: string;
  fontFamily: string;
  primaryColor: string;
  highlightColor: string;
  backgroundColor: string;
  hasBox: boolean;
  uppercase: boolean;
  position: 'bottom' | 'lower-center';
}
