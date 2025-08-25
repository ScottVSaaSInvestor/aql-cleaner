// api/clean-company.js
// This is your Vercel serverless function for cleaning Clay data

import { Client } from '@notionhq/client';

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Main handler function - this is what Vercel calls
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only accept POST requests
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
    
    // Return success with new page URL
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
      // Add other block types as needed
      if (block.type === 'heading_1' && block.heading_1.rich_text) {
        content += '# ' + block.heading_1.rich_text.map(t => t.plain_text).join('') + '\n';
      }
      if (block.type === 'heading_2' && block.heading_2.rich_text) {
        content += '## ' + block.heading_2.rich_text.map(t => t.plain_text).join('') + '\n';
      }
      if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text) {
        content += '- ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join('') + '\n';
      }
    }
    
    return content;
  } catch (error) {
    throw new Error(`Failed to fetch Notion content: ${error.message}`);
  }
}

// Main cleaning function
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
  
  // Add classification based on score
  cleaned.classification = getClassification(cleaned.controlPointsScore);
  
  return cleaned;
}

// Extract company name
function extractCompanyName(raw) {
  const patterns = [
    /Company Name:\s*([^\n]+)/i,
    /^([A-Z][A-Za-z\s\-\.]+?)(?:\s+is\s+a\s+)/m,
    /COMPANY OVERVIEW:\s*([^\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return 'Company Name Not Found';
}

// Extract year founded
function extractYearFounded(raw) {
  const patterns = [
    /Founded:?\s*(\d{4})/i,
    /Year Founded:?\s*(\d{4})/i,
    /Founded in\s+(\d{4})/i,
    /established in\s+(\d{4})/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return 'Not specified';
}

// Extract location
function extractLocation(raw) {
  const patterns = [
    /Location:\s*([^\n]+)/i,
    /Headquarters:\s*([^\n]+)/i,
    /headquartered in\s+([^\n,]+(?:,\s*[^\n,]+)?)/i,
    /based in\s+([^\n,]+(?:,\s*[^\n,]+)?)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return 'Not specified';
}

// Extract website
function extractWebsite(raw) {
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

// Extract vertical/category
function extractVertical(raw) {
  const patterns = [
    /Software Category[^:]*:\s*([^\n]+)/i,
    /Vertical:\s*([^\n]+)/i,
    /Category:\s*([^\n]+)/i,
    /specialized.*?platform for\s+([^\n\.]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return 'Vertical SaaS';
}

// Extract funding
function extractFunding(raw) {
  const patterns = [
    /Total Funding[^:]*:\s*([^\n]+)/i,
    /raised.*?\$([0-9,]+(?:\.[0-9]+)?[MBK]?)/i,
    /Funding.*?:\s*\$([^\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return 'Not specified';
}

// Extract FTE count
function extractFTECount(raw) {
  const patterns = [
    /Employee Count:\s*([0-9,]+)/i,
    /FTE.*?:\s*([0-9,]+)/i,
    /(\d+)\s+employees/i
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return 'Not specified';
}

// Extract executive summary
function extractExecutiveSummary(raw) {
  const summary = {
    challenge: '',
    solution: '',
    impact: ''
  };
  
  // Extract challenge
  const challengeMatch = raw.match(/(?:The\s+)?Challenge:([^]*?)(?=The\s+Solution:|Solution:|Customer|$)/i);
  if (challengeMatch) {
    summary.challenge = challengeMatch[1].trim().substring(0, 500);
  }
  
  // Extract solution
  const solutionMatch = raw.match(/(?:The\s+)?Solution:([^]*?)(?=Customer|Results|Impact|$)/i);
  if (solutionMatch) {
    summary.solution = solutionMatch[1].trim().substring(0, 500);
  }
  
  // Extract impact
  const impactMatch = raw.match(/(?:Customer\s+)?Success:([^]*?)(?=\n#|$)/i);
  if (impactMatch) {
    summary.impact = impactMatch[1].trim().substring(0, 500);
  }
  
  return summary;
}

// Extract business description
function extractBusinessDescription(raw) {
  const businessMatch = raw.match(/Business.*?Description:([^]*?)(?=Customer|#|$)/i);
  if (businessMatch) {
    return businessMatch[1].trim().substring(0, 1000);
  }
  
  // Fallback: look for company description patterns
  const descPatterns = [
    /is\s+a\s+([^.]+platform[^.]+\.)/i,
    /provides\s+([^.]+solution[^.]+\.)/i,
    /offers\s+([^.]+software[^.]+\.)/i
  ];
  
  for (const pattern of descPatterns) {
    const match = raw.match(pattern);
    if (match) {
      return match[0];
    }
  }
  
  return 'Business description to be added';
}

// Extract customer overview
function extractCustomerOverview(raw) {
  const customerMatch = raw.match(/Customer\s+Overview:([^]*?)(?=#|Core\s+Jobs|$)/i);
  if (customerMatch) {
    return customerMatch[1].trim().substring(0, 800);
  }
  return 'Customer overview to be added';
}

// Calculate control points
function calculateControlPoints(raw) {
  let totalScore = 0;
  
  // Look for explicit scores in the content
  const scorePatterns = [
    /DATA GRAVITY.*?SCORE.*?([0-9.]+)\s*(?:out of|\/)\s*5/i,
    /WORKFLOW GRAVITY.*?SCORE.*?([0-9.]+)\s*(?:out of|\/)\s*5/i,
    /ACCOUNT GRAVITY.*?SCORE.*?([0-9.]+)\s*(?:out of|\/)\s*5/i,
    /NETWORK EFFECTS.*?SCORE.*?([0-9.]+)\s*(?:out of|\/)\s*5/i,
    /ECOSYSTEM.*?SCORE.*?([0-9.]+)\s*(?:out of|\/)\s*5/i,
    /PRODUCT EXTENSION.*?SCORE.*?([0-9.]+)\s*(?:out of|\/)\s*5/i
  ];
  
  for (const pattern of scorePatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      totalScore += parseFloat(match[1]);
    }
  }
  
  // If no scores found, estimate based on content
  if (totalScore === 0) {
    // Basic heuristic scoring
    if (raw.match(/data gravity|centralized data|single source/i)) totalScore += 3;
    if (raw.match(/workflow|automation|process/i)) totalScore += 3;
    if (raw.match(/network effect|viral|collaboration/i)) totalScore += 2;
    if (raw.match(/ecosystem|integration|api/i)) totalScore += 2;
    if (raw.match(/ai|machine learning|predictive/i)) totalScore += 2;
  }
  
  return totalScore;
}

// Get classification based on score
function getClassification(score) {
  if (score >= 25) return 'SYSTEM OF RECORD';
  if (score >= 20) return 'SYSTEM OF ENGAGEMENT';
  if (score >= 15) return 'SYSTEM OF WORKFLOW';
  return 'SYSTEM OF PRODUCTIVITY';
}

// Create clean Notion page
async function createCleanNotionPage(data) {
  try {
    // Format the content for Notion
    const content = formatForNotion(data);
    
    // Determine where to save the page
    let parent = {};
    
    // If you have a dedicated database for cleaned companies
    if (process.env.NOTION_CLEANED_DATABASE_ID) {
      parent = {
        database_id: process.env.NOTION_CLEANED_DATABASE_ID
      };
    }
    // Or if you have a dedicated parent page for cleaned companies
    else if (process.env.NOTION_CLEANED_PARENT_PAGE_ID) {
      parent = {
        page_id: process.env.NOTION_CLEANED_PARENT_PAGE_ID
      };
    }
    // Fallback to general parent page
    else if (process.env.NOTION_PARENT_PAGE_ID) {
      parent = {
        page_id: process.env.NOTION_PARENT_PAGE_ID
      };
    }
    
    // Build properties based on whether it's a database or page
    let properties = {
      title: {
        title: [
          {
            text: {
              content: `${data.companyName} - Cleaned`
            }
          }
        ]
      }
    };
    
    // If it's a database, add additional properties
    if (parent.database_id) {
      properties = {
        ...properties,
        'Company Name': {
          title: [
            {
              text: {
                content: data.companyName
              }
            }
          ]
        },
        'Status': {
          select: {
            name: '⭐ Cleaned & Ready'
          }
        },
        'Control Score': {
          number: data.controlPointsScore
        },
        'Classification': {
          select: {
            name: data.classification
          }
        },
        'Cleaned Date': {
          date: {
            start: new Date().toISOString()
          }
        },
        'Vertical': {
          rich_text: [
            {
              text: {
                content: data.vertical
              }
            }
          ]
        }
      };
    }
    
    // Create the page with icon and cover for visual recognition
    const response = await notion.pages.create({
      parent: parent,
      icon: {
        type: 'emoji',
        emoji: '✨'  // Clean/ready indicator
      },
      cover: {
        type: 'external',
        external: {
          url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&h=300&fit=crop'  // Professional gradient
        }
      },
      properties: properties,
      children: content
    });
    
    console.log(`✅ Created cleaned page for ${data.companyName} with ID: ${response.id}`);
    
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
    }
  ];
  
  return blocks;
}
