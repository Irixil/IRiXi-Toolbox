'use strict';
// Host-owned bridge only. It receives an existing service, creates no timer,
// store or window, and does not close the service when a view disconnects.
const attached=new WeakMap();
class FocusController {
  constructor(service){
    if(!service||typeof service.snapshot!=='function'||typeof service.dispatch!=='function'||typeof service.on!=='function')throw Error('需要现有唯一计时服务。');
    if(attached.has(service))throw Error('该计时服务已有视图桥，不能重复注册。');
    this.service=service;this.views=new Set();this.disposed=false;
    this.changed=state=>{
      for(const view of this.views){
        try{if(view.isDestroyed()){this.views.delete(view);continue;}view.send('owl:changed',structuredClone(state));}
        catch{this.views.delete(view);}
      }
    };
    service.on('change',this.changed);attached.set(service,this);
  }
  registerView(view){
    if(this.disposed)throw Error('视图桥已关闭。');
    if(!view||!view.mainFrame||typeof view.send!=='function'||typeof view.isDestroyed!=='function'||view.isDestroyed())throw Error('只能注册主机创建的有效视图。');
    this.views.add(view);let registered=true;
    return ()=>{if(registered){this.views.delete(view);registered=false;}};
  }
  allowed(event){return !this.disposed&&Boolean(event?.sender)&&Boolean(event?.senderFrame)&&this.views.has(event.sender)&&!event.sender.isDestroyed()&&event.senderFrame===event.sender.mainFrame;}
  snapshot(event){if(!this.allowed(event))throw Error('未授权窗口');return this.service.snapshot();}
  command(event,value){
    if(!this.allowed(event))return {ok:false,error:'未授权窗口'};
    try{return {ok:true,state:this.service.dispatch(value)};}
    catch(error){return {ok:false,error:error.message,state:this.service.snapshot()};}
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.views.clear();this.service.removeListener('change',this.changed);attached.delete(this.service);
  }
}
module.exports={FocusController};
