#!/usr/bin/env node

// Adds editor-visible spotlight and setting controls to both the source prefab
// and the checked-in drh8 scene instance. The script is intentionally
// idempotent so the layout can be regenerated safely.

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const prefabUuid = "1c485fb2-99c7-499b-a5e1-395955406b76";
const spotlightFrameUuid = "d9f79129-52e0-46be-91a4-58044914113f";
const materialUuid = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432";
const fontUuid = "fd7307b2-666e-4c26-963d-59f787cad6fb";
const toggleOffUuid = "9b02cd7a-c772-4cc1-b748-803f964c8392";
const toggleOnUuid = "7475ee2c-daf5-4835-90b5-0f6abfd6383b";

function ref(id) {
    return { __id__: id };
}

function color(r, g, b, a = 255) {
    return { __type__: "cc.Color", r, g, b, a };
}

function size(width, height) {
    return { __type__: "cc.Size", width, height };
}

function vec2(x, y) {
    return { __type__: "cc.Vec2", x, y };
}

function addObject(data, object) {
    data.push(object);
    return data.length - 1;
}

function addPrefabInfo(data, nodeId, rootId, fileId) {
    const prefabInfoId = addObject(data, {
        __type__: "cc.PrefabInfo",
        root: ref(rootId),
        asset: { __uuid__: prefabUuid },
        fileId,
        sync: false,
    });
    data[nodeId]._prefab = ref(prefabInfoId);
}

function addNode(data, rootId, options) {
    const nodeId = addObject(data, {
        __type__: "cc.Node",
        _name: options.name,
        _objFlags: 0,
        _parent: options.parentId === null ? null : ref(options.parentId),
        _children: [],
        _active: options.active === undefined ? true : options.active,
        _components: [],
        _prefab: null,
        _opacity: options.opacity === undefined ? 255 : options.opacity,
        _color: options.color || color(255, 255, 255),
        _contentSize: size(options.width, options.height),
        _anchorPoint: vec2(
            options.anchorX === undefined ? 0.5 : options.anchorX,
            options.anchorY === undefined ? 0.5 : options.anchorY,
        ),
        _trs: {
            __type__: "TypedArray",
            ctor: "Float64Array",
            array: [options.x || 0, options.y || 0, 0, 0, 0, 0, 1, 1, 1, 1],
        },
        _eulerAngles: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 },
        _skewX: 0,
        _skewY: 0,
        _is3DNode: false,
        _groupIndex: 0,
        groupIndex: 0,
        _id: "",
    });
    addPrefabInfo(data, nodeId, rootId, options.fileId);
    return nodeId;
}

function addSprite(data, nodeId, frameUuid, sizeMode, trimmedMode) {
    const componentId = addObject(data, {
        __type__: "cc.Sprite",
        _name: "",
        _objFlags: 0,
        node: ref(nodeId),
        _enabled: true,
        _materials: [{ __uuid__: materialUuid }],
        _srcBlendFactor: 770,
        _dstBlendFactor: 771,
        _spriteFrame: { __uuid__: frameUuid },
        _type: 0,
        _sizeMode: sizeMode,
        _fillType: 0,
        _fillCenter: vec2(0, 0),
        _fillStart: 0,
        _fillRange: 0,
        _isTrimmedMode: trimmedMode,
        _atlas: null,
        _id: "",
    });
    data[nodeId]._components.push(ref(componentId));
    return componentId;
}

function addLabel(data, nodeId, text, fontSize, lineHeight) {
    const componentId = addObject(data, {
        __type__: "cc.Label",
        _name: "",
        _objFlags: 0,
        node: ref(nodeId),
        _enabled: true,
        _materials: [{ __uuid__: materialUuid }],
        _useOriginalSize: false,
        _string: text,
        _N$string: text,
        _fontSize: fontSize,
        _lineHeight: lineHeight,
        _enableWrapText: true,
        _N$file: { __uuid__: fontUuid },
        _isSystemFontUsed: false,
        _spacingX: 0,
        _batchAsBitmap: false,
        _N$horizontalAlign: 0,
        _N$verticalAlign: 1,
        _N$fontFamily: "Arial",
        _N$overflow: 0,
        _N$cacheMode: 0,
        _id: "",
    });
    data[nodeId]._components.push(ref(componentId));
}

function addWidget(data, nodeId) {
    const componentId = addObject(data, {
        __type__: "cc.Widget",
        _name: "",
        _objFlags: 0,
        node: ref(nodeId),
        _enabled: true,
        alignMode: 1,
        _target: null,
        _alignFlags: 40,
        _left: 0,
        _right: 0,
        _top: 0,
        _bottom: 0,
        _verticalCenter: 0,
        _horizontalCenter: 0,
        _isAbsLeft: true,
        _isAbsRight: true,
        _isAbsTop: true,
        _isAbsBottom: true,
        _isAbsHorizontalCenter: true,
        _isAbsVerticalCenter: true,
        _originalWidth: 0,
        _originalHeight: 0,
        _id: "",
    });
    data[nodeId]._components.push(ref(componentId));
}

