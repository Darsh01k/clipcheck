/* ─── ClipCheck Browser Extension — Content Script ───
   Detects YouTube transcript data on the page and sends it to the popup.
*/

(function() {
  let transcriptData = null;

  function extractYouTubeTranscript() {
    const segments = [];

    try {
      const captionWindows = document.querySelectorAll('.ytd-transcript-segment-renderer');
      if (captionWindows.length > 0) {
        captionWindows.forEach(seg => {
          const textEl = seg.querySelector('.segment-text');
          const timeEl = seg.querySelector('.segment-timestamp');
          if (textEl) {
            const text = textEl.textContent.trim();
            const timeText = timeEl ? timeEl.textContent.trim() : '';
            const timeParts = timeText.split(':');
            let offset = 0;
            if (timeParts.length === 2) {
              offset = parseInt(timeParts[0]) * 60 + parseFloat(timeParts[1]);
            } else if (timeParts.length === 3) {
              offset = parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseFloat(timeParts[2]);
            }
            if (text) {
              segments.push({ text, offset, duration: 5 });
            }
          }
        });
      }

      if (segments.length === 0) {
        const scriptTags = document.querySelectorAll('script');
        for (const script of scriptTags) {
          const content = script.textContent || '';
          if (content.includes('playerCaptionsTracklistRenderer') || content.includes('captionTracks')) {
            try {
              const match = content.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"/
              );
              if (match) {
                const tracks = JSON.parse(match[1]);
                if (tracks && tracks.length > 0) {
                  const track = tracks.find(t => t.languageCode === 'en' && !t.kind) ||
                               tracks.find(t => t.languageCode === 'en') ||
                               tracks[0];
                  if (track && track.baseUrl) {
                    return { rawData: true, trackUrl: track.baseUrl, languageCode: track.languageCode };
                  }
                }
              }
            } catch (e) {}
            break;
          }
        }
      }
    } catch (e) {
      console.error('ClipCheck: Error extracting transcript:', e);
    }

    return segments.length > 0 ? { segments } : null;
  }

  function extractVideoInfo() {
    const url = window.location.href;
    const title = document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() ||
                  document.title.replace(' - YouTube', '').trim() ||
                  'YouTube Video';

    return { url, title };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getTranscript') {
      transcriptData = extractYouTubeTranscript();
      const videoInfo = extractVideoInfo();

      if (transcriptData) {
        sendResponse({ success: true, transcriptData, videoInfo });
      } else {
        sendResponse({ success: false, error: 'Could not extract transcript from YouTube page. Make sure the video has captions enabled.' });
      }
    }
    return true;
  });
})();
