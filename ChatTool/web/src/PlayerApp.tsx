import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ApiError, appURL, jsonBody, playerSessionURL, setCSRF, setPlayerEmbeddedToken, setPlayerSessionRef } from './api'
import { createClientMessageID } from './client'
import { Avatar, LoadingScreen, MessageBubble } from './components'
import type { Message, PlayerState } from './types'

export default function PlayerApp() {
  const initialParams = useRef(new URLSearchParams(location.search)).current
  const embedded = initialParams.get('embed') === 'game'
  // 游戏外入口会带 bg=opaque：保留嵌入模式的会话与媒体行为，但外观改用完整网页版的浅色不透明样式。
  const opaqueBackground = embedded && initialParams.get('bg') === 'opaque'
  // 只有牌桌内的“联系客服”继续使用透明深色皮肤，让牌桌透出。
  const embeddedSkin = embedded && !opaqueBackground
	const embeddedTokenKey = 'chattool.playerEmbeddedToken'
	const embeddedCSRFKey = 'chattool.playerEmbeddedCSRF'
  const [state, setState] = useState<PlayerState | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [agentTyping, setAgentTyping] = useState(false)
  const [previewImage, setPreviewImage] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [keyboardEditing, setKeyboardEditing] = useState(false)
  const [showRating, setShowRating] = useState(false)
  const booted = useRef(false)
  const parentReadySent = useRef(false)
  const messageList = useRef<HTMLElement>(null)
  const typingIdleTimer = useRef<number | undefined>(undefined)
  const typingHeartbeatTimer = useRef<number | undefined>(undefined)
  const typingActive = useRef(false)
  const agentTypingExpiry = useRef<number | undefined>(undefined)
  const keyboardBlurTimer = useRef<number | undefined>(undefined)
  const normalViewportHeight = useRef(0)
  const normalViewportWidth = useRef(window.innerWidth)
  const conversationID = state?.conversation.id
	const canSend = Boolean(state && state.conversation.status !== 'closed' && state.onlineAgents > 0)
  const lastMessageID = messages.length ? messages[messages.length - 1].id : null

  useLayoutEffect(() => {
    document.documentElement.classList.add('chattool-player-document')
    if (embeddedSkin) document.documentElement.classList.add('chattool-embedded-document')
    return () => {
      document.documentElement.classList.remove('chattool-player-document')
      document.documentElement.classList.remove('chattool-embedded-document')
    }
  }, [embeddedSkin])

  useLayoutEffect(() => {
    if (!embedded) return
    const viewport = window.visualViewport
    const updateHeight = () => {
      const available = Math.min(window.innerHeight, viewport ? viewport.offsetTop + viewport.height : window.innerHeight)
      if (!keyboardEditing) {
        if (Math.abs(window.innerWidth - normalViewportWidth.current) > 40) {
          normalViewportWidth.current = window.innerWidth
          normalViewportHeight.current = available
        } else {
          normalViewportHeight.current = Math.max(normalViewportHeight.current, available)
        }
      }
      const normal = normalViewportHeight.current || available
      // Some fullscreen WebViews keep reporting the old viewport when the IME opens.
      // Reserve the keyboard's approximate space only in that case.
      const keyboardReported = normal - available > 120
      const estimatedKeyboard = Math.min(500, Math.max(320, normal * 0.5))
      const height = keyboardEditing
        ? Math.min(available, Math.max(160, keyboardReported ? available - 32 : normal - estimatedKeyboard - 16))
        : available
      document.documentElement.style.setProperty('--chattool-viewport-height', `${height}px`)
    }
    updateHeight()
    viewport?.addEventListener('resize', updateHeight)
    viewport?.addEventListener('scroll', updateHeight)
    window.addEventListener('resize', updateHeight)
    return () => {
      window.clearTimeout(keyboardBlurTimer.current)
      viewport?.removeEventListener('resize', updateHeight)
      viewport?.removeEventListener('scroll', updateHeight)
      window.removeEventListener('resize', updateHeight)
      document.documentElement.style.removeProperty('--chattool-viewport-height')
    }
  }, [embedded, keyboardEditing])

  const loadMessages = useCallback(async () => {
    const result = await api<{ items: Message[] }>('/api/player/messages')
    setMessages(Array.isArray(result.items) ? result.items : [])
  }, [])

  const loadState = useCallback(async () => {
    const result = await api<PlayerState>('/api/player/me')
	if (result.csrfToken) setCSRF(result.csrfToken)
    setState(result)
  }, [])

  const stopPlayerTyping = useCallback(() => {
    window.clearTimeout(typingIdleTimer.current)
    window.clearInterval(typingHeartbeatTimer.current)
    typingIdleTimer.current = undefined
    typingHeartbeatTimer.current = undefined
    if (!typingActive.current) return
    typingActive.current = false
    void api<void>('/api/player/typing', { method: 'POST', body: jsonBody({ typing: false }) }).catch(() => undefined)
  }, [])

  const startPlayerTyping = useCallback(() => {
    if (!typingActive.current) {
      typingActive.current = true
      void api<void>('/api/player/typing', { method: 'POST', body: jsonBody({ typing: true }) }).catch(() => undefined)
      typingHeartbeatTimer.current = window.setInterval(() => {
        void api<void>('/api/player/typing', { method: 'POST', body: jsonBody({ typing: true }) }).catch(() => undefined)
      }, 1000)
    }
    window.clearTimeout(typingIdleTimer.current)
    typingIdleTimer.current = window.setTimeout(stopPlayerTyping, 1200)
  }, [stopPlayerTyping])

  const updateAgentTyping = useCallback((typing: boolean) => {
    window.clearTimeout(agentTypingExpiry.current)
    agentTypingExpiry.current = undefined
    setAgentTyping(typing)
    if (typing) {
      agentTypingExpiry.current = window.setTimeout(() => {
        agentTypingExpiry.current = undefined
        setAgentTyping(false)
      }, 2500)
    }
  }, [])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      try {
		const params = new URLSearchParams(location.search)
		const encryptedData = params.get('d') || params.get('data') || params.get('extradata') || params.get('info')
		const existingSessionRef = params.get('sessionRef') || ''
		setPlayerSessionRef(existingSessionRef)
		if (embedded) {
			setPlayerEmbeddedToken(sessionStorage.getItem(embeddedTokenKey) || '')
			setCSRF(sessionStorage.getItem(embeddedCSRFKey) || '')
		}
		let result: PlayerState
		if (encryptedData) {
			setPlayerSessionRef('')
			setPlayerEmbeddedToken('')
			if (embedded) {
				sessionStorage.removeItem(embeddedTokenKey)
				sessionStorage.removeItem(embeddedCSRFKey)
			}
			result = await api<PlayerState>('/api/player/session', { method: 'POST', body: jsonBody({ encryptedData, embedded }) })
			setPlayerSessionRef(result.sessionRef || '')
			if (embedded && result.embeddedToken) {
				setPlayerEmbeddedToken(result.embeddedToken)
				sessionStorage.setItem(embeddedTokenKey, result.embeddedToken)
			}
			const cleanParams = new URLSearchParams()
			if (result.sessionRef) cleanParams.set('sessionRef', result.sessionRef)
			if (embedded) cleanParams.set('embed', 'game')
			if (opaqueBackground) cleanParams.set('bg', 'opaque')
			const cleanQuery = cleanParams.toString()
			const cleanURL = `${appURL('/player')}${cleanQuery ? `?${cleanQuery}` : ''}`
			history.replaceState(null, '', cleanURL)
        } else {
          result = await api<PlayerState>('/api/player/me')
        }
		if (result.csrfToken) {
			setCSRF(result.csrfToken)
			if (embedded) sessionStorage.setItem(embeddedCSRFKey, result.csrfToken)
		}
        setState(result)
        await loadMessages()
      } catch (reason) {
        setError(reason instanceof ApiError ? reason.message : '暂时无法连接客服中心，请返回游戏后重试')
      }
    })()
  }, [embedded, embeddedCSRFKey, embeddedTokenKey, loadMessages, opaqueBackground])

  useEffect(() => {
    if (!embedded || parentReadySent.current || (!state && !error) || window.parent === window) return
    parentReadySent.current = true
    window.parent.postMessage({ type: 'chattool:player-ready', ok: Boolean(state) }, '*')
  }, [embedded, error, state])

  useEffect(() => {
    if (!conversationID) return
	if (embedded) {
	  const refresh = () => { void Promise.all([loadState(), loadMessages()]).catch(() => undefined) }
	  const embeddedPoll = window.setInterval(refresh, 2000)
	  return () => window.clearInterval(embeddedPoll)
	}
	const source = new EventSource(playerSessionURL('/api/player/events'))
    const refresh = () => { void Promise.all([loadState(), loadMessages()]) }
    source.addEventListener('message.created', refresh)
    source.addEventListener('conversation.assigned', refresh)
    source.addEventListener('conversation.requeued', refresh)
    source.addEventListener('conversation.transferred', refresh)
	  source.addEventListener('conversation.closed', refresh)
	  source.addEventListener('conversation.cleared', refresh)
	  source.addEventListener('team.changed', () => void loadState())
	  source.addEventListener('typing', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { payload?: { actor?: string; typing?: boolean } }
        if (data.payload?.actor === 'agent') updateAgentTyping(Boolean(data.payload.typing))
      } catch { /* ignore malformed realtime event */ }
	  })
	const statePoll = window.setInterval(() => void loadState().catch(() => undefined), 20000)
    return () => {
      source.close()
	  window.clearInterval(statePoll)
      window.clearTimeout(agentTypingExpiry.current)
      agentTypingExpiry.current = undefined
    }
  }, [conversationID, embedded, loadMessages, loadState, updateAgentTyping])

  useEffect(() => {
	if (!canSend || state?.conversation.status !== 'active') {
      stopPlayerTyping()
      updateAgentTyping(false)
    }
	if (!canSend) setShowActions(false)
	}, [canSend, state?.conversation.status, stopPlayerTyping, updateAgentTyping])

  useEffect(() => () => {
    stopPlayerTyping()
    window.clearTimeout(agentTypingExpiry.current)
  }, [stopPlayerTyping])

  useEffect(() => {
    // scrollIntoView also scrolls the outer WebView on some phones. The embedded
    // page polls messages every two seconds, so that used to move the whole UI.
    const list = messageList.current
    if (!list) return
    list.style.scrollBehavior = 'auto'
    list.scrollTop = list.scrollHeight
    list.style.scrollBehavior = ''
  }, [messages.length, lastMessageID, agentTyping])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const content = text.trim()
	if (!content || sending || !canSend) return
    stopPlayerTyping()
    setSending(true)
    setError('')
    try {
      const message = await api<Message>('/api/player/messages', { method: 'POST', body: jsonBody({ text: content, clientMessageId: createClientMessageID() }) })
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
      setText('')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '消息发送失败，请重试')
    } finally { setSending(false) }
  }

  const onTextChange = (value: string) => {
    setText(value)
	if (canSend && state?.conversation.status === 'active' && value.trim()) startPlayerTyping()
    else stopPlayerTyping()
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
	if (!file || uploading || !canSend) return
    stopPlayerTyping()
    setUploading(true)
    setShowActions(false)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const message = await api<Message>('/api/player/uploads', { method: 'POST', body: form })
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '文件上传失败，请重试')
    } finally { setUploading(false) }
  }

  if (!state && !error) return <LoadingScreen embedded={embeddedSkin} />
  if (!state) return (
    <main className={`player-shell player-error-page ${embedded ? 'player-shell-game' : ''} ${embeddedSkin ? 'player-shell-embedded player-error-page-embedded' : ''}`}>
      <div className="brand-mark">BY</div><h1>无法进入在线客服</h1><p>{error}</p><button type="button" onClick={() => location.reload()}>重新连接</button><small>为保障账号安全，请从游戏内的“客服”入口进入。</small>
    </main>
  )

  const { conversation } = state
	const unavailable = conversation.status !== 'closed' && state.onlineAgents === 0
	const hasPlayerMessage = messages.some((message) => message.senderType === 'player')
  return (
    <main className={`player-shell ${embedded ? 'player-shell-game' : ''} ${embeddedSkin ? 'player-shell-embedded' : ''} ${embedded && keyboardEditing ? 'player-shell-keyboard' : ''}`}>
      <header className="player-header">
		<div className="player-brand"><span className="brand-mark brand-mark-small">BY</span><div><strong>在线客服</strong><small>{conversation.category} · 专属服务</small></div></div>
      </header>
      <section className={`service-banner banner-${conversation.status} ${unavailable ? 'banner-unavailable' : ''}`}>
        <span className="service-avatar"><Avatar name={conversation.agentName || '客'} size="large" /><i /></span>
        <div>
		  <strong>{conversation.status === 'closed' ? '本次咨询已结束' : unavailable ? '当前没有客服在线' : conversation.status === 'active' ? `${conversation.agentName} 正在为您服务` : hasPlayerMessage ? '正在为您分配客服' : '请先发送您的问题'}</strong>
		  <p>{conversation.status === 'closed' ? '如有其他问题，请返回游戏重新进入客服' : unavailable ? '暂时无法发送消息，请等待客服上线后再咨询' : conversation.status === 'active' ? (embedded ? '您可以发送文字、图片或视频' : '您可以发送文字、图片、视频或文件') : hasPlayerMessage ? '请稍候，正在为您接入在线客服' : '发送第一条文字、图片或视频后，将自动接入在线客服'}</p>
        </div>
      </section>
      <section className="player-messages" aria-live="polite" ref={messageList}>
        <div className="conversation-date">今天</div>
        {messages.map((message) => <MessageBubble key={message.id} message={message} own={message.senderType === 'player'} onImage={setPreviewImage} />)}
        {agentTyping && <div className="typing-bubble"><i /><i /><i /></div>}
      </section>
      {error && <div className="toast-error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭提示">×</button></div>}
      {conversation.status === 'closed' && <button className="rating-entry" type="button" onClick={() => setShowRating(true)}>评价本次服务</button>}
      {uploading && <div className="uploading-bar"><span className="loading-spinner" />正在上传文件…</div>}
	  <form className={`player-composer ${!canSend ? 'player-composer-disabled' : ''}`} onSubmit={submit}>
		{showActions && <div className={`player-actions ${embedded ? 'player-actions-embedded' : ''}`}>
		  <label><span className="action-icon action-photo">图</span><b>图片</b><input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={upload} disabled={!canSend} /></label>
		  {!embedded && <label><span className="action-icon action-camera">拍</span><b>拍摄</b><input type="file" accept="image/*,video/*" capture="environment" onChange={upload} disabled={!canSend} /></label>}
		  <label><span className="action-icon action-video">视</span><b>视频</b><input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={upload} disabled={!canSend} /></label>
		  {!embedded && <label><span className="action-icon action-file">文</span><b>文件</b><input type="file" accept=".pdf,.txt,.zip" onChange={upload} disabled={!canSend} /></label>}
		</div>}
		<div className="composer-row">
		  <button className={`add-button ${showActions ? 'add-button-open' : ''}`} type="button" aria-label="添加图片或视频" onClick={() => setShowActions((value) => !value)} disabled={!canSend}>＋</button>
		  <textarea value={text} onChange={(event) => onTextChange(event.target.value)} onFocus={() => { window.clearTimeout(keyboardBlurTimer.current); setShowActions(false); setKeyboardEditing(true) }} onBlur={() => { keyboardBlurTimer.current = window.setTimeout(() => setKeyboardEditing(false), 180); stopPlayerTyping() }} rows={1} maxLength={2000} placeholder={conversation.status === 'closed' ? '本次咨询已结束' : unavailable ? '当前没有客服在线' : '请输入您要咨询的问题…'} disabled={!canSend} />
		  <button className="send-button" type="submit" disabled={!text.trim() || sending || !canSend}>{sending ? '发送中' : '发送'}</button>
		</div>
		<small className={`safe-tip ${unavailable ? 'offline-tip' : ''}`}>{unavailable ? '客服上线后将自动恢复发送功能' : '请勿发送密码、验证码、银行卡等敏感信息'}</small>
      </form>
      {previewImage && <div className="image-preview" role="dialog" aria-modal="true" onClick={() => setPreviewImage('')}><button type="button" aria-label="关闭图片">×</button><img src={previewImage} alt="图片预览" /></div>}
      {showRating && <RatingModal onClose={() => setShowRating(false)} onSubmit={async (score, tags, comment) => { await api('/api/player/satisfaction', { method: 'POST', body: jsonBody({ score, tags, comment }) }); setShowRating(false) }} />}
    </main>
  )
}

function RatingModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (score: number, tags: string[], comment: string) => Promise<void> }) {
  const [score, setScore] = useState(5)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const options = ['回复及时', '态度友好', '解决问题', '专业清晰']
  return <div className="modal-backdrop"><form className="modal-card rating-modal" onSubmit={(event) => { event.preventDefault(); setSaving(true); void onSubmit(score, tags, comment).catch((reason) => setError(reason instanceof ApiError ? reason.message : '评价提交失败')).finally(() => setSaving(false)) }}><header><div><small>SERVICE REVIEW</small><h3>服务评价</h3></div><button type="button" onClick={onClose}>×</button></header><p>您的反馈会帮助我们持续提升服务质量</p><div className="rating-stars">{[1,2,3,4,5].map((value) => <button type="button" key={value} className={value <= score ? 'active' : ''} onClick={() => setScore(value)}>★</button>)}</div><div className="rating-tags">{options.map((option) => <button type="button" className={tags.includes(option) ? 'active' : ''} key={option} onClick={() => setTags((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option])}>{option}</button>)}</div><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} placeholder="还可以告诉我们更多（选填）" />{error && <div className="form-error">{error}</div>}<footer><button type="button" onClick={onClose}>暂不评价</button><button type="submit" disabled={saving}>{saving ? '提交中…' : '提交评价'}</button></footer></form></div>
}
