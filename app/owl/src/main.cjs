'use strict';
const {app,BrowserWindow,ipcMain,powerMonitor,session,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{isUtf8}=require('node:buffer');
const {FileStore}=require('./store.cjs'),{FocusService}=require('./service.cjs'),{FocusController}=require('./focus-controller.cjs');
const {ActivityService,ActivityFileStore}=require('./activity.cjs');
const root=path.resolve(__dirname,'..');
const verification=process.argv.includes('--verify-duration-reopen')?'duration-reopen':process.argv.includes('--verify-duration')?'duration':process.argv.includes('--verify-placement-reopen')?'placement-reopen':process.argv.includes('--verify-placement')?'placement':process.argv.includes('--verify-drawer-reopen')?'drawer-reopen':process.argv.includes('--verify-drawer')?'drawer':process.argv.includes('--verify-test-access-off-reopen')?'test-access-off-reopen':process.argv.includes('--verify-test-access-reopen')?'test-access-reopen':process.argv.includes('--verify-test-access')?'test-access':process.argv.includes('--verify-collection-reopen')?'collection-reopen':process.argv.includes('--verify-collection')?'collection':process.argv.includes('--verify-room')?'room':process.argv.includes('--verify-headless')?'flow':process.argv.includes('--verify-reopen')?'reopen':null;
if(verification&&process.platform==='darwin')app.setActivationPolicy('prohibited');
let verificationData;
if(verification&&!process.env.OWL_FOCUS_DATA_DIR){
 const runtime=path.join(root,'.runtime'),context=path.join(runtime,verification.startsWith('test-access')?'test-access-verification-context.json':'verification-context.json');fs.mkdirSync(runtime,{recursive:true});
 if(!verification.endsWith('reopen')){verificationData=fs.mkdtempSync(path.join(runtime,'verification-'));fs.writeFileSync(context,JSON.stringify({dataDir:verificationData}));}
 else{try{verificationData=JSON.parse(fs.readFileSync(context)).dataDir;if(typeof verificationData!=='string'||path.dirname(verificationData)!==runtime||!path.basename(verificationData).startsWith('verification-'))throw Error('Invalid verification context');}catch{console.error('请先运行 npm run verify:ui，建立本地验证存档。');app.exit(1);}}
}
const data=path.resolve(process.env.OWL_FOCUS_DATA_DIR||verificationData||path.join(app.getPath('appData'),'IRiXi Owl Focus'));
app.setName('IRiXi Owl Focus');fs.mkdirSync(path.join(data,'electron-profile'),{recursive:true,mode:0o700});app.setPath('userData',path.join(data,'electron-profile'));
let store,service,controller,activity,heartbeat,closing=false,defaults={seconds:1500};const views=new Map();
const defaultsFile=path.join(data,'focus-defaults.json');
function loadDefaults(){
 try{const bytes=fs.readFileSync(defaultsFile);if(!isUtf8(bytes))throw Error('设置不是有效 UTF-8');const value=JSON.parse(bytes.toString('utf8'));if(!value||Object.keys(value).some(k=>!['seconds','breakSeconds'].includes(k))||!Number.isInteger(value.seconds)||value.seconds<1||value.seconds>10800||(value.breakSeconds!==undefined&&(!Number.isInteger(value.breakSeconds)||value.breakSeconds<1||value.breakSeconds>3600)))throw Error('设置内容无法识别');defaults=value;}
 catch(e){if(e.code!=='ENOENT')throw Error('专注设置读取失败，原文件未覆盖：'+e.message);}
}
function saveDefaults(value){
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['seconds','breakSeconds'].includes(k))||!Number.isInteger(value.seconds)||value.seconds<1||value.seconds>10800||(value.breakSeconds!==undefined&&(!Number.isInteger(value.breakSeconds)||value.breakSeconds<1||value.breakSeconds>3600)))throw Error('专注时长需在1秒至180分钟内。');
 const temp=defaultsFile+'.tmp';let fd,replaced=false;
 try{fd=fs.openSync(temp,'w',0o600);fs.writeFileSync(fd,JSON.stringify({seconds:value.seconds,breakSeconds:value.breakSeconds??defaults.breakSeconds??300},null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,defaultsFile);replaced=true;const dir=fs.openSync(data,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 catch(e){throw Error((replaced?'设置文件已替换，但未能确认落盘：':'设置未确认保存：')+e.message);}
 finally{if(fd!==undefined)fs.closeSync(fd);}
 defaults={seconds:value.seconds,breakSeconds:value.breakSeconds??defaults.breakSeconds??300};controller.changed(service.snapshot());return {...defaults};
}
function openView(mode='standalone'){
 const previous=views.get(mode);if(previous&&!previous.isDestroyed()){if(!verification){previous.show();previous.focus();}return previous;}
 const compact=mode==='compact',widget=mode==='widget'&&(['room','collection','duration','duration-reopen'].includes(verification)||verification?.startsWith('placement')||verification?.startsWith('test-access')||verification?.startsWith('drawer'));const win=new BrowserWindow({width:widget?386:compact?420:920,height:widget?538:compact?600:820,minWidth:widget?175:compact?350:700,minHeight:widget?120:compact?520:640,
  title:compact?'iRIXI 猫头鹰番茄钟 · 小窗口':'iRIXI 猫头鹰番茄钟',backgroundColor:'#F6EDE6',show:false,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:!verification,offscreen:Boolean(verification)}});
 views.set(mode,win);const off=controller.registerView(win.webContents);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
 win.on('closed',()=>{off();views.delete(mode);});if(!verification)win.once('ready-to-show',()=>win.show());
 if(verification)win.webContents.on('console-message',event=>console.log('renderer:',event.message));
 win.loadFile(path.join(root,'ui/index.html'),{query:{mode,shell:widget?'embedded':'standalone'}});return win;
}
function checked(event){if(!controller.allowed(event))throw Error('未授权窗口');}
function activitySnapshot(){return {...activity.snapshot(),available:false,reason:'独立版暂未接入真实前台 APP 查询。记录保持关闭；本机不采集 APP 活动。'};}
function close(){if(closing)return;closing=true;clearInterval(heartbeat);activity?.close();controller?.dispose();try{if(service)service.close();else store?.close();}catch(e){console.error('退出保存失败：',e.message);}}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(service&&!verification)openView();});
 app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_w,_p,done)=>done(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  try{
   loadDefaults();store=new FileStore(path.join(data,'focus'));const development=process.argv.includes('--dev-layout-fixtures');if(development&&(!process.env.OWL_FOCUS_DATA_DIR||!data.startsWith(path.resolve(root,'..')+path.sep)))throw Error('开发占位只允许明确隔离存档路径。');service=new FocusService(store,development?{catalog:require('../tests/fixtures/placement-catalog.cjs')}:{});const snapshot=service.snapshot.bind(service);service.snapshot=()=>({...snapshot(),configuredFocusSeconds:defaults.seconds,configuredBreakSeconds:defaults.breakSeconds??300});controller=new FocusController(service);
   activity=new ActivityService({store:new ActivityFileStore(path.join(data,'activity'))});
   ipcMain.handle('owl:snapshot',e=>controller.snapshot(e));ipcMain.handle('owl:command',(e,value)=>controller.command(e,value));
   ipcMain.handle('owl:defaults',(e,value)=>{checked(e);return value===undefined?{...defaults}:saveDefaults(value);});
   ipcMain.handle('owl:open-view',e=>{checked(e);openView(views.get('compact')?.webContents===e.sender?'standalone':'compact');return true;});
   ipcMain.handle('owl:activity-snapshot',e=>{checked(e);return activitySnapshot();});
   ipcMain.handle('owl:activity-command',(e,value)=>{checked(e);if(value?.type==='stop')activity.stop();else if(value?.type==='classify')activity.classify(value.id,value.category);else throw Error('独立版暂不支持真实前台 APP 记录。');return activitySnapshot();});
   activity.on('change',()=>{for(const view of controller.views)if(!view.isDestroyed())view.send('owl:activity-changed',activitySnapshot());});
   heartbeat=setInterval(()=>{try{service.tick();}catch(e){console.error('计时已停止：',e.message);}},1000);
   powerMonitor.on('suspend',()=>{activity.stop('系统休眠，记录保持关闭。');try{service.suspend();}catch(e){console.error(e.message);}});
   powerMonitor.on('resume',()=>{try{service.tick();}catch(e){console.error(e.message);}});
   const dragEvents=[];
   if(verification==='room'||verification?.startsWith('placement'))ipcMain.handle('owl:drag',(e,value)=>{checked(e);dragEvents.push(value);return true;});
   openView();if(verification)await require(verification.startsWith('duration')?'../tests/duration.electron.cjs':verification.startsWith('placement')?'../tests/placement.electron.cjs':verification.startsWith('drawer')?'../tests/drawer.electron.cjs':verification.startsWith('test-access')?'../tests/test-access.electron.cjs':verification.startsWith('collection')?'../tests/collection.electron.cjs':verification==='room'?'../tests/room.electron.cjs':'../tests/native.electron.cjs').run({app,views,service,activity,root,data,phase:verification,openView,dragEvents});
  }catch(e){close();if(verification){fs.mkdirSync(path.join(root,'.runtime'),{recursive:true});fs.writeFileSync(path.join(root,'.runtime/verification-startup-failed.json'),JSON.stringify({error:e.stack}));console.error(e.stack);app.exit(1);}else{dialog.showErrorBox('专注存档未被覆盖',e.message);app.quit();}}
 });
 app.on('activate',()=>{if(service&&views.size===0&&!verification)openView();});
 app.on('window-all-closed',()=>app.quit());app.on('before-quit',close);
}
