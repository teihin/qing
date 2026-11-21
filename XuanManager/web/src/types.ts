export type Status = "enabled" | "disabled";

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  isSuper: boolean;
  isProtectedRoot: boolean;
  totpEnabled: boolean;
}

export interface TOTPStatus {
  enabled: boolean;
  confirmedAt: string | null;
  recoveryCodesLeft: number;
}

export interface TOTPSetup {
  secret: string;
  otpauthUri: string;
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
  format: "plain-text-preserved-v1";
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

export interface GameNotificationCarouselItem {
  id: number;
  content: string;
  sortOrder: number;
}

export interface GameNotificationCarousel {
  enabled: boolean;
  intervalSeconds: number;
  startAt: string | null;
  loopCount: number;
  completedLoops: number;
  items: GameNotificationCarouselItem[];
  lastSentItemId: number | null;
  lastSentAt: string | null;
  lastStatus: "sent" | "accepted" | "failed" | "completed" | "";
  lastMessage: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string | null;
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

export interface RewardPoolControlItem {
  key: string;
  label: string;
  baseRewardRate: number | null;
  tierNoRewardRate: number;
  estimatedActualRewardRate: number | null;
  platformRetentionYuan: number | null;
}

export interface RewardPoolControlValues {
  rewardRates: Record<string, number>;
  globalNoRewardRate: number;
  tierNoRewardRates: Record<string, number>;
  platformRetentionYuan: Record<string, number>;
}

export interface GameRewardPoolControlState {
  items: RewardPoolControlItem[];
  globalNoRewardRate: number;
  lastUpdatedBy: string;
  lastUpdatedAt: string | null;
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

export interface PlayerBanHistoryItem {
  id: number;
  playerId: string;
  loginName: string;
  accountName: string;
  name: string;
  operation: "ban" | "unban";
  reason: string;
  operatorName: string;
  success: boolean;
  resultCode: number;
  resultMessage: string;
  createdAt: string;
}

export interface PlayerBanHistoryResponse {
  items: PlayerBanHistoryItem[];
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

export interface PlayerStoneGrantResult {
  player: { playerId: string; name: string; stone: number; roomId: number };
  amount: number;
  context: string;
  verified: boolean;
  message: string;
}

export interface PlayerStoneGrantRecord {
  id: number;
  playerId: string;
  loginName: string;
  accountName: string;
  name: string;
  amount: number;
  reason: string;
  operatorName: string;
  stoneBefore: number;
  stoneAfter: number;
  context: string;
  createdAt: string;
}

export interface PlayerStoneGrantRecordsResponse {
  items: PlayerStoneGrantRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PlayerClubRef {
  clubId: string;
  name: string;
}

export interface PlayerClubMembership {
  clubId: string;
  clubName: string;
  clubStatus: string;
  clubMode: string;
  role: string;
  roleLabel: string;
  clubGold: number | null;
  upperId: string;
  upperName: string;
  chain: PlayerClubChainNode[];
}

// 玩家在该俱乐部的完整代理链：本人 → 直属上级 → … → 群主/盟主 → 大盟主。
export interface PlayerClubChainNode {
  playerId: string;
  name: string;
  role: string;
  roleLabel: string;
  upperId: string;
  isSelf: boolean;
  depth: number;
  missing: boolean;
}

export interface PlayerClubSubordinate {
  playerId: string;
  name: string;
  role: string;
  roleLabel: string;
  clubGold: number | null;
  upperId: string;
  upperName: string;
  depth: number;
}

export interface PlayerPasswordResetResult {
  playerId: string;
  message: string;
}

export interface PlayerRelationItem {
  playerId: string;
  name: string;
  /** 已绑定的个人ID靓号；未绑定或游戏服未建表时为空。 */
  prettyNo?: string;
  /** device=同设备，gps=同GPS网格，ip=同公网IP。 */
  types: string[];
  score: number;
  lastSeen: string;
}

export interface PlayerRelationsResponse {
  playerId: string;
  name: string;
  items: PlayerRelationItem[];
  total: number;
}

export interface PlayerSensitiveInfo {
  playerId: string;
  ip: string;
  gps: string;
  latitude: number | null;
  longitude: number | null;
  locationAvailable: boolean;
  locationMessage: string;
}

export interface CurrentRoomItem {
  roomId: number;
  roomType: string;
  roomName: string;
  roomStatus: string;
  gameStatus: string;
  playMode: string;
  specialRule: string[];
  roundCount: number;
  gameRound: number;
  playerCount: number;
  watcherCount: number;
  playerAndWatcherCount: number;
  inholdCount: number;
  maxNumber: number;
  clubId: string;
  clubName: string;
  creatorGuuid: string;
  creatorName: string;
  createDatetime: string;
  remark: string;
}

export interface CurrentRoomsResponse {
  available: boolean;
  items: CurrentRoomItem[];
  page: number;
  pageSize: number;
  total: number;
  playerCount: number;
  watcherCount: number;
  inholdCount: number;
  source: string;
  message: string;
  refreshedAt: string;
}

/** 房间维护：按俱乐部聚合的实时房间。 */
export interface ClubRoomGroup {
  clubId: string;
  clubName: string;
  creatorId: string;
  creatorName: string;
  creatorInviteCode: string;
  roomCount: number;
  playerCount: number;
  watcherCount: number;
  inholdCount: number;
  rooms: CurrentRoomItem[];
}

export interface ClubRoomsResponse {
  available: boolean;
  groups: ClubRoomGroup[];
  page: number;
  pageSize: number;
  totalClubs: number;
  totalRooms: number;
  playerCount: number;
  watcherCount: number;
  inholdCount: number;
  source: string;
  message: string;
  refreshedAt: string;
}

export interface TransactionBlacklistItem {
  playerId: string;
  loginName: string;
  name: string;
  agentId: string;
  roomId: number;
  exists: boolean;
}

export interface TransactionBlacklistState {
  enabled: boolean;
  items: TransactionBlacklistItem[];
  total: number;
  revision: string;
  warnings: string[];
}

export type PlayerOptimizationState = "active" | "done" | "stopped" | "";

export interface PlayerOptimizationItem {
  id: number;
  playerId: string;
  loginName: string;
  name: string;
  /** 正=让玩家赢，负=让玩家输；绝对值即输赢金额。 */
  targetValue: number;
  /** 触发概率 1~100，方向由 targetValue 决定。 */
  chance: number;
  progress: number;
  remain: number;
  roundCount: number;
  peerCount: number;
  state: PlayerOptimizationState;
  active: boolean;
  online: boolean;
  curChance: number;
  curCount: number;
  man: string;
  manName: string;
  scopeType: string;
  scopeId: string;
  groupId: number;
  groupName: string;
  setAt: string;
  finishAt: string;
  finishReason: string;
}

export interface PlayerOptimizationSummary {
  activePlayers: number;
  totalTargetAmount: number;
  averageChance: number;
}

export interface PlayerOptimizationsResponse {
  items: PlayerOptimizationItem[];
  page: number;
  pageSize: number;
  total: number;
  summary: PlayerOptimizationSummary;
}

export interface PlayerOptimizationHistoryResponse {
  items: PlayerOptimizationItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaymentChannelConfig {
  name: string;
  enabled: boolean;
  iconType: "default" | "alipay" | "unionpay" | "wechat" | "other";
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
  bankWithdrawalEnabled: boolean;
  alipayWithdrawalEnabled: boolean;
  usdtWithdrawalEnabled: boolean;
  usdtExchangeRate: string;
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
  totpEnabled: boolean;
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
  targetName: string;
  resultCode: number;
  resultMessage: string;
  ip: string;
  createdAt: string;
}

export interface ManageScopeName {
  id: string;
  name: string;
}

export interface PlayerItem {
  id: number;
  playerId: string;
  /** 已绑定的个人ID靓号；未绑定或游戏服未建表时为空。 */
  prettyNo?: string;
  loginName: string;
  accountName: string;
  /** 玩家登录密码明文（后台加密收录后解密返回）；passwordRecorded=false 表示历史密码未收录。 */
  loginPassword?: string;
  passwordRecorded?: boolean;
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
  roomId: number;
  roomType: string;
  clientVersion: string;
  clientStatus: string;
  /** 最近上报 IP 的 6 位短码，与游戏内 BOSS 弹窗同一规则。 */
  ipCode: string;
  /** 原始 IP，仅 admin999 查询时返回。 */
  ip?: string;
  /** 关联账号数量；relatedVisible=false 表示本次关联查询失败或无权查看。 */
  relatedCount: number;
  relatedVisible: boolean;
  totalRounds: number;
  totalScore: number;
  registrationTime: string;
  lastLoginAt: string | null;
  loginCount: number;
  remark: string;
  /** 大小BOSS：已配置可管理联盟（union_manage）或俱乐部（club_manage）；前端据此把整行标成浅红色。 */
  isBoss: boolean;
  /** 可管理联盟号，逗号分隔；用于配置弹窗回显。 */
  unionManage: string;
  /** 可管理俱乐部号，逗号分隔；用于配置弹窗回显。 */
  clubManage: string;
  /** 可管理联盟名称，按授权顺序；name 为空时前端回退显示 id。 */
  unionManageNames: ManageScopeName[];
  /** 可管理俱乐部名称，按授权顺序；name 为空时前端回退显示 id。 */
  clubManageNames: ManageScopeName[];
  clubs: PlayerClubRef[];
}

export interface PlayerManageScopeResult {
  playerId: string;
  unionManage: string;
  clubManage: string;
  verified: boolean;
  message: string;
  context: string;
}

export interface ManageScopeOption {
  id: string;
  name: string;
  ownerName?: string;
  clubCount?: number;
  memberCount?: number;
}

export interface ManageScopeOptions {
  unions: ManageScopeOption[];
  clubs: ManageScopeOption[];
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
  clubId: string;
  clubName: string;
  creatorId: string;
  creatorName: string;
  creatorInviteCode: string;
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
  clubId: string;
  clubName: string;
  creatorId: string;
  creatorName: string;
  creatorInviteCode: string;
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
  poolScore: number;
  mangoTotal: number;
  mangoNetTotal: number;
  mangoPool: number;
  totalBet: number;
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
  mangoPool: number;
  displayScore: number;
  mangoNet: number;
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

export interface StoneConsumePriceItemState {
  code: string;
  name: string;
  scene: string;
  stone: number;
  defaultStone: number;
  legacyMoney: number;
  legacyUnit: string;
}

export interface StoneConsumePriceState {
  items: StoneConsumePriceItemState[];
  storageKey: string;
  configured: boolean;
  clientFormat: string;
  updatedBy: string;
  updatedAt: string | null;
  missingItems: string[];
  unknownItems: string[];
  parseError: string;
}

/** 俱乐部配分模式「入座收费」的积分→钻石兑换比例（usr_hash_info 纯小数）。 */
export interface ClubSeatStoneRatioState {
  ratio: number;
  defaultRatio: number;
  configured: boolean;
  storageKey: string;
  clientContext: string;
  clientFormat: string;
  updatedBy: string;
  updatedAt: string | null;
  rowCount: number;
  duplicateRows: number;
  parseError: string;
}

/** 游戏内「游戏推广」页展示的下载地址（哈希配置 usr_hash_info.下载url）。 */
export interface PromotionDownloadURLState {
  downloadUrl: string;
  configured: boolean;
  storageKey: string;
  clientContext: string;
  updatedBy: string;
  updatedAt: string | null;
  duplicateRows: number;
  rowCount: number;
}

/** 俱乐部管理：列表项。群主由 sm_club_make 反查，代理数来自 club_invite_code_info。 */
export interface ClubListItem {
  clubId: string;
  name: string;
  status: string;
  mode: string;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  agentCount: number;
  tax: string;
  payMode: string;
  /** 旧双向结盟字段（V2 已停用），仅保留兼容。 */
  union: string;
  /** V2 联盟归属；空表示未加入联盟。 */
  unionId: string;
  unionName: string;
  /** 所属联盟的联盟池余额（分）；未加入联盟时为 null。 */
  unionPoolQuotaFen: number | null;
  /** 俱乐部当前可用额度 club_guuid_info.union_quota（分）；未加入联盟时为 null。 */
  ownerQuotaFen: number | null;
  /** 群主钻石池：俱乐部创建者账号 sm_stone（钻）；找不到群主时为 null。 */
  stonePool: number | null;
  /** 俱乐部总积分（元）：全体成员在该俱乐部积分之和；后端读取失败时为 null。 */
  totalClubGold: number | null;
  /** 开房-游戏设置里的暗抽开关：usr_hash_info 的「暗抽_俱乐部_<clubId>」。 */
  darkEnabled?: boolean;
  /** 消息页置顶 BF 聊天（官方客服）入口开关，按俱乐部维护，默认关闭。 */
  bfChatEnabled?: boolean;
  /**
   * 大厅「发现」页排行榜入口开关的生效值：独立俱乐部取「排行榜_俱乐部_<clubId>」，
   * 已入盟取「排行榜_联盟_<unionId>」。
   */
  leaderboardEnabled?: boolean;
}

export interface ClubListResponse {
  items: ClubListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 俱乐部成员节点。clubGold 为 null 表示「无该俱乐部积分数据」（服务端 -99 哨兵），
 * 与真实的 0 不同，界面必须区分，不能显示成 0。
 */
export interface ClubMemberNode {
  playerId: string;
  /** 已绑定的个人ID靓号；未绑定或游戏服未建表时为空。 */
  prettyNo?: string;
  name: string;
  role: "owner" | "agent" | "member";
  isAgent: boolean;
  upperId: string;
  upperName: string;
  clubGold: number | null;
  /** club_agent_info.quota（分）。null 表示尚未被授信，不是 0。 */
  quotaFen: number | null;
  inviteCode: string;
  note: string;
  level: number;
}

export interface ClubMemberTree extends ClubMemberNode {
  children: ClubMemberTree[];
}

export interface ClubDetailResponse {
  club: ClubListItem;
  members: ClubMemberNode[];
  roots: ClubMemberTree[];
  /** 上级缺失、指向自己或成环的成员：单独展示，不能混进树里伪造关系。 */
  orphan: ClubMemberNode[];
  warnings: string[];
}

/** 代理贡献管理：展示口径（输赢按比例调少、贡献按金额调增，各自继承）。 */
export interface AgentDisplayRule {
  scorePercent?: number | null;
  contribAdd?: number | null;
  /** self=自己设置；inherit=继承上级；default=默认值 */
  scoreSource?: string;
  contribSource?: string;
  sim?: boolean;
}

/** 代理贡献管理：成员行。金额字段为字符串，贡献单位分、输赢单位积分。 */
export interface AgentContributionNode {
  playerId: string;
  name: string;
  role: "owner" | "agent" | "member" | string;
  /** 该行所属俱乐部；盟主虚拟行是盟主自己的俱乐部，不等于父俱乐部。 */
  clubId: string;
  clubName: string;
  isAgent: boolean;
  isLeader: boolean;
  level: number;
  upperId: string;
  upperName: string;
  teamCount: string;
  todayScore: string;
  yesterdayScore: string;
  totalScore: string;
  todayScoreDisplay?: string;
  yesterdayScoreDisplay?: string;
  totalScoreDisplay?: string;
  todayContribFen: string;
  yesterdayContribFen: string;
  totalContribFen: string;
  todayContribDisplayFen?: string;
  yesterdayContribDisplayFen?: string;
  totalContribDisplayFen?: string;
  clubGold: string;
  gold: string;
  quota: string;
  status: string;
  note: string;
  darkPercent: string;
  /** 红利暗抽比例（0~100；-1=代理树未加载，游戏服未返回时为空）。 */
  bonusDarkPercent?: string;
  percent: string;
  /** 该行输赢的生效展示比例（0~100，自己优先、上级就近继承）。 */
  scorePercent: number | null;
  /** 该行贡献的生效增加额（单位分，自己优先、上级就近继承）。 */
  contribAdd: number | null;
  /** 该代理自己设置的输赢比例；null 表示没有单独设置。 */
  ownScorePercent?: number | null;
  /** 该代理自己设置的贡献增加额（分）；null 表示没有单独设置。 */
  ownContribAdd?: number | null;
  /** self=自己设置；inherit=继承上级；default=默认值；空=游戏服未返回。 */
  scorePercentSource?: "self" | "inherit" | "default" | "";
  contribAddSource?: "self" | "inherit" | "default" | "";
}

/** 查询_代理_展示数据：self/team 的原始值与展示值。 */
export interface AgentContributionDisplayData {
  agentId: string;
  clubId: string;
  metric: string;
  /** 该代理自己的设置值（未设置分别是 100 / 0）。 */
  scorePercent?: number | null;
  contribAdd?: number | null;
  /** 继承后的生效值；展示值已按该口径算好。 */
  effectiveScorePercent?: number | null;
  effectiveContribAdd?: number | null;
  /** 该代理自己的红利暗抽比例（0~100；未设置=0），不参与展示缩放。 */
  bonusDarkPercent?: number | null;
  selfRaw: Record<string, string>;
  selfDisplay: Record<string, string>;
  teamRaw: Record<string, string>;
  teamDisplay: Record<string, string>;
  available: boolean;
  message: string;
}

/** 红利暗抽比例：查询与设置共用。 */
export interface AgentContributionBonusDarkResponse {
  clubId: string;
  agentId: string;
  bonusDarkPercent: number | null;
  available: boolean;
  message: string;
}

export interface AgentContributionDisplayBatchResponse {
  clubId: string;
  items: Record<string, AgentContributionDisplayData>;
  message: string;
}

export interface AgentContributionMembersResponse {
  clubId: string;
  agentId: string;
  items: AgentContributionNode[];
  total: number;
  page: number;
  pageSize: number;
  rawAvailable: boolean;
  truncated: boolean;
  message: string;
}

export interface AgentContributionRuleResponse {
  clubId: string;
  agentId: string;
  metric: "contrib" | "score";
  rule: AgentDisplayRule;
  verified: boolean;
  message: string;
}

export interface AgentContributionRuleQueryResponse {
  clubId: string;
  agentId: string;
  metric: "contrib" | "score";
  available: boolean;
  /** 该代理自己的输赢比例 / 贡献增加额（分）。 */
  scorePercent?: number | null;
  contribAdd?: number | null;
  /** 继承后的生效值。 */
  effectiveScorePercent?: number | null;
  effectiveContribAdd?: number | null;
  rule: AgentDisplayRule;
  message: string;
}

/** 联盟管理（V2）：联盟池与关联俱乐部。 */
export interface UnionListItem {
  unionId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  ownerClubId: string;
  ownerClubName: string;
  /** 联盟池余额（分）。 */
  poolQuotaFen: number;
  /** 已分给俱乐部的额度合计（分）。 */
  totalClubQuotaFen: number;
  memberCount: number;
  status: string;
  /** 游戏库里的创建时间（北京时间墙上时间）。 */
  createdAt: string;
  /** 总群主俱乐部的开房暗抽开关：usr_hash_info 的「暗抽_俱乐部_<ownerClubId>」。 */
  darkEnabled?: boolean;
  /** 联盟所有俱乐部的大厅排行榜入口开关：usr_hash_info 的「排行榜_联盟_<unionId>」。 */
  leaderboardEnabled?: boolean;
}

export interface UnionListResponse {
  items: UnionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UnionClubItem {
  clubId: string;
  name: string;
  status: string;
  mode: string;
  ownerId: string;
  ownerName: string;
  /** 俱乐部当前可用额度（分）。 */
  quotaFen: number;
  memberCount: number;
  tax: string;
}

export interface UnionDetailResponse {
  union: UnionListItem;
  clubs: UnionClubItem[];
}

export interface UnionQuotaAdjustmentResponse {
  unionId: string;
  action: "add" | "subtract";
  poolQuotaFen: number;
  poolQuotaYuan: number;
  deltaFen: number;
  verified: boolean;
  message: string;
}

/** 俱乐部/联盟暗抽开关的保存结果；联盟会带回实际写入的总群主俱乐部 ID。 */
export interface DarkSettingState {
  scope: "club" | "union";
  targetId: string;
  ownerClubId?: string;
  enabled: boolean;
  verified: boolean;
  message: string;
}

/** 大厅排行榜入口开关保存结果。 */
export interface LeaderboardEntryState {
  scope: "club" | "union";
  targetId: string;
  enabled: boolean;
  verified: boolean;
  message: string;
}

/** 俱乐部 BF 聊天入口开关保存结果。 */
export interface BFChatState {
  clubId: string;
  enabled: boolean;
  verified: boolean;
  message: string;
}

/** 联盟/俱乐部收益对账（暗抽、奖池）。 */
export type OwnerEarningsKind = "dark" | "jackpot";

export interface OwnerEarningsClubRef {
  clubId: string;
  clubName: string;
  status: string;
  ownerId: string;
  ownerName: string;
}

export interface OwnerEarningsTarget {
  scope: "union" | "club";
  unionId: string;
  unionName: string;
  clubId: string;
  clubName: string;
  ownerId: string;
  ownerName: string;
  ownerRole: string;
  clubOwnerId: string;
  clubOwnerName: string;
  clubs: OwnerEarningsClubRef[];
}

export interface OwnerEarningsSummary {
  amountFen: number;
  amountYuan: number;
  grossFen: number;
  grossYuan: number;
  bonusTaxFen: number;
  bonusTaxYuan: number;
  count: number;
  baseYuan: number;
  ratioPercent: number;
  averageYuan: number;
  unattributedFen: number;
  unattributedYuan: number;
  unattributedCount: number;
}

export interface OwnerEarningsDailyItem {
  date: string;
  amountFen: number;
  amountYuan: number;
  grossYuan: number;
  bonusTaxYuan: number;
  count: number;
  baseYuan: number;
  ratioPercent: number;
  averageYuan: number;
}

export interface OwnerEarningsClubItem {
  clubId: string;
  clubName: string;
  status: string;
  amountFen: number;
  amountYuan: number;
  count: number;
  baseYuan: number;
  ratioPercent: number;
}

export interface OwnerEarningsDetailItem {
  id: string;
  date: string;
  time: string;
  clubId: string;
  clubName: string;
  roomId: string;
  playerId: string;
  playerName: string;
  baseYuan: number;
  ratePercent: number;
  actualPercent: number;
  waterRate: number;
  amountFen: number;
  amountYuan: number;
  grossYuan: number;
  bonusTaxYuan: number;
  level: string;
  levelLabel: string;
  typeLabel: string;
  note: string;
}

export interface OwnerEarningsDetails {
  items: OwnerEarningsDetailItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface OwnerEarningsRateCount {
  percent: number;
  agents: number;
}

export interface OwnerEarningsDarkClub {
  clubId: string;
  clubName: string;
  status: string;
  configured: number;
  unset: number;
  rates: OwnerEarningsRateCount[];
}

export interface OwnerEarningsDarkConfig {
  configured: number;
  unset: number;
  rates: OwnerEarningsRateCount[];
  clubs: OwnerEarningsDarkClub[];
  effectivePercent: number;
  note: string;
}

export interface OwnerEarningsRetentionItem {
  key: string;
  label: string;
  yuan: number | null;
  source: string;
}

export interface OwnerEarningsPayoutItem {
  key: string;
  percent: number | null;
  source: string;
}

export interface OwnerEarningsJackpotConfig {
  poolKey: string;
  poolType: string;
  rewardOn: boolean;
  retention: OwnerEarningsRetentionItem[];
  payouts: OwnerEarningsPayoutItem[];
  source: string;
  warnings: string[];
}

export interface OwnerEarningsResponse {
  scope: "union" | "club";
  kind: OwnerEarningsKind;
  target: OwnerEarningsTarget;
  dateFrom: string;
  dateTo: string;
  filterClubId: string;
  summary: OwnerEarningsSummary;
  daily: OwnerEarningsDailyItem[];
  clubs: OwnerEarningsClubItem[];
  details: OwnerEarningsDetails;
  dark?: OwnerEarningsDarkConfig;
  jackpot?: OwnerEarningsJackpotConfig;
  warnings: string[];
}


/** 群主钻石池加/减结果；stonePool 是操作后（回读到）的钻石数量。 */
export interface ClubStonePoolAdjustmentResponse {
  clubId: string;
  ownerId: string;
  ownerName: string;
  action: "add" | "subtract";
  stonePool: number;
  delta: number;
  verified: boolean;
  message: string;
}

/** 后台 → 游戏服（8890 /hall/command）的单条调用/回包日志。 */
export interface GameCallLogEntry {
  key: string;
  time: string;
  level: string;
  kind: "call" | "result" | "error";
  tag: string;
  command: string;
  params: string;
  result: string;
  retCode: string;
  httpStatus: string;
  durationMs: string;
  error: string;
}

export interface GameCallLogState {
  entries: GameCallLogEntry[];
  file: string;
  updatedAt: string;
}

/** 俱乐部荣耀榜的三个榜；手数榜 5 个档位各占一行配置。 */
export type HonorRankType = "play" | "score" | "bonus";

/** 一行 = 一个榜的一个档位：开关 + 起止时间 + 名次奖励，服务端整行覆盖。 */
export interface HonorRankRow {
  rankType: HonorRankType;
  /** 手数榜为 1皮/2皮/5皮/10皮/20皮；赢分/红利榜为空串。 */
  dipi: string;
  /** 第 1 名起的奖励金额（元），已按逗号拆好；空数组=未配置。 */
  rewards: string[];
  activityOn: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  updateDate: string;
  updateTime: string;
  opterGuuid: string;
}

/** 榜级汇总：5 个档位一致就是开/关，不一致给 mixed 提示。 */
export interface HonorRankBoardSummary {
  rankType: HonorRankType;
  on: boolean;
  mixed: boolean;
}

/** 一个 scope（联盟 / 独立俱乐部）的荣耀榜配置（后台按 7 行聚合）。 */
export interface HonorRankState {
  scope: "club" | "union";
  targetId: string;
  clubId: string;
  activityOn: boolean;
  /** 7 行开关不一致（历史单档配置）时为真。 */
  mixedOn: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** 7 行起止时间不一致时为真。 */
  mixedSchedule: boolean;
  boards: HonorRankBoardSummary[];
  rows: HonorRankRow[];
  message: string;
}

/** 排行榜活动（后台留档的一条历史活动）。 */
export interface HonorRankActivity {
  id: number;
  scopeType: "union" | "club";
  scopeId: string;
  scopeName: string;
  title: string;
  /** on=运营开着，closed=已结束。 */
  state: "on" | "closed";
  /** 由时间推导：pending 未开始 / running 进行中 / finished 已过期 / closed 已结束。 */
  phase: "pending" | "running" | "finished" | "closed";
  activityOn: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** 提交给游戏服的榜结构（与创建请求同一份）。 */
  boards: HonorRankActivityBoard[];
  openBoards: string[];
  ranks: HonorRankActivityBoardSummary[];
  note: string;
  /** 该范围已有更新的活动时，本活动中止维护。 */
  superseded: boolean;
  createdBy: string;
  createdAt: string;
  clubId: string;
}

export interface HonorRankActivityBoard {
  rankType: HonorRankType;
  on: boolean;
  rewards: { dipi: string; list: string }[];
}

export interface HonorRankActivityBoardSummary {
  rankType: HonorRankType;
  name: string;
  on: boolean;
  rewards: string;
}

export interface HonorRankActivityListResponse {
  items: HonorRankActivity[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HonorRankActivityDetail {
  activity: HonorRankActivity;
  game: HonorRankState;
  /** 游戏服当前 7 行仍是这次活动配置。 */
  inSync: boolean;
  canEdit: boolean;
  message: string;
}

export interface HonorRankRankingRow {
  rank: number;
  playerId: string;
  name: string;
  value: number;
  /** 第 N 名的展示奖励（元）；未配置为空串。 */
  reward: string;
  /** 手数榜为 微/小/中/大，其它榜为空。 */
  remark: string;
}

export interface HonorRankRankingResponse {
  activityId: number;
  rankType: HonorRankType;
  dipi: string;
  /** 局 / 积分 / 元。 */
  unit: string;
  startDate: string;
  endDate: string;
  phase: string;
  total: number;
  page: number;
  pageSize: number;
  truncated: boolean;
  items: HonorRankRankingRow[];
  count: number;
}

export interface HonorRankScopeOption {
  id: string;
  name: string;
  note: string;
}

// ---------------------------------------------------------------- 网页支付

export interface PayChannel {
  code: string;
  name: string;
  enabled: boolean;
  presetAmounts: string[];
  requirePayer: boolean;
  /** 付款页是否给「输入其他金额」入口，默认关闭。 */
  allowCustom: boolean;
  /** 服务商硬性要求带付款人姓名，后台开关锁定为开。 */
  payerLocked?: boolean;
  minAmount: string;
  maxAmount: string;
  sortOrder: number;
}

export interface PayProvider {
  id: number;
  code: string;
  name: string;
  kind: string;
  gatewayBase: string;
  requestPrefix: string;
  merchantCode: string;
  callbackIp: string;
  remark: string;
  minAmount: string;
  maxAmount: string;
  enabled: boolean;
  sortOrder: number;
  hasSecureKey: boolean;
  channels: PayChannel[];
}

export interface PayProvidersResponse {
  items: PayProvider[];
  baseUrl: string;
  baseUrlFromEnv: boolean;
  statusLabels: Record<string, string>;
}

export interface PayOrderItem {
  id: number;
  orderNo: string;
  providerId: number;
  providerName: string;
  channelCode: string;
  channelName: string;
  amount: string;
  status: string;
  statusLabel: string;
  gamerOrderId: string;
  payUrl: string;
  playerId: string;
  playerName: string;
  operatorName: string;
  payerIp: string;
  remark: string;
  paidAt: string;
  createdAt: string;
}

export interface PayStatBucket {
  orders: number;
  paidOrders: number;
  paidAmount: string;
  successPct: string;
}

export interface PayOrderResponse {
  items: PayOrderItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: PayStatBucket;
}

export interface PayChannelStat {
  channelCode: string;
  channelName: string;
  orders: number;
  paidOrders: number;
  paidAmount: string;
}

export interface PayStatsResponse {
  today: PayStatBucket;
  yesterday: PayStatBucket;
  week: PayStatBucket;
  month: PayStatBucket;
  total: PayStatBucket;
  channels: PayChannelStat[];
  pending: number;
}

export interface PayLinkResponse {
  url: string;
  expiresAt: string;
}
