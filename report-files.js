(function(root){'use strict';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function endpoint(value){if(!String(value||'').trim())return '';const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('보고서 연결 주소는 로그인 정보가 없는 HTTPS 주소로 설정하세요.');return u.href.replace(/\/$/,'')}
function nasWebUrl(value){if(!String(value||'').trim())return '';const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('ipDISK 주소 형식을 확인하세요.');return u.href}
function reportRelativeFolder(value){
 let folder=String(value||'').trim();
 if(folder.startsWith('"')&&folder.endsWith('"'))folder=folder.slice(1,-1).trim();
 folder=folder.replace(/\\/g,'/').replace(/\/$/,'');
 if(/^[a-z]:/i.test(folder)){
  if(!/^[a-z]:\/VOL1\//i.test(folder))throw Error('전체 경로는 Z:\\VOL1 또는 F:\\VOL1 아래 경로를 사용하세요. 다른 NAS 기준 폴더는 연결 PC 설정을 확인하고 상대 경로를 입력하세요.');
  folder=folder.replace(/^[a-z]:\/VOL1\//i,'');
 }
 return folder;
}
function selectedFilesText(value){return Array.isArray(value?.allowed_files)?value.allowed_files.join('\n'):String(value?.preferred_file||'')}
function mappingValue(value){
 const folder=reportRelativeFolder(value.folder);if(!folder||folder.length>1500||folder.startsWith('/')||folder.includes(':')||folder.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('NAS 기준 폴더 아래의 상대 경로를 입력하세요.');
 const source=Array.isArray(value.allowed_files)?value.allowed_files:String(value.preferred_file||'').split(/\r?\n/);
 const allowed_files=[...new Set(source.map(v=>String(v).trim().replace(/\\/g,'/')).filter(Boolean))];
 if(allowed_files.length>100||allowed_files.some(v=>v.length>1500||v.startsWith('/')||v.includes(':')||v.split('/').some(p=>!p||p==='.'||p==='..')))throw Error('파일 목록과 상대 경로를 확인하세요.');
 return {folder,reference_date:'',preferred_file:(allowed_files[0]||'').split('/').pop(),allowed_files};
}
function mappingKey(config,id){if(!Number.isSafeInteger(Number(id))||Number(id)<=0)throw Error('현장 ID를 확인하세요.');return 'staff-report-mapping-v1:'+String(config.supabaseUrl||'')+':'+Number(id)}
function saveLocal(storage,key,value){const text=JSON.stringify(mappingValue(value));storage.setItem(key,text);if(storage.getItem(key)!==text)throw Error('브라우저 저장 내용을 확인할 수 없습니다.');return JSON.parse(text)}
function sameMapping(a,b){try{return !!a&&!!b&&JSON.stringify(mappingValue(a))===JSON.stringify(mappingValue(b))}catch(e){return false}}
root.ReportFiles={open,endpoint,nasWebUrl,mappingValue,mappingKey,saveLocal,sameMapping};
function open(ctx){
 const apiKey='staff-report-api-v1:'+String(ctx.config.supabaseUrl||'');let override='';if(!ctx.getApi){try{override=localStorage.getItem(apiKey)||''}catch(e){}}
 const dlg=document.createElement(ctx.container?'section':'dialog');dlg.className='reportFilesDialog'+(ctx.container?' reportFilesPage':'');
 const example=String(ctx.row.site_name||'').includes('상록중학교');
 const dateMatch=String(ctx.row.site_name||'').match(/(?:기준일)\s*(\d{2,4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
 const referenceLabel=dateMatch?`${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3]}`:'';
 dlg.innerHTML=`<div class="dlgHead"><div><h3>현장 보고서</h3><small>${escape(ctx.row.site_name)} · 현장 ID ${Number(ctx.row.source_id)}</small></div><button type="button" data-close>닫기</button></div><p>NAS 원본 파일을 조회합니다. 보고서를 확인하고 PDF 열람 또는 다운로드를 선택하세요.</p><div class="filterRow"><a data-nas hidden target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">ipDISK에서 보고서 찾기</a><button type="button" data-refresh class="primary">보고서 다시 조회</button>${ctx.admin?'<button type="button" data-diagnose>연결 상태 확인</button>':''}</div><div data-nas-guide hidden></div><p data-status role="status" aria-live="polite"></p><div data-list class="reportFilesList"></div>${ctx.admin?'<div data-diagnostics role="status" aria-live="polite"></div>':''}${ctx.admin?`<details class="reportMapping" open><summary>관리자: 임시 HTTPS 연결 주소 설정</summary><p>PC 임시연결 창에 표시된 주소를 붙여넣으세요. 관리자가 저장하면 모든 직원의 PC와 휴대폰에 공통으로 적용됩니다. 공통 주소를 처음 저장하기 전에는 이 브라우저의 기존 주소 또는 포털 기본 주소를 사용합니다. 현재 실행 중인 주소인지 확인한 뒤 공통 저장하세요. 이미 열린 보고서 화면에서는 보고서 다시 조회를 누르세요.</p><label>발급된 임시 HTTPS 주소<input data-api placeholder="PC에서 발급된 https://…trycloudflare.com 주소"></label><button type="button" data-api-save>공통 연결 주소 저장</button></details><details class="reportMapping" open><summary>관리자: 현장 보고서 폴더 연결</summary><p>직원 PC의 드라이브 문자는 달라도 됩니다. 모든 보고서는 연결 프로그램 PC에서 읽습니다. NAS 기준 폴더가 VOL1인 경우 Z 또는 F 드라이브의 전체 경로를 붙여넣으면 VOL1 아래 상대 경로로 변환해 저장합니다. 연결 PC의 기준 폴더는 실제 접근 가능한 위치여야 합니다. 보고서가 있는 폴더와 조회할 파일명을 지정하세요. 지정하지 않은 파일은 표시하거나 다운로드하지 않습니다. 폴더명·파일명이 바뀌면 수정하세요.</p><label>현장 폴더 경로 (상대 경로 또는 드라이브의 VOL1 전체 경로)<input data-folder lang="ko" placeholder="예: 유지관리 및 성능점검/② 학교/상록중학교"></label><button type="button" data-browse-folder>실제 NAS 폴더 찾아 선택</button><div data-folder-browser hidden role="region" aria-label="실제 NAS 폴더 선택"></div><input data-date type="hidden"><details class="reportManualFiles"><summary>파일명 직접 입력 (관리자용 추가 설정)</summary><p>파일 목록에서 선택하기 어려운 경우에만 사용하세요. 현장 폴더 안의 파일 경로를 한 줄에 하나씩 입력합니다.</p><label style="display:flex;flex-direction:column;gap:8px">조회 허용 파일<textarea data-preferred lang="ko" rows="3" style="box-sizing:border-box;width:100%;max-width:100%;resize:vertical" placeholder="파일 경로를 한 줄에 하나씩 입력"></textarea></label></details><button type="button" data-candidates>폴더의 파일 목록 불러오기</button><div data-candidate-list></div><small>파일 목록에서 조회할 보고서를 선택하세요. 선택한 파일만 직원에게 표시됩니다.</small><button type="button" data-save>이 현장에 폴더 연결 저장</button><p data-save-status role="status" aria-live="polite">입력 후 저장 버튼을 누르세요.</p><small>연결 프로그램이 있으면 해당 프로그램에 저장합니다. 연결 전에는 이 PC·브라우저에만 저장되며 다른 기기와 공유되지 않습니다. NAS 원본은 변경하지 않습니다.</small></details>`:''}`;
 (ctx.container||document.body).append(dlg);if(!ctx.container)dlg.showModal();const q=s=>dlg.querySelector(s);let base='',closed=false,busy=false,saving=false,mappingDirty=false,initialMapping=Promise.resolve(),activeRefresh=Promise.resolve(),requests=new Set();
 const status=s=>{q('[data-status]').textContent=s};
 const close=(notify=true)=>{closed=true;requests.forEach(c=>c.abort());if(!ctx.container)dlg.close();dlg.remove();if(notify&&ctx.onClose)ctx.onClose()};if(ctx.onReady)ctx.onReady(close);q('[data-close]').onclick=close;dlg.oncancel=e=>{e.preventDefault();close()};
 let nas='';try{nas=nasWebUrl(ctx.config.reportNasWebUrl);if(nas){q('[data-nas]').href=nas;q('[data-nas]').hidden=false;q('[data-nas-guide]').hidden=false;q('[data-nas-guide]').innerHTML=`<p>ipDISK 창에서 로그인한 후 현장명 <b>${escape(ctx.row.site_name)}</b>으로 해당 폴더를 찾아 파일을 열람하거나 다운로드하세요. 포털 로그인과 NAS 로그인은 별개입니다.</p>${example?`<p>상록중학교 위치 확인: VOL1 → 유지관리 및 성능점검 → ② 학교 → 상록중학교 → 해당 계약 폴더 → 제본 PDF 저장 폴더 → 제출용. ${referenceLabel?'조회 중인 현장의 기준일 '+escape(referenceLabel)+'에 해당하는 보고서를 확인하세요.':'조회 중인 계약에 해당하는 보고서를 확인하세요.'} 폴더명이 바뀌면 연결 경로도 수정하세요.</p>`:''}<small>서버 화면의 파일 조회·다운로드 지원 여부는 실제 접속 확인이 필요합니다. 자동 현장 폴더 이동은 아직 연결되지 않았습니다.</small>`}}catch(e){status(e.message)}
 try{base=endpoint(override||ctx.config.reportApiUrl)}catch(e){status(e.message)}
 async function request(route,options={}){
  if(ctx.getApi)base=endpoint(await ctx.getApi());
  if(!base)throw Error('공통 보고서 접속주소가 등록되지 않았습니다. 관리자에게 주소 등록을 요청하세요.');
  const session=await ctx.session();if(!session?.access_token)throw Error('포털 로그인이 필요합니다. 다시 로그인하세요.');
  const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),60000);
  try{const r=await fetch(base+'/api/sites/'+Number(ctx.row.source_id)+'/'+route,{...options,headers:{Authorization:'Bearer '+session.access_token,...(options.body?{'Content-Type':'application/json'}:{} )},signal:controller.signal,cache:'no-store',redirect:'error'});
   if(!r.ok){const error=await r.json().catch(()=>({}));const failure=Error((error.error||'보고서 서버 응답 오류')+' (HTTP '+r.status+')');failure.httpStatus=r.status;failure.serverMessage=String(error.error||'');throw failure}if(options.binary)return await r.blob();try{return await r.json()}catch(e){throw Error('연결 프로그램의 응답이 설정 데이터가 아닙니다. 임시 HTTPS 주소와 실행 창을 확인하세요.')}
  }catch(e){if(e.name==='AbortError')throw Error('조회가 취소되었거나 시간이 초과되었습니다. NAS 연결 상태를 확인하세요.');if(e instanceof TypeError)throw Error('보고서 연결 프로그램에 접속할 수 없습니다. HTTPS 주소와 서버 연결을 확인하세요.');throw e}
  finally{clearTimeout(timer);requests.delete(controller)}
 }
 function lock(value){busy=value;dlg.querySelectorAll('[data-refresh],[data-diagnose],button[data-file-id]').forEach(b=>b.disabled=value||saving)}
 async function fileAction(file,view){if(busy)return;const popup=view?window.open('','_blank'):null;if(view&&!popup){status('팝업을 허용한 뒤 열람을 다시 누르세요.');return}if(popup){popup.opener=null;popup.document.body.textContent='보고서를 불러오는 중입니다.'}lock(true);status('파일을 불러오는 중입니다.');try{
  const blob=await request('files/'+file.id+(view?'?view=1':''),{binary:true});if(closed){if(popup)popup.close();return}
  const url=URL.createObjectURL(blob);if(view){popup.location.replace(url)}else{const a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove()}setTimeout(()=>URL.revokeObjectURL(url),300000);status(view?'PDF 열람 창을 열었습니다.':'다운로드를 시작했습니다.');
 }catch(e){if(popup)popup.close();if(!closed)status(e.message)}finally{if(!closed)lock(false)}}
 async function refresh(){if(busy||saving)return;lock(true);status('이 현장의 보고서 폴더를 확인하고 있습니다.');q('[data-list]').innerHTML='';try{
  let data;
  for(let attempt=0;attempt<3;attempt++){
   try{data=await request('reports');break}catch(error){
    if(closed)return;
    if(error.httpStatus!==503||attempt===2)throw error;
    status(`NAS 연결 준비를 기다린 후 다시 조회합니다 (${attempt+1}/2). 기존 폴더 연결정보는 유지됩니다.`);
    await new Promise(resolve=>setTimeout(resolve,(attempt+1)*1500));if(closed)return;
   }
  }
  if(closed)return;
  if(data.recovery_message&&ctx.admin&&!mappingDirty){
   try{const restored=await request('mapping');if(!closed&&!mappingDirty&&restored.mapping){const m=restored.mapping;q('[data-folder]').value=m.folder||'';q('[data-date]').value=m.reference_date||'';q('[data-preferred]').value=selectedFilesText(m);q('[data-save-status]').textContent='기존 보고서 경로를 확인하여 복구했습니다. 현재 표시된 값은 서버에 저장된 연결정보입니다.'}}catch(e){}
  }
  if(!data.connected){status('이 현장에 보고서 폴더가 연결되지 않았습니다. 관리자에게 연결 설정을 요청하세요.');return}
  if(!['R7','R8'].includes(data.bridge_version)){status('지정 파일만 조회하려면 연결 PC의 report-bridge/server.py를 이번 R7 버전으로 교체하고 연결 프로그램을 재시작하세요.');return}
  const files=data.files||[];if(!files.length){status('지정된 보고서를 찾지 못했습니다. 관리자에게 조회할 파일명(확장자 포함), 폴더 위치와 선택한 파일 확인을 요청하세요. 허용할 파일을 선택하고 저장하지 않으면 목록을 표시하지 않습니다.');return}
  q('[data-list]').innerHTML=`<table><thead><tr><th>파일명</th><th>현장 폴더 안의 위치</th><th>수정일</th><th>크기</th><th>열람·다운로드</th></tr></thead><tbody>${files.map((f,i)=>`<tr><td>${escape(f.name)}</td><td>${escape(f.folder==='.'?'현장 폴더':f.folder)}</td><td>${escape(new Date(f.modified*1000).toLocaleString('ko-KR'))}</td><td>${(Number(f.size)/1024/1024).toFixed(2)} MB</td><td>${f.pdf?`<button type="button" data-file-id="${i}" data-view="1">PDF 열람</button>`:''}<button type="button" data-file-id="${i}">다운로드</button></td></tr>`).join('')}</tbody></table>`;
  q('[data-list]').querySelectorAll('[data-file-id]').forEach(b=>b.onclick=()=>fileAction(files[Number(b.dataset.fileId)],b.dataset.view==='1'));status(`${data.recovery_message?data.recovery_message+' ':''}${files.length}개 파일을 찾았습니다. 관리자가 지정한 파일만 조회·열람·다운로드할 수 있습니다.`);
 }catch(e){if(!closed){if(e.httpStatus===404&&e.serverMessage.includes('연결한 현장 폴더가 없습니다')){await initialMapping.catch(()=>{});if(!closed){const folder=ctx.admin?q('[data-folder]').value:'';status(e.message+' · 현장 ID '+Number(ctx.row.source_id)+' · '+(folder?'관리자 화면의 폴더 경로: '+folder+' · ':'')+'연결 프로그램 PC에서 NAS 기준 폴더와 실제 폴더명을 확인하세요. NAS 재연결 중인지도 확인한 후 다시 조회하세요. 기존 등록정보를 삭제하거나 전체 재등록하지 마세요. 연결 상태 확인에서 실제 NAS 기준 폴더·연결 DB·실행 버전을 먼저 확인하세요. R5는 확인 가능한 동일 현장 경로만 자동 복구합니다.')}}else if(e.httpStatus===404){status(e.message+' · 현장 ID '+Number(ctx.row.source_id)+' · 이 응답만으로 NAS 폴더 문제라고 판단할 수 없습니다. 현장 조회 권한과 현재 HTTPS 연결 주소를 확인하세요.')}else status(e.message)}}finally{if(!closed)lock(false)}}
 function startRefresh(){activeRefresh=refresh();return activeRefresh}
 q('[data-refresh]').onclick=startRefresh;
 if(ctx.admin)q('[data-diagnose]').onclick=async()=>{
  if(busy||saving)return;lock(true);status('실행 중인 연결 프로그램의 상태를 확인하고 있습니다.');
  try{
   const data=await request('diagnostics');if(closed)return;
   if(!data.bridge_version||Number(data.site_id)!==Number(ctx.row.source_id))throw Error('연결 상태 응답을 확인할 수 없습니다. 이 HTTPS 주소에 보고서 연결 프로그램 R5가 실행 중인지 확인하세요.');
   const mapping=data.mapping||{};
   q('[data-diagnostics]').innerHTML=`<div class="reportMapping"><strong>실행 중인 연결 프로그램 확인</strong><p>버전: ${escape(data.bridge_version)} · 프로세스 ID: ${Number(data.process_id)} · 현장 ID: ${Number(data.site_id)}</p><p>실행 중인 NAS 기준 폴더: ${escape(data.nas_root)}</p><p>설정 파일: ${escape(data.config_file||'구버전은 표시하지 않습니다')}</p><p>실제 연결 DB: ${escape(data.mapping_database||'구버전은 표시하지 않습니다')} · 등록 ${data.mapping_count===undefined?'구버전 미지원':Number(data.mapping_count)+'건'}</p><p>설정된 NAS 기준 폴더: ${escape(data.configured_nas_root||data.nas_root)}</p><p>실제로 읽은 현장 연결 경로: ${escape(mapping.folder||'미등록')}</p><p>검색 결과: HTTP ${Number(data.http_status)} · ${Number(data.file_count||0)}개 파일</p><p>${escape(data.message)}</p>${data.bridge_version==='R4'?'<p><b>현재 PC는 이전 R4 연결 프로그램입니다. 이번 R5 server.py를 실제 실행 폴더에 적용하고 재시작하세요.</b></p>':''}${data.recovery?`<p>자동 복구: ${escape(data.recovery.previous_folder)} → ${escape(data.recovery.folder)}</p>`:''}</div>`;
   status(data.http_status===200?data.message+' · '+Number(data.file_count||0)+'개 파일. 보고서 다시 조회를 눌러 목록을 확인하세요.':data.message+' (HTTP '+Number(data.http_status)+')');
  }catch(e){if(!closed)status(e.message+(e.httpStatus===404?' · 현재 HTTPS 주소에 연결 프로그램 R5가 실행 중인지 확인하세요. 연결 상태 확인 요청의 404이며, 현장 폴더가 없다는 뜻으로 단정할 수 없습니다.':''))}
  finally{if(!closed)lock(false)}
 };

 if(ctx.admin){
  const saveStatus=(message,error=false)=>{if(closed)return;const node=q('[data-save-status]');node.textContent=message;node.dataset.error=String(error)};
  ['[data-folder]','[data-date]','[data-preferred]'].forEach(sel=>q(sel).addEventListener('input',()=>{mappingDirty=true;saveStatus('변경한 입력 내용은 아직 저장되지 않았습니다.')}));
  async function browseFolder(folder=''){
   const panel=q('[data-folder-browser]');panel.hidden=false;panel.textContent='연결 PC의 실제 NAS 폴더를 확인하고 있습니다…';
   q('[data-browse-folder]').disabled=true;
   try{const data=await request('folders'+(folder?'?folder='+encodeURIComponent(folder):''));if(closed)return;
    if(data.bridge_version!=='R8')throw Error('실제 폴더 선택에는 연결 PC의 server.py R8 버전이 필요합니다.');
    panel.innerHTML='<p><b>현재 위치: '+escape(data.folder||'NAS 기준 폴더')+'</b></p><p>폴더 이름을 눌러 보고서가 있는 위치까지 이동한 후 이 폴더를 선택하세요.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-folder-root>처음 위치</button>'+(data.folder?'<button type="button" data-folder-up>상위 폴더</button><button type="button" data-folder-use class="primary">이 폴더 선택 · 파일 목록 보기</button>':'')+'<button type="button" data-folder-close>폴더 선택 닫기</button></div><div style="max-height:280px;overflow:auto;margin-top:12px">'+(data.folders.length?data.folders.map((f,i)=>'<button type="button" data-folder-index="'+i+'" style="display:block;width:100%;text-align:left;margin:4px 0;white-space:normal;overflow-wrap:anywhere">📁 '+escape(f.name)+'</button>').join(''):'<p>하위 폴더가 없습니다.</p>')+'</div>';
    panel.querySelector('[data-folder-root]').onclick=()=>browseFolder('');
    const up=panel.querySelector('[data-folder-up]');if(up)up.onclick=()=>browseFolder(data.parent);
    panel.querySelector('[data-folder-close]').onclick=()=>{panel.hidden=true};
    panel.querySelectorAll('[data-folder-index]').forEach(b=>b.onclick=()=>browseFolder(data.folders[Number(b.dataset.folderIndex)].path));
    const use=panel.querySelector('[data-folder-use]');if(use)use.onclick=()=>{q('[data-folder]').value=data.folder;q('[data-preferred]').value='';mappingDirty=true;saveStatus('실제 폴더를 선택했습니다. 아래 파일 목록에서 보고서를 선택하여 저장하세요.');panel.hidden=true;q('[data-candidates]').click()};
   }catch(e){if(!closed)panel.textContent='실제 폴더 조회 실패: '+e.message+' 연결 PC의 server.py를 R8로 교체했는지 확인하세요.'}finally{if(!closed)q('[data-browse-folder]').disabled=false}
  }
  q('[data-browse-folder]').onclick=()=>{if(!busy&&!saving)browseFolder('')};
  q('[data-candidates]').onclick=async()=>{if(busy||saving)return;const panel=q('[data-candidate-list]'),button=q('[data-candidates]');button.disabled=true;panel.textContent='폴더의 실제 파일 목록을 확인하고 있습니다…';try{const folder=reportRelativeFolder(q('[data-folder]').value);const data=await request('candidates?folder='+encodeURIComponent(folder));if(closed)return;if(!['R7','R8'].includes(data.bridge_version))throw Error('연결 PC의 server.py를 R7으로 교체하고 재시작하세요.');const chosen=new Set(q('[data-preferred]').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)),files=data.files||[];panel.innerHTML=files.length?'<p>조회할 보고서를 체크한 뒤 아래 버튼을 누르세요. 선택하지 않은 파일은 직원에게 표시되지 않습니다.</p>'+files.map((f,i)=>`<label style="display:flex;gap:8px;align-items:flex-start;padding:8px;border-bottom:1px solid #d6e1f0"><input type="checkbox" data-candidate="${i}" style="width:auto" ${chosen.has(f.relative_path)||chosen.has(f.name)?'checked':''}><span>${escape(f.name)}<small style="display:block">${escape(f.relative_path)}</small></span></label>`).join('')+'<button type="button" data-candidate-save>선택한 파일로 저장</button>':'<p>이 폴더에서 지원하는 파일을 찾지 못했습니다. 폴더 경로를 확인하세요.</p>';const save=panel.querySelector('[data-candidate-save]');if(save)save.onclick=()=>{q('[data-preferred]').value=[...panel.querySelectorAll('[data-candidate]:checked')].map(c=>files[Number(c.dataset.candidate)].relative_path).join('\n');mappingDirty=true;q('[data-save]').click()};}catch(e){if(!closed)panel.textContent='파일 목록 조회 실패: '+e.message+(e.httpStatus===404?' 위의 실제 NAS 폴더 찾아 선택 버튼으로 존재하는 폴더를 선택하세요.':'')}finally{if(!closed)button.disabled=false}};
  q('[data-api]').value=override||ctx.config.reportApiUrl||'';
  q('[data-api-save]').onclick=async()=>{if(saving){saveStatus('폴더 저장이 끝난 뒤 연결 주소를 변경하세요.',true);return}try{const value=endpoint(q('[data-api]').value);if(!value||!new URL(value).hostname.endsWith('.trycloudflare.com'))throw Error('PC에서 발급된 trycloudflare.com HTTPS 주소를 입력하세요.');if(ctx.saveApi){const btn=q('[data-api-save]');btn.disabled=true;status('공통 접속주소 저장 중…');try{await ctx.saveApi(value);try{localStorage.removeItem(apiKey)}catch(e){}}finally{btn.disabled=false}}else{localStorage.setItem(apiKey,value);if(localStorage.getItem(apiKey)!==value)throw Error('주소 저장에 실패했습니다.');}close(false);open({...ctx,config:{...ctx.config,reportApiUrl:value}})}catch(e){status(e.message)}};
  q('[data-save]').onclick=async()=>{
   if(saving)return;
   let value;try{value=mappingValue({folder:q('[data-folder]').value,reference_date:q('[data-date]').value,preferred_file:q('[data-preferred]').value})}catch(e){saveStatus('저장하지 못했습니다: '+e.message,true);return}
   saving=true;q('[data-save]').disabled=true;q('[data-save]').textContent='폴더 연결 저장 중…';q('[data-api-save]').disabled=true;
   let saved=false;saveStatus('폴더 연결을 저장하고 있습니다. 잠시 기다려 주세요.');
   try{
    await Promise.all([initialMapping,activeRefresh]);if(closed)return;
    lock(true);
    if(base){
     saveStatus('연결 프로그램에 입력한 폴더 정보를 보내고 있습니다.');
     const written=await request('mapping',{method:'PUT',body:JSON.stringify(value)});
     if(!sameMapping(written.mapping,value))throw Error('서버의 저장 응답이 입력값과 다릅니다. 다시 저장하세요.');
     saveStatus('저장한 값을 서버에서 다시 읽어 확인하고 있습니다.');
     const read=await request('mapping');
     if(!sameMapping(read.mapping,value))throw Error('서버에서 저장 내용을 확인하지 못했습니다. 연결 프로그램의 실행 상태를 확인하세요.');
     saved=true;mappingDirty=false;
     if(!closed){q('[data-folder]').value=value.folder;q('[data-date]').value=value.reference_date;q('[data-preferred]').value=selectedFilesText(value);saveStatus('저장 완료 · 현장 ID '+Number(ctx.row.source_id)+'의 설정값 저장을 확인했습니다. 실제 폴더·파일 존재 여부는 보고서 조회 결과를 확인하세요.');}
    }else{
     saveLocal(localStorage,mappingKey(ctx.config,ctx.row.source_id),value);mappingDirty=false;saveStatus('이 PC·브라우저에 저장했습니다. 자동 보고서 조회에는 HTTPS 연결 주소 설정이 필요합니다.');
    }
   }catch(e){saveStatus('저장 확인에 실패했습니다: '+e.message,true);status('폴더 연결 저장 결과는 저장 버튼 바로 아래에서 확인하세요.');}
   finally{saving=false;if(!closed){q('[data-save]').disabled=false;q('[data-save]').textContent='이 현장에 폴더 연결 저장';q('[data-api-save]').disabled=false;lock(false)}}
   if(saved&&!closed)startRefresh();
  };
  try{const raw=localStorage.getItem(mappingKey(ctx.config,ctx.row.source_id));if(raw){const m=mappingValue(JSON.parse(raw));q('[data-folder]').value=m.folder;q('[data-date]').value=m.reference_date;q('[data-preferred]').value=selectedFilesText(m);saveStatus('이 브라우저의 기존 폴더 설정을 표시했습니다. 연결 프로그램에 저장된 정보를 확인하고 있습니다.')}}catch(e){saveStatus('기존 폴더 설정 확인 실패: '+e.message,true)}
  if(base)initialMapping=request('mapping').then(data=>{if(closed||mappingDirty||saving)return;const m=data.mapping;if(m){q('[data-folder]').value=m.folder||'';q('[data-date]').value=m.reference_date||'';q('[data-preferred]').value=selectedFilesText(m);saveStatus('이 현장에 저장된 폴더 정보를 불러왔습니다.')}}).catch(e=>{if(!closed&&!saving)saveStatus('기존 연결 정보 조회 실패: '+e.message,true)});
 }
 if(!base){q('[data-refresh]').disabled=true;status('보고서 연결 준비 상태입니다. NAS에 접근 가능한 PC·서버에서 연결 프로그램을 실행하고 HTTPS 주소를 설정해야 실제 파일 조회가 가능합니다.');if(nas)status('ipDISK 연결 주소를 설정했습니다. 위 버튼으로 서버 창을 열어 로그인 후 보고서를 찾으세요. 포털 내부 자동 목록 조회는 연결 프로그램 설정 후 사용할 수 있습니다.');}else startRefresh();
 if(!base&&ctx.admin){try{const raw=localStorage.getItem(mappingKey(ctx.config,ctx.row.source_id));if(raw){const m=mappingValue(JSON.parse(raw));q('[data-folder]').value=m.folder;q('[data-date]').value=m.reference_date;q('[data-preferred]').value=selectedFilesText(m);status('이 PC·브라우저에 저장된 폴더 정보를 불러왔습니다. 다른 기기와 공유되지 않습니다. ipDISK 버튼으로 서버를 열 수 있으며 자동 목록 조회는 별도 연결이 필요합니다.')}}catch(e){status('저장된 연결 정보를 불러오지 못했습니다. 경로를 다시 입력해 저장하세요. '+e.message)}}
 return close;
}

})(window);
