export type Status = "enabled" | "disabled";

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  isSuper: boolean;
}

export interface ModuleItem {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  route: string;
  icon: string;
  sortOrder: number;
  visible: boolean;
  status: Status;
}

export interface PermissionItem {
  id: number;
  moduleId: number;
  moduleCode: string;
  moduleName: string;
  code: string;
  name: string;
  action: string;
  description: string;
  status: Status;
}

export interface SessionData {
  user: SessionUser;
  permissions: string[];
  modules: ModuleItem[];
}

export interface GameAnnouncement {
  content: string;
  configured: boolean;
  contentLength: number;
  lastUpdatedBy: string;
  lastUpdatedAt: string | null;
  storageKey: string;
  encoding: string;
  duplicateRows: number;
}

export interface GameNotificationHistoryItem {
  id: number;
  content: string;
  operatorName: string;
  status: "sent" | "accepted" | "failed";
  resultMessage: string;
  createdAt: string;
}

export interface RewardPoolItem {
  key: string;
  label: string;
  value: number;
}

export interface GameRewardPoolState {
  items: RewardPoolItem[];
  total: number;
  lastUpdatedBy: string;
  lastUpdatedAt: string | null;
  unexpectedKeys: string[];
}

export interface BannedPlayerItem {
  playerId: string;
  loginName: string;
  accountName: string;
  name: string;
  role: string;
  reason: string;
  agentId: string;
  roomId: number;
  clientVersion: string;
  registrationTime: string;
  lastLoginAt: string | null;
  bannedBy: string;
  bannedAt: string | null;
}

