const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const base=path.join(__dirname,'..'),html=fs.readFileSync(path.join(base,'index.html'),'utf8'),d=new JSDOM(html,{url:'https://portal.test',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window,doc=w.document;
w.matchMedia=q=>({matches:process.env.ENTER_MOBILE==='1'?q.includes('max-width'):q.includes('min-width'),addEventListener(){}});w.CSS={escape:String};w.scrollTo=()=>{};let alerts=[];w.alert=s=>alerts.push(s);w.HTMLDialogElement.prototype.show=w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
w.eval(fs.readFileSync(path.join(__dirname,'design-fixture.js'),'utf8')+'\nwindow.__qa.client=client;');

w.HTMLElement.prototype.getClientRects=function(){return [{width:100,height:30}]};w.HTMLElement.prototype.scrollIntoView=()=>{};
for(const f of ['fields.js','schedule-holidays.js','inspection-schedule.js','report-files.js'])w.eval(fs.readFileSync(path.join(base,f),'utf8'));
const app=html.match(/<script id="bundled-app-js"[^>]*>([\s\S]*?)<\/script>/)[1];w.eval(app.replace(/\}\)\(\);\s*$/,`window.enterTest={openCreateSite,openSiteEditor,selectProgress(){siteEditGroupIndex=1;renderSiteEditFields();renderSiteEditTabs()},enterNavVisible};})();`));
const tick=()=>new Promise(r=>setTimeout(r,80));
(async()=>{await tick();const api=w.enterTest;if(process.env.ENTER_EDIT==='1')await api.openSiteEditor(1);else await api.openCreateSite();api.selectProgress();await tick();const root=doc.getElementById('siteEditFields'),controls=Array.from(root.querySelectorAll('input,select,textarea')).filter(api.enterNavVisible);
assert(controls.length>12);assert(controls.some(x=>x.id==='siteScheduleStart'));assert(controls.some(x=>x.id==='siteScheduleEnd'));
const dateKeys=controls.map(x=>x.id==='siteScheduleStart'?138:x.id==='siteScheduleEnd'?139:Number(x.dataset.siteCol)).filter(x=>[44,45,138,139,28,29,26,27,32,40,22,23].includes(x));assert.deepEqual(dateKeys,[44,45,138,139,28,29,26,27,32,40,22,23]);
for(let i=0;i<controls.length-1;i++){controls[i].focus();const e=new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});controls[i].dispatchEvent(e);assert(e.defaultPrevented);assert.equal(doc.activeElement,controls[i+1],`next input from ${controls[i].dataset.siteCol||controls[i].id}`)}
const last=controls.at(-1);last.focus();const end=new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});last.dispatchEvent(end);assert(end.defaultPrevented);assert.equal(doc.activeElement,last);
controls[0].focus();controls[0].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));assert.equal(doc.activeElement,controls[0]);
const second=controls[1];second.disabled=true;controls[0].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(doc.activeElement,controls[2]);second.disabled=false;
second.readOnly=true;controls[0].focus();controls[0].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(doc.activeElement,controls[2]);second.readOnly=false;
second.closest('label').classList.add('hidden');controls[0].focus();controls[0].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(doc.activeElement,controls[2]);
console.log('PASS V207: full rendered create/edit progress Enter sequence includes both plan dates and reordered dates, skips disabled/readonly/hidden, last stays, IME preserved');w.close()})().catch(e=>{console.error(e);w.close();process.exit(1)});
