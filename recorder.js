// ViewDrop Capture Engine

let mediaRecorder = null;
let recordedChunks = [];
let screenStream = null;
let micStream = null;
let audioCtx = null;
let audioDestination = null;
let recordingId = null;
let startTime = null;
let pauseStartTime = null;
let totalPausedTime = 0;
let options = null;
let bookmarks = [];

// --- TRANSCRIPTION STATE ---
let recognizer = null;
let transcriptEntries = [];
let transcriptionActive = false;

// IndexedDB Helper
const DB_NAME = 'ViewDropDB';
const STORE_NAME = 'videos';

function saveVideoToIndexedDB(id, blob) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

// --- LIVE TRANSCRIPTION (Web Speech API) ---
// Runs alongside MediaRecorder using the same mic stream. Gracefully no-ops
// if the browser doesn't support it or no microphone was captured.
function startTranscription() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !micStream || micStream.getAudioTracks().length === 0) {
    console.warn('Transcription unavailable: no SpeechRecognition support or no mic track.');
    return;
  }

  try {
    recognizer = new SR();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = 'en-US';

    recognizer.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (!result || !result.isFinal) return;
      const text = result[0].transcript.trim();
      if (!text) return;

      const elapsedMs = (Date.now() - startTime) - totalPausedTime;
      transcriptEntries.push({
        time: Math.max(0, Math.floor(elapsedMs / 1000)),
        text
      });
    };

    recognizer.onerror = (e) => {
      // Suppress network/mic errors from flooding the console
      // console.warn('Transcription error:', e.error);
    };

    // Chrome's recognizer stops itself periodically (silence/network) -
    // restart automatically while we're still actively recording.
    recognizer.onend = () => {
      if (transcriptionActive) {
        try { recognizer.start(); } catch (e) { /* already started */ }
      }
    };

    transcriptionActive = true;
    recognizer.start();
  } catch (e) {
    console.warn('Failed to start transcription:', e);
  }
}

function stopTranscription() {
  transcriptionActive = false;
  if (recognizer) {
    try { recognizer.stop(); } catch (e) { /* ignore */ }
    recognizer = null;
  }
}

// Request options and start immediately
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ action: 'recorder_ready' }, (response) => {
    if (response) {
      options = response.options;
      startCaptureFlow();
    }
  });

  document.getElementById('manual-btn').addEventListener('click', startCaptureFlow);
  document.getElementById('pause-btn').addEventListener('click', pauseRecording);
  document.getElementById('resume-btn').addEventListener('click', resumeRecording);
  document.getElementById('stop-btn').addEventListener('click', stopAndSaveRecording);
});

