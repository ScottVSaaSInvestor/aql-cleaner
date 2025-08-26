// api/clean-notion.js
// Universal Notion Data Cleaner with proper character limit handling
// Adapts to any Clay data structure and respects Notion's 2000 char limits

import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Main handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pageId } = req.body;
    
    if (!pageId) {
      return res.status(400).json({ error: 'Page ID is required' });
    }

    console.log('Starting to process page:', pageId);
    
    // Fetch raw content
    const rawContent = await fetchNotionContent(pageId);
    console.log('Fetched content length:', rawContent.length);
    
    // Process and structure the data
    const cleanedData = processClayData(rawContent);
    console.log('Processed company:', cleanedData.companyName);
    
    // Create the cleaned page
    const newPageId = await createCleanedPage(cleanedData);
    console.log('Created cleaned page:', newPageId);
    
    return res.status(200).json({ 
      success: true,
      cleanPageId: newPageId,
      companyName: cleanedData.companyName,
      message: `Successfully cleaned data for ${cleanedData.companyName}`
    });
    
  } catch (error) {
    console.error('Processing error:', error);
    return res.status(500).json({ 
      error: 'Failed to process company data',
      details: error.message 
    });
  }
}

// Fetch all content from Notion page
async function fetchNotionContent(pageId) {
  try {
    let fullContent = '';
    let hasMore = true;
    let cursor = undefined;
    
    while (hasMore) {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor
      });
      
      for (const block of response.results) {
        const text = extractTextFromBlock(block);
        if (text) {
          fullContent += text + '\n';
        }
      }
      
      hasMore = response.has_more;
      cursor = response.next_cursor;
    }
    
    return fullContent;
  } catch (error) {
    throw new Error(`Failed to fetch Notion content: ${error.message}`);
  }
}

// Extract text from any block type
function extractTextFromBlock(block) {
  try {
    switch (block.type) {
      case 'paragraph':
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        if (block[block.type].rich_text) {
          return block[block.type].rich_text.map(t => t.plain_text).join('');
        }
        break;
      case 'bulleted_list_item':
      case 'numbered_list_item':
        if (block[block.type].rich_text) {
          return block[block.type].rich_text.map(t => t.plain_text).join('');
        }
        break;
      case 'code':
        if (block.code.rich_text) {
          return block.code.rich_text.map(t => t.plain_text).join('');
        }
        break;
      case 'quote':
        if (block.quote.rich_text) {
          return block.quote.rich_text.map(t => t.plain_text).join('');
        }
        break;
      case 'callout':
        if (block.callout.rich_text) {
          return block.callout.rich_text.map(t => t.plain_text).join('');
        }
        break;
    }
  } catch (e) {
    console.log('Error extracting from block type:', block.type);
  }
  return '';
}

