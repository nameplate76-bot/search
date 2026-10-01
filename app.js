(()=>{'use strict';
const cfg=window.STAFF_APP_CONFIG, schema=window.STAFF_FIELD_SCHEMA;
const sb=supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])), money=n=>(Number(n||0)).toLocaleString('ko-KR')+'원';
const labels=schema.fields.map(x=>x.label), financialCols=new Set(schema.financial_cols||[46,47,48,49,50,51,52]);
const dateCols=new Set([8,18,22,23,26,27,28,29,30,32,40,44,45]);
// 화면에서는 제거하지만 원본 DB/엑셀의 열 위치는 유지합니다.
// 20(문서작성 진행월)은 더 이상 매출 집계에 사용하지 않으며 화면/엑셀에서 숨김 처리합니다.
const HIDDEN_UI_FIELD_COLS=new Set([18,20,30,82,110]);
const COMPACT_FIELD_LABELS={
  3:'점검표(매)',
  10:'성능점검 계약(회)',11:'성능점검 진행(회)',12:'유지관리 계약(회)',13:'유지관리 진행(회)',14:'유지관리자 선임 계약 여부',15:'월점검 계약(회)',
  19:'문서작성 담당자',21:'문서작성 완료(월)',22:'제본요청일자',23:'제본입고일자',
  25:'점검구분',26:'황화일 접수일자',27:'전자파일 접수일자',28:'점검 시작일자',29:'점검 종료일자',
  32:'보고서 작성 완료일자',33:'보고서 관련 메모',34:'제출/유지관리 매뉴얼(부)',35:'제출/계획서(부)',36:'제출/현황표(부)',37:'제출/점검표(부)',38:'제출/보고서(부)',39:'제출/USB(개)',40:'메일 발송일자',
  44:'계약 시작일자',45:'계약 종료일자',46:'성능점검 (VAT 별도)',47:'유지점검 (VAT 별도)',48:'유지관리자 선임 (VAT 별도)',49:'계약금액 (VAT 별도)',50:'문서작성 매출 (VAT 별도)'
};
let me=null,currentFilter='all',lastSites=[],salesRows=[],salesImported=false;
let salesListSort={key:null,dir:'asc'},salesListColumnOrder=[];
let salesFreezeSelectMode=false,salesFreezeLayoutFrame=0,suppressSalesSortClick=false;
let salesAssignedRows=[];
let selectedUserIds=new Set();
let salesDashboardPeriod='annual',salesDashboardOwners=new Set(),salesDashboardInitialized=false;
let unwrittenRows=[],unwrittenOwnerFilter='all';
let unwrittenDisplayFields=[];
let selectedSiteIds=new Set();
const DATA_CACHE_TTL=120000;
let searchSourceRows=[],searchCacheQuery='',searchCacheReady=false,searchLoadedAt=0,searchRequestSeq=0;
let unwrittenCacheReady=false,unwrittenLoadedAt=0,unwrittenLoadPromise=null;
let salesCacheReady=false,salesLoadedAt=0,salesLoadPromise=null;
let usersCacheReady=false,usersLoadedAt=0,usersRows=[];
function cacheFresh(ts){return !!ts&&(Date.now()-ts)<DATA_CACHE_TTL}
function invalidateDataCaches(scope='all'){
 if(scope==='all'||scope==='sites'){searchCacheReady=false;searchLoadedAt=0;searchSourceRows=[];searchCacheQuery='';unwrittenCacheReady=false;unwrittenLoadedAt=0;salesCacheReady=false;salesLoadedAt=0}
 if(scope==='all')salesAssignedRows=[];
 if(scope==='all'||scope==='users'){usersCacheReady=false;usersLoadedAt=0;usersRows=[]}
}
function activePageName(){return document.querySelector('.page.active')?.id?.replace(/^page-/,'')||savedPage()}
async function refreshActiveData(force=false){const name=activePageName();if(name==='search')return searchSites(force);if(name==='unwritten')return loadUnwrittenDashboard(force);if(name==='sales')return loadSales(force);if(name==='users')return loadUsers(force)}
const DEFAULT_DISPLAY_FIELDS=['S/N','보고서  등급','현장명','지역','문서작성 > 담당','현장점검원','문서작성 진행 현황 > 현황 > 보고서 작성 완료'];
let displayFields=[...DEFAULT_DISPLAY_FIELDS];
function selectableDisplayFields(){return schema.fields.filter(f=>!f.financial&&f.col<=45&&!HIDDEN_UI_FIELD_COLS.has(Number(f.col))&&String(f.label||'').trim())}
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
const canViewSales=()=>isAdmin()||can('can_view_staff_sales');
const canExportSales=()=>isAdmin()||can('can_export_staff_sales');
const canPrintSales=()=>isAdmin()||can('can_print_staff_sales');
const canImportSites=()=>isAdmin()||can('can_import_staff_sites');
const canManageUsers=()=>isAdmin()||can('can_manage_staff_users');
const canViewMoney=()=>isAdmin()||can('can_view_money');
const canCreateMoney=()=>isAdmin()||can('can_create_money');
const canEditMoney=()=>isAdmin()||can('can_edit_money');
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
function displayNumber(v,decimals=0){const raw=String(v??'').trim().replace(/,/g,'');if(!raw)return'';const n=Number(raw);if(!Number.isFinite(n))return String(v??'').trim();return n.toLocaleString('ko-KR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})}
function formatDisplayCell(v,col){const normalized=normalizeCell(v,col);if(Number(col)===6)return displayNumber(normalized,2);if(Number(col)===7)return displayNumber(normalized,0);return normalized}
function enterNavVisible(el){
 if(!el||el.disabled)return false;
 if(el.matches?.('input[type="hidden"],input[type="checkbox"],input[type="radio"],input[type="file"]'))return false;
 if(el.matches?.('input[readonly],textarea[readonly]'))return false;
 if(el.closest?.('.hidden'))return false;
 const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden')return false;
 return el.getClientRects().length>0;
}
function enterNavControls(form){
 return [...form.querySelectorAll('input,select,textarea,button[type="submit"]')].filter(el=>{
  if(el.tagName==='BUTTON')return !el.disabled&&el.getClientRects().length>0&&!el.closest('.hidden');
  return enterNavVisible(el);
 });
}
function focusEnterNavControl(el){
 if(!el)return false;
 try{el.focus({preventScroll:false})}catch(e){try{el.focus()}catch(err){return false}}
 try{el.scrollIntoView({block:'nearest',inline:'nearest'})}catch(e){}
 return true;
}
function moveEnterNavNext(form,current){
 const controls=enterNavControls(form),i=controls.indexOf(current);
 if(i<0)return false;
 const next=controls[i+1];
 return next?focusEnterNavControl(next):false;
}
function siteFieldInGroup(f,g){const c=Number(f?.col||0),extras=Array.isArray(g?.[3])?g[3]:[];return !!c&&((c>=Number(g?.[1]||0)&&c<=Number(g?.[2]||0))||extras.includes(c))}
function siteFieldsForGroup(g){const extras=Array.isArray(g?.[3])?g[3]:[],start=Number(g?.[1]||0),end=Number(g?.[2]||0);return schema.fields.filter(f=>siteFieldInGroup(f,g)).sort((a,b)=>{const ac=Number(a.col),bc=Number(b.col),ai=extras.indexOf(ac),bi=extras.indexOf(bc),ak=ac>=start&&ac<=end?ac:10000+(ai<0?999:ai),bk=bc>=start&&bc<=end?bc:10000+(bi<0?999:bi);return ak-bk})}
function editableSiteFieldsInOrder(){
 const seen=new Set(),out=[];
 for(const g of siteEditGroups){
  for(const f of siteFieldsForGroup(g).filter(siteFieldAllowed)){
   if(!seen.has(f.col)){seen.add(f.col);out.push(f)}
  }
 }
 return out;
}
function moveSiteEditDataFieldNext(current){
 const col=Number(current?.dataset?.siteCol||0);if(!col)return false;
 const fields=editableSiteFieldsInOrder(),idx=fields.findIndex(f=>Number(f.col)===col),next=idx>=0?fields[idx+1]:null;
 if(!next)return moveEnterNavNext($('siteEditForm'),current);
 const nextGroup=siteEditGroups.findIndex(g=>siteFieldInGroup(next,g));
 if(nextGroup<0)return moveEnterNavNext($('siteEditForm'),current);
 if(nextGroup!==siteEditGroupIndex){
  siteEditGroupIndex=nextGroup;renderSiteEditTabs();renderSiteEditFields();
  requestAnimationFrame(()=>{const el=$('siteEditFields')?.querySelector(`[data-site-col="${next.col}"]`);if(el)focusEnterNavControl(el)});
  return true;
 }
 const el=$('siteEditFields')?.querySelector(`[data-site-col="${next.col}"]`);
 return el?focusEnterNavControl(el):false;
}
function enableEnterToNext(form,{siteEditor=false}={}){
 if(!form||form.dataset.enterNextReady==='1')return;
 form.dataset.enterNextReady='1';
 form.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.isComposing||e.keyCode===229||e.ctrlKey||e.altKey||e.metaKey)return;
  const el=e.target?.closest?.('input,select,textarea');if(!el||!form.contains(el))return;
  // 주소 검색어는 기존 Enter=주소검색 동작을 유지합니다.
  if(el.id==='siteAddressQuery'||el.id==='addressQuery'||el.id==='siteTemplateQuery')return;
  const type=String(el.type||'').toLowerCase();if(['hidden','checkbox','radio','file','button','submit'].includes(type))return;
  // 전화번호 등 여러 줄 입력이 필요한 경우 Shift+Enter는 줄바꿈으로 남겨둡니다.
  if(el.tagName==='TEXTAREA'&&e.shiftKey)return;
  e.preventDefault();e.stopPropagation();
  if(siteEditor&&el.matches('[data-site-col]')){moveSiteEditDataFieldNext(el);return}
  moveEnterNavNext(form,el);
 });
}
function tableColumnWidthStorageKey(tableName){return `staff_table_column_widths:${me?.id||'guest'}:${tableName}`}
function tableResizeHeaderKey(th,index){
 return th?.dataset?.resizeKey||th?.dataset?.colKey||th?.dataset?.uwColKey||`col_${index}_${String(th?.textContent||'').replace(/\s+/g,' ').trim()}`;
}
function readTableColumnWidths(tableName){try{const v=JSON.parse(localStorage.getItem(tableColumnWidthStorageKey(tableName))||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch(e){return{}}}
function saveTableColumnWidths(tableName,widths){try{localStorage.setItem(tableColumnWidthStorageKey(tableName),JSON.stringify(widths))}catch(e){}}
function cleanResizableTableClone(table){
 const clone=table.cloneNode(true);clone.classList.remove('columnResizeEnabled');clone.removeAttribute('style');
 clone.querySelectorAll('.columnResizer').forEach(x=>x.remove());
 clone.querySelectorAll('.salesFreezeCell').forEach(cell=>{cell.classList.remove('salesFreezeCell','salesFreezeCorner','salesFreezeBoundaryRight','salesFreezeBoundaryBottom');cell.style.removeProperty('left');cell.style.removeProperty('top');cell.style.removeProperty('z-index')});clone.classList.remove('salesFreezeActive','salesFreezePicking');
 clone.querySelectorAll('th[data-sales-col-key]').forEach(th=>{const key=th.dataset.salesColKey,c=typeof SALES_LIST_COLUMNS!=='undefined'?SALES_LIST_COLUMNS[key]:null;if(c)th.innerHTML=c.label;th.classList.remove('sortActive','dragging','dragBefore','dragAfter')});
 clone.querySelectorAll('col').forEach(col=>{const original=col.dataset.originalStyle;if(original!==undefined){if(original)col.setAttribute('style',original);else col.removeAttribute('style');delete col.dataset.originalStyle}});
 return clone;
}
const tableResizeTimers=new WeakMap();
function scheduleTableColumnResize(table,tableName,attempt=0){
 if(!table||!window.matchMedia('(min-width:801px)').matches)return;
 const old=tableResizeTimers.get(table);if(old)cancelAnimationFrame(old);
 const id=requestAnimationFrame(()=>{
  tableResizeTimers.delete(table);
  const first=table.querySelector('thead tr:first-child > th');
  if((!first||first.getBoundingClientRect().width<=0)&&attempt<4){setTimeout(()=>scheduleTableColumnResize(table,tableName,attempt+1),40*(attempt+1));return}
  installTableColumnResize(table,tableName);
 });
 tableResizeTimers.set(table,id);
}
function installTableColumnResize(table,tableName){
 if(!table||!window.matchMedia('(min-width:801px)').matches)return;
 const headers=[...table.querySelectorAll('thead tr:first-child > th')];if(!headers.length)return;
 if(table.classList.contains('columnResizeEnabled')&&table.querySelectorAll('.columnResizer').length===headers.length)return;
 const measuredWidths=headers.map(th=>Math.round(th.getBoundingClientRect().width));if(!measuredWidths[0])return;
 table.querySelectorAll('.columnResizer').forEach(x=>x.remove());
 let colgroup=table.querySelector(':scope > colgroup');
 if(!colgroup){colgroup=document.createElement('colgroup');table.insertBefore(colgroup,table.firstChild)}
 while(colgroup.children.length<headers.length)colgroup.appendChild(document.createElement('col'));
 while(colgroup.children.length>headers.length)colgroup.lastElementChild.remove();
 const cols=[...colgroup.children],stored=readTableColumnWidths(tableName),resolved={...stored};
 const applyTableWidth=()=>{const total=cols.reduce((sum,c)=>sum+(parseFloat(c.style.width)||0),0);table.style.setProperty('width',`${Math.ceil(total)}px`,'important');table.style.setProperty('min-width','0','important');table.style.setProperty('table-layout','fixed','important')};
 headers.forEach((th,i)=>{
  const col=cols[i],key=tableResizeHeaderKey(th,i),rectWidth=measuredWidths[i]||60;
  th.dataset.resizeKeyResolved=key;
  if(!Object.prototype.hasOwnProperty.call(col.dataset,'originalStyle'))col.dataset.originalStyle=col.getAttribute('style')||'';
  const min=th.classList.contains('siteSelectCol')?44:th.classList.contains('col-no')||th.classList.contains('uw-col-no')?54:60;
  const saved=Number(stored[key]),width=Math.max(min,Number.isFinite(saved)&&saved>0?saved:rectWidth);
  col.style.setProperty('width',`${width}px`,'important');resolved[key]=width;
  const handle=document.createElement('div');handle.className='columnResizer';handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',`${String(th.textContent||'열').replace(/\s+/g,' ').trim()} 열 폭 조절`);handle.draggable=false;
  handle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation()});
  handle.addEventListener('dragstart',e=>{e.preventDefault();e.stopPropagation()});
  handle.addEventListener('pointerdown',e=>{
   if(e.button!==0)return;e.preventDefault();e.stopPropagation();
   const startX=e.clientX,startW=parseFloat(col.style.width)||rectWidth,oldDraggable=th.getAttribute('draggable');
   th.setAttribute('draggable','false');document.body.classList.add('columnResizing');handle.classList.add('active');
   try{handle.setPointerCapture(e.pointerId)}catch(err){}
   const move=ev=>{ev.preventDefault();ev.stopPropagation();const width=Math.max(min,Math.round(startW+(ev.clientX-startX)));col.style.setProperty('width',`${width}px`,'important');resolved[key]=width;applyTableWidth();if(table.classList.contains('desktopSiteTable'))scheduleSiteFreezeLayout(table);if(table.classList.contains('unwrittenTable'))scheduleUnwrittenFreezeLayout(table);if(table.id==='salesTable')scheduleSalesFreezeLayout(table)};
   const up=ev=>{if(ev){ev.preventDefault();ev.stopPropagation()}window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);document.body.classList.remove('columnResizing');handle.classList.remove('active');if(oldDraggable===null)th.removeAttribute('draggable');else th.setAttribute('draggable',oldDraggable);saveTableColumnWidths(tableName,resolved);if(table.classList.contains('desktopSiteTable'))scheduleSiteFreezeLayout(table);if(table.classList.contains('unwrittenTable'))scheduleUnwrittenFreezeLayout(table);if(table.id==='salesTable')scheduleSalesFreezeLayout(table);setTimeout(()=>{suppressSiteSortClick=false;suppressUnwrittenSortClick=false;suppressSalesSortClick=false},80)};
   window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);applyTableWidth();
  });
  th.appendChild(handle);
 });
 table.classList.add('columnResizeEnabled');applyTableWidth();
}
function ownerParts(raw){raw=String(raw||'').trim();const m=raw.match(/^(20\d{2}|\d{2})(.*)$/);if(!m)return{year:null,owner:raw};let y=Number(m[1]);if(y<100)y+=2000;return{year:y,owner:m[2].trim()||raw}}
function inferYearMonth(vals,owner){let year=owner.year,month=Number(vals[20])||null;if(month<1||month>12)month=null;for(const ix of [31,43,44]){const m=String(vals[ix]||'').match(/^(\d{4})-(\d{2})/);if(m){year=year||Number(m[1]);month=month||Number(m[2])}}return{year,month}}
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
async function syncAddressToSameSiteName(sourceId,siteName,address,msgEl=null){
 const name=String(siteName||'').trim(),addr=String(address||'').trim();
 if(!name||!addr||!canEditSite())return{synced:false,updated:0,matched:0};
 try{
  const{data:info,error:infoError}=await sb.rpc('staff_same_site_address_info',{p_source_id:Number(sourceId)||null,p_site_name:name,p_address:addr});if(infoError)throw infoError;
  const others=Number(info?.others||0),baseName=String(info?.base_name||name).trim();
  if(msgEl&&others>0)notify(msgEl,`같은 현장 “${baseName}” 주소와 지역을 자동 반영하는 중...`,true);
  const{data,error}=await sb.rpc('staff_apply_address_to_same_name',{p_source_id:Number(sourceId)||null,p_site_name:name,p_address:addr});if(error)throw error;
  const updated=Number(data?.updated||0);invalidateDataCaches('sites');
  return{synced:others>0,updated,matched:others,baseName:String(data?.base_name||baseName).trim(),region:String(data?.region||'')};
 }catch(err){alert('동일 현장 주소·지역 자동반영 오류: '+(err?.message||err));return{synced:false,updated:0,matched:0,error:err}}
}

async function saveContact(e){
 e.preventDefault();if(!isAdmin())return notify($('contactEditMsg'),'관리자만 수정할 수 있습니다.');
 const base=String($('contactAddress').value||'').trim(),detail=addressInputMode==='manual'?'':String($('contactAddressDetail').value||'').trim();
 const fullAddress=[base,detail].filter(Boolean).join(' ').trim();
 if(!fullAddress)return notify($('contactEditMsg'),'주소를 검색해 선택하거나 직접입력해 주세요.');
 const id=Number($('contactSourceId').value),autoRegion=regionFromAddress(fullAddress),patch={client_phone:normalizePhoneList($('contactPhone').value.trim()),client_email:$('contactEmail').value.trim(),site_address:fullAddress,...(autoRegion?{region:autoRegion}:{})};
 notify($('contactEditMsg'),'저장 중...',true);
 const{error}=await sb.from('staff_site_source').update(patch).eq('id',id);if(error)return notify($('contactEditMsg'),'저장 실패: '+error.message);
 const row=lastSites.find(x=>Number(x.source_id)===id);if(row)Object.assign(row,patch);
 const siteName=String($('contactSiteName').value||row?.site_name||'').trim();
 const syncResult=await syncAddressToSameSiteName(id,siteName,fullAddress,$('contactEditMsg'));
 notify($('contactEditMsg'),syncResult.synced?`저장했습니다. 괄호 뒤 내용을 제외한 같은 현장 ${syncResult.matched.toLocaleString()}건의 주소를 자동 동기화했습니다.`:'저장했습니다.',true);
 invalidateDataCaches('sites');
 await refreshActiveData(true).catch(()=>{});
 setTimeout(()=>{$('contactEditDlg').close();if(row)openDetail(id)},350);
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
async function boot(){const{data:{session}}=await sb.auth.getSession();if(!session)return showLogin();const p=await profileFor(session.user);if(!p?.approved||!p.can_use_staff_portal){await sb.auth.signOut();showLogin();notify($('loginMsg'),'사용이 승인되지 않은 계정입니다. 관리자에게 문의하세요.');return}me=p;applyDisplayFieldPreference(p);applyUnwrittenDisplayFieldPreference(p);showApp()}
function showLogin(){siteColumnFiltersEnabled=false;siteColumnFilters.clear();$('siteColumnFilterDlg')?.close();salesDashboardInitialized=false;salesDashboardOwners.clear();salesDashboardPeriod='annual';$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
function activePageStorageKey(){return `staff_active_page:${me?.id||'guest'}`}
function pageAllowed(name){
 if(name==='search')return can('can_view_staff_sites');
 if(name==='unwritten')return isAdmin();
 if(name==='sales')return canViewSales();
 if(name==='users')return canManageUsers();
 return false;
}
function defaultPage(){return can('can_view_staff_sites')?'search':isAdmin()?'unwritten':canViewSales()?'sales':canManageUsers()?'users':'search'}
function savedPage(){
 try{const name=localStorage.getItem(activePageStorageKey());if(name&&pageAllowed(name))return name}catch(e){}
 return defaultPage();
}
function rememberPage(name){try{if(me&&pageAllowed(name))localStorage.setItem(activePageStorageKey(),name)}catch(e){}}
function showApp(){
 $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');
 $('userBadge').textContent=`${me.name||me.user_id||''} · ${isAdmin()?'관리자':'일반 사용자'}`;
 $('unwrittenNav')?.classList.toggle('hidden',!isAdmin());
 $('salesNav').classList.toggle('hidden',!canViewSales());
 $('usersNav').classList.toggle('hidden',!canManageUsers());
 $('dbImportBtn')?.classList.toggle('hidden',!canImportSites());
 $('dbDeleteAllBtn')?.classList.toggle('hidden',!isAdmin());
 $('allSitesExportBtn')?.classList.toggle('hidden',!canExportAllSites());
 $('siteCreateBtn')?.classList.toggle('hidden',!canCreateSite());
 $('newUserBtn')?.classList.toggle('hidden',!isAdmin());
 $('salesImport')?.classList.toggle('hidden',!isAdmin());
 $('salesExport')?.classList.toggle('hidden',!isAdmin());
 $('salesPrint')?.classList.toggle('hidden',!isAdmin());
 showPage(savedPage(),false);
 if(can('can_view_staff_sites'))refreshDbStatus();
}
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
    me=p;applyDisplayFieldPreference(p);applyUnwrittenDisplayFieldPreference(p);showApp();
  }catch(error){
    await sb.auth.signOut().catch(()=>{});
    notify($('loginMsg'),error?.message||'로그인에 실패했습니다. ID와 비밀번호를 확인하세요.');
  }
}
function showPage(name,save=true){
 if(name==='search'&&!can('can_view_staff_sites'))return alert('현장 검색 권한이 없습니다.');
 if(name==='unwritten'&&!isAdmin())return alert('보고서 미작성 대시보드는 관리자만 사용할 수 있습니다.');
 if(name==='sales'&&!canViewSales())return alert('매출 조회 권한이 없습니다.');
 if(name==='users'&&!canManageUsers())return alert('사용자 관리 권한이 없습니다.');
 document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.querySelectorAll('#mainNav button').forEach(x=>x.classList.toggle('active',x.dataset.page===name));$('page-'+name).classList.add('active');if(save)rememberPage(name);
 if(name==='search')searchSites(false);
 if(name==='unwritten')loadUnwrittenDashboard(false);
 if(name==='sales'){applySalesPanelCollapsed(readSalesPanelCollapsed());loadSales(false);}
 if(name==='users')loadUsers(false);
 requestAnimationFrame(()=>{if(name==='search')scheduleTableColumnResize(document.querySelector('#siteResults .desktopSiteTable'),'search-v73');if(name==='unwritten'){const t=document.querySelector('#unwrittenList .unwrittenTable');scheduleTableColumnResize(t,'unwritten');scheduleUnwrittenFreezeLayout(t)};if(name==='sales'){scheduleTableColumnResize($('salesTable'),'sales');scheduleSalesFreezeLayout($('salesTable'))};if(name==='users')scheduleTableColumnResize($('userTable'),'users')});
}
async function refreshDbStatus(){if(!me)return;try{const{count,error}=await sb.from('staff_site_search').select('*',{count:'exact',head:true});if(error)throw error;const el=$('dbStatus');if((count||0)>0){el.className='statusBanner ok';el.innerHTML=`<strong>현장 DB ${Number(count).toLocaleString()}건</strong>이 서버에 저장되어 있습니다. 승인된 직원은 PC와 휴대폰에서 동일한 자료를 조회합니다.`}else{el.className='statusBanner warn';el.innerHTML=`<strong>현장 DB가 비어 있습니다.</strong> 관리자 계정에서 [전체 DB 엑셀 갱신]으로 현장 Excel을 등록하거나 [현장 직접등록]을 이용하세요.`}}catch(e){$('dbStatus').className='statusBanner warn';$('dbStatus').textContent='DB 상태 확인 실패: '+e.message}}
async function fetchPaged(table,select='*',mutator=null){let from=0,all=[];const size=1000;for(;;){let q=sb.from(table).select(select).range(from,from+size-1);if(mutator)q=mutator(q);const{data,error}=await q;if(error)throw error;all.push(...(data||[]));if(!data||data.length<size)break;from+=size}return all}
function applySearchCache(){
 lastSites=siteColumnFiltersEnabled?[...searchSourceRows]:searchSourceRows.filter(filterOk);selectedSiteIds.clear();$('searchMeta').textContent=`검색 ${searchSourceRows.length.toLocaleString()}건 · 현재 조건 ${lastSites.length.toLocaleString()}건`;renderSites();
}
async function searchSites(force=false){
 if(!can('can_view_staff_sites'))return;
 const q=siteColumnFiltersEnabled?'':$('siteQuery').value.trim(),sameQuery=searchCacheReady&&searchCacheQuery===q;
 if(!force&&sameQuery&&cacheFresh(searchLoadedAt)){applySearchCache();return}
 const requestId=++searchRequestSeq;$('searchMeta').textContent='검색 중...';
 try{
  const rows=await fetchPaged('staff_site_search_list','*',query=>{query=query.order('excel_row',{ascending:true}).order('source_id',{ascending:true});if(q){const term=q.replace(/[%_,()]/g,' ').trim();query=query.or(`site_name.ilike.%${term}%,previous_name.ilike.%${term}%,region.ilike.%${term}%,sn.ilike.%${term}%,document_owner.ilike.%${term}%,field_inspector.ilike.%${term}%,sales_manager.ilike.%${term}%`)}return query});
  if(requestId!==searchRequestSeq)return;
  searchSourceRows=rows;searchCacheQuery=q;searchCacheReady=true;searchLoadedAt=Date.now();applySearchCache();
 }catch(e){if(requestId!==searchRequestSeq)return;$('searchMeta').textContent='검색 오류: '+e.message;$('siteResults').innerHTML=''}
}
function refilterSearchSites(){const q=siteColumnFiltersEnabled?'':$('siteQuery').value.trim();if(searchCacheReady&&searchCacheQuery===q){applySearchCache();return}searchSites(false)}
function siteStatusLabel(r){const s=statusOf(r);return s==='complete'?'보고서 완료':s==='unwritten'?'보고서 미작성':s==='checking'?'점검 진행 중':s==='target'?'점검대상':'전체 진행 중'}

