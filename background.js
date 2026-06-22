// ViewDrop Pro Service Worker

let activeRecordingTabId = null;
let originalTargetTabId = null;
let recordingOptions = null;
let recordingStartTime = null;
let isPaused = false;

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
    if (originalTargetTabId) {
      recordingStartTime = Date.now();
      
      const startOverlaysAndSwitch = () => {
        recordingOptions.startTime = recordingStartTime;
        chrome.tabs.sendMessage(originalTargetTabId, {
          action: 'start_overlays',
          options: recordingOptions
        }).catch(() => {});
        chrome.tabs.update(originalTargetTabId, { active: true }).catch(() => {});
      };

      chrome.scripting.executeScript({
        target: { tabId: originalTargetTabId },
        files: ['content.js']
      }).then(() => {
        return chrome.scripting.insertCSS({
          target: { tabId: originalTargetTabId },
          files: ['content.css']
        });
      }).then(() => {
        startOverlaysAndSwitch();
      }).catch(err => {
        console.warn('Could not inject content script (might be a restricted page or lost activeTab):', err);
        startOverlaysAndSwitch();
      });
    }
  }

  if (message.action === 'pause_recording') isPaused = true;
  if (message.action === 'resume_recording') isPaused = false;

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
    activeRecordingTabId = null;
    recordingStartTime = null;
  }
});

// Follow user across tabs and navigations
function injectOverlaysIntoTab(tabId) {
  if (!activeRecordingTabId || tabId === activeRecordingTabId) return;
  
  if (originalTargetTabId && originalTargetTabId !== tabId) {
    chrome.tabs.sendMessage(originalTargetTabId, { action: 'cleanup_overlays' }).catch(() => {});
  }
  
  originalTargetTabId = tabId;
  recordingOptions.startTime = recordingStartTime;
  
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content.js']
  }).then(() => {
    return chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['content.css']
    });
  }).then(() => {
    chrome.tabs.sendMessage(tabId, { action: 'start_overlays', options: recordingOptions }).catch(() => {});
    if (isPaused) {
        chrome.tabs.sendMessage(tabId, { action: 'pause_toolbar_ui' }).catch(() => {});
    }
  }).catch(() => {
    // Try sending message anyway if it was pre-loaded
    chrome.tabs.sendMessage(tabId, { action: 'start_overlays', options: recordingOptions }).catch(() => {});
  });
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (activeRecordingTabId) {
    injectOverlaysIntoTab(activeInfo.tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (activeRecordingTabId && tabId === originalTargetTabId && changeInfo.status === 'complete') {
    injectOverlaysIntoTab(tabId);
  }
});
