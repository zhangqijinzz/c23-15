import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { readTextFile } from "../services/fileService";
import { downloadSubtitles } from "../services/exportService";
vi.mock("../services/fileService", () => ({
  readTextFile: vi.fn(
    async () => "1\n00:00:01,000 --> 00:00:03,000\nOriginal caption",
  ),
}));
vi.mock("../repositories/projectRepository", () => ({
  projectRepository: {
    save: vi.fn(async () => undefined),
    load: vi.fn(async () => null),
  },
}));
vi.mock("../services/exportService", () => ({ downloadSubtitles: vi.fn() }));

const validSrt = () => new File(["x"], "clip.srt");

describe("SubtitleMeterViewModel", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readTextFile).mockResolvedValue(
      "1\n00:00:01,000 --> 00:00:03,000\nOriginal caption",
    );
    vm = new SubtitleMeterViewModel();
  });
  it("imports, edits, rechecks, snapshots, and exports", async () => {
    await vm.importFile(validSrt());
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.notice).toContain("已解析 1 条字幕");
    const cue = vm.state.project!.cues[0];
    await vm.editCue(cue.id, { text: "Edited" });
    expect(vm.state.project!.cues[0].text).toBe("Edited");
    await vm.saveVersion();
    expect(vm.state.project!.versions).toHaveLength(1);
    await vm.exportFile();
    expect(vm.state.notice).toBe("字幕文件已导出");
  });
  it("keeps the empty state with a labelled error for an unsupported file", async () => {
    await vm.importFile(new File(["x"], "clip.txt"));
    expect(vm.state.phase).toBe("empty");
    expect(vm.state.project).toBeNull();
    expect(vm.state.importError).not.toBeNull();
    expect(vm.state.importError?.message).toContain("仅支持");
  });
  it("shows a parse failure as a recoverable import error without a project", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce("not a subtitle block");
    await vm.importFile(validSrt());
    expect(vm.state.phase).toBe("empty");
    expect(vm.state.importError?.message).toContain("缺少时间码");
  });
  it("keeps editing visible immediately and reports export failures", async () => {
    await vm.importFile(validSrt());
    const cue = vm.state.project!.cues[0];
    const saving = vm.editCue(cue.id, { text: "Immediate edit" });
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
    await saving;
    vi.mocked(downloadSubtitles).mockImplementationOnce(() => {
      throw new Error("download unavailable");
    });
    await vm.exportFile();
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("导出失败");
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
  });
  it("does not replace a project until the snapshot choice is confirmed", async () => {
    await vm.importFile(validSrt());
    await vm.saveVersion();
    const oldProject = vm.state.project!;
    vi.mocked(readTextFile).mockResolvedValueOnce(
      "1\n00:00:01,000 --> 00:00:02,000\nNew caption\n\n" +
        "2\n00:00:02,500 --> 00:00:04,000\nSecond caption",
    );
    await vm.importFile(new File(["x"], "replacement.srt"));
    // 等待确认期间：旧项目原样保留，新文件只挂在 pendingImport
    expect(vm.state.phase).toBe("import-confirm");
    expect(vm.state.project).toBe(oldProject);
    expect(vm.state.pendingImport?.fileName).toBe("replacement.srt");
    expect(vm.state.pendingImport?.cues).toHaveLength(2);
    expect(vm.state.project!.versions).toHaveLength(1);
  });
  it("carries old snapshots into the new project when 'keep' is chosen", async () => {
    await vm.importFile(validSrt());
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "replacement.srt"));
    await vm.confirmImport("keep");
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.project?.name).toBe("replacement.srt");
    expect(vm.state.project?.versions).toHaveLength(1);
    expect(vm.state.pendingImport).toBeNull();
    expect(vm.state.notice).toContain("已保留旧项目的 1 个快照");
  });
  it("archives old snapshots under the old project name when 'archive' is chosen", async () => {
    await vm.importFile(validSrt());
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "replacement.srt"));
    await vm.confirmImport("archive");
    expect(vm.state.project?.versions).toHaveLength(0);
    expect(vm.state.project?.archives).toHaveLength(1);
    expect(vm.state.project?.archives?.[0]).toMatchObject({
      projectName: "clip.srt",
    });
    expect(vm.state.project?.archives?.[0].versions).toHaveLength(1);
    expect(vm.state.notice).toContain("已归档");
  });
  it("drops old snapshots but keeps existing archives when 'discard' is chosen", async () => {
    await vm.importFile(validSrt());
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "middle.srt"));
    await vm.confirmImport("archive");
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "latest.vtt"));
    await vm.confirmImport("discard");
    expect(vm.state.project?.name).toBe("latest.vtt");
    expect(vm.state.project?.versions).toHaveLength(0);
    // middle.srt 归档时带入了最早 clip.srt 的那一组，丢弃不影响归档
    expect(vm.state.project?.archives).toHaveLength(1);
    expect(vm.state.notice).toContain("快照未保留");
  });
  it("cancels a pending replacement and leaves the current project untouched", async () => {
    await vm.importFile(validSrt());
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "replacement.srt"));
    vm.cancelImport();
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.pendingImport).toBeNull();
    expect(vm.state.project?.name).toBe("clip.srt");
    expect(vm.state.project?.versions).toHaveLength(1);
    expect(vm.state.notice).toContain("当前项目未改动");
  });
  it("fully keeps the previous project when a re-import fails to parse", async () => {
    await vm.importFile(validSrt());
    await vm.saveVersion();
    const oldProject = vm.state.project!;
    vi.mocked(readTextFile).mockResolvedValueOnce("not a subtitle block");
    await vm.importFile(new File(["x"], "broken.srt"));
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.project).toBe(oldProject);
    expect(vm.state.project?.versions).toHaveLength(1);
    expect(vm.state.pendingImport).toBeNull();
    expect(vm.state.importError?.fileName).toBe("broken.srt");
    expect(vm.state.importError?.message).toContain("缺少时间码");
    vm.dismissImportError();
    expect(vm.state.importError).toBeNull();
    expect(vm.state.project).toBe(oldProject);
  });
  it("replaces directly without confirmation when there is no previous project", async () => {
    await vm.importFile(validSrt());
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.pendingImport).toBeNull();
  });
});
