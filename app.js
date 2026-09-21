(()=>{'use strict';
const cfg=window.STAFF_APP_CONFIG, schema=window.STAFF_FIELD_SCHEMA;
const sb=supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])), money=n=>(Number(n||0)).toLocaleString('ko-KR')+'원';
const labels=schema.fields.map(x=>x.label), financialCols=new Set(schema.financial_cols||[46,47,48,49,50,51,52]);
const dateCols=new Set([8,18,22,23,26,27,28,29,30,32,40,44,45]);
let me=null,currentFilter='all',lastSites=[],salesRows=[],salesImported=false;
let unwrittenRows=[],unwrittenOwnerFilter='all';
let selectedSiteIds=new Set();
const DEFAULT_DISPLAY_FIELDS=['S/N','보고서  등급','현장명','지역','문서작성 > 담당','현장점검원','문서작성 진행 현황 > 현황 > 보고서 작성 완료'];
let displayFields=[...DEFAULT_DISPLAY_FIELDS];
function selectableDisplayFields(){return schema.fields.filter(f=>!f.financial&&f.col<=45&&String(f.label||'').trim())}
function sanitizeDisplayFields(list){const allowed=new Set(selectableDisplayFields().map(f=>f.label));return [...new Set((Array.isArray(list)?list:[]).map(String).filter(x=>allowed.has(x)))]}
function displayFieldStorageKey(){return `staff_display_fields:${me?.id||'guest'}`}
function applyDisplayFieldPreference(profile){
 const server=sanitizeDisplayFields(profile?.staff_display_fields);
 let chosen=server;
 if(!chosen.length){
  try{chosen=sanitizeDisplayFields(JSON.parse(localStorage.getItem(`staff_display_fields:${profile?.id||''}`)||'null'))}catch(e){}
 }
 if(!chosen.length){
  try{chosen=sanitizeDisplayFields(JSON.parse(localStorage.getItem('staff_display_fields')||'null'))}catch(e){}
 }
 displayFields=chosen.length?chosen:[...DEFAULT_DISPLAY_FIELDS];
 try{localStorage.setItem(displayFieldStorageKey(),JSON.stringify(displayFields))}catch(e){}
 siteListColumnOrder=[];
}
const can=k=>!!me?.[k],isAdmin=()=>me?.role==='admin'&&me?.approved;
const canCreateSite=()=>isAdmin()||can('can_create_staff_sites');
const canEditSite=()=>isAdmin()||can('can_edit_staff_sites');
const canExportAllSites=()=>isAdmin()||can('can_export_staff_sites');
function uuid(){
  try{
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
    if(globalThis.crypto?.getRandomValues){
      const b=new Uint8Array(16);globalThis.crypto.getRandomValues(b);
      b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;
      const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }
  }catch(e){}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)});
}
function notify(el,msg,ok=false){el.textContent=msg||'';el.style.color=ok?'#17733c':'#b42318'}
function val(row,label){const ix=labels.indexOf(label);return ix<0?'':(row.safe_values?.[ix]??'')}
function statusOf(r){const plan=!!(r.field_plan_start||r.field_plan_end),end=!!r.field_end,report=!!r.report_complete_date;if(report)return'complete';if(end)return'unwritten';if(plan)return'checking';if(String(r.inspection_stage||'').trim())return'target';return'inprogress'}
function filterOk(r){if(currentFilter==='all')return true;const s=statusOf(r);if(currentFilter==='inprogress')return s!=='complete';if(currentFilter==='checked')return s==='unwritten'||s==='complete';return s===currentFilter}
function excelDate(serial){const base=Date.UTC(1899,11,30),d=new Date(base+Number(serial)*86400000);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):serial}
function normalizeCell(v,col){if(v===null||v===undefined)return'';if(dateCols.has(col)&&typeof v==='number'&&v>20000&&v<80000)return excelDate(v);return v}
function ownerParts(raw){raw=String(raw||'').trim();const m=raw.match(/^(20\d{2}|\d{2})(.*)$/);if(!m)return{year:null,owner:raw};let y=Number(m[1]);if(y<100)y+=2000;return{year:y,owner:m[2].trim()||raw}}
function inferYearMonth(vals,owner){let year=owner.year,month=Number(vals[20]||vals[19])||null;if(month<1||month>12)month=null;for(const ix of [31,43,44]){const m=String(vals[ix]||'').match(/^(\d{4})-(\d{2})/);if(m){year=year||Number(m[1]);month=month||Number(m[2])}}return{year,month}}
function splitContact(raw){
 raw=String(raw||'').trim();
 const em=raw.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
 const email=em?em[0]:'';
 const phone=normalizePhoneList(raw.replace(email,''));
 return{phone,email};
}
function cleanPhone(v){return String(v||'').replace(/[^0-9+]/g,'')}
function formatPhone(v){
 const n=cleanPhone(v).replace(/^\+82/,'0');
 if(/^02\d{7,8}$/.test(n))return n.replace(/^(02)(\d{3,4})(\d{4})$/,'$1-$2-$3');
 if(/^0\d{9,10}$/.test(n))return n.replace(/^(0\d{1,2})(\d{3,4})(\d{4})$/,'$1-$2-$3');
 return String(v||'').trim();
}
function splitPhoneNumbers(v){
 const raw=String(v||'').replace(/\u00a0/g,' ').trim();
 if(!raw)return[];
 const re=/(?:\+?82[-.\s]?)?(?:0?1[016789]|0?2|0?[3-6][1-5]|0?70)[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
 const found=raw.match(re)||[];
 let nums=found.map(x=>formatPhone(x)).filter(Boolean);
 if(!nums.length){
   nums=raw.split(/(?:\r?\n|[,;/|]|\s{2,})+/).map(x=>x.trim()).filter(x=>cleanPhone(x).replace(/^\+82/,'0').length>=9).map(formatPhone);
 }
 return [...new Set(nums.map(x=>String(x).trim()).filter(Boolean))];
}
function normalizePhoneList(v){return splitPhoneNumbers(v).join(' / ')}
function formatPhoneList(v){const a=splitPhoneNumbers(v);return a.length?a.join(' / '):String(v||'').trim()}
function callPhone(phone){
 const n=cleanPhone(phone);if(!n)return alert('등록된 전화번호가 없습니다.');
 // 사용자 클릭 이벤트 안에서 직접 tel: 스킴을 호출해야 iOS/Android 전화 앱이 가장 안정적으로 실행됩니다.
 window.location.href=`tel:${n}`;
}
function contactCards(r){
 const phone=String(r.client_phone||'').trim(),email=String(r.client_email||'').trim(),address=String(r.site_address||'').trim();
 const phones=splitPhoneNumbers(phone);
 const phoneHtml=phones.length?`<div class="phoneLinkList">${phones.map((p,i)=>`<a class="contactLink phoneLink phoneLinkItem" href="tel:${esc(cleanPhone(p))}" data-call-phone="${esc(p)}" aria-label="관리주체 전화번호 ${i+1} ${esc(p)} 전화걸기">📞 ${esc(p)}</a>`).join('')}</div>`:'<span class="contactEmpty">미등록</span>';
 const emailHtml=email?`<a class="contactLink" href="mailto:${esc(email)}">${esc(email)}</a>`:'<span class="contactEmpty">미등록</span>';
 const addrHtml=address?`<a href="#" class="contactLink addressLink" data-route-address="${esc(address)}" data-route-name="${esc(r.site_name||'현장')}">📍 ${esc(address)}</a>`:'<span class="contactEmpty">미등록</span>';
 return `<div class="detailContactGroup"><div class="contactCard"><span>관리주체 전화번호</span><div class="contactValueRow">${phoneHtml}</div></div><div class="contactCard"><span>관리주체 이메일</span><div class="contactValueRow">${emailHtml}</div></div><div class="contactCard"><span>주소</span><div class="contactValueRow">${addrHtml}${address?'<button class="smallBtn" data-route-address="'+esc(address)+'" data-route-name="'+esc(r.site_name||'현장')+'">길찾기</button>':''}</div></div></div>${isAdmin()?'<div class="adminEditBar"><button class="smallBtn" data-edit-contact="'+Number(r.source_id)+'">전화·이메일·주소 수정</button></div>':''}`;
}
function bindContactActions(r){
 document.querySelectorAll('[data-call-phone]').forEach(el=>el.onclick=e=>{e.preventDefault();e.stopPropagation();callPhone(el.dataset.callPhone)});
 document.querySelectorAll('[data-route-address]').forEach(el=>el.onclick=e=>{e.preventDefault();openRouteChooser(el.dataset.routeAddress,el.dataset.routeName||r.site_name||'현장')});
 const edit=document.querySelector('[data-edit-contact]');if(edit)edit.onclick=()=>openContactEditor(r);
}
let addressInputMode='search';
function setAddressMode(mode){
 addressInputMode=mode==='manual'?'manual':'search';
 const manual=addressInputMode==='manual',addr=$('contactAddress');
 addr.readOnly=!manual;
 $('addressSearchBox')?.classList.toggle('hidden',manual);
 $('addressDetailLabel')?.classList.toggle('hidden',manual);
 $('manualAddressBtn')?.classList.toggle('hidden',manual);
 $('searchAddressModeBtn')?.classList.toggle('hidden',!manual);
 addr.placeholder=manual?'주소를 직접 입력하세요':'주소 검색 결과를 선택하세요';
 if(manual){$('contactAddressDetail').value='';addr.focus();notify($('addressSearchMsg'),'');}
}
function openContactEditor(r){
 if(!isAdmin())return alert('연락처와 주소 수정은 관리자만 가능합니다.');
 $('contactSourceId').value=r.source_id;$('contactSiteName').value=r.site_name||'';$('contactPhone').value=formatPhoneList(r.client_phone||'');$('contactEmail').value=r.client_email||'';$('contactAddress').value=r.site_address||'';$('contactAddressDetail').value='';$('addressQuery').value=r.site_address||'';setAddressMode('search');
 $('contactAddress').dataset.zonecode='';notify($('addressSearchMsg'),'주소를 검색해 선택하거나, 검색되지 않을 경우 직접입력을 선택하세요.',true);notify($('contactEditMsg'),'');$('contactEditDlg').showModal();
}
function searchAddress(){
 if(!isAdmin())return alert('주소 수정은 관리자만 가능합니다.');
 const q=String($('addressQuery').value||'').trim();
 if(!(window.kakao&&window.kakao.Postcode)){
   setAddressMode('manual');notify($('addressSearchMsg'),'주소 검색 서비스를 불러오지 못했습니다. 직접입력으로 전환했습니다.');return;
 }
 let hadResult=true;
 const pc=new window.kakao.Postcode({
   onsearch:data=>{
     hadResult=Number(data?.count||0)>0;
     if(!hadResult){notify($('addressSearchMsg'),'검색 결과가 없습니다. 검색어를 바꾸거나 아래의 직접입력을 선택하세요.');$('manualAddressBtn')?.classList.add('needsAttention');}
     else {notify($('addressSearchMsg'),`검색 결과 ${Number(data.count).toLocaleString()}건입니다. 정확한 주소를 선택하세요.`,true);$('manualAddressBtn')?.classList.remove('needsAttention');}
   },
   oncomplete:data=>{
     const addr=(data.userSelectedType==='R'?data.roadAddress:data.jibunAddress)||data.roadAddress||data.jibunAddress||data.address||'';
     $('contactAddress').value=addr;$('contactAddress').dataset.zonecode=data.zonecode||'';$('addressQuery').value=addr;$('contactAddressDetail').value='';
     notify($('addressSearchMsg'),`${data.zonecode?'['+data.zonecode+'] ':''}주소가 선택되었습니다. 필요한 경우 상세주소를 입력하세요.`,true);$('contactAddressDetail').focus();
   },
   onclose:state=>{if(!hadResult&&state!=='COMPLETE_CLOSE')notify($('addressSearchMsg'),'검색 결과가 없었습니다. 직접입력을 선택해 주소를 입력할 수 있습니다.');},
   width:'100%',height:'100%',maxSuggestItems:5
 });
 pc.open({q, popupTitle:'현장 주소 검색', popupKey:'staff-address-search'});
}
async function saveContact(e){
 e.preventDefault();if(!isAdmin())return notify($('contactEditMsg'),'관리자만 수정할 수 있습니다.');
 const base=String($('contactAddress').value||'').trim(),detail=addressInputMode==='manual'?'':String($('contactAddressDetail').value||'').trim();
 const fullAddress=[base,detail].filter(Boolean).join(' ').trim();
 if(!fullAddress)return notify($('contactEditMsg'),'주소를 검색해 선택하거나 직접입력해 주세요.');
 const id=Number($('contactSourceId').value),patch={client_phone:normalizePhoneList($('contactPhone').value.trim()),client_email:$('contactEmail').value.trim(),site_address:fullAddress};
 notify($('contactEditMsg'),'저장 중...',true);
 const{error}=await sb.from('staff_site_source').update(patch).eq('id',id);if(error)return notify($('contactEditMsg'),'저장 실패: '+error.message);
 const row=lastSites.find(x=>Number(x.source_id)===id);if(row)Object.assign(row,patch);
 notify($('contactEditMsg'),'저장했습니다.',true);setTimeout(()=>{$('contactEditDlg').close();if(row)openDetail(id)},350);
}
let currentRouteAddress='',currentRouteName='현장';
function openRouteChooser(address,name){address=String(address||'').trim();if(!address)return alert('등록된 주소가 없습니다. 관리자에게 주소 입력을 요청하세요.');currentRouteAddress=address;currentRouteName=String(name||'현장').trim()||'현장';$('routeAddress').textContent=address;$('routeDlg').showModal()}
function openWithFallback(appUrl,fallback){
 const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
 if(!mobile){window.open(fallback,'_blank','noopener');return;}
 let hidden=false;const onVis=()=>{if(document.hidden)hidden=true};document.addEventListener('visibilitychange',onVis,{once:true});
 window.location.href=appUrl;
 setTimeout(()=>{if(!hidden)window.location.href=fallback},1400);
}
function launchRoute(app){
 const a=currentRouteAddress,q=encodeURIComponent(a),name=encodeURIComponent(currentRouteName||a);let appUrl='',fallback='';
 $('routeDlg').close();
 if(app==='naver'){
   // 주소만 보유한 경우 네이버지도에서 주소를 자동 검색합니다. 검색 결과에서 바로 길찾기를 누를 수 있습니다.
   appUrl=`nmap://search?query=${q}&appname=nameplate76-bot.search`;fallback=`https://map.naver.com/p/search/${q}`;
 }else if(app==='kakao'){
   appUrl=`kakaomap://search?q=${q}`;fallback=`https://m.map.kakao.com/scheme/search?q=${q}`;
 }else if(app==='tmap'){
   appUrl=`tmap://search?name=${q}`;fallback=`https://www.tmap.co.kr/search?q=${q}`;
 }else{
   // 카카오내비는 웹 URL Scheme을 공식 제공하지 않아 주소만으로 직접 길안내를 시작할 수 없습니다.
   // 카카오맵에서 동일 주소를 검색해 목적지를 확인한 뒤 내비게이션으로 이어가도록 합니다.
   appUrl=`kakaomap://search?q=${q}`;fallback=`https://map.kakao.com/link/search/${q}`;
   alert('카카오내비는 웹페이지에서 주소만 넘겨 바로 길안내를 시작하는 공식 URL Scheme을 제공하지 않습니다. 같은 주소를 카카오 지도 검색으로 열어 목적지를 확인한 뒤 내비게이션을 선택해 주세요.');
 }
 openWithFallback(appUrl,fallback);
}

async function profileFor(user){const{data,error}=await sb.from('pjt_profiles').select('*').eq('id',user.id).maybeSingle();if(error)throw error;return data}
async function boot(){const{data:{session}}=await sb.auth.getSession();if(!session)return showLogin();const p=await profileFor(session.user);if(!p?.approved||!p.can_use_staff_portal){await sb.auth.signOut();showLogin();notify($('loginMsg'),'사용이 승인되지 않은 계정입니다. 관리자에게 문의하세요.');return}me=p;applyDisplayFieldPreference(p);showApp()}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
function activePageStorageKey(){return `staff_active_page:${me?.id||'guest'}`}
function pageAllowed(name){
 if(name==='search')return can('can_view_staff_sites');
 if(name==='unwritten')return isAdmin();
 if(name==='sales')return isAdmin()&&can('can_view_staff_sales');
 if(name==='users')return isAdmin()&&can('can_manage_staff_users');
 return false;
}
function defaultPage(){return can('can_view_staff_sites')?'search':isAdmin()?'unwritten':can('can_view_staff_sales')?'sales':'users'}
function savedPage(){
 try{const name=localStorage.getItem(activePageStorageKey());if(name&&pageAllowed(name))return name}catch(e){}
 return defaultPage();
}
function rememberPage(name){try{if(me&&pageAllowed(name))localStorage.setItem(activePageStorageKey(),name)}catch(e){}}
function showApp(){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('userBadge').textContent=`${me.name||me.user_id||''} · ${isAdmin()?'관리자':'일반 사용자'}`;$('unwrittenNav')?.classList.toggle('hidden',!isAdmin());$('salesNav').classList.toggle('hidden',!(isAdmin()&&can('can_view_staff_sales')));$('usersNav').classList.toggle('hidden',!(isAdmin()&&can('can_manage_staff_users')));$('dbImportBtn')?.classList.toggle('hidden',!(isAdmin()&&can('can_import_staff_sites')));$('dbDeleteAllBtn')?.classList.toggle('hidden',!isAdmin());$('allSitesExportBtn')?.classList.toggle('hidden',!canExportAllSites());$('siteCreateBtn')?.classList.toggle('hidden',!canCreateSite());showPage(savedPage(),false);refreshDbStatus();if(can('can_view_staff_sites'))searchSites()}
async function login(){
  const raw=$('loginId').value.trim(),pw=$('loginPw').value;
  if(!raw||!pw)return notify($('loginMsg'),'ID와 비밀번호를 입력하세요.');
  notify($('loginMsg'),'로그인 확인 중...',true);
  try{
    let user=null;
    if(raw.includes('@')){
      const{data,error}=await sb.auth.signInWithPassword({email:raw,password:pw});
      if(error)throw new Error('ID 또는 비밀번호가 올바르지 않습니다.');
      user=data.user;
    }else{
      const res=await fetch(`${cfg.supabaseUrl}/functions/v1/${cfg.loginFunction||'staff-id-login'}`,{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':cfg.supabaseKey},
        body:JSON.stringify({employee_id:raw,password:pw})
      });
      const out=await res.json().catch(()=>({}));
      if(!res.ok||!out?.access_token||!out?.refresh_token)throw new Error(out?.error||'ID 또는 비밀번호가 올바르지 않습니다.');
      const{data,error}=await sb.auth.setSession({access_token:out.access_token,refresh_token:out.refresh_token});
      if(error||!data?.user)throw new Error('로그인 세션을 만들지 못했습니다.');
      user=data.user;
    }
    const p=await profileFor(user);
    if(!p?.approved||!p.can_use_staff_portal){await sb.auth.signOut();return notify($('loginMsg'),'회사 직원 승인 또는 사내포털 사용권한이 없습니다.');}
    me=p;applyDisplayFieldPreference(p);showApp();
  }catch(error){
    await sb.auth.signOut().catch(()=>{});
    notify($('loginMsg'),error?.message||'로그인에 실패했습니다. ID와 비밀번호를 확인하세요.');
  }
}
function showPage(name,save=true){if(name==='search'&&!can('can_view_staff_sites'))return alert('현장 검색 권한이 없습니다.');if(name==='unwritten'&&!isAdmin())return alert('보고서 미작성 대시보드는 관리자만 사용할 수 있습니다.');if(name==='sales'&&!(isAdmin()&&can('can_view_staff_sales')))return alert('매출 관리는 관리자만 사용할 수 있습니다.');if(name==='users'&&!(isAdmin()&&can('can_manage_staff_users')))return alert('사용자 관리는 관리자만 사용할 수 있습니다.');document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.querySelectorAll('#mainNav button').forEach(x=>x.classList.toggle('active',x.dataset.page===name));$('page-'+name).classList.add('active');if(save)rememberPage(name);if(name==='unwritten')loadUnwrittenDashboard();if(name==='sales')loadSales();if(name==='users')loadUsers()}
async function refreshDbStatus(){if(!me)return;try{const{count,error}=await sb.from('staff_site_search').select('*',{count:'exact',head:true});if(error)throw error;const el=$('dbStatus');if((count||0)>0){el.className='statusBanner ok';el.innerHTML=`<strong>현장 DB ${Number(count).toLocaleString()}건</strong>이 서버에 저장되어 있습니다. 승인된 직원은 PC와 휴대폰에서 동일한 자료를 조회합니다.`}else{el.className='statusBanner warn';el.innerHTML=`<strong>현장 DB가 비어 있습니다.</strong> 관리자 계정에서 [전체 DB 엑셀 갱신]으로 현장 Excel을 등록하거나 [현장 직접등록]을 이용하세요.`}}catch(e){$('dbStatus').className='statusBanner warn';$('dbStatus').textContent='DB 상태 확인 실패: '+e.message}}
async function fetchPaged(table,select='*',mutator=null){let from=0,all=[];const size=1000;for(;;){let q=sb.from(table).select(select).range(from,from+size-1);if(mutator)q=mutator(q);const{data,error}=await q;if(error)throw error;all.push(...(data||[]));if(!data||data.length<size)break;from+=size}return all}
async function searchSites(){if(!can('can_view_staff_sites'))return;const q=$('siteQuery').value.trim();$('searchMeta').textContent='검색 중...';try{const rows=await fetchPaged('staff_site_search','*',query=>{query=query.order('excel_row',{ascending:true});if(q){const s=q.replace(/[%_,()]/g,' ').trim();query=query.or(`site_name.ilike.%${s}%,previous_name.ilike.%${s}%,region.ilike.%${s}%,sn.ilike.%${s}%,document_owner.ilike.%${s}%,field_inspector.ilike.%${s}%`)}return query});lastSites=rows.filter(filterOk);selectedSiteIds.clear();$('searchMeta').textContent=`검색 ${rows.length.toLocaleString()}건 · 현재 조건 ${lastSites.length.toLocaleString()}건`;renderSites()}catch(e){$('searchMeta').textContent='검색 오류: '+e.message;$('siteResults').innerHTML=''}}
function siteStatusLabel(r){const s=statusOf(r);return s==='complete'?'보고서 완료':s==='unwritten'?'보고서 미작성':s==='checking'?'점검 진행 중':s==='target'?'점검대상':'전체 진행 중'}

const SITE_LIST_SPECIAL_COLUMNS={
 no:{key:'no',label:'No.',sortable:false},
 actions:{key:'actions',label:'관리',sortable:false}
};
function displayFieldKey(field){return `field_${field.col}`}
function activeSiteListColumns(){
 const dynamic=displayFields.map(label=>schema.fields.find(f=>f.label===label)).filter(Boolean).map(f=>({key:displayFieldKey(f),label:f.label,sortable:true,field:f}));
 return [SITE_LIST_SPECIAL_COLUMNS.no,...dynamic,SITE_LIST_SPECIAL_COLUMNS.actions];
}
function activeSiteListKeys(){return activeSiteListColumns().map(c=>c.key)}
function siteListOrderStorageKey(){return `staff_site_list_column_order:${me?.id||'guest'}`}
let siteListColumnOrder=[];
let siteListSort={key:null,dir:'asc'};
let suppressSiteSortClick=false;
const siteListCollator=new Intl.Collator('ko-KR',{numeric:true,sensitivity:'base'});
function ensureSiteListColumnOrder(){
 const valid=activeSiteListKeys(),dynamic=valid.filter(k=>k!=='no'&&k!=='actions');
 if(!siteListColumnOrder.length){
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(siteListOrderStorageKey())||localStorage.getItem('staff_site_list_column_order')||'null')}catch(e){}
  // V21의 고정열 저장값(sn/site_name 등)은 V22 동적열과 호환되지 않으므로 처음 한 번은 기본 순서를 사용합니다.
  if(Array.isArray(saved)&&saved.some(k=>String(k).startsWith('field_')))siteListColumnOrder=saved.filter(k=>valid.includes(k));
  else siteListColumnOrder=[];
 }
 let next=siteListColumnOrder.filter(k=>valid.includes(k));
 if(!next.includes('no'))next.unshift('no');
 const missing=dynamic.filter(k=>!next.includes(k));
 const actionIndex=next.indexOf('actions');
 if(actionIndex>=0)next.splice(actionIndex,0,...missing);else next.push(...missing);
 if(!next.includes('actions'))next.push('actions');
 siteListColumnOrder=next;
 if(siteListSort.key&&!valid.includes(siteListSort.key))siteListSort={key:null,dir:'asc'};
 return siteListColumnOrder;
}
function siteListColumn(key){
 if(key==='no'||key==='actions')return SITE_LIST_SPECIAL_COLUMNS[key];
 if(String(key).startsWith('field_')){
  const col=Number(String(key).slice(6)),field=schema.fields.find(f=>Number(f.col)===col);
  if(field)return{key,label:field.label,sortable:true,field};
 }
 return SITE_LIST_SPECIAL_COLUMNS.no;
}
function siteFieldDisplayValue(r,field){
 const raw=r?.safe_values?.[field.col-1]??'';
 return normalizeCell(raw,field.col);
}
function siteListSortValue(r,key){
 const c=siteListColumn(key);
 return c.field?siteFieldDisplayValue(r,c.field):'';
}
function compareSiteListValues(a,b){
 const as=String(a??'').trim(),bs=String(b??'').trim();
 const an=Number(as.replace(/,/g,'')),bn=Number(bs.replace(/,/g,''));
 if(as!==''&&bs!==''&&Number.isFinite(an)&&Number.isFinite(bn))return an-bn;
 return siteListCollator.compare(as,bs);
}
function sortedSiteRows(rows){
 if(!siteListSort.key)return rows;
 const dir=siteListSort.dir==='desc'?-1:1,key=siteListSort.key;
 return [...rows].sort((a,b)=>{
  const cmp=compareSiteListValues(siteListSortValue(a,key),siteListSortValue(b,key));
  if(cmp)return cmp*dir;
  return (Number(a.excel_row||0)-Number(b.excel_row||0))||((Number(a.source_id||0)-Number(b.source_id||0)));
 });
}
function toggleSiteListSort(key){
 const col=siteListColumn(key);if(!col.sortable)return;
 if(siteListSort.key===key)siteListSort.dir=siteListSort.dir==='asc'?'desc':'asc';
 else siteListSort={key,dir:'asc'};
 renderSites();
}
function moveSiteListColumn(dragKey,targetKey,placeAfter=false){
 ensureSiteListColumnOrder();
 if(!dragKey||!targetKey||dragKey===targetKey)return;
 const next=siteListColumnOrder.filter(k=>k!==dragKey),idx=next.indexOf(targetKey);
 if(idx<0)return;
 next.splice(idx+(placeAfter?1:0),0,dragKey);
 siteListColumnOrder=next;
 try{localStorage.setItem(siteListOrderStorageKey(),JSON.stringify(siteListColumnOrder))}catch(e){}
 renderSites();
}
function siteListHeaderHtml(key){
 const c=siteListColumn(key),active=siteListSort.key===key,arrow=active?(siteListSort.dir==='asc'?' ▲':' ▼'):'';
 return `<th class="col-dynamic ${c.sortable?'sortableHeader':''} ${active?'sortActive':''}" data-col-key="${key}" data-sortable="${c.sortable?'1':'0'}" draggable="true" title="${c.sortable?'클릭: 정렬 · ':''}드래그: 열 이동"><span>${esc(c.label)}${arrow}</span></th>`;
}
function siteListCellHtml(r,key,index){
 if(key==='no')return `<td class="center col-no">${index+1}</td>`;
 if(key==='actions'){
  const edit=canEditSite()?`<button class="primary smallBtn desktopEditBtn" data-site-edit="${r.source_id}">수정</button>`:'';
  return `<td class="center rowActions col-actions">${edit}<button class="smallBtn" data-detail-btn="${r.source_id}">상세</button></td>`;
 }
 const c=siteListColumn(key),v=c.field?siteFieldDisplayValue(r,c.field):'';
 const isSite=c.field?.label==='현장명';
 return `<td class="col-dynamic ${isSite?'siteNameCell':''}">${isSite?`<strong>${esc(v||'-')}</strong>`:esc(v||'-')}</td>`;
}
function bindSiteListHeaderInteractions(root){
 let dragKey=null;
 const clearMarks=()=>root.querySelectorAll('.desktopSiteTable th').forEach(x=>x.classList.remove('dragging','dragBefore','dragAfter'));
 root.querySelectorAll('.desktopSiteTable th[data-col-key]').forEach(th=>{
  th.addEventListener('click',()=>{if(suppressSiteSortClick)return;toggleSiteListSort(th.dataset.colKey)});
  th.addEventListener('dragstart',e=>{
   dragKey=th.dataset.colKey;th.classList.add('dragging');suppressSiteSortClick=true;
   if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragKey)}
  });
  th.addEventListener('dragover',e=>{
   if(!dragKey||dragKey===th.dataset.colKey)return;e.preventDefault();clearMarks();
   const rect=th.getBoundingClientRect(),after=e.clientX>rect.left+rect.width/2;
   th.classList.add(after?'dragAfter':'dragBefore');
   if(e.dataTransfer)e.dataTransfer.dropEffect='move';
  });
  th.addEventListener('dragleave',()=>th.classList.remove('dragBefore','dragAfter'));
  th.addEventListener('drop',e=>{
   e.preventDefault();const target=th.dataset.colKey,rect=th.getBoundingClientRect(),after=e.clientX>rect.left+rect.width/2;
   clearMarks();const from=dragKey;dragKey=null;setTimeout(()=>{suppressSiteSortClick=false},120);moveSiteListColumn(from,target,after);
  });
  th.addEventListener('dragend',()=>{clearMarks();dragKey=null;setTimeout(()=>{suppressSiteSortClick=false},120)});
 });
}
function siteSelectionBarHtml(visibleRows){
 if(!isAdmin())return '';
 const visibleIds=visibleRows.map(r=>Number(r.source_id)).filter(Number.isFinite);
 const selectedVisible=visibleIds.filter(id=>selectedSiteIds.has(id)).length;
 return `<div class="siteSelectionBar" data-visible-ids="${visibleIds.join(',')}"><div class="siteSelectionButtons"><button type="button" class="ghost" data-site-select-all>전체선택</button><button type="button" class="ghost" data-site-select-none>선택해제</button><button type="button" class="danger" data-site-delete-selected ${selectedSiteIds.size?'':'disabled'}>선택 삭제</button></div><strong class="siteSelectedCount">선택 ${selectedSiteIds.size.toLocaleString()}건${selectedVisible!==selectedSiteIds.size?` · 현재 화면 ${selectedVisible.toLocaleString()}건`:''}</strong></div>`;
}
function syncSiteSelectionUi(root,visibleRows){
 if(!isAdmin())return;
 const ids=visibleRows.map(r=>Number(r.source_id)).filter(Number.isFinite);
 root.querySelectorAll('.siteRowCheck,.siteCardCheck').forEach(ch=>{ch.checked=selectedSiteIds.has(Number(ch.dataset.siteSelect))});
 const master=root.querySelector('[data-site-select-master]');
 if(master){const picked=ids.filter(id=>selectedSiteIds.has(id)).length;master.checked=ids.length>0&&picked===ids.length;master.indeterminate=picked>0&&picked<ids.length}
 root.querySelectorAll('.siteSelectedCount').forEach(el=>el.textContent=`선택 ${selectedSiteIds.size.toLocaleString()}건`);
 root.querySelectorAll('[data-site-delete-selected]').forEach(b=>b.disabled=!selectedSiteIds.size);
}
function bindSiteSelectionControls(root,visibleRows){
 if(!isAdmin())return;
 const ids=visibleRows.map(r=>Number(r.source_id)).filter(Number.isFinite);
 root.querySelectorAll('.siteRowCheck,.siteCardCheck').forEach(ch=>ch.onchange=e=>{e.stopPropagation();const id=Number(ch.dataset.siteSelect);if(ch.checked)selectedSiteIds.add(id);else selectedSiteIds.delete(id);syncSiteSelectionUi(root,visibleRows)});
 const master=root.querySelector('[data-site-select-master]');if(master)master.onchange=e=>{e.stopPropagation();ids.forEach(id=>master.checked?selectedSiteIds.add(id):selectedSiteIds.delete(id));syncSiteSelectionUi(root,visibleRows)};
 root.querySelectorAll('[data-site-select-all]').forEach(b=>b.onclick=()=>{ids.forEach(id=>selectedSiteIds.add(id));syncSiteSelectionUi(root,visibleRows)});
 root.querySelectorAll('[data-site-select-none]').forEach(b=>b.onclick=()=>{selectedSiteIds.clear();syncSiteSelectionUi(root,visibleRows)});
 root.querySelectorAll('[data-site-delete-selected]').forEach(b=>b.onclick=deleteSelectedSites);
 syncSiteSelectionUi(root,visibleRows);
}
async function deleteSelectedSites(){
 if(!isAdmin())return alert('선택 삭제는 관리자만 사용할 수 있습니다.');
 const ids=[...selectedSiteIds].map(Number).filter(Number.isFinite);
 if(!ids.length)return alert('삭제할 현장을 선택해 주세요.');
 const names=lastSites.filter(r=>selectedSiteIds.has(Number(r.source_id))).slice(0,5).map(r=>r.site_name).filter(Boolean);
 const preview=names.length?`\n\n선택 예시: ${names.join(', ')}${ids.length>names.length?' 외 '+(ids.length-names.length)+'건':''}`:'';
 if(!confirm(`선택한 ${ids.length.toLocaleString()}개 현장을 삭제하시겠습니까?${preview}\n\n삭제된 현장정보는 복구하기 어렵습니다.`))return;
 try{
  const{data,error}=await sb.rpc('staff_delete_selected_sites',{p_ids:ids});if(error)throw error;
  const deleted=Number(data?.deleted||0);selectedSiteIds.clear();
  await Promise.all([refreshDbStatus(),searchSites(),loadSales()]);
  alert(`${deleted.toLocaleString()}개 현장을 삭제했습니다.`);
 }catch(e){alert('선택 현장 삭제 오류: '+(e?.message||e))}
}
function renderSites(){
 const root=$('siteResults');
 if(!lastSites.length){selectedSiteIds.clear();root.innerHTML='<div class="siteCard">검색 결과가 없습니다.</div>';return}
 const desktop=window.matchMedia('(min-width: 801px)').matches;
 if(desktop){
   ensureSiteListColumnOrder();
   const sorted=sortedSiteRows(lastSites),visible=sorted.slice(0,600);
   const selectHead=isAdmin()?'<th class="center siteSelectCol"><input type="checkbox" data-site-select-master aria-label="현재 표시된 현장 전체선택"></th>':'';
   const rows=visible.map((r,i)=>`<tr class="siteListRow" data-detail="${r.source_id}" tabindex="0" aria-label="${esc(r.site_name)} 상세조회">${isAdmin()?`<td class="center siteSelectCol"><input type="checkbox" class="siteRowCheck" data-site-select="${r.source_id}" aria-label="${esc(r.site_name)} 선택"></td>`:''}${siteListColumnOrder.map(key=>siteListCellHtml(r,key,i)).join('')}</tr>`).join('');
   const headers=siteListColumnOrder.map(siteListHeaderHtml).join('');
   root.innerHTML=`<div class="desktopSiteList">${siteSelectionBarHtml(visible)}<div class="desktopListHint"><strong>정렬:</strong> 제목 클릭 · <strong>열 이동:</strong> 제목을 마우스로 잡아 왼쪽/오른쪽으로 드래그하세요. 열 순서는 자동 저장됩니다.</div><div class="desktopSiteTableWrap"><table class="desktopSiteTable"><thead><tr>${selectHead}${headers}</tr></thead><tbody>${rows}</tbody></table></div></div>${lastSites.length>600?'<div class="listLimitNotice">화면 성능을 위해 정렬된 결과 중 처음 600건만 표시합니다. 전체선택은 현재 표시된 행을 대상으로 합니다.</div>':''}`;
   bindSiteListHeaderInteractions(root);
   root.querySelectorAll('.siteListRow').forEach(tr=>{
     tr.onclick=e=>{if(e.target.closest('button,a,input,select,th'))return;openDetail(Number(tr.dataset.detail))};
     tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){if(e.target.closest('input,button'))return;e.preventDefault();openDetail(Number(tr.dataset.detail))}};
   });
   root.querySelectorAll('[data-detail-btn]').forEach(b=>b.onclick=e=>{e.stopPropagation();openDetail(Number(b.dataset.detailBtn))});
   root.querySelectorAll('[data-site-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openSiteEditor(Number(b.dataset.siteEdit))});
   bindSiteSelectionControls(root,visible);
   return;
 }
 const visible=lastSites.slice(0,600);
 root.innerHTML=siteSelectionBarHtml(visible)+visible.map(r=>{
  const fieldsHtml=displayFields.map(f=>{const meta=schema.fields.find(x=>x.label===f),v=meta?normalizeCell(r.safe_values?.[meta.col-1]??'',meta.col):val(r,f);return `<div><span>${esc(f)}</span><b>${esc(v||'-')}</b></div>`}).join('');
  const p1=r.field_plan_start?'done':'',p2=r.field_end?'done':(r.field_plan_start?'working':''),p3=r.report_complete_date?'done':(r.field_end?'working':'');
  const manual=Number(r.excel_row)<0?'<span class="tag directTag">직접등록</span>':'';
  const edit=canEditSite()?`<button class="primary smallBtn" data-site-edit="${r.source_id}">수정</button>`:'';
  const select=isAdmin()?`<label class="mobileSiteSelect"><input type="checkbox" class="siteCardCheck" data-site-select="${r.source_id}"> 선택</label>`:'';
  return `<article class="siteCard"><div class="siteSelectionMeta">${select}<span>${manual}</span></div><div class="miniGrid selectedFieldsGrid">${fieldsHtml}</div><div class="stepRow"><div class="step ${p1}">점검계획</div><div class="step ${p2}">현장점검</div><div class="step ${p3}">보고서</div></div><div class="siteActions">${edit}<button data-detail="${r.source_id}">상세 조회</button></div></article>`
 }).join('')+(lastSites.length>600?`<div class="siteCard">화면 성능을 위해 처음 600건만 표시합니다. 전체선택은 현재 표시된 카드만 대상으로 합니다.</div>`:'');
 root.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(Number(b.dataset.detail)));
 root.querySelectorAll('[data-site-edit]').forEach(b=>b.onclick=()=>openSiteEditor(Number(b.dataset.siteEdit)));
 bindSiteSelectionControls(root,visible);
}
const groups=[['기본정보',1,18],['진행·담당·계약',19,45],['유지관리 전체수량',55,82],['성능점검 대상수량',83,110],['성능점검 확정수량',111,137]];
async function openDetail(id){let r=lastSites.find(x=>Number(x.source_id)===Number(id));if(!r){const{data,error}=await sb.from('staff_site_search').select('*').eq('source_id',Number(id)).maybeSingle();if(error)return alert('현장 정보를 불러오지 못했습니다: '+error.message);r=data;if(r)lastSites.push(r)}if(!r)return;$('detailTitle').textContent=r.site_name;const tabs=$('detailTabs');tabs.innerHTML=groups.map((g,i)=>`<button class="chip ${i===0?'active':''}" data-g="${i}">${g[0]}</button>`).join('');const render=i=>{const[,a,b]=groups[i];const fields=schema.fields.filter(f=>f.col>=a&&f.col<=b&&!f.financial&&f.label!=='관리주체 연락처/이메일');const editBar=canEditSite()?`<div class="detailEditBar"><button class="primary smallBtn" data-detail-site-edit="${r.source_id}">현장 정보 수정</button></div>`:'';$('detailBody').innerHTML=editBar+(i===0||i===1?contactCards(r):'')+fields.map(f=>`<div class="detailItem"><span>${esc(f.label)}</span><b>${esc(normalizeCell(r.safe_values?.[f.col-1]??'-',f.col))}</b></div>`).join('');bindContactActions(r);const eb=$('detailBody').querySelector('[data-detail-site-edit]');if(eb)eb.onclick=()=>{$('detailDlg').close();openSiteEditor(Number(eb.dataset.detailSiteEdit))};tabs.querySelectorAll('[data-g]').forEach(x=>x.classList.toggle('active',Number(x.dataset.g)===i))};tabs.querySelectorAll('[data-g]').forEach(x=>x.onclick=()=>render(Number(x.dataset.g)));render(0);$('detailDlg').showModal()}

