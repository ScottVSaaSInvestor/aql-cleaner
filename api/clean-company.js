// api/clean-notion.js
import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

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
    
    // Fetch all blocks from the Clay page
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
    
    console.log(`Fetched ${allBlocks.length} blocks`);
    
    // Extract all text content
    let fullText = '';
    for (const block of allBlocks) {
      const text = extractText(block);
      if (text) {
        fullText += text + '\n';
      }
    }
    
    console.log(`Extracted ${fullText.length} characters`);
    
    if (!fullText.trim()) {
      return res.status(400).json({ error: 'No content found' });
    }
    
    // Get company name
    let companyName = 'Company';
    const nameMatch = fullText.match(/CLAY_RAW_(.+?)(?:\s|===|\n)/i);
    if (nameMatch) {
      companyName = nameMatch[1].replace(/_/g, ' ').trim();
    }
    console.log(`Company: ${companyName}`);
    
    // Parse the content into your standard structure
    const structuredData = parseIntoStandardStructure(fullText);
    
    // Create the cleaned page
    const newPageId = await createCleanedPage(companyName, structuredData);
    
    console.log(`Success! Created page: ${newPageId}`);
    return res.status(200).json({ 
      success: true, 
      pageId: newPageId,
      company: companyName 
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Failed to process page',
      details: error.message 
    });
  }
}

function extractText(block) {
  const type = block.type;
  const data = block[type];
  
  if (data?.rich_text) {
    return data.rich_text.map(t => t.plain_text || '').join('');
  }
  
  return '';
}

function parseIntoStandardStructure(text) {
  // Your standard TOC structure
  const structure = {
    'Part 1: Company Overview': [],
    'Part 2: Control Points Analysis': []
  };
  
  // Part 1 mappings - look for these sections in the Clay text
  const part1Sections = [
    {
      title: '1. Company Snapshot',
      patterns: [/===\s*(?:\d+\.\s*)?COMPANY SNAPSHOT\s*===/i, /Company Name:.*?(?=\n\n|===)/s]
    },
    {
      title: '2. Product Overview',
      patterns: [/===\s*(?:\d+\.\s*)?(?:PRODUCT OVERVIEW|KEY MODULES|FEATURES)\s*===/i]
    },
    {
      title: '3. Vertical Specificity',
      patterns: [/===\s*(?:\d+\.\s*)?VERTICAL[- ]SPECIFIC(?:ITY)?\s*(?:CAPABILITIES)?\s*===/i]
    },
    {
      title: '4. Customer Overview',
      patterns: [/===\s*(?:\d+\.\s*)?CUSTOMER (?:OVERVIEW|PROFILE)\s*===/i]
    },
    {
      title: '5. ICP Analysis',
      patterns: [/===\s*(?:\d+\.\s*)?ICP ANALYSIS\s*===/i]
    },
    {
      title: '6. Customer Jobs to be Done',
      patterns: [/===\s*(?:\d+\.\s*)?(?:CUSTOMER\s*)?JOBS TO BE DONE\s*===/i, /===\s*[IVX]+\.\s*KEY JOBS\s*===/i]
    },
    {
      title: '7. Customer Success Stories',
      patterns: [/===\s*(?:\d+\.\s*)?(?:CUSTOMER\s*)?SUCCESS STORIES\s*===/i]
    },
    {
      title: '8. Market Overview',
      patterns: [/===\s*(?:\d+\.\s*)?MARKET OVERVIEW\s*===/i]
    },
    {
      title: '9. TAM / SAM / SOM',
      patterns: [/===\s*(?:\d+\.\s*)?(?:TAM|MARKET SIZE)\s*===/i]
    },
    {
      title: '10. Competitive Analysis',
      patterns: [/===\s*(?:\d+\.\s*)?COMPETITIVE ANALYSIS\s*===/i]
    },
    {
      title: '11. Competitive Market Map',
      patterns: [/===\s*(?:\d+\.\s*)?(?:COMPETITIVE\s*)?MARKET MAP\s*===/i]
    }
  ];
  
  // Part 2 mappings - Control Points
  const part2Sections = [
    {
      title: '1. Data Gravity Analysis',
      patterns: [/===\s*(?:\d+\.\s*)?DATA GRAVITY\s*===/i, /Data Gravity.*?Score.*?\d+\/\d+/si]
    },
    {
      title: '2. Workflow Gravity Analysis',
      patterns: [/===\s*(?:\d+\.\s*)?WORKFLOW GRAVITY\s*===/i, /Workflow Gravity.*?Score.*?\d+\/\d+/si]
    },
    {
      title: '3. Account Gravity Analysis',
      patterns: [/===\s*(?:\d+\.\s*)?ACCOUNT GRAVITY\s*===/i, /Account Gravity.*?Score.*?\d+\/\d+/si]
    },
    {
      title: '4. Network Effects Analysis',
      patterns: [/===\s*(?:\d+\.\s*)?NETWORK EFFECTS\s*===/i, /Network Effects.*?Score.*?\d+\/\d+/si]
    },
    {
      title: '5. Ecosystem Control Points Analysis',
      patterns: [/===\s*(?:\d+\.\s*)?ECOSYSTEM\s*(?:CONTROL POINTS)?\s*===/i, /Ecosystem.*?Score.*?\d+\/\d+/si]
    },
    {
      title: '6. Product Extension Analysis',
      patterns: [/===\s*(?:\d+\.\s*)?PRODUCT EXTENSION\s*===/i, /Product Extension.*?Score.*?\d+\/\d+/si]
    },
    {
      title: '7. Final Control Points Conclusions',
      patterns: [/===\s*(?:\d+\.\s*)?(?:FINAL\s*)?CONTROL POINTS\s*(?:CONCLUSION)?\s*===/i]
    },
    {
      title: '8. Final Total Score and Classification',
      patterns: [/Total Score:.*?\d+\/\d+/i, /Overall Score:.*?\d+\/\d+/i, /Classification:.*?(?:HOLD|PASS|INVEST)/i]
    }
  ];
  
  // Extract content for Part 1
  for (const section of part1Sections) {
    const content = extractSectionContent(text, section.patterns);
    structure['Part 1: Company Overview'].push({
      title: section.title,
      content: content || 'Content to be added'
    });
  }
  
  // Extract content for Part 2
  for (const section of part2Sections) {
    const content = extractSectionContent(text, section.patterns);
    structure['Part 2: Control Points Analysis'].push({
      title: section.title,
      content: content || 'Content to be added'
    });
  }
  
  return structure;
}

