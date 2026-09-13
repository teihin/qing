#!/usr/bin/env python3
"""Slice the approved transparent generated atlas; retain its pixels and alpha."""
import copy
import hashlib
import json
import uuid
from pathlib import Path
from PIL import Image
from apply_v7_prefab_skin import ROOT, ASSET_DIR

OUT=ROOT/'art_sources/v8-repairs/settings'
SOURCE=OUT/'icons-transparent.png'
KEYS=['gear','login','trade','info','voice','audio','security','logout','chevron']


def main():
    atlas=Image.open(SOURCE)
    assert atlas.mode=='RGBA' and atlas.getchannel('A').getextrema()==(0,255)
    template=json.loads((ASSET_DIR/'register_toggle_on_exact.png.meta').read_text())
    manifest={}
    for i,key in enumerate(KEYS):
        x,y=i%3,i//3
        cell_box=(round(x*atlas.width/3),round(y*atlas.height/3),round((x+1)*atlas.width/3),round((y+1)*atlas.height/3))
        cell=atlas.crop(cell_box)
        # Bounding calculation ignores near-invisible matte noise; cropped pixels stay unchanged.
        box=cell.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox()
        box=(max(0,box[0]-8),max(0,box[1]-8),min(cell.width,box[2]+8),min(cell.height,box[3]+8))
        icon=cell.crop(box);name='settings_v8_icon_'+key;file=ASSET_DIR/(name+'.png')
        icon.save(file,optimize=True)
        meta=copy.deepcopy(template)
        texture=str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8/settings/'+name+'/texture'))
        frame=str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8/settings/'+name+'/frame'))
        sub=next(iter(meta['subMetas'].values()))
        sub.update(uuid=frame,rawTextureUuid=texture,width=icon.width,height=icon.height,rawWidth=icon.width,rawHeight=icon.height)
        meta.update(uuid=texture,width=icon.width,height=icon.height,subMetas={name:sub})
        Path(str(file)+'.meta').write_text(json.dumps(meta,indent=2)+'\n')
        manifest[name+'.png']={'cell':cell_box,'crop':box,'size':icon.size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
    (OUT/'icons.json').write_text(json.dumps({'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'icons':manifest},indent=2)+'\n')
    print('Prepared 9 native-ratio icons; original generated RGBA pixels preserved.')


if __name__=='__main__':main()
