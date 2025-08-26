// api/clean-notion.js
import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export default async function handler(req, res) {
  console.log('Function invoked with method:', req.method);
  console.log('Request body:', req.body);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pageId } = req.body;

  if (!pageId) {
    console.error('No pageId provided in request');
    return res.status(400).json({ error: 'pageId is required' });
  }

  if (!process.env.NOTION_TOKEN) {
    console.error('NOTION_TOKEN not configured');
    return res.status(500).json({ error: 'Notion token not configured' });
  }

  if (!process.env.NOTION_CLEANED_PARENT_PAGE_ID) {
    console.error('NOTION_CLEANED_PARENT_PAGE_ID not configured');
    return res.status(500).json({ error: 'Parent page ID not configured' });
  }

  try {
    console.log(`Processing page: ${pageId}`);
    
    // Fetch the page blocks
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
    });

    console.log('Fetched blocks count:', response.results.length);
    
    // Extract text from all blocks
    let rawContent = '';
    let hasMore = true;
    let nextCursor = response.has_more ? response.next_cursor : null;
    let allBlocks = response.results;

    // Get all blocks if paginated
    while (hasMore && nextCursor) {
      const nextResponse = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: nextCursor
      });
      allBlocks = [...allBlocks, ...nextResponse.results];
      hasMore = nextResponse.has_more;
      nextCursor = nextResponse.next_cursor;
    }

    console.log('Total blocks fetched:', allBlocks.length);

    // Extract text from blocks - preserve the exact structure
    const contentLines = [];
    for (const block of allBlocks) {
      const text = extractTextFromBlock(block);
      if (text) {
        contentLines.push(text);
      }
    }

    rawContent = contentLines.join('\n');
    console.log('Content length:', rawContent.length);
    console.log('First 500 chars:', rawContent.substring(0, 500));

    if (!rawContent.trim()) {
      console.error('No content found in page');
      return res.status(400).json({ error: 'No content found in source page' });
    }

    // Extract company name
    const companyName = extractCompanyName(rawContent);
    console.log('Company:', companyName);

    // Create sections based on === markers
    const sections = parseClayContent(rawContent);
    console.log('Sections found:', sections.length);

    // Create the cleaned page
    const newPageId = await createCleanedPage(companyName, sections);
    
    console.log('Success! New page:', newPageId);
    return res.status(200).json({ 
      success: true, 
      pageId: newPageId,
      company: companyName 
    });

  } catch (error) {
    console.error('Error processing page:', error);
    console.error('Error details:', error.message);
    if (error.code) console.error('Error code:', error.code);
    if (error.status) console.error('Error status:', error.status);
    
    return res.status(500).json({ 
      error: 'Failed to process page',
      details: error.message,
      code: error.code
    });
  }
}

function extractTextFromBlock(block) {
  let text = '';
  
  // Handle different block types
  if (block.type === 'paragraph' && block.paragraph?.rich_text) {
    text = block.paragraph.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'heading_1' && block.heading_1?.rich_text) {
    text = '# ' + block.heading_1.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'heading_2' && block.heading_2?.rich_text) {
    text = '## ' + block.heading_2.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'heading_3' && block.heading_3?.rich_text) {
    text = '### ' + block.heading_3.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
    text = '• ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
    text = block.numbered_list_item.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'code' && block.code?.rich_text) {
    text = block.code.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'quote' && block.quote?.rich_text) {
    text = '"' + block.quote.rich_text.map(t => t.plain_text).join('') + '"';
  }
  
  return text;
}

function extractCompanyName(content) {
  // Try to find company name
  const patterns = [
    /Company Name:\s*([^\n\-]+)/i,
    /^#\s+CLAY_RAW_(.+?)(?:\s|$)/m,
    /^#\s+(.+?)(?:\s+-|$)/m,
    /^(.+?)\.(?:com|io|ai|app)\b/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim().replace(/_/g, ' ');
    }
  }

  return 'Company';
}

function parseClayContent(content) {
  const sections = [];
  
  // Split by === markers - these denote main sections in Clay
  const parts = content.split(/===+/);
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    
    // First line is usually the section title
    const lines = part.split('\n');
    const firstLine = lines[0].trim();
    
    // Check if this looks like a section header
    if (firstLine && (
      firstLine.match(/^\d+\.?\s+/) || // Numbered section
      firstLine.match(/^[IVX]+\.?\s+/) || // Roman numerals
      firstLine.match(/SNAPSHOT|SUMMARY|CAPABILITIES|PROFILE|PROPOSITION|TECHNOLOGY|CONTROL|INTEGRATION|STORIES|JOBS|FRAMEWORK/i)
    )) {
      const sectionTitle = firstLine.replace(/^[\d\.IVX]+\s+/, '').trim();
      const sectionContent = lines.slice(1).join('\n').trim();
      
      if (sectionTitle) {
        sections.push({
          title: sectionTitle,
          content: cleanContent(sectionContent)
        });
      }
    } else if (part.length > 50) {
      // If no clear title, use generic section name
      sections.push({
        title: `Section ${sections.length + 1}`,
        content: cleanContent(part)
      });
    }
  }
  
  // If no sections found with ===, try splitting by *** markers
  if (sections.length === 0) {
    const altParts = content.split(/\*\*\*+/);
    for (const part of altParts) {
      if (part.trim().length > 50) {
        sections.push({
          title: `Section ${sections.length + 1}`,
          content: cleanContent(part.trim())
        });
      }
    }
  }
  
  // If still no sections, treat entire content as one section
  if (sections.length === 0) {
    sections.push({
      title: 'Content',
      content: cleanContent(content)
    });
  }
  
  return sections;
}

