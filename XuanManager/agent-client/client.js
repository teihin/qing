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
  inviteCode: String(env('XUAN_INVITE_CODE', '')).trim(),
  joinStatus: env('XUAN_JOIN_STATUS', 'unassigned'),
  buyinMultiple: Math.max(1, Math.min(10, Number(env('XUAN_BUYIN_MULTIPLE', '1')) || 1)),
  startPaused: env('XUAN_START_PAUSED', '0') === '1',
  host: env('XUAN_GAME_HOST', '154-37-155-17.nip.io'),
  port: Number(env('XUAN_GAME_PORT', '20013')),
  wss: env('XUAN_GAME_WSS', '1') !== '0',
  roomRetryMs: Number(env('XUAN_ROOM_RETRY_MS', '15000')),
  sitTimeoutMs: Number(env('XUAN_SIT_TIMEOUT_MS', '12000')),
  autoAction: env('XUAN_AUTO_ACTION', '1') !== '0',
  // 配牌 click（多人代打接口 §2.3）：0 不申请；1~8 软模式、11~18 严格、98/99 最大。
  pairClick: Number(env('XUAN_PAIR_CLICK', '0')) || 0,
  // 只进的底皮档位（后台投放时设置），空数组表示不限。
  roomPi: String(env('XUAN_ROOM_PI', '')).split(',').map(normalizePi).filter(Boolean),
  // 真机身份：GPS 登录后上报；输赢目标是「时间范围内累计净分」的目标，0 表示不控制。
  gps: String(env('XUAN_GPS', '')).trim(),
  profitMode: String(env('XUAN_PROFIT_MODE', '')).trim(),
  profitTarget: Number(env('XUAN_PROFIT_TARGET', '0')) || 0,
  netToday: Number(env('XUAN_NET_TODAY', '0')) || 0,
  netPeriod: Number(env('XUAN_NET_PERIOD', '0')) || 0,
  periodStart: String(env('XUAN_PERIOD_START', '')).trim(),
  periodEnd: String(env('XUAN_PERIOD_END', '')).trim(),
};

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
  joinRequested: false,
  joinAttempts: 0,
  skipJoinCheck: false,
  clubJoined: false,
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

function errorText(code) {
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
    args.wssProxyBaseURL = 'wss://' + cfg.host + '/ws/';
    args.wssProxyAllowedPorts = [20013, 20015, 20016, 20017, 20018, 20019];
    args.defBaseAppIP = cfg.host;
    KBEngine.create(args);
    engineCreated = true;
  }
  emit('LoginStarted', { account: cfg.account, scene });
  const loginData = JSON.stringify({
    version: 1,
    platform: 'web',
    device_id: 'xuanagent-' + cfg.terminalNo,
    scene,
  });
  KBEngine.Event.fire('login', cfg.account, cfg.password, loginData);
}

function scheduleRelogin(reason) {
  if (state.stopping) return;
  emit('Waiting', { reason, retryInSeconds: 3 });
  clearTimers();
  later(3000, () => fireLogin('reconnect'));
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
  return (cfg.profitMode === 'period' ? '周期' : '每日') + '目标 ' + amount + '，当前净分 ' + netBase() + pending;
}