let siteFreezeSelectMode=false;
function siteFreezeStorageKey(){return `staff_site_freeze_panes:${me?.id||'guest'}`}
function readSiteFreezePanes(){
 try{const v=JSON.parse(localStorage.getItem(siteFreezeStorageKey())||'{}');return{rows:Math.max(0,Number(v?.rows)||0),cols:Math.max(0,Number(v?.cols)||0)}}catch(e){return{rows:0,cols:0}}
}
function saveSiteFreezePanes(rows,cols){try{localStorage.setItem(siteFreezeStorageKey(),JSON.stringify({rows:Math.max(0,rows|0),cols:Math.max(0,cols|0)}))}catch(e){}}
function clearSiteFreezePanes(){siteFreezeSelectMode=false;saveSiteFreezePanes(0,0);const table=document.querySelector('#siteResults .desktopSiteTable');if(table)applySiteFreezePanes(table);updateSiteFreezeControls()}
function siteFreezeStatusText(){
 const f=readSiteFreezePanes();
 if(siteFreezeSelectMode)return '표에서 기준 셀을 클릭하세요. 클릭한 셀의 위쪽 행과 왼쪽 열이 고정됩니다.';
 if(!f.rows&&!f.cols)return '고정 안 됨';
 const rowText=f.rows?`위쪽 ${Math.max(0,f.rows-1)}개 현장행 + 제목행`:'';
 const colText=f.cols?`왼쪽 ${f.cols}개 열`:'';
 return [rowText,colText].filter(Boolean).join(' · ')+' 고정 중';
}
function updateSiteFreezeControls(){
 const root=$('siteResults');if(!root)return;
 const selectBtn=root.querySelector('[data-site-freeze-select]'),clearBtn=root.querySelector('[data-site-freeze-clear]'),status=root.querySelector('[data-site-freeze-status]');
 if(selectBtn){selectBtn.classList.toggle('active',siteFreezeSelectMode);selectBtn.textContent=siteFreezeSelectMode?'📍 고정할 셀을 클릭하세요':'📌 틀 고정 위치 선택'}
 const f=readSiteFreezePanes();if(clearBtn)clearBtn.disabled=!f.rows&&!f.cols;
 if(status)status.textContent=siteFreezeStatusText();
}
let siteFreezeLayoutFrame=0;
function scheduleSiteFreezeLayout(table){
 if(!table||!window.matchMedia('(min-width:801px)').matches)return;
 if(siteFreezeLayoutFrame)cancelAnimationFrame(siteFreezeLayoutFrame);
 siteFreezeLayoutFrame=requestAnimationFrame(()=>{siteFreezeLayoutFrame=0;applySiteFreezePanes(table)});
}
function resetSiteFreezeStyles(table){
 if(!table)return;
 table.querySelectorAll('th,td').forEach(cell=>{
  cell.classList.remove('siteFreezeCell','siteFreezeCorner','siteFreezeBoundaryRight','siteFreezeBoundaryBottom');
  cell.style.removeProperty('--site-freeze-left');cell.style.removeProperty('--site-freeze-top');cell.style.removeProperty('left');cell.style.removeProperty('top');cell.style.removeProperty('z-index');
 });
 table.classList.remove('siteFreezeActive');
}
function applySiteFreezePanes(table){
 if(!table||!window.matchMedia('(min-width:801px)').matches)return;
 resetSiteFreezeStyles(table);
 const f=readSiteFreezePanes(),allRows=[...table.rows];if(!allRows.length)return;
 const rowCount=Math.min(f.rows,allRows.length),colCount=Math.min(f.cols,allRows[0]?.cells?.length||0);
 if(!rowCount&&!colCount){updateSiteFreezeControls();return}
 table.classList.add('siteFreezeActive');
 const colLeft=[];let left=0;
 for(let c=0;c<colCount;c++){
  colLeft[c]=left;
  const ref=allRows[0]?.cells?.[c];left+=ref?ref.getBoundingClientRect().width:0;
 }
 const rowTop=[];let top=0;
 for(let r=0;r<rowCount;r++){
  rowTop[r]=top;
  top+=allRows[r]?.getBoundingClientRect().height||0;
 }
 allRows.forEach((row,r)=>[...row.cells].forEach((cell,c)=>{
  const freezeRow=r<rowCount,freezeCol=c<colCount;if(!freezeRow&&!freezeCol)return;
  cell.classList.add('siteFreezeCell');
  if(freezeCol){cell.style.setProperty('--site-freeze-left',`${Math.round(colLeft[c]||0)}px`);cell.style.left=`${Math.round(colLeft[c]||0)}px`}
  if(freezeRow){cell.style.setProperty('--site-freeze-top',`${Math.round(rowTop[r]||0)}px`);cell.style.top=`${Math.round(rowTop[r]||0)}px`}
  if(freezeRow&&freezeCol){cell.classList.add('siteFreezeCorner');cell.style.zIndex='8'}
  else if(freezeRow){cell.style.zIndex='6'}
  else if(freezeCol){cell.style.zIndex='5'}
  if(freezeCol&&c===colCount-1)cell.classList.add('siteFreezeBoundaryRight');
  if(freezeRow&&r===rowCount-1)cell.classList.add('siteFreezeBoundaryBottom');
 }));
 updateSiteFreezeControls();
}
function selectSiteFreezeCell(cell){
 const table=cell?.closest?.('.desktopSiteTable');if(!table)return;
 const row=cell.parentElement,rowIndex=[...table.rows].indexOf(row),colIndex=[...row.cells].indexOf(cell);
 if(rowIndex<0||colIndex<0)return;
 saveSiteFreezePanes(rowIndex,colIndex);siteFreezeSelectMode=false;applySiteFreezePanes(table);updateSiteFreezeControls();
 const rowLabel=Math.max(0,rowIndex-1),colLabel=colIndex;
 const parts=[];if(rowIndex)parts.push(rowLabel?`제목행과 위쪽 현장 ${rowLabel}개`:'제목행');if(colIndex)parts.push(`왼쪽 ${colLabel}개 열`);
 if(!parts.length)parts.push('고정 영역 없음');
 const status=$('siteResults')?.querySelector('[data-site-freeze-status]');if(status)status.textContent=parts.join(' · ')+'을 고정했습니다.';
}
function bindSiteFreezeControls(root,table){
 if(!root||!table)return;
 const selectBtn=root.querySelector('[data-site-freeze-select]'),clearBtn=root.querySelector('[data-site-freeze-clear]');
 if(selectBtn)selectBtn.onclick=()=>{siteFreezeSelectMode=!siteFreezeSelectMode;updateSiteFreezeControls();table.classList.toggle('siteFreezePicking',siteFreezeSelectMode)};
 if(clearBtn)clearBtn.onclick=()=>{table.classList.remove('siteFreezePicking');clearSiteFreezePanes()};
 table.addEventListener('click',e=>{
  if(!siteFreezeSelectMode)return;
  const cell=e.target.closest('th,td');if(!cell||!table.contains(cell))return;
  e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();
  table.classList.remove('siteFreezePicking');selectSiteFreezeCell(cell);
 },true);
 updateSiteFreezeControls();scheduleSiteFreezeLayout(table);
}

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
  if(field)return{key,label:siteCompactFieldLabel(field,'search'),sortable:true,field};
 }
 return SITE_LIST_SPECIAL_COLUMNS.no;
}
function siteFieldDisplayValue(r,field){
 const raw=r?.safe_values?.[field.col-1]??'';
 return formatDisplayCell(raw,field.col);
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
 if(!dragKey||!targetKey||dragKey===targetKey||['no','actions'].includes(dragKey)||['no','actions'].includes(targetKey))return;
 const next=siteListColumnOrder.filter(k=>k!==dragKey),idx=next.indexOf(targetKey);
 if(idx<0)return;
 next.splice(idx+(placeAfter?1:0),0,dragKey);
 siteListColumnOrder=next;
 try{localStorage.setItem(siteListOrderStorageKey(),JSON.stringify(siteListColumnOrder))}catch(e){}
 renderSites();
}
// 현장 목록: 각 열은 복수 값 선택, 서로 다른 열은 AND 조건으로 필터합니다.
let siteColumnFiltersEnabled=false;
const siteColumnFilters=new Map();
function siteFilterValue(row,key){return String(siteListSortValue(row,key)??'').trim()}
function filteredSiteRows(rows,exceptKey=null){
 const allowed=new Set(activeSiteListKeys());
 if(!siteColumnFiltersEnabled)return rows;
 return rows.filter(row=>[...siteColumnFilters].every(([key,values])=>key===exceptKey||!allowed.has(key)||values.has(siteFilterValue(row,key))));
}
function siteColumnFilterToolbarHtml(count){
 const columns=activeSiteListColumns().filter(c=>c.field),active=columns.filter(c=>siteColumnFilters.has(c.key));
 return `<div class="siteColumnFilterToolbar"><button type="button" class="primary" data-site-filter-enable ${siteColumnFiltersEnabled?'disabled':''}>필터추가</button><button type="button" class="ghost" data-site-filter-disable ${siteColumnFiltersEnabled?'':'disabled'}>필터해제</button>${siteColumnFiltersEnabled?`<label>열 필터 <select data-site-filter-column><option value="">항목 선택</option>${columns.map(c=>`<option value="${esc(c.key)}">${esc(siteListColumn(c.key).label)}${siteColumnFilters.has(c.key)?' · 적용중':''}</option>`).join('')}</select></label><span role="status">전체 DB 필터 결과 ${count.toLocaleString()} / ${lastSites.length.toLocaleString()}건${active.length?` · ${active.length}개 열 적용중`:''}</span>`:''}</div>`;
}
function bindSiteColumnFilters(root){
 const enable=root.querySelector('[data-site-filter-enable]');if(enable)enable.onclick=async()=>{siteColumnFiltersEnabled=true;siteColumnFilters.clear();selectedSiteIds.clear();lastSites=[];renderSites();await searchSites(true)};
 const disable=root.querySelector('[data-site-filter-disable]');if(disable)disable.onclick=async()=>{siteColumnFiltersEnabled=false;siteColumnFilters.clear();selectedSiteIds.clear();$('siteColumnFilterDlg')?.close();await searchSites(true)};
 root.querySelectorAll('[data-site-filter]').forEach(button=>{
  ['pointerdown','mousedown','dragstart'].forEach(name=>button.addEventListener(name,e=>e.stopPropagation()));
  button.onclick=e=>{e.preventDefault();e.stopPropagation();openSiteColumnFilter(button.dataset.siteFilter)};
 });
 const select=root.querySelector('[data-site-filter-column]');if(select)select.onchange=()=>{if(select.value)openSiteColumnFilter(select.value);select.value=''};
 const clear=root.querySelector('[data-site-filter-clear-all]');if(clear)clear.onclick=()=>{siteColumnFilters.clear();selectedSiteIds.clear();renderSites()};
}
function openSiteColumnFilter(key){
 const column=siteListColumn(key);if(!siteColumnFiltersEnabled||!column.field)return;
 let dialog=$('siteColumnFilterDlg');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='siteColumnFilterDlg';dialog.className='siteColumnFilterDlg';document.body.appendChild(dialog)}
 const counts=new Map();filteredSiteRows(lastSites,key).forEach(row=>{const value=siteFilterValue(row,key);counts.set(value,(counts.get(value)||0)+1)});
 const applied=siteColumnFilters.get(key);if(applied)applied.forEach(value=>{if(!counts.has(value))counts.set(value,0)});
 const values=[...counts.keys()].sort(compareSiteListValues),draft=new Set(applied||values);
 dialog.innerHTML=`<div class="siteFilterHead"><h3>${esc(column.label)} 필터</h3><button type="button" data-filter-close aria-label="닫기">닫기</button></div><input type="search" data-filter-search placeholder="선택할 값 검색" aria-label="필터 값 검색"><div class="siteFilterTools"><button type="button" data-filter-select>검색값 전체 선택</button><button type="button" data-filter-deselect>검색값 선택 해제</button></div><div class="siteFilterValues"></div><div class="siteFilterFoot"><button type="button" data-filter-reset>이 열 필터 해제</button><button type="button" class="primary" data-filter-apply>적용</button></div>`;
 const search=dialog.querySelector('[data-filter-search]'),list=dialog.querySelector('.siteFilterValues');let shown=values;
 const render=()=>{const term=search.value.trim().toLocaleLowerCase('ko-KR');shown=values.filter(value=>(value||'(공란)').toLocaleLowerCase('ko-KR').includes(term));list.innerHTML=shown.map(value=>`<label><input type="checkbox" data-filter-value="${esc(value)}" ${draft.has(value)?'checked':''}><span>${esc(value||'(공란)')}</span><small>${counts.get(value).toLocaleString()}건</small></label>`).join('')||'<p>일치하는 값이 없습니다.</p>';list.querySelectorAll('[data-filter-value]').forEach(input=>input.onchange=()=>{if(input.checked)draft.add(input.dataset.filterValue);else draft.delete(input.dataset.filterValue)})};
 search.oninput=render;
 dialog.querySelector('[data-filter-select]').onclick=()=>{shown.forEach(value=>draft.add(value));render()};
 dialog.querySelector('[data-filter-deselect]').onclick=()=>{shown.forEach(value=>draft.delete(value));render()};
 dialog.querySelector('[data-filter-close]').onclick=()=>dialog.close();
 dialog.querySelector('[data-filter-reset]').onclick=()=>{siteColumnFilters.delete(key);selectedSiteIds.clear();dialog.close();renderSites()};
 dialog.querySelector('[data-filter-apply]').onclick=()=>{if(values.every(value=>draft.has(value)))siteColumnFilters.delete(key);else siteColumnFilters.set(key,new Set(draft));selectedSiteIds.clear();dialog.close();renderSites()};
 render();dialog.showModal();search.focus();
}

