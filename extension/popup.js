const API_BASE = 'https://clipcheck.onrender.com';
const API_AUTH_KEY = ''; // Set this to your API_AUTH_KEY from the server .env for authenticated access

const defaultEl = document.getElementById('status-default');
const loadingEl = document.getElementById('status-loading');
const successEl = document.getElementById('status-success');
const errorEl = document.getElementById('status-error');
const resultEl = document.getElementById('status-result');
const loadingDetail = document.getElementById('loading-detail');
const successDetail = document.getElementById('success-detail');
const errorText = document.getElementById('error-text');
const errorDetail = document.getElementById('error-detail');
const resultDetail = document.getElementById('result-detail');
const reportLink = document.getElementById('report-link');
const progressFill = document.getElementById('progress-fill');

function showSection(section) {
  [defaultEl, loadingEl, successEl, errorEl, resultEl].forEach(el => {
    el.style.display = 'none';
  });
  if (section) section.style.display = 'block';
}

function updateProgress(pct) {
  if (progressFill) {
    progressFill.style.width = pct + '%';
  }
}

document.getElementById('analyze-btn').addEventListener('click', async () => {
  showSection(loadingEl);
  loadingDetail.textContent = 'Requesting transcript from YouTube page...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('youtube.com/watch')) {
      showSection(errorEl);
      errorText.textContent = 'Not a YouTube video';
      errorDetail.textContent = 'Please navigate to a YouTube video page first.';
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getTranscript' });

    if (!response || !response.success) {
      showSection(errorEl);
      errorText.textContent = 'Transcript extraction failed';
      errorDetail.textContent = response?.error || 'Could not extract transcript from this page.';
      return;
    }

    loadingDetail.textContent = 'Processing transcript...';

    const transcriptData = response.transcriptData;
    const videoInfo = response.videoInfo;

    let transcriptText = '';

    if (transcriptData.segments && transcriptData.segments.length > 0) {
      transcriptText = transcriptData.segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    } else if (transcriptData.rawData && transcriptData.trackUrl) {
      loadingDetail.textContent = 'Downloading caption track...';
      try {
        const captionResp = await fetch(transcriptData.trackUrl);
        if (captionResp.ok) {
          const xml = await captionResp.text();
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xml, 'text/xml');
          const textElements = xmlDoc.querySelectorAll('text, p');
          const segments = [];
          textElements.forEach(el => {
            const text = el.textContent.trim();
            const start = parseFloat(el.getAttribute('start') || el.getAttribute('t') || 0);
            const dur = parseFloat(el.getAttribute('dur') || el.getAttribute('d') || 5);
            if (text) {
              segments.push({ text, offset: Math.round(start * 1000), duration: Math.round(dur * 1000) });
            }
          });
          transcriptText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
        }
      } catch (e) {
        showSection(errorEl);
        errorText.textContent = 'Failed to download captions';
        errorDetail.textContent = e.message;
        return;
      }
    }

    if (!transcriptText || transcriptText.length < 20) {
      showSection(errorEl);
      errorText.textContent = 'Empty transcript';
      errorDetail.textContent = 'The transcript extracted from this video is too short. The video may not have captions.';
      return;
    }

    showSection(successEl);
    successDetail.textContent = `Extracted ${transcriptText.length} characters. Sending to ClipCheck...`;
    updateProgress(50);

    const sessionId = 'ext_' + crypto.randomUUID();

    const headers = { 'Content-Type': 'application/json' };
    if (API_AUTH_KEY) headers['Authorization'] = `Bearer ${API_AUTH_KEY}`;

    const apiResponse = await fetch(`${API_BASE}/api/extension/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: videoInfo.url,
        transcript: transcriptText,
        title: videoInfo.title,
        user_id: sessionId,
        language: 'en'
      })
    });

    if (!apiResponse.ok) {
      const errData = await apiResponse.json().catch(() => ({}));
      showSection(errorEl);
      errorText.textContent = 'API Error';
      errorDetail.textContent = errData.detail || 'Failed to send transcript to ClipCheck API.';
      return;
    }

    const result = await apiResponse.json();
    updateProgress(100);

    showSection(resultEl);
    resultDetail.textContent = `Report ID: ${result.report_id.substring(0, 8)}...`;
    reportLink.href = `https://clipcheck.app/report/${result.report_id}`;

  } catch (e) {
    showSection(errorEl);
    errorText.textContent = 'Error';
    errorDetail.textContent = e.message || 'An unexpected error occurred.';
  }
});

document.getElementById('retry-btn').addEventListener('click', () => {
  showSection(defaultEl);
});
