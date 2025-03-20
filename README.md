# HubSpot Sync Tool

A Node.js tool to export HubSpot deals and their associated activities to the local filesystem as JSON files.

## Features

- Supports both OAuth and Private App authentication
- Automatically refreshes OAuth tokens when expired
- Handles pagination for large datasets
- Saves data as structured JSON files

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Authentication - Choose one of the methods:

   ### Method 1: OAuth (Recommended)
   
   1. Create a HubSpot App in your HubSpot developer account:
      - Go to https://developers.hubspot.com/
      - Create a new app
      - Configure OAuth (Redirect URL: http://localhost:3000/oauth-callback)
      - Add required scopes:
        - `crm.objects.deals.read`
        - `crm.objects.deals.write` (if needed)
        - `crm.objects.contacts.read`
        - `crm.objects.companies.read`
   
   2. Copy `.env.example` to `.env` and fill in your app credentials:
      ```
      HUBSPOT_CLIENT_ID=your_client_id
      HUBSPOT_CLIENT_SECRET=your_client_secret
      HUBSPOT_REDIRECT_URI=http://localhost:3000/oauth-callback
      ```
   
   3. Run the OAuth flow:
      ```
      npm run auth
      ```
      This will open a browser window where you can authorize the app.
   
   ### Method 2: Private App Token
   
   1. Create a private app in HubSpot:
      - Go to your HubSpot account
      - Navigate to Settings > Integrations > Private Apps
      - Create a new private app with scopes for reading deals and engagements
      - Copy the access token
   
   2. Copy `.env.example` to `.env` and set your access token:
      ```
      HUBSPOT_ACCESS_TOKEN=your_access_token
      ```

## Configuration

You can customize the following in your `.env` file:

```
# Either OAuth credentials or Private App token
HUBSPOT_CLIENT_ID=your_client_id
HUBSPOT_CLIENT_SECRET=your_client_secret
HUBSPOT_REDIRECT_URI=http://localhost:3000/oauth-callback
HUBSPOT_ACCESS_TOKEN=your_access_token

# Configuration
OUTPUT_DIR=./data
BATCH_SIZE=100
```

## Usage

Run the sync script:

```
npm start
```

This will:
1. Create a `data` directory (if it doesn't exist)
2. Fetch all deals from HubSpot (with pagination)
3. Save all deals to `data/deals.json`
4. For each deal, fetch its activities
5. Save each deal's activities to `data/activities/{dealId}.json`

## Output

- All deals: `data/deals.json`
- Activities for each deal: `data/activities/{dealId}.json`

## Notes

- The script handles pagination for deals
- Activities are fetched in batches to avoid API rate limits
- Error handling is included to prevent the script from crashing if one request fails
- OAuth tokens are automatically refreshed when expired