export interface BannedPlayersResponse {
  items: BannedPlayerItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AntiTheftAccountItem {
  registrationId: number;
  playerId: string;
  loginName: string;
  name: string;
  enabled: boolean;
  deviceMasked: string;
  devicePlatform: "android" | "ios" | "web" | "";
  deviceVersion: number;
  boundAt: string | null;
  bindingRevision: number;
  registrationAt: string;
  lastLoginAt: string | null;
  stateHealthy: boolean;
}

export interface AntiTheftAccountsResponse {
  items: AntiTheftAccountItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PlayerBalanceAdjustmentResult {
  player: { playerId: string; name: string; gold: number; gold2: number; balance: number; roomId: number };
  delta: number;
  workOrder: string;
  message: string;
}

export interface CurrentRoomPlayer {
  playerId: string;
  name: string;
  balance: number;
  clientStatus: string;
}

export interface CurrentRoomItem {
  roomId: number;
  roomType: string;
  playerCount: number;
  players: CurrentRoomPlayer[];
}

export interface CurrentRoomsResponse {
  available: boolean;
  items: CurrentRoomItem[];
  total: number;
  playerCount: number;
  source: string;
  message: string;
  refreshedAt: string;
}

export interface PlayerOptimizationItem {
  playerId: string;
  loginName: string;
  name: string;
  managerId: string;
  managerName: string;
  configuredBy: string;
  configuredSource: "admin" | "game" | "hidden" | "";
  remainingCount: number;
  chance: number;
  active: boolean;
  lastConfiguredAt: string;
}

export interface PlayerOptimizationSummary {
  activePlayers: number;
  totalRemaining: number;
  averageChance: number;
}

export interface PlayerOptimizationsResponse {
  items: PlayerOptimizationItem[];
  page: number;
  pageSize: number;
  total: number;
  summary: PlayerOptimizationSummary;
}

export interface PaymentChannelConfig {
  name: string;
  enabled: boolean;
  needsInfo: boolean;
  infoFields: string[];
  presetAmounts: string;
  displayText: string;
  banks: string;
  allowCustom: boolean;
  customMin: string;
  customMax: string;
  configured: boolean;
  encodingError: boolean;
}

export interface PaymentConfigurationState {
  channels: PaymentChannelConfig[];
  paymentDomain: string;
  requireBankBranch: boolean;
  alipayWithdrawalText: string;
  unionWithdrawalText: string;
  usdtWithdrawalText: string;
  revision: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string | null;
}

export interface ActivityItemState {
  code: string;
  name: string;
  enabled: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  rewardRule: string;
  allowClaim: boolean;
  rankLimit: number;
  playerText: string;
}

export interface ActivityPowerState {
  one: string;
  two: string;
  five: string;
  ten: string;
  twenty: string;
}

export interface ActivityConfigurationState {
  enabled: boolean;
  activities: ActivityItemState[];
  handRankPower: ActivityPowerState;
  revision: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string | null;
}

export interface UserItem {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  isSuper: boolean;
  status: Status;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RoleItem {
  id: number;
  code: string;
  name: string;
  description: string;
  status: Status;
  isSystem: boolean;
  userCount: number;
  permissionIds: number[];
}

export interface AuditItem {
  id: number;
  operatorName: string;
  action: string;
  targetType: string;
  targetId: string;
  resultCode: number;
  resultMessage: string;
  ip: string;
  createdAt: string;
}

export interface PlayerItem {
  id: number;
  playerId: string;
  loginName: string;
  accountName: string;
  name: string;
  photo: string;
  sex: string;
  role: string;
  gold: number;
  gold2: number;
  balance: number;
  stone: number;
  level: number;
  vip: number;
  vipLevel: number;
  agentId: string;
  agentName: string;
  bigAgentId: string;
  partnerAgentId: string;
  chiefAgentId: string;
  roomId: number;
  roomType: string;
  clientVersion: string;
  clientStatus: string;
  totalRounds: number;
  totalScore: number;
  registrationTime: string;
  lastLoginAt: string | null;
  loginCount: number;
  remark: string;
  optimizeOneCount: number;
  optimizeOneChance: number;
  optimizeTwoCount: number;
  optimizeTwoChance: number;
}

export interface PlayerRoomSummary {
  roomCount: number;
  roundsPlayed: number;
  winRooms: number;
  lossRooms: number;
  drawRooms: number;
  totalBuyIn: number;
  totalSettlementReturn: number;
  netScore: number;
}

export interface PlayerRoomHistoryItem {
  id: number;
  roomId: string;
  roomName: string;
  playMode: string;
  creatorName: string;
  creatorId: string;
  recordedAt: string;
  startedAt: string;
  endedAt: string;
  seat: number;
  roomRoundCount: number;
  roundsPlayed: number;
  totalBuyIn: number;
  settlementReturn: number;
  recordedScore: number;
  score: number;
  scoreSource: "settlement" | "record";
  scoreMismatch: boolean;
  result: "win" | "loss" | "draw";
}

export interface PlayerRoomHistoryResponse {
  items: PlayerRoomHistoryItem[];
  summary: PlayerRoomSummary;
  page: number;
  pageSize: number;
  total: number;
}

export interface AgentSummary {
  totalCount: number;
  bossCount: number;
  leaderCount: number;
  agentCount: number;
  linkedCount: number;
}

export interface AgentItem {
  id: number;
  agentId: string;
  loginName: string;
  name: string;
  level: number;
  role: string;
  type: "boss" | "leader" | "agent" | "partner" | "chief" | "player";
  parentId: string;
  parentName: string;
  marketingParentId: string;
  accountParentId: string;
  bigPercent: number;
  superPercent: number;
  isBoss: boolean;
  isLeader: boolean;
  isPartner: boolean;
  isChief: boolean;
  directAgentCount: number;
  directPlayerCount: number;
  storedLowerCount: number;
  todayLowerCount: number;
  registeredProxyAt: string;
  accountRegisteredAt: string;
  secondParentId: string;
  thirdParentId: string;
  smallLeaderId: string;
  bigLeaderId: string;
  partnerId: string;
  chiefId: string;
  unlimitedParents: string;
  chainState: "root" | "linked" | "broken" | "conflict";
}

export interface AgentChainNode {
  agentId: string;
  name: string;
  type: AgentItem["type"];
  level: number;
  role: string;
  parentId: string;
  bigPercent: number;
  superPercent: number;
}

export interface AgentTierRelation {
  key: string;
  name: string;
  agentId: string;
  agentName: string;
}

export interface AgentRelationship {
  agent: AgentItem;
  chain: AgentChainNode[];
  chainState: "healthy" | "root" | "broken" | "cycle" | "conflict" | "depth_limit";
  chainMessage: string;
  tiers: AgentTierRelation[];
}

export interface AgentChildItem {
  id: number;
  playerId: string;
  loginName: string;
  name: string;
  level: number;
  role: string;
  type: AgentItem["type"];
  parentId: string;
  parentName: string;
  depth: number;
  isAgent: boolean;
  bigPercent: number;
  superPercent: number;
  storedLowerCount: number;
  registeredProxyAt: string;
}

export interface AgentChildrenResponse {
  items: AgentChildItem[];
  page: number;
  pageSize: number;
  total: number;
  agentCount: number;
  playerCount: number;
  maxDepth: number;
  truncated: boolean;
}

export interface AgentBonusSummary {
  totalBonus: number;
  withdrawnBonus: number;
  remainingBonus: number;
  incomeSourceTotal: number;
  incomeSourceCount: number;
  withdrawalRecordTotal: number;
  withdrawalRecordCount: number;
  unrecordedWithdrawal: number;
  accountBalanceMatches: boolean;
  incomeSourcesMatchTotal: boolean;
}

export interface AgentBonusItem {
  id: string;
  type: "income" | "withdrawal";
  occurredAt: string;
  date: string;
  time: string;
  amount: number;
  sourceType: string;
  sourceDescription: string;
  sourcePlayerId: string;
  sourcePlayerName: string;
  roomId: string;
  roomName: string;
  sourceBase: number;
  rate: number;
  sourceLevel: string;
}

export interface AgentBonusResponse {
  agentId: string;
  agentName: string;
  summary: AgentBonusSummary;
  items: AgentBonusItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TransactionPlayer {
  playerId: string;
  loginName: string;
  name: string;
  currentBalance: number;
  totalRecords: number;
}

export interface TransactionSummary {
  recordCount: number;
  totalIn: number;
  totalOut: number;
  netChange: number;
  gameNet: number;
  itemSpend: number;
  firstAt: string;
  lastAt: string;
}

export interface TransactionOptionType {
  name: string;
  count: number;
}

export interface TransactionItem {
  id: number;
  occurredAt: string;
  date: string;
  time: string;
  playerName: string;
  playerId: string;
  optionType: string;
  category: "game" | "item" | "consumption" | "adjustment" | "other";
  direction: "in" | "out" | "unchanged";
  oldBalance: number;
  businessAmount: number;
  newBalance: number;
  change: number;
  remark1: string;
  remark2: string;
  remark3: string;
  remark4: string;
  remark5: string;
  maintenanceReason: string;
  maintenanceOperator: string;
  maintenanceWorkOrder: string;
}

export interface TransactionResponse {
  player: TransactionPlayer;
  summary: TransactionSummary;
  optionTypes: TransactionOptionType[];
  items: TransactionItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface RoomRecordOverview {
  roomId: string;
  roomName: string;
  startedAt: string;
  endedAt: string;
  roundCount: number;
  playerCount: number;
  totalBuyIn: number;
  totalWin: number;
  totalLoss: number;
  scoreBalance: number;
  jackpot: string;
  baseRule: string;
  mangoRule: string;
  durationRule: string;
  settlementRule: string;
  isDijiuKing: boolean;
}

export interface RoomRecordListItem {
  roomId: string;
  roomName: string;
  isDijiuKing: boolean;
  recordedAt: string;
  startedAt: string;
  endedAt: string;
  roundCount: number;
  playerCount: number;
  totalBuyIn: number;
  participants: string[];
}

export interface RoomRecordListResponse {
  items: RoomRecordListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface RoomRecordPlayer {
  id: number;
  playerId: string;
  playerName: string;
  seat: number;
  score: number;
  recordedScore: number;
  settlementReturn: number;
  scoreSource: "settlement" | "record";
  scoreMismatch: boolean;
  result: "win" | "loss" | "draw";
  totalBuyIn: number;
  roundsPlayed: number;
  joinedAt: string;
  leftAt: string;
}

export interface RoomRecordRound {
  round: number;
  playedAt: string;
  playerCount: number;
  totalWin: number;
  totalLoss: number;
  netScore: number;
  actionCount: number;
}

export interface RoomRecordCard {
  suit: number;
  rank: number;
}

export interface RoomRecordRoundPlayer {
  id: number;
  playerId: string;
  playerName: string;
  seat: number;
  score: number;
  result: "win" | "loss" | "draw";
  playedAt: string;
  state: string;
  role: string;
  betScore: number;
  mangoScore: number;
  remainingMango: number;
  cards: RoomRecordCard[];
  dealtCards: RoomRecordCard[];
  revealFlags: string;
  poolScore: number;
  compensation: string;
}

export interface RoomRecordAction {
  id: number;
  occurredAt: string;
  playerId: string;
  playerName: string;
  seat: number;
  stage: number;
  action: string;
  actionScore: number;
  remainingScore: number;
}

export interface RoomRecordResponse {
  room: RoomRecordOverview;
  players: RoomRecordPlayer[];
  rounds: RoomRecordRound[];
}

export interface RoomRecordRoundResponse {
  roomId: string;
  round: number;
  players: RoomRecordRoundPlayer[];
  actions: RoomRecordAction[];
}
