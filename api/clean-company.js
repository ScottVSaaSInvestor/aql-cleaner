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
    
    // Fetch the page blocks (not the page itself)
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

    // Extract text from blocks
    for (const block of allBlocks) {
      const text = extractTextFromBlock(block);
      if (text) {
        rawContent += text + '\n';
      }
    }

    console.log('Content length:', rawContent.length);
    console.log('First 500 chars:', rawContent.substring(0, 500));

    if (!rawContent.trim()) {
      console.error('No content found in page');
      return res.status(400).json({ error: 'No content found in source page' });
    }

    // Clean and structure the content
    const cleanedData = cleanRawData(rawContent);
    
    if (!cleanedData.company) {
      console.error('Could not extract company name');
      cleanedData.company = 'Unknown Company';
    }

    console.log('Company:', cleanedData.company);
    console.log('Sections found:', Object.keys(cleanedData).length);

    // Create the cleaned page
    const newPageId = await createCleanedPage(cleanedData);
    
    console.log('Success! New page:', newPageId);
    return res.status(200).json({ 
      success: true, 
      pageId: newPageId,
      company: cleanedData.company 
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
    text = block.heading_1.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'heading_2' && block.heading_2?.rich_text) {
    text = block.heading_2.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'heading_3' && block.heading_3?.rich_text) {
    text = block.heading_3.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
    text = '• ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
    text = block.numbered_list_item.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'code' && block.code?.rich_text) {
    text = block.code.rich_text.map(t => t.plain_text).join('');
  } else if (block.type === 'quote' && block.quote?.rich_text) {
    text = block.quote.rich_text.map(t => t.plain_text).join('');
  }
  
  return text;
}

function cleanRawData(content) {
  const cleaned = {
    company: extractCompanyName(content),
    tableOfContents: [],
    sections: []
  };

  // Remove excess wordiness while preserving insights
  content = reduceWordiness(content);

  // Split content by main section markers (=== or ***)
  const sectionParts = content.split(/(?:===+|\*\*\*+)/);
  
  for (let i = 0; i < sectionParts.length; i++) {
    const part = sectionParts[i].trim();
    if (!part) continue;

    // Check if this is a section header
    const headerMatch = part.match(/^[\d\w\s\-\.]+(?:SNAPSHOT|SUMMARY|CAPABILITIES|PROFILE|PROPOSITION|TECHNOLOGY|DIFFERENTIATION|CONTROL POINTS|INTEGRATION|ARCHITECTURE|STORIES|JOBS|FRAMEWORK)/i);
    
    if (headerMatch || part.length > 100) {
      // This is likely a section with content
      const sectionTitle = headerMatch ? headerMatch[0].trim() : `Section ${cleaned.sections.length + 1}`;
      
      // Add to table of contents
      cleaned.tableOfContents.push(sectionTitle);
      
      // Process the section content
      const sectionContent = part.replace(headerMatch ? headerMatch[0] : '', '').trim();
      
      cleaned.sections.push({
        title: sectionTitle,
        content: processSectionContent(sectionContent, sectionTitle)
      });
    }
  }

  // If no sections were found, treat the entire content as one section
  if (cleaned.sections.length === 0 && content.trim()) {
    cleaned.sections.push({
      title: 'Content',
      content: processSectionContent(content, 'Content')
    });
  }

  return cleaned;
}

