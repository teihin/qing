import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { agentSessionExpiredEvent, agentSessionURL, api, ApiError, jsonBody, notifyAgentSessionExpired, setAgentExpectedID, setCSRF } from './api'
import { createClientMessageID, gameAdminPlayerURL, playIncomingMessageSound, readAgentSoundPreference, writeAgentSoundPreference } from './client'
import { Avatar, EmptyState, LoadingScreen, MessageBubble, StatusDot, formatAgo, formatDateTime } from './components'
import type { Agent, Conversation, ConversationDetail, Message, ServiceChannel, TeamMember } from './types'

type Dashboard = { queued: number; active: number; myActive: number; myUnread: number; allUnread: number; onlineAgents: number; todayClosed: number }
type QuickReply = { id: number; title: string; content: string; category: string }
type PlayerMemo = { id: number; playerId: string; content: string; createdBy: number; createdByName: string; createdAt: string }
const agentIdentityStorageKey = 'chattool.agentIdentityChanged'

function announceAgentIdentity(agentID: number) {
	try {
		localStorage.setItem(agentIdentityStorageKey, JSON.stringify({ agentID, changedAt: Date.now(), nonce: Math.random() }))
	} catch {
		// 隐私模式禁用localStorage时仍由接口身份头和定时请求兜底识别账号切换。
	}
}

export default function AgentApp() {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [checking, setChecking] = useState(true)
	const [sessionNotice, setSessionNotice] = useState('')
	const agentRef = useRef<Agent | null>(null)

	useEffect(() => {
		const handleSessionExpired = (event: Event) => {
			if (!agentRef.current) return
			agentRef.current = null
			const message = (event as CustomEvent<{ message?: string }>).detail?.message
			setCSRF('')
			setAgentExpectedID()
			setAgent(null)
			setSessionNotice(message || '登录已失效，请重新登录')
		}
		window.addEventListener(agentSessionExpiredEvent, handleSessionExpired)
		return () => window.removeEventListener(agentSessionExpiredEvent, handleSessionExpired)
	}, [])

	useEffect(() => {
		const handleIdentityChange = (event: StorageEvent) => {
			if (event.key !== agentIdentityStorageKey || !event.newValue || !agentRef.current) return
			try {
				const value = JSON.parse(event.newValue) as { agentID?: number }
				if (value.agentID && value.agentID !== agentRef.current.id) {
					notifyAgentSessionExpired('当前浏览器已登录其他客服账号；多客服请使用独立浏览器配置文件、不同浏览器或不同设备')
				}
			} catch { /* ignore invalid cross-tab notification */ }
		}
		window.addEventListener('storage', handleIdentityChange)
		return () => window.removeEventListener('storage', handleIdentityChange)
	}, [])

  useEffect(() => {
    void api<{ agent: Agent; csrfToken: string }>('/api/agent/auth/me').then((result) => {
	  agentRef.current = result.agent; setAgentExpectedID(result.agent.id); setCSRF(result.csrfToken); setAgent(result.agent)
    }).catch(() => undefined).finally(() => setChecking(false))
  }, [])

  if (checking) return <LoadingScreen label="正在进入客服工作台" />
	if (!agent) return <AgentLogin notice={sessionNotice} onLogin={(value, token) => { agentRef.current = value; setSessionNotice(''); setAgentExpectedID(value.id); setCSRF(token); setAgent(value); announceAgentIdentity(value.id) }} />
	return <AgentWorkspace agent={agent} onLogout={() => { agentRef.current = null; setAgentExpectedID(); setCSRF(''); setAgent(null) }} />
}

function AgentLogin({ notice, onLogin }: { notice: string; onLogin: (agent: Agent, token: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!username || !password || loading) return
    setLoading(true); setError('')
    try {
      const result = await api<{ agent: Agent; csrfToken: string }>('/api/agent/auth/login', { method: 'POST', body: jsonBody({ username, password }) })
      onLogin(result.agent, result.csrfToken)
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : '登录失败，请稍后重试') }
    finally { setLoading(false) }
  }
  return <main className="agent-login-page">
    <section className="login-showcase"><div className="showcase-content"><span className="brand-mark brand-mark-login">8L</span><p>玩家服务中枢</p><h1>每一次回应，<br />都让服务更有温度。</h1><div className="showcase-points"><span>实时会话</span><span>智能分配</span><span>安全留痕</span></div></div></section>
    <section className="login-panel"><form className="login-card" onSubmit={submit}>
      <header><span className="mobile-login-mark">8L</span><small>客服工作台</small><h2>欢迎回来</h2><p>登录后开始处理玩家咨询</p></header>
      <label><span>客服账号</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={32} placeholder="请输入客服账号" autoFocus /></label>
      <label><span>登录密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" maxLength={72} placeholder="请输入登录密码" /></label>
	  {(error || notice) && <div className="form-error">{error || notice}</div>}
      <button type="submit" disabled={loading || !username || !password}>{loading ? '登录中…' : '登录工作台'}</button>
      <footer>账号由客服主管统一创建。如无法登录，请联系管理员。</footer>
    </form></section>
  </main>
}

