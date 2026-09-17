(()=>{'use strict';
const cfg=window.STAFF_APP_CONFIG, schema=window.STAFF_FIELD_SCHEMA;
const sb=supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])), money=n=>(Number(n||0)).toLocaleString('ko-KR')+'원';
const labels=schema.fields.map(x=>x.label), financialCols=new Set(schema.financial_cols||[46,47,48,49,50,51,52]);
const dateCols=new Set([8,18,22,23,26,27,28,29,30,32,44,45]);
let me=null,currentFilter='all',lastSites=[],salesRows=[],salesImported=false;
let displayFields=JSON.parse(localStorage.getItem('staff_display_fields')||'null')||['S/N','보고서  등급','지역','문서작성 > 담당','현장점검원','문서작성 진행 현황 > 현황 > 보고서 작성 완료'];
const can=k=>!!me?.[k],isAdmin=()=>me?.role==='admin'&&me?.approved;
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
 let phone=raw.replace(email,'').replace(/[|/,;]+/g,' ').replace(/\s+/g,' ').trim();
 const pm=phone.match(/(?:0\d{1,2}|01\d)[- .]?\d{3,4}[- .]?\d{4}/);
 phone=pm?pm[0].replace(/[ .]/g,'-'):phone;
 return{phone,email};
}
function cleanPhone(v){return String(v||'').replace(/[^0-9+]/g,'')}
function formatPhone(v){
 const n=cleanPhone(v).replace(/^\+82/,'0');
 if(/^02\d{7,8}$/.test(n))return n.replace(/^(02)(\d{3,4})(\d{4})$/,'$1-$2-$3');
 if(/^0\d{9,10}$/.test(n))return n.replace(/^(0\d{1,2})(\d{3,4})(\d{4})$/,'$1-$2-$3');
 return String(v||'').trim();
}
function callPhone(phone){
 const n=cleanPhone(phone);if(!n)return alert('등록된 전화번호가 없습니다.');
 // 사용자 클릭 이벤트 안에서 직접 tel: 스킴을 호출해야 iOS/Android 전화 앱이 가장 안정적으로 실행됩니다.
 window.location.href=`tel:${n}`;
}
function contactCards(r){
 const phone=String(r.client_phone||'').trim(),email=String(r.client_email||'').trim(),address=String(r.site_address||'').trim();
 const phoneHtml=phone?`<a class="contactLink phoneLink" href="tel:${esc(cleanPhone(phone))}" data-call-phone="${esc(phone)}" aria-label="${esc(phone)} 전화걸기">📞 ${esc(formatPhone(phone))}</a>`:'<span class="contactEmpty">미등록</span>';
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
 $('contactSourceId').value=r.source_id;$('contactSiteName').value=r.site_name||'';$('contactPhone').value=formatPhone(r.client_phone||'');$('contactEmail').value=r.client_email||'';$('contactAddress').value=r.site_address||'';$('contactAddressDetail').value='';$('addressQuery').value=r.site_address||'';setAddressMode('search');
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
 const id=Number($('contactSourceId').value),patch={client_phone:formatPhone($('contactPhone').value.trim()),client_email:$('contactEmail').value.trim(),site_address:fullAddress};
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
async function boot(){const{data:{session}}=await sb.auth.getSession();if(!session)return showLogin();const p=await profileFor(session.user);if(!p?.approved||!p.can_use_staff_portal){await sb.auth.signOut();showLogin();notify($('loginMsg'),'사용이 승인되지 않은 계정입니다. 관리자에게 문의하세요.');return}me=p;showApp()}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
function showApp(){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('userBadge').textContent=`${me.name||me.user_id||''} · ${isAdmin()?'관리자':'일반 사용자'}`;$('salesNav').classList.toggle('hidden',!(isAdmin()&&can('can_view_staff_sales')));$('usersNav').classList.toggle('hidden',!(isAdmin()&&can('can_manage_staff_users')));$('dbImportBtn')?.classList.toggle('hidden',!(isAdmin()&&can('can_import_staff_sites')));showPage(can('can_view_staff_sites')?'search':can('can_view_staff_sales')?'sales':'users');refreshDbStatus();if(can('can_view_staff_sites'))searchSites()}
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
    me=p;showApp();
  }catch(error){
    await sb.auth.signOut().catch(()=>{});
    notify($('loginMsg'),error?.message||'로그인에 실패했습니다. ID와 비밀번호를 확인하세요.');
  }
}
function showPage(name){if(name==='search'&&!can('can_view_staff_sites'))return alert('현장 검색 권한이 없습니다.');if(name==='sales'&&!(isAdmin()&&can('can_view_staff_sales')))return alert('매출 관리는 관리자만 사용할 수 있습니다.');if(name==='users'&&!(isAdmin()&&can('can_manage_staff_users')))return alert('사용자 관리는 관리자만 사용할 수 있습니다.');document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.querySelectorAll('#mainNav button').forEach(x=>x.classList.toggle('active',x.dataset.page===name));$('page-'+name).classList.add('active');if(name==='sales')loadSales();if(name==='users')loadUsers()}
async function refreshDbStatus(){if(!me)return;try{const{count,error}=await sb.from('staff_site_search').select('*',{count:'exact',head:true});if(error)throw error;const el=$('dbStatus');if((count||0)>0){el.className='statusBanner ok';el.innerHTML=`<strong>현장 DB ${Number(count).toLocaleString()}건</strong>이 서버에 저장되어 있습니다. 승인된 직원은 PC와 휴대폰에서 동일한 자료를 조회합니다.`}else{el.className='statusBanner warn';el.innerHTML=`<strong>현장 DB가 비어 있습니다.</strong> 관리자 계정에서 [매출 관리 → 엑셀 가져오기]로 확정수량.xlsx를 1회 등록하세요.`}}catch(e){$('dbStatus').className='statusBanner warn';$('dbStatus').textContent='DB 상태 확인 실패: '+e.message}}
async function fetchPaged(table,select='*',mutator=null){let from=0,all=[];const size=1000;for(;;){let q=sb.from(table).select(select).range(from,from+size-1);if(mutator)q=mutator(q);const{data,error}=await q;if(error)throw error;all.push(...(data||[]));if(!data||data.length<size)break;from+=size}return all}
async function searchSites(){if(!can('can_view_staff_sites'))return;const q=$('siteQuery').value.trim();$('searchMeta').textContent='검색 중...';try{const rows=await fetchPaged('staff_site_search','*',query=>{query=query.order('excel_row',{ascending:true});if(q){const s=q.replace(/[%_,()]/g,' ').trim();query=query.or(`site_name.ilike.%${s}%,previous_name.ilike.%${s}%,region.ilike.%${s}%,sn.ilike.%${s}%,document_owner.ilike.%${s}%,field_inspector.ilike.%${s}%`)}return query});lastSites=rows.filter(filterOk);$('searchMeta').textContent=`검색 ${rows.length.toLocaleString()}건 · 현재 조건 ${lastSites.length.toLocaleString()}건`;renderSites()}catch(e){$('searchMeta').textContent='검색 오류: '+e.message;$('siteResults').innerHTML=''}}
function renderSites(){const root=$('siteResults');if(!lastSites.length){root.innerHTML='<div class="siteCard">검색 결과가 없습니다.</div>';return}const visible=lastSites.slice(0,600);root.innerHTML=visible.map(r=>{const minis=displayFields.map(f=>`<div><span>${esc(f)}</span><b>${esc(val(r,f)||'-')}</b></div>`).join('');const p1=r.field_plan_start?'done':'',p2=r.field_end?'done':(r.field_plan_start?'working':''),p3=r.report_complete_date?'done':(r.field_end?'working':'');return `<article class="siteCard"><div class="siteTop"><div><h3>${esc(r.site_name)}</h3><span class="tag">${esc(r.report_grade||'등급 없음')}</span><span class="tag">${esc(r.region||'지역 없음')}</span></div><span class="tag">${esc(r.sn||'')}</span></div><div class="miniGrid">${minis}</div><div class="stepRow"><div class="step ${p1}">점검계획</div><div class="step ${p2}">현장점검</div><div class="step ${p3}">보고서</div></div><div class="siteActions"><button data-detail="${r.source_id}">상세 조회</button></div></article>`}).join('')+(lastSites.length>600?`<div class="siteCard">화면 성능을 위해 처음 600건만 표시합니다. 검색어를 입력하면 원하는 현장을 더 빠르게 찾을 수 있습니다.</div>`:'');document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(Number(b.dataset.detail)))}
const groups=[['기본정보',1,18],['진행·담당·계약',19,45],['유지관리 전체수량',55,82],['성능점검 대상수량',83,110],['성능점검 확정수량',111,137]];
async function openDetail(id){const r=lastSites.find(x=>Number(x.source_id)===Number(id));if(!r)return;$('detailTitle').textContent=r.site_name;const tabs=$('detailTabs');tabs.innerHTML=groups.map((g,i)=>`<button class="chip ${i===0?'active':''}" data-g="${i}">${g[0]}</button>`).join('');const render=i=>{const[,a,b]=groups[i];const fields=schema.fields.filter(f=>f.col>=a&&f.col<=b&&!f.financial&&f.label!=='관리주체 연락처/이메일');$('detailBody').innerHTML=(i===0||i===1?contactCards(r):'')+fields.map(f=>`<div class="detailItem"><span>${esc(f.label)}</span><b>${esc(r.safe_values?.[f.col-1]??'-')}</b></div>`).join('');bindContactActions(r);tabs.querySelectorAll('[data-g]').forEach(x=>x.classList.toggle('active',Number(x.dataset.g)===i))};tabs.querySelectorAll('[data-g]').forEach(x=>x.onclick=()=>render(Number(x.dataset.g)));render(0);$('detailDlg').showModal()}
function setupFields(){const safe=schema.fields.filter(f=>!f.financial&&f.col<=45);$('fieldList').innerHTML=safe.map(f=>`<label><input type="checkbox" value="${esc(f.label)}" ${displayFields.includes(f.label)?'checked':''}>${esc(f.label)}</label>`).join('');$('fieldsDlg').showModal()}
function saveFields(){displayFields=[...$('fieldList').querySelectorAll('input:checked')].map(x=>x.value).slice(0,10);if(!displayFields.length)displayFields=['S/N','지역'];localStorage.setItem('staff_display_fields',JSON.stringify(displayFields));$('fieldsDlg').close();renderSites()}
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
 const owners=[...new Set(salesRows.map(r=>String(r.document_owner||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
 const ys=$('salesYear'),ms=$('salesMonth'),os=$('salesOwner');
 const now=String(new Date().getFullYear()),oldY=ys.value||now;
 ys.innerHTML=years.map(y=>`<option value="${esc(y)}">${esc(y)}년</option>`).join('');
 ys.value=years.includes(oldY)?oldY:(years[0]||now);
 const oldM=ms.dataset.last||String(new Date().getMonth()+1);
 ms.innerHTML='<option value="all">전체 월</option>'+Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}월</option>`).join('');
 ms.value=[...ms.options].some(x=>x.value===oldM)?oldM:'all';
 const oldO=os.value||'all';
 os.innerHTML='<option value="all">전체 담당자</option>'+owners.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
 os.value=[...os.options].some(x=>x.value===oldO)?oldO:'all';
}
function filteredSales(){
 const y=$('salesYear').value,m=$('salesMonth').value,o=$('salesOwner').value;
 $('salesMonth').dataset.last=m;
 return salesRows.filter(r=>salesReportCompleted(r)&&String(r.sales_year)===String(y)&&(m==='all'||Number(r.sales_month)===Number(m))&&(o==='all'||String(r.document_owner||'')===o));
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
async function loadUsers(){if(!(isAdmin()&&can('can_manage_staff_users')))return;const{data,error}=await sb.from('pjt_profiles').select('*').order('name',{ascending:true});if(error)return alert(error.message);const tb=$('userTable').querySelector('tbody');tb.innerHTML=(data||[]).map(p=>{const admin=p.role==='admin';return `<tr><td>${esc(p.name||'')}</td><td>${esc(p.user_id||'')}</td><td>${esc(p.phone||'')}</td><td><select data-u="${p.id}" data-k="role"><option value="viewer" ${!admin?'selected':''}>일반</option><option value="admin" ${admin?'selected':''}>관리자</option></select></td>${[['approved','승인'],['can_use_staff_portal','포털'],['can_view_staff_sites','현장'],['can_view_staff_sales','매출'],['can_import_staff_sites','가져오기'],['can_manage_staff_users','사용자']].map(([k])=>`<td class="permCell"><input type="checkbox" data-u="${p.id}" data-k="${k}" ${p[k]?'checked':''} ${admin&&k!=='approved'?'disabled':''}></td>`).join('')}<td><div class="userActions"><button data-reset="${p.id}">PW</button>${p.id!==me.id?`<button data-del="${p.id}">삭제</button>`:''}</div></td></tr>`}).join('');document.querySelectorAll('#userTable [data-k]').forEach(el=>el.onchange=()=>changeUserPermission(el));document.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetPw(b.dataset.reset));document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteUser(b.dataset.del))}
async function changeUserPermission(el){const id=el.dataset.u,k=el.dataset.k,v=el.type==='checkbox'?el.checked:el.value;let patch={[k]:v};if(k==='role'&&v==='admin')patch={...patch,approved:true,can_use_staff_portal:true,can_view_staff_sites:true,can_import_staff_sites:true,can_manage_staff_users:true,can_view_staff_sales:true,can_export_staff_sales:true,can_print_staff_sales:true,can_view_money:true,can_view_sales:true,can_print_sales:true};const{error}=await sb.from('pjt_profiles').update(patch).eq('id',id);if(error){alert(error.message);loadUsers();return}loadUsers()}
async function invokeAdmin(body){const{data,error}=await sb.functions.invoke(cfg.userAdminFunction,{body});if(error)throw error;if(data?.error)throw new Error(data.error);return data}
async function createUser(e){e.preventDefault();notify($('userMsg'),'등록 중...',true);try{await invokeAdmin({action:'create',employee_id:$('empId').value,password:$('empPw').value,name:$('empName').value,phone:$('empPhone').value,role:$('empRole').value,approved:$('empApproved').checked,permissions:{can_use_staff_portal:$('permPortal').checked,can_view_staff_sites:$('permSites').checked,can_view_staff_sales:$('permSales').checked,can_export_staff_sales:$('permSalesExport').checked,can_print_staff_sales:$('permSalesPrint').checked,can_import_staff_sites:$('permImport').checked,can_manage_staff_users:$('permUsers').checked}});notify($('userMsg'),'직원 등록이 완료되었습니다.',true);setTimeout(()=>{$('userDlg').close();$('userForm').reset();$('empApproved').checked=$('permPortal').checked=$('permSites').checked=true;loadUsers()},500)}catch(err){notify($('userMsg'),err.message)}}
async function resetPw(id){const pw=prompt('새 비밀번호를 8자 이상 입력하세요.');if(!pw)return;try{await invokeAdmin({action:'reset_password',user_uuid:id,password:pw});alert('비밀번호를 변경했습니다.')}catch(e){alert(e.message)}}
async function deleteUser(id){if(!confirm('이 직원 계정을 삭제할까요?'))return;try{await invokeAdmin({action:'delete',user_uuid:id});loadUsers()}catch(e){alert(e.message)}}
function syncRoleForm(){const admin=$('empRole').value==='admin';['permPortal','permSites'].forEach(id=>{$(id).disabled=false;if(admin)$(id).checked=true});['permSales','permSalesExport','permSalesPrint','permImport','permUsers'].forEach(id=>{$(id).checked=admin;$(id).disabled=!admin||admin})}
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
if(isStandalone()){const n=$('standaloneNotice');n?.classList.remove('hidden');$('standaloneHelp')?.addEventListener('click',()=>alert('현재 Chrome에 설치된 웹앱으로 실행 중입니다.\n\n일반 Chrome 탭으로 사용하려면:\n1. 이 앱 창 오른쪽 위 ⋮ 메뉴를 누릅니다.\n2. 앱 제거/삭제를 선택합니다.\n3. 또는 Chrome 주소창에 chrome://apps 를 입력한 뒤 현장 검색 앱을 제거합니다.\n4. 이후 https://nameplate76-bot.github.io/search/ 를 Chrome 일반 탭에서 다시 여세요.'));}
$('loginBtn').onclick=login;$('loginPw').onkeydown=e=>{if(e.key==='Enter')login()};$('logoutBtn').onclick=async()=>{await sb.auth.signOut();me=null;showLogin()};document.querySelectorAll('#mainNav button[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$('searchBtn').onclick=searchSites;$('siteQuery').onkeydown=e=>{if(e.key==='Enter')searchSites()};document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));searchSites()});$('fieldBtn').onclick=setupFields;$('fieldsSave').onclick=saveFields;$('detailClose').onclick=()=>$('detailDlg').close();$('fieldsClose').onclick=()=>$('fieldsDlg').close();$('userClose').onclick=()=>$('userDlg').close();$('contactEditClose').onclick=()=>$('contactEditDlg').close();$('contactEditForm').onsubmit=saveContact;$('addressSearchBtn').onclick=searchAddress;$('addressQuery').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchAddress()}};$('manualAddressBtn').onclick=()=>setAddressMode('manual');$('searchAddressModeBtn').onclick=()=>setAddressMode('search');$('contactPhone').oninput=e=>{const pos=e.target.selectionStart;e.target.value=formatPhone(e.target.value)};$('routeClose').onclick=()=>$('routeDlg').close();document.querySelectorAll('[data-route-app]').forEach(b=>b.onclick=()=>launchRoute(b.dataset.routeApp));['salesYear','salesMonth','salesOwner'].forEach(id=>$(id).onchange=renderSales);$('salesPrint').onclick=printSalesReport;$('salesExport').onclick=exportSales;$('salesImport').onclick=()=>isAdmin()?$('salesFile').click():alert('매출 관리는 관리자만 사용할 수 있습니다.');$('salesFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;await importSalesExcel(f);e.target.value=''};$('dbImportBtn').onclick=()=>isAdmin()&&can('can_import_staff_sites')?$('dbFile').click():alert('전체 DB 엑셀 갱신은 관리자만 사용할 수 있습니다.');$('dbFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importWorkbook(f)}catch(err){alert('전체 DB 엑셀 갱신 오류: '+err.message)}e.target.value=''};$('newUserBtn').onclick=()=>{$('userDlg').showModal();syncRoleForm()};$('empRole').onchange=syncRoleForm;$('userForm').onsubmit=createUser;sb.auth.onAuthStateChange(()=>setTimeout(()=>boot().catch(console.error),0));boot().catch(e=>{console.error(e);showLogin();notify($('loginMsg'),e.message)});
})();
