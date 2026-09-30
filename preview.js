(() => {
  'use strict';
  const { fontStackFor, markdownToBlocks } = window.ManuscriptStudio.model;
  const { isHangingPunctuation, isTrailingPunctuation, canHangPunctuation } = window.ManuscriptStudio.punctuation;


function createPreview({ getDocument, preview, paperDescription, readEditableText, isReflowing }) {
  let previewDocumentId = null;
  const previewScrollPositions = new Map();
  const pageBottomCache = new WeakMap();
  function documentBlocks() { return Array.isArray(getDocument().document.blocks) && getDocument().document.blocks.length ? getDocument().document.blocks : markdownToBlocks(getDocument().document.markdown); }
  function isEmptyManuscript(blocks) { return blocks.length === 1 && blocks[0].type === 'paragraph' && blocks[0].text === ''; }
  function syncPagePadding(page) { pageBottomCache.delete(page); const size = { a5: [148, 210], a4: [210, 297], b5: [176, 250] }[getDocument().typesetting.paperSize], bounds = page.getBoundingClientRect(), margins = getDocument().typesetting; if (!bounds.width || !bounds.height) return; const vertical = bounds.height * margins.marginVerticalMm / size[1], horizontal = bounds.width * margins.marginHorizontalMm / size[0]; page.style.setProperty('--page-padding-top', `${vertical}px`); page.style.setProperty('--page-padding-right', `${horizontal}px`); page.style.setProperty('--page-padding-bottom', `${vertical}px`); page.style.setProperty('--page-padding-left', `${horizontal}px`); page.style.setProperty('--running-text-offset', `${vertical * .13}px`); page.style.setProperty('--running-line-offset', `${vertical * .72}px`); }
  function pageElement(className = 'manuscript-page') { const page = document.createElement('article'), size = { a5: [148, 210], a4: [210, 297], b5: [176, 250] }[getDocument().typesetting.paperSize], margins = getDocument().typesetting; page.className = `book-page ${className}`; page.dataset.paperSize = getDocument().typesetting.paperSize; page.dataset.theme = getDocument().typesetting.designTheme; page.style.fontSize = `${getDocument().typesetting.fontSizePt}pt`; page.style.lineHeight = getDocument().typesetting.lineHeight; page.style.fontFamily = fontStackFor(getDocument().typesetting.fontFamily); const vertical = `${margins.marginVerticalMm / size[1] * 100}%`, horizontal = `${margins.marginHorizontalMm / size[0] * 100}%`; page.style.setProperty('--page-padding-top', vertical); page.style.setProperty('--page-padding-right', horizontal); page.style.setProperty('--page-padding-bottom', vertical); page.style.setProperty('--page-padding-left', horizontal); page.style.setProperty('--print-padding-top', `${margins.marginVerticalMm}mm`); page.style.setProperty('--print-padding-right', `${margins.marginHorizontalMm}mm`); page.style.setProperty('--print-padding-bottom', `${margins.marginVerticalMm}mm`); page.style.setProperty('--print-padding-left', `${margins.marginHorizontalMm}mm`); page.style.setProperty('--print-running-text-offset', `${margins.marginVerticalMm * .13}mm`); page.style.setProperty('--print-running-line-offset', `${margins.marginVerticalMm * .72}mm`); return page; }
  function staticSection(className) { const section = pageElement(className); section.contentEditable = 'false'; section.dataset.static = 'true'; return section; }
  function blockElement(block) { const node = document.createElement(block.type === 'heading' ? 'h1' : block.type === 'subheading' ? 'h2' : block.type === 'quote' ? 'blockquote' : 'p'); node.dataset.block = block.type; node.textContent = block.text.replace(/\r\n?/g, '\n'); return node; }
  // All paper pages inherit one editing host from the preview. A page break is
  // only a layout boundary, never a second text field.
  function createManuscriptPage() { return pageElement(); }
  function decorateRunningMatter(sideFilter = null) {
    const pages = [...preview.querySelectorAll('.book-page')];
    pages.forEach((page, pageIndex) => {
      if (!page.classList.contains('manuscript-page')) return;
      for (const side of ['header', 'footer']) {
        if (sideFilter && side !== sideFilter) continue;
        const setting = getDocument().typesetting[side];
        const textClass = `running-${side}`;
        let node = page.querySelector(`:scope > .${textClass}.running-text`);
        if (setting.text) {
          if (!node) {
            node = document.createElement('div');
            node.className = `running-text ${textClass}`;
            node.dataset.static = 'true';
            node.contentEditable = 'false';
            page.append(node);
          }
          node.style.textAlign = setting.align;
          node.textContent = setting.text.replace(/\{제목\}|\{저자\}|\{쪽수\}/g, token => ({ '{제목}': getDocument().meta.title, '{저자}': getDocument().meta.author, '{쪽수}': String(pageIndex + 1) })[token]);
        } else node?.remove();
        let line = page.querySelector(`:scope > .running-${side}-rule`);
        if (setting.rule !== 'none') {
          if (!line) {
            line = document.createElement('div');
            line.className = `running-rule running-${side}-rule`;
            line.dataset.static = 'true';
            line.contentEditable = 'false';
            page.append(line);
          }
          line.style.borderTopStyle = setting.rule;
          const width = setting.rule === 'double' ? Math.max(3, setting.ruleWidth * 2) : setting.ruleWidth;
          line.style.borderTopWidth = `${width}px`;
          page.style.setProperty(`--running-${side}-rule-width`, `${width}px`);
        } else { line?.remove(); page.style.setProperty(`--running-${side}-rule-width`, '0px'); }
      }
    });
  }
  function decorateWrappedPunctuation(node) {
    const value = node.textContent;
    if (![...value].some(isHangingPunctuation)) return;
    const fragment = document.createDocumentFragment(), punctuation = [];
    let start = 0;
    for (let index = 0; index < value.length;) {
      if (!isTrailingPunctuation(value, index)) { index += 1; continue; }
      const markStart = index;
      while (isTrailingPunctuation(value, index)) index += 1;
      const run = value.slice(markStart, index), before = value.slice(start, markStart);
      if (canHangPunctuation(run)) {
        fragment.append(document.createTextNode(before));
        const mark = document.createElement('span');
        mark.textContent = run;
        fragment.append(mark);
        punctuation.push({ mark, end: index });
      } else {
        const previous = [...before].at(-1);
        if (previous && !/\s/.test(previous)) {
          fragment.append(document.createTextNode(before.slice(0, -previous.length)));
          const cluster = document.createElement('span');
          cluster.className = 'punctuation-cluster';
          cluster.textContent = previous + run;
          fragment.append(cluster);
        } else fragment.append(document.createTextNode(before + run));
      }
      start = index;
    }
    fragment.append(document.createTextNode(value.slice(start)));
    node.replaceChildren(fragment);
    const originalAlign = node.style.textAlign, right = node.getBoundingClientRect().right;
    node.style.textAlign = 'left';
    for (const { mark, end } of punctuation) {
      if (node.dataset.hangingEnd && end === value.length) { mark.className = 'hanging-punctuation'; continue; }
      const before = mark.previousSibling;
      if (before?.nodeType !== Node.TEXT_NODE || before.length < 2 || before.data.endsWith('\n')) continue;
      const range = document.createRange();
      range.setStart(before, before.length - 2); range.setEnd(before, before.length - 1);
      const preceding = range.getBoundingClientRect();
      range.setStart(before, before.length - 1); range.setEnd(before, before.length);
      const last = range.getBoundingClientRect();
      if (last.top > preceding.top + 1 && preceding.right + last.width <= right + 1) mark.className = 'hanging-punctuation';
    }
    node.style.textAlign = originalAlign;
    punctuation.forEach(({ mark }) => { if (!mark.className) mark.replaceWith(document.createTextNode(mark.textContent)); });
    node.normalize();
  }
  function fitsPage(page, node) {
    let bottomPadding = pageBottomCache.get(page);
    if (bottomPadding === undefined) {
      bottomPadding = parseFloat(getComputedStyle(page).paddingBottom);
      pageBottomCache.set(page, bottomPadding);
    }
    // A paragraph's bottom margin separates it from the next block. It does not
    // need to fit after the last line on a page.
    return node.offsetTop + node.offsetHeight <= page.clientHeight - bottomPadding + 1;
  }
  function splitOverflowingBlock(page, node) {
    if (!['P', 'BLOCKQUOTE'].includes(node.tagName)) return null;
    const text = node.textContent;
    if (text.length < 2) return null;
    const textNode = node.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, textNode.length);
    const lineBoxGap = node.getBoundingClientRect().bottom - range.getBoundingClientRect().bottom;
    const pageTop = page.getBoundingClientRect().top;
    const pageBottom = page.clientHeight - pageBottomCache.get(page);
    let low = 1, high = text.length - 1, fit = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      range.setEnd(textNode, middle);
      if (range.getBoundingClientRect().bottom - pageTop + lineBoxGap <= pageBottom + 1) { fit = middle; low = middle + 1; }
      else high = middle - 1;
    }
    fit = /[\uDC00-\uDFFF]/.test(text[fit] || '') ? fit - 1 : fit;
    let splitAt = fit, hanging = false;
    const punctuationAt = isTrailingPunctuation(text, fit) ? fit : isTrailingPunctuation(text, fit + 1) ? fit + 1 : -1;
    if (punctuationAt > 0 && text[punctuationAt - 1] !== '\n') {
      let start = punctuationAt;
      while (isTrailingPunctuation(text, start - 1)) start -= 1;
      let end = punctuationAt + 1;
      while (isTrailingPunctuation(text, end)) end += 1;
      if (canHangPunctuation(text.slice(start, end))) {
        node.textContent = text.slice(0, start);
        const mark = document.createElement('span');
        mark.className = 'hanging-punctuation';
        mark.textContent = text.slice(start, end);
        node.append(mark);
        if (fitsPage(page, node)) { splitAt = end; hanging = true; }
        else splitAt = start - 1;
      } else splitAt = start - 1;
      if (splitAt > 0 && /[\uDC00-\uDFFF]/.test(text[splitAt])) splitAt -= 1;
    }
    if (!splitAt) { node.textContent = text; return null; }
    // Keep spaces at the end of the previous page so a continued line has no indent.
    while (text[splitAt] === ' ') splitAt += 1;
    if (!hanging) node.textContent = text.slice(0, splitAt);
    else { node.dataset.hangingEnd = 'true'; node.append(document.createTextNode(text.slice(node.textContent.length, splitAt))); }
    if (!fitsPage(page, node)) {
      // The range measures glyphs; a browser may reserve extra line-box space.
      // Fall back to the exact block measurement only for that edge case.
      let left = 1, right = splitAt - 1, exact = 0;
      delete node.dataset.hangingEnd;
      while (left <= right) {
        const middle = Math.floor((left + right) / 2);
        node.textContent = text.slice(0, middle);
        if (fitsPage(page, node)) { exact = middle; left = middle + 1; }
        else right = middle - 1;
      }
      if (!exact) { node.textContent = text; return null; }
      splitAt = exact;
      node.textContent = text.slice(0, splitAt);
    }
    const continuation = blockElement({ type: node.tagName === 'BLOCKQUOTE' ? 'quote' : 'paragraph', text: text.slice(splitAt) });
    continuation.dataset.flowContinuation = 'true';
    return continuation;
  }
  function paginatePreview(startPage = null) {
    const pages = [...preview.querySelectorAll('.manuscript-page')];
    const index = startPage && pages.includes(startPage) ? Math.max(0, pages.indexOf(startPage) - 1) : 0;
    const affected = pages.slice(index);
    const first = affected[0] || createManuscriptPage();
    const fragments = affected.flatMap(page => [...page.querySelectorAll(':scope > [data-block]')]);
    const blocks = fragments;
    for (const node of blocks) {
      node.textContent = readEditableText(node);
      delete node.dataset.hangingEnd;
    }
    const staticBlocks = index === 0 ? [...first.querySelectorAll(':scope > [data-static]')].filter(node => !node.classList.contains('running-text') && !node.classList.contains('running-rule')) : [];
    affected.forEach((page, pageIndex) => page.replaceChildren(...(pageIndex === 0 ? staticBlocks : [])));
    if (!first.isConnected) preview.append(first);
    syncPagePadding(first);
    let pageIndex = 0;
    function nextPage() {
      pageIndex += 1;
      const next = affected[pageIndex] || createManuscriptPage();
      if (!next.isConnected) { preview.append(next); syncPagePadding(next); }
      return next;
    }
    let page = first;
    for (let position = 0; position < blocks.length; position += 1) {
      let node = blocks[position];
      const previous = page.lastElementChild;
      if (node.dataset.flowContinuation && previous?.dataset.block && previous.tagName === node.tagName) {
        previous.textContent += node.textContent;
        node.remove();
        node = previous;
      } else page.append(node);
      if (fitsPage(page, node)) continue;
      const continuation = splitOverflowingBlock(page, node);
      if (continuation) {
        blocks.splice(position + 1, 0, continuation);
        page = nextPage();
      } else if (page.childElementCount > 1) {
        page = nextPage();
        page.append(node);
      }
    }
    if (!first.childElementCount) first.append(blockElement({ type: 'paragraph', text: '' }));
    affected.slice(pageIndex + 1).forEach(page => page.remove());
    return [...preview.querySelectorAll('.manuscript-page')].slice(index);
  }
  function rebalanceContinuedParagraph(startPage, delta) {
    if (!startPage || !delta) return null;
    const pages = [...preview.querySelectorAll('.manuscript-page')];
    const start = pages.indexOf(startPage);
    if (start < 0) return null;
    const fragments = pages.slice(start).map(page => [...page.querySelectorAll(':scope > [data-block]')]);
    const first = fragments[0]?.[0];
    if (!first || !['P', 'BLOCKQUOTE'].includes(first.tagName) || fragments.some((items, index) => items.length !== 1 || items[0].tagName !== first.tagName || (index > 0 && !items[0].dataset.flowContinuation))) return null;
    const affected = [startPage];
    if (delta > 0) {
      for (let index = start; index < pages.length; index += 1) {
        const page = pages[index], node = fragments[index - start][0];
        node.textContent = readEditableText(node);
        delete node.dataset.hangingEnd;
        if (affected.at(-1) !== page) affected.push(page);
        if (fitsPage(page, node)) break;
        const original = node.textContent;
        const characters = Array.from(original);
        if (characters.length < 2) return null;
        const lastCharacter = characters.pop();
        node.textContent = characters.join('');
        let continuation;
        if (fitsPage(page, node)) {
          continuation = blockElement({ type: node.dataset.block, text: lastCharacter });
          continuation.dataset.flowContinuation = 'true';
        } else {
          node.textContent = original;
          continuation = splitOverflowingBlock(page, node);
          if (!continuation) return null;
        }
        const moved = continuation.textContent;
        const next = fragments[index - start + 1]?.[0];
        if (next) next.textContent = moved + readEditableText(next);
        else {
          const nextPage = createManuscriptPage();
          preview.append(nextPage);
          syncPagePadding(nextPage);
          nextPage.append(continuation);
          affected.push(nextPage);
        }
      }
    } else {
      for (let index = 0; index < fragments.length - 1; index += 1) {
        const node = fragments[index][0], next = fragments[index + 1][0], page = pages[start + index];
        affected.push(pages[start + index + 1]);
        node.textContent = readEditableText(node);
        next.textContent = readEditableText(next);
        delete node.dataset.hangingEnd;
        delete next.dataset.hangingEnd;
        let moved = 0;
        while (next.textContent && moved < 8) {
          const character = Array.from(next.textContent)[0];
          node.textContent += character;
          next.textContent = next.textContent.slice(character.length);
          if (!fitsPage(page, node)) {
            node.textContent = node.textContent.slice(0, -character.length);
            next.textContent = character + next.textContent;
            break;
          }
          moved += 1;
        }
        if (moved >= 8) return null;
        if (!moved) break;
        if (!next.textContent) {
          if (index + 1 < fragments.length - 1) return null;
          pages[start + index + 1].remove();
          break;
        }
      }
    }
    return affected.filter(page => page.isConnected);
  }
  const paginatePreviewUnsafe = paginatePreview;
  paginatePreview = (startPage = null, delta = 0) => {
    const lastBlock = startPage && [...startPage.querySelectorAll(':scope > [data-block]')].at(-1);
    const affected = delta > 0 && lastBlock && fitsPage(startPage, lastBlock)
      ? [startPage]
      : rebalanceContinuedParagraph(startPage, delta) || paginatePreviewUnsafe(startPage);
    affected.forEach(page => page.querySelectorAll(':scope > [data-block]').forEach(decorateWrappedPunctuation));
    updateToc();
    decorateRunningMatter();
  };
  function prepareNextPageForCaret(block) {
    const page = block?.closest('.manuscript-page');
    if (!page || !['P', 'BLOCKQUOTE'].includes(block.tagName) ||
        block !== [...page.querySelectorAll(':scope > [data-block]')].at(-1)) return null;
    // Check the next Korean glyph before composition begins. The probe is
    // removed immediately so it never enters the document or its history.
    const probe = document.createTextNode('가');
    block.append(probe);
    const hasRoom = fitsPage(page, block);
    probe.remove();
    if (hasRoom) return null;
    const nextPage = page.nextElementSibling;
    const firstBlock = nextPage?.classList.contains('manuscript-page') &&
      nextPage.querySelector(':scope > [data-block]');
    if (firstBlock?.dataset.flowContinuation && firstBlock.tagName === block.tagName) return firstBlock;
    if (page !== [...preview.querySelectorAll('.manuscript-page')].at(-1)) return null;
    const freshPage = createManuscriptPage();
    preview.append(freshPage);
    syncPagePadding(freshPage);
    const continuation = blockElement({ type: block.dataset.block, text: '' });
    continuation.dataset.flowContinuation = 'true';
    freshPage.append(continuation);
    decorateRunningMatter();
    return continuation;
  }
  function chapterPageNumbers() { const pages = [...preview.querySelectorAll('.book-page')]; return [...preview.querySelectorAll('.manuscript-page > h1[data-block="heading"]')].map(chapter => pages.indexOf(chapter.closest('.book-page')) + 1); }
  function createTocSection(blocks, pageNumbers = []) { const chapters = blocks.filter(block => block.type === 'heading'), toc = staticSection('toc-page'), heading = document.createElement('h2'); heading.textContent = '목차'; const list = document.createElement('ol'); if (chapters.length) { chapters.forEach((block, index) => { const item = document.createElement('li'), name = document.createElement('span'), number = document.createElement('span'); name.textContent = block.text || `장 ${index + 1}`; number.textContent = pageNumbers[index] ? `${pageNumbers[index]}p` : '—'; item.append(name, number); list.append(item); }); toc.append(heading, list); } else { const empty = document.createElement('p'); empty.className = 'toc-empty'; empty.textContent = '장 제목을 추가하면 이곳에 목차가 표시됩니다.'; toc.append(heading, empty); } return toc; }
  function updateToc() { const current = preview.querySelector('.toc-page'); if (!getDocument().typesetting.showToc) { current?.remove(); return; } const toc = createTocSection(documentBlocks(), chapterPageNumbers()); if (current) current.replaceWith(toc); else { const firstPage = preview.querySelector('.manuscript-page'); firstPage ? preview.insertBefore(toc, firstPage) : preview.append(toc); } syncPagePadding(toc); }
  function renderPreview() { if (isReflowing()) return; const pane = preview.closest('.preview-pane'); if (pane && previewDocumentId) previewScrollPositions.set(previewDocumentId, pane.scrollTop); const scrollTop = previewScrollPositions.get(getDocument().id) || 0; const paper = { a5: ['A5 · 148 × 210 mm', 'A5'], a4: ['A4 · 210 × 297 mm', 'A4'], b5: ['B5 · 176 × 250 mm', 'B5'] }[getDocument().typesetting.paperSize]; const blocks = documentBlocks(); getDocument().document.blocks = blocks; preview.replaceChildren(); preview.dataset.empty = String(isEmptyManuscript(blocks)); document.documentElement.style.setProperty('--print-size', paper[1]); paperDescription.textContent = paper[0]; if (getDocument().typesetting.showCover) { const cover = staticSection('cover-page'); const title = document.createElement('h1'); title.textContent = getDocument().meta.title || '제목 없는 원고'; const author = document.createElement('p'); author.className = 'cover-author'; author.textContent = getDocument().meta.author || '저자명'; cover.append(title, author); preview.append(cover); } if (getDocument().typesetting.showToc) preview.append(createTocSection(blocks)); const page = createManuscriptPage(); if (!getDocument().typesetting.showCover && getDocument().meta.title) { const title = document.createElement('h1'); title.className = 'book-title'; title.contentEditable = 'false'; title.dataset.static = 'true'; title.textContent = getDocument().meta.title; page.append(title); } (blocks.length ? blocks : [{ type: 'paragraph', text: '' }]).forEach(block => page.append(blockElement(block))); preview.append(page); paginatePreview(); if (pane) pane.scrollTop = scrollTop; previewDocumentId = getDocument().id; }
  return { renderPreview, paginatePreview, prepareNextPageForCaret, updateToc, decorateRunningMatter, blockElement, isEmptyManuscript };
}

  window.ManuscriptStudio.preview = { createPreview };
})();
