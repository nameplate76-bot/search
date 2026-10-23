const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const calls = [];
const elements = new Map();
const el = id => { if (!elements.has(id)) elements.set(id, {value:'',textContent:'',close(){}}); return elements.get(id); };
const context = vm.createContext({console,JSON,Number,String,Array,Set,
 $:el, isAdmin:()=>true, canEditSite:()=>true,canCreateSite:()=>true,
 notify:(e,text)=>{e.textContent=text},regionFromAddress:()=> '경기',
 refreshAfterSiteSave:async()=>{},closeSiteEditor:()=>{},invalidateDataCaches:()=>{},refreshActiveData:async()=>{},refreshDbStatus:async()=>{},setTimeout:()=>{},
 syncAddressToSameSiteName:async()=>({synced:false}),
 syncInspectionType:()=>{},syncContractAmount:()=>{},syncRegionFromSiteAddress:()=>{},syncFieldEndFromPlan:()=>{},syncBindingRatioFromAmounts:()=>{},
 siteAddressMode:'manual', addressInputMode:'manual',siteEditMode:'edit',siteScheduleDraft:{start:'',end:'',inspectors:'',changed:false},siteEditValues:Array(137).fill(''),
 siteEditGroupIndex:0,renderSiteEditTabs:()=>{},renderSiteEditFields:()=>{},siteEditRow:{client_phone:'031-111-1234'},
 lastSites:[{source_id:117,site_name:'검증학교(26년)'}],
 sb:{rpc:async(name,args)=>{calls.push({name,args});return name==='staff_update_site_contact'?{data:{school_phone:{synced:true,matched:2,updated:2},school_email:{synced:true,matched:2,updated:2}}}:{data:117};}},
});
vm.runInContext(source.slice(source.indexOf('function cleanPhone('),source.indexOf('function callPhone(')),context);
vm.runInContext(source.slice(source.indexOf('async function saveContact('),source.indexOf("let currentRouteAddress=")),context);
vm.runInContext(source.slice(source.indexOf('function sitePayload('),source.indexOf('function reportValue(')),context);
const note=(...args)=>context.schoolPhoneSaveNote(...args);
assert.ok(note('상록중학교(26년)','031-123-4567','','true'));
assert.equal(note('상록중학교','010-1234-5678','010-9876-5432'), '');
assert.equal(note('사무실','031-123-4567'), '');
assert.equal(note('상록중학교','031-123-4567 / 010-9876-5432','031-123-4567 / 010-1234-5678'), '');
assert.ok(note('상록중학교（26년）','02-1234-5678','031-123-4567'));
assert.ok(note('검증학교','070-1234-5678'));
const emailNote=(...args)=>context.schoolEmailSaveNote(...args);
assert.ok(emailNote('상록중학교(26년)','new@example.com'));
assert.ok(emailNote('상록중학교（26년）','new@example.com','old@example.com'));
assert.equal(emailNote('상록중학교','new@example.com',' new@example.com '),'');
assert.equal(emailNote('상록중학교','','old@example.com'),'');
assert.equal(emailNote('사무실','new@example.com','old@example.com'),'');
assert.ok(emailNote('상록중학교','same@example.com','same@example.com',true));

(async()=>{
 el('contactSourceId').value='117';el('contactSiteName').value='검증학교(26년)';
 el('contactPhone').value='0311234567 / 01012345678';el('contactEmail').value='source@example.com';el('contactAddress').value='경기도 안산시';
 await context.saveContact({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'staff_update_site_contact');
 assert.equal(calls[0].args.p_phone,'031-123-4567 / 010-1234-5678');
 assert.match(el('contactEditMsg').textContent,/같은 학교 2건/);
 assert.match(el('contactEditMsg').textContent,/관리주체 이메일/);
 calls.length=0;
 context.siteEditValues[3]='검증학교(26년)';el('siteEditSourceId').value='117';el('siteFormPhone').value='031-123-4567 / 010-1234-5678';el('siteFormEmail').value='source@example.com';el('siteFormAddress').value='경기도 안산시';
 await context.saveSiteEdit({preventDefault(){}});
 assert.equal(calls[0].name,'staff_update_site');
 assert.equal(calls[0].args.p_data.values[42],'031-123-4567 / 010-1234-5678 source@example.com');
 assert.match(el('siteEditMsg').textContent,/학교 일반전화번호/);
 assert.match(el('siteEditMsg').textContent,/관리주체 이메일/);
 calls.length=0;context.siteEditMode='create';context.siteEditRow=null;
 await context.saveSiteEdit({preventDefault(){}});
 assert.equal(calls[0].name,'staff_create_site');
 assert.match(el('siteEditMsg').textContent,/학교 일반전화번호/);
 // DB에서 실패하면 화면이 저장 성공으로 표시되어서는 안 됩니다.
 context.sb.rpc=async()=>({error:{message:'테스트 저장 오류'}});
 await context.saveContact({preventDefault(){}});
 assert.match(el('contactEditMsg').textContent,/저장 실패: 테스트 저장 오류/);
 console.log('PASS: school phone/email notices; unchanged/blank email; atomic contact RPC; create/edit payload; save errors');
})().catch(e=>{console.error(e);process.exitCode=1});
