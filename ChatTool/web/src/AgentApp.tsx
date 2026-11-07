import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { agentSessionExpiredEvent, agentSessionURL, api, ApiError, jsonBody, notifyAgentSessionExpired, setAgentExpectedID, setCSRF } from './api'
import { createClientMessageID, gameAdminPlayerURL, playIncomingMessageSound, readAgentSoundPreference, writeAgentSoundPreference } from './client'
import { Avatar, EmptyState, LoadingScreen, MessageBubble, StatusDot, formatAgo, formatDateTime } from './components'
import HostingLedgerPage from './HostingLedgerPage'
import type { Agent, Conversation, ConversationDetail, Message, ServiceChannel, TeamMember } from './types'

type Dashboard = { queued: number; active: number; myActive: number; myUnread: number; allUnread: number; onlineAgents: number; todayClosed: number }
type QuickReply = { id: number; title: string; content: string; category: string }
type PlayerMemo = { id: number; playerId: string; content: string; createdBy: number; createdByName: string; createdAt: string }
type HostedPeer = { guuid: string; name: string; note?: string; avatar: string; role: string; roleName?: string }
type HostedOwner = { guuid: string; name: string; avatar: string; role: string; roleName: string; groupType: string; groupId: string; groupName: string; clubId: string; clubName: string; enabled: boolean; enabledAt: string; disabledAt: string; conversationCount: number; unread: number; lastMessageAt: string; pinned?: boolean; pinnedAt?: string }
type HostedGroup = { key: string; type: string; name: string; items: HostedOwner[]; pinned?: boolean; pinnedAt?: string }
type HostedConversation = { conversationId: string; clubId: string; clubName: string; peer: HostedPeer; lastMessage: string; lastMessageType: string; lastMessageAt: string; unread: number; canSend: boolean; hostedGuuid: string; hostedName: string; hostedRole: string; hostedRoleName?: string; remark?: string; pinned?: boolean; pinnedAt?: string }
type HostedMessage = { id: string; messageType: 'text' | 'image' | 'voice' | 'system'; text: string; senderGuuid: string; senderName: string; senderRole: string; attachment?: { url?: string; thumbnailUrl?: string; durationMs?: number } | null; createdAt: string }
type HostedBalance = { clubId: string; clubName: string; peerGuuid: string; peerName: string; clubGold: number | null }
const agentIdentityStorageKey = 'chattool.agentIdentityChanged'

/** 直聊时间格式为 “YYYY-MM-DD HH:mm:ss[.SSS]”，部分 Safari 只认 ISO 的 T 分隔。 */
function normalizeDirectTime(value: string): string {
  return /^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') : value
}

/** 托管会话排序与服务端一致：置顶在前，其次按最后一条消息时间倒序。 */
function sortHostedConversations(items: HostedConversation[]): HostedConversation[] {
  return [...items].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    if (a.pinned && b.pinned && (a.pinnedAt || '') !== (b.pinnedAt || '')) return (a.pinnedAt || '') < (b.pinnedAt || '') ? 1 : -1
    if (a.lastMessageAt !== b.lastMessageAt) return a.lastMessageAt < b.lastMessageAt ? 1 : -1
    return a.peer.name.localeCompare(b.peer.name)
  })
}

/** 一级分组（联盟/俱乐部）排序：置顶最前，其余保持服务端顺序（联盟在前）。 */
function sortHostedGroups(groups: HostedGroup[]): HostedGroup[] {
  return [...groups].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    if (a.pinned && b.pinned && (a.pinnedAt || '') !== (b.pinnedAt || '')) return (a.pinnedAt || '') < (b.pinnedAt || '') ? 1 : -1
    return 0
  })
}

/** 二级托管账号（盟主/群主）排序：置顶最前，其余保持服务端顺序。 */
function sortHostedOwners(items: HostedOwner[]): HostedOwner[] {
  return [...items].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    if (a.pinned && b.pinned && (a.pinnedAt || '') !== (b.pinnedAt || '')) return (a.pinnedAt || '') < (b.pinnedAt || '') ? 1 : -1
    return 0
  })
}

