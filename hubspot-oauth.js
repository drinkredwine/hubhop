const express = require('express');
const fs = require('fs').promises;
const { Client } = require('@hubspot/api-client');
const open = require('open');
require('dotenv').config();

// OAuth configuration from environment variables
const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const HUBSPOT_REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:3000/oauth-callback';
// Request only read permissions, no write permissions
// You can customize this list based on the scopes enabled in your HubSpot app
const SCOPES = process.env.HUBSPOT_SCOPES || 'crm.objects.deals.read crm.objects.contacts.read crm.objects.companies.read sales-email-read';

// For reference, here are available READ-ONLY scopes:
// Basic CRM: 'crm.objects.deals.read crm.objects.contacts.read crm.objects.companies.read'
// Email: 'sales-email-read'
// Content: 'content'
// E-commerce: 'e-commerce'
// Files: 'files.ui_hidden.read'
// Forms: 'forms'
// Marketing: 'marketing.automation'
// Tickets: 'tickets'

// Create HubSpot client instance
const hubspotClient = new Client();

// Create Express app for handling OAuth callback
const app = express();
const PORT = 3000;

// Variables to store the tokens
let tokens = {};

// Check if we have existing tokens in .env file
async function checkExistingTokens() {
  try {
    const dotEnvContent = await fs.readFile('.env', 'utf8');
    const accessToken = dotEnvContent.match(/HUBSPOT_ACCESS_TOKEN=(.+)/);
    const refreshToken = dotEnvContent.match(/HUBSPOT_REFRESH_TOKEN=(.+)/);
    const expiresAt = dotEnvContent.match(/HUBSPOT_TOKEN_EXPIRES_AT=(.+)/);
    
    if (accessToken && refreshToken && expiresAt) {
      console.log('Found existing tokens in .env file');
      return {
        accessToken: accessToken[1],
        refreshToken: refreshToken[1],
        expiresAt: parseInt(expiresAt[1], 10)
      };
    }
    return null;
  } catch (error) {
    // File doesn't exist or other error
    return null;
  }
}

