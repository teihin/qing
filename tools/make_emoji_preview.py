# -*- coding: utf-8 -*-
"""根据现有表情动画剪辑生成可视化预览页（写入 temp/，该目录已被 .gitignore 忽略）。"""
import glob
import json
import os
import re
import urllib.parse

PROJECT = '/Volumes/SSD/qing'
ASSETS = os.path.join(PROJECT, 'assets')
EMOJI = os.path.join(ASSETS, 'ImagesLuck', '表情')
OUT = os.path.join(PROJECT, 'temp', 'emoji-preview.html')
NAMES = ['冰冷', '发怒', '囧', '困', '大笑', '微笑', '感动', '拇指', '拜拜', '色心']
NEW = {'冰冷': 'cold', '发怒': 'enraged', '囧': 'explode', '困': 'no', '大笑': 'joy',
       '微笑': 'beaming', '感动': 'cry1', '拇指': 'biceps', '拜拜': 'devil', '色心': 'hot'}

uuid2meta = {}
for m in glob.glob(ASSETS + '/ImagesLuck/表情/**/*.meta', recursive=True):
    d = json.load(open(m, encoding='utf-8'))
    uuid2meta[d['uuid']] = m[:-5]
    for v in (d.get('subMetas') or {}).values():
        uuid2meta[v['uuid']] = m[:-5]


def as_src(path):
    rel = os.path.relpath(path, PROJECT)
    return '../' + urllib.parse.quote(rel)


items = []
for i, name in enumerate(NAMES, 1):
    clip = json.load(open(os.path.join(EMOJI, name, name + '.anim'), encoding='utf-8'))
    keys = clip['curveData']['comps']['cc.Sprite']['spriteFrame']
    frames = [{'t': k['frame'], 'src': as_src(uuid2meta[k['value']['__uuid__']])} for k in keys]
    icon = sorted(glob.glob(os.path.join(EMOJI, name, '*_0.png')))[0]
    from PIL import Image
    size = Image.open(icon).size
    items.append({'slot': i, 'folder': name, 'new': NEW[name], 'icon': as_src(icon),
                  'w': size[0], 'h': size[1], 'dur': clip['_duration'], 'frames': frames})

html = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>新表情动画预览</title>
<style>
 body{margin:0;background:#12232b;color:#e8f3ee;font:14px/1.5 -apple-system,"PingFang SC",sans-serif}
 header{padding:14px 18px;background:#0d1a20;border-bottom:1px solid #23414d}
 h1{margin:0 0 4px;font-size:17px} .sub{color:#8fb3a8}
 .grid{display:flex;flex-wrap:wrap;gap:14px;padding:16px}
 .card{background:#182e37;border:1px solid #23414d;border-radius:10px;padding:10px 12px;width:232px}
 .stage{position:relative;width:210px;height:210px;border-radius:8px;
        background:radial-gradient(circle at 50% 45%,#1d6b4f,#0e3a2b 70%);overflow:hidden}
 .stage img{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);image-rendering:auto}
 .avatar{position:absolute;left:50%;top:66%;transform:translate(-50%,-50%);
         width:74px;height:74px;border-radius:50%;background:linear-gradient(#5b6b74,#39464d);
         border:2px solid #cbb173;display:flex;align-items:center;justify-content:center;
         color:#dfe8ea;font-size:11px}
 .meta{display:flex;justify-content:space-between;margin-top:8px;color:#9fc0b4;font-size:12px}
 .ttl{display:flex;align-items:center;gap:8px;margin-bottom:8px}
 .ttl img{width:38px;height:38px;object-fit:contain}
 .ttl b{font-size:15px} .ttl span{color:#8fb3a8;font-size:12px}
 .panel{display:flex;flex-wrap:wrap;gap:10px;padding:0 16px 8px}
 .btn{width:96px;height:103px;border-radius:8px;background:#1e3b46;border:1px solid #2d5b68;
      display:flex;align-items:center;justify-content:center}
 .btn img{width:78px;height:83px;object-fit:contain}
 .panelwrap{padding:0 16px 20px}
 .card h2{margin:0 0 6px;font-size:13px;color:#cfe6dc;font-weight:600}
 .switch{cursor:pointer;user-select:none;color:#7fe0b0}
</style></head><body>
<header><h1>hh-poker 表情动画 → 游戏内表情动画（已替换）</h1>
<div class="sub">点头像 → 表情面板 → 选择后，在玩家头像上播放；此处按动画剪辑的真实关键帧时间轴回放（Loop）。</div></header>
<div class="panelwrap"><h2 class="card" style="background:none;border:0;margin:0 0 8px;color:#cfe6dc;padding:0">表情面板图标（panelTalk 1~10 号按钮实际使用的贴图）</h2>
<div class="panel" id="panel"></div></div>
<div class="grid" id="grid"></div>
<script>
const DATA = __DATA__;
const TL = {};
DATA.forEach(d=>{ TL[d.slot]=d.frames; });
DATA.forEach(d=>{
  const card=document.createElement('div'); card.className='card';
  card.innerHTML = `<div class="ttl"><img src="${d.icon}"><b>${d.slot}. ${d.folder}</b>
     <span>← ${d.new}</span></div>
   <div class="stage"><div class="avatar">玩家头像</div><img id="im${d.slot}"></div>
   <div class="meta"><span>${d.w}×${d.h}px</span><span>${d.frames.length} 帧</span><span>${d.dur.toFixed(2)}s</span></div>`;
  document.getElementById('grid').appendChild(card);
  const b=document.createElement('div'); b.className='btn';
  b.innerHTML=`<img src="${d.icon}" title="${d.slot}. ${d.folder} → ${d.new}">`;
  document.getElementById('panel').appendChild(b);
  const im=document.getElementById('im'+d.slot);
  const pre=[]; TL[d.slot].forEach(f=>{ const i=new Image(); i.src=f.src; pre.push(i); });
  let idx=-1;
  const tick=()=>{
    idx=(idx+1)%TL[d.slot].length;
    im.src=TL[d.slot][idx].src; im.style.width=d.w+'px'; im.style.height=d.h+'px';
    const t0=TL[d.slot][idx].t, t1=(TL[d.slot][idx+1]||{t:d.dur}).t;
    setTimeout(tick, Math.max(33, (t1-t0)*1000));
  };
  setTimeout(tick, d.slot*120);
});
</script></body></html>
"""
html = html.replace('__DATA__', json.dumps(items, ensure_ascii=False))
html = html.replace('__I__', '0')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(html)
print('written', OUT)
