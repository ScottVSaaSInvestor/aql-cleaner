// api/clean-company.js  (v1.1 – chunked blocks)
// Env: NOTION_TOKEN, NOTION_CLEANED_PARENT_PAGE_ID, DRY_RUN (true/false)

const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const CLEAN_PARENT = process.env.NOTION_CLEANED_PARENT_PAGE_ID; // <-- matches your env
const DRY_RUN = (process.env.DRY_RUN || 'false').toLowerCase() === 'true';

// ---------- TOC (locked) ----------
const TOC = [
  '1. Company Snapshot',
  '2. Business Summary',
  '3. Product Overview',
  '4. Vertical Specificity',
  '5. Customer Overview',
  '6. ICP Analysis',
  '7. Customer Jobs to Be Done',
  '8. Customer Success Stories',
  '9. Market Overview',
  '10. TAM / SAM / SOM',
  '11. Competitive Analysis',
  '12. Competitive Market Map',
];
const CONTROL_TOC = [
  '1. Data Gravity Analysis',
  '2. Workflow Gravity Analysis',
  '3. Account Gravity Analysis',
  '4. Network Effects Analysis',
  '5. Ecosystem Control Points Analysis',
  '6. Product Extension Analysis',
  '7. Final Control Points Conclusions',
  '8. Final Total Score and Classification',
];
const keyCompany = (t) => `Company Overview:${t}`;
const keyControl  = (t) => `Part 2: Control Points Analysis:${t}`;

// ---------- Notion helpers ----------
async function fetchAllChildren(block_id) {
  const out = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id, page_size: 100, start_cursor: cursor });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}
async function fetchBlocksDeep(block_id, acc = []) {
  const kids = await fetchAllChildren(block_id);
  for (const b of kids) {
    acc.push(b);
    if (b.has_children) await fetchBlocksDeep(b.id, acc);
  }
  return acc;
}
const rtText = (rt) => (rt || []).map((t) => t.plain_text || '').join('');
function blockToLines(block) {
  const t = block.type;
  if (t === 'paragraph')           return [rtText(block.paragraph.rich_text)];
  if (t === 'bulleted_list_item')  return ['- ' + rtText(block.bulleted_list_item.rich_text)];
  if (t === 'numbered_list_item')  return ['1. ' + rtText(block.numbered_list_item.rich_text)];
  if (t === 'heading_1')           return ['# '   + rtText(block.heading_1.rich_text)];
  if (t === 'heading_2')           return ['## '  + rtText(block.heading_2.rich_text)];
  if (t === 'heading_3')           return ['### ' + rtText(block.heading_3.rich_text)];
  if (t === 'quote')               return ['> '   + rtText(block.quote.rich_text)];
  if (t === 'callout')             return [rtText(block.callout.rich_text)];
  if (t === 'toggle')              return [rtText(block.toggle.rich_text)];
  if (t === 'to_do') {
    const txt = rtText(block.to_do.rich_text);
    const chk = block.to_do.checked ? 'x' : ' ';
    return [`- [${chk}] ${txt}`];
  }
  return []; // ignore images/files/dividers
}