const siteEditGroups=[['기본정보',1,18],['진행·담당·계약',19,45],['금액·문서번호',46,54],['유지관리 전체수량',55,81],['성능점검 대상수량',83,109],['성능점검 확정수량',111,137]];
let siteEditMode='create',siteEditValues=Array(137).fill(''),siteEditRow=null,siteEditGroupIndex=0,siteAddressMode='search';
let siteNameSuggestTimer=null,siteNameSuggestRequest=0,siteNameSuggestions=[];
function siteFieldAllowed(f){if(!f?.label?.trim())return false;if(f.label==='관리주체 연락처/이메일')return false;if(f.financial&&!isAdmin())return false;return true}
function siteInputType(col){return dateCols.has(col)?'date':'text'}
function renderSiteEditTabs(){const root=$('siteEditTabs');root.innerHTML=siteEditGroups.map((g,i)=>{const has= schema.fields.some(f=>f.col>=g[1]&&f.col<=g[2]&&siteFieldAllowed(f));return has?`<button type="button" class="chip ${i===siteEditGroupIndex?'active':''}" data-site-group="${i}">${g[0]}</button>`:''}).join('');root.querySelectorAll('[data-site-group]').forEach(b=>b.onclick=()=>{siteEditGroupIndex=Number(b.dataset.siteGroup);renderSiteEditFields();renderSiteEditTabs()})}
function renderSiteEditFields(){
 const g=siteEditGroups[siteEditGroupIndex]||siteEditGroups[0];
 const fields=schema.fields.filter(f=>f.col>=g[1]&&f.col<=g[2]&&siteFieldAllowed(f));
 $('siteEditFields').innerHTML=fields.map(f=>{
  const v=normalizeCell(siteEditValues[f.col-1]??'',f.col),req=f.col===4?' required':'',fin=f.financial?' financialField':'';
  if(f.col===1&&siteEditMode==='create')return `<label class="siteField${fin}"><span>${esc(f.label)}</span><div class="siteSnInputRow"><input data-site-col="1" type="text" value="${esc(v)}"><button type="button" class="ghost smallBtn" id="applyNextSnBtn">다음 S/N 적용</button></div><small class="fieldHelp">신규등록 시 현재 DB의 마지막 숫자형 S/N 다음 번호를 자동 표시합니다.</small></label>`;
  if(f.col===4&&siteEditMode==='create')return `<label class="siteField siteNameLookupField${fin}"><span>${esc(f.label)} *</span><div class="siteNameLookupWrap"><input data-site-col="4" id="siteNameLookupInput" type="text" value="${esc(v)}" required autocomplete="off" placeholder="현장명 일부를 입력하면 기존 현장을 검색합니다"><div id="siteNameSuggestions" class="siteNameSuggestions hidden"></div></div><small class="fieldHelp">기존 현장을 선택하면 S/N을 포함한 등록정보를 복사합니다. 복사 후 원하는 항목을 수정해 새 현장으로 저장할 수 있습니다.</small></label>`;
  return `<label class="siteField${fin}"><span>${esc(f.label)}${f.col===4?' *':''}</span><input data-site-col="${f.col}" type="${siteInputType(f.col)}" value="${esc(v)}"${req}></label>`;
 }).join('')||'<p class="hint">이 탭에서 입력할 수 있는 항목이 없습니다.</p>';
 $('siteEditFields').querySelectorAll('[data-site-col]').forEach(inp=>inp.oninput=()=>{
  siteEditValues[Number(inp.dataset.siteCol)-1]=inp.value;
  if(siteEditMode==='create'&&Number(inp.dataset.siteCol)===4)scheduleSiteNameSuggestions(inp.value);
 });
 const nextBtn=$('applyNextSnBtn');if(nextBtn)nextBtn.onclick=()=>applyNextSiteSn(true);
 const nameInput=$('siteNameLookupInput');if(nameInput){
  nameInput.onfocus=()=>{if(String(nameInput.value||'').trim())scheduleSiteNameSuggestions(nameInput.value,true)};
  nameInput.onblur=()=>setTimeout(hideSiteNameSuggestions,180);
 }
}
async function applyNextSiteSn(force=false){
 if(siteEditMode!=='create'||!canCreateSite())return;
 try{
  const{data,error}=await sb.rpc('staff_next_site_sn');if(error)throw error;
  if(force||!String(siteEditValues[0]||'').trim())siteEditValues[0]=String(data||'');
  const inp=$('siteEditFields')?.querySelector('[data-site-col="1"]');if(inp)inp.value=siteEditValues[0]||'';
  if(force)notify($('siteEditMsg'),`다음 S/N ${siteEditValues[0]}을 적용했습니다.`,true);
 }catch(e){if(force)notify($('siteEditMsg'),'다음 S/N 조회 실패: '+e.message)}
}
function hideSiteNameSuggestions(){const box=$('siteNameSuggestions');if(box)box.classList.add('hidden')}
function scheduleSiteNameSuggestions(value,immediate=false){
 clearTimeout(siteNameSuggestTimer);const q=String(value||'').trim();
 if(!q){hideSiteNameSuggestions();return}
 siteNameSuggestTimer=setTimeout(()=>searchSiteNameSuggestions(q),immediate?0:250);
}
async function searchSiteNameSuggestions(term){
 if(siteEditMode!=='create'||!canCreateSite())return;
 const seq=++siteNameSuggestRequest,box=$('siteNameSuggestions');if(!box)return;
 box.classList.remove('hidden');box.innerHTML='<div class="siteSuggestionState">검색 중...</div>';
 try{
  const q=String(term||'').replace(/[%_(),]/g,' ').trim();if(!q)return hideSiteNameSuggestions();
  const{data,error}=await sb.from('staff_site_search').select('source_id,site_name,sn,region,report_grade,excel_row').ilike('site_name',`%${q}%`).order('site_name',{ascending:true}).limit(20);
  if(error)throw error;if(seq!==siteNameSuggestRequest)return;
  siteNameSuggestions=data||[];
  if(!siteNameSuggestions.length){box.innerHTML='<div class="siteSuggestionState">일치하는 기존 현장이 없습니다. 새 현장명으로 계속 입력하세요.</div>';return}
  box.innerHTML=siteNameSuggestions.map(r=>`<button type="button" class="siteSuggestionItem" data-template-source="${Number(r.source_id)}"><strong>${esc(r.site_name||'-')}</strong><span>S/N ${esc(r.sn||'-')} · ${esc(r.region||'지역 없음')} · ${esc(r.report_grade||'등급 없음')}</span></button>`).join('');
  box.querySelectorAll('[data-template-source]').forEach(b=>b.onmousedown=e=>e.preventDefault());
  box.querySelectorAll('[data-template-source]').forEach(b=>b.onclick=()=>applySiteTemplate(Number(b.dataset.templateSource)));
 }catch(e){if(seq===siteNameSuggestRequest)box.innerHTML=`<div class="siteSuggestionState">현장명 검색 오류: ${esc(e.message)}</div>`}
}
async function applySiteTemplate(sourceId){
 if(siteEditMode!=='create'||!canCreateSite())return;
 try{
  notify($('siteEditMsg'),'선택한 현장정보를 불러오는 중...',true);
  const{data,error}=await sb.rpc('staff_site_template',{p_source_id:Number(sourceId)});if(error)throw error;
  let vals=Array.isArray(data?.values)?[...data.values]:Array(137).fill('');while(vals.length<137)vals.push('');
  siteEditValues=vals.slice(0,137).map((v,i)=>normalizeCell(v,i+1));
  $('siteFormPhone').value=formatPhoneList(data?.client_phone||'');$('siteFormEmail').value=data?.client_email||'';$('siteFormAddress').value=data?.site_address||'';$('siteAddressQuery').value=data?.site_address||'';$('siteFormAddressDetail').value='';setSiteAddressMode('search');
  hideSiteNameSuggestions();renderSiteEditTabs();renderSiteEditFields();
  $('siteEditHint').textContent=`기존 현장 “${data?.site_name||''}” 정보를 복사했습니다. S/N을 포함해 필요한 항목을 수정한 뒤 저장하면 새 현장으로 추가됩니다.`;
  notify($('siteEditMsg'),'기존 현장정보를 복사했습니다. 필요한 내용을 수정한 뒤 저장하세요.',true);
 }catch(e){notify($('siteEditMsg'),'기존 현장정보 불러오기 실패: '+e.message)}
}
function setSiteAddressMode(mode){siteAddressMode=mode==='manual'?'manual':'search';const manual=siteAddressMode==='manual',addr=$('siteFormAddress');addr.readOnly=!manual;$('siteAddressQuery').closest('label')?.classList.toggle('hidden',manual);$('siteAddressDetailLabel')?.classList.toggle('hidden',manual);$('siteManualAddressBtn')?.classList.toggle('hidden',manual);$('siteSearchAddressModeBtn')?.classList.toggle('hidden',!manual);addr.placeholder=manual?'주소를 직접 입력하세요':'주소 검색 결과를 선택하세요';if(manual){$('siteFormAddressDetail').value='';addr.focus();notify($('siteAddressMsg'),'')}}
function searchSiteAddress(){const q=String($('siteAddressQuery').value||'').trim();if(!(window.kakao&&window.kakao.Postcode)){setSiteAddressMode('manual');notify($('siteAddressMsg'),'주소 검색 서비스를 불러오지 못했습니다. 직접입력으로 전환했습니다.');return}let had=true;new window.kakao.Postcode({onsearch:data=>{had=Number(data?.count||0)>0;notify($('siteAddressMsg'),had?`검색 결과 ${Number(data.count).toLocaleString()}건입니다. 주소를 선택하세요.`:'검색 결과가 없습니다. 검색어를 바꾸거나 직접입력을 선택하세요.',had)},oncomplete:data=>{const a=(data.userSelectedType==='R'?data.roadAddress:data.jibunAddress)||data.roadAddress||data.jibunAddress||data.address||'';$('siteFormAddress').value=a;$('siteAddressQuery').value=a;$('siteFormAddressDetail').value='';notify($('siteAddressMsg'),'주소가 선택되었습니다. 필요한 경우 상세주소를 입력하세요.',true);$('siteFormAddressDetail').focus()},onclose:()=>{if(!had)notify($('siteAddressMsg'),'검색 결과가 없었습니다. 직접입력을 선택할 수 있습니다.')}}).open({q,popupTitle:'현장 주소 검색',popupKey:'staff-site-edit-address'})}
function resetSiteEditor(){siteEditValues=Array(137).fill('');siteEditRow=null;siteEditGroupIndex=0;$('siteEditSourceId').value='';$('siteFormPhone').value='';$('siteFormEmail').value='';$('siteFormAddress').value='';$('siteFormAddressDetail').value='';$('siteAddressQuery').value='';setSiteAddressMode('search');notify($('siteAddressMsg'),'검색 결과에서 주소를 선택하거나, 검색되지 않으면 직접입력을 선택하세요.',true);notify($('siteEditMsg'),'')}
async function openCreateSite(){if(!canCreateSite())return alert('현장 직접등록 권한이 없습니다.');siteEditMode='create';resetSiteEditor();$('siteEditTitle').textContent='현장 직접등록';$('siteEditHint').textContent='S/N은 현재 DB의 마지막 숫자형 S/N 다음 번호가 자동 표시됩니다. 현장명을 입력하면 기존 현장을 검색해 복사할 수 있습니다.';$('siteFormPhone').disabled=false;$('siteFormEmail').disabled=false;$('siteFormAddress').disabled=false;await applyNextSiteSn(false);renderSiteEditTabs();renderSiteEditFields();$('siteEditDlg').showModal()}
async function openSiteEditor(id){if(!canEditSite())return alert('현장 수정 권한이 없습니다.');let r=lastSites.find(x=>Number(x.source_id)===Number(id));if(!r){const{data,error}=await sb.from('staff_site_search').select('*').eq('source_id',Number(id)).maybeSingle();if(error)return alert('수정할 현장을 불러오지 못했습니다: '+error.message);r=data;if(r)lastSites.push(r)}if(!r)return alert('수정할 현장을 찾을 수 없습니다.');siteEditMode='edit';resetSiteEditor();siteEditRow=r;$('siteEditSourceId').value=String(id);let vals=Array.isArray(r.safe_values)?[...r.safe_values]:Array(137).fill('');if(isAdmin()){const{data,error}=await sb.from('staff_site_source').select('full_values,client_phone,client_email,site_address').eq('id',id).maybeSingle();if(error)return alert('현장 원본을 불러오지 못했습니다: '+error.message);if(Array.isArray(data?.full_values))vals=[...data.full_values];Object.assign(r,{client_phone:data?.client_phone??r.client_phone,client_email:data?.client_email??r.client_email,site_address:data?.site_address??r.site_address})}while(vals.length<137)vals.push('');siteEditValues=vals.slice(0,137).map((v,i)=>normalizeCell(v,i+1));$('siteEditTitle').textContent='현장 정보 수정';$('siteEditHint').textContent=isAdmin()?'관리자는 전체 현장정보를 수정할 수 있습니다.':'부여된 수정권한으로 비금액 현장정보를 수정할 수 있습니다. 전화번호 변경은 관리자만 가능합니다.';$('siteFormPhone').value=formatPhoneList(r.client_phone||'');$('siteFormPhone').disabled=!isAdmin();$('siteFormEmail').value=r.client_email||'';$('siteFormAddress').value=r.site_address||'';$('siteAddressQuery').value=r.site_address||'';setSiteAddressMode('search');renderSiteEditTabs();renderSiteEditFields();$('siteEditDlg').showModal()}
function sitePayload(){const base=String($('siteFormAddress').value||'').trim(),detail=siteAddressMode==='manual'?'':String($('siteFormAddressDetail').value||'').trim();return{values:siteEditValues,client_phone:normalizePhoneList($('siteFormPhone').value||''),client_email:String($('siteFormEmail').value||'').trim(),site_address:[base,detail].filter(Boolean).join(' ').trim()}}
async function saveSiteEdit(e){e.preventDefault();siteEditValues[3]=String(siteEditValues[3]||'').trim();if(!siteEditValues[3]){siteEditGroupIndex=0;renderSiteEditTabs();renderSiteEditFields();return notify($('siteEditMsg'),'현장명을 입력하세요.')}const payload=sitePayload();notify($('siteEditMsg'),'저장 중...',true);try{if(siteEditMode==='create'){if(!canCreateSite())throw new Error('현장 직접등록 권한이 없습니다.');const{data,error}=await sb.rpc('staff_create_site',{p_data:payload});if(error)throw error;notify($('siteEditMsg'),`현장 등록이 완료되었습니다. (ID ${data})`,true)}else{if(!canEditSite())throw new Error('현장 수정 권한이 없습니다.');const id=Number($('siteEditSourceId').value);const{error}=await sb.rpc('staff_update_site',{p_source_id:id,p_data:payload});if(error)throw error;notify($('siteEditMsg'),'현장 수정이 완료되었습니다.',true)}setTimeout(()=>{$('siteEditDlg').close()},350);await Promise.all([refreshDbStatus(),searchSites()]);if($('page-unwritten')?.classList.contains('active')&&isAdmin())await loadUnwrittenDashboard();}catch(err){notify($('siteEditMsg'),'저장 실패: '+(err?.message||err))}}


