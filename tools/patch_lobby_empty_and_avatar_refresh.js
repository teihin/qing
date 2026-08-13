#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PREFAB = path.join(ROOT, "assets/resources/UI/panelMain.prefab");
const MATERIAL_UUID = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432";
const FONT_UUID = "fd7307b2-666e-4c26-963d-59f787cad6fb";
const EMPTY_OFF_UUID = "e60c4f15-29e9-4706-87db-deda79c063ac";
const EMPTY_ON_UUID = "5f9b8415-6ba5-4b49-8639-7fdaa42f9278";
const REFRESH_UUID = "380b5a19-b53d-4ab8-ac5a-e2c8b1a212d7";

const objects = JSON.parse(fs.readFileSync(PREFAB, "utf8"));
const ref = (id) => ({__id__: id});
const idOf = (reference) => reference && Number.isInteger(reference.__id__) ? reference.__id__ : -1;
const object = (reference) => objects[idOf(reference)];
const nodeChildren = (node) => (node._children || []).map(object).filter(Boolean);
const add = (value) => {
  objects.push(value);
  return objects.length - 1;
};

function childByName(node, name) {
  return nodeChildren(node).find((child) => child.__type__ === "cc.Node" && child._name === name) || null;
}

function componentByType(node, type) {
  return (node._components || []).map(object).find((component) => component && component.__type__ === type) || null;
}

function directNode(name, parentName) {
  const matches = objects.filter((item) => item && item.__type__ === "cc.Node" && item._name === name &&
    item._parent && objects[item._parent.__id__] && objects[item._parent.__id__]._name === parentName);
  if(matches.length !== 1)
    throw new Error(`节点 ${parentName}/${name} 数量异常：${matches.length}`);
  return matches[0];
}

function transform(x, y, scaleX = 1, scaleY = 1) {
  return {
    __type__: "TypedArray",
    ctor: "Float64Array",
    array: [x, y, 0, 0, 0, 0, 1, scaleX, scaleY, 1],
  };
}

function color(r, g, b, a = 255) {
  return {__type__: "cc.Color", r, g, b, a};
}

function size(width, height) {
  return {__type__: "cc.Size", width, height};
}

function nodeBase(name, parentId, width, height, x, y) {
  return {
    __type__: "cc.Node",
    _name: name,
    _objFlags: 0,
    _parent: ref(parentId),
    _children: [],
    _active: true,
    _components: [],
    _prefab: null,
    _opacity: 255,
    _color: color(255, 255, 255),
    _contentSize: size(width, height),
    _anchorPoint: {__type__: "cc.Vec2", x: 0.5, y: 0.5},
    _trs: transform(x, y),
    _eulerAngles: {__type__: "cc.Vec3", x: 0, y: 0, z: 0},
    _skewX: 0,
    _skewY: 0,
    _is3DNode: false,
    _groupIndex: 0,
    groupIndex: 0,
    _id: "",
  };
}

function prefabInfo(nodeId, fileId) {
  return {
    __type__: "cc.PrefabInfo",
    root: ref(1),
    asset: ref(0),
    fileId,
    sync: false,
  };
}

function spriteComponent(nodeId, spriteFrame, sizeMode = 0) {
  return {
    __type__: "cc.Sprite",
    _name: "",
    _objFlags: 0,
    node: ref(nodeId),
    _enabled: true,
    _materials: [{__uuid__: MATERIAL_UUID}],
    _srcBlendFactor: 770,
    _dstBlendFactor: 771,
    _spriteFrame: {__uuid__: spriteFrame},
    _type: 0,
    _sizeMode: sizeMode,
    _fillType: 0,
    _fillCenter: {__type__: "cc.Vec2", x: 0, y: 0},
    _fillStart: 0,
    _fillRange: 0,
    _isTrimmedMode: true,
    _atlas: null,
    _id: "",
  };
}

