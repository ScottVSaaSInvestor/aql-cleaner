// api/clean-notion.js
// Production-ready Clay to Notion Cleaner
// Preserves all content, reduces wordiness, handles all edge cases

import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Constants
const MAX_TEXT_LENGTH = 1900; // Notion's limit with safety margin
const MAX_BLOCKS_PER_REQUEST = 100; // Notion API limit

export default async function handler(req, res) {
  // CORS headers
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

    console.log('Processing page:', pageId);
    
    // Step 1: Fetch raw content
    const rawContent = await fetchNotionContent(pageId);
    console.log('Content length:', rawContent.length);
    
    // Step 2: Parse and structure
    const structuredData = parseClayContent(rawContent);
    console.log('Company:', structuredData.companyName);
    console.log('Sections found:', structuredData.sections.length);
    
    // Step 3: Create clean page
    const newPageId = await createCleanNotionPage(structuredData);
    console.log('Success! New page:', newPageId);
    
    return res.status(200).json({ 
      success: true,
      cleanPageId: newPageId,
      companyName: structuredData.companyName,
      sectionsProcessed: structuredData.sections.length
    });
    
  } catch (error) {
    console.error('Processing failed:', error);
    return res.status(500).json({ 
      error: 'Failed to process content',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Fetch all content from source Notion page
async function fetchNotionContent(pageId) {
  let fullContent = '';
  let hasMore = true;
  let cursor = undefined;
  
  while (hasMore) {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: MAX_BLOCKS_PER_REQUEST,
      start_cursor: cursor
    });
    
    for (const block of response.results) {
      const text = extractBlockText(block);
      if (text) {
        // Preserve block type context
        if (block.type === 'heading_1') {
          fullContent += `\n# ${text}\n`;
        } else if (block.type === 'heading_2') {
          fullContent += `\n## ${text}\n`;
        } else if (block.type === 'heading_3') {
          fullContent += `\n### ${text}\n`;
        } else if (block.type === 'bulleted_list_item') {
          fullContent += `• ${text}\n`;
        } else if (block.type === 'numbered_list_item') {
          fullContent += `- ${text}\n`;
        } else {
          fullContent += `${text}\n`;
        }
      }
    }
    
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }
  
  return fullContent;
}

// Extract text from any block type
function extractBlockText(block) {
  const type = block.type;
  const data = block[type];
  
  if (data && data.rich_text && Array.isArray(data.rich_text)) {
    return data.rich_text.map(rt => rt.plain_text).join('');
  }
  
  return '';
}

// Parse Clay's content structure
function parseClayContent(raw) {
  const data = {
    companyName: '',
    sections: []
  };
  
  // Extract company name
  const namePatterns = [
    /CLAY_RAW_([^\n]+)/i,
    /^#\s*([^\n]+)/m,
    /Company Name:\s*([^\n]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = raw.match(pattern);
    if (match) {
      data.companyName = cleanCompanyName(match[1]);
      break;
    }
  }
  
  // Default if no name found
  if (!data.companyName) {
    data.companyName = 'Company Analysis';
  }
  
  // Parse sections - handle both === and *** separators
  const majorSections = raw.split(/\n\*{3,}\n/);
  
  for (const majorBlock of majorSections) {
    // Handle === section markers
    const sectionRegex = /={3,}\s*(\d+\.?\s*)?([^=]+?)={3,}/g;
    let lastIndex = 0;
    let match;
    
    while ((match = sectionRegex.exec(majorBlock)) !== null) {
      // Get any content before this section
      const beforeContent = majorBlock.substring(lastIndex, match.index).trim();
      if (beforeContent && beforeContent.length > 50) {
        processContent(data, beforeContent);
      }
      
      // Process section header and content
      const sectionTitle = match[2].trim();
      const startOfContent = sectionRegex.lastIndex;
      const nextMatch = sectionRegex.exec(majorBlock);
      
      let sectionContent;
      if (nextMatch) {
        sectionContent = majorBlock.substring(startOfContent, nextMatch.index).trim();
        sectionRegex.lastIndex = nextMatch.index; // Reset to process next section
      } else {
        sectionContent = majorBlock.substring(startOfContent).trim();
      }
      
      if (sectionTitle && sectionContent) {
        addSection(data, sectionTitle, sectionContent);
      }
      
      lastIndex = startOfContent;
    }
    
    // Handle any remaining content
    const remaining = majorBlock.substring(lastIndex).trim();
    if (remaining && remaining.length > 50) {
      processContent(data, remaining);
    }
  }
  
  return data;
}

// Clean company name
function cleanCompanyName(name) {
  return name
    .trim()
    .replace(/\.app$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

// Process unstructured content blocks
function processContent(data, content) {
  // Identify content type and add appropriate section
  if (content.includes('[Paragraph') && content.includes('Executive Summary')) {
    addSection(data, 'Executive Summary', content);
  } else if (content.includes('Customer Success Story') || content.includes('Customer Background')) {
    addSection(data, 'Customer Success Stories', content);
  } else if (content.includes('Job ') && content.includes('Who Does This Job')) {
    addSection(data, 'Jobs To Be Done', content);
  } else if (content.includes('CONTROL POINTS') || content.includes('DATA GRAVITY')) {
    addSection(data, 'Control Points Analysis', content);
  } else if (content.includes('TAM') || content.includes('SAM') || content.includes('SOM')) {
    addSection(data, 'Market Sizing', content);
  } else if (content.includes('COMPETITIVE LANDSCAPE')) {
    addSection(data, 'Competitive Landscape', content);
  } else {
    // Generic content - try to identify from first line
    const firstLine = content.split('\n')[0];
    const title = firstLine.length < 100 ? firstLine : 'Additional Information';
    addSection(data, title, content);
  }
}

// Add section with appropriate type
function addSection(data, title, content) {
  // Clean up the title
  title = title.replace(/^\d+\.\s*/, '').trim();
  
  // Determine section type
  let type = 'standard';
  if (title.includes('SNAPSHOT')) type = 'snapshot';
  else if (title.includes('SUMMARY')) type = 'summary';
  else if (title.includes('SUCCESS STOR')) type = 'stories';
  else if (title.includes('JOBS')) type = 'jobs';
  else if (title.includes('CONTROL POINT')) type = 'control';
  
  // Reduce wordiness
  content = reduceWordiness(content);
  
  data.sections.push({
    title: cleanSectionTitle(title),
    type: type,
    content: content
  });
}

// Clean section titles
function cleanSectionTitle(title) {
  return title
    .replace(/^===\s*/, '')
    .replace(/\s*===\s*$/, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Intelligently reduce wordiness while preserving insights
function reduceWordiness(text) {
  // Remove repetitive strategic takeaways (they're often redundant)
  text = text.replace(/Strategic takeaway:[^.]+\./gi, '');
  
  // Remove common filler phrases that don't add value
  const fillers = [
    /It's worth noting that /gi,
    /It should be noted that /gi,
    /In practical terms, /gi,
    /Generally speaking, /gi,
    /As mentioned previously, /gi,
    /As mentioned earlier, /gi,
    /It is important to note that /gi,
    /For all intents and purposes, /gi,
    /At the end of the day, /gi,
    /When all is said and done, /gi
  ];
  
  fillers.forEach(filler => {
    text = text.replace(filler, '');
  });
  
  // Remove redundant transitions when they start sentences
  text = text.replace(/^(Furthermore|Additionally|Moreover|However|Nevertheless),\s*/gim, '');
  
  // Clean up excessive whitespace
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text.trim();
}

// Create the cleaned page in Notion
async function createCleanNotionPage(data) {
  const blocks = [];
  
  // Page title
  blocks.push(createHeading1(data.companyName));
  
  // Table of Contents
  blocks.push(createHeading2('Table of Contents'));
  
  // Build TOC
  data.sections.forEach((section, index) => {
    blocks.push({
      object: 'block',
      type: 'numbered_list_item',
      numbered_list_item: {
        rich_text: [{
          type: 'text',
          text: { content: truncateText(section.title, MAX_TEXT_LENGTH) }
        }]
      }
    });
  });
  
  blocks.push(createDivider());
  
  // Process each section
  for (const section of data.sections) {
    // Section heading
    blocks.push(createHeading2(section.title));
    
    // Process content based on type
    switch (section.type) {
      case 'snapshot':
        processSnapshotSection(blocks, section.content);
        break;
        
      case 'summary':
        processSummarySection(blocks, section.content);
        break;
        
      case 'stories':
        processStoriesSection(blocks, section.content);
        break;
        
      case 'jobs':
        processJobsSection(blocks, section.content);
        break;
        
      case 'control':
        processControlSection(blocks, section.content);
        break;
        
      default:
        processStandardSection(blocks, section.content);
    }
    
    blocks.push(createDivider());
  }
  
  // Create the Notion page
  try {
    const response = await notion.pages.create({
      parent: {
        page_id: process.env.NOTION_CLEANED_PARENT_PAGE_ID
      },
      icon: {
        type: 'emoji',
        emoji: '✨'
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
      children: blocks.slice(0, MAX_BLOCKS_PER_REQUEST)
    });
    
    // Add remaining blocks if needed
    if (blocks.length > MAX_BLOCKS_PER_REQUEST) {
      await addRemainingBlocks(response.id, blocks.slice(MAX_BLOCKS_PER_REQUEST));
    }
    
    return response.id;
    
  } catch (error) {
    console.error('Notion API error:', error);
    throw new Error(`Failed to create page: ${error.message}`);
  }
}

// Add remaining blocks in batches
async function addRemainingBlocks(pageId, remainingBlocks) {
  for (let i = 0; i < remainingBlocks.length; i += MAX_BLOCKS_PER_REQUEST) {
    const batch = remainingBlocks.slice(i, Math.min(i + MAX_BLOCKS_PER_REQUEST, remainingBlocks.length));
    await notion.blocks.children.append({
      block_id: pageId,
      children: batch
    });
  }
}

// Process snapshot section
function processSnapshotSection(blocks, content) {
  const lines = content.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Parse key-value pairs
    const match = line.match(/^[-•]?\s*([^:]+):\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      
      if ((key + ': ' + value).length <= MAX_TEXT_LENGTH) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              {
                type: 'text',
                text: { content: key + ': ' },
                annotations: { bold: true }
              },
              {
                type: 'text',
                text: { content: value }
              }
            ]
          }
        });
      } else {
        // Split long values
        blocks.push(createParagraphBold(key + ':'));
        addTextChunks(blocks, value);
      }
    } else {
      addTextChunks(blocks, line);
    }
  }
}

// Process summary section
function processSummarySection(blocks, content) {
  // Split by paragraph markers
  const paragraphs = content.split(/\[Paragraph \d+\]/);
  
  for (const para of paragraphs) {
    const text = para.trim();
    if (text) {
      addTextChunks(blocks, text);
    }
  }
}

// Process customer stories
function processStoriesSection(blocks, content) {
  const stories = content.split(/Customer (Background|Name):/);
  
  for (const story of stories) {
    if (!story.trim()) continue;
    
    // Extract story components
    const nameMatch = story.match(/(?:Name|Company):\s*([^\n]+)/i);
    if (nameMatch) {
      blocks.push(createHeading3(nameMatch[1].trim()));
    }
    
    // Process story content
    const lines = story.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.match(/^(Name|Company):/)) {
        processContentLine(blocks, trimmed);
      }
    }
  }
}

