import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import {
  emptyState,
  type ArchivedProject,
  type Format,
  type MeterState,
  type PendingImport,
  type SubtitleCue,
  type SubtitleProject,
} from "../models";
import { detectFormat, parseSubtitles } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import { downloadSubtitles } from "../services/exportService";
import { readTextFile } from "../services/fileService";

export type SnapshotPolicy = "keep" | "archive" | "discard";

export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<MeterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async commit(
    project: SubtitleProject,
    phase: MeterState["phase"] = "editing",
    notice?: string,
  ) {
    project.updatedAt = Date.now();
    const issues = detectIssues(project.cues);
    this.publish({
      project,
      issues,
      phase,
      notice: notice ?? this.state.notice,
    });
    try {
      await projectRepository.save(project);
    } catch {
      if (this.state.project?.updatedAt === project.updatedAt) {
        this.publish({
          phase: "error",
          notice: "本地保存失败；当前修改仍保留在页面中，请导出备份",
        });
      }
    }
  }
  async restore() {
    try {
      const project = await projectRepository.load();
      if (project) {
        project.archives ??= [];
        this.publish({
          project,
          issues: detectIssues(project.cues),
          phase: "ready",
          selectedId: project.cues[0]?.id ?? null,
          notice: "已恢复上次编辑",
        });
      }
    } catch {
      this.publish({ notice: "本地项目暂时无法读取，可继续导入字幕文件" });
    }
  }
  async importFile(file: File) {
    // 开始一次新的解析：清掉上一次的导入错误与待确认导入；
    // 但现有项目原封不动，直到新文件解析成功并由用户确认。
    this.publish({
      phase: "importing",
      notice: `正在读取并解析 ${file.name}…`,
      importError: null,
      pendingImport: null,
    });
    let pending: PendingImport;
    try {
      const format = detectFormat(file.name),
        text = await readTextFile(file),
        cues = parseSubtitles(text, format);
      pending = {
        fileName: file.name,
        format,
        cues,
        parsedAt: Date.now(),
      };
    } catch (error) {
      // 解析失败：旧项目完整保留，界面回到其正常状态；
      // 失败信息单独标注，明确当前仍在处理旧文件。
      this.publish({
        importError: {
          fileName: file.name,
          message:
            error instanceof Error
              ? error.message
              : "导入失败，请检查文件后重试",
        },
        pendingImport: null,
        phase: this.state.project ? "ready" : "empty",
        notice: "",
      });
      return;
    }
    const current = this.state.project;
    if (!current) {
      await this.applyImport(pending, []);
      return;
    }
    // 已有项目：替换前必须由用户确认旧快照如何处理。
    this.publish({
      phase: "import-confirm",
      pendingImport: pending,
      notice: "",
    });
  }
  /** 用户在替换确认面板上的选择，policy 决定旧项目快照的去向 */
  async confirmImport(policy: SnapshotPolicy) {
    const pending = this.state.pendingImport;
    if (!pending) return;
    const current = this.state.project;
    const carriedArchives = (current?.archives ?? []).slice();
    if (current && policy === "archive") {
      if (current.versions.length > 0) {
        const archive: ArchivedProject = {
          id: `archive-${current.updatedAt}-${carriedArchives.length + 1}`,
          projectName: current.name,
          format: current.format,
          archivedAt: Date.now(),
          versions: structuredClone(current.versions),
        };
        carriedArchives.push(archive);
      }
    }
    const carriedVersions =
      current && policy === "keep" ? structuredClone(current.versions) : [];
    await this.applyImport(pending, carriedVersions, carriedArchives, policy);
  }
  private async applyImport(
    pending: PendingImport,
    versions: SubtitleProject["versions"],
    archives: ArchivedProject[] = [],
    policy?: SnapshotPolicy,
  ) {
    const project: SubtitleProject = {
      id: "subtitle-meter.current.v1",
      name: pending.fileName,
      format: pending.format,
      cues: pending.cues,
      updatedAt: Date.now(),
      versions,
      archives,
    };
    const snapshotNote =
      versions.length > 0
        ? `，已保留旧项目的 ${versions.length} 个快照`
        : policy === "archive"
          ? "，旧项目快照已归档"
          : policy === "discard"
            ? "，旧项目快照未保留"
            : "";
    await this.commit(
      project,
      "ready",
      `已解析 ${pending.cues.length} 条字幕并导入${snapshotNote}`,
    );
    this.publish({
      selectedId: pending.cues[0]?.id ?? null,
      pendingImport: null,
      importError: null,
    });
  }
  /** 放弃待确认的新文件，完整回到当前项目，不覆盖任何数据 */
  cancelImport() {
    const pending = this.state.pendingImport;
    if (!pending) return;
    this.publish({
      phase: this.state.project ? "ready" : "empty",
      pendingImport: null,
      notice: `已取消导入「${pending.fileName}」，当前项目未改动`,
    });
  }
  /** 关闭解析失败提示（旧项目始终保留） */
  dismissImportError() {
    this.publish({ importError: null });
  }
  selectCue(id: string) {
    this.publish({ selectedId: id });
  }
  setZoom(zoom: number) {
    this.publish({ zoom });
  }
  async editCue(
    id: string,
    patch: Partial<Pick<SubtitleCue, "text" | "startMs" | "endMs">>,
  ) {
    if (!this.state.project) return;
    const cues = this.state.project.cues.map((cue) =>
      cue.id === id ? { ...cue, ...patch } : cue,
    );
    await this.commit({ ...this.state.project, cues }, undefined, "");
  }
  async saveVersion() {
    const project = this.state.project;
    if (!project) return;
    const versions = [
      ...project.versions,
      {
        id: `v-${Date.now()}`,
        label: `快照 ${project.versions.length + 1}`,
        savedAt: Date.now(),
        cues: structuredClone(project.cues),
      },
    ];
    await this.commit({ ...project, versions }, undefined, "已保存版本快照");
  }
  async restoreVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    await this.commit(
      { ...project, cues: structuredClone(version.cues) },
      undefined,
      `已恢复${version.label}`,
    );
  }
  /** 导出某个归档项目里的单条历史快照 */
  exportArchivedVersion(archiveId: string, versionId: string) {
    const archive = this.state.project?.archives?.find(
      (item) => item.id === archiveId,
    );
    const version = archive?.versions.find((item) => item.id === versionId);
    if (!archive || !version) return;
    formatSubtitles(version.cues, archive.format);
    downloadSubtitles(
      `${archive.projectName.replace(/\.(srt|vtt)$/i, "")}-${version.label}`,
      version.cues,
      archive.format,
    );
    this.publish({
      phase: "ready",
      notice: `已导出归档快照：${archive.projectName} / ${version.label}`,
    });
  }
  async exportFile() {
    const project = this.state.project;
    if (!project) return;
    this.publish({ phase: "exporting" });
    try {
      formatSubtitles(project.cues, project.format);
      downloadSubtitles(project.name, project.cues, project.format);
      this.publish({ phase: "ready", notice: "字幕文件已导出" });
    } catch {
      this.publish({
        phase: "error",
        notice: "导出失败，编辑内容已保留，请重试",
      });
    }
  }
  setFormat(format: Format) {
    const project = this.state.project;
    if (project) void this.commit({ ...project, format }, undefined, "");
  }
}
export const createViewModel = () => new SubtitleMeterViewModel();