function buttonComponent(nodeId) {
  return {
    __type__: "cc.Button",
    _name: "",
    _objFlags: 0,
    node: ref(nodeId),
    _enabled: true,
    _normalMaterial: {__uuid__: MATERIAL_UUID},
    _grayMaterial: null,
    duration: 0.1,
    zoomScale: 0.92,
    clickEvents: [],
    _N$interactable: true,
    _N$enableAutoGrayEffect: false,
    _N$transition: 3,
    transition: 3,
    _N$normalColor: color(255, 255, 255),
    _N$pressedColor: color(211, 211, 211),
    pressedColor: color(211, 211, 211),
    _N$hoverColor: color(255, 255, 255),
    hoverColor: color(255, 255, 255),
    _N$disabledColor: color(124, 124, 124),
    _N$normalSprite: null,
    _N$pressedSprite: null,
    pressedSprite: null,
    _N$hoverSprite: null,
    hoverSprite: null,
    _N$disabledSprite: null,
    _N$target: ref(nodeId),
    _id: "",
  };
}

function labelComponent(nodeId, text, fontSize, align = 1) {
  return {
    __type__: "cc.Label",
    _name: "",
    _objFlags: 0,
    node: ref(nodeId),
    _enabled: true,
    _materials: [{__uuid__: MATERIAL_UUID}],
    _srcBlendFactor: 770,
    _dstBlendFactor: 771,
    _string: text,
    _N$string: text,
    _fontSize: fontSize,
    _lineHeight: fontSize + 4,
    _enableWrapText: false,
    _N$file: {__uuid__: FONT_UUID},
    _isSystemFontUsed: false,
    _spacingX: 0,
    _batchAsBitmap: false,
    _styleFlags: 0,
    _underlineHeight: 0,
    _N$horizontalAlign: align,
    _N$verticalAlign: 1,
    _N$fontFamily: "Arial",
    _N$overflow: 1,
    _N$cacheMode: 0,
    _id: "",
  };
}

function attachNewNode(parent, node, components, fileId) {
  const nodeId = add(node);
  node._parent = ref(objects.indexOf(parent));
  for(const makeComponent of components) {
    const componentId = add(makeComponent(nodeId));
    node._components.push(ref(componentId));
  }
  const prefabId = add(prefabInfo(nodeId, fileId));
  node._prefab = ref(prefabId);
  parent._children.push(ref(nodeId));
  return node;
}

function patchEmptySeatFilter() {
  const filter = directNode("过滤", "发现");
  const filterId = objects.indexOf(filter);
  const categories = ["全", "小", "中", "大"].map((name) => childByName(filter, name));
  if(categories.some((node) => node === null))
    throw new Error("大厅分类节点不完整");

  const positions = [-90, 12, 114, 216];
  categories.forEach((node, index) => {
    node._contentSize.width = 90;
    node._trs.array[0] = positions[index];
  });

  let placeholder = childByName(filter, "空位条件");
  if(!placeholder) {
    placeholder = nodeChildren(filter).find((node) => node._name === "New Node" && node._contentSize && node._contentSize.width === 60) || null;
  }
  if(!placeholder)
    throw new Error("没有找到大厅过滤栏右侧预留节点");
  const placeholderId = objects.indexOf(placeholder);
  placeholder._name = "空位条件";
  placeholder._active = true;
  placeholder._contentSize = size(90, 79);
  placeholder._trs = transform(315, 5.386);

  let toggleNode = childByName(placeholder, "有空位");
  if(!toggleNode) {
    toggleNode = childByName(filter, "20皮");
    if(!toggleNode)
      throw new Error("没有找到可恢复为空位条件的历史20皮节点");
    const toggleId = objects.indexOf(toggleNode);
    filter._children = filter._children.filter((reference) => idOf(reference) !== toggleId);
    placeholder._children = [ref(toggleId)];
    toggleNode._parent = ref(placeholderId);
  }
  toggleNode._name = "有空位";
  toggleNode._active = true;
  toggleNode._contentSize = size(90, 79);
  toggleNode._trs = transform(0, 0);

  const checked = childByName(toggleNode, "checkmark");
  const background = childByName(toggleNode, "Background");
  if(!checked || !background)
    throw new Error("历史过滤按钮缺少选中/未选中节点");
  for(const stateNode of [checked, background]) {
    stateNode._contentSize = size(41, 41);
    stateNode._trs.array[0] = -23;
    stateNode._trs.array[1] = 0;
    const imageNode = nodeChildren(stateNode)[0];
    if(!imageNode)
      throw new Error("空位状态节点缺少图片子节点");
    imageNode._contentSize = size(41, 41);
    imageNode._trs.array[0] = 0;
    imageNode._trs.array[1] = 0;
    const sprite = componentByType(imageNode, "cc.Sprite");
    if(!sprite)
      throw new Error("空位状态图片缺少Sprite");
    sprite._spriteFrame = {__uuid__: stateNode === checked ? EMPTY_ON_UUID : EMPTY_OFF_UUID};
    sprite._sizeMode = 0;
  }

  let textNode = childByName(toggleNode, "空位文字");
  if(!textNode) {
    textNode = nodeBase("空位文字", objects.indexOf(toggleNode), 44, 36, 22, 0);
    attachNewNode(toggleNode, textNode, [
      (nodeId) => labelComponent(nodeId, "空位", 23),
    ], "empty-seat-label");
  }
  textNode._color = color(208, 226, 236);
  textNode._contentSize = size(44, 36);
  textNode._trs = transform(22, 0);
  const textLabel = componentByType(textNode, "cc.Label");
  textLabel._string = "空位";
  textLabel._N$string = "空位";
  textLabel._fontSize = 23;
  textLabel._lineHeight = 27;

  // 未选中底图含半透明深色填充，必须先绘制底图，再绘制勾号。
  toggleNode._children = [
    ref(objects.indexOf(background)),
    ref(objects.indexOf(checked)),
    ref(objects.indexOf(textNode)),
  ];

  const toggle = componentByType(toggleNode, "cc.Toggle");
  const checkedSprite = componentByType(checked, "cc.Sprite");
  if(!toggle || !checkedSprite)
    throw new Error("空位筛选Toggle结构异常");
  toggle._N$isChecked = false;
  toggle.toggleGroup = null;
  toggle._N$target = ref(objects.indexOf(background));
  toggle.checkMark = ref(objects.indexOf(checkedSprite));
  checked._active = false;

  // ToggleContainer只管理“过滤”的直接子节点；空位Toggle放在包装节点内，保持独立复选。
  const placeholderRef = ref(placeholderId);
  filter._children = filter._children.filter((reference) => idOf(reference) !== placeholderId);
  filter._children.push(placeholderRef);
  if(toggleNode._parent.__id__ !== placeholderId || filterId < 0)
    throw new Error("空位筛选父子关系校验失败");
}