function cleanContent(text) {
  // Light cleaning while preserving all content
  
  // Remove repetitive phrases
  text = text.replace(/Strategic takeaway:[^.]+\./gi, '');
  
  // Remove filler phrases
  text = text.replace(/It's worth noting that\s*/gi, '');
  text = text.replace(/In practical terms,\s*/gi, '');
  text = text.replace(/Generally speaking,\s*/gi, '');
  text = text.replace(/As mentioned previously,\s*/gi, '');
  
  // Clean up whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  
  return text.trim();
}

function splitText(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];
  
  const chunks = [];
  
  // First try to split by paragraphs (double newlines)
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      // If single paragraph is too long, split by sentences
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
      for (const sentence of sentences) {
        if (sentence.length > maxLength) {
          // If single sentence is too long, force split
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }
          
          // Split long sentence by words
          const words = sentence.split(/\s+/);
          let tempChunk = '';
          for (const word of words) {
            if ((tempChunk + ' ' + word).length > maxLength) {
              if (tempChunk) chunks.push(tempChunk.trim());
              tempChunk = word;
            } else {
              tempChunk += (tempChunk ? ' ' : '') + word;
            }
          }
          if (tempChunk) chunks.push(tempChunk.trim());
        } else if ((currentChunk + ' ' + sentence).length > maxLength) {
          if (currentChunk) chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
      }
    } else if ((currentChunk + '\n\n' + paragraph).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  
  return chunks;
}

async function createCleanedPage(companyName, sections) {
  const blocks = [];
  
  // Title
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{
        type: 'text',
        text: { content: `${companyName} - Cleaned for Presentation` }
      }]
    }
  });
  
  // Table of Contents
  if (sections.length > 1) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Table of Contents' } }]
      }
    });
    
    // Add TOC items
    for (let i = 0; i < sections.length; i++) {
      const tocText = `${i + 1}. ${sections[i].title}`;
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
    
    // Divider after TOC
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }
  
  // Add each section
  for (const section of sections) {
    // Section heading
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: section.title } }]
      }
    });
    
    // Section content - split if needed
    const contentChunks = splitText(section.content);
    
    for (const chunk of contentChunks) {
      // Detect what type of content this is
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        let blockToAdd = null;
        
        // Check if it's a bullet point
        if (trimmedLine.startsWith('• ') || trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
          const bulletContent = trimmedLine.replace(/^[•\-*]\s+/, '');
          if (bulletContent.length <= 2000) {
            blockToAdd = {
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [{ type: 'text', text: { content: bulletContent } }]
              }
            };
          }
        }
        // Check if it's a key-value pair
        else if (trimmedLine.includes(':') && trimmedLine.indexOf(':') < 50) {
          const colonIndex = trimmedLine.indexOf(':');
          const key = trimmedLine.substring(0, colonIndex).trim();
          const value = trimmedLine.substring(colonIndex + 1).trim();
          
          if (key.length + value.length <= 1900) {
            blockToAdd = {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  { type: 'text', text: { content: key + ': ' }, annotations: { bold: true } },
                  { type: 'text', text: { content: value } }
                ]
              }
            };
          } else {
            // If too long, just add as regular paragraph
            blockToAdd = {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content: trimmedLine.substring(0, 1900) } }]
              }
            };
          }
        }
        // Check if it's a score (e.g., "Something: 8/10")
        else if (trimmedLine.match(/:\s*\d+\/\d+/)) {
          blockToAdd = {
            object: 'block',
            type: 'callout',
            callout: {
              rich_text: [{ type: 'text', text: { content: trimmedLine } }],
              icon: { emoji: '📊' }
            }
          };
        }
        // Default to paragraph
        else if (trimmedLine.length <= 2000) {
          blockToAdd = {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: trimmedLine } }]
            }
          };
        }
        
        if (blockToAdd) {
          blocks.push(blockToAdd);
        }
      }
    }
    
    // Add divider between sections
    if (sections.indexOf(section) < sections.length - 1) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    }
  }
  
  // Create the page with first 100 blocks
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
  
  console.log(`Creating page with ${Math.min(blocks.length, 100)} initial blocks`);
  const response = await notion.pages.create(pageData);
  
  // Add remaining blocks in batches of 100
  if (blocks.length > 100) {
    const remainingBlocks = blocks.slice(100);
    console.log(`Adding ${remainingBlocks.length} additional blocks in batches`);
    
    for (let i = 0; i < remainingBlocks.length; i += 100) {
      const batch = remainingBlocks.slice(i, Math.min(i + 100, remainingBlocks.length));
      console.log(`Adding batch of ${batch.length} blocks`);
      
      await notion.blocks.children.append({
        block_id: response.id,
        children: batch
      });
    }
  }
  
  return response.id;
}