// Process Clay data and extract structured information
function processClayData(rawContent) {
  const data = {
    companyName: '',
    snapshot: {},
    executiveSummary: [],
    sections: []
  };
  
  // Extract company name (flexible patterns)
  const namePatterns = [
    /Company Name[:\s]*([^\n]+)/i,
    /^([A-Za-z0-9\s.]+?)(?:\s*===|\s*\n)/m,
    /([A-Za-z]+\.(?:app|ai|io|com))/i,
    /CLAY_RAW_([^\s.]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = rawContent.match(pattern);
    if (match) {
      data.companyName = match[1].trim().replace(/_/g, ' ');
      break;
    }
  }
  
  if (!data.companyName) {
    data.companyName = 'Company Analysis';
  }
  
  // Extract snapshot data
  data.snapshot = extractSnapshot(rawContent);
  
  // Extract executive summary (from paragraphs)
  const execPattern = /\[Paragraph \d+\]([^[]*?)(?=\[Paragraph|\n===|$)/gi;
  let execMatch;
  while ((execMatch = execPattern.exec(rawContent)) !== null) {
    const text = execMatch[1].trim();
    if (text && text.length > 50) {
      data.executiveSummary.push(text);
    }
  }
  
  // Extract major sections with flexible patterns
  const sectionPatterns = [
    { name: 'Introduction', pattern: /=== ?\d*\.?\s*INTRODUCTION ===\s*([^=]+)/i },
    { name: 'Key Modules & Features', pattern: /=== ?\d*\.?\s*KEY MODULES[^=]*===\s*([^=]+)/i },
    { name: 'Vertical Capabilities', pattern: /=== ?\d*\.?\s*VERTICAL[^=]*CAPABILITIES[^=]*===\s*([^=]+)/i },
    { name: 'Value Proposition', pattern: /=== ?\d*\.?\s*(?:CORE )?VALUE PROPOSITION[^=]*===\s*([^=]+)/i },
    { name: 'Technology', pattern: /=== ?\d*\.?\s*TECHNOLOGY[^=]*===\s*([^=]+)/i },
    { name: 'Workflows', pattern: /=== ?\d*\.?\s*WORKFLOW[^=]*===\s*([^=]+)/i },
    { name: 'Customer Profile', pattern: /=== ?\d*\.?\s*(?:ICP|IDEAL CUSTOMER)[^=]*===\s*([^=]+)/i },
    { name: 'Jobs To Be Done', pattern: /(?:JOBS TO BE DONE|Job \d+:)([^=]+)/i },
    { name: 'Customer Stories', pattern: /CUSTOMER SUCCESS STORY[^=]*\n([^=]+)/i },
    { name: 'Market Context', pattern: /=== ?\d*\.?\s*MARKET[^=]*===\s*([^=]+)/i },
    { name: 'TAM', pattern: /=== ?\d*\.?\s*(?:TAM|TOTAL ADDRESSABLE)[^=]*===\s*([^=]+)/i },
    { name: 'Competitive', pattern: /=== ?\d*\.?\s*COMPETITIVE[^=]*===\s*([^=]+)/i },
    { name: 'Control Points', pattern: /CONTROL POINTS[^=]*\n([^*]+)/i }
  ];
  
  for (const { name, pattern } of sectionPatterns) {
    const match = rawContent.match(pattern);
    if (match && match[1]) {
      const content = cleanSectionContent(match[1]);
      if (content) {
        data.sections.push({ name, content });
      }
    }
  }
  
  // Extract control points score if present
  const scoreMatch = rawContent.match(/Control Points[:\s]*(\d+\/\d+)/i);
  if (scoreMatch) {
    data.snapshot.controlPoints = scoreMatch[1];
  }
  
  const classMatch = rawContent.match(/→\s*(System of \w+)/i);
  if (classMatch) {
    data.snapshot.classification = classMatch[1];
  }
  
  return data;
}

// Extract snapshot information
function extractSnapshot(content) {
  const snapshot = {};
  
  const patterns = {
    yearFounded: /Year Founded[:\s]*(\d{4})/i,
    location: /Location[:\s]*([^\n]+)/i,
    website: /Website[:\s]*(https?:\/\/[^\s]+)/i,
    category: /Software Category[^\n]*[:\s]*([^\n]+)/i,
    fteCount: /FTE Count[:\s]*(\d+)/i,
    fteGrowth: /FTE growth[:\s]*([0-9.]+%)/i,
    funding: /(?:Funding|Total Raised)[:\s]*([^\n]+)/i,
    controlPoints: /Control Points[:\s]*(\d+\/\d+)/i
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = content.match(pattern);
    if (match) {
      snapshot[key] = match[1].trim();
    }
  }
  
  return snapshot;
}

// Clean section content
function cleanSectionContent(text) {
  // Remove excessive whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  // Remove markdown artifacts
  text = text.replace(/\*{3,}/g, '');
  text = text.replace(/_{3,}/g, '');
  text = text.replace(/={3,}/g, '');
  
  // Fix bullet points
  text = text.replace(/^[-•*]\s*/gm, '• ');
  
  // Remove duplicate sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  const unique = [...new Set(sentences)];
  text = unique.join(' ');
  
  return text.trim();
}

// Create the cleaned page in Notion
async function createCleanedPage(data) {
  const blocks = [];
  
  // Title
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{
        type: 'text',
        text: { content: data.companyName }
      }]
    }
  });
  
  // Table of Contents
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{
        type: 'text',
        text: { content: 'Table of Contents' }
      }]
    }
  });
  
  const tocItems = [
    'Company Snapshot',
    'Executive Summary',
    ...data.sections.map(s => s.name)
  ];
  
  // Add TOC items as numbered list
  tocItems.forEach((item, index) => {
    const tocText = `${index + 1}. ${item}`;
    // Split if too long for Notion's limit
    if (tocText.length <= 2000) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{
            type: 'text',
            text: { content: tocText }
          }]
        }
      });
    }
  });
  
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  
  // Company Snapshot
  if (Object.keys(data.snapshot).length > 0) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{
          type: 'text',
          text: { content: 'Company Snapshot' }
        }]
      }
    });
    
    for (const [key, value] of Object.entries(data.snapshot)) {
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
      const snapshotLine = `${label}: ${value}`;
      
      // Check character limit
      if (snapshotLine.length <= 2000) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: label + ': ' },
              annotations: { bold: true }
            }, {
              type: 'text',
              text: { content: value }
            }]
          }
        });
      }
    }
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }
  
  // Executive Summary
  if (data.executiveSummary.length > 0) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{
          type: 'text',
          text: { content: 'Executive Summary' }
        }]
      }
    });
    
    data.executiveSummary.forEach(paragraph => {
      // Split long paragraphs into chunks
      const chunks = splitIntoChunks(paragraph, 1900);
      chunks.forEach(chunk => {
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
      });
    });
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }
  
  // Add each section
  data.sections.forEach(section => {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{
          type: 'text',
          text: { content: section.name }
        }]
      }
    });
    
    // Process section content
    const contentBlocks = processContentIntoBlocks(section.content);
    blocks.push(...contentBlocks);
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  });
  
  // Create the page with proper parent ID
  try {
    const response = await notion.pages.create({
      parent: {
        page_id: process.env.NOTION_CLEANED_PARENT_PAGE_ID || process.env.NOTION_PARENT_PAGE_ID
      },
      icon: {
        type: 'emoji',
        emoji: '📊'
      },
      properties: {
        title: {
          title: [{
            text: {
              content: `${data.companyName} - Cleaned for Presentation`
            }
          }]
        }
      },
      children: blocks.slice(0, 100) // First 100 blocks
    });
    
    // Add remaining blocks if there are more than 100
    if (blocks.length > 100) {
      for (let i = 100; i < blocks.length; i += 100) {
        const chunk = blocks.slice(i, Math.min(i + 100, blocks.length));
        await notion.blocks.children.append({
          block_id: response.id,
          children: chunk
        });
      }
    }
    
    return response.id;
  } catch (error) {
    console.error('Error creating Notion page:', error);
    throw error;
  }
}

