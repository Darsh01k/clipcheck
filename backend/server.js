/* ──────────────────────────────────────────────
   ClipCheck — Backend Server v3
   – Timestamped claims
   – Batch parallel verification (3 at a time)
   – Stores video_id + segments for sync
   ────────────────────────────────────────────── */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 8000;

// ─── AI Provider Configuration (with fallback) ───
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const AI_PROVIDERS = [
    {
        name: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: OPENROUTER_API_KEY,
        models: [
            process.env.AI_MODEL,
            'openrouter/free',
            'meta-llama/llama-3.3-70b-instruct:free',
            'google/gemma-4-31b-it:free',
        ].filter(Boolean),
        getHeaders(key) {
            return {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://clipcheck.app',
                'X-Title': 'ClipCheck',
            };
        },
    },
    {
        name: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: GROQ_API_KEY,
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
        getHeaders(key) {
            return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
        },
    },
    {
        name: 'nvidia',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        apiKey: NVIDIA_API_KEY,
        models: ['meta/llama-3.3-70b-instruct', 'google/gemma-2-27b-it', 'mistralai/mixtral-8x22b-instruct-v0.1'],
        getHeaders(key) {
            return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
        },
    },
].filter(p => p.apiKey);

// ─── Middleware ───
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'frontend')));

// ─── JSON Database ───
const DB_PATH = path.join(__dirname, 'clipcheck.json');

function loadDb() {
    try {
        if (fs.existsSync(DB_PATH)) {
            return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        }
    } catch (e) { console.error('DB load error:', e.message); }
    return { reports: {} };
}
function saveDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
if (!fs.existsSync(DB_PATH)) saveDb(loadDb());

// ─── AI API Call with Multi-Provider Fallback + Timeout ───
async function callOpenRouter(messages, options = {}) {
    const { temperature = 0.3, max_tokens = 4000, response_format = null } = options;
    const errors = [];
    const timeoutMs = 35000;

    for (const provider of AI_PROVIDERS) {
        for (const model of provider.models) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const body = { model, messages, temperature, max_tokens };
                if (response_format) body.response_format = response_format;
                const response = await fetch(`${provider.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: provider.getHeaders(provider.apiKey),
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const errText = await response.text();
                    if (response.status === 429 || response.status === 503) {
                        errors.push(`${provider.name}/${model}: rate-limited`);
                        console.log(`  ${provider.name}/${model} rate-limited, trying next...`);
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    throw new Error(`${provider.name} ${model} error (${response.status}): ${errText}`);
                }
                const data = await response.json();
                console.log(`  Using model: ${provider.name}/${model}`);
                return data;
            } catch (e) {
                clearTimeout(timeoutId);
                if (e.name === 'AbortError') {
                    errors.push(`${provider.name}/${model}: timed out after ${timeoutMs}ms`);
                    console.log(`  ${provider.name}/${model} timed out, trying next...`);
                    continue;
                }
                errors.push(`${provider.name}/${model}: ${e.message}`);
                console.log(`  ${provider.name}/${model} failed: ${e.message}`);
            }
        }
        // Brief pause when switching providers
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`All AI models failed:\n${errors.join('\n')}`);
}

// ─── Safe JSON Parse ───
function safeParseJSON(text) {
    if (!text) return null;
    let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    try { return JSON.parse(cleaned); } catch {}
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > 0) {
        try { return JSON.parse(cleaned.substring(0, lastBrace + 1)); } catch {}
    }
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
        try { return { claims: JSON.parse(cleaned.substring(firstBracket, lastBracket + 1)) }; } catch {}
    }
    return null;
}

// ─── YouTube Transcript Extraction (with timeout) ───
async function getYoutubeTranscript(videoId, lang = 'en') {
    const { YoutubeTranscript } = require('youtube-transcript');
    const triedLangs = [];
    for (const tryLang of [lang, undefined]) {
        triedLangs.push(tryLang || 'auto');
        try {
            const opts = tryLang ? { lang: tryLang } : undefined;
            const segments = await withTimeout(
                YoutubeTranscript.fetchTranscript(videoId, opts),
                12000,
                'YouTube transcript fetch'
            );
            if (segments && segments.length > 0) {
                const fullText = segments.map(s => s.text || '').join(' ').replace(/\s+/g, ' ').trim();
                const normalised = segments.map(s => ({
                    text: s.text || '',
                    offset: s.offset || s.start || 0,
                    duration: s.duration || 5,
                }));
                console.log(`  Transcript obtained (lang: ${tryLang || 'auto'}, ${segments.length} segments)`);
                return { fullText, segments: normalised };
            }
        } catch (e) {
            const isLastAttempt = tryLang === undefined;
            if (!isLastAttempt) {
                console.log(`  Language '${tryLang}' not available, trying auto-detect...`);
                continue;
            }
            console.error(`YouTube transcript error: ${e.message}`);
            return null;
        }
    }
    return null;
}

// ─── Quick transcript availability check (with timeout) ───
async function checkTranscriptAvailable(platform, videoUrl, videoId, lang = 'en') {
    if (platform !== 'youtube' || !videoId) return true;
    try {
        const { YoutubeTranscript } = require('youtube-transcript');
        const opts = lang ? { lang } : undefined;
        await withTimeout(
            YoutubeTranscript.fetchTranscript(videoId, opts),
            8000,
            'transcript availability check'
        );
        return true;
    } catch (e) {
        const msg = e.message || '';
        if (lang !== 'en') return true;
        const hasHindi = msg.toLowerCase().includes('hi') || msg.includes('hindi');
        if (hasHindi) {
            try {
                await YoutubeTranscript.fetchTranscript(videoId, { lang: 'hi' });
                return true;
            } catch {}
        }
        return false;
    }
}

function detectPlatform(url) {
    const u = url.toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('tiktok.com') || u.includes('vm.tiktok.com')) return 'tiktok';
    if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
    if (u.includes('facebook.com') || u.includes('fb.com') || u.includes('fb.watch')) return 'facebook';
    if (u.includes('vimeo.com')) return 'vimeo';
    if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram';
    return 'unknown';
}

function extractYoutubeId(url) {
    const patterns = [
        /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

// ─── Promise timeout helper (Promise.race based) ───
function withTimeout(promise, ms, label = 'operation') {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        )
    ]);
}

// ─── Video Info Fetching (with timeout) ───
async function getYouTubeInfo(videoUrl) {
    try {
        const info = await withTimeout(
            ytdl.getInfo(videoUrl),
            10000,
            'ytdl.getInfo'
        );
        const d = info.videoDetails;
        const bestThumb = d.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url || '';
        return {
            title: d.title || 'YouTube Video',
            thumbnail_url: bestThumb || `https://img.youtube.com/vi/${d.videoId}/maxresdefault.jpg`,
            duration: parseInt(d.lengthSeconds) || 0,
            author: d.author?.name || '',
        };
    } catch (e) {
        console.error('Video info error:', e.message);
        const videoId = extractYoutubeId(videoUrl);
        // Return fallback immediately instead of hanging
        return {
            title: 'YouTube Video',
            thumbnail_url: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '',
            duration: 0,
            author: '',
        };
    }
}