function addToggle(data, nodeId, backgroundId, checkmarkSpriteId) {
    const componentId = addObject(data, {
        __type__: "cc.Toggle",
        _name: "",
        _objFlags: 0,
        node: ref(nodeId),
        _enabled: true,
        _normalMaterial: null,
        _grayMaterial: null,
        duration: 0.1,
        zoomScale: 1.2,
        clickEvents: [],
        _N$interactable: true,
        _N$enableAutoGrayEffect: false,
        _N$transition: 3,
        transition: 3,
        _N$normalColor: color(214, 214, 214),
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
        _N$target: ref(backgroundId),
        _N$isChecked: true,
        toggleGroup: null,
        checkMark: ref(checkmarkSpriteId),
        checkEvents: [],
        _id: "",
    });
    data[nodeId]._components.push(ref(componentId));
}

function childIdByName(data, parentId, name) {
    const item = data[parentId]._children.find((itemRef) => data[itemRef.__id__]._name === name);
    if (!item) {
        throw new Error(`Missing child ${name} under ${data[parentId]._name}`);
    }
    return item.__id__;
}

function descendantsContainName(data, rootId, name) {
    const stack = [rootId];
    while (stack.length) {
        const id = stack.pop();
        if (data[id] && data[id]._name === name) return true;
        for (const child of (data[id] && data[id]._children) || []) stack.push(child.__id__);
    }
    return false;
}

function findDescendantId(data, rootId, name) {
    const stack = [rootId];
    while (stack.length) {
        const id = stack.pop();
        if (data[id] && data[id]._name === name) return id;
        for (const child of (data[id] && data[id]._children) || []) stack.push(child.__id__);
    }
    return -1;
}

function addSpotlightNode(data, rootId) {
    const spotlightId = addNode(data, rootId, {
        name: "下注聚光灯",
        parentId: rootId,
        width: 220,
        height: 560,
        x: 0,
        y: 66.692,
        anchorX: 0.5,
        anchorY: 0,
        active: false,
        opacity: 0,
        fileId: "spotLightBeamNode8L2026",
    });
    addSprite(data, spotlightId, spotlightFrameUuid, 0, false);

    const children = data[rootId]._children;
    const userInfoIndex = children.findIndex((itemRef) => data[itemRef.__id__]._name === "UserInfo");
    if (userInfoIndex < 0) throw new Error("Missing UserInfo root node");
    children.splice(userInfoIndex, 0, ref(spotlightId));
}

function addSpotlightSetting(data, rootId) {
    const settingsPanelId = childIdByName(data, rootId, "系统设置");
    const settingsId = childIdByName(data, settingsPanelId, "设置");
    const rowId = addNode(data, rootId, {
        name: "聚光灯",
        parentId: settingsId,
        width: 703,
        height: 90,
        x: 0,
        y: -292.5,
        fileId: "spotLightSettingRow8L26",
    });
    addWidget(data, rowId);

    const titleId = addNode(data, rootId, {
        name: "标题",
        parentId: rowId,
        width: 200,
        height: 40,
        x: -280,
        y: 15,
        anchorX: 0,
        color: color(207, 237, 248),
        fileId: "spotLightTitleLabel8L26",
    });
    addLabel(data, titleId, "下注聚光灯", 30, 34);

    const tipId = addNode(data, rootId, {
        name: "说明",
        parentId: rowId,
        width: 310,
        height: 26,
        x: -280,
        y: -21,
        anchorX: 0,
        color: color(111, 171, 193),
        fileId: "spotLightTipLabel8L2026",
    });
    addLabel(data, tipId, "下注时指向当前操作玩家", 18, 24);

    const toggleId = addNode(data, rootId, {
        name: "聚光灯开关",
        parentId: rowId,
        width: 87,
        height: 57,
        x: 230,
        y: 0,
        fileId: "spotLightToggleNode8L2026",
    });
    const backgroundId = addNode(data, rootId, {
        name: "Background",
        parentId: toggleId,
        width: 101,
        height: 41,
        fileId: "spotLightToggleBg8L2026",
    });
    addSprite(data, backgroundId, toggleOffUuid, 1, true);

    const checkmarkId = addNode(data, rootId, {
        name: "checkmark",
        parentId: toggleId,
        width: 103,
        height: 41,
        active: true,
        fileId: "spotLightToggleCheck8L26",
    });
    const checkmarkSpriteId = addSprite(data, checkmarkId, toggleOnUuid, 2, false);
    addToggle(data, toggleId, backgroundId, checkmarkSpriteId);

    data[rowId]._children.push(ref(titleId), ref(tipId), ref(toggleId));
    data[toggleId]._children.push(ref(backgroundId), ref(checkmarkId));
    data[settingsId]._children.push(ref(rowId));
}

function patchFile(relativePath, rootId) {
    const filePath = path.join(projectRoot, relativePath);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (descendantsContainName(data, rootId, "下注聚光灯") || descendantsContainName(data, rootId, "聚光灯开关")) {
        const toggleId = findDescendantId(data, rootId, "聚光灯开关");
        if (toggleId >= 0) {
            const checkmarkId = childIdByName(data, toggleId, "checkmark");
            data[checkmarkId]._active = true;
            const toggleComponentId = data[toggleId]._components.find((componentRef) => data[componentRef.__id__].__type__ === "cc.Toggle").__id__;
            data[toggleComponentId]._N$isChecked = true;
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
        }
        console.log(`${relativePath}: already patched; defaults refreshed`);
        return;
    }
    addSpotlightNode(data, rootId);
    addSpotlightSetting(data, rootId);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
    console.log(`${relativePath}: patched`);
}

patchFile("assets/resources/UI/panelGameView.prefab", 1);
patchFile("assets/Scenes/drh8.fire", 6);
