// api/clean-notion.js
import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Your standard TOC structure with Clay section mappings
const STANDARD_STRUCTURE = {
  'Part 1: Company Overview': [
    {
      title: '1. Company Snapshot',
      clayMarkers: ['COMPANY SNAPSHOT', 'Company Overview', 'Company Name:', 'Year Founded:', 'Location:', 'Website:']
    },
    {
      title: '2. Product Overview',
      clayMarkers: ['PRODUCT_OVERVIEW', 'PRODUCT OVERVIEW', 'KEY MODULES', 'FEATURES']
    },
    {
      title: '3. Vertical Specificity',
      clayMarkers: ['VERTICAL SPECIFICITY', 'VERTICAL-SPECIFIC CAPABILITIES', 'VERTICAL CAPABILITIES']
    },
    {
      title: '4. Customer Overview',
      clayMarkers: ['CUSTOMER PROFILE', 'CUSTOMER OVERVIEW', 'TARGET CUSTOMER']
    },
    {
      title: '5. ICP Analysis',
      clayMarkers: ['ICP Analysis', 'IDEAL CUSTOMER PROFILE', 'ICP DEEP']
    },
    {
      title: '6. Customer Jobs to be Done',
      clayMarkers: ['JOBS TO BE DONE', 'Customer_Jobs_To_Be_Done', 'KEY JOBS', 'JTBD']
    },
    {
      title: '7. Customer Success Stories',
      clayMarkers: ['SUCCESS STORIES', 'CUSTOMER STORIES', 'CASE STUDIES']
    },
    {
      title: '8. Market Overview',
      clayMarkers: ['MARKET OVERVIEW', 'Market_Overview', 'MARKET ANALYSIS']
    },
    {
      title: '9. TAM / SAM / SOM',
      clayMarkers: ['TAM', 'SAM', 'SOM', 'TAM_Estimation', 'MARKET SIZE']
    },
    {
      title: '10. Competitive Analysis',
      clayMarkers: ['COMPETITIVE ANALYSIS', 'COMPETITIVE_ANALYSIS_CLEAN', 'COMPETITION']
    },
    {
      title: '11. Competitive Market Map',
      clayMarkers: ['COMPETITIVE MARKET MAP', 'MARKET MAP', 'COMPETITIVE_MARKET_MAP']
    }
  ],
  'Part 2: Control Points Analysis': [
    {
      title: '1. Data Gravity Analysis',
      clayMarkers: ['Data Gravity', 'DATA GRAVITY', 'Data Integration']
    },
    {
      title: '2. Workflow Gravity Analysis',
      clayMarkers: ['Workflow Gravity', 'WORKFLOW GRAVITY', 'WG_Part', 'Workflow Integration']
    },
    {
      title: '3. Account Gravity Analysis',
      clayMarkers: ['Account Gravity', 'ACCOUNT GRAVITY', 'Customer Lock-in']
    },
    {
      title: '4. Network Effects Analysis',
      clayMarkers: ['Network Effects', 'NETWORK EFFECTS', 'Network Value']
    },
    {
      title: '5. Ecosystem Control Points Analysis',
      clayMarkers: ['Ecosystem Control', 'ECO_CP', 'ECOSYSTEM', 'Platform Effects']
    },
    {
      title: '6. Product Extension Analysis',
      clayMarkers: ['Product Extension', 'PRODUCT EXTENSION', 'Expansion Potential']
    },
    {
      title: '7. Final Control Points Conclusions',
      clayMarkers: ['Final Control Points', 'CONTROL POINTS CONCLUSION', 'Final - Conclusion']
    },
    {
      title: '8. Final Total Score and Classification',
      clayMarkers: ['Final_Total_Score', 'Classification_Final', 'TOTAL SCORE', 'Overall Score']
    }
  ]
};

export default async function handler(req, res) {
  console.log('Function invoked');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pageId } = req.body;

  if (!pageId) {
    return res.status(400).json({ error: 'pageId is required' });
  }

  if (!process.env.NOTION_TOKEN || !process.env.NOTION_CLEANED_PARENT_PAGE_ID) {
    return res.status(500).json({ error: 'Missing configuration' });
  }

  try {
    console.log(`Processing page: ${pageId}`);
    
    // Fetch all content from Clay page
    const rawContent = await fetchAllContent(pageId);
    
    if (!rawContent.trim()) {
      return res.status(400).json({ error: 'No content found in source page' });
    }
    
    console.log('Raw content length:', rawContent.length);
    
    // Extract company name
    const companyName = extractCompanyName(rawContent);
    console.log('Company:', companyName);
    
    // Map content to standard structure
    const structuredContent = mapToStandardStructure(rawContent);
    console.log('Sections mapped:', Object.keys(structuredContent).length);
    
    // Create the cleaned page
    const newPageId = await createCleanedPage(companyName, structuredContent);
    
    console.log('Success! Created page:', newPageId);
    return res.status(200).json({ 
      success: true, 
      pageId: newPageId,
      company: companyName 
    });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({ 
      error: 'Failed to process page',
      details: error.message 
    });
  }
}

