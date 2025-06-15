// background.js - This is the main controller for the Chrome extension
// It runs in the background and handles all the heavy lifting like opening tabs,
// scraping profiles, and managing retries. It acts as the "brain" of the extension.

/**
 * This event fires when the extension is first installed.
 * It's mainly used for setup and logging that the extension is ready to use.
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log("BNI Profile Scraper - Merged Extension installed."); // Log successful installation
});

/**
 * This event fires when Chrome starts up and the extension loads.
 * It confirms the extension is active and ready to receive commands.
 */
chrome.runtime.onStartup.addListener(() => {
  console.log("BNI Profile Scraper - Merged Extension started."); // Log extension startup
});

/**
 * This is the main message handler that listens for commands from the popup.
 * It acts like a dispatcher, routing different types of requests to the right functions.
 * The popup sends messages here when the user wants to scrape profiles or extract filters.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle batch scraping requests (the main scraping operation)
  if (request.action === 'scrapeBatch') {
    handleBatchScraping(request, sendResponse); // Process a batch of profile URLs
    return true; // Keep message channel open for async response
  }
  
  // Handle filter extraction requests (for creating meaningful filenames)
  if (request.action === 'extractPageFilters') {
    handleFilterExtraction(request, sendResponse); // Extract search filters from current page
    return true; // Keep message channel open for async response
  }
});

/**
 * This function extracts search filters from the current BNI page.
 * It's used to create meaningful filenames like "bni_profiles_chapter-downtown_20241201.csv"
 * The function injects a content script into the page to read the search criteria.
 */
async function handleFilterExtraction(request, sendResponse) {
  try {
    const { tabId } = request; // Get the tab ID from the request
    
    // Make sure our content script is loaded on the target page
    // Content scripts are needed to read page content and interact with the DOM
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js'] // Inject our content script
    });
    
    // Ask the content script to extract filter information from the page
    // This looks for things like selected chapter, industry, city, etc.
    const result = await chrome.tabs.sendMessage(tabId, { action: 'extractFilters' });
    
    sendResponse({ success: true, filters: result }); // Send the filters back to popup
  } catch (error) {
    console.error('Filter extraction error:', error); // Log the error for debugging
    sendResponse({ success: false, error: error.message }); // Send error back to popup
  }
}

/**
 * This is the main scraping function that processes a batch of profile URLs.
 * It opens each profile in a new tab, extracts the data, then closes the tab.
 * It includes retry logic, timeout handling, and progress reporting.
 * This function is designed to be gentle on the BNI servers to avoid getting blocked.
 */
async function handleBatchScraping(request, sendResponse) {
  const { profileUrls, batchIndex, totalBatches, onProfileComplete } = request; // Get parameters from popup
  const results = []; // Array to store results from each profile
  
  try {
    // Process each profile URL in the batch one by one
    for (let i = 0; i < profileUrls.length; i++) {
      const url = profileUrls[i]; // Get the current profile URL
      const profileNumber = (batchIndex * profileUrls.length) + i + 1; // Calculate overall profile number
      console.log(`Scraping profile ${profileNumber}: ${url}`); // Log what we're working on
      
      // Set up retry logic - sometimes profiles fail to load, so we try multiple times
      let tab = null; // Variable to track the current tab
      let retryCount = 0; // How many times we've tried this profile
      const maxRetries = 2; // Maximum number of retries before giving up
      
      // Keep trying until we succeed or run out of retries
      while (retryCount <= maxRetries) {
        try {
          // Create a new background tab for this profile
          // Background tabs don't interfere with the user's browsing
          tab = await chrome.tabs.create({ url: url, active: false });
          
          // Wait for the page to fully load, but don't wait forever
          // Some pages load slowly, so we need to be patient but not wait endlessly
          await Promise.race([
            new Promise(resolve => {
              const listener = (tabId, changeInfo) => {
                // Check if this is our tab and it's finished loading
                if (tabId === tab.id && changeInfo.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener); // Clean up the listener
                  resolve(); // Page is loaded
                }
              };
              chrome.tabs.onUpdated.addListener(listener); // Start listening for load completion
            }),
            sleep(15000) // Give up waiting after 15 seconds
          ]);
          
          // Wait a bit more for dynamic content to load (JavaScript-generated content)
          // Many modern websites load content after the initial page load
          await sleep(2000);
          
          // Inject our content script into the profile page
          // The content script can read the page content and extract profile data
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'] // Load our content script into the tab
          });
          
          // Ask the content script to extract detailed profile information
          // This includes phone numbers, email, address, etc.
          const result = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { action: 'extractDetailedProfile' }), // Extract data
            sleep(12000).then(() => ({ timeout: true })) // Give up after 12 seconds
          ]);
          
          // Check if we got valid data from the profile
          if (result && !result.timeout && result.data) {
            results.push({ url, data: result.data, success: true }); // Add successful result
            
            // Tell the popup that we successfully completed this profile
            // This updates the progress bar and counters in real-time
            try {
              chrome.runtime.sendMessage({
                action: 'profileCompleted',
                profileNumber: profileNumber,
                success: true
              });
            } catch (e) {
              console.log('Could not notify popup - popup may be closed'); // Popup might be closed
            }
            
            break; // Success! Exit the retry loop and move to next profile
          } else if (result && result.timeout) {
            throw new Error('Timeout waiting for profile data'); // Profile took too long to load
          } else {
            throw new Error('No data extracted'); // Profile didn't have the expected data
          }
          
        } catch (error) {
          console.error(`Attempt ${retryCount + 1} failed for ${url}:`, error); // Log the error
          retryCount++; // Increment retry counter
          
          // Decide whether to retry or give up
          if (retryCount <= maxRetries) {
            console.log(`Retrying ${url} (attempt ${retryCount + 1}/${maxRetries + 1})`); // Log retry attempt
            await sleep(2000); // Wait 2 seconds before retrying
          } else {
            // We've exhausted all retries, mark this profile as failed
            results.push({ url, data: null, success: false, error: error.message });
            
            // Tell the popup that this profile failed
            // This updates the failed counter in the UI
            try {
              chrome.runtime.sendMessage({
                action: 'profileCompleted',
                profileNumber: profileNumber,
                success: false
              });
            } catch (e) {
              console.log('Could not notify popup - popup may be closed'); // Popup might be closed
            }
          }
        } finally {
          // Always clean up by closing the tab, regardless of success or failure
          // This prevents accumulating lots of open tabs
          if (tab && tab.id) {
            try {
              await chrome.tabs.remove(tab.id); // Close the tab
            } catch (e) {
              console.log('Tab already closed or removed'); // Tab might already be gone
            }
          }
        }
      }
      
      // Wait between profiles to be gentle on the server
      // This helps avoid getting blocked for making too many requests too quickly
      if (i < profileUrls.length - 1) {
        await sleep(2000); // Wait 2 seconds before processing the next profile
      }
    }
    
    // Send all results back to the popup when the batch is complete
    sendResponse({ success: true, results });
  } catch (error) {
    console.error('Batch scraping error:', error); // Log any unexpected errors
    sendResponse({ success: false, error: error.message }); // Send error back to popup
  }
}

/**
 * This is a utility function that creates a delay for a specified number of milliseconds.
 * It's used throughout the scraping process to avoid overwhelming servers with too many requests.
 * The function returns a Promise that resolves after the specified time, making it work with async/await.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms)); // Wait for the specified time
}