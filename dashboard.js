// VeloRecord Studio Controller

const DB_NAME = 'VeloRecordDB';
const STORE_NAME = 'videos';
let currentRecordingId = null;
let currentRecordingBlob = null;
let currentRecordingMetadata = null;
let videoPlayer = null;

// Trimmer values
let duration = 0;
let trimStartVal = 0;
let trimEndVal = 0;
let isDragging = false;
let activeDragHandle = null; // 'start' or 'end'

// Transcript state
let transcriptData = [];

document.addEventListener('DOMContentLoaded', () => {
  videoPlayer = document.getElementById('main-video-player');
  videoPlayer.addEventListener('timeupdate', highlightActiveTranscriptLine);

  // Parse ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  currentRecordingId = urlParams.get('id');

  // Load Library and Current Video
  loadDashboard();

  // Wire Events
  document.getElementById('save-title-btn').addEventListener('click', saveTitle);
  document.getElementById('download-btn').addEventListener('click', downloadVideo);
  document.getElementById('delete-btn').addEventListener('click', deleteVideo);
  document.getElementById('apply-trim-btn').addEventListener('click', applyTrim);

  // Setup Timeline dragging
  setupTimelineEvents();

  // Tabs & Transcript search
  const summaryBtn = document.getElementById('tab-summary-btn');
  if (summaryBtn) summaryBtn.addEventListener('click', () => switchTab('summary'));
  
  const transcriptBtn = document.getElementById('tab-transcript-btn');
  if (transcriptBtn) transcriptBtn.addEventListener('click', () => switchTab('transcript'));
  
  document.getElementById('transcript-search').addEventListener('input', handleTranscriptSearch);
});

// Load DB Video
function getRecordingFromDB(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.onerror);
    };
    request.onerror = () => reject(request.error);
  });
}

function saveVideoToIndexedDB(id, blob) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

function deleteVideoFromIndexedDB(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

function loadDashboard() {
  chrome.storage.local.get(['recordings'], async (data) => {
    const recordings = data.recordings || [];
    renderLibrary(recordings);

    if (recordings.length === 0) {
      document.getElementById('video-title-input').value = 'No Recordings Found';
      return;
    }

    // Default to last recording if no ID specified
    if (!currentRecordingId && recordings.length > 0) {
      currentRecordingId = recordings[recordings.length - 1].id;
    }

    currentRecordingMetadata = recordings.find(r => r.id === currentRecordingId);

    if (currentRecordingMetadata) {
      document.getElementById('video-title-input').value = currentRecordingMetadata.title;
      highlightActiveLibraryItem(currentRecordingId);
      renderTranscript(currentRecordingMetadata.transcript || []);

      // Only load the video file if it hasn't been loaded yet or if we're changing videos
      if (!videoPlayer.src || videoPlayer.dataset.loadedId !== currentRecordingId) {
        videoPlayer.dataset.loadedId = currentRecordingId;
        try {
          currentRecordingBlob = await getRecordingFromDB(currentRecordingId);
          if (currentRecordingBlob) {
            const videoURL = URL.createObjectURL(currentRecordingBlob);
            videoPlayer.src = videoURL;

            const initTrimmer = () => {
              let dur = videoPlayer.duration;
              if (!dur || dur === Infinity || isNaN(dur)) {
                if (currentRecordingMetadata && currentRecordingMetadata.durationSecs) {
                  dur = currentRecordingMetadata.durationSecs;
                }
              }
              if (dur && dur !== Infinity && !isNaN(dur)) {
                duration = dur;
                trimStartVal = 0;
                trimEndVal = duration;
                setupTrimmer();
              } else {
                setTimeout(initTrimmer, 100);
              }
            };

            videoPlayer.onloadedmetadata = initTrimmer;
            videoPlayer.ondurationchange = initTrimmer;
            initTrimmer();
          } else {
            console.warn('Recording blob not found in DB:', currentRecordingId);
          }
        } catch (err) {
          console.error('Failed to load video file:', err);
        }
      }
    }
  });
}

// Render Library List
function renderLibrary(recordings) {
  const libraryList = document.getElementById('library-list');
  libraryList.innerHTML = '';

  recordings.forEach(rec => {
    const item = document.createElement('div');
    item.className = 'library-item';
    item.dataset.id = rec.id;
    
    const title = document.createElement('div');
    title.className = 'library-item-title';
    title.textContent = rec.title;

    const meta = document.createElement('div');
    meta.className = 'library-item-meta';
    
    const date = document.createElement('span');
    date.textContent = rec.date;

    const dur = document.createElement('span');
    dur.textContent = rec.duration;

    meta.appendChild(date);
    meta.appendChild(dur);
    item.appendChild(title);
    item.appendChild(meta);

    item.addEventListener('click', () => {
      window.location.href = `dashboard.html?id=${rec.id}`;
    });

    libraryList.appendChild(item);
  });
}

function highlightActiveLibraryItem(id) {
  document.querySelectorAll('.library-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === id);
  });
}