function siteListHeaderHtml(key){
 const c=siteListColumn(key),active=siteListSort.key===key,arrow=active?(siteListSort.dir==='asc'?' ▲':' ▼'):'';
 return `<th class="col-dynamic ${c.sortable?'sortableHeader':''} ${active?'sortActive':''}" data-col-key="${key}" data-sortable="${c.sortable?'1':'0'}" draggable="true" title="${c.sortable?'클릭: 정렬 · ':''}드래그: 열 이동"><span>${esc(c.label)}${arrow}</span>${c.field&&siteColumnFiltersEnabled?`<button type="button" class="siteColumnFilterBtn ${siteColumnFilters.has(key)?'filterActive':''}" data-site-filter="${key}" aria-label="${esc(c.label)} 필터" title="${siteColumnFilters.has(key)?'필터 적용중 · 클릭하여 변경':'열 필터'}">${siteColumnFilters.has(key)?'▼●':'▽'}</button>`:''}</th>`;
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
  th.addEventListener('click',e=>{if(e.target.closest('[data-site-filter]')||suppressSiteSortClick)return;toggleSiteListSort(th.dataset.colKey)});
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
  invalidateDataCaches('sites');await Promise.all([refreshDbStatus(),searchSites(true)]);
  alert(`${deleted.toLocaleString()}개 현장을 삭제했습니다.`);
 }catch(e){alert('선택 현장 삭제 오류: '+(e?.message||e))}
}
function renderSites(){
 const root=$('siteResults');
 if(!lastSites.length){selectedSiteIds.clear();root.innerHTML=siteColumnFilterToolbarHtml(0)+'<div class="siteCard">검색 결과가 없습니다.</div>';bindSiteColumnFilters(root);return}
 const filtered=filteredSiteRows(lastSites);
 const filterToolbar=siteColumnFilterToolbarHtml(filtered.length);
 const desktop=window.matchMedia('(min-width: 801px)').matches;
 if(desktop){
   ensureSiteListColumnOrder();
   const sorted=sortedSiteRows(filtered),visible=siteColumnFiltersEnabled?sorted:sorted.slice(0,600);
   const selectHead=isAdmin()?'<th class="center siteSelectCol"><input type="checkbox" data-site-select-master aria-label="현재 표시된 현장 전체선택"></th>':'';
   const rows=visible.map((r,i)=>`<tr class="siteListRow" data-detail="${r.source_id}" tabindex="0" aria-label="${esc(r.site_name)} 상세조회">${isAdmin()?`<td class="center siteSelectCol"><input type="checkbox" class="siteRowCheck" data-site-select="${r.source_id}" aria-label="${esc(r.site_name)} 선택"></td>`:''}${siteListColumnOrder.map(key=>siteListCellHtml(r,key,i)).join('')}</tr>`).join('');
   const headers=siteListColumnOrder.map(siteListHeaderHtml).join('');
   root.innerHTML=`<div class="desktopSiteList"><div class="siteListActionRow">${siteSelectionBarHtml(visible)}<div class="siteFreezeToolbar"><div class="siteFreezeButtons"><button type="button" class="ghost siteFreezeSelectBtn" data-site-freeze-select>📌 틀 고정 위치 선택</button><button type="button" class="ghost" data-site-freeze-clear>🔓 틀 고정 해제</button></div><span class="siteFreezeStatus" data-site-freeze-status></span></div>${filterToolbar}</div><div class="desktopListHint"><strong>틀 고정:</strong> 위치 선택 버튼 → 원하는 셀 클릭 (선택 셀의 위쪽·왼쪽 고정) · <strong>정렬:</strong> 제목 클릭 · <strong>열 이동:</strong> 제목 드래그 · <strong>열 폭:</strong> 제목 오른쪽 경계 드래그</div><div class="desktopSiteTableWrap"><table class="desktopSiteTable"><thead><tr>${selectHead}${headers}</tr></thead><tbody>${rows||`<tr><td colspan="${siteListColumnOrder.length+(isAdmin()?1:0)}">필터 조건에 맞는 현장이 없습니다. 필터를 변경하거나 해제하세요.</td></tr>`}</tbody></table></div></div>${!siteColumnFiltersEnabled&&filtered.length>600?'<div class="listLimitNotice">화면 성능을 위해 정렬된 결과 중 처음 600건만 표시합니다. 전체선택은 현재 표시된 행을 대상으로 합니다.</div>':''}`;
   bindSiteListHeaderInteractions(root);bindSiteColumnFilters(root);
   root.querySelectorAll('.siteListRow').forEach(tr=>{
     tr.onclick=e=>{if(e.target.closest('button,a,input,select,th'))return;openDetail(Number(tr.dataset.detail))};
     tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){if(e.target.closest('input,button'))return;e.preventDefault();openDetail(Number(tr.dataset.detail))}};
   });
   root.querySelectorAll('[data-detail-btn]').forEach(b=>b.onclick=e=>{e.stopPropagation();openDetail(Number(b.dataset.detailBtn))});
   root.querySelectorAll('[data-site-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openSiteEditor(Number(b.dataset.siteEdit))});
   bindSiteSelectionControls(root,visible);
   const siteTable=root.querySelector('.desktopSiteTable');bindSiteFreezeControls(root,siteTable);
   scheduleTableColumnResize(siteTable,'search-v73');setTimeout(()=>scheduleSiteFreezeLayout(siteTable),80);
   return;
 }
 const sortedMobile=sortedSiteRows(filtered),visible=siteColumnFiltersEnabled?sortedMobile:sortedMobile.slice(0,600);
 root.innerHTML=filterToolbar+siteSelectionBarHtml(visible)+(filtered.length?'':'<div class="siteCard">필터 조건에 맞는 현장이 없습니다. 필터를 변경하거나 해제하세요.</div>')+visible.map(r=>{
  const fieldsHtml=displayFields.map(f=>{const meta=schema.fields.find(x=>x.label===f),v=meta?formatDisplayCell(r.safe_values?.[meta.col-1]??'',meta.col):val(r,f);return `<div><span>${esc(f)}</span><b>${esc(v||'-')}</b></div>`}).join('');
  const p1=r.field_plan_start?'done':'',p2=r.field_end?'done':(r.field_plan_start?'working':''),p3=r.report_complete_date?'done':(r.field_end?'working':'');
  const manual=Number(r.excel_row)<0?'<span class="tag directTag">직접등록</span>':'';
  const edit=canEditSite()?`<button class="primary smallBtn" data-site-edit="${r.source_id}">수정</button>`:'';
  const select=isAdmin()?`<label class="mobileSiteSelect"><input type="checkbox" class="siteCardCheck" data-site-select="${r.source_id}"> 선택</label>`:'';
  return `<article class="siteCard"><div class="siteSelectionMeta">${select}<span>${manual}</span></div><div class="miniGrid selectedFieldsGrid">${fieldsHtml}</div><div class="stepRow"><div class="step ${p1}">점검계획</div><div class="step ${p2}">현장점검</div><div class="step ${p3}">보고서</div></div><div class="siteActions">${edit}<button data-detail="${r.source_id}">상세 조회</button></div></article>`
 }).join('')+(!siteColumnFiltersEnabled&&filtered.length>600?`<div class="siteCard">화면 성능을 위해 처음 600건만 표시합니다. 전체선택은 현재 표시된 카드만 대상으로 합니다.</div>`:'');
 root.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(Number(b.dataset.detail)));
 root.querySelectorAll('[data-site-edit]').forEach(b=>b.onclick=()=>openSiteEditor(Number(b.dataset.siteEdit)));
 bindSiteSelectionControls(root,visible);bindSiteColumnFilters(root);
}
async function ensureFullSiteRow(id,row=null){
 let r=row||lastSites.find(x=>Number(x.source_id)===Number(id))||searchSourceRows.find(x=>Number(x.source_id)===Number(id))||{};
 if(r?._secureDetailLoaded)return r;
 const{data,error}=await sb.rpc('staff_site_secure_detail',{p_source_id:Number(id)});if(error)throw error;if(!data)return Object.keys(r).length?r:null;
 const vals=Array.isArray(data?.values)?data.values:[];
 const merged={...r,source_id:Number(data?.source_id||id),site_name:data?.site_name||r.site_name||'',safe_values:vals,client_phone:data?.client_phone??r.client_phone,client_email:data?.client_email??r.client_email,site_address:data?.site_address??r.site_address,_secureDetailLoaded:true};
 const ix=lastSites.findIndex(x=>Number(x.source_id)===Number(id));if(ix>=0)lastSites[ix]=merged;
 return merged;
}
function siteMoneyFieldLabel(f){return ({46:'성능점검 (VAT 별도)',47:'유지점검 (VAT 별도)',48:'유지관리자 선임 (VAT 별도)',49:'계약금액 (VAT 별도)',50:'문서작성 매출 (VAT 별도)',51:'제본비',52:'매출액 대비 제본비 비율'})[Number(f?.col)]||f?.label||''}
function siteQuantityEquipmentLabel(f){const col=Number(f?.col||0),label=String(f?.label||'').trim();if(!((col>=55&&col<=81)||(col>=83&&col<=109)||(col>=111&&col<=137)))return label;let name=(label.includes('>')?label.split('>').pop():label).trim();name=name.replace(/\s+(?:[A-Z]{1,2}|[ㄱ-ㅎㅏ-ㅣ가-힣])$/u,'').trim();if(name==='펌프(냉난방)')name='펌프';return name}
function siteCompactFieldLabel(f,mode='detail'){
 const col=Number(f?.col||0),raw=String(f?.label||'').trim();
 if(f?.financial)return siteMoneyFieldLabel(f);
 const isMaintain=col>=55&&col<=81,isTarget=col>=83&&col<=109,isConfirmed=col>=111&&col<=137;
 if(isMaintain||isTarget||isConfirmed){
  const equipment=siteQuantityEquipmentLabel(f);
  if(mode==='detail')return equipment;
  if(isMaintain)return `유지관리/${equipment}`;
  if(isTarget)return `점검대상/${equipment}`;
  return `점검수량/${equipment}`;
 }
 return COMPACT_FIELD_LABELS[col]||raw;
}
function siteDisplayFieldLabel(f){return siteCompactFieldLabel(f,'detail')}
function siteExportFieldLabel(f){return siteCompactFieldLabel(f,'export')}
function siteDateInputValue(v){
 const s=String(v??'').trim();if(!s)return'';
 if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
 let m=s.match(/^(\d{4})[.\/]\s*(\d{1,2})[.\/]\s*(\d{1,2})/);if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
 m=s.match(/^(\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);if(m)return `${2000+Number(m[1])}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
 return'';
}
function maintenanceManagerSelectOptions(v){
 const cur=String(v??'').trim(),base=['','O','X'],vals=base.includes(cur)?base:[...base,cur];
 return vals.map(x=>`<option value="${esc(x)}" ${x===cur?'selected':''}>${x===''?'선택 안 함':(x===cur&&!base.includes(cur)?`기존값: ${esc(x)}`:esc(x))}</option>`).join('');
}
function siteMoneyDisplay(v,col){
 const c=Number(col),raw=String(v??'').trim().replace(/,/g,'');if(!raw)return '-';const n=Number(raw);if(!Number.isFinite(n))return String(v);
 if(c===52){const pct=Math.abs(n)<=1?n*100:n;return pct.toLocaleString('ko-KR',{maximumFractionDigits:4})+'%'}
 if([46,47,48,49,50,51].includes(c))return n.toLocaleString('ko-KR',{maximumFractionDigits:2})+'원';
 return formatDisplayCell(v,col);
}
function siteMoneyInput(v,col){
 const c=Number(col),raw=String(v??'').trim().replace(/[,％%]/g,'');if(!raw)return '';const n=Number(raw);if(!Number.isFinite(n))return String(v??'');
 if(c===52){const pct=Math.abs(n)<=1?n*100:n;return pct.toLocaleString('ko-KR',{maximumFractionDigits:4})}
 if([46,47,48,49,50,51].includes(c))return n.toLocaleString('ko-KR',{maximumFractionDigits:2});
 return normalizeCell(v,col);
}
function siteFinancialRawInput(v,col){
 const c=Number(col),raw=String(v??'').trim().replace(/[,％%]/g,'');if(!raw)return '';const n=Number(raw);if(!Number.isFinite(n))return v;
 if(c===52)return String(n/100);
 return v;
}
function siteMoneyNumber(v){const raw=String(v??'').trim().replace(/[,원\s]/g,'');if(raw==='')return null;const n=Number(raw);return Number.isFinite(n)?n:null}
function calculatedInspectionType(){
 const hasCount=col=>{const raw=String(siteEditValues[col-1]??'').trim().replace(/,/g,'');return raw!==''&&Number.isFinite(Number(raw))};
 const performance=hasCount(10),maintenance=hasCount(12),manager=String(siteEditValues[13]??'').trim()!=='';
 if(performance&&maintenance&&manager)return '성능+유지+유지선임';
 if(performance&&maintenance)return '성능 + 유지';
 return [performance?'성능':'',maintenance?'유지':'',manager?'유지 선임':''].filter(Boolean).join(' + ');
}
function syncInspectionType(updateInput=true){
 const value=calculatedInspectionType();siteEditValues[24]=value;
 if(updateInput){const input=$('siteEditFields')?.querySelector('[data-site-col="25"]');if(input)input.value=value}
 return value;
}
function calculatedContractAmount(){
 const values=[45,46,47].map(index=>siteEditValues[index]);
 if(values.every(value=>String(value??'').trim()===''))return '';
 const numbers=values.map(value=>String(value??'').trim()===''?0:siteMoneyNumber(value));
 if(numbers.some(value=>value===null))return '';
 const total=numbers.reduce((sum,value)=>sum+value,0);return Number.isFinite(total)?String(Math.round((total+Number.EPSILON)*100)/100):'';
}
function syncContractAmount(updateInput=true){
 if(!(siteEditMode==='create'?canCreateMoney():canEditMoney()))return siteEditValues[48]??'';
 const value=calculatedContractAmount();siteEditValues[48]=value;
 if(updateInput){const input=$('siteEditFields')?.querySelector('[data-site-col="49"]');if(input)input.value=siteMoneyInput(value,49)}
 return value;
}
function calculatedBindingRatio(){const amount=siteMoneyNumber(siteEditValues[49]),binding=siteMoneyNumber(siteEditValues[50]);if(amount===null||amount===0||binding===null)return '';return String(binding/amount)}
function syncBindingRatioFromAmounts(updateInput=true){const ratio=calculatedBindingRatio();siteEditValues[51]=ratio;if(updateInput){const inp=$('siteEditFields')?.querySelector('[data-site-col="52"]');if(inp)inp.value=siteMoneyInput(ratio,52)}return ratio}
function regionFromAddress(address){
 const parts=String(address||'').trim().replace(/\s+/g,' ').split(' ').filter(Boolean);if(!parts.length)return '';
 const p1=parts[0]||'',p2=parts[1]||'',p3=parts[2]||'';
 const metros={'서울특별시':'서울','서울':'서울','부산광역시':'부산','부산':'부산','대구광역시':'대구','대구':'대구','인천광역시':'인천','인천':'인천','광주광역시':'광주','광주':'광주','대전광역시':'대전','대전':'대전','울산광역시':'울산','울산':'울산'};
 if(metros[p1])return [metros[p1],/(구|군)$/.test(p2)?p2:''].filter(Boolean).join(' ');
 if(p1==='세종특별자치시'||p1==='세종')return '세종';
 if(p1==='경기도'||p1==='경기'){const city=p2.replace(/(시|군)$/,'');return [city,/구$/.test(p3)?p3:''].filter(Boolean).join(' ')||'경기'}
 const provMap={'경상남도':'경남','경남':'경남','경상북도':'경북','경북':'경북','전라남도':'전남','전남':'전남','전라북도':'전북','전북특별자치도':'전북','전북':'전북','충청남도':'충남','충남':'충남','충청북도':'충북','충북':'충북','강원도':'강원','강원특별자치도':'강원','강원':'강원','제주특별자치도':'제주','제주':'제주'};
 if(provMap[p1]){const prov=provMap[p1],city=p2.replace(/(시|군)$/,'');if(prov==='제주'&&city==='제주')return '제주';return [prov,city].filter(Boolean).join(' ')}
 return p1.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/,'');
}
function siteDraftAddress(){const base=String($('siteFormAddress')?.value||'').trim(),detail=siteAddressMode==='manual'?'':String($('siteFormAddressDetail')?.value||'').trim();return [base,detail].filter(Boolean).join(' ').trim()}
function syncRegionFromSiteAddress(){
 const address=siteDraftAddress(),region=regionFromAddress(address),inp=$('siteEditFields')?.querySelector('[data-site-col="17"]'),help=$('siteEditFields')?.querySelector('[data-region-help]');
 if(address&&region){siteEditValues[16]=region;if(inp){inp.value=region;inp.readOnly=true;inp.setAttribute('aria-readonly','true')}if(help)help.textContent=`주소 기준 자동 지역: ${region}`}
 else if(inp){inp.readOnly=false;inp.removeAttribute('aria-readonly');if(help)help.textContent='주소가 없는 경우에만 지역을 직접 입력할 수 있습니다.'}
 return region;
}
function syncElectronicReceiptFromYellowFile(value){
 siteEditValues[26]=String(value??'');
 const input=$('siteEditFields')?.querySelector('[data-site-col="27"]');
 if(input)input.value=siteDateInputValue(siteEditValues[26])||'';
}
// 유사 현장의 이번 업무 실적은 새 현장에 복사하지 않습니다.
const SITE_TEMPLATE_CLEAR_COLS=[2,3,10,11,12,13,16,19,21,22,23,26,27,28,29,30,31,32,33,50,51,52];
function clearSiteTemplateWorkValues(){
 SITE_TEMPLATE_CLEAR_COLS.forEach(col=>{siteEditValues[col-1]=''});
 if(/^x$/i.test(String(siteEditValues[13]??'').trim()))siteEditValues[13]='';
}
function syncFieldEndFromPlan(){
 const plan=String(siteEditValues[28]??'').trim(),end=$('siteEditFields')?.querySelector('[data-site-col="30"]');
 if(plan)siteEditValues[29]=plan;
 if(end){if(plan)end.value=plan;end.readOnly=!!plan;end.toggleAttribute('aria-readonly',!!plan)}
 return plan;
}
const PERFORMANCE_CONFIRM_RULES={
  83:{confirmedCol:111,rate:.5,label:'50%'},84:{confirmedCol:112,rate:.5,label:'50%'},85:{confirmedCol:113,rate:1,label:'100%'},
  86:{confirmedCol:114,rate:.5,label:'50%'},87:{confirmedCol:115,rate:.5,label:'50%'},88:{confirmedCol:116,rate:1,label:'100%'},
  89:{confirmedCol:117,rate:.2,label:'20%'},
  90:{confirmedCol:118,rate:1,label:'100%'},91:{confirmedCol:119,rate:1,label:'100%'},92:{confirmedCol:120,rate:1,label:'100%'},
  93:{confirmedCol:121,rate:.2,label:'20%'},94:{confirmedCol:122,rate:.2,label:'20%'},95:{confirmedCol:123,rate:.2,label:'20%'},
  96:{confirmedCol:124,rate:.2,label:'20%'},97:{confirmedCol:125,rate:.2,label:'20%'},
  98:{confirmedCol:126,rate:1,label:'100%'},99:{confirmedCol:127,rate:1,label:'100%'},100:{confirmedCol:128,rate:1,label:'100%'},
  101:{confirmedCol:129,rate:1,label:'100%'},102:{confirmedCol:130,rate:1,label:'100%'},103:{confirmedCol:131,rate:1,label:'100%'},
  104:{confirmedCol:132,rate:1,label:'100%'},105:{confirmedCol:133,rate:1,label:'100%'},106:{confirmedCol:134,rate:1,label:'100%'},
  107:{confirmedCol:135,rate:1,label:'100%'},108:{confirmedCol:136,rate:1,label:'100%'},109:{confirmedCol:137,rate:1,label:'100%'}
};
const PERFORMANCE_CONFIRM_BY_COL=Object.fromEntries(Object.entries(PERFORMANCE_CONFIRM_RULES).map(([target,rule])=>[rule.confirmedCol,{targetCol:Number(target),...rule}]));
let sitePerformanceManualCols=new Set();
function performanceQtyNumber(v){const raw=String(v??'').trim().replace(/,/g,'');if(raw==='')return null;const n=Number(raw);return Number.isFinite(n)&&n>=0?n:null}
function calculatedPerformanceQty(targetCol){const rule=PERFORMANCE_CONFIRM_RULES[Number(targetCol)],n=performanceQtyNumber(siteEditValues[Number(targetCol)-1]);if(!rule||n===null)return '';return String(Math.ceil(n*rule.rate))}
function syncPerformanceConfirmed(targetCol,force=false){const rule=PERFORMANCE_CONFIRM_RULES[Number(targetCol)];if(!rule)return;if(!force&&sitePerformanceManualCols.has(rule.confirmedCol))return;const value=calculatedPerformanceQty(targetCol);if(value==='')return;siteEditValues[rule.confirmedCol-1]=value;const inp=$('siteEditFields')?.querySelector(`[data-site-col="${rule.confirmedCol}"]`);if(inp)inp.value=value}
function seedPerformanceConfirmedBlanks(){Object.entries(PERFORMANCE_CONFIRM_RULES).forEach(([target,rule])=>{if(String(siteEditValues[rule.confirmedCol-1]??'').trim()==='')syncPerformanceConfirmed(Number(target),true)})}
function resetPerformanceConfirmedToAuto(confirmedCol){const meta=PERFORMANCE_CONFIRM_BY_COL[Number(confirmedCol)];if(!meta)return;sitePerformanceManualCols.delete(Number(confirmedCol));syncPerformanceConfirmed(meta.targetCol,true)}
const groups=[['기본정보',1,18,[54,53]],['진행·담당·계약',19,52],['유지관리 전체수량',55,81],['성능점검 대상 전체수량',83,109],['성능점검수량',111,137]];
let quantityPrintRow=null;
const QUANTITY_PRINT_EQUIPMENT=[
 {db:0,group:'열원 및\n냉난방설비',groupRows:12,name:'냉동기(헤더 포함)',criteria:'전체수량의 50% 이상'},
 {db:1,name:'냉각탑(냉동기 관련)',criteria:'전체수량의 50% 이상'},
 {db:2,name:'축열조',criteria:'전체수량'},
 {db:3,name:'보일러\n(헤더 포함, 난방용량 42 kW 이하 제외)',criteria:'전체수량의 50% 이상'},
 {db:4,name:'열교환기',criteria:'전체수량의 50% 이상'},
 {db:5,name:'팽창탱크\n(냉·난방, 급탕 팽창탱크 포함)',criteria:'전체수량'},
 {db:6,name:'펌프(냉·난방펌프)\n(예비펌프, 모터동력 0.75 kW 이하 제외)',criteria:'전체수량의 20% 이상'},
 {db:7,name:'신재생에너지(지열)',criteria:'전체수량'},
 {db:8,name:'신재생에너지(태양열)',criteria:'전체수량'},
 {db:9,name:'신재생에너지(연료전지)',criteria:'전체수량'},
 {db:10,name:'패키지에어컨\n(냉·난방용량 7.3 kW 이하 제외(실외기 기준), 내부필터 포함)',criteria:'전체수량의 20% 이상'},
 {db:11,name:'항온항습기(내부필터 포함)',criteria:'전체수량의 20% 이상'},
 {db:12,group:'공기조화설비',groupRows:2,name:'공기조화기(송풍기포함, 내부필터 포함)',criteria:'전체수량의 20% 이상'},
 {db:13,name:'팬코일 유닛(유니트 기준, 내부필터 포함)',criteria:'전체수량의 20% 이상'},
 {db:14,group:'환기설비',groupRows:2,name:'환기설비\n(모터동력 0.75 kW 이하 및 벽부형 제외)',criteria:'전체수량의 20% 이상'},
 {db:15,name:'필터\n(필터유닛, 냄새제거 필터유닛, 특수목적필터 등 포함)',criteria:'전체수량'},
 {db:16,group:'위생기구설비',groupRows:1,name:'위생기구설비',setGroup:true},
 {db:17,group:'급수·급탕설비',groupRows:2,name:'급수펌프, 급탕탱크 등\n(모터동력 0.75 kW 이하 제외)',setGroup:true},
 {db:18,name:'고·저수조',setGroup:true},
 {db:19,group:'오·배수 통기 및\n우수배수설비',groupRows:2,name:'오·배수용 펌프(모터동력 0.75 kW 이하 제외)',setGroup:true},
 {db:19,name:'오·배수 통기 및 우수배수설비',setGroup:true},
 {db:20,group:'오수정화 및\n물 재이용설비',groupRows:2,name:'오수정화설비',setGroup:true},
 {db:21,name:'물 재이용설비',setGroup:true},
 {db:22,group:'배관설비',groupRows:1,name:'배관설비',setGroup:true},
 {db:23,group:'덕트설비',groupRows:1,name:'덕트설비',setGroup:true},
 {db:24,group:'보온설비',groupRows:1,name:'보온설비(동파방지 발열선 시스템 포함)',setGroup:true},
 {db:25,group:'자동제어설비',groupRows:1,name:'자동제어설비(BEMS, 원격검침시스템, 중앙감시반, 기계실, 공조실 포함)',setGroup:true},
 {db:26,group:'방음·방진·내진설비',groupRows:1,name:'방음·방진·내진설비',setGroup:true}
];
function quantityPrintRaw(vals,index){return Array.isArray(vals)?vals[index]??'':''}
function quantityPrintNum(v){const n=Number(String(v??'').replace(/,/g,'').trim());return Number.isFinite(n)?n:null}
function quantityPrintCount(v){const s=String(v??'').trim();if(!s)return '-';const n=quantityPrintNum(v);if(n===null)return s;if(n===0)return '-';return Math.round(n).toLocaleString('ko-KR')}
function quantityPrintMark(v){const n=quantityPrintNum(v);return n!==null&&n>0?'○':'×'}
function quantityPrintText(v,fallback='-'){const s=String(v??'').trim();return s||fallback}
function quantityPrintNl(v){return esc(quantityPrintText(v,'')).replace(/\r?\n/g,'<br>')}
function quantityPrintWithUnit(v,unit){
 const raw=String(v??'').trim();
 if(!raw||raw==='-'||raw==='—')return raw;
 const numberText=raw.replace(unit==='㎡'?/\s*(?:㎡|m²|m2)\s*$/i:/\s*세대\s*$/,'').trim();
 return numberText?`${numberText} ${unit}`:'';
}
function quantityPrintSheetHtml(row){
 const vals=Array.isArray(row?.safe_values)?row.safe_values:[];
 const site=quantityPrintRaw(vals,3)||row?.site_name||'';
 const area=quantityPrintRaw(vals,5),households=quantityPrintRaw(vals,6),approval=quantityPrintRaw(vals,7);
 const rows=QUANTITY_PRINT_EQUIPMENT.map((e,i)=>{
   const maintenance=quantityPrintRaw(vals,54+e.db),target=quantityPrintRaw(vals,82+e.db),confirmed=quantityPrintRaw(vals,110+e.db);
   const groupCell=e.group?`<td class="qtyGroup" rowspan="${e.groupRows}">${quantityPrintNl(e.group)}</td>`:'';
   const criteria=e.setGroup?(i===16?`<td class="qtySet" rowspan="12" colspan="2">식</td>`:''):`<td class="qtyNum">${quantityPrintCount(target)}</td><td class="qtyCriteria">${esc(e.criteria||'')}</td>`;
   return `<tr>${groupCell}<td class="qtyDetail">${quantityPrintNl(e.name)}</td><td class="qtyMark">${quantityPrintMark(maintenance)}</td><td class="qtyNum">${quantityPrintCount(maintenance)}</td>${criteria}<td class="qtyNum">${quantityPrintCount(confirmed)}</td></tr>`;
 }).join('');
 return `<section class="qtySheet"><table class="qtyInfoTable"><tbody><tr><th>현장명</th><td>${quantityPrintNl(site)}</td></tr><tr><th>연면적</th><td>${quantityPrintNl(quantityPrintWithUnit(area,'㎡'))}</td></tr><tr><th>세대수</th><td>${quantityPrintNl(quantityPrintWithUnit(households,'세대'))}</td></tr><tr><th>사용승인일</th><td>${quantityPrintNl(approval)}</td></tr></tbody></table><div class="qtyFormTitle">유지관리 및 성능점검 대상 기계설비의 수량 (제7조 제2항 관련)</div><table class="qtyPrintTable"><colgroup><col style="width:15%"><col style="width:35%"><col style="width:7%"><col style="width:9%"><col style="width:9%"><col style="width:18%"><col style="width:7%"></colgroup><thead><tr><th rowspan="2">기계설비</th><th rowspan="2">세부항목</th><th rowspan="2">대상<br>여부</th><th>유지관리</th><th colspan="3">성능점검</th></tr><tr><th>전체수량</th><th>전체수량</th><th>점검수량 산출기준</th><th>점검수량</th></tr></thead><tbody>${rows}</tbody></table><div class="qtyFootnote">※ 공동주택을 제외한 건축물의 유지관리점검 대상 설비의 종류와 수량은 대상 건축물의 연면적 합계가 10,000 ㎡ 이상인 경우, 해당 건축물별 설치된 설비의 종류와 수량 합계 기준이며, 성능점검 대상 설비의 종류와 수량은 단일 건물 연면적이 10,000 ㎡ 이상에 해당하는 경우이므로 유지관리 점검 대상과 성능점검 대상 설비의 종류와 수량은 차이가 날 수 있음.</div></section>`;
}
function quantityPrintCss(){return `*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font-family:Arial,'Noto Sans KR','Malgun Gothic',sans-serif}.qtySheet{width:190mm;margin:0 auto;background:#fff}.qtyInfoTable,.qtyPrintTable{width:100%;min-width:0!important;border-collapse:collapse;table-layout:fixed}.qtyInfoTable th,.qtyInfoTable td,.qtyPrintTable th,.qtyPrintTable td{border:1px solid #222;text-align:center;vertical-align:middle}.qtyInfoTable th{width:17%;font-size:11pt;padding:4px;font-weight:700}.qtyInfoTable td{font-size:10.5pt;padding:4px;min-height:7mm}.qtyFormTitle{border:1px solid #222;border-top:0;padding:8px 4px;text-align:center;font-size:13pt;font-weight:700}.qtyPrintTable th{background:#d9d9d9;font-size:9.5pt;padding:4px 2px;font-weight:700}.qtyPrintTable td{font-size:8.5pt;padding:3px 2px;line-height:1.18;white-space:normal}.qtyGroup{font-weight:700}.qtyDetail{font-size:8.2pt!important}.qtyMark,.qtyNum{font-weight:700}.qtyCriteria{font-size:8.2pt!important}.qtySet{font-size:11pt!important}.qtyFootnote{border:1px solid #222;border-top:0;padding:5px 6px;font-size:6.8pt;line-height:1.25}.qtyPrintTable tr{break-inside:avoid}.qtyPrintTable tbody tr{height:8mm}@page{size:A4 portrait;margin:8mm}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.qtySheet{width:100%;margin:0}.qtyPrintTable tbody tr{height:auto}}`;}
function openQuantityPrint(row){quantityPrintRow=row;$('quantityPrintTitle').textContent=`확정수량 출력 - ${row?.site_name||''}`;$('quantityPrintPreview').innerHTML=quantityPrintSheetHtml(row);$('quantityPrintDlg').showModal()}
function runQuantityPrint(){if(!quantityPrintRow)return;const w=window.open('','_blank','width=1000,height=900');if(!w)return alert('출력 창을 열 수 없습니다. 팝업 차단을 해제해 주세요.');const title=`확정수량_${String(quantityPrintRow?.site_name||'현장').replace(/[\\/:*?"<>|]/g,'_')}`;w.document.open();w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${quantityPrintCss()}</style></head><body>${quantityPrintSheetHtml(quantityPrintRow)}<script>window.addEventListener('load',()=>setTimeout(()=>{window.focus();window.print()},250));<\/script></body></html>`);w.document.close()}

async function openDetail(id){let r;try{r=await ensureFullSiteRow(id)}catch(e){return alert('현장 정보를 불러오지 못했습니다: '+e.message)}if(!r)return;$('detailTitle').textContent=r.site_name;const tabs=$('detailTabs');tabs.innerHTML=groups.map((g,i)=>`<button class="chip ${i===0?'active':''}" data-g="${i}">${g[0]}</button>`).join('');const render=i=>{const g=groups[i];const quantityGroup=['유지관리 전체수량','성능점검 대상 전체수량','성능점검수량'].includes(g?.[0]);$('detailBody').classList.toggle('quantityGrid',quantityGroup);const fields=siteFieldsForGroup(g).filter(f=>!HIDDEN_UI_FIELD_COLS.has(Number(f.col))&&(!f.financial||canViewMoney())&&f.label!=='관리주체 연락처/이메일');const editBar=`<div class="detailEditBar"><div class="detailActionStack"><button class="quantityOutputBtn smallBtn" data-quantity-print="${r.source_id}">확정수량 출력</button>${canEditSite()?`<button class="primary smallBtn" data-detail-site-edit="${r.source_id}">현장 정보 수정</button>`:''}</div></div>`;$('detailBody').innerHTML=editBar+(i===0||i===1?contactCards(r):'')+fields.map(f=>`<div class="detailItem ${f.financial?'financialDetailItem':''}"><span>${esc(siteDisplayFieldLabel(f))}</span><b>${esc(f.financial?siteMoneyDisplay(r.safe_values?.[f.col-1]??'',f.col):formatDisplayCell(r.safe_values?.[f.col-1]??'-',f.col))}</b></div>`).join('');bindContactActions(r);const qb=$('detailBody').querySelector('[data-quantity-print]');if(qb)qb.onclick=()=>openQuantityPrint(r);const eb=$('detailBody').querySelector('[data-detail-site-edit]');if(eb)eb.onclick=()=>{$('detailDlg').close();openSiteEditor(Number(eb.dataset.detailSiteEdit))};tabs.querySelectorAll('[data-g]').forEach(x=>x.classList.toggle('active',Number(x.dataset.g)===i))};tabs.querySelectorAll('[data-g]').forEach(x=>x.onclick=()=>render(Number(x.dataset.g)));render(0);$('detailDlg').showModal()}

const siteEditGroups=[['기본정보',1,18,[54,53]],['진행·담당·계약',19,52],['유지관리 전체수량',55,81],['성능점검 대상 전체수량',83,109],['성능점검수량',111,137]];
let siteEditMode='create',siteEditValues=Array(137).fill(''),siteEditRow=null,siteEditGroupIndex=0,siteAddressMode='search';
let siteNameSuggestTimer=null,siteNameSuggestRequest=0,siteNameSuggestions=[];
let siteTemplateSearchRequest=0,siteTemplateSearchRows=[];
function siteFieldAllowed(f){if(!f?.label?.trim())return false;if(HIDDEN_UI_FIELD_COLS.has(Number(f.col)))return false;if(f.label==='관리주체 연락처/이메일')return false;if(f.financial){if(siteEditMode==='create')return canCreateMoney();return canEditMoney()}return true}
function siteInputType(col){return dateCols.has(col)?'date':'text'}
function renderSiteEditTabs(){const root=$('siteEditTabs');root.innerHTML=siteEditGroups.map((g,i)=>{const has=schema.fields.some(f=>siteFieldInGroup(f,g)&&siteFieldAllowed(f));return has?`<button type="button" class="chip ${i===siteEditGroupIndex?'active':''}" data-site-group="${i}">${g[0]}</button>`:''}).join('');root.querySelectorAll('[data-site-group]').forEach(b=>b.onclick=()=>{siteEditGroupIndex=Number(b.dataset.siteGroup);renderSiteEditFields();renderSiteEditTabs()})}
function renderSiteEditFields(){
 syncInspectionType(false);syncContractAmount(false);
 const g=siteEditGroups[siteEditGroupIndex]||siteEditGroups[0];
 const fields=siteFieldsForGroup(g).filter(siteFieldAllowed);
 const fieldsRoot=$('siteEditFields');
 const isQuantityGroup=['유지관리 전체수량','성능점검 대상 전체수량','성능점검수량'].includes(g?.[0]);
 fieldsRoot.classList.toggle('quantityGrid',isQuantityGroup);
 fieldsRoot.dataset.groupName=g?.[0]||'';
 fieldsRoot.innerHTML=fields.map(f=>{
  if(f.col===17){const derived=regionFromAddress(siteDraftAddress());if(derived)siteEditValues[16]=derived;const v=siteEditValues[16]??'',locked=!!derived;return `<label class="siteField"><span>지역</span><input data-site-col="17" type="text" value="${esc(v)}"${locked?' readonly aria-readonly="true"':''}><small class="fieldHelp" data-region-help>${locked?`주소 기준 자동 지역: ${esc(derived)}`:'주소가 없는 경우에만 지역을 직접 입력할 수 있습니다.'}</small></label>`}
  const rawValue=f.financial?siteMoneyInput(siteEditValues[f.col-1]??'',f.col):normalizeCell(siteEditValues[f.col-1]??'',f.col),v=dateCols.has(Number(f.col))?siteDateInputValue(rawValue)||rawValue:rawValue,req=f.col===4?' required':'',fin=f.financial?' financialField':'';
  if(f.col===1&&siteEditMode==='create')return `<label class="siteField${fin}"><span>${esc(siteDisplayFieldLabel(f))}</span><div class="siteSnInputRow"><input data-site-col="1" type="text" value="${esc(v)}"><button type="button" class="ghost smallBtn" id="applyNextSnBtn">다음 S/N 적용</button></div><small class="fieldHelp">신규등록 시 현재 DB의 마지막 숫자형 S/N 다음 번호를 자동 표시합니다.</small></label>`;
  if(f.col===4&&siteEditMode==='create')return `<label class="siteField siteNameLookupField${fin}"><span>${esc(siteDisplayFieldLabel(f))} *</span><div class="siteNameLookupWrap"><input data-site-col="4" id="siteNameLookupInput" type="text" value="${esc(v)}" required autocomplete="off" placeholder="현장명 일부를 입력하면 기존 현장을 검색합니다"><div id="siteNameSuggestions" class="siteNameSuggestions hidden"></div></div><small class="fieldHelp">기존 현장정보를 복사하되 접수·점검·작성·제본 이력과 문서작성 매출은 비워 둡니다. 새 업무 내용을 입력해 등록하세요.</small></label>`;
  if(f.col===14)return `<label class="siteField"><span>${esc(siteDisplayFieldLabel(f))}</span><select data-site-col="14" aria-label="${esc(siteDisplayFieldLabel(f))}">${maintenanceManagerSelectOptions(siteEditValues[13])}</select><small class="fieldHelp">O / X / 공란 중 선택합니다.</small></label>`;
  let help=f.col===26?'<small class="fieldHelp">입력하거나 변경하면 전자파일 접수일자에 같은 날짜가 자동 입력됩니다.</small>':'';if(f.col===29)help='<small class="fieldHelp">이 날짜는 내부 현장점검 종료 기준일에도 자동으로 적용됩니다.</small>';
  if(f.col===25||f.col===49){const help=f.col===25?'계약 횟수와 선임 계약 여부 기준 자동입력':'성능점검 + 유지점검 + 유지관리자 선임 금액 자동합계';return `<label class="siteField${fin}"><span>${esc(siteDisplayFieldLabel(f))}</span><input data-site-col="${f.col}" type="text" value="${esc(v)}" readonly aria-readonly="true"><small class="fieldHelp">${help}</small></label>`}
  if(f.col===52){const ratio=syncBindingRatioFromAmounts(false);return `<label class="siteField financialField autoRatioField"><span>${esc(siteDisplayFieldLabel(f))}</span><input data-site-col="52" type="text" value="${esc(siteMoneyInput(ratio,52))}" readonly aria-readonly="true"><small class="fieldHelp">자동계산: (제본비 ÷ 금액(VAT 별도)) × 100%</small></label>`}
  const lockedEnd=f.col===30&&!!String(siteEditValues[28]??'').trim();
  const perfMeta=PERFORMANCE_CONFIRM_BY_COL[f.col];
  if(perfMeta){const manual=sitePerformanceManualCols.has(f.col);return `<label class="siteField performanceConfirmField${manual?' manualOverride':''}"><span>${esc(siteDisplayFieldLabel(f))}</span><div class="performanceConfirmRow"><input data-site-col="${f.col}" type="text" inputmode="numeric" value="${esc(v)}"><button type="button" class="ghost smallBtn performanceAutoBtn" data-performance-auto="${f.col}">자동계산</button></div><small class="fieldHelp">대상 전체수량 × ${perfMeta.label}${manual?' · 현재 직접 수정값 사용':' · 소수점은 올림'}</small></label>`}
  return `<label class="siteField${fin}"><span>${esc(siteDisplayFieldLabel(f))}${f.col===4?' *':''}</span><input data-site-col="${f.col}" ${f.financial?'data-money-input="1" inputmode="decimal" ':''}type="${siteInputType(f.col)}" value="${esc(dateCols.has(Number(f.col))?(siteDateInputValue(v)||''):v)}"${req}${lockedEnd?' readonly aria-readonly="true"':''}>${help}${dateCols.has(Number(f.col))&&!siteDateInputValue(v)&&String(v||'').trim()?`<small class="fieldHelp">기존값은 보존됩니다: ${esc(v)}</small>`:''}</label>`;
 }).join('')||'<p class="hint">이 탭에서 입력할 수 있는 항목이 없습니다.</p>';
 $('siteEditFields').querySelectorAll('[data-site-col]').forEach(inp=>inp.oninput=()=>{
  const col=Number(inp.dataset.siteCol),before=String(siteEditValues[col-1]??'');
  siteEditValues[col-1]=inp.value;
  if([10,12,14].includes(col))syncInspectionType(true);
  if([46,47,48].includes(col))syncContractAmount(true);
  if(col===26)syncElectronicReceiptFromYellowFile(inp.value);
  if(col===50||col===51)syncBindingRatioFromAmounts(true);
  if(PERFORMANCE_CONFIRM_BY_COL[col])sitePerformanceManualCols.add(col);
  if(PERFORMANCE_CONFIRM_RULES[col])syncPerformanceConfirmed(col,false);
  if(col===29){if(inp.value)siteEditValues[29]=inp.value;else if(String(siteEditValues[29]??'')===before)siteEditValues[29]='';syncFieldEndFromPlan()}
  if(siteEditMode==='create'&&col===4)scheduleSiteNameSuggestions(inp.value);
 });
 $('siteEditFields').querySelectorAll('[data-money-input]').forEach(inp=>inp.onblur=()=>{const col=Number(inp.dataset.siteCol);inp.value=siteMoneyInput(inp.value,col);siteEditValues[col-1]=inp.value;if([46,47,48].includes(col))syncContractAmount(true);if(col===50||col===51)syncBindingRatioFromAmounts(true)});
 $('siteEditFields').querySelectorAll('[data-performance-auto]').forEach(btn=>btn.onclick=()=>{const col=Number(btn.dataset.performanceAuto);resetPerformanceConfirmedToAuto(col);renderSiteEditFields()});
 const nextBtn=$('applyNextSnBtn');if(nextBtn)nextBtn.onclick=()=>applyNextSiteSn(true);
 const nameInput=$('siteNameLookupInput');if(nameInput){nameInput.onfocus=()=>{if(String(nameInput.value||'').trim())scheduleSiteNameSuggestions(nameInput.value,true)};nameInput.onblur=()=>setTimeout(hideSiteNameSuggestions,180)}
 syncRegionFromSiteAddress();syncFieldEndFromPlan();
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
async function applySiteTemplate(sourceId,options={}){
 if(siteEditMode!=='create'||!canCreateSite())return;
 try{
  const keepSn=!!options.keepSn,currentSn=String(siteEditValues[0]||'').trim();
  notify($('siteEditMsg'),'선택한 현장정보를 불러오는 중...',true);
  const{data,error}=await sb.rpc('staff_site_template',{p_source_id:Number(sourceId)});if(error)throw error;
  let vals=Array.isArray(data?.values)?[...data.values]:Array(137).fill('');while(vals.length<137)vals.push('');
  siteEditValues=vals.slice(0,137).map((v,i)=>normalizeCell(v,i+1));
  clearSiteTemplateWorkValues();
  sitePerformanceManualCols.clear();seedPerformanceConfirmedBlanks();
  if(keepSn&&currentSn)siteEditValues[0]=currentSn;
  $('siteFormPhone').value=formatPhoneList(data?.client_phone||'');$('siteFormEmail').value=data?.client_email||'';$('siteFormAddress').value=data?.site_address||'';$('siteAddressQuery').value=data?.site_address||'';$('siteFormAddressDetail').value='';setSiteAddressMode('search');syncRegionFromSiteAddress();
  hideSiteNameSuggestions();renderSiteEditTabs();renderSiteEditFields();
  const copiedName=String(data?.site_name||'');
  if(options.fromSearch){
   renderSelectedSiteTemplate({source_id:Number(sourceId),site_name:copiedName,sn:data?.sn||'',region:data?.region||'',report_grade:data?.report_grade||''},keepSn?currentSn:'');
   $('siteEditHint').textContent=`유사 현장 “${copiedName}” 정보를 불러왔습니다. 신규 S/N은 ${siteEditValues[0]||'-'}으로 유지됩니다. 필요한 내용을 수정한 뒤 저장하면 새 현장으로 추가됩니다.`;
   notify($('siteEditMsg'),'현장정보를 불러왔습니다. 접수·점검·작성·제본 이력과 문서작성 매출은 초기화했습니다. 새 내용을 입력한 뒤 신규등록하세요.',true);
  }else{
   $('siteEditHint').textContent=`기존 현장 “${copiedName}” 정보를 복사했습니다. S/N을 포함해 필요한 항목을 수정한 뒤 저장하면 새 현장으로 추가됩니다.`;
   notify($('siteEditMsg'),'현장정보를 복사하고 접수·점검·작성·제본 이력과 문서작성 매출을 초기화했습니다. 새 내용을 입력한 뒤 저장하세요.',true);
  }
 }catch(e){notify($('siteEditMsg'),'기존 현장정보 불러오기 실패: '+e.message)}
}
function resetSiteTemplateSearch(){
 siteTemplateSearchRows=[];siteTemplateSearchRequest++;
 const q=$('siteTemplateQuery'),results=$('siteTemplateResults'),selected=$('siteTemplateSelected');
 if(q)q.value='';if(results){results.innerHTML='';results.classList.add('hidden')}if(selected){selected.innerHTML='';selected.classList.add('hidden')}
}
function renderSelectedSiteTemplate(row,newSn=''){
 const box=$('siteTemplateSelected');if(!box)return;
 box.classList.remove('hidden');
 box.innerHTML=`<div><span>선택한 유사 현장</span><strong>${esc(row?.site_name||'-')}</strong><small>S/N ${esc(row?.sn||'-')} · ${esc(row?.region||'지역 없음')} · ${esc(row?.report_grade||'등급 없음')}</small></div><div class="siteTemplateSelectedNote">${newSn?`신규 S/N <b>${esc(newSn)}</b> 유지`:''}</div>`;
}
async function searchSimilarSiteTemplates(){
 if(siteEditMode!=='create'||!canCreateSite())return;
 const qEl=$('siteTemplateQuery'),results=$('siteTemplateResults');if(!qEl||!results)return;
 const raw=String(qEl.value||'').trim();
 if(!raw){results.classList.remove('hidden');results.innerHTML='<div class="siteTemplateSearchState">검색어를 입력하세요.</div>';qEl.focus();return}
 const q=raw.replace(/[%_(),]/g,' ').replace(/\s+/g,' ').trim();if(!q)return;
 const seq=++siteTemplateSearchRequest;results.classList.remove('hidden');results.innerHTML='<div class="siteTemplateSearchState">유사 현장을 찾는 중...</div>';
 try{
  const{data,error}=await sb.from('staff_site_search_list').select('source_id,site_name,previous_name,sn,region,report_grade,excel_row').or(`site_name.ilike.%${q}%,previous_name.ilike.%${q}%,sn.ilike.%${q}%,region.ilike.%${q}%`).order('site_name',{ascending:true}).limit(30);
  if(error)throw error;if(seq!==siteTemplateSearchRequest)return;
  siteTemplateSearchRows=data||[];
  if(!siteTemplateSearchRows.length){results.innerHTML='<div class="siteTemplateSearchState">검색된 유사 현장이 없습니다. 다른 현장명·S/N·지역으로 검색해 보세요.</div>';return}
  results.innerHTML=`<div class="siteTemplateResultMeta">검색결과 ${siteTemplateSearchRows.length.toLocaleString()}건 · 선택하면 신규 S/N은 유지되고 현장정보를 불러옵니다. 접수·점검·작성·제본 이력과 문서작성 매출은 비워 둡니다.</div><div class="siteTemplateResultList">${siteTemplateSearchRows.map(r=>`<article class="siteTemplateResultItem"><div class="siteTemplateResultInfo"><strong>${esc(r.site_name||'-')}</strong>${r.previous_name?`<span>변경 전: ${esc(r.previous_name)}</span>`:''}<small>S/N ${esc(r.sn||'-')} · ${esc(r.region||'지역 없음')} · ${esc(r.report_grade||'등급 없음')}</small></div><button type="button" class="primary smallBtn" data-similar-template="${Number(r.source_id)}">이 현장 불러오기</button></article>`).join('')}</div>`;
  results.querySelectorAll('[data-similar-template]').forEach(b=>b.onclick=async()=>{
   const id=Number(b.dataset.similarTemplate),row=siteTemplateSearchRows.find(x=>Number(x.source_id)===id);
   await applySiteTemplate(id,{keepSn:true,fromSearch:true});
   if(row)renderSelectedSiteTemplate(row,String(siteEditValues[0]||''));
   results.classList.add('hidden');
  });
 }catch(e){if(seq===siteTemplateSearchRequest)results.innerHTML=`<div class="siteTemplateSearchState">유사 현장 검색 오류: ${esc(e.message)}</div>`}
}
function setSiteAddressMode(mode){siteAddressMode=mode==='manual'?'manual':'search';const manual=siteAddressMode==='manual',addr=$('siteFormAddress');addr.readOnly=!manual;$('siteAddressQuery').closest('label')?.classList.toggle('hidden',manual);$('siteAddressDetailLabel')?.classList.toggle('hidden',manual);$('siteManualAddressBtn')?.classList.toggle('hidden',manual);$('siteSearchAddressModeBtn')?.classList.toggle('hidden',!manual);addr.placeholder=manual?'주소를 직접 입력하세요':'주소 검색 결과를 선택하세요';if(manual){$('siteFormAddressDetail').value='';addr.focus();notify($('siteAddressMsg'),'')}syncRegionFromSiteAddress()}
function searchSiteAddress(){const q=String($('siteAddressQuery').value||'').trim();if(!(window.kakao&&window.kakao.Postcode)){setSiteAddressMode('manual');notify($('siteAddressMsg'),'주소 검색 서비스를 불러오지 못했습니다. 직접입력으로 전환했습니다.');return}let had=true;new window.kakao.Postcode({onsearch:data=>{had=Number(data?.count||0)>0;notify($('siteAddressMsg'),had?`검색 결과 ${Number(data.count).toLocaleString()}건입니다. 주소를 선택하세요.`:'검색 결과가 없습니다. 검색어를 바꾸거나 직접입력을 선택하세요.',had)},oncomplete:data=>{const a=(data.userSelectedType==='R'?data.roadAddress:data.jibunAddress)||data.roadAddress||data.jibunAddress||data.address||'';$('siteFormAddress').value=a;$('siteAddressQuery').value=a;$('siteFormAddressDetail').value='';syncRegionFromSiteAddress();notify($('siteAddressMsg'),`주소가 선택되었습니다. 지역은 ${regionFromAddress(a)||'주소 기준'}으로 자동 입력됩니다. 필요한 경우 상세주소를 입력하세요.`,true);$('siteFormAddressDetail').focus()},onclose:()=>{if(!had)notify($('siteAddressMsg'),'검색 결과가 없었습니다. 직접입력을 선택할 수 있습니다.')}}).open({q,popupTitle:'현장 주소 검색',popupKey:'staff-site-edit-address'})}
function resetSiteEditor(){siteEditValues=Array(137).fill('');sitePerformanceManualCols.clear();siteEditRow=null;siteEditGroupIndex=0;$('siteEditSourceId').value='';$('siteFormPhone').value='';$('siteFormEmail').value='';$('siteFormAddress').value='';$('siteFormAddressDetail').value='';$('siteAddressQuery').value='';resetSiteTemplateSearch();setSiteAddressMode('search');notify($('siteAddressMsg'),'검색 결과에서 주소를 선택하거나, 검색되지 않으면 직접입력을 선택하세요.',true);notify($('siteEditMsg'),'')}
async function openCreateSite(){if(!canCreateSite())return alert('현장 직접등록 권한이 없습니다.');siteEditMode='create';resetSiteEditor();$('siteEditTitle').textContent='현장 직접등록';$('siteEditHint').textContent=canCreateMoney()?'유사 현장을 불러온 뒤 진행·담당·계약과 금액정보까지 수정하여 신규등록할 수 있습니다.':'유사 현장을 불러오거나 새 현장을 등록할 수 있습니다. 금액정보 입력은 별도의 금액입력 권한이 필요합니다.';$('siteTemplateSearchPanel')?.classList.remove('hidden');$('siteFormPhone').disabled=false;$('siteFormEmail').disabled=false;$('siteFormAddress').disabled=false;await applyNextSiteSn(false);renderSiteEditTabs();renderSiteEditFields();$('siteEditDlg').showModal();setTimeout(()=>{$('siteTemplateQuery')?.focus()},60)}
async function openSiteEditor(id){if(!canEditSite())return alert('현장 수정 권한이 없습니다.');$('siteTemplateSearchPanel')?.classList.add('hidden');let r;try{r=await ensureFullSiteRow(id)}catch(e){return alert('수정할 현장을 불러오지 못했습니다: '+e.message)}if(!r)return alert('수정할 현장을 찾을 수 없습니다.');siteEditMode='edit';resetSiteEditor();siteEditRow=r;$('siteEditSourceId').value=String(id);let vals=Array.isArray(r.safe_values)?[...r.safe_values]:Array(137).fill('');while(vals.length<137)vals.push('');siteEditValues=vals.slice(0,137).map((v,i)=>normalizeCell(v,i+1));seedPerformanceConfirmedBlanks();$('siteEditTitle').textContent='현장 정보 수정';$('siteEditHint').textContent=isAdmin()?'관리자는 전체 현장정보와 금액정보를 수정할 수 있습니다.':(canEditMoney()?'현장 수정 및 금액 수정 권한이 적용됩니다. 금액정보는 권한이 있는 사용자에게만 표시됩니다.':'부여된 현장 수정권한으로 비금액 현장정보를 수정할 수 있습니다. 금액정보는 금액수정 권한이 필요합니다.');$('siteFormPhone').value=formatPhoneList(r.client_phone||'');$('siteFormPhone').disabled=!isAdmin();$('siteFormEmail').value=r.client_email||'';$('siteFormAddress').value=r.site_address||'';$('siteAddressQuery').value=r.site_address||'';setSiteAddressMode('search');syncRegionFromSiteAddress();renderSiteEditTabs();renderSiteEditFields();$('siteEditDlg').showModal()}
function sitePayload(){syncInspectionType(false);syncContractAmount(false);syncRegionFromSiteAddress();syncFieldEndFromPlan();syncBindingRatioFromAmounts(false);const base=String($('siteFormAddress').value||'').trim(),detail=siteAddressMode==='manual'?'':String($('siteFormAddressDetail').value||'').trim();return{values:siteEditValues,client_phone:normalizePhoneList($('siteFormPhone').value||''),client_email:String($('siteFormEmail').value||'').trim(),site_address:[base,detail].filter(Boolean).join(' ').trim()}}
async function saveSiteEdit(e){e.preventDefault();siteEditValues[3]=String(siteEditValues[3]||'').trim();if(!siteEditValues[3]){siteEditGroupIndex=0;renderSiteEditTabs();renderSiteEditFields();return notify($('siteEditMsg'),'현장명을 입력하세요.')}const payload=sitePayload();notify($('siteEditMsg'),'저장 중...',true);try{let savedId=0;if(siteEditMode==='create'){if(!canCreateSite())throw new Error('현장 직접등록 권한이 없습니다.');const{data,error}=await sb.rpc('staff_create_site',{p_data:payload});if(error)throw error;savedId=Number(data)||0;notify($('siteEditMsg'),`현장 등록이 완료되었습니다. (ID ${data})`,true)}else{if(!canEditSite())throw new Error('현장 수정 권한이 없습니다.');savedId=Number($('siteEditSourceId').value);const{error}=await sb.rpc('staff_update_site',{p_source_id:savedId,p_data:payload});if(error)throw error;notify($('siteEditMsg'),'현장 수정이 완료되었습니다.',true)}
 if(payload.site_address&&canEditSite()){const syncResult=await syncAddressToSameSiteName(savedId,siteEditValues[3],payload.site_address,$('siteEditMsg'));if(syncResult.synced)notify($('siteEditMsg'),`${siteEditMode==='create'?'현장 등록':'현장 수정'}이 완료되었습니다. 괄호 뒤 내용을 제외한 같은 현장 ${syncResult.matched.toLocaleString()}건의 주소를 자동 동기화했습니다.`,true)}
 setTimeout(()=>{$('siteEditDlg').close()},350);invalidateDataCaches('sites');await Promise.all([refreshDbStatus(),refreshActiveData(true)]);}catch(err){notify($('siteEditMsg'),'저장 실패: '+(err?.message||err))}}


function reportValue(r,col){
 if(Array.isArray(r?.safe_values))return formatDisplayCell(r.safe_values[col-1]??'',col);
 const direct={16:'important',18:'expiry',24:'corporation',25:'inspection_type',27:'receipt_date',30:'field_end_raw',31:'field_inspector_raw'};
 const key=direct[Number(col)];return formatDisplayCell(key?(r?.[key]??''):'',col);
}
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
function renderUnwrittenDashboardSummary(){
 const summary=$('unwrittenSummary'),owners=$('unwrittenOwners');
 const ownerMap=new Map();for(const r of unwrittenRows){const n=reportOwnerName(r);ownerMap.set(n,(ownerMap.get(n)||0)+1)}
 const ownerEntries=[...ownerMap.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko'));
 const over14=unwrittenRows.filter(r=>(elapsedFromReceipt(r)??-1)>=14).length,over30=unwrittenRows.filter(r=>(elapsedFromReceipt(r)??-1)>=30).length;
 summary.innerHTML=`<div class="unwrittenKpi"><span>전체 미작성</span><b>${unwrittenRows.length.toLocaleString()}건</b></div><div class="unwrittenKpi"><span>담당자</span><b>${ownerEntries.filter(([n])=>n!=='미배정').length.toLocaleString()}명</b></div><div class="unwrittenKpi warn"><span>파일접수 14일 이상</span><b>${over14.toLocaleString()}건</b></div><div class="unwrittenKpi danger"><span>파일접수 30일 이상</span><b>${over30.toLocaleString()}건</b></div>`;
 owners.innerHTML=`<button class="ownerCard ${unwrittenOwnerFilter==='all'?'active':''}" data-owner="all"><span>전체</span><b>${unwrittenRows.length.toLocaleString()}건</b></button>`+ownerEntries.map(([name,count])=>`<button class="ownerCard ${unwrittenOwnerFilter===name?'active':''}" data-owner="${esc(name)}"><span>${esc(name)}</span><b>${count.toLocaleString()}건</b></button>`).join('');
 owners.querySelectorAll('[data-owner]').forEach(b=>b.onclick=()=>{unwrittenOwnerFilter=b.dataset.owner;renderUnwrittenList();owners.querySelectorAll('[data-owner]').forEach(x=>x.classList.toggle('active',x===b))});
 if(unwrittenOwnerFilter!=='all'&&!ownerMap.has(unwrittenOwnerFilter))unwrittenOwnerFilter='all';renderUnwrittenList();
}
async function loadUnwrittenDashboard(force=false){
 if(!isAdmin())return;
 if(!force&&unwrittenCacheReady&&cacheFresh(unwrittenLoadedAt)){renderUnwrittenDashboardSummary();return}
 if(unwrittenLoadPromise&&!force)return unwrittenLoadPromise;
 const summary=$('unwrittenSummary'),owners=$('unwrittenOwners'),list=$('unwrittenList');
 if(summary)summary.innerHTML='<div class="dashLoading">미작성 현황을 불러오는 중...</div>';if(owners)owners.innerHTML='';if(list)list.innerHTML='';
 unwrittenLoadPromise=(async()=>{try{
  const rows=await fetchPaged('staff_unwritten_fast','*',q=>q.order('excel_row',{ascending:true}));
  unwrittenRows=rows.filter(isUnwrittenReport);unwrittenCacheReady=true;unwrittenLoadedAt=Date.now();renderUnwrittenDashboardSummary();
 }catch(e){summary.innerHTML=`<div class="statusBanner warn">미작성 대시보드 조회 오류: ${esc(e.message)}</div>`}finally{unwrittenLoadPromise=null}})();
 return unwrittenLoadPromise;
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
const UNWRITTEN_SELECTABLE_KEYS=['site_name','important','elapsed','corporation','inspection_type','receipt','field_end','field_inspector'];
const UNWRITTEN_DEFAULT_FIELDS=[...UNWRITTEN_SELECTABLE_KEYS];
function sanitizeUnwrittenDisplayFields(list){
 const allowed=new Set(UNWRITTEN_SELECTABLE_KEYS);
 return [...new Set((Array.isArray(list)?list:[]).map(String).filter(k=>allowed.has(k)))];
}
function unwrittenDisplayStorageKey(){return `staff_unwritten_display_fields:${me?.id||'guest'}`}
function applyUnwrittenDisplayFieldPreference(profile){
 let chosen=sanitizeUnwrittenDisplayFields(profile?.staff_unwritten_display_fields);
 if(!chosen.length){try{chosen=sanitizeUnwrittenDisplayFields(JSON.parse(localStorage.getItem(`staff_unwritten_display_fields:${profile?.id||''}`)||'null'))}catch(e){}}
 unwrittenDisplayFields=chosen.length?chosen:[...UNWRITTEN_DEFAULT_FIELDS];
 try{localStorage.setItem(unwrittenDisplayStorageKey(),JSON.stringify(unwrittenDisplayFields))}catch(e){}
 unwrittenColumnOrder=[];
}
const UNWRITTEN_DEFAULT_ORDER=['no','site_name','important','elapsed','corporation','inspection_type','receipt','field_end','field_inspector','actions'];
let unwrittenColumnOrder=[];
let unwrittenSort={key:null,dir:'asc'};
let suppressUnwrittenSortClick=false;
function unwrittenOrderStorageKey(){return `staff_unwritten_column_order:${me?.id||'guest'}`}
function unwrittenSortStorageKey(){return `staff_unwritten_sort:${me?.id||'guest'}`}
function ensureUnwrittenColumnOrder(){
 const selected=sanitizeUnwrittenDisplayFields(unwrittenDisplayFields);
 const valid=['no',...selected,'actions'];
 if(!unwrittenColumnOrder.length){
  try{const saved=JSON.parse(localStorage.getItem(unwrittenOrderStorageKey())||'null');if(Array.isArray(saved))unwrittenColumnOrder=saved.filter(k=>valid.includes(k))}catch(e){}
 }
 let next=unwrittenColumnOrder.filter(k=>valid.includes(k));
 if(!next.includes('no'))next.unshift('no');
 selected.forEach(k=>{if(!next.includes(k))next.splice(Math.max(1,next.length-(next.includes('actions')?1:0)),0,k)});
 if(!next.includes('actions'))next.push('actions');
 // 기능열은 항상 양 끝에 유지합니다.
 next=next.filter(k=>k!=='no'&&k!=='actions');
 unwrittenColumnOrder=['no',...next,'actions'];
 if(!unwrittenSort.key){
  try{const st=JSON.parse(localStorage.getItem(unwrittenSortStorageKey())||'null');if(st&&UNWRITTEN_LIST_COLUMNS[st.key]?.sortable&&selected.includes(st.key)&&['asc','desc'].includes(st.dir))unwrittenSort=st}catch(e){}
 }
 if(unwrittenSort.key&&(!UNWRITTEN_LIST_COLUMNS[unwrittenSort.key]?.sortable||!selected.includes(unwrittenSort.key)))unwrittenSort={key:null,dir:'asc'};
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
 const fixed=['no','actions'].includes(key);return `<th class="uw-col-${key} ${c.sortable?'sortableHeader':''} ${active?'sortActive':''}" data-uw-col-key="${key}" data-sortable="${c.sortable?'1':'0'}" draggable="${fixed?'false':'true'}" title="${fixed?'기능열':(c.sortable?'클릭: 오름/내림차순 정렬 · ':'')+'드래그: 열 이동'}"><span>${esc(c.label)}${arrow}</span></th>`;
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
let unwrittenFreezeSelectMode=false;
function unwrittenFreezeStorageKey(){return `staff_unwritten_freeze_panes:${me?.id||'guest'}`}
function readUnwrittenFreezePanes(){
 try{const v=JSON.parse(localStorage.getItem(unwrittenFreezeStorageKey())||'{}');return{rows:Math.max(0,Number(v?.rows)||0),cols:Math.max(0,Number(v?.cols)||0)}}catch(e){return{rows:0,cols:0}}
}
function saveUnwrittenFreezePanes(rows,cols){try{localStorage.setItem(unwrittenFreezeStorageKey(),JSON.stringify({rows:Math.max(0,rows|0),cols:Math.max(0,cols|0)}))}catch(e){}}
function clearUnwrittenFreezePanes(){
 unwrittenFreezeSelectMode=false;saveUnwrittenFreezePanes(0,0);
 const table=document.querySelector('#unwrittenList .unwrittenTable');if(table){table.classList.remove('unwrittenFreezePicking');applyUnwrittenFreezePanes(table)}
 updateUnwrittenFreezeControls();
}
function unwrittenFreezeStatusText(){
 const f=readUnwrittenFreezePanes();
 if(unwrittenFreezeSelectMode)return '표에서 기준 셀을 클릭하세요. 클릭한 셀의 위쪽 행과 왼쪽 열이 고정됩니다.';
 if(!f.rows&&!f.cols)return '고정 안 됨';
 const rowText=f.rows?`위쪽 ${Math.max(0,f.rows-1)}개 현장행 + 제목행`:'';
 const colText=f.cols?`왼쪽 ${f.cols}개 열`:'';
 return [rowText,colText].filter(Boolean).join(' · ')+' 고정 중';
}
function updateUnwrittenFreezeControls(){
 const root=$('unwrittenList');if(!root)return;
 const selectBtn=root.querySelector('[data-unwritten-freeze-select]'),clearBtn=root.querySelector('[data-unwritten-freeze-clear]'),status=root.querySelector('[data-unwritten-freeze-status]');
 if(selectBtn){selectBtn.classList.toggle('active',unwrittenFreezeSelectMode);selectBtn.textContent=unwrittenFreezeSelectMode?'📍 고정할 셀을 클릭하세요':'📌 틀 고정 위치 선택'}
 const f=readUnwrittenFreezePanes();if(clearBtn)clearBtn.disabled=!f.rows&&!f.cols;
 if(status)status.textContent=unwrittenFreezeStatusText();
}
let unwrittenFreezeLayoutFrame=0;
function scheduleUnwrittenFreezeLayout(table){
 if(!table||!window.matchMedia('(min-width:801px)').matches)return;
 if(unwrittenFreezeLayoutFrame)cancelAnimationFrame(unwrittenFreezeLayoutFrame);
 unwrittenFreezeLayoutFrame=requestAnimationFrame(()=>{unwrittenFreezeLayoutFrame=0;applyUnwrittenFreezePanes(table)});
}
function resetUnwrittenFreezeStyles(table){
 if(!table)return;
 table.querySelectorAll('th,td').forEach(cell=>{
  cell.classList.remove('unwrittenFreezeCell','unwrittenFreezeCorner','unwrittenFreezeBoundaryRight','unwrittenFreezeBoundaryBottom');
  cell.style.removeProperty('--unwritten-freeze-left');cell.style.removeProperty('--unwritten-freeze-top');cell.style.removeProperty('left');cell.style.removeProperty('top');cell.style.removeProperty('z-index');
 });
 table.classList.remove('unwrittenFreezeActive');
}
function applyUnwrittenFreezePanes(table){
 if(!table||!window.matchMedia('(min-width:801px)').matches)return;
 resetUnwrittenFreezeStyles(table);
 const f=readUnwrittenFreezePanes(),allRows=[...table.rows];if(!allRows.length)return;
 const rowCount=Math.min(f.rows,allRows.length),colCount=Math.min(f.cols,allRows[0]?.cells?.length||0);
 if(!rowCount&&!colCount){updateUnwrittenFreezeControls();return}
 table.classList.add('unwrittenFreezeActive');
 const colLeft=[];let left=0;
 for(let c=0;c<colCount;c++){
  colLeft[c]=left;
  const ref=allRows[0]?.cells?.[c];left+=ref?ref.getBoundingClientRect().width:0;
 }
 const rowTop=[];let top=0;
 for(let r=0;r<rowCount;r++){
  rowTop[r]=top;
  top+=allRows[r]?.getBoundingClientRect().height||0;
 }
 allRows.forEach((row,r)=>[...row.cells].forEach((cell,c)=>{
  const freezeRow=r<rowCount,freezeCol=c<colCount;if(!freezeRow&&!freezeCol)return;
  cell.classList.add('unwrittenFreezeCell');
  if(freezeCol){cell.style.setProperty('--unwritten-freeze-left',`${Math.round(colLeft[c]||0)}px`);cell.style.left=`${Math.round(colLeft[c]||0)}px`}
  if(freezeRow){cell.style.setProperty('--unwritten-freeze-top',`${Math.round(rowTop[r]||0)}px`);cell.style.top=`${Math.round(rowTop[r]||0)}px`}
  if(freezeRow&&freezeCol){cell.classList.add('unwrittenFreezeCorner');cell.style.zIndex='8'}
  else if(freezeRow){cell.style.zIndex='6'}
  else if(freezeCol){cell.style.zIndex='5'}
  if(freezeCol&&c===colCount-1)cell.classList.add('unwrittenFreezeBoundaryRight');
  if(freezeRow&&r===rowCount-1)cell.classList.add('unwrittenFreezeBoundaryBottom');
 }));
 updateUnwrittenFreezeControls();
}
function selectUnwrittenFreezeCell(cell){
 const table=cell?.closest?.('.unwrittenTable');if(!table)return;
 const row=cell.parentElement,rowIndex=[...table.rows].indexOf(row),colIndex=[...row.cells].indexOf(cell);
 if(rowIndex<0||colIndex<0)return;
 saveUnwrittenFreezePanes(rowIndex,colIndex);unwrittenFreezeSelectMode=false;applyUnwrittenFreezePanes(table);updateUnwrittenFreezeControls();
 const parts=[];
 if(rowIndex)parts.push(rowIndex>1?`제목행과 위쪽 현장 ${rowIndex-1}개`:'제목행');
 if(colIndex)parts.push(`왼쪽 ${colIndex}개 열`);
 if(!parts.length)parts.push('고정 영역 없음');
 const status=$('unwrittenList')?.querySelector('[data-unwritten-freeze-status]');if(status)status.textContent=parts.join(' · ')+'을 고정했습니다.';
}
function bindUnwrittenFreezeControls(root,table){
 if(!root||!table)return;
 const selectBtn=root.querySelector('[data-unwritten-freeze-select]'),clearBtn=root.querySelector('[data-unwritten-freeze-clear]');
 if(selectBtn)selectBtn.onclick=()=>{unwrittenFreezeSelectMode=!unwrittenFreezeSelectMode;updateUnwrittenFreezeControls();table.classList.toggle('unwrittenFreezePicking',unwrittenFreezeSelectMode)};
 if(clearBtn)clearBtn.onclick=()=>{table.classList.remove('unwrittenFreezePicking');clearUnwrittenFreezePanes()};
 table.addEventListener('click',e=>{
  if(!unwrittenFreezeSelectMode)return;
  const cell=e.target.closest('th,td');if(!cell||!table.contains(cell))return;
  e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();
  table.classList.remove('unwrittenFreezePicking');selectUnwrittenFreezeCell(cell);
 },true);
 updateUnwrittenFreezeControls();scheduleUnwrittenFreezeLayout(table);
}

function bindUnwrittenHeaderInteractions(root){
 let dragKey=null;
 const clearMarks=()=>root.querySelectorAll('.unwrittenTable th').forEach(x=>x.classList.remove('dragging','dragBefore','dragAfter'));
 root.querySelectorAll('.unwrittenTable th[data-uw-col-key]').forEach(th=>{
  th.addEventListener('click',()=>{if(suppressUnwrittenSortClick)return;toggleUnwrittenSort(th.dataset.uwColKey)});
  th.addEventListener('dragstart',e=>{if(['no','actions'].includes(th.dataset.uwColKey)){e.preventDefault();return;}dragKey=th.dataset.uwColKey;th.classList.add('dragging');suppressUnwrittenSortClick=true;if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragKey)}});
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
 $('unwrittenListMeta').textContent=desktop?`${filtered.length.toLocaleString()}건 · 제목 클릭: 정렬 · 제목 드래그: 열 이동 · 오른쪽 경계 드래그: 열 폭 조절 · 현장 행 클릭: 상세조회`:`${filtered.length.toLocaleString()}건 · 현장카드에서 상세·수정할 수 있습니다.`;
 const root=$('unwrittenList');if(!filtered.length){root.innerHTML='<div class="emptyDashboard">해당 담당자의 미작성 보고서가 없습니다.</div>';return}
 if(desktop){
   ensureUnwrittenColumnOrder();
   const sorted=sortedUnwrittenRows(filtered);
   const headers=unwrittenColumnOrder.map(unwrittenHeaderHtml).join('');
   const rows=sorted.map((r,i)=>`<tr class="unwrittenRow" data-report-detail="${r.source_id}">${unwrittenColumnOrder.map(key=>unwrittenCellHtml(r,key,i)).join('')}</tr>`).join('');
   root.innerHTML=`<div class="unwrittenFreezeToolbar"><div class="unwrittenFreezeButtons"><button type="button" class="ghost unwrittenFreezeSelectBtn" data-unwritten-freeze-select>📌 틀 고정 위치 선택</button><button type="button" class="ghost" data-unwritten-freeze-clear>🔓 틀 고정 해제</button></div><span class="unwrittenFreezeStatus" data-unwritten-freeze-status></span></div><div class="unwrittenListHint"><strong>틀 고정:</strong> 위치 선택 버튼 → 원하는 셀 클릭 (선택 셀의 위쪽·왼쪽 고정) · <strong>정렬:</strong> 제목 클릭 · <strong>열 이동:</strong> 제목 드래그 · <strong>열 폭:</strong> 제목 오른쪽 경계 드래그</div><div class="unwrittenTableWrap"><table class="unwrittenTable"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
   const unwrittenTable=root.querySelector('.unwrittenTable');
   bindUnwrittenHeaderInteractions(root);bindUnwrittenFreezeControls(root,unwrittenTable);
   scheduleTableColumnResize(unwrittenTable,'unwritten');setTimeout(()=>scheduleUnwrittenFreezeLayout(unwrittenTable),80);
   root.querySelectorAll('.unwrittenRow').forEach(tr=>tr.onclick=e=>{if(e.target.closest('button,a,input,select,th'))return;openDetail(Number(tr.dataset.reportDetail))});
 }else{
   const selected=sanitizeUnwrittenDisplayFields(unwrittenDisplayFields);
   const mobileValue=(r,key)=>{const days=elapsedFromReceipt(r);if(key==='site_name')return r.site_name||'-';if(key==='important')return reportValue(r,16)||'-';if(key==='expiry')return reportValue(r,18)||'-';if(key==='elapsed')return days===null?'-':days+'일';if(key==='corporation')return reportValue(r,24)||'-';if(key==='inspection_type')return reportValue(r,25)||'-';if(key==='receipt')return reportValue(r,27)||'-';if(key==='field_end')return String(r.field_end||reportValue(r,30)||'-');if(key==='field_inspector')return r.field_inspector||reportValue(r,31)||'-';return'-'};
   root.innerHTML=filtered.map(r=>{const days=elapsedFromReceipt(r),title=selected.includes('site_name')?esc(r.site_name||'-'):'미작성 현장';const badge=selected.includes('elapsed')?`<span class="elapsedBadge ${elapsedClass(days)}">${days===null?'접수일 없음':days+'일 경과'}</span>`:'';const details=selected.filter(k=>k!=='site_name'&&k!=='elapsed').map(k=>`<div><dt>${esc(UNWRITTEN_LIST_COLUMNS[k].label)}</dt><dd>${esc(mobileValue(r,k))}</dd></div>`).join('');return `<article class="unwrittenCard"><div class="unwrittenCardHead"><h4>${title}</h4>${badge}</div>${details?`<dl>${details}</dl>`:''}<div class="siteActions"><button class="smallBtn" data-report-detail-btn="${r.source_id}">상세</button><button class="primary smallBtn" data-report-edit="${r.source_id}">수정</button></div></article>`}).join('');
 }
 root.querySelectorAll('[data-report-detail-btn]').forEach(b=>b.onclick=e=>{e.stopPropagation();openDetail(Number(b.dataset.reportDetailBtn))});
 root.querySelectorAll('[data-report-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openSiteEditor(Number(b.dataset.reportEdit))});
}

function updateUnwrittenFieldSelectionCount(){const root=$('unwrittenFieldList'),total=root.querySelectorAll('input[type=checkbox]').length,selected=root.querySelectorAll('input[type=checkbox]:checked').length;$('unwrittenFieldSelectionCount').textContent=`${selected} / ${total}개 선택`}
function setUnwrittenFieldChecks(mode){const boxes=[...$('unwrittenFieldList').querySelectorAll('input[type=checkbox]')];if(mode==='all')boxes.forEach(x=>x.checked=true);else if(mode==='none')boxes.forEach(x=>x.checked=false);else{const defs=new Set(UNWRITTEN_DEFAULT_FIELDS);boxes.forEach(x=>x.checked=defs.has(x.value))}updateUnwrittenFieldSelectionCount()}
function setupUnwrittenFields(){const root=$('unwrittenFieldList');root.innerHTML=UNWRITTEN_SELECTABLE_KEYS.map(k=>`<label><input type="checkbox" value="${esc(k)}" ${unwrittenDisplayFields.includes(k)?'checked':''}>${esc(UNWRITTEN_LIST_COLUMNS[k].label)}</label>`).join('');root.querySelectorAll('input[type=checkbox]').forEach(x=>x.onchange=updateUnwrittenFieldSelectionCount);updateUnwrittenFieldSelectionCount();$('unwrittenFieldsDlg').showModal()}
async function saveUnwrittenFields(){const chosen=sanitizeUnwrittenDisplayFields([...$('unwrittenFieldList').querySelectorAll('input:checked')].map(x=>x.value));if(!chosen.length)return alert('미작성 현황에 표시할 항목을 하나 이상 선택해 주세요.');const btn=$('unwrittenFieldsSave'),old=btn.textContent;btn.disabled=true;btn.textContent='저장 중...';try{const{error}=await sb.rpc('staff_save_unwritten_display_fields',{p_fields:chosen});if(error)throw error;unwrittenDisplayFields=chosen;me.staff_unwritten_display_fields=[...chosen];try{localStorage.setItem(unwrittenDisplayStorageKey(),JSON.stringify(chosen))}catch(e){};ensureUnwrittenColumnOrder();$('unwrittenFieldsDlg').close();renderUnwrittenList()}catch(e){alert('미작성 표시항목 저장 오류: '+e.message)}finally{btn.disabled=false;btn.textContent=old}}

function updateFieldSelectionCount(){const total=$('fieldList').querySelectorAll('input[type=checkbox]').length,selected=$('fieldList').querySelectorAll('input[type=checkbox]:checked').length;$('fieldSelectionCount').textContent=`${selected} / ${total}개 선택`}
function setFieldChecks(mode){const boxes=[...$('fieldList').querySelectorAll('input[type=checkbox]')];if(mode==='all')boxes.forEach(x=>x.checked=true);else if(mode==='none')boxes.forEach(x=>x.checked=false);else{const defs=new Set(DEFAULT_DISPLAY_FIELDS);boxes.forEach(x=>x.checked=defs.has(x.value))}updateFieldSelectionCount()}
function setupFields(){const safe=selectableDisplayFields();$('fieldList').innerHTML=safe.map(f=>`<label><input type="checkbox" value="${esc(f.label)}" ${displayFields.includes(f.label)?'checked':''}>${esc(siteCompactFieldLabel(f,'search'))}</label>`).join('');$('fieldList').querySelectorAll('input[type=checkbox]').forEach(x=>x.onchange=updateFieldSelectionCount);updateFieldSelectionCount();$('fieldsDlg').showModal()}
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
function salesRaw(r,col){
 if(Array.isArray(r?.full_values))return r.full_values[col-1]??'';
 const direct={10:'performance_plan_count',11:'performance_done_count',12:'maintenance_plan_count',13:'maintenance_done_count',25:'contract_type_value'};
 return direct[Number(col)]?(r?.[direct[Number(col)]]??''):'';
}
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
// V90: 기존 원본 DB를 페이지별로 조회하여 집계합니다. 추가 집계 뷰가 필요하지 않습니다.
function salesMonthIndex(value,col){
 const d=parseLocalDate(value,col);
 return d?d.getFullYear()*12+d.getMonth():null;
}
function buildSalesAssignments(rows,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric'}).formatToParts(now);
 const current=Number(parts.find(p=>p.type==='year').value)*12+Number(parts.find(p=>p.type==='month').value)-1;
 const totals=new Map();
 const add=(month,owner,amount,written)=>{
  const key=JSON.stringify([month,owner]);
  if(!totals.has(key))totals.set(key,{allocation_year:Math.floor(month/12),allocation_month:month%12+1,owner_name:owner,allocation_amount:0,assigned_count:0,written_amount:0,written_count:0});
  const row=totals.get(key);
  if(written){row.written_amount+=amount;row.written_count++}else{row.allocation_amount+=amount;row.assigned_count++}
 };
 for(const r of rows){
  const owner=salesOwnerName(r);if(!owner||owner==='미배정')continue;
  const receipt=salesMonthIndex(salesRaw(r,26),26),completed=salesMonthIndex(r.report_complete_date,32),amount=salesAmount(r);
  if(receipt!==null){
   const end=Math.min(completed??current,current);
   for(let month=receipt;month<=end;month++)add(month,owner,amount,false);
   if(completed!==null&&completed>current&&completed>=receipt)add(completed,owner,amount,false);
  }
  if(completed!==null)add(completed,owner,amount,true);
 }
 return [...totals.values()].sort((a,b)=>b.allocation_year-a.allocation_year||b.allocation_month-a.allocation_month||a.owner_name.localeCompare(b.owner_name,'ko'));
}
function salesPanelStorageKey(){return `staff_sales_panel_collapsed:${me?.id||'guest'}`}
function readSalesPanelCollapsed(){
 try{return localStorage.getItem(salesPanelStorageKey())==='1'}catch(e){return false}
}
function writeSalesPanelCollapsed(collapsed){
 try{localStorage.setItem(salesPanelStorageKey(),collapsed?'1':'0')}catch(e){}
}
function applySalesPanelCollapsed(collapsed){
 const panel=$('salesPanel'),body=$('salesPanelBody'),btn=$('salesPanelToggle'),label=$('salesPanelToggleLabel');
 if(!panel||!body||!btn||!label)return;
 panel.classList.toggle('collapsed',!!collapsed);
 btn.setAttribute('aria-expanded',collapsed?'false':'true');
 label.textContent=collapsed?'상세 목록 펼치기':'상세 목록 접기';
 btn.title=collapsed?'현장별 상세 매출 목록 펼치기':'현장별 상세 매출 목록 접기';
}
function toggleSalesPanel(force){
 const next=typeof force==='boolean'?!!force:!readSalesPanelCollapsed();
 writeSalesPanelCollapsed(next);applySalesPanelCollapsed(next);
}

function salesDashboardStorageKey(){return `staff_sales_dashboard:${me?.id||'guest'}`}
function readSalesDashboardPrefs(){try{const v=JSON.parse(localStorage.getItem(salesDashboardStorageKey())||'{}');return v&&typeof v==='object'?v:{}}catch(e){return{}}}
function saveSalesDashboardPrefs(){try{localStorage.setItem(salesDashboardStorageKey(),JSON.stringify({period:salesDashboardPeriod,year:$('salesDashYear')?.value||'',month:$('salesDashMonth')?.value||'',owners:[...salesDashboardOwners]}))}catch(e){}}
function salesDashboardOwnerNames(){return [...new Set([...salesRows.map(salesOwnerName),...salesAssignedRows.map(x=>String(x.owner_name||'').trim())].filter(x=>x&&x!=='미배정'))].sort((a,b)=>a.localeCompare(b,'ko'))}
function updateSalesDashboardOwnerSummary(){const n=salesDashboardOwners.size,total=salesDashboardOwnerNames().length;const el=$('salesDashOwnerSummary');if(el)el.textContent=n?`담당자 ${n}명 선택${n===total?' · 전체':''}`:'담당자를 선택하세요'}
function renderSalesDashboardOwnerList(){
 const root=$('salesDashOwnerList');if(!root)return;
 const owners=salesDashboardOwnerNames();
 root.innerHTML=owners.map(o=>`<label><input type="checkbox" value="${esc(o)}" ${salesDashboardOwners.has(o)?'checked':''}><span>${esc(o)}</span></label>`).join('')||'<div class="salesDashEmpty">조회 가능한 담당자가 없습니다.</div>';
 root.querySelectorAll('input[type=checkbox]').forEach(ch=>ch.onchange=()=>{if(ch.checked)salesDashboardOwners.add(ch.value);else salesDashboardOwners.delete(ch.value);updateSalesDashboardOwnerSummary();renderSalesDashboard()});
 updateSalesDashboardOwnerSummary();
}
function setSalesDashboardPeriod(period,render=true){salesDashboardPeriod=period==='monthly'?'monthly':'annual';$('salesDashAnnual')?.classList.toggle('active',salesDashboardPeriod==='annual');$('salesDashMonthly')?.classList.toggle('active',salesDashboardPeriod==='monthly');$('salesDashMonthWrap')?.classList.toggle('hidden',salesDashboardPeriod!=='monthly');if(render&&salesDashboardInitialized){updateSalesTitleFromDashboard();renderSalesDashboard()}}
function setupSalesDashboardFilters(){
 const years=[...new Set([...salesRows.map(r=>String(r.sales_year||'')),...salesAssignedRows.map(r=>String(r.allocation_year||''))].filter(Boolean))].sort((a,b)=>b.localeCompare(a));
 const owners=salesDashboardOwnerNames(),prefs=readSalesDashboardPrefs(),yearSel=$('salesDashYear'),monthSel=$('salesDashMonth');
 const oldYear=yearSel?.value||'',oldMonth=monthSel?.value||'';
 if(yearSel){yearSel.innerHTML=years.map(y=>`<option value="${esc(y)}">${esc(y)}년</option>`).join('');const py=String(prefs.year||oldYear||$('salesYear')?.value||years[0]||'');yearSel.value=years.includes(py)?py:(years[0]||'')}
 if(monthSel){monthSel.innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}월</option>`).join('');const pm=String(prefs.month||oldMonth||new Date().getMonth()+1);monthSel.value=[...monthSel.options].some(x=>x.value===pm)?pm:'1'}
 if(!salesDashboardInitialized){
  salesDashboardPeriod=prefs.period==='monthly'?'monthly':'annual';
  const savedOwners=Array.isArray(prefs.owners)?prefs.owners.map(String).filter(o=>owners.includes(o)):[];
  salesDashboardOwners=new Set(savedOwners.length?savedOwners:owners);
  salesDashboardInitialized=true;
 }else{
  salesDashboardOwners=new Set([...salesDashboardOwners].filter(o=>owners.includes(o)));
 }
 setSalesDashboardPeriod(salesDashboardPeriod,false);renderSalesDashboardOwnerList();renderSalesDashboard();
}
const SALES_DASH_SUMMARY_KEYS=['no','owner','allocated','written','allocatedCount','writtenCount','allocShare','writtenShare','rate'];
const SALES_DASH_SUMMARY_LABELS={no:'No.',owner:'담당자',allocated:'할당 매출액',written:'작성 매출액',allocatedCount:'할당 건수',writtenCount:'작성 건수',allocShare:'전체 할당 매출액 대비',writtenShare:'전체 작성 매출액 대비',rate:'할당 대비 작성률'};
function salesDashSummaryOrderStorageKey(){return `staff_sales_dashboard_summary_column_order:${me?.id||'guest'}`}
function salesDashSummaryColumnOrder(){
 let saved=[];try{saved=JSON.parse(localStorage.getItem(salesDashSummaryOrderStorageKey())||'[]')}catch(e){}
 const valid=SALES_DASH_SUMMARY_KEYS,seen=new Set(),out=[];
 (Array.isArray(saved)?saved:[]).forEach(k=>{k=String(k);if(valid.includes(k)&&!seen.has(k)){seen.add(k);out.push(k)}});
 valid.forEach(k=>{if(!seen.has(k))out.push(k)});
 return out;
}
function saveSalesDashSummaryColumnOrder(order){try{localStorage.setItem(salesDashSummaryOrderStorageKey(),JSON.stringify(order))}catch(e){}}
function salesDashSummaryCell(key,x,i,d,totalRate){
 const allocShare=d.totalAllocated>0?x.allocated/d.totalAllocated*100:0,writtenShare=d.totalWritten>0?x.written/d.totalWritten*100:0,rate=salesDashboardRate(x.written,x.allocated);
 const cells={
  no:`<td data-summary-key="no" class="center">${i+1}</td>`,
  owner:`<td data-summary-key="owner">${esc(x.owner)}</td>`,
  allocated:`<td data-summary-key="allocated" class="num">${esc(salesDashboardMoney(x.allocated))}</td>`,
  written:`<td data-summary-key="written" class="num">${esc(salesDashboardMoney(x.written))}</td>`,
  allocatedCount:`<td data-summary-key="allocatedCount" class="center">${x.allocatedCount.toLocaleString()}건</td>`,
  writtenCount:`<td data-summary-key="writtenCount" class="center">${x.writtenCount.toLocaleString()}건</td>`,
  allocShare:`<td data-summary-key="allocShare" class="num">${allocShare.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}%</td>`,
  writtenShare:`<td data-summary-key="writtenShare" class="num">${writtenShare.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}%</td>`,
  rate:`<td data-summary-key="rate" class="num ${rate!==null&&rate>=100?'salesRateDone':''}">${rate===null?'-':rate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</td>`
 };
 return cells[key]||'<td></td>';
}
function salesDashSummaryFooterCell(key,d,totalRate){
 const vals={
  no:'',owner:'합계',allocated:esc(salesDashboardMoney(d.totalAllocated)),written:esc(salesDashboardMoney(d.totalWritten)),allocatedCount:d.totalAllocatedCount.toLocaleString()+'건',writtenCount:d.totalWrittenCount.toLocaleString()+'건',allocShare:d.totalAllocated>0?'100.0%':'-',writtenShare:d.totalWritten>0?'100.0%':'-',rate:totalRate===null?'-':totalRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'
 };
 const cls=['allocated','written','allocShare','writtenShare','rate'].includes(key)?'num':(['no','owner','allocatedCount','writtenCount'].includes(key)?'center':'');
 return `<th data-summary-key="${key}" class="${cls}">${vals[key]??''}</th>`;
}
function bindSalesDashSummaryHeaderInteractions(table){
 if(!table)return;let dragKey=null;
 const clear=()=>table.querySelectorAll('thead th').forEach(x=>x.classList.remove('dragging','dragBefore','dragAfter'));
 table.querySelectorAll('thead th[data-summary-key]').forEach(th=>{
  th.addEventListener('dragstart',e=>{dragKey=th.dataset.summaryKey;th.classList.add('dragging');if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragKey)}});
  th.addEventListener('dragover',e=>{if(!dragKey||dragKey===th.dataset.summaryKey)return;e.preventDefault();clear();const r=th.getBoundingClientRect(),after=e.clientX>r.left+r.width/2;th.classList.add(after?'dragAfter':'dragBefore');if(e.dataTransfer)e.dataTransfer.dropEffect='move'});
  th.addEventListener('dragleave',()=>th.classList.remove('dragBefore','dragAfter'));
  th.addEventListener('drop',e=>{e.preventDefault();const target=th.dataset.summaryKey,rect=th.getBoundingClientRect(),after=e.clientX>rect.left+rect.width/2;clear();const from=dragKey;dragKey=null;if(!from||!target||from===target)return;const order=salesDashSummaryColumnOrder().filter(k=>k!==from),idx=order.indexOf(target);if(idx<0)return;order.splice(idx+(after?1:0),0,from);saveSalesDashSummaryColumnOrder(order);renderSalesDashboard()});
  th.addEventListener('dragend',()=>{clear();dragKey=null});
 });
}

function salesDashboardMoney(v){return `${Math.round(salesNumber(v)).toLocaleString('ko-KR')}원`}
function salesDashboardRate(written,allocated){return allocated>0?written/allocated*100:null}
function salesMonthlyOverviewData(){
 const year=$('salesDashYear')?.value||$('salesYear')?.value||'';
 const ownerList=(salesDashboardOwners&&salesDashboardOwners.size?[...salesDashboardOwners]:salesDashboardOwnerNames()).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ko'));
 const selected=new Set(ownerList);
 const months=Array.from({length:12},(_,i)=>({month:i+1,allocated:0,written:0,allocatedCount:0,writtenCount:0}));
 const monthMap=new Map(months.map(x=>[x.month,x]));
 const detailMap=new Map();
 const summaryMap=new Map(ownerList.map(o=>[o,{owner:o,allocated:0,written:0,allocatedCount:0,writtenCount:0}]));
 function ensureDetail(month,owner){const key=`${month}|${owner}`;if(!detailMap.has(key))detailMap.set(key,{month,owner,allocated:0,written:0,allocatedCount:0,writtenCount:0});return detailMap.get(key)}
 salesAssignedRows.filter(a=>String(a.allocation_year||'')===String(year)&&selected.has(String(a.owner_name||'').trim())).forEach(a=>{
   const owner=String(a.owner_name||'').trim(),month=Math.max(1,Math.min(12,Number(a.allocation_month)||0));if(!month)return;
   const amount=salesNumber(a.allocation_amount),count=Math.max(0,Math.round(salesNumber(a.assigned_count)));
   const writtenAmount=salesNumber(a.written_amount),writtenCount=Math.max(0,Math.round(salesNumber(a.written_count)));
   const m=monthMap.get(month),d=ensureDetail(month,owner),sum=summaryMap.get(owner);
   m.allocated+=amount;m.allocatedCount+=count;m.written+=writtenAmount;m.writtenCount+=writtenCount;
   d.allocated+=amount;d.allocatedCount+=count;d.written+=writtenAmount;d.writtenCount+=writtenCount;
   if(sum){sum.allocated+=amount;sum.allocatedCount+=count;sum.written+=writtenAmount;sum.writtenCount+=writtenCount}
 });
 const detailRows=[...detailMap.values()].sort((a,b)=>a.month-b.month||a.owner.localeCompare(b.owner,'ko'));
 const summaryRows=[...summaryMap.values()].filter(x=>x.allocated||x.written||x.allocatedCount||x.writtenCount).sort((a,b)=>b.written-a.written||b.allocated-a.allocated||a.owner.localeCompare(b.owner,'ko'));
 const totals=months.reduce((acc,m)=>{acc.allocated+=m.allocated;acc.written+=m.written;acc.allocatedCount+=m.allocatedCount;acc.writtenCount+=m.writtenCount;return acc},{allocated:0,written:0,allocatedCount:0,writtenCount:0});
 return {year,owners:ownerList,months,detailRows,summaryRows,totals};
}
function salesMonthlyOverviewMoney(v){return `${Math.round(salesNumber(v)).toLocaleString('ko-KR')}원`}
function salesMonthlyOverviewRate(w,a){return a>0?(w/a*100):null}
function salesMonthlyAmountLabel(v){return (v/1000000).toLocaleString('ko-KR',{maximumFractionDigits:0})}
function renderSalesMonthlyOverviewChart(data){
 const root=$('salesMonthlyChart');if(!root)return;
 if(!data.owners.length){root.innerHTML='<div class="salesMonthlyChartEmpty">담당자를 한 명 이상 선택하면 1월부터 12월까지의 월별 차트가 표시됩니다.</div>';return}
 const maxAmount=Math.max(1,...data.months.flatMap(m=>[m.allocated,m.written]));
 const maxCount=Math.max(1,...data.months.flatMap(m=>[m.allocatedCount,m.writtenCount]));
 const width=1120,height=360,padL=72,padR=54,padT=24,padB=52,plotW=width-padL-padR,plotH=height-padT-padB,groupW=plotW/12,barW=Math.min(28,groupW*0.23),centerOffset=Math.min(16,groupW*0.18);
 const amountTicks=5,countTicks=5;
 const grid=[];for(let i=0;i<=amountTicks;i++){const y=padT+plotH-(plotH*(i/amountTicks));const val=Math.round(maxAmount/amountTicks*i);grid.push({y,val})}
 const pointsA=[],pointsW=[],bars=[],labels=[],hoverBands=[];
 data.months.forEach((m,idx)=>{const cx=padL+groupW*idx+groupW/2;const ah=(m.allocated/maxAmount)*plotH,wh=(m.written/maxAmount)*plotH;const ay=padT+plotH-ah,wy=padT+plotH-wh;
  bars.push(`<rect x="${(cx-centerOffset-barW/2).toFixed(1)}" y="${ay.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0,ah).toFixed(1)}" rx="4" fill="#bfdbfe" stroke="#93c5fd"></rect>`);
  bars.push(`<rect x="${(cx+centerOffset-barW/2).toFixed(1)}" y="${wy.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0,wh).toFixed(1)}" rx="4" fill="#2563eb"></rect>`);
  const pyA=padT+plotH-(m.allocatedCount/maxCount)*plotH,pyW=padT+plotH-(m.writtenCount/maxCount)*plotH;pointsA.push(`${cx.toFixed(1)},${pyA.toFixed(1)}`);pointsW.push(`${cx.toFixed(1)},${pyW.toFixed(1)}`);
  labels.push(`<text x="${cx.toFixed(1)}" y="${height-22}" text-anchor="middle" font-size="11" fill="#475467">${m.month}월</text>`);
  hoverBands.push(`<rect class="salesMonthlyHoverBand" data-month-index="${idx}" x="${(padL+groupW*idx).toFixed(1)}" y="${padT}" width="${groupW.toFixed(1)}" height="${plotH}" fill="transparent"></rect>`);
 });
 const countAxis=[];for(let i=0;i<=countTicks;i++){const y=padT+plotH-(plotH*(i/countTicks));const val=Math.round(maxCount/countTicks*i);countAxis.push(`<text x="${width-10}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="11" fill="#667085">${val}</text>`)}
 root.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="월별 매출액 및 건수 현황 차트"><rect x="0" y="0" width="${width}" height="${height}" fill="#fff"></rect>${grid.map(g=>`<line x1="${padL}" y1="${g.y.toFixed(1)}" x2="${width-padR}" y2="${g.y.toFixed(1)}" stroke="#e5e7eb"></line><text x="${padL-10}" y="${(g.y+4).toFixed(1)}" text-anchor="end" font-size="11" fill="#667085">${salesMonthlyAmountLabel(g.val)}</text>`).join('')}<text x="${padL-4}" y="14" text-anchor="start" font-size="11" fill="#667085">매출액(백만원)</text><text x="${width-padR+8}" y="14" text-anchor="start" font-size="11" fill="#667085">건수(건)</text>${countAxis.join('')}<line x1="${padL}" y1="${padT+plotH}" x2="${width-padR}" y2="${padT+plotH}" stroke="#cdd5df"></line>${bars.join('')}<polyline fill="none" stroke="#16a34a" stroke-width="3" points="${pointsA.join(' ')}"></polyline><polyline fill="none" stroke="#f97316" stroke-width="3" points="${pointsW.join(' ')}"></polyline>${pointsA.map(p=>{const[x,y]=p.split(',');return `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="#16a34a" stroke-width="2"></circle>`}).join('')}${pointsW.map(p=>{const[x,y]=p.split(',');return `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="#f97316" stroke-width="2"></circle>`}).join('')}${labels.join('')}${hoverBands.join('')}</svg><div class="salesMonthlyTooltip" id="salesMonthlyTooltip"></div>`;
 const tip=$('salesMonthlyTooltip');let touchTimer=0;
 const showTip=(idx,e)=>{const m=data.months[idx];if(!m||!tip)return;tip.innerHTML=`<strong>${m.month}월</strong><div class="salesMonthlyTooltipRow"><span>할당 매출액</span><b>${esc(salesMonthlyOverviewMoney(m.allocated))}</b></div><div class="salesMonthlyTooltipRow"><span>작성 매출액</span><b>${esc(salesMonthlyOverviewMoney(m.written))}</b></div><div class="salesMonthlyTooltipRow"><span>할당 건수</span><b>${m.allocatedCount.toLocaleString()}건</b></div><div class="salesMonthlyTooltipRow"><span>작성 건수</span><b>${m.writtenCount.toLocaleString()}건</b></div>`;const r=root.getBoundingClientRect();const x=e.clientX-r.left+root.scrollLeft+14,y=e.clientY-r.top+root.scrollTop-26;tip.style.left=Math.max(6,x)+'px';tip.style.top=Math.max(6,y)+'px';tip.classList.add('show')};
 const hideTip=()=>tip?.classList.remove('show');
 root.querySelectorAll('.salesMonthlyHoverBand').forEach(el=>{const idx=Number(el.dataset.monthIndex);el.onpointerenter=e=>showTip(idx,e);el.onpointermove=e=>showTip(idx,e);el.onpointerleave=hideTip;el.onpointerdown=e=>{showTip(idx,e);clearTimeout(touchTimer);touchTimer=setTimeout(hideTip,2400)}});
}
function renderSalesMonthlyOverviewTables(data){
 const detail=$('salesMonthlyDetail'),summary=$('salesMonthlySummary');if(!detail||!summary)return;
 if(!data.owners.length){detail.innerHTML='<div class="salesDashEmpty">담당자를 한 명 이상 선택하면 표가 표시됩니다.</div>';summary.innerHTML='';return}
 const detailMap=new Map(data.detailRows.map(r=>[`${r.owner}|${r.month}`,r]));
 const metricDefs=[
  {key:'allocated',label:'할당 매출액',kind:'money',cls:'metricAllocated'},
  {key:'written',label:'작성 매출액',kind:'money',cls:'metricWritten'},
  {key:'allocatedCount',label:'할당 건수',kind:'count',cls:'metricCount'},
  {key:'writtenCount',label:'작성 건수',kind:'count',cls:'metricCount'}
 ];
 const format=(v,kind)=>kind==='money'?Math.round(salesNumber(v)).toLocaleString('ko-KR')+'원':Math.round(salesNumber(v)).toLocaleString('ko-KR')+'건';
 const body=data.owners.map(owner=>{
   const rows=metricDefs.map((md,ri)=>{let total=0;const monthCells=Array.from({length:12},(_,i)=>{const row=detailMap.get(`${owner}|${i+1}`),v=row?salesNumber(row[md.key]):0;total+=v;return `<td class="monthCol num">${format(v,md.kind)}</td>`}).join('');return `<tr class="${ri===0?'ownerGroupStart':''}">${ri===0?`<td class="ownerCol stickyOwner" rowspan="4">${esc(owner)}</td>`:''}<td class="metricCol stickyMetric ${md.cls}">${md.label}</td>${monthCells}<td class="totalCol num">${format(total,md.kind)}</td></tr>`}).join('');
   return rows;
 }).join('');
 const totalByMonth=Array.from({length:12},(_,i)=>{const m=data.months[i];return {allocated:m?.allocated||0,written:m?.written||0,allocatedCount:m?.allocatedCount||0,writtenCount:m?.writtenCount||0}});
 const foot=metricDefs.map((md,ri)=>{let grand=0;const cells=totalByMonth.map(m=>{const v=salesNumber(m[md.key]);grand+=v;return `<td class="monthCol num">${format(v,md.kind)}</td>`}).join('');return `<tr>${ri===0?'<th class="ownerCol stickyOwner" rowspan="4">전체 합계</th>':''}<th class="metricCol stickyMetric">${md.label}</th>${cells}<th class="totalCol num">${format(grand,md.kind)}</th></tr>`}).join('');
 detail.innerHTML=`<table id="salesMonthlyDetailTable" class="salesMonthlyTable salesMonthlyMatrix"><thead><tr><th class="ownerCol stickyOwner">담당자</th><th class="metricCol stickyMetric">항목</th>${Array.from({length:12},(_,i)=>`<th class="monthCol">${i+1}월</th>`).join('')}<th class="totalCol">합계</th></tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
 const monthFooterRate=salesMonthlyOverviewRate(data.totals.written,data.totals.allocated);
 const summaryRows=data.summaryRows.map(r=>{const rate=salesMonthlyOverviewRate(r.written,r.allocated),countRate=salesMonthlyOverviewRate(r.writtenCount,r.allocatedCount);return `<tr><td>${esc(r.owner)}</td><td class="num">${esc(salesMonthlyOverviewMoney(r.allocated))}</td><td class="num">${esc(salesMonthlyOverviewMoney(r.written))}</td><td class="num salesMonthlyRate">${rate===null?'-':rate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</td><td class="num">${r.allocatedCount.toLocaleString()}</td><td class="num">${r.writtenCount.toLocaleString()}</td><td class="num salesMonthlyRate">${countRate===null?'-':countRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</td></tr>`}).join('');
 const summaryCards=data.summaryRows.map(r=>{const rate=salesMonthlyOverviewRate(r.written,r.allocated),countRate=salesMonthlyOverviewRate(r.writtenCount,r.allocatedCount);return `<article class="salesMonthlySummaryMobileCard"><h4>${esc(r.owner)}</h4><div class="salesMonthlySummaryMobileGrid"><div><span>할당 매출액</span><b>${esc(salesMonthlyOverviewMoney(r.allocated))}</b></div><div><span>작성 매출액</span><b>${esc(salesMonthlyOverviewMoney(r.written))}</b></div><div><span>매출 달성률</span><b class="salesMonthlyRate">${rate===null?'-':rate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</b></div><div><span>할당 건수</span><b>${r.allocatedCount.toLocaleString()}건</b></div><div><span>작성 건수</span><b>${r.writtenCount.toLocaleString()}건</b></div><div><span>건수 달성률</span><b class="salesMonthlyRate">${countRate===null?'-':countRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</b></div></div></article>`}).join('');
 const totalCountRate=salesMonthlyOverviewRate(data.totals.writtenCount,data.totals.allocatedCount);
 const totalCard=`<article class="salesMonthlySummaryMobileCard total"><h4>전체 합계</h4><div class="salesMonthlySummaryMobileGrid"><div><span>할당 매출액</span><b>${esc(salesMonthlyOverviewMoney(data.totals.allocated))}</b></div><div><span>작성 매출액</span><b>${esc(salesMonthlyOverviewMoney(data.totals.written))}</b></div><div><span>매출 달성률</span><b class="salesMonthlyRate">${monthFooterRate===null?'-':monthFooterRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</b></div><div><span>할당 건수</span><b>${data.totals.allocatedCount.toLocaleString()}건</b></div><div><span>작성 건수</span><b>${data.totals.writtenCount.toLocaleString()}건</b></div><div><span>건수 달성률</span><b class="salesMonthlyRate">${totalCountRate===null?'-':totalCountRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</b></div></div></article>`;
 summary.innerHTML=`<div class="salesMonthlySummaryDesktop"><table id="salesMonthlySummaryTable" class="salesMonthlyTable"><thead><tr><th>담당자</th><th class="num">할당 매출액</th><th class="num">작성 매출액</th><th class="num">달성률</th><th class="num">할당 건수</th><th class="num">작성 건수</th><th class="num">달성률</th></tr></thead><tbody>${summaryRows||`<tr><td colspan="7" class="center salesDashEmpty">자료가 없습니다.</td></tr>`}</tbody><tfoot><tr><th>합계</th><th class="num">${esc(salesMonthlyOverviewMoney(data.totals.allocated))}</th><th class="num">${esc(salesMonthlyOverviewMoney(data.totals.written))}</th><th class="num">${monthFooterRate===null?'-':monthFooterRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</th><th class="num">${data.totals.allocatedCount.toLocaleString()}</th><th class="num">${data.totals.writtenCount.toLocaleString()}</th><th class="num">${totalCountRate===null?'-':totalCountRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</th></tr></tfoot></table></div><div class="salesMonthlySummaryMobile">${summaryCards||'<div class="salesDashEmpty">자료가 없습니다.</div>'}${summaryCards?totalCard:''}</div>`;
 scheduleTableColumnResize($('salesMonthlySummaryTable'),'sales-monthly-summary');
}
function renderSalesMonthlyOverview(){
 const title=$('salesMonthlyTitle'),kpis=$('salesMonthlyKpis');if(!title||!kpis)return;
 const data=salesMonthlyOverviewData(); const year=data.year||'연도';
 title.textContent=`${year}년 월별 담당자별 매출 현황`;
 const rate=salesMonthlyOverviewRate(data.totals.written,data.totals.allocated);
 const countRate=salesMonthlyOverviewRate(data.totals.writtenCount,data.totals.allocatedCount);
 kpis.innerHTML=`<div><span>연간 할당 매출 합계</span><b>${esc(salesMonthlyOverviewMoney(data.totals.allocated))}</b><small>1월~12월 할당 매출액 합계</small></div><div><span>연간 작성 매출 합계</span><b>${esc(salesMonthlyOverviewMoney(data.totals.written))}</b><small>할당 대비 ${rate===null?'-':rate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</small></div><div><span>연간 할당 건수</span><b>${data.totals.allocatedCount.toLocaleString()}건</b><small>1월~12월 할당 건수 합계</small></div><div><span>연간 작성 건수</span><b>${data.totals.writtenCount.toLocaleString()}건</b><small>할당 대비 ${countRate===null?'-':countRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</small></div>`;
 renderSalesMonthlyOverviewChart(data); renderSalesMonthlyOverviewTables(data);
}
function salesDashboardAggregates(){
 const year=$('salesDashYear')?.value||'',month=$('salesDashMonth')?.value||'';
 const selected=new Set(salesDashboardOwners),map=new Map([...selected].map(o=>[o,{owner:o,allocated:0,written:0,allocatedCount:0,writtenCount:0}]));
 salesAssignedRows.filter(a=>String(a.allocation_year)===String(year)&&(salesDashboardPeriod==='annual'||Number(a.allocation_month)===Number(month))&&selected.has(String(a.owner_name||'').trim())).forEach(a=>{
  const item=map.get(String(a.owner_name||'').trim());if(!item)return;
  item.allocated+=salesNumber(a.allocation_amount);
  item.allocatedCount+=Math.max(0,Math.round(salesNumber(a.assigned_count)));
  item.written+=salesNumber(a.written_amount);
  item.writtenCount+=Math.max(0,Math.round(salesNumber(a.written_count)));
 });
 const items=[...map.values()].sort((a,b)=>b.written-a.written||b.allocated-a.allocated||a.owner.localeCompare(b.owner,'ko'));
 return{year,month,writtenRows:[],items,totalWritten:items.reduce((n,x)=>n+x.written,0),totalAllocated:items.reduce((n,x)=>n+x.allocated,0),totalWrittenCount:items.reduce((n,x)=>n+x.writtenCount,0),totalAllocatedCount:items.reduce((n,x)=>n+x.allocatedCount,0)};
}
function renderSalesDashboard(){
 if(!salesDashboardInitialized)return;
 const kpi=$('salesDashKpis'),chart=$('salesDashChart'),summary=$('salesDashSummary');if(!kpi||!chart||!summary)return;
 if(!salesDashboardOwners.size){
  kpi.innerHTML='';chart.innerHTML='<div class="salesDashEmpty">대시보드에서 조회할 담당자를 한 명 이상 선택해 주세요.</div>';summary.innerHTML='';saveSalesDashboardPrefs();return;
 }
 const d=salesDashboardAggregates(),periodLabel=salesDashboardPeriod==='annual'?`${d.year}년 연간`:`${d.year}년 ${d.month}월`;
 const totalRate=salesDashboardRate(d.totalWritten,d.totalAllocated),maxAmount=Math.max(0,...d.items.flatMap(x=>[x.allocated,x.written])),maxCount=Math.max(0,...d.items.flatMap(x=>[x.allocatedCount,x.writtenCount]));
 kpi.innerHTML=`<div><span>조회 기간</span><b>${esc(periodLabel)}</b></div><div><span>선택 담당자</span><b>${d.items.length.toLocaleString()}명</b></div><div><span>할당 매출 합계</span><b>${esc(salesDashboardMoney(d.totalAllocated))}</b><small>접수월부터 완료월까지 · 미완료는 현재월까지만 이월</small></div><div><span>작성 매출 합계</span><b>${esc(salesDashboardMoney(d.totalWritten))}</b></div><div><span>할당/작성 건수</span><b>${d.totalAllocatedCount.toLocaleString()}건 / ${d.totalWrittenCount.toLocaleString()}건</b></div><div><span>할당 대비 작성률</span><b>${totalRate===null?'-':totalRate.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}</b></div>`;
 $('salesDashChartTitle').textContent=`${periodLabel} 담당자별 할당·작성 매출액 및 건수`;
 chart.innerHTML=d.items.map(x=>{
  const ap=maxAmount>0?Math.max(x.allocated>0?1:0,Math.round(x.allocated/maxAmount*1000)/10):0,wp=maxAmount>0?Math.max(x.written>0?1:0,Math.round(x.written/maxAmount*1000)/10):0;
  const ac=maxCount>0?Math.max(x.allocatedCount>0?2:0,Math.round(x.allocatedCount/maxCount*1000)/10):0,wc=maxCount>0?Math.max(x.writtenCount>0?2:0,Math.round(x.writtenCount/maxCount*1000)/10):0;
  return `<div class="salesDashCompareRow"><div class="salesDashBarLabel" title="${esc(x.owner)}">${esc(x.owner)}</div><div class="salesDashCompareGroup"><div class="salesDashCompareGroupTitle">매출액</div><div class="salesDashCompareBars"><div class="salesDashMetricRow"><span>할당</span><div class="salesDashBarTrack"><div class="salesDashBarFill allocation" style="width:${ap}%"></div></div><b>${esc(salesDashboardMoney(x.allocated))}</b></div><div class="salesDashMetricRow"><span>작성</span><div class="salesDashBarTrack"><div class="salesDashBarFill written" style="width:${wp}%"></div></div><b>${esc(salesDashboardMoney(x.written))}</b></div></div></div><div class="salesDashCompareGroup count"><div class="salesDashCompareGroupTitle">건수</div><div class="salesDashCompareBars"><div class="salesDashMetricRow"><span>할당</span><div class="salesDashBarTrack countTrack"><div class="salesDashBarFill allocation" style="width:${ac}%"></div></div><b>${x.allocatedCount.toLocaleString()}건</b></div><div class="salesDashMetricRow"><span>작성</span><div class="salesDashBarTrack countTrack"><div class="salesDashBarFill written" style="width:${wc}%"></div></div><b>${x.writtenCount.toLocaleString()}건</b></div></div></div></div>`;
 }).join('')||'<div class="salesDashEmpty">해당 기간의 매출 자료가 없습니다.</div>';
 const summaryOrder=salesDashSummaryColumnOrder();
 const rows=d.items.map((x,i)=>`<tr>${summaryOrder.map(key=>salesDashSummaryCell(key,x,i,d,totalRate)).join('')}</tr>`).join('');
 const headers=summaryOrder.map(key=>`<th data-summary-key="${key}" data-resize-key="${key}" draggable="true" title="드래그: 열 이동 · 오른쪽 경계선 드래그: 열 폭 조절"><span>${esc(SALES_DASH_SUMMARY_LABELS[key])}</span></th>`).join('');
 const footer=summaryOrder.map(key=>salesDashSummaryFooterCell(key,d,totalRate)).join('');
 summary.innerHTML=`<div class="salesDashTableHelp"><strong>열 이동:</strong> 제목을 좌우로 드래그 · <strong>열 폭:</strong> 제목 오른쪽 경계선을 좌우로 드래그하세요. 설정은 사용자별로 자동 저장됩니다.</div><div class="salesDashTableWrap"><table id="salesDashSummaryTable" class="salesDashTable salesDashReorderable"><thead><tr>${headers}</tr></thead><tbody>${rows||`<tr><td colspan="${summaryOrder.length}" class="salesDashEmpty">자료가 없습니다.</td></tr>`}</tbody><tfoot><tr>${footer}</tr></tfoot></table></div>`;
 const summaryTable=$('salesDashSummaryTable');bindSalesDashSummaryHeaderInteractions(summaryTable);scheduleTableColumnResize(summaryTable,'sales-dashboard-summary');renderSalesMonthlyOverview();saveSalesDashboardPrefs();
}
async function loadSales(force=false){
 if(!canViewSales())return;
 if(!force&&salesCacheReady&&cacheFresh(salesLoadedAt)){renderSales();return}
 if(salesLoadPromise&&!force)return salesLoadPromise;
 salesLoadPromise=(async()=>{try{
  const [salesData,allocationData]=await Promise.all([fetchPaged('staff_sales_fast','*',q=>q.order('sales_year',{ascending:false}).order('sales_month',{ascending:false})),fetchPaged('staff_site_source','id,excel_row,document_owner,document_owner_raw,full_values,report_complete_date,sales_amount,contract_amount,performance_amount,maintenance_amount,manager_amount',q=>q.order('excel_row',{ascending:true}).order('id',{ascending:true}))]);
  salesRows=salesData.filter(r=>r.sales_year&&r.sales_month&&String(r.document_owner||'').trim()&&salesReportCompleted(r));salesAssignedRows=buildSalesAssignments(allocationData||[]);salesCacheReady=true;salesLoadedAt=Date.now();salesImported=false;fillSalesFilters();renderSales();
 }catch(e){alert('매출 자료 조회 오류: '+e.message)}finally{salesLoadPromise=null}})();
 return salesLoadPromise;
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
 setupSalesDashboardFilters();
}
function updateSalesPageTitle(year=null,month=null,owner=null){
 const y=String(year??$('salesYear')?.value??'').trim();
 const m=String(month??$('salesMonth')?.value??'all').trim();
 const o=owner===null?String($('salesOwner')?.value??'all').trim():String(owner??'all').trim();
 const period=y?(m&&m!=='all'?`${y}년 ${Number(m)}월`:`${y}년`):'';
 const ownerText=o&&o!=='all'?` - ${o}`:'';
 const title=`${period}${period?' ':''}보고서 작성 완료 매출 관리${ownerText}`;
 if($('salesTitle'))$('salesTitle').textContent=title;
 return title;
}
function updateSalesTitleFromDashboard(){
 const y=$('salesDashYear')?.value||'';
 const m=salesDashboardPeriod==='monthly'?($('salesDashMonth')?.value||''):'all';
 updateSalesPageTitle(y,m,'all');
}
const SALES_LIST_KEYS=['no','site','contractType','inspector','contractAmount','managerAmount','salesAmount','remark'];
const SALES_LIST_COLUMNS={
 no:{label:'No.',sortable:false,width:4},
 site:{label:'현장명',sortable:true,width:31},
 contractType:{label:'계약 구분<br>(유지/성능/유지선임)',plain:'계약 구분',sortable:true,width:14},
 inspector:{label:'점검참여자',sortable:true,width:14},
 contractAmount:{label:'계약 금액<br>(VAT 별도)',plain:'계약 금액 (VAT 별도)',sortable:true,width:10},
 managerAmount:{label:'유지관리자<br>선임비(VAT 별도)',plain:'유지관리자 선임비(VAT 별도)',sortable:true,width:10},
 salesAmount:{label:'매출액<br>(VAT 별도)',plain:'매출액 (VAT 별도)',sortable:true,width:10},
 remark:{label:'비고',sortable:true,width:7}
};
function salesListOrderStorageKey(){return `staff_sales_list_column_order:${me?.id||'guest'}`}
function salesListSortStorageKey(){return `staff_sales_list_sort:${me?.id||'guest'}`}
function ensureSalesListColumnOrder(){
 let saved=[];try{saved=JSON.parse(localStorage.getItem(salesListOrderStorageKey())||'[]')}catch(e){}
 const seen=new Set(),out=[];(Array.isArray(saved)?saved:[]).forEach(k=>{k=String(k);if(SALES_LIST_KEYS.includes(k)&&!seen.has(k)){seen.add(k);out.push(k)}});SALES_LIST_KEYS.forEach(k=>{if(!seen.has(k))out.push(k)});
 // No.는 행 번호이므로 항상 첫 열에 유지하고 나머지 정보열만 자유롭게 이동합니다.
 salesListColumnOrder=['no',...out.filter(k=>k!=='no')];
 if(!salesListSort.key){try{const st=JSON.parse(localStorage.getItem(salesListSortStorageKey())||'null');if(st&&SALES_LIST_COLUMNS[st.key]?.sortable&&['asc','desc'].includes(st.dir))salesListSort=st}catch(e){}}
 return salesListColumnOrder;
}
function salesListSortValue(r,key){
 if(key==='site')return r.site_name||'';
 if(key==='contractType')return salesContractType(r);
 if(key==='inspector')return r.field_inspector||'';
 if(key==='contractAmount')return salesContractAmount(r);
 if(key==='managerAmount')return salesNumber(r.manager_amount);
 if(key==='salesAmount')return salesAmount(r);
 if(key==='remark')return salesRemark(r).text;
 return '';
}
function sortedSalesListRows(rows){
 if(!salesListSort.key)return rows;
 const key=salesListSort.key,dir=salesListSort.dir==='desc'?-1:1;
 return [...rows].sort((a,b)=>{const cmp=compareSiteListValues(salesListSortValue(a,key),salesListSortValue(b,key));if(cmp)return cmp*dir;return String(a.site_name||'').localeCompare(String(b.site_name||''),'ko')});
}
function toggleSalesListSort(key){
 if(!SALES_LIST_COLUMNS[key]?.sortable)return;
 if(salesListSort.key===key)salesListSort.dir=salesListSort.dir==='asc'?'desc':'asc';else salesListSort={key,dir:'asc'};
 try{localStorage.setItem(salesListSortStorageKey(),JSON.stringify(salesListSort))}catch(e){}
 renderSales();
}
function moveSalesListColumn(from,target,after=false){
 ensureSalesListColumnOrder();if(!from||!target||from===target||from==='no'||target==='no')return;
 const next=salesListColumnOrder.filter(k=>k!==from),idx=next.indexOf(target);if(idx<0)return;next.splice(idx+(after?1:0),0,from);salesListColumnOrder=['no',...next.filter(k=>k!=='no')];
 try{localStorage.setItem(salesListOrderStorageKey(),JSON.stringify(salesListColumnOrder))}catch(e){};renderSales();
}
function salesListHeaderHtml(key){
 const c=SALES_LIST_COLUMNS[key],active=salesListSort.key===key,arrow=active?(salesListSort.dir==='asc'?' ▲':' ▼'):'';
 const movable=key!=='no';return `<th data-sales-col-key="${key}" data-col-key="${key}" data-sortable="${c.sortable?'1':'0'}" class="sales-col-${key} ${c.sortable?'sortableHeader':''} ${active?'sortActive':''}" draggable="${movable?'true':'false'}" title="${c.sortable?'클릭: 오름/내림차순 정렬 · ':''}${movable?'드래그: 열 이동':'행 번호 열'}"><span>${c.label}${arrow}</span></th>`;
}
function salesListCellHtml(r,key,index){
 const remark=salesRemark(r);
 if(key==='no')return `<td class="center sales-col-no">${index+1}</td>`;
 if(key==='site')return `<td class="sales-col-site">${esc(r.site_name||'')}</td>`;
 if(key==='contractType')return `<td class="center sales-col-contractType">${esc(salesContractType(r))}</td>`;
 if(key==='inspector')return `<td class="sales-col-inspector">${esc(r.field_inspector||'-')}</td>`;
 if(key==='contractAmount')return `<td class="num sales-col-contractAmount">${salesMoney(salesContractAmount(r))}</td>`;
 if(key==='managerAmount')return `<td class="num sales-col-managerAmount">${salesMoney(salesNumber(r.manager_amount))}</td>`;
 if(key==='salesAmount')return `<td class="num sales-col-salesAmount">${salesMoney(salesAmount(r))}</td>`;
 if(key==='remark')return `<td class="sales-col-remark ${remark.done?'salesDone':''}">${esc(remark.text)}</td>`;
 return '<td></td>';
}
function salesListTotalCell(key,totals){
 if(key==='site')return '<td class="center salesTotalLabel">매출 합계</td>';
 if(key==='contractAmount')return `<td class="num">${salesMoney(totals.contract)}</td>`;
 if(key==='managerAmount')return `<td class="num">${salesMoney(totals.manager)}</td>`;
 if(key==='salesAmount')return `<td class="num">${salesMoney(totals.sales)}</td>`;
 return '<td></td>';
}
function bindSalesListHeaderInteractions(table){
 if(!table)return;let dragKey=null;
 const clear=()=>table.querySelectorAll('thead th').forEach(x=>x.classList.remove('dragging','dragBefore','dragAfter'));
 table.querySelectorAll('thead th[data-sales-col-key]').forEach(th=>{
  const key=th.dataset.salesColKey;
  th.onclick=e=>{if(suppressSalesSortClick||e.target.closest('.columnResizer'))return;if(th.dataset.sortable==='1')toggleSalesListSort(key)};
  if(key==='no')return;
  th.ondragstart=e=>{if(e.target.closest('.columnResizer')){e.preventDefault();return}suppressSalesSortClick=true;dragKey=key;th.classList.add('dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',key)}catch(err){}};
  th.ondragover=e=>{if(!dragKey||key==='no')return;e.preventDefault();const rect=th.getBoundingClientRect();th.classList.toggle('dragBefore',e.clientX<=rect.left+rect.width/2);th.classList.toggle('dragAfter',e.clientX>rect.left+rect.width/2)};
  th.ondragleave=()=>th.classList.remove('dragBefore','dragAfter');
  th.ondrop=e=>{e.preventDefault();const rect=th.getBoundingClientRect(),after=e.clientX>rect.left+rect.width/2;clear();const from=dragKey;dragKey=null;setTimeout(()=>{suppressSalesSortClick=false},120);moveSalesListColumn(from,key,after)};
  th.ondragend=()=>{clear();dragKey=null;setTimeout(()=>{suppressSalesSortClick=false},120)};
 });
}
function salesFreezeStorageKey(){return `staff_sales_freeze_panes:${me?.id||'guest'}`}
function readSalesFreezePanes(){try{const v=JSON.parse(localStorage.getItem(salesFreezeStorageKey())||'{}');return{rows:Math.max(0,Number(v?.rows)||0),cols:Math.max(0,Number(v?.cols)||0)}}catch(e){return{rows:0,cols:0}}}
function saveSalesFreezePanes(rows,cols){try{localStorage.setItem(salesFreezeStorageKey(),JSON.stringify({rows:Math.max(0,rows|0),cols:Math.max(0,cols|0)}))}catch(e){}}
function salesFreezeStatusText(){const f=readSalesFreezePanes();if(salesFreezeSelectMode)return '표에서 기준 셀을 클릭하세요. 클릭한 셀의 위쪽 행과 왼쪽 열이 고정됩니다.';if(!f.rows&&!f.cols)return '고정 안 됨';const a=[];if(f.rows)a.push(f.rows===1?'제목행':`제목행 + 위쪽 ${f.rows-1}개 현장행`);if(f.cols)a.push(`왼쪽 ${f.cols}개 열`);return a.join(' · ')+' 고정 중'}
function updateSalesFreezeControls(){const a=$('salesFreezeSelectBtn'),b=$('salesFreezeClearBtn'),st=$('salesFreezeStatus');if(a){a.classList.toggle('active',salesFreezeSelectMode);a.textContent=salesFreezeSelectMode?'📍 고정할 셀을 클릭하세요':'📌 틀 고정 위치 선택'}const f=readSalesFreezePanes();if(b)b.disabled=!f.rows&&!f.cols;if(st)st.textContent=salesFreezeStatusText()}
function resetSalesFreezeStyles(table){if(!table)return;table.querySelectorAll('th,td').forEach(cell=>{cell.classList.remove('salesFreezeCell','salesFreezeCorner','salesFreezeBoundaryRight','salesFreezeBoundaryBottom');cell.style.removeProperty('left');cell.style.removeProperty('top');cell.style.removeProperty('z-index')});table.classList.remove('salesFreezeActive')}
function applySalesFreezePanes(table){
 if(!table||!window.matchMedia('(min-width:801px)').matches)return;resetSalesFreezeStyles(table);const f=readSalesFreezePanes(),allRows=[...table.rows];if(!allRows.length||(!f.rows&&!f.cols)){updateSalesFreezeControls();return}
 const rowCount=Math.min(f.rows,allRows.length),maxCols=Math.max(...allRows.map(r=>r.cells.length)),colCount=Math.min(f.cols,maxCols);if(!rowCount&&!colCount){updateSalesFreezeControls();return}table.classList.add('salesFreezeActive');
 const colLeft=[];let left=0;for(let c=0;c<colCount;c++){colLeft[c]=left;const ref=allRows[0]?.cells?.[c];left+=ref?ref.getBoundingClientRect().width:0}
 const rowTop=[];let top=0;for(let r=0;r<rowCount;r++){rowTop[r]=top;top+=allRows[r]?.getBoundingClientRect().height||0}
 allRows.forEach((row,r)=>[...row.cells].forEach((cell,c)=>{const fr=r<rowCount,fc=c<colCount;if(!fr&&!fc)return;cell.classList.add('salesFreezeCell');if(fc)cell.style.left=`${Math.round(colLeft[c]||0)}px`;if(fr)cell.style.top=`${Math.round(rowTop[r]||0)}px`;cell.style.zIndex=fr&&fc?'8':fr?'6':'5';if(fc&&c===colCount-1)cell.classList.add('salesFreezeBoundaryRight');if(fr&&r===rowCount-1)cell.classList.add('salesFreezeBoundaryBottom');if(fr&&fc)cell.classList.add('salesFreezeCorner') }));updateSalesFreezeControls();
}
function scheduleSalesFreezeLayout(table){if(!table||!window.matchMedia('(min-width:801px)').matches)return;if(salesFreezeLayoutFrame)cancelAnimationFrame(salesFreezeLayoutFrame);salesFreezeLayoutFrame=requestAnimationFrame(()=>{salesFreezeLayoutFrame=0;applySalesFreezePanes(table)})}
function clearSalesFreezePanes(){salesFreezeSelectMode=false;saveSalesFreezePanes(0,0);const t=$('salesTable');if(t){t.classList.remove('salesFreezePicking');applySalesFreezePanes(t)}updateSalesFreezeControls()}
function selectSalesFreezeCell(cell){const table=cell?.closest?.('#salesTable');if(!table)return;const row=cell.parentElement,rowIndex=[...table.rows].indexOf(row),colIndex=[...row.cells].indexOf(cell);if(rowIndex<0||colIndex<0)return;saveSalesFreezePanes(rowIndex,colIndex);salesFreezeSelectMode=false;table.classList.remove('salesFreezePicking');applySalesFreezePanes(table);updateSalesFreezeControls()}
function bindSalesFreezeControls(table){
 if(!table)return;const a=$('salesFreezeSelectBtn'),b=$('salesFreezeClearBtn');if(a)a.onclick=()=>{salesFreezeSelectMode=!salesFreezeSelectMode;table.classList.toggle('salesFreezePicking',salesFreezeSelectMode);updateSalesFreezeControls()};if(b)b.onclick=()=>clearSalesFreezePanes();
 if(table.dataset.salesFreezeBound!=='1'){table.dataset.salesFreezeBound='1';table.addEventListener('click',e=>{if(!salesFreezeSelectMode)return;const cell=e.target.closest('th,td');if(!cell||!table.contains(cell))return;e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();selectSalesFreezeCell(cell)},true)}
 updateSalesFreezeControls();scheduleSalesFreezeLayout(table);
}
function filteredSales(){
 const y=$('salesYear').value,m=$('salesMonth').value,o=$('salesOwner').value;
 $('salesMonth').dataset.last=m;
 return salesRows.filter(r=>salesReportCompleted(r)&&String(r.sales_year)===String(y)&&(m==='all'||Number(r.sales_month)===Number(m))&&(o==='all'||salesOwnerName(r)===o));
}
function renderSales(){
 salesImported=false;
 const y=$('salesYear').value,m=$('salesMonth').value,o=$('salesOwner').value,order=ensureSalesListColumnOrder(),rows=sortedSalesListRows(filteredSales());
 let tc=0,tm=0,ts=0;rows.forEach(r=>{tc+=salesContractAmount(r);tm+=salesNumber(r.manager_amount);ts+=salesAmount(r)});
 const table=$('salesTable'),head=$('salesHead'),body=$('salesBody'),foot=$('salesFoot');
 const cg=table.querySelector(':scope > colgroup');if(cg)cg.innerHTML=order.map(k=>`<col style="width:${SALES_LIST_COLUMNS[k].width}%">`).join('');
 head.innerHTML=`<tr>${order.map(salesListHeaderHtml).join('')}</tr>`;
 body.innerHTML=rows.length?rows.map((r,i)=>`<tr>${order.map(k=>salesListCellHtml(r,k,i)).join('')}</tr>`).join('')+`<tr class="totalrow">${order.map(k=>salesListTotalCell(k,{contract:tc,manager:tm,sales:ts})).join('')}</tr>`:`<tr><td colspan="${order.length}" class="emptyrow">선택한 조건에 해당하는 보고서 작성 완료 건이 없습니다.</td></tr>`;
 foot.innerHTML='';updateSalesPageTitle(y,m,o);
 bindSalesListHeaderInteractions(table);bindSalesFreezeControls(table);scheduleTableColumnResize(table,'sales');setTimeout(()=>scheduleSalesFreezeLayout(table),80);
 if(salesDashboardInitialized)renderSalesDashboard();
}
function exportSales(){
 if(!isAdmin())return alert('매출 엑셀 내보내기는 관리자만 사용할 수 있습니다.');
 try{if(!window.XLSX)throw new Error('엑셀 라이브러리를 불러오지 못했습니다.');const table=$('salesTable'),exportTable=cleanResizableTableClone(table);const wb=XLSX.utils.table_to_book(exportTable,{sheet:'매출 관리',raw:true});XLSX.writeFile(wb,`${updateSalesPageTitle()}.xlsx`)}catch(e){alert('엑셀 내보내기 실패\n\n'+e.message)}
}
async function importSalesExcel(file){
 if(!file)return;if(!isAdmin())return alert('매출 엑셀 가져오기는 관리자만 사용할 수 있습니다.');
 try{
  if(!window.XLSX)throw new Error('엑셀 라이브러리를 불러오지 못했습니다.');
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:''}),body=rows.filter(r=>String(r['현장명']||'').trim());
  if(!body.length)throw new Error('현장명이 있는 매출 관리표를 찾지 못했습니다.');
  let tc=0,tm=0,ts=0;
  $('salesBody').innerHTML=body.map((r,i)=>{const c=salesNumber(r['계약 금액 (VAT 별도)']),m=salesNumber(r['유지관리자 선임비(VAT 별도)']),sale=salesNumber(r['매출액 (VAT 별도)']);tc+=c;tm+=m;ts+=sale;const note=String(r['비고']||'');return `<tr><td class="center">${i+1}</td><td>${esc(r['현장명'])}</td><td class="center">${esc(r['계약 구분 (유지/성능/유지선임)']||'')}</td><td>${esc(r['점검참여자']||'')}</td><td class="num">${salesMoney(c)}</td><td class="num">${salesMoney(m)}</td><td class="num">${salesMoney(sale)}</td><td class="${note==='완료'?'salesDone':''}">${esc(note)}</td></tr>`}).join('')+`<tr class="totalrow"><td colspan="4" class="center">매출 합계</td><td class="num">${salesMoney(tc)}</td><td class="num">${salesMoney(tm)}</td><td class="num">${salesMoney(ts)}</td><td></td></tr>`;
  $('salesFoot').innerHTML='';salesImported=true;scheduleTableColumnResize($('salesTable'),'sales');
 }catch(e){alert('엑셀 가져오기 실패\n\n'+e.message)}
}
function printSalesReport(){
 if(!isAdmin())return alert('매출 출력은 관리자만 사용할 수 있습니다.');
 const title=updateSalesPageTitle(),table=$('salesTable');
 if(!table)return alert('출력할 매출 관리표를 찾지 못했습니다.');
 const w=window.open('','sales_print','width=980,height=760');
 if(!w)return alert('출력 창이 차단되었습니다. 브라우저의 팝업 차단을 해제한 뒤 다시 눌러주세요.');
 const printTable=cleanResizableTableClone(table);
 printTable.querySelectorAll('.totalrow td.num').forEach(td=>{
  const len=String(td.textContent||'').replace(/\s/g,'').length;
  td.classList.add('printTotalNumber');
  td.style.fontSize=len>=14?'5.2pt':len>=12?'5.7pt':len>=10?'6.3pt':'7pt';
 });
 w.document.open();w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4 portrait;margin:10mm 8mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,'Malgun Gothic',sans-serif;color:#111}h1{text-align:center;font-size:15pt;margin:0 0 6mm}.salesReportTable{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}.salesReportTable thead{display:table-header-group}.salesReportTable tr{break-inside:avoid;page-break-inside:avoid}.salesReportTable th{background:#0877bd!important;color:#fff!important;font-weight:900;text-align:center;border:1px solid #fff;padding:5px 3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.salesReportTable td{border:1px solid #aeb7c2;padding:5px 3px;vertical-align:middle;word-break:break-word}.salesReportTable td.num{text-align:right}.salesReportTable td.center{text-align:center}.salesReportTable .totalrow td{font-weight:900;background:#0877bd!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.salesReportTable .totalrow td.num,.salesReportTable .totalrow td:last-child{background:#fff!important;color:#111!important}.salesReportTable .totalrow td.printTotalNumber{white-space:nowrap!important;word-break:normal!important;overflow-wrap:normal!important;letter-spacing:-.15px;padding-left:1px!important;padding-right:2px!important;font-variant-numeric:tabular-nums;line-height:1.05}.salesReportTable .salesDone{color:#a7adb5}.salesReportTable .emptyrow{text-align:center;color:#68768a;padding:20px}</style></head><body><h1>${esc(title)}</h1>${printTable.outerHTML}</body></html>`);w.document.close();w.focus();setTimeout(()=>w.print(),300);
}
async function importWorkbook(file){if(!canImportSites())return alert('엑셀 DB 등록 권한이 없습니다.');if(!confirm('선택한 엑셀의 진행중 시트 전체를 서버 DB와 동기화합니다. 계속할까요?'))return;const overlay=$('importOverlay'),bar=$('importBar'),text=$('importText');overlay.classList.remove('hidden');bar.style.width='2%';text.textContent='엑셀 파일 읽는 중...';try{const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:false}),ws=wb.Sheets['진행중']||wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});const token=uuid(),batch=[];let count=0,total=0;for(let ri=3;ri<rows.length;ri++)if(String(rows[ri]?.[3]||'').trim())total++;const flush=async()=>{if(!batch.length)return;const payload=batch.splice(0);const{error}=await sb.from('staff_site_source').upsert(payload,{onConflict:'excel_row'});if(error)throw error;count+=payload.length;const pct=Math.min(94,5+Math.round(count/Math.max(total,1)*89));bar.style.width=pct+'%';text.textContent=`현장 DB 등록 중 ${count.toLocaleString()} / ${total.toLocaleString()}건`};for(let ri=3;ri<rows.length;ri++){const a=rows[ri]||[],site=String(a[3]||'').trim();if(!site)continue;const vals=Array.from({length:137},(_,i)=>normalizeCell(a[i],i+1));const safe=vals.map((v,i)=>financialCols.has(i+1)?null:v),op=ownerParts(vals[18]),ym=inferYearMonth(vals,op),num=i=>vals[i]===''?null:(Number.isFinite(Number(vals[i]))?Number(vals[i]):null);batch.push({excel_row:ri+1,source_file:file.name,sn:String(vals[0]||''),site_name:site,previous_name:String(vals[4]||''),report_grade:String(vals[1]||''),region:String(vals[16]||''),area:num(5),households:String(vals[6]||''),approval_date:String(vals[7]||''),inspection_stage:String(vals[8]||''),document_owner_raw:String(vals[18]||''),document_owner:op.owner,document_progress_month:String(vals[19]||''),document_complete_month:String(vals[20]||''),field_plan_start:String(vals[27]||''),field_plan_end:String(vals[28]||''),field_end:String(vals[29]||''),field_inspector:String(vals[30]||''),report_complete_date:String(vals[31]||''),report_status:String(vals[32]||''),sales_manager:String(vals[40]||''),client_manager:String(vals[41]||''),client_contact:String(vals[42]||''),contract_start:String(vals[43]||''),contract_end:String(vals[44]||''),performance_amount:num(45),maintenance_amount:num(46),manager_amount:num(47),contract_amount:num(48),sales_amount:num(49),binding_cost:num(50),binding_ratio:num(51),sales_year:ym.year,sales_month:ym.month,full_values:vals,safe_values:safe,import_token:token});if(batch.length>=100)await flush()}await flush();text.textContent='이전 DB와 동기화 중...';const{error:delErr}=await sb.from('staff_site_source').delete().neq('import_token',token);if(delErr)throw delErr;let aux={sheet_names:wb.SheetNames};const auxWs=wb.Sheets['Sheet1'];if(auxWs)aux.Sheet1=XLSX.utils.sheet_to_json(auxWs,{header:1,defval:'',raw:false});const{error:metaErr}=await sb.from('staff_workbook_meta').insert({source_file:file.name,source_sheet:'진행중',field_schema:schema.fields,auxiliary_sheets:aux,record_count:count,imported_by:me.id});if(metaErr)throw metaErr;bar.style.width='100%';text.textContent=`완료: ${count.toLocaleString()}개 현장을 서버 DB에 저장했습니다.`;setTimeout(()=>overlay.classList.add('hidden'),900);invalidateDataCaches('sites');await Promise.all([refreshDbStatus(),refreshActiveData(true)]);alert(`${count.toLocaleString()}개 현장을 전체 DB와 동기화했습니다.`)}catch(e){overlay.classList.add('hidden');throw e}}
async function exportAllSites(){
 if(!canExportAllSites())return alert('전체 현장정보 엑셀 내려받기 권한이 없습니다.');
 if(!window.XLSX)return alert('엑셀 라이브러리를 불러오지 못했습니다.');
 const btn=$('allSitesExportBtn'),oldText=btn?.textContent||'⇩ 전체 엑셀 내려받기';
 try{
  if(btn){btn.disabled=true;btn.textContent='엑셀 생성 중...'}
  const rows=await fetchPaged('staff_site_source','id,excel_row,source_file,site_name,client_phone,client_email,site_address,full_values',q=>q.order('excel_row',{ascending:true}));
  if(!rows.length)return alert('내려받을 현장정보가 없습니다.');
  const extraHeaders=['관리주체 전화번호(분리)','관리주체 이메일(분리)','주소','등록구분','DB ID','원본파일'];
  const headers=[...schema.fields.map(siteExportFieldLabel),...extraHeaders];
  const aoa=[headers];
  for(const r of rows){
    let vals=Array.isArray(r.full_values)?[...r.full_values]:Array(137).fill('');
    while(vals.length<137)vals.push('');
    vals=vals.slice(0,137).map((v,i)=>normalizeCell(v,i+1));
    aoa.push([...vals,formatPhoneList(r.client_phone||''),String(r.client_email||''),String(r.site_address||''),Number(r.excel_row)<0?'직접등록':'Excel/DB',r.id,String(r.source_file||'')]);
  }
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=headers.map((h,i)=>({
    wch:i===3?32:i===headers.length-4?45:Math.min(24,Math.max(9,String(h).length+2)),
    hidden:[17,19,29,81,109].includes(i)
  }));
  ws['!autofilter']={ref:`A1:${XLSX.utils.encode_col(headers.length-1)}${aoa.length}`};
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'전체 현장정보');
  const now=new Date(),pad=n=>String(n).padStart(2,'0'),stamp=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const info=[['항목','내용'],['내려받은 일시',`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`],['현장 수',rows.length],['내려받은 사용자',me?.name||me?.user_id||''],['안내','DB 호환을 위해 137개 원본 열 위치는 유지합니다. 계약만료일·문서작성 진행월·현장점검 종료 등 화면에서 삭제한 항목은 숨김 열로 보존하며, 표시 이름은 짧게 정리했습니다.']];
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
   invalidateDataCaches('sites');await Promise.all([refreshDbStatus(),refreshActiveData(true)]);
   const n=Number(data?.deleted_source||0);
   alert(`${n.toLocaleString()}개 현장을 삭제했습니다. 사용자 계정과 권한은 유지되었습니다.`);
 }catch(e){
   alert('전체 DB 삭제 오류: '+e.message);
 }finally{
   if(btn){btn.disabled=false;btn.textContent=oldText||'전체 DB 삭제'}
 }
}

