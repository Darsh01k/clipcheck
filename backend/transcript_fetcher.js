/* ─── Robust YouTube Transcript Fetcher ───
   Tries multiple strategies in order:
   1. Direct YouTube InnerTube API
   2. ytdl-core video info + caption track fetch
*/

const CLIENTS = [
  { name: 'ANDROID', version: '20.10.38' },
  { name: 'ANDROID', version: '19.45.36' },
  { name: 'ANDROID', version: '19.40.41' },
];

// Helper to parse YouTube transcript XML (handles both <p> and <text> tags)
function parseTranscriptXml(xml) {
  const segments = [];
  let match;

  // Try <p> format: <p t="1360" d="1680">text</p>
  const pRegex = /<p\s+t="([\d.]+)"\s+d="([\d.]+)"[^>]*>(.*?)<\/p>/g;
  while ((match = pRegex.exec(xml)) !== null) {
    segments.push({
      text: match[3]
        .replace(/&amp;/g, '&').replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, '').trim(),
      offset: Math.round(parseFloat(match[1])),
      duration: Math.round(parseFloat(match[2])),
    });
  }

  // Try <text> format: <text start="0.0" dur="5.0">text</text>
  if (segments.length === 0) {
    const textRegex = /<text start="([\d.]+)" dur="([\d.]+)">(.*?)<\/text>/g;
    while ((match = textRegex.exec(xml)) !== null) {
      segments.push({
        text: match[3]
          .replace(/&amp;/g, '&').replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/<[^>]+>/g, '').trim(),
        offset: Math.round(parseFloat(match[1]) * 1000),
        duration: Math.round(parseFloat(match[2]) * 1000),
      });
    }
  }

  if (segments.length === 0) return null;
  return {
    fullText: segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim(),
    segments,
  };
}

// Strategy 1: Direct YouTube InnerTube API
async function fetchTranscriptDirect(videoId, lang = 'en') {
  for (const client of CLIENTS) {
    try {
      const body = {
        context: {
          client: { clientName: client.name, clientVersion: client.version, hl: lang },
        },
        videoId,
      };

      const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `com.google.android.youtube/${client.version} (Linux; U; Android 14)`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;

      const data = await resp.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!tracks?.length) continue;

      const langPrefix = lang?.split('-')[0];
      let track =
        tracks.find(t => t.languageCode === lang && !t.kind) ||
        tracks.find(t => t.languageCode === lang) ||
        tracks.find(t => t.languageCode?.startsWith(langPrefix)) ||
        tracks[0];
      if (!track?.baseUrl) continue;

      const trResp = await fetch(track.baseUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000),
      });
      if (!trResp.ok) continue;

      const xml = await trResp.text();
      const result = parseTranscriptXml(xml);
      if (!result) continue;

      console.log(`  Transcript via InnerTube API: ${result.segments.length} segments (${result.fullText.length} chars)`);
      return result;
    } catch (e) {
      console.log(`  InnerTube ${client.name}/${client.version} failed: ${e.message?.substring(0, 60)}`);
    }
  }
  return null;
}

// Strategy 2: ytdl-core video info + caption track fetch
async function fetchTranscriptWithYtdl(videoId, lang = 'en') {
  try {
    const ytdl = require('@distube/ytdl-core');
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    const tracks = info.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) return null;

    const langPrefix = lang?.split('-')[0];
    let track =
      tracks.find(t => t.languageCode === lang && !t.kind) ||
      tracks.find(t => t.languageCode === lang) ||
      tracks.find(t => t.languageCode?.startsWith(langPrefix)) ||
      tracks[0];
    if (!track?.baseUrl) return null;

    const trResp = await fetch(track.baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    });
    if (!trResp.ok) return null;

    const xml = await trResp.text();
    const result = parseTranscriptXml(xml);
    if (!result) return null;

    console.log(`  Transcript via ytdl-core: ${result.segments.length} segments (${result.fullText.length} chars)`);
    return result;
  } catch (e) {
    console.log(`  ytdl-core failed: ${e.message?.substring(0, 60)}`);
    return null;
  }
}

// Combined: tries all strategies
async function fetchTranscriptAll(videoId, lang = 'en') {
  let result = await fetchTranscriptDirect(videoId, lang);
  if (result) return result;

  result = await fetchTranscriptWithYtdl(videoId, lang);
  if (result) return result;

  return null;
}

module.exports = { fetchTranscriptDirect, fetchTranscriptWithYtdl, fetchTranscriptAll };
