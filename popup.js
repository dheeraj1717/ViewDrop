document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const modeCards = document.querySelectorAll('.mode-card');
  const micToggle = document.getElementById('mic-toggle');
  const camToggle = document.getElementById('cam-toggle');
  const countdownSelect = document.getElementById('countdown-select');
  const startBtn = document.getElementById('start-btn');
  const openDashboardBtn = document.getElementById('open-dashboard-btn');
  const recentList = document.getElementById('recent-recordings-list');

  let selectedMode = 'screen-cam';

  // Load Saved Settings & Recent Recordings
  chrome.storage.local.get(['velo_mode', 'velo_mic', 'velo_cam', 'velo_countdown', 'recordings'], (data) => {
    // Mode
    if (data.velo_mode) {
      selectedMode = data.velo_mode;
      modeCards.forEach(c => {
        c.classList.toggle('active', c.dataset.mode === selectedMode);
      });
      adjustSettingsVisibility(selectedMode);
    }
    // Mic Toggle
    if (data.velo_mic !== undefined) {
      micToggle.checked = data.velo_mic;
    }
    // Cam Toggle
    if (data.velo_cam !== undefined) {
      camToggle.checked = data.velo_cam;
    }
    // Countdown
    if (data.velo_countdown !== undefined) {
      countdownSelect.value = data.velo_countdown;
    }
    // Recent Recordings
    renderRecent(data.recordings || []);
  });

  // Handle Mode Selection
  modeCards.forEach(card => {
    card.addEventListener('click', () => {
      modeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedMode = card.dataset.mode;
      chrome.storage.local.set({ velo_mode: selectedMode });
      adjustSettingsVisibility(selectedMode);
    });
  });

  function adjustSettingsVisibility(mode) {
    if (mode === 'screen') {
      camToggle.checked = false;
      camToggle.disabled = true;
      camToggle.closest('.setting-row').style.opacity = '0.5';
    } else if (mode === 'camera') {
      camToggle.checked = true;
      camToggle.disabled = false;
      camToggle.closest('.setting-row').style.opacity = '1';
    } else {
      camToggle.disabled = false;
      camToggle.closest('.setting-row').style.opacity = '1';
    }
  }

  // Handle Setting Toggles Changes
  micToggle.addEventListener('change', () => {
    chrome.storage.local.set({ velo_mic: micToggle.checked });
  });

  camToggle.addEventListener('change', () => {
    chrome.storage.local.set({ velo_cam: camToggle.checked });
  });

  countdownSelect.addEventListener('change', () => {
    chrome.storage.local.set({ velo_countdown: countdownSelect.value });
  });

  // Open Dashboard
  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });

  // Start Recording Action
  startBtn.addEventListener('click', () => {
    const options = {
      mode: selectedMode,
      micEnabled: micToggle.checked,
      camEnabled: camToggle.checked,
      countdown: parseInt(countdownSelect.value, 10)
    };

    chrome.runtime.sendMessage({ action: 'start_recording', options }, (response) => {
      // Close popup after starting the flow
      window.close();
    });
  });

  // Render recent recordings
  function renderRecent(recordings) {
    if (recordings.length === 0) {
      recentList.innerHTML = '<div class="empty-state">No recordings yet. Make your first video!</div>';
      return;
    }

    recentList.innerHTML = '';
    // Show top 3 recent recordings
    recordings.slice(-3).reverse().forEach(rec => {
      const item = document.createElement('div');
      item.className = 'recent-item';
      
      const info = document.createElement('div');
      info.className = 'recent-item-info';
      
      const title = document.createElement('span');
      title.className = 'recent-item-title';
      title.textContent = rec.title || 'Untitled Recording';
      
      const meta = document.createElement('span');
      meta.className = 'recent-item-meta';
      meta.textContent = `${rec.date} • ${rec.duration || '0:00'}`;

      info.appendChild(title);
      info.appendChild(meta);

      const playBtn = document.createElement('div');
      playBtn.className = 'recent-item-play';
      playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <polygon points="8,5 19,12 8,19" />
        </svg>
      `;
      playBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?id=${rec.id}`) });
      });

      item.appendChild(info);
      item.appendChild(playBtn);
      recentList.appendChild(item);
    });
  }
});