// Process jobs section
function processJobsSection(blocks, content) {
  const jobs = content.split(/Job \d+:/);
  
  jobs.forEach((job, index) => {
    if (!job.trim()) return;
    
    const lines = job.split('\n');
    if (index > 0) {
      // Add job heading
      const firstLine = lines[0].trim();
      if (firstLine) {
        blocks.push(createHeading3(`Job ${index}: ${firstLine}`));
      }
    }
    
    // Process job details
    for (let i = 1; i < lines.length; i++) {
      processContentLine(blocks, lines[i]);
    }
  });
}

// Process control points section
function processControlSection(blocks, content) {
  // This section is critical - preserve all details
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check for score patterns
    if (trimmed.match(/Score:?\s*\d+/i) || trimmed.match(/\d+\/\d+/)) {
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          icon: { type: 'emoji', emoji: '⭐' },
          rich_text: [{
            type: 'text',
            text: { content: truncateText(trimmed, MAX_TEXT_LENGTH) }
          }]
        }
      });
    } else {
      processContentLine(blocks, trimmed);
    }
  }
}

// Process standard section
function processStandardSection(blocks, content) {
  const lines = content.split('\n');
  
  for (const line of lines) {
    processContentLine(blocks, line);
  }
}

// Process a single content line
function processContentLine(blocks, line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  
  // Detect line type and format accordingly
  if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('→')) {
    // Bullet point
    const text = trimmed.replace(/^[•\-→]\s*/, '').trim();
    addBulletChunks(blocks, text);
  } else if (trimmed.match(/^\d+\./)) {
    // Numbered item
    const text = trimmed.replace(/^\d+\.\s*/, '').trim();
    addNumberedChunks(blocks, text);
  } else if (trimmed.includes(':') && trimmed.indexOf(':') < 50) {
    // Potential key-value pair
    const colonIndex = trimmed.indexOf(':');
    const key = trimmed.substring(0, colonIndex).trim();
    const value = trimmed.substring(colonIndex + 1).trim();
    
    if (key.length < 100 && value) {
      if ((key + ': ' + value).length <= MAX_TEXT_LENGTH) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: key + ': ' },
                annotations: { bold: true }
              },
              {
                type: 'text',
                text: { content: value }
              }
            ]
          }
        });
      } else {
        blocks.push(createParagraphBold(key + ':'));
        addTextChunks(blocks, value);
      }
    } else {
      addTextChunks(blocks, trimmed);
    }
  } else {
    // Regular text
    addTextChunks(blocks, trimmed);
  }
}

