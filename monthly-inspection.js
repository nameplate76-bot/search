(function (root) {
  'use strict';

  root.createStaffMonthlyInspection = function (deps) {
    const $ = id => document.getElementById(id);
    const esc = deps.escape;
    const dialogs = new Set();
    let chartYear = null;
    let dashboardRequest = 0;
    let calendar;

    const monthText = value => value ? `${value.slice(0, 4)}년 ${Number(value.slice(5, 7))}월` : '—';
    const dateText = value => esc(value || '—');
    const count = value => Number(value || 0).toLocaleString('ko-KR');
    const displayPeriod = row => `${dateText(row.starts_on)} ~ ${dateText(row.ends_on)}`;
    const detail = (kind, id) => deps.rpc('staff_monthly_detail', kind === 'source' ? { p_source_id: id } : { p_contract_id: id });
    const hasInspector = row => Boolean(row.inspector_id || row.inspector_name);
    const reportStatus = row => row.report_submitted_on ? '제출 완료'
      : row.report_written_on ? '제출 대기' : row.inspected_on ? '작성 대기' : '—';
    const visitStatus = row => row.inspected_on ? '점검 완료' : row.planned_on ? '계획 등록' : '계획 미등록';

    function status(element, message, error = false) {
      element.textContent = message;
      element.classList.toggle('monthlyError', error);
    }

    function errorMessage(error) {
      if (error?.code === 'PGRST202' || error?.code === '42883') {
        return '월점검 DB 설정을 확인하세요. Supabase에서 V355 월점검 SQL을 실행해야 합니다.';
      }
      return error?.message || String(error);
    }

    function dialog(title) {
      const element = document.createElement('dialog');
      element.className = 'scheduleDialog monthlyDialog';
      element.setAttribute('aria-label', title);
      element.innerHTML = `<div class="dlgHead"><h3>${esc(title)}</h3><button type="button" class="iconBtn" aria-label="닫기">×</button></div><div class="monthlyDialogBody"></div>`;
      element.querySelector('button').onclick = () => element.close();
      element.addEventListener('close', () => {
        dialogs.delete(element);
        element.remove();
      });
      dialogs.add(element);
      document.body.append(element);
      element.showModal();
      return { element, body: element.querySelector('.monthlyDialogBody') };
    }

    function clear() {
      dashboardRequest++;
      chartYear = null;
      calendar?.clear();
      for (const element of dialogs) element.remove();
      dialogs.clear();
      for (const id of ['monthlyDashMetrics', 'monthlyAnnualChart', 'monthlyMonthChart']) $(id).replaceChildren();
      $('monthlyDashCharts').classList.add('hidden');
      $('monthlyInspectionDashboard').classList.add('hidden');
    }

    async function refreshAfterSave() {
      const jobs = [];
      if (deps.activePage() === 'schedule' && deps.calendarActive()) jobs.push(calendar.load());
      if (deps.activePage() === 'home' && deps.isMonthlyUser()) jobs.push(loadDashboard());
      await Promise.allSettled(jobs);
    }

    function monthOptions(row) {
      const start = new Date(`${row.starts_on.slice(0, 7)}-01T00:00:00Z`);
      const end = row.ends_on.slice(0, 7);
      const options = [];
      while (start.toISOString().slice(0, 7) <= end) {
        const value = start.toISOString().slice(0, 10);
        options.push(`<option value="${value}" ${value === row.target_month ? 'selected' : ''}>${monthText(value)}</option>`);
        start.setUTCMonth(start.getUTCMonth() + 1);
      }
      return options.join('');
    }

    function dateInput(name, label, value) {
      return `<label>${esc(label)}<input type="date" name="${name}" min="2000-01-01" max="2050-12-31" value="${esc(value || '')}"></label>`;
    }

    function reportLink(value) {
      if (!value) return '';
      try {
        const url = new URL(value);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">보고서 열기</a>`;
        }
      } catch {}
      return '';
    }

    function renderReadOnlyRound(body, row) {
      body.innerHTML = `<p><strong>${esc(row.site_name)} · ${row.round_no}회차</strong> <span class="hint">${monthText(row.target_month)}</span></p>
        <dl class="monthlyReadGrid">
          <div><dt>계획일자</dt><dd>${dateText(row.planned_on)}</dd></div>
          <div><dt>점검일자</dt><dd>${dateText(row.inspected_on)}</dd></div>
          <div><dt>월점검원</dt><dd>${dateText(row.inspector_name)}</dd></div>
          <div><dt>차량번호</dt><dd>${dateText(row.vehicle_number)}</dd></div>
          <div><dt>보고서</dt><dd>${reportStatus(row)} ${reportLink(row.report_url)}</dd></div>
          <div><dt>작성일자</dt><dd>${dateText(row.report_written_on)}</dd></div>
          <div><dt>제출일자</dt><dd>${dateText(row.report_submitted_on)}</dd></div>
          <div><dt>제출처</dt><dd>${dateText(row.report_recipient)}</dd></div>
        </dl>`;
    }

    function openRound(row, { proposedDate = '', onSaved, focus, readOnly = false } = {}) {
      if (!deps.canView()) return;
      const { element, body } = dialog('월점검 일정');
      if (readOnly || !deps.canEdit()) {
        renderReadOnlyRound(body, row);
        return;
      }
      return renderRoundForm(body, row, {
        proposedDate, focus, canEdit: () => element.open && deps.canEdit(),
        onSaved: () => {
          if (element.open) element.close();
          return onSaved?.();
        }
      });
    }

    async function renderRoundForm(body, row, { proposedDate = '', onSaved, focus, canEdit }) {
      body.textContent = '월점검원 목록을 불러오는 중…';
      try {
        const inspectors = await deps.rpc('staff_monthly_inspectors');
        if (!body.isConnected || !canEdit()) return;
        const current = String(row.inspector_id || '');
        const existingOption = current && !inspectors.some(person => person.id === current)
          ? `<option selected value="${esc(current)}">${esc(row.inspector_name)} (기존 담당자)</option>` : '';
        const options = inspectors.map(person =>
          `<option value="${esc(person.id)}" ${person.id === current ? 'selected' : ''}>${esc(person.name)} · ${esc(person.user_id)}</option>`
        ).join('');
        body.innerHTML = `<form class="monthlyRoundForm">
          <p><strong>${esc(row.site_name)} · ${row.round_no}회차</strong> <span class="hint">${displayPeriod(row)}</span></p>
          <div class="monthlyFormGrid">
            <label>대상 월<select name="target_month">${monthOptions(row)}</select></label>
            <label>월점검원<select name="inspector_id"><option value="">${!current && row.inspector_name ? esc(row.inspector_name) + ' (기존 담당자)' : '선택하세요'}</option>${existingOption}${options}</select></label>
            ${dateInput('planned_on', '계획일자', row.planned_on || proposedDate)}
            ${dateInput('inspected_on', '점검일자', row.inspected_on)}
            <label>차량번호<input name="vehicle_number" maxlength="80" value="${esc(row.vehicle_number)}"></label>
          </div>
          <fieldset class="monthlyReportFields"><legend>월점검 보고서</legend>
            <p class="hint">점검일자를 등록한 회차에서 작성과 제출을 기록합니다.</p>
            <div class="monthlyFormGrid">
              ${dateInput('report_written_on', '작성일자', row.report_written_on)}
              ${dateInput('report_submitted_on', '제출일자', row.report_submitted_on)}
              <label>제출처<input name="report_recipient" maxlength="200" value="${esc(row.report_recipient)}"></label>
              <label>보고서 링크<input type="url" name="report_url" maxlength="2000" value="${esc(row.report_url)}" placeholder="https://"></label>
            </div>
            ${reportLink(row.report_url)}
          </fieldset>
          <p class="monthlyStatus" role="status" aria-live="polite"></p>
          <div class="actions">
            ${row.planned_on ? '<button type="button" data-clear-monthly-plan>계획일자 지우기</button>' : ''}
            <button type="submit" class="primary">저장</button>
          </div>
        </form>`;
        const form = body.querySelector('form');
        const report = form.querySelector('fieldset');
        const message = form.querySelector('[role="status"]');
        const button = form.querySelector('button[type="submit"]');
        const syncReportFields = () => {
          report.disabled = !form.elements.inspected_on.value &&
            !['report_written_on', 'report_submitted_on', 'report_recipient', 'report_url'].some(name => form.elements[name].value);
          form.elements.report_submitted_on.disabled = !form.elements.report_written_on.value && !form.elements.report_submitted_on.value;
        };
        form.elements.inspected_on.onchange = syncReportFields;
        form.elements.report_written_on.onchange = syncReportFields;
        syncReportFields();
        const clearPlan = form.querySelector('[data-clear-monthly-plan]');
        if (clearPlan) clearPlan.onclick = () => {
          form.elements.planned_on.value = '';
          status(message, '저장하면 달력에서 이 계획이 해제됩니다.');
        };
        if (focus) form.elements[focus]?.focus();
        form.onsubmit = async event => {
          event.preventDefault();
          if (!body.isConnected || !canEdit() || button.disabled) return;
          const names = ['target_month', 'inspector_id', 'planned_on', 'inspected_on', 'vehicle_number',
            'report_written_on', 'report_submitted_on', 'report_recipient', 'report_url'];
          const patch = Object.fromEntries(names.map(name => [name, form.elements[name].value.trim() || null]));
          if ((patch.planned_on || patch.inspected_on) && !patch.inspector_id && !(hasInspector(row) && !row.inspector_id)) {
            status(message, '월점검원을 선택하세요.', true);
            return;
          }
          button.disabled = true;
          status(message, '저장 중…');
          try {
            await deps.rpc('staff_monthly_save_round', { p_round_id: row.id, p_revision: row.revision, p_patch: patch });
            await Promise.allSettled([refreshAfterSave(), onSaved?.()]);
          } catch (error) {
            status(message, errorMessage(error), true);
            button.disabled = false;
          }
        };
      } catch (error) {
        if (body.isConnected) status(body, errorMessage(error), true);
      }
    }

    function contractForm(container, data, onSaved, canEdit = deps.canEdit) {
      const { source, candidates } = data;
      if (!source) {
        container.innerHTML = '<p class="hint">등록된 월점검 계약이 없습니다.</p>';
        return;
      }
      const options = candidates.map(row => `<option value="${row.id}">${displayPeriod(row)} · ${count(row.inspection_count)}회 · S/N ${esc(row.reference_sn || '—')}</option>`).join('');
      const description = `<p><strong>${esc(source.site_name)}</strong> · S/N ${dateText(source.sn)}</p>`;
      if (!canEdit()) {
        container.innerHTML = description + `<p class="hint">월점검 계약 연결 전${source.inspection_count > 0 ? ` · 계약 ${count(source.inspection_count)}회` : ''}</p>`;
        return;
      }
      container.innerHTML = `${description}<form class="monthlyContractForm">
        ${options ? `<label>계약 선택<select name="contract_id">${options}<option value="">새 월점검 계약 등록</option></select></label>` : ''}
        <fieldset class="monthlyNewContract">
          <legend>계약기간과 횟수</legend>
          <div class="monthlyFormGrid">
            ${dateInput('starts_on', '계약 시작일자', source.starts_on)}
            ${dateInput('ends_on', '계약 종료일자', source.ends_on)}
            <label>월점검 계약횟수<input name="inspection_count" type="number" min="1" max="1200" step="1" value="${source.inspection_count > 0 ? esc(source.inspection_count) : ''}" required></label>
          </div>
        </fieldset>
        <p class="monthlyStatus" role="status" aria-live="polite"></p>
        <div class="actions"><button type="submit" class="primary"></button></div>
      </form>`;
      const form = container.querySelector('form');
      const button = form.querySelector('button[type="submit"]');
      const dates = form.querySelector('fieldset');
      const message = form.querySelector('[role="status"]');
      const contractId = () => form.elements.contract_id?.value || '';
      form.elements.starts_on.readOnly = Boolean(source.starts_on);
      form.elements.ends_on.readOnly = Boolean(source.ends_on);
      form.elements.starts_on.required = form.elements.ends_on.required = true;
      const sync = () => {
        const linked = Boolean(contractId());
        dates.disabled = linked;
        dates.hidden = linked;
        button.textContent = linked ? '기존 계약 연결' : '월점검 회차 생성';
      };
      if (form.elements.contract_id) form.elements.contract_id.onchange = sync;
      sync();
      form.onsubmit = async event => {
        event.preventDefault();
        if (!container.isConnected || !canEdit() || button.disabled) return;
        const existing = contractId();
        const args = {
          p_source_id: source.source_id,
          p_contract_id: existing || null,
          p_start: existing ? null : form.elements.starts_on.value,
          p_end: existing ? null : form.elements.ends_on.value,
          p_count: existing ? null : Number(form.elements.inspection_count.value)
        };
        button.disabled = true;
        status(message, '계약 연결 중…');
        try {
          const id = await deps.rpc('staff_monthly_register_contract', args);
          if (container.isConnected) await onSaved(id);
          await refreshAfterSave();
        } catch (error) {
          status(message, errorMessage(error), true);
          button.disabled = false;
        }
      };
    }

    function table(rows, { showSite = false, showProgress = false, open, action = '수정', editable = deps.canEdit() } = {}) {
      const headers = [...(showSite ? ['현장명'] : []), '회차', '대상 월', '계획일자', '점검일자', '월점검원',
        '차량번호', ...(showProgress ? ['점검횟수/계약횟수'] : []), '보고서', '관리'];
      const completed = rows.filter(row => row.inspected_on).length;
      const result = document.createElement('div');
      result.className = 'monthlyTableWrap';
      result.innerHTML = `<table class="monthlyTable"><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row, i) => `<tr>
          ${showSite ? `<td><strong>${esc(row.site_name)}</strong> <small>${dateText(row.sn)}</small></td>` : ''}
          <td>${row.round_no}회차</td><td>${monthText(row.target_month)}</td><td>${dateText(row.planned_on)}</td>
          <td>${dateText(row.inspected_on)}</td><td>${dateText(row.inspector_name)}</td><td>${dateText(row.vehicle_number)}</td>
          ${showProgress ? `<td>${count(completed)} / ${count(row.inspection_count)}회</td>` : ''}
          <td><span class="monthlyPill" data-report-state="${row.report_submitted_on ? 'done' : row.inspected_on ? 'pending' : 'none'}">${reportStatus(row)}</span></td>
          <td><button type="button" data-monthly-row="${i}">${editable ? action : '조회'}</button></td></tr>`).join('')
          || `<tr><td colspan="${headers.length}">해당 회차가 없습니다.</td></tr>`}</tbody></table>`;
      for (const button of result.querySelectorAll('[data-monthly-row]')) {
        button.onclick = () => open(rows[Number(button.dataset.monthlyRow)]);
      }
      return result;
    }

    async function renderDetail(container, sourceId, { canEdit = () => false, onSaved } = {}) {
      const content = document.createElement('div');
      container.replaceChildren(content);
      if (!deps.canView()) {
        status(content, '월점검 일정조회 권한이 필요합니다.', true);
        return;
      }
      content.innerHTML = '<p class="monthlyStatus" role="status">월점검 계약을 불러오는 중…</p>';
      const reload = () => renderDetail(container, sourceId, { canEdit, onSaved });
      const saved = () => Promise.allSettled([content.isConnected ? reload() : undefined, onSaved?.()]);
      try {
        const data = await detail('source', sourceId);
        if (!content.isConnected || !deps.canView()) return;
        if (!data.contract) {
          contractForm(content, data, saved, canEdit);
          return;
        }
        const { contract, rounds } = data;
        content.innerHTML = `<div class="monthlyContractSummary"><div><h3>월점검 계약</h3><span>${displayPeriod(contract)} · S/N ${dateText(contract.reference_sn || contract.sn)}</span></div>
          <strong>점검횟수/계약횟수 ${count(rounds.filter(row => row.inspected_on).length)} / ${count(contract.inspection_count)}회</strong></div>`;
        const editable = canEdit();
        content.append(table(rounds, { showProgress: true, editable, open: row => {
          if (!editable) return openRound(row, { readOnly: true });
          if (!canEdit()) return;
          content.innerHTML = '<button type="button" class="ghost monthlyEditBack">회차 목록으로</button><div></div>';
          content.firstElementChild.onclick = reload;
          renderRoundForm(content.lastElementChild, row, { canEdit, onSaved: saved, focus: 'target_month' });
        } }));
      } catch (error) {
        if (content.isConnected) status(content.querySelector('[role="status"]') || content, errorMessage(error), true);
      }
    }

    function openCalendarRegistration(date) {
      if (!deps.canEdit()) return;
      const { element, body } = dialog('월점검 일정 등록');
      body.innerHTML = `<form class="monthlySearchForm"><label>현장명 또는 S/N<input type="search" name="query" maxlength="100" required></label>
        <button type="submit" class="primary">현장 검색</button></form>
        <div class="monthlySearchResults" aria-live="polite"></div><div class="monthlySearchContract"></div>`;
      const form = body.querySelector('form');
      const results = body.querySelector('.monthlySearchResults');
      const contractArea = body.querySelector('.monthlySearchContract');
      let request = 0;
      async function showContract(kind, id) {
        const token = ++request;
        contractArea.textContent = '계약을 불러오는 중…';
        try {
          const data = await detail(kind, id);
          if (!element.isConnected || token !== request || !deps.canEdit()) return;
          if (!data.contract) {
            contractForm(contractArea, data, contractId => showContract('contract', contractId));
            return;
          }
          const { contract, rounds } = data;
          const first = rounds.find(row => date?.slice(0, 7) === row.target_month.slice(0, 7) && !row.planned_on && !row.inspected_on)
            || rounds.find(row => !row.planned_on && !row.inspected_on) || rounds[0];
          contractArea.innerHTML = `<div class="monthlyContractSummary"><div><h3>${esc(contract.site_name)}</h3><span>${displayPeriod(contract)} · 계약 ${count(contract.inspection_count)}회</span></div></div>
            <div class="monthlyChooseRound"><label>월점검 회차<select>${rounds.map(row =>
              `<option value="${row.id}" ${row.id === first?.id ? 'selected' : ''}>${row.round_no}회차 · ${monthText(row.target_month)} · ${visitStatus(row)}</option>`
            ).join('')}</select></label><button type="button" class="primary">회차 열기</button></div>`;
          contractArea.querySelector('button').onclick = () => {
            const selection = contractArea.querySelector('select').value;
            const row = rounds.find(item => String(item.id) === selection);
            if (!row) return;
            openRound(row, {
              proposedDate: row.inspected_on ? '' : date,
              onSaved: () => { if (element.isConnected) element.close(); }
            });
          };
        } catch (error) {
          if (element.isConnected && token === request) status(contractArea, errorMessage(error), true);
        }
      }
      form.onsubmit = async event => {
        event.preventDefault();
        const query = form.elements.query.value.trim();
        if (!query || !deps.canEdit()) return;
        const token = ++request;
        contractArea.replaceChildren();
        status(results, '검색 중…');
        try {
          const sites = await deps.rpc('staff_monthly_search', { p_query: query });
          if (!element.isConnected || token !== request || !deps.canEdit()) return;
          if (!sites.length) {
            status(results, '일치하는 월점검 계약이 없습니다. 현장 정보 수정의 월점검 탭에서 계약을 등록할 수 있습니다.');
            return;
          }
          results.innerHTML = sites.map((row, i) => `<button type="button" data-monthly-choice="${i}"><strong>${esc(row.site_name)}</strong>
            <small>S/N ${dateText(row.sn)} · ${displayPeriod(row)} · 계약 ${count(row.inspection_count)}회${row.kind === 'source' ? ' · 연결 필요' : ''}</small></button>`).join('');
          for (const button of results.querySelectorAll('button')) {
            const row = sites[Number(button.dataset.monthlyChoice)];
            button.onclick = () => showContract(row.kind, row.id);
          }
        } catch (error) {
          if (element.isConnected && token === request) status(results, errorMessage(error), true);
        }
      };
      form.elements.query.focus();
    }

    const workTitles = {
      annual: '연간 월점검 대상', monthly: '월간 월점검 대상', completed: '월점검 완료',
      missing: '월점검계획 미등록', unwritten: '월점검 보고서 작성 대기', unsubmitted: '월점검 보고서 제출 대기'
    };

    function openWork(kind, year, month) {
      if (!deps.canView() || !workTitles[kind]) return;
      const suffix = kind === 'annual' ? ` · ${year}년`
        : ['monthly', 'completed'].includes(kind) ? ` · ${year}년 ${month}월` : '';
      const { element, body } = dialog(workTitles[kind] + suffix);
      let offset = 0;
      let request = 0;
      async function load() {
        const token = ++request;
        status(body, '월점검 회차를 불러오는 중…');
        try {
          const rows = await deps.rpc('staff_monthly_work_list', {
            p_kind: kind, p_year: year, p_month: month, p_offset: offset
          });
          if (!element.isConnected || token !== request || !deps.canView()) return;
          const focus = kind === 'unwritten' ? 'report_written_on' : kind === 'unsubmitted' ? 'report_submitted_on'
            : kind === 'missing' ? 'planned_on' : '';
          const action = kind === 'unwritten' ? '보고서 작성' : kind === 'unsubmitted' ? '제출 등록'
            : kind === 'missing' ? '계획 등록' : '수정';
          body.replaceChildren(table(rows.slice(0, 100), {
            showSite: true, action, open: row => openRound(row, { onSaved: load, focus })
          }));
          if (offset || rows.length > 100) {
            const nav = document.createElement('div');
            nav.className = 'actions monthlyWorkPagination';
            nav.innerHTML = `<button type="button" ${offset ? '' : 'disabled'}>이전</button><span>${offset / 100 + 1} 페이지</span><button type="button" ${rows.length > 100 ? '' : 'disabled'}>다음</button>`;
            const [prev, next] = nav.querySelectorAll('button');
            prev.onclick = () => { offset -= 100; load(); };
            next.onclick = () => { offset += 100; load(); };
            body.append(nav);
          }
        } catch (error) {
          if (element.isConnected && token === request) status(body, errorMessage(error), true);
        }
      }
      load();
    }

    function renderDashboard(data) {
      const [year, month] = data.today.split('-').map(Number);
      const annual = data.annual.find(row => row.year === year) || {};
      const now = data.current;
      const metrics = [
        ['annual', '올해 월점검 현장', annual.sites, '곳', `대상 ${count(annual.rounds)}회`],
        ['monthly', '이번 달 월점검 현장', now.sites, '곳', `대상 ${count(now.rounds)}회`],
        ['completed', '이번 달 월점검 완료', now.completed, '회', '실제 점검일 기준'],
        ['missing', '월점검계획 미등록', now.missing, '회', '이번 달까지의 대상 회차'],
        ['unwritten', '보고서 작성 대기', now.unwritten, '건', '점검 완료 기준'],
        ['unsubmitted', '보고서 제출 대기', now.unsubmitted, '건', '작성 완료 기준']
      ];
      $('monthlyDashMetrics').innerHTML = metrics.map(([kind, label, value, unit, note]) =>
        `<button type="button" class="inspectionDashMetric" data-monthly-open="${kind}" data-year="${year}" data-month="${month}"><span>${label}</span><strong>${count(value)}<small>${unit}</small></strong><small>${note}</small></button>`
      ).join('');
      const maxAnnual = Math.max(1, ...data.annual.map(row => row.sites));
      const maxMonthly = Math.max(1, ...data.monthly.map(row => row.sites));
      $('monthlyAnnualChart').innerHTML = data.annual.map(row =>
        `<button type="button" class="inspectionDashBarRow" data-monthly-open="annual" data-year="${row.year}" data-month="1"><span class="inspectionDashBarYear">${row.year}년</span><span class="inspectionDashBarTrack"><i style="width:${row.sites / maxAnnual * 100}%"></i></span><b class="inspectionDashBarCount">${count(row.sites)}곳</b></button>`
      ).join('');
      $('monthlyMonthChart').innerHTML = data.monthly.map(row =>
        `<button type="button" class="inspectionDashMonth" data-monthly-open="monthly" data-year="${chartYear}" data-month="${row.month}" aria-label="${row.month}월 ${count(row.sites)}곳, ${count(row.rounds)}회"><span class="inspectionDashMonthValue">${count(row.sites)}곳</span><span class="inspectionDashMonthTrack"><i style="height:${row.sites / maxMonthly * 100}%"></i></span><b>${row.month}월</b></button>`
      ).join('');
      const picker = $('monthlyDashYear');
      const last = Math.max(year + 1, chartYear);
      picker.innerHTML = Array.from({ length: last - 1999 }, (_, i) => `<option value="${last - i}">${last - i}년</option>`).join('');
      picker.value = String(chartYear);
      $('monthlyDashCharts').classList.remove('hidden');
    }

    async function loadDashboard() {
      const request = ++dashboardRequest;
      const message = $('monthlyDashStatus');
      $('monthlyDashMetrics').replaceChildren();
      $('monthlyDashCharts').classList.add('hidden');
      if (!deps.isMonthlyUser()) return;
      if (!deps.canView()) {
        status(message, '월점검 현황을 보려면 월점검 일정조회 또는 일정수정 권한이 필요합니다.');
        return;
      }
      if (!chartYear) chartYear = deps.currentPeriod().year;
      status(message, '월점검 현황을 불러오는 중…');
      try {
        const data = await deps.rpc('staff_monthly_dashboard', { p_year: chartYear });
        if (request !== dashboardRequest || !deps.isMonthlyUser() || !deps.canView()) return;
        renderDashboard(data);
        status(message, '현장 수는 중복을 제외하고, 방문은 회차별로 집계합니다.');
      } catch (error) {
        if (request === dashboardRequest) status(message, errorMessage(error), true);
      }
    }

    async function showAbsence(year) {
      if (!deps.canView()) return;
      const { element, body } = dialog(`${year}년 공휴일·휴무`);
      status(body, '공휴일·휴무를 불러오는 중…');
      try {
        const data = await deps.rpc('staff_monthly_calendar', { p_year: year });
        if (!element.isConnected || !deps.canView()) return;
        const holidayNames = root.STAFF_SCHEDULE_HOLIDAYS?.[year] || {};
        const holidays = new Map(Object.entries(holidayNames));
        for (const item of data.holidays) {
          if (item.is_holiday === false) holidays.delete(item.holiday_date);
          else holidays.set(item.holiday_date, item.name);
        }
        const leaveLabels = { full: '연차', am: '오전 반차', pm: '오후 반차', sick: '병가', maternity: '출산휴가', leave: '휴직' };
        const entries = [...[...holidays].map(([date, name]) => ({ date, name })),
          ...data.leaves.map(row => ({ date: row.leave_date, name: `${row.inspector} · ${leaveLabels[row.leave_type] || '휴무'}` }))];
        entries.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko'));
        body.innerHTML = `<ul class="monthlyAbsenceList">${entries.map(row => `<li><time>${esc(row.date)}</time> ${esc(row.name)}</li>`).join('')
          || '<li>등록된 휴무가 없습니다.</li>'}</ul>`;
      } catch (error) {
        if (element.isConnected) status(body, errorMessage(error), true);
      }
    }

    function init() {
      const panel = $('monthlySchedulePanel');
      const fragment = document.createDocumentFragment();
      for (const child of $('regularSchedulePanel').children) fragment.append(child.cloneNode(true));
      const elements = { 'page-schedule': $('page-schedule') };
      for (const node of fragment.querySelectorAll('[id]')) {
        elements[node.id] = node;
        node.id = 'monthly-' + node.id;
      }
      for (const node of fragment.querySelectorAll('label[for]')) node.htmlFor = 'monthly-' + node.htmlFor;
      panel.append(fragment);
      elements.scheduleAdd.textContent = '+ 월점검 일정 등록';
      elements.scheduleHolidays.textContent = '공휴일·휴무 조회';
      panel.querySelector('.scheduleLegend').textContent = '평일 등록률은 주말·공휴일을 제외해 계산합니다. 빨간 테두리와 휴무 표시로 휴가를 확인할 수 있습니다.';
      elements.scheduleScopeNote.textContent = '월점검 계획일과 배정된 월점검원을 표시합니다.';
      calendar = root.createStaffSchedule({
        monthly: true,
        element: id => elements[id],
        access: () => ({ view: deps.canView(), edit: deps.canEdit(), all: deps.canView(), dailyLog: false }),
        loadEmployeeOptions: deps.loadEmployees,
        calendarData: async year => {
          const data = await deps.rpc('staff_monthly_calendar', { p_year: year });
          return {
            rows: data.rows.map(row => ({
              ...row, source_id: row.id, site_key: row.site_id, plan_start: row.planned_on,
              plan_end: row.planned_on, inspectors: row.inspector_name
            })),
            holidays: data.holidays,
            leaves: data.leaves
          };
        },
        editRecord: (row, date) => row ? openRound(row) : openCalendarRegistration(date),
        moveRecord: (row, date) => deps.rpc('staff_monthly_save_round', {
          p_round_id: row.id, p_revision: row.revision, p_patch: { planned_on: date }
        }),
        showAbsence,
        pageActive: () => deps.activePage() === 'schedule' && deps.calendarActive()
      });
      $('monthlyDashboardRefresh').onclick = loadDashboard;
      $('monthlyDashYear').onchange = event => {
        chartYear = Number(event.target.value) || deps.currentPeriod().year;
        loadDashboard();
      };
      $('monthlyInspectionDashboard').onclick = event => {
        const button = event.target.closest('[data-monthly-open]');
        if (button) openWork(button.dataset.monthlyOpen, Number(button.dataset.year), Number(button.dataset.month));
      };
    }

    return { init, clear, open: () => calendar.open(), loadDashboard, renderDetail };
  };
})(window);
