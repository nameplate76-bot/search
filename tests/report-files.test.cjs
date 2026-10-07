const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../report-files.js'),'utf8');
function setup(mode='ok',override=''){
 const nodes=new Map();
 function node(sel){if(!nodes.has(sel))nodes.set(sel,{value:'',textContent:'',dataset:{},disabled:false,hidden:false,innerHTML:'',addEventListener(event,fn){this[event]=fn},querySelectorAll(){return []}});return nodes.get(sel)}
 const dialog={showModal(){},close(){},remove(){},querySelector:node,querySelectorAll(sel){return sel.split(',').filter(x=>!x.includes('file-id')).map(node)}};
 const storage=new Map(override?[['staff-report-api-v1:https://example.supabase.co',override]]:[]);
 let releaseMapping,releaseReports,saved=null,mappingReady=false,reportsReady=false;const calls=[];
 const context={window:{},URL,Date,Number,String,Error,TypeError,JSON,Set,Promise,AbortController,setTimeout,clearTimeout,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{createElement:()=>dialog,body:{append(){}}},fetch:async(url,options)=>{
  calls.push({url,method:options.method||'GET'});
  if(url.endsWith('/reports')){if(!reportsReady)await new Promise(r=>releaseReports=()=>{reportsReady=true;r()});return new Response(JSON.stringify({connected:!!saved,files:[]}))}
  if(options.method==='PUT'){if(mode==='denied')return new Response(JSON.stringify({error:'관리자만 변경할 수 있습니다.'}),{status:403});saved=JSON.parse(options.body);return new Response(JSON.stringify({mapping:saved}))}
  if(!mappingReady){await new Promise(r=>releaseMapping=()=>{mappingReady=true;r()});return new Response(JSON.stringify({mapping:{folder:'old/folder'}}))}
  return new Response(JSON.stringify({mapping:mode==='mismatch'?{folder:'other/folder'}:saved}));
 }};
 vm.runInNewContext(source,context);
 context.window.ReportFiles.open({admin:true,row:{site_name:'테스트',source_id:7523},config:{supabaseUrl:'https://example.supabase.co',reportApiUrl:'https://current.trycloudflare.com'},session:async()=>({access_token:'test-token'})});
 return {node,calls,releaseMapping:()=>releaseMapping(),releaseReports:()=>releaseReports()};
}
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 let t=setup();await tick();t.node('[data-folder]').value='유지관리 및 성능점검/② 학교/상록중학교';t.node('[data-folder]').input();t.releaseMapping();await tick();
 assert.equal(t.node('[data-folder]').value,'유지관리 및 성능점검/② 학교/상록중학교','late mapping must not overwrite user input');
 const saving=t.node('[data-save]').onclick();await tick();assert.equal(t.calls.some(x=>x.method==='PUT'),false,'save queues behind initial report request');assert.equal(t.node('[data-save]').disabled,true);
 t.releaseReports();await saving;await tick();assert.ok(t.node('[data-save-status]').textContent.includes('저장 완료'));assert.equal(t.calls.filter(x=>x.method==='PUT').length,1);assert.equal(t.calls.filter(x=>x.url.endsWith('/mapping')).length,3);assert.equal(t.calls.filter(x=>x.url.endsWith('/reports')).length,2);
 for(const mode of ['denied','mismatch']){t=setup(mode);await tick();t.releaseMapping();t.releaseReports();await tick();t.node('[data-folder]').value='학교/상록중학교';await t.node('[data-save]').onclick();const result=t.node('[data-save-status]');assert.equal(result.dataset.error,'true');assert.ok(result.textContent.includes(mode==='denied'?'HTTP 403':'저장 내용을 확인하지 못했습니다'));assert.ok(!result.textContent.includes('저장 완료'));assert.equal(t.node('[data-save]').disabled,false)}
 t=setup('ok','https://replacement.trycloudflare.com');await tick();assert.ok(t.calls.every(x=>x.url.startsWith('https://replacement.trycloudflare.com/')));t.releaseMapping();t.releaseReports();await tick();
 console.log('PASS: delayed mapping preserves input; save queues during initial query; PUT/GET verifies storage; automatic report refresh; visible HTTP 403; readback mismatch; persistent HTTPS override');
})().catch(e=>{console.error(e);process.exitCode=1});
