// Offline checks for the actual TypeScript clock and manager integration.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ts = require(process.env.TYPESCRIPT_PATH || '/usr/local/lib/node_modules/nexe/node_modules/typescript');
let mono = 0, wall = 100000, requests = 0;
const account = { roomID: '123', reqPlayerList() { requests++; } };
const cc = { Component: class {}, _decorator: { ccclass: x => x, property: () => {} } };
function load(file, dependencies = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, experimentalDecorators: true }, reportDiagnostics: true });
  assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const sandbox = { exports: {}, require: name => dependencies[name] || { default: {} }, cc, performance: { now: () => mono }, Date: class extends Date { constructor() { super(wall); } static now() { return wall; } }, Map, Number, String, isFinite };
  vm.runInNewContext(output.outputText, sandbox, { filename: file });
  return sandbox.exports.default;
}
const Clock = load('assets/scripts/logic/RoomCountdown.ts');
const clock = new Clock();
assert.equal(clock.remaining(0, 100000), null);
clock.sync(1800, false, 0, 100000); assert.equal(clock.remaining(1000, 101000), null);
clock.sync('65', true, 0, 100000);
assert.equal(clock.remaining(12500, 112500), 53); // skipped frames, no callback subtraction
assert.equal(clock.remaining(70000, 170000), 0);
assert.equal(clock.remaining(700000, 800000), 0); // no wrap below zero
clock.sync(-3, true, 0, 100000); assert.equal(clock.remaining(0, 100000), 0);
for (const bad of [null, undefined, '', 'bad', Infinity, 1e30, true]) {
  clock.sync(bad, true, 0, 100000); assert.equal(clock.remaining(0, 100000), null);
}
clock.sync(100, true, 0, 100000); assert.equal(clock.remaining(1000, 160000), null); // system clock jump
clock.sync(100, true, 1000, 100000); assert.equal(clock.remaining(500, 99500), null);
clock.sync(100, true, 0, 100000); clock.invalidate(); assert.equal(clock.remaining(5000, 105000), null);
clock.sync(40, true, 5000, 105000); assert.equal(clock.remaining(6000, 106000), 39);
assert.equal(Clock.format(3600), '60:00'); assert.equal(Clock.format(3661, true), '01:01:01');
clock.sync(100, true, 0, 100000); assert.equal(clock.remaining(60000, 160000, false), null);
assert.equal(Clock.format(-1), '00:00'); assert.equal(Clock.format(NaN), '00:00');
const Manager = load('assets/scripts/logic/DrhLogicMgr.ts', {
  './RoomCountdown': { default: Clock },
  './QueueMatchManager': { default: { getInstance: () => ({ rememberEnteredRoom() {} }) } },
  '../common/Debug': { default: { Log() {} } }, '../GameDataManager': { default: { getAccount: () => account } },
});
const manager = new Manager(); manager.strMsgRoomID = '123'; manager.strGameState = 'running';
manager.roomClockLabel = { node: { active: false }, string: '' };
manager.strGameState = 'init'; manager.SyncRoomCountdownFromPlayMessage({ game_end_time: 1800 });
assert.equal(manager.GetRoomRemainingSeconds(), null); assert.equal(manager.roomClockLabel.node.active, false);
manager.strGameState = 'running';
manager.SyncRoomCountdownFromPlayMessage({ game_end_time: 10, room_id: '123' });
assert.equal(manager.roomClockLabel.string, '剩余时间 00:10');
mono = 3000; wall += 3000; manager.RefreshRoomCountdown(); assert.equal(manager.roomClockLabel.string, '剩余时间 00:07');
manager.SyncRoomCountdownFromPlayMessage({ game_end_time: 999, room_id: 'other' }); assert.equal(manager.GetRoomRemainingSeconds(), 7);
for (let i = 0; i < 500; i++) { mono += 200; wall += 200; manager.RefreshRoomCountdown(); }
assert.equal(requests, 0); assert.equal(manager.roomClockLabel.string, '剩余时间 00:00');
manager.OnRoomClockDisconnected(); assert.equal(manager.roomClockLabel.node.active, false);
manager.SyncRoomCountdownFromPlayMessage({ game_end_time: 20 }); assert.equal(manager.GetRoomRemainingSeconds(), null);
manager.OnRoomClockReconnected(); assert.equal(requests, 1); assert.equal(manager.GetRoomRemainingSeconds(), null);
manager.SyncRoomCountdownFromPlayMessage({ game_end_time: 20 }); assert.equal(manager.GetRoomRemainingSeconds(), 20);
manager.OnUpdatePlayerList(JSON.stringify({ room_id: 'other', GameStatus: 'end', game_end_time: 999 }));
assert.equal(manager.strGameState, 'running'); assert.equal(manager.GetRoomRemainingSeconds(), 20);
manager.bShowOverAnimate = true;
manager.OnUpdatePlayerList(JSON.stringify({ room_id: '123', GameStatus: 'running', round_count: 1, game_end_time: 30 }));
assert.equal(manager.GetRoomRemainingSeconds(), 30);
mono += 5000; wall += 5000;
manager.OnUpdatePlayerList(JSON.stringify({ room_id: '123', GameStatus: 'running', round_count: 1, game_end_time: 30 }), true);
assert.equal(manager.GetRoomRemainingSeconds(), 25); // replay cannot restart an old snapshot
manager.roomClockSuspended = true; manager.InvalidateRoomCountdown();
manager.SyncRoomCountdownFromPlayMessage({ game_end_time: 99 }); assert.equal(manager.GetRoomRemainingSeconds(), null);
manager.roomClockSuspended = false; manager.strGameState = 'end';
manager.SyncRoomCountdownFromPlayMessage({ game_end_time: 99 }); assert.equal(manager.GetRoomRemainingSeconds(), null);
// Transpile both consumers, including the push message hook.
load('assets/scripts/logic/DrhPlayerLogic.ts');
const viewSource = fs.readFileSync('assets/scripts/UI/panelGameView.ts', 'utf8');
assert.equal((ts.transpileModule(viewSource, { compilerOptions: { experimentalDecorators: true }, reportDiagnostics: true }).diagnostics || []).filter(d => d.category === 1).length, 0);
for (const file of ['assets/resources/UI/panelGameView.prefab', 'assets/Scenes/drh8.fire']) {
  const data = JSON.parse(fs.readFileSync(file));
  const nodes = data.filter(n => n._name === '游戏时间'); assert.equal(nodes.length, 1);
  const node = nodes[0], parent = data[node._parent.__id__]; assert.equal(parent._name, 'info'); assert.equal(node._active, false);
  const label = data[node._components[0].__id__], widget = data[node._components[1].__id__];
  assert.equal(label._string, '剩余时间 00:00'); assert.equal(widget.alignMode, 2); assert.equal(widget._alignFlags, 20); assert.equal(widget._bottom, 0);
  function refs(obj) { if (!obj || typeof obj !== 'object') return; if ('__id__' in obj) assert.ok(obj.__id__ >= 0 && obj.__id__ < data.length); Object.values(obj).forEach(refs); }
  data.forEach(refs);
}
console.log('PASS: countdown timing, zero clamp, invalid data, clock jumps, passive sync, reconnect, room isolation, TS transpilation and formal nodes');
