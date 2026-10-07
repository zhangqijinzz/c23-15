import type { Format, SubtitleProject } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
export function VersionExportModule({
  project,
  vm,
  phase,
}: {
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
  phase: string;
}) {
  const archives = project.archives ?? [];
  return (
    <section className="module version-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">04 / VERSIONS & EXPORT</span>
          <h2>版本与交付</h2>
        </div>
        <span className="saved-label">● 自动保存</span>
      </div>
      <div className="version-row">
        <div>
          <strong>本地快照</strong>
          <small>
            {project.versions.length
              ? `最近：${project.versions.at(-1)?.label}`
              : "保存当前版本以便回退"}
          </small>
        </div>
        <button
          className="secondary-button"
          onClick={() => void vm.saveVersion()}
        >
          ＋ 保存快照
        </button>
      </div>
      {project.versions.length > 0 && (
        <div className="version-list">
          {project.versions.map((version) => (
            <button
              key={version.id}
              onClick={() => void vm.restoreVersion(version.id)}
            >
              {version.label}
              <span>恢复 ↗</span>
            </button>
          ))}
        </div>
      )}
      {archives.length > 0 && (
        <div className="archive-list">
          <div className="archive-head">
            <strong>已归档的旧项目快照</strong>
            <small>只读保留，可导出，不会用于回退当前项目</small>
          </div>
          {archives.map((archive) => (
            <div key={archive.id} className="archive-group">
              <div className="archive-name" title={archive.projectName}>
                {archive.projectName}
                <span>{archive.versions.length} 个快照</span>
              </div>
              {archive.versions.map((version) => (
                <div key={version.id} className="archive-row">
                  <span>{version.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      vm.exportArchivedVersion(archive.id, version.id)
                    }
                  >
                    导出 ↓
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="export-row">
        <label>
          格式
          <select
            aria-label="导出格式"
            value={project.format}
            onChange={(e) => vm.setFormat(e.target.value as Format)}
          >
            <option value="srt">SRT</option>
            <option value="vtt">WebVTT</option>
          </select>
        </label>
        <button
          className="export-button"
          disabled={phase === "exporting"}
          onClick={() => void vm.exportFile()}
        >
          导出字幕 <span>↓</span>
        </button>
      </div>
      <p className="privacy-note">字幕文件与项目版本仅保存在当前浏览器</p>
    </section>
  );
}