function AgentWorkspace({ agent, onLogout }: { agent: Agent; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<Dashboard>({ queued: 0, active: 0, myActive: 0, myUnread: 0, allUnread: 0, onlineAgents: 0, todayClosed: 0 })
  const [scope, setScope] = useState<'mine' | 'queue' | 'all' | 'closed'>('mine')
  const [search, setSearch] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedID, setSelectedID] = useState('')
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [channels, setChannels] = useState<ServiceChannel[]>([{ code: agent.channelCode, displayName: agent.channelName }])
  const [presence, setPresence] = useState(agent.presence)
  const [text, setText] = useState('')
  const [internalNote, setInternalNote] = useState(false)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')
  const [showQuick, setShowQuick] = useState(false)
  const [showTeam, setShowTeam] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(readAgentSoundPreference)
  const [playerTyping, setPlayerTyping] = useState(false)
  const [previewImage, setPreviewImage] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [memoRevision, setMemoRevision] = useState(0)
  const listEnd = useRef<HTMLDivElement>(null)
  const typingIdleTimer = useRef<number | undefined>(undefined)
  const typingHeartbeatTimer = useRef<number | undefined>(undefined)
  const typingActive = useRef(false)
  const typingConversationID = useRef('')
  const playerTypingExpiry = useRef<number | undefined>(undefined)
  const conversationLoadSerial = useRef(0)
  const selectedLoadSerial = useRef(0)
  const lastSoundMessageID = useRef('')

  const loadDashboard = useCallback(async () => setDashboard(await api<Dashboard>('/api/agent/dashboard')), [])
  const loadConversations = useCallback(async () => {
    const serial = ++conversationLoadSerial.current
    const params = new URLSearchParams({ scope })
    if (search.trim()) params.set('search', search.trim())
    const result = await api<{ items: Conversation[] }>(`/api/agent/conversations?${params}`)
    if (serial === conversationLoadSerial.current) setConversations(Array.isArray(result.items) ? result.items : [])
  }, [scope, search])
  const loadTeam = useCallback(async () => {
    const result = await api<{ items: TeamMember[]; channels?: ServiceChannel[] }>(agent.role === 'supervisor' ? '/api/agent/team' : '/api/agent/team/options')
    setTeam(Array.isArray(result.items) ? result.items : [])
    if (Array.isArray(result.channels) && result.channels.length > 0) setChannels(result.channels)
  }, [agent.role])

  const stopAgentTyping = useCallback(() => {
    window.clearTimeout(typingIdleTimer.current)
    window.clearInterval(typingHeartbeatTimer.current)
    typingIdleTimer.current = undefined
    typingHeartbeatTimer.current = undefined
    const conversationID = typingConversationID.current
    typingConversationID.current = ''
    if (!typingActive.current) return
    typingActive.current = false
    if (conversationID) {
      void api(`/api/agent/conversations/${conversationID}/typing`, { method: 'POST', body: jsonBody({ typing: false }) }).catch(() => undefined)
    }
  }, [])

  const startAgentTyping = useCallback((conversationID: string) => {
    if (typingActive.current && typingConversationID.current !== conversationID) stopAgentTyping()
    if (!typingActive.current) {
      typingActive.current = true
      typingConversationID.current = conversationID
      void api(`/api/agent/conversations/${conversationID}/typing`, { method: 'POST', body: jsonBody({ typing: true }) }).catch(() => undefined)
      typingHeartbeatTimer.current = window.setInterval(() => {
        void api(`/api/agent/conversations/${conversationID}/typing`, { method: 'POST', body: jsonBody({ typing: true }) }).catch(() => undefined)
      }, 1000)
    }
    window.clearTimeout(typingIdleTimer.current)
    typingIdleTimer.current = window.setTimeout(stopAgentTyping, 1200)
  }, [stopAgentTyping])

  const updatePlayerTyping = useCallback((typing: boolean) => {
    window.clearTimeout(playerTypingExpiry.current)
    playerTypingExpiry.current = undefined
    setPlayerTyping(typing)
    if (typing) {
      playerTypingExpiry.current = window.setTimeout(() => {
        playerTypingExpiry.current = undefined
        setPlayerTyping(false)
      }, 2500)
    }
  }, [])
  const loadSelected = useCallback(async (id = selectedID) => {
    if (!id) return
    const serial = ++selectedLoadSerial.current
    const nextDetail = await api<ConversationDetail>(`/api/agent/conversations/${id}`)
    if (serial !== selectedLoadSerial.current) return
    setDetail(nextDetail)
    if (nextDetail.status !== 'queued' || agent.role === 'supervisor') {
      const result = await api<{ items: Message[] }>(`/api/agent/conversations/${id}/messages`)
      if (serial !== selectedLoadSerial.current) return
      setMessages(Array.isArray(result.items) ? result.items : [])
      await api<void>(`/api/agent/conversations/${id}/read`, { method: 'POST', body: jsonBody({}) })
      await loadDashboard()
    } else if (serial === selectedLoadSerial.current) setMessages([])
  }, [agent.role, loadDashboard, selectedID])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([loadDashboard(), loadConversations(), loadTeam(), api<{ items: QuickReply[] }>('/api/agent/quick-replies').then((result) => setQuickReplies(Array.isArray(result.items) ? result.items : []))]).catch((reason) => setError(reason instanceof ApiError ? reason.message : '工作台数据加载失败'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadConversations, loadDashboard, loadTeam])

  useEffect(() => {
    if (!selectedID) return
    const timer = window.setTimeout(() => void loadSelected(selectedID).catch((reason) => setError(reason instanceof ApiError ? reason.message : '会话加载失败')), 0)
    return () => window.clearTimeout(timer)
  }, [selectedID, loadSelected])

  useEffect(() => {
    const refresh = () => { void Promise.all([loadDashboard(), loadConversations(), loadTeam(), selectedID ? loadSelected(selectedID) : Promise.resolve()]).catch(() => undefined) }
    const source = new EventSource(agentSessionURL('/api/agent/events'))
    source.addEventListener('conversation.changed', refresh)
    source.addEventListener('conversation.assigned', refresh)
    source.addEventListener('conversation.cleared', refresh)
    source.addEventListener('message.created', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { conversationId?: string; payload?: Message }
        if (soundEnabled && data.payload?.senderType === 'player' && data.payload.id && data.payload.id !== lastSoundMessageID.current) {
          lastSoundMessageID.current = data.payload.id
          void playIncomingMessageSound()
        }
        if (data.conversationId === selectedID) {
          if (data.payload?.senderType === 'player') updatePlayerTyping(false)
          void loadSelected(selectedID)
        }
      } catch { /* ignore malformed realtime event */ }
      void Promise.all([loadDashboard(), loadConversations()])
    })
	  source.addEventListener('team.changed', () => void Promise.all([loadTeam(), loadDashboard()]))
	  source.addEventListener('player.memo.changed', () => setMemoRevision((value) => value + 1))
	  source.addEventListener('session.replaced', (event) => {
		try {
		  const data = JSON.parse((event as MessageEvent).data) as { payload?: { message?: string } }
		  notifyAgentSessionExpired(data.payload?.message || '该账号已在其他设备登录，当前登录已退出')
		} catch {
		  notifyAgentSessionExpired('该账号已在其他设备登录，当前登录已退出')
		}
	  })
    source.addEventListener('typing', (event) => {
      try { const data = JSON.parse((event as MessageEvent).data) as { conversationId?: string; payload?: { actor?: string; typing?: boolean } }; if (data.conversationId === selectedID && data.payload?.actor === 'player') updatePlayerTyping(Boolean(data.payload.typing)) } catch { /* ignore */ }
    })
    const poll = window.setInterval(refresh, 20000)
    return () => { source.close(); window.clearInterval(poll) }
  }, [loadConversations, loadDashboard, loadSelected, loadTeam, selectedID, soundEnabled, updatePlayerTyping])

  useEffect(() => {
    const heartbeat = () => void api<void>('/api/agent/heartbeat', { method: 'POST', body: jsonBody({}) }).catch(() => undefined)
    heartbeat()
    const timer = window.setInterval(heartbeat, 30000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    try {
      listEnd.current?.scrollIntoView({ behavior: 'smooth' })
    } catch {
      // 部分浏览器在区域刚切换时不支持带选项滚动，不能因此卸载整个工作台。
    }
  }, [messages, playerTyping])

  useEffect(() => {
    if (detail?.status !== 'active' || internalNote) stopAgentTyping()
  }, [detail?.status, internalNote, stopAgentTyping])

  useEffect(() => () => {
    stopAgentTyping()
    window.clearTimeout(playerTypingExpiry.current)
  }, [stopAgentTyping])

  const selectConversation = (id: string) => { stopAgentTyping(); updatePlayerTyping(false); setSelectedID(id); setDetailOpen(true); setError('') }
  const changePresence = async (value: Agent['presence']) => {
    if (value !== 'online') stopAgentTyping()
    try { await api('/api/agent/presence', { method: 'POST', body: jsonBody({ presence: value }) }); setPresence(value); await Promise.all([loadDashboard(), loadConversations()]) }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : '在线状态更新失败') }
  }
  const logout = async () => { stopAgentTyping(); try { await api('/api/agent/auth/logout', { method: 'POST', body: jsonBody({}) }) } finally { onLogout() } }
  const send = async (event: FormEvent) => {
    event.preventDefault(); const content = text.trim(); if (!selectedID || !content || sending || detail?.status !== 'active') return
    stopAgentTyping()
    setSending(true); setError('')
    try {
      const item = await api<Message>(`/api/agent/conversations/${selectedID}/messages`, { method: 'POST', body: jsonBody({ text: content, clientMessageId: createClientMessageID(), internalNote }) })
      setMessages((current) => current.some((message) => message.id === item.id) ? current : [...current, item]); setText('')
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : '消息发送失败') }
    finally { setSending(false) }
  }
  const onText = (value: string) => {
    setText(value)
    if (selectedID && detail?.status === 'active' && !internalNote && value.trim()) startAgentTyping(selectedID)
    else stopAgentTyping()
  }
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !selectedID || uploading || detail?.status !== 'active') return
    stopAgentTyping()
    setUploading(true)
    try { const form = new FormData(); form.append('file', file); const item = await api<Message>(`/api/agent/conversations/${selectedID}/uploads`, { method: 'POST', body: form }); setMessages((current) => [...current, item]) }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : '文件上传失败') }
    finally { setUploading(false) }
  }
  const claim = async () => {
    if (!selectedID) return
    try { await api(`/api/agent/conversations/${selectedID}/claim`, { method: 'POST', body: jsonBody({}) }); setScope('mine'); await Promise.all([loadSelected(selectedID), loadDashboard()]) }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : '接入会话失败') }
  }
  const close = async () => {
    if (!selectedID || !confirm('确认结束这个会话吗？')) return
    const reason = prompt('请输入结束原因', '问题已处理') || '问题已处理'
    stopAgentTyping()
    try { await api(`/api/agent/conversations/${selectedID}/close`, { method: 'POST', body: jsonBody({ reason }) }); await Promise.all([loadSelected(selectedID), loadConversations(), loadDashboard()]) }
    catch (value) { setError(value instanceof ApiError ? value.message : '结束会话失败') }
  }
  const clearHistory = async () => {
    if (!selectedID || clearing || !confirm('确认永久清空本会话的全部聊天记录和媒体吗？清空后玩家端与客服端都会立即消失，且无法恢复；玩家备忘不会删除。')) return
    stopAgentTyping()
    setClearing(true); setError('')
    try {
      await api(`/api/agent/conversations/${selectedID}/messages`, { method: 'DELETE', body: jsonBody({ confirm: true }) })
      setMessages([])
      await Promise.all([loadSelected(selectedID), loadConversations(), loadDashboard()])
    } catch (value) { setError(value instanceof ApiError ? value.message : '聊天记录清空失败') }
    finally { setClearing(false) }
  }

  const filteredTabs = useMemo(() => [
    { value: 'mine', label: '我的会话', count: dashboard.myUnread },
    { value: 'queue', label: '待接入', count: dashboard.queued },
    ...(agent.role === 'supervisor' ? [{ value: 'all', label: '全部会话', count: dashboard.allUnread }] : []),
    { value: 'closed', label: '已结束', count: 0 },
  ] as { value: typeof scope; label: string; count: number }[], [agent.role, dashboard])

  return <main className="agent-shell">
    <header className="agent-topbar"><div className="agent-logo"><span className="brand-mark brand-mark-small">8L</span><div><strong>玩家服务中枢</strong><small>{agent.channelName}</small></div></div>
      <div className="topbar-metrics"><span><b>{dashboard.queued}</b> 人待接入</span><span><b>{dashboard.myActive}</b> 个接待中</span><span><b>{dashboard.onlineAgents}</b> 位客服在线</span></div>
      <div className="agent-account"><StatusDot status={presence} /><select value={presence} onChange={(event) => void changePresence(event.target.value as Agent['presence'])}><option value="online">在线接待</option><option value="away">暂时离开</option><option value="offline">停止接待</option></select><Avatar name={agent.displayName} /><div><strong>{agent.displayName}</strong><small>{agent.role === 'supervisor' ? '客服主管' : '在线客服'}</small></div><button className={`sound-toggle ${soundEnabled ? 'active' : ''}`} type="button" aria-pressed={soundEnabled} onClick={() => { const next = !soundEnabled; setSoundEnabled(next); writeAgentSoundPreference(next); if (next) void playIncomingMessageSound() }}>{soundEnabled ? '声音开' : '声音关'}</button><button type="button" onClick={() => setShowPassword(true)}>改密码</button>{agent.role === 'supervisor' && <button type="button" onClick={() => setShowTeam(true)}>团队</button>}<button className="logout-button" type="button" onClick={() => void logout()}>退出</button></div>
    </header>
    <section className={`agent-workspace ${detailOpen ? 'mobile-detail-open' : ''}`}>
      <aside className="conversation-sidebar">
        <div className="sidebar-heading"><div><h2>会话</h2><span>{conversations.length}</span></div><button type="button" onClick={() => void loadConversations()} aria-label="刷新会话">↻</button></div>
        <div className="conversation-tabs">{filteredTabs.map((tab) => <button key={tab.value} className={scope === tab.value ? 'active' : ''} onClick={() => { stopAgentTyping(); updatePlayerTyping(false); selectedLoadSerial.current += 1; setScope(tab.value); setSelectedID(''); setDetail(null); setMessages([]); setConversations([]); setDetailOpen(false) }}>{tab.label}{tab.count > 0 && <b>{tab.count}</b>}</button>)}</div>
        <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索玩家昵称或ID" /></label>
        <div className="conversation-list">{conversations.length === 0 ? <EmptyState icon="聊" title="暂无会话" text={scope === 'queue' ? '当前没有玩家等待接入' : '新的玩家咨询会显示在这里'} /> : conversations.map((item) => <ConversationCard key={item.id} item={item} selected={selectedID === item.id} onClick={() => selectConversation(item.id)} />)}</div>
      </aside>
      <section className="agent-chat-panel">
        {!detail ? <EmptyState icon="8L" title="选择一条会话开始服务" text="玩家的消息、资料和服务记录会在这里同步显示" /> : <>
          <header className="chat-header"><button className="mobile-back" onClick={() => setDetailOpen(false)} aria-label="返回会话列表">‹</button><Avatar name={detail.nickname} url={detail.avatarUrl} /><div className="chat-person"><strong>{detail.nickname}<small>ID {detail.playerId} · {detail.category}</small></strong><span><i className={detail.status === 'active' ? 'active' : ''} />{detail.status === 'active' ? '接待中' : detail.status === 'queued' ? '等待接入' : '已结束'}</span></div><div className="chat-actions">{detail.status === 'queued' && <button className="primary-small" onClick={() => void claim()}>立即接入</button>}{detail.status !== 'queued' && <button className="danger-light" disabled={clearing} onClick={() => void clearHistory()}>{clearing ? '清空中…' : '清空记录'}</button>}{detail.status === 'active' && <><button onClick={() => setShowTransfer(true)}>转接</button><button className="danger-light" onClick={() => void close()}>结束会话</button></>}</div></header>
          <div className="agent-message-list">{detail.status === 'queued' && agent.role !== 'supervisor' ? <div className="claim-prompt"><span>待</span><h3>玩家正在等待客服</h3><p>接入后可查看完整聊天记录并开始回复。</p><button onClick={() => void claim()}>接入此会话</button></div> : <>{messages.map((message) => <MessageBubble key={message.id} message={message} own={(message.senderType === 'agent' || message.senderType === 'note') && message.senderId === String(agent.id)} onImage={setPreviewImage} />)}{playerTyping && <div className="agent-typing">玩家正在输入 <i /><i /><i /></div>}<div ref={listEnd} /></>}</div>
          {error && <div className="workspace-error">{error}<button onClick={() => setError('')}>×</button></div>}
          <form className="agent-composer" onSubmit={send}>
            <div className="composer-tools"><label title="发送图片、视频或文件">＋<input type="file" accept="image/*,video/*,.pdf,.txt,.zip" onChange={upload} /></label><button type="button" onClick={() => setShowQuick((value) => !value)}>快捷回复</button><label className="note-switch"><input type="checkbox" checked={internalNote} onChange={(event) => { if (event.target.checked) stopAgentTyping(); setInternalNote(event.target.checked) }} /><span />内部备注</label><small>{uploading ? '正在上传文件…' : internalNote ? '备注仅客服可见' : 'Enter 发送，Shift+Enter 换行'}</small></div>
            {showQuick && <div className="quick-replies"><header><strong>快捷回复</strong><button type="button" onClick={() => setShowQuick(false)}>×</button></header>{quickReplies.map((item) => <button key={item.id} type="button" onClick={() => { setText(item.content); setShowQuick(false) }}><b>{item.title}</b><span>{item.content}</span></button>)}</div>}
            <textarea value={text} onChange={(event) => onText(event.target.value)} onBlur={stopAgentTyping} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} maxLength={2000} placeholder={detail.status === 'active' ? internalNote ? '输入仅客服团队可见的内部备注…' : '输入回复内容…' : '接入会话后即可回复'} disabled={detail.status !== 'active'} />
            <div className="composer-submit"><span>{text.length}/2000</span><button type="submit" disabled={!text.trim() || sending || detail.status !== 'active'}>{sending ? '发送中…' : internalNote ? '保存备注' : '发送消息'}</button></div>
          </form>
        </>}
      </section>
      <aside className="player-info-panel">{detail ? <PlayerInfo detail={detail} memoRevision={memoRevision} /> : <EmptyState icon="资" title="玩家资料" text="选择会话后显示" />}</aside>
    </section>
    {showTransfer && detail && <TransferModal team={team} currentAgentID={detail.assignedAgentId} onClose={() => setShowTransfer(false)} onSubmit={async (agentID, reason) => { await api(`/api/agent/conversations/${detail.id}/transfer`, { method: 'POST', body: jsonBody({ agentId: agentID, reason }) }); setShowTransfer(false); await Promise.all([loadSelected(detail.id), loadConversations()]) }} />}
    {showTeam && <TeamModal members={team} channels={channels} currentAgentID={agent.id} onClose={() => setShowTeam(false)} onRefresh={loadTeam} />}
    {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
    {previewImage && <div className="image-preview" role="dialog" aria-modal="true" onClick={() => setPreviewImage('')}><button type="button">×</button><img src={previewImage} alt="图片预览" /></div>}
  </main>
}