/** 备注与原名的显示口径：设了备注就显示「原名（备注）」，原名始终保留。 */
function hostedDisplayName(name: string, remark?: string): string {
  const trimmed = (remark || '').trim()
  return trimmed ? `${name}（${trimmed}）` : name
}

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
    <section className="login-showcase"><div className="showcase-content"><span className="brand-mark brand-mark-login">BY</span><p>玩家服务中枢</p><h1>每一次回应，<br />都让服务更有温度。</h1><div className="showcase-points"><span>实时会话</span><span>智能分配</span><span>安全留痕</span></div></div></section>
    <section className="login-panel"><form className="login-card" onSubmit={submit}>
      <header><span className="mobile-login-mark">BY</span><small>客服工作台</small><h2>欢迎回来</h2><p>登录后开始处理玩家咨询</p></header>
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
  const [scope, setScope] = useState<'mine' | 'queue' | 'all' | 'closed' | 'hosted'>('hosted')
  const [search, setSearch] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedID, setSelectedID] = useState('')
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [channels, setChannels] = useState<ServiceChannel[]>([{ code: agent.channelCode, displayName: agent.channelName }])
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
  const [hostedGroups, setHostedGroups] = useState<HostedGroup[]>([])
  const [hostedLoading, setHostedLoading] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [expandedOwners, setExpandedOwners] = useState<Record<string, boolean>>({})
  const [hostedConversations, setHostedConversations] = useState<Record<string, HostedConversation[]>>({})
  const [hostedSelection, setHostedSelection] = useState<{ guuid: string; conversationId: string } | null>(null)
  const [hostedMessages, setHostedMessages] = useState<HostedMessage[]>([])
  const [hostedText, setHostedText] = useState('')
  const [hostedSending, setHostedSending] = useState(false)
  const [hostedBalance, setHostedBalance] = useState<HostedBalance | null>(null)
  const [goldAction, setGoldAction] = useState<'' | 'up' | 'down'>('')
  const [showLedger, setShowLedger] = useState(false)
  const [deletingHostedOwner, setDeletingHostedOwner] = useState('')
  /** 备注弹窗：非 null 表示正在给这个会话的玩家改备注。 */
  const [remarkTarget, setRemarkTarget] = useState<HostedConversation | null>(null)
  const [remarkSaving, setRemarkSaving] = useState(false)
  const [remarkError, setRemarkError] = useState('')
  const [pinBusyID, setPinBusyID] = useState('')
  const [deleteBusyID, setDeleteBusyID] = useState('')
  const [hostedQuickOpen, setHostedQuickOpen] = useState(false)
  const [showQuickManager, setShowQuickManager] = useState(false)
  const hostedLoadSerial = useRef(0)
  const lastHostedSoundID = useRef('')
  const lastHostedSoundAt = useRef(0)
  const hostedUnreadRef = useRef(-1)
  const hostedSelectionRef = useRef<{ guuid: string; conversationId: string } | null>(null)
  const expandedOwnersRef = useRef<Record<string, boolean>>({})
  const listEnd = useRef<HTMLDivElement>(null)
  const typingIdleTimer = useRef<number | undefined>(undefined)
  const typingHeartbeatTimer = useRef<number | undefined>(undefined)
  const typingActive = useRef(false)
  const typingConversationID = useRef('')
  const playerTypingExpiry = useRef<number | undefined>(undefined)
  const conversationLoadSerial = useRef(0)
  const selectedLoadSerial = useRef(0)
  const autoClaimPending = useRef('')
  const lastSoundMessageID = useRef('')

  const loadDashboard = useCallback(async () => setDashboard(await api<Dashboard>('/api/agent/dashboard')), [])
  const loadConversations = useCallback(async () => {
    // 托管页签走独立的托管接口，不能再带 scope=hosted 请求普通客服会话。
    if (scope === 'hosted') return
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

  const loadHostedGroups = useCallback(async () => {
    setHostedLoading(true)
    try {
      const result = await api<{ items: HostedGroup[] }>('/api/agent/hosted/groups')
      const items = Array.isArray(result.items) ? result.items : []
      setHostedGroups(items)
      // SSE 之外的兜底：轮询发现未读增加时也提示一次；8 秒内已被 SSE 提示过则不重复。
      const total = items.reduce((sum, group) => sum + group.items.reduce((count, owner) => count + owner.unread, 0), 0)
      const previous = hostedUnreadRef.current
      hostedUnreadRef.current = total
      if (soundEnabled && previous >= 0 && total > previous && Date.now() - lastHostedSoundAt.current > 8000) {
        lastHostedSoundAt.current = Date.now()
        void playIncomingMessageSound()
      }
    } finally {
      setHostedLoading(false)
    }
  }, [soundEnabled])

  const loadHostedConversations = useCallback(async (guuid: string) => {
    const result = await api<{ items: HostedConversation[] }>(`/api/agent/hosted/conversations?guuid=${encodeURIComponent(guuid)}`)
    setHostedConversations((current) => ({ ...current, [guuid]: Array.isArray(result.items) ? result.items : [] }))
  }, [])

  const loadHostedMessages = useCallback(async (guuid: string, conversationID: string) => {
    const serial = ++hostedLoadSerial.current
    const result = await api<{ items: HostedMessage[] }>(`/api/agent/hosted/conversations/${conversationID}/messages?guuid=${encodeURIComponent(guuid)}`)
    if (serial === hostedLoadSerial.current) setHostedMessages(Array.isArray(result.items) ? result.items : [])
  }, [])

  const loadHostedBalance = useCallback(async (guuid: string, conversationID: string) => {
    const result = await api<HostedBalance>(`/api/agent/hosted/conversations/${conversationID}/balance?guuid=${encodeURIComponent(guuid)}`)
    setHostedBalance(result)
  }, [])

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
    let nextDetail = await api<ConversationDetail>(`/api/agent/conversations/${id}`)
    if (serial !== selectedLoadSerial.current) return
    // 点进待接入会话即自动接入，不再需要单独的「立即接入」按钮。
    if (nextDetail.status === 'queued' && autoClaimPending.current === id) {
      autoClaimPending.current = ''
      try {
        await api(`/api/agent/conversations/${id}/claim`, { method: 'POST', body: jsonBody({}) })
        if (serial !== selectedLoadSerial.current) return
        setScope('mine')
        nextDetail = await api<ConversationDetail>(`/api/agent/conversations/${id}`)
        if (serial !== selectedLoadSerial.current) return
        await loadDashboard()
      } catch (reason) {
        autoClaimPending.current = ''
        setError(reason instanceof ApiError ? reason.message : '接入会话失败')
      }
    }
    setDetail(nextDetail)
    if (nextDetail.status !== 'queued') {
      const result = await api<{ items: Message[] }>(`/api/agent/conversations/${id}/messages`)
      if (serial !== selectedLoadSerial.current) return
      setMessages(Array.isArray(result.items) ? result.items : [])
      await api<void>(`/api/agent/conversations/${id}/read`, { method: 'POST', body: jsonBody({}) })
      await loadDashboard()
    } else if (serial === selectedLoadSerial.current) setMessages([])
  }, [loadDashboard, selectedID])

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

  useEffect(() => { hostedSelectionRef.current = hostedSelection }, [hostedSelection])
  useEffect(() => { expandedOwnersRef.current = expandedOwners }, [expandedOwners])

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
	  source.addEventListener('hosted.message', (event) => {
	    try {
	      const data = JSON.parse((event as MessageEvent).data) as { conversationId?: string; payload?: { hostedGuuid?: string; messageId?: string; incoming?: boolean; preview?: string; messageType?: string } }
	      const hostedGuuid = data.payload?.hostedGuuid || ''
	      const incoming = data.payload?.incoming !== false
	      const messageID = data.payload?.messageId || ''
	      if (soundEnabled && incoming && messageID && messageID !== lastHostedSoundID.current) {
	        lastHostedSoundID.current = messageID
	        lastHostedSoundAt.current = Date.now()
	        void playIncomingMessageSound()
	      }
	      // 先用事件内容本地更新，避免等待分组重算；随后再向服务端对账。
	      const now = new Date().toISOString()
	      if (hostedGuuid) {
	        setHostedGroups((current) => current.map((group) => group.items.some((owner) => owner.guuid === hostedGuuid) ? {
	          ...group,
	          items: group.items.map((owner) => owner.guuid === hostedGuuid ? { ...owner, unread: incoming ? owner.unread + 1 : owner.unread, lastMessageAt: now } : owner),
	        } : group))
	        setHostedConversations((current) => {
	          const items = current[hostedGuuid]
	          if (!items) return current
	          let changed = false
	          const next = items.map((item) => {
	            if (item.conversationId !== data.conversationId) return item
	            changed = true
	            return {
	              ...item,
	              lastMessage: data.payload?.preview || item.lastMessage,
	              lastMessageType: data.payload?.messageType || item.lastMessageType,
	              lastMessageAt: now,
	              unread: incoming ? item.unread + 1 : item.unread,
	            }
	          })
	          if (!changed) return current
	          next.sort((a, b) => a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0)
	          return { ...current, [hostedGuuid]: next }
	        })
	      }
	      const selection = hostedSelectionRef.current
	      if (selection && hostedGuuid === selection.guuid && data.conversationId === selection.conversationId) {
	        void loadHostedMessages(selection.guuid, selection.conversationId)
	          .then(() => loadHostedGroups().catch(() => undefined))
	          .catch(() => undefined)
	        void loadHostedBalance(selection.guuid, selection.conversationId).catch(() => undefined)
	      }
	      if (hostedGuuid && expandedOwnersRef.current[hostedGuuid]) {
	        void loadHostedConversations(hostedGuuid).catch(() => undefined)
	      }
	      void loadHostedGroups().catch(() => undefined)
	    } catch { /* ignore malformed realtime event */ }
	  })
	  source.addEventListener('hosted.read', () => void loadHostedGroups().catch(() => undefined))
	  source.addEventListener('hosted.preference', (event) => {
		// 备注/置顶是全团队共享的，其他客服改完后这里要同步刷新列表与头部。
		try {
		  const data = JSON.parse((event as MessageEvent).data) as { payload?: { hostedGuuid?: string } }
		  const hostedGuuid = data.payload?.hostedGuuid || ''
		  if (hostedGuuid && expandedOwnersRef.current[hostedGuuid]) {
			void loadHostedConversations(hostedGuuid).catch(() => undefined)
		  }
		} catch { /* 忽略无效事件 */ }
		void loadHostedGroups().catch(() => undefined)
	  })
	  source.addEventListener('hosted.conversation.deleted', (event) => {
		try {
		  const data = JSON.parse((event as MessageEvent).data) as { conversationId?: string; payload?: { hostedGuuid?: string } }
		  if (hostedSelectionRef.current?.conversationId === data.conversationId) {
			setHostedSelection(null)
			setHostedMessages([])
			setHostedBalance(null)
		  }
		  const hostedGuuid = data.payload?.hostedGuuid || ''
		  if (hostedGuuid && expandedOwnersRef.current[hostedGuuid]) {
			void loadHostedConversations(hostedGuuid).catch(() => undefined)
		  }
		} catch { /* 忽略无效事件 */ }
		void loadHostedGroups().catch(() => undefined)
	  })
	  source.addEventListener('hosted.deleted', (event) => {
		try {
		  const data = JSON.parse((event as MessageEvent).data) as { hostedGuuid?: string }
		  if (hostedSelectionRef.current?.guuid === data.hostedGuuid) {
			setHostedSelection(null)
			setHostedMessages([])
			setHostedBalance(null)
		  }
		} catch { /* 忽略无效事件 */ }
		void loadHostedGroups().catch(() => undefined)
	  })
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
  }, [loadConversations, loadDashboard, loadHostedBalance, loadHostedConversations, loadHostedGroups, loadHostedMessages, loadSelected, loadTeam, selectedID, soundEnabled, updatePlayerTyping])

  useEffect(() => {
    const heartbeat = () => void api<void>('/api/agent/heartbeat', { method: 'POST', body: jsonBody({}) }).catch(() => undefined)
    heartbeat()
    const timer = window.setInterval(heartbeat, 30000)
    // 浏览器会节流后台标签页的定时器，回到工作台时立刻补一次心跳，避免刚切回来仍被判离线。
    const onVisible = () => { if (document.visibilityState === 'visible') heartbeat() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [])
  useEffect(() => {
    if (scope !== 'hosted') return
    void loadHostedGroups().catch((reason) => setError(reason instanceof ApiError ? reason.message : '托管账号加载失败'))
    const timer = window.setInterval(() => {
      void loadHostedGroups().catch(() => undefined)
      for (const guuid of Object.keys(expandedOwners)) {
        if (expandedOwners[guuid]) void loadHostedConversations(guuid).catch(() => undefined)
      }
      if (hostedSelection) {
        void loadHostedMessages(hostedSelection.guuid, hostedSelection.conversationId).catch(() => undefined)
        void loadHostedBalance(hostedSelection.guuid, hostedSelection.conversationId).catch(() => undefined)
      }
    }, 15000)
    return () => window.clearInterval(timer)
  }, [scope, loadHostedGroups, loadHostedConversations, loadHostedMessages, loadHostedBalance, hostedSelection, expandedOwners])

  // 不在托管页签时也定时对账，保证「聊天托管」红点与声音提示不依赖当前页签。
  useEffect(() => {
    if (scope === 'hosted') return
    const timer = window.setInterval(() => void loadHostedGroups().catch(() => undefined), 30000)
    return () => window.clearInterval(timer)
  }, [scope, loadHostedGroups])

  useEffect(() => {
    try {
      listEnd.current?.scrollIntoView({ behavior: 'smooth' })
    } catch {
      // 部分浏览器在区域刚切换时不支持带选项滚动，不能因此卸载整个工作台。
    }
  }, [messages, playerTyping, hostedMessages])

  useEffect(() => {
    if (detail?.status !== 'active' || internalNote) stopAgentTyping()
  }, [detail?.status, internalNote, stopAgentTyping])

  useEffect(() => () => {
    stopAgentTyping()
    window.clearTimeout(playerTypingExpiry.current)
  }, [stopAgentTyping])

  const selectConversation = (item: Conversation) => {
    // 没有玩家消息的空会话无法接入；有消息的待接入会话点开即自动接入。
    const hasMessage = item.lastMessage.trim() !== '' || item.lastMessageType !== ''
    autoClaimPending.current = item.status === 'queued' && hasMessage ? item.id : ''
    stopAgentTyping(); updatePlayerTyping(false); setDetailOpen(true); setError('')
    if (selectedID === item.id) void loadSelected(item.id).catch((reason) => setError(reason instanceof ApiError ? reason.message : '会话加载失败'))
    else setSelectedID(item.id)
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

  const toggleHostedGroup = (key: string) => setCollapsedGroups((current) => ({ ...current, [key]: !current[key] }))
  const toggleHostedOwner = (owner: HostedOwner) => {
    const willExpand = !expandedOwners[owner.guuid]
    setExpandedOwners((current) => ({ ...current, [owner.guuid]: willExpand }))
    if (willExpand && !hostedConversations[owner.guuid]) {
      void loadHostedConversations(owner.guuid).catch((reason) => setError(reason instanceof ApiError ? reason.message : '托管会话加载失败'))
    }
  }
  const selectHostedConversation = (item: HostedConversation) => {
    setHostedSelection({ guuid: item.hostedGuuid, conversationId: item.conversationId })
    setHostedText('')
    setHostedBalance(null)
    setHostedQuickOpen(false)
    void loadHostedMessages(item.hostedGuuid, item.conversationId)
      .then(() => loadHostedGroups().catch(() => undefined))
      .catch((reason) => setError(reason instanceof ApiError ? reason.message : '托管消息加载失败'))
    void loadHostedBalance(item.hostedGuuid, item.conversationId).catch(() => undefined)
  }
  const deleteHostedOwner = async (owner: HostedOwner) => {
    if (deletingHostedOwner) return
    if (!confirm(`确认永久删除「${owner.name}」的托管聊天记录？\n会同时删除该托管账号下的会话、消息和图片，且无法恢复。`)) return
    setDeletingHostedOwner(owner.guuid)
    setError('')
    try {
      await api(`/api/agent/hosted/owners/${encodeURIComponent(owner.guuid)}`, { method: 'DELETE' })
      setHostedSelection((current) => current?.guuid === owner.guuid ? null : current)
      setHostedMessages([])
      setHostedBalance(null)
      setHostedConversations((current) => {
        const next = { ...current }
        delete next[owner.guuid]
        return next
      })
      setExpandedOwners((current) => {
        const next = { ...current }
        delete next[owner.guuid]
        return next
      })
      await loadHostedGroups()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '删除托管聊天记录失败')
    } finally {
      setDeletingHostedOwner('')
    }
  }
  const loadQuickReplies = useCallback(async () => {
    const result = await api<{ items: QuickReply[] }>('/api/agent/quick-replies')
    setQuickReplies(Array.isArray(result.items) ? result.items : [])
  }, [])

  /** 备注、置顶修改后统一刷新：托管分组负责排序摘要，展开的账号要重取会话列表。 */
  const refreshHostedState = useCallback(async (guuid: string) => {
    await Promise.all([loadHostedGroups().catch(() => undefined), loadHostedConversations(guuid).catch(() => undefined)])
  }, [loadHostedConversations, loadHostedGroups])

  const saveHostedRemark = useCallback(async (target: HostedConversation, remark: string) => {
    if (remarkSaving) return
    setRemarkSaving(true)
    setRemarkError('')
    try {
      const result = await api<{ remark: string }>(`/api/agent/hosted/conversations/${target.conversationId}/remark`, {
        method: 'PUT',
        body: jsonBody({ guuid: target.hostedGuuid, remark }),
      })
      // 备注属于玩家本身：同一托管账号下的其他会话（同一玩家）也要一起更新。
      setHostedConversations((current) => {
        const next = { ...current }
        for (const key of Object.keys(next)) {
          next[key] = next[key].map((item) => item.peer.guuid === target.peer.guuid ? { ...item, remark: result.remark } : item)
        }
        return next
      })
      setRemarkTarget(null)
      void refreshHostedState(target.hostedGuuid)
    } catch (reason) {
      setRemarkError(reason instanceof ApiError ? reason.message : '备注保存失败，请稍后重试')
    } finally {
      setRemarkSaving(false)
    }
  }, [refreshHostedState, remarkSaving])

  /** 三级置顶统一入口：group（联盟/俱乐部）、owner（盟主/群主）、conversation（会话）。 */
  const toggleHostedTargetPin = useCallback(async (targetType: 'group' | 'owner' | 'conversation', targetID: string, pinned: boolean, opts?: { guuid?: string; grouped?: string }) => {
    const busyKey = `${targetType}:${targetID}`
    if (pinBusyID) return
    setPinBusyID(busyKey)
    setError('')
    const stamp = pinned ? new Date().toISOString().replace('T', ' ').slice(0, 19) : undefined
    try {
      await api('/api/agent/hosted/pin', {
        method: 'POST',
        body: jsonBody({ type: targetType, id: targetID, guuid: opts?.guuid || '', pinned }),
      })
      if (targetType === 'conversation' && opts?.guuid) {
        const guuid = opts.guuid
        // 本地先排好序，避免等接口回来时列表闪一下。
        setHostedConversations((current) => {
          const items = current[guuid]
          if (!items) return current
          return { ...current, [guuid]: sortHostedConversations(items.map((item) => item.conversationId === targetID ? { ...item, pinned, pinnedAt: stamp } : item)) }
        })
        void refreshHostedState(guuid)
      } else if (targetType === 'owner') {
        setHostedGroups((current) => current.map((group) => ({ ...group, items: sortHostedOwners(group.items.map((owner) => owner.guuid === targetID ? { ...owner, pinned, pinnedAt: stamp } : owner)) })))
        void loadHostedGroups().catch(() => undefined)
      } else {
        setHostedGroups((current) => sortHostedGroups(current.map((group) => group.key === targetID ? { ...group, pinned, pinnedAt: stamp } : group)))
        void loadHostedGroups().catch(() => undefined)
      }
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : pinned ? '置顶失败' : '取消置顶失败')
    } finally {
      setPinBusyID('')
    }
  }, [loadHostedGroups, pinBusyID, refreshHostedState])

  const toggleHostedPin = useCallback(async (target: HostedConversation, pinned: boolean) => {
    await toggleHostedTargetPin('conversation', target.conversationId, pinned, { guuid: target.hostedGuuid })
  }, [toggleHostedTargetPin])

  const deleteHostedConversation = useCallback(async (target: HostedConversation) => {
    if (deleteBusyID) return
    const name = hostedDisplayName(target.peer.name, target.remark)
    if (!confirm(`确认永久删除与「${name}」的这一条会话吗？\n会话里的文字、图片和语音会一起删除，玩家端也会消失，且无法恢复。`)) return
    setDeleteBusyID(target.conversationId)
    setError('')
    try {
      await api(`/api/agent/hosted/conversations/${target.conversationId}?guuid=${encodeURIComponent(target.hostedGuuid)}`, { method: 'DELETE' })
      setHostedSelection((current) => current?.conversationId === target.conversationId ? null : current)
      setHostedMessages([])
      setHostedBalance(null)
      setHostedConversations((current) => {
        const items = current[target.hostedGuuid]
        if (!items) return current
        return { ...current, [target.hostedGuuid]: items.filter((item) => item.conversationId !== target.conversationId) }
      })
      await loadHostedGroups().catch(() => undefined)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '删除会话失败')
    } finally {
      setDeleteBusyID('')
    }
  }, [deleteBusyID, loadHostedGroups])

  const sendHostedText = async (content: string) => {
    const value = content.trim()
    if (!hostedSelection || !value || hostedSending) return
    setHostedSending(true)
    setError('')
    try {
      const result = await api<{ message: HostedMessage }>(`/api/agent/hosted/conversations/${hostedSelection.conversationId}/messages`, {
        method: 'POST',
        body: jsonBody({ guuid: hostedSelection.guuid, text: value, clientMessageId: createClientMessageID() }),
      })
      setHostedMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message])
      if (hostedText.trim() === value) setHostedText('')
      void loadHostedConversations(hostedSelection.guuid).catch(() => undefined)
      void loadHostedGroups().catch(() => undefined)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '托管回复发送失败')
    } finally {
      setHostedSending(false)
    }
  }
  const sendHostedMessage = async (event: FormEvent) => {
    event.preventDefault()
    await sendHostedText(hostedText)
  }
  const selectedHostedOwner = useMemo(() => {
    if (!hostedSelection) return null
    for (const group of hostedGroups) {
      for (const owner of group.items) {
        if (owner.guuid === hostedSelection.guuid) return owner
      }
    }
    return null
  }, [hostedGroups, hostedSelection])
  const selectedHostedConversation = useMemo(() => {
    if (!hostedSelection) return null
    const items = hostedConversations[hostedSelection.guuid] || []
    return items.find((item) => item.conversationId === hostedSelection.conversationId) || null
  }, [hostedConversations, hostedSelection])

  const hostedUnread = useMemo(() => hostedGroups.reduce((sum, group) => sum + group.items.reduce((count, owner) => count + owner.unread, 0), 0), [hostedGroups])

  const filteredTabs = useMemo(() => [
    { value: 'hosted', label: '聊天托管', count: hostedUnread },
    { value: 'mine', label: '客服消息', count: dashboard.myUnread },
    { value: 'queue', label: '待接入', count: dashboard.queued },
    ...(agent.role === 'supervisor' ? [{ value: 'all', label: '全部会话', count: dashboard.allUnread }] : []),
    { value: 'closed', label: '已结束', count: 0 },
  ] as { value: typeof scope; label: string; count: number }[], [agent.role, dashboard, hostedUnread])

  return <main className="agent-shell">
    <header className="agent-topbar"><div className="agent-logo"><span className="brand-mark brand-mark-small">BY</span><div><strong>玩家服务中枢</strong><small>{agent.channelName}</small></div></div>
      <div className="topbar-metrics"><span><b>{dashboard.queued}</b> 人待接入</span><span><b>{dashboard.myActive}</b> 个接待中</span><span><b>{dashboard.onlineAgents}</b> 位客服在线</span></div>
      <div className="agent-account"><Avatar name={agent.displayName} /><div><strong>{agent.displayName}</strong><small>{agent.role === 'supervisor' ? '客服主管' : '在线客服'}</small></div><button className={`sound-toggle ${soundEnabled ? 'active' : ''}`} type="button" aria-pressed={soundEnabled} onClick={() => { const next = !soundEnabled; setSoundEnabled(next); writeAgentSoundPreference(next); if (next) void playIncomingMessageSound() }}>{soundEnabled ? '声音开' : '声音关'}</button><button type="button" onClick={() => setShowLedger(true)}>对账统计</button><button type="button" onClick={() => setShowPassword(true)}>改密码</button>{agent.role === 'supervisor' && <button type="button" onClick={() => setShowTeam(true)}>团队</button>}<button className="logout-button" type="button" onClick={() => void logout()}>退出</button></div>
    </header>
    <section className={`agent-workspace ${detailOpen ? 'mobile-detail-open' : ''}`}>
      <aside className="conversation-sidebar">
        <div className="sidebar-heading"><div><h2>{scope === 'hosted' ? '聊天托管' : '客服消息'}</h2><span>{scope === 'hosted' ? hostedGroups.reduce((sum, group) => sum + group.items.length, 0) : conversations.length}</span></div><button type="button" onClick={() => void (scope === 'hosted' ? loadHostedGroups() : loadConversations())} aria-label="刷新列表">↻</button></div>
        <div className="conversation-tabs">{filteredTabs.map((tab) => <button key={tab.value} className={scope === tab.value ? 'active' : ''} onClick={() => { stopAgentTyping(); updatePlayerTyping(false); selectedLoadSerial.current += 1; setScope(tab.value); setSelectedID(''); setDetail(null); setMessages([]); setConversations([]); setHostedSelection(null); setHostedMessages([]); setHostedText(''); setDetailOpen(false) }}>{tab.label}{tab.count > 0 && <b>{tab.count}</b>}</button>)}</div>
        {scope !== 'hosted' && <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索玩家昵称或ID" /></label>}
        {scope === 'hosted' ? <div className="conversation-list hosted-list">{hostedGroups.length === 0 ? <EmptyState icon="托" title="暂无托管账号" text={hostedLoading ? '正在读取托管账号…' : '群主、盟主或大盟主在游戏内开启聊天托管后会显示在这里'} /> : sortHostedGroups(hostedGroups).map((group) => {
          const collapsed = collapsedGroups[group.key] === true
          const groupUnread = group.items.reduce((sum, owner) => sum + owner.unread, 0)
          return <section className={`hosted-group ${group.pinned ? 'pinned' : ''}`} key={group.key}>
            <div className={`hosted-group-head ${group.pinned ? 'pinned' : ''}`}>
              <button type="button" className="hosted-row-main" onClick={() => toggleHostedGroup(group.key)}>
                <span className={`hosted-group-badge hosted-${group.type}`}>{group.type === 'union' ? '联盟' : '俱乐部'}</span>
                <strong>{group.name}</strong>
                <small>{group.items.length} 个托管</small>
                {groupUnread > 0 && <b className="hosted-count-badge">{groupUnread > 99 ? '99+' : groupUnread}</b>}
                <i>{collapsed ? '▸' : '▾'}</i>
              </button>
              <button type="button" className={`hosted-pin-button ${group.pinned ? 'active' : ''}`} disabled={pinBusyID === `group:${group.key}`} title={group.pinned ? '取消置顶该俱乐部/联盟' : '置顶该俱乐部/联盟'} aria-pressed={group.pinned} onClick={() => void toggleHostedTargetPin('group', group.key, !group.pinned)}>置顶</button>
            </div>
            {!collapsed && sortHostedOwners(group.items).map((owner) => {
              const expanded = expandedOwners[owner.guuid] === true
              const items = hostedConversations[owner.guuid]
              return <div className={`hosted-owner ${owner.pinned ? 'pinned' : ''}`} key={owner.guuid}>
                <div className={`hosted-owner-row ${hostedSelection?.guuid === owner.guuid ? 'selected' : ''} ${owner.pinned ? 'pinned' : ''}`}>
                  <button type="button" className="hosted-row-main" onClick={() => toggleHostedOwner(owner)}>
                    <Avatar name={owner.name} url={owner.avatar} size="small" />
                    <span className="hosted-owner-copy"><strong>{owner.name}</strong><small>{owner.roleName} · {owner.groupName}</small></span>
                    {!owner.enabled && <b className="hosted-readonly-badge" title="该账号已取消托管，只能查看历史记录">已取消</b>}
                    <span className="hosted-owner-meta">{owner.conversationCount} 个会话</span>
                    {owner.unread > 0 && <b className="hosted-count-badge">{owner.unread > 99 ? '99+' : owner.unread}</b>}
                    <i>{expanded ? '▾' : '▸'}</i>
                  </button>
                  <button type="button" className={`hosted-pin-button ${owner.pinned ? 'active' : ''}`} disabled={pinBusyID === `owner:${owner.guuid}`} title={owner.pinned ? '取消置顶该托管账号' : '置顶该托管账号'} aria-pressed={owner.pinned} onClick={() => void toggleHostedTargetPin('owner', owner.guuid, !owner.pinned)}>置顶</button>
                </div>
                {expanded && (items == null ? <p className="hosted-hint">正在读取会话…</p> : items.length === 0 ? <p className="hosted-hint">暂无会话</p> : sortHostedConversations(items).map((item) => <div key={item.conversationId} className={`hosted-conversation-row ${item.unread > 0 ? 'unread' : ''} ${item.pinned ? 'pinned' : ''} ${hostedSelection?.conversationId === item.conversationId ? 'selected' : ''}`}>
                  <button type="button" className="hosted-row-main" onClick={() => selectHostedConversation(item)}>
                    <Avatar name={item.peer.name} url={item.peer.avatar} size="small" />
                    <span className="hosted-conversation-copy">
                      <span className="hosted-conversation-title">
                        <strong>{hostedDisplayName(item.peer.name, item.remark)}</strong>
                        <time>{formatAgo(normalizeDirectTime(item.lastMessageAt))}</time>
                      </span>
                      <small>{item.clubName}{item.peer.roleName ? ` · ${item.peer.roleName}` : ''}</small>
                      <span className="hosted-conversation-preview">{item.lastMessageType === 'image' ? '[图片]' : item.lastMessageType === 'voice' ? '[语音]' : (item.lastMessage || '暂无消息')}</span>
                    </span>
                    {item.unread > 0 && <b className="hosted-unread">{item.unread > 99 ? '99+' : item.unread}</b>}
                  </button>
                  <button type="button" className={`hosted-pin-button ${item.pinned ? 'active' : ''}`} disabled={pinBusyID === `conversation:${item.conversationId}`} title={item.pinned ? '取消置顶该会话' : '置顶该会话'} aria-pressed={Boolean(item.pinned)} onClick={() => void toggleHostedTargetPin('conversation', item.conversationId, !item.pinned, { guuid: item.hostedGuuid })}>置顶</button>
                </div>))}
              </div>
            })}
          </section>
        })}</div> : <div className="conversation-list">{conversations.length === 0 ? <EmptyState icon="聊" title="暂无会话" text={scope === 'queue' ? '当前没有玩家等待接入' : '新的玩家咨询会显示在这里'} /> : conversations.map((item) => <ConversationCard key={item.id} item={item} selected={selectedID === item.id} onClick={() => selectConversation(item)} />)}</div>}
      </aside>
      <section className="agent-chat-panel">
        {scope === 'hosted' ? (selectedHostedConversation ? <HostedChatPanel conversation={selectedHostedConversation} owner={selectedHostedOwner} messages={hostedMessages} text={hostedText} sending={hostedSending} error={error} balance={hostedBalance} quickReplies={quickReplies} quickOpen={hostedQuickOpen} pinBusy={pinBusyID === `conversation:${selectedHostedConversation.conversationId}`} deleteBusy={deleteBusyID === selectedHostedConversation.conversationId} onText={setHostedText} onSend={sendHostedMessage} onQuickOpen={setHostedQuickOpen} onQuickSend={(content) => { setHostedQuickOpen(false); void sendHostedText(content) }} onManageQuick={() => { setHostedQuickOpen(false); setShowQuickManager(true) }} onRemark={() => { setRemarkError(''); setRemarkTarget(selectedHostedConversation) }} onTogglePin={(pinned) => void toggleHostedPin(selectedHostedConversation, pinned)} onDelete={() => void deleteHostedConversation(selectedHostedConversation)} onDismissError={() => setError('')} onImage={setPreviewImage} onGold={setGoldAction} /> : <EmptyState icon="托" title="选择托管会话" text="左侧按联盟或俱乐部展开托管账号，选择会话后即可查看记录并代其回复" />) : !detail ? <EmptyState icon="BY" title="选择一条会话开始服务" text="玩家的消息、资料和服务记录会在这里同步显示" /> : <>
          <header className="chat-header"><button className="mobile-back" onClick={() => setDetailOpen(false)} aria-label="返回会话列表">‹</button><Avatar name={detail.nickname} url={detail.avatarUrl} /><div className="chat-person"><strong>{detail.nickname}<small>ID {detail.playerId} · {detail.category}</small></strong><span><i className={detail.status === 'active' ? 'active' : ''} />{detail.status === 'active' ? '接待中' : detail.status === 'queued' ? '等待接入' : '已结束'}</span></div><div className="chat-actions">{detail.status !== 'queued' && <button className="danger-light" disabled={clearing} onClick={() => void clearHistory()}>{clearing ? '清空中…' : '清空记录'}</button>}{detail.status === 'active' && <><button onClick={() => setShowTransfer(true)}>转接</button><button className="danger-light" onClick={() => void close()}>结束会话</button></>}</div></header>
          <div className="agent-message-list">{messages.map((message) => <MessageBubble key={message.id} message={message} own={(message.senderType === 'agent' || message.senderType === 'note') && message.senderId === String(agent.id)} peerAvatar={detail.avatarUrl} onImage={setPreviewImage} />)}{playerTyping && <div className="agent-typing">玩家正在输入 <i /><i /><i /></div>}<div ref={listEnd} /></div>
          {error && <div className="workspace-error">{error}<button onClick={() => setError('')}>×</button></div>}
          <form className="agent-composer" onSubmit={send}>
            <div className="composer-tools"><label title="发送图片、视频或文件">＋<input type="file" accept="image/*,video/*,.pdf,.txt,.zip" onChange={upload} /></label><button type="button" onClick={() => setShowQuick((value) => !value)}>快捷回复</button><label className="note-switch"><input type="checkbox" checked={internalNote} onChange={(event) => { if (event.target.checked) stopAgentTyping(); setInternalNote(event.target.checked) }} /><span />内部备注</label><small>{uploading ? '正在上传文件…' : internalNote ? '备注仅客服可见' : 'Enter 发送，Shift+Enter 换行'}</small></div>
            {showQuick && <div className="quick-replies"><header><strong>快捷回复</strong><span className="quick-reply-tip">点击填入输入框</span><button type="button" className="quick-reply-manage" onClick={() => { setShowQuick(false); setShowQuickManager(true) }}>管理话术</button><button type="button" onClick={() => setShowQuick(false)}>×</button></header>{quickReplies.map((item) => <button key={item.id} type="button" onClick={() => { setText(item.content); setShowQuick(false) }}><b>{item.title}</b><span>{item.content}</span></button>)}</div>}
            <textarea value={text} onChange={(event) => onText(event.target.value)} onBlur={stopAgentTyping} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} maxLength={2000} placeholder={detail.status === 'active' ? internalNote ? '输入仅客服团队可见的内部备注…' : '输入回复内容…' : '接入会话后即可回复'} disabled={detail.status !== 'active'} />
            <div className="composer-submit"><span>{text.length}/2000</span><button type="submit" disabled={!text.trim() || sending || detail.status !== 'active'}>{sending ? '发送中…' : internalNote ? '保存备注' : '发送消息'}</button></div>
          </form>
        </>}
      </section>
      <aside className="player-info-panel">{scope === 'hosted' ? (selectedHostedOwner ? <HostedOwnerInfo owner={selectedHostedOwner} conversation={selectedHostedConversation} canDelete={agent.role === 'supervisor'} deleting={deletingHostedOwner === selectedHostedOwner.guuid} onDelete={() => void deleteHostedOwner(selectedHostedOwner)} /> : <EmptyState icon="托" title="托管账号资料" text="选择托管账号后显示" />) : detail ? <PlayerInfo detail={detail} memoRevision={memoRevision} /> : <EmptyState icon="资" title="玩家资料" text="选择会话后显示" />}</aside>
    </section>
    {showTransfer && detail && <TransferModal team={team} currentAgentID={detail.assignedAgentId} onClose={() => setShowTransfer(false)} onSubmit={async (agentID, reason) => { await api(`/api/agent/conversations/${detail.id}/transfer`, { method: 'POST', body: jsonBody({ agentId: agentID, reason }) }); setShowTransfer(false); await Promise.all([loadSelected(detail.id), loadConversations()]) }} />}
    {goldAction && selectedHostedConversation && <HostedGoldModal conversation={selectedHostedConversation} owner={selectedHostedOwner} action={goldAction} onClose={() => setGoldAction('')} onDone={(warning) => { setGoldAction(''); if (warning) setError(warning); const selection = { guuid: selectedHostedConversation.hostedGuuid, conversationId: selectedHostedConversation.conversationId }; void loadHostedMessages(selection.guuid, selection.conversationId).catch(() => undefined); void loadHostedBalance(selection.guuid, selection.conversationId).catch(() => undefined); void loadHostedGroups().catch(() => undefined); }} />}
    {remarkTarget && <HostedRemarkModal target={remarkTarget} saving={remarkSaving} error={remarkError} onClose={() => { if (!remarkSaving) setRemarkTarget(null) }} onSubmit={(value) => void saveHostedRemark(remarkTarget, value)} />}
    {showQuickManager && <QuickReplyManager items={quickReplies} onClose={() => setShowQuickManager(false)} onChanged={() => void loadQuickReplies().catch(() => undefined)} />}
    {showLedger && <HostingLedgerPage role={agent.role} onClose={() => setShowLedger(false)} />}
    {showTeam && <TeamModal members={team} channels={channels} currentAgentID={agent.id} onClose={() => setShowTeam(false)} onRefresh={loadTeam} />}
    {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
    {previewImage && <div className="image-preview" role="dialog" aria-modal="true" onClick={() => setPreviewImage('')}><button type="button">×</button><img src={previewImage} alt="图片预览" /></div>}
  </main>
}

