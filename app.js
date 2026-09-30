
(() => {
  'use strict';
  const { createEditor } = window.ManuscriptStudio.editor;
  const { createPreview } = window.ManuscriptStudio.preview;
  const { ELLIPSIS_PATTERN, ELLIPSIS_TEXT, LOCAL_FONT_PREFIX, TYPESETTING_PRESETS, blocksToMarkdown, cleanText, fontStackFor, localFontName, newDocument, normalizeEllipsisText, sanitizeImported } = window.ManuscriptStudio.model;
  const { withDb, writeDocument, readLibrary, readLocalFontCache, writeLocalFontCache, moveToTrash, restoreFromTrash, deleteFromTrash, storeRecoveryPoint, migrateLegacyRecords } = window.ManuscriptStudio.storage;
  const { safeFileName, downloadBlob, buildPdf, renderPagesForExport, canvasToBlob } = window.ManuscriptStudio.output;
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024, SAVE_DELAY = 150, FONT_REFLOW_DELAY = 180, FONT_CHOICE_BATCH = 40;
  const $ = (id) => document.getElementById(id);
  const el = { title: $('document-title'), author: $('document-author'), designTheme: $('design-theme'), showCover: $('show-cover'), showToc: $('show-toc'), preview: $('book-preview'), list: $('document-list'), undoDelete: $('undo-delete-button'), toggleTrash: $('toggle-trash-button'), trashList: $('trash-list'), trashCount: $('trash-count'), status: $('save-status'), stats: $('document-stats'), file: $('import-file'), preset: $('typesetting-preset'), presetDescription: $('typesetting-preset-description'), fontSize: $('font-size'), lineHeight: $('line-height'), fontFamily: $('font-family'), fontPicker: $('font-picker'), fontButton: $('font-family-button'), fontPanel: $('font-family-panel'), fontSearch: $('font-family-search'), fontOptions: $('font-family-options'), loadLocalFonts: $('load-local-fonts'), localFontStatus: $('local-font-status'), paperSize: $('paper-size'), marginHorizontal: $('margin-horizontal'), marginVertical: $('margin-vertical'), findDialog: $('find-dialog'), findQuery: $('find-query'), replaceQuery: $('replace-query'), findCase: $('find-case-sensitive'), findRegex: $('find-regex'), findStatus: $('find-status') };
  let doc, timer, fontReflowTimer, isComposing = false, isReflowing = false, runningControlDirty = false, undoStack = [], redoStack = [], lastSnapshot = '', savedDocuments = [], trashDocuments = [], lastDeleted = null, findIndex = -1, lastFindKey = '', findOpener = null, exportErrorOpener = null, localFontsLoaded = false, fontChoiceMatches = [], renderedFontChoices = 0;
  function readEditableText(node) { let text = '', hasBlockChild = false; node.childNodes.forEach(child => { if (child.nodeType === Node.TEXT_NODE) text += child.data; else if (child.nodeType === Node.ELEMENT_NODE) { if (child.hasAttribute('data-empty-line-caret')) text += child.textContent.replace('\u200b', ''); else if (child.tagName === 'BR') text += '\n'; else { const isBlock = /^(DIV|P|H1|H2|BLOCKQUOTE)$/.test(child.tagName); if (isBlock && hasBlockChild && !text.endsWith('\n')) text += '\n'; text += readEditableText(child); if (isBlock) hasBlockChild = true; } } }); return text; }
  function snapshot() { return JSON.stringify(doc); }
  function captureHistory() { const next = snapshot(); if (next !== lastSnapshot) { undoStack.push(lastSnapshot); if (undoStack.length > 100) undoStack.shift(); redoStack = []; lastSnapshot = next; updateUndoButtons(); } }
  function updateUndoButtons() { /* 실행 취소/다시 실행은 단축키로만 제공합니다. */ }
  function matchingPresetId() { return Object.entries(TYPESETTING_PRESETS).find(([, preset]) => Object.entries(preset).filter(([key]) => key !== 'label' && key !== 'description').every(([key, value]) => doc.typesetting[key] === value))?.[0] || 'custom'; }
  function syncPresetControl() { const id = matchingPresetId(), preset = TYPESETTING_PRESETS[id]; el.preset.value = id; el.presetDescription.textContent = preset ? `${preset.description}. 필요하면 아래 항목을 개별 조절할 수 있습니다.` : '직접 조절한 설정입니다. 자주 쓰는 값으로 되돌리려면 위 프리셋을 선택하세요.'; }
  function renderFontChoices() {
    const query = el.fontSearch.value.trim().toLocaleLowerCase();
    fontChoiceMatches = [...el.fontFamily.options].filter(option => option.textContent.toLocaleLowerCase().includes(query));
    renderedFontChoices = 0;
    el.fontOptions.replaceChildren();
    el.fontOptions.scrollTop = 0;
    if (!fontChoiceMatches.length) {
      const empty = document.createElement('p');
      empty.className = 'font-picker-empty';
      empty.textContent = '일치하는 글꼴이 없습니다.';
      el.fontOptions.append(empty);
      return;
    }
    appendFontChoices();
  }
  function appendFontChoices() {
    if (renderedFontChoices >= fontChoiceMatches.length) return;
    const fragment = document.createDocumentFragment();
    const next = Math.min(renderedFontChoices + FONT_CHOICE_BATCH, fontChoiceMatches.length);
    for (const option of fontChoiceMatches.slice(renderedFontChoices, next)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'font-choice';
      button.style.fontFamily = fontStackFor(option.value);
      button.setAttribute('aria-pressed', String(option.value === el.fontFamily.value));
      const name = document.createElement('span');
      name.textContent = option.textContent;
      const sample = document.createElement('small');
      sample.textContent = '가나다 ABC 123';
      button.append(name, sample);
      button.addEventListener('click', () => {
        el.fontFamily.value = option.value;
        closeFontPicker();
        updateFontPicker();
        el.fontButton.focus();
        el.fontFamily.dispatchEvent(new Event('input', { bubbles: true }));
      });
      fragment.append(button);
    }
    el.fontOptions.append(fragment);
    renderedFontChoices = next;
  }
  function updateFontPicker() {
    const selected = [...el.fontFamily.options].find(option => option.value === el.fontFamily.value);
    el.fontButton.textContent = selected?.textContent || '본문 글꼴 선택';
    el.fontButton.style.fontFamily = fontStackFor(el.fontFamily.value);
    if (!el.fontPanel.hidden) renderFontChoices();
  }
  function closeFontPicker() { el.fontPanel.hidden = true; el.fontButton.setAttribute('aria-expanded', 'false'); }
  function bindFontPicker() {
    el.fontButton.addEventListener('click', () => {
      if (!el.fontPanel.hidden) { closeFontPicker(); return; }
      el.fontSearch.value = '';
      renderFontChoices();
      el.fontPanel.hidden = false;
      el.fontButton.setAttribute('aria-expanded', 'true');
      el.fontSearch.focus();
    });
    el.fontSearch.addEventListener('input', renderFontChoices);
    el.fontOptions.addEventListener('scroll', () => {
      if (el.fontOptions.scrollTop + el.fontOptions.clientHeight >= el.fontOptions.scrollHeight - 80) appendFontChoices();
    });
    el.fontPicker.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !el.fontPanel.hidden) { event.preventDefault(); closeFontPicker(); el.fontButton.focus(); return; }
      if (el.fontPanel.hidden || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      let choices = [...el.fontOptions.querySelectorAll('.font-choice')];
      if (!choices.length) return;
      const index = choices.indexOf(document.activeElement);
      if (index < 0 && event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (event.key === 'ArrowDown' && index === choices.length - 1) {
        appendFontChoices();
        choices = [...el.fontOptions.querySelectorAll('.font-choice')];
      }
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : event.key === 'ArrowUp' ? Math.max(0, index - 1) : Math.min(choices.length - 1, index + 1);
      choices[next].focus();
    });
    el.fontPicker.addEventListener('focusout', event => { if (!el.fontPicker.contains(event.relatedTarget)) closeFontPicker(); });
    document.addEventListener('pointerdown', event => { if (!el.fontPicker.contains(event.target)) closeFontPicker(); });
  }
  function syncFontControl() {
    el.fontFamily.querySelector('[data-document-font]')?.remove();
    const value = doc.typesetting.fontFamily;
    if (![...el.fontFamily.options].some(option => option.value === value)) {
      const option = document.createElement('option');
      const name = localFontName(value);
      option.value = value;
      option.textContent = name ? `${name} (${localFontsLoaded ? '이 기기에서 확인되지 않음' : '설치 여부 확인 전'})` : `이전 글꼴 설정: ${value}`;
      option.dataset.documentFont = '';
      el.fontFamily.append(option);
    }
    el.fontFamily.value = value;
    updateFontPicker();
  }
  function showLocalFontNames(names) {
    el.fontFamily.querySelector('[data-installed-fonts]')?.remove();
    if (names.length) {
      const group = document.createElement('optgroup');
      group.label = '이 기기에 설치된 글꼴';
      group.dataset.installedFonts = '';
      for (const name of names) {
        const option = document.createElement('option');
        option.value = LOCAL_FONT_PREFIX + name;
        option.textContent = name;
        group.append(option);
      }
      el.fontFamily.append(group);
    }
    localFontsLoaded = true;
    el.loadLocalFonts.textContent = '설치 글꼴 목록 새로고침';
    syncFontControl();
  }
  async function restoreLocalFonts() {
    try {
      const cached = await withDb(readLocalFontCache);
      if (!cached || !Array.isArray(cached.families) || cached.families.length > 10000) return;
      const names = [...new Set(cached.families.filter(name => typeof name === 'string' && localFontName(LOCAL_FONT_PREFIX + name)))];
      showLocalFontNames(names);
      el.localFontStatus.textContent = names.length ? `이 브라우저에 저장된 설치 글꼴 ${names.length}개를 불러왔습니다. 목록을 갱신하려면 버튼을 누르세요.` : '이 브라우저에 저장된 설치 글꼴이 없습니다. 목록을 갱신하려면 버튼을 누르세요.';
    } catch (_) {
      el.localFontStatus.textContent = '저장된 글꼴 목록을 읽지 못했습니다. 필요하면 설치 글꼴을 다시 불러오세요.';
    }
  }
  async function loadLocalFonts() {
    if (!window.isSecureContext || typeof window.queryLocalFonts !== 'function') {
      el.localFontStatus.textContent = '이 브라우저 또는 연결에서는 설치 글꼴 목록을 읽을 수 없습니다. 기본 글꼴은 계속 사용할 수 있습니다.';
      return;
    }
    el.loadLocalFonts.disabled = true;
    el.localFontStatus.textContent = '설치 글꼴 목록을 읽는 중입니다…';
    try {
      const fonts = await window.queryLocalFonts();
      const names = [...new Set(fonts.map(font => font.family).filter(name => typeof name === 'string' && localFontName(LOCAL_FONT_PREFIX + name)))].sort((a, b) => a.localeCompare(b, 'ko'));
      showLocalFontNames(names);
      try {
        await withDb(db => writeLocalFontCache(db, names));
        el.localFontStatus.textContent = names.length ? `설치 글꼴 ${names.length}개를 이 브라우저에 저장했습니다. 다음 방문부터 자동으로 표시됩니다.` : '설치 글꼴이 없습니다. 빈 목록을 이 브라우저에 저장했습니다.';
      } catch (_) {
        el.localFontStatus.textContent = `설치 글꼴 ${names.length}개를 불러왔지만 저장하지 못했습니다. 다음 방문에는 다시 불러와야 합니다.`;
      }
    } catch (error) {
      el.localFontStatus.textContent = error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? '글꼴 접근 권한이 허용되지 않았습니다. 브라우저 권한을 확인하거나 기본 글꼴을 사용하세요.' : '설치 글꼴을 읽지 못했습니다. 다시 시도하거나 기본 글꼴을 사용하세요.';
    } finally {
      el.loadLocalFonts.disabled = false;
    }
  }
  const { renderPreview: drawPreview, paginatePreview, updateToc, decorateRunningMatter, blockElement, isEmptyManuscript } = createPreview({ getDocument: () => doc, preview: el.preview, paperDescription: $('paper-description'), readEditableText, isReflowing: () => isReflowing });
  function renderPreview() { clearTimeout(fontReflowTimer); fontReflowTimer = null; drawPreview(); }
  function flushFontReflow() { if (!fontReflowTimer) return; renderPreview(); }
  function scheduleFontReflow() {
    const stack = fontStackFor(doc.typesetting.fontFamily);
    el.preview.querySelectorAll('.book-page').forEach(page => { page.style.fontFamily = stack; });
    clearTimeout(fontReflowTimer);
    fontReflowTimer = setTimeout(flushFontReflow, FONT_REFLOW_DELAY);
  }
  const { captureCaret, setCaret, focusClickedEmptyBlock, scrollToCaretPage, syncEditablePreview, splitCurrentBlock, splitEditableBlock, selectAllManuscript, deleteEntireManuscriptOnKeydown, applyMarkdownShortcut, normalizeEditableEllipses, pasteManuscriptText } = createEditor({ getDocument: () => doc, preview: el.preview, readEditableText, getIsComposing: () => isComposing, setReflowing: value => { isReflowing = value; }, renderPreview, paginatePreview, updateToc, blockElement, isEmptyManuscript, captureHistory, updateStats, scheduleSave });
  function render() { runningControlDirty = false; el.title.value = doc.meta.title; el.author.value = doc.meta.author; el.designTheme.value = doc.typesetting.designTheme; el.showCover.checked = doc.typesetting.showCover; el.showToc.checked = doc.typesetting.showToc; el.fontSize.value = doc.typesetting.fontSizePt; el.lineHeight.value = doc.typesetting.lineHeight; syncFontControl(); el.paperSize.value = doc.typesetting.paperSize; el.marginHorizontal.value = doc.typesetting.marginHorizontalMm; el.marginVertical.value = doc.typesetting.marginVerticalMm; $('font-size-value').value = `${doc.typesetting.fontSizePt}pt`; $('line-height-value').value = doc.typesetting.lineHeight; $('margin-horizontal-value').value = `${doc.typesetting.marginHorizontalMm}mm`; $('margin-vertical-value').value = `${doc.typesetting.marginVerticalMm}mm`; for (const side of ['header', 'footer']) { const setting = doc.typesetting[side]; for (const [field, key] of [['text', 'text'], ['align', 'align'], ['rule', 'rule'], ['width', 'ruleWidth']]) $(`running-${side}-${field}`).value = setting[key]; $(`running-${side}-width-value`).value = `${setting.ruleWidth}px`; } syncPresetControl(); renderPreview(); renderDocumentList(); renderDeleteUndo(); renderTrash(); updateStats(); }
  function renderDocumentList() { el.list.replaceChildren(); const records = [...savedDocuments].sort((a, b) => String(b.meta?.updatedAt).localeCompare(String(a.meta?.updatedAt))); if (!records.length) { const empty = document.createElement('p'); empty.className = 'empty-library'; empty.textContent = '저장된 원고가 아직 없습니다.'; el.list.append(empty); return; } records.forEach(record => { const entry = document.createElement('div'); entry.className = 'document-entry'; const button = document.createElement('button'); button.type = 'button'; button.className = 'document-item'; button.dataset.documentId = record.id; button.setAttribute('aria-current', String(record.id === doc.id)); const name = document.createElement('strong'); name.textContent = record.meta?.title?.trim() || '제목 없는 원고'; const date = document.createElement('span'); date.textContent = new Date(record.meta?.updatedAt).toLocaleDateString('ko-KR'); button.append(name, date); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'document-delete'; remove.dataset.deleteDocumentId = record.id; remove.setAttribute('aria-label', `${name.textContent} 삭제`); remove.title = '휴지통으로 이동'; remove.textContent = '삭제'; entry.append(button, remove); el.list.append(entry); }); }
  function renderDeleteUndo() { el.undoDelete.hidden = !lastDeleted; }
  function renderTrash() { el.trashCount.textContent = String(trashDocuments.length); el.trashList.replaceChildren(); const records = [...trashDocuments].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))); if (!records.length) { const empty = document.createElement('p'); empty.className = 'empty-library'; empty.textContent = '휴지통이 비어 있습니다.'; el.trashList.append(empty); return; } records.forEach(record => { const entry = document.createElement('div'); entry.className = 'trash-entry'; const name = document.createElement('span'); name.textContent = record.meta?.title?.trim() || '제목 없는 원고'; const actions = document.createElement('div'); actions.className = 'trash-actions'; const restore = document.createElement('button'); restore.type = 'button'; restore.dataset.restoreDocumentId = record.id; restore.textContent = '복원'; restore.setAttribute('aria-label', `${name.textContent} 복원`); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'trash-delete'; remove.dataset.permanentDeleteId = record.id; remove.textContent = '영구 삭제'; remove.setAttribute('aria-label', `${name.textContent} 영구 삭제`); actions.append(restore, remove); entry.append(name, actions); el.trashList.append(entry); }); }
  function updateStats() { const text = doc.document.blocks.map(b => b.text).join(' '); const chars = [...text.replace(/\s/g, '')].length, words = text.trim() ? text.trim().split(/\s+/).length : 0; el.stats.textContent = `글자 ${chars.toLocaleString()}자 · 단어 ${words.toLocaleString()}개 · 블록 ${doc.document.blocks.length}개`; }
  function scheduleSave(delay = SAVE_DELAY) { clearTimeout(timer); el.status.textContent = '저장 예정'; timer = setTimeout(() => { timer = null; save(); }, delay); }
  function flushPendingSave() { if (timer) { clearTimeout(timer); timer = null; } if (!isComposing) save(); }
  async function createRecoveryPoint(reason) { try { await withDb(db => storeRecoveryPoint(db, JSON.parse(snapshot()), reason)); return true; } catch (_) { el.status.textContent = '복구 지점을 만들지 못했습니다 — 변경하지 않았습니다'; return false; } }
  async function save() { if (isComposing) return false; const record = JSON.parse(snapshot()); record.meta.updatedAt = new Date().toISOString(); if (doc.id === record.id) doc.meta.updatedAt = record.meta.updatedAt; try { await withDb(db => writeDocument(db, record)); savedDocuments = savedDocuments.filter(item => item.id !== record.id); savedDocuments.push(record); renderDocumentList(); if (doc.id === record.id) el.status.textContent = `저장됨 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`; return true; } catch (_) { if (doc.id === record.id) el.status.textContent = '저장 실패 — JSON으로 백업하세요'; return false; } }
  async function restore() { try { const records = await withDb(async db => { const result = await readLibrary(db); result.documents = await migrateLegacyRecords(db, result.documents); return result; }); savedDocuments = records.documents.flatMap(record => { try { return [sanitizeImported(record)]; } catch (_) { return []; } }); trashDocuments = records.trash.filter(record => record && typeof record === 'object' && typeof record.id === 'string'); lastDeleted = [...trashDocuments].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))[0] || null; const latest = savedDocuments.sort((a, b) => String(b.meta?.updatedAt).localeCompare(String(a.meta?.updatedAt)))[0]; if (latest) doc = latest; } catch (_) { el.status.textContent = '로컬 저장소 또는 원고 이전 버전을 불러올 수 없음'; } }
  async function deleteDocument(id) { const record = savedDocuments.find(item => item.id === id); if (!record || !confirm(`“${record.meta.title || '제목 없는 원고'}”을(를) 휴지통으로 옮길까요? 삭제 후 되돌릴 수 있습니다.`)) return; try { const deleted = { ...record, deletedAt: new Date().toISOString() }; await withDb(db => moveToTrash(db, deleted)); savedDocuments = savedDocuments.filter(item => item.id !== id); trashDocuments = trashDocuments.filter(item => item.id !== id); trashDocuments.push(deleted); lastDeleted = deleted; if (doc.id === id) { doc = savedDocuments.sort((a, b) => String(b.meta.updatedAt).localeCompare(String(a.meta.updatedAt)))[0] || newDocument(); undoStack = []; redoStack = []; lastSnapshot = snapshot(); render(); updateUndoButtons(); } else { renderDocumentList(); renderTrash(); } renderDeleteUndo(); el.status.textContent = '휴지통으로 이동됨 — 되돌릴 수 있습니다'; } catch (_) { el.status.textContent = '삭제하지 못했습니다'; } }
  async function restoreDeleted(id = lastDeleted?.id) { const deleted = trashDocuments.find(item => item.id === id); if (!deleted) return; try { const restored = sanitizeImported(deleted); await withDb(db => restoreFromTrash(db, deleted, restored)); savedDocuments = savedDocuments.filter(item => item.id !== restored.id); savedDocuments.push(restored); trashDocuments = trashDocuments.filter(item => item.id !== restored.id); lastDeleted = [...trashDocuments].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))[0] || null; renderDocumentList(); renderDeleteUndo(); renderTrash(); el.status.textContent = '삭제한 원고를 복원했습니다'; } catch (_) { el.status.textContent = '원고를 복원하지 못했습니다'; } }
  async function permanentlyDelete(id) { const deleted = trashDocuments.find(item => item.id === id); if (!deleted || !confirm(`“${deleted.meta?.title || '제목 없는 원고'}”을(를) 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return; try { await withDb(db => deleteFromTrash(db, id)); trashDocuments = trashDocuments.filter(item => item.id !== id); lastDeleted = [...trashDocuments].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))[0] || null; renderDeleteUndo(); renderTrash(); el.status.textContent = '원고를 영구 삭제했습니다'; } catch (_) { el.status.textContent = '원고를 영구 삭제하지 못했습니다'; } }
  function setHistory(direction) { if (runningControlDirty) { captureHistory(); runningControlDirty = false; } const from = direction === 'undo' ? undoStack : redoStack, to = direction === 'undo' ? redoStack : undoStack; if (!from.length || isComposing) return; to.push(snapshot()); doc = JSON.parse(from.pop()); lastSnapshot = snapshot(); render(); updateUndoButtons(); scheduleSave(); }
  function download() { downloadBlob(JSON.stringify(doc, null, 2), 'application/json', 'json', safeFileName(doc.meta.title)); }
  function downloadMarkdown() { try { downloadBlob(blocksToMarkdown(doc.document.blocks), 'text/markdown;charset=utf-8', 'md', safeFileName(doc.meta.title)); el.status.textContent = 'Markdown 파일을 저장했습니다'; } catch (error) { showExportError('MD', error, $('markdown-button')); } }
  function showExportError(format, error, opener) { const dialog = $('export-error-dialog'), message = error instanceof Error ? error.message : String(error || '알 수 없는 오류'), copyButton = $('copy-export-error-button'); el.status.textContent = `${format} 내보내기에 실패했습니다. 오류 창에서 내용을 확인하세요`; if (typeof dialog.showModal !== 'function') return; exportErrorOpener = opener; $('export-error-heading').textContent = `${format} 내보내기에 실패했습니다`; $('export-error-message').value = message; $('export-error-copy-status').textContent = ''; copyButton.onclick = copyExportError; dialog.addEventListener('close', () => { exportErrorOpener?.focus(); exportErrorOpener = null; }, { once: true }); dialog.showModal(); copyButton.focus(); }
  async function copyExportError() { const message = $('export-error-message'), status = $('export-error-copy-status'); message.focus(); message.select(); message.setSelectionRange(0, message.value.length); try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(message.value); else if (!document.execCommand('copy')) throw new Error('복사 명령을 실행하지 못했습니다'); status.textContent = '오류 내용을 클립보드에 복사했습니다.'; } catch (_) { status.textContent = '자동 복사에 실패했습니다. 오류 내용을 선택해 직접 복사하세요.'; } }
  async function downloadPdf() { const button = $('print-button'); button.disabled = true; el.status.textContent = 'PDF를 만드는 중입니다'; try { flushFontReflow(); const canvases = await renderPagesForExport(el.preview); downloadBlob(buildPdf(canvases, doc.typesetting.paperSize), 'application/pdf', 'pdf', safeFileName(doc.meta.title)); el.status.textContent = `${canvases.length}페이지 PDF 파일을 저장했습니다`; } catch (error) { console.error('PDF export failed:', error); showExportError('PDF', error, button); } finally { button.disabled = false; } }
  async function downloadPng() { const button = $('png-button'); button.disabled = true; el.status.textContent = '페이지별 PNG를 만드는 중입니다'; try { flushFontReflow(); const canvases = await renderPagesForExport(el.preview), digits = String(canvases.length).length; for (let index = 0; index < canvases.length; index += 1) { const blob = await canvasToBlob(canvases[index]); downloadBlob(blob, 'image/png', 'png', `${safeFileName(doc.meta.title)}-${String(index + 1).padStart(digits, '0')}`); } el.status.textContent = `${canvases.length}개의 페이지별 PNG 파일을 저장했습니다`; } catch (error) { console.error('PNG export failed:', error); showExportError('PNG', error, button); } finally { button.disabled = false; } }
  async function importFile(file) { const allowedType = !file?.type || ['application/json', 'text/json'].includes(file.type); if (!file || file.size > MAX_IMPORT_BYTES || !/\.json$/i.test(file.name) || !allowedType) { el.status.textContent = '5MB 이하의 JSON 파일만 가져올 수 있습니다'; return; } try { const imported = sanitizeImported(JSON.parse(await file.text())); if (savedDocuments.some(record => record.id === imported.id && record.id !== doc.id)) imported.id = newDocument().id; if (!await createRecoveryPoint('JSON 가져오기 전')) return; undoStack.push(snapshot()); redoStack = []; doc = imported; lastSnapshot = snapshot(); render(); updateUndoButtons(); if (await save()) el.status.textContent = '가져오기 완료'; } catch (error) { el.status.textContent = `가져오기 실패: ${error.message}`; } }
  function searchOptions() { const query = el.findQuery.value; if (!query) throw new Error('찾을 내용을 입력하세요.'); const source = el.findRegex.checked ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const flags = el.findCase.checked ? 'g' : 'gi'; let emptyMatch; try { emptyMatch = new RegExp(source, flags.replace('g', '')); } catch (_) { throw new Error('정규식 문법을 확인하세요.'); } if (emptyMatch.test('')) throw new Error('빈 문자열과 일치하는 검색어는 사용할 수 없습니다.'); return { query, source, flags, key: `${source}/${flags}` }; }
  function findMatches(options) { const matches = []; doc.document.blocks.forEach((block, blockIndex) => { const regex = new RegExp(options.source, options.flags); let match; while ((match = regex.exec(block.text))) matches.push({ blockIndex, start: match.index, end: match.index + match[0].length }); }); return matches; }
  function setFindStatus(message, error = false) { el.findStatus.textContent = message; el.findStatus.dataset.error = String(error); }
  function textRangeAt(node, start, end) { const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let current, offset = 0, startNode, endNode, startOffset, endOffset; while ((current = walker.nextNode())) { const next = offset + current.nodeValue.length; if (!startNode && start >= offset && start <= next) { startNode = current; startOffset = start - offset; } if (end >= offset && end <= next) { endNode = current; endOffset = end - offset; break; } offset = next; } if (!startNode || !endNode) return false; const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); node.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return true; }
  function moveFind(step) { try { const options = searchOptions(), matches = findMatches(options); if (options.key !== lastFindKey) { findIndex = step < 0 ? 0 : -1; lastFindKey = options.key; } if (!matches.length) { setFindStatus('일치하는 내용이 없습니다.'); return; } findIndex = (findIndex + step + matches.length) % matches.length; const match = matches[findIndex], nodes = [...el.preview.querySelectorAll('.manuscript-page > [data-block]')].filter(node => !node.dataset.static); if (!textRangeAt(nodes[match.blockIndex], match.start, match.end)) throw new Error('찾은 위치를 표시하지 못했습니다.'); setFindStatus(`${matches.length}개 중 ${findIndex + 1}번째 일치`); } catch (error) { setFindStatus(error.message, true); } }
  function refreshFindCount() { try { const options = searchOptions(), count = findMatches(options).length; lastFindKey = ''; findIndex = -1; setFindStatus(count ? `${count}개 일치` : '일치하는 내용이 없습니다.'); } catch (error) { setFindStatus(error.message, Boolean(el.findQuery.value)); } }
  async function replaceAll() { let options, matches; try { options = searchOptions(); matches = findMatches(options); } catch (error) { setFindStatus(error.message, true); return; } if (!matches.length) { setFindStatus('바꿀 일치 항목이 없습니다.'); return; } if (!confirm(`${matches.length}개 항목을 모두 바꿀까요? 실행 취소할 수 있습니다.`) || !await createRecoveryPoint('전체 바꾸기 전')) return; const replacement = el.replaceQuery.value; doc.document.blocks = doc.document.blocks.map(block => ({ ...block, text: block.text.replace(new RegExp(options.source, options.flags), replacement) })); doc.document.markdown = blocksToMarkdown(doc.document.blocks); captureHistory(); render(); scheduleSave(); refreshFindCount(); setFindStatus(`${matches.length}개 항목을 바꿨습니다.`); }
  async function normalizeEllipsis() { const count = doc.document.blocks.reduce((total, block) => total + (block.text.match(ELLIPSIS_PATTERN) || []).length, 0); if (!count) { setFindStatus('정리할 말줄임표가 없습니다.'); return; } if (!confirm(`${count}개의 말줄임표를 정리할까요? (... → ${ELLIPSIS_TEXT}, .... → ${ELLIPSIS_TEXT}.) 실행 취소할 수 있습니다.`) || !await createRecoveryPoint('말줄임표 정리 전')) return; doc.document.blocks = doc.document.blocks.map(block => ({ ...block, text: normalizeEllipsisText(block.text) })); doc.document.markdown = blocksToMarkdown(doc.document.blocks); captureHistory(); render(); scheduleSave(); setFindStatus(`${count}개의 말줄임표를 정리했습니다.`); }
  function openFindDialog(opener) { if (typeof el.findDialog.showModal !== 'function') { el.status.textContent = '이 브라우저에서는 찾기 창을 지원하지 않습니다'; return; } findOpener = opener; el.findDialog.showModal(); el.findQuery.focus(); refreshFindCount(); }
  function bind() { el.title.addEventListener('input', () => { doc.meta.title = cleanText(el.title.value, 200); captureHistory(); renderPreview(); scheduleSave(); }); el.preview.addEventListener('click', focusClickedEmptyBlock); el.preview.addEventListener('beforeinput', splitEditableBlock); el.preview.addEventListener('keydown', deleteEntireManuscriptOnKeydown); el.preview.addEventListener('compositionstart', () => { isComposing = true; }); el.preview.addEventListener('compositionend', () => { isComposing = false; normalizeEditableEllipses(); applyMarkdownShortcut(); syncEditablePreview(); }); el.preview.addEventListener('input', (event) => { if (!isComposing && !event.isComposing) { normalizeEditableEllipses(event.inputType === 'insertFromPaste'); applyMarkdownShortcut(); syncEditablePreview(); } }); el.preview.addEventListener('focusout', (event) => { if (!el.preview.contains(event.relatedTarget)) renderPreview(); }); el.preview.addEventListener('paste', pasteManuscriptText); el.preview.addEventListener('dragover', event => event.preventDefault()); el.preview.addEventListener('drop', event => event.preventDefault()); el.preview.addEventListener('keydown', (event) => { if (isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return; if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; const activePage = document.activeElement?.closest?.('.manuscript-page'); if (!activePage) return; const sel = getSelection(); const prevNode = sel?.anchorNode, prevOffset = sel?.anchorOffset; setTimeout(() => { const s = getSelection(); if (!s?.rangeCount || !s.isCollapsed) return; const cursorPage = (s.anchorNode?.nodeType === Node.ELEMENT_NODE ? s.anchorNode : s.anchorNode?.parentElement)?.closest?.('.manuscript-page'); if (cursorPage && cursorPage !== document.activeElement?.closest?.('.manuscript-page')) { cursorPage.focus({ preventScroll: true }); return; } if (s.anchorNode === prevNode && s.anchorOffset === prevOffset) { const pages = [...el.preview.querySelectorAll('.manuscript-page')]; const pageIndex = pages.indexOf(activePage); if ((event.key === 'ArrowDown' || event.key === 'ArrowRight') && pageIndex < pages.length - 1) { const nextPage = pages[pageIndex + 1]; const nextBlocks = [...nextPage.querySelectorAll(':scope > *')].filter(n => !n.dataset.static); if (nextBlocks.length) { setCaret(nextBlocks[0], 0); nextPage.focus({ preventScroll: true }); scrollToCaretPage(nextBlocks[0]); } } else if ((event.key === 'ArrowUp' || event.key === 'ArrowLeft') && pageIndex > 0) { const prevPage = pages[pageIndex - 1]; const prevBlocks = [...prevPage.querySelectorAll(':scope > *')].filter(n => !n.dataset.static); if (prevBlocks.length) { const last = prevBlocks[prevBlocks.length - 1]; setCaret(last, last.textContent.length); prevPage.focus({ preventScroll: true }); scrollToCaretPage(last); } } } }, 0); }); el.preset.addEventListener('change', () => { const preset = TYPESETTING_PRESETS[el.preset.value]; if (!preset) { syncPresetControl(); return; } Object.assign(doc.typesetting, Object.fromEntries(Object.entries(preset).filter(([key]) => !['label', 'description'].includes(key)))); captureHistory(); render(); scheduleSave(); el.status.textContent = `${preset.label} 프리셋 적용됨`; }); [el.fontSize, el.lineHeight, el.fontFamily, el.paperSize].forEach(input => input.addEventListener('input', () => { const key = input === el.fontSize ? 'fontSizePt' : input === el.lineHeight ? 'lineHeight' : input === el.fontFamily ? 'fontFamily' : 'paperSize'; doc.typesetting[key] = input.type === 'range' ? Number(input.value) : input.value; $('font-size-value').value = `${doc.typesetting.fontSizePt}pt`; $('line-height-value').value = doc.typesetting.lineHeight; syncPresetControl(); captureHistory(); if (input === el.fontFamily) scheduleFontReflow(); else renderPreview(); scheduleSave(); })); el.list.addEventListener('click', async event => { const remove = event.target.closest('[data-delete-document-id]'); if (remove) { await deleteDocument(remove.dataset.deleteDocumentId); return; } const button = event.target.closest('[data-document-id]'); if (!button || button.dataset.documentId === doc.id) return; if (!await save()) return; const next = savedDocuments.find(record => record.id === button.dataset.documentId); if (!next) return; doc = sanitizeImported(next); undoStack = []; redoStack = []; lastSnapshot = snapshot(); render(); updateUndoButtons(); el.status.textContent = '원고를 불러왔습니다'; }); el.toggleTrash.addEventListener('click', () => { const open = el.trashList.hidden; el.trashList.hidden = !open; el.toggleTrash.setAttribute('aria-expanded', String(open)); }); el.trashList.addEventListener('click', async event => { const remove = event.target.closest('[data-permanent-delete-id]'); if (remove) { await permanentlyDelete(remove.dataset.permanentDeleteId); return; } const restore = event.target.closest('[data-restore-document-id]'); if (restore) await restoreDeleted(restore.dataset.restoreDocumentId); }); el.undoDelete.addEventListener('click', () => restoreDeleted()); $('export-button').addEventListener('click', download); $('import-button').addEventListener('click', () => el.file.click()); el.file.addEventListener('change', () => importFile(el.file.files[0]).finally(() => { el.file.value = ''; })); el.findDialog.addEventListener('close', () => { findOpener?.focus(); findOpener = null; }); [el.findQuery, el.findCase, el.findRegex].forEach(input => input.addEventListener('input', refreshFindCount)); $('find-next-button').addEventListener('click', () => moveFind(1)); $('find-previous-button').addEventListener('click', () => moveFind(-1)); $('replace-all-button').addEventListener('click', replaceAll); $('ellipsis-button').addEventListener('click', normalizeEllipsis); $('new-document-button').addEventListener('click', async () => { if (confirm('새 원고를 시작할까요? 현재 원고는 자동 저장되어 있습니다.')) { if (!await save()) return; doc = newDocument(); redoStack = []; undoStack = []; lastSnapshot = snapshot(); await save(); render(); updateUndoButtons(); el.preview.focus(); } }); $('print-button').addEventListener('click', downloadPdf); $('png-button').addEventListener('click', downloadPng); $('markdown-button').addEventListener('click', downloadMarkdown); document.addEventListener('keydown', event => { if (!(event.ctrlKey || event.metaKey) || isComposing) return; if (event.key.toLowerCase() === 'a' && el.preview.contains(document.activeElement)) { event.preventDefault(); selectAllManuscript(); return; } if (event.key.toLowerCase() === 'f') { event.preventDefault(); if (!el.findDialog.open) openFindDialog(document.activeElement); return; } if (event.key.toLowerCase() === 'z') { event.preventDefault(); setHistory(event.shiftKey ? 'redo' : 'undo'); } else if (event.key.toLowerCase() === 'y') { event.preventDefault(); setHistory('redo'); } }); }
  function bindEnterKey() { el.preview.addEventListener('keydown', event => { if (isComposing || event.isComposing || event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return; if (splitCurrentBlock()) event.preventDefault(); }); }
  function bindDesignControls() { bindEnterKey(); const updateDesign = () => { doc.meta.author = cleanText(el.author.value, 200); doc.typesetting.designTheme = el.designTheme.value; doc.typesetting.showCover = el.showCover.checked; doc.typesetting.showToc = el.showToc.checked; captureHistory(); renderPreview(); scheduleSave(); }; [el.author, el.designTheme, el.showCover, el.showToc].forEach(input => input.addEventListener('input', updateDesign)); }
  function bindRunningControls() {
    for (const side of ['header', 'footer']) for (const [field, key] of [['text', 'text'], ['align', 'align'], ['rule', 'rule'], ['width', 'ruleWidth']]) {
      const input = $(`running-${side}-${field}`);
      const apply = () => {
        const value = field === 'width' ? Number(input.value) : field === 'text' ? cleanText(input.value, 120).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ') : input.value;
        if (doc.typesetting[side][key] === value) return;
        doc.typesetting[side][key] = value;
        if (field === 'width') $(`running-${side}-width-value`).value = `${value}px`;
        runningControlDirty = true;
        decorateRunningMatter(side);
        scheduleSave(650);
      };
      input.addEventListener('input', event => { if (!event.isComposing) apply(); });
      if (field === 'text') input.addEventListener('compositionend', apply);
      input.addEventListener('change', () => { apply(); if (runningControlDirty) { captureHistory(); runningControlDirty = false; } });
    }
  }
  function bindMarginControls() { [[el.marginHorizontal, 'marginHorizontalMm', 'margin-horizontal-value'], [el.marginVertical, 'marginVerticalMm', 'margin-vertical-value']].forEach(([input, key, output]) => input.addEventListener('input', () => { doc.typesetting[key] = Number(input.value); $(output).value = `${input.value}mm`; syncPresetControl(); captureHistory(); renderPreview(); scheduleSave(); })); }
  function arrangeControls() { const library = document.querySelector('.library-pane'), heading = library?.querySelector('.pane-heading'), meta = document.querySelector('.document-meta'), design = document.querySelector('.book-design'), toolbar = document.querySelector('.toolbar'); if (heading && meta && design) heading.after(meta, design); if (toolbar) { toolbar.before(el.status); toolbar.append($('print-button'), $('png-button'), $('markdown-button')); document.querySelector('.export-actions')?.remove(); } }
  async function init() { arrangeControls(); doc = newDocument(); await restore(); await restoreLocalFonts(); lastSnapshot = snapshot(); bindDesignControls(); bindRunningControls(); bindMarginControls(); bind(); window.addEventListener('pagehide', flushPendingSave); document.addEventListener('blur', event => { if (event.target instanceof Element && event.target.closest('.manuscript-page')) event.stopPropagation(); }, true); render(); updateUndoButtons(); if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {}); }
  el.loadLocalFonts.addEventListener('click', loadLocalFonts);
  bindFontPicker();
  init();
})();