// Update .env file with new tokens
async function updateEnvFile(tokens) {
  try {
    let dotEnvContent;
    
    try {
      dotEnvContent = await fs.readFile('.env', 'utf8');
    } catch (error) {
      // If .env doesn't exist, create it from example
      try {
        dotEnvContent = await fs.readFile('.env.example', 'utf8');
      } catch (error) {
        dotEnvContent = `
HUBSPOT_CLIENT_ID=${HUBSPOT_CLIENT_ID}
HUBSPOT_CLIENT_SECRET=${HUBSPOT_CLIENT_SECRET}
HUBSPOT_REDIRECT_URI=${HUBSPOT_REDIRECT_URI}

# OAuth tokens
HUBSPOT_ACCESS_TOKEN=
HUBSPOT_REFRESH_TOKEN=
HUBSPOT_TOKEN_EXPIRES_AT=

# Configuration
OUTPUT_DIR=./data
BATCH_SIZE=100
`;
      }
    }
    
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

// Refresh the access token if it's expired
async function refreshAccessToken(refreshToken) {
  try {
    console.log('Refreshing access token...');
    const result = await hubspotClient.oauth.tokensApi.create(
      'refresh_token',
      undefined,
      undefined,
      HUBSPOT_CLIENT_ID,
      HUBSPOT_CLIENT_SECRET,
      refreshToken
    );
    
    const tokens = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: Date.now() + (result.expiresIn * 1000)
    };
    
    await updateEnvFile(tokens);
    return tokens;
  } catch (error) {
    console.error('Error refreshing token:', error);
    return null;
  }
}

// Routes
app.get('/', (req, res) => {
  const authUrl = hubspotClient.oauth.getAuthorizationUrl(
    HUBSPOT_CLIENT_ID,
    HUBSPOT_REDIRECT_URI,
    SCOPES
  );
  
  console.log('Auth URL:', authUrl);
  console.log('Scopes requested:', SCOPES);
  
  res.send(`
    <h1>HubSpot OAuth</h1>
    <p>Click the button below to authorize this app with your HubSpot account.</p>
    <p>Requested scopes: ${SCOPES}</p>
    <p>Redirect URI: ${HUBSPOT_REDIRECT_URI}</p>
    <a href="${authUrl}" style="display: inline-block; padding: 10px 15px; background-color: #ff7a59; color: white; text-decoration: none; border-radius: 4px;">
      Connect to HubSpot
    </a>
    <p style="margin-top: 20px; color: #666;">
      <strong>Troubleshooting:</strong> If you get authorization errors, make sure:
      <ul>
        <li>The redirect URL in your HubSpot app settings exactly matches: ${HUBSPOT_REDIRECT_URI}</li>
        <li>All scopes listed above are enabled in your HubSpot app</li>
      </ul>
    </p>
  `);
});

app.get('/oauth-callback', async (req, res) => {
  const code = req.query.code;
  
  try {
    const tokensResponse = await hubspotClient.oauth.tokensApi.create(
      'authorization_code',
      code,
      HUBSPOT_REDIRECT_URI,
      HUBSPOT_CLIENT_ID,
      HUBSPOT_CLIENT_SECRET
    );
    
    tokens = {
      accessToken: tokensResponse.accessToken,
      refreshToken: tokensResponse.refreshToken,
      expiresAt: Date.now() + (tokensResponse.expiresIn * 1000)
    };
    
    await updateEnvFile(tokens);
    
    res.send(`
      <h1>Authorization Successful!</h1>
      <p>Your HubSpot account has been connected. The access tokens have been saved.</p>
      <p>You can now close this window and run the sync script with:</p>
      <pre style="background: #f1f1f1; padding: 10px; border-radius: 4px;">npm start</pre>
    `);
    
    // Wait a few seconds before shutting down the server
    setTimeout(() => {
      console.log('Authorization successful! Access tokens have been saved to .env file.');
      console.log('You can now run the sync script with: npm start');
      process.exit(0);
    }, 5000);
  } catch (error) {
    console.error('Error getting access token:', error);
    res.status(500).send(`
      <h1>Error</h1>
      <p>Failed to get access token: ${error.message}</p>
      <a href="/">Try again</a>
    `);
  }
});

// Main function
async function main() {
  console.log('Checking for existing tokens...');
  const existingTokens = await checkExistingTokens();
  
  if (existingTokens) {
    // If tokens exist but are expired, refresh them
    if (existingTokens.expiresAt < Date.now()) {
      console.log('Tokens expired, refreshing...');
      const refreshedTokens = await refreshAccessToken(existingTokens.refreshToken);
      
      if (refreshedTokens) {
        console.log('Tokens refreshed successfully!');
        console.log('You can now run the sync script with: npm start');
        return;
      } else {
        console.log('Failed to refresh tokens. Starting OAuth flow...');
      }
    } else {
      // Tokens exist and are valid
      console.log('Existing tokens are valid!');
      console.log('You can now run the sync script with: npm start');
      return;
    }
  } else {
    console.log('No valid tokens found. Starting OAuth flow...');
  }
  
  // Start the server for OAuth flow
  app.listen(PORT, () => {
    console.log(`OAuth server running at http://localhost:${PORT}`);
    console.log('Opening browser to start OAuth flow...');
    
    // Open the browser to start OAuth flow
    open(`http://localhost:${PORT}`);
  });
}

// Check if we have all required configuration
if (!HUBSPOT_CLIENT_ID || !HUBSPOT_CLIENT_SECRET) {
  console.error('Error: HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET must be set in .env file');
  console.log('Please create a .env file based on .env.example and add your HubSpot API credentials');
  process.exit(1);
}

// Run the main function
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});