function reportValue(r,col){return normalizeCell(r?.safe_values?.[col-1]??'',col)}
function normalizeReportOwnerName(raw){
 let name=String(raw??'').replace(/\u00a0/g,' ').trim();
 if(!name)return '미배정';
 // 담당자명 앞에 붙은 연도/회차/순번 숫자는 집계에서 무시합니다.
 // 예: 24김명철, 2025 김명철, 01-김명철, 1) 김명철 -> 김명철
 let prev='';
 while(name!==prev&&/^\s*\d/.test(name)){
   prev=name;
   name=name.replace(/^\s*\d+\s*(?:년(?:도)?|기|차|회)?\s*[-._/:()\[\]]*\s*/,'').trim();
 }
 name=name.replace(/\s+/g,' ').trim();
 return name||'미배정';
}
function reportOwnerName(r){return normalizeReportOwnerName(r?.document_owner||reportValue(r,19)||'')}
function parseLocalDate(v,col){v=normalizeCell(v,col);if(!v)return null;const s=String(v).trim();let m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);if(m){const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));return Number.isNaN(d.getTime())?null:d}if(/^\d+(\.\d+)?$/.test(s)){const x=excelDate(Number(s));if(x!==s)return parseLocalDate(x,col)}return null}
function elapsedFromReceipt(r){const d=parseLocalDate(reportValue(r,27),27);if(!d)return null;const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());return Math.max(0,Math.floor((today-d)/86400000))}
function elapsedClass(days){if(days===null)return'';if(days>=30)return'elapsedDanger';if(days>=14)return'elapsedWarn';if(days>=7)return'elapsedWatch';return'elapsedNormal'}
function isUnwrittenReport(r){return !!String(r?.field_end||reportValue(r,30)||'').trim()&&!String(r?.report_complete_date||reportValue(r,32)||'').trim()}
async function loadUnwrittenDashboard(){
 if(!isAdmin())return;
 const summary=$('unwrittenSummary'),owners=$('unwrittenOwners'),list=$('unwrittenList');
 if(summary)summary.innerHTML='<div class="dashLoading">미작성 현황을 불러오는 중...</div>';if(owners)owners.innerHTML='';if(list)list.innerHTML='';
 try{
  const rows=await fetchPaged('staff_site_search','source_id,excel_row,site_name,document_owner,field_end,field_inspector,report_complete_date,safe_values',q=>q.order('excel_row',{ascending:true}));
  unwrittenRows=rows.filter(isUnwrittenReport);
  const ownerMap=new Map();for(const r of unwrittenRows){const n=reportOwnerName(r);ownerMap.set(n,(ownerMap.get(n)||0)+1)}
  const ownerEntries=[...ownerMap.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko'));
  const over14=unwrittenRows.filter(r=>(elapsedFromReceipt(r)??-1)>=14).length,over30=unwrittenRows.filter(r=>(elapsedFromReceipt(r)??-1)>=30).length;
  summary.innerHTML=`<div class="unwrittenKpi"><span>전체 미작성</span><b>${unwrittenRows.length.toLocaleString()}건</b></div><div class="unwrittenKpi"><span>담당자</span><b>${ownerEntries.filter(([n])=>n!=='미배정').length.toLocaleString()}명</b></div><div class="unwrittenKpi warn"><span>파일접수 14일 이상</span><b>${over14.toLocaleString()}건</b></div><div class="unwrittenKpi danger"><span>파일접수 30일 이상</span><b>${over30.toLocaleString()}건</b></div>`;
  owners.innerHTML=`<button class="ownerCard ${unwrittenOwnerFilter==='all'?'active':''}" data-owner="all"><span>전체</span><b>${unwrittenRows.length.toLocaleString()}건</b></button>`+ownerEntries.map(([name,count])=>`<button class="ownerCard ${unwrittenOwnerFilter===name?'active':''}" data-owner="${esc(name)}"><span>${esc(name)}</span><b>${count.toLocaleString()}건</b></button>`).join('');
  owners.querySelectorAll('[data-owner]').forEach(b=>b.onclick=()=>{unwrittenOwnerFilter=b.dataset.owner;renderUnwrittenList();owners.querySelectorAll('[data-owner]').forEach(x=>x.classList.toggle('active',x===b))});
  if(unwrittenOwnerFilter!=='all'&&!ownerMap.has(unwrittenOwnerFilter))unwrittenOwnerFilter='all';
  renderUnwrittenList();
 }catch(e){summary.innerHTML=`<div class="statusBanner warn">미작성 대시보드 조회 오류: ${esc(e.message)}</div>`}
}

const UNWRITTEN_LIST_COLUMNS={
 no:{key:'no',label:'No.',sortable:false},
 site_name:{key:'site_name',label:'현장명',sortable:true},
 important:{key:'important',label:'중요사항',sortable:true},
 expiry:{key:'expiry',label:'계약만료일',sortable:true},
 elapsed:{key:'elapsed',label:'파일접수 후 경과일수',sortable:true},
 corporation:{key:'corporation',label:'법인',sortable:true},
 inspection_type:{key:'inspection_type',label:'점검 구분',sortable:true},
 receipt:{key:'receipt',label:'파일접수일자',sortable:true},
 field_end:{key:'field_end',label:'점검종료일자',sortable:true},
 field_inspector:{key:'field_inspector',label:'현장점검원',sortable:true},
 actions:{key:'actions',label:'관리',sortable:false}
};
const UNWRITTEN_DEFAULT_ORDER=['no','site_name','important','expiry','elapsed','corporation','inspection_type','receipt','field_end','field_inspector','actions'];
let unwrittenColumnOrder=[];
let unwrittenSort={key:null,dir:'asc'};
let suppressUnwrittenSortClick=false;
function unwrittenOrderStorageKey(){return `staff_unwritten_column_order:${me?.id||'guest'}`}
function unwrittenSortStorageKey(){return `staff_unwritten_sort:${me?.id||'guest'}`}
function ensureUnwrittenColumnOrder(){
 const valid=[...UNWRITTEN_DEFAULT_ORDER];
 if(!unwrittenColumnOrder.length){
  try{const saved=JSON.parse(localStorage.getItem(unwrittenOrderStorageKey())||'null');if(Array.isArray(saved))unwrittenColumnOrder=saved.filter(k=>valid.includes(k))}catch(e){}
 }
 let next=unwrittenColumnOrder.filter(k=>valid.includes(k));
 valid.forEach(k=>{if(!next.includes(k))next.push(k)});
 unwrittenColumnOrder=next;
 if(!unwrittenSort.key){
  try{const s=JSON.parse(localStorage.getItem(unwrittenSortStorageKey())||'null');if(s&&UNWRITTEN_LIST_COLUMNS[s.key]?.sortable&&['asc','desc'].includes(s.dir))unwrittenSort=s}catch(e){}
 }
 if(unwrittenSort.key&&!UNWRITTEN_LIST_COLUMNS[unwrittenSort.key]?.sortable)unwrittenSort={key:null,dir:'asc'};
 return unwrittenColumnOrder;
}
function unwrittenSortValue(r,key){
 if(key==='site_name')return r.site_name||'';
 if(key==='important')return reportValue(r,16)||'';
 if(key==='expiry')return reportValue(r,18)||'';
 if(key==='elapsed')return elapsedFromReceipt(r)??-1;
 if(key==='corporation')return reportValue(r,24)||'';
 if(key==='inspection_type')return reportValue(r,25)||'';
 if(key==='receipt')return reportValue(r,27)||'';
 if(key==='field_end')return String(r.field_end||reportValue(r,30)||'');
 if(key==='field_inspector')return String(r.field_inspector||reportValue(r,31)||'');
 return '';
}
function sortedUnwrittenRows(rows){
 if(!unwrittenSort.key)return rows;
 const key=unwrittenSort.key,dir=unwrittenSort.dir==='desc'?-1:1;
 return [...rows].sort((a,b)=>{
  const cmp=compareSiteListValues(unwrittenSortValue(a,key),unwrittenSortValue(b,key));
  if(cmp)return cmp*dir;
  return (Number(a.excel_row||0)-Number(b.excel_row||0))||Number(a.source_id||0)-Number(b.source_id||0);
 });
}
function toggleUnwrittenSort(key){
 const c=UNWRITTEN_LIST_COLUMNS[key];if(!c?.sortable)return;
 if(unwrittenSort.key===key)unwrittenSort.dir=unwrittenSort.dir==='asc'?'desc':'asc';else unwrittenSort={key,dir:'asc'};
 try{localStorage.setItem(unwrittenSortStorageKey(),JSON.stringify(unwrittenSort))}catch(e){}
 renderUnwrittenList();
}
function moveUnwrittenColumn(dragKey,targetKey,placeAfter=false){
 ensureUnwrittenColumnOrder();
 if(!dragKey||!targetKey||dragKey===targetKey)return;
 const next=unwrittenColumnOrder.filter(k=>k!==dragKey),idx=next.indexOf(targetKey);if(idx<0)return;
 next.splice(idx+(placeAfter?1:0),0,dragKey);unwrittenColumnOrder=next;
 try{localStorage.setItem(unwrittenOrderStorageKey(),JSON.stringify(unwrittenColumnOrder))}catch(e){}
 renderUnwrittenList();
}
function unwrittenHeaderHtml(key){
 const c=UNWRITTEN_LIST_COLUMNS[key],active=unwrittenSort.key===key,arrow=active?(unwrittenSort.dir==='asc'?' ▲':' ▼'):'';
 return `<th class="uw-col-${key} ${c.sortable?'sortableHeader':''} ${active?'sortActive':''}" data-uw-col-key="${key}" data-sortable="${c.sortable?'1':'0'}" draggable="true" title="${c.sortable?'클릭: 오름/내림차순 정렬 · ':''}드래그: 열 이동"><span>${esc(c.label)}${arrow}</span></th>`;
}
function unwrittenCellHtml(r,key,index){
 const days=elapsedFromReceipt(r);
 if(key==='no')return `<td class="center uw-col-no">${index+1}</td>`;
 if(key==='site_name')return `<td class="unwrittenSite uw-col-site_name"><strong>${esc(r.site_name||'-')}</strong></td>`;
 if(key==='important')return `<td class="importantCell uw-col-important">${esc(reportValue(r,16)||'-')}</td>`;
 if(key==='expiry')return `<td class="uw-col-expiry">${esc(reportValue(r,18)||'-')}</td>`;
 if(key==='elapsed')return `<td class="center uw-col-elapsed ${elapsedClass(days)}">${days===null?'-':days+'일'}</td>`;
 if(key==='corporation')return `<td class="uw-col-corporation">${esc(reportValue(r,24)||'-')}</td>`;
 if(key==='inspection_type')return `<td class="uw-col-inspection_type">${esc(reportValue(r,25)||'-')}</td>`;
 if(key==='receipt')return `<td class="uw-col-receipt">${esc(reportValue(r,27)||'-')}</td>`;
 if(key==='field_end')return `<td class="uw-col-field_end">${esc(String(r.field_end||reportValue(r,30)||'-'))}</td>`;
 if(key==='field_inspector')return `<td class="uw-col-field_inspector">${esc(r.field_inspector||reportValue(r,31)||'-')}</td>`;
 if(key==='actions')return `<td class="center reportActions uw-col-actions"><button class="smallBtn" data-report-detail-btn="${r.source_id}">상세</button><button class="primary smallBtn" data-report-edit="${r.source_id}">수정</button></td>`;
 return '<td></td>';
}
function bindUnwrittenHeaderInteractions(root){
 let dragKey=null;
 const clearMarks=()=>root.querySelectorAll('.unwrittenTable th').forEach(x=>x.classList.remove('dragging','dragBefore','dragAfter'));
 root.querySelectorAll('.unwrittenTable th[data-uw-col-key]').forEach(th=>{
  th.addEventListener('click',()=>{if(suppressUnwrittenSortClick)return;toggleUnwrittenSort(th.dataset.uwColKey)});
  th.addEventListener('dragstart',e=>{dragKey=th.dataset.uwColKey;th.classList.add('dragging');suppressUnwrittenSortClick=true;if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragKey)}});
  th.addEventListener('dragover',e=>{if(!dragKey||dragKey===th.dataset.uwColKey)return;e.preventDefault();clearMarks();const rect=th.getBoundingClientRect(),after=e.clientX>rect.left+rect.width/2;th.classList.add(after?'dragAfter':'dragBefore');if(e.dataTransfer)e.dataTransfer.dropEffect='move'});
  th.addEventListener('dragleave',()=>th.classList.remove('dragBefore','dragAfter'));
  th.addEventListener('drop',e=>{e.preventDefault();const target=th.dataset.uwColKey,rect=th.getBoundingClientRect(),after=e.clientX>rect.left+rect.width/2;clearMarks();const from=dragKey;dragKey=null;setTimeout(()=>{suppressUnwrittenSortClick=false},120);moveUnwrittenColumn(from,target,after)});
  th.addEventListener('dragend',()=>{clearMarks();dragKey=null;setTimeout(()=>{suppressUnwrittenSortClick=false},120)});
 });
}
function renderUnwrittenList(){
 if(!isAdmin())return;
 const filtered=unwrittenOwnerFilter==='all'?unwrittenRows:unwrittenRows.filter(r=>reportOwnerName(r)===unwrittenOwnerFilter);
 $('unwrittenListTitle').textContent=unwrittenOwnerFilter==='all'?'미작성 현장 전체':`${unwrittenOwnerFilter} · 미작성 현장`;
 const desktop=window.matchMedia('(min-width:801px)').matches;
 $('unwrittenListMeta').textContent=desktop?`${filtered.length.toLocaleString()}건 · 제목 클릭: 오름/내림차순 정렬 · 제목 드래그: 열 이동 · 현장 행 클릭: 상세조회`:`${filtered.length.toLocaleString()}건 · 현장카드에서 상세·수정할 수 있습니다.`;
 const root=$('unwrittenList');if(!filtered.length){root.innerHTML='<div class="emptyDashboard">해당 담당자의 미작성 보고서가 없습니다.</div>';return}
 if(desktop){
   ensureUnwrittenColumnOrder();
   const sorted=sortedUnwrittenRows(filtered);
   const headers=unwrittenColumnOrder.map(unwrittenHeaderHtml).join('');
   const rows=sorted.map((r,i)=>`<tr class="unwrittenRow" data-report-detail="${r.source_id}">${unwrittenColumnOrder.map(key=>unwrittenCellHtml(r,key,i)).join('')}</tr>`).join('');
   root.innerHTML=`<div class="unwrittenListHint"><strong>정렬:</strong> 열 제목 클릭 · <strong>열 이동:</strong> 제목을 마우스로 잡아 왼쪽/오른쪽으로 드래그하세요. 변경한 열 순서는 자동 저장됩니다.</div><div class="unwrittenTableWrap"><table class="unwrittenTable"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
   bindUnwrittenHeaderInteractions(root);
   root.querySelectorAll('.unwrittenRow').forEach(tr=>tr.onclick=e=>{if(e.target.closest('button,a,input,select,th'))return;openDetail(Number(tr.dataset.reportDetail))});
 }else{
   root.innerHTML=filtered.map(r=>{const days=elapsedFromReceipt(r);return `<article class="unwrittenCard"><div class="unwrittenCardHead"><h4>${esc(r.site_name||'-')}</h4><span class="elapsedBadge ${elapsedClass(days)}">${days===null?'접수일 없음':days+'일 경과'}</span></div><dl><div><dt>중요사항</dt><dd>${esc(reportValue(r,16)||'-')}</dd></div><div><dt>계약만료일</dt><dd>${esc(reportValue(r,18)||'-')}</dd></div><div><dt>법인</dt><dd>${esc(reportValue(r,24)||'-')}</dd></div><div><dt>점검 구분</dt><dd>${esc(reportValue(r,25)||'-')}</dd></div><div><dt>파일접수일자</dt><dd>${esc(reportValue(r,27)||'-')}</dd></div><div><dt>점검종료일자</dt><dd>${esc(r.field_end||reportValue(r,30)||'-')}</dd></div><div><dt>현장점검원</dt><dd>${esc(r.field_inspector||reportValue(r,31)||'-')}</dd></div></dl><div class="siteActions"><button class="smallBtn" data-report-detail-btn="${r.source_id}">상세</button><button class="primary smallBtn" data-report-edit="${r.source_id}">수정</button></div></article>`}).join('');
 }
 root.querySelectorAll('[data-report-detail-btn]').forEach(b=>b.onclick=e=>{e.stopPropagation();openDetail(Number(b.dataset.reportDetailBtn))});
 root.querySelectorAll('[data-report-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openSiteEditor(Number(b.dataset.reportEdit))});
}

function updateFieldSelectionCount(){const total=$('fieldList').querySelectorAll('input[type=checkbox]').length,selected=$('fieldList').querySelectorAll('input[type=checkbox]:checked').length;$('fieldSelectionCount').textContent=`${selected} / ${total}개 선택`}
function setFieldChecks(mode){const boxes=[...$('fieldList').querySelectorAll('input[type=checkbox]')];if(mode==='all')boxes.forEach(x=>x.checked=true);else if(mode==='none')boxes.forEach(x=>x.checked=false);else{const defs=new Set(DEFAULT_DISPLAY_FIELDS);boxes.forEach(x=>x.checked=defs.has(x.value))}updateFieldSelectionCount()}
function setupFields(){const safe=selectableDisplayFields();$('fieldList').innerHTML=safe.map(f=>`<label><input type="checkbox" value="${esc(f.label)}" ${displayFields.includes(f.label)?'checked':''}>${esc(f.label)}</label>`).join('');$('fieldList').querySelectorAll('input[type=checkbox]').forEach(x=>x.onchange=updateFieldSelectionCount);updateFieldSelectionCount();$('fieldsDlg').showModal()}
async function saveFields(){
 const chosen=sanitizeDisplayFields([...$('fieldList').querySelectorAll('input:checked')].map(x=>x.value));
 if(!chosen.length)return alert('검색 결과에 표시할 항목을 하나 이상 선택해 주세요.');
 const btn=$('fieldsSave'),old=btn.textContent;btn.disabled=true;btn.textContent='저장 중...';
 try{
  const{error}=await sb.rpc('staff_save_display_fields',{p_fields:chosen});if(error)throw error;
  displayFields=chosen;me.staff_display_fields=[...chosen];siteListColumnOrder=[];
  localStorage.setItem(displayFieldStorageKey(),JSON.stringify(displayFields));localStorage.setItem('staff_display_fields',JSON.stringify(displayFields));
  $('fieldsDlg').close();renderSites();
 }catch(e){alert('표시 항목 저장 오류: '+e.message)}finally{btn.disabled=false;btn.textContent=old}
}
function salesRaw(r,col){return r?.full_values?.[col-1]??''}
function salesNumber(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0}
function salesMoney(v){const n=salesNumber(v);return n?Math.round(n).toLocaleString('ko-KR'):'-'}
function salesRemark(r){
 const remain=[];
 const perf=Math.max(0,salesNumber(salesRaw(r,10))-salesNumber(salesRaw(r,11)));
 const maint=Math.max(0,salesNumber(salesRaw(r,12))-salesNumber(salesRaw(r,13)));
 if(perf)remain.push(`잔여 성능 ${perf}회`);
 if(maint)remain.push(`잔여 유지 ${maint}회`);
 return remain.length?{text:remain.join(' · '),done:false}:{text:'완료',done:true};
}
function salesContractType(r){return String(salesRaw(r,25)||r.report_grade||'-').trim()||'-'}
function salesContractAmount(r){const v=salesNumber(r.contract_amount);return v||salesNumber(r.performance_amount)+salesNumber(r.maintenance_amount)+salesNumber(r.manager_amount)}
function salesAmount(r){return salesNumber(r.sales_amount)||salesContractAmount(r)}
function salesReportCompleted(r){return String(r?.report_complete_date??'').trim()!==''}
function salesOwnerName(r){return normalizeReportOwnerName(r?.document_owner||r?.document_owner_raw||'')}
async function loadSales(){
 if(!(isAdmin()&&can('can_view_staff_sales')))return;
 try{
  salesRows=await fetchPaged('staff_site_source','id,site_name,report_grade,document_owner_raw,document_owner,sales_year,sales_month,contract_amount,performance_amount,maintenance_amount,manager_amount,sales_amount,field_inspector,report_complete_date,full_values',q=>q.order('sales_year',{ascending:false}).order('sales_month',{ascending:false}));
  salesRows=salesRows.filter(r=>r.sales_year&&r.sales_month&&String(r.document_owner||'').trim()&&salesReportCompleted(r));
  salesImported=false;fillSalesFilters();renderSales();
 }catch(e){alert('매출 자료 조회 오류: '+e.message)}
}
function fillSalesFilters(){
 const years=[...new Set(salesRows.map(r=>String(r.sales_year||'')).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
 const owners=[...new Set(salesRows.map(salesOwnerName).filter(x=>x&&x!=='미배정'))].sort((a,b)=>a.localeCompare(b,'ko'));
 const ys=$('salesYear'),ms=$('salesMonth'),os=$('salesOwner');
 const now=String(new Date().getFullYear()),oldY=ys.value||now;
 ys.innerHTML=years.map(y=>`<option value="${esc(y)}">${esc(y)}년</option>`).join('');
 ys.value=years.includes(oldY)?oldY:(years[0]||now);
 const oldM=ms.dataset.last||String(new Date().getMonth()+1);
 ms.innerHTML='<option value="all">전체 월</option>'+Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}월</option>`).join('');
 ms.value=[...ms.options].some(x=>x.value===oldM)?oldM:'all';
 const oldO=normalizeReportOwnerName(os.value||'all');
 os.innerHTML='<option value="all">전체 담당자</option>'+owners.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
 os.value=[...os.options].some(x=>x.value===oldO)?oldO:'all';
}
function filteredSales(){
 const y=$('salesYear').value,m=$('salesMonth').value,o=$('salesOwner').value;
 $('salesMonth').dataset.last=m;
 return salesRows.filter(r=>salesReportCompleted(r)&&String(r.sales_year)===String(y)&&(m==='all'||Number(r.sales_month)===Number(m))&&(o==='all'||salesOwnerName(r)===o));
}
function renderSales(){
 salesImported=false;
 const y=$('salesYear').value,m=$('salesMonth').value,o=$('salesOwner').value,rows=filteredSales();
 let tc=0,tm=0,ts=0;
 const body=rows.map((r,i)=>{
  const c=salesContractAmount(r),manager=salesNumber(r.manager_amount),sale=salesAmount(r),remark=salesRemark(r);
  tc+=c;tm+=manager;ts+=sale;
  return `<tr><td class="center">${i+1}</td><td>${esc(r.site_name||'')}</td><td class="center">${esc(salesContractType(r))}</td><td>${esc(r.field_inspector||'-')}</td><td class="num">${salesMoney(c)}</td><td class="num">${salesMoney(manager)}</td><td class="num">${salesMoney(sale)}</td><td class="${remark.done?'salesDone':''}">${esc(remark.text)}</td></tr>`;
 }).join('');
 const totalRow=`<tr class="totalrow"><td colspan="4" class="center">매출 합계</td><td class="num">${salesMoney(tc)}</td><td class="num">${salesMoney(tm)}</td><td class="num">${salesMoney(ts)}</td><td></td></tr>`;
 $('salesBody').innerHTML=body?body+totalRow:'<tr><td colspan="8" class="emptyrow">선택한 조건에 해당하는 보고서 작성 완료 건이 없습니다.</td></tr>';
 $('salesFoot').innerHTML='';
 $('salesTitle').textContent=`${y||''}년 ${m==='all'?'전체':m+'월'} 보고서 작성 완료 매출 관리${o==='all'?'':' - '+o}`;
}
function exportSales(){
 if(!(isAdmin()&&can('can_export_staff_sales')))return alert('매출 관리 엑셀 내보내기는 관리자만 사용할 수 있습니다.');
 try{if(!window.XLSX)throw new Error('엑셀 라이브러리를 불러오지 못했습니다.');const table=$('salesTable');const wb=XLSX.utils.table_to_book(table,{sheet:'매출 관리',raw:true});XLSX.writeFile(wb,`${$('salesTitle').textContent}.xlsx`)}catch(e){alert('엑셀 내보내기 실패\n\n'+e.message)}
}
async function importSalesExcel(file){
 if(!file)return;if(!(isAdmin()&&can('can_view_staff_sales')))return alert('매출 관리는 관리자만 사용할 수 있습니다.');
 try{
  if(!window.XLSX)throw new Error('엑셀 라이브러리를 불러오지 못했습니다.');
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:''}),body=rows.filter(r=>String(r['현장명']||'').trim());
  if(!body.length)throw new Error('현장명이 있는 매출 관리표를 찾지 못했습니다.');
  let tc=0,tm=0,ts=0;
  $('salesBody').innerHTML=body.map((r,i)=>{const c=salesNumber(r['계약 금액 (VAT 별도)']),m=salesNumber(r['유지관리자 선임비(VAT 별도)']),sale=salesNumber(r['매출액 (VAT 별도)']);tc+=c;tm+=m;ts+=sale;const note=String(r['비고']||'');return `<tr><td class="center">${i+1}</td><td>${esc(r['현장명'])}</td><td class="center">${esc(r['계약 구분 (유지/성능/유지선임)']||'')}</td><td>${esc(r['점검참여자']||'')}</td><td class="num">${salesMoney(c)}</td><td class="num">${salesMoney(m)}</td><td class="num">${salesMoney(sale)}</td><td class="${note==='완료'?'salesDone':''}">${esc(note)}</td></tr>`}).join('')+`<tr class="totalrow"><td colspan="4" class="center">매출 합계</td><td class="num">${salesMoney(tc)}</td><td class="num">${salesMoney(tm)}</td><td class="num">${salesMoney(ts)}</td><td></td></tr>`;
  $('salesFoot').innerHTML='';salesImported=true;
 }catch(e){alert('엑셀 가져오기 실패\n\n'+e.message)}
}
function printSalesReport(){
 if(!(isAdmin()&&can('can_print_staff_sales')))return alert('매출 관리 출력은 관리자만 사용할 수 있습니다.');
 const title=$('salesTitle').textContent,table=$('salesTable');
 if(!table)return alert('출력할 매출 관리표를 찾지 못했습니다.');
 const w=window.open('','sales_print','width=980,height=760');
 if(!w)return alert('출력 창이 차단되었습니다. 브라우저의 팝업 차단을 해제한 뒤 다시 눌러주세요.');
 w.document.open();w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4 portrait;margin:10mm 8mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,'Malgun Gothic',sans-serif;color:#111}h1{text-align:center;font-size:15pt;margin:0 0 6mm}.salesReportTable{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}.salesReportTable thead{display:table-header-group}.salesReportTable tr{break-inside:avoid;page-break-inside:avoid}.salesReportTable th{background:#0877bd!important;color:#fff!important;font-weight:900;text-align:center;border:1px solid #fff;padding:5px 3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.salesReportTable td{border:1px solid #aeb7c2;padding:5px 3px;vertical-align:middle;word-break:break-word}.salesReportTable td.num{text-align:right}.salesReportTable td.center{text-align:center}.salesReportTable .totalrow td{font-weight:900;background:#0877bd!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.salesReportTable .totalrow td.num,.salesReportTable .totalrow td:last-child{background:#fff!important;color:#111!important}.salesReportTable .salesDone{color:#a7adb5}.salesReportTable .emptyrow{text-align:center;color:#68768a;padding:20px}</style></head><body><h1>${esc(title)}</h1>${table.outerHTML}</body></html>`);w.document.close();w.focus();setTimeout(()=>w.print(),300);
}
async function importWorkbook(file){if(!(isAdmin()&&can('can_import_staff_sites')))return alert('엑셀 DB 등록은 관리자만 사용할 수 있습니다.');if(!confirm('선택한 엑셀의 진행중 시트 전체를 서버 DB와 동기화합니다. 계속할까요?'))return;const overlay=$('importOverlay'),bar=$('importBar'),text=$('importText');overlay.classList.remove('hidden');bar.style.width='2%';text.textContent='엑셀 파일 읽는 중...';try{const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:false}),ws=wb.Sheets['진행중']||wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});const token=uuid(),batch=[];let count=0,total=0;for(let ri=3;ri<rows.length;ri++)if(String(rows[ri]?.[3]||'').trim())total++;const flush=async()=>{if(!batch.length)return;const payload=batch.splice(0);const{error}=await sb.from('staff_site_source').upsert(payload,{onConflict:'excel_row'});if(error)throw error;count+=payload.length;const pct=Math.min(94,5+Math.round(count/Math.max(total,1)*89));bar.style.width=pct+'%';text.textContent=`현장 DB 등록 중 ${count.toLocaleString()} / ${total.toLocaleString()}건`};for(let ri=3;ri<rows.length;ri++){const a=rows[ri]||[],site=String(a[3]||'').trim();if(!site)continue;const vals=Array.from({length:137},(_,i)=>normalizeCell(a[i],i+1));const safe=vals.map((v,i)=>financialCols.has(i+1)?null:v),op=ownerParts(vals[18]),ym=inferYearMonth(vals,op),num=i=>vals[i]===''?null:(Number.isFinite(Number(vals[i]))?Number(vals[i]):null);batch.push({excel_row:ri+1,source_file:file.name,sn:String(vals[0]||''),site_name:site,previous_name:String(vals[4]||''),report_grade:String(vals[1]||''),region:String(vals[16]||''),area:num(5),households:String(vals[6]||''),approval_date:String(vals[7]||''),inspection_stage:String(vals[8]||''),document_owner_raw:String(vals[18]||''),document_owner:op.owner,document_progress_month:String(vals[19]||''),document_complete_month:String(vals[20]||''),field_plan_start:String(vals[27]||''),field_plan_end:String(vals[28]||''),field_end:String(vals[29]||''),field_inspector:String(vals[30]||''),report_complete_date:String(vals[31]||''),report_status:String(vals[32]||''),sales_manager:String(vals[40]||''),client_manager:String(vals[41]||''),client_contact:String(vals[42]||''),contract_start:String(vals[43]||''),contract_end:String(vals[44]||''),performance_amount:num(45),maintenance_amount:num(46),manager_amount:num(47),contract_amount:num(48),sales_amount:num(49),binding_cost:num(50),binding_ratio:num(51),sales_year:ym.year,sales_month:ym.month,full_values:vals,safe_values:safe,import_token:token});if(batch.length>=100)await flush()}await flush();text.textContent='이전 DB와 동기화 중...';const{error:delErr}=await sb.from('staff_site_source').delete().neq('import_token',token);if(delErr)throw delErr;let aux={sheet_names:wb.SheetNames};const auxWs=wb.Sheets['Sheet1'];if(auxWs)aux.Sheet1=XLSX.utils.sheet_to_json(auxWs,{header:1,defval:'',raw:false});const{error:metaErr}=await sb.from('staff_workbook_meta').insert({source_file:file.name,source_sheet:'진행중',field_schema:schema.fields,auxiliary_sheets:aux,record_count:count,imported_by:me.id});if(metaErr)throw metaErr;bar.style.width='100%';text.textContent=`완료: ${count.toLocaleString()}개 현장을 서버 DB에 저장했습니다.`;setTimeout(()=>overlay.classList.add('hidden'),900);await Promise.all([refreshDbStatus(),searchSites(),loadSales()]);alert(`${count.toLocaleString()}개 현장을 전체 DB와 동기화했습니다.`)}catch(e){overlay.classList.add('hidden');throw e}}
async function exportAllSites(){
 if(!canExportAllSites())return alert('전체 현장정보 엑셀 내려받기 권한이 없습니다.');
 if(!window.XLSX)return alert('엑셀 라이브러리를 불러오지 못했습니다.');
 const btn=$('allSitesExportBtn'),oldText=btn?.textContent||'⇩ 전체 엑셀 내려받기';
 try{
  if(btn){btn.disabled=true;btn.textContent='엑셀 생성 중...'}
  const rows=await fetchPaged('staff_site_source','id,excel_row,source_file,site_name,client_phone,client_email,site_address,full_values',q=>q.order('excel_row',{ascending:true}));
  if(!rows.length)return alert('내려받을 현장정보가 없습니다.');
  const extraHeaders=['관리주체 전화번호(분리)','관리주체 이메일(분리)','주소','등록구분','DB ID','원본파일'];
  const headers=[...labels,...extraHeaders];
  const aoa=[headers];
  for(const r of rows){
    let vals=Array.isArray(r.full_values)?[...r.full_values]:Array(137).fill('');
    while(vals.length<137)vals.push('');
    vals=vals.slice(0,137).map((v,i)=>normalizeCell(v,i+1));
    aoa.push([...vals,formatPhoneList(r.client_phone||''),String(r.client_email||''),String(r.site_address||''),Number(r.excel_row)<0?'직접등록':'Excel/DB',r.id,String(r.source_file||'')]);
  }
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=headers.map((h,i)=>({wch:i===3?32:i===headers.length-4?45:Math.min(28,Math.max(10,String(h).length+2))}));
  ws['!autofilter']={ref:`A1:${XLSX.utils.encode_col(headers.length-1)}${aoa.length}`};
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'전체 현장정보');
  const now=new Date(),pad=n=>String(n).padStart(2,'0'),stamp=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const info=[['항목','내용'],['내려받은 일시',`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`],['현장 수',rows.length],['내려받은 사용자',me?.name||me?.user_id||''],['안내','DB에 등록된 전체 현장정보(137개 원본 항목 + 분리 연락처·주소)를 포함합니다.']];
  const infoWs=XLSX.utils.aoa_to_sheet(info);infoWs['!cols']=[{wch:18},{wch:70}];XLSX.utils.book_append_sheet(wb,infoWs,'내려받기 정보');
  XLSX.writeFile(wb,`사내현장정보_전체_${stamp}.xlsx`,{compression:true});
 }catch(e){alert('전체 엑셀 내려받기 실패\n\n'+(e?.message||e));}
 finally{if(btn){btn.disabled=false;btn.textContent=oldText}}
}

