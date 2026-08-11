import AgentApp from './AgentApp'
import PlayerApp from './PlayerApp'

export default function App() {
  const basePath = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '')
  const routePath = basePath && location.pathname.startsWith(basePath)
    ? location.pathname.slice(basePath.length) || '/'
    : location.pathname
  if (routePath.startsWith('/agent')) return <AgentApp />
  return <PlayerApp />
}