function extractCompanyName(content) {
  // Try multiple patterns to find company name
  const patterns = [
    /Company Name:\s*([^\n\-]+)/i,
    /^#\s+(.+?)(?:\s+-|$)/m,
    /^(.+?)\.(?:com|io|ai|app)\b/i,
    /^(.+?)\s+====/m
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function reduceWordiness(text) {
  // Remove repetitive strategic takeaways
  text = text.replace(/Strategic takeaway:[^.]+\./gi, '');
  
  // Remove common filler phrases but preserve the content after them
  const fillers = [
    /It's worth noting that\s*/gi,
    /It should be noted that\s*/gi,
    /In practical terms,\s*/gi,
    /Generally speaking,\s*/gi,
    /As mentioned previously,\s*/gi,
    /Furthermore,\s*/gi,
    /Additionally,\s*/gi,
    /Moreover,\s*/gi,
    /In other words,\s*/gi,
    /That being said,\s*/gi,
    /It is important to note that\s*/gi,
    /It's important to mention that\s*/gi
  ];
  
  fillers.forEach(filler => {
    text = text.replace(filler, '');
  });
  
  // Clean up excessive whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  
  return text.trim();
}

function processSectionContent(content, sectionTitle) {
  const processedContent = [];
  
  // Special handling for different section types
  if (sectionTitle.includes('SNAPSHOT')) {
    processedContent.push(...processSnapshot(content));
  } else if (sectionTitle.includes('EXECUTIVE SUMMARY')) {
    processedContent.push(...processExecutiveSummary(content));
  } else if (sectionTitle.includes('CONTROL POINTS')) {
    processedContent.push(...processControlPoints(content));
  } else if (sectionTitle.includes('STORIES')) {
    processedContent.push(...processStories(content));
  } else if (sectionTitle.includes('JOBS')) {
    processedContent.push(...processJobs(content));
  } else {
    // Default processing for other sections
    processedContent.push(...processGenericSection(content));
  }
  
  return processedContent;
}

function processSnapshot(content) {
  const items = [];
  const lines = content.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    if (line.includes(':')) {
      const [label, value] = line.split(':').map(s => s.trim());
      items.push({
        type: 'key_value',
        label: label.replace(/^-\s*/, ''),
        value: value || ''
      });
    } else if (line.trim()) {
      items.push({
        type: 'text',
        content: line.trim()
      });
    }
  }
  
  return items;
}

function processExecutiveSummary(content) {
  const items = [];
  
  // Extract paragraphs marked as [Paragraph X]
  const paragraphs = content.split(/\[Paragraph \d+\]/i).filter(p => p.trim());
  
  for (const paragraph of paragraphs) {
    const cleanParagraph = paragraph.trim().replace(/^\s*[:：]\s*/, '');
    if (cleanParagraph) {
      items.push({
        type: 'paragraph',
        content: cleanParagraph
      });
    }
  }
  
  // If no paragraph markers, treat as regular content
  if (items.length === 0 && content.trim()) {
    items.push({
      type: 'paragraph',
      content: content.trim()
    });
  }
  
  return items;
}

function processControlPoints(content) {
  const items = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const scoreLine = line.match(/(.+?):\s*(\d+\/\d+)/);
    if (scoreLine) {
      items.push({
        type: 'score',
        label: scoreLine[1].trim(),
        value: scoreLine[2]
      });
    } else if (line.includes('Total Score:') || line.includes('Overall Score:')) {
      items.push({
        type: 'total_score',
        content: line.trim()
      });
    } else if (line.trim()) {
      items.push({
        type: 'text',
        content: line.trim()
      });
    }
  }
  
  return items;
}

function processStories(content) {
  const items = [];
  const stories = content.split(/(?:Story \d+:|Customer Story:|Success Story:)/i);
  
  for (const story of stories) {
    if (story.trim()) {
      items.push({
        type: 'story',
        content: story.trim()
      });
    }
  }
  
  return items;
}

function processJobs(content) {
  const items = [];
  const jobs = content.split(/(?:Job \d+:|When I|I want to|So that)/i);
  
  for (const job of jobs) {
    if (job.trim() && job.length > 10) {
      items.push({
        type: 'job',
        content: job.trim()
      });
    }
  }
  
  return items;
}

function processGenericSection(content) {
  const items = [];
  const lines = content.split('\n');
  let currentList = [];
  let currentParagraph = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (!trimmedLine) {
      // Empty line - flush current paragraph
      if (currentParagraph.length > 0) {
        items.push({
          type: 'paragraph',
          content: currentParagraph.join(' ')
        });
        currentParagraph = [];
      }
    } else if (trimmedLine.match(/^[-•*]\s+/)) {
      // Bullet point
      if (currentParagraph.length > 0) {
        items.push({
          type: 'paragraph',
          content: currentParagraph.join(' ')
        });
        currentParagraph = [];
      }
      currentList.push(trimmedLine.replace(/^[-•*]\s+/, ''));
    } else if (trimmedLine.match(/^\d+\.\s+/)) {
      // Numbered list
      if (currentParagraph.length > 0) {
        items.push({
          type: 'paragraph',
          content: currentParagraph.join(' ')
        });
        currentParagraph = [];
      }
      items.push({
        type: 'numbered',
        content: trimmedLine.replace(/^\d+\.\s+/, '')
      });
    } else {
      // Regular text
      if (currentList.length > 0) {
        items.push({
          type: 'bullet_list',
          items: currentList
        });
        currentList = [];
      }
      currentParagraph.push(trimmedLine);
    }
  }
  
  // Flush remaining content
  if (currentParagraph.length > 0) {
    items.push({
      type: 'paragraph',
      content: currentParagraph.join(' ')
    });
  }
  if (currentList.length > 0) {
    items.push({
      type: 'bullet_list',
      items: currentList
    });
  }
  
  return items;
}

