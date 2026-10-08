'use strict';
const path=require('node:path'),fs=require('node:fs');
const {FileStore}=require('./src/store.cjs');
const {FocusService}=require('./src/service.cjs');
const {FocusController}=require('./src/focus-controller.cjs');
const {ActivityService,ActivityFileStore}=require('./src/activity.cjs');
// One host-owned service and writer; closing a view never closes the service.
exports.createOwlHost=({app,BrowserWindow,WebContentsView,ipcMain,powerMonitor,dataDir,showCard,showHome,readForeground,frontendRoot=path.join(__dirname,'ui'),watchFrontend=false,isExpanded=()=>true})=>{
  let store,service,controller,standalone,disposed=false,frontendWatcher,refreshTimer,embedded,mainViewWindow,embeddingSuppressed=false,dragPointer=null,dragGeneration=0,dragQueue=Promise.resolve();
  const page=path.join(frontendRoot,'index.html');
  const defaultsFile=path.join(dataDir,'legacy-pomodoro.json');
  let defaults={seconds:1500,legacyRaw:null};
  if(fs.existsSync(defaultsFile)){
    const saved=JSON.parse(fs.readFileSync(defaultsFile,'utf8'));
    if(!Number.isInteger(saved.seconds)||saved.seconds<1||saved.seconds>10800||(saved.breakSeconds!==undefined&&(!Number.isInteger(saved.breakSeconds)||saved.breakSeconds<1||saved.breakSeconds>3600)))throw Error('旧番茄钟设置无法识别，原字节已保留。');
    defaults=saved;
  }
  try{store=new FileStore(dataDir);service=new FocusService(store);const snapshot=service.snapshot.bind(service);service.snapshot=()=>({...snapshot(),configuredFocusSeconds:defaults.seconds,configuredBreakSeconds:defaults.breakSeconds??300});controller=new FocusController(service);}
  catch(error){store?.close();throw error;}
  const checked=event=>{if(!controller.allowed(event))throw Error('未授权窗口');};
  const activity=new ActivityService({store:new ActivityFileStore(path.join(dataDir,'activity')),foreground:readForeground});
  activity.on('change',state=>{for(const view of controller.views){if(!view.isDestroyed())view.send('owl:activity-changed',state);}});
  ipcMain.handle('owl:activity-snapshot',event=>{checked(event);return activity.snapshot();});
  ipcMain.handle('owl:activity-command',(event,value)=>{
    checked(event);if(!value||!['start','stop','classify'].includes(value.type))throw Error('APP 记录操作无法识别。');
    if(value.type==='start')return activity.start();
    if(value.type==='stop')return activity.stop();
    if(typeof value.id!=='string'||value.id.length>128)throw Error('APP 时间段无法识别。');
    return activity.classify(value.id,value.category);
  });
  const register=win=>{const off=controller.registerView(win.webContents);win.once('closed',off);};
  function openStandalone(){
    if(standalone&&!standalone.isDestroyed()){standalone.show();standalone.focus();return standalone;}
    standalone=new BrowserWindow({width:920,height:820,minWidth:700,minHeight:640,title:'猫头鹰专注',backgroundColor:'#f2eee5',show:false,
      webPreferences:{preload:path.join(__dirname,'src/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
    register(standalone);standalone.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    standalone.webContents.on('will-navigate',event=>event.preventDefault());
    standalone.once('ready-to-show',()=>standalone.show());standalone.once('closed',()=>{standalone=null;});
    standalone.loadFile(page);return standalone;
  }
  ipcMain.handle('owl:snapshot',event=>controller.snapshot(event));
  ipcMain.handle('owl:command',(event,value)=>controller.command(event,value));
  ipcMain.handle('owl:open-view',event=>{checked(event);if(standalone?.webContents===event.sender)showCard();else openStandalone();return true;});
  function attach(main){
    mainViewWindow=main;
    main.once('closed',()=>{if(embedded&&!embedded.webContents.isDestroyed())embedded.webContents.close({waitForBeforeUnload:false});embedded=null;mainViewWindow=null;});
  }
  function hideEmbedded(){void resetDrag();embeddingSuppressed=true;embedded?.setVisible(false);}
  function embedBounds(event,value){
    checked(event);if(event.sender!==mainViewWindow?.webContents)throw Error('仅工具箱主页面能定位内嵌模块');
    if(!value?.visible){hideEmbedded();embeddingSuppressed=false;return true;}
    if(!isExpanded()||embeddingSuppressed){embedded?.setVisible(false);return false;}
    const size=mainViewWindow.getContentBounds();
    const {x,y,width,height}=value;
    if(![x,y,width,height].every(Number.isInteger)||x<0||y<0||width<1||height<1||x+width>size.width||y+height>size.height)throw Error('模块区域超出工具箱');
    if(!embedded){
      embedded=new WebContentsView({webPreferences:{preload:path.join(__dirname,'src/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
      embedded.setBorderRadius(17);embedded.setBackgroundColor('#f7f4ed');mainViewWindow.contentView.addChildView(embedded);
      const off=controller.registerView(embedded.webContents);embedded.webContents.once('destroyed',off);
      embedded.webContents.setWindowOpenHandler(()=>({action:'deny'}));embedded.webContents.on('will-navigate',event=>event.preventDefault());
      embedded.webContents.on('did-start-navigation',()=>{void resetDrag();});
      embedded.webContents.loadFile(page,{query:{mode:'widget'}});
    }
    embedded.setBounds({x,y,width,height});embedded.setVisible(true);return true;
  }
  function resetDrag(){
    dragGeneration++;
    const result=dragQueue.then(async()=>{if(dragPointer!==null&&mainViewWindow&&!mainViewWindow.isDestroyed()){await mainViewWindow.webContents.executeJavaScript('window.OwlModuleDrag?.cancel()');}dragPointer=null;embedded?.webContents.send('owl:drag-reset');return true;});
    dragQueue=result.catch(()=>{dragPointer=null;});return dragQueue;
  }
  function forwardDrag(event,value){
    if(disposed)return false;
    checked(event);if(event.sender!==embedded?.webContents)throw Error('Only embedded top frame may reorder its module');
    if(!value||!['begin','move','end','cancel'].includes(value.type)||!Number.isInteger(value.pointerId)||value.pointerId<0||value.pointerId>2147483647)throw Error('Invalid pointer gesture');
    if(value.type!=='cancel'&&![value.screenX,value.screenY].every(n=>Number.isFinite(n)&&Math.abs(n)<100000))throw Error('Invalid pointer point');
    const generation=dragGeneration;
    const result=dragQueue.then(async()=>{
      if(!mainViewWindow||mainViewWindow.isDestroyed())return false;
      if(value.type==='cancel'){if(dragPointer===value.pointerId){await mainViewWindow.webContents.executeJavaScript('window.OwlModuleDrag?.cancel()');dragPointer=null;}embedded.webContents.send('owl:drag-reset');return true;}
      if(generation!==dragGeneration)return false;
      const box=mainViewWindow.getContentBounds(),point={x:value.screenX-box.x,y:value.screenY-box.y};
      if(value.type==='begin'){
        if(!isExpanded()||embeddingSuppressed||!embedded.getVisible())return false;
        const b=embedded.getBounds();if(point.x<b.x||point.y<b.y||point.x>b.x+b.width||point.y>b.y+b.height)return false;
        const ok=await mainViewWindow.webContents.executeJavaScript('window.OwlModuleDrag?.begin('+JSON.stringify(point)+')');if(ok)dragPointer=value.pointerId;return Boolean(ok);
      }
      if(dragPointer!==value.pointerId)return false;
      const method=value.type==='move'?'move':'finish';
      const ok=await mainViewWindow.webContents.executeJavaScript('window.OwlModuleDrag?.'+method+'('+JSON.stringify(point)+')');
      if(value.type==='end'){dragPointer=null;embedded.webContents.send('owl:drag-reset');}return Boolean(ok);
    });dragQueue=result.catch(()=>{});return result;
  }
  ipcMain.handle('owl:drag',forwardDrag);
  ipcMain.handle('owl:embed-bounds',embedBounds);
  ipcMain.handle('owl:widget-size',event=>{checked(event);if(event.sender!==embedded?.webContents)throw Error('仅内嵌模块可切换尺寸');return mainViewWindow.webContents.executeJavaScript("document.querySelector('[data-widget-size-cycle=\"pomodoro\"]').click()");});
  ipcMain.handle('owl:enter',async event=>{checked(event);await showCard();return true;});
  ipcMain.handle('owl:return',async event=>{checked(event);await showHome(false);return true;});
  ipcMain.handle('owl:collapse',async event=>{checked(event);await showHome(true);return true;});
  ipcMain.handle('owl:defaults',(event,legacyRaw)=>{
    checked(event);
    if(legacyRaw&&typeof legacyRaw==='object'){
      const seconds=legacyRaw.seconds,breakSeconds=legacyRaw.breakSeconds??defaults.breakSeconds??300;
      if(!Number.isInteger(seconds)||seconds<1||seconds>10800||!Number.isInteger(breakSeconds)||breakSeconds<1||breakSeconds>3600)throw Error('专注时长无效。');
      if(service.snapshot().active)throw Error('先结束当前一轮再设置时长。');
      const candidate={...defaults,seconds,breakSeconds};
      const temp=defaultsFile+'.tmp';const fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(candidate,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,defaultsFile);defaults=candidate;controller.changed(service.snapshot());
    }
    if(!fs.existsSync(defaultsFile)&&typeof legacyRaw==='string'&&legacyRaw.length<=256){
      let parts;try{parts=JSON.parse(legacyRaw);}catch{return {...defaults};}
      if(Array.isArray(parts)&&(parts.length===2||parts.length===3)&&parts.every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=60)){
        const seconds=parts.length===3?Math.min(60,parts[0]*60+parts[1])*60+parts[2]:parts[0]*60+parts[1];
        // Preserve the raw original, including zero, without inventing history/rewards.
        defaults={seconds:seconds>0?seconds:1500,legacyRaw,zeroDuration:seconds===0};
        fs.writeFileSync(defaultsFile,JSON.stringify(defaults,null,2),{flag:'wx',mode:0o600});controller.changed(service.snapshot());
      }
    }
    return {...defaults};
  });
  if(watchFrontend){
    frontendWatcher=fs.watch(frontendRoot,{recursive:true},(_event,file)=>{
      if(!file||!/[.](html|css|js|mjs|png|json|ttf|woff2)$/.test(file))return;
      clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{
        const expected=require('node:url').pathToFileURL(page).href;
        for(const view of controller.views){
          if(!view.isDestroyed()&&view.getURL().split('?')[0]===expected)view.reload();
        }
      },200);
    });
  }
  const heartbeat=setInterval(()=>{try{service.tick();}catch(e){console.error('专注计时已停止:',e.message);}},1000);
  const suspend=()=>{activity.stop('系统休眠，APP 记录已停止；唤醒后需要主动开启。');try{service.suspend();}catch(e){console.error(e.message);}};
  const resume=()=>{try{service.tick();}catch(e){console.error(e.message);}};
  powerMonitor.on('suspend',suspend);powerMonitor.on('resume',resume);
  return {service,controller,activity,register,openStandalone,getStandalone:()=>standalone,getEmbedded:()=>embedded,inspectEmbedding:()=>({expanded:isExpanded(),suppressed:embeddingSuppressed,visible:embedded?.getVisible(),dragPointer}),attach,hideEmbedded,allowEmbedded:()=>{embeddingSuppressed=false;},page,dispose(){if(disposed)return;activity.close();disposed=true;if(embedded){mainViewWindow?.contentView.removeChildView(embedded);if(!embedded.webContents.isDestroyed())embedded.webContents.close({waitForBeforeUnload:false});embedded=null;}clearTimeout(refreshTimer);frontendWatcher?.close();clearInterval(heartbeat);powerMonitor.removeListener('suspend',suspend);powerMonitor.removeListener('resume',resume);controller.dispose();service.close();}};
};
