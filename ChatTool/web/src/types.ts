export type Agent = {
  id: number
  username: string
  displayName: string
	role: 'supervisor' | 'agent'
	channelCode: string
	channelName: string
  presence: 'online' | 'away' | 'offline'
}

export type Message = {
  id: string
  conversationId: string
  senderType: 'player' | 'agent' | 'system' | 'note'
  senderId: string
  senderName: string
  messageType: 'text' | 'image' | 'video' | 'file' | 'system' | 'note'
  text: string
  mediaId?: string
  mediaName?: string
  mediaMime?: string
  mediaSize?: number
  createdAt: string
  recalledAt?: string
}

export type PlayerProfile = {
  playerId: string
  nickname: string
  loginName: string
  avatarUrl: string
  level: string
  vip: string
  platform: string
  metadata: Record<string, unknown>
}

export type PlayerState = {
  player: PlayerProfile
  conversation: {
    id: string
    status: 'queued' | 'active' | 'closed'
		category: string
		channelCode: string
    priority: string
    assignedAgentId?: number
    agentName: string
  }
  onlineAgents: number
	csrfToken: string
	sessionRef?: string
}

export type Conversation = {
  id: string
  playerId: string
  nickname: string
  avatarUrl: string
  vip: string
  status: 'queued' | 'active' | 'closed'
  priority: string
	category: string
	channelCode: string
  assignedAgentId?: number
  assignedAgent: string
  lastMessage: string
  lastMessageType: string
  lastMessageAt: string
  unread: number
  queueStartedAt: string
  firstResponseAt?: string
}

export type ConversationDetail = {
  id: string
  status: 'queued' | 'active' | 'closed'
  priority: string
	category: string
	channelCode: string
  playerId: string
  nickname: string
  loginName: string
  avatarUrl: string
  level: string
  vip: string
  platform: string
  metadata: Record<string, unknown>
  assignedAgentId?: number
  assignedAgent: string
  createdAt: string
  lastMessageAt: string
  satisfactionScore?: number
  satisfactionTags: string
  satisfactionComment: string
}

export type TeamMember = Agent & {
  enabled: boolean
  maxConversations: number
  activeConversations: number
  lastSeenAt?: string
}

export type ServiceChannel = {
	code: string
	displayName: string
}
