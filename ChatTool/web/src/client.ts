const agentSoundPreferenceKey = 'chattool.agent.sound-enabled'

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

let messageAudioContext: AudioContext | null = null

export function createClientMessageID(): string {
  try {
    if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID()
  } catch {
    // 纯 HTTP IP 页面可能不暴露 Web Crypto，使用下方非安全随机值即可满足消息幂等键需求。
  }
  const random = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}-${random.slice(0, 24)}`
}

export function gameAdminPlayerURL(playerID: string): string {
  const configuredBase = String(import.meta.env.VITE_GAME_ADMIN_URL || '').trim()
  const baseURL = configuredBase || new URL('/xuanmanager/', window.location.origin).toString()
  const url = new URL(baseURL, window.location.origin)
  url.hash = `/game/players?playerId=${encodeURIComponent(playerID)}`
  return url.toString()
}

export function readAgentSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(agentSoundPreferenceKey) !== 'off'
  } catch {
    return true
  }
}

export function writeAgentSoundPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(agentSoundPreferenceKey, enabled ? 'on' : 'off')
  } catch {
    // 隐私模式禁用本地存储时，当前页面内的开关状态仍然有效。
  }
}

function getMessageAudioContext(): AudioContext | null {
  if (messageAudioContext) return messageAudioContext
  const audioWindow = window as AudioWindow
  const AudioContextType = audioWindow.AudioContext || audioWindow.webkitAudioContext
  if (!AudioContextType) return null
  try {
    messageAudioContext = new AudioContextType()
    return messageAudioContext
  } catch {
    return null
  }
}

export async function playIncomingMessageSound(): Promise<void> {
  const context = getMessageAudioContext()
  if (!context) return
  try {
    if (context.state === 'suspended') await context.resume()
    const start = context.currentTime
    ;[
      { offset: 0, frequency: 880 },
      { offset: 0.14, frequency: 1175 },
    ].forEach(({ offset, frequency }) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, start + offset)
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.13, start + offset + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.12)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.13)
    })
  } catch {
    // 浏览器自动播放策略可能在用户首次交互前阻止声音，不影响消息接收。
  }
}
