(()=>{'use strict';
const cfg=window.STAFF_APP_CONFIG, schema=window.STAFF_FIELD_SCHEMA;
const sb=supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id), money=n=>(Number(n||0)).toLocaleString('ko-KR')+'원';
let me=null,currentFilter='all',lastSites=[],salesRows=[];
const financialCols=new Set(schema.financial_cols||[46,47,48,49,50,51,52]);
const labels=schema.fields.map(x=>x.label);
const defaultDisplay=['S/N','보고서  등급','지역','문서작성 > 담당','현장점검원','문서작성 진행 현황 > 현황 > 보고서 작성 완료'];
let displayFields=JSON.parse(localStorage.getItem('staff_display_fields')||'null')||defaultDisplay;

function notify(el,msg,ok=false){el.textContent=msg||'';el.style.color=ok?'#17733c':'#b42318'}
function isAdmin(){return me?.role==='admin'&&me?.approved}
function val(row,label){const ix=labels.indexOf(label);return ix<0?'':(row.safe_values?.[ix]??'')}
function statusOf(r){
  const hasPlan=!!(r.field_plan_start||r.field_plan_end), hasEnd=!!r.field_end, hasReport=!!r.report_complete_date;
  if(hasReport)return 'complete'; if(hasEnd)return 'unwritten'; if(hasPlan)return 'checking';
  if(String(r.inspection_stage||'').trim())return 'target'; return 'inprogress';
}
function filterOk(r){if(currentFilter==='all')return true;const s=statusOf(r);if(currentFilter==='inprogress')return s!=='complete';if(currentFilter==='checked')return s==='unwritten'||s==='complete';return s===currentFilter}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function phone(v){return String(v||'').replace(/[^0-9]/g,'')}

async function profileFor(user){
 const {data,error}=await sb.from('pjt_profiles').select('*').eq('id',user.id).maybeSingle();
 if(error)throw error; return data;
}
async function boot(){
 const {data:{session}}=await sb.auth.getSession();
 if(!session)return showLogin();
 const p=await profileFor(session.user);
 if(!p?.approved){await sb.auth.signOut();showLogin();notify($('loginMsg'),'승인되지 않은 계정입니다. 관리자에게 문의하세요.');return}
 me=p; showApp();
}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
function showApp(){
 $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');
 $('userBadge').textContent=`${me.name||me.user_id||''} · ${isAdmin()?'관리자':'일반 사용자'}`;
 $('salesNav').classList.toggle('hidden',!isAdmin()); $('usersNav').classList.toggle('hidden',!isAdmin());
 showPage('search'); searchSites(); if(isAdmin())loadUsers();
}
async function login(){
 const raw=$('loginId').value.trim(), pw=$('loginPw').value; if(!raw||!pw)return notify($('loginMsg'),'ID와 비밀번호를 입력하세요.');
 notify($('loginMsg'),'로그인 확인 중...',true);
 const email=raw.includes('@')?raw:`${raw.toLowerCase()}@staff.internal`;
 const {data,error}=await sb.auth.signInWithPassword({email,password:pw});
 if(error)return notify($('loginMsg'),'로그인에 실패했습니다. 신규 직원은 ID로, 기존 관리자는 기존 이메일로 로그인하세요.');
 const p=await profileFor(data.user); if(!p?.approved){await sb.auth.signOut();return notify($('loginMsg'),'승인되지 않은 계정입니다.');}
 me=p; showApp();
}
function showPage(name){document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===name));$('page-'+name).classList.add('active');if(name==='sales'&&isAdmin())loadSales();if(name==='users'&&isAdmin())loadUsers()}

