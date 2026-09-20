const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

let source = fs.readFileSync('assets/scripts/UI/panelRoomInvite.ts', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/^const \{ccclass\} = cc\._decorator;\n\n/gm, '')
  .replace(/^@ccclass\n/gm, '')
  .replace('export default class panelRoomInvite extends UIPanelViewBase', 'class panelRoomInvite extends UIPanelViewBase')
  .replace(/private (\w+):[^=;]+ = /g, '$1 = ')
  .replace(/\(button:cc\.Button\)/g, '(button)');
source += '\nmodule.exports = panelRoomInvite;';

function panelNode() {
  const label = () => ({ string: '' });
  const children = new Map([
    ['卡片/邀请人', { component: label(), getComponent() { return this.component; } }],
    ['卡片/房间信息/房间号', { component: label(), getComponent() { return this.component; } }],
    ['卡片/底皮值', { component: label(), getComponent() { return this.component; } }],
    ['卡片/人数值', { component: label(), getComponent() { return this.component; } }],
    ['卡片/本次登录不再弹出', { component: { isChecked: false, checkMark: { node: { active: true } } }, getComponent() { return this.component; } }],
  ]);
  return { children, node: {} };
}
const calls = [];
const manager = { handleDialogAction: (...args) => calls.push(args) };
class UIPanelViewBase { start() {} }
const sandbox = {
  module: { exports: null },
  UIPanelViewBase,
  RoomInviteManager: { getInstance: () => manager },
  Tool: { GetChild: (root, path) => root.children.get(path) },
  cc: { Toggle: class {}, Label: class {} },
  Date,
};
vm.runInNewContext(source, sandbox, { filename: 'panelRoomInvite.ts' });
const Panel = sandbox.module.exports;
function instance(data) { const p = new Panel(); const tree = panelNode(); p.node = tree; p.strUserData = data; return [p, tree]; }
function value(tree, path) { return tree.children.get(path).getComponent().string; }

const active = { inviterName: '长名字牌友', inviterID: '998877', roomID: 730564, bottom: '1/3', currentPlayers: 3, maxPlayers: 8, text: '自定义邀请说明', expiresAt: Date.now() + 60000 };
let [valid, tree] = instance(JSON.stringify(active)); valid.start();
assert.equal(value(tree, '卡片/邀请人'), '长名字牌友（ID：998877）邀请你加入');
assert.equal(value(tree, '卡片/房间信息/房间号'), '730564');
assert.equal(value(tree, '卡片/底皮值'), '1/3'); assert.equal(value(tree, '卡片/人数值'), '3/8');
calls.length = 0; tree.children.get('卡片/本次登录不再弹出').getComponent().isChecked = true;
valid.onButtonClick({ node: { name: '忽略' } }); valid.onButtonClick({ node: { name: '前往' } }); valid.onButtonClick({ node: { name: '关闭' } });
assert.deepEqual(calls.map(x => [x[1], x[2]]), [[false, true], [true, true], [false, true]]);
calls.length = 0; instance('{bad json')[0].start(); assert.deepEqual(calls[0], [null, false, false]);
calls.length = 0; instance(JSON.stringify({ ...active, expiresAt: Date.now() - 1 }))[0].start(); assert.equal(calls[0][1], false);
console.log('room invite TypeScript mock regression passed');
