# BNI-Connect-Scraper-Extension

BNI Connect Scraper - Full Guide
================================

Part 1: How to Use BNI Website
------------------------------

Step 1: Login to BNI
- Go to the BNI Connect website
- Enter your username and password
- Click the Login button

Step 2: Search for Members
- Click on the Search Icon (magnifying glass)
- This will open search options

Step 3: Choose Your Search Method

Option A: Search by Keyword
- Use this if you're not sure of the exact industry
- Type words like "doctor", "lawyer", or "marketing"

Option B: Search by Name
- Enter the first and last name
- Use this if you are looking for someone specific

Option C (Recommended): Search by Category
- Choose a specific industry from the dropdown
- Select the target country and region/state
- Gives best targeted results

Step 4: Apply Filters and Search
- Choose filters (category, country, state)
- Click the Search button
- Wait for the results to load

Part 2: How to Install and Use the Extension
--------------------------------------------

Step 1: Install the Extension
- Open Chrome
- Click the Puzzle Icon in the top-right
- Click "Manage Extensions"
- Click "Load Unpacked"
- Select your "final" folder (which has all the code)
- Click Select Folder

Step 2: Use the Extension
- Go to your BNI search results page
- Click the Puzzle Icon again
- Click on "BNI Scraper"

Step 3: Start the Scraping

Button 1: Check Profiles & Filters
- Click it
- The extension will count profiles
- It will show:
  - Total profiles found
  - Estimated time
  - Filters detected

Button 2: Start Scraping
- Click it
- The extension will:
  - Collect profile data one by one
  - Show scraping progress, average time, and a progress bar
  - Automatically download the final spreadsheet

Part 3: Workflow Diagram (Code Flow)
------------------------------------

[popup.js]
↓
User clicks popup buttons:
- checkProfiles() → collects list of visible profiles
- startProfileScraping() → starts detailed scraping

↓
checkProfiles():
→ Sends message: {action: 'extractDashboardProfiles'}
→ Collects: name, company, chapter, city, industry
→ Extracts profile links

↓
startProfileScraping():
→ Divides links into batches
→ For each batch, sends: {action: 'scrapeBatch'} to background.js

[background.js]
↓
onMessage:
- If action is 'scrapeBatch' → handleBatchScraping()
- If action is 'extractPageFilters' → handleFilterExtraction()

↓
handleBatchScraping():
→ Opens hidden tab
→ Injects content.js
→ Sends: {action: 'extractDetailedProfile'}
→ Gets phone, email, address, etc.
→ Closes tab
→ Reports progress to popup

↓
handleFilterExtraction():
→ Injects content.js to read filters (dropdowns, search terms, etc.)

[content.js]
↓
onMessage:
- If action is 'extractDashboardProfiles':
  → Uses class selectors to extract data from search results

- If action is 'extractDetailedProfile':
  → Reads detailed contact info from profile page

- If action is 'extractFilters':
  → Extracts filters from inputs, dropdowns, or URL

[manifest.json]
↓
Registers:
- popup.html (UI)
- background.js (logic)
- content.js (page reader)
Grants permissions for tabs, scripting, downloads, storage

Part 4: Function Descriptions
------------------------------------------

1. checkProfiles() - popup.js
- Finds all member profiles on the current page
- Collects names, company, chapter, etc.
- Prepares links for full scraping
- Calculates estimated scraping time

2. startProfileScraping() - popup.js
- Starts scraping in batches
- Tracks completed and failed profiles
- Downloads everything in a spreadsheet at the end

3. scrapeBatch(profileUrls, batchIndex, totalBatches) - popup.js
- Sends one group of profile links to be scraped
- Waits for background.js to return results

4. handleBatchScraping() - background.js
- Opens each profile in a hidden tab
- Injects script to collect data
- Closes tab
- Sends data back to popup

5. handleFilterExtraction() - background.js
- Gets the selected filters from the page (city, industry, etc.)
- Used to name the downloaded file

6. extractDashboardProfiles - content.js
- Runs on the search result page
- Collects: Name, Chapter, Company, City, Industry, Profile link

7. extractDetailedProfile - content.js
- Runs on each profile page
- Collects: Phone numbers, Email, Address, Website, City/ZIP/Country, Industry, About, Keywords

8. extractFilters - content.js
- Looks at dropdowns, inputs, and URL
- Finds out which filters were used

9. downloadCompleteData() - popup.js
- Combines all data into a spreadsheet (CSV)
- Downloads it to your computer

10. sleep(ms) - used in popup.js and background.js
- Waits a few seconds before the next step
- Helps avoid doing things too fast
