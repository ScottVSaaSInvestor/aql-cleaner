// api/clean-company.js
// Updated cleaner for Clay narrative text format

import { Client } from '@notionhq/client';

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Main handler function
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pageId, rawContent } = req.body;
    
    console.log('Cleaning request received for:', pageId);
    
    // If pageId provided, fetch from Notion
    let contentToClean = rawContent;
    if (pageId && !rawContent) {
      contentToClean = await fetchNotionContent(pageId);
    }
    
    // Clean the data
    const cleanedData = cleanCompanyData(contentToClean);
    
    // Create new clean page in Notion
    const newPage = await createCleanNotionPage(cleanedData);
    
    return res.status(200).json({ 
      success: true,
      cleanPageId: newPage.id,
      cleanPageUrl: newPage.url,
      message: `Successfully cleaned ${cleanedData.companyName}`
    });
    
  } catch (error) {
    console.error('Cleaning error:', error);
    return res.status(500).json({ 
      error: error.message,
      details: 'Check Vercel logs for more information'
    });
  }
}

// Fetch content from existing Notion page
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
        content += block.heading_1.rich_text.map(t => t.plain_text).join('') + '\n';
      }
      if (block.type === 'heading_2' && block.heading_2.rich_text) {
        content += block.heading_2.rich_text.map(t => t.plain_text).join('') + '\n';
      }
      if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text) {
        content += block.bulleted_list_item.rich_text.map(t => t.plain_text).join('') + '\n';
      }
    }
    
    return content;
  } catch (error) {
    throw new Error(`Failed to fetch Notion content: ${error.message}`);
  }
}

// Main cleaning function - updated for narrative text
function cleanCompanyData(rawContent) {
  const cleaned = {
    companyName: extractCompanyName(rawContent),
    yearFounded: extractYearFounded(rawContent),
    location: extractLocation(rawContent),
    website: extractWebsite(rawContent),
    vertical: extractVertical(rawContent),
    funding: extractFunding(rawContent),
    fteCount: extractFTECount(rawContent),
    executiveSummary: extractExecutiveSummary(rawContent),
    businessDescription: extractBusinessDescription(rawContent),
    customerOverview: extractCustomerOverview(rawContent),
    controlPointsScore: calculateControlPoints(rawContent),
  };
  
  cleaned.classification = getClassification(cleaned.controlPointsScore);
  
  return cleaned;
}

