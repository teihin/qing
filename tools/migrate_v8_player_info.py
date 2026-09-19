#!/usr/bin/env python3
"""Migrate formal panelUserInfo Prefab geometry and V8 art bindings.

Visual assets are generated only by extract_v8_player_info_assets.py.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelUserInfo.prefab"
PREFAB_UUID = "4e6e4bc9-7b49-42db-9090-5a1581a33843"
ASSET_NAMES = (
    "panel", "title", "divider", "avatar_frame", "button", "stats",
    "prop_card", "close", "copy", "toggle_off", "toggle_on", "grid_line",
    "mic", "icon_chicken", "icon_bomb", "icon_gun", "icon_shark",
    "icon_like", "icon_poop",
)


def load_asset_info():
    uuids = {}
    sizes = {}
    for name in ASSET_NAMES:
        meta_path = ROOT / "assets/V7" / f"player_info_v8_{name}.png.meta"
        meta = json.loads(meta_path.read_text(encoding="utf8"))
        sprite_frame = next(iter(meta["subMetas"].values()))
        uuids[name] = sprite_frame["uuid"]
        sizes[name] = (meta["width"], meta["height"])
    return uuids, sizes


UUIDS, ASSET_SIZES = load_asset_info()

def node_paths(data):
    nodes={i:v for i,v in enumerate(data) if isinstance(v,dict) and v.get("__type__")=="cc.Node"}; out={}
    def walk(i,p=""):
        n=nodes[i]; q=p+"/"+n["_name"] if p else n["_name"]; out[q]=i
        for c in n.get("_children",[]): walk(c["__id__"],q)
    roots=[i for i,n in nodes.items() if not n.get("_parent")]
    if len(roots)!=1: raise RuntimeError("expected one prefab root")
    walk(roots[0]); return nodes,out

def sprite(data,node,frame, sliced=False):
    for ref in data[node].get("_components",[]):
        comp=data[ref["__id__"]]
        if comp.get("__type__")=="cc.Sprite":
            comp["_spriteFrame"]={"__uuid__":UUIDS[frame]}; comp["_type"]=1 if sliced else 0; comp["_sizeMode"]=0; return
    raise RuntimeError("sprite missing")

def pos(n,x,y,w=None,h=None):
    # Creator 2.4 serializes actual node placement in _trs.  _position alone
    # is ignored when the existing _trs remains, so always write one uniform
    # transform and remove the stale convenience field.
    n["_trs"]={"__type__":"TypedArray","ctor":"Float64Array","array":[x,y,0,0,0,0,1,1,1,1]}
    n.pop("_position",None); n.pop("_scale",None)
    if w is not None: n["_contentSize"]={"__type__":"cc.Size","width":w,"height":h}


def natural_size(frame):
    return ASSET_SIZES[frame]


def contain_size(frame, max_width, max_height):
    width, height = natural_size(frame)
    scale = min(max_width / width, max_height / height)
    return round(width * scale, 3), round(height * scale, 3)

def add_node(data,parent,name,x,y,w,h,frame,button=False,sliced=False):
    i=len(data); node={"__type__":"cc.Node","_name":name,"_objFlags":0,"_parent":{"__id__":parent},"_children":[],"_active":True,"_components":[],"_prefab":{"__id__":i+1},"_opacity":255,"_color":{"__type__":"cc.Color","r":255,"g":255,"b":255,"a":255},"_contentSize":{"__type__":"cc.Size","width":w,"height":h},"_anchorPoint":{"__type__":"cc.Vec2","x":.5,"y":.5},"_trs":{"__type__":"TypedArray","ctor":"Float64Array","array":[x,y,0,0,0,0,1,1,1,1]},"_skewX":0,"_skewY":0,"_is3DNode":False,"_groupIndex":0,"groupIndex":0}
    prefab={"__type__":"cc.PrefabInfo","root":{"__id__":1},"asset":{"__uuid__":PREFAB_UUID},"fileId":"","sync":False}
    ci=i+2; comp={"__type__":"cc.Sprite","_name":"","_objFlags":0,"node":{"__id__":i},"_enabled":True,"_materials":[{"__uuid__":"eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}],"_srcBlendFactor":770,"_dstBlendFactor":771,"_spriteFrame":{"__uuid__":UUIDS[frame]},"_type":1 if sliced else 0,"_sizeMode":0,"_fillType":0,"_fillCenter":{"__type__":"cc.Vec2","x":0,"y":0},"_fillStart":0,"_fillRange":0,"_isTrimmedMode":True,"_atlas":None,"_id":""}; node["_components"].append({"__id__":ci})
    data[parent]["_children"].append({"__id__":i}); data.extend([node,prefab,comp])
    if button:
        bi=len(data); node["_components"].append({"__id__":bi}); data.append({"__type__":"cc.Button","_name":"","_objFlags":0,"node":{"__id__":i},"_enabled":True,"_normalMaterial":None,"_grayMaterial":None,"duration":.1,"zoomScale":.9,"clickEvents":[],"_N$interactable":True,"_N$enableAutoGrayEffect":False,"_N$transition":0,"transition":0,"_N$normalColor":{"__type__":"cc.Color","r":255,"g":255,"b":255,"a":255},"_N$pressedColor":{"__type__":"cc.Color","r":211,"g":211,"b":211,"a":255},"pressedColor":{"__type__":"cc.Color","r":211,"g":211,"b":211,"a":255},"_N$hoverColor":{"__type__":"cc.Color","r":255,"g":255,"b":255,"a":255},"hoverColor":{"__type__":"cc.Color","r":255,"g":255,"b":255,"a":255},"_N$disabledColor":{"__type__":"cc.Color","r":124,"g":124,"b":124,"a":255},"_N$normalSprite":None,"_N$pressedSprite":None,"pressedSprite":None,"_N$hoverSprite":None,"_N$hoverSprite":None,"_N$disabledSprite":None,"_N$target":None,"_id":""})
        
def child_by_name(data, parent, name):
    for ref in data[parent].get("_children",[]):
        node=data[ref["__id__"]]
        if node.get("_name")==name: return ref["__id__"]
    return None

def label_component(data, node_id, text, size, colour=(222,240,244,255), overflow=0, horizontal=1):
    """Turn an art placeholder into a native dynamic-safe caption label."""
    node=data[node_id]
    component_id=node["_components"][0]["__id__"]
    data[component_id]={"__type__":"cc.Label","_name":"","_objFlags":0,"node":{"__id__":node_id},"_enabled":True,"_materials":[{"__uuid__":"eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}],"_srcBlendFactor":770,"_dstBlendFactor":771,"_string":text,"_N$string":text,"_fontSize":size,"_lineHeight":size,"_enableWrapText":False,"_N$file":None,"_isSystemFontUsed":True,"_spacingX":0,"_batchAsBitmap":False,"_styleFlags":0,"_underlineHeight":0,"_N$horizontalAlign":horizontal,"_N$verticalAlign":1,"_N$fontFamily":"Arial","_N$overflow":overflow,"_N$cacheMode":0,"_id":""}
    node["_color"]={"__type__":"cc.Color","r":colour[0],"g":colour[1],"b":colour[2],"a":colour[3]}
    node["_active"] = True


def label_text(data, node_id):
    for ref in data[node_id].get("_components", []):
        component = data[ref["__id__"]]
        if component.get("__type__") == "cc.Label":
            return component.get("_string", component.get("_N$string", ""))
    raise RuntimeError(f"label missing on node {node_id}")


def preceding_sibling(data, parent_id, node_id):
    children = [ref["__id__"] for ref in data[parent_id].get("_children", [])]
    index = children.index(node_id)
    if index == 0:
        raise RuntimeError(f"node {node_id} has no preceding sibling")
    return children[index - 1]


def repair_prefab_asset(data, node_id):
    prefab_ref = data[node_id].get("_prefab")
    if not prefab_ref:
        raise RuntimeError(f"PrefabInfo missing on node {node_id}")
    prefab_info = data[prefab_ref["__id__"]]
    if prefab_info.get("__type__") != "cc.PrefabInfo":
        raise RuntimeError(f"invalid PrefabInfo on node {node_id}")
    prefab_info["root"] = {"__id__": 1}
    prefab_info["asset"] = {"__uuid__": PREFAB_UUID}

def normalize_descendant_scale(data, start):
    for ref in data[start].get("_children",[]):
        node_id=ref["__id__"]; node=data[node_id]
        trs=node.get("_trs",{}).get("array",[0,0,0,0,0,0,1,1,1,1])
        pos(node,trs[0],trs[1])
        normalize_descendant_scale(data,node_id)

def migrate_prefab():
    data=json.loads(PREFAB.read_text(encoding="utf8")); nodes,paths=node_paths(data); root=paths["panelUserInfo"]; data[root]["_anchorPoint"]={"__type__":"cc.Vec2","x":.5,"y":.5}
    panel=paths["panelUserInfo/bk copy"]; pos(nodes[panel],0,-72,686,1126); nodes[panel]["_opacity"]=255; sprite(data,panel,"panel",True)
    title=paths["panelUserInfo/bk copy/玩家信息"]; pos(nodes[title],0,485,*natural_size("title")); sprite(data,title,"title")
    droot=paths["panelUserInfo/数据"]; pos(nodes[droot],0,-72,686,1126)
    # Existing dynamic nodes and business buttons keep their names/components.
    avatar_size=natural_size("avatar_frame")[0]
    pos(nodes[paths["panelUserInfo/数据/头像"]],-227,355,avatar_size,avatar_size); sprite(data,paths["panelUserInfo/数据/头像"],"avatar_frame")
    pos(nodes[paths["panelUserInfo/数据/头像/mask"]],0,0,118,118); pos(nodes[paths["panelUserInfo/数据/头像/mask/img"]],0,0,118,118)
    txt=paths["panelUserInfo/数据/txt"]; pos(nodes[txt],-140,381,40,30); nodes[txt]["_anchorPoint"]["x"]=0; label_component(data,txt,"ID:",22,horizontal=0)
    user_id=paths["panelUserInfo/数据/id"]; pos(nodes[user_id],-104,381,110,30); nodes[user_id]["_anchorPoint"]["x"]=0; label_component(data,user_id,label_text(data,user_id),22,horizontal=0)
    nickname=paths["panelUserInfo/数据/name"]; pos(nodes[nickname],-140,338,260,42); nodes[nickname]["_anchorPoint"]["x"]=0; label_component(data,nickname,label_text(data,nickname),32,overflow=2,horizontal=0)
    toggle_size=natural_size("toggle_on")
    pos(nodes[paths["panelUserInfo/数据/屏蔽语音"]],215,353,190,42); pos(nodes[paths["panelUserInfo/数据/屏蔽语音/Background"]],55,0,*toggle_size); pos(nodes[paths["panelUserInfo/数据/屏蔽语音/checkmark"]],55,0,*toggle_size); sprite(data,paths["panelUserInfo/数据/屏蔽语音/Background"],"toggle_on"); sprite(data,paths["panelUserInfo/数据/屏蔽语音/checkmark"],"toggle_off")
    voice_label=paths["panelUserInfo/数据/屏蔽语音/语音聊天"]; pos(nodes[voice_label],-42,0,112,30); label_component(data,voice_label,"语音聊天",22,(255,238,187,255))
    for name,x in (("语音回放",-162),("赠送",162),("充值",162)):
        p=paths["panelUserInfo/数据/"+name]; pos(nodes[p],x,218,286,75); sprite(data,p,"button",True)
        text_node=child_by_name(data,p,"V8文字")
        if text_node is None: add_node(data,p,"V8文字",0,0,240,52,"button")
        text_node=child_by_name(data,p,"V8文字"); pos(data[text_node],14 if name=="语音回放" else 0,0,190,52)
        label_component(data,text_node,name,34,(255,238,187,255))
    voice=paths["panelUserInfo/数据/语音回放"]; mic=child_by_name(data,voice,"V8麦克风")
    if mic is None: add_node(data,voice,"V8麦克风",-88,0,*natural_size("mic"),"mic")
    else: pos(data[mic],-88,0,*natural_size("mic")); sprite(data,mic,"mic")
    nodes[paths["panelUserInfo/数据/充值"]]["_active"]=nodes[paths["panelUserInfo/数据/充值"]].get("_active",False)
    # Retain old VIP action semantics, but tuck its inactive promotional hook by the name.
    pos(nodes[paths["panelUserInfo/数据/头像/开通VIP"]],-125,-78,125,32)
    stats=paths["panelUserInfo/数据/统计"]; pos(nodes[stats],0,-8,609,319); sprite(data,stats,"stats",True)
    labels=[("总手数",-203,112,"总手数"),("总胜率",0,112,"总胜率"),("失败率",203,112,"失败率"),("胜利",-203,0,"胜利"),("平局",0,0,"平局"),("失败",203,0,"失败"),("入池率",-203,-80,"入池率"),("翻牌率",0,-80,"翻牌率"),("翻牌胜率",203,-80,"翻牌胜率")]
    for index,(name,x,y,caption) in enumerate(labels):
        p=paths["panelUserInfo/数据/统计/"+name]; pos(nodes[p],x,y,170,44); nodes[p]["_anchorPoint"]={"__type__":"cc.Vec2","x":.5,"y":.5}; nodes[p]["_active"]=True
        label_component(data,p,label_text(data,p),38,(255,235,184,255))
        caption_node=preceding_sibling(data,stats,p); pos(nodes[caption_node],x,(74,-35,-122)[index//3],170,30); label_component(data,caption_node,caption,24)
    for name,x,y,w,h in (("V8统计竖线1",-101.5,4,2,277),("V8统计竖线2",101.5,4,2,277),("V8统计横线1",0,42,565,2),("V8统计横线2",0,-49,565,2)):
        line=child_by_name(data,stats,name)
        if line is None: add_node(data,stats,name,x,y,w,h,"grid_line")
        else: pos(data[line],x,y,w,h); sprite(data,line,"grid_line")
        line=child_by_name(data,stats,name); data[line]["_color"]={"__type__":"cc.Color","r":255,"g":255,"b":255,"a":255}
    props=paths["panelUserInfo/数据/道具"]; nodes[props]["_components"]=[r for r in nodes[props]["_components"] if data[r["__id__"]].get("__type__")!="cc.Layout"]; pos(nodes[props],0,-350,609,300)
    visible=[("抓鸡","鸡","chicken",-203,74),("炸弹","炸弹","bomb",0,74),("机枪","枪","gun",203,74),("鲨鱼",None,"shark",-203,-74),("大拇指","拇指","like",0,-74),("屎",None,"poop",203,-74)]
    hidden=("亲嘴","干杯","Nice","钓鱼")
    for name,child,asset,x,y in visible:
        p=paths["panelUserInfo/数据/道具/"+name]; nodes[p]["_active"]=True; pos(nodes[p],x,y,187,143); sprite(data,p,"prop_card",True)
        if child:
            child_path="panelUserInfo/数据/道具/"+name+"/"+child
            icon_width,icon_height=contain_size("icon_"+asset,130 if asset=="gun" else 112,100 if asset=="gun" else 108)
            pos(nodes[paths[child_path]],0,16,icon_width,icon_height); sprite(data,paths[child_path],"icon_"+asset)
        # Shark/poop have no image child in old Prefab; add transparent extracted icon nodes.
        else:
            icon_node=child_by_name(data,p,name+"图标")
            icon_width,icon_height=contain_size("icon_"+asset,130 if asset=="shark" else 112,100 if asset=="shark" else 108)
            if icon_node is None: add_node(data,p,name+"图标",0,16,icon_width,icon_height,"icon_"+asset)
            else: pos(data[icon_node],0,16,icon_width,icon_height); sprite(data,icon_node,"icon_"+asset)
        label="label" if name=="Nice" else "label copy"; lp=paths.get("panelUserInfo/数据/道具/"+name+"/"+label)
        if lp: pos(nodes[lp],0,-56,60,32); nodes[lp]["_color"]={"__type__":"cc.Color","r":255,"g":232,"b":177,"a":255}
    for name in hidden: nodes[paths["panelUserInfo/数据/道具/"+name]]["_active"]=False
    # New real controls use UIViewBase automatic Button binding.
    if "panelUserInfo/关闭" not in paths: add_node(data,root,"关闭",285,437,*natural_size("close"),"close",True)
    else: pos(nodes[paths["panelUserInfo/关闭"]],285,437,*natural_size("close")); sprite(data,paths["panelUserInfo/关闭"],"close")
    if "panelUserInfo/数据/复制ID" not in paths: add_node(data,droot,"复制ID",-9,381,*natural_size("copy"),"copy",True)
    else: pos(nodes[paths["panelUserInfo/数据/复制ID"]],-9,381,*natural_size("copy")); nodes[paths["panelUserInfo/数据/复制ID"]]["_opacity"]=255; sprite(data,paths["panelUserInfo/数据/复制ID"],"copy")
    if "panelUserInfo/数据/分隔线" not in paths: add_node(data,droot,"分隔线",0,430,*natural_size("divider"),"divider")
    else: pos(nodes[paths["panelUserInfo/数据/分隔线"]],0,430,*natural_size("divider")); sprite(data,paths["panelUserInfo/数据/分隔线"],"divider")
    # Early migration drafts wrote a temporary Prefab UUID on five added nodes.
    # Repair every generated node explicitly so existing Prefabs are fixed too.
    _,final_paths=node_paths(data)
    generated_paths=(
        "panelUserInfo/关闭", "panelUserInfo/数据/复制ID", "panelUserInfo/数据/分隔线",
        "panelUserInfo/数据/语音回放/V8文字", "panelUserInfo/数据/语音回放/V8麦克风",
        "panelUserInfo/数据/赠送/V8文字", "panelUserInfo/数据/充值/V8文字",
        "panelUserInfo/数据/统计/V8统计竖线1", "panelUserInfo/数据/统计/V8统计竖线2",
        "panelUserInfo/数据/统计/V8统计横线1", "panelUserInfo/数据/统计/V8统计横线2",
        "panelUserInfo/数据/道具/鲨鱼/鲨鱼图标", "panelUserInfo/数据/道具/屎/屎图标",
    )
    for generated_path in generated_paths:
        repair_prefab_asset(data,final_paths[generated_path])
    normalize_descendant_scale(data,droot)
    PREFAB.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf8")

if __name__=="__main__":
    # Visual assets are deliberately maintained by extract_v8_player_info_assets.py.
    # This tool only serializes formal Prefab geometry and bindings.
    migrate_prefab(); print(PREFAB)
