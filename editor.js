(() => {
  'use strict';
  const { blocksToMarkdown, cleanText, normalizeEllipsisText } = window.ManuscriptStudio.model;


function createEditor({ getDocument, preview, readEditableText, getIsComposing, setReflowing, renderPreview, paginatePreview, updateToc, blockElement, isEmptyManuscript, captureHistory, updateStats, scheduleSave }) {
  function captureCaret() { const selection = getSelection(); if (!selection?.rangeCount || !selection.isCollapsed) return null; let node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement; const block = node?.closest?.('.manuscript-page > *'); if (!block || block.dataset.static) return null; const range = selection.getRangeAt(0).cloneRange(); try { range.selectNodeContents(block); range.setEnd(selection.anchorNode, selection.anchorOffset); const blockOffset = readEditableText(range.cloneContents()).length, blocks = [...preview.querySelectorAll('.manuscript-page > *')].filter(item => !item.dataset.static); return { block, blockOffset, offset: blocks.slice(0, blocks.indexOf(block)).reduce((total, item) => total + readEditableText(item).length, 0) + blockOffset }; } catch (_) { return null; } }
  function setCaret(block, offset) { const range = document.createRange(), walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let remaining = offset, textNode; while ((textNode = walker.nextNode())) { if (remaining <= textNode.length) { range.setStart(textNode, remaining); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return true; } remaining -= textNode.length; } range.selectNodeContents(block); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return true; }
  function focusPastedBlankLine(event, page, block) {
    if (!block || !readEditableText(block).includes('\n\n')) return false;
    const bounds = block.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right) return false;
    const lineHeight = parseFloat(getComputedStyle(block).lineHeight);
    const onLine = rect => rect.height && event.clientY >= rect.top - (lineHeight - rect.height) / 2 && event.clientY <= rect.bottom + (lineHeight - rect.height) / 2;
    for (const marker of block.querySelectorAll('[data-empty-line-caret]')) {
      if (!onLine(marker.getBoundingClientRect())) continue;
      page.focus({ preventScroll: true });
      const range = document.createRange();
      range.setStart(marker.firstChild, 0);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return true;
    }
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.hasAttribute('data-empty-line-caret')) continue;
      for (let index = 1; index < node.length; index += 1) {
        if (node.data[index - 1] !== '\n' || node.data[index] !== '\n') continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        if (!onLine(range.getBoundingClientRect())) continue;
        const marker = document.createElement('span');
        marker.dataset.emptyLineCaret = '';
        marker.textContent = '\u200b';
        range.collapse(true);
        range.insertNode(marker);
        page.focus({ preventScroll: true });
        range.setStart(marker.firstChild, 0);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return true;
      }
    }
    return false;
  }
  function focusClickedEmptyBlock(event) {
    if (!(event.target instanceof Element) || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const page = event.target.closest('.manuscript-page');
    if (!page || !preview.contains(page)) return;
    let block = event.target.closest('[data-block]');
    if (block?.parentElement !== page) block = null;
    if (focusPastedBlankLine(event, page, block)) return;
    if (!block && event.target === page) {
      let closestDistance = Infinity;
      for (const candidate of page.querySelectorAll(':scope > [data-block]')) {
        if (candidate.textContent) continue;
        const rect = candidate.getBoundingClientRect();
        const previous = candidate.previousElementSibling?.getBoundingClientRect();
        const next = candidate.nextElementSibling?.getBoundingClientRect();
        const top = previous ? previous.bottom : rect.top;
        const bottom = next ? next.top : rect.bottom + parseFloat(getComputedStyle(candidate).marginBottom);
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < top || event.clientY > bottom) continue;
        const distance = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
        if (distance < closestDistance) { block = candidate; closestDistance = distance; }
      }
    }
    if (!block || block.textContent) return;
    page.focus({ preventScroll: true });
    setCaret(block, 0);
  }
  function scrollToCaretPage(block) { const page = block.closest('.manuscript-page'), pane = preview.closest('.preview-pane'); if (!page || !pane) return; const top = Math.max(0, pane.scrollTop + page.getBoundingClientRect().top - pane.getBoundingClientRect().top - Math.max(0, (pane.clientHeight - page.offsetHeight) / 2)); pane.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  function focusPageOf(block) { const page = block?.closest?.('.manuscript-page'); if (page && document.activeElement !== page) page.focus({ preventScroll: true }); }
  function restoreCaret(caret) { if (!caret) return null; if (caret.block?.isConnected && caret.blockOffset <= readEditableText(caret.block).length) { setCaret(caret.block, caret.blockOffset); focusPageOf(caret.block); return caret.block; } const blocks = [...preview.querySelectorAll('.manuscript-page > *')].filter(node => !node.dataset.static); let remaining = caret.offset; for (const block of blocks) { if (remaining > readEditableText(block).length) { remaining -= readEditableText(block).length; continue; } setCaret(block, remaining); focusPageOf(block); return block; } return null; }
  function previewHasOverflow() { return [...preview.querySelectorAll('.manuscript-page')].some(page => page.scrollHeight > page.clientHeight + 1); }
  function syncEditablePreview() { const caret = captureCaret(), pagesBefore = [...preview.querySelectorAll('.manuscript-page')], pageBefore = pagesBefore.indexOf(caret?.block?.closest('.manuscript-page')), pane = preview.closest('.preview-pane'), scrollTop = pane?.scrollTop, blocks = []; [...preview.querySelectorAll('.manuscript-page > *')].filter(node => !node.dataset.static).forEach(node => { const block = { type: node.tagName === 'H1' ? 'heading' : node.tagName === 'H2' ? 'subheading' : node.tagName === 'BLOCKQUOTE' ? 'quote' : 'paragraph', text: cleanText(readEditableText(node)) }; const previous = blocks.at(-1); if (node.dataset.flowContinuation && previous?.type === block.type) previous.text += block.text; else blocks.push(block); }); getDocument().document.blocks = blocks.length ? blocks.slice(0, 2000) : [{ type: 'paragraph', text: '' }]; getDocument().document.markdown = blocksToMarkdown(getDocument().document.blocks); preview.dataset.empty = String(isEmptyManuscript(getDocument().document.blocks)); updateToc(); setReflowing(true); paginatePreview(); const restoredBlock = restoreCaret(caret); if (pane) pane.scrollTop = scrollTop; const pageAfter = [...preview.querySelectorAll('.manuscript-page')].indexOf(restoredBlock?.closest('.manuscript-page')); if (pageBefore !== -1 && pageAfter !== -1 && pageBefore !== pageAfter) scrollToCaretPage(restoredBlock); setReflowing(false); captureHistory(); updateStats(); scheduleSave(); }
  function splitCurrentBlock() { const selection = getSelection(), block = currentEditableBlock(); if (!selection?.isCollapsed || !selection.rangeCount || !block) return false; const range = selection.getRangeAt(0).cloneRange(); try { range.selectNodeContents(block); range.setEnd(selection.anchorNode, selection.anchorOffset); } catch (_) { return false; } const text = readEditableText(block), offset = readEditableText(range.cloneContents()).length, next = blockElement({ type: 'paragraph', text: text.slice(offset) }); block.textContent = text.slice(0, offset); block.after(next); setCaret(next, 0); syncEditablePreview(); return true; }
  function splitEditableBlock(event) { if (getIsComposing() || event.getIsComposing()) return; const selection = getSelection(); if (!selection?.isCollapsed) { const anchorPage = selection.anchorNode?.parentElement?.closest('.manuscript-page'), focusPage = selection.focusNode?.parentElement?.closest('.manuscript-page'); if (anchorPage && focusPage && anchorPage !== focusPage) { if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward' || event.inputType === 'deleteByCut') { event.preventDefault(); getDocument().document.blocks = [{ type: 'paragraph', text: '' }]; getDocument().document.markdown = ''; captureHistory(); renderPreview(); updateStats(); scheduleSave(); const firstBlock = preview.querySelector('.manuscript-page > *:not([data-static])'); if (firstBlock) setCaret(firstBlock, 0); } else if (event.inputType === 'insertText') { event.preventDefault(); const text = event.data || ''; getDocument().document.blocks = [{ type: 'paragraph', text }]; getDocument().document.markdown = blocksToMarkdown(getDocument().document.blocks); captureHistory(); renderPreview(); updateStats(); scheduleSave(); const firstBlock = preview.querySelector('.manuscript-page > *:not([data-static])'); if (firstBlock) setCaret(firstBlock, text.length); } } return; } const block = currentEditableBlock(); if (!selection?.rangeCount || !block || event.inputType !== 'deleteContentBackward') return; const range = selection.getRangeAt(0).cloneRange(); try { range.selectNodeContents(block); range.setEnd(selection.anchorNode, selection.anchorOffset); } catch (_) { return; } if (range.toString().length) return; if (block.matches('h1, h2, blockquote')) { event.preventDefault(); const replacement = blockElement({ type: 'paragraph', text: '' }); block.replaceWith(replacement); setCaret(replacement, 0); syncEditablePreview(); return; } const blocks = [...preview.querySelectorAll('.manuscript-page > *')].filter(node => !node.dataset.static), index = blocks.indexOf(block), previous = blocks[index - 1]; if (!previous) { event.preventDefault(); return; } if (previous.closest('.manuscript-page') === block.closest('.manuscript-page')) return; event.preventDefault(); if (block.dataset.flowContinuation) { const text = previous.textContent; if (!text.length) return; previous.textContent = text.slice(0, -1); setCaret(previous, previous.textContent.length); } else { const caretOffset = previous.textContent.length; previous.textContent += block.textContent; block.remove(); setCaret(previous, caretOffset); } syncEditablePreview(); }
  function currentEditableBlock() { const selection = getSelection(); let node = selection?.anchorNode; if (!node) return null; node = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; let block = node?.closest?.('[data-block], p, h1, h2, blockquote, div'); if (!block && node?.matches?.('.manuscript-page')) { const children = node.children, index = Math.min(selection.anchorOffset, children.length - 1); block = children[index] || null; } return block && preview.contains(block) && !block.dataset.static ? block : null; }
  function applyMarkdownShortcut() { const selection = getSelection(), block = currentEditableBlock(); if (!block) return; const marker = block.textContent.replace(/\u00a0/g, ' '); const type = marker === '# ' ? 'heading' : marker === '## ' ? 'subheading' : marker === '> ' ? 'quote' : ''; if (!type) return; const replacement = document.createElement(type === 'heading' ? 'h1' : type === 'subheading' ? 'h2' : 'blockquote'); replacement.dataset.block = type; block.replaceWith(replacement); const range = document.createRange(); range.selectNodeContents(replacement); range.collapse(false); selection.removeAllRanges(); selection.addRange(range); }
  function normalizeEditableEllipses(allBlocks = false) {
    const caret = captureCaret();
    const blocks = allBlocks ? [...preview.querySelectorAll('.manuscript-page > [data-block]')] : caret ? [caret.block] : [];
    for (const block of blocks) {
      const value = readEditableText(block), normalized = normalizeEllipsisText(value);
      if (normalized === value) continue;
      const offset = caret?.block === block ? normalizeEllipsisText(value.slice(0, caret.blockOffset)).length : null;
      block.textContent = normalized;
      if (offset !== null) setCaret(block, offset);
    }
  }
  function pasteManuscriptText(event) {
    if (getIsComposing()) return;
    const page = event.target.closest?.('.manuscript-page');
    if (!page || page.dataset.static) return;
    event.preventDefault();
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed && range.startContainer === page) {
      const children = [...page.children];
      const next = children.slice(range.startOffset).find(node => node.dataset.block);
      const block = next || children.reverse().find(node => node.dataset.block);
      if (!block) return;
      range.selectNodeContents(block);
      range.collapse(Boolean(next));
    }
    const text = normalizeEllipsisText(event.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    normalizeEditableEllipses(true);
    applyMarkdownShortcut();
    syncEditablePreview();
  }
  return { captureCaret, setCaret, focusClickedEmptyBlock, scrollToCaretPage, syncEditablePreview, splitCurrentBlock, splitEditableBlock, applyMarkdownShortcut, normalizeEditableEllipses, pasteManuscriptText };
}

  window.ManuscriptStudio.editor = { createEditor };
})();
