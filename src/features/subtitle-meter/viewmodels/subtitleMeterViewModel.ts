import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import {
  emptyState,
  type Format,
  type ImportSnapshotPolicy,
  type MeterState,
  type SubtitleCue,
  type SubtitleProject,
} from "../models";
import { detectFormat, parseSubtitles } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import { downloadSubtitles } from "../services/exportService";
import { readTextFile } from "../services/fileService";
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
    notice = "",
  ) {
    project.updatedAt = Date.now();
    const issues = detectIssues(project.cues);
    this.publish({ project, issues, phase, notice });
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
      if (project)
        this.publish({
          project,
          issues: detectIssues(project.cues),
          phase: "ready",
          selectedId: project.cues[0]?.id ?? null,
          notice: "已恢复上次编辑",
        });
    } catch {
      this.publish({ notice: "本地项目暂时无法读取，可继续导入字幕文件" });
    }
  }
  private pending: {
    fileName: string;
    format: Format;
    cues: SubtitleCue[];
  } | null = null;
  async importFile(file: File) {
    this.pending = null;
    this.publish({
      phase: "importing",
      notice: "正在读取并解析字幕文件…",
      pendingImport: null,
    });
    try {
      const format = detectFormat(file.name),
        text = await readTextFile(file),
        cues = parseSubtitles(text, format);
      const previous = this.state.project;
      if (previous && previous.versions.length > 0) {
        this.pending = { fileName: file.name, format, cues };
        this.publish({
          phase: "confirming",
          notice: "",
          pendingImport: {
            fileName: file.name,
            cueCount: cues.length,
            previousName: previous.name,
            snapshotCount: previous.versions.length,
          },
        });
        return;
      }
      await this.commitImported(file.name, format, cues, "discard");
    } catch (error) {
      this.pending = null;
      const current = this.state.project,
        reason =
          error instanceof Error ? error.message : "导入失败，请检查文件后重试";
      this.publish({
        phase: "error",
        pendingImport: null,
        notice: current
          ? `《${file.name}》导入失败：${reason}。当前项目《${current.name}》未受影响，可继续编辑或重新导入`
          : `《${file.name}》导入失败：${reason}`,
      });
    }
  }
  async confirmImport(policy: ImportSnapshotPolicy) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    await this.commitImported(
      pending.fileName,
      pending.format,
      pending.cues,
      policy,
    );
  }
  cancelImport() {
    if (!this.pending) return;
    this.pending = null;
    this.publish({
      phase: "ready",
      pendingImport: null,
      notice: `已取消导入，当前项目《${this.state.project?.name}》保持不变`,
    });
  }
  private async commitImported(
    fileName: string,
    format: Format,
    cues: SubtitleCue[],
    policy: ImportSnapshotPolicy,
  ) {
    const previous = this.state.project,
      snapshotCount = previous?.versions.length ?? 0;
    let versions: SubtitleProject["versions"] = [];
    if (previous && policy !== "discard") {
      versions = structuredClone(previous.versions);
      if (policy === "archive")
        versions.push({
          id: `v-${Date.now()}`,
          label: `归档 · ${previous.name}`,
          savedAt: Date.now(),
          cues: structuredClone(previous.cues),
        });
    }
    const project: SubtitleProject = {
      id: "subtitle-meter.current.v1",
      name: fileName,
      format,
      cues,
      updatedAt: Date.now(),
      versions,
    };
    const summary =
      policy === "keep"
        ? `，已保留旧项目的 ${snapshotCount} 个快照`
        : policy === "archive"
          ? `，旧项目已归档为快照（共 ${snapshotCount + 1} 个）`
          : snapshotCount > 0
            ? `，已丢弃旧项目的 ${snapshotCount} 个快照`
            : "";
    this.publish({ selectedId: cues[0].id, pendingImport: null });
    await this.commit(
      project,
      "ready",
      `已解析 ${cues.length} 条字幕${summary}`,
    );
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
    await this.commit({ ...this.state.project, cues });
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
    await this.commit({ ...project, versions });
    this.publish({ notice: "已保存版本快照" });
  }
  async restoreVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    await this.commit({ ...project, cues: structuredClone(version.cues) });
    this.publish({ notice: `已恢复${version.label}` });
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
    if (project) void this.commit({ ...project, format });
  }
}
export const createViewModel = () => new SubtitleMeterViewModel();
