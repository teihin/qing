import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, ApiError } from './api'

type LedgerSummary = { up: number; down: number; give: number; received: number; count: number }
type LedgerItem = {
  id: string
  createdAt: string
  operationType: 'up' | 'down'
  playerId: string
  playerName: string
  ownerName: string
  groupType: 'union' | 'club'
  groupName: string
  agentName: string
  amount: number
  balance: number | null
}
type LedgerResponse = {
  date: string
  summary: LedgerSummary
  items: LedgerItem[]
  page: number
  pageSize: number
  hasMore: boolean
  scope: 'all' | 'self'
}
type AgentOption = { id: number; name: string }
type Filter = { date: string; owner: string; player: string; agentId: string }

function todayLocal(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function formatAmount(value: number): string {
  return Number(value || 0).toLocaleString('zh-CN')
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '—'
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function queryString(filter: Filter, page: number): string {
  const params = new URLSearchParams({ date: filter.date, page: String(page), pageSize: '50' })
  if (filter.owner) params.set('owner', filter.owner)
  if (filter.player.trim()) params.set('player', filter.player.trim())
  if (filter.agentId) params.set('agentId', filter.agentId)
  return params.toString()
}

export default function HostingLedgerPage({ role, onClose }: { role: string; onClose: () => void }) {
  const initialDate = useMemo(todayLocal, [])
  const [date, setDate] = useState(initialDate)
  const [owner, setOwner] = useState('')
  const [player, setPlayer] = useState('')
  const [agentId, setAgentId] = useState('')
  const [applied, setApplied] = useState<Filter>({ date: initialDate, owner: '', player: '', agentId: '' })
  const [page, setPage] = useState(1)
  const [owners, setOwners] = useState<string[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api<{ items: string[] }>(`/api/agent/hosting/ledger/owners?date=${encodeURIComponent(date)}`)
      .then((result) => { if (active) setOwners(Array.isArray(result.items) ? result.items : []) })
      .catch(() => { if (active) setOwners([]) })
    return () => { active = false }
  }, [date])

  useEffect(() => {
    let active = true
    void api<{ items: AgentOption[] }>(`/api/agent/hosting/ledger/agents?date=${encodeURIComponent(date)}`)
      .then((result) => { if (active) setAgents(Array.isArray(result.items) ? result.items : []) })
      .catch(() => { if (active) setAgents([]) })
    return () => { active = false }
  }, [date])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<LedgerResponse>(`/api/agent/hosting/ledger?${queryString(applied, page)}`)
      setData(result)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '对账记录加载失败')
    } finally {
      setLoading(false)
    }
  }, [applied, page])

  useEffect(() => { void load() }, [load])

  const apply = (event: FormEvent) => {
    event.preventDefault()
    setApplied({ date, owner, player, agentId })
    setPage(1)
  }
  const reset = () => {
    const today = todayLocal()
    setDate(today)
    setOwner('')
    setPlayer('')
    setAgentId('')
    setApplied({ date: today, owner: '', player: '', agentId: '' })
    setPage(1)
  }

  const summary = data?.summary || { up: 0, down: 0, give: 0, received: 0, count: 0 }
  const items = data?.items || []
  const scopeText = data?.scope === 'all' || (data == null && role === 'supervisor')
    ? '主管视图：显示全部客服的上下分记录'
    : '客服视图：只显示你自己的操作记录'

  return <div className="ledger-overlay" role="dialog" aria-modal="true">
    <section className="ledger-page">
      <header className="ledger-header">
        <div><small>HOSTED GOLD</small><h2>上下分对账</h2><p>{scopeText}</p></div>
        <button type="button" onClick={onClose}>返回聊天</button>
      </header>

      <div className="ledger-cards">
        <article><small>上分总额</small><strong>{formatAmount(summary.up)}</strong><span>积分</span></article>
        <article><small>下分总额</small><strong>{formatAmount(summary.down)}</strong><span>积分</span></article>
        <article className="ledger-card-muted"><small>赠送总额</small><strong>0</strong><span>暂未接入</span></article>
        <article className="ledger-card-muted"><small>被赠送总额</small><strong>0</strong><span>暂未接入</span></article>
        <article><small>操作笔数</small><strong>{formatAmount(summary.count)}</strong><span>笔</span></article>
      </div>

      <form className="ledger-filters" onSubmit={apply}>
        <label><span>日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>盟主</span><select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">全部盟主</option>{owners.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label><span>客服</span><select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">全部客服</option>{agents.map((agent) => <option key={agent.id} value={String(agent.id)}>{agent.name || `客服 ${agent.id}`}</option>)}</select></label>
        <label><span>玩家</span><input value={player} maxLength={64} placeholder="玩家ID或昵称" onChange={(event) => setPlayer(event.target.value)} /></label>
        <button type="submit">查询</button>
        <button type="button" className="ledger-reset" onClick={reset}>重置</button>
      </form>

      {error && <div className="workspace-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead><tr><th>时间</th><th>类型</th><th>玩家ID</th><th>玩家昵称</th><th>所属盟主</th><th>联盟/俱乐部</th><th>操作人</th><th>数量</th><th>余额</th></tr></thead>
          <tbody>
            {items.map((item) => <tr key={item.id}>
              <td>{formatTime(item.createdAt)}</td>
              <td><span className={`ledger-type ledger-type-${item.operationType}`}>{item.operationType === 'up' ? '上分' : '下分'}</span></td>
              <td>{item.playerId || '—'}</td>
              <td>{item.playerName || '—'}</td>
              <td>{item.ownerName || '—'}</td>
              <td>{item.groupType === 'union' ? '联盟' : '俱乐部'} · {item.groupName || '—'}</td>
              <td>{item.agentName || '—'}</td>
              <td className={`ledger-amount ledger-amount-${item.operationType}`}>{item.operationType === 'up' ? '+' : '-'}{formatAmount(item.amount)}</td>
              <td>{item.balance == null ? '—' : formatAmount(item.balance)}</td>
            </tr>)}
          </tbody>
        </table>
        {!loading && items.length === 0 && <div className="ledger-empty">当天暂无上下分记录</div>}
        {loading && <div className="ledger-loading">正在读取对账记录…</div>}
      </div>

      <footer className="ledger-footer">
        <span>{data?.date || applied.date} · 第 {page} 页</span>
        <div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" disabled={!data?.hasMore || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
      </footer>
    </section>
  </div>
}