async function fetchAllContent(pageId) {
  let allBlocks = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      start_cursor: startCursor
    });
    
    allBlocks = [...allBlocks, ...response.results];
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }
  
  // Extract text from all blocks
  let content = '';
  for (const block of allBlocks) {
    const text = extractTextFromBlock(block);
    if (text) {
      content += text + '\n';
    }
  }
  
  return content;
}

function extractTextFromBlock(block) {
  const type = block.type;
  const blockData = block[type];
  
  if (!blockData) return '';
  
  if (blockData.rich_text && Array.isArray(blockData.rich_text)) {
    return blockData.rich_text.map(rt => rt.plain_text || '').join('');
  }
  
  if (blockData.caption && Array.isArray(blockData.caption)) {
    return blockData.caption.map(rt => rt.plain_text || '').join('');
  }
  
  return '';
}

function extractCompanyName(text) {
  const patterns = [
    /CLAY_RAW_(.+?)(?:\s|$)/i,
    /Company Name:\s*(.+?)(?:\n|$)/i,
    /Company_Name_Presentation:\s*(.+?)(?:\n|$)/i,
    /^#\s+(.+?)(?:\n|$)/m,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim()
        .replace(/_/g, ' ')
        .replace(/\.(?:com|io|ai|app)$/, '');
    }
  }
  
  return 'Company';
}

function mapToStandardStructure(rawContent) {
  const mappedContent = {};
  
  // Process each part of the standard structure
  for (const [partName, sections] of Object.entries(STANDARD_STRUCTURE)) {
    mappedContent[partName] = [];
    
    for (const section of sections) {
      const sectionContent = extractSectionContent(rawContent, section.clayMarkers);
      
      if (sectionContent) {
        mappedContent[partName].push({
          title: section.title,
          content: cleanAndPolish(sectionContent)
        });
      } else {
        // Add placeholder if section not found
        mappedContent[partName].push({
          title: section.title,
          content: '[Content not found in source data]'
        });
      }
    }
  }
  
  return mappedContent;
}

