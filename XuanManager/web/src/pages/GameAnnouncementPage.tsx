import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, formatDate, LoadingBlock, PageHeader } from "../components/ui";
import type { GameAnnouncement } from "../types";

type AnnouncementPreviewMode = "popup" | "lobby";

const previewProfiles: Record<AnnouncementPreviewMode, { name: string; detail: string }> = {
  popup: { name: "进入大厅公告弹窗", detail: "文字区 534 × 577，字号 26，行高 36（预览按 50% 缩放）" },
  lobby: { name: "大厅公告详情页", detail: "文字区宽 600，字号 28，行高 35（预览按 39% 缩放）" },
};

export default function GameAnnouncementPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<GameAnnouncement | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState<AnnouncementPreviewMode>("popup");

  const load = useCallback(async () => {
    try {
      const result = await api<GameAnnouncement>("/api/configuration/announcement");
      setData(result);
      setContent(result.content);
    } catch (reason) {
      notify(errorMessage(reason, "游戏公告加载失败"), "error");
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const normalized = normalizeAnnouncementContent(content);
  const length = Array.from(normalized).length;
  const dirty = data !== null && normalized !== normalizeAnnouncementContent(data.content);
  const formatStats = useMemo(() => {
    if (!normalized) return { lines: 0, blankLines: 0, spaces: 0 };
    const lines = normalized.split("\n");
    return {
      lines: lines.length,
      blankLines: lines.filter((line) => line.length === 0).length,
      spaces: Array.from(normalized).filter((char) => char === " " || char === "　").length,
    };
  }, [normalized]);

  const save = async () => {
    if (length > 4000) {
      notify("公告内容不能超过 4000 个字符", "error");
      return;
    }
    if (!normalized && data?.configured && !window.confirm("确定清空当前游戏公告吗？玩家大厅将不再显示这条公告。")) return;
    setSaving(true);
    try {
      const result = await api<GameAnnouncement>("/api/configuration/announcement", {
        method: "PUT",
        ...jsonBody({ content: normalized }),
      });
      setData(result);
      setContent(result.content);
      notify(result.configured ? "游戏公告已保存并完成回读校验" : "游戏公告已清空");
    } catch (reason) {
      notify(errorMessage(reason, "游戏公告保存失败"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="GAME ANNOUNCEMENT" title="游戏公告设置" description="维护玩家进入大厅后看到的长期公告内容。" actions={
        <span className={`configuration-status ${data?.configured ? "is-enabled" : "is-empty"}`}><i />{data?.configured ? "公告已配置" : "当前未配置"}</span>
      } />
      {!data ? <section className="panel"><LoadingBlock label="正在读取游戏公告" /></section> : (
        <div className="configuration-editor-grid">
          <section className="panel configuration-editor">
            <header className="configuration-panel-title">
              <div><span>CONTENT EDITOR</span><h2>公告正文</h2><p>纯文本保真模式：换行、空行、段首缩进和连续空格会逐字保存。</p></div>
              <strong className={length > 4000 ? "is-over" : ""}>{length} / 4000</strong>
            </header>
            <div className="configuration-editor__body">
              <div className="announcement-editor-mode">
                <div><strong>编辑排版</strong><span>与右侧预览同步切换，输入时的自动换行位置保持一致。</span></div>
                <div className="announcement-preview-tabs is-editor" role="tablist" aria-label="编辑区客户端公告显示位置">
                  {(Object.keys(previewProfiles) as AnnouncementPreviewMode[]).map((mode) => <button key={mode} type="button" role="tab" aria-selected={previewMode === mode} className={previewMode === mode ? "is-active" : ""} onClick={() => setPreviewMode(mode)}>{previewProfiles[mode].name}</button>)}
                </div>
              </div>
              <div className={`announcement-editor-viewport is-${previewMode}`}>
                <div className="announcement-editor-canvas">
                  <div className="announcement-editor-canvas__meta"><span>客户端 1:1 排版编辑</span><strong>{previewProfiles[previewMode].name}</strong></div>
                  <textarea className="announcement-plain-text-editor" rows={15} maxLength={4200} value={content} onChange={(event) => setContent(event.target.value.replace(/\r\n?/g, "\n"))} disabled={!can("configuration.announcement.update")} spellCheck={false} wrap="soft" placeholder="输入玩家进入大厅后需要看到的公告内容……" />
                </div>
              </div>
              <div className="announcement-format-summary"><span>{formatStats.lines} 行</span><span>{formatStats.blankLines} 个空行</span><span>{formatStats.spaces} 个空格</span><p>建议用回车控制段落；网页富文本的颜色、粗体、表格和图片不属于当前客户端纯文本公告格式。</p></div>
              {data.duplicateRows > 0 && <div className="configuration-warning"><span>!</span><p>检测到 {data.duplicateRows + 1} 条同名配置，保存时会统一内容，避免客户端读取到不同公告。</p></div>}
              <div className="configuration-editor__actions">
                <p>{can("configuration.announcement.update") ? "保存操作会记录修改前后内容和操作者。" : "当前角色只有查看公告权限。"}</p>
                <div>
                  <Button variant="secondary" type="button" disabled={!dirty || saving} onClick={() => setContent(data.content)}>恢复已保存</Button>
                  {can("configuration.announcement.update") && <Button type="button" disabled={!dirty || saving || length > 4000} onClick={() => void save()}>{saving ? "正在保存…" : normalized ? "保存游戏公告" : "清空游戏公告"}</Button>}
                </div>
              </div>
            </div>
          </section>

          <aside className="panel announcement-preview-panel">
            <header><span>CLIENT LAYOUT PREVIEW</span><h2>客户端等比例预览</h2><p>使用客户端实际文字宽度、字号和行高比例；切换查看两个显示位置。</p></header>
            <div className="announcement-preview-tabs" role="tablist" aria-label="客户端公告显示位置">
              {(Object.keys(previewProfiles) as AnnouncementPreviewMode[]).map((mode) => <button key={mode} type="button" role="tab" aria-selected={previewMode === mode} className={previewMode === mode ? "is-active" : ""} onClick={() => setPreviewMode(mode)}>{previewProfiles[mode].name}</button>)}
            </div>
            <div className={`announcement-device is-${previewMode}`}>
              <div className="announcement-device__top"><i />{previewProfiles[previewMode].name}<span>纯文本</span></div>
              <div className="announcement-device__paper">
                <p className={normalized ? "" : "is-placeholder"}>{normalized || "暂未设置公告内容"}</p>
              </div>
            </div>
            <p className="announcement-preview-spec">{previewProfiles[previewMode].detail}</p>
            <dl className="configuration-meta">
              <div><dt>配置键</dt><dd>{data.storageKey}</dd></div>
              <div><dt>最后修改</dt><dd>{data.lastUpdatedAt ? formatDate(data.lastUpdatedAt) : "尚无后台修改记录"}</dd></div>
              <div><dt>操作者</dt><dd>{data.lastUpdatedBy || "—"}</dd></div>
            </dl>
            <div className="configuration-note"><span>i</span><p>长期公告不会立即推送跑马灯。如需马上提醒在线玩家，请使用“游戏通知发送”。</p></div>
          </aside>
        </div>
      )}
    </div>
  );
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiError ? reason.message : fallback;
}

function normalizeAnnouncementContent(value: string) {
  const lineNormalized = value.replace(/\r\n?/g, "\n");
  return lineNormalized.trim() ? lineNormalized : "";
}
