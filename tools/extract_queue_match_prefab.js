#!/usr/bin/env node

/*
 * 从 drh8.fire 中现有“排队弹窗”节点确定性生成独立顶层 Prefab。
 * 只复制弹窗子树和外部资源UUID，不修改原场景。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const scenePath = path.join(projectRoot, "assets/Scenes/drh8.fire");
const outputPath = path.join(projectRoot, "assets/resources/UI/panelQueueMatch.prefab");
const scriptType = "d9d58MWXWBMvKFhVv9gbPh5";

const source = JSON.parse(fs.readFileSync(scenePath, "utf8"));
const rootIndex = source.findIndex((item) => item && item.__type__ === "cc.Node" && item._name === "排队弹窗");
if(rootIndex < 0)
    throw new Error("drh8.fire 中找不到排队弹窗节点");

const used = new Set();
function visitReference(value)
{
    if(value == null || typeof value !== "object")
        return;
    if(Object.prototype.hasOwnProperty.call(value, "__id__"))
    {
        visitObject(value.__id__);
        return;
    }
    if(Array.isArray(value))
    {
        value.forEach(visitReference);
        return;
    }
    Object.keys(value).forEach((key) => visitReference(value[key]));
}

function visitObject(index)
{
    if(used.has(index))
        return;
    if(index < 0 || index >= source.length)
        throw new Error("Prefab子树引用越界: " + index);
    used.add(index);
    const item = source[index];
    Object.keys(item).forEach((key) => {
        if(index === rootIndex && key === "_parent")
            return;
        visitReference(item[key]);
    });
}

visitObject(rootIndex);
const ordered = [rootIndex].concat(Array.from(used).filter((index) => index !== rootIndex).sort((a, b) => a - b));
const idMap = new Map();
ordered.forEach((oldId, offset) => idMap.set(oldId, offset + 1));

function remap(value)
{
    if(value == null || typeof value !== "object")
        return value;
    if(Object.prototype.hasOwnProperty.call(value, "__id__"))
    {
        if(!idMap.has(value.__id__))
            throw new Error("Prefab子树包含未收集的内部引用: " + value.__id__);
        return {__id__: idMap.get(value.__id__)};
    }
    if(Array.isArray(value))
        return value.map(remap);
    const result = {};
    Object.keys(value).forEach((key) => result[key] = remap(value[key]));
    return result;
}

const output = [{
    __type__: "cc.Prefab",
    _name: "",
    _objFlags: 0,
    _native: "",
    data: {__id__: 1},
    optimizationPolicy: 0,
    asyncLoadAssets: false,
    readonly: false
}];

ordered.forEach((oldId) => {
    if(oldId === rootIndex)
    {
        const rootSource = Object.assign({}, source[oldId], {_parent: null});
        output.push(remap(rootSource));
    }
    else
        output.push(remap(source[oldId]));
});
const root = output[1];
root._name = "panelQueueMatch";
root._parent = null;
root._active = true;

const scriptComponentId = output.length;
output.push({
    __type__: scriptType,
    _name: "",
    _objFlags: 0,
    node: {__id__: 1},
    _enabled: true,
    _id: ""
});
root._components.push({__id__: scriptComponentId});

for(let index = 1; index < output.length; index++)
{
    const item = output[index];
    if(item == null || item.__type__ !== "cc.Node")
        continue;
    const prefabInfoId = output.length;
    const fileId = crypto.createHash("sha1").update("panelQueueMatch:" + index + ":" + item._name).digest("base64").slice(0, 22);
    output.push({
        __type__: "cc.PrefabInfo",
        root: {__id__: 1},
        asset: {__id__: 0},
        fileId: fileId,
        sync: false
    });
    item._prefab = {__id__: prefabInfoId};
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log("已生成:", outputPath, "对象数:", output.length);
