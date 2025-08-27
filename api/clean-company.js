// api/clean-company.js
// FULL RIP-AND-REPLACE VERSION
// - Fixes Notion 2000-char limit by auto-chunking long text
// - Works with Page parent or Database parent
// - Safe GET health check
// - Minimal OpenAI usage (optional)
// CommonJS for Vercel Node functions.

const OpenAI = require("openai");
const { Client: NotionClient } = require("@notionhq/client");

// ---- ENV SETUP ----
// OpenAI is optional (used only if useOpenAI: true in request)
const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

// Notion is required
const notion = new NotionClient({
  auth: process.env.NOTION_API_KEY || process.env.NOTION_KEY || process.env.NOTION_SECRET,
});

// If you prefer not to pass parentId in POST body every time, set one of these:
//   NOTION_PARENT_ID (page or database id)  OR  NOTION_DATABASE_ID (database id)
const DEFAULT_PARENT_ID =
  process.env.NOTION_PARENT_ID || process.env.NOTION_DATABASE_ID || "";

// ---- UTILITIES ----
function clamp(str, max) {
  if (!str) return "";
  return str.length <= max ? str : str.slice(0, max);
}

function sanitizeText(str) {
  if (!str) return "";
  // remove control chars Notion may reject (except \n \r \t)
  return String(str).replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, " ");
}

function chunkString(str, size = 2000) {
  const out = [];
  for (let i = 0; i < str.length; i += size) {
    out.push(str.slice(i, i + size));
  }
  return out;
}

function chunkArray(arr, size = 100) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// Turn long text into multiple paragraph blocks (≤2000 chars each)
function textToParagraphBlocks(text) {
  const clean = sanitizeText(text);
  if (!clean) {
    return [
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "" } }] },
      },
    ];
  }

  // First split on blank lines to preserve paragraphs, then chunk each paragraph
  const paras = clean.split(/\n\s*\n/g);
  const blocks = [];
  for (const p of paras) {
    const chunks = chunkString(p, 2000);
    for (const c of chunks) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: c } }],
        },
      });
    }
  }
  return blocks;
}

// Turn long text into multiple code blocks (≤2000 chars each)
function textToCodeBlocks(text, language = "plain text") {
  const clean = sanitizeText(text);
  if (!clean) {
    return [
      {
        object: "block",
        type: "code",
        code: { language, rich_text: [{ type: "text", text: { content: "" } }] },
      },
    ];
  }
  const chunks = chunkString(clean, 2000);
  return chunks.map((c) => ({
    object: "block",
    type: "code",
    code: { language, rich_text: [{ type: "text", text: { content: c } }] },
  }));
}

function headingBlock(text, level = 2) {
  const t = clamp(sanitizeText(text), 2000);
  const type = level === 1 ? "heading_1" : level === 3 ? "heading_3" : "heading_2";
  return {
    object: "block",
    type,
    [type]: {
      rich_text: [{ type: "text", text: { content: t } }],
    },
  };
}

// Build blocks from a simple "sections" array
// Each section: { type: "heading"|"paragraph"|"code", text: "..." , language?: "javascript"|... }
function buildBlocksFromSections(sections = []) {
  const out = [];
  for (const s of sections) {
    const kind = (s.type || "paragraph").toLowerCase();
    if (kind === "heading") {
      out.push(headingBlock(s.text || ""));
    } else if (kind === "code") {
      out.push(...textToCodeBlocks(s.text || "", s.language || "plain text"));
    } else {
      out.push(...textToParagraphBlocks(s.text || ""));
    }
  }
  return out;
}