// ─── Web Search (Deep) ───
async function searchWeb(query, maxResults = 8) {
    try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClipCheck/1.0)', 'Accept': 'text/html' }
        });
        if (!response.ok) return [];
        const html = await response.text();
        const results = [];
        const linkRegex = /<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/g;
        const urlRegex = /uddg=(.*?)&/;
        const snippetRegex = /<samp[^>]*class="result__snippet"[^>]*>(.*?)<\/samp>/g;
        const links = [...html.matchAll(linkRegex)];
        const snippets = [...html.matchAll(snippetRegex)];
        for (let i = 0; i < links.length && results.length < maxResults; i++) {
            const title = links[i][1].replace(/<[^>]*>/g, '').trim();
            const urlMatch = links[i][0].match(urlRegex);
            let cleanUrl = '';
            if (urlMatch) try { cleanUrl = decodeURIComponent(urlMatch[1]); } catch { cleanUrl = urlMatch[1]; }
            const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]*>/g, '').trim() : '';
            if (title && cleanUrl) results.push({ title, url: cleanUrl, snippet });
        }
        return results;
    } catch (e) {
        console.error('Web search error:', e.message);
        return [];
    }
}

// ─── Deep Search: Single-query search for speed ───
async function deepSearch(claim, language = 'en') {
    const query = language !== 'en' ? `${claim} ${language}` : claim;
    const results = await searchWeb(query, 8);
    return results.slice(0, 8);
}

