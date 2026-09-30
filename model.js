(() => {
  'use strict';
  window.ManuscriptStudio = window.ManuscriptStudio || Object.create(null);

const VERSION = 2;
const MAX_MANUSCRIPT_CHARS = 250_000;
const ELLIPSIS_TEXT = '······';
const ELLIPSIS_PATTERN = /\.{3,}|[⋯…]+/g;
const normalizeEllipsisText = text => text.replace(ELLIPSIS_PATTERN, match => ELLIPSIS_TEXT + (match.startsWith('.') && match.length >= 4 ? '.' : ''));

const FONT_STACKS = Object.freeze({ serif: '"Noto Serif KR", Batang, Georgia, serif', 'sans-serif': '"Noto Sans KR", "Malgun Gothic", Arial, sans-serif', monospace: 'Consolas, "Courier New", monospace', 'noto-serif-kr': '"Noto Serif KR", Batang, Georgia, serif', 'nanum-myeongjo': '"Nanum Myeongjo", Batang, Georgia, serif', batang: 'Batang, "Noto Serif KR", serif', 'noto-sans-kr': '"Noto Sans KR", "Malgun Gothic", Arial, sans-serif', 'nanum-gothic': '"Nanum Gothic", "Malgun Gothic", Arial, sans-serif', 'malgun-gothic': '"Malgun Gothic", "Noto Sans KR", Arial, sans-serif', 'apple-sd-gothic-neo': '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif', georgia: 'Georgia, "Noto Serif KR", serif', 'times-new-roman': '"Times New Roman", "Noto Serif KR", serif', arial: 'Arial, "Noto Sans KR", sans-serif', verdana: 'Verdana, "Noto Sans KR", sans-serif', 'courier-new': '"Courier New", Consolas, monospace' });
const TYPESETTING_PRESETS = Object.freeze({
  'a5-novel': Object.freeze({ label: 'A5 소설책', description: 'A5 · 명조 계열 · 10pt · 줄 간격 1.8 · 가로 23 / 세로 26mm', fontSizePt: 10, lineHeight: 1.8, fontFamily: 'serif', paperSize: 'a5', marginHorizontalMm: 23, marginVerticalMm: 26 }),
  'b5-essay': Object.freeze({ label: 'B5 에세이·실용서', description: 'B5 · 명조 계열 · 11pt · 줄 간격 1.9 · 가로 20 / 세로 21mm', fontSizePt: 11, lineHeight: 1.9, fontFamily: 'serif', paperSize: 'b5', marginHorizontalMm: 20, marginVerticalMm: 21 }),
  'a4-manuscript': Object.freeze({ label: 'A4 원고·교정', description: 'A4 · 고딕 계열 · 11pt · 줄 간격 1.7 · 가로 20 / 세로 25mm', fontSizePt: 11, lineHeight: 1.7, fontFamily: 'sans-serif', paperSize: 'a4', marginHorizontalMm: 20, marginVerticalMm: 25 }),
  'a5-compact': Object.freeze({ label: 'A5 휴대용 소설', description: 'A5 · 명조 계열 · 9pt · 줄 간격 1.6 · 가로 15 / 세로 18mm', fontSizePt: 9, lineHeight: 1.6, fontFamily: 'serif', paperSize: 'a5', marginHorizontalMm: 15, marginVerticalMm: 18 }),
  'a5-large': Object.freeze({ label: 'A5 큰 글씨 책', description: 'A5 · 명조 계열 · 13pt · 줄 간격 1.9 · 가로 18 / 세로 20mm', fontSizePt: 13, lineHeight: 1.9, fontFamily: 'serif', paperSize: 'a5', marginHorizontalMm: 18, marginVerticalMm: 20 }),
  'b5-poetry': Object.freeze({ label: 'B5 시집', description: 'B5 · 명조 계열 · 12pt · 줄 간격 2.1 · 가로 28 / 세로 30mm', fontSizePt: 12, lineHeight: 2.1, fontFamily: 'serif', paperSize: 'b5', marginHorizontalMm: 28, marginVerticalMm: 30 }),
  'b5-report': Object.freeze({ label: 'B5 리포트', description: 'B5 · 고딕 계열 · 10pt · 줄 간격 1.6 · 가로 18 / 세로 20mm', fontSizePt: 10, lineHeight: 1.6, fontFamily: 'sans-serif', paperSize: 'b5', marginHorizontalMm: 18, marginVerticalMm: 20 }),
  'a4-workbook': Object.freeze({ label: 'A4 학습 자료', description: 'A4 · 고딕 계열 · 12pt · 줄 간격 1.8 · 가로 22 / 세로 24mm', fontSizePt: 12, lineHeight: 1.8, fontFamily: 'sans-serif', paperSize: 'a4', marginHorizontalMm: 22, marginVerticalMm: 24 })
});

const newDocument = () => ({ version: VERSION, id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), meta: { title: '', author: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, document: { markdown: '', blocks: [{ type: 'paragraph', text: '' }] }, typesetting: { fontSizePt: 10.5, lineHeight: 1.8, fontFamily: 'serif', paperSize: 'a5', marginHorizontalMm: 18, marginVerticalMm: 19, designTheme: 'classic', showCover: true, showToc: true } });
const cleanText = (value, max = MAX_MANUSCRIPT_CHARS) => typeof value === 'string' ? value.slice(0, max) : '';
const validBlock = block => block && ['paragraph', 'heading', 'subheading', 'quote'].includes(block.type) && typeof block.text === 'string';
function blocksToMarkdown(blocks) { return blocks.map(block => `${block.type === 'heading' ? '# ' : block.type === 'subheading' ? '## ' : block.type === 'quote' ? '> ' : ''}${block.text}`).join('\n\n'); }
function markdownToBlocks(markdown) {
  const text = cleanText(markdown);
  if (/^\n*$/.test(text)) return Array.from({ length: Math.max(1, Math.ceil((text.length + 1) / 2)) }, () => ({ type: 'paragraph', text: '' }));
  const blocks = [], lines = text.split('\n');
  let paragraph = [], blankLines = 0;
  const flush = () => {
    if (paragraph.length) { blocks.push({ type: 'paragraph', text: paragraph.join('\n') }); paragraph = []; }
    for (let index = 0; index < Math.floor(blankLines / 2); index += 1) blocks.push({ type: 'paragraph', text: '' });
    blankLines = 0;
  };
  lines.forEach(line => {
    if (line === '') { blankLines += 1; return; }
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      const level = line.match(/^#+/)[0].length;
      blocks.push({ type: level === 1 ? 'heading' : 'subheading', text: line.replace(/^#{1,6}\s+/, '') });
    } else if (/^>\s?/.test(line)) {
      flush();
      blocks.push({ type: 'quote', text: line.replace(/^>\s?/, '') });
    } else { if (blankLines) flush(); paragraph.push(line); }
  });
  flush();
  return blocks.slice(0, 2000);
}
function sanitizeImported(value) {
  if (!value || typeof value !== 'object' || ![1, VERSION].includes(value.version) || !value.document) throw new Error('지원하지 않는 프로젝트 형식입니다.');
  const storedBlocks = Array.isArray(value.document.blocks) ? value.document.blocks.filter(validBlock).slice(0, 2000).map(b => ({ type: b.type, text: cleanText(b.text) })) : [];
  if (!storedBlocks.length && typeof value.document.markdown !== 'string') throw new Error('가져올 원고가 없습니다.');
  const markdown = typeof value.document.markdown === 'string' ? cleanText(value.document.markdown) : blocksToMarkdown(storedBlocks);
  const importedId = typeof value.id === 'string' ? value.id.trim().slice(0, 100) : '';
  const oldHorizontal = Math.round((clamp(Number(value.typesetting?.marginLeftMm), 8, 35, 20) + clamp(Number(value.typesetting?.marginRightMm), 8, 35, 16)) / 2);
  const oldVertical = Math.round((clamp(Number(value.typesetting?.marginTopMm), 8, 35, 18) + clamp(Number(value.typesetting?.marginBottomMm), 8, 35, 20)) / 2);
  return { version: VERSION, id: importedId || newDocument().id, meta: { title: cleanText(value.meta?.title, 200), author: cleanText(value.meta?.author, 200), createdAt: typeof value.meta?.createdAt === 'string' ? value.meta.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString() }, document: { markdown, blocks: markdownToBlocks(markdown) }, typesetting: { fontSizePt: clamp(Number(value.typesetting?.fontSizePt), 8, 18, 10.5), lineHeight: clamp(Number(value.typesetting?.lineHeight), 1.2, 2.4, 1.8), fontFamily: Object.hasOwn(FONT_STACKS, value.typesetting?.fontFamily) ? value.typesetting.fontFamily : 'serif', paperSize: ['a4','a5','b5'].includes(value.typesetting?.paperSize) ? value.typesetting.paperSize : 'a5', marginHorizontalMm: Math.round(clamp(Number(value.typesetting?.marginHorizontalMm), 8, 35, oldHorizontal)), marginVerticalMm: Math.round(clamp(Number(value.typesetting?.marginVerticalMm), 8, 35, oldVertical)), designTheme: ['classic', 'essay', 'poetry', 'noir', 'editorial'].includes(value.typesetting?.designTheme) ? value.typesetting.designTheme : 'classic', showCover: value.typesetting?.showCover !== false, showToc: value.typesetting?.showToc !== false } };
}
function clamp(n, min, max, fallback) { return Number.isFinite(n) && n >= min && n <= max ? n : fallback; }

  window.ManuscriptStudio.model = { VERSION, MAX_MANUSCRIPT_CHARS, ELLIPSIS_TEXT, ELLIPSIS_PATTERN, normalizeEllipsisText, FONT_STACKS, TYPESETTING_PRESETS, newDocument, cleanText, validBlock, blocksToMarkdown, markdownToBlocks, sanitizeImported, clamp };
})();
