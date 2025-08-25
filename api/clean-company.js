// api/clean-company.js
// Presentation-ready cleaner with fixed structure

import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Fixed presentation structure
const PRESENTATION_STRUCTURE = {
  tableOfContents: [
    'I. COMPANY OVERVIEW',
    '   a. Company Snapshot',
    '   b. Executive Summary',
    '   c. Business and Product Description',
    '   d. Customer Overview',
    '   e. Core Jobs to be Done',
    '   f. Customer Success Stories',
    '   g. Tech Market Map',
    '   h. Competitive Landscape',
    'II. CONTROL POINTS ANALYSIS',
    '   a. Data Gravity Analysis',
    '   b. Workflow Gravity Analysis',
    '   c. Account Gravity Analysis',
    '   d. Network Effects Analysis',
    '   e. Ecosystem Control Points',
    '   f. Product Extension Analysis',
    '   g. Final Score and Classification',
    'III. STRATEGIC RECOMMENDATIONS'
  ]
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pageId } = req.body;
    console.log('Processing:', pageId);
    
    const rawContent = await fetchNotionContent(pageId);
    const presentationData = createPresentationStructure(rawContent);
    const newPage = await createPresentationPage(presentationData);
    
    return res.status(200).json({ 
      success: true,
      cleanPageId: newPage.id,
      cleanPageUrl: newPage.url
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function fetchNotionContent(pageId) {
  try {
    let content = '';
    let hasMore = true;
    let cursor = undefined;
    
    while (hasMore) {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor
      });
      
      for (const block of response.results) {
        if (block.type === 'paragraph' && block.paragraph.rich_text) {
          content += block.paragraph.rich_text.map(t => t.plain_text).join('') + '\n';
        }
      }
      
      hasMore = response.has_more;
      cursor = response.next_cursor;
    }
    
    return content;
  } catch (error) {
    throw new Error('Failed to fetch: ' + error.message);
  }
}

function createPresentationStructure(raw) {
  // Extract and clean key information
  const companyName = extractCompanyName(raw);
  const snapshot = extractSnapshot(raw);
  
  // Build presentation sections
  const presentation = {
    companyName: companyName,
    snapshot: snapshot,
    executiveSummary: extractExecutiveSummary(raw),
    problem: extractAndCleanSection(raw, 'SECTION 3: THE PROBLEM'),
    solution: extractAndCleanSection(raw, 'SECTION 4: THE SOLUTION'),
    businessDescription: extractAndCleanSection(raw, 'BUSINESS & PRODUCT DESCRIPTION'),
    customers: extractAndCleanSection(raw, 'CUSTOMERS|TARGET AUDIENCE'),
    valueProposition: extractAndCleanSection(raw, 'VALUE PROPOSITION'),
    useCases: extractAndCleanSection(raw, 'USE CASE'),
    roi: extractAndCleanSection(raw, 'RETURN ON INVESTMENT'),
    controlPoints: calculateControlPoints(raw)
  };
  
  return presentation;
}