// ─── Step 1: Extract Claims from Transcript (Deep) ───
async function extractClaims(transcript, reportId, language = 'en') {
    const langInstruction = language !== 'en'
        ? `\nThe transcript is in ${language}. Analyze claims in the original language but explain them afterward.\n`
        : '';

    // Determine how many claims to extract based on transcript length (no hard limit)
    const CHUNK_SIZE = 10000;
    const maxClaims = Math.max(15, transcript.length > 8000 ? 200 : 100);

    const systemPrompt = `You are an expert fact-checker analyzing a video transcript.${langInstruction}
Extract ALL important factual claims from the transcript — be thorough, leave none out.

A factual claim is something VERIFIABLE as true or false (statistics, dates, history, science, events, numbers, named facts).
Exclude opinions, filler, jokes, rhetorical questions.

Keep each claim SHORT (under 120 chars). Include the timestamp context if possible.

Return ONLY valid JSON like:
{"claims": [
  {"text":"short claim here","context":"brief context (1 sentence)","category":"Scientific|Historical|Statistical|Political|Health|Economic|Other"}
]}

CRITICAL: You MUST extract at LEAST 15-20 verifiable claims. If you find fewer, you missed some. Go through the transcript sentence by sentence and extract every single verifiable fact. The more claims you extract, the better the fact-check report will be. Do not stop at a small number.`;

    try {
        // For long transcripts, split into chunks and extract from each
        let allClaimResults = [];
        const chunks = [];

        if (transcript.length > CHUNK_SIZE) {
            // Split into overlapping chunks
            for (let i = 0; i < transcript.length; i += CHUNK_SIZE - 2000) {
                chunks.push(transcript.substring(i, i + CHUNK_SIZE));
                if (chunks.length >= 3) break; // max 3 chunks to avoid cost
            }
        } else {
            chunks.push(transcript);
        }

        // 🔥 Process all chunks in parallel to save time
        const chunkPromises = chunks.map(async (chunk, ci) => {
            const chunkNote = chunks.length > 1 ? `\n[Part ${ci + 1} of ${chunks.length} — extract ALL claims from this section]` : '';

            const data = await callOpenRouter(
                [
                    { role: 'system', content: 'You extract factual claims as valid JSON. Be thorough.' },
                    { role: 'user', content: systemPrompt + chunkNote + '\n\nTRANSCRIPT:\n' + chunk }
                ],
                { temperature: 0.2, max_tokens: 4096 }
            );

            const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.text || '';
            if (!content) {
                console.log(`  Chunk ${ci + 1}: AI returned empty`);
                return [];
            }
            console.log(`  Chunk ${ci + 1} raw response (${content.length} chars)`);

            let parsed = safeParseJSON(content);

            if (!parsed || !Array.isArray(parsed.claims)) {
                const claimRegex = /\{"text"\s*:\s*"[^"]*"\s*,\s*"context"\s*:\s*"[^"]*"\s*,\s*"category"\s*:\s*"[^"]*"\s*\}/g;
                const matches = [...content.matchAll(claimRegex)];
                if (matches.length > 0) {
                    const claims = matches.map(m => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(Boolean);
                    if (claims.length > 0) {
                        console.log(`  Chunk ${ci + 1}: Extracted ${claims.length} claims via regex`);
                        return claims;
                    }
                }
                console.log(`  Chunk ${ci + 1}: Could not parse claims.`);
                return [];
            }
            console.log(`  Chunk ${ci + 1}: Parsed ${parsed.claims.length} claims`);
            return parsed.claims || [];
        });

        // Update progress before parallel extraction
        const dbProgress = loadDb();
        if (dbProgress.reports[reportId]) {
            dbProgress.reports[reportId].progress = chunks.length > 1
                ? `Extracting claims from ${chunks.length} sections in parallel...`
                : `Extracting claims...`;
            saveDb(dbProgress);
        }

        // Run all chunks in parallel
        const chunkResults = await Promise.all(chunkPromises);
        for (const claims of chunkResults) {
            allClaimResults.push(...claims);
        }

        // Deduplicate: remove claims with very similar text
        const unique = [];
        for (const c of allClaimResults) {
            const text = (c.text || '').toLowerCase().replace(/[^\w]/g, '');
            const isDup = unique.some(u => {
                const uText = (u.text || '').toLowerCase().replace(/[^\w]/g, '');
                return text.includes(uText) || uText.includes(text);
            });
            if (!isDup) unique.push(c);
        }

        const finalClaims = unique.slice(0, maxClaims);
        console.log(`  ✅ Total unique claims extracted: ${finalClaims.length} (from ${allClaimResults.length} raw)`);
        return finalClaims;
    } catch (e) {
        console.error('Claim extraction error:', e.message);
        return [];
    }
}

// ─── Match claims to transcript timestamps (improved) ───
function matchTimestamps(claims, segments) {
    if (!segments || segments.length === 0) {
        return claims.map(c => ({ ...c, time_start: 0, time_end: 10 }));
    }
    return claims.map(claim => {
        const claimLower = claim.text.toLowerCase().replace(/[^\w\s]/g, '');
        const words = claimLower.split(/\s+/).filter(w => w.length > 3);
        const bigrams = [];
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.push(words[i] + ' ' + words[i + 1]);
        }

        let bestSeg = null, bestScore = 0;
        for (const seg of segments) {
            const segLower = seg.text.toLowerCase();
            let score = 0;
            // Score: full substring match gives big boost
            if (segLower.includes(claimLower.substring(0, 30))) score += 5;
            // Score bigrams (adjacent word pairs)
            for (const bg of bigrams) {
                if (segLower.includes(bg)) score += 3;
            }
            // Score individual content words
            for (const w of words) {
                if (segLower.includes(w)) score++;
            }
            if (score > bestScore) {
                bestScore = score;
                bestSeg = seg;
            }
        }
        if (bestSeg && bestScore > 0) {
            return {
                ...claim,
                time_start: Math.round(Math.max(0, bestSeg.offset - 2)),
                time_end: Math.round(bestSeg.offset + bestSeg.duration + 3),
            };
        }
        return { ...claim, time_start: 0, time_end: 10 };
    });
}

