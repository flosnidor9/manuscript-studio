(() => {
  'use strict';
  const { FONT_STACKS, markdownToBlocks } = window.ManuscriptStudio.model;
  const { isHangingPunctuation, isTrailingPunctuation, canHangPunctuation } = window.ManuscriptStudio.punctuation;


function createPreview({ getDocument, preview, paperDescription, readEditableText, isReflowing }) {
  let previewDocumentId = null;
  const previewScrollPositions = new Map();
  function documentBlocks() { return Array.isArray(getDocument().document.blocks) && getDocument().document.blocks.length ? getDocument().document.blocks : markdownToBlocks(getDocument().document.markdown); }
  function isEmptyManuscript(blocks) { return blocks.length === 1 && blocks[0].type === 'paragraph' && blocks[0].text === ''; }
  function syncPagePadding(page) { const size = { a5: [148, 210], a4: [210, 297], b5: [176, 250] }[getDocument().typesetting.paperSize], bounds = page.getBoundingClientRect(), margins = getDocument().typesetting; if (!bounds.width || !bounds.height) return; const vertical = bounds.height * margins.marginVerticalMm / size[1], horizontal = bounds.width * margins.marginHorizontalMm / size[0]; page.style.setProperty('--page-padding-top', `${vertical}px`); page.style.setProperty('--page-padding-right', `${horizontal}px`); page.style.setProperty('--page-padding-bottom', `${vertical}px`); page.style.setProperty('--page-padding-left', `${horizontal}px`); }
  function pageElement(className = 'manuscript-page') { const page = document.createElement('article'), size = { a5: [148, 210], a4: [210, 297], b5: [176, 250] }[getDocument().typesetting.paperSize], margins = getDocument().typesetting; page.className = `book-page ${className}`; page.dataset.paperSize = getDocument().typesetting.paperSize; page.dataset.theme = getDocument().typesetting.designTheme; page.style.fontSize = `${getDocument().typesetting.fontSizePt}pt`; page.style.lineHeight = getDocument().typesetting.lineHeight; page.style.fontFamily = FONT_STACKS[getDocument().typesetting.fontFamily]; const vertical = `${margins.marginVerticalMm / size[1] * 100}%`, horizontal = `${margins.marginHorizontalMm / size[0] * 100}%`; page.style.setProperty('--page-padding-top', vertical); page.style.setProperty('--page-padding-right', horizontal); page.style.setProperty('--page-padding-bottom', vertical); page.style.setProperty('--page-padding-left', horizontal); page.style.setProperty('--print-padding-top', `${margins.marginVerticalMm}mm`); page.style.setProperty('--print-padding-right', `${margins.marginHorizontalMm}mm`); page.style.setProperty('--print-padding-bottom', `${margins.marginVerticalMm}mm`); page.style.setProperty('--print-padding-left', `${margins.marginHorizontalMm}mm`); return page; }
  function staticSection(className) { const section = pageElement(className); section.contentEditable = 'false'; section.dataset.static = 'true'; return section; }
  function blockElement(block) { const node = document.createElement(block.type === 'heading' ? 'h1' : block.type === 'subheading' ? 'h2' : block.type === 'quote' ? 'blockquote' : 'p'); node.dataset.block = block.type; node.textContent = block.text.replace(/\r\n?/g, '\n'); return node; }
  function createManuscriptPage() { const page = pageElement(); page.contentEditable = 'true'; page.setAttribute('role', 'textbox'); page.setAttribute('aria-multiline', 'true'); page.setAttribute('aria-label', '원고 본문'); return page; }
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
    const pageBottom = page.getBoundingClientRect().bottom - parseFloat(getComputedStyle(page).paddingBottom);
    // A paragraph's bottom margin separates it from the next block. It does not
    // need to fit after the last line on a page.
    return node.getBoundingClientRect().bottom <= pageBottom + 1;
  }
  function splitOverflowingBlock(page, node) {
    if (!['P', 'BLOCKQUOTE'].includes(node.tagName)) return null;
    const text = node.textContent;
    if (text.length < 2) return null;
    let low = 1, high = text.length - 1, fit = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      node.textContent = text.slice(0, middle);
      if (fitsPage(page, node)) { fit = middle; low = middle + 1; } else high = middle - 1;
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
    const continuation = blockElement({ type: node.tagName === 'BLOCKQUOTE' ? 'quote' : 'paragraph', text: text.slice(splitAt) });
    continuation.dataset.flowContinuation = 'true';
    return continuation;
  }
  function paginatePreview() { const blocks = [...preview.querySelectorAll('.manuscript-page:not([data-static]) > *')].filter(node => !node.dataset.static); blocks.forEach(node => { node.textContent = readEditableText(node); delete node.dataset.hangingEnd; }); const allPages = [...preview.querySelectorAll('.book-page')]; allPages.forEach(syncPagePadding); const pages = allPages.filter(page => !page.dataset.static); const first = pages[0] || createManuscriptPage(), staticBlocks = [...first.querySelectorAll(':scope > [data-static]')]; if (!first.isConnected) { preview.append(first); syncPagePadding(first); } pages.forEach(page => page.replaceChildren()); first.append(...staticBlocks); let page = first; for (let index = 0; index < blocks.length; index += 1) { const node = blocks[index]; page.append(node); if (fitsPage(page, node)) continue; const continuation = splitOverflowingBlock(page, node); if (continuation) { blocks.splice(index + 1, 0, continuation); page = createManuscriptPage(); preview.append(page); syncPagePadding(page); continue; } if (page.childElementCount > 1) { page = createManuscriptPage(); preview.append(page); syncPagePadding(page); page.append(node); } } if (!first.childElementCount) first.append(blockElement({ type: 'paragraph', text: '' })); [...preview.querySelectorAll('.manuscript-page')].slice(1).forEach(page => { if (!page.childElementCount) page.remove(); }); }
  const paginatePreviewUnsafe = paginatePreview;
  paginatePreview = () => { paginatePreviewUnsafe(); preview.querySelectorAll('.manuscript-page > [data-block]').forEach(decorateWrappedPunctuation); updateToc(); };
  function chapterPageNumbers() { const pages = [...preview.querySelectorAll('.book-page')]; return [...preview.querySelectorAll('.manuscript-page > h1[data-block="heading"]')].map(chapter => pages.indexOf(chapter.closest('.book-page')) + 1); }
  function createTocSection(blocks, pageNumbers = []) { const chapters = blocks.filter(block => block.type === 'heading'), toc = staticSection('toc-page'), heading = document.createElement('h2'); heading.textContent = '목차'; const list = document.createElement('ol'); if (chapters.length) { chapters.forEach((block, index) => { const item = document.createElement('li'), name = document.createElement('span'), number = document.createElement('span'); name.textContent = block.text || `장 ${index + 1}`; number.textContent = pageNumbers[index] ? `${pageNumbers[index]}p` : '—'; item.append(name, number); list.append(item); }); toc.append(heading, list); } else { const empty = document.createElement('p'); empty.className = 'toc-empty'; empty.textContent = '장 제목을 추가하면 이곳에 목차가 표시됩니다.'; toc.append(heading, empty); } return toc; }
  function updateToc() { const current = preview.querySelector('.toc-page'); if (!getDocument().typesetting.showToc) { current?.remove(); return; } const toc = createTocSection(documentBlocks(), chapterPageNumbers()); if (current) current.replaceWith(toc); else { const firstPage = preview.querySelector('.manuscript-page'); firstPage ? preview.insertBefore(toc, firstPage) : preview.append(toc); } syncPagePadding(toc); }
  function renderPreview() { if (isReflowing()) return; const pane = preview.closest('.preview-pane'); if (pane && previewDocumentId) previewScrollPositions.set(previewDocumentId, pane.scrollTop); const scrollTop = previewScrollPositions.get(getDocument().id) || 0; const paper = { a5: ['A5 · 148 × 210 mm', 'A5'], a4: ['A4 · 210 × 297 mm', 'A4'], b5: ['B5 · 176 × 250 mm', 'B5'] }[getDocument().typesetting.paperSize]; const blocks = documentBlocks(); getDocument().document.blocks = blocks; preview.replaceChildren(); preview.dataset.empty = String(isEmptyManuscript(blocks)); document.documentElement.style.setProperty('--print-size', paper[1]); paperDescription.textContent = paper[0]; if (getDocument().typesetting.showCover) { const cover = staticSection('cover-page'); const title = document.createElement('h1'); title.textContent = getDocument().meta.title || '제목 없는 원고'; const author = document.createElement('p'); author.className = 'cover-author'; author.textContent = getDocument().meta.author || '저자명'; cover.append(title, author); } if (getDocument().typesetting.showToc) preview.append(createTocSection(blocks)); const page = createManuscriptPage(); if (!getDocument().typesetting.showCover && getDocument().meta.title) { const title = document.createElement('h1'); title.className = 'book-title'; title.contentEditable = 'false'; title.dataset.static = 'true'; title.textContent = getDocument().meta.title; page.append(title); } (blocks.length ? blocks : [{ type: 'paragraph', text: '' }]).forEach(block => page.append(blockElement(block))); preview.append(page); paginatePreview(); if (pane) pane.scrollTop = scrollTop; previewDocumentId = getDocument().id; }
  return { renderPreview, paginatePreview, updateToc, blockElement, isEmptyManuscript };
}

  window.ManuscriptStudio.preview = { createPreview };
})();