// Create a Notion page with children; supports both Database or Page parent
async function createNotionPage({ parentId, parentType, title, children }) {
  const pageTitle = clamp(title || "Cleaned Content", 100);

  // Decide parent type
  let parent;
  if (parentType === "database") {
    parent = { database_id: parentId };
  } else if (parentType === "page") {
    parent = { page_id: parentId };
  } else {
    // If DEFAULT_PARENT_ID looks like a database, caller can pass parentType; otherwise default to page
    parent = { page_id: parentId };
  }

  const initialChildren = children.slice(0, 100);
  const remainder = children.slice(100);

  // Try database first if specified, else page
  const tryCreate = async (asDatabase) => {
    if (asDatabase) {
      // Most DBs use "Name" for title; allow override via env/body later if needed
      return await notion.pages.create({
        parent: { database_id: parentId },
        properties: {
          Name: {
            title: [{ type: "text", text: { content: pageTitle } }],
          },
        },
        children: initialChildren,
      });
    } else {
      return await notion.pages.create({
        parent: { page_id: parentId },
        properties: {
          title: {
            title: [{ type: "text", text: { content: pageTitle } }],
          },
        },
        children: initialChildren,
      });
    }
  };

  let page;
  try {
    if (parent.database_id || parentType === "database") {
      page = await tryCreate(true);
    } else {
      page = await tryCreate(false);
    }
  } catch (err) {
    // Fallback: if database creation fails (wrong title prop), try as page parent
    if (parentType === "database") throw err;
    page = await tryCreate(false);
  }

  // Append remaining blocks in batches of 100
  if (remainder.length) {
    const batches = chunkArray(remainder, 100);
    for (const batch of batches) {
      await notion.blocks.children.append({
        block_id: page.id,
        children: batch,
      });
    }
  }

  return page;
}

// Optional: minimal polishing via OpenAI
async function maybePolishWithOpenAI(raw, companyName) {
  if (!openai) return raw;
  const prompt = [
    { role: "system", content: "You polish narrative content for investor briefs. Keep structure, improve clarity. No markdown, no headings unless provided." },
    { role: "user", content: `Company: ${companyName || "Unknown"}\n\nText:\n${raw}` },
  ];
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: prompt,
    temperature: 0.2,
  });
  return resp.choices?.[0]?.message?.content?.trim() || raw;
}

// Safe body parsing (Vercel often gives parsed JSON already)
function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

// ---- HANDLER ----
module.exports = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "clean-company", method: "GET" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = getBody(req);

    // Inputs you can provide in the POST body:
    // - parentId (required if no env default)
    // - parentType: "page" | "database"  (default: "page")
    // - title: string
    // - companyName: string
    // - sections: [{type:"heading"|"paragraph"|"code", text:"...", language?}]
    // - raw: string (fallback if no sections)
    // - useOpenAI: boolean (defaults false)
    const parentId = body.parentId || DEFAULT_PARENT_ID;
    const parentType = body.parentType || (process.env.NOTION_DATABASE_ID ? "database" : "page");

    if (!parentId) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing Notion parentId. Set NOTION_PARENT_ID or NOTION_DATABASE_ID in Vercel, or include { parentId } in the POST body.",
      });
    }

    // Build content
    let sections = Array.isArray(body.sections) ? body.sections : null;

    if (!sections && body.raw) {
      // Minimal: one heading + a big paragraph (will be auto-chunked)
      const text = body.useOpenAI ? await maybePolishWithOpenAI(body.raw, body.companyName) : body.raw;
      sections = [
        body.companyName ? { type: "heading", text: `Cleaned: ${body.companyName}` } : { type: "heading", text: "Cleaned Content" },
        { type: "paragraph", text },
      ];
    }

    if (!sections) {
      return res.status(400).json({
        ok: false,
        error:
          "Provide content via { sections: [...] } or { raw: \"...\" }. See example in response.",
        example: {
          parentId: "YOUR_PAGE_OR_DB_ID",
          parentType: "page",
          title: "Cleaned - ExampleCo",
          companyName: "ExampleCo",
          useOpenAI: false,
          sections: [
            { type: "heading", text: "Executive Summary" },
            { type: "paragraph", text: "This is a long paragraph that will be split into <=2000 char blocks automatically..." },
            { type: "code", language: "plain text", text: "Optional: paste long raw here; will be chunked into code blocks." }
          ],
        },
      });
    }

    const title = body.title || (body.companyName ? `Cleaned - ${body.companyName}` : "Cleaned Content");
    const blocks = buildBlocksFromSections(sections);

    const page = await createNotionPage({
      parentId,
      parentType,
      title,
      children: blocks,
    });

    // Build a friendly URL
    const notionUrl = `https://www.notion.so/${page.id.replace(/-/g, "")}`;

    return res.status(200).json({
      ok: true,
      pageId: page.id,
      url: notionUrl,
      blocksCreated: blocks.length,
      parentTypeUsed: parentType,
    });
  } catch (err) {
    // Surface Notion validation clearly
    let details = String(err);
    try {
      if (err && err.body) {
        details += ` | Notion body: ${err.body}`;
      }
    } catch {}
    return res.status(500).json({ ok: false, error: details });
  }
};
