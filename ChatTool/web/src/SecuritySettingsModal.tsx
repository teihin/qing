import { useCallback, useEffect, useState } from 'react'
import qrcode from 'qrcode-generator'
import { api, ApiError, jsonBody } from './api'
import type { TOTPSetup, TOTPStatus } from './types'

type Mode = 'overview' | 'bind-password' | 'bind-scan' | 'disable' | 'regenerate' | 'codes'

type RecoveryResult = { message: string; recoveryCodes: string[] }

export default function SecuritySettingsModal({ onClose, onChanged }: {
  onClose: () => void
  onChanged: () => Promise<void> | void
}) {
  const [status, setStatus] = useState<TOTPStatus | null>(null)
  const [mode, setMode] = useState<Mode>('overview')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [setup, setSetup] = useState<TOTPSetup | null>(null)
  const [qrImage, setQrImage] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [codesHint, setCodesHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<TOTPStatus>('/api/agent/auth/totp/status'))
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [])

  useEffect(() => { void loadStatus() }, [loadStatus])

  useEffect(() => {
    if (!setup) { setQrImage(''); return }
    const qr = qrcode(0, 'M')
    qr.addData(setup.otpauthUri)
    qr.make()
    const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })
    setQrImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  }, [setup])

  const switchMode = (next: Mode) => {
    setMode(next)
    setPassword('')
    setCode('')
    setError('')
    if (next === 'overview') setSetup(null)
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const startBind = () => run(async () => {
    const result = await api<TOTPSetup>('/api/agent/auth/totp/setup', { method: 'POST', body: jsonBody({ password }) })
    setSetup(result)
    setPassword('')
    setMode('bind-scan')
  })

  const confirmBind = () => run(async () => {
    const result = await api<RecoveryResult>('/api/agent/auth/totp/confirm', { method: 'POST', body: jsonBody({ code: code.trim() }) })
    setCodes(result.recoveryCodes)
    setCodesHint(result.message)
    setMode('codes')
    await loadStatus()
    await onChanged()
  })

  const disable = () => run(async () => {
    await api('/api/agent/auth/totp/disable', { method: 'POST', body: jsonBody({ password, code: code.trim() }) })
    setPassword('')
    setCode('')
    await loadStatus()
    await onChanged()
    setMode('overview')
  })

  const regenerate = () => run(async () => {
    const result = await api<RecoveryResult>('/api/agent/auth/totp/recovery', { method: 'POST', body: jsonBody({ password, code: code.trim() }) })
    setCodes(result.recoveryCodes)
    setCodesHint(result.message)
    setPassword('')
    setCode('')
    setMode('codes')
    await loadStatus()
  })

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
    } catch {
      setError('复制失败，请手动选择文本')
    }
  }

  const downloadCodes = () => {
    const content = [
      'ChatTool 客服工作台 · 谷歌验证恢复码',
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      ...codes,
      '',
      '每个恢复码只能使用一次，请离线保存。',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'ChatTool-恢复码.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return <div className="modal-backdrop">
    <div className="modal-card security-modal">
      <header><div><small>ACCOUNT SECURITY</small><h3>账号安全</h3></div><button type="button" onClick={onClose}>×</button></header>

      {mode === 'overview' && (!status ? <div className="security-loading">正在读取二次验证状态…</div> : status.enabled ? <div className="security-body">
        <div className="totp-state totp-state--on"><span>已开启</span><strong>谷歌验证（动态口令）</strong></div>
        <div className="totp-meta"><span>绑定时间：{formatMoment(status.confirmedAt)}</span><span>剩余恢复码：{status.recoveryCodesLeft} 个</span></div>
        {error && <div className="form-error">{error}</div>}
        <p className="totp-note">重新生成恢复码或关闭验证，需要输入登录密码 + 当前动态码（也可用恢复码）。</p>
        <div className="security-actions">
          <button type="button" onClick={() => switchMode('regenerate')}>重新生成恢复码</button>
          <button type="button" className="danger" onClick={() => switchMode('disable')}>关闭谷歌验证</button>
        </div>
      </div> : <div className="security-body">
        <div className="totp-state"><span>未开启</span><strong>谷歌验证（动态口令）</strong></div>
        {error && <div className="form-error">{error}</div>}
        <div className="totp-banner">开启后，每次登录还需要输入验证器 App 的 6 位动态码。手机丢失时可使用恢复码或联系客服主管重置。</div>
        <div className="security-actions"><button type="button" className="primary" onClick={() => switchMode('bind-password')}>立即绑定</button></div>
      </div>)}

      {mode === 'bind-password' && <form className="security-body" onSubmit={(event) => { event.preventDefault(); void startBind() }}>
        {error && <div className="form-error">{error}</div>}
        <div className="totp-banner">先验证当前登录密码，再展示验证器二维码。</div>
        <label className="security-field"><span>当前登录密码</span><input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div className="security-actions"><button type="button" onClick={() => switchMode('overview')}>取消</button><button type="submit" className="primary" disabled={busy || !password}>{busy ? '正在生成…' : '下一步'}</button></div>
      </form>}

      {mode === 'bind-scan' && setup && <form className="security-body" onSubmit={(event) => { event.preventDefault(); void confirmBind() }}>
        {error && <div className="form-error">{error}</div>}
        <div className="totp-qr">{qrImage ? <img src={qrImage} alt="谷歌验证二维码" /> : <div className="security-loading">正在生成二维码…</div>}</div>
        <div className="totp-secret">无法扫码时，在验证器中手动添加账号并输入密钥：<code>{setup.secret}</code></div>
        <label className="security-field"><span>验证器中的 6 位动态码</span><input className="totp-code-input" autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))} placeholder="000000" /><small>打开 Google Authenticator / Microsoft Authenticator 等 App 输入当前动态码</small></label>
        <div className="security-actions"><button type="button" onClick={() => switchMode('overview')}>取消</button><button type="submit" className="primary" disabled={busy || code.length !== 6}>{busy ? '正在保存…' : '确认开启'}</button></div>
      </form>}

      {mode === 'disable' && <form className="security-body" onSubmit={(event) => { event.preventDefault(); void disable() }}>
        {error && <div className="form-error">{error}</div>}
        <div className="totp-banner">关闭后，登录将只校验账号密码。其他设备的登录会话会一起退出。</div>
        <label className="security-field"><span>当前登录密码</span><input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="security-field"><span>动态码或恢复码</span><input className="totp-code-input totp-code-input--text" autoComplete="one-time-code" value={code} maxLength={20} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="6 位动态码或 10 位恢复码" /></label>
        <div className="security-actions"><button type="button" onClick={() => switchMode('overview')}>取消</button><button type="submit" className="primary" disabled={busy || !password || code.trim().length < 6}>{busy ? '正在关闭…' : '确认关闭'}</button></div>
      </form>}

      {mode === 'regenerate' && <form className="security-body" onSubmit={(event) => { event.preventDefault(); void regenerate() }}>
        {error && <div className="form-error">{error}</div>}
        <div className="totp-banner">生成新一批恢复码后，旧恢复码全部失效。需要登录密码 + 当前动态码（也可用恢复码）。</div>
        <label className="security-field"><span>当前登录密码</span><input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="security-field"><span>动态码或恢复码</span><input className="totp-code-input totp-code-input--text" autoComplete="one-time-code" value={code} maxLength={20} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="6 位动态码或 10 位恢复码" /></label>
        <div className="security-actions"><button type="button" onClick={() => switchMode('overview')}>取消</button><button type="submit" className="primary" disabled={busy || !password || code.trim().length < 6}>{busy ? '正在生成…' : '生成新恢复码'}</button></div>
      </form>}

      {mode === 'codes' && <div className="security-body">
        <div className="totp-banner">{codesHint || '恢复码只显示这一次，请立即保存。'}</div>
        <div className="recovery-codes">{codes.map((item) => <code key={item}>{item}</code>)}</div>
        <div className="security-actions"><button type="button" onClick={() => void copyCodes()}>复制全部</button><button type="button" onClick={downloadCodes}>下载 TXT</button></div>
        <p className="totp-note">每个恢复码只能使用一次。手机丢失且没有恢复码时，需要客服主管重置二次验证。</p>
        <div className="security-actions"><button type="button" className="primary" onClick={() => { setCodes([]); setCodesHint(''); switchMode('overview') }}>我已保存，完成</button></div>
      </div>}
    </div>
  </div>
}

function errorMessage(reason: unknown) {
  return reason instanceof ApiError ? reason.message : '操作失败，请稍后重试'
}

function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
