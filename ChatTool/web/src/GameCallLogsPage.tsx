import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from './api'

type GameCallEntry = {
  key: string
  time: string
  level: string
  kind: 'call' | 'result' | 'error' | string
  tag: string
  command: string
  params: string
  result: string
  retCode: string
  httpStatus: string
  durationMs: string
  error: string
}

type GameCallResponse = { entries: GameCallEntry[]; updatedAt: string; contextPath?: string }

const kindText: Record<string, string> = {
  call: '调用',
  result: '回包',
  error: '异常',
}

function formatTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 19)
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 参数/返回是 JSON 字符串，展开时格式化后逐行展示，避免一行截断看不全。 */
function prettyJSON(value: string): string {
  const text = (value || '').trim()
  if (!text || text === '{}' || text === 'null') return text || '—'
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/**
 * 服务端调用日志：客服后端 → 游戏服 的接口调用与回包。
 * 客服站不直连游戏服，托管上下分由后台服务执行游戏命令，这里展示后台记录的原始命令与返回。
 */
export default function GameCallLogsPage({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<GameCallEntry[]>([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<GameCallResponse>('/api/agent/game-call-logs?limit=500')
      setEntries(Array.isArray(result.entries) ? result.entries : [])
      setUpdatedAt(result.updatedAt || '')
      setError('')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '游戏服调用日志加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => { void load() }, 5000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, load])

  // 接口按时间正序返回，页面倒序展示：最新的一次调用在最上面。
  const ordered = useMemo(() => [...entries].reverse(), [entries])
  const failedCount = useMemo(() => entries.filter((item) => item.kind === 'error').length, [entries])
  const visible = useMemo(() => (onlyFailed ? ordered.filter((item) => item.kind === 'error') : ordered), [ordered, onlyFailed])

  return <div className="ledger-overlay" role="dialog" aria-modal="true">
    <section className="ledger-page">
      <header className="ledger-header">
        <div>
          <small>GAME SERVER CALLS</small>
          <h2>服务端调用日志</h2>
          <p>客服后端 → 游戏服 的接口调用与回包（托管上下分经后台服务执行游戏命令，按 <code>cs-hosted-gold-</code> 归属过滤）；最新在最上面，参数与返回按原始内容完整显示。</p>
        </div>
        <button type="button" onClick={onClose}>返回聊天</button>
      </header>

      <div className="game-log-toolbar">
        <div className="game-log-switch">
          <button type="button" className={onlyFailed ? '' : 'active'} onClick={() => setOnlyFailed(false)}>全部 {entries.length}</button>
          <button type="button" className={onlyFailed ? 'active' : ''} onClick={() => setOnlyFailed(true)}>仅异常 {failedCount}</button>
        </div>
        <label className="game-log-auto"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} /><span />5 秒自动刷新</label>
        <span className="game-log-updated">{loading ? '正在读取…' : updatedAt ? `更新于 ${updatedAt}` : ''}</span>
        <button type="button" className="game-log-refresh" onClick={() => void load()} disabled={loading}>刷新</button>
      </div>

      {error && <div className="workspace-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      <div className="ledger-table-wrap game-log-table-wrap">
        <table className="ledger-table game-log-table">
          <thead><tr><th>时间</th><th>类型</th><th>游戏命令</th><th>调用参数</th><th>游戏服返回</th><th>ret_code</th></tr></thead>
          <tbody>
            {visible.map((item, index) => <tr key={`${item.key}-${index}`} className={item.kind === 'error' ? 'game-log-row-error' : ''}>
              <td>{formatTime(item.time)}</td>
              <td><span className={`game-log-status game-log-status-${item.kind || 'error'}`}>{kindText[item.kind] || item.kind || '—'}</span></td>
              <td>{item.command || '—'}</td>
              <td className="game-log-cell"><pre className="game-log-json">{prettyJSON(item.params)}</pre></td>
              <td className="game-log-cell">
                <pre className="game-log-json">{prettyJSON(item.result)}</pre>
                {item.error ? <span className="game-log-error">{item.error}</span> : null}
              </td>
              <td>{item.retCode || '—'}</td>
            </tr>)}
          </tbody>
        </table>
        {!loading && visible.length === 0 && <div className="ledger-empty">{onlyFailed ? '窗口内没有异常调用' : '还没有游戏服调用记录 —— 客服发起托管上下分后会立即出现在这里'}</div>}
        {loading && visible.length === 0 && <div className="ledger-loading">正在读取游戏服调用日志…</div>}
      </div>

      <footer className="ledger-footer">
        <span>显示 {visible.length} / {entries.length} 条 · 只对 admin999 开放</span>
        <span>数据来自后台游戏命令日志，重启或日志过旧的行会被滚掉</span>
      </footer>
    </section>
  </div>
}