async function startCaptureFlow() {
  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  const manualBtn = document.getElementById('manual-btn');

  manualBtn.style.display = 'none';

  try {
    statusTitle.textContent = 'Awaiting User Selection';
    statusDesc.textContent = 'Choose the screen or window you wish to record.';

    // 1. Get Screen Stream
    const displayMediaOptions = {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: true // Request system/tab audio
    };

    if (options.mode === 'camera') {
      // Camera Only Mode
      screenStream = null;
    } else {
      screenStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      // Listen for screen sharing stopped from native Chrome banner
      screenStream.getVideoTracks()[0].onended = () => {
        stopAndSaveRecording();
      };
    }

    // 2. Get Mic Stream if enabled
    if (options.micEnabled || options.mode === 'camera') {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          video: options.mode === 'camera' ? { width: 1280, height: 720 } : false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (e) {
        console.warn('Microphone/Webcam permission denied or unavailable:', e);
      }
    }

    // 3. Setup Audio Graph to mix screen + mic
    let tracks = [];
    let combinedAudioStream = null;

    if (screenStream && screenStream.getAudioTracks().length > 0 || micStream && micStream.getAudioTracks().length > 0) {
      audioCtx = new AudioContext();
      audioDestination = audioCtx.createMediaStreamDestination();

      if (screenStream && screenStream.getAudioTracks().length > 0) {
        const screenAudioSrc = audioCtx.createMediaStreamSource(new MediaStream([screenStream.getAudioTracks()[0]]));
        screenAudioSrc.connect(audioDestination);
      }

      if (micStream && micStream.getAudioTracks().length > 0) {
        const micAudioSrc = audioCtx.createMediaStreamSource(new MediaStream([micStream.getAudioTracks()[0]]));
        micAudioSrc.connect(audioDestination);
      }

      combinedAudioStream = audioDestination.stream;
    }

    // 4. Combine Video and Audio tracks
    if (options.mode === 'camera') {
      // Camera Only
      if (micStream) {
        tracks = micStream.getTracks();
      }
    } else {
      // Screen Only or Screen + Cam
      if (screenStream) {
        tracks.push(screenStream.getVideoTracks()[0]);
      }
      if (combinedAudioStream && combinedAudioStream.getAudioTracks().length > 0) {
        tracks.push(combinedAudioStream.getAudioTracks()[0]);
      } else if (screenStream && screenStream.getAudioTracks().length > 0) {
        tracks.push(screenStream.getAudioTracks()[0]);
      }
    }

    if (tracks.length === 0) {
      throw new Error('No tracks found to record.');
    }

    const finalStream = new MediaStream(tracks);

    // 5. Initialize MediaRecorder
    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    mediaRecorder = new MediaRecorder(finalStream, {
      mimeType: mimeType,
      videoBitsPerSecond: 3000000 // 3 Mbps for high-quality
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };


    mediaRecorder.onstop = async () => {
      stopTranscription();

      statusTitle.textContent = 'Saving Recording...';
      statusDesc.textContent = 'Writing high-quality video data to local database.';
      document.getElementById('controls-bar').style.display = 'none';

      const rawBlob = new Blob(recordedChunks, { type: mimeType });
      
      // Calculate duration
      const endTime = Date.now();
      const durationMs = (endTime - startTime) - totalPausedTime;
      const durationStr = formatDuration(durationMs);

      // Fix WebM infinite duration issue
      let blob = rawBlob;
      try {
        blob = await fixWebmDuration(rawBlob, durationMs);
      } catch (err) {
        console.warn('Failed to fix WebM seek duration headers:', err);
      }

      // Save to IndexedDB
      await saveVideoToIndexedDB(recordingId, blob);
      const date = new Date().toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      const time = new Date().toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit'
      });

      chrome.storage.local.get(['recordings'], (data) => {
        const recordings = data.recordings || [];
        recordings.push({
          id: recordingId,
          title: `Recording - ${date} ${time}`,
          date: date,
          duration: durationStr,
          durationSecs: durationMs / 1000,
          mimeType: mimeType,
          size: blob.size,
          transcript: transcriptEntries
        });
        chrome.storage.local.set({ recordings }, () => {
          chrome.runtime.sendMessage({ action: 'recording_stopped_cleanup' });

          // Clean up local tracks
          if (screenStream) screenStream.getTracks().forEach(t => t.stop());
          if (micStream) micStream.getTracks().forEach(t => t.stop());
          if (audioCtx) audioCtx.close();

          // Open Dashboard with the new ID
          window.location.href = `dashboard.html?id=${recordingId}`;
        });
      });
    };

    // Start Recorder
    recordingId = 'rec_' + Date.now() + Math.random().toString(36).substr(2, 9);
    recordedChunks = [];
    
    // Countdown implementation (if user selected one)
    if (options.countdown > 0) {
      statusTitle.textContent = `Starting in ${options.countdown}...`;
      for (let i = options.countdown; i > 0; i--) {
        statusTitle.textContent = `Starting in ${i}...`;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    mediaRecorder.start(1000); // 1-second chunks slice
    startTime = Date.now();
    totalPausedTime = 0;
    bookmarks = [{
      time: 0,
      note: 'Recording Started'
    }];
    transcriptEntries = [];
    startTranscription();

    statusTitle.textContent = 'Recording Screen';
    statusDesc.textContent = 'Recording is active. Do not close this tab.';
    document.getElementById('controls-bar').style.display = 'flex';

    // Send message to background that recording started successfully
    chrome.runtime.sendMessage({ action: 'recording_started' });

  } catch (err) {
    console.error('Recording initialization failed:', err);
    statusTitle.textContent = 'Capture Cancelled';
    statusDesc.textContent = err.message || 'Make sure permissions are granted and try again.';
    manualBtn.style.display = 'inline-block';
  }
}

function pauseRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    pauseStartTime = Date.now();
    const elapsedMs = (Date.now() - startTime) - totalPausedTime;
    const elapsedSecs = Math.max(0, Math.floor(elapsedMs / 1000));
    bookmarks.push({
      time: elapsedSecs,
      note: 'Recording Paused'
    });
    document.getElementById('pause-btn').style.display = 'none';
    document.getElementById('resume-btn').style.display = 'inline-block';
    document.getElementById('status-title').textContent = 'Recording Paused';
    document.getElementById('status-desc').textContent = 'Recording is currently paused.';
  }
}

function resumeRecording() {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    if (pauseStartTime) {
      totalPausedTime += (Date.now() - pauseStartTime);
    }
    const elapsedMs = (Date.now() - startTime) - totalPausedTime;
    const elapsedSecs = Math.max(0, Math.floor(elapsedMs / 1000));
    bookmarks.push({
      time: elapsedSecs,
      note: 'Recording Resumed'
    });
    document.getElementById('resume-btn').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'inline-block';
    document.getElementById('status-title').textContent = 'Recording Screen';
    document.getElementById('status-desc').textContent = 'Recording is active. Do not close this tab.';
  }
}

function addBookmark() {
  const elapsedMs = (Date.now() - startTime) - totalPausedTime;
  const elapsedSecs = Math.max(0, Math.floor(elapsedMs / 1000));
  bookmarks.push({
    time: elapsedSecs,
    note: `Bookmark ${bookmarks.filter(b => b.note.startsWith('Bookmark')).length + 1}`
  });
}

// Listen for control actions
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'pause_recording') {
    pauseRecording();
  }
  if (message.action === 'resume_recording') {
    resumeRecording();
  }
  if (message.action === 'add_bookmark') {
    addBookmark();
  }
  if (message.action === 'stop_recording') {
    stopAndSaveRecording();
  }
});

function stopAndSaveRecording() {
  if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
    mediaRecorder.stop();
  }
}

function formatDuration(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
