const fs = require('fs').promises;
const path = require('path');
const { Client } = require('@hubspot/api-client');
require('dotenv').config();

// Configuration
const config = {
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,      // API token (from Private App or OAuth)
  refreshToken: process.env.HUBSPOT_REFRESH_TOKEN,    // OAuth refresh token
  clientId: process.env.HUBSPOT_CLIENT_ID,            // OAuth client ID
  clientSecret: process.env.HUBSPOT_CLIENT_SECRET,    // OAuth client secret
  tokenExpiresAt: process.env.HUBSPOT_TOKEN_EXPIRES_AT ? parseInt(process.env.HUBSPOT_TOKEN_EXPIRES_AT, 10) : null,
  outputDir: process.env.OUTPUT_DIR || './data',      // Directory to store the exported data
  batchSize: process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE, 10) : 100, // Number of records to fetch per request
  includeAssociations: true,                          // Whether to include associated records
};

// Update .env file with new tokens
async function updateEnvFile(tokens) {
  try {
    let dotEnvContent = await fs.readFile('.env', 'utf8');
    
    // Update token values
    dotEnvContent = dotEnvContent.replace(/HUBSPOT_ACCESS_TOKEN=(.*)/, `HUBSPOT_ACCESS_TOKEN=${tokens.accessToken}`);
    dotEnvContent = dotEnvContent.replace(/HUBSPOT_REFRESH_TOKEN=(.*)/, `HUBSPOT_REFRESH_TOKEN=${tokens.refreshToken}`);
    dotEnvContent = dotEnvContent.replace(/HUBSPOT_TOKEN_EXPIRES_AT=(.*)/, `HUBSPOT_TOKEN_EXPIRES_AT=${tokens.expiresAt}`);
    
    // Write updated content back to .env
    await fs.writeFile('.env', dotEnvContent);
    console.log('Updated .env file with new tokens');
  } catch (error) {
    console.error('Error updating .env file:', error);
  }
}

// Create a refresh interceptor for the HubSpot client
async function refreshAccessToken() {
  try {
    console.log('Refreshing access token...');
    const tempClient = new Client();
    const result = await tempClient.oauth.tokensApi.create(
      'refresh_token',
      undefined,
      undefined,
      config.clientId,
      config.clientSecret,
      config.refreshToken
    );
    
    const tokens = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: Date.now() + (result.expiresIn * 1000)
    };
    
    // Update config with new tokens
    config.accessToken = tokens.accessToken;
    config.refreshToken = tokens.refreshToken;
    config.tokenExpiresAt = tokens.expiresAt;
    
    // Update .env file
    await updateEnvFile(tokens);
    
    return tokens.accessToken;
  } catch (error) {
    console.error('Error refreshing token:', error);
    throw error;
  }
}

// Initialize HubSpot client
const hubspotClient = new Client({ accessToken: config.accessToken });

// Add token refresh handling
if (config.refreshToken && config.clientId && config.clientSecret) {
  hubspotClient.setAccessToken(config.accessToken);
  
  // Check if token needs refresh before starting
  if (config.tokenExpiresAt && config.tokenExpiresAt < Date.now()) {
    console.log('Access token expired, refreshing before starting...');
    refreshAccessToken().then(newToken => {
      hubspotClient.setAccessToken(newToken);
      console.log('Token refreshed successfully');
    }).catch(error => {
      console.error('Failed to refresh token, please run oauth flow again:', error);
      process.exit(1);
    });
  }
  
  // Note: We'll handle token expiration manually instead of using interceptors
  // The @hubspot/api-client doesn't expose the axios instance directly
  console.log('Token refresh handling is enabled');
}

