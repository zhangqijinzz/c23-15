import type { ChangeEvent } from "react";
import type {
  ImportError,
  MeterState,
  PendingImport,
  SubtitleProject,
} from "../models";
import type {
  SnapshotPolicy,
  SubtitleMeterViewModel,
} from "../viewmodels/subtitleMeterViewModel";

interface ImportModuleProps {
  vm: SubtitleMeterViewModel;
  state: MeterState;
  project: SubtitleProject | null;
}

export function ImportModule({ vm, state, project }: ImportModuleProps) {
  const { phase, notice, pendingImport, importError } = state;
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void vm.importFile(file);
    event.target.value = "";
  };

  const status = getFileStatus(phase, project, importError);

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
        <strong>
          {phase === "importing"
            ? "正在解析…"
            : pendingImport
              ? "解析完成，等待确认"
              : "导入字幕文件"}
        </strong>
        <span>拖放或点击选择 · SRT / WebVTT</span>
      </label>
      <div className={`file-status ${status.tone}`}>
        <span className="status-dot" />
        {status.label}
        <span className="file-size">{status.meta}</span>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {importError && (
        <ImportErrorCard
          error={importError}
          keptProjectName={project?.name ?? null}
          onDismiss={() => vm.dismissImportError()}
        />
      )}
      {pendingImport && project && (
        <ReplaceConfirmCard pending={pendingImport} project={project} vm={vm} />
      )}
    </section>
  );
}

function getFileStatus(
  phase: MeterState["phase"],
  project: SubtitleProject | null,
  importError: ImportError | null,
): { label: string; meta: string; tone: string } {
  if (phase === "importing")
    return { label: "正在解析文件…", meta: "请稍候", tone: "pending" };
  if (importError)
    return {
      label: `导入失败：${importError.fileName}`,
      meta: project ? "当前仍是下方旧项目" : "未载入任何项目",
      tone: "error",
    };
  if (phase === "import-confirm")
    return {
      label: "等待确认替换",
      meta: "确认前不会覆盖当前项目",
      tone: "pending",
    };
  if (project)
    return { label: project.name, meta: "已保存到本机", tone: "ready" };
  return { label: "等待文件导入", meta: "UTF-8", tone: "" };
}

function ImportErrorCard({
  error,
  keptProjectName,
  onDismiss,
}: {
  error: ImportError;
  keptProjectName: string | null;
  onDismiss: () => void;
}) {
  return (
    <div className="notice-card error-card" role="alert">
      <div className="notice-card-head">
        <strong>「{error.fileName}」解析失败，未替换任何内容</strong>
        <button
          type="button"
          className="notice-close"
          aria-label="关闭错误提示"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
      <p>原因：{error.message}</p>
      {keptProjectName ? (
        <p className="kept-project-note">
          当前项目仍是「{keptProjectName}」，其字幕与历史快照均完整保留；
          请修正文件后重新导入。
        </p>
      ) : (
        <p className="kept-project-note">当前没有已载入的项目。</p>
      )}
    </div>
  );
}

function ReplaceConfirmCard({
  pending,
  project,
  vm,
}: {
  pending: PendingImport;
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
}) {
  const hasVersions = project.versions.length > 0;
  const archiveCount = project.archives?.length ?? 0;
  const choices: Array<{
    policy: SnapshotPolicy;
    title: string;
    detail: string;
    disabled?: boolean;
  }> = [
    {
      policy: "keep",
      title: "保留快照",
      detail: hasVersions
        ? `${project.versions.length} 个快照随新项目保留，可继续回退`
        : "当前没有快照，等同直接替换",
    },
    {
      policy: "archive",
      title: "归档快照",
      detail: hasVersions
        ? `快照归入「${project.name}」名下，仅可查看与导出，不再用于回退`
        : "当前没有快照，等同直接替换",
    },
    {
      policy: "discard",
      title: "丢弃快照",
      detail:
        "新项目不携带任何旧快照" +
        (archiveCount > 0 ? `；已归档的 ${archiveCount} 组快照不受影响` : ""),
    },
  ];

  return (
    <div
      className="notice-card replace-card"
      role="dialog"
      aria-label="确认替换项目"
    >
      <div className="replace-summary">
        <div>
          <span className="replace-label">
            新文件（已解析 {pending.cues.length} 条）
          </span>
          <strong>{pending.fileName}</strong>
        </div>
        <span className="replace-arrow">替换</span>
        <div>
          <span className="replace-label">
            当前项目
            {hasVersions ? ` · ${project.versions.length} 个快照` : " · 无快照"}
          </span>
          <strong>{project.name}</strong>
        </div>
      </div>
      <p className="replace-question">
        替换后，当前项目的
        {hasVersions ? `${project.versions.length} 个历史快照` : "历史快照"}
        如何处理？
      </p>
      <div className="replace-choices">
        {choices.map((choice) => (
          <button
            key={choice.policy}
            type="button"
            className="replace-choice"
            onClick={() => void vm.confirmImport(choice.policy)}
          >
            <strong>{choice.title}</strong>
            <small>{choice.detail}</small>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="replace-cancel"
        onClick={() => vm.cancelImport()}
      >
        取消，继续编辑当前项目
      </button>
    </div>
  );
}
