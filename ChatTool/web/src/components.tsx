import { useEffect, useState } from 'react'
import type { Message } from './types'
import { hasPlayerEmbeddedToken, mediaURL, resolveMediaURL } from './api'

export function Avatar({ name, url, size = 'normal' }: { name: string; url?: string; size?: 'small' | 'normal' | 'large' }) {
  const safeName = typeof name === 'string' ? name : ''
  if (url) return <img className={`avatar avatar-${size}`} src={url} alt={`${safeName || '客服'}头像`} />
  return <span className={`avatar avatar-${size} avatar-fallback`} aria-hidden="true">{safeName.slice(0, 1) || '客'}</span>
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot status-${status}`} aria-label={status === 'online' ? '在线' : status === 'away' ? '离开' : '离线'} />
}

export function MessageBubble({ message, own, onImage }: { message: Message; own: boolean; onImage?: (src: string) => void }) {
  const time = formatTime(message.createdAt)
  const [mediaSrc, setMediaSrc] = useState(
    message.mediaId && !hasPlayerEmbeddedToken() ? mediaURL(message.mediaId) : '',
  )
  useEffect(() => {
    let active = true
    if (!message.mediaId) return () => { active = false }
    void resolveMediaURL(message.mediaId).then((value) => {
      if (active) setMediaSrc(value)
    }).catch(() => undefined)
    return () => { active = false }
  }, [message.mediaId])
  if (message.senderType === 'system') {
    return <div className="system-message"><span>{message.text}</span></div>
  }
  return (
    <div className={`message-row ${own ? 'message-own' : ''} ${message.senderType === 'note' ? 'message-note-row' : ''}`}>
      {!own && <Avatar name={message.senderName} size="small" />}
      <div className="message-stack">
        <div className="message-meta">
          {!own && <span>{message.senderName}</span>}
          {message.senderType === 'note' && <span className="note-label">内部备注</span>}
          <time>{time}</time>
        </div>
        <div className={`message-bubble message-${message.messageType}`}>
          {(message.messageType === 'text' || message.messageType === 'note') && <p>{message.text}</p>}
          {message.messageType === 'image' && (mediaSrc
            ? <button className="media-button" type="button" onClick={() => onImage?.(mediaSrc)}><img src={mediaSrc} alt={message.mediaName || '聊天图片'} loading="lazy" /></button>
            : <span className="media-loading">图片加载中…</span>)}
          {message.messageType === 'video' && (mediaSrc
            ? <video src={mediaSrc} controls playsInline preload="metadata" aria-label={message.mediaName || '聊天视频'} />
            : <span className="media-loading">视频加载中…</span>)}
          {message.messageType === 'file' && (mediaSrc
            ? <a className="file-card" href={mediaSrc} download><span className="file-icon">文</span><span><strong>{message.mediaName || '文件'}</strong><small>{formatBytes(message.mediaSize || 0)}</small></span><b>下载</b></a>
            : <span className="media-loading">文件加载中…</span>)}
        </div>
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{text}</p></div>
}

export function LoadingScreen({ label = '正在连接客服中心', embedded = false }: { label?: string; embedded?: boolean }) {
  return <div className={`loading-screen ${embedded ? 'loading-screen-embedded' : ''}`}><div className="brand-mark">8L</div><span className="loading-spinner" /><p>{label}</p></div>
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatAgo(value: string) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '刚刚'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '—'
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
}