function extractSectionContent(rawContent, markers) {
  // Try to find content for any of the markers
  for (const marker of markers) {
    // Try === delimited sections first
    const sectionRegex = new RegExp(`===\\s*[^=]*${escapeRegex(marker)}[^=]*===([\\s\\S]*?)(?:===|\\*\\*\\*|$)`, 'i');
    let match = rawContent.match(sectionRegex);
    
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Try other patterns
    const altRegex = new RegExp(`${escapeRegex(marker)}[:\\s]+([\\s\\S]*?)(?:===|\\*\\*\\*|\\n\\n[A-Z][A-Z\\s]+:|$)`, 'i');
    match = rawContent.match(altRegex);
    
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return null;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanAndPolish(text) {
  // Remove filler phrases while preserving key content
  const fillers = [
    /Strategic takeaway:[^\n]+\n?/gi,
    /It's worth noting that\s*/gi,
    /In practical terms,\s*/gi,
    /Generally speaking,\s*/gi,
    /As mentioned previously,\s*/gi,
    /Furthermore,\s*/gi,
    /Additionally,\s*/gi,
    /Moreover,\s*/gi,
  ];
  
  let cleaned = text;
  for (const filler of fillers) {
    cleaned = cleaned.replace(filler, '');
  }
  
  // Clean up formatting
  cleaned = cleaned.replace(/\*{3,}/g, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  
  // Format special content
  cleaned = formatLists(cleaned);
  cleaned = formatScores(cleaned);
  cleaned = formatKeyValues(cleaned);
  
  return cleaned.trim();
}

function formatLists(text) {
  // Convert various list formats to consistent bullets
  text = text.replace(/^[-*]\s+/gm, '• ');
  text = text.replace(/^\d+\)\s+/gm, (match, offset) => {
    const lineNum = text.substring(0, offset).split('\n').length;
    return `${lineNum}. `;
  });
  return text;
}

function formatScores(text) {
  // Highlight scores (e.g., "8/10" or "29/30")
  return text.replace(/(\d+\/\d+)/g, '**$1**');
}

function formatKeyValues(text) {
  // Bold keys in key-value pairs
  return text.replace(/^([A-Za-z][A-Za-z\s]+):\s+(.+)$/gm, '**$1:** $2');
}

function splitText(text, maxLength = 1900) {
  if (!text || text.length <= maxLength) return [text];
  
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';
  
  for (const para of paragraphs) {
    if (para.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      // Split long paragraph by sentences
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (sentence.length > maxLength) {
          // Force split by words
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }
          
          const words = sentence.split(/\s+/);
          let wordChunk = '';
          for (const word of words) {
            if ((wordChunk + ' ' + word).length > maxLength) {
              if (wordChunk) chunks.push(wordChunk.trim());
              wordChunk = word;
            } else {
              wordChunk += (wordChunk ? ' ' : '') + word;
            }
          }
          if (wordChunk) currentChunk = wordChunk;
        } else if ((currentChunk + ' ' + sentence).length > maxLength) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
      }
    } else if ((currentChunk + '\n\n' + para).length > maxLength) {
      chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

async function createCleanedPage(companyName, structuredContent) {
  const blocks = [];
  
  // Main title
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{
        type: 'text',
        text: { content: `${companyName} Overview - Cleaned for Presentation` }
      }]
    }
  });
  
  // Process Part 1: Company Overview
  if (structuredContent['Part 1: Company Overview']) {
    blocks.push({
      object: 'block',
      type: 'divider',
      divider: {}
    });
    
    blocks.push({
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{
          type: 'text',
          text: { content: 'Part 1: Company Overview' },
          annotations: { bold: true }
        }]
      }
    });
    
    // Table of Contents for Part 1
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Table of Contents' } }]
      }
    });
    
    for (const section of structuredContent['Part 1: Company Overview']) {
      const tocText = section.title;
      if (tocText.length <= 2000) {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ type: 'text', text: { content: tocText } }]
          }
        });
      }
    }
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
    
    // Add Part 1 sections
    for (const section of structuredContent['Part 1: Company Overview']) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: section.title } }]
        }
      });
      
      // Process section content
      const contentBlocks = processContent(section.content);
      blocks.push(...contentBlocks);
      
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    }
  }
  
  // Process Part 2: Control Points Analysis
  if (structuredContent['Part 2: Control Points Analysis']) {
    blocks.push({
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{
          type: 'text',
          text: { content: 'Part 2: Control Points Analysis' },
          annotations: { bold: true }
        }]
      }
    });
    
    // Table of Contents for Part 2
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Control Points Sections' } }]
      }
    });
    
    for (const section of structuredContent['Part 2: Control Points Analysis']) {
      const tocText = section.title;
      if (tocText.length <= 2000) {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ type: 'text', text: { content: tocText } }]
          }
        });
      }
    }
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
    
    // Add Part 2 sections
    for (const section of structuredContent['Part 2: Control Points Analysis']) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: section.title } }]
        }
      });
      
      // Process section content with special handling for scores
      const contentBlocks = processContent(section.content, section.title.includes('Score') || section.title.includes('Control Points'));
      blocks.push(...contentBlocks);
      
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    }
  }
  
  // Create page with blocks
  const pageData = {
    parent: { page_id: process.env.NOTION_CLEANED_PARENT_PAGE_ID },
    properties: {
      title: {
        title: [{
          text: { content: `${companyName} - Cleaned for Presentation` }
        }]
      }
    },
    children: blocks.slice(0, 100)
  };
  
  const response = await notion.pages.create(pageData);
  
  // Add remaining blocks if needed
  if (blocks.length > 100) {
    const remaining = blocks.slice(100);
    for (let i = 0; i < remaining.length; i += 100) {
      const batch = remaining.slice(i, Math.min(i + 100, remaining.length));
      await notion.blocks.children.append({
        block_id: response.id,
        children: batch
      });
    }
  }
  
  return response.id;
}

function processContent(content, isScoreSection = false) {
  const blocks = [];
  
  if (content === '[Content not found in source data]') {
    blocks.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: content } }],
        icon: { emoji: '⚠️' },
        color: 'yellow_background'
      }
    });
    return blocks;
  }
  
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Handle bullets
    if (trimmed.startsWith('•')) {
      const bulletText = trimmed.substring(1).trim();
      const chunks = splitText(bulletText);
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: chunk } }]
          }
        });
      }
    }
    // Handle numbered items
    else if (trimmed.match(/^\d+\./)) {
      const numberedText = trimmed.replace(/^\d+\.\s*/, '');
      const chunks = splitText(numberedText);
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ type: 'text', text: { content: chunk } }]
          }
        });
      }
    }
    // Handle scores with callout
    else if (trimmed.match(/\d+\/\d+/) && (isScoreSection || trimmed.includes('Score'))) {
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: trimmed } }],
          icon: { emoji: '📊' },
          color: 'blue_background'
        }
      });
    }
    // Handle bold key-value pairs
    else if (trimmed.includes('**') && trimmed.includes(':')) {
      const parts = trimmed.split('**').filter(p => p);
      const richText = [];
      
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          // This is bold text
          richText.push({
            type: 'text',
            text: { content: parts[i] },
            annotations: { bold: true }
          });
        } else {
          richText.push({
            type: 'text',
            text: { content: parts[i] }
          });
        }
      }
      
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: richText }
      });
    }
    // Regular paragraph
    else {
      const chunks = splitText(trimmed);
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }]
          }
        });
      }
    }
  }
  
  return blocks;
}
