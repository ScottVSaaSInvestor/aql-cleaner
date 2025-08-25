// api/clean-company.js
// Full section preservation version - no truncation

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
    
    // Fetch content from Notion
    const rawContent = await fetchNotionContent(pageId);
    
    // Structure the content preserving FULL sections
    const structuredData = structureCompanyData(rawContent);
    
    // Create new clean page with all content
    const newPage = await createCleanNotionPage(structuredData);
    
    return res.status(200).json({ 
      success: true,
      cleanPageId: newPage.id,
      cleanPageUrl: newPage.url,
      message: `Successfully cleaned ${structuredData.companyName}`
    });
    
  } catch (error) {
    console.error('Cleaning error:', error);
    return res.status(500).json({ 
      error: error.message,
      details: 'Check Vercel logs'
    });
  }
}

async function fetchNotionContent(pageId) {
  try {
    const blocks = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100
    });
    
    let content = '';
    for (const block of blocks.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text) {
        content += block.paragraph.rich_text.map(t => t.plain_text).join('') + '\n';
      }
      if (block.type === 'heading_1' && block.heading_1.rich_text) {
        content += '\n' + block.heading_1.rich_text.map(t => t.plain_text).join('') + '\n';
      }
      if (block.type === 'heading_2' && block.heading_2.rich_text) {
        content += '\n' + block.heading_2.rich_text.map(t => t.plain_text).join('') + '\n';
      }
      if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text) {
        content += '• ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join('') + '\n';
      }
    }
    
    return content;
  } catch (error) {
    throw new Error(`Failed to fetch Notion content: ${error.message}`);
  }
}

function structureCompanyData(raw) {
  // Extract basic company info
  const companyName = extractCompanyName(raw);
  const yearFounded = extractYearFounded(raw);
  const location = extractLocation(raw);
  const funding = extractFunding(raw);
  const fteCount = extractFTECount(raw);
  
  // Extract ALL sections without truncation
  const sections = extractAllSections(raw);
  
  // Calculate control points
  const controlScore = calculateControlPoints(raw);
  const classification = getClassification(controlScore);
  
  // Determine vertical based on content
  const vertical = extractVertical(raw);

  return {
    companyName,
    yearFounded,
    location,
    funding,
    website: companyName.toLowerCase().replace(/\s+/g, ''),
    vertical,
    fteCount,
    controlScore,
    classification,
    sections
  };
}

