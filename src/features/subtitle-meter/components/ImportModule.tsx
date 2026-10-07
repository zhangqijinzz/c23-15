import type { ChangeEvent } from "react";
import type { PendingImport } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
export function ImportModule({
  vm,
  notice,
  phase,
  fileName,
  pendingImport,
}: {
  vm: SubtitleMeterViewModel;
  notice: string;
  phase: string;
  fileName?: string;
  pendingImport: PendingImport | null;
}) {
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void vm.importFile(file);
    event.target.value = "";
  };
  return (
    <section className="module import-module">
      <div className="module-head">
        <span className="module-kicker">01 / IMPORT</span>
        <span className="local-mark">● 本地处理</span>
      </div>
      <label className="dropzone">
        <input
          aria-label="导入 SRT 或 WebVTT 文件"
          type="file"
          accept=".srt,.vtt"
          onChange={onFile}
        />
        <span className="upload-icon">↑</span>
        <strong>{phase === "importing" ? "正在解析…" : "导入字幕文件"}</strong>
        <span>拖放或点击选择 · SRT / WebVTT</span>
      </label>
      <div className="file-status">
        <span className="status-dot" />
        {fileName ?? "等待文件导入"}
        <span className="file-size">{fileName ? "已保存到本机" : "UTF-8"}</span>
      </div>
      {pendingImport && (
        <div className="import-confirm" role="dialog" aria-label="确认替换项目">
          <strong>
            《{pendingImport.fileName}》已解析 {pendingImport.cueCount} 条字幕
          </strong>
          <p>
            将替换当前项目《{pendingImport.previousName}》。旧项目保存了{" "}
            {pendingImport.snapshotCount} 个历史快照，请选择处理方式：
          </p>
          <div className="import-confirm-actions">
            <button onClick={() => void vm.confirmImport("keep")}>
              保留快照
              <small>旧快照原样带入新项目</small>
            </button>
            <button onClick={() => void vm.confirmImport("archive")}>
              归档旧项目
              <small>旧项目最终内容另存为一条归档快照</small>
            </button>
            <button onClick={() => void vm.confirmImport("discard")}>
              丢弃快照
              <small>旧快照全部删除，新项目从零开始</small>
            </button>
          </div>
          <button
            className="import-confirm-cancel"
            onClick={() => vm.cancelImport()}
          >
            取消导入，保留当前项目
          </button>
        </div>
      )}
      {notice && (
        <div
          className={`notice ${phase === "error" ? "error" : ""}`}
          role="status"
        >
          {notice}
        </div>
      )}
    </section>
  );
}