async function searchSites(){
 const q=$('siteQuery').value.trim(); $('searchMeta').textContent='검색 중...';
 let query=sb.from('staff_site_search').select('*').order('excel_row',{ascending:true}).limit(300);
 if(q){const s=q.replace(/[%_,()]/g,' ');query=query.or(`site_name.ilike.%${s}%,previous_name.ilike.%${s}%,region.ilike.%${s}%,sn.ilike.%${s}%,document_owner.ilike.%${s}%,field_inspector.ilike.%${s}%`)}
 const {data,error}=await query;if(error){$('searchMeta').textContent='검색 오류: '+error.message;return}
 lastSites=(data||[]).filter(filterOk); $('searchMeta').textContent=`${lastSites.length.toLocaleString()}개 표시${data?.length===300?' · 검색 결과가 많아 상위 300개까지 표시':''}`; renderSites();
}
function renderSites(){
 const root=$('siteResults');if(!lastSites.length){root.innerHTML='<div class="siteCard">검색 결과가 없습니다.</div>';return}
 root.innerHTML=lastSites.map(r=>{
   const minis=displayFields.map(f=>`<div><span>${esc(f)}</span><b>${esc(val(r,f)||'-')}</b></div>`).join('');
   const st=statusOf(r); const p1=r.field_plan_start?'done':'',p2=r.field_end?'done':(r.field_plan_start?'working':''),p3=r.report_complete_date?'done':(r.field_end?'working':'');
   return `<article class="siteCard"><div class="siteTop"><div><h3>${esc(r.site_name)}</h3><span class="tag">${esc(r.report_grade||'등급 없음')}</span><span class="tag">${esc(r.region||'지역 없음')}</span></div><button data-detail="${r.source_id}">상세 조회</button></div><div class="miniGrid">${minis}</div><div class="stepRow"><div class="step ${p1}">점검계획</div><div class="step ${p2}">현장점검</div><div class="step ${p3}">보고서</div><div class="step">${st==='complete'?'완료':st==='unwritten'?'미작성':st==='checking'?'진행 중':st==='target'?'점검대상':'진행 중'}</div></div></article>`
 }).join('');
 root.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(Number(b.dataset.detail)));
}
async function openDetail(id){
 const {data,error}=await sb.from('staff_site_search').select('*').eq('source_id',id).single();if(error)return alert(error.message);
 $('detailTitle').textContent=data.site_name;
 const groups=[['기본정보',1,18],['업무·문서',19,54],['유지관리 수량',55,81],['성능점검 대상',83,109],['성능점검 확정',111,137]];
 $('detailTabs').innerHTML=groups.map((g,i)=>`<button class="chip ${i?'':'active'}" data-g="${i}">${g[0]}</button>`).join('');
 const render=i=>{const g=groups[i];let html='';for(let c=g[1];c<=g[2];c++){if(financialCols.has(c))continue;const f=schema.fields[c-1];if(!f)continue;const v=data.safe_values?.[c-1];if(v===''||v===null||v===undefined)continue;html+=`<div><b>${esc(f.label)}</b><span>${esc(v)}</span></div>`}$('detailBody').innerHTML=html||'<div>등록된 내용이 없습니다.</div>';document.querySelectorAll('#detailTabs .chip').forEach((x,k)=>x.classList.toggle('active',k===i))};
 document.querySelectorAll('#detailTabs .chip').forEach(b=>b.onclick=()=>render(Number(b.dataset.g)));render(0);$('detailDlg').showModal();
}
function setupFields(){
 const candidates=schema.fields.filter(f=>!f.financial&&f.col<=54&&![42,43].includes(f.col));
 $('fieldList').innerHTML=candidates.map(f=>`<label><input type="checkbox" value="${esc(f.label)}" ${displayFields.includes(f.label)?'checked':''}>${esc(f.label)}</label>`).join('');$('fieldsDlg').showModal();
}
function saveFields(){const a=[...$('fieldList').querySelectorAll('input:checked')].map(x=>x.value).slice(0,8);displayFields=a.length?a:defaultDisplay;localStorage.setItem('staff_display_fields',JSON.stringify(displayFields));$('fieldsDlg').close();renderSites()}

