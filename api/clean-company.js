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
      // Get content after the match until next === or end
      const startIndex = match.index + match[0].length;
      const remainingText = text.substring(startIndex);
      
      // Find where this section ends (next === or ***)
      const endMatch = remainingText.match(/(?:===|\*\*\*)/);
      const endIndex = endMatch ? endMatch.index : remainingText.length;
      
      const content = remainingText.substring(0, endIndex).trim();
      
      if (content.length > 10) {
        return cleanContent(content);
      }
    }
  }
  
  return null;
}

function cleanContent(text) {
  // Basic cleaning
  text = text.replace(/Strategic takeaway:[^\n]+/gi, '');
  text = text.replace(/\*{3,}/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  
  return text;
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
    
    chunks.push(remaining.substring(0, splitPoint)
