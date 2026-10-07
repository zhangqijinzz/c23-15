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
describe("SubtitleMeterViewModel", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
    vm = new SubtitleMeterViewModel();
  });
  it("imports, edits, rechecks, snapshots, and exports", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("ready");
    const cue = vm.state.project!.cues[0];
    await vm.editCue(cue.id, { text: "Edited" });
    expect(vm.state.project!.cues[0].text).toBe("Edited");
    await vm.saveVersion();
    expect(vm.state.project!.versions).toHaveLength(1);
    await vm.exportFile();
    expect(vm.state.notice).toBe("字幕文件已导出");
  });
  it("keeps a recoverable error when an unsupported import is selected", async () => {
    await vm.importFile(new File(["x"], "clip.txt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("仅支持");
  });
  it("shows a parse failure as a recoverable import error", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce("not a subtitle block");
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("缺少时间码");
  });
  it("keeps editing visible immediately and reports export failures", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
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
  it("keeps the parse-count notice visible after a successful import", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.notice).toContain("已解析 1 条字幕");
  });
  it("replaces a snapshot-less project directly without asking", async () => {
    await vm.importFile(new File(["x"], "first.srt"));
    await vm.importFile(new File(["x"], "second.srt"));
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.pendingImport).toBeNull();
    expect(vm.state.project!.name).toBe("second.srt");
  });
  it("asks how to handle snapshots before replacing a project", async () => {
    await vm.importFile(new File(["x"], "first.srt"));
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "second.srt"));
    expect(vm.state.phase).toBe("confirming");
    expect(vm.state.pendingImport).toMatchObject({
      fileName: "second.srt",
      cueCount: 1,
      previousName: "first.srt",
      snapshotCount: 1,
    });
    expect(vm.state.project!.name).toBe("first.srt");
  });
  it("keeps old snapshots in the new project when confirmed with keep", async () => {
    await vm.importFile(new File(["x"], "first.srt"));
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "second.srt"));
    await vm.confirmImport("keep");
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.pendingImport).toBeNull();
    expect(vm.state.project!.name).toBe("second.srt");
    expect(vm.state.project!.versions).toHaveLength(1);
    expect(vm.state.notice).toContain("已解析 1 条字幕");
    expect(vm.state.notice).toContain("保留");
  });
  it("archives the old project's final state as an extra snapshot", async () => {
    await vm.importFile(new File(["x"], "first.srt"));
    await vm.editCue(vm.state.project!.cues[0].id, { text: "旧项目最终文本" });
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "second.srt"));
    await vm.confirmImport("archive");
    const versions = vm.state.project!.versions;
    expect(versions).toHaveLength(2);
    expect(versions.at(-1)!.label).toBe("归档 · first.srt");
    expect(versions.at(-1)!.cues[0].text).toBe("旧项目最终文本");
    expect(vm.state.notice).toContain("归档");
  });
  it("drops old snapshots only when confirmed with discard", async () => {
    await vm.importFile(new File(["x"], "first.srt"));
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "second.srt"));
    await vm.confirmImport("discard");
    expect(vm.state.project!.versions).toHaveLength(0);
    expect(vm.state.notice).toContain("丢弃");
  });
  it("keeps the old project untouched when the replacement is cancelled", async () => {
    await vm.importFile(new File(["x"], "first.srt"));
    await vm.saveVersion();
    await vm.importFile(new File(["x"], "second.srt"));
    vm.cancelImport();
    expect(vm.state.phase).toBe("ready");
    expect(vm.state.pendingImport).toBeNull();
    expect(vm.state.project!.name).toBe("first.srt");
    expect(vm.state.project!.versions).toHaveLength(1);
    expect(vm.state.notice).toContain("已取消导入");
  });
  it("keeps the old project fully intact and labeled when re-import fails", async () => {
    await vm.importFile(new File(["x"], "first.srt"));
    await vm.saveVersion();
    vi.mocked(readTextFile).mockResolvedValueOnce("not a subtitle block");
    await vm.importFile(new File(["x"], "broken.srt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.project!.name).toBe("first.srt");
    expect(vm.state.project!.versions).toHaveLength(1);
    expect(vm.state.notice).toContain("broken.srt");
    expect(vm.state.notice).toContain("first.srt");
    expect(vm.state.notice).toContain("未受影响");
  });
});