function ConversationCard({ item, selected, onClick }: { item: Conversation; selected: boolean; onClick: () => void }) {
  return <button className={`conversation-card ${selected ? 'selected' : ''}`} onClick={onClick}><span className="conversation-avatar"><Avatar name={item.nickname} url={item.avatarUrl} />{item.status === 'active' && <i />}</span><span className="conversation-copy"><span className="conversation-title"><strong>{item.nickname}</strong>{item.vip && <em>{item.vip}</em>}<time>{formatAgo(item.lastMessageAt)}</time></span><small>ID {item.playerId} · {item.category}</small><span className="conversation-preview">{item.lastMessage || '暂时没有消息'}</span></span>{item.unread > 0 && <b className="unread-badge">{item.unread > 99 ? '99+' : item.unread}</b>}{item.status === 'queued' && <b className="queue-badge">待接入</b>}</button>
}

function HostedChatPanel({ conversation, owner, messages, text, sending, error, balance, quickReplies, quickOpen, pinBusy, deleteBusy, onText, onSend, onQuickOpen, onQuickSend, onManageQuick, onRemark, onTogglePin, onDelete, onDismissError, onImage, onGold }: { conversation: HostedConversation; owner: HostedOwner | null; messages: HostedMessage[]; text: string; sending: boolean; error: string; balance: HostedBalance | null; quickReplies: QuickReply[]; quickOpen: boolean; pinBusy: boolean; deleteBusy: boolean; onText: (value: string) => void; onSend: (event: FormEvent) => void; onQuickOpen: (open: boolean) => void; onQuickSend: (content: string) => void; onManageQuick: () => void; onRemark: () => void; onTogglePin: (pinned: boolean) => void; onDelete: () => void; onDismissError: () => void; onImage: (src: string) => void; onGold: (action: 'up' | 'down') => void }) {
  const readOnly = owner?.enabled === false || !conversation.canSend
  const listEnd = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playingID, setPlayingID] = useState('')
  useEffect(() => {
    try { listEnd.current?.scrollIntoView({ behavior: 'smooth' }) }
    catch { /* 部分浏览器不支持带选项滚动 */ }
  }, [messages])
  useEffect(() => () => { audioRef.current?.pause() }, [])
  const toggleVoice = (message: HostedMessage) => {
    const url = message.attachment?.url || ''
    if (!url) return
    if (playingID === message.id) {
      audioRef.current?.pause()
      audioRef.current = null
      setPlayingID('')
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(url)
    audioRef.current = audio
    setPlayingID(message.id)
    const stop = () => {
      if (audioRef.current === audio) {
        audioRef.current = null
        setPlayingID('')
      }
    }
    audio.onended = stop
    audio.onerror = stop
    void audio.play().catch(stop)
  }
  const displayName = hostedDisplayName(conversation.peer.name, conversation.remark)
  return <>
    <header className="chat-header">
      <Avatar name={conversation.peer.name} url={conversation.peer.avatar} />
      <div className="chat-person">
        <strong>{displayName}{conversation.peer.roleName && <em className="chat-role">{conversation.peer.roleName}</em>}<small>{conversation.clubName}{conversation.peer.note ? ` · ${conversation.peer.note}` : ''}</small></strong>
        <span><i className="active" />托管账号：{owner?.name || conversation.hostedName}（{owner?.roleName || conversation.hostedRoleName || (conversation.hostedRole === 'union_owner' ? '大盟主' : '盟主')}）</span>
      </div>
      <div className="chat-actions">
        <button type="button" onClick={onRemark}>备注</button>
        <button type="button" disabled={pinBusy} onClick={() => onTogglePin(!conversation.pinned)}>{pinBusy ? '处理中…' : conversation.pinned ? '取消置顶' : '置顶'}</button>
        <button type="button" className="danger-light" disabled={deleteBusy} onClick={onDelete}>{deleteBusy ? '删除中…' : '删除会话'}</button>
      </div>
    </header>
    <div className="agent-message-list">{messages.length === 0 ? <p className="hosted-hint">正在读取聊天记录…</p> : <>{messages.map((message) => <HostedMessageBubble key={message.id} message={message} hostedGuuid={conversation.hostedGuuid} peerAvatar={conversation.peer.avatar} playing={playingID === message.id} onImage={onImage} onPlayVoice={toggleVoice} />)}<div ref={listEnd} /></>}</div>
    {error && <div className="workspace-error">{error}<button onClick={onDismissError}>×</button></div>}
    <form className={`agent-composer hosted-composer ${readOnly ? 'hosted-composer-readonly' : ''}`} onSubmit={onSend}>
      <div className="composer-tools">
        <button type="button" className="hosted-gold-button" disabled={readOnly} onClick={() => onGold('up')}>上分</button>
        <button type="button" className="hosted-gold-button" disabled={readOnly} onClick={() => onGold('down')}>下分</button>
        <span className="hosted-balance" title={`${balance?.peerName || conversation.peer.name} 在当前俱乐部的积分`}>积分：{balance?.clubGold != null ? balance.clubGold : '—'}</span>
        {/* 话术是团队级配置，不受单条会话只读状态限制；只读时点击会提示不能代发。 */}
        <button type="button" className="hosted-quick-toggle" onClick={() => onQuickOpen(!quickOpen)}>快捷回复</button>
        <button type="button" className="hosted-quick-manage" onClick={onManageQuick}>管理话术</button>
        <small>{readOnly ? '托管已取消，仅可查看历史记录' : `代 ${owner?.name || conversation.hostedName} 回复 ${displayName}，Enter 发送`}</small>
      </div>
      {quickOpen && <div className="quick-replies hosted-quick-replies">
        <header><strong>快捷回复</strong><span className="quick-reply-tip">{readOnly ? '该会话已不能代发，仅可查看' : '点击直接发送'}</span><button type="button" onClick={() => onQuickOpen(false)}>×</button></header>
        {quickReplies.length === 0 ? <p className="hosted-hint">还没有常用话术，点「管理话术」添加</p> : quickReplies.map((item) => <button key={item.id} type="button" disabled={readOnly || sending} title={readOnly ? '该会话已不能代发' : item.content} onClick={() => onQuickSend(item.content)}><b>{item.title}</b><span>{item.content}</span></button>)}
      </div>}
      <textarea value={text} onChange={(event) => onText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} maxLength={2000} placeholder={readOnly ? '托管已取消，不能继续回复' : '输入回复内容…'} disabled={readOnly} />
      <div className="composer-submit"><span>{text.length}/2000</span><button type="submit" disabled={readOnly || !text.trim() || sending}>{sending ? '发送中…' : '以托管账号发送'}</button></div>
    </form>
  </>
}

