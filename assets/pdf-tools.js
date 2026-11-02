// A conservative, browser-only PDF inspection and rasterized anonymization aid.
// The returned file always requires a human page-by-page review.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs';
const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
const PDF_LIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

function normalized(text) {
  return Array.from(String(text || '').normalize('NFKC').toLowerCase())
    .filter(ch => /[\p{L}\p{N}]/u.test(ch)).join('');
}

export function matchingItems(items, identities = []) {
  let joined = '';
  const owners = [];
  items.forEach((item, index) => {
    for (const ch of Array.from(normalized(item.str))) {
      joined += ch;
      owners.push(index);
    }
  });
  const marked = new Set();
  for (const needle of identities.map(normalized).filter(Boolean)) {
    let offset = 0;
    while (offset < joined.length) {
      const match = joined.indexOf(needle, offset);
      if (match < 0) break;
      for (let i = match; i < match + needle.length; i++) marked.add(owners[i]);
      offset = match + needle.length;
    }
  }
  return marked;
}

export async function inspectPdf(buffer, {makeCandidate = false, onProgress = () => {}, dependencies = null, identities = []} = {}) {
  if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) throw new Error('乐谱文件为空。');
  if (buffer.byteLength > 35 * 1024 * 1024) throw new Error('PDF超过35 MB，无法在浏览器中安全处理。');
  const pdfjs = dependencies?.pdfjs || await import(PDFJS);
  if (!dependencies?.pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  // Loading with a copy leaves the caller's original bytes intact.
  const pdf = await pdfjs.getDocument({data: new Uint8Array(buffer.slice(0)), isEvalSupported: false}).promise;
  if (pdf.numPages > 60) throw new Error('PDF超过60页，请先拆分或手动处理。');
  let meta = {};
  try { meta = (await pdf.getMetadata()).info || {}; } catch (_) {}
  const metaFields = ['Author', 'Creator', 'Producer', 'Title', 'Subject'];
  const normalizedNames = identities.map(normalized).filter(Boolean);
  const metadataHits = metaFields.filter(key => normalizedNames.some(n => normalized(meta[key]).includes(n)));
  const {PDFDocument} = makeCandidate ? (dependencies?.pdfLib || await import(PDF_LIB)) : {PDFDocument: null};
  const output = makeCandidate ? await PDFDocument.create() : null;
  let found = 0, emptyTextPages = 0;
  const pageReports = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(n, pdf.numPages);
    const page = await pdf.getPage(n);
    const text = await page.getTextContent();
    const items = text.items.filter(item => typeof item.str === 'string');
    const marked = matchingItems(items, identities);
    const textChars = items.reduce((count, item) => count + normalized(item.str).length, 0);
    if (!textChars) emptyTextPages++;
    found += marked.size;
    pageReports.push({page: n, detectedItems: marked.size, textExtracted: textChars > 0});
    if (output) {
      const viewport = page.getViewport({scale: 2.25});
      const canvas = dependencies?.createCanvas ? dependencies.createCanvas() : document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', {alpha: false});
      if (!context) throw new Error('浏览器无法渲染PDF页面。');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({canvas, canvasContext: context, viewport}).promise;
      context.fillStyle = '#fff';
      for (const index of marked) {
        const item = items[index];
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.max(Math.hypot(tx[2], tx[3]), Math.abs(item.height * viewport.scale), 8);
        const width = Math.max(Math.abs(item.width * viewport.scale), 4);
        // Hide the entire matching text item. Rotated or outlined lettering may
        // need manual correction; the preview explicitly requires inspection.
        context.fillRect(Math.floor(tx[4] - 4), Math.floor(tx[5] - height * 1.2 - 4),
          Math.ceil(width + 8), Math.ceil(height * 1.6 + 8));
      }
      const imageBlob = dependencies?.canvasToBlob ? await dependencies.canvasToBlob(canvas) : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!imageBlob) throw new Error('无法生成PDF页面图像。');
      const image = await output.embedPng(await imageBlob.arrayBuffer());
      const base = page.getViewport({scale: 1});
      const target = output.addPage([base.width, base.height]);
      target.drawImage(image, {x: 0, y: 0, width: base.width, height: base.height});
      canvas.width = canvas.height = 0;
    }
  }
  let candidate = null;
  if (output) {
    output.setTitle('Score');
    output.setAuthor('');
    output.setSubject('');
    output.setKeywords([]);
    output.setCreator('');
    output.setProducer('');
    candidate = new Blob([await output.save()], {type: 'application/pdf'});
  }
  await pdf.destroy();
  return {pages: pageReports.length, found, metadataHits, emptyTextPages, pageReports, candidate};
}

// Extract only explicitly labelled programme notes; never invent missing text.
export async function extractProgrammeNote(buffer) {
  const pdfjs = await import(PDFJS); pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const pdf = await pdfjs.getDocument({data:new Uint8Array(buffer.slice(0)),isEvalSupported:false}).promise;
  try {
    const pages=[];
    for(let n=1;n<=Math.min(pdf.numPages,12);n++){
      const c=await (await pdf.getPage(n)).getTextContent();
      let out='', lastY=null;
      for(const item of c.items){if(!item.str)continue;const y=Math.round(item.transform?.[5]||0);if(lastY!==null&&Math.abs(y-lastY)>4)out+='\n';else if(out&&!out.endsWith('\n'))out+=' ';out+=item.str;if(item.hasEOL)out+='\n';lastY=y;}
      pages.push(out);
    }
    const all=pages.join('\n\n');
    const heading=/(?:programme|program)\s*notes?\b[ \t]*[:：]?[ \t]*\n/i.exec(all);
    if(!heading) return '';
    const tail=all.slice(heading.index+heading[0].length);
    const stop=/(?:^|\n)[^\n]{0,25}(?:composer[’']?s?\s+statement|performance\s+notes?|instrumentation|duration|composer\s*(?:bio|biography)|about\s+the\s+composer|contents|copyright)\b/i.exec(tail);
    if(!stop) return '';
    const section=tail.slice(0,stop.index).trim();
    const lines=section.split('\n');
    const english=lines.filter(line=>!/[\u3400-\u9fff]/.test(line)).join('\n').trim();
    return english.length>=30 && english.length<=7000 ? english : '';
  } finally {await pdf.destroy();}
}
