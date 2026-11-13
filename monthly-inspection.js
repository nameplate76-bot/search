(function (root) {
  'use strict';

  root.createStaffMonthlyInspection = function (deps) {
    const $ = id => document.getElementById(id);
    const esc = deps.escape;
    const dialogs = new Set();
    const firstYear = 2000;
    const lastYear = 2050;
    const roundsPerPage = 24;
    const reportFields = ['report_written_on', 'report_submitted_on', 'report_recipient', 'report_url'];
    const roundFields = ['inspector_id', 'planned_on', 'inspected_on', 'vehicle_number', ...reportFields];
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

    function yearOptions(selectedYear) {
      return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
        const year = lastYear - index;
        return `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}년</option>`;
      }).join('');
    }

    function targetMonthFields(value, prefix = '') {
      const [year, month] = value.split('-').map(Number);
      const options = Array.from({ length: 12 }, (_, index) => {
        const number = index + 1;
        return `<option value="${String(number).padStart(2, '0')}" ${number === month ? 'selected' : ''}>${number}월</option>`;
      }).join('');
      return `<div class="monthlyTargetMonth" role="group" aria-label="대상 월">
        <span>대상 월</span>
        <div class="monthlyTargetMonthChoices">
          <select name="target_year" aria-label="${prefix}대상 연도">${yearOptions(year)}</select>
          <select name="target_month" aria-label="${prefix}대상 월">${options}</select>
        </div>
      </div>`;
    }

    function dateInput(name, label, value) {
      return `<label>${esc(label)}${dateControl(name, value)}</label>`;
    }

    function dateControl(name, value) {
      return `<input type="date" name="${name}" min="2000-01-01" max="2050-12-31" value="${esc(value || '')}">`;
    }

    function inspectorSelect(row, inspectors, showId = true) {
      const current = String(row.inspector_id || '');
      const placeholder = !current && row.inspector_name ? `${esc(row.inspector_name)} (기존 담당자)` : '선택하세요';
      const names = new Set();
      const duplicates = new Set();
      if (!showId) for (const person of inspectors) {
        if (names.has(person.name)) duplicates.add(person.name);
        names.add(person.name);
      }
      const existingOption = current && !inspectors.some(person => person.id === current)
        ? `<option selected value="${esc(current)}">${esc(row.inspector_name)} (기존 담당자)</option>` : '';
      const options = inspectors.map(person =>
        `<option value="${esc(person.id)}" ${person.id === current ? 'selected' : ''}>${esc(person.name)}${showId || duplicates.has(person.name) ? ` · ${esc(person.user_id)}` : ''}</option>`
      ).join('');
      return `<select name="inspector_id"><option value="">${placeholder}</option>${existingOption}${options}</select>`;
    }

    function roundValues(fields) {
      const values = Object.fromEntries(roundFields.map(name => [name, fields[name].value.trim() || null]));
      values.target_month = `${fields.target_year.value}-${fields.target_month.value}-01`;
      return values;
    }

    function canEnterReport(fields) {
      return Boolean(fields.inspected_on.value || reportFields.some(name => fields[name].value));
    }

    function syncSubmissionDate(fields) {
      fields.report_submitted_on.disabled = !fields.report_written_on.value && !fields.report_submitted_on.value;
    }

    function bindReportDates(fields, sync) {
      for (const name of ['inspected_on', 'report_written_on']) {
        fields[name].addEventListener('input', sync);
        fields[name].addEventListener('change', sync);
      }
      sync();
    }

    function missingInspector(row, values) {
      return Boolean((values.planned_on || values.inspected_on) && !values.inspector_id && !(hasInspector(row) && !row.inspector_id));
    }

    function saveRound(row, patch) {
      return deps.rpc('staff_monthly_save_round', { p_round_id: row.id, p_revision: row.revision, p_patch: patch });
    }

    function reportPill(row) {
      return `<span class="monthlyPill" data-report-state="${row.report_submitted_on ? 'done' : row.inspected_on ? 'pending' : 'none'}">${reportStatus(row)}</span>`;
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
        body.innerHTML = `<form class="monthlyRoundForm">
          <p><strong>${esc(row.site_name)} · ${row.round_no}회차</strong> <span class="hint">${displayPeriod(row)}</span></p>
          <div class="monthlyFormGrid">
            ${targetMonthFields(row.target_month)}
            <label>월점검원${inspectorSelect(row, inspectors)}</label>
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
        bindReportDates(form.elements, () => {
          report.disabled = !canEnterReport(form.elements);
          syncSubmissionDate(form.elements);
        });
        const clearPlan = form.querySelector('[data-clear-monthly-plan]');
        if (clearPlan) clearPlan.onclick = () => {
          form.elements.planned_on.value = '';
          status(message, '저장하면 달력에서 이 계획이 해제됩니다.');
        };
        if (focus) form.elements[focus]?.focus();
        form.onsubmit = async event => {
          event.preventDefault();
          if (!body.isConnected || !canEdit() || button.disabled) return;
          const patch = roundValues(form.elements);
          if (missingInspector(row, patch)) {
            status(message, '월점검원을 선택하세요.', true);
            return;
          }
          button.disabled = true;
          status(message, '저장 중…');
          try {
            await saveRound(row, patch);
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
          <td>${reportPill(row)}</td>
          <td><button type="button" data-monthly-row="${i}">${editable ? action : '조회'}</button></td></tr>`).join('')
          || `<tr><td colspan="${headers.length}">해당 회차가 없습니다.</td></tr>`}</tbody></table>`;
      for (const button of result.querySelectorAll('[data-monthly-row]')) {
        button.onclick = () => open(rows[Number(button.dataset.monthlyRow)]);
      }
      return result;
    }

    async function renderInlineRounds(content, contract, rounds, canEdit, onSaved) {
      const loading = document.createElement('p');
      loading.className = 'monthlyStatus';
      loading.setAttribute('role', 'status');
      status(loading, '월점검원 목록을 불러오는 중…');
      content.append(loading);
      const inspectors = await deps.rpc('staff_monthly_inspectors');
      if (!content.isConnected || !canEdit()) return;
      loading.remove();

      const form = document.createElement('form');
      form.className = 'monthlyInlineForm';
      form.noValidate = true;
      const headers = ['회차', '대상 월', '계획일자', '점검일자', '월점검원', '차량번호', '보고서'];
      form.innerHTML = `<div class="monthlyInlineBar">
          <div class="monthlyInlineMessages"><p role="status" aria-live="polite"></p><ul hidden></ul></div>
          <button type="submit" class="primary" id="monthlyInlineSave" disabled>변경사항 저장</button>
        </div>
        <div class="monthlyTableWrap monthlyInlineTableWrap">
          <table class="monthlyTable monthlyInlineTable" aria-label="월점검 회차 입력">
            <thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody></tbody>
          </table>
        </div>
        <nav class="actions monthlyWorkPagination" aria-label="월점검 회차 페이지" hidden>
          <button type="button" data-monthly-previous>이전</button><span aria-live="polite"></span><button type="button" data-monthly-next>다음</button>
        </nav>`;
      content.append(form);
      const summaryCount = content.querySelector('[data-monthly-completed]');
      const tbody = form.querySelector('tbody');
      const message = form.querySelector('[role="status"]');
      const errorList = form.querySelector('.monthlyInlineMessages ul');
      const save = form.querySelector('#monthlyInlineSave');
      const tableWrap = form.querySelector('.monthlyInlineTableWrap');
      const pagination = form.querySelector('nav');
      const previous = pagination.querySelector('[data-monthly-previous]');
      const next = pagination.querySelector('[data-monthly-next]');
      const drafts = new Map();
      const errors = new Map();
      let page = 0;
      let saving = false;

      function renderMessages() {
        save.disabled = saving || !drafts.size;
        save.textContent = saving ? '저장 중…' : '변경사항 저장';
        status(message, drafts.size ? `변경된 회차 ${drafts.size}건` : '', false);
        errorList.hidden = !errors.size;
        errorList.replaceChildren(...[...errors].map(([row, error]) => {
          const item = document.createElement('li');
          item.textContent = `${row.round_no}회차 · ${error}`;
          return item;
        }));
      }

      function paintReport(tr, row) {
        const details = tr.querySelector('details');
        details.querySelector('summary').innerHTML = `<span>보고서</span> ${reportPill(row)}`;
        details.querySelector('[data-monthly-report-link]').innerHTML = reportLink(row.report_url);
      }

      function renderPage() {
        const first = page * roundsPerPage;
        const visible = rounds.slice(first, first + roundsPerPage);
        const openReports = new Set([...tbody.querySelectorAll('tr:has(details[open])')].map(tr => tr.dataset.monthlyRoundId));
        tbody.innerHTML = visible.map(row => {
          const draft = drafts.get(row);
          const values = { ...row, ...draft?.patch };
          const prefix = `${row.round_no}회차 `;
          const label = (name, control) => `<label><span><span class="monthlyRoundAccessible">${prefix}</span>${name}</span>${control}</label>`;
          const planned = dateControl('planned_on', values.planned_on);
          const inspected = dateControl('inspected_on', values.inspected_on);
          const vehicle = `<input name="vehicle_number" maxlength="80" value="${esc(values.vehicle_number || '')}">`;
          const recipient = `<input name="report_recipient" maxlength="200" value="${esc(values.report_recipient || '')}">`;
          const url = `<input type="url" name="report_url" maxlength="2000" value="${esc(values.report_url || '')}">`;
          return `<tr data-monthly-round-id="${esc(row.id)}" ${draft ? 'data-monthly-dirty' : ''} ${errors.has(row) ? 'data-monthly-row-error' : ''}>
            <th scope="row">${row.round_no}회차</th>
            <td>${targetMonthFields(values.target_month, prefix)}</td>
            <td>${label('계획일자', planned)}</td><td>${label('점검일자', inspected)}</td>
            <td>${label('월점검원', inspectorSelect(values, inspectors, false))}</td>
            <td>${label('차량번호', vehicle)}</td>
            <td class="monthlyInlineReportCell"><details ${openReports.has(String(row.id)) || reportFields.some(name => Object.hasOwn(draft?.patch || {}, name)) ? 'open' : ''}>
              <summary></summary>
              <p class="monthlyReportDateHint">점검일자를 입력하면 보고서를 기록할 수 있습니다.</p>
              <fieldset aria-label="${prefix}보고서 입력">
                ${label('작성일자', dateControl('report_written_on', values.report_written_on))}
                ${label('제출일자', dateControl('report_submitted_on', values.report_submitted_on))}
                ${label('제출처', recipient)}${label('보고서 링크', url)}
                <span data-monthly-report-link></span>
              </fieldset>
            </details></td>
          </tr>`;
        }).join('') || `<tr><td colspan="${headers.length}">해당 회차가 없습니다.</td></tr>`;
        visible.forEach((row, index) => {
          const tr = tbody.rows[index];
          const fields = Object.fromEntries([...tr.querySelectorAll('input,select')].map(field => [field.name, field]));
          const report = tr.querySelector('fieldset');
          const reportHint = tr.querySelector('.monthlyReportDateHint');
          const syncReport = () => {
            report.disabled = !canEnterReport(fields);
            reportHint.hidden = !report.disabled;
            syncSubmissionDate(fields);
          };
          bindReportDates(fields, syncReport);
          paintReport(tr, row);
          const updateDraft = () => {
            if (saving) return;
            const values = roundValues(fields);
            const patch = Object.fromEntries(Object.entries(values).filter(([name, value]) => value !== (row[name]?.trim() || null)));
            const invalid = Object.values(fields).find(field => field.willValidate &&
              (field.validity.badInput || (Object.hasOwn(patch, field.name) && !field.validity.valid)));
            if (Object.keys(patch).length || invalid) drafts.set(row, { patch, invalid: invalid?.name });
            else drafts.delete(row);
            errors.delete(row);
            tr.toggleAttribute('data-monthly-dirty', drafts.has(row));
            tr.removeAttribute('data-monthly-row-error');
            renderMessages();
          };
          tr.addEventListener('input', updateDraft);
          tr.addEventListener('change', updateDraft);
        });
        pagination.hidden = rounds.length <= roundsPerPage;
        previous.disabled = page === 0;
        next.disabled = first + roundsPerPage >= rounds.length;
        pagination.querySelector('span').textContent = `${page + 1} / ${Math.ceil(rounds.length / roundsPerPage)} 페이지`;
      }

      function focusRound(row, fieldName) {
        const targetPage = Math.floor(rounds.indexOf(row) / roundsPerPage);
        if (targetPage !== page) {
          page = targetPage;
          renderPage();
        }
        const tr = tbody.querySelector(`[data-monthly-round-id="${CSS.escape(String(row.id))}"]`);
        const field = tr?.querySelector(`[name="${fieldName}"]`);
        const details = field?.closest('details');
        if (details) details.open = true;
        field?.focus();
      }

      function movePage(direction) {
        page += direction;
        renderPage();
        tableWrap.scrollTop = 0;
      }
      previous.onclick = () => movePage(-1);
      next.onclick = () => movePage(1);
      renderPage();
      form.onsubmit = async event => {
        event.preventDefault();
        if (saving || !drafts.size || !form.isConnected || !canEdit()) return;
        const invalid = [...drafts].find(([, draft]) => draft.invalid);
        const unassigned = [...drafts].find(([row, draft]) => missingInspector(row, { ...row, ...draft.patch }));
        if (invalid || unassigned) {
          const [row, draft] = invalid || unassigned;
          focusRound(row, draft.invalid || 'inspector_id');
          status(message, `${row.round_no}회차 · ${invalid ? '날짜 또는 보고서 링크 입력을 확인하세요.' : '월점검원을 선택하세요.'}`, true);
          return;
        }

        saving = true;
        errors.clear();
        renderMessages();
        status(message, '변경한 회차를 저장하는 중…');
        tableWrap.inert = true;
        pagination.inert = true;
        form.setAttribute('aria-busy', 'true');
        let savedCount = 0;
        try {
          for (const [row, draft] of [...drafts]) {
            if (!form.isConnected || !canEdit()) break;
            try {
              const saved = await saveRound(row, draft.patch);
              Object.assign(row, saved);
              drafts.delete(row);
              savedCount++;
            } catch (error) {
              errors.set(row, errorMessage(error));
            }
          }
          if (savedCount) await Promise.allSettled([refreshAfterSave(), onSaved?.()]);
        } finally {
          tableWrap.inert = false;
          pagination.inert = false;
          form.removeAttribute('aria-busy');
          saving = false;
          if (form.isConnected) {
            summaryCount.textContent = `점검횟수/계약횟수 ${count(rounds.filter(row => row.inspected_on).length)} / ${count(contract.inspection_count)}회`;
            for (const tr of tbody.querySelectorAll('tr[data-monthly-round-id]')) {
              const row = rounds[(page * roundsPerPage) + tr.sectionRowIndex];
              tr.toggleAttribute('data-monthly-dirty', drafts.has(row));
              tr.toggleAttribute('data-monthly-row-error', errors.has(row));
              paintReport(tr, row);
            }
            renderMessages();
            if (errors.size) status(message, `저장 완료 ${savedCount}건 · 저장 실패 ${errors.size}건`, true);
            else if (savedCount) status(message, `월점검 회차 ${savedCount}건을 저장했습니다.`);
          }
        }
      };
    }

    function hasUnsavedChanges(container) {
      return Boolean(container.querySelector('.monthlyInlineForm:not([aria-busy="true"]) #monthlyInlineSave:enabled'));
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
          <strong data-monthly-completed>점검횟수/계약횟수 ${count(rounds.filter(row => row.inspected_on).length)} / ${count(contract.inspection_count)}회</strong></div>`;
        if (canEdit()) await renderInlineRounds(content, contract, rounds, canEdit, onSaved);
        else content.append(table(rounds, { showProgress: true, editable: false, open: row => openRound(row, { readOnly: true }) }));
      } catch (error) {
        if (content.isConnected) status(content.querySelector('[role="status"]') || content, errorMessage(error), true);
      }
    }

    function openCalendarRegistration(date) {
      if (!deps.canEdit()) return;
      const { element, body } = dialog('월점검 일정 등록');
      body.innerHTML = `<form class="monthlySearchForm" data-enter-native><label>현장명 또는 S/N<input type="search" name="query" maxlength="100" required></label>
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
            <div class="monthlyChooseRound" data-enter-next><label>월점검 회차<select>${rounds.map(row =>
              `<option value="${row.id}" ${row.id === first?.id ? 'selected' : ''}>${row.round_no}회차 · ${monthText(row.target_month)} · ${visitStatus(row)}</option>`
            ).join('')}</select></label><button type="button" class="primary" data-enter-next-action>회차 열기</button></div>`;
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
      picker.innerHTML = yearOptions(chartYear);
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

    return { init, clear, open: () => calendar.open(), loadDashboard, renderDetail, hasUnsavedChanges };
  };
})(window);