function extractSectionContent(text, patterns) {
  for (const pattern of patterns) {
    // Try to match the pattern
    const match = text.match(pattern);
    if (match) {
      // Get content after the match
      const startIndex = match.index + match[0].length;
      const remainingText = text.substring(startIndex);
      
      // Look for the next section marker - be more specific
      // Stop at the next numbered section, === marker, or control points section
      const stopPatterns = [
        /===\s*\d+\./,  // === followed by number
        /===\s*[IVX]+\./,  // === followed by roman numeral
        /===\s*[A-Z][A-Z\s]+===/,  // === followed by all caps title
        /\n\d+\.\s+[A-Z][A-Z\s]+===/,  // Numbered section with ===
        /\*{3,}/,  // Three or more asterisks
        /^#{1,3}\s+/m,  // Markdown headers
        /CONTROL POINTS/i,  // Control points sections
        /Data Gravity/i,  // Start of control points
        /Workflow Gravity/i,
        /Account Gravity/i,
        /Network Effects/i,
        /Ecosystem Control/i,
        /Product Extension/i,
        /Total Score:/i,
        /Overall Score:/i,
        /Classification:/i
      ];
      
      let endIndex = remainingText.length;
      for (const stopPattern of stopPatterns) {
        const stopMatch = remainingText.match(stopPattern);
        if (stopMatch && stopMatch.index < endIndex) {
          endIndex = stopMatch.index;
        }
      }
      
      // Extract just this section's content
      let content = remainingText.substring(0, endIndex).trim();
      
      // Remove any trailing section headers that got included
      content = content.replace(/===\s*$/, '');
      content = content.replace(/\*{3,}\s*$/, '');
      
      // Only return if we have meaningful content
      if (content.length > 20 && !content.match(/^===/) && !content.match(/^\*{3,}/)) {
        return cleanContent(content);
      }
    }
  }
  
  return null;
}