// ─── Step 2 & 3: Deep Search + Verify (with batch parallel) ───
async function verifyClaim(claim, searchResults, language = 'en') {
    const langInstruction = language !== 'en'
        ? `\nThe claim is in ${language}. Search for evidence in ${language} first, then fall back to English. Respond with explanation in English.\n`
        : '';
    const searchText = searchResults.length > 0
        ? searchResults.map((r, i) => `[${i+1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n\n')
        : 'No search results found.';

    const prompt = `You are a forensic fact-checker. Carefully analyze this claim using ALL the web evidence provided.

Claim: "${claim.text}"
Context: "${claim.context}"
Category: ${claim.category}
${langInstruction}
Web Evidence Sources (${searchResults.length} total):
${searchText}

Analyze each source critically:
- Check if the source is authoritative and relevant
- Cross-reference multiple sources
- Identify any contradictions or biases
- Look for primary vs secondary sources

Verdict definitions:
- TRUE: The claim is directly supported by reliable evidence
- FALSE: The claim is directly contradicted by reliable evidence
- MISLEADING: The claim contains some truth but is deceptive, missing context, or exaggerated
- UNVERIFIABLE: There is insufficient reliable evidence to determine truth

Return JSON ONLY:
{
  "verdict": "TRUE|FALSE|MISLEADING|UNVERIFIABLE",
  "confidence": "HIGH|MEDIUM|LOW",
  "explanation": "Detailed reasoning referencing specific sources, minimum 3 sentences",
  "sources": [{"title":"","url":"","relevance":"how this source supports/contradicts"}],
  "key_evidence": "1-2 sentence summary of the strongest evidence"
}`;

    try {
        const data = await callOpenRouter(
            [
                { role: 'system', content: 'You are a rigorous fact-checker. Always respond with valid JSON only. Be thorough and specific.' },
                { role: 'user', content: prompt }
            ],
            { temperature: 0.15, max_tokens: 4096 }
        );

        const rawContent = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.text || '';
        const result = safeParseJSON(rawContent) || {};
        return {
            claim: claim.text,
            context: claim.context,
            category: claim.category,
            time_start: claim.time_start,
            time_end: claim.time_end,
            verdict: result.verdict || 'UNVERIFIABLE',
            confidence: result.confidence || 'LOW',
            explanation: result.explanation || '',
            sources: (result.sources || []).slice(0, 8),
            key_evidence: result.key_evidence || '',
        };
    } catch (e) {
        console.error('Verification error:', e.message);
        return {
            claim: claim.text, context: claim.context, category: claim.category,
            time_start: claim.time_start, time_end: claim.time_end,
            verdict: 'UNVERIFIABLE', confidence: 'LOW',
            explanation: `Verification error: ${e.message}`,
            sources: [], key_evidence: '',
        };
    }
}

function generateSummary(claims) {
    if (!claims || claims.length === 0) return 'No factual claims were identified in this video.';
    const total = claims.length;
    const t = claims.filter(c => c.verdict === 'TRUE').length;
    const f = claims.filter(c => c.verdict === 'FALSE').length;
    const m = claims.filter(c => c.verdict === 'MISLEADING').length;
    const u = claims.filter(c => c.verdict === 'UNVERIFIABLE').length;
    return `Analysis of **${total}** claim(s): **${t}** True (${Math.round(t/total*100)}%), **${f}** False (${Math.round(f/total*100)}%), **${m}** Misleading, **${u}** Unverifiable.`;
}

// ─── Full Pipeline (batch parallel) ───
async function runFactCheckPipeline(transcript, reportId, segments, language = 'en') {
    console.log('  Extracting claims from transcript...');
    const claims = await extractClaims(transcript, reportId, language);
    console.log(`  Found ${claims.length} claims`);

    if (claims.length === 0) {
        return { claims: [], summary: 'No factual claims were identified in this video.' };
    }

    // Match timestamps
    const timedClaims = matchTimestamps(claims, segments);

    // Update progress to show claim count before fact-checking starts
    const db2 = loadDb();
    if (db2.reports[reportId]) {
        db2.reports[reportId].progress = `Found ${timedClaims.length} claims, starting verification...`;
        saveDb(db2);
    }

    // Batch parallel: process all claims at once for speed
    const BATCH_SIZE = 20;
    const verifiedClaims = [];
    let completed = 0;
    const total = timedClaims.length;

    // Pre-fetch all search results in parallel first
    const allSearchResults = await Promise.all(
        timedClaims.map(claim => deepSearch(claim.text, language))
    );

    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batchEnd = Math.min(i + BATCH_SIZE, total);
        const batchClaims = timedClaims.slice(i, batchEnd);
        const batchSearchResults = allSearchResults.slice(i, batchEnd);

        const results = await Promise.all(
            batchClaims.map((claim, idx) =>
                verifyClaim(claim, batchSearchResults[idx], language)
            )
        );

        verifiedClaims.push(...results);
        completed += batchEnd - i;

        // Update progress
        const db = loadDb();
        if (db.reports[reportId]) {
            const pct = Math.round((completed / total) * 100);
            db.reports[reportId].progress = `Deep fact-checking claim ${completed} of ${total} (${pct}%)`;
            saveDb(db);
        }
    }

    return { claims: verifiedClaims, summary: generateSummary(verifiedClaims) };
}

// ─── Transcription Pipeline ───
async function getTranscript(videoUrl, startTime = 0, endTime = null, lang = 'en') {
    const platform = detectPlatform(videoUrl);
    console.log(`  Platform detected: ${platform}`);

    try {
        if (platform === 'youtube') {
            const videoId = extractYoutubeId(videoUrl);
            if (!videoId) return { success: false, error: 'Invalid YouTube URL format.', platform };

            console.log(`  YouTube video ID: ${videoId} (lang: ${lang})`);
            const result = await withTimeout(
                getYoutubeTranscript(videoId, lang),
                15000,
                'YouTube transcript fetch'
            );
            if (!result) return { success: false, error: 'Could not extract captions from this YouTube video.', platform };

            let { fullText, segments } = result;

            // If time range specified, filter
            if ((startTime > 0 || endTime) && segments && segments.length > 0) {
                const filteredSegments = segments.filter(s => {
                    const segEnd = s.offset + s.duration;
                    if (endTime) return s.offset >= startTime && segEnd <= endTime;
                    return s.offset >= startTime;
                });
                if (filteredSegments.length > 0) {
                    const filteredText = filteredSegments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
                    return {
                        success: true,
                        transcript: filteredText || fullText,
                        segments: filteredSegments,
                        platform: 'youtube',
                        video_id: videoId,
                        title: `YouTube Video (${videoId})`,
                        segmentCount: segments.length,
                        usedSegmentCount: filteredSegments.length,
                    };
                }
            }

            return {
                success: true,
                transcript: fullText,
                segments,
                platform: 'youtube',
                video_id: videoId,
                title: `YouTube Video (${videoId})`,
                segmentCount: segments.length,
            };
        }

        if (platform === 'twitter') {
            console.log('  Fetching tweet content via oEmbed...');
            try {
                const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(videoUrl)}`;
                const oembedResp = await withTimeout(fetch(oembedUrl), 8000, 'Twitter oEmbed');
                if (!oembedResp.ok) throw new Error(`oEmbed status ${oembedResp.status}`);
                const oembedData = await oembedResp.json();
                const html = oembedData.html || '';
                // Strip HTML tags to get readable text
                const tweetText = html.replace(/<[^>]*>/g, ' ')
                    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                    .replace(/\s+/g, ' ').trim();
                const author = oembedData.author_name || '';
                console.log(`  ✅ Tweet fetched (${tweetText.length} chars) by ${author}`);
                return {
                    success: true,
                    transcript: tweetText,
                    segments: [{ text: tweetText, offset: 0, duration: tweetText.split(' ').length * 2 }],
                    platform: 'twitter',
                    video_id: null,
                    title: `Tweet by ${author}`,
                    author: author,
                    segmentCount: 1,
                };
            } catch (e) {
                console.error('Twitter oEmbed error:', e.message);
                try {
                    const pageResp = await withTimeout(fetch(videoUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClipCheck/1.0)' }
                    }), 8000, 'Twitter page fetch');
                    const pageHtml = await pageResp.text();
                    const metaMatch = pageHtml.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
                    const pageText = metaMatch ? metaMatch[1] : 'Could not extract tweet text.';
                    return {
                        success: true,
                        transcript: pageText,
                        segments: [{ text: pageText, offset: 0, duration: pageText.split(' ').length * 2 }],
                        platform: 'twitter',
                        video_id: null,
                        title: `Tweet`,
                        segmentCount: 1,
                    };
                } catch (e2) {
                    return { success: false, error: `Could not fetch tweet: ${e2.message}`, platform };
                }
            }
        }

        return {
            success: false,
            error: `${platform.charAt(0).toUpperCase() + platform.slice(1)} videos are not yet supported.`,
            platform
        };
    } catch (e) {
        console.error('Transcript error:', e.message);
        return { success: false, error: `Transcription error: ${e.message}`, platform };
    }
}