function ConversationCard({ item, selected, onClick }: { item: Conversation; selected: boolean; onClick: () => void }) {
  return <button className={`conversation-card ${selected ? 'selected' : ''}`} onClick={onClick}><span className="conversation-avatar"><Avatar name={item.nickname} url={item.avatarUrl} />{item.status === 'active' && <i />}</span><span className="conversation-copy"><span className="conversation-title"><strong>{item.nickname}</strong>{item.vip && <em>{item.vip}</em>}<time>{formatAgo(item.lastMessageAt)}</time></span><small>ID {item.playerId} · {item.category}</small><span className="conversation-preview">{item.lastMessage || '暂时没有消息'}</span></span>{item.unread > 0 && <b className="unread-badge">{item.unread > 99 ? '99+' : item.unread}</b>}{item.status === 'queued' && <b className="queue-badge">待接入</b>}</button>
}

function PlayerInfo({ detail, memoRevision }: { detail: ConversationDetail; memoRevision: number }) {
  const metadataSource = detail.metadata && typeof detail.metadata === 'object' && !Array.isArray(detail.metadata) ? detail.metadata : {}
  const metadata = Object.entries(metadataSource).slice(0, 10)
  return <div className="player-info"><header><span className="info-avatar"><Avatar name={detail.nickname} url={detail.avatarUrl} size="large" /></span><h3>{detail.nickname}</h3><p>ID {detail.playerId}</p><div>{detail.vip && <em>{detail.vip}</em>}{detail.level && <span>{detail.level}</span>}</div><a className="game-admin-link" href={gameAdminPlayerURL(detail.playerId)} target="_blank" rel="noreferrer">在游戏后台查看 / 处理</a></header><section><h4>基本资料</h4><dl><div><dt>玩家ID</dt><dd>{detail.playerId}</dd></div><div><dt>登录账号</dt><dd>{detail.loginName || '—'}</dd></div><div><dt>客户端</dt><dd>{detail.platform || '—'}</dd></div><div><dt>咨询分类</dt><dd>{detail.category}</dd></div><div><dt>接待客服</dt><dd>{detail.assignedAgent || '待分配'}</dd></div><div><dt>进入时间</dt><dd>{formatDateTime(detail.createdAt)}</dd></div></dl></section>{metadata.length > 0 && <section><h4>游戏信息</h4><dl>{metadata.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatMetadataValue(value)}</dd></div>)}</dl></section>}<PlayerMemos playerID={detail.playerId} revision={memoRevision} />{detail.satisfactionScore && <section className="satisfaction-card"><h4>服务评价</h4><strong>{'★'.repeat(detail.satisfactionScore)}{'☆'.repeat(5-detail.satisfactionScore)}</strong>{detail.satisfactionTags && <p>{detail.satisfactionTags.split(',').join(' · ')}</p>}{detail.satisfactionComment && <blockquote>{detail.satisfactionComment}</blockquote>}</section>}<footer>玩家资料由游戏客户端加密传入；游戏后台会再次校验登录状态和操作权限。</footer></div>
}

