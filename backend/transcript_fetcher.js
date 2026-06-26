/* ─── Robust YouTube Transcript Fetcher ───
   Directly calls YouTube InnerTube API with known-working client versions.
*/

const CLIENTS = [
  { name: 'ANDROID', version: '20.10.38' },
  { name: 'ANDROID', version: '19.45.36' },
  { name: 'ANDROID', version: '19.40.41' },
];

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

      // Prefer: exact lang + manual > exact lang > language prefix > first available
      const langPrefix = lang?.split('-')[0];
      let track =
        tracks.find(t => t.languageCode === lang && !t.kind) ||
        tracks.find(t => t.languageCode === lang) ||
        tracks.find(t => t.languageCode?.startsWith(langPrefix)) ||
        tracks[0];
      if (!track?.baseUrl) continue;

      // Fetch transcript XML from the track URL
      const trResp = await fetch(track.baseUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000),
      });
      if (!trResp.ok) continue;

      const xml = await trResp.text();
      // YouTube XML can use <text> or <p> tags with different attribute names
      const segments = [];
      let match;

      // Try <p> format first (newer): <p t="1360" d="1680">text</p>
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

      // Try <text> format (older): <text start="0.0" dur="5.0">text</text>
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

      if (segments.length === 0) continue;

      const fullText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
      console.log(`  Transcript via ${client.name}/${client.version}: ${segments.length} segments (${fullText.length} chars)`);
      return { fullText, segments };
    } catch (e) {
      console.log(`  ${client.name}/${client.version} failed: ${e.message?.substring(0, 60)}`);
    }
  }
  return null;
}

module.exports = { fetchTranscriptDirect };