// ─── Custom Text Fact-Check ───
app.post('/api/fact-check-text', async (req, res) => {
    try {
        const { text, session_id, language } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ detail: 'Text is required' });
        if (text.trim().length < 3) return res.status(400).json({ detail: 'Text must be at least 3 characters' });

        const reportId = uuidv4();
        const db = loadDb();
        const textLabel = text.trim().substring(0, 100);
        db.reports[reportId] = {
            id: reportId,
            video_url: null,
            video_id: null,
            platform: 'text',
            title: `Fact-Check: "${textLabel}${text.trim().length > 100 ? '...' : ''}"`,
            status: 'processing',
            session_id: session_id || 'anonymous',
            language: language || 'en',
            with_video: false,
            thumbnail_url: null,
            duration: 0,
            author: '',
            start_time: null,
            end_time: null,
            transcript: text.trim(),
            segments: [],
            summary: null,
            claims: [],
            progress: 'Starting text analysis...',
            error: null,
            created_at: new Date().toISOString(),
            completed_at: null,
        };
        saveDb(db);

        const reportLang = language || 'en';
        processTextReport(reportId, text.trim(), reportLang).catch(err => {
            console.error(`Background error for ${reportId}:`, err);
            const db2 = loadDb();
            if (db2.reports[reportId]) {
                db2.reports[reportId].status = 'failed';
                db2.reports[reportId].error = `Processing error: ${err.message}`;
                db2.reports[reportId].completed_at = new Date().toISOString();
                saveDb(db2);
            }
        });

        res.json({ report_id: reportId, status: 'processing', message: 'Text fact-check started.' });
    } catch (e) {
        console.error('Text submit error:', e);
        res.status(500).json({ detail: 'Internal server error' });
    }
});

