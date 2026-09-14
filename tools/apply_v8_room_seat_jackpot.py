#!/usr/bin/env python3
"""Package the 2026-09-14 seat art and apply the aligned jackpot to both saved roots.

Writes only the named room assets, panelGameView.prefab, and drh8.fire.
The generated seat master is preserved; digit cells are deterministic typography.
"""
import json
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'art_sources/v8-repairs/room-seat-jackpot'
ASSETS = ROOT / 'assets/resources/V7'


def uid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'qing/v8/room-seat-jackpot/' + name))


def save_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')


def texture(name, im, border=0):
    im.save(ASSETS / (name + '.png'))
    w, h = im.size
    save_json(ASSETS / (name + '.png.meta'), {
        'ver': '2.3.7', 'uuid': uid(name), 'importer': 'texture', 'type': 'sprite',
        'wrapMode': 'clamp', 'filterMode': 'bilinear', 'premultiplyAlpha': False,
        'genMipmaps': False, 'packable': False, 'width': w, 'height': h,
        'platformSettings': {}, 'subMetas': {name: {
            'ver': '1.0.6', 'uuid': uid(name + '/frame'), 'importer': 'sprite-frame',
            'rawTextureUuid': uid(name), 'trimType': 'none', 'trimThreshold': 1,
            'rotated': False, 'offsetX': 0, 'offsetY': 0, 'trimX': 0, 'trimY': 0,
            'width': w, 'height': h, 'rawWidth': w, 'rawHeight': h,
            'borderTop': border, 'borderBottom': border,
            'borderLeft': border, 'borderRight': border, 'subMetas': {}}}})


