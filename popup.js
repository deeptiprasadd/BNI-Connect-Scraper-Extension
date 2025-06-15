document.addEventListener('DOMContentLoaded', function () {
  // Get all the important elements from the HTML page
  const checkProfilesBtn = document.getElementById('checkProfiles'); // Button to scan current page for profiles
  const scrapeDataBtn = document.getElementById('scrapeData'); // Button to start the scraping process
  const statusDiv = document.getElementById('status'); // Div to show current operation status
  const progressBar = document.getElementById('progressBar'); // Container for progress visualization
  const progressFill = document.getElementById('progressFill'); // Fill element for progress bar
  const statsDiv = document.getElementById('stats'); // Container for scraping statistics
  const profileInfoPanel = document.getElementById('profileInfo'); // Panel showing profile count info
  const timerDisplay = document.getElementById('timerDisplay'); // Display for elapsed time and ETA
  const saveLocationDiv = document.getElementById('saveLocation'); // Shows where files will be saved

  // Variables to store all our data and settings
  let dashboardData = []; // Basic profile data extracted from BNI dashboard page
  let profileLinks = []; // Array of profile URLs to scrape
  let allScrapedData = []; // Complete scraped data with merged dashboard + detailed info
  let startTime = null; // Timestamp when scraping began
  let profilesProcessed = 0; // Counter for successfully processed profiles
  let failedProfiles = 0; // Counter for profiles that failed to scrape
  let searchFilters = ''; // Search keywords extracted from current page/URL
  let isScrapingActive = false; // Flag to track if scraping is currently running
  let timerInterval = null; // Reference to timer interval for cleanup
  let currentFilename = ''; // Generated filename for the output CSV
  let processedProfileIds = new Set(); // Track which profiles we've already counted to prevent duplicates

  // Settings for how the scraping works
  const BATCH_SIZE = 5; // Number of profiles to process simultaneously
  const ESTIMATED_TIME_PER_PROFILE = 8; // Initial estimate in seconds per profile
  const BATCH_DELAY = 3000; // Wait time between batches in milliseconds
  const LONG_BREAK_INTERVAL = 15; // Take longer break every N batches
  const LONG_BREAK_DURATION = 15000; // Duration of long break in milliseconds

  // Set up click events for our buttons
  checkProfilesBtn.addEventListener('click', checkProfiles); // Scan page for profiles
  scrapeDataBtn.addEventListener('click', startProfileScraping); // Begin scraping process

  // Initialize download location display on page load
  initializeDownloadLocation();

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'profileCompleted') {
      handleProfileCompletion(message); // Update UI when individual profile completes
    }
  });

  /**
   * Initialize the download location display when popup loads
   * 
   * This function runs when the extension popup first opens and sets up
   * the display showing where downloaded files will be saved. It tries to
   * detect the user's default download directory from their recent downloads.
   */
  async function initializeDownloadLocation() {
    try {
      const downloadPath = await getDownloadPath(); // Get user's download directory
      updateSaveLocationDisplay(downloadPath, 'Ready to save...'); // Show initial state
    } catch (error) {
      console.log('Could not get download path:', error);
      updateSaveLocationDisplay('Downloads folder', 'Default location'); // Fallback display
    }
  }

  /**
   * Get the user's default download directory path
   * 
   * This function queries Chrome's downloads API to find the most recent
   * download and extracts the directory path from it. This helps us show
   * users exactly where their scraped data will be saved.
   */
  function getDownloadPath() {
    return new Promise((resolve) => {
      chrome.downloads.search({ limit: 1 }, (downloads) => { // Get most recent download
        if (chrome.runtime.lastError) {
          resolve('Downloads'); // Default if API fails
          return;
        }

        if (downloads && downloads.length > 0) {
          const recentDownload = downloads[0];
          if (recentDownload.filename) {
            const pathParts = recentDownload.filename.split(/[/\\]/); // Split path on slashes
            pathParts.pop(); // Remove filename, keep directory
            const downloadDir = pathParts.join('/') || 'Downloads'; // Rejoin path
            resolve(downloadDir);
          } else {
            resolve('Downloads'); // Fallback if no filename
          }
        } else {
          resolve('Downloads'); // Fallback if no downloads found
        }
      });
    });
  }

  /**
   * Update the save location display with current path and filename
   * 
   * This function updates the UI element that shows users where their
   * scraped data will be saved and what the filename will be. It includes
   * visual formatting to make long paths more readable.
   */
  function updateSaveLocationDisplay(path, filename) {
    if (!saveLocationDiv) return; // Exit if element doesn't exist

    const cleanPath = path.replace(/\\/g, '/'); // Normalize path separators
    const displayPath = cleanPath.length > 50 ? '...' + cleanPath.slice(-47) : cleanPath; // Truncate long paths

    saveLocationDiv.innerHTML = `
      <div class="save-location-content">
        <div class="save-icon">📁</div>
        <div class="save-info">
          <div class="save-label">Save Location:</div>
          <div class="save-path">${displayPath}</div>
          <div class="save-filename">${filename}</div>
        </div>
      </div>
    `;
  }

  /**
   * Handle completion of individual profile scraping - FIXED to prevent double counting
   * 
   * This function is called whenever a single profile finishes scraping (success or failure).
   * It updates the UI counters and progress indicators. The function includes logic to
   * prevent double-counting profiles that might send multiple completion messages.
   */
  function handleProfileCompletion(message) {
    if (!isScrapingActive) return; // Ignore if scraping is not active

    const { profileNumber, success, profileUrl } = message;
    
    // Create unique identifier for this profile to prevent double counting
    const profileId = `${profileNumber}-${profileUrl || profileNumber}`;
    
    // Skip if we've already processed this profile
    if (processedProfileIds.has(profileId)) {
      return; // Prevent duplicate counting
    }
    
    // Mark this profile as processed
    processedProfileIds.add(profileId);

    // Update success/failure counters
    if (success) {
      profilesProcessed++; // Increment successful scrapes
      document.getElementById('scrapedProfiles').textContent = profilesProcessed;
    } else {
      failedProfiles++; // Increment failed scrapes
      document.getElementById('failedProfiles').textContent = failedProfiles;
    }

    // Update current profile number display
    document.getElementById('currentProfile').textContent = profileNumber;

    // Update progress bar and status message
    const totalCompleted = profilesProcessed + failedProfiles;
    updateProgress(totalCompleted, profileLinks.length, `Processing profile ${profileNumber}/${profileLinks.length}...`);

    // Recalculate average time per profile
    updateAverageTime();
  }

  /**
   * Calculate and display the average time per profile
   * 
   * This function calculates how long each profile is taking to scrape on average
   * and updates the UI display. This helps users understand the scraping performance
   * and provides better time estimates.
   */
  function updateAverageTime() {
    if (!startTime || (profilesProcessed + failedProfiles) === 0) return; // Can't calculate without data

    const elapsed = (Date.now() - startTime) / 1000; // Time elapsed in seconds
    const totalCompleted = profilesProcessed + failedProfiles;
    const avgTimePerProfile = elapsed / totalCompleted; // Calculate average

    document.getElementById('avgTime').textContent = `${avgTimePerProfile.toFixed(1)}s`; // Display with 1 decimal
  }

  /**
   * Start the real-time timer display
   * 
   * This function initializes and starts the timer that shows elapsed time
   * and estimated time remaining. It updates every second to provide
   * real-time feedback to the user about scraping progress.
   */
  function startTimer() {
    if (timerInterval) clearInterval(timerInterval); // Clear any existing timer

    timerDisplay.style.display = 'block'; // Show timer UI
    startTime = Date.now(); // Record start time

    timerInterval = setInterval(() => {
      updateTimeRemaining(); // Update display every second
    }, 1000);
  }

  /**
   * Stop the timer and hide timer display
   * 
   * This function cleans up the timer when scraping completes or is cancelled.
   * It's important to clear intervals to prevent memory leaks.
   */
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval); // Stop the interval
      timerInterval = null; // Clear reference
    }
  }

  /**
   * Update the estimated time remaining display
   * 
   * This function calculates and displays how much time is estimated to remain
   * based on the current average processing time per profile. It provides
   * users with a realistic expectation of when scraping will complete.
   */
  function updateTimeRemaining() {
    if (!startTime || !isScrapingActive) return; // Exit if not actively scraping

    const elapsed = (Date.now() - startTime) / 1000; // Seconds elapsed
    const totalCompleted = profilesProcessed + failedProfiles;

    if (totalCompleted === 0) {
      document.getElementById('timeRemaining').textContent = 'Calculating...'; // No data yet
      return;
    }

    const avgTimePerProfile = elapsed / totalCompleted; // Current average time
    const remainingProfiles = profileLinks.length - totalCompleted; // Profiles left to process
    const estimatedRemainingSeconds = Math.max(0, remainingProfiles * avgTimePerProfile); // Calculate ETA

    document.getElementById('timeRemaining').textContent = formatTime(estimatedRemainingSeconds); // Display formatted time
  }

  /**
   * Extract search filters from the current BNI page URL and content
   * 
   * This function analyzes the current BNI page to determine what search filters
   * or criteria were used. This information is used to generate meaningful
   * filenames and organize the scraped data appropriately.
   */
  async function extractSearchFilters() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); // Get current tab
      if (!tab || !tab.id) return 'general'; // Fallback if no tab

      const url = new URL(tab.url);
      const params = new URLSearchParams(url.search); // Parse URL parameters

      let keywords = [];

      // Extract common search parameters from URL
      if (params.get('search')) keywords.push(params.get('search')); // Search term
      if (params.get('chapter')) keywords.push(params.get('chapter')); // BNI chapter
      if (params.get('industry')) keywords.push(params.get('industry')); // Industry filter
      if (params.get('city')) keywords.push(params.get('city')); // City filter
      if (params.get('region')) keywords.push(params.get('region')); // Region filter

      // If no URL parameters found, try extracting from page content
      if (keywords.length === 0) {
        try {
          await ensureContentScript(tab.id); // Make sure content script is loaded
          const response = await chrome.runtime.sendMessage({
            action: 'extractPageFilters',
            tabId: tab.id
          });

          if (response && response.success && response.filters) {
            Object.entries(response.filters).forEach(([key, value]) => {
              if (value && value.trim()) {
                keywords.push(value.trim()); // Add non-empty filter values
              }
            });
          }
        } catch (e) {
          console.log('Could not extract page filters:', e);
        }
      }

      const cleanKeywords = keywords
        .map(keyword => keyword.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()) // Clean special characters
        .filter(keyword => keyword.length > 0); // Remove empty strings

      return cleanKeywords.length > 0 ? cleanKeywords[0] : 'general'; // Return first keyword or default
    } catch (e) {
      console.log('Filter extraction error:', e);
      return 'general'; // Fallback on any error
    }
  }

  /**
   * Check for profiles on the current BNI page
   * 
   * This function scans the current BNI dashboard or search results page
   * to identify all available member profiles. It extracts basic information
   * about each profile and prepares the list of URLs to scrape.
   */
  async function checkProfiles() {
    statusDiv.textContent = 'Checking profiles on current page...'; // Update status
    checkProfilesBtn.disabled = true; // Prevent multiple clicks

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); // Get active tab
      if (!tab || !tab.id) throw new Error('Cannot access current tab');

      await ensureContentScript(tab.id); // Inject content script if needed

      const response = await sendMessage(tab.id, { action: 'extractDashboardProfiles' }); // Extract profile data

      if (response?.dashboardData) {
        dashboardData = response.dashboardData; // Store basic profile info
        profileLinks = response.profileLinks.filter(link => link?.trim()); // Filter out empty URLs

        searchFilters = await extractSearchFilters(); // Get search context

        const timestamp = formatDate(); // Generate timestamp
        currentFilename = `BNI-${searchFilters}-${timestamp}.csv`; // Create filename

        const downloadPath = await getDownloadPath(); // Get save location
        updateSaveLocationDisplay(downloadPath, currentFilename); // Update UI

        const totalBatches = Math.ceil(profileLinks.length / BATCH_SIZE); // Calculate batches needed
        const estimatedTotalTimeSeconds = profileLinks.length * ESTIMATED_TIME_PER_PROFILE; // Rough time estimate
        const estimatedTotalTimeMinutes = Math.ceil(estimatedTotalTimeSeconds / 60); // Convert to minutes

        document.getElementById('profileCount').textContent = profileLinks.length; // Show profile count
        document.getElementById('estimatedTime').textContent = `${estimatedTotalTimeMinutes} min`; // Show time estimate
        document.getElementById('totalProfiles').textContent = profileLinks.length; // Update total counter

        profileInfoPanel.style.display = 'block'; // Show profile info panel
        saveLocationDiv.style.display = 'block'; // Show save location
        scrapeDataBtn.disabled = false; // Enable scrape button
        statusDiv.textContent = `Found ${profileLinks.length} profiles. Ready to scrape.`; // Success message
      } else {
        throw new Error('No profiles found on this page');
      }
    } catch (e) {
      statusDiv.textContent = `Error: ${e.message}`; // Show error
      checkProfilesBtn.disabled = false; // Re-enable button on error
    }
  }

  /**
   * Start the main profile scraping process - FIXED to reset counters properly
   * 
   * This is the main function that orchestrates the entire scraping process.
   * It processes profiles in batches to avoid overwhelming the server and
   * includes proper rate limiting and error handling.
   */
  async function startProfileScraping() {
    if (!profileLinks.length) {
      return statusDiv.textContent = 'No profile links to scrape'; // Exit if no profiles
    }

    // Initialize scraping state - RESET ALL COUNTERS
    isScrapingActive = true; // Set scraping flag
    scrapeDataBtn.disabled = true; // Disable scrape button
    checkProfilesBtn.disabled = true; // Disable check button

    // Show progress UI elements
    progressBar.style.display = 'block'; // Show progress bar
    statsDiv.style.display = 'block'; // Show statistics

    // CRITICAL: Reset all data and counters to prevent double counting
    allScrapedData = []; // Clear previous data
    profilesProcessed = 0; // Reset success counter
    failedProfiles = 0; // Reset failure counter
    processedProfileIds.clear(); // Clear the tracking set

    // Reset statistics display
    document.getElementById('scrapedProfiles').textContent = '0'; // Reset UI counter
    document.getElementById('failedProfiles').textContent = '0'; // Reset UI counter
    document.getElementById('avgTime').textContent = '--'; // Reset average time
    document.getElementById('currentProfile').textContent = '0'; // Reset current profile

    const totalBatches = Math.ceil(profileLinks.length / BATCH_SIZE); // Calculate total batches
    const downloadPath = await getDownloadPath(); // Get download location
    updateSaveLocationDisplay(downloadPath, `🔄 Scraping... (${currentFilename})`); // Update UI

    startTimer(); // Begin timer

    try {
      // Process profiles in batches
      for (let i = 0; i < totalBatches; i++) {
        if (!isScrapingActive) break; // Exit if scraping cancelled

        const startIdx = i * BATCH_SIZE; // Calculate batch start index
        const endIdx = Math.min(startIdx + BATCH_SIZE, profileLinks.length); // Calculate batch end index
        const batchUrls = profileLinks.slice(startIdx, endIdx); // Extract URLs for this batch

        try {
          const batchResult = await scrapeBatch(batchUrls, i, totalBatches); // Process batch
          
          if (batchResult.success && batchResult.results) {
            // Process batch results and merge with dashboard data
            batchResult.results.forEach((result, idx) => {
              const dashboardIndex = startIdx + idx; // Calculate original index
              const dashboardProfile = dashboardData[dashboardIndex] || {}; // Get dashboard data

              const merged = {
                // Basic dashboard data
                name: dashboardProfile.name || '',
                profileLink: dashboardProfile.profileLink || '',
                chapter: dashboardProfile.chapter || '',
                company: dashboardProfile.company || '',
                city: dashboardProfile.city || '',
                industryTag: dashboardProfile.industry || '',
                connect: dashboardProfile.connect || '+',
                // Detailed scraped data
                detailedName: result?.data?.name || '',
                phoneNo: result?.data?.phone1 || '',
                detailedEmail: result?.data?.email || '',
                website: result?.data?.website || '',
                phoneNo2: result?.data?.phone2 || '',
                detailedAddress: result?.data?.address || '',
                detailedCity: result?.data?.city || '',
                postalCode: result?.data?.postalCode || '',
                country: result?.data?.country || '',
                detailedIndustry: result?.data?.industry || '',
                about: result?.data?.about || '',
                keyword: result?.data?.keywords || '',
                other: result?.data?.other || ''
              };

              allScrapedData.push(merged); // Add to final dataset
            });
          }
        } catch (e) {
          statusDiv.textContent = `Batch ${i + 1} error: ${e.message}`; // Show batch error
          console.error('Batch processing error:', e);
        }

        // Wait between batches
        if (i < totalBatches - 1) {
          const isLongBreak = (i + 1) % LONG_BREAK_INTERVAL === 0; // Check if long break time
          const waitTime = isLongBreak ? LONG_BREAK_DURATION : BATCH_DELAY; // Choose wait duration

          if (isLongBreak) {
            statusDiv.textContent = `Taking extended break (${LONG_BREAK_DURATION / 1000}s) to avoid rate limits...`; // Long break message
          } else {
            statusDiv.textContent = `Waiting ${BATCH_DELAY / 1000}s before next batch...`; // Short break message
          }
          
          await sleep(waitTime); // Wait before next batch
        }
      }

      // Complete scraping process
      if (isScrapingActive) {
        document.getElementById('timeRemaining').textContent = 'Complete!'; // Update timer
        statusDiv.textContent = `Scraping complete! Processing ${allScrapedData.length} profiles for download...`; // Success message
        
        downloadCompleteData(); // Generate and download CSV
      }
      
    } catch (error) {
      statusDiv.textContent = `Scraping failed: ${error.message}`; // Show error
      console.error('Scraping error:', error);
    } finally {
      // Clean up and reset UI
      isScrapingActive = false; // Clear scraping flag
      stopTimer(); // Stop timer
      scrapeDataBtn.disabled = false; // Re-enable scrape button
      checkProfilesBtn.disabled = false; // Re-enable check button
    }
  }

  /**
   * Scrape a batch of profile URLs
   * 
   * This function sends a batch of profile URLs to the background script
   * for processing. It handles communication with the background script
   * and returns the results for the current batch.
   */
  function scrapeBatch(profileUrls, batchIndex, totalBatches) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'scrapeBatch',
        profileUrls, // URLs to scrape in this batch
        batchIndex, // Current batch number
        totalBatches // Total number of batches
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message }); // Handle Chrome API errors
        } else {
          resolve(response || { success: false, error: 'No response received' }); // Return response or error
        }
      });
    });
  }

  /**
   * Generate and download the complete CSV file with all scraped data
   * 
   * This function takes all the scraped profile data, formats it as CSV,
   * and triggers a download. It merges the basic dashboard data with
   * the detailed scraped information into a comprehensive dataset.
   */
  async function downloadCompleteData() {
    if (!allScrapedData.length) {
      statusDiv.textContent = 'No data to download'; // Exit if no data
      return;
    }

    const headers = [
      'NAME', 'PROFILE LINK', 'CHAPTER', 'COMPANY', 'CITY', 'INDUSTRY TAG', 'CONNECT',
      'DETAILED NAME', 'PHONE NO', 'EMAIL', 'WEBSITE', 'PHONE NO 2', 'ADDRESS',
      'DETAILED CITY', 'POSTAL CODE', 'COUNTRY', 'DETAILED INDUSTRY', 'ABOUT', 'KEYWORD', 'OTHER'
    ]; // CSV column headers

    const rows = allScrapedData.map(d => [
      d.name, d.profileLink, d.chapter, d.company, d.city, d.industryTag, d.connect,
      d.detailedName, d.phoneNo, d.detailedEmail, d.website, d.phoneNo2,
      d.detailedAddress, d.detailedCity, d.postalCode, d.country,
      d.detailedIndustry, d.about, d.keyword, d.other
    ]); // Convert data objects to array rows

    const csv = [headers, ...rows]
      .map(row => row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(',')) // Escape quotes and join columns
      .join('\n'); // Join rows with newlines

    const timestamp = formatDate(); // Generate timestamp
    const filename = `BNI-${searchFilters}-${timestamp}.csv`; // Create filename

    const downloadPath = await getDownloadPath(); // Get download location
    updateSaveLocationDisplay(downloadPath, `⬇️ Downloading: ${filename}`); // Update UI

    downloadCSV(csv, filename); // Trigger download

    setTimeout(() => {
      updateSaveLocationDisplay(downloadPath, `✅ Saved: ${filename}`); // Update UI after download
    }, 1000);

    statusDiv.textContent = 'Scraping process completed successfully.'; // Final success message
  }

  /**
   * Download CSV data as a file using Chrome downloads API
   * 
   * This function creates a downloadable file from the CSV data using
   * Chrome's downloads API. It creates a blob URL and initiates the
   * download without prompting the user for a save location.
   */
  function downloadCSV(csvData, filename) {
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' }); // Create blob from CSV data
    const url = URL.createObjectURL(blob); // Create download URL

    chrome.downloads.download({
      url: url, // Blob URL
      filename: filename, // Target filename
      saveAs: false // Don't prompt user for location
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        statusDiv.textContent = `Download error: ${chrome.runtime.lastError.message}`; // Show error
      } else {
        console.log(`Download started with ID: ${downloadId}`); // Log success
        setTimeout(() => URL.revokeObjectURL(url), 1000); // Clean up blob URL
      }
    });
  }

  /**
   * Update the progress bar and status message
   * 
   * This function updates the visual progress bar based on completion
   * percentage and optionally updates the status message. It provides
   * users with visual feedback about scraping progress.
   */
  function updateProgress(current, total, message) {
    const percentage = Math.round((current / total) * 100); // Calculate completion percentage
    progressFill.style.width = `${percentage}%`; // Update progress bar width
    if (message) {
      statusDiv.textContent = message; // Update status message if provided
    }
  }

  /**
   * Format seconds into human-readable time string
   * 
   * This utility function converts seconds into a more readable format
   * showing hours, minutes, and seconds as appropriate. Used for displaying
   * time estimates and elapsed time.
   */
  function formatTime(seconds) {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`; // Just seconds if under 1 minute
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60); // Calculate minutes
      const remainingSeconds = Math.round(seconds % 60); // Calculate remaining seconds
      return `${minutes}m ${remainingSeconds}s`; // Format as minutes and seconds
    } else {
      const hours = Math.floor(seconds / 3600); // Calculate hours
      const minutes = Math.floor((seconds % 3600) / 60); // Calculate remaining minutes
      return `${hours}h ${minutes}m`; // Format as hours and minutes
    }
  }

  /**
   * Format current date and time for filename timestamps
   * 
   * This function generates a timestamp string suitable for use in filenames.
   * It creates a compact, sortable format that includes date and time
   * down to the second to ensure unique filenames.
   */
  function formatDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Pad month with zero
    const day = String(now.getDate()).padStart(2, '0'); // Pad day with zero
    const hours = String(now.getHours()).padStart(2, '0'); // Pad hours with zero
    const minutes = String(now.getMinutes()).padStart(2, '0'); // Pad minutes with zero
    const seconds = String(now.getSeconds()).padStart(2, '0'); // Pad seconds with zero

    return `${year}${month}${day}-${hours}${minutes}${seconds}`; // Return formatted timestamp
  }

  /**
   * Ensure content script is loaded in the specified tab
   * 
   * This function checks if the content script is already loaded in the target
   * tab and injects it if necessary. This is important because content scripts
   * are needed to interact with the BNI pages.
   */
  async function ensureContentScript(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => { // Test if content script is loaded
        if (chrome.runtime.lastError || !response) {
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'] // Inject content script
          }, () => {
            resolve(); // Resolve after injection
          });
        } else {
          resolve(); // Content script already loaded
        }
      });
    });
  }

  /**
   * Send message to content script and return response
   * 
   * This utility function handles communication with content scripts
   * running in BNI pages. It wraps the Chrome messaging API in a
   * Promise for easier async/await usage.
   */
  function sendMessage(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => { // Send message to tab
        if (chrome.runtime.lastError) {
          resolve(null); // Return null on error
        } else {
          resolve(response); // Return response
        }
      });
    });
  }

  /**
   * Simple sleep/delay function
   * 
   * This utility function creates a delay using Promises. It's used
   * to implement rate limiting between batches to avoid overwhelming
   * the BNI servers and reduce the chance of being blocked.
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms)); // Create delay promise
  }
});