async function processTextReport(reportId, text, language = 'en') {
    console.log(`\n🔍 Processing text report ${reportId}: "${text.substring(0, 60)}..." (lang: ${language})`);

    try {
        // For short text, skip AI extraction and go straight to verification
        if (text.length < 500) {
            console.log('  Short text — skipping extraction, verifying directly...');
            let db = loadDb();
            if (db.reports[reportId]) { db.reports[reportId].progress = 'No claims found, verifying your question directly...'; saveDb(db); }

            const singleClaim = {
                text: text.substring(0, 250),
                context: text.substring(0, 400),
                category: 'Other'
            };
            const searchResults = await deepSearch(text, language);
            const verifiedClaim = await verifyClaim(singleClaim, searchResults, language);

            db = loadDb();
            if (db.reports[reportId]) {
                const r = db.reports[reportId];
                r.claims = [verifiedClaim];
                const v = verifiedClaim.verdict || 'UNVERIFIABLE';
                r.summary = `**${v}** — ${verifiedClaim.explanation ? verifiedClaim.explanation.substring(0, 200) : 'No explanation available.'}`;
                r.status = 'completed';
                r.progress = 'Completed!';
                r.completed_at = new Date().toISOString();
                saveDb(db);
            }
            console.log('  ✅ Short text report complete.');
            return;
        }

        let db = loadDb();
        if (db.reports[reportId]) { db.reports[reportId].progress = 'Extracting claims from text...'; saveDb(db); }

        console.log('  🔎 Extracting claims from text...');
        let claims = await extractClaims(text, reportId, language);
        console.log(`  Found ${claims.length} claims`);

        if (claims.length === 0) {
            console.log('  No claims extracted — treating user text as a single claim to verify...');
            db = loadDb();
            if (db.reports[reportId]) { db.reports[reportId].progress = 'No claims found, verifying your question directly...'; saveDb(db); }

            // Treat the user's text as one claim to answer directly
            const singleClaim = {
                text: text.substring(0, 250),
                context: text.substring(0, 400),
                category: 'Other'
            };
            const searchResults = await deepSearch(text, language);
            const verifiedClaim = await verifyClaim(singleClaim, searchResults, language);

            db = loadDb();
            if (db.reports[reportId]) {
                const r = db.reports[reportId];
                r.claims = [verifiedClaim];
                const v = verifiedClaim.verdict || 'UNVERIFIABLE';
                r.summary = `**${v}** — ${verifiedClaim.explanation ? verifiedClaim.explanation.substring(0, 200) : 'No explanation available.'}`;
                r.status = 'completed';
                r.progress = 'Completed!';
                r.completed_at = new Date().toISOString();
                saveDb(db);
            }
            console.log('  ✅ Text report complete — answered as single claim.');
            return;
        }

        db = loadDb();
        if (db.reports[reportId]) {
            db.reports[reportId].progress = `Found ${claims.length} claims, starting verification...`;
            saveDb(db);
        }

        // Batch verify (same as video pipeline)
        const BATCH_SIZE = 20;
        const verifiedClaims = [];
        let completed = 0;
        const total = claims.length;

        // Pre-fetch all search results in parallel first
        const allSearchResults = await Promise.all(
            claims.map(claim => deepSearch(claim.text, language))
        );

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batchEnd = Math.min(i + BATCH_SIZE, total);
            const batchClaims = claims.slice(i, batchEnd);
            const batchSearchResults = allSearchResults.slice(i, batchEnd);

            const results = await Promise.all(
                batchClaims.map((claim, idx) =>
                    verifyClaim(claim, batchSearchResults[idx], language)
                )
            );

            verifiedClaims.push(...results);
            completed += batchEnd - i;

            const db2 = loadDb();
            if (db2.reports[reportId]) {
                const pct = Math.round((completed / total) * 100);
                db2.reports[reportId].progress = `Deep fact-checking claim ${completed} of ${total} (${pct}%)`;
                saveDb(db2);
            }
        }

        db = loadDb();
        if (db.reports[reportId]) {
            db.reports[reportId].progress = 'Generating report...';
            saveDb(db);
        }
        await new Promise(r => setTimeout(r, 500));

        db = loadDb();
        if (db.reports[reportId]) {
            const r = db.reports[reportId];
            r.claims = verifiedClaims;
            r.summary = generateSummary(verifiedClaims);
            r.status = 'completed';
            r.progress = 'Completed!';
            r.completed_at = new Date().toISOString();
            saveDb(db);
        }

        console.log(`  ✅ Text report complete! ${verifiedClaims.length} claims analyzed.`);
    } catch (e) {
        console.error(`  ❌ Text processing error:`, e);
        const db = loadDb();
        if (db.reports[reportId]) {
            db.reports[reportId].status = 'failed';
            db.reports[reportId].error = `Processing error: ${e.message}`;
            db.reports[reportId].completed_at = new Date().toISOString();
            saveDb(db);
        }
    }
}

