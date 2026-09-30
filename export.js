import { isTrailingPunctuation, canHangPunctuation } from './punctuation.js';

  export function safeFileName(title) { const name = (title || '원고').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80); return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) || !name ? '원고' : name; }
  export function downloadBlob(contents, type, extension, name) { const blob = new Blob([contents], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${name}.${extension}`; a.hidden = true; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function canvasLines(context, value, maxWidth) {
    const lines = [];
    String(value).split('\n').forEach(paragraph => {
      if (!paragraph) { lines.push(''); return; }
      const characters = [...paragraph], units = [];
      for (let index = 0; index < characters.length;) {
        const character = characters[index];
        if (!isTrailingPunctuation(characters, index) && !/\s/.test(character) && isTrailingPunctuation(characters, index + 1)) {
          let end = index + 1;
          while (isTrailingPunctuation(characters, end)) end += 1;
          const run = characters.slice(index + 1, end).join('');
          if (canHangPunctuation(run)) { units.push({ text: character }); units.push({ text: run, hang: true }); }
          else units.push({ text: character + run });
          index = end;
        } else { units.push({ text: character }); index += 1; }
      }
      let line = '';
      for (const unit of units) {
        if (!line && unit.text === ' ') continue;
        const next = line + unit.text;
        if (line && context.measureText(next).width > maxWidth && !unit.hang) { lines.push(line); line = unit.text.trimStart(); }
        else line = next;
      }
      lines.push(line);
    });
    return lines;
  }
  function drawPageBlock(context, pageBounds, node) { const bounds = node.getBoundingClientRect(), style = getComputedStyle(node), x = bounds.left - pageBounds.left, y = bounds.top - pageBounds.top, width = bounds.width, height = bounds.height, fontSize = Number.parseFloat(style.fontSize) || 16, lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.5; context.save(); context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`; context.fillStyle = style.color || '#262b25'; context.textBaseline = 'top'; if (node.tagName === 'BLOCKQUOTE') { const border = Number.parseFloat(style.borderLeftWidth) || 2; context.fillStyle = style.borderLeftColor || '#a1ad9b'; context.fillRect(x, y, border, height); context.fillStyle = style.color || '#596358'; } const left = x + (node.tagName === 'BLOCKQUOTE' ? Number.parseFloat(style.paddingLeft) || 0 : 0), lines = canvasLines(context, node.textContent, Math.max(1, width - (left - x))), visible = Math.max(1, Math.round(height / lineHeight)); lines.slice(0, visible).forEach((line, index) => { const textWidth = context.measureText(line).width; const textX = style.textAlign === 'center' ? left + (width - (left - x) - textWidth) / 2 : style.textAlign === 'right' ? x + width - textWidth : left; context.fillText(line, textX, y + index * lineHeight); }); context.restore(); }
  async function rasterizePage(page, scale = 2) { const bounds = page.getBoundingClientRect(), width = Math.round(bounds.width * scale), height = Math.round(bounds.height * scale); if (!width || !height || width * height > 24_000_000) throw new Error('페이지 크기가 너무 큽니다'); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('이미지 캔버스를 만들지 못했습니다'); const style = getComputedStyle(page); context.scale(scale, scale); context.fillStyle = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : '#fffdf7'; context.fillRect(0, 0, bounds.width, bounds.height); [...page.querySelectorAll(':scope > *')].forEach(node => drawPageBlock(context, bounds, node)); return canvas; }
  function joinBytes(parts) { const size = parts.reduce((total, part) => total + part.length, 0), result = new Uint8Array(size); let offset = 0; parts.forEach(part => { result.set(part, offset); offset += part.length; }); return result; }
  export function buildPdf(canvases, paperSize) { const encoder = new TextEncoder(), text = value => encoder.encode(value), pageSize = { a5: [419.53, 595.28], a4: [595.28, 841.89], b5: [498.9, 708.66] }[paperSize], objects = []; const add = body => objects.push(body); add(text('<< /Type /Catalog /Pages 2 0 R >>')); add(text(`<< /Type /Pages /Kids [${canvases.map((_, index) => `${3 + index * 3} 0 R`).join(' ')}] /Count ${canvases.length} >>`)); canvases.forEach((canvas, index) => { const pageId = 3 + index * 3, imageId = pageId + 1, contentId = pageId + 2, jpeg = Uint8Array.from(atob(canvas.toDataURL('image/jpeg', .92).split(',')[1]), character => character.charCodeAt(0)); add(text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize[0]} ${pageSize[1]}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)); add(joinBytes([text(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, text('\nendstream')])); const stream = text(`q\n${pageSize[0]} 0 0 ${pageSize[1]} 0 0 cm\n/Im${index} Do\nQ`); add(joinBytes([text(`<< /Length ${stream.length} >>\nstream\n`), stream, text('\nendstream')])); }); const header = text('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n'), parts = [header], offsets = [0]; let offset = header.length; objects.forEach((body, index) => { const object = joinBytes([text(`${index + 1} 0 obj\n`), body, text('\nendobj\n')]); offsets.push(offset); parts.push(object); offset += object.length; }); parts.push(text(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`)); return new Blob([joinBytes(parts)], { type: 'application/pdf' }); }
  export async function renderPagesForExport(preview) { await document.fonts?.ready; const pages = [...preview.querySelectorAll('.book-page')]; if (!pages.length) throw new Error('저장할 페이지가 없습니다'); const canvases = []; for (const page of pages) canvases.push(await rasterizePage(page)); return canvases; }
  export function canvasToBlob(canvas, type = 'image/png') { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 생성 실패')), type)); }