function userPermissionKeys(){return ['approved','can_use_staff_portal','can_view_staff_sites','can_create_staff_sites','can_edit_staff_sites','can_view_money','can_create_money','can_edit_money','can_export_staff_sites','can_view_staff_sales','can_export_staff_sales','can_print_staff_sales','can_import_staff_sites','can_manage_staff_users']}
function syncUserRowDependencies(tr,changedKey=''){
 const get=k=>tr.querySelector(`[data-k="${k}"]`),role=get('role')?.value||'viewer';
 const boxes=Object.fromEntries(userPermissionKeys().map(k=>[k,get(k)]));
 if(role==='admin'){
  Object.values(boxes).forEach(el=>{if(el)el.checked=true});
 }else{
  if(['can_create_staff_sites','can_edit_staff_sites','can_export_staff_sites','can_import_staff_sites','can_view_money','can_create_money','can_edit_money'].includes(changedKey)&&boxes[changedKey]?.checked&&boxes.can_view_staff_sites)boxes.can_view_staff_sites.checked=true;
  if(changedKey==='can_create_money'&&boxes.can_create_money?.checked){if(boxes.can_view_money)boxes.can_view_money.checked=true;if(boxes.can_create_staff_sites)boxes.can_create_staff_sites.checked=true}
  if(changedKey==='can_edit_money'&&boxes.can_edit_money?.checked){if(boxes.can_view_money)boxes.can_view_money.checked=true;if(boxes.can_edit_staff_sites)boxes.can_edit_staff_sites.checked=true}
  if(changedKey==='can_view_money'&&!boxes.can_view_money?.checked){['can_create_money','can_edit_money'].forEach(k=>{if(boxes[k])boxes[k].checked=false})}
  if(changedKey==='can_create_staff_sites'&&!boxes.can_create_staff_sites?.checked&&boxes.can_create_money)boxes.can_create_money.checked=false;
  if(changedKey==='can_edit_staff_sites'&&!boxes.can_edit_staff_sites?.checked&&boxes.can_edit_money)boxes.can_edit_money.checked=false;
  if(changedKey==='can_view_staff_sites'&&!boxes.can_view_staff_sites?.checked){['can_create_staff_sites','can_edit_staff_sites','can_export_staff_sites','can_import_staff_sites','can_view_money','can_create_money','can_edit_money'].forEach(k=>{if(boxes[k])boxes[k].checked=false})}
  if(['can_export_staff_sales','can_print_staff_sales'].includes(changedKey)&&boxes[changedKey]?.checked&&boxes.can_view_staff_sales)boxes.can_view_staff_sales.checked=true;
  if(changedKey==='can_view_staff_sales'&&!boxes.can_view_staff_sales?.checked){['can_export_staff_sales','can_print_staff_sales'].forEach(k=>{if(boxes[k])boxes[k].checked=false})}
  const anyFeature=['can_view_staff_sites','can_create_staff_sites','can_edit_staff_sites','can_view_money','can_create_money','can_edit_money','can_export_staff_sites','can_view_staff_sales','can_export_staff_sales','can_print_staff_sales','can_import_staff_sites','can_manage_staff_users'].some(k=>boxes[k]?.checked);
  if(anyFeature&&boxes.can_use_staff_portal)boxes.can_use_staff_portal.checked=true;
 }
 const admin=role==='admin';
 tr.querySelectorAll('[data-k]').forEach(el=>{const moneyKey=['can_view_money','can_create_money','can_edit_money'].includes(el.dataset.k);if(el.dataset.k==='role'||el.dataset.k==='approved'||moneyKey)el.disabled=!isAdmin()||admin;else el.disabled=admin});
}
function markUserRowDirty(tr,dirty=true){tr?.classList.toggle('userRowDirty',dirty);const b=tr?.querySelector('[data-save-user]');if(b){b.disabled=!dirty;b.textContent=dirty?'권한 저장':'저장됨'}}
function updateUsersSelectedCount(){
 const valid=new Set((usersRows||[]).map(x=>String(x.id)));for(const id of [...selectedUserIds])if(!valid.has(String(id))||String(id)===String(me?.id))selectedUserIds.delete(id);
 const el=$('usersSelectedCount');if(el)el.textContent=`${selectedUserIds.size.toLocaleString()}명 선택`;
 const del=$('usersDeleteSelectedBtn');if(del){del.disabled=!isAdmin()||selectedUserIds.size===0;del.classList.toggle('hidden',!isAdmin())}
 const all=$('usersSelectAllBtn'),clear=$('usersClearSelectionBtn');if(all)all.disabled=!isAdmin();if(clear)clear.disabled=!isAdmin()||selectedUserIds.size===0;
}
function toggleUserSelection(id,checked){id=String(id);if(id===String(me?.id))return;if(checked)selectedUserIds.add(id);else selectedUserIds.delete(id);updateUsersSelectedCount()}
function syncUserSelectionUi(){const tb=$('userTable')?.querySelector('tbody');if(!tb)return;tb.querySelectorAll('[data-user-select]').forEach(ch=>{const on=selectedUserIds.has(String(ch.dataset.userSelect));ch.checked=on;ch.closest('tr')?.classList.toggle('userRowSelected',on)});updateUsersSelectedCount()}
function selectAllUsers(){if(!isAdmin())return alert('직원 삭제는 관리자만 할 수 있습니다.');selectedUserIds=new Set((usersRows||[]).filter(p=>String(p.id)!==String(me?.id)).map(p=>String(p.id)));syncUserSelectionUi()}
function clearUserSelection(){selectedUserIds.clear();syncUserSelectionUi()}
function userPermissionLabel(k){return ({approved:'승인',can_use_staff_portal:'포털 사용',can_view_staff_sites:'현장 검색',can_create_staff_sites:'현장 등록',can_edit_staff_sites:'현장 수정',can_view_money:'금액 조회',can_create_money:'금액 입력',can_edit_money:'금액 수정',can_export_staff_sites:'전체 엑셀',can_view_staff_sales:'매출 조회',can_export_staff_sales:'매출 내보내기',can_print_staff_sales:'매출 출력',can_import_staff_sites:'엑셀 DB 등록',can_manage_staff_users:'사용자 관리'})[k]||k}
function userPhoneCanEdit(p){return !!p&&(isAdmin()||String(p.id)===String(me?.id))}
function userPhoneHtml(p){
 const phone=formatPhone(p?.phone||'');
 const call=phone?`<a class="userPhoneCall" href="tel:${esc(cleanPhone(phone))}" data-user-phone-call="${esc(phone)}">📞 ${esc(phone)}</a>`:'<span class="contactEmpty">미등록</span>';
 const edit=userPhoneCanEdit(p)?`<div class="userPhoneEdit"><input id="userInfoPhoneInput" inputmode="tel" autocomplete="tel" value="${esc(phone)}" placeholder="010-0000-0000"><button type="button" class="primary smallBtn" data-user-phone-save="${esc(p.id)}">전화번호 저장</button></div>`:'';
 return `<div class="userPhoneInfo">${call}${edit}</div>`;
}
function userPasswordCanEdit(p){return !!p&&(isAdmin()||String(p.id)===String(me?.id))}
function userPasswordHtml(p){
 if(!userPasswordCanEdit(p))return '';
 return `<section class="userPasswordSection"><h4>비밀번호 변경</h4><p class="userPasswordHelp">${String(p.id)===String(me?.id)?'본인 계정의 새 비밀번호를 입력하세요.':'관리자는 이 직원의 새 비밀번호를 설정할 수 있습니다.'}</p><div class="userPasswordEdit"><label>새 비밀번호<input id="userInfoPwInput" type="password" minlength="8" autocomplete="new-password" placeholder="8자 이상"></label><label>비밀번호 확인<input id="userInfoPwConfirm" type="password" minlength="8" autocomplete="new-password" placeholder="한 번 더 입력"></label><button type="button" class="primary" data-user-password-save="${esc(p.id)}">비밀번호 저장</button></div><small id="userInfoPwMsg" class="userPasswordMsg"></small></section>`;
}
function openUserInfo(id){
 const p=(usersRows||[]).find(x=>String(x.id)===String(id))||(String(id)===String(me?.id)?me:null);if(!p)return;
 $('userInfoTitle').textContent=`${p.name||p.user_id||'직원'} · 직원 정보`;
 const permissions=['approved','can_use_staff_portal','can_view_staff_sites','can_create_staff_sites','can_edit_staff_sites','can_view_money','can_create_money','can_edit_money','can_export_staff_sites','can_view_staff_sales','can_export_staff_sales','can_print_staff_sales','can_import_staff_sites','can_manage_staff_users'];
 $('userInfoBody').innerHTML=`<section class="userInfoSummary"><div><span>사원명</span><b>${esc(p.name||'-')}</b></div><div><span>ID</span><b>${esc(p.user_id||'-')}</b></div><div class="userPhoneInfoCard"><span>전화번호</span>${userPhoneHtml(p)}</div><div><span>사용자 구분</span><b>${p.role==='admin'?'관리자':'일반 사용자'}</b></div></section><section class="userInfoPermissions"><h4>권한 현황</h4><div class="userPermissionGrid">${permissions.map(k=>`<div class="userPermissionItem ${p[k]?'on':'off'}"><span>${esc(userPermissionLabel(k))}</span><b>${p[k]?'사용':'미사용'}</b></div>`).join('')}</div></section>${userPasswordHtml(p)}`;
 const save=$('userInfoBody').querySelector('[data-user-phone-save]');if(save)save.onclick=()=>saveUserPhone(save.dataset.userPhoneSave);
 const pwSave=$('userInfoBody').querySelector('[data-user-password-save]');if(pwSave)pwSave.onclick=()=>saveUserPassword(pwSave.dataset.userPasswordSave);
 const pwConfirm=$('userInfoPwConfirm');if(pwConfirm)pwConfirm.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();saveUserPassword(p.id)}};
 $('userInfoBody').querySelectorAll('[data-user-phone-call]').forEach(a=>a.onclick=e=>{e.stopPropagation()});
 $('userInfoDlg').showModal();
}
async function saveUserPhone(id){
 const input=$('userInfoPhoneInput');if(!input)return;
 const phone=formatPhone(input.value||'');
 const btn=$('userInfoBody').querySelector('[data-user-phone-save]'),old=btn?.textContent||'전화번호 저장';
 try{
  if(btn){btn.disabled=true;btn.textContent='저장 중...'}
  const{data,error}=await sb.rpc('staff_update_employee_phone',{p_user_id:id,p_phone:phone});if(error)throw error;
  const saved=formatPhone(data?.phone||phone);
  const ix=usersRows.findIndex(x=>String(x.id)===String(id));if(ix>=0)usersRows[ix]={...usersRows[ix],phone:saved};
  if(String(id)===String(me?.id))me={...me,phone:saved};
  usersCacheReady=usersCacheReady&&ix>=0;
  if($('page-users')?.classList.contains('active')&&usersRows.length)renderUsers(usersRows);
  openUserInfo(id);
 }catch(e){alert('전화번호 저장 오류: '+(e?.message||e));}
 finally{if(btn){btn.disabled=false;btn.textContent=old}}
}