function HostedMessageBubble({ message, hostedGuuid, peerAvatar, playing, onImage, onPlayVoice }: { message: HostedMessage; hostedGuuid: string; peerAvatar?: string; playing: boolean; onImage: (src: string) => void; onPlayVoice: (message: HostedMessage) => void }) {
  const own = message.senderGuuid === hostedGuuid
  if (message.messageType === 'system') return <div className="system-message"><span>{message.text}</span></div>
  const imageURL = message.attachment?.url || ''
  return <div className={`message-row ${own ? 'message-own' : ''}`}>
    {!own && <Avatar name={message.senderName} url={peerAvatar} size="small" />}
    <div className="message-stack">
      <div className="message-meta">{!own && <span>{message.senderName}</span>}<time>{formatDateTime(normalizeDirectTime(message.createdAt))}</time></div>
      <div className={`message-bubble message-${message.messageType}`}>
        {message.messageType === 'text' && <p>{message.text}</p>}
        {message.messageType === 'image' && (imageURL ? <button type="button" className="hosted-image-button" onClick={() => onImage(imageURL)} title="点击放大"><img src={message.attachment?.thumbnailUrl || imageURL} alt="聊天图片" /></button> : <span className="media-loading">图片加载中…</span>)}
        {message.messageType === 'voice' && <button type="button" className={`hosted-voice ${playing ? 'playing' : ''}`} onClick={() => onPlayVoice(message)} disabled={!message.attachment?.url}><span>{playing ? '■' : '▶'}</span>{Math.max(1, Math.round((message.attachment?.durationMs || 0) / 1000))}″</button>}
      </div>
    </div>
  </div>
}

