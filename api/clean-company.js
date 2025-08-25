// api/clean-company.js
// Complete cleaner - no optional chaining

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
      message: 'Successfully cleaned content'
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
    throw new Error('Failed to fetch content: ' + error.message);
  }
}

function organizeContent(raw) {
  // Extract company name
  let companyName = 'Company';
  const companyMatch = raw.match(/([A-Za-z]+\.app)/i);
  if (companyMatch) {
    companyName = companyMatch[1];
  }
  
  // Extract year founded
  let yearFounded = 'Not specified';
  const yearMatch = raw.match(/Year Founded:\s*(\d{4})|established in\s+(\d{4})/i);
  if (yearMatch) {
    yearFounded = yearMatch[1] || yearMatch[2] || 'Not specified';
  }
  
  // Extract location
  let location = 'Not specified';
  const locationMatch = raw.match(/Headquarters Location:\s*([^\n]+)|New York,\s*New York/i);
  if (locationMatch) {
    location = locationMatch[1] || 'New York, New York';
  }
  
  // Extract funding
  let funding = 'Not specified';
  const fundingMatch = raw.match(/Total Funding:\s*([^\n]+)|\$(\d+\s*(?:million|M))/i);
  if (fundingMatch) {
    funding = fundingMatch[1] || fundingMatch[2] || 'Not specified';
  }
  
  // Calculate control score
  let controlScore = 0;
  if (raw.includes('automat') || raw.includes('workflow')) controlScore += 5;
  if (raw.includes('data') && raw.includes('centralized')) controlScore += 5;
  if (raw.includes('membership') || raw.includes('retention')) controlScore += 4.5;
  if (raw.includes('network') || raw.includes('viral')) controlScore += 4;
  if (raw.includes('ecosystem') || raw.includes('integration')) controlScore += 4;
  if (raw.includes('analytics') || raw.includes('AI')) controlScore += 4;
  
  let classification = 'POINT SOLUTION';
  if (controlScore >= 25) classification = 'SYSTEM OF RECORD';
  else if (controlScore >= 20) classification = 'CORE SAAS';
  else if (controlScore >= 15) classification = 'SYSTEM OF WORKFLOW';
  
  // Extract sections
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
  
  for (let i = 0; i < sectionMarkers.length; i++) {
    const marker = sectionMarkers[i];
    const startIdx = raw.indexOf(marker.start);
    if (startIdx !== -1) {
      const contentStart = startIdx + marker.start.length;
      let contentEnd = raw.length;
      
      if (marker.end) {
        const endIdx = raw.indexOf(marker.end, contentStart);
        if (endIdx !== -1) contentEnd = endIdx;
      }
      
      sections[marker.key] = raw.substring(contentStart, contentEnd).trim();
    }
  }
  
  return {
    companyName: companyName,
    yearFounded: yearFounded,
    location: location,
    funding: funding,
    controlScore: controlScore,
    classification: classification,
    sections: sections
  };
}

async function createFullNotionPage(data) {
  try {
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
    
    // Table of Contents
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
          text: { content: 'I. COMPANY OVERVIEW\nII. BUSINESS AND PRODUCT DESCRIPTION\nIII. CUSTOMER OVERVIEW\nIV. COMPETITIVE LANDSCAPE\nV. CONTROL POINTS ANALYSIS' }
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
    
    const snapshotText = 'Company Name: ' + data.companyName + '\n' +
                         'Year Founded: ' + data.yearFounded + '\n' +
                         'Location: ' + data.location + '\n' +
                         'Website: ' + data.companyName.toLowerCase() + '\n' +
                         'Software Category & Vertical: Sports Facility Management Platform\n' +
                         'FTE Count: Not specified\n' +
                         'Funding History: ' + data.funding;
    
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
    
    blocks.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{
          type: 'text',
          text: { 
            content: 'CONTROL POINTS: FINAL SCORE: ' + data.controlScore + ' / 30 ——> ' + data.classification
          },
          annotations: { bold: true }
        }],
        icon: { type: 'emoji', emoji: '⭐' }
      }
    });
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
    
    // Add sections
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
      
      addContentBlocks(blocks, data.sections.introduction);
    }
    
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
    
    if (data.sections.customers) {
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
      
      addContentBlocks(blocks, data.sections.customers);
    }
    
    // Create page with first 100 blocks
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
              content: data.companyName + ' - Cleaned'
            }
          }]
        }
      },
      children: blocks.slice(0, 100)
    });
    
    // Add remaining blocks if over 100
    if (blocks.length > 100) {
      for (let i = 100; i < blocks.length; i += 100) {
        const chunk = blocks.slice(i, Math.min(i + 100, blocks.length));
        await notion.blocks.children.append({
          block_id: response.id,
          children: chunk
        });
      }
    }
    
    return response;
    
  } catch (error) {
    throw new Error('Failed to create page: ' + error.message);
  }
}

function addContentBlocks(blocks, content) {
  if (!content) return;
  
  // Split by double newlines
  const paragraphs = content.split('\n\n');
  
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (!para) continue;
    
    // Handle bullet points
    if (para.includes('•')) {
      const bullets = para.split('•');
      for (let j = 0; j < bullets.length; j++) {
        const bullet = bullets[j].trim();
        if (bullet) {
          blocks.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{
                type: 'text',
                text: { content: bullet }
              }]
            }
          });
        }
      }
    }
    // Handle numbered lists
    else if (para.match(/^\d+\./)) {
      const text = para.replace(/^\d+\.\s*/, '').trim();
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{
            type: 'text',
            text: { content: text }
          }]
        }
      });
    }
    // Regular paragraphs
    else {
      // Split if too long for Notion (max 2000 chars)
      if (para.length > 1900) {
        const chunks = [];
        let current = '';
        const sentences = para.split('. ');
        
        for (let s = 0; s < sentences.length; s++) {
          const sentence = sentences[s] + (s < sentences.length - 1 ? '.' : '');
          if (current.length + sentence.length > 1900) {
            if (current) chunks.push(current.trim());
            current = sentence;
          } else {
            current += (current ? ' ' : '') + sentence;
          }
        }
        
        if (current) chunks.push(current.trim());
        
        for (let c = 0; c < chunks.length; c++) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: { content: chunks[c] }
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
              text: { content: para }
            }]
          }
        });
      }
    }
  }
}
