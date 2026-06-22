// VeloRecord Pro Service Worker

let activeRecordingTabId = null;
let originalTargetTabId = null;
let recordingOptions = null;

// Listen for messages from popup, recorder, or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (message.action === 'start_recording') {
    recordingOptions = message.options;
    
    // Store current active tab so we know where to inject overlays
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        originalTargetTabId = tabs[0].id;
      }
      
      // Open the recorder helper tab in the background (or pinned) to start capture
      chrome.tabs.create({
        url: chrome.runtime.getURL('recorder.html'),
        active: true // Needs to be active to guarantee user gesture capability
      }, (tab) => {
        activeRecordingTabId = tab.id;
        sendResponse({ success: true });
      });
    });
    return true; // Keep message channel open for async response
  }

  if (message.action === 'recorder_ready') {
    // Send options back to the recorder page
    sendResponse({ options: recordingOptions, targetTabId: originalTargetTabId });
  }

  if (message.action === 'recording_started') {
    // Notify the target tab content script to display overlay widgets
    if (originalTargetTabId) {
      // First ensure content script is injected (in case it wasn't pre-loaded)
      chrome.scripting.executeScript({
        target: { tabId: originalTargetTabId },
        files: ['content.js']
      }).then(() => {
        chrome.tabs.sendMessage(originalTargetTabId, {
          action: 'start_overlays',
          options: recordingOptions
        });
      }).catch(err => {
        console.warn('Could not inject content script to original tab (might be a restricted chrome:// page):', err);
      });
    }
  }

  if (message.action === 'pause_recording' || message.action === 'resume_recording' || message.action === 'stop_recording' || message.action === 'add_bookmark') {
    // Forward actions from content script floating bar to the recorder tab
    if (activeRecordingTabId) {
      chrome.tabs.sendMessage(activeRecordingTabId, message);
    }
  }

  if (message.action === 'recording_stopped_cleanup') {
    // Tell content script to remove overlays
    if (originalTargetTabId) {
      chrome.tabs.sendMessage(originalTargetTabId, { action: 'cleanup_overlays' }).catch(() => {});
    }
  }
});
