import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { extractDocumentText, isExtractableMimeType } from './documentText.ts';

// Run with:  npx tsx --test src/lib/documentText.test.mjs   (from artifacts/api-server)
//
// Real DOCX/XLSX/PDF bytes are built here rather than committed as fixtures,
// so the tests exercise the actual container parsing (ZIP central directory,
// raw DEFLATE, PDF content streams) instead of a hand-waved stub.

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Minimal but spec-correct ZIP writer: local headers + central directory + EOCD. */
function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, content } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

test('reads a real .docx, preserving paragraphs and table rows', () => {
  const documentXml = `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:r><w:t>Term Sheet &amp; Summary</w:t></w:r></w:p>
    <w:p><w:r><w:t>Valuation: $12M pre-money</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Investor</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2,000,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  const buf = buildZip([{ name: 'word/document.xml', content: documentXml }]);

  const result = extractDocumentText(buf, DOCX_MIME);
  assert.equal(result.kind, 'text');
  assert.match(result.text, /Term Sheet & Summary/, 'XML entities decoded');
  assert.match(result.text, /Valuation: \$12M pre-money/);
  assert.match(result.text, /Investor \| 2,000,000/, 'table cells keep their row shape');
  assert.ok(!result.text.includes('<w:'), 'no XML tags leak through');
});

test('reads a real .xlsx, keeping shared strings and empty-cell positions', () => {
  const sharedStrings = `<?xml version="1.0"?><sst><si><t>Month</t></si><si><t>MRR</t></si><si><t>Jan</t></si></sst>`;
  // Row 2 deliberately skips column B so the column-position handling is
  // exercised — a shift here would silently move a founder's numbers into
  // the wrong columns, which is worse than failing to read the file.
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>35000</v></c></row>
  </sheetData></worksheet>`;
  const buf = buildZip([
    { name: 'xl/sharedStrings.xml', content: sharedStrings },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
  ]);

  const result = extractDocumentText(buf, XLSX_MIME);
  assert.equal(result.kind, 'text');
  assert.match(result.text, /Month,MRR/);
  assert.match(result.text, /Jan,,35000/, 'the empty B column is preserved as a gap');
});

test('reads an uncompressed PDF content stream', () => {
  const content = `BT /F1 12 Tf (Revenue was $4.2M last year) Tj ET
BT /F1 12 Tf [(Burn is ) -250 ($310K) -250 ( per month)] TJ ET`;
  const pdf = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n%%EOF`,
    'latin1',
  );

  const result = extractDocumentText(pdf, 'application/pdf');
  assert.equal(result.kind, 'text');
  assert.match(result.text, /Revenue was \$4\.2M last year/);
  assert.match(result.text, /Burn is \$310K per month/, 'kerned TJ arrays are rejoined');
});

test('reads a FlateDecode PDF content stream', () => {
  const content = `BT (Runway: 14 months) Tj ET`;
  const deflated = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.5\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
    deflated,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);

  const result = extractDocumentText(pdf, 'application/pdf');
  assert.equal(result.kind, 'text');
  assert.match(result.text, /Runway: 14 months/);
});

test('a scanned PDF is reported as having no text layer, never guessed at', () => {
  // Image-only PDF: a stream of binary that is neither inflatable nor a
  // content stream. The ONLY acceptable outcome is an honest "no text".
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Subtype /Image >>\nstream\n', 'latin1'),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);

  const result = extractDocumentText(pdf, 'application/pdf');
  assert.equal(result.kind, 'no-text-layer');
  assert.equal(result.text, '');
  assert.match(result.note ?? '', /scan|photo/i, 'the note must tell the founder what to do instead');
});

test('plain text and csv pass straight through', () => {
  const csv = extractDocumentText(Buffer.from('month,mrr\njan,35000'), 'text/csv');
  assert.equal(csv.kind, 'text');
  assert.match(csv.text, /jan,35000/);
});

test('unknown binary formats are declared unsupported, not half-parsed', () => {
  const result = extractDocumentText(Buffer.from([0, 1, 2, 3]), 'application/msword');
  assert.equal(result.kind, 'unsupported');
  assert.equal(result.text, '');
});

test('a corrupt file fails cleanly instead of throwing', () => {
  const result = extractDocumentText(Buffer.from('not a zip at all'), DOCX_MIME);
  assert.ok(result.kind !== 'text');
  assert.equal(result.text, '');
});

test('mime gating matches what the extractor can actually read', () => {
  for (const mime of ['text/plain', 'text/csv', 'application/pdf', DOCX_MIME, XLSX_MIME]) {
    assert.equal(isExtractableMimeType(mime), true, mime);
  }
  for (const mime of ['image/png', 'image/jpeg', 'application/msword']) {
    assert.equal(isExtractableMimeType(mime), false, mime);
  }
});
