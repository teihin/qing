#!/usr/bin/env node
'use strict';

// 真实游戏客户端：一个进程只跑一个账号。
// 由 xuanagent 按指派拉起，通过 stdin/stdout 的 JSON 行通信：
//   输出：{"type":"event","eventType":"LoginSucceeded","payload":{…},"roomId":0,"roundId":""}
//         {"type":"log","level":"info","message":"…"}
//   输入：{"cmd":"stop"|"pause"|"resume"}
// 账号与密码只从环境变量取，绝不打印到 stdout/stderr。

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const vm = require('vm');

// 每个机器人一份「原始游戏消息」日志：排查问题时直接看这个文件，不用再靠截图。
// 目录可用 XUAN_GAME_LOG_DIR 覆盖；按账号 + 日期分文件，老文件不自动删（运营自己清理）。
const GAME_LOG_DIR = process.env.XUAN_GAME_LOG_DIR || '/tmp/xuanagent-game';
let gameLogStream = null;
let gameLogDay = '';

function gameLog(name, args) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (!gameLogStream || day !== gameLogDay) {
      fs.mkdirSync(GAME_LOG_DIR, { recursive: true });
      const account = String((cfg && cfg.account) || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_');
      gameLogStream = fs.createWriteStream(path.join(GAME_LOG_DIR, account + '-' + day + '.log'), { flags: 'a' });
      gameLogDay = day;
    }
    gameLogStream.write(JSON.stringify({ t: new Date().toISOString(), name, args }) + '\n');
  } catch (error) {
    // 写日志失败不能影响牌局
  }
}

// Node 自带的 WebSocket 是 undici 实现，对 KBEngine 的握手回包（未请求的
// Sec-WebSocket-Protocol: WebManagerSocket）判失败，浏览器和原生引擎都容忍。
// 这里换成自带的最小实现，其余接口与浏览器一致，SDK 无感。
global.WebSocket = require('./wsclient');

const SDK_DIR = process.env.XUAN_KBE_DIR || path.join(__dirname, 'sdk');
const strategy = require('./strategy');

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

const cfg = {
  account: env('XUAN_ROBOT_ACCOUNT', ''),
  password: env('XUAN_ROBOT_PASSWORD', ''),
  terminalNo: env('XUAN_TERMINAL_NO', 'T0'),
  robotId: Number(env('XUAN_ROBOT_ID', '0')),
  clubId: String(env('XUAN_CLUB_ID', '')).trim(),
  // 上次所在的房间：登录后先回这个房（留座还在就直接继续打，不重新找房/预坐）。
  resumeRoomId: Number(env('XUAN_RESUME_ROOM', '0')) || 0,
  inviteCode: String(env('XUAN_INVITE_CODE', '')).trim(),
  joinStatus: env('XUAN_JOIN_STATUS', 'unassigned'),
  // 只登录激活：后台给还没登录过的账号分的临时终端，登录成功就退出，不进房。
  loginOnly: env('XUAN_LOGIN_ONLY', '0') === '1',
  buyinMultiple: Math.max(1, Math.min(10, Number(env('XUAN_BUYIN_MULTIPLE', '1')) || 1)),
  startPaused: env('XUAN_START_PAUSED', '0') === '1',
  // 与原生客户端一致：默认直连游戏服 IP:端口、明文 ws
  // （客户端 GameDef.IS_USE_WSS=false，WSS 代理只给浏览器页面用）。
  // 需要走 WSS 代理时才设 XUAN_GAME_WSS=1（可另给 XUAN_GAME_WSS_PROXY）。
  host: env('XUAN_GAME_HOST', '154.37.155.17'),
  port: Number(env('XUAN_GAME_PORT', '20013')),
  wss: env('XUAN_GAME_WSS', '0') === '1',
  // BaseApp 地址：原生客户端用 BASE_SERVER_IP 强制指定，登录服下发的域名/LB 地址不用。
  baseAppIP: String(env('XUAN_GAME_BASE_IP', '')).trim(),
  wssProxy: String(env('XUAN_GAME_WSS_PROXY', '')).trim(),
  // 登录身份：与真机一致地带上设备指纹（platform + device_id），后台防盗号按设备记。
  devicePlatform: env('XUAN_DEVICE_PLATFORM', 'web'),
  // 设备码：worker 集群统一一个值（不是按账号、也不是按机器算的），
  // 保证任何 worker 在任何机器上都能登录任何机器人；临时要用别的值可用 XUAN_DEVICE_ID 覆盖。
  deviceId: String(env('XUAN_DEVICE_ID', '')).trim(),
  clientVersion: Number(env('XUAN_CLIENT_VERSION', '1')) || 1,
  roomRetryMs: Number(env('XUAN_ROOM_RETRY_MS', '15000')),
  sitTimeoutMs: Number(env('XUAN_SIT_TIMEOUT_MS', '12000')),
  autoAction: env('XUAN_AUTO_ACTION', '1') !== '0',
  // 配牌 click（多人代打接口 §2.3）：0 不申请；1~8 软模式、11~18 严格、98/99 最大。
  pairClick: Number(env('XUAN_PAIR_CLICK', '0')) || 0,
  // 只进的底皮档位（后台投放时设置），空数组表示不限。
  roomPi: String(env('XUAN_ROOM_PI', '')).split(',').map(normalizePi).filter(Boolean),
  // 是否允许进「等待中/准备中」的房间：默认 false，只进已经开局的房间。
  allowWaitingRoom: env('XUAN_ALLOW_WAITING_ROOM', '0') === '1',
  // 进房身份：默认观战（进房后找空座再坐下），个别房间需要别的身份时再覆盖。
  enterRule: env('XUAN_ENTER_RULE', '观战'),
  // 座位被收回后等这么久再抢座：刚丢座时座位表还在刷新，立刻抢容易撞失败。
  reinstateDelayMs: Math.max(1000, Number(env('XUAN_REINSTATE_DELAY_MS', '3000')) || 3000),
  // 打完一轮离开的房间在这段时间内不再进；期间没有别的房就等着，过期后允许回原房。
  roomAvoidMs: Math.max(60000, Number(env('XUAN_ROOM_AVOID_MS', '600000')) || 600000),
  // 结算时已超目标，允许在原房继续带入「输」的次数；用完才离房换桌。
  stayBuyinTimes: Math.max(0, Number(env('XUAN_STAY_BUYIN_TIMES', '2')) || 0),
  // 真机身份：GPS 登录后上报；输赢目标是「时间范围内累计净分」的目标，0 表示不控制。
  gps: String(env('XUAN_GPS', '')).trim(),
  // 俱乐部金币：带入从这里扣，账号自己的金币不作数（有俱乐部时）。
  clubGold: Number(env('XUAN_CLUB_GOLD', '0')) || 0,
  profitMode: String(env('XUAN_PROFIT_MODE', '')).trim(),
  profitTarget: Number(env('XUAN_PROFIT_TARGET', '0')) || 0,
  netToday: Number(env('XUAN_NET_TODAY', '0')) || 0,
  netPeriod: Number(env('XUAN_NET_PERIOD', '0')) || 0,
  periodStart: String(env('XUAN_PERIOD_START', '')).trim(),
  periodEnd: String(env('XUAN_PERIOD_END', '')).trim(),
  // 后台策略原文（整份 JSON）：业务参数与打牌阈值都在里面，没配的项走默认值。
  strategy: null,
};

// 后台策略优先于独立环境变量：给了值就覆盖，没给就保持原样。
// 策略只带「动作与智力」，进哪些房间、输赢目标由投放写进机器人配置，不从这里来。
function applyStrategyOverrides(input) {
  if (!input || typeof input !== 'object') return [];
  const changed = [];
  if (Number(input.buyinMultiple) > 0) {
    const value = Math.max(1, Math.min(10, Number(input.buyinMultiple)));
    if (value !== cfg.buyinMultiple) changed.push('带入倍数 ' + value);
    cfg.buyinMultiple = value;
  }
  if (Number(input.roomRetryMs) >= 1000) cfg.roomRetryMs = Number(input.roomRetryMs);
  if (typeof input.allowWaitingRoom === 'boolean') cfg.allowWaitingRoom = input.allowWaitingRoom;
  if (Number(input.sitTimeoutMs) >= 1000) cfg.sitTimeoutMs = Number(input.sitTimeoutMs);
  if (Number(input.reinstateDelayMs) >= 1000) cfg.reinstateDelayMs = Number(input.reinstateDelayMs);
  if (Number(input.roomAvoidMs) >= 60000) cfg.roomAvoidMs = Number(input.roomAvoidMs);
  if (Number.isFinite(Number(input.stayBuyinTimes)) && Number(input.stayBuyinTimes) >= 0) {
    cfg.stayBuyinTimes = Number(input.stayBuyinTimes);
  }
  // 打牌阈值整份留着，取值时由 strategy.mergeTuning 兜默认值。
  cfg.strategy = input;
  return changed;
}

// 设备码：整个 worker 集群共用同一个值，跟机器、节点、终端号、账号都无关。
// 这样任何一台 worker 都能接手任何机器人（后台绑定值见 robotDeviceFleetID，改一处要同步）。
if (!cfg.deviceId) {
  cfg.deviceId = 'xuanagent-worker-fleet-v1';
}