async function saveUserPassword(id){
 const pw=$('userInfoPwInput'),confirmPw=$('userInfoPwConfirm'),msg=$('userInfoPwMsg');
 if(!pw||!confirmPw)return;
 const value=String(pw.value||''),check=String(confirmPw.value||'');
 if(value.length<8){if(msg){msg.textContent='비밀번호는 8자 이상 입력하세요.';msg.classList.add('error')}pw.focus();return}
 if(value!==check){if(msg){msg.textContent='비밀번호 확인값이 일치하지 않습니다.';msg.classList.add('error')}confirmPw.focus();return}
 const btn=$('userInfoBody').querySelector('[data-user-password-save]'),old=btn?.textContent||'비밀번호 저장';
 try{
  if(btn){btn.disabled=true;btn.textContent='저장 중...'}
  if(msg){msg.textContent='';msg.classList.remove('error')}
  await invokeAdmin({action:'reset_password',user_uuid:id,password:value});
  pw.value='';confirmPw.value='';
  if(msg){msg.textContent='비밀번호가 변경되었습니다.';msg.classList.remove('error')}
  alert(String(id)===String(me?.id)?'내 비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.':'직원 비밀번호가 변경되었습니다.');
 }catch(e){
  const text='비밀번호 변경 오류: '+(e?.message||e);
  if(msg){msg.textContent=text;msg.classList.add('error')}else alert(text);
 }finally{if(btn){btn.disabled=false;btn.textContent=old}}
}