async function loadSales(){
 if(!isAdmin())return; let all=[],from=0,step=1000;
 while(true){let q=sb.from('staff_sales_view').select('*').order('sales_year',{ascending:false}).order('sales_month',{ascending:false}).range(from,from+step-1);const {data,error}=await q;if(error){alert('매출 조회 오류: '+error.message);return}all.push(...(data||[]));if(!data||data.length<step)break;from+=step}
 salesRows=all; fillSalesFilters(); renderSales();
}
function fillSalesFilters(){
 const sy=$('salesYear'),so=$('salesOwner');const y=sy.value,o=so.value;
 const years=[...new Set(salesRows.map(r=>r.sales_year).filter(Boolean))].sort((a,b)=>b-a), owners=[...new Set(salesRows.map(r=>r.document_owner).filter(Boolean))].sort();
 sy.innerHTML='<option value="">전체 연도</option>'+years.map(v=>`<option>${v}</option>`).join('');so.innerHTML='<option value="">전체 담당자</option>'+owners.map(v=>`<option>${esc(v)}</option>`).join('');sy.value=y;so.value=o;
 if(!$('salesMonth').dataset.ready){$('salesMonth').innerHTML='<option value="">전체 월</option>'+Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}월</option>`).join('');$('salesMonth').dataset.ready='1'}
}
function filteredSales(){const y=$('salesYear').value,m=$('salesMonth').value,o=$('salesOwner').value,q=$('salesQuery').value.trim().toLowerCase();return salesRows.filter(r=>(!y||String(r.sales_year)===y)&&(!m||String(r.sales_month)===m)&&(!o||r.document_owner===o)&&(!q||String(r.site_name).toLowerCase().includes(q)))}
function renderSales(){const rows=filteredSales(),total=rows.reduce((s,r)=>s+Number(r.sales_amount||0),0),bind=rows.reduce((s,r)=>s+Number(r.binding_cost||0),0);$('kpiCount').textContent=rows.length.toLocaleString();$('kpiAmount').textContent=money(total);$('kpiBinding').textContent=money(bind);$('salesTable').querySelector('tbody').innerHTML=rows.map(r=>`<tr class="${r.report_complete_date?'completeRow':''}"><td>${r.sales_year||''}</td><td>${r.sales_month||''}</td><td>${esc(r.document_owner||'')}</td><td>${esc(r.site_name)}</td><td>${money(r.sales_amount)}</td><td>${money(r.binding_cost)}</td><td>${esc(r.report_complete_date||'')}</td><td>${r.report_complete_date?'완료':''}</td></tr>`).join('')}
function exportSales(){const rows=filteredSales().map(r=>({'연도':r.sales_year,'월':r.sales_month,'문서작성 담당':r.document_owner,'현장명':r.site_name,'매출액(VAT 미포함)':r.sales_amount||0,'제본비':r.binding_cost||0,'보고서 완료일':r.report_complete_date||'','비고':r.report_complete_date?'완료':''}));const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'매출관리');XLSX.writeFile(wb,`매출관리_${new Date().toISOString().slice(0,10)}.xlsx`)}

function excelSerial(v){if(typeof v!=='number')return String(v??'').trim();if(v>20000&&v<80000){const d=XLSX.SSF.parse_date_code(v);if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}return v}
function ownerParts(raw){raw=String(raw||'').trim();const m=raw.match(/^(20\d{2}|\d{2})(.*)$/);if(!m)return {year:null,owner:raw};let y=Number(m[1]);if(y<100)y+=2000;return {year:y,owner:m[2].trim()||raw}}
async function importWorkbook(file){
 if(!isAdmin())return alert('관리자만 가져올 수 있습니다.');
 if(!confirm('선택한 엑셀의 진행중 시트를 DB에 등록/갱신합니다. 계속할까요?'))return;
 const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:false}),ws=wb.Sheets['진행중']||wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
 const batch=[],max=137; let count=0;
 for(let ri=3;ri<rows.length;ri++){const a=rows[ri];const site=String(a[3]||'').trim();if(!site)continue;const vals=Array.from({length:max},(_,i)=>excelSerial(a[i]));const safe=vals.map((v,i)=>financialCols.has(i+1)?null:v);const op=ownerParts(vals[18]);let month=Number(vals[20]||vals[19])||null;if(month<1||month>12)month=null;let year=op.year;for(const ix of [31,44,43]){const m=String(vals[ix]||'').match(/^(\d{4})-(\d{2})/);if(m){year=year||Number(m[1]);month=month||Number(m[2]);}}
 const num=i=>vals[i]===''?null:Number(vals[i]);batch.push({excel_row:ri+1,sn:String(vals[0]||''),site_name:site,previous_name:String(vals[4]||''),report_grade:String(vals[1]||''),region:String(vals[16]||''),area:num(5),households:String(vals[6]||''),approval_date:String(vals[7]||''),inspection_stage:String(vals[8]||''),document_owner_raw:String(vals[18]||''),document_owner:op.owner,document_progress_month:String(vals[19]||''),document_complete_month:String(vals[20]||''),field_plan_start:String(vals[27]||''),field_plan_end:String(vals[28]||''),field_end:String(vals[29]||''),field_inspector:String(vals[30]||''),report_complete_date:String(vals[31]||''),report_status:String(vals[32]||''),sales_manager:String(vals[40]||''),client_manager:String(vals[41]||''),client_contact:String(vals[42]||''),contract_start:String(vals[43]||''),contract_end:String(vals[44]||''),performance_amount:num(45),maintenance_amount:num(46),manager_amount:num(47),contract_amount:num(48),sales_amount:num(49),binding_cost:num(50),binding_ratio:num(51),sales_year:year,sales_month:month,full_values:vals,safe_values:safe});
 if(batch.length>=80){const {error}=await sb.from('staff_site_source').upsert(batch.splice(0),{onConflict:'excel_row'});if(error)throw error;count+=80;$('salesImport').textContent=`가져오는 중 ${count.toLocaleString()}`}}
 if(batch.length){const n=batch.length,{error}=await sb.from('staff_site_source').upsert(batch,{onConflict:'excel_row'});if(error)throw error;count+=n}
 await sb.from('staff_workbook_meta').insert({source_file:file.name,source_sheet:ws.name||'진행중',field_schema:schema.fields,auxiliary_sheets:{sheet_names:wb.SheetNames},record_count:count});$('salesImport').textContent='엑셀 가져오기';alert(`${count.toLocaleString()}개 현장을 DB에 등록/갱신했습니다.`);await Promise.all([searchSites(),loadSales()]);
}

async function loadUsers(){if(!isAdmin())return;const {data,error}=await sb.from('pjt_profiles').select('*').order('name',{ascending:true});if(error)return;$('userTable').querySelector('tbody').innerHTML=(data||[]).map(p=>`<tr><td>${esc(p.name||'')}</td><td>${esc(p.user_id||'')}</td><td>${esc(p.phone||'')}</td><td><select data-u="${p.id}" data-k="role"><option value="viewer" ${p.role==='viewer'?'selected':''}>일반</option><option value="admin" ${p.role==='admin'?'selected':''}>관리자</option></select></td><td><input type="checkbox" data-u="${p.id}" data-k="approved" ${p.approved?'checked':''}></td><td><input type="checkbox" data-u="${p.id}" data-k="can_view_report" ${p.can_view_report?'checked':''}></td><td><input type="checkbox" data-u="${p.id}" data-k="can_view_sales_work" ${p.can_view_sales_work?'checked':''}></td><td><input type="checkbox" data-u="${p.id}" data-k="can_view_inspection" ${p.can_view_inspection?'checked':''}></td><td><input type="checkbox" data-u="${p.id}" data-k="can_view_management" ${p.can_view_management?'checked':''}></td><td><div class="userActions"><button data-reset="${p.id}">PW</button>${p.id!==me.id?`<button data-del="${p.id}">삭제</button>`:''}</div></td></tr>`).join('');
 document.querySelectorAll('#userTable [data-k]').forEach(el=>el.onchange=async()=>{const v=el.type==='checkbox'?el.checked:el.value;const patch={[el.dataset.k]:v};if(el.dataset.k==='role'&&v==='admin')Object.assign(patch,{can_view_sales:true,can_print_sales:true,can_view_money:true});const {error}=await sb.from('pjt_profiles').update(patch).eq('id',el.dataset.u);if(error){alert(error.message);loadUsers()}});
 document.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetPw(b.dataset.reset));document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteUser(b.dataset.del));}
async function invokeAdmin(body){const {data,error}=await sb.functions.invoke(cfg.userAdminFunction,{body});if(error)throw error;if(data?.error)throw new Error(data.error);return data}
async function createUser(e){e.preventDefault();notify($('userMsg'),'등록 중...',true);try{await invokeAdmin({action:'create',employee_id:$('empId').value,password:$('empPw').value,name:$('empName').value,phone:$('empPhone').value,role:$('empRole').value,approved:$('empApproved').checked,permissions:{can_view_report:$('permReport').checked,can_view_sales_work:$('permSalesWork').checked,can_view_inspection:$('permInspection').checked,can_view_management:$('permManagement').checked}});notify($('userMsg'),'등록 완료',true);setTimeout(()=>{$('userDlg').close();$('userForm').reset();loadUsers()},500)}catch(err){notify($('userMsg'),err.message)}}
async function resetPw(id){const pw=prompt('새 비밀번호를 8자 이상 입력하세요.');if(!pw)return;try{await invokeAdmin({action:'reset_password',user_uuid:id,password:pw});alert('비밀번호를 변경했습니다.')}catch(e){alert(e.message)}}
async function deleteUser(id){if(!confirm('이 사용자 계정을 삭제할까요?'))return;try{await invokeAdmin({action:'delete',user_uuid:id});loadUsers()}catch(e){alert(e.message)}}

$('loginBtn').onclick=login;$('loginPw').onkeydown=e=>{if(e.key==='Enter')login()};$('logoutBtn').onclick=async()=>{await sb.auth.signOut();me=null;showLogin()};document.querySelectorAll('nav button[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$('searchBtn').onclick=searchSites;$('siteQuery').onkeydown=e=>{if(e.key==='Enter')searchSites()};document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));searchSites()});$('fieldBtn').onclick=setupFields;$('fieldsSave').onclick=saveFields;
$('salesRefresh').onclick=renderSales;['salesYear','salesMonth','salesOwner'].forEach(id=>$(id).onchange=renderSales);$('salesQuery').oninput=renderSales;$('salesPrint').onclick=()=>window.print();$('salesExport').onclick=exportSales;$('salesImport').onclick=()=>$('salesFile').click();$('salesFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importWorkbook(f)}catch(err){$('salesImport').textContent='엑셀 가져오기';alert('가져오기 오류: '+err.message)}e.target.value=''};
$('newUserBtn').onclick=()=>$('userDlg').showModal();$('userForm').onsubmit=createUser;
sb.auth.onAuthStateChange(()=>setTimeout(boot,0));boot().catch(e=>{console.error(e);showLogin();notify($('loginMsg'),e.message)});
})();
