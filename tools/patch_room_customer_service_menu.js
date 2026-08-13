#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "assets/resources/UI/panelGameView.prefab",
  "assets/Scenes/drh8.fire",
];
const CUSTOMER_SERVICE_SPRITE_UUID = "7fe79ef8-57c0-4e84-b854-90665e728517";
const MENU_HEIGHT = 582;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function patchFile(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  const objects = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const menuIndex = objects.findIndex((item) => item && item.__type__ === "cc.Node" && item._name === "ConfigMain");
  if (menuIndex < 0) throw new Error(`${relativePath} 缺少 ConfigMain`);
  const menu = objects[menuIndex];
  const childNodes = menu._children.map((reference) => objects[reference.__id__]);
  const existing = childNodes.find((node) => node && node._name === "联系客服");
  if (existing) {
    console.log(`${relativePath} 已有联系客服按钮，跳过新增`);
    return false;
  }

  const exitChildPosition = childNodes.findIndex((node) => node && node._name === "退出房间");
  if (exitChildPosition < 0) throw new Error(`${relativePath} 的 ConfigMain 缺少退出房间按钮`);
  const exitIndex = menu._children[exitChildPosition].__id__;
  const exitNode = objects[exitIndex];
  const exitSpriteIndex = exitNode._components
    .map((reference) => reference.__id__)
    .find((index) => objects[index] && objects[index].__type__ === "cc.Sprite");
  const exitButtonIndex = exitNode._components
    .map((reference) => reference.__id__)
    .find((index) => objects[index] && objects[index].__type__ === "cc.Button");
  const exitPrefabIndex = exitNode._prefab.__id__;
  if (exitSpriteIndex == null || exitButtonIndex == null || exitPrefabIndex == null) {
    throw new Error(`${relativePath} 的退出房间按钮结构不完整`);
  }

  const nodeIndex = objects.length;
  const spriteIndex = nodeIndex + 1;
  const buttonIndex = nodeIndex + 2;
  const prefabIndex = nodeIndex + 3;
  const customerNode = clone(exitNode);
  const customerSprite = clone(objects[exitSpriteIndex]);
  const customerButton = clone(objects[exitButtonIndex]);
  const customerPrefab = clone(objects[exitPrefabIndex]);

  customerNode._name = "联系客服";
  customerNode._components = [{ __id__: spriteIndex }, { __id__: buttonIndex }];
  customerNode._prefab = { __id__: prefabIndex };
  customerNode._trs.array[1] = exitNode._trs.array[1];
  customerSprite._name = "联系客服<Sprite>";
  customerSprite.node = { __id__: nodeIndex };
  customerSprite._spriteFrame = { __uuid__: CUSTOMER_SERVICE_SPRITE_UUID };
  customerButton.node = { __id__: nodeIndex };

  if (relativePath.endsWith(".fire")) {
    customerNode._id = "RKm8LBtn20260813A1b2C3";
    customerSprite._id = "RKm8LSpr20260813D4e5F6";
    customerButton._id = "RKm8LCmp20260813G7h8I9";
    customerPrefab.fileId = "RKm8LPfb20260813J0k1L2";
  } else {
    customerNode._id = "";
    customerSprite._id = "";
    customerButton._id = "";
    customerPrefab.fileId = "RKm8LPfb20260813J0k1L2";
  }

  objects.push(customerNode, customerSprite, customerButton, customerPrefab);
  menu._children.splice(exitChildPosition, 0, { __id__: nodeIndex });
  menu._contentSize.height = MENU_HEIGHT;
  const layout = menu._components
    .map((reference) => objects[reference.__id__])
    .find((component) => component && component.__type__ === "cc.Layout");
  if (!layout) throw new Error(`${relativePath} 的 ConfigMain 缺少 Layout`);
  layout._layoutSize.height = MENU_HEIGHT;

  customerNode._trs.array[1] = -447.2368054145516;
  exitNode._trs.array[1] = -512.2368054145516;
  fs.writeFileSync(fullPath, `${JSON.stringify(objects, null, 2)}\n`, "utf8");
  console.log(`${relativePath} 已新增联系客服按钮`);
  return true;
}

for (const file of FILES) patchFile(file);
