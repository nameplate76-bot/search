(function(root){'use strict';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function endpoint(value){if(!String(value||'').trim())return '';const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('보고서 연결 주소는 로그인 정보가 없는 HTTPS 주소로 설정하세요.');return u.href.replace(/\/$/,'')}
function nasWebUrl(value){if(!String(value||'').trim())return '';const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('ipDISK 주소 형식을 확인하세요.');return u.href}
function mappingValue(value){const folder=String(value.folder||'').trim().replace(/\\/g,'/').replace(/\/$/,'');if(!folder||folder.length>1500||folder.startsWith('/')||folder.includes(':')||folder.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('NAS 기준 폴더 아래의 상대 경로를 입력하세요. 예: 유지관리 및 성능점검/② 학교/상록중학교');const reference_date=String(value.reference_date||'');if(reference_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(reference_date)||Number.isNaN(Date.parse(reference_date))||new Date(reference_date).toISOString().slice(0,10)!==reference_date))throw Error('기준일을 확인하세요.');const preferred_file=String(value.preferred_file||'').trim();if(preferred_file.length>500||/[\\/]/.test(preferred_file))throw Error('파일명에는 폴더 경로를 넣지 마세요.');return {folder,reference_date,preferred_file}}
function mappingKey(config,id){if(!Number.isSafeInteger(Number(id))||Number(id)<=0)throw Error('현장 ID를 확인하세요.');return 'staff-report-mapping-v1:'+String(config.supabaseUrl||'')+':'+Number(id)}
function saveLocal(storage,key,value){const text=JSON.stringify(mappingValue(value));storage.setItem(key,text);if(storage.getItem(key)!==text)throw Error('브라우저 저장 내용을 확인할 수 없습니다.');return JSON.parse(text)}
function sameMapping(a,b){return !!a&&!!b&&['folder','reference_date','preferred_file'].every(k=>String(a[k]||'')===String(b[k]||''))}
root.ReportFiles={open,endpoint,nasWebUrl,mappingValue,mappingKey,saveLocal,sameMapping};
function open(ctx){
 const apiKey='staff-report-api-v1:'+String(ctx.config.supabaseUrl||'');let override='';if(!ctx.getApi){try{override=localStorage.getItem(apiKey)||''}catch(e){}}
 const dlg=document.createElement('dialog');dlg.className='reportFilesDialog';
 const example=String(ctx.row.site_name||'').includes('상록중학교');
 const dateMatch=String(ctx.row.site_name||'').match(/(?:기준일)\s*(\d{2,4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
 const referenceLabel=dateMatch?`${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3]}`:'';
 dlg.innerHTML=`<div class="dlgHead"><div><h3>현장 보고서</h3><small>${escape(ctx.row.site_name)} · 현장 ID ${Number(ctx.row.source_id)}</small></div><button type="button" data-close>닫기</button></div><p>NAS 원본 파일을 조회합니다. 보고서를 확인하고 PDF 열람 또는 다운로드를 선택하세요.</p><div class="filterRow"><a data-nas hidden target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">ipDISK에서 보고서 찾기</a><button type="button" data-refresh class="primary">보고서 다시 조회</button></div><div data-nas-guide hidden></div><p data-status role="status" aria-live="polite"></p><div data-list class="reportFilesList"></div>${ctx.admin?`<details class="reportMapping" open><summary>관리자: 임시 HTTPS 연결 주소 설정</summary><p>PC 임시연결 창에 표시된 주소를 붙여넣으세요. 관리자가 저장하면 모든 직원의 PC와 휴대폰에 공통으로 적용됩니다. 공통 주소를 처음 저장하기 전에는 이 브라우저의 기존 주소 또는 포털 기본 주소를 사용합니다. 현재 실행 중인 주소인지 확인한 뒤 공통 저장하세요. 이미 열린 보고서 화면에서는 보고서 다시 조회를 누르세요.</p><label>발급된 임시 HTTPS 주소<input data-api placeholder="PC에서 발급된 https://…trycloudflare.com 주소"></label><button type="button" data-api-save>공통 연결 주소 저장</button></details><details class="reportMapping" open><summary>관리자: 현장 보고서 폴더 연결</summary><p>NAS 기준 폴더 아래에서 현장 폴더를 지정하세요. 검색 시간이 초과되지 않도록 보고서가 있는 제출용 폴더까지 지정하세요. 폴더명이 바뀌면 연결 경로를 수정해 주세요.</p><label>현장 폴더의 상대 경로<input data-folder lang="ko" placeholder="예: 유지관리 및 성능점검/② 학교/상록중학교"></label><label>성능 실시기준일 (다른 보고서도 함께 보려면 공란)<input data-date type="date"></label><label>우선 표시할 파일명 (선택)<input data-preferred lang="ko" placeholder="예: 제5권 기계설비 성능점검 보고서-상록중학교(기준일 25.04.18).pdf"></label><button type="button" data-save>이 현장에 폴더 연결 저장</button><p data-save-status role="status" aria-live="polite">입력 후 저장 버튼을 누르세요.</p><small>연결 프로그램이 있으면 해당 프로그램에 저장합니다. 연결 전에는 이 PC·브라우저에만 저장되며 다른 기기와 공유되지 않습니다. NAS 원본은 변경하지 않습니다.</small></details>`:''}`;
 document.body.append(dlg);dlg.showModal();const q=s=>dlg.querySelector(s);let base='',closed=false,busy=false,saving=false,mappingDirty=false,initialMapping=Promise.resolve(),activeRefresh=Promise.resolve(),requests=new Set();
 const status=s=>{q('[data-status]').textContent=s};
 const close=()=>{closed=true;requests.forEach(c=>c.abort());dlg.close();dlg.remove()};q('[data-close]').onclick=close;dlg.oncancel=e=>{e.preventDefault();close()};
 let nas='';try{nas=nasWebUrl(ctx.config.reportNasWebUrl);if(nas){q('[data-nas]').href=nas;q('[data-nas]').hidden=false;q('[data-nas-guide]').hidden=false;q('[data-nas-guide]').innerHTML=`<p>ipDISK 창에서 로그인한 후 현장명 <b>${escape(ctx.row.site_name)}</b>으로 해당 폴더를 찾아 파일을 열람하거나 다운로드하세요. 포털 로그인과 NAS 로그인은 별개입니다.</p>${example?`<p>상록중학교 위치 확인: VOL1 → 유지관리 및 성능점검 → ② 학교 → 상록중학교 → 해당 계약 폴더 → 제본 PDF 저장 폴더 → 제출용. ${referenceLabel?'조회 중인 현장의 기준일 '+escape(referenceLabel)+'에 해당하는 보고서를 확인하세요.':'조회 중인 계약에 해당하는 보고서를 확인하세요.'} 폴더명이 바뀌면 연결 경로도 수정하세요.</p>`:''}<small>서버 화면의 파일 조회·다운로드 지원 여부는 실제 접속 확인이 필요합니다. 자동 현장 폴더 이동은 아직 연결되지 않았습니다.</small>`}}catch(e){status(e.message)}
 try{base=endpoint(override||ctx.config.reportApiUrl)}catch(e){status(e.message)}
 async function request(route,options={}){
  if(ctx.getApi)base=endpoint(await ctx.getApi());
  if(!base)throw Error('공통 보고서 접속주소가 등록되지 않았습니다. 관리자에게 주소 등록을 요청하세요.');
  const session=await ctx.session();if(!session?.access_token)throw Error('포털 로그인이 필요합니다. 다시 로그인하세요.');
  const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),60000);
  try{const r=await fetch(base+'/api/sites/'+Number(ctx.row.source_id)+'/'+route,{...options,headers:{Authorization:'Bearer '+session.access_token,...(options.body?{'Content-Type':'application/json'}:{} )},signal:controller.signal,cache:'no-store',redirect:'error'});
   if(!r.ok){const error=await r.json().catch(()=>({}));throw Error((error.error||'보고서 서버 응답 오류')+' (HTTP '+r.status+')')}if(options.binary)return await r.blob();try{return await r.json()}catch(e){throw Error('연결 프로그램의 응답이 설정 데이터가 아닙니다. 임시 HTTPS 주소와 실행 창을 확인하세요.')}
  }catch(e){if(e.name==='AbortError')throw Error('조회가 취소되었거나 시간이 초과되었습니다. NAS 연결 상태를 확인하세요.');if(e instanceof TypeError)throw Error('보고서 연결 프로그램에 접속할 수 없습니다. HTTPS 주소와 서버 연결을 확인하세요.');throw e}
  finally{clearTimeout(timer);requests.delete(controller)}
 }
 function lock(value){busy=value;dlg.querySelectorAll('[data-refresh],button[data-file-id]').forEach(b=>b.disabled=value||saving)}
 async function fileAction(file,view){if(busy)return;const popup=view?window.open('','_blank'):null;if(view&&!popup){status('팝업을 허용한 뒤 열람을 다시 누르세요.');return}if(popup){popup.opener=null;popup.document.body.textContent='보고서를 불러오는 중입니다.'}lock(true);status('파일을 불러오는 중입니다.');try{
  const blob=await request('files/'+file.id+(view?'?view=1':''),{binary:true});if(closed){if(popup)popup.close();return}
  const url=URL.createObjectURL(blob);if(view){popup.location.replace(url)}else{const a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove()}setTimeout(()=>URL.revokeObjectURL(url),300000);status(view?'PDF 열람 창을 열었습니다.':'다운로드를 시작했습니다.');
 }catch(e){if(popup)popup.close();if(!closed)status(e.message)}finally{if(!closed)lock(false)}}
 async function refresh(){if(busy||saving)return;lock(true);status('이 현장의 보고서 폴더를 확인하고 있습니다.');q('[data-list]').innerHTML='';try{
  const data=await request('reports');if(closed)return;
  if(!data.connected){status('이 현장에 보고서 폴더가 연결되지 않았습니다. 관리자에게 연결 설정을 요청하세요.');return}
  const files=data.files||[];if(!files.length){status('연결된 폴더에서 조건에 맞는 보고서를 찾지 못했습니다. 폴더 위치와 실시기준일을 확인하세요.');return}
  q('[data-list]').innerHTML=`<table><thead><tr><th>파일명</th><th>현장 폴더 안의 위치</th><th>수정일</th><th>크기</th><th>열람·다운로드</th></tr></thead><tbody>${files.map((f,i)=>`<tr><td>${f.preferred?'<b>우선 표시</b> ':''}${escape(f.name)}</td><td>${escape(f.folder==='.'?'현장 폴더':f.folder)}</td><td>${escape(new Date(f.modified*1000).toLocaleString('ko-KR'))}</td><td>${(Number(f.size)/1024/1024).toFixed(2)} MB</td><td>${f.pdf?`<button type="button" data-file-id="${i}" data-view="1">PDF 열람</button>`:''}<button type="button" data-file-id="${i}">다운로드</button></td></tr>`).join('')}</tbody></table>`;
  q('[data-list]').querySelectorAll('[data-file-id]').forEach(b=>b.onclick=()=>fileAction(files[Number(b.dataset.fileId)],b.dataset.view==='1'));status(`${files.length}개 파일을 찾았습니다. 같은 종류의 파일이 여러 개면 파일명과 위치를 확인해 선택하세요.`);
 }catch(e){if(!closed){if(String(e.message).includes('HTTP 404')){await initialMapping.catch(()=>{});if(!closed){const folder=ctx.admin?q('[data-folder]').value:'';status('연결 프로그램에는 접속했지만 이 현장의 NAS 폴더를 찾지 못했습니다. '+(folder?'현재 연결 경로: '+folder+' · ':'')+'연결 PC에서 NAS 기준 폴더와 해당 경로가 열리는지 확인하세요. 폴더명·위치가 바뀌었다면 이 현장의 경로를 수정하세요. 다른 연도 현장과 연결 정보는 별도로 저장됩니다. (HTTP 404)')}}else status(e.message)}}finally{if(!closed)lock(false)}}
 function startRefresh(){activeRefresh=refresh();return activeRefresh}
 q('[data-refresh]').onclick=startRefresh;
 if(ctx.admin){
  const saveStatus=(message,error=false)=>{if(closed)return;const node=q('[data-save-status]');node.textContent=message;node.dataset.error=String(error)};
  ['[data-folder]','[data-date]','[data-preferred]'].forEach(sel=>q(sel).addEventListener('input',()=>{mappingDirty=true;saveStatus('변경한 입력 내용은 아직 저장되지 않았습니다.')}));
  q('[data-api]').value=override||ctx.config.reportApiUrl||'';
  q('[data-api-save]').onclick=async()=>{if(saving){saveStatus('폴더 저장이 끝난 뒤 연결 주소를 변경하세요.',true);return}try{const value=endpoint(q('[data-api]').value);if(!value||!new URL(value).hostname.endsWith('.trycloudflare.com'))throw Error('PC에서 발급된 trycloudflare.com HTTPS 주소를 입력하세요.');if(ctx.saveApi){const btn=q('[data-api-save]');btn.disabled=true;status('공통 접속주소 저장 중…');try{await ctx.saveApi(value);try{localStorage.removeItem(apiKey)}catch(e){}}finally{btn.disabled=false}}else{localStorage.setItem(apiKey,value);if(localStorage.getItem(apiKey)!==value)throw Error('주소 저장에 실패했습니다.');}close();open({...ctx,config:{...ctx.config,reportApiUrl:value}})}catch(e){status(e.message)}};
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
     if(!closed){q('[data-folder]').value=value.folder;q('[data-date]').value=value.reference_date;q('[data-preferred]').value=value.preferred_file;saveStatus('저장 완료 · 현장 ID '+Number(ctx.row.source_id)+'의 폴더 정보를 서버에서 확인했습니다. 아래 입력값은 저장된 값입니다.');}
    }else{
     saveLocal(localStorage,mappingKey(ctx.config,ctx.row.source_id),value);mappingDirty=false;saveStatus('이 PC·브라우저에 저장했습니다. 자동 보고서 조회에는 HTTPS 연결 주소 설정이 필요합니다.');
    }
   }catch(e){saveStatus('저장 확인에 실패했습니다: '+e.message,true);status('폴더 연결 저장 결과는 저장 버튼 바로 아래에서 확인하세요.');}
   finally{saving=false;if(!closed){q('[data-save]').disabled=false;q('[data-save]').textContent='이 현장에 폴더 연결 저장';q('[data-api-save]').disabled=false;lock(false)}}
   if(saved&&!closed)startRefresh();
  };
  try{const raw=localStorage.getItem(mappingKey(ctx.config,ctx.row.source_id));if(raw){const m=mappingValue(JSON.parse(raw));q('[data-folder]').value=m.folder;q('[data-date]').value=m.reference_date;q('[data-preferred]').value=m.preferred_file;saveStatus('이 브라우저의 기존 폴더 설정을 표시했습니다. 연결 프로그램에 저장된 정보를 확인하고 있습니다.')}}catch(e){saveStatus('기존 폴더 설정 확인 실패: '+e.message,true)}
  if(base)initialMapping=request('mapping').then(data=>{if(closed||mappingDirty||saving)return;const m=data.mapping;if(m){q('[data-folder]').value=m.folder||'';q('[data-date]').value=m.reference_date||'';q('[data-preferred]').value=m.preferred_file||'';saveStatus('이 현장에 저장된 폴더 정보를 불러왔습니다.')}}).catch(e=>{if(!closed&&!saving)saveStatus('기존 연결 정보 조회 실패: '+e.message,true)});
 }
 if(!base){q('[data-refresh]').disabled=true;status('보고서 연결 준비 상태입니다. NAS에 접근 가능한 PC·서버에서 연결 프로그램을 실행하고 HTTPS 주소를 설정해야 실제 파일 조회가 가능합니다.');if(nas)status('ipDISK 연결 주소를 설정했습니다. 위 버튼으로 서버 창을 열어 로그인 후 보고서를 찾으세요. 포털 내부 자동 목록 조회는 연결 프로그램 설정 후 사용할 수 있습니다.');}else startRefresh();
 if(!base&&ctx.admin){try{const raw=localStorage.getItem(mappingKey(ctx.config,ctx.row.source_id));if(raw){const m=mappingValue(JSON.parse(raw));q('[data-folder]').value=m.folder;q('[data-date]').value=m.reference_date;q('[data-preferred]').value=m.preferred_file;status('이 PC·브라우저에 저장된 폴더 정보를 불러왔습니다. 다른 기기와 공유되지 않습니다. ipDISK 버튼으로 서버를 열 수 있으며 자동 목록 조회는 별도 연결이 필요합니다.')}}catch(e){status('저장된 연결 정보를 불러오지 못했습니다. 경로를 다시 입력해 저장하세요. '+e.message)}}
}

})(window);
