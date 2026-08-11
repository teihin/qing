import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ChatTool page failed', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return <main className="loading-screen runtime-error-page"><div className="brand-mark">8L</div><h1>页面需要重新加载</h1><p>聊天记录已经安全保存，请刷新页面继续处理。</p><button type="button" onClick={() => location.reload()}>立即刷新</button></main>
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
)