function extractCompanyName(raw) {
  // Look for .app companies first
  const appMatch = raw.match(/([A-Za-z]+\.app)/i);
  if (appMatch) return appMatch[1];
  
  // Look for company patterns
  const patterns = [
    /([A-Z][a-zA-Z]+)\s+(?:exists|is|operates|provides|delivers)/,
    /INTRODUCTION\s+([A-Z][a-zA-Z]+)\s+/,
    /Executive Summary.*?for\s+([A-Z][a-zA-Z]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return 'Company';
}

function extractYearFounded(raw) {
  const patterns = [
    /Year Founded:\s*(\d{4})/i,
    /Founded:\s*(\d{4})/i,
    /established in\s+(\d{4})/i,
    /In\s+(\d{4}),.*?established/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return 'Not specified';
}

function extractLocation(raw) {
  const patterns = [
    /Headquarters Location:\s*([^\n]+)/i,
    /Location:\s*([^\n]+)/i,
    /based in\s+([^,\n]+,\s*[^,\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  if (raw.includes('New York, New York')) return 'New York, New York';
  if (raw.includes('New York, NY')) return 'New York, New York';
  
  return 'Not specified';
}

function extractFunding(raw) {
  const patterns = [
    /Total Funding:\s*\$?([^\n]+)/i,
    /\$(\d+(?:\.\d+)?\s*(?:million|Million|M))\s*\([^)]+\)/i,
    /raised\s+\$?([^\n\)]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return 'Not specified';
}

function extractFTECount(raw) {
  const patterns = [
    /Current Employee Count:\s*([^\n]+)/i,
    /Employee Count:\s*([^\n]+)/i,
    /FTE.*?:\s*([0-9,]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      const count = match[1].trim();
      if (count.includes('Not Available')) return 'Not specified';
      return count;
    }
  }
  return 'Not specified';
}

function extractVertical(raw) {
  // Determine vertical based on content
  if (raw.includes('sports facility') || raw.includes('sports venue')) {
    return 'Sports Facility Management Platform';
  }
  if (raw.includes('racket sports')) {
    return 'Racket Sports Management Platform';
  }
  if (raw.includes('autonomous venue')) {
    return 'Autonomous Venue Management Platform';
  }
  if (raw.includes('Vertical SaaS') || raw.includes('VSaaS')) {
    return 'Vertical SaaS Platform';
  }
  return 'SaaS Platform';
}

function extractAllSections(raw) {
  const sections = {};
  
  // Define all section markers from your Clay data
  const sectionDefinitions = [
    { key: 'introduction', markers: ['SECTION 1: INTRODUCTION'] },
    { key: 'marketContext', markers: ['SECTION 2: MARKET CONTEXT'] },
    { key: 'problem', markers: ['SECTION 3: THE PROBLEM'] },
    { key: 'solution', markers: ['SECTION 4: THE SOLUTION'] },
    { key: 'valueProposition', markers: ['SECTION 5: UNIQUE VALUE PROPOSITION'] },
    { key: 'keyFeatures', markers: ['SECTION 6: KEY FEATURES'] },
    { key: 'implementation', markers: ['SECTION 7: IMPLEMENTATION'] },
    { key: 'whyItMatters', markers: ['SECTION 8: WHY THIS MATTERS'] },
    { key: 'targetAudience', markers: ['SECTION 9: TARGET AUDIENCE'] },
    { key: 'useCases', markers: ['SECTION 10: USE CASE'] },
    { key: 'roi', markers: ['SECTION 11: RETURN ON INVESTMENT'] },
    { key: 'foundingStory', markers: ['FOUNDING STORY', '1. FOUNDING STORY'] },
    { key: 'businessDescription', markers: ['BUSINESS & PRODUCT DESCRIPTION', '2. BUSINESS & PRODUCT DESCRIPTION'] },
    { key: 'customers', markers: ['CUSTOMERS', '3. CUSTOMERS'] },
    { key: 'competitivePositioning', markers: ['COMPETITIVE POSITIONING', '6. COMPETITIVE POSITIONING'] }
  ];
  
  // Extract each section WITHOUT TRUNCATION
  sectionDefinitions.forEach(({ key, markers }) => {
    for (const marker of markers) {
      const content = extractSectionContent(raw, marker);
      if (content && content.length > 10) {
        sections[key] = content;
        break;
      }
    }
  });
  
  return sections;
}

function extractSectionContent(text, startMarker) {
  const startIndex = text.indexOf(startMarker);
  if (startIndex === -1) return null;
  
  // Find where this section ends (next section or document end)
  const possibleEndMarkers = [
    'SECTION 1:', 'SECTION 2:', 'SECTION 3:', 'SECTION 4:', 'SECTION 5:',
    'SECTION 6:', 'SECTION 7:', 'SECTION 8:', 'SECTION 9:', 'SECTION 10:',
    'SECTION 11:', 'FOUNDING STORY', 'BUSINESS & PRODUCT', 'CUSTOMERS',
    'COMPETITIVE POSITIONING', '–––––', 'ADDITIONAL COMPANY'
  ];
  
  const contentStart = startIndex + startMarker.length;
  let endIndex = text.length;
  
  // Find the nearest end marker
  for (const endMarker of possibleEndMarkers) {
    const markerIndex = text.indexOf(endMarker, contentStart);
    if (markerIndex > contentStart && markerIndex < endIndex) {
      endIndex = markerIndex;
    }
  }
  
  // Return FULL section content without truncation
  return text.substring(contentStart, endIndex).trim();
}

function calculateControlPoints(raw) {
  let score = 0;
  
  // Data Gravity (max 5)
  if (raw.match(/centralized|unified|single source|data repository/i)) score += 4.5;
  
  // Workflow Gravity (max 5)
  if (raw.match(/automat|workflow|streamline|process optimization/i)) score += 4.5;
  
  // Account Gravity (max 5)
  if (raw.match(/membership|retention|customer satisfaction|loyalty/i)) score += 4;
  
  // Network Effects (max 5)
  if (raw.match(/network effect|viral|social|collaboration|community/i)) score += 3.5;
  
  // Ecosystem Control (max 5)
  if (raw.match(/ecosystem|integration|platform|third-party|api/i)) score += 4;
  
  // Product Extension (max 5)
  if (raw.match(/ai|machine learning|analytics|predictive|intelligence/i)) score += 4;
  
  return Math.min(score, 30);
}

function getClassification(score) {
  if (score >= 25) return 'SYSTEM OF RECORD';
  if (score >= 20) return 'CORE SAAS';
  if (score >= 15) return 'SYSTEM OF WORKFLOW';
  return 'POINT SOLUTION';
}

async function createCleanNotionPage(data) {
  try {
    const blocks = [];
    
    // Title
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
    
    // Table of Contents
    blocks.push({
      object: 'block',
      type: 'heading_1',
      heading_1: {
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
          text: { content: `I. COMPANY OVERVIEW
II. BUSINESS AND PRODUCT DESCRIPTION
III. CUSTOMER OVERVIEW
IV. COMPETITIVE LANDSCAPE
V. CONTROL POINTS ANALYSIS` }
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
    
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `Company Name: ${data.companyName}
Year Founded: ${data.yearFounded}
Location: ${data.location}
Website: ${data.website}
Software Category & Vertical: ${data.vertical}
FTE Count: ${data.fteCount}
Funding History: ${data.funding}` }
        }]
      }
    });
    
    blocks.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{
          type: 'text',
          text: { 
            content: `CONTROL POINTS: FINAL SCORE: ${data.controlScore} / 30 ——> ${data.classification}` 
          },
          annotations: { bold: true }
        }],
        icon: { emoji: '⭐' }
      }
    });
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
    
    // Executive Summary (from Introduction)
    if (data.sections.introduction) {
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
      
      // Add the FULL introduction content
      addContentBlocks(blocks, data.sections.introduction);
    }
    
    // The Problem
    if (data.sections.problem) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: 'THE PROBLEM' }
          }]
        }
      });
      
      addContentBlocks(blocks, data.sections.problem);
    }
    
    // The Solution
    if (data.sections.solution) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: 'THE SOLUTION' }
          }]
        }
      });
      
      addContentBlocks(blocks, data.sections.solution);
    }
    
    // Business Description
    if (data.sections.businessDescription) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: 'BUSINESS AND PRODUCT DESCRIPTION' }
          }]
        }
      });
      
      addContentBlocks(blocks, data.sections.businessDescription);
    }
    
    // Customer Overview
    if (data.sections.customers || data.sections.targetAudience) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: 'CUSTOMER OVERVIEW' }
          }]
        }
      });
      
      const customerContent = data.sections.customers || data.sections.targetAudience;
      addContentBlocks(blocks, customerContent);
    }
    
    // Value Proposition
    if (data.sections.valueProposition) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: 'UNIQUE VALUE PROPOSITION' }
          }]
        }
      });
      
      addContentBlocks(blocks, data.sections.valueProposition);
    }
    
    // Use Cases
    if (data.sections.useCases) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: 'USE CASES' }
          }]
        }
      });
      
      addContentBlocks(blocks, data.sections.useCases);
    }
    
    // ROI
    if (data.sections.roi) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: 'RETURN ON INVESTMENT' }
          }]
        }
      });
      
      addContentBlocks(blocks, data.sections.roi);
    }
    
    // Create the page
    const response = await notion.pages.create({
      parent: { 
        page_id: process.env.NOTION_CLEANED_PARENT_PAGE_ID 
      },
      icon: {
        type: 'emoji',
        emoji: '✨'
      },
      cover: {
        type: 'external',
        external: {
          url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&h=300&fit=crop'
        }
      },
      properties: {
        title: {
          title: [{
            text: {
              content: `${data.companyName} - Cleaned`
            }
          }]
        }
      },
      children: blocks.slice(0, 100) // Notion has a 100 block limit per request
    });
    
    // If we have more than 100 blocks, add them separately
    if (blocks.length > 100) {
      const remainingBlocks = blocks.slice(100);
      for (let i = 0; i < remainingBlocks.length; i += 100) {
        await notion.blocks.children.append({
          block_id: response.id,
          children: remainingBlocks.slice(i, i + 100)
        });
      }
    }
    
    return response;
    
  } catch (error) {
    throw new Error(`Failed to create Notion page: ${error.message}`);
  }
}

// Helper function to add content as Notion blocks
function addContentBlocks(blocks, content) {
  if (!content) return;
  
  // Split content into chunks to avoid Notion's text limit (2000 chars per block)
  const chunks = splitIntoChunks(content, 1800);
  
  for (const chunk of chunks) {
    // Check if it's a bullet point
    if (chunk.startsWith('•') || chunk.startsWith('-')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{
            type: 'text',
            text: { content: chunk.replace(/^[•-]\s*/, '') }
          }]
        }
      });
    } else if (chunk.match(/^\d+\./)) {
      // Numbered list
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{
            type: 'text',
            text: { content: chunk.replace(/^\d+\.\s*/, '') }
          }]
        }
      });
    } else {
      // Regular paragraph
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
  }
}

// Split long text into chunks
function splitIntoChunks(text, maxLength) {
  if (text.length <= maxLength) return [text];
  
  const chunks = [];
  const paragraphs = text.split('\n\n');
  
  let currentChunk = '';
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}