// Extract company name from narrative text
function extractCompanyName(raw) {
  // Look for patterns like "CompanyName.app exists" or "CompanyName operates"
  const patterns = [
    /([A-Za-z]+\.app)\s+exists/i,
    /([A-Za-z]+\.app)\s+is/i,
    /([A-Za-z]+\.app)\s+operates/i,
    /([A-Za-z]+\.app)\s+delivers/i,
    /([A-Za-z]+\.app)\s+provides/i,
    /for\s+([A-Za-z]+\.app)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  // Fallback: look for any .app domain
  const appMatch = raw.match(/([A-Za-z]+\.app)/i);
  if (appMatch) return appMatch[1];
  
  return 'Company Name Not Found';
}

// Extract year founded from narrative text
function extractYearFounded(raw) {
  // Look for explicit year founded patterns
  const patterns = [
    /Year Founded:\s*(\d{4})/i,
    /Founded:\s*(\d{4})/i,
    /established\s+in\s+(\d{4})/i,
    /In\s+(\d{4}),\s+[\w\.]+ was/i,
    /officially established in[^0-9]*(\d{4})/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return 'Not specified';
}

// Extract location from narrative text
function extractLocation(raw) {
  // Look for headquarters patterns
  const patterns = [
    /Headquarters Location:\s*([^\n]+)/i,
    /Headquarters:\s*([^\n]+)/i,
    /based in\s+([^,\n]+,\s*[^,\n]+)/i,
    /located in\s+([^,\n]+,\s*[^,\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  // Specific location matching
  if (raw.includes('New York, New York')) return 'New York, New York';
  if (raw.includes('New York, NY')) return 'New York, New York';
  
  return 'Not specified';
}

// Extract website
function extractWebsite(raw) {
  // Extract company name first and use as website
  const companyName = extractCompanyName(raw);
  if (companyName && companyName.includes('.app')) {
    return companyName.toLowerCase();
  }
  
  const patterns = [
    /Website:\s*(https?:\/\/[^\s\n]+)/i,
    /(?:www\.)?([a-z0-9\-]+\.[a-z]{2,})/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return 'Not specified';
}

// Extract vertical from narrative text
function extractVertical(raw) {
  // Look for specific vertical descriptions
  if (raw.includes('sports facility management') || raw.includes('sports and recreation')) {
    return 'Sports Facility Management Platform';
  }
  if (raw.includes('racket sports')) {
    return 'Racket Sports Management Platform';
  }
  if (raw.includes('autonomous') && raw.includes('venue')) {
    return 'Autonomous Venue Management Platform';
  }
  
  // Look for explicit vertical mentions
  const patterns = [
    /categorized as[^:]*:\s*([^\n.]+)/i,
    /Vertical SaaS.*?for\s+([^\n.]+)/i,
    /platform for\s+([^\n.]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return 'Vertical SaaS Platform';
}

// Extract funding from narrative text
function extractFunding(raw) {
  const patterns = [
    /Total Funding:\s*\$([^\n]+)/i,
    /Total Funding:\s*([^\n]+)/i,
    /\$(\d+(?:\.\d+)?\s*(?:million|Million|M))\s*\(Series [A-Z]\)/i,
    /raised\s+\$([^\n\)]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return 'Not specified';
}

// Extract FTE count
function extractFTECount(raw) {
  const patterns = [
    /Current Employee Count:\s*([^\n]+)/i,
    /Employee Count:\s*([0-9,]+)/i,
    /FTE.*?:\s*([0-9,]+)/i,
    /(\d+)\s+employees/i
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

// Extract executive summary from narrative sections
function extractExecutiveSummary(raw) {
  const summary = {
    challenge: '',
    solution: '',
    impact: ''
  };
  
  // Extract THE PROBLEM section
  const problemMatch = raw.match(/SECTION 3: THE PROBLEM([^]*?)(?=SECTION|$)/i);
  if (problemMatch) {
    const problemText = problemMatch[1].trim();
    // Get first major problem point
    const firstProblem = problemText.match(/1\.\s*([^]+?)(?=\n2\.|$)/);
    if (firstProblem) {
      summary.challenge = firstProblem[1].trim().substring(0, 500);
    } else {
      summary.challenge = problemText.substring(0, 500);
    }
  }
  
  // Extract THE SOLUTION section
  const solutionMatch = raw.match(/SECTION 4: THE SOLUTION([^]*?)(?=SECTION|$)/i);
  if (solutionMatch) {
    const solutionText = solutionMatch[1].trim();
    // Get the main solution description
    const mainSolution = solutionText.split('•')[0];
    summary.solution = mainSolution.trim().substring(0, 500);
  }
  
  // Extract impact/ROI section
  const roiMatch = raw.match(/RETURN ON INVESTMENT([^]*?)(?=SECTION|$)/i);
  if (roiMatch) {
    const roiText = roiMatch[1].trim();
    summary.impact = roiText.substring(0, 500);
  } else {
    // Fallback to mission statement
    const missionMatch = raw.match(/mission is[^.]+\./i);
    if (missionMatch) {
      summary.impact = missionMatch[0];
    }
  }
  
  return summary;
}

// Extract business description from narrative
function extractBusinessDescription(raw) {
  // Look for BUSINESS & PRODUCT DESCRIPTION section
  const businessMatch = raw.match(/BUSINESS & PRODUCT DESCRIPTION([^]*?)(?=\n\d+\.|SECTION|$)/i);
  if (businessMatch) {
    return businessMatch[1].trim().substring(0, 1000);
  }
  
  // Fallback to INTRODUCTION section
  const introMatch = raw.match(/SECTION 1: INTRODUCTION([^]*?)(?=SECTION|$)/i);
  if (introMatch) {
    return introMatch[1].trim().substring(0, 1000);
  }
  
  return 'Business description to be extracted';
}

// Extract customer overview
function extractCustomerOverview(raw) {
  // Look for CUSTOMERS section
  const customerMatch = raw.match(/CUSTOMERS[^:]*:([^]*?)(?=\n\d+\.|SECTION|$)/i);
  if (customerMatch) {
    return customerMatch[1].trim().substring(0, 800);
  }
  
  // Look for TARGET AUDIENCE section
  const targetMatch = raw.match(/TARGET AUDIENCE([^]*?)(?=SECTION|$)/i);
  if (targetMatch) {
    return targetMatch[1].trim().substring(0, 800);
  }
  
  return 'Customer overview to be extracted';
}

// Calculate control points (basic scoring based on content)
function calculateControlPoints(raw) {
  let totalScore = 0;
  
  // Data Gravity indicators
  if (raw.match(/centralized|unified|single source|data repository/i)) totalScore += 4.5;
  
  // Workflow Gravity indicators
  if (raw.match(/automat|workflow|streamline|process/i)) totalScore += 4.5;
  
  // Account Gravity indicators
  if (raw.match(/membership|retention|customer satisfaction/i)) totalScore += 4;
  
  // Network Effects indicators
  if (raw.match(/network|viral|social|collaboration/i)) totalScore += 3.5;
  
  // Ecosystem Control indicators
  if (raw.match(/ecosystem|integration|platform|api/i)) totalScore += 4;
  
  // Product Extension indicators
  if (raw.match(/ai|machine learning|analytics|predictive/i)) totalScore += 4;
  
  return Math.min(totalScore, 30); // Cap at 30
}

// Get classification based on score
function getClassification(score) {
  if (score >= 25) return 'SYSTEM OF RECORD';
  if (score >= 20) return 'CORE SAAS';
  if (score >= 15) return 'SYSTEM OF WORKFLOW';
  return 'POINT SOLUTION';
}

// Create clean Notion page
async function createCleanNotionPage(data) {
  try {
    const content = formatForNotion(data);
    
    let parent = {};
    
    if (process.env.NOTION_CLEANED_DATABASE_ID) {
      parent = { database_id: process.env.NOTION_CLEANED_DATABASE_ID };
    } else if (process.env.NOTION_CLEANED_PARENT_PAGE_ID) {
      parent = { page_id: process.env.NOTION_CLEANED_PARENT_PAGE_ID };
    } else if (process.env.NOTION_PARENT_PAGE_ID) {
      parent = { page_id: process.env.NOTION_PARENT_PAGE_ID };
    }
    
    let properties = {
      title: {
        title: [{
          text: {
            content: `${data.companyName} - Cleaned`
          }
        }]
      }
    };
    
    const response = await notion.pages.create({
      parent: parent,
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
      properties: properties,
      children: content
    });
    
    console.log(`Created cleaned page for ${data.companyName}`);
    return response;
    
  } catch (error) {
    throw new Error(`Failed to create Notion page: ${error.message}`);
  }
}

// Format data for Notion blocks
function formatForNotion(data) {
  const blocks = [
    {
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{
          type: 'text',
          text: { content: 'COMPANY SNAPSHOT' }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `Company Name: ${data.companyName}` }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `Year Founded: ${data.yearFounded}` }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `Location: ${data.location}` }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `Website: ${data.website}` }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `Software Category & Vertical: ${data.vertical}` }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `FTE Count: ${data.fteCount}` }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `Funding History: ${data.funding}` }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `CONTROL POINTS: FINAL SCORE: ${data.controlPointsScore} / 30 ——> ${data.classification}` },
          annotations: { bold: true }
        }]
      }
    },
    {
      object: 'block',
      type: 'divider',
      divider: {}
    },
    {
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{
          type: 'text',
          text: { content: 'EXECUTIVE SUMMARY' }
        }]
      }
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{
          type: 'text',
          text: { content: 'The Challenge' }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: data.executiveSummary.challenge || 'To be extracted' }
        }]
      }
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{
          type: 'text',
          text: { content: 'The Solution' }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: data.executiveSummary.solution || 'To be extracted' }
        }]
      }
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{
          type: 'text',
          text: { content: 'Customer Success' }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: data.executiveSummary.impact || 'To be extracted' }
        }]
      }
    },
    {
      object: 'block',
      type: 'divider',
      divider: {}
    },
    {
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{
          type: 'text',
          text: { content: 'BUSINESS DESCRIPTION' }
        }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: data.businessDescription }
        }]
      }
    }
  ];
  
  return blocks;
}