// Ensure output directory exists
async function ensureDirectoryExists(directory) {
  try {
    await fs.mkdir(directory, { recursive: true });
    console.log(`Directory created: ${directory}`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

// Save data to JSON file
async function saveToFile(data, filename) {
  const filePath = path.join(config.outputDir, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`Data saved to ${filePath}`);
}

// Get all deals with pagination
async function getAllDeals() {
  console.log('Fetching deals...');
  const deals = [];
  let after;
  let hasMore = true;
  
  try {
    while (hasMore) {
      try {
        // Get deals with only read permissions
        const response = await hubspotClient.crm.deals.basicApi.getPage(
          config.batchSize, 
          after, 
          ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'createdate'], 
          config.includeAssociations ? ['contacts', 'companies'] : undefined
        );
        
        deals.push(...response.results);
        
        if (response.paging && response.paging.next) {
          after = response.paging.next.after;
        } else {
          hasMore = false;
        }
        
        console.log(`Retrieved ${deals.length} deals so far...`);
      } catch (error) {
        // Check if error is due to expired token
        if (error.message && error.message.includes('401') && config.refreshToken) {
          console.log('Access token expired during request, refreshing...');
          try {
            const newToken = await refreshAccessToken();
            hubspotClient.setAccessToken(newToken);
            console.log('Token refreshed, retrying request...');
            // Continue the loop to retry the request
            continue;
          } catch (refreshError) {
            console.error('Failed to refresh token:', refreshError.message);
            throw refreshError;
          }
        } else {
          // For other errors, rethrow
          throw error;
        }
      }
    }
    
    console.log(`Total deals retrieved: ${deals.length}`);
    return deals;
  } catch (error) {
    console.error('Error fetching deals:', error.message);
    throw error;
  }
}

// Helper function to fetch associated objects by type with full content
async function getAssociatedObjects(dealId, objectType) {
  try {
    // First get the association IDs
    const associations = await hubspotClient.crm.deals.associationsApi.getAll(
      dealId,
      objectType
    );
    
    // If we have associations, fetch the actual objects
    if (associations.results && associations.results.length > 0) {
      console.log(`Found ${associations.results.length} ${objectType} for deal ${dealId}`);
      
      // Create an array to hold the full objects
      const fullObjects = [];
      
      // Get all IDs
      const objectIds = associations.results.map(result => result.toObjectId);
      
      // HubSpot batch API limit is 100 per batch
      const batchSize = 100; // Maximum allowed by HubSpot
      for (let i = 0; i < objectIds.length; i += batchSize) {
        const batchIds = objectIds.slice(i, i + batchSize);
        
        try {
          // Use the appropriate API method based on object type
          let batchObjects;
          
          // Handle different object types
          switch (objectType) {
            case 'notes':
              batchObjects = await hubspotClient.crm.objects.notes.batchApi.read({ inputs: batchIds.map(id => ({ id })) });
              break;
              
            case 'emails':
              batchObjects = await hubspotClient.crm.objects.emails.batchApi.read({ inputs: batchIds.map(id => ({ id })) });
              break;
              
            case 'calls':
              batchObjects = await hubspotClient.crm.objects.calls.batchApi.read({ inputs: batchIds.map(id => ({ id })) });
              break;
              
            case 'meetings':
              batchObjects = await hubspotClient.crm.objects.meetings.batchApi.read({ inputs: batchIds.map(id => ({ id })) });
              break;
              
            case 'tasks':
              batchObjects = await hubspotClient.crm.objects.tasks.batchApi.read({ inputs: batchIds.map(id => ({ id })) });
              break;
              
            default:
              console.warn(`No batch API method available for ${objectType}`);
              // Just return the associations if we can't fetch the full objects
              return associations.results;
          }
          
          // Add the retrieved objects to our array
          if (batchObjects && batchObjects.results) {
            fullObjects.push(...batchObjects.results);
          }
          
        } catch (batchError) {
          console.error(`Error fetching batch of ${objectType}:`, batchError.message);
          // Continue with the next batch rather than failing completely
        }
      }
      
      console.log(`Retrieved ${fullObjects.length} ${objectType} objects for deal ${dealId}`);
      return {
        associations: associations.results,
        objects: fullObjects
      };
    }
    
    return { associations: [], objects: [] };
  } catch (error) {
    if (error.message && error.message.includes('401') && config.refreshToken) {
      console.log(`Access token expired during ${objectType} request, refreshing...`);
      const newToken = await refreshAccessToken();
      hubspotClient.setAccessToken(newToken);
      console.log('Token refreshed, retrying request...');
      
      // This is a recursive call to retry after token refresh
      return await getAssociatedObjects(dealId, objectType);
    } else {
      console.error(`Error fetching ${objectType} associations: ${error.message}`);
      return { associations: [], objects: [] };
    }
  }
}

// Get activities for a specific deal
async function getDealActivities(dealId) {
  console.log(`Fetching activities for deal ${dealId}...`);
  
  try {
    // Create an object to store all activities
    const activities = {
      deal_id: dealId,
      timestamp: new Date().toISOString(),
      activity_types: {}
    };
    
    // Array of activity types to check
    const activityTypes = ['notes', 'calls', 'meetings', 'emails', 'tasks'];
    
    // Process each activity type
    for (const type of activityTypes) {
      const results = await getAssociatedObjects(dealId, type);
      activities.activity_types[type] = results;
    }
    
    // Calculate total activities
    const totalActivities = Object.values(activities.activity_types)
      .reduce((sum, arr) => sum + arr.length, 0);
    
    console.log(`Total activities for deal ${dealId}: ${totalActivities}`);
    
    return activities;
  } catch (error) {
    console.error(`Error fetching activities for deal ${dealId}:`, error.message);
    
    // Return a properly structured empty result
    return {
      deal_id: dealId,
      timestamp: new Date().toISOString(),
      error: error.message,
      activity_types: {
        notes: { associations: [], objects: [] },
        calls: { associations: [], objects: [] },
        meetings: { associations: [], objects: [] },
        emails: { associations: [], objects: [] },
        tasks: { associations: [], objects: [] }
      }
    };
  }
}

// Main function to export deals and their activities
async function exportDealsAndActivities() {
  try {
    // Ensure data directory exists
    await ensureDirectoryExists(config.outputDir);
    await ensureDirectoryExists(path.join(config.outputDir, 'activities'));
    
    // Get all deals
    const deals = await getAllDeals();
    await saveToFile(deals, 'deals.json');
    
    // Get activities for each deal
    console.log('Fetching activities for each deal...');
    
    // Process all deals at maximum speed
    let processedCount = 0;
    for (const deal of deals) {
      // Get activities for this deal
      const activities = await getDealActivities(deal.id);
      
      // Only save if we have actual activities
      const hasActivities = Object.values(activities.activity_types)
        .some(data => data.associations && data.associations.length > 0);
      
      if (hasActivities) {
        await saveToFile(activities, `activities/${deal.id}.json`);
      }
      
      // Log progress periodically
      processedCount++;
      if (processedCount % 10 === 0) {
        console.log(`Progress: ${processedCount}/${deals.length} deals processed (${Math.round(processedCount/deals.length*100)}%)`);
      }
    }
    
    console.log('Export completed successfully!');
  } catch (error) {
    console.error('Export failed:', error);
  }
}

// Check if access token is set
if (!config.accessToken) {
  console.error('Error: HUBSPOT_ACCESS_TOKEN environment variable is not set');
  console.log('Set it by running: export HUBSPOT_ACCESS_TOKEN=your_token');
  process.exit(1);
}

// Run the export
exportDealsAndActivities();