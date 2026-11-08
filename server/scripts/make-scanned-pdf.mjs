/** Build testdata/scanned-sample.pdf: a 2-page image-only PDF (no text layer).
 * Page 1 is crisp; page 2 is downscaled and re-upscaled to simulate a blurry scan.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const data = new Uint8Array(await readFile('testdata/chemistry.pdf'));
const task = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false });
const doc = await task.promise;
const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 150 / 72 });
const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
const crisp = await canvas.encode('jpeg', 86);

const small = createCanvas(Math.ceil(canvas.width * 0.14), Math.ceil(canvas.height * 0.14));
small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
const blurryCanvas = createCanvas(canvas.width, canvas.height);
const bctx = blurryCanvas.getContext('2d');
bctx.imageSmoothingEnabled = true;
bctx.drawImage(small, 0, 0, blurryCanvas.width, blurryCanvas.height);
const blurry = await blurryCanvas.encode('jpeg', 25);
await mkdir('.ocr-test/fixture', { recursive: true });
await writeFile('.ocr-test/fixture/page-0001.jpg', crisp);
await writeFile('.ocr-test/fixture/page-0002.jpg', blurry);
await task.destroy();

function pdfWithImages(images, width, height) {
  const objects = [];
  const pageIds = images.map((_, index) => 3 + index * 3);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>`);
  images.forEach((jpeg, index) => {
    const contentId = 4 + index * 3;
    const imageId = 5 + index * 3;
    const stream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
    objects.push(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        ),
        jpeg,
        Buffer.from('\nendstream'),
      ]),
    );
  });
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(offset);
    const head = Buffer.from(`${index + 1} 0 obj\n`);
    const tail = Buffer.from('\nendobj\n');
    const middle = Buffer.isBuffer(body) ? body : Buffer.from(body);
    chunks.push(head, middle, tail);
    offset += head.length + middle.length + tail.length;
  });
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

const onePage = process.argv.includes('--one-page');
const images = onePage ? [crisp] : [crisp, blurry];
const out = onePage ? 'testdata/scanned-one-page.pdf' : 'testdata/scanned-sample.pdf';
const pdf = pdfWithImages(images, Math.ceil(viewport.width), Math.ceil(viewport.height));
await mkdir('testdata', { recursive: true });
await writeFile(out, pdf);
console.log(`${out} ${pdf.length} bytes, page ${canvas.width}x${canvas.height}, ${images.length} page(s)`);