// Split text into chunks under 2000 characters
function splitIntoChunks(text, maxLength = 1900) {
  const chunks = [];
  
  if (text.length <= maxLength) {
    return [text];
  }
  
  // Try to split at sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      
      // If single sentence is too long, split it
      if (sentence.length > maxLength) {
        const words = sentence.split(' ');
        currentChunk = '';
        
        for (const word of words) {
          if ((currentChunk + ' ' + word).length <= maxLength) {
            currentChunk += (currentChunk ? ' ' : '') + word;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = word;
          }
        }
      } else {
        currentChunk = sentence;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Process content into properly formatted blocks
function processContentIntoBlocks(content) {
  const blocks = [];
  
  // Split by line breaks to preserve structure
  const lines = content.split(/\n+/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Handle bullet points
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      const bulletContent = trimmed.replace(/^[•\-*]\s*/, '').trim();
      const chunks = splitIntoChunks(bulletContent, 1900);
      
      chunks.forEach((chunk, index) => {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{
              type: 'text',
              text: { content: chunk }
            }]
          }
        });
      });
    }
    // Handle numbered items
    else if (trimmed.match(/^\d+\./)) {
      const numberContent = trimmed.replace(/^\d+\.\s*/, '').trim();
      const chunks = splitIntoChunks(numberContent, 1900);
      
      chunks.forEach((chunk) => {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{
              type: 'text',
              text: { content: chunk }
            }]
          }
        });
      });
    }
    // Regular paragraph
    else {
      const chunks = splitIntoChunks(trimmed, 1900);
      
      chunks.forEach(chunk => {
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
      });
    }
  }
  
  return blocks;
}

// Helper function to format keys nicely
function formatKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}
