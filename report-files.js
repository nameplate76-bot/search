(function(root){'use strict';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function endpoint(value){if(!String(value||'').trim())return '';const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('보고서 연결 주소는 로그인 정보가 없는 HTTPS 주소로 설정하세요.');return u.href.replace(/\/$/,'')}
root.ReportFiles={open,endpoint};
function open(ctx){
 const dlg=document.createElement('dialog');dlg.className='reportFilesDialog';
 const example=String(ctx.row.site_name||'').includes('상록중학교');
 dlg.innerHTML=`<div class="dlgHead"><div><h3>현장 보고서</h3><small>${escape(ctx.row.site_name)} · 현장 ID ${Number(ctx.row.source_id)}</small></div><button type="button" data-close>닫기</button></div><p>NAS 원본 파일을 조회합니다. 보고서를 확인하고 PDF 열람 또는 다운로드를 선택하세요.</p><div class="filterRow"><button type="button" data-refresh class="primary">보고서 다시 조회</button></div><p data-status role="status" aria-live="polite"></p><div data-list class="reportFilesList"></div>${ctx.admin?`<details class="reportMapping"><summary>관리자: 현장 보고서 폴더 연결</summary><p>NAS 기준 폴더 아래에서 현장 폴더를 지정하세요. 진행 단계에 따라 이름이 바뀌는 업무 폴더보다 위쪽 현장 폴더를 연결하면 하위 폴더를 다시 검색합니다.</p><label>현장 폴더의 상대 경로<input data-folder lang="ko" placeholder="예: 유지관리 및 성능점검/② 학교/상록중학교"></label><label>성능 실시기준일 (다른 보고서도 함께 보려면 공란)<input data-date type="date"></label><label>우선 표시할 파일명 (선택)<input data-preferred lang="ko" placeholder="예: 제5권 기계설비 성능점검 보고서-상록중학교(기준일 25.04.18).pdf"></label><button type="button" data-save>이 현장에 폴더 연결 저장</button><small>파일이나 NAS 폴더를 수정하지 않고, 연결 정보만 보고서 연결 프로그램에 저장합니다.</small></details>`:''}`;
 document.body.append(dlg);dlg.showModal();const q=s=>dlg.querySelector(s);let base='',closed=false,busy=false,requests=new Set();
 const status=s=>{q('[data-status]').textContent=s};
 const close=()=>{closed=true;requests.forEach(c=>c.abort());dlg.close();dlg.remove()};q('[data-close]').onclick=close;dlg.oncancel=e=>{e.preventDefault();close()};
 try{base=endpoint(ctx.config.reportApiUrl)}catch(e){status(e.message)}
 async function request(route,options={}){
  if(!base)throw Error('보고서 연결 프로그램이 아직 설정되지 않았습니다. 서버 연결 확인 후 활성화할 수 있습니다.');
  const session=await ctx.session();if(!session?.access_token)throw Error('포털 로그인이 필요합니다. 다시 로그인하세요.');
  const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),60000);
  try{const r=await fetch(base+'/api/sites/'+Number(ctx.row.source_id)+'/'+route,{...options,headers:{Authorization:'Bearer '+session.access_token,...(options.body?{'Content-Type':'application/json'}:{} )},signal:controller.signal,cache:'no-store',redirect:'error'});
   if(!r.ok){const error=await r.json().catch(()=>({}));throw Error(error.error||'보고서 서버 응답 오류 ('+r.status+')')}return options.binary?await r.blob():await r.json();
  }catch(e){if(e.name==='AbortError')throw Error('조회가 취소되었거나 시간이 초과되었습니다. NAS 연결 상태를 확인하세요.');if(e instanceof TypeError)throw Error('보고서 연결 프로그램에 접속할 수 없습니다. HTTPS 주소와 서버 연결을 확인하세요.');throw e}
  finally{clearTimeout(timer);requests.delete(controller)}
 }
 function lock(value){busy=value;dlg.querySelectorAll('[data-refresh],[data-save],button[data-file-id]').forEach(b=>b.disabled=value)}
 async function fileAction(file,view){if(busy)return;const popup=view?window.open('','_blank'):null;if(view&&!popup){status('팝업을 허용한 뒤 열람을 다시 누르세요.');return}if(popup){popup.opener=null;popup.document.body.textContent='보고서를 불러오는 중입니다.'}lock(true);status('파일을 불러오는 중입니다.');try{
  const blob=await request('files/'+file.id+(view?'?view=1':''),{binary:true});if(closed){if(popup)popup.close();return}
  const url=URL.createObjectURL(blob);if(view){popup.location.replace(url)}else{const a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove()}setTimeout(()=>URL.revokeObjectURL(url),300000);status(view?'PDF 열람 창을 열었습니다.':'다운로드를 시작했습니다.');
 }catch(e){if(popup)popup.close();if(!closed)status(e.message)}finally{if(!closed)lock(false)}}
 async function refresh(){if(busy)return;lock(true);status('이 현장의 보고서 폴더를 확인하고 있습니다.');q('[data-list]').innerHTML='';try{
  const data=await request('reports');if(closed)return;
  if(!data.connected){status('이 현장에 보고서 폴더가 연결되지 않았습니다. 관리자에게 연결 설정을 요청하세요.');return}
  const files=data.files||[];if(!files.length){status('연결된 폴더에서 조건에 맞는 보고서를 찾지 못했습니다. 폴더 위치와 실시기준일을 확인하세요.');return}
  q('[data-list]').innerHTML=`<table><thead><tr><th>파일명</th><th>현장 폴더 안의 위치</th><th>수정일</th><th>크기</th><th>열람·다운로드</th></tr></thead><tbody>${files.map((f,i)=>`<tr><td>${f.preferred?'<b>우선 표시</b> ':''}${escape(f.name)}</td><td>${escape(f.folder==='.'?'현장 폴더':f.folder)}</td><td>${escape(new Date(f.modified*1000).toLocaleString('ko-KR'))}</td><td>${(Number(f.size)/1024/1024).toFixed(2)} MB</td><td>${f.pdf?`<button type="button" data-file-id="${i}" data-view="1">PDF 열람</button>`:''}<button type="button" data-file-id="${i}">다운로드</button></td></tr>`).join('')}</tbody></table>`;
  q('[data-list]').querySelectorAll('[data-file-id]').forEach(b=>b.onclick=()=>fileAction(files[Number(b.dataset.fileId)],b.dataset.view==='1'));status(`${files.length}개 파일을 찾았습니다. 같은 종류의 파일이 여러 개면 파일명과 위치를 확인해 선택하세요.`);
 }catch(e){if(!closed)status(e.message)}finally{if(!closed)lock(false)}}
 q('[data-refresh]').onclick=refresh;
 if(ctx.admin){q('[data-save]').onclick=async()=>{if(busy)return;lock(true);try{await request('mapping',{method:'PUT',body:JSON.stringify({folder:q('[data-folder]').value,reference_date:q('[data-date]').value,preferred_file:q('[data-preferred]').value})});if(!closed)status('폴더 연결 정보를 저장했습니다. 보고서 다시 조회를 눌러 확인하세요.')}catch(e){if(!closed)status(e.message)}finally{if(!closed)lock(false)}};
  if(base)request('mapping').then(data=>{if(closed)return;const m=data.mapping;if(m){q('[data-folder]').value=m.folder||'';q('[data-date]').value=m.reference_date||'';q('[data-preferred]').value=m.preferred_file||''}}).catch(e=>{if(!closed)status(e.message)});
 }
 if(!base){dlg.querySelectorAll('[data-refresh],[data-save]').forEach(b=>b.disabled=true);status('보고서 연결 준비 상태입니다. NAS에 접근 가능한 PC·서버에서 연결 프로그램을 실행하고 HTTPS 주소를 설정해야 실제 파일 조회가 가능합니다.');if(ctx.admin&&example){q('[data-folder]').value='유지관리 및 성능점검/② 학교/상록중학교';q('[data-date]').value='2025-04-18';q('[data-preferred]').value='제5권 기계설비 성능점검 보고서-상록중학교(기준일 25.04.18).pdf';status('보고서 연결 준비 상태입니다. 상록중학교의 예시 설정을 표시했습니다. 해당 등록 건의 기준일과 경로를 확인한 뒤 연결 프로그램 설정 후 저장하세요.')}}else refresh();
}
})(window);