function PlayerMemos({ playerID, revision }: { playerID: string; revision: number }) {
  const [items, setItems] = useState<PlayerMemo[]>([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingID, setDeletingID] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<{ items: PlayerMemo[] }>(`/api/agent/players/${encodeURIComponent(playerID)}/memos`)
      setItems(Array.isArray(result.items) ? result.items : [])
      setError('')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '玩家备忘加载失败')
    } finally {
      setLoading(false)
    }
  }, [playerID])

  useEffect(() => { void load() }, [load, revision])
  useEffect(() => { setContent(''); setError('') }, [playerID])

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const value = content.trim()
    if (!value || saving) return
    setSaving(true)
    setError('')
    try {
      const item = await api<PlayerMemo>(`/api/agent/players/${encodeURIComponent(playerID)}/memos`, { method: 'POST', body: jsonBody({ content: value }) })
      setItems((current) => current.some((memo) => memo.id === item.id) ? current : [item, ...current])
      setContent('')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '玩家备忘新增失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: PlayerMemo) => {
    if (!confirm('确认删除这条玩家备忘吗？')) return
    setDeletingID(item.id)
    setError('')
    try {
      await api<void>(`/api/agent/players/${encodeURIComponent(playerID)}/memos/${item.id}`, { method: 'DELETE' })
      setItems((current) => current.filter((memo) => memo.id !== item.id))
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '玩家备忘删除失败')
    } finally {
      setDeletingID(0)
    }
  }

  return <section className="player-memos"><div className="memo-heading"><h4>玩家备忘</h4><span>仅客服可见</span></div><form onSubmit={add}><textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} rows={3} placeholder="记录核对结果、处理进度或后续事项…" /><div><small>{content.length}/500</small><button type="submit" disabled={!content.trim() || saving}>{saving ? '保存中…' : '新增备忘'}</button></div></form>{error && <p className="memo-error">{error}</p>}{loading ? <p className="memo-empty">正在读取备忘…</p> : items.length === 0 ? <p className="memo-empty">暂无备忘记录</p> : <div className="memo-list">{items.map((item) => <article key={item.id}><p>{item.content}</p><footer><span>{item.createdByName} · {formatDateTime(item.createdAt)}</span><button type="button" disabled={deletingID === item.id} onClick={() => void remove(item)}>{deletingID === item.id ? '删除中' : '删除'}</button></footer></article>)}</div>}</section>
}

function formatMetadataValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value !== 'object') return String(value)
  try { return JSON.stringify(value) }
  catch { return '—' }
}

function TransferModal({ team, currentAgentID, onClose, onSubmit }: { team: TeamMember[]; currentAgentID?: number; onClose: () => void; onSubmit: (id: number, reason: string) => Promise<void> }) {
  const candidates = team.filter((member) => member.enabled && member.presence === 'online' && member.id !== currentAgentID)
  const [agentID, setAgentID] = useState(candidates[0]?.id || 0); const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  return <div className="modal-backdrop"><form className="modal-card transfer-modal" onSubmit={(event) => { event.preventDefault(); if (!agentID || reason.trim().length < 2) { setError('请选择目标客服并填写转接原因'); return } setSaving(true); void onSubmit(agentID, reason.trim()).catch((value) => setError(value instanceof ApiError ? value.message : '转接失败')).finally(() => setSaving(false)) }}><header><div><small>TRANSFER</small><h3>转接会话</h3></div><button type="button" onClick={onClose}>×</button></header><label><span>目标客服</span><select value={agentID} onChange={(event) => setAgentID(Number(event.target.value))}><option value={0}>请选择客服</option>{candidates.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.presence === 'online' ? `在线，接待 ${member.activeConversations}/${member.maxConversations}` : '当前离线'}</option>)}</select></label><label><span>转接原因</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={120} placeholder="请填写转接原因，便于后续客服了解情况" /></label>{error && <div className="form-error">{error}</div>}<footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving} type="submit">{saving ? '正在转接…' : '确认转接'}</button></footer></form></div>
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setSaving(true)
    try {
      await api('/api/agent/auth/password', { method: 'POST', body: jsonBody({ currentPassword, newPassword }) })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess(true)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '密码修改失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }
  return <div className="modal-backdrop"><form className="modal-card password-modal" onSubmit={submit}><header><div><small>ACCOUNT SECURITY</small><h3>修改登录密码</h3></div><button type="button" onClick={onClose}>×</button></header>{success ? <div className="password-success"><span>✓</span><h4>密码修改成功</h4><p>其他设备上的旧登录会话已经失效，当前工作台可以继续使用。</p><button type="button" onClick={onClose}>完成</button></div> : <><div className="password-fields"><label><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={72} required /></label><label><span>新密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" maxLength={72} minLength={6} required /><small>至少6位，最长72字节</small></label><label><span>确认新密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" maxLength={72} minLength={6} required /></label></div>{error && <div className="form-error password-error">{error}</div>}<footer><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit" disabled={saving || !currentPassword || newPassword.length < 6 || !confirmPassword}>{saving ? '正在修改…' : '确认修改'}</button></footer></>}</form></div>
}

function TeamModal({ members, channels, currentAgentID, onClose, onRefresh }: { members: TeamMember[]; channels: ServiceChannel[]; currentAgentID: number; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [showCreate, setShowCreate] = useState(false); const [error, setError] = useState('')
  const update = async (member: TeamMember, values: { enabled?: boolean; channelCode?: string }) => {
    setError('')
    try {
      await api(`/api/agent/team/${member.id}`, { method: 'PUT', body: jsonBody({ displayName: member.displayName, role: member.role, channelCode: values.channelCode ?? member.channelCode, enabled: values.enabled ?? member.enabled, maxConversations: member.maxConversations }) })
      await onRefresh()
    } catch (value) { setError(value instanceof ApiError ? value.message : '更新失败') }
  }
  return <div className="modal-backdrop"><div className="modal-card team-modal"><header><div><small>TEAM MANAGEMENT</small><h3>客服团队与通道</h3></div><button type="button" onClick={onClose}>×</button></header><div className="team-summary"><span><b>{members.filter((item) => item.presence === 'online').length}</b> 在线客服</span><span><b>{members.reduce((sum, item) => sum + item.activeConversations, 0)}</b> 接待中</span><button type="button" onClick={() => setShowCreate((value) => !value)}>＋ 新建客服</button></div>{showCreate && <CreateAgentForm channels={channels} onCreated={async () => { setShowCreate(false); await onRefresh() }} onError={setError} />}{error && <div className="form-error team-error">{error}</div>}<div className="team-list">{members.map((member) => <div key={member.id}><Avatar name={member.displayName} /><span><strong>{member.displayName}<em>{member.role === 'supervisor' ? '主管' : '客服'}</em></strong><small>@{member.username} · {member.activeConversations}/{member.maxConversations} 个会话</small></span><label className="team-channel"><span>服务通道</span><select value={member.channelCode} disabled={member.id === currentAgentID} title={member.id === currentAgentID ? '当前登录主管的通道需由其他主管修改' : '修改后该客服只能处理新通道会话'} onChange={(event) => void update(member, { channelCode: event.target.value })}>{channels.map((channel) => <option key={channel.code} value={channel.code}>{channel.displayName}</option>)}</select></label><StatusDot status={member.presence} /><b>{member.presence === 'online' ? '在线' : member.presence === 'away' ? '离开' : '离线'}</b><label className="enabled-switch"><input type="checkbox" checked={member.enabled} onChange={(event) => void update(member, { enabled: event.target.checked })} /><span /></label></div>)}</div></div></div>
}

function CreateAgentForm({ channels, onCreated, onError }: { channels: ServiceChannel[]; onCreated: () => Promise<void>; onError: (value: string) => void }) {
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'agent', channelCode: channels[0]?.code || 'general', maxConversations: 8 }); const [saving, setSaving] = useState(false)
  return <form className="create-agent-form" onSubmit={(event) => { event.preventDefault(); setSaving(true); void api('/api/agent/team', { method: 'POST', body: jsonBody(form) }).then(onCreated).catch((value) => onError(value instanceof ApiError ? value.message : '创建失败')).finally(() => setSaving(false)) }}><input placeholder="客服账号" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /><input placeholder="显示名称" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /><input type="password" placeholder="初始密码（至少6位）" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={6} maxLength={72} required /><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="agent">普通客服</option><option value="supervisor">客服主管</option></select><select aria-label="服务通道" value={form.channelCode} onChange={(event) => setForm({ ...form, channelCode: event.target.value })}>{channels.map((channel) => <option key={channel.code} value={channel.code}>{channel.displayName}</option>)}</select><button disabled={saving}>{saving ? '创建中…' : '确认创建'}</button></form>
}
