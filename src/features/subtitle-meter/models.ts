export type Format = "srt" | "vtt";
export interface SubtitleCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}
export type IssueType =
  | "overlap"
  | "too-short"
  | "too-fast"
  | "too-long"
  | "empty"
  | "invalid-time";
export interface SubtitleIssue {
  id: string;
  cueId: string;
  type: IssueType;
  severity: "info" | "warning" | "error";
  message: string;
}
export interface ProjectVersion {
  id: string;
  label: string;
  savedAt: number;
  cues: SubtitleCue[];
}
/**
 * 归档：某个项目被新文件替换时，其历史快照可以整体归档到新项目下，
 * 按原项目名分组展示，避免再导入时被静默清空。
 */
export interface ArchivedProject {
  id: string;
  projectName: string;
  format: Format;
  archivedAt: number;
  versions: ProjectVersion[];
}
export interface SubtitleProject {
  id: string;
  name: string;
  format: Format;
  cues: SubtitleCue[];
  updatedAt: number;
  versions: ProjectVersion[];
  archives?: ArchivedProject[];
}
/** 已解析完成、等待用户确认快照处理方式的新文件 */
export interface PendingImport {
  fileName: string;
  format: Format;
  cues: SubtitleCue[];
  parsedAt: number;
}
export interface ImportError {
  fileName: string;
  message: string;
}
export type Phase =
  | "empty"
  | "importing"
  | "import-confirm"
  | "ready"
  | "editing"
  | "exporting"
  | "error";
export interface MeterState {
  phase: Phase;
  project: SubtitleProject | null;
  issues: SubtitleIssue[];
  selectedId: string | null;
  notice: string;
  zoom: number;
  pendingImport: PendingImport | null;
  importError: ImportError | null;
}
export const emptyState = (): MeterState => ({
  phase: "empty",
  project: null,
  issues: [],
  selectedId: null,
  notice: "",
  zoom: 1,
  pendingImport: null,
  importError: null,
});