// ─── Routes ───
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));
app.get('/report/:id', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));
app.get('/history', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

app.get('/api/health', (req, res) => {
    const providers = AI_PROVIDERS.map(p => ({
        name: p.name,
        configured: !!p.apiKey,
        models: p.models,
    }));
    res.json({
        status: 'ok',
        providers,
        timestamp: new Date().toISOString()
    });
});

app.post('/api/fact-check', async (req, res) => {
    try {
        const { url, session_id, start_time, end_time, language, with_video } = req.body;
        if (!url || !url.trim()) return res.status(400).json({ detail: 'URL is required' });
        const trimmedUrl = url.trim();
        if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
            return res.status(400).json({ detail: 'Invalid URL format' });
        }
        const startTime = Math.max(0, parseFloat(start_time) || 0);
        const endTime = parseFloat(end_time) > startTime ? parseFloat(end_time) : null;
        const platform = detectPlatform(trimmedUrl);
        const videoId = extractYoutubeId(trimmedUrl);

        const reportId = uuidv4();
        const db = loadDb();
        db.reports[reportId] = {
            id: reportId,
            video_url: trimmedUrl,
            video_id: videoId,
            platform,
            title: null,
            status: 'processing',
            session_id: session_id || 'anonymous',
            language: language || 'en',
            with_video: with_video !== false,
            thumbnail_url: null,
            duration: 0,
            author: '',
            start_time: startTime || null,
            end_time: endTime || null,
            transcript: null,
            segments: null,
            summary: null,
            claims: [],
            progress: 'Starting analysis...',
            error: null,
            created_at: new Date().toISOString(),
            completed_at: null,
        };
        saveDb(db);

        const reportLang = language || 'en';
        processReport(reportId, trimmedUrl, startTime, endTime, reportLang).catch(err => {
            console.error(`Background error for ${reportId}:`, err);
            const db2 = loadDb();
            if (db2.reports[reportId]) {
                db2.reports[reportId].status = 'failed';
                db2.reports[reportId].error = `Processing error: ${err.message}`;
                db2.reports[reportId].completed_at = new Date().toISOString();
                saveDb(db2);
            }
        });

        res.json({ report_id: reportId, status: 'processing', message: 'Fact-check started.' });
    } catch (e) {
        console.error('Submit error:', e);
        res.status(500).json({ detail: 'Internal server error' });
    }
});

app.get('/api/report/:id', (req, res) => {
    const db = loadDb();
    const report = db.reports[req.params.id];
    if (!report) return res.status(404).json({ detail: 'Report not found' });
    res.json(report);
});