function splitIntoChunks(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];
  
  const chunks = [];
  let currentChunk = '';
  
  // Try to split at sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      
      // If single sentence is too long, split it
      if (sentence.length > maxLength) {
        const words = sentence.split(' ');
        currentChunk = '';
        for (const word of words) {
          if ((currentChunk + ' ' + word).length <= maxLength) {
            currentChunk += (currentChunk ? ' ' : '') + word;
          } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = word;
          }
        }
      } else {
        currentChunk = sentence;
      }
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  
  return chunks;
}

async function createCleanedPage(data) {
  const blocks = [];
  
  // Title
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{
        type: 'text',
        text: { content: `${data.company || 'Company'} - Cleaned for Presentation` }
      }]
    }
  });
  
  // Table of Contents
  if (data.tableOfContents && data.tableOfContents.length > 0) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Table of Contents' } }]
      }
    });
    
    for (let i = 0; i < data.tableOfContents.length; i++) {
      const tocItem = `${i + 1}. ${data.tableOfContents[i]}`;
      if (tocItem.length <= 2000) {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ type: 'text', text: { content: tocItem } }]
          }
        });
      }
    }
  }
  
  // Divider
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  
  // Sections
  for (const section of data.sections) {
    // Section title
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: section.title } }]
      }
    });
    
    // Section content
    for (const item of section.content) {
      if (item.type === 'key_value') {
        const text = `${item.label}: ${item.value}`;
        const chunks = splitIntoChunks(text);
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                { type: 'text', text: { content: item.label + ': ' }, annotations: { bold: true } },
                { type: 'text', text: { content: item.value } }
              ].filter(rt => rt.text.content.length <= 2000)
            }
          });
        }
      } else if (item.type === 'paragraph' || item.type === 'text') {
        const chunks = splitIntoChunks(item.content);
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: chunk } }]
            }
          });
        }
      } else if (item.type === 'bullet_list') {
        for (const bullet of item.items) {
          const chunks = splitIntoChunks(bullet);
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
      } else if (item.type === 'numbered') {
        const chunks = splitIntoChunks(item.content);
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'numbered_list_item',
            numbered_list_item: {
              rich_text: [{ type: 'text', text: { content: chunk } }]
            }
          });
        }
      } else if (item.type === 'score') {
        blocks.push({
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [
              { type: 'text', text: { content: `${item.label}: ` }, annotations: { bold: true } },
              { type: 'text', text: { content: item.value } }
            ],
            icon: { emoji: '📊' }
          }
        });
      } else if (item.type === 'total_score') {
        blocks.push({
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ type: 'text', text: { content: item.content }, annotations: { bold: true } }],
            icon: { emoji: '🎯' },
            color: 'green_background'
          }
        });
      } else if (item.type === 'story' || item.type === 'job') {
        const chunks = splitIntoChunks(item.content);
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'quote',
            quote: {
              rich_text: [{ type: 'text', text: { content: chunk } }]
            }
          });
        }
      }
    }
    
    // Add divider between sections
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }
  
  // Create the page with blocks (Notion allows max 100 blocks per request)
  const pageData = {
    parent: { page_id: process.env.NOTION_CLEANED_PARENT_PAGE_ID },
    properties: {
      title: {
        title: [{
          text: { content: `${data.company || 'Company'} - Cleaned for Presentation` }
        }]
      }
    },
    children: blocks.slice(0, 100) // First 100 blocks
  };
  
  const response = await notion.pages.create(pageData);
  
  // If there are more than 100 blocks, add them in batches
  if (blocks.length > 100) {
    const remainingBlocks = blocks.slice(100);
    const batches = [];
    
    for (let i = 0; i < remainingBlocks.length; i += 100) {
      batches.push(remainingBlocks.slice(i, i + 100));
    }
    
    for (const batch of batches) {
      await notion.blocks.children.append({
        block_id: response.id,
        children: batch
      });
    }
  }
  
  return response.id;
}
