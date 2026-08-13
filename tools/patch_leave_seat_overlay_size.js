#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "assets/resources/UI/panelGameView.prefab",
  "assets/Scenes/drh8.fire",
];
const TARGET_SIZE = 90;
const TARGET_OPACITY = 170;
const EXPECTED_PLAYER_COUNT = 8;

function childByName(objects, parent, name) {
  for (const reference of parent._children || []) {
    const child = objects[reference.__id__];
    if (child && child.__type__ === "cc.Node" && child._name === name) return child;
  }
  return null;
}

function setSize(node) {
  node._contentSize.width = TARGET_SIZE;
  node._contentSize.height = TARGET_SIZE;
}

function patchFile(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  const objects = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const heads = objects.filter(
    (item) => item && item.__type__ === "cc.Node" && item._name === "Head"
      && childByName(objects, item, "留坐") !== null
  );
  if (heads.length !== EXPECTED_PLAYER_COUNT) {
    throw new Error(`${relativePath} 留坐头像数量异常：${heads.length}`);
  }

  for (const head of heads) {
    const overlay = childByName(objects, head, "留坐");
    const background = childByName(objects, overlay, "bk");
    if (!background) throw new Error(`${relativePath} 的留坐节点缺少 bk 圆底`);
    if (head._contentSize.width !== TARGET_SIZE || head._contentSize.height !== TARGET_SIZE) {
      throw new Error(`${relativePath} 的头像外框不是 ${TARGET_SIZE}x${TARGET_SIZE}`);
    }
    setSize(overlay);
    setSize(background);
    background._opacity = TARGET_OPACITY;
  }

  fs.writeFileSync(fullPath, `${JSON.stringify(objects, null, 2)}\n`, "utf8");
  console.log(`${relativePath} 已统一 ${heads.length} 个留坐遮罩为 ${TARGET_SIZE}x${TARGET_SIZE}、透明度 ${TARGET_OPACITY}`);
}

for (const file of FILES) patchFile(file);