function patchAvatarControls() {
  const editPanel = directNode("修改个人信息2", "panelMain");
  const editPanelId = objects.indexOf(editPanel);

  let refresh = childByName(editPanel, "换一批头像");
  if(!refresh) {
    refresh = nodeBase("换一批头像", editPanelId, 165, 40, 250, 185);
    attachNewNode(editPanel, refresh, [
      (nodeId) => spriteComponent(nodeId, REFRESH_UUID, 0),
      (nodeId) => buttonComponent(nodeId),
    ], "avatar-refresh-button");
  }
  refresh._active = true;
  refresh._contentSize = size(165, 40);
  refresh._trs = transform(250, 185);

  let costHint = childByName(editPanel, "头像收费提示");
  if(!costHint) {
    costHint = nodeBase("头像收费提示", editPanelId, 420, 34, 0, -345);
    attachNewNode(editPanel, costHint, [
      (nodeId) => labelComponent(nodeId, "更换头像每次收取10元", 22),
    ], "avatar-cost-hint");
  }
  costHint._active = true;
  costHint._color = color(225, 191, 108);
  costHint._contentSize = size(420, 34);
  costHint._trs = transform(0, -345);
  const costLabel = componentByType(costHint, "cc.Label");
  costLabel._string = "更换头像每次收取10元";
  costLabel._N$string = "更换头像每次收取10元";
  costLabel._fontSize = 22;
  costLabel._lineHeight = 26;

  const confirmPanel = directNode("确定修改个人信息", "panelMain");
  const promptNode = childByName(childByName(confirmPanel, "bk"), "msg");
  const prompt = promptNode && componentByType(promptNode, "cc.Label");
  if(!prompt)
    throw new Error("没有找到头像付费确认提示");
  prompt._string = "更换头像将收取10元，是否确认？";
  prompt._N$string = "更换头像将收取10元，是否确认？";
}

patchEmptySeatFilter();
patchAvatarControls();
fs.writeFileSync(PREFAB, `${JSON.stringify(objects, null, 2)}\n`, "utf8");
console.log("panelMain.prefab 已恢复空位筛选，并新增头像刷新按钮和10元收费提示");
