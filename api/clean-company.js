// api/clean-company.js
// Full content preservation cleaner

import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pageId } = req.body;
    console.log('Cleaning request received for:', pageId);
    
    const rawContent = await fetchAllNotionContent(pageId);
    const organizedContent = organizeContent(rawContent);
    const newPage = await createFullNotionPage(organizedContent);
    
    return res.status(200).json({ 
      success: true,
      cleanPageId: newPage.id,
      cleanPageUrl: newPage.url,
      message: `Successfully cleaned content`
    });
    
  } catch (error) {
    console.error('Cleaning error:', error);
    return res.status(500).json({ 
      error: error.message,
      details: 'Check Vercel logs'
    });
  }
}

async function fetchAllNotionContent(pageId) {
  try {
    let allContent = '';
    let hasMore = true;
    let startCursor = undefined;
    
    while (hasMore) {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: startCursor
      });
      
      for (const block of response.results) {
        if (block.type === 'paragraph' && block.paragraph.rich_text) {
          const text = block.paragraph.rich_text.map(t => t.plain_text).join('');
          if (text.trim()) allContent += text + '\n';
        } else if (block.type === 'heading_1' && block.heading_1.rich_text) {
          const text = block.heading_1.rich_text.map(t => t.plain_text).join('');
          if (text.trim()) allContent += '\n' + text + '\n';
        } else if (block.type === 'heading_2' && block.heading_2.rich_text) {
          const text = block.heading_2.rich_text.map(t => t.plain_text).join('');
          if (text.trim()) allContent += '\n' + text + '\n';
        } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text) {
          const text = block.bulleted_list_item.rich_text.map(t => t.plain_text).join('');
          if (text.trim()) allContent += '• ' + text + '\n';
        }
      }
      
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }
    
    return allContent;
  } catch (error) {
    throw new Error(`Failed to fetch content: ${error.message}`);
  }
}

function organizeContent(raw) {
  const companyName = raw.match(/([A-Za-z]+\.app)/i)?.[1] || 'Company';
  const yearFounded = raw.match(/Year Founded:\s*(\d{4})|established in\s+(\d{4})/i)?.[1] || '2023';
  const location = raw.match(/Headquarters Location:\s*([^\n]+)|New York,\s*New York/i)?.[1] || 'New York, New York';
  const funding = raw.match(/Total Funding:\s*([^\n]+)|\$(\d+\s*(?:million|M))/i)?.[1] || 'Not specified';
  
  let controlScore = 0;
  if (raw.includes('automat') || raw.includes('workflow')) controlScore += 5;
  if (raw.includes('data') && raw.includes('centralized')) controlScore += 5;
  if (raw.includes('membership') || raw.includes('retention')) controlScore += 4.5;
  if (raw.includes('network') || raw.includes('viral')) controlScore += 4;
  if (raw.includes('ecosystem') || raw.includes('integration')) controlScore += 4;
  if (raw.includes('analytics') || raw.includes('AI')) controlScore += 4;
  
  const classification = controlScore >= 25 ? 'SYSTEM OF RECORD' : 
                         controlScore >= 20 ? 'CORE SAAS' :
                         controlScore >= 15 ? 'SYSTEM OF WORKFLOW' : 'POINT SOLUTION';
  
  const sections = {};
  
  const sectionMarkers = [
    { key: 'introduction', start: 'SECTION 1: INTRODUCTION', end: 'SECTION 2:' },
    { key: 'marketContext', start: 'SECTION 2: MARKET CONTEXT', end: 'SECTION 3:' },
    { key: 'problem', start: 'SECTION 3: THE PROBLEM', end: 'SECTION 4:' },
    { key: 'solution', start: 'SECTION 4: THE SOLUTION', end: 'SECTION 5:' },
    { key: 'valueProposition', start: 'SECTION 5: UNIQUE VALUE PROPOSITION', end: 'SECTION 6:' },
    { key: 'keyFeatures', start: 'SECTION 6: KEY FEATURES', end: 'SECTION 7:' },
    { key: 'implementation', start: 'SECTION 7: IMPLEMENTATION', end: 'SECTION 8:' },
    { key: 'whyItMatters', start: 'SECTION 8: WHY THIS MATTERS', end: 'SECTION 9:' },
    { key: 'targetAudience', start: 'SECTION 9: TARGET AUDIENCE', end: 'SECTION 10:' },
    { key: 'useCases', start: 'SECTION 10: USE CASE', end: 'SECTION 11:' },
    { key: 'roi', start: 'SECTION 11: RETURN ON INVESTMENT', end: null },
    { key: 'foundingStory', start: 'FOUNDING STORY', end: null },
    { key: 'businessDescription', start: 'BUSINESS & PRODUCT DESCRIPTION', end: null },
    { key: 'customers', start: 'CUSTOMERS', end: null }
  ];
  
  for (const { key, start, end } of sectionMarkers) {
    const startIdx = raw.indexOf(start);
    if (startIdx !== -1) {
      const contentStart = startIdx + start.length;
      let contentEnd = raw.length;
      
      if (end) {
        const endIdx = raw.indexOf(end, contentStart);
        if (endIdx !== -1) contentEnd = endIdx;
      }
      
      sections[key] = raw.substring(contentStart, contentEnd).trim();
    }
  }
  
  return {
    companyName,
    yearFounded,
    location,
    funding,
    controlScore,
    classification,
    raw: raw,
    sections
  };
}

async function createFullNotionPage(data) {
  try {
    const blocks = [];
    
    blocks.push({
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{
          type: 'text',
          text: { content: `COMPANY OVERVIEW: ${data.companyName.toUpperCase()}` },
          annotations: { bold: true }
        }]
      }
    });
    
    blocks.push({
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [{
          type: 'text',
          text: { content: 'TABLE OF CONTENTS' }
        }],
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: `I. COMPANY OVERVIEW
II. BUSINESS AND PRODUCT DESCRIPTION  
III. CUSTOMER OVERVIEW
IV. COMPETITIVE LANDSCAPE
V. CONTROL POINTS ANALYSIS` }
            }]
          }
        }]
      }
    });
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
    
    blocks.push({
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{
          type: 'text',
          text: { content: 'COMPANY SNAPSHOT' }
        }]
      }
    });
    
    const snapshotText
