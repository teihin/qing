#!/usr/bin/env python3
"""Serialize one aspect-correct V8 login composition; preserve root bindings."""
import base64
import copy
import json
import struct
import uuid
from apply_v7_prefab_skin import Prefab, ASSET_DIR
from repair_v7_responsive_layout import center

SCALE = 750 / 941
RECTS = {
    "登录LOGO": ("login_shield_exact.png", (260, 200, 677, 714)),
    "手机号": ("login_input_account_exact.png", (137, 750, 800, 897)),
    "密码": ("login_input_password_exact.png", (137, 916, 800, 1064)),
    "登陆": ("login_button_exact.png", (137, 1212, 800, 1342)),
    "忘记密码": ("login_link_reset_exact.png", (154, 1098, 316, 1158)),
    "注册账号": ("login_link_register_exact.png", (614, 1098, 789, 1158)),
}

def update_meta(name):
    path = ASSET_DIR / name
    width, height = struct.unpack(">II", path.read_bytes()[16:24])
    meta_path = path.with_suffix(path.suffix + ".meta")
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        frame = next(iter(meta["subMetas"].values()))
    else:
        meta = json.loads((ASSET_DIR / "login_button_exact.png.meta").read_text())
        meta["uuid"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8-login/" + name))
        frame = copy.deepcopy(next(iter(meta["subMetas"].values())))
        frame["uuid"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8-login/frame/" + name))
        frame["rawTextureUuid"] = meta["uuid"]
    meta.update(width=width,height=height,packable=False,premultiplyAlpha=False)
    frame.update(width=width,height=height,rawWidth=width,rawHeight=height,
                 trimType="none",trimX=0,trimY=0,offsetX=0,offsetY=0,
                 borderTop=0,borderBottom=0,borderLeft=0,borderRight=0)
    meta["subMetas"] = {path.stem:frame}
    meta_path.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n")

def main():
    for name in ["casino_bg.png","login_hint_account_exact.png","login_hint_password_exact.png"]+[v[0] for v in RECTS.values()]:
        update_meta(name)
    p = Prefab("assets/resources/UI/panelLogin.prefab")
    p.disable(p.root,"cc.Sprite")
    try: bg = p.node("V8登录背景")
    except KeyError: bg = p.clone_subtree(p.node("手机号/BACKGROUND_SPRITE"),p.root,"V8登录背景")
    # A cloned node needs its own PrefabInfo identity for safe editor round trips.
    bg_uuid = uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8-login/background-node")
    p.data[p.data[bg]["_prefab"]["__id__"]]["fileId"] = (
        bg_uuid.hex[:2] + base64.b64encode(bg_uuid.bytes[1:]).decode("ascii")
    )
    p.set_active(bg,True)
    p.art(bg,"casino_bg.png",0,0,750,2232*SCALE)
    center(p,"V8登录背景",width=750,height=2232*SCALE)
    children = p.data[p.root]["_children"]
    children[:] = [{"__id__":bg}]+[r for r in children if r["__id__"] != bg]
    for path,(asset,(x0,y0,x1,y1)) in RECTS.items():
        node_id = p.node(path)
        x,y = ((x0+x1)/2-941/2)*SCALE,(1672/2-(y0+y1)/2)*SCALE
        width,height = (x1-x0)*SCALE,(y1-y0)*SCALE
        p.set_active(node_id,True)
        center(p,path,x=x,y=y,width=width,height=height)
        p.data[node_id]["_trs"]["array"][7:10] = [1,1,1]
        if path not in ("手机号","密码"):
            p.art(node_id,asset,x,y,width,height,hide=True)
            _,button = p.component(node_id,"cc.Button")
            if button:
                button["_N$transition"] = button["transition"] = 0
            continue
        bg_id = p.node(path+"/BACKGROUND_SPRITE")
        p.art(bg_id,asset,0,0,width,height)
        p.disable(bg_id,"cc.Widget")
        hx0,hy0,hx1,hy1 = (299,798,487,858) if path=="手机号" else (299,964,487,1024)
        hint_name = "V7账号占位美术字" if path=="手机号" else "V7密码占位美术字"
        hint_asset = "login_hint_account_exact.png" if path=="手机号" else "login_hint_password_exact.png"
        hint_id = p.node(path+"/"+hint_name)
        p.art(hint_id,hint_asset,((hx0+hx1-x0-x1)/2)*SCALE,
              ((y0+y1-hy0-hy1)/2)*SCALE,(hx1-hx0)*SCALE,(hy1-hy0)*SCALE)
        p.disable(hint_id,"cc.Widget")
        p.set_active(hint_id,True)
        for suffix in ["TEXT_LABEL","PLACEHOLDER_LABEL"]:
            label_id = p.node(path+"/"+suffix)
            p.set_pos(label_id,(309-(x0+x1)/2)*SCALE,0,360*SCALE,height)
            p.data[label_id]["_anchorPoint"] = {"__type__":"cc.Vec2","x":0,"y":0.5}
            p.disable(label_id,"cc.Widget")
            _,label = p.component(label_id,"cc.Label")
            label.update(_fontSize=30,_lineHeight=38,_enableWrapText=False)
            label["_N$horizontalAlign"] = 0
            label["_N$verticalAlign"] = 1
            if suffix=="PLACEHOLDER_LABEL": label["_string"] = label["_N$string"] = ""
        # Password uses the project's EditBox subclass, with the same serialized labels.
        for suffix in ["线条","线条 copy","sj","mm","V8精确清底"]:
            try: p.set_active(p.node(path+"/"+suffix),False)
            except KeyError: pass
        clear_path = path+("/清除用户" if path=="手机号" else "/清除密码")
        p.set_pos(p.node(clear_path),width/2-26,0,52,height)
        p.disable(p.node(clear_path),"cc.Widget")
        p.set_active(p.node(clear_path+"/CHACHA"),False)
    p.save()
    print("V8 login now uses one centered source coordinate system, preserving business bindings.")

if __name__ == "__main__": main()