function cleanContent(text) {
  // Remove filler phrases and redundant language
  const fillerPhrases = [
    /Strategic takeaway:[^\n]+/gi,
    /It's worth noting that\s*/gi,
    /In practical terms,\s*/gi,
    /Generally speaking,\s*/gi,
    /As mentioned previously,\s*/gi,
    /Furthermore,\s*/gi,
    /Additionally,\s*/gi,
    /Moreover,\s*/gi,
    /It should be noted that\s*/gi,
    /In other words,\s*/gi,
    /That being said,\s*/gi,
    /It is important to note that\s*/gi,
  ];
  
  for (const filler of fillerPhrases) {
    text = text.replace(filler, '');
  }
  
  // Clean up formatting artifacts
  text = text.replace(/\*{3,}/g, '');
  text = text.replace(/={3,}/g, '');
  text = text.replace(/\[Paragraph \d+\]:\s*/gi, '');
  
  // Format lists properly
  text = text.replace(/^[-*]\s+/gm, '• ');
  
  // Format key-value pairs (e.g., "Company Name: XYZ" becomes bold key)
  text = text.replace(/^([A-Za-z][A-Za-z\s]+):\s+(.+)$/gm, (match, key, value) => {
    if (key.length < 50) {  // Reasonable key length
      return `**${key}:** ${value}`;
    }
    return match;
  });
  
  // Format scores (e.g., "8/10" becomes **8/10**)
  text = text.replace(/(\d+\/\d+)/g, '**$1**');
  
  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  
  // Ensure sentences are properly capitalized
  text = text.replace(/\.\s+([a-z])/g, (match, letter) => `. ${letter.toUpperCase()}`);
  
  return text.trim();
}

function splitIntoChunks(text, maxLength = 1900) {
  if (!text || text.length <= maxLength) return [text];
  
  const chunks = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    
    // Try to split at a good break point
    let splitPoint = maxLength;
    
    // Look for paragraph break
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphBreak > maxLength * 0.5) {
      splitPoint = paragraphBreak;
    } else {
      // Look for sentence end
      const sentenceEnd = remaining.lastIndexOf('. ', maxLength);
      if (sentenceEnd > maxLength * 0.5) {
        splitPoint = sentenceEnd + 1;
      } else {
        // Look for any space
        const spaceBreak = remaining.lastIndexOf(' ', maxLength);
        if (spaceBreak > maxLength * 0.5) {
          splitPoint = spaceBreak;
        }
      }
    }
    
    chunks.push(remaining.substring(0, splitPoint).trim());
    remaining = remaining.substring(splitPoint).trim();
  }
  
  return chunks;
}

async function createCleanedPage(companyName, structure) {
  const blocks = [];
  
  // Title page
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{
        type: 'text',
        text: { content: `${companyName} Overview` }
      }]
    }
  });
  
  // Overall Table of Contents
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Table of Contents' } }]
    }
  });
  
  // Add TOC for Part 1
  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ 
        type: 'text', 
        text: { content: 'Part 1: Company Overview' },
        annotations: { bold: true }
      }]
    }
  });
  
  for (const section of structure['Part 1: Company Overview']) {
    blocks.push({
      object: 'block',
      type: 'numbered_list_item',
      numbered_list_item: {
        rich_text: [{ type: 'text', text: { content: section.title.substring(3) } }]  // Remove number prefix
      }
    });
  }
  
  // Add TOC for Part 2
  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ 
        type: 'text', 
        text: { content: 'Part 2: Control Points Analysis' },
        annotations: { bold: true }
      }]
    }
  });
  
  for (const section of structure['Part 2: Control Points Analysis']) {
    blocks.push({
      object: 'block',
      type: 'numbered_list_item',
      numbered_list_item: {
        rich_text: [{ type: 'text', text: { content: section.title.substring(3) } }]  // Remove number prefix
      }
    });
  }
  
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  
  // Part 1 Content
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{ type: 'text', text: { content: 'Part 1: Company Overview' } }]
    }
  });
  
  for (const section of structure['Part 1: Company Overview']) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: section.title } }]
      }
    });
    
    // Process content with proper formatting
    const contentBlocks = processFormattedContent(section.content);
    blocks.push(...contentBlocks);
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }
  
  // Part 2 Content
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{ type: 'text', text: { content: 'Part 2: Control Points Analysis' } }]
    }
  });
  
  for (const section of structure['Part 2: Control Points Analysis']) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: section.title } }]
      }
    });
    
    // Process content with special handling for scores
    const contentBlocks = processFormattedContent(section.content, section.title.includes('Score') || section.title.includes('Control Points'));
    blocks.push(...contentBlocks);
    
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }
  
  // Create the page
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

