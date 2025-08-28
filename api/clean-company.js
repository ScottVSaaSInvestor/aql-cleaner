const OpenAI = require("openai");
const { Client: NotionClient } = require("@notionhq/client");

// ---------- CLIENTS ----------
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const notion = new NotionClient({
  auth: process.env.NOTION_API_KEY || process.env.NOTION_KEY,
});

// ---------- HELPERS ----------
function sanitizeText(str) {
  if (!str) return "";
  return String(str).replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, " ");
}
function clamp(str, max) {
  if (!str) return "";
  return str.length <= max ? str : str.slice(0, max);
}
function chunkString(str, size = 2000) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}
function chunkArray(arr, size = 100) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function emptyParagraph() {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: "" } }] },
  };
}
function textToParagraphBlocks(text) {
  const clean = sanitizeText(text);
  if (!clean) return [emptyParagraph()];
  const paras = clean.split(/\n\s*\n/g);
  const blocks = [];
  for (const p of paras) {
    for (const c of chunkString(p, 2000)) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: c } }] },
      });
    }
  }
  return blocks;
}
function headingBlock(text) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ type: "text", text: { content: text || "" } }] },
  };
}
function tocBlock(color = "default") {
  return {
    object: "block",
    type: "table_of_contents",
    table_of_contents: { color },
  };
}

async function maybePolishWithOpenAI(raw, companyName) {
  if (!openai) return raw;
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: "Polish narrative for an investor brief. Keep structure. No markdown." },
      { role: "user", content: `Company: ${companyName || "Unknown"}\n\nText:\n${raw}` },
    ],
  });
  return resp.choices?.[0]?.message?.content?.trim() || raw;
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

// ---------- HANDLER ----------
module.exports = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "clean-company", method: "GET" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = parseBody(req);

    // 🚨 Use Clay's field pageID, or fallback to NOTION_PARENT_ID
    const parentId = body.pageID || process.env.NOTION_PARENT_ID;
    if (!parentId) {
      return res.status(400).json({
        ok: false,
        error: "Missing Notion pageID. Pass it in POST body as { pageID } or set NOTION_PARENT_ID in Vercel.",
      });
    }

    // Build sections from raw or structured input
    let sections = Array.isArray(body.sections) ? body.sections : null;
    if (!sections && body.raw) {
      const text = body.useOpenAI
        ? await maybePolishWithOpenAI(body.raw, body.companyName)
        : body.raw;

      sections = [
        body.companyName
          ? { type: "heading", text: `Cleaned: ${body.companyName}` }
          : { type: "heading", text: "Cleaned Content" },
        { type: "paragraph", text },
      ];
    }
    if (!sections) {
      return res.status(400).json({
        ok: false,
        error: "Provide { pageID, raw } or { pageID, sections: [...] }",
      });
    }

    // Build Notion blocks (TOC + headings/paragraphs)
    const blocks = [];
    if (body.includeTOC !== false) blocks.push(tocBlock(body.tocColor || "default"));
    for (const s of sections) {
      if ((s.type || "paragraph").toLowerCase() === "heading") {
        blocks.push(headingBlock(clamp(s.text || "", 2000)));
      } else {
        blocks.push(...textToParagraphBlocks(s.text || ""));
      }
    }

    // Create the new page inside the given parent page
    const pageTitle = clamp(
      body.title || (body.companyName ? `Cleaned - ${body.companyName}` : "Cleaned Content"),
      100
    );

    const first100 = blocks.slice(0, 100);
    const remainder = blocks.slice(100);

    const page = await notion.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: { title: [{ type: "text", text: { content: pageTitle } }] },
      },
      children: first100,
    });

    // Append remaining blocks in batches of 100
    if (remainder.length) {
      for (const batch of chunkArray(remainder, 100)) {
        await notion.blocks.children.append({
          block_id: page.id,
          children: batch,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      pageId: page.id,
      url: `https://www.notion.so/${page.id.replace(/-/g, "")}`,
      blocksCreated: blocks.length,
      toc: body.includeTOC !== false,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
};
