// explore.js —— KBEngine 无头客户端 PoC（2026-10-28 真实登录验证用，见
// docs/memory/topics/automation-real-client.md）。
// 在 Node 里加载游戏自带 SDK + 实体定义，用分配的账号真实登录 154.37.155.17，
// 并按 KBE_STEPS 顺序执行步骤，全量嗅探服务端事件。
//
// 用法（node >= 22，自带 WebSocket）：
//   cd XuanManager/tools/kbe-poc
//   KBE_ACCOUNT=mm000000002 KBE_PASSWORD=111111 \
//   KBE_STEPS=joinclub,clubrooms,enterroom,presit,sit,standup \
//   KBE_CLUB_ID=567671 KBE_ROOM_ID=420121 KBE_SECONDS=20 \
//   node explore.js
//
// 步骤：joinclub(申请入会) clubrooms(查俱乐部房间) enterroom presit sit standup
//       created/returned/playerlist/enterhall
// 注意：kbengine.js / Account.js / Item.js 直接引用 /Volumes/SSD/qing/assets/scripts/kbe_scripts，
//       未随仓库分发；换机器改 KBE_DIR 指到有这三个文件即可。
global.window = global;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KBE_DIR = process.env.KBE_DIR || '/Volumes/SSD/qing/assets/scripts/kbe_scripts';
global.cc = { sys: { localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } }, isNative: false } };

const cache = new Map();
function loadModule(file) {
  const abs = path.resolve(file);
  if (cache.has(abs)) return cache.get(abs).exports;
  const module = { exports: {} };
  cache.set(abs, module);
  const wrapper = vm.runInThisContext(
    '(function (require, module, exports, __filename, __dirname) {' + fs.readFileSync(abs, 'utf8') + '\n})',
    { filename: abs }
  );
  const dir = path.dirname(abs);
  const req = (name) => {
    if (name === 'kbengine') return KBEngine;
    if (/GameDataManager/.test(name)) return { default: { getInstance: () => ({ dtLastSend: 0, dtLastSuccess: 0 }) } };
    return loadModule(path.resolve(dir, name));
  };
  wrapper(req, module, module.exports, abs, dir);
  return module.exports;
}

vm.runInThisContext(fs.readFileSync(path.join(KBE_DIR, 'kbengine.js'), 'utf8'), { filename: 'kbengine.js' });
loadModule(path.join(KBE_DIR, 'Account.js'));
loadModule(path.join(KBE_DIR, 'Item.js'));

const ACCOUNT = process.env.KBE_ACCOUNT || 'mm000000002';
const PASSWORD = process.env.KBE_PASSWORD || '111111';
const HOST = '154-37-155-17.nip.io';
const STEPS = (process.env.KBE_STEPS || '').split(',').filter(Boolean);
const ROOM_ID = Number(process.env.KBE_ROOM_ID || 0);
const CLUB_ID = process.env.KBE_CLUB_ID || '';

KBEngine.INFO_MSG = () => {};
KBEngine.DEBUG_MSG = () => {};
KBEngine.WARNING_MSG = () => {};
KBEngine.ERROR_MSG = (...a) => console.log('[ERR]', ...a);

const t0 = Date.now();
const log = (...a) => console.log('[' + String(Date.now() - t0).padStart(6) + 'ms]', ...a);

// 全量事件嗅探：拦 Event.fire，凡是服务端推的、名字像 on/get 的都打出来
const rawFire = KBEngine.Event.fire.bind(KBEngine.Event);
let quiet = false;
KBEngine.Event.fire = function (name, ...rest) {
  if (!quiet) {
    const brief = rest.map((v) => {
      if (v === null || v === undefined) return String(v);
      if (typeof v === 'object') {
        if (v.className) return '<' + v.className + '#' + v.id + '>';
        try { const s = JSON.stringify(v); return s.length > 260 ? s.slice(0, 260) + '…' : s; } catch { return '<obj>'; }
      }
      return String(v);
    });
    log('EV', name, brief.join(' | ').slice(0, 400));
  }
  return rawFire(name, ...rest);
};

const args = new KBEngine.KBEngineArgs();
args.ip = HOST;
args.port = 20013;
args.isWss = true;
args.wssProxyBaseURL = 'wss://' + HOST + '/ws/';
args.wssProxyAllowedPorts = [20013, 20015, 20016, 20017, 20018, 20019];
args.defBaseAppIP = HOST;

KBEngine.create(args);
log('login', ACCOUNT);
KBEngine.Event.fire('login', ACCOUNT, PASSWORD, JSON.stringify({
  version: 1, platform: 'web', device_id: 'xuanagent-' + ACCOUNT, scene: 'login',
}));

const steps = {
  joinclub: (acc) => acc.reqHallCommand(JSON.stringify({ header: '申请_加入_俱乐部', invite_code: CLUB_ID || '996242' }), 'p@club:join'),
  clubrooms: (acc) => acc.reqHallCommand(JSON.stringify({
    header: '查询_俱乐部_房间_信息',
    club_id: CLUB_ID || '567671',
    is_zip_result: '0',
    page: '0',
    count: '20',
    fillter_01: '',
    is_have_site: 'false',
    fillter_02: '',
    is_no_running: '0',
  }), 'P@查询_俱乐部_房间_信息'),
  enterhall: (acc) => acc.reqEnterHall(1),
  created: (acc) => acc.reqGetCreatedRoom(),
  returned: (acc) => acc.reqGetReturnedRoom(),
  playerlist: (acc) => acc.reqPlayerList(),
  accountlist: (acc) => acc.reqAccountList(),
  enterroom: (acc) => {
    const ex = CLUB_ID ? JSON.stringify({ club_id: CLUB_ID }) : '';
    log('reqEnterRoom Custom', ROOM_ID, ex);
    acc.reqEnterRoom('Custom', ROOM_ID, ex);
  },
  presit: (acc) => acc.reqRoomCommand(JSON.stringify({ header: '预坐_事件', site: Number(process.env.KBE_SITE || 0) }), '预坐_事件'),
  sit: (acc) => acc.reqRoomCommand(JSON.stringify({
    header: '坐下_事件', money: Number(process.env.KBE_MONEY || 100), ready: 1, type: '直接', club_id: CLUB_ID,
  }), '坐下_事件1'),
  standup: (acc) => acc.reqRoomCommand(JSON.stringify({ header: '起立_事件' }), '起立_事件'),
  join: (acc) => acc.reqJoin(),
  ready: (acc) => acc.reqReady(),
  leave: (acc) => acc.reqLeaveRoom(),
};

let index = 0;
const timer = setInterval(() => {
  const acc = KBEngine.app.player();
  if (!acc) return;
  if (index >= STEPS.length) { clearInterval(timer); return; }
  const step = STEPS[index++];
  if (step === 'login') return;
  log('>>> STEP', step);
  try { steps[step]?.(acc); } catch (e) { log('step fail', step, e.message); }
}, 2500);

setTimeout(() => {
  const app = KBEngine.app;
  log('DUMP entities=' + Object.keys(app.entities || {}).length, 'space=' + app.spaceID);
  const acc = app.player();
  if (acc) {
    const keys = ['guuid', 'name', 'gold', 'gold2', 'club_join', 'club_join2', 'club_gold', 'hallID', 'custom_id', 'roomID', 'level', 'client_status'];
    log('props: ' + keys.map((k) => k + '=' + JSON.stringify(acc[k])).join(' '));
  }
  process.exit(0);
}, Number(process.env.KBE_SECONDS || 14) * 1000);