function processFormattedContent(content, isScoreSection = false) {
  const blocks = [];
  
  if (!content || content === 'Content to be added') {
    blocks.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: 'Content to be added' } }],
        icon: { emoji: '📝' },
        color: 'gray_background'
      }
    });
    return blocks;
  }
  
  const lines = content.split('\n');
  let currentParagraph = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) {
      // Empty line - flush current paragraph
      if (currentParagraph.length > 0) {
        const paragraphText = currentParagraph.join(' ');
        const chunks = splitIntoChunks(paragraphText);
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: formatRichText(chunk)
            }
          });
        }
        currentParagraph = [];
      }
      continue;
    }
    
    // Handle bullets
    if (trimmed.startsWith('•')) {
      // Flush current paragraph first
      if (currentParagraph.length > 0) {
        const paragraphText = currentParagraph.join(' ');
        const chunks = splitIntoChunks(paragraphText);
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: formatRichText(chunk)
            }
          });
        }
        currentParagraph = [];
      }
      
      const bulletText = trimmed.substring(1).trim();
      const chunks = splitIntoChunks(bulletText);
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: formatRichText(chunk)
          }
        });
      }
    }
    // Handle numbered items
    else if (trimmed.match(/^\d+\./)) {
      // Flush current paragraph first
      if (currentParagraph.length > 0) {
        const paragraphText = currentParagraph.join(' ');
        const chunks = splitIntoChunks(paragraphText);
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: formatRichText(chunk)
            }
          });
        }
        currentParagraph = [];
      }
      
      const numberedText = trimmed.replace(/^\d+\.\s*/, '');
      const chunks = splitIntoChunks(numberedText);
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: formatRichText(chunk)
          }
        });
      }
    }
    // Handle scores with callout
    else if ((trimmed.includes('/10') || trimmed.includes('/30')) && isScoreSection) {
      // Flush current paragraph first
      if (currentParagraph.length > 0) {
        const paragraphText = currentParagraph.join(' ');
        const chunks = splitIntoChunks(paragraphText);
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: formatRichText(chunk)
            }
          });
        }
        currentParagraph = [];
      }
      
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: formatRichText(trimmed),
          icon: { emoji: '📊' },
          color: 'blue_background'
        }
      });
    }
    // Regular paragraph line
    else {
      currentParagraph.push(trimmed);
    }
  }
  
  // Flush any remaining paragraph
  if (currentParagraph.length > 0) {
    const paragraphText = currentParagraph.join(' ');
    const chunks = splitIntoChunks(paragraphText);
    for (const chunk of chunks) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: formatRichText(chunk)
        }
      });
    }
  }
  
  return blocks;
}

function formatRichText(text) {
  // Handle bold text marked with **
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  const richText = [];
  
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      // This is bold text
      richText.push({
        type: 'text',
        text: { content: part.slice(2, -2) },
        annotations: { bold: true }
      });
    } else if (part) {
      // Regular text
      richText.push({
        type: 'text',
        text: { content: part }
      });
    }
  }
  
  // If no formatting was found, return simple text
  if (richText.length === 0) {
    return [{ type: 'text', text: { content: text } }];
  }
  
  // Ensure text doesn't exceed 2000 chars per block
  return richText.map(item => ({
    ...item,
    text: { content: item.text.content.substring(0, 1900) }
  }));
}
