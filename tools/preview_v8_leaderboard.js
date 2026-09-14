// Run only in an agent-owned localhost Creator preview tab; never in a live account tab.
(async () => {
 const F = window.__rankFixture = {requests:[],pause:false,count:61,visibleRows:30};
 const names=['五哥','欢乐马123','体面','小虾米','速搏家','信贷黄经理'];
 const ids=['157710','531344','659348','541507','182771','411973'];
 const boards=['玩家手数榜','玩家赢分榜','代理红利榜'];
 const listKeys=['ListActivityPlayedcount','ListActivityUserScore','ListActivityProxyHongli'];
 const selfKeys=['ListActivitySelfPlayedcount','ListActivitySelfUserScore','ListActivitySelfProxyHongli'];
 const listFns=['OnListActivityPlayedcount','OnListActivityUserScore','ListActivityProxyHongli'];
 const selfFns=['OnListActivitySelfPlayedcount','OnListActivitySelfUserScore','ListActivitySelfProxyHongli'];
 F.reply = req => {
  if (!F.controller || req.data.header.startsWith('领取')) return;
  const h=req.data.header, i=h.includes('手数')?0:h.includes('输赢')?1:2, page=Number(req.data.page)||0;
  const data={count:F.count,number:page,start_date:'09/01 00:00',end_date:'09/30 23:59'};
  if(h.includes('自己')) {
   data[selfKeys[i]]=[{user_no:'18',activity_num:i?90630:386,user_reward:'500',lingqu_on:'True',is_reward:'True',lingqu_count:'0'}];
   F.controller[selfFns[i]](JSON.stringify(data));
  } else {
   data[listKeys[i]]=Array.from({length:Math.min(F.visibleRows,Math.max(0,F.count-page*30))},(_,n)=>({user_no:String(page*30+n+1),user_name:names[n%6],user_guuid:String(Number(ids[n%6])+(page*30+n)*1000000),activity_num:String((i===0?[1286,986,882,728,615,542]:i===1?[90630,82400,75260,61800,58950,52680]:[18630,12400,9260,6800,5950,2680])[n%6]),user_reward:String([3000,2000,1000,500,300,200][n%6])}));
   F.controller[listFns[i]](JSON.stringify(data));
  }
 };
 const account={reqHallCommand:(raw,context)=>{const req={data:JSON.parse(raw),context};F.requests.push(req);if(!F.pause)Promise.resolve().then(()=>F.reply(req));}};
 cc.js.getClassByName('GameDataManager').getAccount=()=>account;
 cc.js.getClassByName('ConfigManager').getInstance=()=>({GetOneHashKey(){}});
 const prefab=await new Promise((resolve,reject)=>cc.loader.loadRes('Prefabs/排行榜',cc.Prefab,(e,p)=>e?reject(e):resolve(p)));
 const normal=cc.find('Canvas/Normal');normal.children.forEach(n=>n.active=false);
 F.node=cc.instantiate(prefab);F.node.active=false;normal.addChild(F.node);F.controller=F.node.getComponent('panelPaihangbang');F.node.active=true;
 F.find=path=>cc.find(path,F.node);
 F.point=path=>{const n=F.find(path),p=n.convertToWorldSpaceAR(cc.v2()),r=document.getElementById('GameCanvas').getBoundingClientRect();return {x:r.x+p.x/cc.winSize.width*r.width,y:r.y+(cc.winSize.height-p.y)/cc.winSize.height*r.height}};
 F.info=()=>{const r=document.getElementById('GameCanvas').getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},boards:boards.map(b=>({name:b,active:F.find('容器/'+b).active,checked:F.find('条件/'+b).getComponent(cc.Toggle).isChecked,pagerActive:F.find('容器/'+b+'/分页').active,rows:F.find('容器/'+b+'/列表/view/content').children.filter(n=>n.active).length,offset:F.find('容器/'+b+'/列表').getComponent('LeaderboardScrollView').getScrollOffset().y})),filters:F.find('容器/玩家手数榜/选择手数').children.filter(n=>n.active).map(n=>({name:n.name,checked:n.getComponent(cc.Toggle).isChecked,mark:n.getChildByName('checkmark').active,markOnTop:n.getChildByName('checkmark').getSiblingIndex()>n.getChildByName('Background').getSiblingIndex()}))}};
 return F.info();
})();