function extractCompanyName(raw) {
  const patterns = [
    /([A-Za-z]+\.app)/i,
    /([A-Z][a-zA-Z]+)\s+(?:is|exists|operates)/,
    /Company Name:\s*([^\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return match[1];
  }
  return 'Company';
}

function extractSnapshot(raw) {
  const snapshot = {
    yearFounded: 'Not specified',
    location: 'Not specified',
    funding: 'Not specified',
    vertical: 'Vertical SaaS Platform',
    fteCount: 'Not specified'
  };
  
  // Year Founded
  const yearMatch = raw.match(/(?:Year Founded|established in|Founded):\s*(\d{4})/i);
  if (yearMatch) snapshot.yearFounded = yearMatch[1];
  
  // Location  
  const locationMatch = raw.match(/(?:Headquarters|Location|based in):\s*([^\n]+)/i);
  if (locationMatch) snapshot.location = locationMatch[1].trim();
  else if (raw.includes('New York')) snapshot.location = 'New York, New York';
  
  // Funding
  const fundingMatch = raw.match(/(?:Total Funding|raised):\s*\$?([^\n]+)/i);
  if (fundingMatch) snapshot.funding = fundingMatch[1].trim();
  
  // Vertical
  if (raw.includes('sports facility')) snapshot.vertical = 'Sports Facility Management Platform';
  else if (raw.includes('racket sports')) snapshot.vertical = 'Racket Sports Management Platform';
  
  return snapshot;
}

function extractExecutiveSummary(raw) {
  // Get the introduction and clean it up
  const intro = extractAndCleanSection(raw, 'SECTION 1: INTRODUCTION');
  if (intro) {
    // Take first 2-3 sentences as executive summary
    const sentences = intro.split(/(?<=[.!?])\s+/);
    return sentences.slice(0, 3).join(' ');
  }
  
  // Fallback: look for mission statement
  const missionMatch = raw.match(/mission is[^.]+\./i);
  if (missionMatch) return missionMatch[0];
  
  return 'Company overview to be added.';
}

function extractAndCleanSection(raw, sectionPattern) {
  const regex = new RegExp(sectionPattern + '[^]*?(?=SECTION \\d+:|FOUNDING STORY|BUSINESS & PRODUCT|CUSTOMERS|$)', 'i');
  const match = raw.match(regex);
  
  if (!match) return '';
  
  let content = match[0];
  
  // Remove the section header
  content = content.replace(new RegExp(sectionPattern + ':?', 'i'), '');
  
  // Clean up the content
  content = cleanText(content);
  
  return content;
}

function cleanText(text) {
  // Remove excessive whitespace
  text = text.replace(/\s+/g, ' ');
  
  // Fix bullet points
  text = text.replace(/[•·]/g, '•');
  
  // Remove duplicate sentences (common in Clay data)
  const sentences = text.split(/(?<=[.!?])\s+/);
  const unique = [...new Set(sentences)];
  text = unique.join(' ');
  
  // Format numbered lists properly
  text = text.replace(/(\d+)\.\s+/g, '\n$1. ');
  
  // Format bullet points properly  
  text = text.replace(/•\s*/g, '\n• ');
  
  // Clean up multiple newlines
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text.trim();
}

function calculateControlPoints(raw) {
  const scores = {
    dataGravity: 0,
    workflowGravity: 0,
    accountGravity: 0,
    networkEffects: 0,
    ecosystem: 0,
    productExtension: 0
  };
  
  // Score based on keywords (simplified)
  if (raw.match(/centralized|unified|single.*source|data.*repository/i)) scores.dataGravity = 4.5;
  if (raw.match(/automat|workflow|streamlin|process/i)) scores.workflowGravity = 4.5;
  if (raw.match(/membership|retention|customer.*satisfaction/i)) scores.accountGravity = 4;
  if (raw.match(/network|viral|social|collaborat/i)) scores.networkEffects = 3.5;
  if (raw.match(/ecosystem|integrat|platform|API/i)) scores.ecosystem = 4;
  if (raw.match(/AI|machine.*learning|analytics|predictive/i)) scores.productExtension = 4;
  
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  
  let classification = 'POINT SOLUTION';
  if (total >= 25) classification = 'SYSTEM OF RECORD';
  else if (total >= 20) classification = 'CORE SAAS';
  else if (total >= 15) classification = 'SYSTEM OF WORKFLOW';
  
  return { scores, total, classification };
}

async function createPresentationPage(data) {
  const blocks = [];
  
  // Title
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{
        type: 'text',
        text: { content: 'COMPANY OVERVIEW: ' + data.companyName.toUpperCase() },
        annotations: { bold: true }
      }]
    }
  });
  
  // Fixed Table of Contents
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{
        type: 'text',
        text: { content: 'TABLE OF CONTENTS' }
      }]
    }
  });
  
  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        type: 'text',
        text: { content: PRESENTATION_STRUCTURE.tableOfContents.join('\n') }
      }]
    }
  });
  
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  
  // Company Snapshot
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
  
  const snapshotText = [
    'Company Name: ' + data.companyName,
    'Year Founded: ' + data.snapshot.yearFounded,
    'Location: ' + data.snapshot.location,
    'Website: ' + data.companyName.toLowerCase().replace(/\s+/g, ''),
    'Software Category & Vertical: ' + data.snapshot.vertical,
    'FTE Count: ' + data.snapshot.fteCount,
    'Funding History: ' + data.snapshot.funding
  ].join('\n');
  
  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        type: 'text',
        text: { content: snapshotText }
      }]
    }
  });
  
  // Control Points Callout
  blocks.push({
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{
        type: 'text',
        text: { 
          content: 'CONTROL POINTS: FINAL SCORE: ' + data.controlPoints.total.toFixed(1) + ' / 30 ——> ' + data.controlPoints.classification
        },
        annotations: { bold: true }
      }],
      icon: { type: 'emoji', emoji: '⭐' }
    }
  });
  
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  
  // Executive Summary
  if (data.executiveSummary) {
    blocks.push({
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{
          type: 'text',
          text: { content: 'EXECUTIVE SUMMARY' }
        }]
      }
    });
    
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: data.executiveSummary }
        }]
      }
    });
  }
  
  // Problem & Solution sections
  const sections = [
    { title: 'THE PROBLEM', content: data.problem },
    { title: 'THE SOLUTION', content: data.solution },
    { title: 'BUSINESS AND PRODUCT DESCRIPTION', content: data.businessDescription },
    { title: 'CUSTOMER OVERVIEW', content: data.customers },
    { title: 'VALUE PROPOSITION', content: data.valueProposition },
    { title: 'USE CASES', content: data.useCases },
    { title: 'RETURN ON INVESTMENT', content: data.roi }
  ];
  
  for (const section of sections) {
    if (section.content) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: section.title }
          }]
        }
      });
      
      // Add content as formatted blocks
      formatContentBlocks(blocks, section.content);
    }
  }
  
  // Create the page
  const response = await notion.pages.create({
    parent: { page_id: process.env.NOTION_CLEANED_PARENT_PAGE_ID },
    icon: { type: 'emoji', emoji: '✨' },
    cover: {
      type: 'external',
      external: {
        url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&h=300&fit=crop'
      }
    },
    properties: {
      title: {
        title: [{
          text: { content: data.companyName + ' - Cleaned' }
        }]
      }
    },
    children: blocks.slice(0, 100)
  });
  
  // Add remaining blocks if needed
  if (blocks.length > 100) {
    for (let i = 100; i < blocks.length; i += 100) {
      await notion.blocks.children.append({
        block_id: response.id,
        children: blocks.slice(i, Math.min(i + 100, blocks.length))
      });
    }
  }
  
  return response;
}

function formatContentBlocks(blocks, content) {
  // Split content into proper blocks
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('•')) {
      // Bullet point
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{
            type: 'text',
            text: { content: trimmed.substring(1).trim() }
          }]
        }
      });
    } else if (trimmed.match(/^\d+\./)) {
      // Numbered list
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{
            type: 'text',
            text: { content: trimmed.replace(/^\d+\.\s*/, '') }
          }]
        }
      });
    } else {
      // Regular paragraph
      // Split if too long
      if (trimmed.length > 1900) {
        const chunks = trimmed.match(/.{1,1900}/g) || [];
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: { content: chunk }
              }]
            }
          });
        }
      } else {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: trimmed }
            }]
          }
        });
      }
    }
  }
}
