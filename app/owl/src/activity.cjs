'use strict';
const {EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const CATEGORIES=Object.freeze(['unknown','video','vibe-coding','chatgpt-learning','writing']);
function validate(state){
 if(!state||state.schema!==1||!Array.isArray(state.segments)||Object.keys(state).some(k=>!['schema','segments'].includes(k)))throw Error('APP 时间存档无法识别，原文件未覆盖。');
 const ids=new Set();for(const row of state.segments){
  if(!row||Object.keys(row).some(k=>!['id','app','startedAt','endedAt','durationMs','category','categoryConfirmed'].includes(k))||typeof row.id!=='string'||!row.id||ids.has(row.id)||!row.app||Object.keys(row.app).some(k=>!['name','bundleId'].includes(k))||typeof row.app.name!=='string'||!row.app.name||row.app.name.length>200||!(row.app.bundleId===null||typeof row.app.bundleId==='string'&&row.app.bundleId.length<=200)||!Number.isFinite(row.startedAt)||!Number.isFinite(row.endedAt)||row.endedAt<row.startedAt||!Number.isSafeInteger(row.durationMs)||row.durationMs<0||!CATEGORIES.includes(row.category)||row.categoryConfirmed!==(row.category!=='unknown'))throw Error('APP 时间存档无法识别，原文件未覆盖。');
  ids.add(row.id);
 }return state;
}
function appIdentity(value){
 const name=typeof value?.name==='string'?value.name.trim().slice(0,200):'',bundleId=typeof value?.bundleId==='string'?value.bundleId.trim().slice(0,200):'';
 return {name:name||'未知 APP',bundleId:bundleId||null};
}
const appKey=app=>app.bundleId||'name:'+app.name;
class ActivityFileStore{
 constructor(dir){this.dir=dir;this.file=path.join(dir,'activity-state.json');}
 read(){try{return validate(JSON.parse(fs.readFileSync(this.file,'utf8')));}catch(error){if(error.code==='ENOENT')return {schema:1,segments:[]};throw error;}}
 write(state){validate(state);fs.mkdirSync(this.dir,{recursive:true,mode:0o700});const temp=this.file+'.tmp';let fd;try{fd=fs.openSync(temp,'w',0o600);fs.writeFileSync(fd,JSON.stringify(state,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,this.file);}finally{if(fd!==undefined)fs.closeSync(fd);}}
}
class ActivityService extends EventEmitter{
 constructor({store,foreground,now=()=>Number(process.hrtime.bigint())/1e6,wall=Date.now,setIntervalFn=setInterval,clearIntervalFn=clearInterval,pollMs=2000,maxGapMs=15000}){
  super();Object.assign(this,{store,foreground,now,wall,setIntervalFn,clearIntervalFn,pollMs,maxGapMs});this.enabled=false;this.disposed=false;this.current=null;this.timer=null;this.generation=0;this.inFlight=false;this.reason='默认关闭。开启后仅记录这台 Mac 的前台 APP 时间；重开需要再次开启。';
  try{this.state=structuredClone(validate(store.read()));}catch(error){this.state={schema:1,segments:[]};this.fault='APP 时间存档读取失败，原文件未覆盖：'+error.message;}
 }
 snapshot(){const byApp=new Map();for(const row of this.state.segments){const key=appKey(row.app);let item=byApp.get(key);if(!item){item={key,app:row.app,durationMs:0,categories:{}};byApp.set(key,item);}item.durationMs+=row.durationMs;item.categories[row.category]=(item.categories[row.category]||0)+row.durationMs;}return structuredClone({enabled:this.enabled,reason:this.reason,fault:this.fault||null,activeId:this.current?.id||null,segments:this.state.segments,apps:[...byApp.values()].sort((a,b)=>b.durationMs-a.durationMs),pollMs:this.pollMs});}
 changed(){this.emit('change',this.snapshot());}
 persist(){try{this.store.write(this.state);return true;}catch(error){this.enabled=false;this.generation++;if(this.timer!==null)this.clearIntervalFn(this.timer);this.timer=null;this.current=null;this.fault='APP 时间保存失败，记录已停止：'+error.message;this.changed();return false;}}
 start(){if(this.disposed)throw Error('APP 记录已关闭。');if(this.fault)throw Error(this.fault);if(typeof this.foreground!=='function')throw Error('此入口暂不支持前台 APP 查询。');if(this.enabled)return this.snapshot();this.enabled=true;this.generation++;this.reason='正在记录前台 APP；活动类别待你确认。';this.timer=this.setIntervalFn(()=>{void this.poll();},this.pollMs);this.changed();void this.poll();return this.snapshot();}
 async poll(){if(!this.enabled||this.inFlight||this.disposed)return;const token=this.generation;this.inFlight=true;let app;try{app=await this.foreground();}catch{app=null;}finally{this.inFlight=false;}if(!this.enabled||token!==this.generation||this.disposed)return;this.observe(app,this.now(),this.wall());}
 observe(value,mono=this.now(),wall=this.wall()){
  if(!this.enabled||this.disposed||this.fault)return false;if(!Number.isFinite(mono)||!Number.isFinite(wall))return false;
  const app=appIdentity(value);
  if(this.current){
   const delta=mono-this.current.lastMono;if(delta<=0)return false;
   if(delta>this.maxGapMs||Math.abs((wall-this.current.lastWall)-delta)>2000){this.stop('检测到中断或系统时间变化；记录已停止，间隔不补记。',false);return false;}
   const row=this.state.segments.find(r=>r.id===this.current.id);const exact=this.current.remainder+delta,credit=Math.floor(exact);this.current.remainder=exact-credit;row.durationMs+=credit;row.endedAt=Math.max(row.endedAt,wall);this.current.lastMono=mono;this.current.lastWall=wall;
   if(appKey(row.app)!==appKey(app))this.current=null;
  }
  if(!this.current){const row={id:randomUUID(),app,startedAt:wall,endedAt:wall,durationMs:0,category:'unknown',categoryConfirmed:false};this.state.segments.push(row);this.current={id:row.id,lastMono:mono,lastWall:wall,remainder:0};}
  if(!app.bundleId&&app.name==='未知 APP')this.reason='前台 APP 无法识别；这一段保留为未知 APP、待确认。';else this.reason='正在记录前台 APP；活动类别待你确认。';if(this.persist())this.changed();return true;
 }
 stop(reason='已停止记录；再次开启前不会查询或累计 APP 时间。',credit=true){
  if(this.disposed)return this.snapshot();if(this.enabled&&credit&&this.current)this.observe(this.state.segments.find(r=>r.id===this.current.id).app,this.now(),this.wall());
  this.enabled=false;this.generation++;if(this.timer!==null)this.clearIntervalFn(this.timer);this.timer=null;this.current=null;this.reason=reason;this.changed();return this.snapshot();
 }
 classify(id,category){if(this.fault)throw Error(this.fault);if(!CATEGORIES.includes(category))throw Error('活动类别无法识别。');const row=this.state.segments.find(r=>r.id===id);if(!row)throw Error('该 APP 时间段不存在。');row.category=category;row.categoryConfirmed=category!=='unknown';if(!this.persist())throw Error(this.fault);this.changed();return this.snapshot();}
 close(){if(this.disposed)return;this.stop('应用已退出，APP 记录已停止。');this.disposed=true;this.removeAllListeners();}
}
module.exports={ActivityService,ActivityFileStore,CATEGORIES,validate,appIdentity};