async function deleteAllSiteDb(){
 if(!isAdmin())return alert('전체 DB 삭제는 관리자만 사용할 수 있습니다.');
 const first=confirm('등록된 모든 현장정보를 삭제합니다.\n\n삭제 대상: Excel 등록 현장 + 직접등록 현장 + 현장검색/매출조회 데이터\n유지 대상: 사용자 계정과 권한\n\n계속하시겠습니까?');
 if(!first)return;
 const phrase=prompt('복구할 수 없는 작업입니다. 계속하려면 아래 문구를 정확히 입력하세요.\n\n전체삭제');
 if(phrase!=='전체삭제'){
   if(phrase!==null)alert('확인 문구가 일치하지 않아 삭제를 취소했습니다.');
   return;
 }
 const final=confirm('마지막 확인입니다. 전체 현장 DB를 정말 삭제하시겠습니까?');
 if(!final)return;
 const btn=$('dbDeleteAllBtn');
 const oldText=btn?.textContent;
 try{
   if(btn){btn.disabled=true;btn.textContent='삭제 중...'}
   const {data,error}=await sb.rpc('staff_delete_all_sites');
   if(error)throw error;
   lastSites=[];
   if($('siteResults'))$('siteResults').innerHTML='';
   if($('searchMeta'))$('searchMeta').textContent='검색 0건 · 현재 조건 0건';
   await Promise.all([refreshDbStatus(),searchSites(),loadSales()]);
   const n=Number(data?.deleted_source||0);
   alert(`${n.toLocaleString()}개 현장을 삭제했습니다. 사용자 계정과 권한은 유지되었습니다.`);
 }catch(e){
   alert('전체 DB 삭제 오류: '+e.message);
 }finally{
   if(btn){btn.disabled=false;btn.textContent=oldText||'전체 DB 삭제'}
 }
}