function HostedGoldModal({ conversation, owner, action, onClose, onDone }: { conversation: HostedConversation; owner: HostedOwner | null; action: 'up' | 'down'; onClose: () => void; onDone: (warning: string) => void }) {
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const requestID = useRef(createClientMessageID())
  const verb = action === 'up' ? '上分' : '下分'
  const value = Number(amount)
  const valid = Number.isInteger(value) && value > 0 && value <= 1_000_000_000
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || sending) return
    setSending(true)
    setError('')
    try {
      const result = await api<{ noticeError?: string; duplicate?: boolean }>(`/api/agent/hosted/conversations/${conversation.conversationId}/gold`, {
        method: 'POST',
        body: jsonBody({ guuid: conversation.hostedGuuid, action, amount: value, clientRequestId: requestID.current }),
      })
      onDone(result.duplicate ? '' : (result.noticeError ? `${verb}成功（${value} 积分），但系统消息发送失败：${result.noticeError}` : ''))
    } catch (reason) {
      if (reason instanceof ApiError && (reason.code === 'HOSTED_GOLD_RETRY' || reason.code === 'REQUEST_CONFLICT')) {
        requestID.current = createClientMessageID()
      }
      setError(reason instanceof ApiError ? reason.message : `${verb}失败，请稍后重试`)
    } finally {
      setSending(false)
    }
  }
  return <div className="modal-backdrop"><form className="modal-card transfer-modal hosted-gold-modal" onSubmit={submit}>
    <header><div><small>HOSTED GOLD</small><h3>{verb}</h3></div><button type="button" onClick={onClose}>×</button></header>
    <p className="hosted-gold-target">托管账号：{owner?.name || conversation.hostedName}（{owner?.roleName || conversation.hostedRoleName || '托管'}）<br />操作对象：{conversation.peer.name}{conversation.peer.roleName ? `（${conversation.peer.roleName}）` : ''} · {conversation.clubName}</p>
    <label><span>{verb}积分</span><input type="number" min={1} max={1000000000} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="请输入整数积分" autoFocus /></label>
    <p className="hosted-gold-target">成功后会在会话内发送「玩家 {conversation.peer.name} {verb} {valid ? value : '金额'} 成功（客服托管）」系统消息。</p>
    {error && <div className="form-error">{error}</div>}
    <footer><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit" disabled={!valid || sending}>{sending ? '提交中…' : `确认${verb}`}</button></footer>
  </form></div>
}