def make_assets():
    # Package the generated RGBA master at 2x the in-game node size.
    seat = Image.open(ART / 'empty-seat-generated.png').convert('RGBA')
    box = seat.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox()
    seat = seat.crop(box)
    seat.thumbnail((180, 180), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (192, 192))
    canvas.alpha_composite(seat, ((192-seat.width)//2, (192-seat.height)//2))
    texture('ingame_empty_seat_clean_v8', canvas)

    # Frame is a stretchable flat panel. No internal dividers are painted here.
    frame = Image.new('RGBA', (536, 128))
    d = ImageDraw.Draw(frame)
    d.rounded_rectangle((1, 1, 534, 126), radius=17, fill=(4, 24, 35, 255),
                        outline=(187, 174, 126, 255), width=3)
    d.rounded_rectangle((6, 6, 529, 121), radius=13, outline=(55, 101, 112, 255), width=2)
    texture('ingame_jackpot_frame_v8', frame, 20)

    # Every glyph contains its own cell. Equal advances keep the grid locked to
    # the numbers even when Cocos SHRINK fits a longer server value to the row.
    name = 'ingame_jackpot_cells_v8'
    chars = '0123456789.,-+'
    cw, ch = 72, 96
    atlas = Image.new('RGBA', (1024, 128))
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf', 78)
    lines = [f'info face="Room Jackpot Cells" size={ch} bold=1 italic=0 unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=0,0',
             f'common lineHeight={ch} base={ch} scaleW=1024 scaleH=128 pages=1 packed=0',
             f'page id=0 file="{name}.png"', f'chars count={len(chars)}']
    glyph_bounds = {}
    for i, char in enumerate(chars):
        tile = Image.new('RGBA', (cw, ch))
        td = ImageDraw.Draw(tile)
        for y in range(ch):
            t = y / (ch-1)
            # Subtle blue/teal glass, restrained gold separators.
            stops = ((9, 35, 48), (27, 88, 104), (10, 46, 61))
            a, b, q = (stops[0], stops[1], t*2) if t < .5 else (stops[1], stops[2], (t-.5)*2)
            td.line((0, y, cw-1, y), fill=tuple(round(a[k]*(1-q)+b[k]*q) for k in range(3))+(255,))
        td.rectangle((0, 0, cw-1, ch-1), outline=(100, 132, 129, 255), width=2)
        td.line((cw-2, 2, cw-2, ch-3), fill=(3, 27, 38, 255), width=2)
        bounds = font.getbbox(char)
        x = round((cw-(bounds[2]-bounds[0]))/2-bounds[0])
        y = round((ch-(bounds[3]-bounds[1]))/2-bounds[1])
        if char in '.,':
            y = 75 - bounds[3]
        mask = Image.new('L', (cw, ch)); md = ImageDraw.Draw(mask)
        md.text((x, y), char, font=font, fill=255)
        glyph_bounds[char] = mask.getbbox()
        shadow = Image.new('RGBA', (cw, ch)); ImageDraw.Draw(shadow).text((x, y+2), char, font=font, fill=(1, 18, 24, 220))
        tile.alpha_composite(shadow)
        ink = Image.new('RGBA', (cw, ch)); inkd = ImageDraw.Draw(ink)
        for sy in range(ch):
            t = sy/(ch-1)
            inkd.line((0, sy, cw, sy), fill=(round(253-35*t), round(245-40*t), round(212-58*t), 255))
        tile.paste(ink, (0, 0), mask)
        atlas.alpha_composite(tile, (i*cw, 0))
        lines.append(f'char id={ord(char)} x={i*cw} y=0 width={cw} height={ch} xoffset=0 yoffset=0 xadvance={cw} page=0 chnl=15')
    texture(name, atlas)
    (ASSETS / (name+'.fnt')).write_text('\n'.join(lines)+'\n')
    save_json(ASSETS / (name+'.fnt.meta'), {'ver':'2.1.2', 'uuid':uid(name+'/font'),
        'importer':'bitmap-font', 'textureUuid':uid(name), 'fontSize':ch, 'subMetas':{}})
    save_json(ART / 'glyph-bounds.json', {'cell':[cw,ch], 'glyphs':glyph_bounds})


def apply(path):
    a = json.loads(path.read_text())
    root = next(i for i,n in enumerate(a) if n.get('__type__')=='cc.Node' and n.get('_name')=='panelGameView')
    def child(parent, name):
        return next(r['__id__'] for r in a[parent]['_children'] if a[r['__id__']]['_name']==name)
    def comp(i, typ):
        return next(a[r['__id__']] for r in a[i]['_components'] if a[r['__id__']]['__type__']==typ)
    def geom(i, w, h, x, y):
        n=a[i];n['_contentSize'].update(width=w,height=h)
        n['_anchorPoint'].update(x=.5,y=.5)
        n['_trs']['array'][0:2]=[x,y];n['_trs']['array'][7:10]=[1,1,1]
    seats=child(root,'坐下控制')
    for r in a[seats]['_children']:
        comp(r['__id__'],'cc.Sprite')['_spriteFrame']={'__uuid__':uid('ingame_empty_seat_clean_v8/frame')}
    bar=child(root,'奖池条'); num=child(bar,'num'); button=child(bar,'奖池条')
    geom(bar,268,64,0,a[root]['_contentSize']['height']/2-42)
    sprite=comp(bar,'cc.Sprite');sprite.update(_spriteFrame={'__uuid__':uid('ingame_jackpot_frame_v8/frame')},_type=1,_sizeMode=0)
    widget=comp(bar,'cc.Widget');widget.update(_alignFlags=17,_top=10,_horizontalCenter=0)
    geom(num,252,48,0,0)
    comp(num,'cc.Widget').update(_alignFlags=45,_left=8,_right=8,_top=8,_bottom=8)
    comp(num,'cc.Label').update(_string='0000000', **{'_N$string':'0000000',
        '_fontSize':48,'_lineHeight':48,'_enableWrapText':False,
        '_N$file':{'__uuid__':uid('ingame_jackpot_cells_v8/font')},
        '_isSystemFontUsed':False,'_spacingX':0,'_N$horizontalAlign':1,
        '_N$verticalAlign':1,'_N$overflow':2})
    geom(button,268,64,0,0)
    save_json(path,a)
    print('Updated',path.relative_to(ROOT))


if __name__ == '__main__':
    make_assets()
    for path in (ROOT/'assets/resources/UI/panelGameView.prefab',ROOT/'assets/Scenes/drh8.fire'):
        apply(path)