async function loadUsers(){if(!(isAdmin()&&can('can_manage_staff_users')))return;const{data,error}=await sb.from('pjt_profiles').select('*').order('name',{ascending:true});if(error)return alert(error.message);const tb=$('userTable').querySelector('tbody');tb.innerHTML=(data||[]).map(p=>{const admin=p.role==='admin';return `<tr><td>${esc(p.name||'')}</td><td>${esc(p.user_id||'')}</td><td>${esc(p.phone||'')}</td><td><select data-u="${p.id}" data-k="role"><option value="viewer" ${!admin?'selected':''}>일반</option><option value="admin" ${admin?'selected':''}>관리자</option></select></td>${[['approved','승인'],['can_use_staff_portal','포털'],['can_view_staff_sites','현장'],['can_create_staff_sites','등록'],['can_edit_staff_sites','수정'],['can_export_staff_sites','전체엑셀'],['can_view_staff_sales','매출'],['can_import_staff_sites','가져오기'],['can_manage_staff_users','사용자']].map(([k])=>`<td class="permCell"><input type="checkbox" data-u="${p.id}" data-k="${k}" ${p[k]?'checked':''} ${admin&&k!=='approved'?'disabled':''}></td>`).join('')}<td><div class="userActions"><button data-reset="${p.id}">PW</button>${p.id!==me.id?`<button data-del="${p.id}">삭제</button>`:''}</div></td></tr>`}).join('');document.querySelectorAll('#userTable [data-k]').forEach(el=>el.onchange=()=>changeUserPermission(el));document.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetPw(b.dataset.reset));document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteUser(b.dataset.del))}
async function changeUserPermission(el){const id=el.dataset.u,k=el.dataset.k,v=el.type==='checkbox'?el.checked:el.value;let patch={[k]:v};if((k==='can_create_staff_sites'||k==='can_edit_staff_sites'||k==='can_export_staff_sites')&&v===true)patch.can_view_staff_sites=true;if(k==='can_view_staff_sites'&&v===false){patch.can_create_staff_sites=false;patch.can_edit_staff_sites=false;patch.can_export_staff_sites=false}if(k==='role'&&v==='admin')patch={...patch,approved:true,can_use_staff_portal:true,can_view_staff_sites:true,can_create_staff_sites:true,can_edit_staff_sites:true,can_export_staff_sites:true,can_import_staff_sites:true,can_manage_staff_users:true,can_view_staff_sales:true,can_export_staff_sales:true,can_print_staff_sales:true,can_view_money:true,can_view_sales:true,can_print_sales:true};const{error}=await sb.from('pjt_profiles').update(patch).eq('id',id);if(error){alert(error.message);loadUsers();return}loadUsers()}
async function invokeAdmin(body){const{data,error}=await sb.functions.invoke(cfg.userAdminFunction,{body});if(error)throw error;if(data?.error)throw new Error(data.error);return data}
async function createUser(e){e.preventDefault();notify($('userMsg'),'등록 중...',true);try{await invokeAdmin({action:'create',employee_id:$('empId').value,password:$('empPw').value,name:$('empName').value,phone:$('empPhone').value,role:$('empRole').value,approved:$('empApproved').checked,permissions:{can_use_staff_portal:$('permPortal').checked,can_view_staff_sites:($('permSites').checked||$('permSiteCreate').checked||$('permSiteEdit').checked),can_create_staff_sites:$('permSiteCreate').checked,can_edit_staff_sites:$('permSiteEdit').checked,can_export_staff_sites:$('permAllSitesExport').checked,can_view_staff_sales:$('permSales').checked,can_export_staff_sales:$('permSalesExport').checked,can_print_staff_sales:$('permSalesPrint').checked,can_import_staff_sites:$('permImport').checked,can_manage_staff_users:$('permUsers').checked}});notify($('userMsg'),'직원 등록이 완료되었습니다.',true);setTimeout(()=>{$('userDlg').close();$('userForm').reset();$('empApproved').checked=$('permPortal').checked=$('permSites').checked=true;$('permSiteCreate').checked=$('permSiteEdit').checked=$('permAllSitesExport').checked=false;loadUsers()},500)}catch(err){notify($('userMsg'),err.message)}}
async function resetPw(id){const pw=prompt('새 비밀번호를 8자 이상 입력하세요.');if(!pw)return;try{await invokeAdmin({action:'reset_password',user_uuid:id,password:pw});alert('비밀번호를 변경했습니다.')}catch(e){alert(e.message)}}
async function deleteUser(id){if(!confirm('이 직원 계정을 삭제할까요?'))return;try{await invokeAdmin({action:'delete',user_uuid:id});loadUsers()}catch(e){alert(e.message)}}
function syncRoleForm(){const admin=$('empRole').value==='admin';['permPortal','permSites','permSiteCreate','permSiteEdit','permAllSitesExport'].forEach(id=>{$(id).disabled=false;if(admin)$(id).checked=true});['permSales','permSalesExport','permSalesPrint','permImport','permUsers'].forEach(id=>{$(id).checked=admin;$(id).disabled=admin})}
const resultLayoutMedia=window.matchMedia('(min-width: 801px)');
const rerenderResultLayout=()=>{if(lastSites.length&&$('page-search')?.classList.contains('active'))renderSites();if(unwrittenRows.length&&$('page-unwritten')?.classList.contains('active'))renderUnwrittenList()};
if(resultLayoutMedia.addEventListener)resultLayoutMedia.addEventListener('change',rerenderResultLayout);else if(resultLayoutMedia.addListener)resultLayoutMedia.addListener(rerenderResultLayout);
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
if(isStandalone()){const n=$('standaloneNotice');n?.classList.remove('hidden');$('standaloneHelp')?.addEventListener('click',()=>alert('현재 Chrome에 설치된 웹앱으로 실행 중입니다.\n\n일반 Chrome 탭으로 사용하려면:\n1. 이 앱 창 오른쪽 위 ⋮ 메뉴를 누릅니다.\n2. 앱 제거/삭제를 선택합니다.\n3. 또는 Chrome 주소창에 chrome://apps 를 입력한 뒤 현장 검색 앱을 제거합니다.\n4. 이후 https://nameplate76-bot.github.io/search/ 를 Chrome 일반 탭에서 다시 여세요.'));}
$('permSiteCreate').onchange=$('permSiteEdit').onchange=$('permAllSitesExport').onchange=e=>{if(e.target.checked)$('permSites').checked=true};$('permSites').onchange=e=>{if(!e.target.checked){$('permSiteCreate').checked=false;$('permSiteEdit').checked=false;$('permAllSitesExport').checked=false}};$('siteCreateBtn').onclick=openCreateSite;$('siteEditClose').onclick=()=>$('siteEditDlg').close();$('siteEditCancel').onclick=()=>$('siteEditDlg').close();$('siteEditForm').onsubmit=saveSiteEdit;$('siteAddressSearchBtn').onclick=searchSiteAddress;$('siteAddressQuery').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchSiteAddress()}};$('siteManualAddressBtn').onclick=()=>setSiteAddressMode('manual');$('siteSearchAddressModeBtn').onclick=()=>setSiteAddressMode('search');$('siteFormPhone').onblur=e=>{e.target.value=formatPhoneList(e.target.value)};
$('unwrittenRefresh').onclick=loadUnwrittenDashboard;
$('loginBtn').onclick=login;$('loginPw').onkeydown=e=>{if(e.key==='Enter')login()};$('logoutBtn').onclick=async()=>{await sb.auth.signOut();me=null;showLogin()};document.querySelectorAll('#mainNav button[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page,true));$('searchBtn').onclick=searchSites;$('siteQuery').onkeydown=e=>{if(e.key==='Enter')searchSites()};document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));searchSites()});$('fieldBtn').onclick=setupFields;$('fieldsSelectAll').onclick=()=>setFieldChecks('all');$('fieldsSelectDefault').onclick=()=>setFieldChecks('default');$('fieldsClearAll').onclick=()=>setFieldChecks('none');$('fieldsSave').onclick=saveFields;$('detailClose').onclick=()=>$('detailDlg').close();$('fieldsClose').onclick=()=>$('fieldsDlg').close();$('userClose').onclick=()=>$('userDlg').close();$('contactEditClose').onclick=()=>$('contactEditDlg').close();$('contactEditForm').onsubmit=saveContact;$('addressSearchBtn').onclick=searchAddress;$('addressQuery').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchAddress()}};$('manualAddressBtn').onclick=()=>setAddressMode('manual');$('searchAddressModeBtn').onclick=()=>setAddressMode('search');$('contactPhone').onblur=e=>{e.target.value=formatPhoneList(e.target.value)};$('routeClose').onclick=()=>$('routeDlg').close();document.querySelectorAll('[data-route-app]').forEach(b=>b.onclick=()=>launchRoute(b.dataset.routeApp));['salesYear','salesMonth','salesOwner'].forEach(id=>$(id).onchange=renderSales);$('salesPrint').onclick=printSalesReport;$('salesExport').onclick=exportSales;$('salesImport').onclick=()=>isAdmin()?$('salesFile').click():alert('매출 관리는 관리자만 사용할 수 있습니다.');$('salesFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;await importSalesExcel(f);e.target.value=''};$('allSitesExportBtn').onclick=exportAllSites;$('dbDeleteAllBtn').onclick=deleteAllSiteDb;$('dbImportBtn').onclick=()=>isAdmin()&&can('can_import_staff_sites')?$('dbFile').click():alert('전체 DB 엑셀 갱신은 관리자만 사용할 수 있습니다.');$('dbFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importWorkbook(f)}catch(err){alert('전체 DB 엑셀 갱신 오류: '+err.message)}e.target.value=''};$('newUserBtn').onclick=()=>{$('userDlg').showModal();syncRoleForm()};$('empRole').onchange=syncRoleForm;$('userForm').onsubmit=createUser;sb.auth.onAuthStateChange((event,session)=>{
 if(event==='SIGNED_OUT'){me=null;showLogin();return}
 // Excel·다른 앱·다른 탭에서 돌아올 때 발생하는 토큰 갱신/재인증으로 현재 화면을 초기화하지 않습니다.
 if(me&&!$('appView').classList.contains('hidden')&&(event==='TOKEN_REFRESHED'||event==='SIGNED_IN'||event==='USER_UPDATED'))return;
 setTimeout(()=>boot().catch(console.error),0);
});boot().catch(e=>{console.error(e);showLogin();notify($('loginMsg'),e.message)});
})();