/** 玩家备注：全团队共享，留空保存即清除，列表与聊天头部优先显示备注。 */
function HostedRemarkModal({ target, saving, error, onClose, onSubmit }: { target: HostedConversation; saving: boolean; error: string; onClose: () => void; onSubmit: (remark: string) => void }) {
  const [value, setValue] = useState(target.remark || '')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    onSubmit(value.trim())
  }
  return <div className="modal-backdrop"><form className="modal-card remark-modal" onSubmit={submit}>
    <header><div><small>PLAYER REMARK</small><h3>备注名称</h3></div><button type="button" onClick={onClose}>×</button></header>
    <p className="remark-target">玩家：{target.peer.name}{target.peer.roleName ? `（${target.peer.roleName}）` : ''} · {target.clubName}</p>
    <label><span>备注名称</span><input value={value} onChange={(event) => setValue(event.target.value)} maxLength={20} placeholder="例如：老客户张三" autoFocus /></label>
    <p className="remark-hint">备注全团队共享，保存后在托管列表和聊天头部优先显示；留空保存即恢复显示玩家昵称。</p>
    {error && <div className="form-error">{error}</div>}
    <footer><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit" disabled={saving}>{saving ? '保存中…' : value.trim() ? '保存备注' : '清除备注'}</button></footer>
  </form></div>
}

