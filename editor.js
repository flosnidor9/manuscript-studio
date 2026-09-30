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
      preview.focus({ preventScroll: true });
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
        preview.focus({ preventScroll: true });
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
    preview.focus({ preventScroll: true });
    setCaret(block, 0);
  }
  function scrollToCaretPage(block) { const page = block.closest('.manuscript-page'), pane = preview.closest('.preview-pane'); if (!page || !pane) return; const top = Math.max(0, pane.scrollTop + page.getBoundingClientRect().top - pane.getBoundingClientRect().top - Math.max(0, (pane.clientHeight - page.offsetHeight) / 2)); pane.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  function restoreCaret(caret) { if (!caret) return null; const blocks = [...preview.querySelectorAll('.manuscript-page > *')].filter(node => !node.dataset.static); let remaining = caret.offset; for (let index = 0; index < blocks.length; index += 1) { const block = blocks[index], length = readEditableText(block).length; if (remaining > length || (remaining === length && caret.blockOffset === 0 && index < blocks.length - 1)) { remaining -= length; continue; } preview.focus({ preventScroll: true }); setCaret(block, remaining); return block; } return null; }
  function previewHasOverflow() { return [...preview.querySelectorAll('.manuscript-page')].some(page => page.scrollHeight > page.clientHeight + 1); }
  function syncEditablePreview(event = null) {
    const caret = captureCaret();
    const editedPage = caret?.block?.closest('.manuscript-page');
    const pagesBefore = [...preview.querySelectorAll('.manuscript-page')];
    const pageBefore = pagesBefore.indexOf(editedPage);
    const pane = preview.closest('.preview-pane');
    const scrollTop = pane?.scrollTop;
    const blocks = [];
    for (const node of preview.querySelectorAll('.manuscript-page > [data-block]')) {
      const block = {
        type: node.tagName === 'H1' ? 'heading' : node.tagName === 'H2' ? 'subheading' : node.tagName === 'BLOCKQUOTE' ? 'quote' : 'paragraph',
        text: cleanText(readEditableText(node))
      };
      const previous = blocks.at(-1);
      if (node.dataset.flowContinuation && previous?.type === block.type) previous.text += block.text;
      else blocks.push(block);
    }
    const oldBlocks = getDocument().document.blocks;
    let flowDelta = 0;
    if (event && ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType) && oldBlocks.length === blocks.length) {
      const changed = blocks.map((block, index) => block.text !== oldBlocks[index].text ? index : -1).filter(index => index >= 0);
      if (changed.length === 1) {
        const index = changed[0], before = oldBlocks[index], after = blocks[index];
        const difference = after.text.length - before.text.length;
        if (before.type === after.type && ['paragraph', 'quote'].includes(after.type) && Math.abs(difference) === 1) flowDelta = difference;
      }
    }
    getDocument().document.blocks = blocks.length ? blocks.slice(0, 2000) : [{ type: 'paragraph', text: '' }];
    getDocument().document.markdown = blocksToMarkdown(getDocument().document.blocks);
    preview.dataset.empty = String(isEmptyManuscript(getDocument().document.blocks));
    setReflowing(true);
    let restoredBlock;
    try {
      paginatePreview(editedPage, flowDelta);
      restoredBlock = restoreCaret(caret);
    } finally { setReflowing(false); }
    if (pane) pane.scrollTop = scrollTop;
    const pageAfter = [...preview.querySelectorAll('.manuscript-page')].indexOf(restoredBlock?.closest('.manuscript-page'));
    if (pageBefore !== -1 && pageAfter !== -1 && pageBefore !== pageAfter) scrollToCaretPage(restoredBlock);
    captureHistory();
    updateStats();
    scheduleSave();
  }
  function splitCurrentBlock() { const selection = getSelection(), block = currentEditableBlock(); if (!selection?.isCollapsed || !selection.rangeCount || !block) return false; const range = selection.getRangeAt(0).cloneRange(); try { range.selectNodeContents(block); range.setEnd(selection.anchorNode, selection.anchorOffset); } catch (_) { return false; } const text = readEditableText(block), offset = readEditableText(range.cloneContents()).length, next = blockElement({ type: 'paragraph', text: text.slice(offset) }); block.textContent = text.slice(0, offset); block.after(next); setCaret(next, 0); syncEditablePreview(); return true; }
  function manuscriptBlocks() { return [...preview.querySelectorAll('.manuscript-page > [data-block]')]; }
  function selectAllManuscript() {
    const blocks = manuscriptBlocks();
    if (!blocks.length) return;
    const range = document.createRange();
    range.setStart(blocks[0], 0);
    range.setEnd(blocks.at(-1), blocks.at(-1).childNodes.length);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function isEntireManuscriptSelected() {
    const selection = getSelection(), blocks = manuscriptBlocks();
    if (!selection?.rangeCount || selection.isCollapsed || !blocks.length) return false;
    const whole = document.createRange();
    whole.setStart(blocks[0], 0);
    whole.setEnd(blocks.at(-1), blocks.at(-1).childNodes.length);
    const selected = selection.getRangeAt(0);
    return selected.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 && selected.compareBoundaryPoints(Range.END_TO_END, whole) >= 0;
  }
  function replaceEntireManuscript(text = '') {
    getDocument().document.blocks = [{ type: 'paragraph', text }];
    getDocument().document.markdown = blocksToMarkdown(getDocument().document.blocks);
    captureHistory();
    renderPreview();
    updateStats();
    scheduleSave();
    const firstBlock = manuscriptBlocks()[0];
    if (firstBlock) { preview.focus({ preventScroll: true }); setCaret(firstBlock, text.length); }
  }
  function selectionPoint(container, offset) {
    const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    let block = element?.closest?.('[data-block]');
    let edgeOffset = null;
    if (!block && element?.matches?.('.manuscript-page')) {
      const children = [...element.children];
      const next = children.slice(offset).find(node => node.dataset.block);
      block = next || children.slice(0, offset).reverse().find(node => node.dataset.block);
      edgeOffset = next ? 0 : block ? readEditableText(block).length : 0;
    }
    if (!block || !preview.contains(block)) return null;
    const fragments = manuscriptBlocks();
    let blockIndex = -1, blockOffset = 0;
    for (const fragment of fragments) {
      if (!fragment.dataset.flowContinuation) { blockIndex += 1; blockOffset = 0; }
      if (fragment === block) break;
      blockOffset += readEditableText(fragment).length;
    }
    if (!fragments.includes(block)) return null;
    if (edgeOffset !== null) return { blockIndex, offset: blockOffset + edgeOffset };
    const range = document.createRange();
    range.selectNodeContents(block);
    range.setEnd(container, offset);
    return { blockIndex, offset: blockOffset + readEditableText(range.cloneContents()).length };
  }
  function replaceCrossPageSelection(text) {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const start = selectionPoint(range.startContainer, range.startOffset);
    const end = selectionPoint(range.endContainer, range.endOffset);
    if (!start || !end || start.blockIndex > end.blockIndex) return false;
    const blocks = getDocument().document.blocks;
    const first = blocks[start.blockIndex], last = blocks[end.blockIndex];
    if (!first || !last) return false;
    const replacement = { type: first.type, text: cleanText(first.text.slice(0, start.offset) + text + last.text.slice(end.offset)) };
    blocks.splice(start.blockIndex, end.blockIndex - start.blockIndex + 1, replacement);
    getDocument().document.markdown = blocksToMarkdown(blocks);
    captureHistory();
    renderPreview();
    updateStats();
    scheduleSave();
    const rendered = manuscriptBlocks();
    let logicalIndex = -1;
    let remaining = start.offset + text.length;
    for (const fragment of rendered) {
      if (!fragment.dataset.flowContinuation) logicalIndex += 1;
      if (logicalIndex !== start.blockIndex) continue;
      const length = readEditableText(fragment).length;
      if (remaining > length) { remaining -= length; continue; }
      preview.focus({ preventScroll: true });
      setCaret(fragment, remaining);
      scrollToCaretPage(fragment);
      break;
    }
    return true;
  }
  function deleteEntireManuscriptOnKeydown(event) {
    if (getIsComposing() || event.isComposing || !['Backspace', 'Delete'].includes(event.key) || !isEntireManuscriptSelected()) return;
    event.preventDefault();
    replaceEntireManuscript();
  }
  function splitEditableBlock(event) {
    if (getIsComposing() || event.isComposing) return;
    if (isEntireManuscriptSelected()) {
      if (['deleteContentBackward', 'deleteContentForward', 'deleteByCut'].includes(event.inputType)) {
        event.preventDefault();
        replaceEntireManuscript();
        return;
      }
      if (event.inputType === 'insertText') {
        event.preventDefault();
        replaceEntireManuscript(event.data || '');
        return;
      }
    }
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    if (!selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
      const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
      const startPage = startElement?.closest?.('.manuscript-page');
      const endPage = endElement?.closest?.('.manuscript-page');
      if (startPage && endPage && startPage !== endPage && ['deleteContentBackward', 'deleteContentForward', 'deleteByCut', 'insertText'].includes(event.inputType)) {
        if (replaceCrossPageSelection(event.inputType === 'insertText' ? event.data || '' : '')) event.preventDefault();
      }
      return;
    }
    const block = currentEditableBlock();
    if (!block || event.inputType !== 'deleteContentBackward') return;
    const range = selection.getRangeAt(0).cloneRange();
    try { range.selectNodeContents(block); range.setEnd(selection.anchorNode, selection.anchorOffset); }
    catch (_) { return; }
    if (range.toString().length) return;
    if (block.matches('h1, h2, blockquote')) {
      event.preventDefault();
      const replacement = blockElement({ type: 'paragraph', text: '' });
      block.replaceWith(replacement);
      setCaret(replacement, 0);
      syncEditablePreview();
      return;
    }
    const blocks = [...preview.querySelectorAll('.manuscript-page > *')].filter(node => !node.dataset.static);
    const previous = blocks[blocks.indexOf(block) - 1];
    if (!previous) { event.preventDefault(); return; }
    if (previous.closest('.manuscript-page') === block.closest('.manuscript-page')) return;
    event.preventDefault();
    if (block.dataset.flowContinuation) {
      const text = previous.textContent;
      if (!text.length) return;
      previous.textContent = text.slice(0, -1);
      setCaret(previous, previous.textContent.length);
    } else {
      const caretOffset = previous.textContent.length;
      previous.textContent += block.textContent;
      block.remove();
      setCaret(previous, caretOffset);
    }
    syncEditablePreview();
  }
  function currentEditableBlock() { const selection = getSelection(); let node = selection?.anchorNode; if (!node) return null; node = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; let block = node?.closest?.('[data-block]'); if (!block && node?.matches?.('.manuscript-page')) { const children = node.children, index = Math.min(selection.anchorOffset, children.length - 1); block = children[index] || null; } return block && preview.contains(block) && !block.dataset.static ? block : null; }
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
    if (isEntireManuscriptSelected()) {
      replaceEntireManuscript(normalizeEllipsisText(event.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n'));
      return;
    }
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
    const startPage = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)?.closest?.('.manuscript-page');
    const endPage = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement)?.closest?.('.manuscript-page');
    if (!range.collapsed && startPage && endPage && startPage !== endPage && replaceCrossPageSelection(text)) return;
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    normalizeEditableEllipses(true);
    applyMarkdownShortcut();
    syncEditablePreview();
  }
  return { captureCaret, setCaret, focusClickedEmptyBlock, scrollToCaretPage, syncEditablePreview, splitCurrentBlock, splitEditableBlock, selectAllManuscript, deleteEntireManuscriptOnKeydown, applyMarkdownShortcut, normalizeEditableEllipses, pasteManuscriptText };
}

  window.ManuscriptStudio.editor = { createEditor };
})();
