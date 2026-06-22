// VeloRecord Content Script

(function() {
  // Prevent duplicate injections
  if (window.veloRecordLoaded) return;
  window.veloRecordLoaded = true;

  let toolbarEl = null;
  let camBubbleEl = null;
  let canvasEl = null;
  let canvasCtx = null;
  
  let cameraStream = null;
  
  let isRecording = false;
  let isPaused = false;
  let timerInterval = null;
  let secondsElapsed = 0;

  // Drawing state
  let isDrawingMode = false;
  let isDrawing = false;
  let drawColor = '#ff2e93'; // Default hot pink
  let lastX = 0;
  let lastY = 0;

  // Click spotlight state
  let spotlightEnabled = true;

  // Listen for messages from background worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'start_overlays') {
      initOverlays(message.options);
    }
    if (message.action === 'cleanup_overlays') {
      cleanup();
    }
    if (message.action === 'pause_toolbar_ui') {
      isPaused = true;
      const pauseBtn = document.getElementById('velo-btn-pause');
      if (pauseBtn) {
        pauseBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <polygon points="8,5 19,12 8,19"></polygon>
          </svg>
        `;
        pauseBtn.title = 'Resume Recording';
      }
    }
  });

  function initOverlays(options) {
    isRecording = true;
    if (options.startTime) {
      secondsElapsed = Math.floor((Date.now() - options.startTime) / 1000);
    } else {
      secondsElapsed = 0;
    }
    
    // 1. Create Transparent drawing canvas overlay
    createDrawingCanvas();

    // 2. Create Floating glassmorphism toolbar
    createToolbar(options);

    // 3. Create Draggable Webcam Bubble if enabled
    if (options.camEnabled) {
      createCameraBubble();
    }

    // 4. Start timer
    startTimer();

    // 5. Listen for clicks anywhere on the page to show a spotlight ripple
    document.addEventListener('click', handleGlobalClickForSpotlight, true);
  }

  // --- TIMER ---
  function startTimer() {
    clearInterval(timerInterval);
    const timerText = document.getElementById('velo-timer-text');
    timerInterval = setInterval(() => {
      if (!isPaused) {
        secondsElapsed++;
        const mins = Math.floor(secondsElapsed / 60);
        const secs = secondsElapsed % 60;
        if (timerText) {
          timerText.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
      }
    }, 1000);
  }

  // --- FLOATING TOOLBAR ---
  function createToolbar(options) {
    if (document.getElementById('velorecord-toolbar-container')) return;

    toolbarEl = document.createElement('div');
    toolbarEl.id = 'velorecord-toolbar-container';
    toolbarEl.className = 'velorecord-toolbar';

    toolbarEl.innerHTML = `
      <button class="velo-btn velo-btn-stop" id="velo-btn-stop" title="Stop and Save" style="width: 44px; height: 44px; border-radius: 16px; background: #ff4d4f;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <rect x="7" y="7" width="10" height="10" rx="2"></rect>
        </svg>
      </button>

      <div class="velo-timer" id="velo-timer-text" style="font-size: 14px; font-weight: 700; color: #60a5fa;">0:00</div>
      
      <button class="velo-btn" id="velo-btn-pause" title="Pause Recording" style="width: 36px; height: 36px; border-radius: 50%; background: transparent; border: 2px solid #52525b;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <rect x="7" y="6" width="3" height="12" rx="1.5"></rect>
          <rect x="14" y="6" width="3" height="12" rx="1.5"></rect>
        </svg>
      </button>

      <button class="velo-btn" id="velo-btn-bookmark" title="Bookmark current moment" style="margin-top: 4px;">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
          <line x1="4" y1="22" x2="4" y2="15"></line>
        </svg>
      </button>

      <button class="velo-btn" id="velo-btn-draw" title="Draw on Screen">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
      </button>

      <div class="velo-draw-options" id="velo-draw-options" style="display: none;">
        <div class="velo-color-dot velo-color-red active" data-color="#ff2e93"></div>
        <div class="velo-color-dot velo-color-yellow" data-color="#fbbf24"></div>
        <div class="velo-color-dot velo-color-blue" data-color="#00f2fe"></div>
        <div class="velo-color-dot velo-color-green" data-color="#10b981"></div>
        <button class="velo-btn" id="velo-btn-clear-draw" style="width: 24px; height: 24px; margin-top: 4px;" title="Clear Annotations">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(toolbarEl);

    // Event Listeners for Toolbar Actions
    const pauseBtn = document.getElementById('velo-btn-pause');
    const stopBtn = document.getElementById('velo-btn-stop');
    const drawBtn = document.getElementById('velo-btn-draw');
    const bookmarkBtn = document.getElementById('velo-btn-bookmark');
    const drawOptions = document.getElementById('velo-draw-options');
    const clearDrawBtn = document.getElementById('velo-btn-clear-draw');
    const statusDot = document.getElementById('velo-status-dot');

    pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        chrome.runtime.sendMessage({ action: 'pause_recording' });
        pauseBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <polygon points="8,5 19,12 8,19"></polygon>
          </svg>
        `;
        pauseBtn.title = 'Resume Recording';
      } else {
        chrome.runtime.sendMessage({ action: 'resume_recording' });
        pauseBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <rect x="7" y="6" width="3" height="12" rx="1.5"></rect>
            <rect x="14" y="6" width="3" height="12" rx="1.5"></rect>
          </svg>
        `;
        pauseBtn.title = 'Pause Recording';
      }
    });

    stopBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'stop_recording' });
    });

    // Toggle screen draw
    drawBtn.addEventListener('click', () => {
      isDrawingMode = !isDrawingMode;
      drawBtn.classList.toggle('active', isDrawingMode);
      drawOptions.style.display = isDrawingMode ? 'flex' : 'none';
      
      if (isDrawingMode) {
        canvasEl.style.pointerEvents = 'auto'; // Block underlying page interaction to draw
      } else {
        canvasEl.style.pointerEvents = 'none'; // Pass clicks through
      }
    });

    // Draw Colors
    const colorDots = document.querySelectorAll('.velo-color-dot');
    colorDots.forEach(dot => {
      dot.addEventListener('click', () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        drawColor = dot.dataset.color;
      });
    });

    // Clear Screen Draw
    clearDrawBtn.addEventListener('click', () => {
      if (canvasCtx && canvasEl) {
        canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      }
    });

    // Add Bookmark Click Listener
    bookmarkBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'add_bookmark',
        timestampSecs: secondsElapsed
      });
      showBookmarkToast(secondsElapsed);
    });
  }

  // --- DRAGGABLE CAMERA BUBBLE ---
  async function createCameraBubble() {
    if (document.getElementById('velorecord-cam-container')) return;

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 300, height: 300, facingMode: 'user' },
        audio: false // Audio already captured in recorder tab to prevent duplicate echo
      });

      camBubbleEl = document.createElement('div');
      camBubbleEl.id = 'velorecord-cam-container';
      camBubbleEl.className = 'velorecord-cam-bubble';

      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = cameraStream;

      camBubbleEl.appendChild(video);
      document.body.appendChild(camBubbleEl);

      // Make camera bubble draggable
      setupDraggable(camBubbleEl);

    } catch (e) {
      console.warn('Could not initialize page webcam overlay:', e);
    }
  }

  function setupDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    element.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      // get the mouse cursor position at startup:
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      // call a function whenever the cursor moves:
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      // calculate the new cursor position:
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      // set the element's new position:
      const newTop = element.offsetTop - pos2;
      const newLeft = element.offsetLeft - pos1;

      // Keep inside viewport boundary bounds
      const maxLeft = window.innerWidth - element.offsetWidth - 20;
      const maxTop = window.innerHeight - element.offsetHeight - 20;

      element.style.top = Math.max(20, Math.min(newTop, maxTop)) + 'px';
      element.style.left = Math.max(20, Math.min(newLeft, maxLeft)) + 'px';
      
      // Clear bottom constraint to use top layout
      element.style.bottom = 'auto';
    }

    function closeDragElement() {
      // stop moving when mouse button is released:
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  // --- DRAWING CANVAS ---
  function createDrawingCanvas() {
    if (document.getElementById('velorecord-drawing-canvas-el')) return;

    canvasEl = document.createElement('canvas');
    canvasEl.id = 'velorecord-drawing-canvas-el';
    canvasEl.className = 'velorecord-drawing-canvas';

    // Set canvas dimensions
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;

    canvasCtx = canvasEl.getContext('2d');
    
    // Draw event listeners
    canvasEl.addEventListener('mousedown', startDrawing);
    canvasEl.addEventListener('mousemove', draw);
    canvasEl.addEventListener('mouseup', stopDrawing);
    canvasEl.addEventListener('mouseout', stopDrawing);

    // Adjust canvas on resize
    window.addEventListener('resize', () => {
      if (canvasEl && canvasCtx) {
        // Save current canvas content
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasEl.width;
        tempCanvas.height = canvasEl.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(canvasEl, 0, 0);

        canvasEl.width = window.innerWidth;
        canvasEl.height = window.innerHeight;

        // Restore content
        canvasCtx.drawImage(tempCanvas, 0, 0);
      }
    });

    document.body.appendChild(canvasEl);
  }

  function startDrawing(e) {
    if (!isDrawingMode) return;
    isDrawing = true;
    [lastX, lastY] = [e.clientX, e.clientY];
  }

  function draw(e) {
    if (!isDrawing || !isDrawingMode) return;
    
    canvasCtx.beginPath();
    canvasCtx.moveTo(lastX, lastY);
    canvasCtx.lineTo(e.clientX, e.clientY);
    canvasCtx.strokeStyle = drawColor;
    canvasCtx.lineWidth = 5;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.stroke();
    
    [lastX, lastY] = [e.clientX, e.clientY];
  }

  function stopDrawing() {
    isDrawing = false;
  }

  // --- CLICK SPOTLIGHT ---
  // Shows a brief animated ripple wherever the viewer clicks while recording,
  // so playback audiences can visually track where attention/clicks happened.
  // Skipped during drawing-mode clicks and clicks on our own toolbar/overlays.
  function handleGlobalClickForSpotlight(e) {
    if (!isRecording || !spotlightEnabled || isDrawingMode) return;
    if (e.target.closest && e.target.closest(
      '.velorecord-toolbar, .velorecord-cam-bubble, .velo-toast, .velorecord-drawing-canvas'
    )) {
      return;
    }
    spawnClickSpotlight(e.clientX, e.clientY);
  }

  function spawnClickSpotlight(x, y) {
    const spotlight = document.createElement('div');
    spotlight.className = 'velorecord-click-spotlight';
    spotlight.style.left = `${x}px`;
    spotlight.style.top = `${y}px`;
    document.body.appendChild(spotlight);

    spotlight.addEventListener('animationend', () => {
      if (spotlight.parentNode) spotlight.parentNode.removeChild(spotlight);
    });
  }

  function showBookmarkToast(secs) {
    const existingToast = document.getElementById('velo-bookmark-toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'velo-bookmark-toast';
    toast.className = 'velo-toast';

    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    const timeStr = `${mins}:${s.toString().padStart(2, '0')}`;

    toast.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; color: #6366f1;">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
        <line x1="4" y1="22" x2="4" y2="15"></line>
      </svg>
      Bookmark added at ${timeStr}
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 2000);
  }

  // --- CLEANUP ---
  function cleanup() {
    isRecording = false;
    clearInterval(timerInterval);
    document.removeEventListener('click', handleGlobalClickForSpotlight, true);

    if (toolbarEl && toolbarEl.parentNode) {
      toolbarEl.parentNode.removeChild(toolbarEl);
    }
    if (camBubbleEl && camBubbleEl.parentNode) {
      camBubbleEl.parentNode.removeChild(camBubbleEl);
    }
    if (canvasEl && canvasEl.parentNode) {
      canvasEl.parentNode.removeChild(canvasEl);
    }

    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    toolbarEl = null;
    camBubbleEl = null;
    canvasEl = null;
    canvasCtx = null;
    cameraStream = null;
  }
})();