/** 快捷话术管理：全团队共享，托管与普通客服会话共用同一套话术。 */
function QuickReplyManager({ items, onClose, onChanged }: { items: QuickReply[]; onClose: () => void; onChanged: () => void }) {
  const empty = { id: 0, title: '', content: '', category: '常用回复' }
  const [draft, setDraft] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [deletingID, setDeletingID] = useState(0)
  const [error, setError] = useState('')
  const editing = draft.id > 0
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (!title || !content || saving) return
    setSaving(true)
    setError('')
    try {
      const body = jsonBody({ title, content, category: draft.category.trim() || '常用回复' })
      if (editing) await api(`/api/agent/quick-replies/${draft.id}`, { method: 'PUT', body })
      else await api('/api/agent/quick-replies', { method: 'POST', body })
      setDraft(empty)
      onChanged()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '话术保存失败')
    } finally {
      setSaving(false)
    }
  }
  const remove = async (item: QuickReply) => {
    if (!confirm(`确认删除话术「${item.title}」吗？`)) return
    setDeletingID(item.id)
    setError('')
    try {
      await api(`/api/agent/quick-replies/${item.id}`, { method: 'DELETE' })
      if (draft.id === item.id) setDraft(empty)
      onChanged()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '话术删除失败')
    } finally {
      setDeletingID(0)
    }
  }
  return <div className="modal-backdrop"><div className="modal-card quick-manager-modal">
    <header><div><small>QUICK REPLIES</small><h3>快捷话术</h3></div><button type="button" onClick={onClose}>×</button></header>
    <div className="quick-manager-body">
      <p className="remark-hint">全团队共享。托管会话里点击话术会直接以托管账号发送；普通客服会话里点击是填入输入框。</p>
      <div className="quick-manager-list">
        {items.length === 0 ? <p className="memo-empty">还没有话术，先在下面新增一条</p> : items.map((item) => <article key={item.id} className={draft.id === item.id ? 'editing' : ''}>
          <div><strong>{item.title}</strong><small>{item.category}</small><p>{item.content}</p></div>
          <footer>
            <button type="button" onClick={() => setDraft({ id: item.id, title: item.title, content: item.content, category: item.category || '常用回复' })}>修改</button>
            <button type="button" disabled={deletingID === item.id} onClick={() => void remove(item)}>{deletingID === item.id ? '删除中' : '删除'}</button>
          </footer>
        </article>)}
      </div>
      <form className="quick-manager-form" onSubmit={submit}>
        <header><strong>{editing ? '修改话术' : '新增话术'}</strong>{editing && <button type="button" onClick={() => setDraft(empty)}>取消修改</button>}</header>
        <label><span>标题</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={80} placeholder="例如：欢迎语" required /></label>
        <label><span>内容</span><textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} maxLength={1000} rows={4} placeholder="客服点击后发送的话术内容" required /></label>
        <label><span>分类</span><input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} maxLength={64} placeholder="常用回复" /></label>
        {error && <div className="form-error">{error}</div>}
        <footer><span>{draft.content.length}/1000</span><button className="primary" type="submit" disabled={saving || !draft.title.trim() || !draft.content.trim()}>{saving ? '保存中…' : editing ? '保存修改' : '新增话术'}</button></footer>
      </form>
    </div>
  </div></div>
}

