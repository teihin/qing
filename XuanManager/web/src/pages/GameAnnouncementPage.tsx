import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, formatDate, LoadingBlock, PageHeader } from "../components/ui";
import type { GameAnnouncement } from "../types";

export default function GameAnnouncementPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<GameAnnouncement | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

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

  const normalized = content.trim();
  const length = Array.from(normalized).length;
  const dirty = data !== null && normalized !== data.content;
  const previewLines = useMemo(() => normalized.split(/\r?\n/).filter(Boolean), [normalized]);

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
              <div><span>CONTENT EDITOR</span><h2>公告正文</h2><p>支持多行文本，保存后按照游戏客户端原有编码写入“系统公告”。</p></div>
              <strong className={length > 4000 ? "is-over" : ""}>{length} / 4000</strong>
            </header>
            <div className="configuration-editor__body">
              <textarea rows={15} maxLength={4200} value={content} onChange={(event) => setContent(event.target.value)} disabled={!can("configuration.announcement.update")} placeholder="输入玩家进入大厅后需要看到的公告内容……" />
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
            <header><span>PLAYER PREVIEW</span><h2>玩家端预览</h2><p>模拟大厅公告阅读区域，实际字号和换行由客户端适配。</p></header>
            <div className="announcement-device">
              <div className="announcement-device__top"><i />XuanManager 游戏公告<span>大厅</span></div>
              <div className="announcement-device__paper">
                <span>系统公告</span>
                {previewLines.length > 0 ? previewLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>) : <p className="is-placeholder">暂未设置公告内容</p>}
              </div>
            </div>
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