// 服务端心跳带来的净分/目标更新：净值是权威基线，本地待记增量清零（已含在净值里）。
function applyConfig(input) {
  const previous = {
    gps: cfg.gps, mode: cfg.profitMode, target: cfg.profitTarget,
    today: cfg.netToday, period: cfg.netPeriod,
    start: cfg.periodStart, end: cfg.periodEnd,
  };
  if (typeof input.gps === 'string' && input.gps.trim()) cfg.gps = input.gps.trim();
  if (typeof input.profitMode === 'string') cfg.profitMode = input.profitMode.trim();
  if (Number.isFinite(Number(input.profitTarget))) cfg.profitTarget = Number(input.profitTarget) || 0;
  if (Number.isFinite(Number(input.todayNet))) cfg.netToday = Number(input.todayNet) || 0;
  if (Number.isFinite(Number(input.periodNet))) cfg.netPeriod = Number(input.periodNet) || 0;
  if (typeof input.periodStart === 'string') cfg.periodStart = input.periodStart.trim();
  if (typeof input.periodEnd === 'string') cfg.periodEnd = input.periodEnd.trim();
  state.netPending = 0;
  state.roundPlan = null;
  const account = player();
  if (account && (previous.gps !== cfg.gps || !state.gpsReported)) reportGps(account, true);
  const changed = previous.gps !== cfg.gps || previous.mode !== cfg.profitMode || previous.target !== cfg.profitTarget
    || previous.today !== cfg.netToday || previous.period !== cfg.netPeriod
    || previous.start !== cfg.periodStart || previous.end !== cfg.periodEnd;
  if (changed) terminalLog('info', '配置更新：' + profitText());
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

function trackRound(roundNo) {
  const value = Number(roundNo);
  if (!Number.isFinite(value) || value <= 0) return;
  state.roomRound = value;
  const roundId = state.roomId + '-' + value;
  if (roundId === state.lastRoundId) return;
  state.lastRoundId = roundId;
  state.settledRound = 0;
  if (state.seated) {
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
    if (t === 0 && n === 0) return;
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
      // club_join 没同步回来时不能死循环，先进房让服务端判定（非成员会回 0x311）。
      state.skipJoinCheck = true;
      state.joinRequested = false;
      state.joinAttempts = 0;
      log('warn', '三次入会都没等到 club_join 变化，改为直接尝试进房');
      afterLogin(current || account);
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
  const players = Array.isArray(room.player_list) ? room.player_list.length : 0;
  return {
    id: Number(room.room_id),
    status: room.room_status == null ? '' : String(room.room_status),
    plays: Number(room.player_and_watcher_count) || players,
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
    if (room.maxPlays > 0 && room.plays >= room.maxPlays) continue;
    if (cfg.roomPi.length > 0 && !cfg.roomPi.includes(room.pi)) continue;
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
  state.stage = 'room';
  state.roomId = Number(room.id);
  state.seatNo = -1;
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
  emit('Waiting', { reason: '正在进入房间 ' + state.roomId + (room.pi ? '（' + room.pi + '）' : ''), roomId: state.roomId });
  account.reqEnterRoom('Custom', state.roomId, JSON.stringify({ special_rule: '观战', club_id: cfg.clubId }));
  scheduleRoomPoll();
  later(12000, () => {
    if (state.stopping || state.paused || state.seated || state.stage !== 'room') return;
    leaveRoom('enter-timeout');
    later(2000, () => requestRooms(player(), '进入房间超时，重新找房'));
  });
}

function leaveRoom(reason) {
  const account = player();
  cancelAction();
  resetTable('waiting', 'leave-room');
  state.roomMeta = null;
  state.stage = 'hall';
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

function freeSeat(players) {
  for (const item of players || []) {
    if (String(item.id) === 'init') return Number(item.num);
  }
  return -1;
}

function sendSit(account) {
  if (state.sitSent || state.seated || state.seatNo < 0) return;
  const min = currentMinBuyin();
  const gold = Number(account.gold || 0);
  let money = min > 0 ? min * cfg.buyinMultiple : 100 * cfg.buyinMultiple;
  if (gold > 0) money = Math.min(money, gold);
  if (money <= 0) {
    emit('Waiting', { reason: '金币不足，无法带入', roomId: state.roomId });
    return;
  }
  state.sitSent = true;
  account.reqRoomCommand(JSON.stringify({
    header: '坐下_事件',
    money,
    ready: 1,
    type: '直接',
    club_id: cfg.clubId,
  }), '坐下_事件1');
  later(cfg.sitTimeoutMs, () => {
    if (state.stopping || state.seated) return;
    log('warn', '坐下超时，重新占座');
    state.presitOk = false;
    state.sitSent = false;
    state.seatNo = -1;
    state.presitSeat = -1;
  });
}

function onPlayerList(payload) {
  const players = payload.Players || [];
  const account = player();
  if (!account) return;
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
    const firstTime = !state.seated;
    state.seatNo = seat;
    state.presitSeat = seat;
    state.seated = true;
    if (firstTime) {
      emit('RoomJoined', { roomId: state.roomId, seatNo: seat, clubId: cfg.clubId }, { roomId: state.roomId });
      emit('PlayerSeated', { roomId: state.roomId, seatNo: seat }, { roomId: state.roomId });
      emit('GameReady', { roomId: state.roomId, seatNo: seat }, { roomId: state.roomId });
    }
    if (!state.sitSent && state.presitOk) sendSit(account);
  } else if (state.stage === 'room' && !state.stopping && !state.paused) {
    const seat = freeSeat(players);
    if (seat >= 0 && state.presitSeat !== seat) {
      state.presitSeat = seat;
      state.presitOk = false;
      state.sitSent = false;
      account.reqRoomCommand(JSON.stringify({ header: '预坐_事件', site: seat }), '预坐_事件');
    }
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
  if (!state.seated) return;
  const msg = String(payload.msg || '');
  const text = String(payload.state || '');
  const mine = Number(payload.player_number) === state.seatNo
    || (state.guuid !== '' && String(payload.player_name || '') === state.guuid);

  // 倒计时是广播的（§3.3）：别人的倒计时一到，说明我的决策窗口已经结束。
  if (msg === '决策_倒计时_消息' && !mine) {
    cancelAction();
    return;
  }
  if (!mine) return;

  // 与游戏内 DrhPlayerLogic 一致：每次「决策_信息_消息」给本人策略编号 +1，
  // 牌桌动作必须带这个编号，否则服务端会当成过期操作。
  if (msg === '决策_信息_消息') state.captureId += 1;
  if (msg === '持有_手牌_消息' || msg === '发牌_结束_消息' || msg === '结算_结束_消息') {
    trackRound(payload.room_round);
  }

  // 策略要用的服务端数据都随「当前_玩家_消息」下发，字段缺失时保留上一次的值。
  if (payload.role !== undefined) state.role = String(payload.role);
  if (payload.gen_score !== undefined) state.genScore = Number(payload.gen_score) || 0;
  if (payload.money_score !== undefined) state.money = Number(payload.money_score) || 0;
  const tableTimes = payload.table_times !== undefined ? payload.table_times : payload.all_bei_shu;
  if (tableTimes !== undefined) state.beicount = Number(tableTimes) || 0;
  if (payload.bei_shu_unit !== undefined) {
    state.betUnits = String(payload.bei_shu_unit).split(',')
      .map((item) => Number(String(item).trim()))
      .filter((item) => Number.isFinite(item) && item > 0);
  }
  if (msg === '持有_手牌_消息' && Array.isArray(payload.now_pai)) {
    state.hand = cardList(payload.now_pai);
    state.handCount = Number(payload.now_pai_count || state.hand.length) || state.hand.length;
  }
  // 摸到的活牌直接补进手牌，扯牌时才能按四张一起拆。
  if (msg === '一张_活牌_消息' && Array.isArray(payload.pai) && payload.pai.length >= 2) {
    state.hand.push([Number(payload.pai[0]), Number(payload.pai[1])]);
    state.handCount = state.hand.length;
  }
  // 每局只做一次计划：拿到手牌时按当时的净分决定这一局争赢、争输还是常规打。
  if (msg === '持有_手牌_消息' && state.roomRound > 0 && state.plannedRound !== state.roomRound) {
    state.plannedRound = state.roomRound;
    planCurrentRound();
  }
  if (msg === '结算_信息_消息') {
    // round_score 是「本局分,芒分,喜分,合计」，只有自己那条带明细（§3.4）。
    settleRound(String(payload.round_score || '').split(',')[0]);
  }
  if (msg === '结算_结束_消息') {
    cancelAction();
    if (String(payload.is_exit || '') === 'True') log('warn', '服务端提示本局结束后已离桌');
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
    cancelAction();
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
  if (isAction) scheduleAction(String(payload.role || state.role || ''));
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
  return { roomSetting: state.roomSetting };
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
  const thresholds = strategy.thresholds[roomType] || strategy.thresholds[1];
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
  const chosen = adjustAction(decision, role);
  // 四张牌不全时不发扯牌：老客户端也只记异常、不动作，乱发会被服务端判废操作。
  if (chosen.action === 'skip') {
    terminalLog('warn', '扯牌条件不足（手牌 ' + state.hand.length + ' 张），本轮不操作');
    return;
  }
  const cap = capture.toString();
  try {
    switch (chosen.action) {
      case 'qiao':
        account.reqRaise('-3', cap);
        break;
      case 'xiu':
        account.reqRaise('-5', cap);
        break;
      case 'gen':
        account.reqRaise('-1', cap);
        break;
      case 'da':
        account.reqRaise(String(Math.trunc(chosen.amount)), cap);
        break;
      case 'show':
        account.reqShow(JSON.stringify({ showlist: decision.cards.map((card) => [card[0], card[1]]) }), '');
        break;
      case 'diu':
      default:
        account.reqPass(cap);
        break;
    }
  } catch (error) {
    terminalLog('error', '提交动作失败：' + (error && error.message));
    return;
  }
  const label = ACTION_NAMES[chosen.action] || chosen.action;
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
function scheduleAction(role) {
  if (!cfg.autoAction || state.paused || state.stopping || state.actionTimer) return;
  if (state.lastActionCapture === state.captureId) return;
  const capture = state.captureId;
  const delay = 1200 + Math.floor(Math.random() * 1300);
  state.actionTimer = setTimeout(() => {
    state.actionTimer = null;
    if (state.paused || state.stopping || !state.seated) return;
    if (capture !== state.captureId) {
      // 等计时期间又来了新的决策编号，按新编号重新排一次。
      scheduleAction(role);
      return;
    }
    if (Date.now() - state.lastDecisionAt > 6000) return;
    const account = player();
    if (!account) return;
    state.lastActionCapture = capture;
    const ctx = strategyContext(role || state.role || '');
    submitAction(account, strategy.decide(ctx), capture, ctx.role);
  }, delay);
}

// ---- 事件分发 ----

function onEvent(name, args) {
  switch (name) {
    case 'onLoginSuccessfully': {
      const account = args[0];
      if (!account) return;
      state.stage = 'hall';
      state.account = account;
      state.guuid = String(account.guuid || '');
      state.nickname = String(account.name || '');
      state.gold = Number(account.gold || 0);
      emit('LoginSucceeded', {
        account: cfg.account,
        entityId: account.id,
        guuid: state.guuid,
        nickname: state.nickname,
        gold: state.gold,
      });
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
        const reason = cfg.roomPi.length > 0
          ? '没有 ' + cfg.roomPi.join('、') + ' 的空房，稍后重试'
          : '俱乐部暂时没有空房，稍后重试';
        emit('Waiting', { reason, clubId: cfg.clubId, retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
        return;
      }
      enterRoom(account, room);
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
        log('info', '进入房间 ' + state.roomId + '，等待座位信息');
      } else {
        log('warn', '进入房间被拒：' + code + ' ' + errorText(code));
        emit('Waiting', { reason: '进入房间被拒（' + code + '），稍后重新找房', retryInSeconds: Math.round(cfg.roomRetryMs / 1000) });
        state.stage = 'hall';
        later(3000, () => requestRooms(player(), '重新查询房间'));
      }
      return;
    }
    case 'onRoomCommand': {
      const code = Number(args[0]);
      const param = String(args[1] || '');
      if (param.includes('预坐_事件')) {
        if (code === 0x200 || code === 512) {
          state.presitOk = true;
          if (state.seatNo < 0) state.seatNo = state.presitSeat;
          sendSit(player());
        } else {
          log('warn', '预坐失败：' + code);
          state.presitSeat = -1;
          state.presitOk = false;
        }
      } else if (param.includes('坐下_事件')) {
        if (code !== 0x200 && code !== 512) {
          log('warn', '坐下被拒：' + code);
          state.sitSent = false;
          state.presitOk = false;
          state.seatNo = -1;
          state.presitSeat = -1;
        }
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
      const code = Number(args[0]);
      const param = String(args[1] || '');
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
  if (cfg.clubId && !state.skipJoinCheck && !clubJoined(account)) {
    requestJoinClub(account);
    return;
  }
  state.clubJoined = true;
  requestRooms(account, '正在查询俱乐部房间');
}

// ---- 控制 ----

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

log('info', '客户端启动 ' + cfg.account + ' @ ' + cfg.host + ':' + cfg.port + (cfg.wss ? ' (wss)' : ' (ws)')
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

// GPS 续报：真机客户端也是登录后每分钟重发一次。
setInterval(() => {
  if (state.stopping) return;
  const account = player();
  if (account && state.guuid) reportGps(account, false);
}, 60000);