function HostedOwnerInfo({ owner, conversation, canDelete, deleting, onDelete }: { owner: HostedOwner; conversation: HostedConversation | null; canDelete: boolean; deleting: boolean; onDelete: () => void }) {  return <div className="player-info"><header><span className="info-avatar"><Avatar name={owner.name} url={owner.avatar} size="large" /></span><h3>{owner.name}</h3><p>{owner.roleName} · {owner.groupName}</p>{!owner.enabled && <em className="hosted-readonly-badge">已取消托管</em>}<a className="game-admin-link" href={gameAdminPlayerURL(owner.guuid)} target="_blank" rel="noreferrer">在游戏后台查看 / 处理</a></header><section><h4>托管信息</h4><dl><div><dt>托管账号</dt><dd>{owner.name}</dd></div><div><dt>游戏 ID</dt><dd>{owner.guuid}</dd></div><div><dt>身份</dt><dd>{owner.roleName}</dd></div><div><dt>归属</dt><dd>{owner.groupType === 'union' ? `联盟 · ${owner.groupName}` : `俱乐部 · ${owner.groupName}`}</dd></div><div><dt>托管会话</dt><dd>{owner.conversationCount} 个</dd></div><div><dt>开启时间</dt><dd>{formatDateTime(normalizeDirectTime(owner.enabledAt))}</dd></div>{owner.disabledAt && <div><dt>取消时间</dt><dd>{formatDateTime(normalizeDirectTime(owner.disabledAt))}</dd></div>}</dl></section>{conversation && <section><h4>当前会话</h4><dl><div><dt>对方</dt><dd>{hostedDisplayName(conversation.peer.name, conversation.remark)}{conversation.peer.roleName ? `（${conversation.peer.roleName}）` : ''}</dd></div>{conversation.peer.guuid && <div><dt>对方后台</dt><dd><a className="inline-admin-link" href={gameAdminPlayerURL(conversation.peer.guuid)} target="_blank" rel="noreferrer">在游戏后台查看</a></dd></div>}<div><dt>备注名称</dt><dd>{conversation.remark || '未设置'}</dd></div><div><dt>置顶</dt><dd>{conversation.pinned ? '已置顶' : '未置顶'}</dd></div><div><dt>俱乐部</dt><dd>{conversation.clubName}</dd></div><div><dt>最后消息</dt><dd>{conversation.lastMessage || '—'}</dd></div></dl></section>}<footer>{owner.enabled ? '客服的回复会以该托管账号身份发送，对方收到时与本人回复一致。' : canDelete ? <><p>托管已取消，仅可查看历史记录。</p><button type="button" className="danger-light hosted-delete-button" disabled={deleting} onClick={onDelete}>{deleting ? '删除中…' : '永久删除聊天记录'}</button></> : <p>托管已取消，仅可查看历史记录；如需删除请联系主管。</p>}</footer></div>
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
