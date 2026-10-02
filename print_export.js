(() => {
  'use strict';
  const MM_TO_PT = 72 / 25.4;
  const PX_PER_MM = 300 / 25.4;
  const SIZES = { a5: [148, 210], a4: [210, 297], b5: [176, 250] };
  const { rasterizePage } = window.ManuscriptStudio.output;
  const bytes = value => new TextEncoder().encode(value);
  const number = value => Number(value.toFixed(3));
  const box = values => `[${values.map(value => number(value * MM_TO_PT)).join(' ')}]`;
  function join(parts) { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
  function imageBytes(canvas) { const encoded = canvas.toDataURL('image/jpeg', .98).split(',')[1]; if (!encoded) throw new Error('페이지 이미지를 만들지 못했습니다'); return Uint8Array.from(atob(encoded), character => character.charCodeAt(0)); }

  // Each PDF page has its own trim and bleed boxes. The printer performs imposition.
  function pdfFromPages(pages) {
    if (!pages.length) throw new Error('출력할 페이지가 없습니다');
    const objects = [bytes('<< /Type /Catalog /Pages 2 0 R >>'), bytes(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`)];
    pages.forEach((page, index) => {
      const id = 3 + index * 3, { widthMm, heightMm, trim } = page, jpeg = page.jpeg || imageBytes(page.canvas);
      const imageWidth = page.imageWidth || page.canvas.width, imageHeight = page.imageHeight || page.canvas.height;
      const widthPt = number(widthMm * MM_TO_PT), heightPt = number(heightMm * MM_TO_PT);
      objects.push(bytes(`<< /Type /Page /Parent 2 0 R /MediaBox ${box([0, 0, widthMm, heightMm])} /CropBox ${box([0, 0, widthMm, heightMm])} /BleedBox ${box([0, 0, widthMm, heightMm])} /TrimBox ${box(trim)} /Resources << /XObject << /Im ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`));
      objects.push(join([bytes(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, bytes('\nendstream')]));
      const content = bytes(`q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im Do\nQ\n`);
      objects.push(join([bytes(`<< /Length ${content.length} >>\nstream\n`), content, bytes('endstream')]));
    });
    const parts = [bytes('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')], offsets = [0];
    let offset = parts[0].length;
    objects.forEach((object, index) => { const wrapped = join([bytes(`${index + 1} 0 obj\n`), object, bytes('\nendobj\n')]); offsets.push(offset); parts.push(wrapped); offset += wrapped.length; });
    parts.push(bytes(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));
    return new Blob(parts, { type: 'application/pdf' });
  }
  function pageCanvas(source, widthMm, heightMm, bleedMm, background) {
    const canvas = document.createElement('canvas'), bleedPx = Math.round(bleedMm * PX_PER_MM);
    canvas.width = Math.round((widthMm + 2 * bleedMm) * PX_PER_MM);
    canvas.height = Math.round((heightMm + 2 * bleedMm) * PX_PER_MM);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('인쇄용 캔버스를 만들지 못했습니다');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, bleedPx, bleedPx, canvas.width - 2 * bleedPx, canvas.height - 2 * bleedPx);
    return canvas;
  }
  async function renderPrintPages(preview, paperSize, bleedMm, includeCover = false) {
    const size = SIZES[paperSize];
    if (!size) throw new Error('지원하지 않는 판형입니다');
    await document.fonts?.ready;
    const previousZoom = preview.style.zoom, pages = [];
    preview.dataset.exporting = 'true'; preview.style.zoom = '1';
    try {
      const elements = [...preview.querySelectorAll('.book-page')].filter(page => includeCover || !page.classList.contains('cover-page'));
      if (!elements.length) throw new Error('출력할 본문이 없습니다');
      for (const page of elements) {
        const source = await rasterizePage(page, 300 / 96);
        const background = getComputedStyle(page).backgroundColor || '#ffffff';
        const canvas = pageCanvas(source, ...size, bleedMm, background);
        pages.push({ jpeg: imageBytes(canvas), imageWidth: canvas.width, imageHeight: canvas.height, widthMm: size[0] + 2 * bleedMm, heightMm: size[1] + 2 * bleedMm, trim: [bleedMm, bleedMm, bleedMm + size[0], bleedMm + size[1]] });
      }
      if (pages.length % 2) {
        const blank = document.createElement('canvas'); blank.width = Math.round((size[0] + 2 * bleedMm) * PX_PER_MM); blank.height = Math.round((size[1] + 2 * bleedMm) * PX_PER_MM);
        blank.getContext('2d').fillStyle = '#ffffff'; blank.getContext('2d').fillRect(0, 0, blank.width, blank.height);
        pages.push({ jpeg: imageBytes(blank), imageWidth: blank.width, imageHeight: blank.height, widthMm: size[0] + 2 * bleedMm, heightMm: size[1] + 2 * bleedMm, trim: [bleedMm, bleedMm, bleedMm + size[0], bleedMm + size[1]] });
      }
      return pages;
    } finally { preview.style.zoom = previousZoom; delete preview.dataset.exporting; }
  }
  async function renderWrapCover(preview, paperSize, bleedMm, spineMm, title, fontFamily) {
    const size = SIZES[paperSize], cover = preview.querySelector('.book-page.cover-page');
    if (!size || !cover) throw new Error('책 구성에서 표지를 켠 뒤 표지 PDF를 만드세요');
    await document.fonts?.ready;
    const previousZoom = preview.style.zoom; preview.dataset.exporting = 'true'; preview.style.zoom = '1';
    try {
      const front = await rasterizePage(cover, 300 / 96), widthMm = 2 * size[0] + spineMm + 2 * bleedMm, heightMm = size[1] + 2 * bleedMm;
      const canvas = document.createElement('canvas'); canvas.width = Math.round(widthMm * PX_PER_MM); canvas.height = Math.round(heightMm * PX_PER_MM);
      if (canvas.width * canvas.height > 24_000_000) throw new Error('표지가 캔버스 크기 제한을 넘었습니다');
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('표지 캔버스를 만들지 못했습니다');
      const color = getComputedStyle(cover).backgroundColor;
      ctx.fillStyle = color && color !== 'rgba(0, 0, 0, 0)' ? color : '#21372d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const frontX = Math.round((bleedMm + size[0] + spineMm) * PX_PER_MM), top = Math.round(bleedMm * PX_PER_MM), frontWidth = Math.round(size[0] * PX_PER_MM), frontHeight = Math.round(size[1] * PX_PER_MM);
      ctx.drawImage(front, frontX, top, frontWidth, frontHeight);
      // Extend the outer edge of the artwork into the bleed, without changing trim dimensions.
      const bleedPx = Math.round(bleedMm * PX_PER_MM);
      ctx.drawImage(front, front.width - 1, 0, 1, front.height, frontX + frontWidth, top, bleedPx, frontHeight);
      ctx.drawImage(front, 0, 0, front.width, 1, frontX, 0, frontWidth, bleedPx);
      ctx.drawImage(front, 0, front.height - 1, front.width, 1, frontX, top + frontHeight, frontWidth, bleedPx);
      if (spineMm >= 7 && title) {
        ctx.save(); ctx.translate(Math.round((bleedMm + size[0] + spineMm / 2) * PX_PER_MM), canvas.height / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = getComputedStyle(cover.querySelector('h1') || cover).color || '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `${Math.min(10, spineMm - 3) * PX_PER_MM}px ${fontFamily}`;
        const available = (size[1] - 24) * PX_PER_MM; if (ctx.measureText(title).width <= available) ctx.fillText(title, 0, 0);
        ctx.restore();
      }
      return { jpeg: imageBytes(canvas), imageWidth: canvas.width, imageHeight: canvas.height, widthMm, heightMm, trim: [bleedMm, bleedMm, widthMm - bleedMm, heightMm - bleedMm] };
    } finally { preview.style.zoom = previousZoom; delete preview.dataset.exporting; }
  }
  window.ManuscriptStudio.printOutput = { SIZES, pdfFromPages, renderPrintPages, renderWrapCover };
})();