function renderUsers(rows){
 const tb=$('userTable').querySelector('tbody');
 const perms=['approved','can_use_staff_portal','can_view_staff_sites','can_create_staff_sites','can_edit_staff_sites','can_view_money','can_create_money','can_edit_money','can_export_staff_sites','can_view_staff_sales','can_export_staff_sales','can_print_staff_sales','can_import_staff_sites','can_manage_staff_users'];
 tb.innerHTML=(rows||[]).map(p=>{const admin=p.role==='admin',self=String(p.id)===String(me?.id),selected=selectedUserIds.has(String(p.id));return `<tr data-user-row="${p.id}" class="${selected?'userRowSelected':''}" tabindex="0"><td class="userSelectCol"><input type="checkbox" class="userRowSelect" data-user-select="${p.id}" ${selected?'checked':''} ${!isAdmin()||self?'disabled':''} aria-label="${esc(p.name||p.user_id||'직원')} 선택" title="${self?'현재 로그인 계정은 삭제할 수 없습니다.':'삭제할 직원 선택'}"></td><td class="userInfoClickable">${esc(p.name||'')}</td><td class="userInfoClickable">${esc(p.user_id||'')}</td><td>${p.phone?`<a class="userTablePhone" href="tel:${esc(cleanPhone(p.phone))}" data-user-phone-call="${esc(p.phone)}">📞 ${esc(formatPhone(p.phone))}</a>`:'-'}</td><td><select data-u="${p.id}" data-k="role" ${!isAdmin()?'disabled':''}><option value="viewer" ${!admin?'selected':''}>일반</option><option value="admin" ${admin?'selected':''}>관리자</option></select></td>${perms.map(k=>`<td class="permCell"><input type="checkbox" data-u="${p.id}" data-k="${k}" ${p[k]?'checked':''} ${(admin&&k!=='approved')||(!isAdmin()&&k==='approved')?'disabled':''}></td>`).join('')}<td><div class="userActions"><button class="primary userSaveBtn" data-save-user="${p.id}" disabled>저장됨</button>${(isAdmin()||self)?`<button data-reset="${p.id}">비밀번호</button>${isAdmin()&&!self?`<button data-del="${p.id}">삭제</button>`:''}`:''}</div></td></tr>`}).join('');
 tb.querySelectorAll('tr[data-user-row]').forEach(tr=>{
  syncUserRowDependencies(tr);
  tr.querySelectorAll('[data-k]').forEach(el=>el.onchange=()=>{syncUserRowDependencies(tr,el.dataset.k);markUserRowDirty(tr,true)});
  tr.onclick=e=>{if(e.target.closest('button,input,select,a,label'))return;openUserInfo(tr.dataset.userRow)};
  tr.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button,input,select,a')){e.preventDefault();openUserInfo(tr.dataset.userRow)}};
 });
 tb.querySelectorAll('[data-user-select]').forEach(ch=>ch.onchange=()=>{toggleUserSelection(ch.dataset.userSelect,ch.checked);ch.closest('tr')?.classList.toggle('userRowSelected',ch.checked)});
 tb.querySelectorAll('[data-save-user]').forEach(b=>b.onclick=e=>{e.stopPropagation();saveUserPermissions(b.dataset.saveUser)});
 tb.querySelectorAll('[data-reset]').forEach(b=>b.onclick=e=>{e.stopPropagation();resetPw(b.dataset.reset)});
 tb.querySelectorAll('[data-del]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteUser(b.dataset.del)});
 tb.querySelectorAll('[data-user-phone-call]').forEach(a=>a.onclick=e=>e.stopPropagation());
 updateUsersSelectedCount();scheduleTableColumnResize($('userTable'),'users');
}
async function loadUsers(force=false){
 if(!canManageUsers())return;
 if(!force&&usersCacheReady&&cacheFresh(usersLoadedAt)){renderUsers(usersRows);return}
 const{data,error}=await sb.rpc('staff_user_admin_list');
 if(error)return alert('사용자 목록 조회 오류: '+error.message);
 usersRows=Array.isArray(data)?data:[];usersCacheReady=true;usersLoadedAt=Date.now();renderUsers(usersRows);
}
async function saveUserPermissions(id){
 const tr=$('userTable').querySelector(`tr[data-user-row="${CSS.escape(String(id))}"]`);if(!tr)return;
 const get=k=>tr.querySelector(`[data-k="${k}"]`),btn=tr.querySelector('[data-save-user]');
 const payload={role:get('role')?.value||'viewer'};
 userPermissionKeys().forEach(k=>{const el=get(k);if(el)payload[k]=!!el.checked});
 if(btn){btn.disabled=true;btn.textContent='저장 중...'}
 try{
  const{data,error}=await sb.rpc('staff_save_user_permissions',{p_user_id:id,p_permissions:payload});if(error)throw error;
  const ix=usersRows.findIndex(x=>String(x.id)===String(id));if(ix>=0)usersRows[ix]={...usersRows[ix],...(data||{})};
  markUserRowDirty(tr,false);syncUserRowDependencies(tr);
  if(String(id)===String(me?.id)){const{data:{session}}=await sb.auth.getSession();if(session){const p=await profileFor(session.user);if(p){me=p;showApp()}}}
 }catch(e){alert('권한 저장 오류: '+(e?.message||e));markUserRowDirty(tr,true)}
}
async function invokeAdmin(body){const{data,error}=await sb.functions.invoke(cfg.userAdminFunction,{body});if(error)throw error;if(data?.error)throw new Error(data.error);return data}
async function createUser(e){e.preventDefault();notify($('userMsg'),'등록 중...',true);try{await invokeAdmin({action:'create',employee_id:$('empId').value,password:$('empPw').value,name:$('empName').value,phone:$('empPhone').value,role:$('empRole').value,approved:$('empApproved').checked,permissions:{can_use_staff_portal:$('permPortal').checked,can_view_staff_sites:($('permSites').checked||$('permSiteCreate').checked||$('permSiteEdit').checked||$('permAllSitesExport').checked||$('permImport').checked),can_create_staff_sites:($('permSiteCreate').checked||$('permMoneyCreate').checked),can_edit_staff_sites:($('permSiteEdit').checked||$('permMoneyEdit').checked),can_view_money:($('permMoneyView').checked||$('permMoneyCreate').checked||$('permMoneyEdit').checked),can_create_money:$('permMoneyCreate').checked,can_edit_money:$('permMoneyEdit').checked,can_export_staff_sites:$('permAllSitesExport').checked,can_view_staff_sales:($('permSales').checked||$('permSalesExport').checked||$('permSalesPrint').checked),can_export_staff_sales:$('permSalesExport').checked,can_print_staff_sales:$('permSalesPrint').checked,can_import_staff_sites:$('permImport').checked,can_manage_staff_users:$('permUsers').checked}});notify($('userMsg'),'직원 등록이 완료되었습니다.',true);setTimeout(()=>{$('userDlg').close();$('userForm').reset();$('empApproved').checked=$('permPortal').checked=$('permSites').checked=true;$('permSiteCreate').checked=$('permSiteEdit').checked=$('permMoneyView').checked=$('permMoneyCreate').checked=$('permMoneyEdit').checked=$('permAllSitesExport').checked=false;invalidateDataCaches('users');loadUsers(true)},500)}catch(err){notify($('userMsg'),err.message)}}
function resetPw(id){openUserInfo(id);requestAnimationFrame(()=>setTimeout(()=>$('userInfoPwInput')?.focus(),0))}
async function deleteUser(id){if(!isAdmin())return alert('직원 삭제는 관리자만 할 수 있습니다.');if(String(id)===String(me?.id))return alert('현재 로그인한 계정은 삭제할 수 없습니다.');const p=(usersRows||[]).find(x=>String(x.id)===String(id));if(!confirm(`${p?.name||p?.user_id||'이 직원'} 계정을 삭제할까요?`))return;try{await invokeAdmin({action:'delete',user_uuid:id});selectedUserIds.delete(String(id));invalidateDataCaches('users');loadUsers(true)}catch(e){alert(e.message)}}
async function deleteSelectedUsers(){
 if(!isAdmin())return alert('직원 삭제는 관리자만 할 수 있습니다.');
 const ids=[...selectedUserIds].filter(id=>String(id)!==String(me?.id));if(!ids.length)return alert('삭제할 직원을 선택해 주세요.');
 const names=ids.map(id=>{const p=(usersRows||[]).find(x=>String(x.id)===String(id));return p?.name||p?.user_id||id});
 const preview=names.slice(0,8).join(', ')+(names.length>8?` 외 ${names.length-8}명`:``);
 if(!confirm(`선택한 ${ids.length.toLocaleString()}명의 직원 계정을 삭제하시겠습니까?\n\n${preview}\n\n삭제 후 해당 직원은 사내포털에 로그인할 수 없습니다.`))return;
 const btn=$('usersDeleteSelectedBtn'),old=btn?.textContent;let ok=0,failed=[];
 try{
  if(btn){btn.disabled=true;btn.textContent='삭제 중...'}
  for(const id of ids){try{await invokeAdmin({action:'delete',user_uuid:id});ok++;selectedUserIds.delete(String(id))}catch(e){const p=(usersRows||[]).find(x=>String(x.id)===String(id));failed.push(`${p?.name||p?.user_id||id}: ${e?.message||e}`)}}
  invalidateDataCaches('users');await loadUsers(true);
  if(failed.length)alert(`${ok.toLocaleString()}명 삭제 완료, ${failed.length.toLocaleString()}명 삭제 실패\n\n${failed.slice(0,5).join('\n')}`);else alert(`${ok.toLocaleString()}명의 직원을 삭제했습니다.`);
 }finally{if(btn){btn.textContent=old||'선택삭제';updateUsersSelectedCount()}}
}
function syncRoleForm(){const admin=$('empRole').value==='admin';['permPortal','permSites','permSiteCreate','permSiteEdit','permMoneyView','permMoneyCreate','permMoneyEdit','permAllSitesExport','permSales','permSalesExport','permSalesPrint','permImport','permUsers'].forEach(id=>{if(admin)$(id).checked=true;$(id).disabled=admin})}
const resultLayoutMedia=window.matchMedia('(min-width: 801px)');
const rerenderResultLayout=()=>{if(lastSites.length&&$('page-search')?.classList.contains('active'))renderSites();if(unwrittenRows.length&&$('page-unwritten')?.classList.contains('active'))renderUnwrittenList()};
if(resultLayoutMedia.addEventListener)resultLayoutMedia.addEventListener('change',rerenderResultLayout);else if(resultLayoutMedia.addListener)resultLayoutMedia.addListener(rerenderResultLayout);
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
if(isStandalone()){const n=$('standaloneNotice');n?.classList.remove('hidden');$('standaloneHelp')?.addEventListener('click',()=>alert('현재 Chrome에 설치된 웹앱으로 실행 중입니다.\n\n일반 Chrome 탭으로 사용하려면:\n1. 이 앱 창 오른쪽 위 ⋮ 메뉴를 누릅니다.\n2. 앱 제거/삭제를 선택합니다.\n3. 또는 Chrome 주소창에 chrome://apps 를 입력한 뒤 현장 검색 앱을 제거합니다.\n4. 이후 https://nameplate76-bot.github.io/search/ 를 Chrome 일반 탭에서 다시 여세요.'));}
enableEnterToNext($('siteEditForm'),{siteEditor:true});enableEnterToNext($('contactEditForm'));enableEnterToNext($('userForm'));
$('permSalesExport').onchange=$('permSalesPrint').onchange=e=>{if(e.target.checked)$('permSales').checked=true};$('permSales').onchange=e=>{if(!e.target.checked){$('permSalesExport').checked=false;$('permSalesPrint').checked=false}};
$('permSiteCreate').onchange=$('permSiteEdit').onchange=$('permAllSitesExport').onchange=$('permImport').onchange=e=>{if(e.target.checked)$('permSites').checked=true};$('permMoneyView').onchange=e=>{if(e.target.checked)$('permSites').checked=true;else{$('permMoneyCreate').checked=false;$('permMoneyEdit').checked=false}};$('permMoneyCreate').onchange=e=>{if(e.target.checked){$('permMoneyView').checked=true;$('permSites').checked=true;$('permSiteCreate').checked=true}};$('permMoneyEdit').onchange=e=>{if(e.target.checked){$('permMoneyView').checked=true;$('permSites').checked=true;$('permSiteEdit').checked=true}};$('permSites').onchange=e=>{if(!e.target.checked){$('permSiteCreate').checked=false;$('permSiteEdit').checked=false;$('permMoneyView').checked=false;$('permMoneyCreate').checked=false;$('permMoneyEdit').checked=false;$('permAllSitesExport').checked=false;$('permImport').checked=false}};$('siteCreateBtn').onclick=openCreateSite;$('siteTemplateSearchBtn').onclick=searchSimilarSiteTemplates;$('siteTemplateQuery').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopPropagation();searchSimilarSiteTemplates()}};$('siteEditClose').onclick=()=>$('siteEditDlg').close();$('siteEditCancel').onclick=()=>$('siteEditDlg').close();$('siteEditForm').onsubmit=saveSiteEdit;$('siteAddressSearchBtn').onclick=searchSiteAddress;$('siteAddressQuery').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchSiteAddress()}};$('siteFormAddress').oninput=()=>{if(siteAddressMode==='manual')syncRegionFromSiteAddress()};$('siteFormAddress').onblur=()=>syncRegionFromSiteAddress();$('siteFormAddressDetail').oninput=()=>syncRegionFromSiteAddress();$('siteManualAddressBtn').onclick=()=>setSiteAddressMode('manual');$('siteSearchAddressModeBtn').onclick=()=>setSiteAddressMode('search');$('siteFormPhone').onblur=e=>{e.target.value=formatPhoneList(e.target.value)};
$('unwrittenRefresh').onclick=()=>loadUnwrittenDashboard(true);$('unwrittenFieldBtn').onclick=setupUnwrittenFields;$('unwrittenFieldsSelectAll').onclick=()=>setUnwrittenFieldChecks('all');$('unwrittenFieldsSelectDefault').onclick=()=>setUnwrittenFieldChecks('default');$('unwrittenFieldsClearAll').onclick=()=>setUnwrittenFieldChecks('none');$('unwrittenFieldsSave').onclick=saveUnwrittenFields;$('unwrittenFieldsClose').onclick=()=>$('unwrittenFieldsDlg').close();
$('loginBtn').onclick=login;$('loginPw').onkeydown=e=>{if(e.key==='Enter')login()};$('myInfoBtn').onclick=()=>openUserInfo(me?.id);$('logoutBtn').onclick=async()=>{invalidateDataCaches('all');await sb.auth.signOut();me=null;showLogin()};document.querySelectorAll('#mainNav button[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page,true));$('searchBtn').onclick=()=>searchSites(true);$('siteQuery').onkeydown=e=>{if(e.key==='Enter')searchSites(true)};$('fieldBtn').onclick=setupFields;$('fieldsSelectAll').onclick=()=>setFieldChecks('all');$('fieldsSelectDefault').onclick=()=>setFieldChecks('default');$('fieldsClearAll').onclick=()=>setFieldChecks('none');$('fieldsSave').onclick=saveFields;$('detailClose').onclick=()=>$('detailDlg').close();$('quantityPrintClose').onclick=()=>$('quantityPrintDlg').close();$('quantityPrintRun').onclick=runQuantityPrint;$('fieldsClose').onclick=()=>$('fieldsDlg').close();$('userClose').onclick=()=>$('userDlg').close();$('contactEditClose').onclick=()=>$('contactEditDlg').close();$('contactEditForm').onsubmit=saveContact;$('addressSearchBtn').onclick=searchAddress;$('addressQuery').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchAddress()}};$('manualAddressBtn').onclick=()=>setAddressMode('manual');$('searchAddressModeBtn').onclick=()=>setAddressMode('search');$('contactPhone').onblur=e=>{e.target.value=formatPhoneList(e.target.value)};$('routeClose').onclick=()=>$('routeDlg').close();document.querySelectorAll('[data-route-app]').forEach(b=>b.onclick=()=>launchRoute(b.dataset.routeApp));$('salesDashAnnual').onclick=()=>setSalesDashboardPeriod('annual');$('salesDashMonthly').onclick=()=>setSalesDashboardPeriod('monthly');$('salesDashSelectAll').onclick=()=>{salesDashboardOwners=new Set(salesDashboardOwnerNames());renderSalesDashboardOwnerList();renderSalesDashboard()};$('salesDashClearAll').onclick=()=>{salesDashboardOwners.clear();renderSalesDashboardOwnerList();renderSalesDashboard()};$('salesDashOwnerClose').onclick=()=>{const d=$('salesDashOwnerDetails');if(d)d.open=false;updateSalesDashboardOwnerSummary();renderSalesDashboard()};$('salesDashYear').onchange=()=>{updateSalesTitleFromDashboard();renderSalesDashboard()};$('salesDashMonth').onchange=()=>{updateSalesTitleFromDashboard();renderSalesDashboard()};$('salesPanelToggle').onclick=()=>toggleSalesPanel();applySalesPanelCollapsed(readSalesPanelCollapsed());['salesYear','salesMonth','salesOwner'].forEach(id=>{const el=$(id);el.onchange=()=>{updateSalesPageTitle();renderSales()};el.oninput=()=>updateSalesPageTitle()});if($('salesPrint'))$('salesPrint').onclick=printSalesReport;if($('salesExport'))$('salesExport').onclick=exportSales;if($('salesImport'))$('salesImport').onclick=()=>isAdmin()?$('salesFile')?.click():alert('매출 엑셀 가져오기는 관리자만 사용할 수 있습니다.');if($('salesFile'))$('salesFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(!isAdmin()){e.target.value='';return alert('매출 엑셀 가져오기는 관리자만 사용할 수 있습니다.')}await importSalesExcel(f);e.target.value=''};$('allSitesExportBtn').onclick=exportAllSites;$('dbDeleteAllBtn').onclick=deleteAllSiteDb;$('dbImportBtn').onclick=()=>canImportSites()?$('dbFile').click():alert('엑셀 DB 등록 권한이 없습니다.');$('dbFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importWorkbook(f)}catch(err){alert('전체 DB 엑셀 갱신 오류: '+err.message)}e.target.value=''};$('newUserBtn').onclick=()=>{if(!isAdmin())return alert('직원 신규등록은 관리자만 할 수 있습니다.');$('userDlg').showModal();syncRoleForm()};$('usersSelectAllBtn').onclick=selectAllUsers;$('usersClearSelectionBtn').onclick=clearUserSelection;$('usersDeleteSelectedBtn').onclick=deleteSelectedUsers;$('userInfoClose').onclick=()=>$('userInfoDlg').close();$('empRole').onchange=syncRoleForm;$('userForm').onsubmit=createUser;
let ownPermissionRefreshAt=0,ownPermissionRefreshBusy=false;
async function refreshOwnPermissions(){
 if(!me||ownPermissionRefreshBusy||Date.now()-ownPermissionRefreshAt<15000)return;ownPermissionRefreshBusy=true;ownPermissionRefreshAt=Date.now();
 try{const{data:{session}}=await sb.auth.getSession();if(!session)return;const p=await profileFor(session.user);if(!p?.approved||!p.can_use_staff_portal){await sb.auth.signOut();return}const keys=['role','approved','can_use_staff_portal','can_view_staff_sites','can_create_staff_sites','can_edit_staff_sites','can_view_money','can_create_money','can_edit_money','can_export_staff_sites','can_view_staff_sales','can_export_staff_sales','can_print_staff_sales','can_import_staff_sites','can_manage_staff_users'];const changed=keys.some(k=>p?.[k]!==me?.[k]);if(changed){me=p;showApp()}}catch(e){console.warn('권한 새로고침 실패',e)}finally{ownPermissionRefreshBusy=false}
}
window.addEventListener('focus',refreshOwnPermissions);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOwnPermissions()});setInterval(refreshOwnPermissions,60000);
sb.auth.onAuthStateChange((event,session)=>{
 if(event==='SIGNED_OUT'){me=null;invalidateDataCaches('all');showLogin();return}
 // 초기 세션은 아래 boot()가 한 번만 처리합니다. 토큰 갱신/재인증 때는 데이터 전체를 다시 읽지 않습니다.
 if(event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED'||event==='SIGNED_IN'||event==='USER_UPDATED')return;
});boot().catch(e=>{console.error(e);showLogin();notify($('loginMsg'),e.message)});
})();