// ---------- Cleaning & routing ----------
function stripCruft(line) {
  let s = (line || '')
    .replace(/^=+\s*.*?=+\s*$/g, '')                 // "=== TITLE ==="
    .replace(/\bStep\s*\d+\b/gi, '')                 // Step 2
    .replace(/\((?:\d+\s*-\s*)?\d+\s*words?\)/gi, '')// (75–150 words)
    .replace(/\u00A0/g, ' ')
    .trim();
  s = s.replace(/^###\s*Section\s*\d+\s*:?\s*/i, '').replace(/^Section\s*\d+\s*:?\s*/i, '');
  return s;
}
function identifySection(allLines) {
  const buckets = new Map();
  const push = (k, txt) => { if (!txt) return; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(txt); };
  const RX = [
    [/company\s*snapshot|company[_\s-]*snap/i,                  keyCompany('1. Company Snapshot')],
    [/business\s*summary|executive\s*summary/i,                 keyCompany('2. Business Summary')],
    [/product\s*overview|key\s*modules|value\s*proposition/i,   keyCompany('3. Product Overview')],
    [/vertical\s*specific/i,                                    keyCompany('4. Vertical Specificity')],
    [/customer\s*overview/i,                                    keyCompany('5. Customer Overview')],
    [/ICP|ideal customer profile|segmentation|personas/i,       keyCompany('6. ICP Analysis')],
    [/jobs?\s*to\s*be\s*done|JTBD/i,                            keyCompany('7. Customer Jobs to Be Done')],
    [/customer\s*success|case\s*studies/i,                      keyCompany('8. Customer Success Stories')],
    [/market\s*overview|market\s*context/i,                     keyCompany('9. Market Overview')],
    [/TAM\s*\/\s*SAM\s*\/\s*SOM|market sizing|TAM\/SAM\/SOM/i,  keyCompany('10. TAM / SAM / SOM')],
    [/competitive\s*analysis|competitive\s*landscape|positioning/i, keyCompany('11. Competitive Analysis')],
    [/market\s*map/i,                                           keyCompany('12. Competitive Market Map')],
    [/data\s*gravity/i,                                         keyControl('1. Data Gravity Analysis')],
    [/workflow\s*gravity/i,                                     keyControl('2. Workflow Gravity Analysis')],
    [/account\s*gravity/i,                                      keyControl('3. Account Gravity Analysis')],
    [/network\s*effects/i,                                      keyControl('4. Network Effects Analysis')],
    [/ecosystem\s*control/i,                                    keyControl('5. Ecosystem Control Points Analysis')],
    [/product\s*extension/i,                                    keyControl('6. Product Extension Analysis')],
    [/final\s*control\s*points\s*conclusions/i,                 keyControl('7. Final Control Points Conclusions')],
    [/final\s*total\s*score|classification/i,                   keyControl('8. Final Total Score and Classification')],
  ];
  let current = null;
  const hit = (line) => { for (const [rx, key] of RX) if (rx.test(line)) return key; return null; };
  for (const raw of allLines) {
    const line = stripCruft(raw);
    if (!line) continue;
    const maybe = hit(line);
    if (maybe) { current = maybe; continue; }
    if (!current) current = keyCompany('2. Business Summary'); // safe default
    push(current, line);
  }
  return buckets;
}
function compileMarkdown(buckets) {
  const md = [];
  md.push('# Company Overview', '');
  for (const title of TOC) {
    const k = keyCompany(title); const body = buckets.get(k) || []; if (!body.length) continue;
    md.push(`## ${title}`); md.push(...body); md.push('---');
  }
  md.push('# Part 2: Control Points Analysis', '');
  for (const title of CONTROL_TOC) {
    const k = keyControl(title); const body = buckets.get(k) || []; if (!body.length) continue;
    md.push(`## ${title}`); md.push(...body); md.push('---');
  }
  while (md.length && md[md.length - 1] === '---') md.pop();
  return md.join('\n');
}

// ---------- Chunking (fixes 2000-char limit) ----------
function chunkText(text, size = 1900) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    const nl = text.lastIndexOf('\n', end);
    if (nl > i + 500) end = nl; // try to split on newline if not too far back
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}
function makeCodeBlocks(title, text, lang = 'markdown') {
  const chunks = chunkText(text);
  const blocks = [];
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: title } }] }
  });
  chunks.forEach((piece, idx) => {
    const label = chunks.length > 1 ? ` (Part ${idx + 1} of ${chunks.length})` : '';
    blocks.push({
      object: 'block',
      type: 'callout',
      callout: { icon: { emoji: '🧩' }, rich_text: [{ type: 'text', text: { content: `${title}${label}` } }] }
    });
    blocks.push({
      object: 'block',
      type: 'code',
      code: { language: lang, rich_text: [{ type: 'text', text: { content: piece } }] }
    });
  });
  return { blocks, count: chunks.length };
}

// ---------- Create Clean page (uses chunked blocks) ----------
async function createCleanPage(companyName, markdown, jsonObj) {
  if (DRY_RUN) return { pageId: null, markdownChunks: 0, jsonChunks: 0 };
  if (!CLEAN_PARENT) throw new Error('NOTION_CLEANED_PARENT_PAGE_ID is missing');

  const jsonPretty = JSON.stringify(jsonObj, null, 2);
  const mdParts   = makeCodeBlocks('Gamma-ready Markdown', markdown, 'markdown');
  const jsParts   = makeCodeBlocks('JSON (for QA / App layer)', jsonPretty, 'json');

  const children  = [...mdParts.blocks, ...jsParts.blocks];

  const page = await notion.pages.create({
    parent: { page_id: CLEAN_PARENT }, // NOTE: parent is a PAGE. If yours is a DATABASE, tell me.
    properties: {
      title: { title: [{ type: 'text', text: { content: `Company – Cleaned for Presentation: ${companyName}` } }] }
    },
    children
  });

  return { pageId: page.id, markdownChunks: mdParts.count, jsonChunks: jsParts.count };
}

// ---------- Handler ----------
module.exports = async (req, res) => {
  try {
    const { pageId, companyName = 'Unknown Company' } = req.body || {};
    if (!pageId) return res.status(400).json({ error: 'Missing pageId' });

    const blocks  = await fetchBlocksDeep(pageId);
    const lines   = blocks.flatMap(blockToLines).filter(Boolean);
    const buckets = identifySection(lines);

    const markdown = compileMarkdown(buckets);
    const jsonObj  = {
      company: companyName,
      sections: [
        ...TOC.map(t => ({ scope: 'Company Overview', title: t, body_md: (buckets.get(keyCompany(t)) || []).join('\n') })).filter(s => s.body_md),
        ...CONTROL_TOC.map(t => ({ scope: 'Part 2: Control Points Analysis', title: t, body_md: (buckets.get(keyControl(t)) || []).join('\n') })).filter(s => s.body_md),
      ],
      meta: { version: 'cleaner-v1.1', generated_at: new Date().toISOString() }
    };

    const write = await createCleanPage(companyName, markdown, jsonObj);

    return res.status(200).json({
      ok: true,
      wrote: !DRY_RUN,
      companyName,
      sections: jsonObj.sections.length,
      cleanedMarkdownBytes: markdown.length,
      notionPageId: write.pageId,
      markdownChunks: write.markdownChunks,
      jsonChunks: write.jsonChunks
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
};