const strategyEnv = (() => {
  const raw = String(process.env.XUAN_STRATEGY || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
})();
if (strategyEnv) applyStrategyOverrides(strategyEnv);

if (!cfg.account || !cfg.password) {
  process.stderr.write('缺少 XUAN_ROBOT_ACCOUNT / XUAN_ROBOT_PASSWORD，无法登录\n');
  process.exit(2);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function emit(eventType, payload, extra) {
  send({
    type: 'event',
    eventType,
    payload: payload || {},
    roomId: extra && extra.roomId ? Number(extra.roomId) : 0,
    roundId: (extra && extra.roundId) || '',
  });
}

function log(level, message) {
  send({ type: 'log', level, message: String(message) });
}

// SDK 里大量 console.log；stdout 是 JSON 行协议通道，必须改道，否则会污染解析。
console.log = (...args) => log('debug', args.map((item) => String(item)).join(' '));
console.info = console.log;

// 决策日志按「同一句 + 3 秒内」去重：牌桌消息会重复下发，不去重会把后台日志刷满。
const logSeen = new Map();
function terminalLog(level, message, extra) {
  const text = String(message || '').trim();
  if (!text) return;
  const now = Date.now();
  const seenAt = logSeen.get(text) || 0;
  if (now - seenAt < 3000) return;
  logSeen.set(text, now);
  if (logSeen.size > 200) {
    for (const [key, at] of logSeen) {
      if (now - at > 30000) logSeen.delete(key);
    }
  }
  log(level, text);
  send({
    type: 'event',
    eventType: 'TerminalLog',
    payload: Object.assign({ level, message: text }, extra || {}),
    roomId: state.roomId ? Number(state.roomId) : 0,
    roundId: state.lastRoundId || '',
  });
}

// ---- 加载游戏自带 SDK（kbengine.js 是裸脚本，必须直接执行） ----

global.window = global;
global.cc = {
  sys: {
    localStorage: {
      _d: {},
      getItem(key) { return this._d[key] === undefined ? null : this._d[key]; },
      setItem(key, value) { this._d[key] = String(value); },
      removeItem(key) { delete this._d[key]; },
    },
    isNative: false,
  },
};

const moduleCache = new Map();
function loadModule(file) {
  const abs = path.resolve(file);
  if (moduleCache.has(abs)) return moduleCache.get(abs).exports;
  const module = { exports: {} };
  moduleCache.set(abs, module);
  const wrapper = vm.runInThisContext(
    '(function (require, module, exports, __filename, __dirname) {' + fs.readFileSync(abs, 'utf8') + '\n})',
    { filename: abs },
  );
  const dir = path.dirname(abs);
  const req = (name) => {
    if (name === 'kbengine') return global.KBEngine;
    if (/GameDataManager/.test(name)) {
      return { default: { getInstance: () => ({ dtLastSend: 0, dtLastSuccess: 0 }) } };
    }
    return loadModule(path.resolve(dir, name));
  };
  wrapper(req, module, module.exports, abs, dir);
  return module.exports;
}

try {
  vm.runInThisContext(fs.readFileSync(path.join(SDK_DIR, 'kbengine.js'), 'utf8'), { filename: 'kbengine.js' });
  loadModule(path.join(SDK_DIR, 'Account.js'));
  loadModule(path.join(SDK_DIR, 'Item.js'));
} catch (error) {
  process.stderr.write('加载 KBEngine SDK 失败：' + error.message + '\n');
  process.exit(2);
}

const KBEngine = global.KBEngine;
KBEngine.INFO_MSG = (...args) => log('debug', args.join(' '));
// SDK 对未实现的协议会刷几十条 no implement，对登录和进房没有意义。
KBEngine.WARNING_MSG = (...args) => {
  const text = args.join(' ');
  if (text.includes('no implement')) return;
  log('warn', text);
};
KBEngine.ERROR_MSG = (...args) => log('error', args.join(' '));

// ---- 状态 ----

const state = {
  stage: 'boot', // boot -> logging -> hall -> room -> seated
  account: null,
  guuid: '',
  nickname: '',
  gold: 0,
  roomId: 0,
  seatNo: -1,
  minBuyin: 0,
  roomSetting: '',
  roomRound: 0,
  lastRoundId: '',
  settledRound: 0,
  pairAppliedRound: -1,
  roomInfoRound: -1,
  roomInfoDenied: false,
  presitSeat: -1,
  presitOk: false,
  sitSent: false,
  seated: false,
  paused: cfg.startPaused,
  stopping: false,
  // 排空：收到 drain 后打完手里这一局再退出，别在半局里离桌。
  draining: false,
  joinRequested: false,
  joinAttempts: 0,
  clubJoined: false,
  // 俱乐部模式：房间不结束，只有「倒计时到 → 全员结算 → 钱回身 → 重新带入」的循环。
  // 人仍在座位上（留座状态），所以这里不是「离座」。
  enterOk: false,
  roomWaitRounds: 0,
  reinstateAt: 0,
  reinstateCount: 0,
  siteCountdown: '0',
  // 自己在桌面上的带入分（PlayerList 的 init_money / begin_score）。
  selfBeginScore: 0,
  // 刚打完一轮的房间：roomId -> 避让到期时间。期内优先进别的房，过期才允许回去。
  avoidRooms: new Map(),
  // 结算时已超目标：留在原房继续带入来输，最多 cfg.stayBuyinTimes 次。
  needBuyin: false,
  buyinAt: 0,
  stayBuyinCount: 0,
  // 同一轮结算可能同时有 is_exit 和 PromptInfo 两个信号，按时间戳只处理一次。
  settleHandledAt: 0,
  lastTurnAt: 0,
  lastDecisionAt: 0,
  captureId: 100,
  lastActionCapture: 0,
  actionTimer: null,
  timers: new Set(),
  // 牌局与策略状态：手牌/跟注/底池/余额都按服务端下发的字段维护。
  role: '',
  hand: [],
  handCount: 0,
  genScore: 0,
  mangAmount: 0,
  mangTimes: 0,
  buyInMin: 0,
  buyInMax: 0,
  buyInDefault: 0,
  buyInStep: 0,
  beicount: 0,
  money: 0,
  betUnits: [],
  table: [],
  roundPlan: null,
  plannedRound: 0,
  addMore: false,
  // 输赢控制：服务端净分是权威基线，本地只累加「还没被服务端净值吸收」的结算增量。
  netPending: 0,
  winStreak: 0,
  loseStreak: 0,
  gpsReported: '',
  // 牌桌快照：座位信息来自 PlayerList，手牌来自 查询_房间_游戏_信息 的 take_pai。
  // 与策略用的 state.table 分开存，避免影响出牌拆分。
  players: [],
  // PlayerList 的原始行（含 id=init 的空座占位），找座位要用它。
  rawPlayers: [],
  sitRetry: 0,
  presitAt: 0,
  tableSeats: [],
  tableSettleRound: 0,
  tableInfoRound: 0,
  // 房间快照：房号/状态/底皮来自选房结果，观战名单来自 获取_游戏内旁观_信息_命令。
  roomMeta: null,
  roomGameStatus: '',
  spectators: [],
  spectatorCount: 0,
  spectatorSentAt: 0,
  spectatorDenied: false,
  lastTableSig: '',
  roomPollSeq: 0,
  // 余额不足：停下坐下动作并报警，等后台补分后自动恢复（不刷服务端错误码）。
  fundShortage: false,
  fundNeed: 0,
  fundGold: 0,
  fundRejects: 0,
  fundRetryAt: 0,
  fundTimer: null,
  fundAlertAt: 0,
  // 服务端嫌带入少时按候选档次逐级试：min、2×、4×、余额一半、全部余额。
  // 用完还不行说明不是「钱少」的问题（或房间要求超出余额），转报警等补分。
  buyinTry: 0,
  lastSitMoney: 0,
  sitAttempted: false,
  // 服务端最近一条提示（用来区分 770 到底是「缺钱」还是「座位被占」）。
  lastPromptText: '',
  lastPromptAt: 0,
  // 本房已经试过、坐不进去的座位（座位被占/预坐被拒），换房时清空。
  badSeats: new Set(),
  // 每个座位的只读视图（key=座位号）：跟真实客户端「每人一个 PlayerCtl 对象」对应。
  seatViews: {},
  guuidMissingAt: 0,
  // 等座位表的起点与防重入定时器（座位表没到时每秒求一次列表）。
  seatWaitSince: 0,
  // 正在等待回包的请求（保证串行：预坐 → 512 → 带入 → 512）
  pendingReq: null,
  // 当前房间的 club_id（来自 PlayerList），带入报文必须带这个。
  roomClubId: '',
  // 服务端已确认人就在座上（回过「玩家已经坐下/已有留座位置」）：不再发坐下请求。
  seatConfirmed: false,
  presitWaitAt: 0,
  // 769 之后是否已经试过「最低带入 + 申请」的回退组合
  sitFallbackTried: false,
  // 等待补芒回包的目标座位（-1 表示没有待发的预坐）
  presitSeatWant: -1,
  enterAt: 0,
  seatWaitTimer: null,
  lastPlayerListReqAt: 0,
  // 轮到我但还没出牌的时间戳（0 表示没有待处理的动作）。
  pendingActionAt: 0,
  // 已经处理过「留座回座」（避免每张座位表都发一次回座事件）。
  resumedSeat: false,
  // 最近一次收到牌局动静的时间（房间散了但服务端不推事件时用来兜底离房）。
  lastTableAt: 0,
  // 当前决策窗口的标识与已经出过牌的窗口。
  // 服务端第二圈（摸第三张牌）不会再发「决策_信息_消息」，captureId 不变，
  // 所以按 captureId 去重会把第二圈挡掉；改用「状态 + 计次 + 座位」标识每个窗口。
  turnKey: '',
  actedTurnKey: '',
  // 服务端当前状态名（用来识别「决策_看牌_状态」这类特殊决策）。
  stateText: '',
  lastLoggedState: '',
};

function later(ms, fn) {
  const timer = setTimeout(() => { state.timers.delete(timer); fn(); }, ms);
  state.timers.add(timer);
  return timer;
}

function clearTimers() {
  for (const timer of state.timers) clearTimeout(timer);
  state.timers.clear();
}

function player() {
  try {
    return KBEngine.app ? KBEngine.app.player() : null;
  } catch (error) {
    return null;
  }
}

// 几个后台/运营需要一眼看懂的登录失败码，引擎没描述时补上中文。
const LOGIN_ERROR_TEXT = {
  2563: '设备校验未通过：该账号已绑定机器人设备，只能由 Worker 登录',
};

function errorText(code) {
  const number = Number(code) || 0;
  if (LOGIN_ERROR_TEXT[number]) return LOGIN_ERROR_TEXT[number];
  try {
    return KBEngine.app.serverErr(code) || ('错误码 ' + code);
  } catch (error) {
    return '错误码 ' + code;
  }
}

// ---- 连接与登录 ----

let engineCreated = false;
function fireLogin(scene) {
  if (state.stopping) return;
  if (!engineCreated) {
    const args = new KBEngine.KBEngineArgs();
    args.ip = cfg.host;
    args.port = cfg.port;
    args.isWss = cfg.wss;
    if (cfg.wss) {
      // 只有浏览器版需要代理；直连模式不设，SDK 才会按 ip:port 直接连。
      args.wssProxyBaseURL = cfg.wssProxy || ('wss://' + cfg.host + '/ws/');
      args.wssProxyAllowedPorts = [20013, 20015, 20016, 20017, 20018, 20019];
    }
    // 与客户端一致：BaseApp 也钉在同一地址，避免登录服下发域名后跑到别的入口。
    args.defBaseAppIP = cfg.baseAppIP || cfg.host;
    KBEngine.create(args);
    engineCreated = true;
    terminalLog('info', '连接游戏服 ' + cfg.host + ':' + cfg.port + (cfg.wss ? '（wss 代理）' : '（ws 直连）'));
  }
  emit('LoginStarted', { account: cfg.account, scene });
  // 与客户端 DeviceIdentityManager.createLoginData 同结构：{version,platform,device_id,scene}。
  const loginData = JSON.stringify({
    version: cfg.clientVersion,
    platform: cfg.devicePlatform,
    device_id: cfg.deviceId,
    scene: scene === 'reconnect' ? 'reconnect' : 'login',
  });
  KBEngine.Event.fire('login', cfg.account, cfg.password, loginData);
}

function scheduleRelogin(reason) {
  if (state.stopping) return;
  // 指数退避：服务端挂了/网络断的时候不要每 3 秒猛连（4 台以上一起连会把恢复中的服务端打爆）。
  state.reloginCount = (state.reloginCount || 0) + 1;
  const delay = Math.min(3000 * Math.pow(2, Math.min(state.reloginCount - 1, 4)), 60000);
  emit('Waiting', { reason, retryInSeconds: Math.round(delay / 1000) });
  log('warn', '重连退避 ' + Math.round(delay / 1000) + ' 秒（第 ' + state.reloginCount + ' 次失败）');
  clearTimers();
  later(delay, () => fireLogin('reconnect'));
}

// ---- 真机身份：GPS ----

// 与老自动化同一取值区间（成都一带），格式与真机一致：纬度,经度。
function randomGps() {
  const lat = 30.385972 + Math.random() * (30.922928 - 30.385972);
  const lng = 104.047018 + Math.random() * (104.213168 - 104.047018);
  return lat.toFixed(6) + ',' + lng.toFixed(6);
}

function currentGps() {
  const value = String(cfg.gps || '').trim();
  if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(value)) return value;
  if (value) log('warn', 'GPS 格式不合法（应为「纬度,经度」）：' + value + '，改用随机坐标');
  cfg.gps = randomGps();
  return cfg.gps;
}

// 登录后上报一次，之后每 60 秒续报，和真机客户端一致。
function reportGps(account, force) {
  if (!account || !state.guuid || state.stopping) return;
  const value = currentGps();
  try {
    account.reqSetProperty('gps', value);
  } catch (error) {
    log('warn', 'GPS 上报失败：' + (error && error.message));
    return;
  }
  if (force || state.gpsReported !== value) {
    state.gpsReported = value;
    terminalLog('info', 'GPS 已上报 ' + value);
  } else {
    log('debug', 'GPS 续报 ' + value);
  }
}

// ---- 输赢控制基线 ----

// 每日目标看 today_net，周期目标看 period_net；两者都只由服务端心跳下发。
function netBase() {
  return cfg.profitMode === 'period' ? cfg.netPeriod : cfg.netToday;
}

function currentNet() {
  return netBase() + state.netPending;
}

function todayText() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function profitText() {
  if (!cfg.profitTarget || cfg.profitMode === 'none') return '不限输赢';
  const amount = (cfg.profitTarget > 0 ? '赢 ' : '输 ') + Math.abs(cfg.profitTarget);
  const pending = state.netPending ? '（本地未入账 ' + state.netPending + '）' : '';
  const label = cfg.profitMode === 'period' ? '周期' : (cfg.profitMode === 'schedule' ? '时段' : '每日');
  return label + '目标 ' + amount + '，当前净分 ' + netBase() + pending;
}

// 服务端心跳带来的净分/目标更新：净值是权威基线，本地待记增量清零（已含在净值里）。
// 策略下发的运行参数也走这条通道，但只在真的下发时才覆盖，没给就保持原值。
function applyConfig(input) {
  if (input && input.clubGold !== undefined && input.clubGold !== null) {
    const next = Number(input.clubGold) || 0;
    if (next !== cfg.clubGold) {
      cfg.clubGold = next;
      terminalLog('info', '俱乐部金币更新为 ' + next);
    }
  }
  const previous = {
    gps: cfg.gps, mode: cfg.profitMode, target: cfg.profitTarget,
    today: cfg.netToday, period: cfg.netPeriod,
    start: cfg.periodStart, end: cfg.periodEnd,
    buyinMultiple: cfg.buyinMultiple,
    roomRetryMs: cfg.roomRetryMs, sitTimeoutMs: cfg.sitTimeoutMs,
    reinstateDelayMs: cfg.reinstateDelayMs, roomAvoidMs: cfg.roomAvoidMs,
    stayBuyinTimes: cfg.stayBuyinTimes,
    allowWaitingRoom: cfg.allowWaitingRoom,
  };
  if (typeof input.gps === 'string' && input.gps.trim()) cfg.gps = input.gps.trim();
  if (typeof input.profitMode === 'string') cfg.profitMode = input.profitMode.trim();
  if (Number.isFinite(Number(input.profitTarget))) cfg.profitTarget = Number(input.profitTarget) || 0;
  if (Number.isFinite(Number(input.todayNet))) cfg.netToday = Number(input.todayNet) || 0;
  if (Number.isFinite(Number(input.periodNet))) cfg.netPeriod = Number(input.periodNet) || 0;
  if (typeof input.periodStart === 'string') cfg.periodStart = input.periodStart.trim();
  if (typeof input.periodEnd === 'string') cfg.periodEnd = input.periodEnd.trim();

  // ---- 策略下发的运行参数与打牌阈值 ----
  // 新节点把整份策略放在 strategy 里；旧节点把参数平铺在 config 上，两种都兼容。
  if (input.strategy && typeof input.strategy === 'object') {
    applyStrategyOverrides(input.strategy);
  } else {
    applyStrategyOverrides(input);
  }

  // 净值是权威基线：只有净分本身变了才清本地待记增量，避免策略微调把未入账的分抹掉。
  if (previous.today !== cfg.netToday || previous.period !== cfg.netPeriod) {
    state.netPending = 0;
  }
  if (previous.target !== cfg.profitTarget || previous.mode !== cfg.profitMode) {
    state.roundPlan = null;
  }
  const account = player();
  if (account && (previous.gps !== cfg.gps || !state.gpsReported)) reportGps(account, true);

  const profitChanged = previous.gps !== cfg.gps || previous.mode !== cfg.profitMode || previous.target !== cfg.profitTarget
    || previous.today !== cfg.netToday || previous.period !== cfg.netPeriod
    || previous.start !== cfg.periodStart || previous.end !== cfg.periodEnd;
  if (profitChanged) terminalLog('info', '配置更新：' + profitText());

  const tuning = [];
  if (previous.buyinMultiple !== cfg.buyinMultiple) tuning.push('带入倍数 ' + cfg.buyinMultiple);
  if (previous.roomRetryMs !== cfg.roomRetryMs) tuning.push('找房间隔 ' + cfg.roomRetryMs + 'ms');
  if (previous.sitTimeoutMs !== cfg.sitTimeoutMs) tuning.push('带入确认超时 ' + cfg.sitTimeoutMs + 'ms');
  if (previous.reinstateDelayMs !== cfg.reinstateDelayMs) tuning.push('丢座重坐延迟 ' + cfg.reinstateDelayMs + 'ms');
  if (previous.roomAvoidMs !== cfg.roomAvoidMs) tuning.push('房间避让 ' + Math.round(cfg.roomAvoidMs / 60000) + ' 分钟');
  if (previous.stayBuyinTimes !== cfg.stayBuyinTimes) tuning.push('原房连输 ' + cfg.stayBuyinTimes + ' 次');
  if (previous.allowWaitingRoom !== cfg.allowWaitingRoom) tuning.push('进等待房 ' + (cfg.allowWaitingRoom ? '允许' : '禁止'));
  if (tuning.length > 0) terminalLog('info', '策略参数更新：' + tuning.join('，'));

  // 配置改成「不进等待房的房」之后，如果人正坐在一个还没开局的房间里，当场退出去重找，
  // 不能等下一轮（用户看到的就是"配置改了但还赖在等待房里"）。
  if (!cfg.allowWaitingRoom && state.stage === 'room' && state.roomId && state.roomGameStatus !== 'running') {
    terminalLog('info', '新配置不进等待中的房间，离开房间 ' + state.roomId + ' 重新找房');
    leaveRoom('配置改为不进等待房');
    emit('Waiting', { reason: '按新配置不进等待中的房间，重新找房', retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
    later(1500, () => requestRooms(player(), '按新配置重新找房'));
  }
}

// ---- 大厅与俱乐部 ----

function clubJoined(account) {
  const raw = String((account && account.club_join) || '');
  if (!cfg.clubId) return true;
  return raw.split(',').map((item) => item.trim()).includes(cfg.clubId);
}

// ---- 局号、结算与配牌 ----

// 状态名偶尔把「决策」拆成「决_策」，比对前先去掉下划线。
function isDecisionState(text) {
  return String(text || '').replace(/_/g, '').includes('决策');
}

function trackRound(roundNo, silent) {
  const value = Number(roundNo);
  if (!Number.isFinite(value) || value <= 0) return;
  state.roomRound = value;
  const roundId = state.roomId + '-' + value;
  if (roundId === state.lastRoundId) return;
  state.lastRoundId = roundId;
  state.settledRound = 0;
  // 由结算消息补记局号时不要再补发 GameStarted，否则后台会看到「结算→开始」的倒序。
  if (state.seated && !silent) {
    emit('GameStarted', { roundId, roundCount: value }, { roomId: state.roomId, roundId });
  }
}

// RoundScore 与 结算_信息_消息 都可能汇报同一局，按局号去重。
function settleRound(delta) {
  const value = Number(delta) || 0;
  if (state.roomRound <= 0) return;
  if (state.settledRound === state.roomRound) return;
  state.settledRound = state.roomRound;
  state.netPending += value;
  if (value > 0) {
    state.winStreak += 1;
    state.loseStreak = 0;
  } else if (value < 0) {
    state.loseStreak += 1;
    state.winStreak = 0;
  } else {
    state.winStreak = 0;
    state.loseStreak = 0;
  }
  const roundId = state.lastRoundId || (state.roomId + '-' + state.roomRound);
  const plan = state.roundPlan;
  emit('GameSettled', {
    roundId,
    delta: value,
    net: currentNet(),
    target: cfg.profitTarget,
    intent: plan ? plan.intent : '',
    reason: plan ? plan.reason : '',
    roomId: state.roomId,
  }, { roomId: state.roomId, roundId });
  terminalLog('info', '第 ' + state.roomRound + ' 局结算 ' + (value > 0 ? '+' : '') + value
    + '，累计净分 ' + currentNet() + ' / ' + profitText()
    + (plan ? '，本局计划 ' + plan.intent : ''));
  applyPairing(player());
  // 结算后再拉一次房间信息：牌桌快照要保留本局最终的四张手牌与得分。
  if (state.tableSettleRound !== state.roomRound) {
    state.tableSettleRound = state.roomRound;
    if (state.roomInfoDenied) {
      emitTableState(seatsCurrent(), 'settled', 'own-hand');
    } else {
      requestRoomGameInfo(player());
    }
  }
  // 排空请求等本局结算并上报完再退出：后台要看到最后一局的分数。
  if (state.draining) later(300, () => shutdown('drain'));
}

const PAIR_CLICKS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 98, 99]);

// 配牌必须在发牌前登记，所以在结算后为下一局申请（§1 / §4.1）。
function applyPairing(account) {
  if (!PAIR_CLICKS.has(cfg.pairClick) || !account || !state.roomId) return;
  if (state.roomRound <= 0 || state.pairAppliedRound === state.roomRound) return;
  state.pairAppliedRound = state.roomRound;
  account.reqGameCommand(JSON.stringify({ header: '执行检查_命令', click_count: cfg.pairClick }), 'P@执行检查_命令');
  log('info', '为下一局申请配牌 click=' + cfg.pairClick);
}

function requestRoomGameInfo(account) {
  if (!account || !state.roomId) return;
  account.reqHallCommand(JSON.stringify({
    header: '查询_房间_游戏_信息',
    room_id: state.roomId,
    context: 'xuanagent',
  }), 'P@查询_房间_游戏_信息');
}

// next_order 是类 Python 字面量字符串（§2.4.2），只能按结构切，不能当 JSON 解析。
function parseNextOrder(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  return text.replace(/^\[|\]$/g, '')
    .split(/['"]\s*,\s*['"]/)
    .map((item) => item.replace(/['"\s]/g, '').split(',').slice(0, 2).map(Number))
    .filter((card) => card.length === 2 && card.every((value) => Number.isFinite(value)));
}

// 牌值统一成 [点数类型, 数字]：类型 0♦ 1♣ 2♥ 3♠ 4 王；[0,0] 是服务端遮牌占位。
function cardList(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try { value = JSON.parse(text); } catch (error) { value = text; }
  }
  const cards = [];
  const push = (type, num) => {
    const t = Number(type);
    const n = Number(num);
    if (!Number.isFinite(t) || !Number.isFinite(n)) return;
    // [0,0] 不是垃圾数据：它是「还没翻开的暗牌」占位，真实客户端也照样塞进 handCardEx。
    // 过滤掉会让自己的 4 张变 2 张，扯牌时牌位全乱。
    cards.push([t, n]);
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item)) {
        push(item[0], item[1]);
      } else if (typeof item === 'string') {
        const parts = item.split(/[^0-9-]+/).filter(Boolean);
        if (parts.length >= 2) push(parts[0], parts[1]);
      } else if (item && typeof item === 'object') {
        push(item.type !== undefined ? item.type : item[0], item.num !== undefined ? item.num : item[1]);
      }
    }
    return cards;
  }
  if (typeof value === 'string') {
    const nums = value.match(/-?\d+/g) || [];
    for (let i = 0; i + 1 < nums.length; i += 2) push(nums[i], nums[i + 1]);
  }
  return cards;
}

function boolish(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function emitTableState(seats, phase, source, extra) {
  const round = state.roomRound;
  const payload = Object.assign({
    roomId: state.roomId,
    round,
    phase,
    source,
    ownSeat: state.seatNo,
    room: roomSnapshot(),
    seats: (seats || []).slice().sort((a, b) => a.seat - b.seat),
    updatedAt: Date.now(),
  }, extra || {});
  // 房间轮询/观战刷新会重复推送同样的内容，内容没变就不落库，避免事件表被刷屏。
  const sig = JSON.stringify({ phase: payload.phase, room: payload.room, seats: payload.seats });
  if (sig === state.lastTableSig) return;
  state.lastTableSig = sig;
  emit('TableState', payload, { roomId: state.roomId, roundId: state.lastRoundId || '' });
}

// 离房、换房时清空快照，后台不会继续展示上一桌的牌。
function resetTable(phase, source) {
  state.players = [];
  // 换桌/离房：座位视图作废，避免把上一桌别人的状态带过来。
  state.seatViews = {};
  state.tableSeats = [];
  state.tableSettleRound = 0;
  state.tableInfoRound = 0;
  state.roomGameStatus = '';
  state.spectators = [];
  state.spectatorCount = 0;
  state.lastTableSig = '';
  if (state.roomId) emitTableState([], phase, source);
}

function roomMetaOf(room) {
  if (!room) return null;
  const raw = room.raw && typeof room.raw === 'object' ? room.raw : null;
  const rules = raw && Array.isArray(raw.special_rule) ? raw.special_rule
    : (raw && raw.special_rule ? [String(raw.special_rule)] : []);
  let minutes = 0;
  for (const rule of rules) {
    const match = /(\d+)\s*分钟/.exec(String(rule));
    if (match) { minutes = Number(match[1]); break; }
  }
  return {
    roomId: Number(room.id) || 0,
    name: raw ? String(raw.room_name || raw.name || '') : '',
    pi: room.pi || '',
    maxSeats: Number(room.maxPlays) || 0,
    status: String(room.status || ''),
    playMode: raw ? String(raw.play_mode || '') : '',
    minBuyin: roomMinBuyin(raw),
    minutes,
  };
}

function roomSnapshot() {
  const meta = state.roomMeta || {};
  return {
    roomId: state.roomId || 0,
    name: meta.name || '',
    status: state.roomGameStatus || meta.status || '',
    pi: meta.pi || '',
    playMode: meta.playMode || '',
    maxSeats: Number(meta.maxSeats) || 0,
    minBuyin: Number(meta.minBuyin) || 0,
    minutes: Number(meta.minutes) || 0,
    seatedCount: (state.players || []).length,
    spectatorCount: Number(state.spectatorCount) || 0,
    spectators: (state.spectators || []).slice(0, 50),
  };
}

function currentPhase() {
  if (state.roomRound > 0 && state.settledRound === state.roomRound) return 'settled';
  if (state.roomRound > 0 || state.roomGameStatus === 'running') return 'playing';
  return 'waiting';
}

function requestSpectators(force) {
  const account = player();
  if (!account || !state.roomId || state.spectatorDenied) return;
  const now = Date.now();
  if (!force && now - state.spectatorSentAt < 10000) return;
  state.spectatorSentAt = now;
  try {
    account.reqAccountCommand(JSON.stringify({ header: '获取_游戏内旁观_信息_命令' }), 'P@获取_游戏内旁观_信息_命令');
  } catch (error) {
    log('warn', '查询观战列表失败：' + (error && error.message));
  }
}

// 没有牌局事件时也要让后台看到房间变化（有人进出、观战增减），20 秒补发一次。
// 换房时 seq 自增，旧房间残留的轮询链在下一次触发时自行结束。
// ---- 请求闸门：同一时刻只允许一个房间请求在飞，等它的回包再走下一步 ----
// 真实客户端是「点一下 → 等回包 → 再点下一处」，我们之前是一进房把查询/补芒/预坐/带入一起发，服务端就乱拒。
function setPending(name) {
  state.pendingReq = { name, at: Date.now() };
}

function clearPending(name) {
  const pending = state.pendingReq;
  if (!pending) return;
  if (!name || pending.name === name) state.pendingReq = null;
}

function pendingBusy() {
  const pending = state.pendingReq;
  if (!pending) return false;
  if (Date.now() - pending.at > 3500) { // 超时视为丢包，放行下一步
    state.pendingReq = null;
    return false;
  }
  return true;
}

function scheduleRoomPoll() {
  const seq = ++state.roomPollSeq;
  later(20000, () => {
    if (state.stopping || seq !== state.roomPollSeq) return;
    if (!state.roomId || state.stage !== 'room') return;
    requestSpectators(false);
    emitTableState(state.players.length > 0 ? seatsCurrent() : state.tableSeats, currentPhase(), 'room-poll');
    scheduleRoomPoll();
  });
}

function seatsFromPlayerList() {
  const ownHand = cardList(state.hand);
  return (state.players || []).map((item) => {
    const guuid = String(item.id || '');
    const isSelf = guuid !== '' && guuid === state.guuid;
    return {
      seat: Number(item.num) || 0,
      guuid,
      name: String(item.name || ''),
      isSelf,
      isZhuang: false,
      isAction: false,
      overType: String(item.status || ''),
      status: String(item.status || ''),
      gold: Number(item.gold) || 0,
      beiShu: 0,
      xiaZhu: 0,
      roundScore: 0,
      totalScore: 0,
      roundCount: 0,
      hand: isSelf ? ownHand : [],
      chedPai: [],
      handVisible: isSelf && ownHand.length > 0,
    };
  });
}

function seatsFromRoomInfo(payload) {
  const list = Array.isArray(payload.RoomGameInfo) ? payload.RoomGameInfo : [];
  const ownHand = cardList(state.hand);
  const seats = [];
  for (const item of list) {
    if (!item) continue;
    const guuid = String(item.guuid || '');
    if (!guuid || guuid === 'init') continue;
    const isSelf = guuid === state.guuid;
    let hand = cardList(item.take_pai);
    // take_pai 是四张原始手牌；自己摸到活牌后本地手牌更长，以本地为准。
    if (isSelf && ownHand.length > hand.length) hand = ownHand;
    const known = (state.players || []).find((one) => String(one.id) === guuid);
    seats.push({
      seat: Number(item.number) || (known ? Number(known.num) || 0 : 0),
      guuid,
      name: String(item.name || (known && known.name) || ''),
      isSelf,
      isZhuang: boolish(item.is_zhuang),
      isAction: boolish(item.is_action),
      overType: String(item.player_over_type || ''),
      status: String((known && known.status) || ''),
      gold: Number((known && known.gold) || 0),
      beiShu: Number(item.bei_shu) || 0,
      xiaZhu: Number(item.xiazhu_score) || 0,
      roundScore: Number(item.round_score) || 0,
      totalScore: Number(item.total_score) || 0,
      roundCount: Number(item.round_count) || 0,
      hand,
      chedPai: cardList(item.ched_pai),
      handVisible: hand.length > 0,
    });
  }
  return seats;
}

// 在座名单以 PlayerList 为准（能反映有人进/出座），手牌和战绩沿用最近一次房间信息。
function seatsCurrent() {
  const base = seatsFromPlayerList();
  if (state.tableSeats.length === 0) return base;
  const known = new Map(state.tableSeats.map((seat) => [seat.guuid, seat]));
  return base.map((seat) => {
    const info = known.get(seat.guuid);
    if (!info) return seat;
    return Object.assign({}, info, {
      seat: seat.seat || info.seat,
      name: seat.name || info.name,
      isSelf: seat.isSelf,
      status: seat.status || info.status,
      overType: info.overType || seat.overType,
      gold: seat.gold || info.gold || 0,
      hand: seat.isSelf ? seat.hand : info.hand,
      chedPai: info.chedPai,
      handVisible: seat.isSelf ? seat.handVisible : info.handVisible,
    });
  });
}

function onRoomGameInfo(payload) {
  if (!state.roomId) return;
  const seats = seatsFromRoomInfo(payload);
  if (seats.length === 0) return;
  state.tableSeats = seats;
  state.tableInfoRound = state.roomRound;
  const phase = currentPhase();
  emitTableState(seats, phase, 'room-info', { nextOrderCount: parseNextOrder(payload.next_order).length });
  const visible = seats.filter((seat) => seat.hand.length > 0).length;
  terminalLog('info', '牌桌快照：第 ' + state.roomRound + ' 局，' + seats.length + ' 人，'
    + visible + ' 人手牌可见（' + (phase === 'settled' ? '已结算' : '对局中') + '）');
}

// 凭邀请码直接入会（服务器文档 §4.10）：不需要管理员审批，成功后 club_join 会同步到实体。
function requestJoinClub(account) {
  if (state.joinRequested) return;
  if (!cfg.inviteCode) {
    emit('Waiting', { reason: '账号还没有加入俱乐部，且没有邀请码', clubId: cfg.clubId, retryInSeconds: 30 });
    later(30000, () => requestJoinClub(player() || account));
    return;
  }
  state.joinRequested = true;
  state.joinAttempts += 1;
  account.reqHallCommand(
    JSON.stringify({ header: '直接_加入_俱乐部', invite_code: cfg.inviteCode }),
    'p@club:join',
  );
  log('info', '凭邀请码直接加入俱乐部 ' + cfg.clubId + '（第 ' + state.joinAttempts + ' 次）');
  emit('Waiting', { reason: '凭邀请码直接加入俱乐部', clubId: cfg.clubId, retryInSeconds: 5 });
  later(5000, () => {
    if (state.stopping) return;
    const current = player();
    if (current && clubJoined(current)) {
      state.joinRequested = false;
      state.joinAttempts = 0;
      log('info', '已加入俱乐部 ' + cfg.clubId);
      afterLogin(current);
      return;
    }
    if (state.joinAttempts >= 3) {
      // 俱乐部是进房硬前置：入会没生效就绝不进房（服务端会直接拒），三十秒后再来一轮。
      state.joinRequested = false;
      state.joinAttempts = 0;
      log('warn', '三次入会都没等到 club_join 变化，本轮不进房，30 秒后重试');
      emit('Waiting', { reason: '入会尚未生效，等待后重试', clubId: cfg.clubId, retryInSeconds: 30 });
      later(30000, () => requestJoinClub(player() || current || account));
      return;
    }
    state.joinRequested = false;
    requestJoinClub(current || account);
  });
}

function requestRooms(account, reason) {
  if (state.paused || state.stopping) return;
  if (!account) return;
  state.stage = 'hall';
  log('info', '查询房间' + (reason ? '（' + reason + '）' : ''));
  if (reason) emit('Waiting', { reason, clubId: cfg.clubId, retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
  account.reqHallCommand(JSON.stringify({
    header: '查询_俱乐部_房间_信息',
    club_id: cfg.clubId,
    is_zip_result: '0',
    page: '0',
    count: '20',
    fillter_01: '',
    is_have_site: 'false',
    fillter_02: '',
    is_no_running: '0',
  }), 'P@查询_俱乐部_房间_信息');
  later(cfg.roomRetryMs, () => {
    if (state.stopping || state.paused || state.stage !== 'hall') return;
    const current = player();
    if (current) requestRooms(current, '没有可用房间，稍后重试');
  });
}

function roomRank(status) {
  const text = String(status || '');
  if (text.includes('等待') || text.includes('准备')) return 0;
  if (text.includes('游戏') || text.includes('进行')) return 1;
  return 2;
}

// 底皮在列表里可能写成「底皮1/3」「1/3」「底皮1/3 45分钟」，统一成一种写法再比。
function normalizePi(value) {
  const match = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(String(value || ''));
  return match ? '底皮' + match[1] + '/' + match[2] : '';
}

// 房间列表有两种返回：is_zip_result=1 的 9 元数组
// [房号, 状态, 剩余时间, 在座人数, 人数上限, 底皮, 时长, 房间名, 是否地九王]，
// 以及 is_zip_result=0 的命名对象（旧客户端格式）。统一成同一种结构再筛。
function parseRoom(room) {
  if (Array.isArray(room)) {
    return {
      id: Number(room[0]),
      status: room[1] == null ? '' : String(room[1]),
      plays: Number(room[3]) || 0,
      maxPlays: Number(room[4]) || 0,
      pi: normalizePi(room[5]),
      raw: null,
    };
  }
  if (!room || typeof room !== 'object') return null;
  const rules = Array.isArray(room.special_rule)
    ? room.special_rule
    : (room.special_rule ? [String(room.special_rule)] : []);
  const piRule = rules.find((rule) => String(rule).includes('底皮'));
  // 满员判定只认真正坐在座位上的人：player_list 里 id=init 的是空位占位行，
  // 把它们算进来会把「3 人 + 5 个空位」误判成满员，导致有空座的房被跳过。
  const players = Array.isArray(room.player_list)
    ? room.player_list.filter((item) => String(item && item.id) !== 'init').length
    : 0;
  return {
    id: Number(room.room_id),
    status: room.room_status == null ? '' : String(room.room_status),
    plays: players || Number(room.player_and_watcher_count) || 0,
    maxPlays: Number(room.max_number) || 0,
    pi: normalizePi(piRule || room.game_pi || ''),
    raw: room,
  };
}

function pickRoom(rooms) {
  const usable = [];
  for (const item of rooms || []) {
    const room = parseRoom(item);
    if (!room || !(room.id > 0)) continue;
    if (room.status.includes('关闭')) continue;
    // 默认只进已经开局的房间：等待/准备中的房进去也是空等，等有人开局再进。
    if (!cfg.allowWaitingRoom && (room.status.includes('等待') || room.status.includes('准备'))) continue;
    if (room.maxPlays > 0 && room.plays >= room.maxPlays) continue;
    if (cfg.roomPi.length > 0 && !cfg.roomPi.includes(room.pi)) continue;
    // 余额不够这间房的最低带入就别进：宁可去低底皮房，也别进去干等补分。
    const need = roomMinBuyin(room.raw || room);
    if (need > 0 && availableFunds(player()).value < need) continue;
    // 刚打完一轮的房在避让期内不进：优先别的桌，避让过期后自然会回来。
    if (isRoomAvoided(room.id)) continue;
    usable.push(room);
  }
  usable.sort((left, right) => roomRank(left.status) - roomRank(right.status));
  return usable[0] || null;
}

function roomMinBuyin(room) {
  const rules = room && room.special_rule;
  const list = Array.isArray(rules) ? rules : (rules ? [String(rules)] : []);
  for (const rule of list) {
    const match = String(rule).match(/最小带入\s*([0-9]+)/);
    if (match) return Number(match[1]);
  }
  return 0;
}

function enterRoom(account, room) {
  if (state.paused || state.stopping) return;
  // 不在俱乐部里房间一定进不去（服务端会拒），先回入会流程，绝不硬进。
  if (cfg.clubId && !clubJoined(account)) {
    state.stage = 'hall';
    state.clubJoined = false;
    log('warn', '当前账号不在俱乐部 ' + cfg.clubId + '，先入会再进房');
    requestJoinClub(account);
    return;
  }
  state.stage = 'room';
  state.enterOk = false;
  // 换到新房间：原房连续带入的计数和结算去重标记一起清零。
  state.stayBuyinCount = 0;
  state.needBuyin = false;
  state.buyinAt = 0;
  state.settleHandledAt = 0;
  state.roomId = Number(room.id);
  state.enterAt = Date.now();
  state.seatConfirmed = false;
  state.sitFallbackTried = false;
  state.seatNo = -1;
  state.resumedSeat = false;
  state.presitSeat = -1;
  state.presitOk = false;
  state.sitSent = false;
  state.seated = false;
  state.roomRound = 0;
  state.lastRoundId = '';
  state.settledRound = 0;
  state.pairAppliedRound = -1;
  state.roomInfoRound = -1;
  state.hand = [];
  state.handCount = 0;
  state.roundPlan = null;
  state.plannedRound = 0;
  state.addMore = false;
  state.role = '';
  state.roomMeta = roomMetaOf(room);
  resetTable('waiting', 'enter-room');
  state.minBuyin = roomMinBuyin(room.raw);
  // 换房重新判定：新房间最低带入可能更低，缺钱标记不能沿用。
  state.fundShortage = false;
  state.fundNeed = 0;
  state.fundGold = 0;
  state.fundRejects = 0;
  state.fundRetryAt = 0;
  state.fundAlertAt = 0;
  emit('Waiting', { reason: '正在进入房间 ' + state.roomId + (room.pi ? '（' + room.pi + '）' : ''), roomId: state.roomId });
  account.reqEnterRoom('Custom', state.roomId, JSON.stringify({ special_rule: cfg.enterRule, club_id: cfg.clubId }));
  scheduleRoomPoll();
  state.roomWaitRounds = 0;
  // 已经进了房只是没座位：房间本身不结束，原地等空位，反复进出只会更抢不到座。
  // 但也不能无限等，等满约 3 分钟还是没座就换房。
  function scheduleSeatCheck() {
    later(12000, checkSeated);
  }
  function checkSeated() {
    if (state.stopping || state.paused || state.seated || state.stage !== 'room') return;
    // 余额不足：留在房间里等补分，不算「等座超时」（换房解决不了没钱的问题）。
    if (state.fundShortage) {
      later(12000, checkSeated);
      return;
    }
    if (state.enterOk) {
      state.roomWaitRounds += 1;
      if (state.roomWaitRounds <= 15) {
        if (state.roomWaitRounds === 1) log('info', '已进入房间 ' + state.roomId + '，等空座中');
        scheduleSeatCheck();
        return;
      }
      log('warn', '在房间 ' + state.roomId + ' 等了约 3 分钟仍无空座，换房');
    }
    leaveRoom('enter-timeout');
    later(2000, () => requestRooms(player(), '进入房间超时，重新找房'));
  }
  scheduleSeatCheck();
}

function leaveRoom(reason) {
  const account = player();
  cancelAction();
  resetTable('waiting', 'leave-room');
  state.roomMeta = null;
  state.stage = 'hall';
  state.enterOk = false;
  state.reinstateAt = 0;
  state.seated = false;
  state.presitOk = false;
  state.sitSent = false;
  state.seatNo = -1;
  state.presitSeat = -1;
  if (state.roomId) {
    emit('RoomLeft', { reason, roomId: state.roomId });
    state.roomId = 0;
  }
  if (account) {
    try { account.reqLeaveRoom(); } catch (error) { log('warn', '离房请求失败：' + error.message); }
  }
}

// ---- 坐下与带入 ----

function currentMinBuyin() {
  const account = player();
  if (account && account.roomSetting) {
    state.roomSetting = String(account.roomSetting);
  }
  const match = state.roomSetting.match(/最小带入\s*([0-9]+)/);
  if (match) state.minBuyin = Number(match[1]);
  return state.minBuyin;
}

// 座位真的没了（留座到期被收座 / 被服务端清座 / 主动站起）才走这里。
// 一轮结算完是离房换桌，不走这条，见 leaveAfterSettle。
function resetSeat(reason) {
  state.seatConfirmed = false;
  state.seated = false;
  state.seatNo = -1;
  state.sitSent = false;
  state.presitOk = false;
  state.presitSeat = -1;
  state.presitAt = 0;
  state.reinstateAt = Date.now();
  state.reinstateCount += 1;
  // 座位都没了，本局的手牌和计划一并作废。
  state.hand = [];
  state.handCount = 0;
  state.roundPlan = null;
  state.plannedRound = 0;
  state.addMore = false;
  state.role = '';
  state.genScore = 0;
  state.beicount = 0;
  state.betUnits = [];
  // 先告诉后台「已丢座」再报等待，后台的座位号不会停在旧值上。
  emit('PlayerUnseated', { reason, reinstateCount: state.reinstateCount }, { roomId: state.roomId });
  emit('Waiting', { reason: '座位已释放，重新占座中', roomId: state.roomId });
  terminalLog('info', '已丢座（' + reason + '），重新占座（第 ' + state.reinstateCount + ' 次）');
  // 不能只等下一次座位表广播：这里主动排一次重试。
  later(cfg.reinstateDelayMs + 500, tryTakeSeat);
}

// 返回这一桌上所有「空」的座号（按座号升序）。
// 服务端会在玩家列表里用 id=init 的占位行标记空座；没下发占位行时按房间上限兜底推算。
function freeSeats(players) {
  const seats = [];
  const used = new Set();
  for (const item of players || []) {
    const num = Number(item.num);
    if (!Number.isFinite(num) || num < 0) continue;
    if (String(item.id) === 'init') {
      if (!seats.includes(num)) seats.push(num);
      continue;
    }
    used.add(num);
  }
  if (seats.length === 0) {
    // 房间座位数：优先用房间列表/房间信息的 maxSeats，取不到就从 roomSetting 的「8人」里读。
    let maxSeats = Number(state.roomMeta && state.roomMeta.maxSeats) || 0;
    if (maxSeats <= 0) {
      const match = String(state.roomSetting || '').match(/([0-9]+)\s*人/);
      if (match) maxSeats = Number(match[1]) || 0;
    }
    if (maxSeats <= 0) {
      // 实在拿不到座位数：按 8 人房算（本项目房间上限就是 8），服务端会拒没这个座号/已占的，
      // 逐个试由 badSeats 兜底，最多试一轮就换房。
      maxSeats = 8;
    }
    // 座位号 0 基：0..maxSeats-1
    for (let seat = 0; seat < maxSeats; seat += 1) {
      if (!used.has(seat)) seats.push(seat);
    }
  }
  return seats.sort((left, right) => left - right);
}

// 在房间里主动找一个空座并预坐。进房、下桌、预坐失败都靠它推进，不必等下一次座位表广播。
function tryTakeSeat() {
  if (pendingBusy()) {
    later(500, tryTakeSeat);
    return;
  }
  if (state.stopping || state.paused || state.seated) return;
  // 余额不足：不抢座、不预坐，等观察器发现补分后再来。
  if (state.fundShortage) { watchFunds(); return; }
  if (state.stage !== 'room' || !state.roomId) return;
  // 预坐阶段服务端也会按余额判；本地先按俱乐部金币挡一道，钱不够就不发请求。
  {
    const min = currentMinBuyin();
    const funds = availableFunds(player());
    if (min > 0 && funds.value < min) {
      // 进了不该进的房（列表里没带最低带入、或余额刚变）：退回大厅，按余额重新挑低底皮房；
      // 所有房都够不到时，找房那一步会在大厅等补分（markFundShortage）。
      log('warn', '房间 ' + state.roomId + ' 最低带入 ' + min + '，俱乐部金币只有 ' + funds.value + '，退回大厅换低底皮房');
      const leaving = Number(state.roomId) || 0;
      if (leaving > 0) state.avoidRooms.set(leaving, Date.now() + 90000); // 90 秒内不再回这间
      state.badSeats.clear();
      leaveRoom('funds-low-for-room');
      emit('Waiting', { reason: '余额不够本房，退回大厅找低底皮房间', retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
      later(1500, () => requestRooms(player(), '余额不足，换低底皮房'));
      return;
    }
  }
  if (Date.now() - state.reinstateAt < cfg.reinstateDelayMs) {
    // 刚丢座的几秒内座位表还在刷新，等过了再抢。
    later(cfg.reinstateDelayMs + 200, tryTakeSeat);
    return;
  }
  // 刚发过预坐请求，等回包：否则同一秒内会连着预坐 0、1、2、3 号位。
  if (state.presitAt && Date.now() - state.presitAt < 1500 && !state.seated) {
    later(600, tryTakeSeat);
    return;
  }
  if (state.seatNo < 0 && state.enterAt && Date.now() - state.enterAt < 3000) {
    // 刚进房：先等座位表把「我是几号位」确认下来。这段时间抢座必然撞到别人的/自己的座位。
    later(600, tryTakeSeat);
    return;
  }
  let players = state.rawPlayers.length > 0 ? state.rawPlayers : state.players;
  if (players.length === 0) {
    // 还没拿到座位表：先要一次并等（进房必有 PlayerList）。否则会在「其实已有留座」的情况下
    // 抢先预坐别人的座位，一路 770/769，钱也带不进去。
    const account0 = player();
    // 主动要座位表要节流：以前每 500ms 要一次，服务端会当成异常请求直接把连接踢掉（进房 3 秒必断）。
    if (account0 && (!state.lastPlayerListReqAt || Date.now() - state.lastPlayerListReqAt > 2500)) {
      state.lastPlayerListReqAt = Date.now();
      try { account0.reqPlayerList(); } catch (error) { /* 断线忽略 */ }
    }
    if (!state.seatWaitSince) state.seatWaitSince = Date.now();
    if (Date.now() - state.seatWaitSince < 2500) {
      later(800, tryTakeSeat);
      return;
    }
  }
  players = state.rawPlayers.length > 0 ? state.rawPlayers : state.players;
  const seats = freeSeats(players);
  const candidates = seats.filter((item) => !state.badSeats.has(item));
  if (candidates.length === 0) {
    // 刚进房时座位表可能还没下发：这种情况不能当成「这桌没空座」，等一等再抢。
    if (seats.length === 0 && state.sitRetry < 8) {
      state.sitRetry += 1;
      later(1000, tryTakeSeat);
      return;
    }
    // 这桌能坐的座位都试过了（或者服务端明确给了座位表但没有空位）：换房，别在这张桌上耗。
    log('warn', '房间 ' + state.roomId + ' 没有可用空座（本房试过 ' + state.badSeats.size + ' 个座位），换房');
    state.sitRetry = 0;
    state.badSeats.clear();
    // 短避让 30 秒：否则下一条找房结果还是这间，会 1 秒一圈来回进出。
    const leaving = Number(state.roomId) || 0;
    if (leaving > 0) state.avoidRooms.set(leaving, Date.now() + 30000);
    leaveRoom('no-free-seat');
    emit('Waiting', { reason: '本房没有空座位，换其他房间', retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
    later(1500, () => requestRooms(player(), '本房无空座，换房'));
    return;
  }
  const seat = candidates[0];
  if (state.presitSeat === seat) {
    if (state.presitOk) {
      // 预坐成功但还没坐进去（典型是当时余额不够）：借这次机会再试一次带入。
      const current = player();
      if (current && !state.seated) sendSit(current);
      return;
    }
    // 预坐请求还在路上，别因为座位表刷新就重复发。
    if (Date.now() - state.presitAt < 5000) return;
  }
  state.presitSeat = seat;
  // 真实时序：先发「玩家_补芒_查询」→ 等服务端回「不补芒」→ 才发「预坐_事件」。
  // 不再两个包同时发（之前补芒+预坐一起打出去，服务端会按未确认状态回 769）。
  const presitAccount = player();
  if (!presitAccount) return;
  state.presitOk = false;
  state.sitSent = false;
  state.presitAt = Date.now();
  state.presitSeatWant = seat;
  try {
    presitAccount.reqGameCommand(JSON.stringify({ header: '玩家_补芒_查询', context: '坐下' + seat }), '玩家_补芒_查询');
  } catch (error) { /* 断线忽略 */ }
  log('info', '补芒查询（坐下' + seat + '）');
  // 回包（PromptInfo2 不补芒）会触发 sendPresitNow；700ms 没回也兜底发一次，避免卡住。
  later(700, () => {
    if (state.presitSeatWant !== seat) return;
    if (state.pendingReq && state.pendingReq.name === '预坐') return;
    sendPresitNow(seat);
  });
}

// 真正发预坐（补芒回包到达或超时兜底时调用）
function sendPresitNow(seat) {
  if (state.presitSeatWant !== seat) return;
  state.presitSeatWant = -1;
  const account = player();
  if (!account) return;
  setPending('预坐');
  account.reqRoomCommand(JSON.stringify({ header: '预坐_事件', site: seat }), '预坐_事件');
  log('info', '预坐座位 ' + seat);
}

// 可用带入资金：有俱乐部时扣俱乐部金币，没有俱乐部（或没读到）才退回账号金币。
function availableFunds(account) {
  if (cfg.clubId) return { value: Number(cfg.clubGold || 0), source: 'club' };
  const gold = account && account.gold !== undefined && account.gold !== null ? Number(account.gold) : 0;
  return { value: gold, source: 'account' };
}

// 余额不足：停下所有坐下动作、报一次警，等后台补分后再自动继续。
// 关键点：**只有余额真的变了才立刻重试**，否则按 60s→300s 退避重探，
// 避免「坐下 → 770 → 立刻重试」把日志和服务端刷满（也会让告警反复开关）。
function markFundShortage(gold, need) {
  state.fundShortage = true;
  state.fundNeed = need > 0 ? need : state.minBuyin;
  state.fundGold = gold;
  state.fundRejects += 1;
  // 连续被拒时按指数退避重探，最长 5 分钟一次。
  const backoff = Math.min(60000 * Math.pow(2, Math.max(0, state.fundRejects - 1)), 300000);
  state.fundRetryAt = Date.now() + backoff;
  // 后台列表要靠这条事件把状态标成「额度不足」，所以节流放宽到 10 秒（原来 60 秒，重启后常常一次都不发）。
  if (!state.fundAlertAt || Date.now() - state.fundAlertAt > 10000) {
    state.fundAlertAt = Date.now();
    const rule = String(state.roomSetting || '').slice(0, 80);
    const attempt = state.sitAttempted && state.lastSitMoney > 0
      ? '已试到带入 ' + state.lastSitMoney
      : '本地判断不足，未发起坐下';
    const who = cfg.clubId ? '俱乐部金币 ' + gold : '账号可用 ' + gold;
    const message = '服务端判定带入失败（俱乐部额度/积分不足）：' + who + '，' + attempt
      + '，本地读到最低带入 ' + state.fundNeed
      + '，已暂停坐下等待补分' + (rule ? '；房间规则：' + rule : '');
    emit('FundShortage', { gold, need: state.fundNeed, rejects: state.fundRejects, roomId: state.roomId, message });
    terminalLog('warn', message);
  }
  watchFunds();
}

// 带入候选：从小到大试，最高到全部余额。本地最小带入可能被解析小（房间串里有多处数字），
// 逐级试既能坐到桌，又不会一上来就把全部钱推上桌。
function buyinLadder(min, gold) {
  const base = min > 0 ? min * cfg.buyinMultiple : 100 * cfg.buyinMultiple;
  const list = [base, base * 2, base * 4];
  if (gold > 0) {
    list.push(Math.floor(gold / 2), gold);
  }
  const unique = [...new Set(list.filter((value) => value > 0 && (!gold || value <= gold)))];
  return unique.length > 0 ? unique : [base];
}

// 770 不是「只有缺钱」才回的：座位被占、带入被拒都可能回 770。
// 以服务端最近 3 秒的提示文案为准，避免把「当前座位已有玩家」误报成余额不足。
function looksLikeFundShortage() {
  if (!state.lastPromptAt || Date.now() - state.lastPromptAt > 3000) return false;
  return String(state.lastPromptText || '').includes('带入金币不足');
}

// 服务端回 770（带入金币不足）时的判定：
// 先加码重试（本地算的带入可能低于这个房间的真实要求），加到余额上限还被拒才算真的没钱。
function handleSitRejected(gold, min) {
  const ladder = buyinLadder(min, gold);
  if (state.buyinTry < ladder.length - 1) {
    state.buyinTry += 1;
    state.sitSent = false;
    state.presitOk = false;
    terminalLog('warn', '带入 ' + state.lastSitMoney + ' 被服务端判金币不足，提高到 ' + ladder[state.buyinTry] + ' 再试');
    later(2000, tryTakeSeat);
    return;
  }
  markFundShortage(gold, min);
}

// 观察器：每 5 秒看一次。余额比报警时更高 → 立刻恢复；否则到退避时间再探一次。
function watchFunds() {
  if (state.fundTimer) return;
  const tick = () => {
    state.fundTimer = null;
    if (state.stopping || state.paused || !state.fundShortage) return;
    const account = player();
    const gold = availableFunds(account).value;
    const raised = gold > state.fundGold;
    const due = Date.now() >= state.fundRetryAt;
    if (!raised && !due) {
      state.fundTimer = later(5000, tick);
      return;
    }
    const reason = raised ? '余额已从 ' + state.fundGold + ' 补到 ' + gold : '到退避时间，重新试一次';
    state.fundShortage = false;
    if (raised) {
      state.fundRejects = 0;
      state.fundAlertAt = 0;
      emit('FundRestored', { gold, need: state.fundNeed, roomId: state.roomId });
      terminalLog('info', reason + '，恢复坐下');
    } else {
      terminalLog('info', reason);
    }
    tryTakeSeat();
  };
  state.fundTimer = later(5000, tick);
}

// 真的坐上了：清掉缺钱计数，后台告警由底座按下一次事件关掉。
function clearFundShortage() {
  state.fundShortage = false;
  state.fundRejects = 0;
  state.fundAlertAt = 0;
  state.fundRetryAt = 0;
}

function sendSit(account, mode) {
  if (pendingBusy()) {
    later(600, () => sendSit(account, mode));
    return;
  }
  // 这里只管「预坐成功后的一次带入」。seated 可能已经为真（预坐占座成功但还没带入），
  // 所以不能拿 seated 当守卫，只认 sitSent 和座位号。
  if (state.sitSent || state.seatNo < 0) return;
  // 服务端已经回过「玩家已经坐下 / 已有留座位置」：人就在座上，再发坐下必被拒（769）。
  if (state.seatConfirmed) return;
  // 已被服务端判额度/积分不足：停手等补分，别再发（发了也是 769）。
  if (state.fundShortage) return;
  // 「回座」模式（已坐过 / 留座恢复）：
  //  - 桌面还有分 → 只发 {site} 回座，不带 money；
  //  - 桌面没分 → 带 money，但 type 必须是「申请」（预坐后的首次带入才是「直接」）。
  if (mode === 'apply' && state.money > 0) {
    state.sitSent = true;
    setPending('坐下');
    account.reqRoomCommand(JSON.stringify({ header: '坐下_事件', site: state.seatNo }), '坐下_事件');
    terminalLog('info', '已发给服务器：回座（坐下_事件 site=' + state.seatNo + '，不带带入）');
    return;
  }
  if (mode === 'apply') mode = 'apply-money';
  if (mode === 'fallback') {
    // 769 之后的回退组合：最低带入 + 「申请」（历史实测能过的报文）
    mode = 'apply-money';
    const fallbackMin = currentMinBuyin();
    state.lastSitMoney = fallbackMin > 0 ? fallbackMin : 50;
    state.sitSent = true;
    setPending('坐下');
    terminalLog('info', '已发给服务器：带入 ' + state.lastSitMoney + '（type=申请，回退组合）');
    account.reqRoomCommand(JSON.stringify({
      header: '坐下_事件',
      money: state.lastSitMoney,
      ready: 1,
      type: '申请',
      club_id: state.roomClubId || cfg.clubId,
    }), '坐下_事件1');
    return;
  }
  const min = currentMinBuyin();
  const funds = availableFunds(account);
  const gold = funds.value;
  // 连最小带入都不够（含 0）就不要再发坐下：服务端必回 770，只会刷错误码。
  if (min > 0 && gold < min) {
    markFundShortage(gold, min);
    return;
  }
  const ladder = buyinLadder(min, gold);
  let money = ladder[Math.min(state.buyinTry, ladder.length - 1)];
  if (gold > 0) money = Math.min(money, gold);
  if (money <= 0) {
    markFundShortage(gold, min);
    return;
  }
  // 服务端给了「默认带入分数」就用它：大多数房间的合法带入就是这个值，
  // 自己按最低带入算出来的 50/100 经常不在允许档位里（会被回 769「请先选择带入分数」）。
  if (state.buyInDefault > 0) money = state.buyInDefault;
  // 真实客户端带入常见就是 100（房间最小带入）；低于 100 会被服务端当非法分数回 769。
  if (money < 100) money = 100;
  // 夹进服务端允许的带入区间（超上限会被回 769）。
  if (state.buyInMax > 0 && money > state.buyInMax) money = state.buyInMax;
  if (state.buyInMin > 0 && money < state.buyInMin) money = state.buyInMin;
  if (state.buyInStep > 1) money = Math.max(state.buyInStep, Math.floor(money / state.buyInStep) * state.buyInStep);
  if (money <= 0 && state.buyInDefault > 0) money = state.buyInDefault;
  state.lastSitMoney = money;
  state.sitAttempted = true;
  state.sitSent = true;
  setPending('坐下');
  terminalLog('info', '已发给服务器：带入 ' + money + '（type=' + (mode === 'apply-money' ? '申请' : '直接')
    + '，服务端区间 ' + state.buyInMin + '~' + state.buyInMax + '，桌面 ' + state.money + '）');
  account.reqRoomCommand(JSON.stringify({
    header: '坐下_事件',
    money,
    ready: 1,
    // 真实客户端：预坐后传「直接」；已经坐过、局间补分传「申请」。
    type: mode === 'apply-money' ? '申请' : '直接',
    // 真实客户端用的是「当前房间所属俱乐部」，不是配置里的俱乐部。
    club_id: state.roomClubId || cfg.clubId,
  }), '坐下_事件1');
  later(cfg.sitTimeoutMs, () => {
    if (state.stopping || state.seated) return;
    log('warn', '带入确认超时，重新占座');
    state.presitOk = false;
    state.sitSent = false;
    state.seatNo = -1;
    state.presitSeat = -1;
  });
}

// 打完一轮的房间在这个窗口内不再进：留时间给别的房，也让这张桌换换人。
function avoidRoom(roomId) {
  const id = Number(roomId) || 0;
  if (id <= 0) return;
  state.avoidRooms.set(id, Date.now() + cfg.roomAvoidMs);
}

function isRoomAvoided(roomId) {
  const id = Number(roomId) || 0;
  const until = state.avoidRooms.get(id);
  if (!until) return false;
  if (Date.now() >= until) {
    state.avoidRooms.delete(id);
    return false;
  }
  return true;
}

// 一轮结算完就离开这间房，去别的房开下一轮（房间本身不结束，人走就行）。
// 刚离开的房间在 cfg.roomAvoidMs 内不再进；找不到别的房就一直等，
// requestRooms 15 秒一轮，避让过期后自然会回到这间。
function leaveAfterSettle(reason) {
  if (state.stopping || !state.roomId) return;
  const roomId = state.roomId;
  avoidRoom(roomId);
  leaveRoom(reason);
  state.stage = 'hall';
  terminalLog('info', '本轮结束，离开房间 ' + roomId + '（' + Math.round(cfg.roomAvoidMs / 60000) + ' 分钟内不再进）');
  emit('Waiting', { reason: '本轮结束，换房', retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
  later(1500, () => requestRooms(player(), '本轮已结束，找其他房间'));
}

// 留在原房继续带入：人还在座位上（留座状态），桌面分已回身，
// 发一次官方客户端「确认带入」用的坐下_事件（带 money、不带 site）。
function tryBuyin(reason) {
  if (state.stopping || state.paused || !state.needBuyin) return;
  if (!state.seated || state.stage !== 'room' || !state.roomId) return;
  const now = Date.now();
  if (now < state.buyinAt) return;
  const account = player();
  if (!account) return;
  const min = currentMinBuyin();
  // 俱乐部模式下带入扣的是俱乐部金币，不看账号自己的金币。
  const funds = availableFunds(account);
  const gold = funds.value;
  if (min > 0 && gold < min) {
    markFundShortage(gold, min);
    state.buyinAt = now + 30000;
    return;
  }
  let money = min > 0 ? min * cfg.buyinMultiple : 100 * cfg.buyinMultiple;
  if (gold > 0) money = Math.min(money, gold);
  if (money <= 0) {
    markFundShortage(gold, min);
    return;
  }
  state.buyinAt = now + 8000;
  account.reqRoomCommand(JSON.stringify({
    header: '坐下_事件',
    money,
    ready: 1,
    type: '申请',
    club_id: state.roomClubId || cfg.clubId,
  }), '坐下_事件1');
  terminalLog('info', '原房继续带入 ' + money + '（' + reason + '，type=申请）');
}

// 一轮结算后的去留判断：
//   已超目标（该输）→ 留在原房继续带入来输，最多 stayBuyinTimes 次；
//   否则（还没到目标 / 连续带入次数用完）→ 离房换桌。
function afterSettle(reason) {
  if (state.stopping || !state.roomId) return;
  // 刚进房时服务端会推一堆历史提示（含「已结算」字样），不能当成本轮结束去补带入，
  // 否则一进房就抢着发 坐下_事件，跟预坐流程打架（表现为 769 反复）。
  if (state.enterAt && Date.now() - state.enterAt < 10000) {
    log('debug', '进房初期忽略结算信号（' + reason + '）');
    return;
  }
  if (state.draining) { shutdown('drain'); return; }
  const now = Date.now();
  if (now - state.settleHandledAt < 5000) return;
  state.settleHandledAt = now;

  const intent = strategy.profitIntent({
    target: cfg.profitTarget,
    net: currentNet(),
    minBuyin: currentMinBuyin(),
    mode: cfg.profitMode,
    periodStart: cfg.periodStart,
    periodEnd: cfg.periodEnd,
    today: todayText(),
    opts: strategyOptions(),
  });
  const overTarget = intent.intent === 'lose';
  // 俱乐部模式的房间不会结束：默认留在原房重新带入继续打，
  // 否则几台机器人一结算就集体走人，房间直接空掉（服务端会「人数不足，房间关闭」）。
  // 只有这两种情况才换桌：分不够下一次带入、或者同房续入次数用满（避免长期占同一桌）。
  const funds = availableFunds(player()).value;
  const min = currentMinBuyin();
  if (min > 0 && funds < min) {
    terminalLog('warn', '本轮结束：俱乐部金币 ' + funds + ' 不够下一次带入（最低 ' + min + '），换桌等分');
    leaveAfterSettle(reason);
    return;
  }
  if (state.stayBuyinCount < cfg.stayBuyinTimes) {
    state.stayBuyinCount += 1;
    state.needBuyin = true;
    state.buyinAt = 0;
    terminalLog('info', (overTarget ? '已超目标（净分 ' + currentNet() + ' / 目标 ' + cfg.profitTarget + '）' : '本轮结束')
      + '，原房继续带入（' + state.stayBuyinCount + '/' + cfg.stayBuyinTimes + '）');
    emit('Waiting', { reason: '原房继续带入', roomId: state.roomId });
    tryBuyin('continue');
    return;
  }
  terminalLog('info', '原房续入次数已用完（' + state.stayBuyinCount + '/' + cfg.stayBuyinTimes + '），离房换桌');
  leaveAfterSettle(reason);
}

// 服务端提示（PromptInfo / PromptInfo2，JSON {word, context}）。
// 游戏内「已结算」是权威的整轮结束信号（onPromptInfo2 收到它才会去补分）；
// 这里不补分——主人规则是结算完就走人换桌。
function onPrompt(source, raw) {
  const text = String(raw || '');
  if (!text) return;
  let json = null;
  try {
    json = JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
  } catch (error) {
    json = null;
  }
  if (!json) {
    terminalLog('warn', source + ' 解析失败：' + text.slice(0, 120));
    return;
  }
  // 记下最近一条提示：770 在不同场景复用，判定要看同一条提示的文案。
  state.lastPromptText = String(json.word || '');
  state.lastPromptAt = Date.now();
  const word = String(json.word == null ? '' : json.word).trim();
  const context = String(json.context == null ? '' : json.context).trim();
  if (!word) return;
  // 服务端提示一律进后台日志，运营能看到到底提示了什么。
  terminalLog('info', '服务器提示：' + word + (context ? '（' + context + '）' : ''));

  // 房间要解散了（人数不足倒计时 / 房主关闭 / 房间已关闭）：别在里面干等，直接换房。
  if (word.includes('房间关闭') || word.includes('人数不足') || word.includes('房间已解散') || word.includes('房间已关闭')) {
    if (state.stage === 'room') {
      terminalLog('info', '房间要解散了（' + word + '），离房换桌');
      state.badSeats.clear();
      state.stayBuyinCount = 0;
      leaveRoom('room-closing');
      emit('Waiting', { reason: '原房间已关闭，换其他房间', retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
      later(1500, () => requestRooms(player(), '原房间已关闭'));
    }
    return;
  }
  // 「不补芒（坐下N）」是补芒查询的应答：用它驱动下一步「预坐_事件」。
  // 注意不能和「已结算」混在一起处理 —— 之前混着，进房第一秒就被当成结算去补带入。
  if (word.includes('不补芒')) {
    const matched = /坐下\s*(\d+)/.exec(word) || /坐下\s*(\d+)/.exec(String(context || ''));
    const seat = matched ? Number(matched[1]) : -1;
    if (seat >= 0 && state.presitSeatWant === seat) sendPresitNow(seat);
    return;
  }
  if (word.includes('已结算')) {
    if (context === '回坐') {
      const account = player();
      if (account) account.reqRoomCommand(JSON.stringify({ header: '回座_事件' }), '回座_事件');
      return;
    }
    // 结算后按输赢阀值决定：已超目标就在原房继续带入来输，否则离房换桌。
    afterSettle('prompt-settled');
    return;
  }
  if (word.includes('弹窗,留座')) {
    terminalLog('info', '留座提示，按当前轮次状态处理');
    return;
  }
  if (word.includes('带入金币不足')) {
    terminalLog('warn', '服务端判定带入金币不足，等待后台补充');
    emit('Waiting', { reason: '带入金币不足，等待补充', roomId: state.roomId });
  }
}

function onPlayerList(payload) {
  // 与真实客户端 DrhLogicMgr.OnUpdatePlayerList 一致：先校验 room_id，
  // 迟到的上一间房的座位表直接丢弃，否则座位号会被旧房数据覆盖，消息归属全乱。
  const listRoom = String(payload.room_id === undefined || payload.room_id === null ? '' : payload.room_id);
  if (listRoom && state.roomId > 0 && listRoom !== String(state.roomId)) {
    log('debug', '丢弃非本房座位表：' + listRoom + '（当前房 ' + state.roomId + '）');
    return;
  }
  state.lastTableAt = Date.now();
  if (payload.club_id !== undefined && payload.club_id !== null && String(payload.club_id) !== '') {
    state.roomClubId = String(payload.club_id);
  }
  const players = payload.Players || [];
  const account = player();
  if (!account) return;
  state.rawPlayers = players;
  // 座位表是「每座位一个对象」的权威来源（对应真实客户端 arrayInfo[num]）：
  // 后续每条消息都只更新它自己那个座位对象，别人的状态从各自对象里读。
  const views = {};
  for (const item of players) {
    const num = Number(item && item.num) || 0;
    if (num <= 0) continue;
    views[num] = {
      seatNo: num,
      id: String(item.id || ''),
      status: String(item.status || ''),
      money: Number(item.money_score ?? item.init_money ?? 0) || 0,
      banker: String(item.banker || '') === 'True',
    };
  }
  state.seatViews = views;
  state.guuid = String(account.guuid || '');
  state.gold = Number(account.gold || 0);
  state.players = players
    .filter((item) => item && String(item.id || '') !== 'init')
    .map((item) => ({
      num: Number(item.num) || 0,
      id: String(item.id || ''),
      name: String(item.name || ''),
      status: String(item.status || ''),
      gold: Number(item.gold) || 0,
    }));

  const self = players.find((item) => String(item.id) === state.guuid);
  if (self) {
    const seat = Number(self.num);
    if (seat !== state.seatNo) {
      terminalLog('info', '座位表确认：我在 ' + seat + ' 号位（status ' + String(self.status || '-') + '，桌面分 '
        + String(self.money_score ?? self.init_money ?? '-') + '）');
    }
    const firstTime = !state.seated;
    state.seatNo = seat;
    state.presitSeat = seat;
    // status 才是「有没有真的坐下」：ready/running 才是坐在位上；
    // leave（已离座）/init（空位）都不算，否则会被当成「回座」直接发带入，被服务端 769 拒掉。
    const seatStatus = String(self.status || '').toLowerCase();
    // leave（留座未坐）也是「座位是我的」，只是要找服务端申请上座/补分，不能再去抢座。
    state.seated = ['ready', 'running', 'sit', 'sited', 'play', 'playing', 'leave'].includes(seatStatus);
    state.seatLeft = seatStatus === 'leave';
    // 留座倒计时：非 0 说明人还占着座位、但这一轮已经结算完，正在等重新带入。
    if (self.site_countdown !== undefined) state.siteCountdown = String(self.site_countdown);
    // 桌上还剩多少带入分：新版本字段 init_money，老字段 begin_score，再退到 table_times。
    const beginRaw = self.init_money !== undefined ? self.init_money
      : (self.begin_score !== undefined ? self.begin_score : self.table_times);
    if (beginRaw !== undefined && beginRaw !== null && beginRaw !== '') {
      state.selfBeginScore = Number(beginRaw) || 0;
    }
    if (firstTime) {
      emit('RoomJoined', { roomId: state.roomId, seatNo: seat, clubId: cfg.clubId }, { roomId: state.roomId });
      emit('PlayerSeated', { roomId: state.roomId, seatNo: seat }, { roomId: state.roomId });
      emit('GameReady', { roomId: state.roomId, seatNo: seat }, { roomId: state.roomId });
    }
    // 留座且桌面还有带入分（切换 Worker / 重连回原房）：直接回座继续打，不要重新带钱。
    const stayMoney = Number(self.money_score ?? self.init_money ?? self.total_score ?? 0) || 0;
    if (state.seated && stayMoney > 0 && !state.resumedSeat) {
      state.resumedSeat = true;
      // 座位本来就留着（自己已在座位表里），不需要再发「回座_事件」：
      // 发它反而会让服务端重走入座流程、把我们挪出房间（表现为进房 1 秒后又被踢、重新找房）。
      state.presitOk = true;
      state.sitSent = true;
      log('info', '留座且桌面还有 ' + stayMoney + ' 分，直接回座继续打（不重新带入）');
    }
    // 回座（切换 Worker / 重连回原房）：座位还在但桌面没有带入分，直接补带入继续打，
    // 这一步不该再走「预坐」——座位本来就是我们的。
    if (!state.sitSent && !state.presitOk && state.seated && state.money <= 0 && !state.needBuyin) {
      state.presitOk = true;
      // 必须先收到预坐 512（presitOk）再带入：预坐还没被服务端确认就发 坐下_事件，必回 769。
      if (!state.presitOk) {
        // 等预坐回包，但别无限等：2.5 秒还没确认就重新预坐。
        if (!state.presitWaitAt) state.presitWaitAt = Date.now();
        if (Date.now() - state.presitWaitAt > 2500) {
          state.presitWaitAt = 0;
          log('warn', '预坐 2.5 秒未确认，重新锁座');
          state.presitSeat = -1;
          resetSeat('presit-timeout');
          tryTakeSeat();
          return;
        }
        later(800, tryTakeSeat);
        return;
      }
      state.presitWaitAt = 0;
      log('info', '回到原座位（' + state.seatNo + ' 号），补带入（直接）');
      later(600, () => { if (!state.sitSent) sendSit(account); });
      return;
    }
    if (!state.sitSent && state.presitOk) sendSit(account);
    // 原房继续带入：靠座位表刷新继续推动（tryBuyin 内部有 8 秒节流）。
    if (state.needBuyin) tryBuyin('player-list');
  } else if (state.stage === 'room' && !state.stopping && !state.paused) {
    // 自己不在座位上：时间到结算被下桌，或进房后还没坐上。
    // 俱乐部房间不结束，正确动作是留在本房重新带入，而不是离房重找。
    if (state.seated) resetSeat('seat-lost');
    tryTakeSeat();
  }

  state.roomGameStatus = String(payload.GameStatus || '');
  const roundCount = Number(payload.round_count || 0);
  if (state.roomGameStatus === 'running' && state.seated) trackRound(roundCount);
  requestSpectators(false);
  emitTableState(state.players.length > 0 ? seatsCurrent() : state.tableSeats, currentPhase(), 'player-list');
}

function onRoundScore(payload) {
  const rounds = payload.RoundScore || [];
  const round = rounds[0];
  if (!round) return;
  const self = (round.players || []).find((item) => String(item.user_guuid) === state.guuid);
  if (!self) return;
  settleRound(Number(self.score || 0));
}

function onServerPlay(payload) {
  // 不能因为本地 seated=false 就把消息全丢掉：预坐留座、带入确认期间 seated 可能还是 false，
  // 但服务端已经在给我们发「轮到你」。是否需要动作由下面的 mine 判断决定。
  const msg = String(payload.msg || '');
  const text = String(payload.state || '');
  // 牌局流程日志：状态名一变就记一条（谁在行动、action 与否），排查时不至于两眼一抹黑。
  // 与真实客户端一致：桌上每个座位是独立对象，各自只更新自己的数据。
  // 这里把所有座位的「只读视图」记在 state.seatViews 里（别人的牌/动作以后从各自视图查），
  // 但只有 mine 的那条才会驱动本机的决策与出牌。
  const seatNo = Number(payload.player_number) || 0;
  if (seatNo >= 0 && String(payload.player_name || '') !== '') {
    const view = state.seatViews[seatNo] || (state.seatViews[seatNo] = { seatNo });
    if (payload.player_name !== undefined) view.id = String(payload.player_name);
    if (payload.role !== undefined) view.role = String(payload.role);
    if (payload.state !== undefined) view.state = String(payload.state);
    if (payload.money_score !== undefined) view.money = Number(payload.money_score) || 0;
    if (payload.is_action !== undefined) view.acting = String(payload.is_action) === 'True';
    view.at = Date.now();
  }
  if (state.guuid === '' && state.seatNo < 0 && seatNo >= 0) {
    // 座位号还没定下来时无法判断消息归属，记一条，避免「消息乱处理」却查不出原因。
    state.guuidMissingAt = state.guuidMissingAt || Date.now();
    if (Date.now() - state.guuidMissingAt > 5000) {
      state.guuidMissingAt = Date.now();
      log('warn', '本地还没有 guuid/座位号，暂时无法判断消息是否属于自己');
    }
  }
  // 归属判定顺序（与真实客户端一致）：先看 PlayerList 定下来的座位号，座位号未知时才用 guuid 兜底。
  // 座位号只在 `onPlayerList` 里写（找到自己那条），预坐/换座都不再改它，
  // 否则座位号一错就会把别人的消息当成自己的（进而看到别人的暗牌、替别人出牌）。
  const owner = String(payload.player_name || '');
  const mine = state.seatNo >= 0
    ? seatNo === state.seatNo
    : (state.guuid !== '' && owner === state.guuid);
  // 只在「这条消息说的是我」时记流程日志：全桌广播每个人都记会把日志刷爆。
  if (mine) {
    const flowKey = String(payload.state || '') + '|' + String(payload.role || '') + '|' + String(payload.is_action || '');
    if (flowKey !== state.lastLoggedState) {
      state.lastLoggedState = flowKey;
      terminalLog('info', '牌局状态：' + String(payload.state || '-') + '（role ' + String(payload.role || '-')
        + (String(payload.is_action || '') === 'True' ? '，该我行动' : '') + '）');
    }
  }

  // 别人的消息一律不处理（每个机器人视角都会收到全桌消息）。
  // 特别注意：别人的倒计时不能用来取消我的排程 —— 以前这么做，等于我刚排出牌就被别人的广播清掉。
  if (!mine) return;

  // 自己的「决策_倒计时_消息」= 轮到我操作（真实客户端收到它就会亮起操作区并开始倒计时）。
  // is_action 那条万一丢了/晚了，靠这条也能把动作排上。
  if (msg === '决策_倒计时_消息') {
    state.lastDecisionAt = Date.now();
    state.pendingActionAt = Date.now();
    terminalLog('info', '收到我的决策倒计时（' + String(payload.countdown || '') + 's）：' + String(payload.state || ''));
    // 不覆盖 turnKey（is_action 那条已经设好），只负责把这一手的动作排上。
    if (state.actedTurnKey !== state.turnKey) scheduleAction(String(payload.role || state.role || ''));
    return;
  }

  // 与游戏内 DrhPlayerLogic 一致：每次「决策_信息_消息」给本人策略编号 +1，
  // 牌桌动作必须带这个编号，否则服务端会当成过期操作。
  if (msg === '决策_信息_消息') state.captureId += 1;
  if (msg === '持有_手牌_消息' || msg === '发牌_结束_消息') {
    trackRound(payload.room_round);
  }
  // 结算结束才补到局号的不补发 GameStarted，否则后台会看到「结算→开始」的倒序。
  if (msg === '结算_结束_消息') {
    trackRound(payload.room_round, true);
  }

  // 策略要用的服务端数据都随「当前_玩家_消息」下发，字段缺失时保留上一次的值。
  if (payload.role !== undefined) state.role = String(payload.role);
  if (payload.gen_score !== undefined) state.genScore = Number(payload.gen_score) || 0;
  if (payload.money_score !== undefined) state.money = Number(payload.money_score) || 0;
  const tableTimes = payload.table_times !== undefined ? payload.table_times : payload.all_bei_shu;
  if (tableTimes !== undefined) state.beicount = Number(tableTimes) || 0;
  // 芒（界面上「揲芒 x5 47」）：xN 是倍数，后面的数字是金额。
  // 带入区间：服务端会随「当前_玩家_消息」下发允许带入的最小/最大/步长，
  // 超范围的金额会被拒（表现为 769「请先选择带入分数」）。
  if (payload.buy_in_min !== undefined) state.buyInMin = Number(payload.buy_in_min) || 0;
  if (payload.buy_in_max !== undefined) state.buyInMax = Number(payload.buy_in_max) || 0;
  if (payload.buy_in_default !== undefined) state.buyInDefault = Number(payload.buy_in_default) || 0;
  if (payload.buy_in_step !== undefined) state.buyInStep = Number(payload.buy_in_step) || 0;
  if (payload.mang_pi_current !== undefined) state.mangTimes = Number(payload.mang_pi_current) || 0;
  if (payload.mang_show_pool_amount !== undefined) state.mangAmount = Number(payload.mang_show_pool_amount) || 0;
  if (payload.bei_shu_unit !== undefined) {
    state.betUnits = String(payload.bei_shu_unit).split(',')
      .map((item) => Number(String(item).trim()))
      .filter((item) => Number.isFinite(item) && item > 0);
  }
  if (msg === '持有_手牌_消息') {
    // now_pai 可能是数组也可能是字符串，统一走 cardList，解析失败时保留上一份手牌。
    const cards = cardList(payload.now_pai);
    if (cards.length > 0) {
      state.hand = cards;
      state.handCount = Number(payload.now_pai_count || cards.length) || cards.length;
    }
    // 新一局的牌都发下来了，说明原房继续带入已经生效。
    state.needBuyin = false;
  }
  // 摸到的活牌直接补进手牌，扯牌时才能按四张一起拆。
  if (msg === '一张_活牌_消息') {
    const extra = cardList(payload.pai);
    if (extra.length > 0) {
      state.hand.push(extra[0]);
      state.handCount = state.hand.length;
    }
  }
  // 每局只做一次计划：拿到手牌时按当时的净分决定这一局争赢、争输还是常规打。
  if (msg === '持有_手牌_消息' && state.roomRound > 0 && state.plannedRound !== state.roomRound) {
    state.plannedRound = state.roomRound;
    planCurrentRound();
  }
  if (msg === '结算_信息_消息') {
    // 结算可能比手牌消息更早到：先把局号补上，否则这一局的分会被上局的去重挡掉。
    if (payload.room_round !== undefined) trackRound(payload.room_round, true);
    // round_score 是「本局分,芒分,喜分,合计」，只有自己那条带明细（§3.4）。
    settleRound(String(payload.round_score || '').split(',')[0]);
  }
  if (msg === '结算_结束_消息') {
    cancelAction();
    if (String(payload.is_exit || '') === 'True') {
      // 整轮结束：等 PromptInfo「已结算」触发去留判断；3 秒内没等到就自己走一遍。
      log('info', '本轮结算完成（桌面带入分 ' + state.selfBeginScore + '），准备换房');
      const settledRoom = state.roomId;
      later(3000, () => {
        if (state.roomId > 0 && state.roomId === settledRoom) afterSettle('settled-exit');
      });
    }
  }
  if (msg === '持有_手牌_消息' && state.roomRound > 0 && state.roomInfoRound !== state.roomRound) {
    // 每局发牌后拉一次房间信息：take_pai 里带全桌四张手牌（含已弃牌者），用于后台「当前牌局」。
    state.roomInfoRound = state.roomRound;
    const round = state.roomRound;
    // 新一局其他人手牌还没下发，先丢掉上一局的快照，避免后台把旧牌当本局展示。
    state.tableSeats = [];
    emitTableState(seatsCurrent(), 'playing', 'own-hand');
    if (!state.roomInfoDenied) {
      requestRoomGameInfo(player());
      // 服务端没回 RoomGameInfo 时退回只看自己的手牌，避免后台一直停在旧快照。
      later(4000, () => {
        if (state.stopping || !state.roomId || state.roomRound !== round) return;
        if (state.tableInfoRound === round) return;
        emitTableState(seatsFromPlayerList(), 'playing', 'own-hand');
      });
    }
  }

  if (!isDecisionState(text)) {
    // 别人的「排队/已经押牌」等消息也会走到这里。以前无条件 cancelAction()，
    // 结果刚排好的出牌定时器被别人的消息一秒内取消 —— 这是「轮到我却不出牌」的主因。
    // 只在自己不再是决策方时才取消。
    if (mine) {
      log('debug', '自己已不在决策状态（' + text + '），取消待出牌');
      cancelAction();
    }
    return;
  }
  const now = Date.now();
  state.lastDecisionAt = now;
  if (now - state.lastTurnAt >= 2000) {
    state.lastTurnAt = now;
    emit('TurnStarted', {
      roomId: state.roomId,
      seatNo: state.seatNo,
      state: text,
      event: String(payload.event || ''),
    }, { roomId: state.roomId, roundId: state.lastRoundId });
  }
  const isAction = String(payload.is_action || '') === 'True' || payload.is_action === true;
  // 扯牌（分牌）阶段：服务端用 is_chepai=True 或状态名带「扯牌/分牌」标记，
  // 这时该发 reqShow 把牌拆成小大/大大，不是看牌、也不是下注。
  const needsSplit = String(payload.is_chepai || '') === 'True'
    || String(payload.state || '').includes('扯牌')
    || String(payload.state || '').includes('分牌');
  if (isAction && needsSplit) {
    state.lastDecisionAt = Date.now();
    state.pendingActionAt = Date.now();
    state.turnKey = [String(payload.state || ''), String(payload.counter ?? payload.count_times ?? ''), String(payload.player_number || ''), 'split'].join('|');
    if (state.actedTurnKey !== state.turnKey) {
      const account = player();
      // 有 4 张就提交：真实客户端也是把 handCardEx 里 4 张原样发（暗牌位置就是 [0,0]），
      // 不能因为「还没翻牌」就拒发，否则分牌阶段会一直空转。
      if (account && state.hand.length >= 4) {
        state.actedTurnKey = state.turnKey;
        const ctx = strategyContext('扯牌');
        submitAction(account, safeDecide(ctx), state.captureId, ctx.role);
      } else {
        // 四张里有两张可能还是 [0,0] 暗牌占位：先补一次看牌把牌翻开，再分。
        terminalLog('warn', '扯牌阶段手牌只有 ' + state.hand.length + ' 张（' + JSON.stringify(state.hand) + '），先补看牌');
        if (account) account.reqGameCommand('{"header":"玩家_搓牌_事件"}', '');
        later(900, () => {
          if (state.stopping || state.paused) return;
          if (state.hand.length < 4) {
            terminalLog('warn', '补看牌后手牌仍不足 4 张（' + JSON.stringify(state.hand) + '），本手不扯');
            return;
          }
          const acc = player();
          if (!acc) return;
          const ctx2 = strategyContext('扯牌');
          submitAction(acc, safeDecide(ctx2), state.captureId, ctx2.role);
        });
      }
    }
    return;
  }
  // 只有正式决策态「…_决策_看牌_状态」才发看牌确认；
  // 「搓牌_决策_…」「搓牌_等待_…」只是搓牌动画的中间态，在那里发事件服务端不认，
  // 而且会把 actedTurnKey 提前占掉，导致真正的「决策_看牌」窗口被跳过（之前就卡在这）。
  const isKanPaiDecision = String(payload.state || '').includes('决策_看牌');
  if (isAction && isKanPaiDecision) {
    // 「决策_看牌_状态」= 搓牌窗口。真实客户端点「看牌」发的是
    // reqGameCommand({"header":"玩家_搓牌_事件"})，不是 reqPass —— 照抄这一条。
    state.lastDecisionAt = Date.now();
    state.pendingActionAt = Date.now();
    state.turnKey = [String(payload.state || ''), String(payload.count_times ?? ''), String(payload.player_number || ''), String(payload.role || '')].join('|');
    if (state.actedTurnKey !== state.turnKey) {
      const account = player();
      const kanpaiKey = state.turnKey;
      state.actedTurnKey = kanpaiKey;
      if (account) account.reqGameCommand('{"header":"玩家_搓牌_事件"}', '');
      terminalLog('info', '已发给服务器：看牌确认（reqGameCommand 玩家_搓牌_事件）');
      // 真实客户端搓完牌立刻弹出下注按钮，玩家马上就能点 —— 机器人不等新消息，
      // 直接按策略下一次注（看牌后可用的是 丢/跟/敲/大 这一组）。
      later(400, () => {
        if (state.stopping || state.paused) return;
        if (state.turnKey !== kanpaiKey) return; // 服务端已经推进到下一个窗口
        const current = player();
        if (!current) return;
        const ctx = strategyContext('丢休敲大不不');
        submitAction(current, safeDecide(ctx), state.captureId, ctx.role);
      });
      // 再兜一层：1.5 秒后状态还停在原地，补一次过牌把这一手走掉。
      later(1500, () => {
        if (state.stopping || state.paused) return;
        if (state.turnKey !== kanpaiKey) return;
        const current = player();
        state.pendingActionAt = 0;
        if (current) current.reqPass(String(state.captureId));
        terminalLog('warn', '看牌后服务端没推进，补发过牌把这一手走掉');
      });
    }
    return;
  }
  if (isAction) {
    // 轮到我 = 决策窗口从现在开始算；之前只在「决策_信息_消息」里记时间，
    // 第二圈（摸第三张牌后）服务端不一定再发那条消息，会把窗口判成已超时而不再出牌。
    state.lastDecisionAt = Date.now();
    state.stateText = String(payload.state || state.stateText || '');
    // 兜底用：轮到我之后 3 秒还没出牌就强制过牌（见下面的定时器）。
    state.pendingActionAt = Date.now();
    // 每个决策窗口一个标识：状态名 + 计次 + 我的座位。
    state.turnKey = [String(payload.state || ''), String(payload.count_times ?? ''), String(payload.player_number || ''), String(payload.role || '')].join('|');
    terminalLog('info', '轮到我（' + (payload.state || '') + '）：手牌 ' + state.hand.length + ' 张，角色 '
      + (payload.role || state.role || '') + '，跟注 ' + state.genScore + '，底池 ' + state.beicount
      + '，加注上限 ' + (payload.bei_shu_max || '-'));
    scheduleAction(String(payload.role || state.role || ''));
  }
}

function cancelAction() {
  if (state.actionTimer) {
    clearTimeout(state.actionTimer);
    state.actionTimer = null;
  }
}

// ---- 策略与出牌 ----

const ACTION_NAMES = { gen: '跟', da: '大', xiu: '休', qiao: '敲', diu: '丢', show: '扯牌', pass: '过' };

function strategyOptions() {
  return { roomSetting: state.roomSetting, tuning: strategy.mergeTuning(cfg.strategy) };
}

function currentRoomType() {
  return strategy.roomTypeOf(state.roomSetting, cfg.roomPi.join(','));
}

function buildPlan() {
  // 先同步房间设置（最小带入/底皮），策略的底皮档位判断依赖它。
  const minBuyin = currentMinBuyin();
  return strategy.planRound({
    target: cfg.profitTarget,
    net: currentNet(),
    minBuyin,
    mode: cfg.profitMode,
    periodStart: cfg.periodStart,
    periodEnd: cfg.periodEnd,
    today: todayText(),
    hand: state.hand,
    opts: strategyOptions(),
    winStreak: state.winStreak,
  });
}

function intentLabel(intent) {
  if (intent === 'win') return '争取赢';
  if (intent === 'lose') return '争取输';
  return '常规打';
}

// 每局开始算一次：控制意图 + 这一局要不要主动加注（加注只在这一局内复用）。
function planCurrentRound() {
  const plan = buildPlan();
  state.roundPlan = plan;
  state.addMore = strategy.shouldAddMore({
    intent: plan.intent,
    net: currentNet(),
    target: cfg.profitTarget,
    hand: state.hand,
    opts: strategyOptions(),
  });
  const handText = state.hand.length
    ? state.hand.map((card) => card[0] + ':' + card[1]).join(' ')
    : '—';
  terminalLog(plan.intent === 'lose' ? 'warn' : 'info', '第 ' + state.roomRound + ' 局开局：手牌 ' + handText
    + '，净分 ' + currentNet() + '（' + profitText() + '）→ ' + intentLabel(plan.intent)
    + '，' + plan.reason + (state.addMore ? '，允许加注' : ''));
}

// 每次决策都按最新净分重算意图，手牌和加注沿用本局计划。
function strategyContext(role) {
  const plan = buildPlan();
  state.roundPlan = plan;
  const options = strategyOptions();
  const roomType = currentRoomType();
  return {
    role,
    hand: state.hand,
    handCount: state.handCount || state.hand.length,
    intent: plan.intent,
    opts: options,
    roomType,
    genScore: state.genScore,
    beicount: state.beicount,
    mangAmount: state.mangAmount,
    mangTimes: state.mangTimes,
    money: state.money,
    minBuyin: currentMinBuyin(),
    betUnits: state.betUnits,
    addMore: resolveAddMore(plan.intent, roomType, options),
    table: state.table,
  };
}

// 老客户端在牌局里还会用余额和手牌否掉加注：钱不够安全线、或前两张太小且已有人加注。
function resolveAddMore(intent, roomType, options) {
  if (!state.addMore) return false;
  const thresholds = strategy.thresholdsOf(roomType, options);
  if (state.money > 0 && state.money < thresholds.safeGen) return false;
  if (state.hand.length === 2 && state.genScore - state.beicount > 15) {
    const hasQ = state.hand.some((card) => card[1] === 12);
    if (!hasQ && !strategy.handIsBig(state.hand, options)) return false;
  }
  return true;
}

function availableFallback(flags) {
  if (flags.gen) return 'gen';
  if (flags.qiao) return 'qiao';
  if (flags.diu) return 'diu';
  return 'pass';
}

// 策略给的动作再按角色校验一次：当前不可用的按钮直接降级，避免服务端当废操作丢弃。
function adjustAction(decision, role) {
  const flags = strategy.parseRole(role);
  let action = String(decision.action || 'pass');
  const amount = Number(decision.amount);
  if (action === 'da' && (!flags.da || !(amount > 0))) action = availableFallback(flags);
  if (action === 'gen' && !flags.gen) action = availableFallback(flags);
  if (action === 'xiu' && !flags.xiu) action = availableFallback(flags);
  if (action === 'qiao' && !flags.qiao) action = flags.diu ? 'diu' : availableFallback(flags);
  if (action === 'diu' && !flags.diu) action = availableFallback(flags);
  if (action === 'show' && (!Array.isArray(decision.cards) || decision.cards.length < 4)) action = 'skip';
  return { action, amount, reason: decision.reason || '' };
}

function submitAction(account, decision, capture, role) {
  state.pendingActionAt = 0;
  const chosen = adjustAction(decision, role);
  // 四张牌不全时不发扯牌：老客户端也只记异常、不动作，乱发会被服务端判废操作。
  if (chosen.action === 'skip') {
    // 只有真在扯牌阶段（手牌不足四张）才允许不发；其它阶段降级成过牌，别让倒计时空转。
    const roleText = String(role || '');
    if (roleText.includes('扯') || String(state.stateText || '').includes('扯')) {
      terminalLog('warn', '扯牌条件不足（手牌 ' + state.hand.length + ' 张），本轮不操作');
      return;
    }
    terminalLog('warn', '策略没有给出可用动作（阶段 ' + state.stateText + '），降级为过牌');
    account.reqPass(capture.toString());
    emit('ActionSubmitted', { action: 'pass', label: '过', amount: null, reason: '策略无动作，降级过牌', captureId: capture, roomId: state.roomId }, { roomId: state.roomId, roundId: state.lastRoundId });
    return;
  }
  const cap = capture.toString();
  // 记录实际发给服务端的方法与参数，排查「到底发了什么」时不用再猜。
  let sentMethod = '';
  let sentArg = '';
  try {
    switch (chosen.action) {
      case 'qiao':
        sentMethod = 'reqRaise'; sentArg = '-3';
        account.reqRaise('-3', cap);
        break;
      case 'xiu':
        sentMethod = 'reqRaise'; sentArg = '-5';
        account.reqRaise('-5', cap);
        break;
      case 'gen':
        sentMethod = 'reqRaise'; sentArg = '-1';
        account.reqRaise('-1', cap);
        break;
      case 'da': {
        // 小额房（0.1/0.3、0.2/0.5）真实客户端会把「注」×10 再发，
        // 见 DrhPlayerLogic.CheckReturn2Big；不换算会被服务端当成过小的加注直接丢掉。
        let amount = Math.trunc(chosen.amount);
        const setting = String(state.roomSetting || '');
        if (setting.includes('0.1/0.3') || setting.includes('0.2/0.5')) amount *= 10;
        sentMethod = 'reqRaise'; sentArg = String(amount);
        account.reqRaise(String(amount), cap);
        break;
      }
      case 'show': {
        const showBody = JSON.stringify({ showlist: decision.cards.map((card) => [card[0], card[1]]) });
        sentMethod = 'reqShow'; sentArg = showBody;
        account.reqShow(showBody, '');
        break;
      }
      case 'diu':
      default:
        sentMethod = 'reqPass'; sentArg = cap;
        account.reqPass(cap);
        break;
    }
  } catch (error) {
    terminalLog('error', '提交动作失败：' + (error && error.message));
    return;
  }
  const label = ACTION_NAMES[chosen.action] || chosen.action;
  terminalLog('info', '已发给服务器：' + label + '（' + sentMethod + ' ' + sentArg + '，决策号 ' + cap + '）');
  const amountText = chosen.action === 'da' ? ' ' + Math.trunc(chosen.amount) : '';
  emit('ActionSubmitted', {
    action: chosen.action,
    label,
    amount: chosen.action === 'da' ? Math.trunc(chosen.amount) : null,
    reason: chosen.reason,
    captureId: capture,
    roomId: state.roomId,
  }, { roomId: state.roomId, roundId: state.lastRoundId });
  terminalLog('info', '第 ' + state.roomRound + ' 局出牌：' + label + amountText
    + '（' + chosen.reason + '；角色 ' + role + '，跟注 ' + state.genScore + '，底池 ' + state.beicount + '）');
}

// 轮到自己时按策略出牌；决策编号只提交一次，编号变了就重新排。
// 策略抛异常不能把整个客户端进程带崩（之前一次 ReferenceError 直接 exit，机器人反复重启）。
// 出错时退化为过牌，并留一条 error 日志。
function safeDecide(ctx) {
  try {
    return strategy.decide(ctx);
  } catch (error) {
    terminalLog('error', '策略计算异常，本手退化为过牌：' + (error && error.message));
    return { action: 'pass', amount: null, reason: '策略异常兜底过牌' };
  }
}

function scheduleAction(role) {
  if (!cfg.autoAction || state.paused || state.stopping || state.actionTimer) return;
  const turnKey = state.turnKey;
  if (state.actedTurnKey === turnKey) {
    log('debug', '这个决策窗口已经出过牌（' + turnKey + '），跳过');
    return;
  }
  const capture = state.captureId;
  // 出牌延迟与决策超时都来自策略，默认 1200–2500ms、6 秒不决策放弃本轮。
  const tuning = strategyOptions().tuning;
  const minDelay = Math.max(200, tuning.actionDelayMinMs);
  const maxDelay = Math.max(minDelay, tuning.actionDelayMaxMs);
  const delay = minDelay + Math.floor(Math.random() * Math.max(1, maxDelay - minDelay));
  state.actionTimer = setTimeout(() => {
    state.actionTimer = null;
    if (state.paused || state.stopping) {
      log('debug', '出牌跳过：' + (state.paused ? '已暂停' : '正在停止'));
      return;
    }
    if (state.stage !== 'room') {
      log('debug', '出牌跳过：已不在房间（' + state.stage + '）');
      return;
    }
    if (turnKey !== state.turnKey) {
      // 等计时期间换成了新的决策窗口，重新排一次。
      scheduleAction(role);
      return;
    }
    if (Date.now() - state.lastDecisionAt > tuning.decideTimeoutMs) {
      // 明确记一条：这次是「决策窗口过期」而不是策略算不出动作。
      log('warn', '决策窗口已过（距轮到我 ' + (Date.now() - state.lastDecisionAt) + 'ms > ' + tuning.decideTimeoutMs + 'ms），本轮不动作');
      return;
    }
    const account = player();
    if (!account) return;
    // 服务端说 is_action=True 就该我们动；role 可能还是「等待/排队」这种动画中间态，
    // 这时回退到 state.role，再不行用通用下注组（真实客户端此时按钮就是丢/跟/敲/大）。
    let usableRole = String(role || state.role || '');
    if (!usableRole || usableRole.includes('等待') || usableRole.includes('排队')) {
      usableRole = String(state.role || '');
    }
    if (!usableRole || usableRole.includes('等待') || usableRole.includes('排队')) {
      usableRole = '丢休敲大不不';
      log('debug', '角色是中间态，按通用下注组出牌（' + usableRole + '）');
    }
    state.actedTurnKey = turnKey;
    const ctx = strategyContext(usableRole);
    submitAction(account, safeDecide(ctx), capture, ctx.role);
  }, delay);
}

// ---- 事件分发 ----

// ---- 线路日志：把「发给服务端」和「服务端发来」的报文按真实客户端格式写进本地日志 ----
// 只在本地 stdout（/tmp/xuanagent-<节点>.log），不推到后台，避免刷后台事件。
let wireAccount = null;

function wrapAccountWire(account) {
  if (!account || wireAccount === account) return;
  wireAccount = account;
  // req* 方法在实体原型链上，逐层收集
  const keys = new Set();
  for (let obj = account; obj && obj !== Object.prototype; obj = Object.getPrototypeOf(obj)) {
    for (const k of Object.keys(obj)) keys.add(k);
  }
  for (const key of keys) {
    if (!key.startsWith('req') || typeof account[key] !== 'function') continue;
    const origin = account[key].bind(account);
    const wrapper = (...args) => {
      try {
        const text = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        log('info', 'C->S:' + key + ' ' + text.slice(0, 400));
      } catch (error) { /* 日志不能影响发送 */ }
      return origin(...args);
    };
    try { account[key] = wrapper; } catch (error) { /* 只读时跳过 */ }
  }
}

// 打印一条上行消息（聊天/牌局等热路径，量大但排查必需）
const WIRE_S2C_KEYS = new Set([
  'onMessage', 'PlayerList', 'onRoomCommand', 'onGameCommand', 'onHallCommand',
  'onEnterRoom', 'PromptInfo', 'PromptInfo2', 'RoundScore', 'OtherInfo',
]);

function wireLogIncoming(name, args) {
  if (!WIRE_S2C_KEYS.has(name)) return;
  try {
    const first = args && args.length ? args[0] : '';
    const text = typeof first === 'string' ? first : JSON.stringify(first);
    log('info', 'S->C:' + name + ' ' + String(text).slice(0, 400));
  } catch (error) { /* 忽略 */ }
}

function onEvent(name, args) {
  wireLogIncoming(name, args);
  gameLog(name, args);
  switch (name) {
    case 'onLoginSuccessfully': {
      const account = args[0];
      if (!account) return;
      state.stage = 'hall';
      state.account = account;
      state.guuid = String(account.guuid || '');
      state.nickname = String(account.name || '');
      state.gold = Number(account.gold || 0);
      state.reloginCount = 0;
      wrapAccountWire(account);
      emit('LoginSucceeded', {
        account: cfg.account,
        entityId: account.id,
        guuid: state.guuid,
        nickname: state.nickname,
        gold: state.gold,
      });
      if (cfg.loginOnly) {
        // 玩家行由游戏服在首次登录时写入，多留几秒等它落库再退出。
        clearTimers();
        log('info', '只登录激活：登录成功，准备退出');
        later(3000, () => shutdown('login-only'));
        return;
      }
      // 真机登录后会设置一次 gps 属性，后台据此判断账号位置。
      clearTimers();
      later(1500, () => reportGps(player() || account, true));
      later(1200, () => afterLogin(player() || account));
      return;
    }
    case 'onLoginFailed': {
      const code = Number(args[0]);
      emit('LoginFailed', { account: cfg.account, code, message: errorText(code) });
      shutdown('login-failed');
      return;
    }
    case 'onLoginBaseappFailed':
    case 'onReloginBaseappFailed':
      scheduleRelogin('连接服务器失败：' + errorText(Number(args[0])));
      return;
    case 'onDisconnected':
      scheduleRelogin('连接已断开，准备重连');
      return;
    case 'onConnectionState':
      if (args[0] === false) scheduleRelogin('网络连接失败，准备重连');
      return;
    case 'onKicked':
      emit('LoginFailed', { account: cfg.account, code: Number(args[0]), message: '连接被服务端终止（可能账号在别处登录）' });
      shutdown('kicked');
      return;
    case 'AllRoomInfo': {
      let payload = args[0];
      try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch (error) { return; }
      if (!payload || !Array.isArray(payload.result)) return;
      const account = player();
      if (!account || state.stage !== 'hall' || state.paused || state.stopping) return;
      const room = pickRoom(payload.result);
      if (!room) {
        // 名单里有没有「底皮合适但余额不够」的房？有的话就是缺钱，按缺钱报，别只报没空房。
        const funds = availableFunds(account).value;
        const tooPoor = (payload.result || []).some((item) => {
          const parsed = parseRoom(item);
          if (!parsed || !(parsed.id > 0)) return false;
          if (cfg.roomPi.length > 0 && !cfg.roomPi.includes(parsed.pi)) return false;
          const need = roomMinBuyin(item);
          return need > 0 && funds < need;
        });
        if (tooPoor) {
          // 传入 0 让 markFundShortage 用当前房间的最低带入兜底，避免拿第一间房的规则误导文案。
          markFundShortage(funds, 0);
          return;
        }
        const reason = cfg.roomPi.length > 0
          ? '没有 ' + cfg.roomPi.join('、') + ' 的空房，稍后重试'
          : '俱乐部暂时没有空房，稍后重试';
        emit('Waiting', { reason, clubId: cfg.clubId, retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
        return;
      }
      enterRoom(account, room);
      return;
    }
    case 'PromptInfo':
    case 'PromptInfo2': {
      onPrompt(name, args[0]);
      return;
    }
    case 'onHallCommand': {
      const code = Number(args[0]);
      const param = String(args[1] || '');
      const ok = code === 0x200 || code === 512;
      if (param.includes('club:join')) {
        if (ok) log('info', '直接加入俱乐部已受理');
        else log('warn', '直接加入俱乐部失败：' + errorText(code) + ' ' + param.slice(0, 100));
        return;
      }
      if (param.includes('查询_房间_游戏_信息') && !ok && !state.roomInfoDenied) {
        // 未开通该权限时服务端只回失败、不下发 RoomGameInfo（§2.2）。
        state.roomInfoDenied = true;
        log('warn', '查询房间信息失败：' + errorText(code) + '（账号可能未开通）');
        if (state.seated) emitTableState(seatsCurrent(), currentPhase(), 'own-hand');
      }
      return;
    }
    case 'onEnterRoom': {
      const code = Number(args[0]);
      const roomId = Number(args[1]);
      if (code === 0x200 || code === 512) {
        state.roomId = roomId || state.roomId;
        state.stage = 'room';
        state.enterOk = true;
        // 换了新房间：之前那张桌上试过的坏座作废，等座位表的计数也清零。
        state.badSeats.clear();
        state.sitRetry = 0;
        // 新房间重新开始等座位表，别把上一间的等待计时带过来。
        state.seatWaitSince = 0;
        if (state.seatWaitTimer) {
          clearTimeout(state.seatWaitTimer);
          state.seatWaitTimer = null;
        }
        state.lastTableAt = Date.now();
        log('info', '进入房间 ' + state.roomId + '，等待座位信息');
        // 座位表不一定主动下发，主动找一次空座。
        later(1500, tryTakeSeat);
      } else {
        log('warn', '进入房间被拒：' + code + ' ' + errorText(code));
        state.stage = 'hall';
        state.enterOk = false;
        // 0x311：当前账号不属于这个俱乐部。俱乐部是进房硬前置，回入会流程而不是换房重试。
        if (cfg.clubId && code === 0x311) {
          state.clubJoined = false;
          emit('Waiting', { reason: '账号还没加入俱乐部，正在重新入会', clubId: cfg.clubId, retryInSeconds: 5 });
          requestJoinClub(player());
          return;
        }
        emit('Waiting', { reason: '进入房间被拒（' + code + '），稍后重新找房', retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
        later(3000, () => requestRooms(player(), '重新查询房间'));
      }
      return;
    }
    case 'onRoomCommand': {
      const code = Number(args[0]);
      const param = String(args[1] || '');
      if (param.includes('预坐_事件')) {
        clearPending();
        if (code === 0x200 || code === 512) {
          state.presitOk = true;
          state.sitRetry = 0;
          clearFundShortage();
          state.buyinTry = 0;
          // 座位号只由 PlayerList 决定，这里不再写入（预坐号可能被别人抢走/不是最终座位）。
          // 官方客户端是「预坐锁座 → 等服务端 PlayerList 确认 → 再选带入分数」。
          // 这里给服务端几百毫秒落座时间，太急会被回「请先选择带入分数」。
          later(600, () => {
            // 预坐成功只是「锁到座位」，PlayerList 里已经能看到自己（status=ready/留座），
            // 但那不代表带入了分；必须发一次带入，否则留座 15 秒到期又回到原点。
            if (!state.sitSent) sendSit(player());
          });
        } else if (code === 769 && !state.seated && String(state.lastPromptText || '').includes('选择带入')) {
          // 还没真坐下就要求选带入：说明预坐没锁住，别硬发带入，按抢座失败换座重来。
          log('warn', '未入座却被要求选带入，按预坐失败重试');
          state.presitOk = false;
          if (state.presitSeat >= 0) state.badSeats.add(state.presitSeat);
          state.presitSeat = -1;
          later(800, tryTakeSeat);
        } else if (code === 769 && (String(state.lastPromptText || '').includes('已有留座')
          || String(state.lastPromptText || '').includes('已经坐下'))) {
          // 服务端说「已有留座位置 / 玩家已经坐下」：说明这个号本来就是我们的，
          // 不该再去撞别的座位（以前会从 2 号一路撞到 8 号，把日志刷满）。
          log('info', '服务端提示已留座/已坐下（' + state.lastPromptText + '），停止预坐，按已在座处理');
          state.seatConfirmed = true;
          state.seated = true;
          state.presitOk = true;
          state.sitSent = true;
          state.badSeats.clear();

          const account = player();
          if (account) {
            // 既要真实座位号，也要确认桌面上是否有带入分（没钱就补带入）。
            account.reqPlayerList();
            later(800, () => {
              if (!state.seated) return;
              if (state.money <= 0) {
                state.sitSent = false;
                sendSit(account, 'apply');
              }
            });
          }
        } else if (code === 769 && String(state.lastPromptText || '').includes('选择带入')) {
          // 座位已经预坐上了，服务端在等我们选带入分数：补一次带入，别当成抢座失败。
          log('info', '预坐已锁座，服务端要求选带入，补发带入');
          state.presitOk = true;
          state.sitRetry = 0;
          state.sitSent = false;
          const account = player();
          if (account) later(400, () => sendSit(account));
        } else if (code === 770 && looksLikeFundShortage()) {
          // 预坐就被判「带入金币不足」：服务端在这一步只看俱乐部金币，下发多少带入都没用，
          // 所以直接停手报警，等补金币（不再加码重试）。
          state.presitSeat = -1;
          state.presitOk = false;
          state.sitSent = false;
          markFundShortage(availableFunds(player()).value, currentMinBuyin());
        } else if (code === 770) {
          // 同样是 770，但服务端提示不是缺钱（例如「当前座位已有玩家」）：换下一个空座。
          log('warn', '预坐失败：770（' + (state.lastPromptText || '无提示') + '），换下一个空座');
          if (state.presitSeat > 0) state.badSeats.add(state.presitSeat);
          state.presitSeat = -1;
          state.presitOk = false;
          later(700 + Math.round(Math.random() * 600), tryTakeSeat);
        } else {
          log('warn', '预坐失败：' + code);
          if (state.presitSeat > 0) state.badSeats.add(state.presitSeat);
          state.presitSeat = -1;
          state.presitOk = false;
          later(700 + Math.round(Math.random() * 600), tryTakeSeat);
        }
      } else if (param.includes('坐下_事件')) {
        if (code === 0x200 || code === 512) {
          // 原房继续带入被受理；真正生效还要等新一局手牌，这里先不重复发。
          state.needBuyin = false;
          state.buyinTry = 0;
          return;
        }
        if (code === 770) {
          state.sitSent = false;
          state.presitOk = false;
          state.seatNo = -1;
          state.presitSeat = -1;
          if (!looksLikeFundShortage()) {
            // 非缺钱的 770（座位被占等）：按普通失败重来，不要报成余额不足。
            log('warn', '坐下被拒：770（' + (state.lastPromptText || '无提示') + '）');
            later(1500 + Math.round(Math.random() * 1500), tryTakeSeat);
            return;
          }
          handleSitRejected(availableFunds(player()).value, currentMinBuyin());
          return;
        }
        log('warn', '坐下被拒：' + code);
        // 769 / 301 = 服务端判「带入失败」（客户端弹「请检查俱乐部额度或积分」）：
        // 这就是额度/积分不足，直接报警停手，不再换座重试。
        if (code === 769 || code === 301) {
          state.sitSent = false;
          state.presitOk = false;
          markFundShortage(availableFunds(player()).value, state.lastSitMoney || currentMinBuyin());
          return;
        }
        state.sitSent = false;
        state.presitOk = false;
        state.seatNo = -1;
        state.presitSeat = -1;
        later(2000, tryTakeSeat);
      }
      return;
    }
    case 'PlayerList': {
      let payload = args[0];
      try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch (error) { return; }
      if (payload) onPlayerList(payload);
      return;
    }
    case 'RoundScore': {
      let payload = args[0];
      try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch (error) { return; }
      if (payload) onRoundScore(payload);
      return;
    }
    case '状态鸡': {
      let payload = args[0];
      try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch (error) { return; }
      if (payload) onServerPlay(payload);
      return;
    }
    case 'GameWatcherListInfo': {
      // 获取_游戏内旁观_信息_命令 的回包，经 Account.onMessage 以事件名透传。
      let payload = args[0];
      try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch (error) { return; }
      const list = payload && Array.isArray(payload.GameWatcherListInfo) ? payload.GameWatcherListInfo : [];
      state.spectators = list
        .filter((item) => item && (item.id !== undefined || item.name !== undefined))
        .map((item) => ({
          id: String(item.id == null ? '' : item.id),
          name: String(item.name == null ? '' : item.name),
          photo: item.photo == null ? '' : String(item.photo),
        }))
        .slice(0, 50);
      state.spectatorCount = Number(payload && payload.count) || state.spectators.length;
      if (state.roomId) {
        emitTableState(state.players.length > 0 ? seatsCurrent() : state.tableSeats, currentPhase(), 'watcher-list');
      }
      return;
    }
    case 'onAccountCommand': {
      const code = Number(args[0]);
      const param = String(args[1] || '');
      if (!param.includes('获取_游戏内旁观_信息_命令')) return;
      if (code === 0x200 || code === 512) return;
      state.spectatorDenied = true;
      log('warn', '查询观战列表失败：' + errorText(code) + '（账号可能未开通）');
      return;
    }
    case 'RoomGameInfo': {
      let payload = args[0];
      try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch (error) { return; }
      if (payload) onRoomGameInfo(payload);
      return;
    }
    case 'onGameCommand': {
      clearPending();
      const code = Number(args[0]);
      const param = String(args[1] || '');
      // 预坐/坐下的回包走的是 onGameCommand（真实客户端 onRoomCommand 收 0x200 才算成功），
      // 这里也按成功码判定，否则状态机会一直以为「预坐没确认」。
      if (param.includes('预坐')) {
        if (code === 0x200 || code === 200 || code === 512) {
          state.presitOk = true;
          state.badSeats.clear();
          log('info', '预坐成功（' + code + '）');
        } else {
          log('warn', '预坐失败（' + code + '，' + (state.lastPromptText || '无提示') + '）');
          state.presitOk = false;
        }
        return;
      }
      if (param.includes('执行检查_命令')) {
        if (code === 0x200 || code === 512) log('info', '配牌申请已受理');
        else log('warn', '配牌申请失败：' + errorText(code) + ' ' + param.slice(0, 100));
        return;
      }
      log('debug', '游戏命令返回 ' + code + ' ' + param.slice(0, 120));
      return;
    }
    case 'DismissInfo':
      cancelAction();
      if (state.roomId) {
        emit('RoomClosed', { roomId: state.roomId, reason: 'dismiss' }, { roomId: state.roomId });
        resetTable('waiting', 'dismiss');
        state.roomMeta = null;
        state.roomId = 0;
        state.seated = false;
        state.seatNo = -1;
        state.presitOk = false;
        state.sitSent = false;
        state.enterOk = false;
        state.reinstateAt = 0;
        state.stage = 'hall';
        later(3000, () => requestRooms(player(), '房间已解散，重新找房'));
      }
      return;
    case 'onLeaveRoom':
      cancelAction();
      if (state.roomId) {
        emit('RoomLeft', { roomId: state.roomId, reason: 'server' }, { roomId: state.roomId });
        resetTable('waiting', 'room-left');
        state.roomMeta = null;
        state.roomId = 0;
      }
      state.seated = false;
      state.seatNo = -1;
      state.presitOk = false;
      state.sitSent = false;
      state.enterOk = false;
      state.reinstateAt = 0;
      state.stage = 'hall';
      if (!state.paused && !state.stopping) later(3000, () => requestRooms(player(), '已离开房间，重新找房'));
      return;
    default:
      return;
  }
}

const rawFire = KBEngine.Event.fire.bind(KBEngine.Event);
KBEngine.Event.fire = function (name, ...rest) {
  try {
    onEvent(name, rest);
  } catch (error) {
    log('error', '事件处理异常 ' + name + '：' + (error && error.message));
  }
  return rawFire(name, ...rest);
};

function afterLogin(account) {
  if (!account || state.stopping || state.paused) return;
  state.guuid = String(account.guuid || '');
  state.gold = Number(account.gold || 0);
  state.stage = 'hall';
  // 俱乐部是进房硬前置：不在俱乐部就先入会，进房请求前面还会再校验一次。
  if (cfg.clubId && !clubJoined(account)) {
    state.clubJoined = false;
    requestJoinClub(account);
    return;
  }
  state.clubJoined = true;
  if (cfg.resumeRoomId > 0) {
    // 切换 Worker / 重启终端后优先回原房：服务端如果还留着座位，进房就能直接继续打。
    log('info', '尝试回到上次所在的房间 ' + cfg.resumeRoomId);
    enterRoom(account, { id: cfg.resumeRoomId, maxPlays: 0, pi: '', status: '', raw: null });
    return;
  }
  requestRooms(account, '正在查询俱乐部房间');
}

// ---- 控制 ----

// 排空：后台按周计划让出 Worker 时下发。手里有没结算的牌局就打完再走，
// 否则立刻退出；后台要等客户端真正离房（RoomLeft）才收回节点上的位置。
function drainNow(reason) {
  if (state.stopping) return;
  state.draining = true;
  const inRound = state.seated && state.roomRound > 0 && state.settledRound !== state.roomRound;
  if (inRound) {
    terminalLog('info', '收到排空指令，第 ' + state.roomRound + ' 局打完后退出');
    return;
  }
  shutdown(reason);
}

function shutdown(reason) {
  if (state.stopping) return;
  state.stopping = true;
  cancelAction();
  clearTimers();
  const account = player();
  try {
    if (account && state.seated) {
      account.reqRoomCommand(JSON.stringify({ header: '起立_事件' }), '起立_事件');
    }
    if (account && state.roomId) account.reqLeaveRoom();
    if (state.roomId) emit('RoomLeft', { reason, roomId: state.roomId });
    state.roomId = 0;
  } catch (error) {
    log('warn', '退出前清理失败：' + error.message);
  }
  later(800, () => {
    try { KBEngine.Event.fire('logout'); } catch (error) { /* 已断开时忽略 */ }
    emit('LogoutSucceeded', { account: cfg.account, reason });
    later(300, () => process.exit(0));
  });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let command;
  try { command = JSON.parse(text); } catch (error) { return; }
  switch (command.cmd) {
    case 'stop':
      shutdown('stop');
      return;
    case 'drain':
      drainNow('drain');
      return;
    case 'pause':
      state.paused = true;
      cancelAction();
      clearTimers();
      if (state.seated) leaveRoom('pause');
      else if (state.roomId) leaveRoom('pause');
      return;
    case 'resume':
      if (!state.paused) return;
      state.paused = false;
      later(1000, () => afterLogin(player()));
      return;
    case 'config':
      applyConfig(command);
      return;
    default:
      return;
  }
});

process.on('SIGTERM', () => shutdown('sigterm'));
process.on('SIGINT', () => shutdown('sigint'));

log('info', '客户端启动 ' + cfg.account + ' @ ' + cfg.host + ':' + cfg.port + (cfg.wss ? ' (wss 代理)' : ' (ws 直连)')
  + (PAIR_CLICKS.has(cfg.pairClick) ? '，配牌 click=' + cfg.pairClick : '，未申请配牌')
  + (cfg.roomPi.length > 0 ? '，只进 ' + cfg.roomPi.join('、') : '，不限底皮')
  + '，' + profitText() + '，GPS ' + currentGps());
fireLogin('login');

// 心跳：游戏客户端本身每 2 秒发一次，长期不发会被服务端踢下线。
setInterval(() => {
  if (state.stopping) return;
  const account = player();
  if (account && state.guuid) {
    try { account.reqHeart('heart'); } catch (error) { /* 断线时忽略 */ }
  }
}, 2000);

// 兜底：轮到我 3 秒还没发动作（卡在某个守卫/异常里），强制过牌，
// 宁可这一手过掉，也不要让整桌陪着等 15 秒倒计时。
setInterval(() => {
  if (!state.pendingActionAt) return;
  if (state.stopping || state.paused) return;
  if (Date.now() - state.pendingActionAt < 3000) return;
  state.pendingActionAt = 0;
  const account = player();
  if (!account) return;
  terminalLog('warn', '轮到我 3 秒还没出牌，兜底过牌');
  try { account.reqPass(String(state.captureId)); } catch (error) { /* 断线忽略 */ }
}, 1000);

// 查某个座位的最新状态（对应真实客户端里别人的 PlayerCtl 对象）。
function seatView(seatNo) {
  return state.seatViews[Number(seatNo) || 0] || null;
}

// 房间兜底：在房里但很久没有任何牌局动静（房间已经散了、服务端没推关闭），主动离房重进。
setInterval(() => {
  if (state.stopping || state.paused) return;
  if (state.stage !== 'room' || !state.roomId || state.seated === false) {
    // 不在房里就不需要兜底
    if (state.stage !== 'room') return;
  }
  if (!state.lastTableAt) return; // 刚进房还没收到座位表，先不算
  const idle = Date.now() - state.lastTableAt;
  if (idle < 300000) return; // 5 分钟
  terminalLog('warn', '房间 ' + state.roomId + ' 已经 ' + Math.round(idle / 60000) + ' 分钟没有任何牌局动静，主动离房重进');
  state.badSeats.clear();
  state.stayBuyinCount = 0;
  leaveRoom('room-idle');
  emit('Waiting', { reason: '房间长时间无动静，重新找房', retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
  later(1500, () => requestRooms(player(), '房间无动静重进'));
}, 30000);

// GPS 续报：真机客户端也是登录后每分钟重发一次。
setInterval(() => {
  if (state.stopping) return;
  const account = player();
  if (account && state.guuid) reportGps(account, false);
}, 60000);
