// Exercise Cocos 2.4.13's real Layout against the formal action group.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'../..'),a=JSON.parse(fs.readFileSync(root+'/assets/resources/UI/panelHongli.prefab'));
const cc={Enum:o=>o,size:(width,height)=>({width,height}),v2:(x,y)=>({x,y}),Class(spec){
 class Comp{};for(const[k,v]of Object.entries(spec))if(typeof v==='function'&&k!=='extends')Comp.prototype[k]=v;
 for(const[k,v]of Object.entries(spec.properties))if(v&&(v.get||v.set))Object.defineProperty(Comp.prototype,k,{get:v.get,set:v.set});
 return Comp;
}};
const mod={exports:{}};vm.runInNewContext(fs.readFileSync('/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/engine/cocos2d/core/components/CCLayout.js','utf8'),{cc,CC_EDITOR:false,CC_DEV:false,module:mod,require:()=>class{}});
const raw=a.find(o=>o.__type__==='cc.Node'&&o._name==='操作'),cfg=raw._components.map(r=>a[r.__id__]).find(o=>o.__type__==='cc.Layout');
const names=['我的玩家','我的业绩','我的盟主','提取记录','推广','总业绩'];
let count=0;
for(const hidden of [[],['我的盟主'],['总业绩'],['我的盟主','总业绩'],['我的盟主','总业绩','推广']]){
 const cols=names.length-hidden.length<=4?2:3;
 const group={width:cols*204+(cols-1)*14,height:194,getContentSize(){return {width:this.width,height:this.height}},getAnchorPoint(){return {x:.5,y:.5}},children:[],_contentSize:{height:194}};
 group.children=raw._children.map(r=>a[r.__id__]).map(o=>({name:o._name,activeInHierarchy:names.includes(o._name)&&!hidden.includes(o._name),width:o._contentSize.width,height:o._contentSize.height,anchorX:.5,anchorY:.5,scaleX:1,scaleY:1,getAnchorPoint(){return {x:.5,y:.5}},setPosition(p){this.x=p.x;this.y=p.y}}));
 const lay=Object.assign(new mod.exports(),cfg,{node:group,_layoutDirty:true});
 for(const k of ['cellSize','startAxis','paddingLeft','paddingRight','paddingTop','paddingBottom','spacingX','spacingY','verticalDirection','horizontalDirection','affectedByScale'])lay[k]=cfg['_N$'+k];
 lay.updateLayout();const active=group.children.filter(c=>c.activeInHierarchy);
 assert.deepEqual(active.map(c=>c.name),names.filter(n=>!hidden.includes(n)));
 active.forEach((n,i)=>{assert.equal(n.x,-group.width/2+102+i%cols*218);assert.equal(n.y,53-Math.floor(i/cols)*106);});
 assert.equal(new Set(active.map(n=>n.y)).size,2);count++;
}
console.log('PASS',count,'actual Cocos Grid permission combinations: 3/4/5/6 buttons, reading order, no gaps, two rows.');