app.get('/api/reports', (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ detail: 'session_id is required' });
    const db = loadDb();
    const reports = Object.values(db.reports)
        .filter(r => r.session_id === sessionId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 50)
        .map(r => ({
            id: r.id, video_url: r.video_url, video_id: r.video_id,
            platform: r.platform, status: r.status, title: r.title,
            thumbnail_url: r.thumbnail_url, duration: r.duration,
            summary: r.summary, progress: r.progress,
            created_at: r.created_at, completed_at: r.completed_at
        }));
    res.json(reports);
});

// ─── Background Processing ───
async function processReport(reportId, videoUrl, startTime = 0, endTime = null, language = 'en') {
    console.log(`\n🔍 Processing report ${reportId}: ${videoUrl} (lang: ${language})`);

    try {
        let db = loadDb();
        if (db.reports[reportId]) { db.reports[reportId].progress = 'Getting video info...'; saveDb(db); }

        // Fetch video metadata (title, thumbnail)
        const platform = detectPlatform(videoUrl);
        let videoInfo = { title: null, thumbnail_url: null, duration: 0, author: '' };
        if (platform === 'youtube') {
            console.log('  📺 Fetching video info...');
            videoInfo = await getYouTubeInfo(videoUrl);
            db = loadDb();
            if (db.reports[reportId]) {
                db.reports[reportId].title = videoInfo.title;
                db.reports[reportId].thumbnail_url = videoInfo.thumbnail_url;
                db.reports[reportId].duration = videoInfo.duration;
                db.reports[reportId].progress = 'Video info obtained, fetching transcript...';
                saveDb(db);
            }
        }

        db = loadDb();
        if (db.reports[reportId]) { db.reports[reportId].progress = 'Fetching transcript...'; saveDb(db); }

        console.log('  📝 Step 1: Getting transcript...');
        const transcriptResult = await getTranscript(videoUrl, startTime, endTime, language);

        db = loadDb();
        if (!db.reports[reportId]) return;
        const report = db.reports[reportId];

        if (!transcriptResult.success) {
            report.status = 'failed';
            report.error = transcriptResult.error || 'Failed to get transcript';
            report.completed_at = new Date().toISOString();
            saveDb(db);
            console.log(`  ❌ Failed: ${report.error}`);
            return;
        }

        report.transcript = transcriptResult.transcript;
        report.segments = transcriptResult.segments || [];
        report.video_id = transcriptResult.video_id || report.video_id;
        report.platform = transcriptResult.platform;
        report.title = transcriptResult.title;
        report.author = transcriptResult.author || report.author || '';
        report.segment_count = transcriptResult.segmentCount;
        report.used_segment_count = transcriptResult.usedSegmentCount;
        report.progress = 'Transcript obtained! Extracting claims...';
        saveDb(db);

        console.log(`  ✅ Transcript obtained (${transcriptResult.transcript.length} chars)`);

        console.log('  🔎 Step 2: Running fact-check pipeline...');
        const factCheckResult = await runFactCheckPipeline(
            transcriptResult.transcript, reportId, transcriptResult.segments || [], report.language || 'en'
        );

        // 🔥 Update progress before final save so "Generating report" step shows
        db = loadDb();
        if (db.reports[reportId]) {
            db.reports[reportId].progress = 'Generating report...';
            saveDb(db);
        }
        // Brief delay to let frontend catch the progress update
        await new Promise(r => setTimeout(r, 500));

        db = loadDb();
        if (db.reports[reportId]) {
            const r = db.reports[reportId];
            r.claims = factCheckResult.claims;
            r.summary = factCheckResult.summary;
            r.status = 'completed';
            r.progress = 'Completed!';
            r.completed_at = new Date().toISOString();
            saveDb(db);
        }

        console.log(`  ✅ Complete! ${factCheckResult.claims.length} claims analyzed.`);
    } catch (e) {
        console.error(`  ❌ Processing error:`, e);
        const db = loadDb();
        if (db.reports[reportId]) {
            db.reports[reportId].status = 'failed';
            db.reports[reportId].error = `Processing error: ${e.message}`;
            db.reports[reportId].completed_at = new Date().toISOString();
            saveDb(db);
        }
    }
}

// ─── Start ───
app.listen(PORT, '0.0.0.0', () => {
    const providerStatus = AI_PROVIDERS.map(p =>
        `${p.name}: ${p.apiKey ? '✅' : '❌'}`
    ).join('  ');
    console.log(`
╔══════════════════════════════════════════════════╗
║              ClipCheck Server v3                 ║
║══════════════════════════════════════════════════║
║  URL:        http://localhost:${PORT}                     ║
║  Providers:  ${providerStatus.padEnd(44)}║
╚══════════════════════════════════════════════════╝
    `);
});