// Helper functions for creating blocks
function createHeading1(text) {
  return {
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{
        type: 'text',
        text: { content: truncateText(text, MAX_TEXT_LENGTH) }
      }]
    }
  };
}

function createHeading2(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{
        type: 'text',
        text: { content: truncateText(text, MAX_TEXT_LENGTH) }
      }]
    }
  };
}

function createHeading3(text) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{
        type: 'text',
        text: { content: truncateText(text, MAX_TEXT_LENGTH) }
      }]
    }
  };
}

function createDivider() {
  return {
    object: 'block',
    type: 'divider',
    divider: {}
  };
}

function createParagraphBold(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        type: 'text',
        text: { content: truncateText(text, MAX_TEXT_LENGTH) },
        annotations: { bold: true }
      }]
    }
  };
}

// Add text in chunks
function addTextChunks(blocks, text) {
  const chunks = splitTextIntoChunks(text, MAX_TEXT_LENGTH);
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
}

// Add bullet points in chunks
function addBulletChunks(blocks, text) {
  const chunks = splitTextIntoChunks(text, MAX_TEXT_LENGTH);
  for (const chunk of chunks) {
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
  }
}

// Add numbered items in chunks
function addNumberedChunks(blocks, text) {
  const chunks = splitTextIntoChunks(text, MAX_TEXT_LENGTH);
  for (const chunk of chunks) {
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
  }
}