// Title Rename
function saveTitle() {
  const newTitle = document.getElementById('video-title-input').value.trim();
  if (!newTitle || !currentRecordingId) return;

  const saveBtn = document.getElementById('save-title-btn');
  const originalBtnText = saveBtn.textContent;

  chrome.storage.local.get(['recordings'], (data) => {
    const recordings = data.recordings || [];
    const index = recordings.findIndex(r => r.id === currentRecordingId);
    if (index !== -1) {
      recordings[index].title = newTitle;
      chrome.storage.local.set({ recordings }, () => {
        saveBtn.textContent = 'Saved!';
        saveBtn.style.background = 'var(--success-color)';
        saveBtn.style.borderColor = 'var(--success-color)';
        saveBtn.style.color = 'white';

        setTimeout(() => {
          saveBtn.textContent = originalBtnText;
          saveBtn.style.background = '';
          saveBtn.style.borderColor = '';
          saveBtn.style.color = '';
        }, 1500);

        loadDashboard();
      });
    }
  });
}

// Download
function downloadVideo() {
  if (!currentRecordingBlob || !currentRecordingMetadata) return;

  const url = URL.createObjectURL(currentRecordingBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentRecordingMetadata.title || 'recording'}.webm`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Delete
function deleteVideo() {
  if (!currentRecordingId) return;
  if (!confirm('Are you sure you want to delete this recording?')) return;

  chrome.storage.local.get(['recordings'], async (data) => {
    let recordings = data.recordings || [];
    recordings = recordings.filter(r => r.id !== currentRecordingId);

    // Delete from DB & Storage
    await deleteVideoFromIndexedDB(currentRecordingId);
    chrome.storage.local.set({ recordings }, () => {
      // Go to latest recording
      window.location.href = 'dashboard.html';
    });
  });
}



// --- DRAG TIMELINE SYSTEM ---
function setupTrimmer() {
  renderTicks();
  updateTimelineUI();

  // Playback cursor updates with smooth 60fps loop
  function updatePlayhead() {
    if (!videoPlayer.paused && !isDragging) {
      const playhead = document.getElementById('playback-head');
      const percent = (videoPlayer.currentTime / duration) * 100;
      if (playhead) {
        playhead.style.left = `${percent}%`;
      }

      // Loop selection cleanly during edit preview
      if (videoPlayer.currentTime >= trimEndVal) {
        videoPlayer.currentTime = trimStartVal;
      }
      if (videoPlayer.currentTime < trimStartVal) {
        videoPlayer.currentTime = trimStartVal;
      }
    }
    requestAnimationFrame(updatePlayhead);
  }

  // Update playhead immediately on pause/seek/timeupdate so it stays responsive
  videoPlayer.addEventListener('seeked', () => {
    const playhead = document.getElementById('playback-head');
    const percent = (videoPlayer.currentTime / duration) * 100;
    if (playhead) playhead.style.left = `${percent}%`;
  });
  
  videoPlayer.addEventListener('timeupdate', () => {
    if (videoPlayer.paused) {
      const playhead = document.getElementById('playback-head');
      const percent = (videoPlayer.currentTime / duration) * 100;
      if (playhead) playhead.style.left = `${percent}%`;
    }
  });

  requestAnimationFrame(updatePlayhead);
}

function renderTicks() {
  const ticksContainer = document.getElementById('timeline-ticks');
  ticksContainer.innerHTML = '';
  
  const tickCount = 20; // Number of subdivisions
  for (let i = 0; i <= tickCount; i++) {
    const tick = document.createElement('div');
    tick.className = 'timeline-tick-mark';
    if (i % 5 === 0) {
      tick.classList.add('major');
    }
    const percent = (i / tickCount) * 100;
    tick.style.left = `${percent}%`;
    ticksContainer.appendChild(tick);
  }
}

function setupTimelineEvents() {
  const timeline = document.getElementById('trim-timeline');
  const handleStart = document.getElementById('handle-start');
  const handleEnd = document.getElementById('handle-end');

  handleStart.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    isDragging = true;
    activeDragHandle = 'start';
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  });

  handleEnd.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    isDragging = true;
    activeDragHandle = 'end';
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  });

  // Clicking on timeline jumps playhead
  timeline.addEventListener('mousedown', (e) => {
    if (isDragging) return;
    const rect = timeline.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const seekTime = Math.max(0, Math.min(duration, percent * duration));
    videoPlayer.currentTime = seekTime;
  });
}

let lastSeekTime = 0;
function throttleSeek(time) {
  const now = Date.now();
  if (now - lastSeekTime > 150) { // Limit seeks to once per 150ms
    videoPlayer.currentTime = time;
    lastSeekTime = now;
  }
}

function handleDragMove(e) {
  if (!isDragging) return;
  const timeline = document.getElementById('trim-timeline');
  const rect = timeline.getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  const timeVal = Math.max(0, Math.min(duration, percent * duration));

  if (activeDragHandle === 'start') {
    if (timeVal >= trimEndVal - 0.2) {
      trimStartVal = trimEndVal - 0.2;
    } else {
      trimStartVal = timeVal;
    }
    throttleSeek(trimStartVal);
  } else if (activeDragHandle === 'end') {
    if (timeVal <= trimStartVal + 0.2) {
      trimEndVal = trimStartVal + 0.2;
    } else {
      trimEndVal = timeVal;
    }
    throttleSeek(trimEndVal);
  }

  updateTimelineUI();
}

function handleDragEnd() {
  isDragging = false;
  // Ensure precise final seek when drag stops
  if (activeDragHandle === 'start') {
    videoPlayer.currentTime = trimStartVal;
  } else if (activeDragHandle === 'end') {
    videoPlayer.currentTime = trimEndVal;
  }
  activeDragHandle = null;
  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', handleDragEnd);
}

function updateTimelineUI() {
  const selection = document.getElementById('timeline-selection');
  const handleStart = document.getElementById('handle-start');
  const handleEnd = document.getElementById('handle-end');
  const startLabel = document.getElementById('trim-start-label');
  const endLabel = document.getElementById('trim-end-label');

  const startPercent = (trimStartVal / duration) * 100;
  const endPercent = (trimEndVal / duration) * 100;

  handleStart.style.left = `${startPercent}%`;
  handleEnd.style.left = `${endPercent}%`;

  selection.style.left = `${startPercent}%`;
  selection.style.width = `${endPercent - startPercent}%`;

  startLabel.textContent = formatTime(trimStartVal);
  endLabel.textContent = formatTime(trimEndVal);
}

// --- HIGH-FIDELITY STREAM CAPTURE TRIMMER ---
async function applyTrim() {
  const statusDiv = document.getElementById('trim-status');

  if (trimStartVal <= 0.1 && trimEndVal >= duration - 0.1) {
    statusDiv.textContent = 'No edits needed (Full range selected).';
    return;
  }

  statusDiv.innerHTML = '<span style="color: var(--secondary-color);">Processing edit... Please do not close.</span>';
  
  // Disable button
  const trimBtn = document.getElementById('apply-trim-btn');
  trimBtn.disabled = true;

  try {
    let trimmedBlob = await trimVideoCaptureStream(videoPlayer, trimStartVal, trimEndVal, (progress) => {
      statusDiv.innerHTML = `<span style="color: var(--primary-color);">Trimming: ${Math.round(progress)}%</span>`;
    });

    // Fix WebM seek duration headers for the newly trimmed blob
    const trimDurationMs = (trimEndVal - trimStartVal) * 1000;
    try {
      if (window.fixWebmDuration) {
        trimmedBlob = await window.fixWebmDuration(trimmedBlob, trimDurationMs);
      }
    } catch (err) {
      console.warn('Failed to fix WebM seek duration headers for trimmed video:', err);
    }

    // Save trimmed blob back
    await saveVideoToIndexedDB(currentRecordingId, trimmedBlob);

    // Update metadata duration & size
    const durationStr = formatDurationString(trimDurationMs);

    chrome.storage.local.get(['recordings'], (data) => {
      const recordings = data.recordings || [];
      const index = recordings.findIndex(r => r.id === currentRecordingId);
      if (index !== -1) {
        recordings[index].duration = durationStr;
        recordings[index].durationSecs = trimDurationMs / 1000;
        recordings[index].size = trimmedBlob.size;
        chrome.storage.local.set({ recordings }, () => {
          statusDiv.innerHTML = '<span style="color: var(--success-color);">Trim applied successfully!</span>';
          trimBtn.disabled = false;
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        });
      }
    });

  } catch (err) {
    console.error('Trim operation failed:', err);
    statusDiv.innerHTML = '<span style="color: #ef4444;">Trim failed. Try again.</span>';
    trimBtn.disabled = false;
  }
}


// High-fidelity captureStream based trimmer
function trimVideoCaptureStream(videoEl, start, end, onProgress) {
  return new Promise((resolve, reject) => {
    const originalMuted = videoEl.muted;
    videoEl.pause();
    
    // Mute playback during trimming process to prevent screeching sound
    videoEl.muted = true;
    videoEl.currentTime = start;

    videoEl.onseeked = () => {
      videoEl.onseeked = null;

      // Capture native stream directly from HTMLVideoElement
      let stream;
      try {
        stream = videoEl.captureStream ? videoEl.captureStream() : videoEl.mozCaptureStream();
      } catch (err) {
        videoEl.muted = originalMuted;
        return reject(new Error('Failed to capture stream: ' + err.message));
      }

      const options = { mimeType: 'video/webm;codecs=vp9,opus' };
      let recorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch (e) {
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      }

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        videoEl.muted = originalMuted;
        videoEl.currentTime = start; // Reset playhead
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(blob);
      };

      // Start recording and play target range
      recorder.start();
      videoEl.play();

      const totalTrimDuration = end - start;

      const progressInterval = setInterval(() => {
        if (videoEl.currentTime >= end || videoEl.paused || videoEl.ended) {
          clearInterval(progressInterval);
          videoEl.pause();
          recorder.stop();
        } else {
          const currentElapsed = videoEl.currentTime - start;
          const pct = Math.min((currentElapsed / totalTrimDuration) * 100, 100);
          onProgress(pct);
        }
      }, 50);
    };
  });
}

// --- TRANSCRIPT TAB ---
function switchTab(tab) {
  document.getElementById('tab-summary-btn').classList.toggle('active', tab === 'summary');
  document.getElementById('tab-transcript-btn').classList.toggle('active', tab === 'transcript');
  document.getElementById('tab-summary-content').style.display = tab === 'summary' ? 'flex' : 'none';
  document.getElementById('tab-transcript-content').style.display = tab === 'transcript' ? 'flex' : 'none';
}

function renderTranscript(entries) {
  transcriptData = entries || [];
  // Reset any previous search when a new recording loads
  const searchInput = document.getElementById('transcript-search');
  if (searchInput) searchInput.value = '';
  document.getElementById('transcript-match-count').textContent = '';
  drawTranscriptLines(transcriptData, '');
}

function drawTranscriptLines(entries, query) {
  const container = document.getElementById('transcript-lines');
  container.innerHTML = '';

  if (!transcriptData.length) {
    container.innerHTML = '<div class="transcript-empty">No transcript available for this recording. Transcription requires the microphone to be enabled while recording.</div>';
    return;
  }

  if (entries.length === 0) {
    container.innerHTML = '<div class="transcript-empty">No matches found.</div>';
    return;
  }

  entries.forEach(entry => {
    const line = document.createElement('div');
    line.className = 'transcript-line';
    line.dataset.time = entry.time;

    const ts = document.createElement('span');
    ts.className = 'timestamp';
    ts.textContent = formatTime(entry.time);

    const textSpan = document.createElement('span');
    textSpan.className = 'transcript-text';
    textSpan.innerHTML = highlightMatch(entry.text, query);

    line.appendChild(ts);
    line.appendChild(textSpan);

    // Click any line to jump the video to that moment
    line.addEventListener('click', () => {
      videoPlayer.currentTime = entry.time;
    });

    container.appendChild(line);
  });
}

// Search box: filters lines containing the query, highlights matched text,
// and jumps the video playhead to the first match (jump-to-word).
function handleTranscriptSearch(e) {
  const query = e.target.value.trim();
  const countEl = document.getElementById('transcript-match-count');

  if (!query) {
    countEl.textContent = '';
    drawTranscriptLines(transcriptData, '');
    return;
  }

  const lowerQuery = query.toLowerCase();
  const matches = transcriptData.filter(entry => entry.text.toLowerCase().includes(lowerQuery));

  countEl.textContent = matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : '0 matches';
  drawTranscriptLines(matches, query);

  if (matches.length > 0) {
    videoPlayer.currentTime = matches[0].time;
  }
}

function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${safeQuery})`, 'ig');
  return escaped.replace(re, '<mark class="transcript-mark">$1</mark>');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Highlights whichever transcript line corresponds to current playback time
function highlightActiveTranscriptLine() {
  if (!transcriptData.length) return;
  const current = videoPlayer.currentTime;
  const lines = document.querySelectorAll('.transcript-line');
  lines.forEach(line => {
    const t = parseFloat(line.dataset.time);
    line.classList.toggle('active', current >= t && current < t + 6);
  });
}

// Helpers
function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDurationString(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
