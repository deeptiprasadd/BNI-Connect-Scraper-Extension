// content.js - BNI Profile Scraper Content Script
// This script runs on BNI website pages and extracts member profile data

console.log('BNI Profile Scraper content script loaded'); // Log when script starts

/*
 * Main message listener - This is the heart of our content script
 * It listens for messages from the popup/background script and responds with data
 * Think of it like a waiter taking orders from customers and bringing back food
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  // Simple ping test to check if the script is working
  if (request.action === 'ping') {
    sendResponse({ status: 'ok' }); // Send back "I'm alive" message
    return true; // Keep the message channel open
  }

  /*
   * FILTER EXTRACTION FUNCTION
   * This function looks at a BNI page and tries to figure out what filters are currently active
   * It's like looking at a restaurant menu and seeing what dishes are highlighted or selected
   * We check search boxes, dropdown menus, active buttons, and even the website URL for clues
   */
  if (request.action === 'extractFilters') {
    try {
      const filters = {}; // Empty container to store all the filters we find
      
      // STEP 1: Look for search input boxes on the page
      const searchInputs = document.querySelectorAll('input[type="text"], input[type="search"]');
      searchInputs.forEach((input, index) => {
        if (input.value && input.value.trim()) { // Only save if there's actually text in the box
          const placeholder = input.placeholder || input.name || input.id || `search${index + 1}`; // Get a name for this search box
          filters[`search_${placeholder.toLowerCase().replace(/\s+/g, '_')}`] = input.value.trim(); // Save the search text
        }
      });
      
      // STEP 2: Check dropdown menus to see what's selected
      const selects = document.querySelectorAll('select');
      selects.forEach((select, index) => {
        // Skip empty selections or default values like "all" or "0"
        if (select.value && select.value !== '' && select.value !== 'all' && select.value !== '0') {
          const label = select.name || select.id || `filter${index + 1}`; // Get a name for this dropdown
          const selectedOption = select.options[select.selectedIndex]; // Get the currently selected option
          filters[`filter_${label.toLowerCase().replace(/\s+/g, '_')}`] = selectedOption.text || select.value; // Save what's selected
        }
      });
      
      // STEP 3: Look for active filter buttons or tags (things that are highlighted/selected)
      const activeFilters = document.querySelectorAll('.active, .selected, [aria-selected="true"]');
      activeFilters.forEach((element, index) => {
        const text = element.textContent?.trim(); // Get the text from the button/tag
        if (text && text.length > 0 && text.length < 50) { // Make sure it's not empty and not too long
          filters[`active_filter_${index + 1}`] = text; // Save the active filter text
        }
      });
      
      // STEP 4: Check the website URL for filter parameters
      const urlParams = new URLSearchParams(window.location.search); // Get the part of URL after "?"
      urlParams.forEach((value, key) => {
        if (value && value.trim() && value !== 'all' && value !== '0') { // Skip empty or default values
          filters[`url_${key.toLowerCase()}`] = decodeURIComponent(value); // Save URL parameters as filters
        }
      });
      
      // STEP 5: If we didn't find any specific filters, try to get page context
      if (Object.keys(filters).length === 0) {
        const pageTitle = document.title; // Get the page title from browser tab
        const mainHeading = document.querySelector('h1, h2, .title, .heading')?.textContent?.trim(); // Get main heading on page
        
        // Save heading if it's different from title
        if (mainHeading && mainHeading !== pageTitle) {
          filters.page_context = mainHeading;
        } 
        // Or save title if it's not generic and not too long
        else if (pageTitle && !pageTitle.includes('BNI') && pageTitle.length < 100) {
          filters.page_context = pageTitle;
        }
      }
      
      sendResponse(filters); // Send all the filters we found back to the popup
    } catch (error) {
      console.error('Filter extraction error:', error); // Log any errors
      sendResponse({}); // Send empty object if something went wrong
    }
    return true; // Keep message channel open for async response
  }

  /*
   * DASHBOARD PROFILE EXTRACTION FUNCTION
   * This function scrapes member profiles from the BNI member directory/dashboard page
   * It's like taking a photo of a class roster and copying down everyone's basic info
   * We look for specific CSS classes that BNI uses to display member information in a list
   */
  if (request.action === 'extractDashboardProfiles') {
    try {
      const dataRows = []; // Array to store all the member profiles we find
      const profileLinks = []; // Array to store direct links to detailed profiles

      // Find all the different pieces of member information using BNI's specific CSS classes
      const nameElems = document.querySelectorAll('.MuiBox-root.css-11zcyzm'); // Member names
      const websiteElems = document.querySelectorAll('.MuiTypography-root.MuiTypography-inherit.MuiLink-root.MuiLink-underlineAlways.css-xpp1g9'); // Profile links
      const chapterElems = document.querySelectorAll('.MuiBox-root.css-y8qrj'); // Chapter names
      const companyElems = document.querySelectorAll('.MuiBox-root.css-cg3igy'); // Company names
      const cityElems = document.querySelectorAll('.MuiBox-root.css-gglxne'); // Cities
      const industryElems = document.querySelectorAll('.MuiBox-root.css-fhwdqw'); // Industries

      // Figure out how many member profiles are on the page
      const count = Math.max(
        nameElems.length,
        websiteElems.length,
        chapterElems.length,
        companyElems.length,
        cityElems.length,
        industryElems.length
      );

      // Loop through each member profile and extract their information
      for (let i = 0; i < count; i++) {
        const name = nameElems[i]?.innerText.trim() || ''; // Get name or empty string if not found
        const profileLink = websiteElems[i]?.href || ''; // Get profile link or empty string
        const chapter = chapterElems[i]?.innerText.trim() || ''; // Get chapter or empty string
        const company = companyElems[i]?.innerText.trim() || ''; // Get company or empty string
        const city = cityElems[i]?.innerText.trim() || ''; // Get city or empty string
        const industry = industryElems[i]?.innerText.trim() || ''; // Get industry or empty string

        // Create a member profile object with all the information
        dataRows.push({
          name,
          profileLink,
          chapter,
          company,
          city,
          industry,
          connect: '+' // Standard "connect" button indicator
        });

        // If we found a profile link, add it to our links array
        if (profileLink) {
          profileLinks.push(profileLink);
        }
      }

      // Send back both the member data and the profile links
      sendResponse({ 
        dashboardData: dataRows, 
        profileLinks: profileLinks 
      });
    } catch (e) {
      console.error('Dashboard extraction error:', e); // Log any errors
      sendResponse({ dashboardData: [], profileLinks: [] }); // Send empty arrays if something went wrong
    }
    return true; // Keep message channel open
  }

  /*
   * DETAILED PROFILE EXTRACTION FUNCTION
   * This function scrapes detailed information from an individual member's profile page
   * It's like reading someone's business card and contact information very carefully
   * We look for specific CSS classes that hold different pieces of contact and business info
   */
  if (request.action === 'extractDetailedProfile') {
    try {
      
      // Main extraction function that does the actual data scraping
      const extractData = () => {
        // Get the member's name from the profile page
        const name = document.querySelector('p.MuiTypography-root.MuiTypography-body1.css-s8q61v')?.textContent.trim() || '';

        // Get phone numbers and address from a specific section (ott blocks)
        const ottBlocks = Array.from(document.querySelectorAll('div.MuiBox-root.css-ott1zk p.MuiTypography-root.MuiTypography-body1.css-1h6y3d6')).map(p => p.textContent.trim());
        const phone1 = ottBlocks[0] || ''; // First phone number
        const phone2 = ottBlocks[1] || ''; // Second phone number
        const address = ottBlocks.find(text => /road|street|lane|next to|building/i.test(text)) || ''; // Find address by looking for address keywords

        // Find email by looking for mailto links
        const emailLink = Array.from(document.querySelectorAll('a.css-1ejdz4y')).find(a => a.href.startsWith('mailto:'));
        const email = emailLink?.textContent.trim() || ''; // Extract email text
        
        // Find website by looking for http links (but not email links)
        const websiteLink = Array.from(document.querySelectorAll('a.css-1ejdz4y')).find(a => a.href.startsWith('http') && !a.href.startsWith('mailto:'));
        const website = websiteLink?.textContent.trim() || ''; // Extract website text

        // Get location information (city, postal code, country)
        const locationElems = document.querySelectorAll('div.MuiBox-root.css-1l43wm0 p.MuiTypography-root.MuiTypography-body1.css-jtzytg');
        const city = locationElems[0]?.textContent.trim() || ''; // City
        const postalCode = locationElems[1]?.textContent.trim() || ''; // Postal/ZIP code
        const country = locationElems[2]?.textContent.trim() || ''; // Country

        // Get business information from qsaw blocks
        const qsawBlocks = document.querySelectorAll('div.MuiBox-root.css-qsaw8 p.MuiTypography-root.MuiTypography-body1.css-1sw3fo6');
        const industry = qsawBlocks[0]?.textContent.trim() || ''; // Industry/profession
        const about = qsawBlocks[1]?.textContent.trim() || ''; // About/description
        const keywords = qsawBlocks[2]?.textContent.trim() || ''; // Keywords
        const other = qsawBlocks[3]?.textContent.trim() || ''; // Other information

        // Return all the extracted data as an object
        return {
          name,
          phone1,
          email,
          website,
          phone2,
          address,
          city,
          postalCode,
          country,
          industry,
          about,
          keywords,
          other
        };
      };

      // Try to extract data immediately first
      let detailedData = extractData();
      
      // If we couldn't get the name, the page might still be loading
      if (!detailedData.name) {
        setTimeout(() => { // Wait a bit and try again
          detailedData = extractData(); // Try extraction again after delay
          sendResponse({ data: detailedData }); // Send the data back
        }, 1500); // Wait 1.5 seconds for dynamic content to load
      } else {
        sendResponse({ data: detailedData }); // Send data immediately if we got it
      }

    } catch (error) {
      console.error('Detailed profile extraction error:', error); // Log any errors
      sendResponse({ data: null }); // Send null if something went wrong
    }
    return true; // Keep message channel open for async response
  }

  return true; // Default return to keep message channel open
});