// Split text into chunks intelligently
function splitTextIntoChunks(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return [text || ''];
  }
  
  const chunks = [];
  
  // Try to split at sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      // Save current chunk
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      
      // Handle oversized sentence
      if (sentence.length > maxLength) {
        // Split by commas
        const parts = sentence.split(/,\s*/);
        currentChunk = '';
        
        for (const part of parts) {
          const partWithComma = part + (part === parts[parts.length - 1] ? '' : ', ');
          
          if ((currentChunk + partWithComma).length <= maxLength) {
            currentChunk += partWithComma;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            
            // If still too long, split by words
            if (partWithComma.length > maxLength) {
              const words = partWithComma.split(' ');
              currentChunk = '';
              
              for (const word of words) {
                if ((currentChunk + ' ' + word).trim().length <= maxLength) {
                  currentChunk += (currentChunk ? ' ' : '') + word;
                } else {
                  if (currentChunk) {
                    chunks.push(currentChunk.trim());
                  }
                  currentChunk = word;
                }
              }
            } else {
              currentChunk = partWithComma;
            }
          }
        }
      } else {
        currentChunk = sentence;
      }
    }
  }
  
  // Add remaining chunk
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.length > 0 ? chunks : [''];
}

// Truncate text if needed
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return text.substring(0, maxLength - 3) + '...';
}
