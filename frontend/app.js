/* ──────────────────────────────────────────────
   ClipCheck — Frontend v4
   – Enhanced progress, video info card,
     pause & fact-check, history thumbnails
   ────────────────────────────────────────────── */

const API_BASE = 'https://clipcheck.onrender.com';

// ─── Fun Facts ───
const FUN_FACTS = [
    'The first fact-checking organization was founded in 1923!',
    'Misinformation spreads 6x faster than the truth on social media.',
    'Only 4% of fact-checks are ever shared — you\'re helping change that!',
    'The term "fake news" was popularized in 2016 but fact-checking dates back centuries.',
    'YouTube removed over 100,000 videos for COVID-19 misinformation in 2020-2021.',
    'People remember false information even after it\'s corrected (continued influence effect).',
    'Finland teaches media literacy in schools starting from preschool.',
    'The word "fact" comes from the Latin "factum" meaning "thing done."',
    'True stories spread faster than false ones — but false ones spread further.',
    'The most fact-checked politician in history is Donald Trump (over 30,000 claims).',
    'Deepfakes have been around since the 1990s — they were just much worse.',
    'Over 70 countries have fact-checking organizations today.',
    'The International Fact-Checking Network (IFCN) was founded in 2015.',
    'Satellite images are often used by fact-checkers to verify war claims.',
    'Reverse image search is a fact-checker\'s best friend.',
    'Snopes.com has been fact-checking urban legends since 1994!',
];
let _funFactInterval = null;

// ─── Gamification ───
const _ml = { points: 0, videos: 0, claims: 0, streak: 0, lastDate: null, speedRoundUnlocked: false };
function loadML() {
    try {
        const d = JSON.parse(localStorage.getItem('clipcheck_ml') || '{}');
        Object.assign(_ml, d);
        const today = new Date().toDateString();
        if (_ml.lastDate !== today) _ml.streak = _ml.lastDate && new Date(_ml.lastDate).getTime() === new Date(today).getTime() - 86400000 ? _ml.streak : 0;
    } catch {}
}
function saveML() {
    _ml.lastDate = new Date().toDateString();
    localStorage.setItem('clipcheck_ml', JSON.stringify(_ml));
}
loadML();

function addMLPoints(points, claimsChecked = 0) {
    const today = new Date().toDateString();
    if (_ml.lastDate !== today) {
        if (_ml.lastDate && new Date(_ml.lastDate).getTime() === new Date(today).getTime() - 86400000) {
            _ml.streak++;
        } else {
            _ml.streak = 0;
        }
    }
    _ml.points += points;
    _ml.videos++;
    _ml.claims += claimsChecked;
    saveML();
}

function showMLBadge() {
    const existing = document.getElementById('ml-badge');
    if (existing) existing.remove();
    const badge = document.createElement('div');
    badge.id = 'ml-badge';
    badge.className = 'ml-badge';
    badge.innerHTML = `🧠 <span class="ml-points">${_ml.points}</span> pts · <span class="ml-streak">${_ml.streak > 0 ? '🔥 ' + _ml.streak + 'd' : 'Today'}</span>`;
    badge.title = `${_ml.videos} videos checked · ${_ml.claims} claims analyzed`;
    document.querySelector('.nav-inner')?.appendChild(badge);
}

// ─── Confetti ───
let _confettiPieces = [];
let _confettiAnimFrame = null;
let _cctx = null;

// ─── Input Mode Toggle ───
let _inputMode = 'url';

function switchInputMode(mode) {
    _inputMode = mode;
    document.querySelectorAll('.input-mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('input-group-url').style.display = mode === 'url' ? 'block' : 'none';
    document.getElementById('input-group-text').style.display = mode === 'text' ? 'block' : 'none';
}

// ─── Mode Toggle ───
let _currentMode = 'report';

function setMode(mode) {
    _currentMode = mode;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.id === `mode-${mode}`));
}

// ─── Session ───
function getSessionId() {
    let sid = localStorage.getItem('clipcheck_session');
    if (!sid) { sid = 'sess_' + crypto.randomUUID(); localStorage.setItem('clipcheck_session', sid); }
    return sid;
}

// ─── Time Range Toggle ───
function toggleTimeRange() {
    const c = document.getElementById('time-range-inputs');
    const a = document.querySelector('.time-range-arrow');
    const open = c.style.display !== 'none';
    c.style.display = open ? 'none' : 'flex';
    a.classList.toggle('open', !open);
}

// ─── Manual Transcript Toggle ───
function toggleManualTranscript() {
    const c = document.getElementById('manual-transcript-section');
    const a = document.querySelector('.manual-transcript-arrow');
    const open = c.style.display !== 'none';
    c.style.display = open ? 'none' : 'block';
    a.classList.toggle('open', !open);
}

// ─── Navigation ───
function navigateTo(page) {
    const path = page === 'home' ? '/' : `/${page}`;
    window.history.pushState({ page }, '', path);
    showPage(page);
    updateNavActive(page);
    if (page === 'home') {
        updateHomeStats();
        loadRecentActivity();
        startActivityFeed();
        renderGamificationHub();
    }
}
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) el.classList.add('active');
}
function updateNavActive(page) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
}
window.addEventListener('popstate', (e) => {
    const page = e.state?.page || getPageFromPath();
    showPage(page); updateNavActive(page);
    if (page === 'history') loadHistory();
    if (page === 'results') { const m = location.pathname.match(/\/report\/(.+)/); if (m) loadReport(m[1]); }
});
function getPageFromPath() {
    const p = window.location.pathname;
    if (p === '/history') return 'history';
    if (p.startsWith('/report/')) return 'results';
    if (p.startsWith('/compare')) return 'compare';
    return 'home';
}

// ─── URL Input ───
function fillExample(url) { document.getElementById('video-url-input').value = url; document.getElementById('video-url-input').focus(); }

// ─── Submit Fact Check ───
async function submitFactCheck() {
    const urlInput = document.getElementById('video-url-input');
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); urlInput.style.outline = '2px solid var(--danger)'; setTimeout(() => urlInput.style.outline = '', 2000); return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) { showToast('Please enter a valid URL'); return; }

    navigateTo('processing');
    resetProgress();
    updateProgress('Starting analysis...');

    try {
        const lang = document.getElementById('language-select').value;
        const manualTranscript = document.getElementById('manual-transcript').value.trim();
        const body = { url, session_id: getSessionId(), language: lang, with_video: _currentMode === 'video' };
        if (manualTranscript) body.manualTranscript = manualTranscript;
        const st = parseFloat(document.getElementById('start-time').value);
        const et = parseFloat(document.getElementById('end-time').value);
        if (st > 0) body.start_time = st;
        if (et > st) body.end_time = et;

        const response = await fetch(`${API_BASE}/api/fact-check`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error((await response.json()).detail || 'Failed');
        const data = await response.json();
        await pollReport(data.report_id);
    } catch (err) { console.error(err); showError(err.message); }
}

// ─── Submit Text Fact Check ───
async function submitTextFactCheck() {
    const textInput = document.getElementById('text-input');
    const text = textInput.value.trim();
    if (!text) { textInput.focus(); textInput.style.outline = '2px solid var(--danger)'; setTimeout(() => textInput.style.outline = '', 2000); return; }
    if (text.length < 3) { showToast('Please enter at least 3 characters'); return; }

    navigateTo('processing');
    resetProgress(true);
    updateProgress('Starting text analysis...');

    try {
        const response = await fetch(`${API_BASE}/api/fact-check-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                session_id: getSessionId(),
                language: document.getElementById('language-select').value || 'en'
            })
        });
        if (!response.ok) throw new Error((await response.json()).detail || 'Failed');
        const data = await response.json();
        await pollReport(data.report_id);
    } catch (err) { console.error(err); showError(err.message); }
}

// ─── Polling ───
let _currentReportId = null;
let _currentReportData = null;
let _lastProgressMessage = '';
let _lastProgressTime = 0;
let _isTextReport = false;

async function pollReport(reportId) {
    let attempts = 0;
    const maxAttempts = 300;
    _lastProgressMessage = '';
    _lastProgressTime = Date.now();

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const response = await fetch(`${API_BASE}/api/report/${reportId}`);
            if (!response.ok) { await new Promise(r => setTimeout(r, 2000)); continue; }
            const report = await response.json();

            if (report.status === 'completed') {
                _currentReportId = report.id;
                _currentReportData = report;
                updateProgress('✅ Complete!');
                updateProgressBar(100);
                stopSimProgress();
                stopFunFacts();
                hideAIThinking();
                closeSwipeGame();
                const claimCount = (report.claims || []).length;
                addMLPoints(10 + claimCount * 5, claimCount);
                showMLBadge();
                launchConfetti();
                // Show completion overlay before results
                showCompletionOverlay(report);
                await new Promise(r => setTimeout(r, 2000));
                closeCompletionOverlay();
                renderResults(report);
                return;
            }
            if (report.status === 'failed') { showError(report.error || 'Fact-check failed.', report); return; }

            // Track if progress is stuck
            const currentProgress = report.progress || '';
            if (currentProgress === _lastProgressMessage) {
                // Stuck for more than 30 seconds? Show a tip
                if (Date.now() - _lastProgressTime > 30000) {
                    const tipEl = document.getElementById('processing-note');
                    if (tipEl && !tipEl.dataset.stuck) {
                        tipEl.dataset.stuck = '1';
                        tipEl.innerHTML = '⏳ Still working... This can take a minute for long videos. <span style="color:var(--text-secondary)">The server is processing your video.</span>';
                    }
                }
            } else {
                _lastProgressMessage = currentProgress;
                _lastProgressTime = Date.now();
                // Reset stuck message
                const tipEl = document.getElementById('processing-note');
                if (tipEl && tipEl.dataset.stuck) {
                    delete tipEl.dataset.stuck;
                    tipEl.innerHTML = '✓ Checking captions... ↓ Trying backup extraction... ↓ Ready for analysis.';
                }
            }

            // Update progress elements
            updateProgressBarFromReport(report);
            updateProcessingStepsFromReport(report);
            if (report.progress) updateProgress(report.progress);
            updateClaimCounter(report);

            // AI thinking indicator
            const p = (report.progress || '').toLowerCase();
            if (p.includes('extracting claims') || p.includes('thinking') || p.includes('analyzing') || p.includes('fact-checking') || p.includes('verifying')) {
                showAIThinking();
            } else {
                hideAIThinking();
            }

        } catch (err) { console.error('Poll error:', err); }
        await new Promise(r => setTimeout(r, 1200));
    }
    showError('This video is taking longer than expected. Check back on the History page.');
}

// ─── Fun Facts Rotator ───
function startFunFacts() {
    const el = document.getElementById('fun-fact-text');
    if (!el) return;
    let idx = Math.floor(Math.random() * FUN_FACTS.length);
    el.textContent = FUN_FACTS[idx];
    if (_funFactInterval) clearInterval(_funFactInterval);
    // Rotate every 10 seconds — slower, calmer
    _funFactInterval = setInterval(() => {
        idx = (idx + 1) % FUN_FACTS.length;
        el.style.opacity = '0';
        setTimeout(() => {
            el.textContent = FUN_FACTS[idx];
            el.style.opacity = '1';
        }, 300);
    }, 10000);
    // Auto-start mini-game after a short delay
    setTimeout(() => startMiniGame(), 1000);
}
function stopFunFacts() {
    if (_funFactInterval) { clearInterval(_funFactInterval); _funFactInterval = null; }
}

// ─── Mini-Game: Guess the Verdict Quiz ───
const QUIZ_QUESTIONS_BASE = [
    { claim: 'Lightning never strikes the same place twice.', answer: 'false', explanation: 'The Empire State Building is hit about 25 times per year!' },
    { claim: 'Humans only use 10% of their brains.', answer: 'false', explanation: 'Brain scans show we use virtually all parts of our brain every day.' },
    { claim: 'Octopuses have three hearts.', answer: 'true', explanation: 'Two pump blood to the gills, one pumps it to the rest of the body.' },
    { claim: 'Bananas grow on trees.', answer: 'false', explanation: 'Banana plants are actually giant herbs, not trees!' },
    { claim: 'Water freezes faster if it\'s already hot.', answer: 'true', explanation: 'The Mpemba effect — under certain conditions, hot water can freeze faster than cold.' },
    { claim: 'The Great Wall of China is visible from space.', answer: 'false', explanation: 'It\'s actually very hard to see from space with the naked eye.' },
    { claim: 'Honey never spoils.', answer: 'true', explanation: 'Archaeologists found 3000-year-old honey in Egyptian tombs that was still edible!' },
    { claim: 'Mount Everest is the tallest mountain in the world.', answer: 'false', explanation: 'Mauna Kea from its base on the ocean floor is taller (10,210m vs 8,848m).' },
];
let QUIZ_QUESTIONS = [];
const GAME_REWARDS = [5, 10, 15, 20, 25, 30, 40, 50];

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

let _gameState = { active: false, current: 0, score: 0, answers: [], claimed: false };

function startMiniGame() {
    const el = document.getElementById('mini-game');
    if (!el) return;
    // Shuffle questions every time the game starts
    QUIZ_QUESTIONS = shuffleArray([...QUIZ_QUESTIONS_BASE]);
    _gameState = { active: true, current: 0, score: 0, answers: [], claimed: false };
    el.style.display = 'block';
    // Clear history
    document.getElementById('quiz-history-list').innerHTML = '';
    document.getElementById('quiz-history-empty').style.display = 'block';
    document.getElementById('quiz-restart').style.display = 'none';
    document.getElementById('speed-round-btn').style.display = 'none';
    showQuizQuestion();
}

function closeMiniGame() {
    document.getElementById('mini-game').style.display = 'none';
    _gameState.active = false;
}

function renderQuizHistory() {
    const list = document.getElementById('quiz-history-list');
    const empty = document.getElementById('quiz-history-empty');
    list.innerHTML = '';
    if (_gameState.answers.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    _gameState.answers.forEach((a, i) => {
        const q = QUIZ_QUESTIONS[i];
        if (!q) return;
        const item = document.createElement('div');
        item.className = 'quiz-history-item';
        const answerLabel = q.answer === 'true' ? 'TRUE' : 'FALSE';
        item.innerHTML = `
            <div class="qhi-header">
                <div class="qhi-verdict ${a.correct ? 'correct' : 'wrong'}">${a.correct ? '✅' : '❌'}</div>
                <div class="qhi-text">"${escapeHtml(q.claim)}"</div>
                <span class="qhi-answer ${a.correct ? 'correct' : 'wrong'}">${answerLabel}</span>
            </div>
            <div class="qhi-detail">${escapeHtml(q.explanation)}</div>
        `;
        item.addEventListener('click', () => {
            item.classList.toggle('expanded');
        });
        list.appendChild(item);
    });
    list.scrollTop = list.scrollHeight;
}

function showQuizQuestion() {
    const q = _gameState.current;
    if (q >= QUIZ_QUESTIONS.length) { showQuizResult(); return; }
    const question = QUIZ_QUESTIONS[q];
    document.getElementById('quiz-claim').textContent = `"${question.claim}"`;
    document.getElementById('quiz-progress').textContent = `Question ${q + 1} of ${QUIZ_QUESTIONS.length}`;
    document.getElementById('quiz-score').textContent = `Score: ${_gameState.score}`;
    document.getElementById('quiz-feedback').style.display = 'none';
    document.getElementById('quiz-buttons').style.display = 'flex';
    document.getElementById('quiz-next').style.display = 'none';
    renderQuizHistory();
}

function answerQuiz(guess) {
    if (!_gameState.active || _gameState.claimed) return;
    const q = _gameState.current;
    if (q >= QUIZ_QUESTIONS.length) return;
    const question = QUIZ_QUESTIONS[q];
    const correct = guess === question.answer;
    _gameState.answers.push({ guess, correct });
    if (correct) _gameState.score += GAME_REWARDS[q];

    document.getElementById('quiz-buttons').style.display = 'none';
    const fb = document.getElementById('quiz-feedback');
    fb.style.display = 'block';
    fb.className = 'quiz-feedback ' + (correct ? 'correct' : 'wrong');
    fb.innerHTML = correct
        ? `✅ Correct! +${GAME_REWARDS[q]} pts`
        : `❌ Wrong! The answer was <strong>${question.answer.toUpperCase()}</strong>`;
    document.getElementById('quiz-explanation').textContent = question.explanation;
    document.getElementById('quiz-next').style.display = 'inline-flex';
    _gameState.claimed = true;
    
    // Update history immediately so user can see the answered question
    renderQuizHistory();
}

function nextQuizQuestion() {
    _gameState.current++;
    _gameState.claimed = false;
    showQuizQuestion();
}

function showQuizResult() {
    const total = QUIZ_QUESTIONS.length;
    const correct = _gameState.answers.filter(a => a.correct).length;
    const pct = Math.round((correct / total) * 100);
    // Hide the current question area, show final result
    document.getElementById('quiz-claim').textContent = `You got ${correct}/${total} correct! (${pct}%)`;
    document.getElementById('quiz-claim').style.fontSize = '1.2rem';
    document.getElementById('quiz-progress').textContent = 'Quiz complete!';
    document.getElementById('quiz-score').textContent = `Total: ${_gameState.score} pts`;
    document.getElementById('quiz-buttons').style.display = 'none';
    document.getElementById('quiz-feedback').style.display = 'none';
    document.getElementById('quiz-next').style.display = 'none';
    document.getElementById('quiz-restart').style.display = 'inline-flex';

    // Unlock Speed Round
    if (!_ml.speedRoundUnlocked) {
        unlockSpeedRound();
        document.getElementById('speed-round-btn').style.display = 'inline-flex';
    } else {
        document.getElementById('speed-round-btn').style.display = 'inline-flex';
    }
}

function restartQuiz() {
    document.getElementById('quiz-restart').style.display = 'none';
    document.getElementById('speed-round-btn').style.display = 'none';
    document.getElementById('quiz-claim').style.fontSize = '';
    // Shuffle and restart with fresh questions
    QUIZ_QUESTIONS = shuffleArray([...QUIZ_QUESTIONS_BASE]);
    _gameState = { active: true, current: 0, score: 0, answers: [], claimed: false };
    document.getElementById('quiz-history-list').innerHTML = '';
    document.getElementById('quiz-history-empty').style.display = 'block';
    showQuizQuestion();
}

// ─── Speed Round ───
const SPEED_ROUND_SECONDS = 20;
const SPEED_ROUND_QUESTIONS = [
    { claim: 'Vikings wore horned helmets.', answer: 'false', explanation: 'No historical evidence — the horned helmet myth was invented for 19th-century opera costumes.' },
    { claim: 'A day on Venus is longer than a year on Venus.', answer: 'true', explanation: 'Venus takes 243 Earth days to rotate but only 225 to orbit the sun.' },
    { claim: 'Dogs only see in black and white.', answer: 'false', explanation: 'Dogs can see blue and yellow — they\'re dichromatic, not monochrome.' },
    { claim: 'Ostriches bury their heads in the sand.', answer: 'false', explanation: 'They dig nests in the ground but never bury their heads — that\'s a myth.' },
    { claim: 'Humans share 60% of their DNA with bananas.', answer: 'true', explanation: 'About 60% of human genes have a recognizable counterpart in the banana genome.' },
    { claim: 'Eating chocolate gives you acne.', answer: 'false', explanation: 'Multiple studies found no direct link between chocolate consumption and acne.' },
    { claim: 'The Amazon rainforest produces 20% of the world\'s oxygen.', answer: 'true', explanation: 'Through photosynthesis, the Amazon contributes about 20% of Earth\'s oxygen.' },
    { claim: 'Fortune cookies were invented in China.', answer: 'false', explanation: 'They were invented in early-1900s San Francisco by Japanese immigrants.' },
    { claim: 'Sharks existed before trees.', answer: 'true', explanation: 'Sharks have been around for ~400 million years, trees for ~350 million.' },
    { claim: 'Goldfish have a 3-second memory.', answer: 'false', explanation: 'Studies show goldfish can remember things for months.' },
];

let _speedRoundState = { active: false, current: 0, score: 0, correct: 0, timeLeft: SPEED_ROUND_SECONDS, timer: null, claimed: false };
const SR_REWARD_PER_CORRECT = 15;

function unlockSpeedRound() {
    _ml.speedRoundUnlocked = true;
    saveML();
}

function startSpeedRound() {
    const el = document.getElementById('mini-game');
    if (!el) return;
    document.getElementById('speed-round-btn').style.display = 'none';
    document.getElementById('quiz-restart').style.display = 'none';
    document.getElementById('sr-section').style.display = 'block';
    document.getElementById('quiz-section').style.display = 'none';

    _speedRoundState = { active: true, current: 0, score: 0, correct: 0, timeLeft: SPEED_ROUND_SECONDS, timer: null, claimed: false };
    document.getElementById('sr-timer').textContent = `⏱ ${SPEED_ROUND_SECONDS}s`;
    document.getElementById('sr-progress').textContent = 'Question 1';
    document.getElementById('sr-score').textContent = 'Score: 0';
    document.getElementById('sr-feedback').style.display = 'none';
    document.getElementById('sr-buttons').style.display = 'flex';
    document.getElementById('sr-result').style.display = 'none';
    showSRQuestion();

    // Start countdown
    clearInterval(_speedRoundState.timer);
    _speedRoundState.timer = setInterval(() => {
        _speedRoundState.timeLeft--;
        document.getElementById('sr-timer').textContent = `⏱ ${_speedRoundState.timeLeft}s`;
        if (_speedRoundState.timeLeft <= 5) {
            document.getElementById('sr-timer').style.color = '#ef4455';
        }
        if (_speedRoundState.timeLeft <= 0) {
            clearInterval(_speedRoundState.timer);
            endSpeedRound();
        }
    }, 1000);
}

function showSRQuestion() {
    const q = _speedRoundState.current;
    if (q >= SPEED_ROUND_QUESTIONS.length) { endSpeedRound(); return; }
    document.getElementById('sr-claim').textContent = `"${SPEED_ROUND_QUESTIONS[q].claim}"`;
    document.getElementById('sr-progress').textContent = `Question ${q + 1}`;
    document.getElementById('sr-score').textContent = `Score: ${_speedRoundState.score}`;
    document.getElementById('sr-feedback').style.display = 'none';
    document.getElementById('sr-buttons').style.display = 'flex';
    _speedRoundState.claimed = false;
}

function answerSpeedRound(guess) {
    if (!_speedRoundState.active || _speedRoundState.claimed) return;
    const q = _speedRoundState.current;
    if (q >= SPEED_ROUND_QUESTIONS.length) return;
    const question = SPEED_ROUND_QUESTIONS[q];
    const correct = guess === question.answer;
    _speedRoundState.claimed = true;
    if (correct) {
        _speedRoundState.score += SR_REWARD_PER_CORRECT;
        _speedRoundState.correct++;
    }

    const fb = document.getElementById('sr-feedback');
    fb.style.display = 'block';
    fb.className = 'quiz-feedback ' + (correct ? 'correct' : 'wrong');
    fb.innerHTML = correct
        ? `✅ Correct! +${SR_REWARD_PER_CORRECT}`
        : `❌ ${question.answer.toUpperCase()}`;
    document.getElementById('sr-explanation').textContent = question.explanation;

    // Auto-advance after 1.5s — slower so user can read the explanation
    setTimeout(() => {
        if (_speedRoundState.active) {
            _speedRoundState.current++;
            if (_speedRoundState.current >= SPEED_ROUND_QUESTIONS.length || _speedRoundState.timeLeft <= 0) {
                endSpeedRound();
            } else {
                showSRQuestion();
            }
        }
    }, 1500);
}

function endSpeedRound() {
    clearInterval(_speedRoundState.timer);
    _speedRoundState.active = false;
    document.getElementById('sr-buttons').style.display = 'none';
    document.getElementById('sr-feedback').style.display = 'none';
    const resultEl = document.getElementById('sr-result');
    resultEl.style.display = 'block';
    const c = _speedRoundState.correct;
    const s = _speedRoundState.score;
    resultEl.innerHTML = `
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:8px;">⏱ Time's Up!</div>
        <div style="font-size:1.1rem;">${c} correct · <strong>${s} pts</strong></div>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;">
            <button class="btn btn-primary btn-sm" onclick="awardSpeedRoundAndClose()">🏆 Claim ${s} pts</button>
            <button class="btn btn-secondary btn-sm" onclick="closeSpeedRound()">Close</button>
        </div>
    `;
}

function awardSpeedRoundAndClose() {
    const s = _speedRoundState.score;
    if (s > 0) {
        _ml.points += s;
        saveML();
        showToast(`🏆 Speed Round complete! +${s} points`);
        showMLBadge();
    }
    closeSpeedRound();
}

function closeSpeedRound() {
    clearInterval(_speedRoundState.timer);
    _speedRoundState.active = false;
    document.getElementById('sr-section').style.display = 'none';
    document.getElementById('quiz-section').style.display = 'block';
    document.getElementById('mini-game').style.display = 'none';
}

// ─── Confetti ───
function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    _cctx = ctx;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#22d65e', '#ef4455', '#f5a80b', '#3b82f6', '#a855f7', '#ec4899', '#22d3ee'];
    _confettiPieces = [];
    for (let i = 0; i < 120; i++) {
        _confettiPieces.push({
            x: Math.random() * canvas.width,
            y: -20 - Math.random() * canvas.height * 0.5,
            w: 6 + Math.random() * 6,
            h: 4 + Math.random() * 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 2,
            vy: 2 + Math.random() * 3,
            rot: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 8,
            opacity: 1,
        });
    }

    if (_confettiAnimFrame) cancelAnimationFrame(_confettiAnimFrame);
    let startTime = Date.now();

    function draw() {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 5) {
            _confettiPieces.forEach(p => { p.opacity = Math.max(0, p.opacity - 0.02); });
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let anyAlive = false;
        _confettiPieces.forEach(p => {
            if (p.opacity <= 0) return;
            anyAlive = true;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.rot += p.rotSpeed;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rot * Math.PI) / 180);
            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        if (anyAlive && elapsed < 8) {
            _confettiAnimFrame = requestAnimationFrame(draw);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            _confettiPieces = [];
        }
    }
    draw();
}

window.addEventListener('resize', () => {
    const canvas = document.getElementById('confetti-canvas');
    if (canvas) { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
});

// ─── Simulated Progress Timer ───
let _simProgressTimer = null;
let _simProgressValue = 0;
let _lastRealPct = 0;

function startSimProgress() {
    stopSimProgress();
    _simProgressValue = 0;
    _lastRealPct = 0;
    // Slow, conservative climb — only goes up to 15% max simulated
    setTimeout(() => {
        if (_simProgressValue <= _lastRealPct) {
            _simProgressValue = 3;
            updateProgressBar(3);
        }
    }, 500);
    _simProgressTimer = setInterval(() => {
        if (_simProgressValue >= 15) { stopSimProgress(); return; }
        const increment = 1 + Math.random() * 2;
        _simProgressValue = Math.min(15, _simProgressValue + increment);
        if (_simProgressValue > _lastRealPct) {
            updateProgressBar(_simProgressValue);
        }
    }, 2000);
}

function stopSimProgress() {
    if (_simProgressTimer) { clearInterval(_simProgressTimer); _simProgressTimer = null; }
}

function onRealProgress(pct) {
    _lastRealPct = pct;
    if (pct > _simProgressValue) {
        _simProgressValue = pct;
    }
}

// ─── Progress Bar ───
function resetProgress(textMode = false) {
    const fill = document.getElementById('progress-fill');
    const label = document.getElementById('progress-percent');
    if (fill) fill.style.width = '0%';
    if (label) label.textContent = '0%';
    const stepLabels = textMode
        ? ['Analyzing text', 'Extracting claims', 'Searching web', 'Verifying facts', 'Generating report']
        : ['Checking captions', 'Trying backup extraction', 'Reading video metadata', 'Verifying facts', 'Generating report'];
    for (let i = 1; i <= 5; i++) {
        const s = document.getElementById(`proc-step${i}`);
        if (s) {
            s.classList.remove('active', 'done');
            const span = s.querySelector('span:last-child');
            if (span) span.textContent = stepLabels[i - 1];
        }
    }
    const s1 = document.getElementById('proc-step1');
    if (s1) s1.classList.add('active');
    const cc = document.getElementById('claim-counter');
    if (cc) cc.style.display = 'none';
    hideAIThinking();
    startFunFacts();
    startSimProgress();
    _isTextReport = textMode;
}

function updateProgress(message) {
    const el = document.getElementById('progress-message');
    if (el) el.textContent = message;
    // Also update the processing title to reflect current stage
    const titleEl = document.getElementById('processing-title');
    if (titleEl && message) {
        const m = message.toLowerCase();
        if (_isTextReport) {
            if (m.includes('starting') || m.includes('text analysis')) {
                titleEl.textContent = '📝 Analyzing text...';
            } else if (m.includes('extracting claim')) {
                titleEl.textContent = '🔍 Extracting claims...';
            } else if (m.includes('search') || m.includes('web')) {
                titleEl.textContent = '🌐 Searching web for evidence...';
            } else if (m.includes('fact-checking') || m.includes('verifying') || m.includes('checking') || m.includes('deep')) {
                titleEl.textContent = '⚡ Verifying facts...';
            } else if (m.includes('generating') || m.includes('complete')) {
                titleEl.textContent = '📊 Generating report...';
            }
        } else {
            if (m.includes('getting video') || m.includes('starting')) {
                titleEl.textContent = '📺 Fetching video info...';
            } else if (m.includes('checking captions')) {
                titleEl.textContent = '📝 Checking captions...';
            } else if (m.includes('trying backup') || m.includes('download')) {
                titleEl.textContent = '🔄 Trying backup extraction...';
            } else if (m.includes('reading metadata') || m.includes('metadata') || m.includes('transcript unavailable')) {
                titleEl.textContent = '📋 Reading video metadata...';
            } else if (m.includes('transcript')) {
                titleEl.textContent = '📝 Getting transcript...';
            } else if (m.includes('extracting claim')) {
                titleEl.textContent = '🔍 Extracting claims...';
            } else if (m.includes('fact-checking') || m.includes('verifying') || m.includes('checking') || m.includes('deep')) {
                titleEl.textContent = '⚡ Verifying facts...';
            } else if (m.includes('generating') || m.includes('complete')) {
                titleEl.textContent = '📊 Generating report...';
            }
        }
    }
}

function updateProgressBar(pct) {
    const fill = document.getElementById('progress-fill');
    const label = document.getElementById('progress-percent');
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (label) label.textContent = Math.round(Math.min(100, pct)) + '%';
}

function updateProgressBarFromReport(report) {
    if (!report) return;
    const p = (report.progress || '').toLowerCase();
    let pct = 3;

    if ((p.includes('starting') && !p.includes('verification')) || (p === 'starting analysis...')) pct = 3;
    else if (p.includes('getting video') || (p.includes('video info') && !p.includes('obtained'))) pct = 8;
    else if (p.includes('video info obtained') || p.includes('video info fetched')) pct = 12;
    else if (p.includes('checking captions') || p.includes('fetching transcript') || p.includes('transcribing') || p.includes('obtaining transcript')) pct = 18;
    else if (p.includes('trying backup') || p.includes('download')) pct = 22;
    else if (p.includes('reading metadata') || p.includes('transcript unavailable')) pct = 25;
    else if (p.includes('transcript obtained') || p.includes('transcript!')) pct = 25;
    else if (p.includes('extracting claims')) pct = 30;
    else if ((p.includes('found') && p.includes('claims')) || p.includes('starting verification') || p.includes('no claims found') || p.includes('verifying your question')) pct = 35;
    else if (p.includes('fact-checking claim') || p.includes('deep fact-checking') || p.includes('deep checking') || p.includes('checking claim')) {
        const m = p.match(/claim\s*(\d+)\s*of\s*(\d+)/i);
        if (m) {
            const done = parseInt(m[1]);
            const total = parseInt(m[2]);
            if (total > 0) pct = 35 + Math.round((done / total) * 63);
        } else pct = 40;
    }
    else if (p.includes('verifying')) pct = 45;
    else if (p === 'completed!' || p.includes('generating report') || p.includes('complete')) pct = 100;

    onRealProgress(pct);
    updateProgressBar(pct);
}

// ─── Real-time Claim Counter ───
function updateClaimCounter(report) {
    if (!report) return;
    const el = document.getElementById('claim-counter');
    const valEl = document.getElementById('claim-counter-value');
    const statusEl = document.getElementById('claim-counter-status');
    if (!el || !valEl || !statusEl) return;

    const p = (report.progress || '').toLowerCase();

    if (p.includes('extracting claims')) {
        el.style.display = 'block';
        valEl.textContent = '...';
        statusEl.textContent = 'extracting claims...';
    } else if (p.includes('found') && p.includes('claims')) {
        const m = p.match(/found\s*(\d+)\s*claims/i);
        if (m) {
            el.style.display = 'block';
            valEl.textContent = m[1];
            statusEl.textContent = 'found, starting verification';
        } else {
            el.style.display = 'block';
            valEl.textContent = '✓';
            statusEl.textContent = 'claims extracted';
        }
    } else if (p.includes('fact-checking claim') || p.includes('deep fact-checking')) {
        const m = p.match(/claim\s*(\d+)\s*of\s*(\d+)/i);
        if (m) {
            el.style.display = 'block';
            valEl.textContent = `${m[1]}/${m[2]}`;
            const pct = p.match(/\((\d+)%\)/);
            statusEl.textContent = `deep checking (${m[2]} total)${pct ? ' ' + pct[1] + '%' : ''}`;
        } else {
            el.style.display = 'block';
            valEl.textContent = '⚡';
            statusEl.textContent = 'deep checking...';
        }
    } else if (p === 'completed!' || p.includes('generating report')) {
        const totalClaims = (report.claims || []).length;
        if (totalClaims > 0) {
            el.style.display = 'block';
            valEl.textContent = totalClaims;
            statusEl.textContent = 'verified';
        }
    } else if (p.includes('transcript') || p.includes('video info')) {
        el.style.display = 'none';
    }
}

function updateProcessingStepsFromReport(report) {
    if (!report) return;
    const isText = report.platform === 'text' || _isTextReport;
    const p = (report.progress || '').toLowerCase();
    const steps = {
        s1: document.getElementById('proc-step1'),
        s2: document.getElementById('proc-step2'),
        s3: document.getElementById('proc-step3'),
        s4: document.getElementById('proc-step4'),
        s5: document.getElementById('proc-step5'),
    };

    const markDone = (s) => { s?.classList.remove('active'); s?.classList.add('done'); };
    const markActive = (s) => { s?.classList.add('active'); };
    const clearSteps = (from) => {
        for (let i = from; i <= 5; i++) {
            const el = document.getElementById(`proc-step${i}`);
            el?.classList.remove('active', 'done');
        }
    };

    if (isText) {
        // Text mode steps
        if (p.includes('starting') && !p.includes('verification')) {
            clearSteps(2);
            markActive(steps.s1);
            return;
        }
        if (!steps.s1?.classList.contains('done')) markDone(steps.s1);

        if (p.includes('extracting claims')) {
            clearSteps(3);
            markActive(steps.s2);
            return;
        }

        if ((p.includes('found') && p.includes('claims') && p.includes('starting verification'))
            || (p.includes('starting verification'))
            || (p.includes('search') && p.includes('web'))
            || (p.includes('no claims') && p.includes('verifying'))
            || (p.includes('verifying your question'))) {
            if (!steps.s1?.classList.contains('done')) markDone(steps.s1);
            if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
            if (!steps.s3?.classList.contains('done')) markDone(steps.s3);
            clearSteps(5);
            markActive(steps.s4);
            return;
        }

        if (p.includes('fact-checking') || p.includes('verifying') || p.includes('deep fact') || p.includes('deep fact-checking') || p.includes('checking claim')) {
            if (!steps.s1?.classList.contains('done')) markDone(steps.s1);
            if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
            if (!steps.s3?.classList.contains('done')) markDone(steps.s3);
            clearSteps(5);
            markActive(steps.s4);
            return;
        }

        if (p === 'completed!' || p.includes('generating report') || p.includes('complete')) {
            if (!steps.s1?.classList.contains('done')) markDone(steps.s1);
            if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
            if (!steps.s3?.classList.contains('done')) markDone(steps.s3);
            if (!steps.s4?.classList.contains('done')) markDone(steps.s4);
            if (!steps.s5?.classList.contains('done')) { markDone(steps.s5); }
        }
        return;
    }

    // Video mode steps
    if ((p.includes('starting') && !p.includes('verification')) || 
        p.includes('getting video') || 
        p.includes('video info') && !p.includes('obtained') && !p.includes('fetched')) {
        clearSteps(2);
        markActive(steps.s1);
        return;
    }

    if (!steps.s1?.classList.contains('done')) markDone(steps.s1);

    if (p.includes('checking captions') || p.includes('fetching transcript') || p.includes('transcribing') || p.includes('video info obtained') || p.includes('obtaining transcript') || (p.includes('transcript') && p.includes('...'))) {
        clearSteps(3);
        markActive(steps.s2);
        return;
    }

    if (p.includes('trying backup') || p.includes('download')) {
        clearSteps(4);
        markActive(steps.s3);
        return;
    }

    if (p.includes('reading metadata') || p.includes('transcript unavailable') || p.includes('metadata only')) {
        if (!steps.s1?.classList.contains('done')) markDone(steps.s1);
        if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
        if (!steps.s3?.classList.contains('done')) markDone(steps.s3);
        clearSteps(5);
        markActive(steps.s4);
        return;
    }

    if (p.includes('transcript obtained') || p.includes('transcript!')) {
        if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
    }

    if (p.includes('extracting claims')) {
        if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
        if (!steps.s3?.classList.contains('done')) markDone(steps.s3);
        clearSteps(5);
        markActive(steps.s4);
        return;
    }

    if ((p.includes('found') && p.includes('claims') && p.includes('starting verification')) || 
        (p.includes('found') && p.includes('claims') && !p.includes('extracting')) ||
        (p.includes('starting verification'))) {
        if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
        if (!steps.s3?.classList.contains('done')) markDone(steps.s3);
        clearSteps(5);
        markActive(steps.s4);
        return;
    }

    if (p.includes('fact-checking') || p.includes('verifying') || p.includes('deep fact') || p.includes('deep fact-checking') || p.includes('checking claim')) {
        if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
        if (!steps.s3?.classList.contains('done')) markDone(steps.s3);
        clearSteps(5);
        markActive(steps.s4);
        return;
    }

    if (p === 'completed!' || p.includes('generating report') || p.includes('complete')) {
        if (!steps.s1?.classList.contains('done')) markDone(steps.s1);
        if (!steps.s2?.classList.contains('done')) markDone(steps.s2);
        if (!steps.s3?.classList.contains('done')) markDone(steps.s3);
        if (!steps.s4?.classList.contains('done')) markDone(steps.s4);
        if (!steps.s5?.classList.contains('done')) { markDone(steps.s5); }
    }
}

// ─── Render Results ───
function renderResults(report) {
    _currentReportId = report.id;
    _currentReportData = report;

    const shareUrl = `${window.location.origin}/report/${report.id}`;
    document.getElementById('report-url').textContent = shareUrl;

    const platformLabel = { youtube: '📺 YouTube', twitter: '🐦 Twitter', tiktok: '🎵 TikTok', facebook: '📘 Facebook', vimeo: '🎥 Vimeo', instagram: '📷 Instagram', text: '📝 Text' };
    const pf = platformLabel[report.platform] || report.platform || 'Source';
    document.getElementById('results-title').textContent = report.title
        ? `${pf} — ${report.title.replace(/^Fact-Check:\s*/, '').replace(/["']/g, '').substring(0, 60)}`
        : `${pf} Fact-Check Report`;

    // Video Info Card (YouTube + platforms with thumbnails)
    const infoCard = document.getElementById('video-info-card');
    if (report.video_id && report.platform === 'youtube') {
        const durationStr = report.duration ? formatDuration(report.duration) : '';
        infoCard.style.display = 'flex';
        infoCard.innerHTML = `
            ${report.thumbnail_url
                ? `<img src="${escapeHtml(report.thumbnail_url)}" alt="Video thumbnail" loading="lazy" onerror="this.parentElement.removeChild(this)">`
                : `<div class="history-thumb-placeholder">🎬</div>`}
            <div class="video-info-text">
                <h3>${escapeHtml(report.title || 'YouTube Video')}</h3>
                <div class="video-meta">
                    ${report.author ? `<span>${escapeHtml(report.author)}</span> · ` : ''}
                    ${durationStr ? `<span>${durationStr}</span> · ` : ''}
                    <span class="platform-icon">📺</span>
                    <span>YouTube</span>
                </div>
            </div>
        `;
    } else {
        infoCard.style.display = 'none';
    }

    // Platform-specific source card (text, tweet, etc.)
    renderSourceCard(report);

    // Summary
    const summaryEl = document.getElementById('report-summary');
    if (report.summary) {
        summaryEl.innerHTML = '<strong>Summary:</strong> ' + report.summary.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    } else {
        summaryEl.textContent = 'No summary available.';
    }

    // Always show video + sync for YouTube videos
    const syncLayout = document.getElementById('video-sync-layout');
    const timeline = document.getElementById('claim-timeline');

    if (report.video_id && report.platform === 'youtube') {
        syncLayout.style.display = 'flex';
        timeline.style.display = 'block';
        initYouTubeSync(report.video_id, report.claims || []);
        renderClaimTimeline(report.claims || []);
    } else {
        syncLayout.style.display = 'none';
        timeline.style.display = 'none';
    }

    // Score Card
    renderScoreCard(report);

    // Show filter bar if claims exist
    const filterBar = document.getElementById('filter-bar');
    const claims = report.claims || [];
    filterBar.style.display = claims.length > 0 ? 'flex' : 'none';

    // Render claims
    const claimsList = document.getElementById('claims-list');
    claimsList.innerHTML = '';

    if (claims.length === 0) {
        claimsList.innerHTML = '<div class="claim-card" style="text-align:center;padding:40px 24px;"><p style="color:var(--text-muted);">No factual claims were identified in this video.</p></div>';
        filterBar.style.display = 'none';
    } else {
        claims.forEach((claim, i) => claimsList.appendChild(createClaimCard(claim, i)));
    }

    // Update URL
    window.history.pushState({ page: 'results' }, '', `/report/${report.id}`);

    navigateTo('results');
}

// ─── Platform-Specific Source Card ───
function renderSourceCard(report) {
    const card = document.getElementById('source-card');
    if (!card) return;
    const platform = report.platform || '';
    const icon = getPlatformIcon(platform);
    let label = 'Source';
    let content = '';

    if (platform === 'text') {
        label = '📝 Text Fact-Check';
        const text = report.transcript || report.title?.replace('Fact-Check: "', '').replace('"', '') || '';
        content = `<div class="source-text-content">${escapeHtml(text)}</div>`;
        card.style.display = 'block';
    } else if (platform === 'twitter') {
        label = '🐦 Tweet Fact-Check';
        const tweetText = report.transcript || '';
        content = `
            ${report.author ? `<div class="source-tweet-author">${escapeHtml(report.author)}</div>` : ''}
            <div class="source-text-content">${escapeHtml(tweetText)}</div>
        `;
        card.style.display = 'block';
    } else if (platform === 'tiktok') {
        label = '🎵 TikTok Fact-Check';
        content = `<div class="source-text-content">${escapeHtml(report.title || 'TikTok Video')}</div>`;
        card.style.display = 'block';
    } else if (platform === 'instagram') {
        label = '📷 Instagram Fact-Check';
        content = `<div class="source-text-content">${escapeHtml(report.title || 'Instagram Post')}</div>`;
        card.style.display = 'block';
    } else if (platform === 'facebook') {
        label = '📘 Facebook Fact-Check';
        content = `<div class="source-text-content">${escapeHtml(report.title || 'Facebook Video')}</div>`;
        card.style.display = 'block';
    } else if (platform === 'vimeo') {
        label = '🎥 Vimeo Fact-Check';
        content = `<div class="source-text-content">${escapeHtml(report.title || 'Vimeo Video')}</div>`;
        card.style.display = 'block';
    } else {
        card.style.display = 'none';
        return;
    }

    card.innerHTML = `
        <div class="source-card-header">
            <span class="source-card-label">${label}</span>
        </div>
        ${content}
    `;
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    return `${m}:${s.toString().padStart(2,'0')}`;
}

function getPlatformIcon(platform) {
    const icons = { youtube: '📺', tiktok: '🎵', twitter: '🐦', facebook: '📘', vimeo: '🎥', instagram: '📷' };
    return icons[platform] || '🌐';
}

// ─── Score Card ───
function renderScoreCard(report) {
    const card = document.getElementById('score-card');
    const claims = report.claims || [];
    if (!claims.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const total = claims.length;
    const trueC = claims.filter(c => c.verdict === 'TRUE').length;
    const falseC = claims.filter(c => c.verdict === 'FALSE').length;
    const misleadingC = claims.filter(c => c.verdict === 'MISLEADING').length;
    const unverifiableC = claims.filter(c => c.verdict === 'UNVERIFIABLE').length;

    document.getElementById('score-true').textContent = trueC;
    document.getElementById('score-false').textContent = falseC;
    document.getElementById('score-misleading').textContent = misleadingC;
    document.getElementById('score-unverifiable').textContent = unverifiableC;

    // Truth score: percentage of TRUE claims, with FALSE penalizing
    const truthRatio = total > 0 ? Math.round((trueC / total) * 100) : 0;
    document.getElementById('score-value').textContent = truthRatio + '%';

    // Score ring animation
    const circumference = 326.73; // 2 * pi * 52
    const offset = circumference - (truthRatio / 100) * circumference;
    const ring = document.getElementById('score-ring-fill');
    requestAnimationFrame(() => {
        ring.style.strokeDashoffset = offset;
    });

    // Rating
    const rating = document.getElementById('score-rating');
    let ratingText, ratingClass;
    if (truthRatio >= 80) {
        ratingText = `✅ Trustworthy — ${truthRatio}% of claims verified true`;
        ratingClass = 'trustworthy';
    } else if (truthRatio >= 50) {
        ratingText = `⚠️ Mixed — ${truthRatio}% of claims verified true. Stay critical.`;
        ratingClass = 'mixed';
    } else if (truthRatio > 0) {
        ratingText = `❌ Untrustworthy — Only ${truthRatio}% of claims verified true`;
        ratingClass = 'untrustworthy';
    } else {
        ratingText = `❓ Unverifiable — No claims could be verified`;
        ratingClass = 'unverifiable';
    }
    rating.textContent = ratingText;
    rating.className = 'score-rating ' + ratingClass;

    // Color the ring based on score
    const ringColor = truthRatio >= 80 ? '#22d65e' : truthRatio >= 50 ? '#f5a80b' : truthRatio > 0 ? '#ef4455' : '#70707e';
    ring.style.stroke = ringColor;
}

// ─── YouTube Sync Engine ───
let ytPlayer = null;
let ytSyncInterval = null;
let ytClaims = [];
// (ytShownClaims removed — replaced by _claimLastInRange tracking)
let ytVideoId = null;
let _lastPausedTime = 0;

function initYouTubeSync(videoId, claims) {
    cleanupYouTubeSync();
    ytVideoId = videoId;
    ytClaims = claims.map((c, i) => ({
        ...c,
        _id: i,
        _visible: false,
        time_start: c.time_start || 0,
        time_end: c.time_end || 10,
    }));

    // Clear sidebar
    const sidebar = document.getElementById('sidebar-claims');
    sidebar.innerHTML = '';
    document.getElementById('sidebar-empty').style.display = 'block';

    // Create or load player
    const playerDiv = document.getElementById('youtube-player');
    playerDiv.innerHTML = '';

    if (typeof YT !== 'undefined' && YT.Player) {
        createPlayer(videoId, playerDiv);
    } else {
        window._ytQueue = { videoId, playerDiv };
    }
}

function onYouTubeIframeAPIReady() {
    if (window._ytQueue) {
        createPlayer(window._ytQueue.videoId, window._ytQueue.playerDiv);
        window._ytQueue = null;
    }
}

function createPlayer(videoId, container) {
    ytPlayer = new YT.Player(container, {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
        },
        events: {
            onReady: () => { startSyncLoop(); },
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.PLAYING) {
                    document.getElementById('pause-factcheck-btn').classList.remove('visible');
                    startSyncLoop();
                } else if (e.data === YT.PlayerState.PAUSED) {
                    showAllClaimsInSidebar();
                    // Record paused time for fact-check button
                    if (ytPlayer && ytPlayer.getCurrentTime) {
                        _lastPausedTime = ytPlayer.getCurrentTime();
                        const claimAtTime = findClaimAtTime(_lastPausedTime);
                        if (claimAtTime) {
                            document.getElementById('pause-factcheck-btn').classList.add('visible');
                        }
                    }
                } else if (e.data === YT.PlayerState.ENDED) {
                    document.getElementById('pause-factcheck-btn').classList.remove('visible');
                }
            }
        }
    });
}

function findClaimAtTime(time) {
    return ytClaims.find(c => time >= c.time_start && time <= c.time_end + 3);
}

function factCheckPausedMoment() {
    // Scroll to the claim at the paused time and open it
    if (!ytPlayer) return;
    const time = ytPlayer.getCurrentTime();
    const claim = findClaimAtTime(time);
    if (!claim) { showToast('No claim at this timestamp'); return; }

    const claimIndex = ytClaims.indexOf(claim);
    const cards = document.querySelectorAll('.claim-card');
    if (cards[claimIndex]) {
        // Scroll to the claim
        cards[claimIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Expand it if not expanded
        if (!cards[claimIndex].classList.contains('expanded')) {
            cards[claimIndex].classList.add('expanded');
        }
        // Highlight it briefly
        cards[claimIndex].style.borderColor = 'var(--primary)';
        setTimeout(() => { cards[claimIndex].style.borderColor = ''; }, 2000);
        showToast(`⚡ Fact-checking claim at ${formatTime(time)}`);
    }
    document.getElementById('pause-factcheck-btn').classList.remove('visible');
}

function startSyncLoop() {
    if (ytSyncInterval) clearInterval(ytSyncInterval);
    ytSyncInterval = setInterval(syncSidebar, 500);
}

// Track when each claim was last in range (for fade timing)
let _claimLastInRange = {};

function syncSidebar() {
    if (!ytPlayer || !ytPlayer.getCurrentTime) return;
    const currentTime = ytPlayer.getCurrentTime();
    const now = Date.now();

    const sidebar = document.getElementById('sidebar-claims');
    const empty = document.getElementById('sidebar-empty');
    const timeoutMs = 2000; // fade after 2s out of range

    let anyVisible = false;

    ytClaims.forEach((claim, i) => {
        const inRange = currentTime >= claim.time_start && currentTime <= claim.time_end + 2;
        const claimId = `sc-${i}`;
        let el = document.getElementById(claimId);

        if (inRange) {
            anyVisible = true;
            empty.style.display = 'none';
            _claimLastInRange[claimId] = now;

            if (!el) {
                el = document.createElement('div');
                el.id = claimId;
                el.className = 'sidebar-claim visible';

                const fullText = escapeHtml(claim.claim || claim.text || '');
                const shortText = fullText.length > 60 ? fullText.substring(0, 60) + '...' : fullText;

                el.innerHTML = `
                    <div class="sc-badge ${claim.verdict?.toLowerCase() || 'unverifiable'}">${claim.verdict || 'UNVERIFIABLE'}</div>
                    <div class="sc-text">${shortText}</div>
                    <div class="sc-full" style="display:none;">${fullText}</div>
                    <div class="sc-time">${formatTime(claim.time_start)} — ${formatTime(claim.time_end)}</div>
                    ${fullText.length > 60 ? '<button class="sc-expand" onclick="toggleSC(this)">▼ More</button>' : ''}
                `;
                el.style.cursor = 'pointer';
                el.onclick = (e) => {
                    if (e.target.closest('.sc-expand')) return;
                    if (ytPlayer && ytPlayer.seekTo && claim.time_start > 0) {
                        ytPlayer.seekTo(claim.time_start, true);
                        if (ytPlayer.playVideo) ytPlayer.playVideo();
                    }
                };
                sidebar.appendChild(el);
            } else {
                // Remove fading if it was fading
                el.classList.remove('fading');
                el.classList.add('visible');
            }
        } else if (el) {
            // Out of range — check if it's been out for more than timeout
            const lastSeen = _claimLastInRange[claimId] || 0;
            const elapsed = now - lastSeen;
            if (elapsed > timeoutMs && el.classList.contains('visible')) {
                el.classList.remove('visible');
                el.classList.add('fading');
                setTimeout(() => {
                    const e = document.getElementById(claimId);
                    if (e && e.classList.contains('fading')) {
                        if (e.parentNode) e.parentNode.removeChild(e);
                        delete _claimLastInRange[claimId];
                    }
                }, 600);
            }
        }
    });

    if (!anyVisible) {
        const hasChildren = sidebar.children.length > 0;
        if (!hasChildren) empty.style.display = 'block';
    }
}

function toggleSC(btn) {
    const claim = btn.closest('.sidebar-claim');
    if (!claim) return;
    const full = claim.querySelector('.sc-full');
    const text = claim.querySelector('.sc-text');
    if (!full || !text) return;
    if (full.style.display === 'none') {
        full.style.display = 'block';
        text.style.display = 'none';
        btn.textContent = '▲ Less';
    } else {
        full.style.display = 'none';
        text.style.display = 'block';
        btn.textContent = '▼ More';
    }
}

function showAllClaimsInSidebar() {
    const sidebar = document.getElementById('sidebar-claims');
    const empty = document.getElementById('sidebar-empty');
    sidebar.innerHTML = '';
    empty.style.display = 'none';

    ytClaims.forEach((claim, i) => {
        const claimId = `sc-${i}`;
        const el = document.createElement('div');
        el.id = claimId;
        el.className = 'sidebar-claim visible';
        const fullText = escapeHtml(claim.claim || claim.text || '');
        const shortText = fullText.length > 60 ? fullText.substring(0, 60) + '...' : fullText;
        el.innerHTML = `
            <div class="sc-badge ${claim.verdict?.toLowerCase() || 'unverifiable'}">${claim.verdict || 'UNVERIFIABLE'}</div>
            <div class="sc-text">${shortText}</div>
            <div class="sc-full" style="display:none;">${fullText}</div>
            <div class="sc-time">${formatTime(claim.time_start)} — ${formatTime(claim.time_end)}</div>
            ${fullText.length > 60 ? '<button class="sc-expand" onclick="toggleSC(this)">▼ More</button>' : ''}
        `;
        el.style.cursor = 'pointer';
        el.onclick = (e) => {
            if (e.target.closest('.sc-expand')) return;
            if (ytPlayer && ytPlayer.seekTo && claim.time_start > 0) {
                ytPlayer.seekTo(claim.time_start, true);
                if (ytPlayer.playVideo) ytPlayer.playVideo();
            }
        };
        sidebar.appendChild(el);
    });
}

// ─── Completion Overlay ───
function showCompletionOverlay(report) {
    const overlay = document.getElementById('completion-overlay');
    if (!overlay) return;
    const claims = report.claims || [];
    document.getElementById('completion-claim-count').textContent = `${claims.length} claims analyzed`;
    const total = claims.length;
    const trueC = claims.filter(c => c.verdict === 'TRUE').length;
    const truthRatio = total > 0 ? Math.round((trueC / total) * 100) : 0;
    document.getElementById('completion-pct').textContent = truthRatio + '%';
    const ring = document.getElementById('completion-ring');
    const circumference = 213.63;
    const offset = circumference - (truthRatio / 100) * circumference;
    requestAnimationFrame(() => { ring.style.strokeDashoffset = offset; });
    const color = truthRatio >= 80 ? '#22d65e' : truthRatio >= 50 ? '#f5a80b' : truthRatio > 0 ? '#ef4455' : '#70707e';
    ring.style.stroke = color;
    overlay.style.display = 'flex';
}
function closeCompletionOverlay() {
    const overlay = document.getElementById('completion-overlay');
    if (overlay) overlay.style.display = 'none';
}

function cleanupYouTubeSync() {
    if (ytSyncInterval) { clearInterval(ytSyncInterval); ytSyncInterval = null; }
    ytClaims = [];
    _claimLastInRange = {};
    _lastPausedTime = 0;
    hideScanningOverlay();
    hideLiveAnalysis();
    if (_scanningTimer) { clearTimeout(_scanningTimer); _scanningTimer = null; }
}

function formatTime(seconds) {
    if (seconds == null) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Claim Timeline ───
function renderClaimTimeline(claims) {
    const track = document.getElementById('timeline-track');
    track.innerHTML = '';

    if (!claims || claims.length === 0) return;

    claims.forEach((claim, i) => {
        const dot = document.createElement('div');
        dot.className = 'timeline-dot';
        dot.onclick = () => {
            const cards = document.querySelectorAll('.claim-card');
            if (cards[i]) cards[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (ytPlayer && ytPlayer.seekTo && claim.time_start > 0) {
                ytPlayer.seekTo(claim.time_start, true);
                if (ytPlayer.playVideo) ytPlayer.playVideo();
            }
        };
        dot.innerHTML = `
            <div class="td-time">${formatTime(claim.time_start)}</div>
            <div class="td-badge ${claim.verdict?.toLowerCase() || 'unverifiable'}">${claim.verdict?.[0] || '?'}</div>
            <div class="td-text">${escapeHtml((claim.claim || claim.text || '').substring(0, 22))}</div>
        `;
        track.appendChild(dot);
    });
}

// ─── Claim Filtering ───
let _currentFilter = 'all';

function filterClaims(filter) {
    _currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));

    const cards = document.querySelectorAll('.claim-card');
    const claims = _currentReportData?.claims || [];

    cards.forEach((card, i) => {
        const claim = claims[i];
        if (!claim) return;
        const verdict = (claim.verdict || '').toLowerCase();

        if (filter === 'all') {
            card.classList.remove('hidden');
        } else if (filter === 'true') {
            card.classList.toggle('hidden', verdict !== 'true');
        } else if (filter === 'false') {
            card.classList.toggle('hidden', verdict !== 'false');
        } else if (filter === 'misleading') {
            card.classList.toggle('hidden', verdict !== 'misleading');
        } else if (filter === 'unverifiable') {
            card.classList.toggle('hidden', verdict !== 'unverifiable');
        }
    });
}

// ─── Create Claim Card ───
function createClaimCard(claim) {
    const card = document.createElement('div');
    card.className = 'claim-card';
    if (claim.time_start > 0) card.dataset.time = claim.time_start;

    const verdict = (claim.verdict || 'UNVERIFIABLE').toLowerCase();
    const badgeLabel = verdict.toUpperCase();
    const confidence = (claim.confidence || 'low').toLowerCase();
    const claimText = claim.claim || claim.text || '';
    const contextText = claim.context || '';

    const sourcesHtml = (claim.sources && claim.sources.length > 0)
        ? claim.sources.map(s => `
            <li class="claim-source">
                <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a>
                ${s.relevance ? `<div class="claim-source-relevance">${escapeHtml(s.relevance)}</div>` : ''}
            </li>
        `).join('')
        : '<li class="claim-source" style="color:var(--text-muted)">No sources available</li>';

    const timeStr = claim.time_start != null
        ? `<span class="claim-timestamp">⏱ ${formatTime(claim.time_start)} — ${formatTime(claim.time_end)}</span>`
        : '';

    const hasTimestamp = ytPlayer && claim.time_start > 0;

    card.innerHTML = `
        <div class="claim-header" onclick="toggleClaim(this)">
            <span class="claim-badge ${verdict}">${badgeLabel}</span>
            <span class="claim-text">${escapeHtml(claimText)}</span>
            ${hasTimestamp ? `<span class="claim-seek-hint">▶ ${formatTime(claim.time_start)}</span>` : ''}
            <span class="claim-expand">▼</span>
        </div>
        <div class="claim-body">
            <div class="claim-meta-bar">
                <span class="claim-category">${escapeHtml(claim.category || 'General')}</span>
                ${timeStr}
                ${contextText ? `<span class="claim-category">${escapeHtml(contextText.substring(0, 60))}</span>` : ''}
            </div>
            <div class="confidence-meter">
                <span class="confidence-label ${confidence}">${confidence.charAt(0).toUpperCase() + confidence.slice(1)}</span>
                <div class="confidence-bar-bg">
                    <div class="confidence-bar-fill ${confidence}"></div>
                </div>
            </div>
            ${claim.key_evidence ? `
            <div class="claim-detail">
                <div class="claim-detail-label">Key Evidence</div>
                <div class="claim-key-evidence">${escapeHtml(claim.key_evidence)}</div>
            </div>` : ''}
            <div class="claim-detail">
                <div class="claim-detail-label">Explanation</div>
                <div class="claim-explanation">${escapeHtml(claim.explanation || 'No explanation available')}</div>
            </div>
            <div class="claim-detail">
                <div class="claim-detail-label">Sources (${claim.sources?.length || 0})</div>
                <ul class="claim-sources">${sourcesHtml}</ul>
            </div>
            <div class="claim-actions">
                <button class="claim-action-btn" onclick="copyClaimEvidence(event, this)">📋 Copy Evidence</button>
                ${hasTimestamp ? `<button class="claim-action-btn" onclick="jumpToClaim(event, ${claim.time_start})">▶ Jump to ${formatTime(claim.time_start)}</button>` : ''}
            </div>
        </div>
    `;
    return card;
}

function jumpToClaim(event, time) {
    event.stopPropagation();
    if (ytPlayer && ytPlayer.seekTo) {
        if (time > 0) {
            ytPlayer.seekTo(time, true);
            if (ytPlayer.playVideo) ytPlayer.playVideo();
        } else {
            showToast('⏱ No specific timestamp for this claim');
        }
    }
}

function toggleClaim(header) {
    const card = header.closest('.claim-card');
    if (!card) return;
    card.classList.toggle('expanded');
    // Seek to timestamp on click
    const time = parseFloat(card.dataset.time);
    if (ytPlayer && ytPlayer.seekTo && time > 0) {
        ytPlayer.seekTo(time, true);
        if (ytPlayer.playVideo) ytPlayer.playVideo();
    }
}

// ─── Copy Claim Evidence ───
function copyClaimEvidence(event, btn) {
    event.stopPropagation();
    const card = btn.closest('.claim-card');
    if (!card) return;

    const getText = (sel) => card.querySelector(sel)?.textContent?.trim() || '';
    const badge = card.querySelector('.claim-badge')?.textContent?.trim() || 'UNVERIFIABLE';
    const claimText = card.querySelector('.claim-text')?.textContent?.trim() || '';
    const explanation = card.querySelector('.claim-explanation')?.textContent?.trim() || '';
    const evidence = card.querySelector('.claim-key-evidence')?.textContent?.trim() || '';

    let text = `Claim: ${claimText}\nVerdict: ${badge}\n`;
    if (evidence) text += `Key Evidence: ${evidence}\n`;
    text += `Explanation: ${explanation}\n`;

    const sources = card.querySelectorAll('.claim-source a');
    if (sources.length > 0) {
        text += 'Sources:\n';
        sources.forEach(a => { text += `  - ${a.textContent.trim()} (${a.href})\n`; });
    }

    navigator.clipboard.writeText(text).then(() => showToast('Claim evidence copied!'))
        .catch(() => showToast('Could not copy'));
}

// ─── Export .txt Report ───
function exportTxt() {
    const report = _currentReportData;
    if (!report) { showToast('No report data to export'); return; }

    let text = '═══════════════════════════════════════════\n';
    text += '  ClipCheck Fact-Check Report\n';
    text += '═══════════════════════════════════════════\n\n';
    text += `Video URL: ${report.video_url}\n`;
    text += `Date: ${new Date(report.completed_at || report.created_at).toLocaleString()}\n`;
    text += `Platform: ${report.platform || 'Unknown'}\n`;
    if (report.title) text += `Title: ${report.title}\n`;
    if (report.author) text += `Author: ${report.author}\n`;
    if (report.duration) text += `Duration: ${formatDuration(report.duration)}\n`;
    text += '\n';

    if (report.summary) {
        text += `Summary: ${report.summary.replace(/\*\*/g, '')}\n\n`;
    }

    text += '───────────────────────────────────────────\n';
    text += '  CLAIMS ANALYSIS\n';
    text += '───────────────────────────────────────────\n\n';

    const claims = report.claims || [];
    if (claims.length === 0) {
        text += 'No factual claims were identified in this video.\n';
    } else {
        claims.forEach((claim, i) => {
            text += `[${i + 1}] ${claim.claim || claim.text || ''}\n`;
            text += `    Verdict: ${claim.verdict || 'UNVERIFIABLE'} (${(claim.confidence || 'LOW').toUpperCase()} confidence)\n`;
            text += `    Category: ${claim.category || 'General'}\n`;
            if (claim.time_start != null) text += `    Timestamp: ${formatTime(claim.time_start)} — ${formatTime(claim.time_end)}\n`;
            if (claim.key_evidence) text += `    Evidence: ${claim.key_evidence}\n`;
            if (claim.explanation) text += `    Explanation: ${claim.explanation}\n`;

            if (claim.sources && claim.sources.length > 0) {
                text += `    Sources:\n`;
                claim.sources.forEach(s => {
                    text += `      - ${s.title || 'Untitled'}\n`;
                    text += `        ${s.url}\n`;
                });
            }
            text += '\n';
        });
    }

    text += '───────────────────────────────────────────\n';
    text += '  Report generated by ClipCheck\n';
    text += '  https://clipcheck.app\n';
    text += '  Results are AI-generated.\n';
    text += '═══════════════════════════════════════════\n';

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clipcheck-report-${report.id?.substring(0, 8) || 'report'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Report downloaded!');
}

// ─── Share Link ───
async function copyShareLink() {
    const id = _currentReportId;
    if (!id) return;
    const url = `${window.location.origin}/report/${id}`;
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard!');
    } catch {
        const ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Link copied to clipboard!');
    }
}

// ─── History ───
let _selectedForCompare = new Set();

async function loadHistory() {
    const list = document.getElementById('history-list');
    _selectedForCompare.clear();
    updateCompareBar();

    try {
        const response = await fetch(`${API_BASE}/api/reports?session_id=${encodeURIComponent(getSessionId())}`);
        if (!response.ok) { list.innerHTML = '<div class="history-empty"><p>Could not load history</p></div>'; return; }
        const reports = await response.json();

        if (!reports || reports.length === 0) {
            list.innerHTML = '<div class="history-empty"><p>No fact-checks yet.</p><a href="/" class="btn btn-primary" style="margin-top:16px;display:inline-block;text-decoration:none;" onclick="navigateTo(\'home\')">Check a video</a></div>';
            return;
        }

        list.innerHTML = reports.map(r => {
            const statusClass = r.status === 'completed' ? 'completed' : r.status === 'processing' ? 'processing' : 'failed';
            const time = r.completed_at || r.created_at;
            const dateStr = time ? new Date(time).toLocaleString() : '';
            const canCompare = r.status === 'completed';
            const platformIcon = getPlatformIcon(r.platform);

            return `
                <div class="history-card ${canCompare ? 'selectable' : ''}" data-id="${escapeHtml(r.id)}">
                    <div class="history-card-left">
                        ${canCompare ? `<input type="checkbox" class="history-checkbox" data-id="${escapeHtml(r.id)}" onchange="toggleCompare(this)" ${_selectedForCompare.has(r.id) ? 'checked' : ''}>` : ''}
                        ${r.thumbnail_url
                            ? `<img class="history-thumb" src="${escapeHtml(r.thumbnail_url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'history-thumb-placeholder\\'>${platformIcon}</div>'">`
                            : `<div class="history-thumb-placeholder">${platformIcon}</div>`}
                        <div class="history-card-info" onclick="${canCompare ? `loadReport(${JSON.stringify(r.id)})` : ''}" style="${canCompare ? 'cursor:pointer' : ''}">
                            <div class="history-card-title">${escapeHtml(r.title || r.video_url.substring(0, 50))}</div>
                            <div class="history-card-url">${escapeHtml(r.video_url)}</div>
                            <div class="history-card-meta">
                                <span>${dateStr}</span>
                                <span>${platformIcon} ${r.platform || 'Unknown'}</span>
                                ${r.progress ? `<span>${escapeHtml(r.progress)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="history-card-status">
                        <span class="status-badge ${statusClass}">${r.status}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('History error:', err);
        list.innerHTML = '<div class="history-empty"><p>Error loading history</p></div>';
    }
}

function toggleCompare(checkbox) {
    const id = checkbox.dataset.id;
    if (checkbox.checked) _selectedForCompare.add(id);
    else _selectedForCompare.delete(id);
    updateCompareBar();
}

function updateCompareBar() {
    const bar = document.getElementById('compare-bar');
    const count = document.getElementById('compare-count');
    const size = _selectedForCompare.size;
    bar.style.display = size > 0 ? 'flex' : 'none';
    count.textContent = `${size} selected (need 2 to compare)`;
}

function clearCompare() {
    _selectedForCompare.clear();
    document.querySelectorAll('.history-checkbox').forEach(c => c.checked = false);
    updateCompareBar();
}

async function compareReports() {
    if (_selectedForCompare.size !== 2) {
        showToast('Please select exactly 2 reports to compare');
        return;
    }
    const ids = [..._selectedForCompare];
    try {
        const r1 = await fetch(`${API_BASE}/api/report/${ids[0]}`).then(r => r.json());
        const r2 = await fetch(`${API_BASE}/api/report/${ids[1]}`).then(r => r.json());
        renderCompare(r1, r2);
    } catch (err) {
        console.error(err);
        showToast('Error loading reports for comparison');
    }
}

function renderCompare(r1, r2) {
    const col1 = document.getElementById('compare-col-1');
    const col2 = document.getElementById('compare-col-2');

    [col1, col2].forEach((col, i) => {
        const r = i === 0 ? r1 : r2;
        col.innerHTML = `
            <div class="results-header">
                <div class="results-meta">
                    <span class="results-label">Report ${i + 1}</span>
                </div>
                ${r.title ? `<div style="font-size:0.9rem;font-weight:600;margin-bottom:8px;">${escapeHtml(r.title)}</div>` : ''}
                <div class="report-summary">${r.summary ? r.summary.replace(/\*\*/g, '') : 'No summary'}</div>
            </div>
            <div class="claims-list">
                ${(r.claims || []).map(c => `
                    <div class="claim-card" style="margin-bottom:8px;">
                        <div class="claim-header" style="padding:12px 16px;">
                            <span class="claim-badge ${(c.verdict||'').toLowerCase()}">${(c.verdict||'UNVERIFIABLE').toUpperCase()}</span>
                            <span class="claim-text" style="font-size:0.85rem;">${escapeHtml(c.claim || c.text || '')}</span>
                            <span style="font-size:0.7rem;color:var(--text-muted);flex-shrink:0;">${c.time_start != null ? formatTime(c.time_start) : ''}</span>
                        </div>
                    </div>
                `).join('') || '<p style="color:var(--text-muted);padding:16px;">No claims</p>'}
            </div>
        `;
    });

    navigateTo('compare');
    showPage('compare');
    updateNavActive('');
}

async function loadReport(reportId) {
    navigateTo('processing');
    resetProgress();
    updateProgress('Loading report...');
    try {
        const r = await fetch(`${API_BASE}/api/report/${reportId}`);
        if (!r.ok) throw new Error('Not found');
        const report = await r.json();
        if (report.status === 'completed') {
            _currentReportId = report.id;
            _currentReportData = report;
            updateProgress('✅ Loaded!');
            updateProgressBar(100);
            stopFunFacts();
            await new Promise(r => setTimeout(r, 300));
            renderResults(report);
        } else {
            await pollReport(reportId);
        }
    } catch (err) {
        showError('Could not load report');
    }
}

// ─── Error ───
function showError(message, report) {
    const titleEl = document.getElementById('error-title');
    const detailEl = document.getElementById('error-message');

    // Check for TRANSCRIPT_UNAVAILABLE error code
    if (report && report.errorCode === 'TRANSCRIPT_UNAVAILABLE') {
        titleEl.textContent = 'Transcript not available';
        detailEl.innerHTML = message + (report.suggestion ? '<br><br>' + report.suggestion : '');
        navigateTo('error');
        return;
    }

    if (message) {
        const msg = message.trim();
        const isTranscriptError = /transcript|captions|subtitles/i.test(msg);
        const isNetworkError = /network|fetch|timeout|connect/i.test(msg);
        const isApiError = /api key|rate.limit|quota|model/i.test(msg);
        if (isTranscriptError) {
            titleEl.textContent = 'Could not get video transcript';
        } else if (isNetworkError) {
            titleEl.textContent = 'Network error';
        } else if (isApiError) {
            titleEl.textContent = 'AI service error';
        } else {
            titleEl.textContent = 'Something went wrong';
        }
        detailEl.textContent = msg;
    } else {
        titleEl.textContent = 'Something went wrong';
        detailEl.textContent = 'An unexpected error occurred.';
    }
    navigateTo('error');
}

// ─── Toast ───
function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─── Utilities ───
function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// ─── Home Page Stats & Recent ───
function updateHomeStats() {
    const bar = document.getElementById('stats-bar');
    if (!bar) return;
    if (_ml.videos === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    document.getElementById('stat-points').textContent = _ml.points;
    document.getElementById('stat-videos').textContent = _ml.videos;
    document.getElementById('stat-claims').textContent = _ml.claims;
    document.getElementById('stat-streak').textContent = _ml.streak > 0 ? `${_ml.streak}d` : '0';
}

async function loadRecentActivity() {
    const section = document.getElementById('recent-section');
    const list = document.getElementById('recent-list');
    if (!section || !list) return;
    try {
        const response = await fetch(`${API_BASE}/api/reports?session_id=${encodeURIComponent(getSessionId())}`);
        if (!response.ok) { section.style.display = 'none'; return; }
        const reports = await response.json();
        if (!reports || reports.length === 0) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        const recent = reports.slice(0, 3);
        list.innerHTML = recent.map(r => {
            const platformIcon = getPlatformIcon(r.platform);
            const time = r.completed_at || r.created_at;
            const dateStr = time ? new Date(time).toLocaleString() : '';
            const statusIcon = r.status === 'completed' ? '✅' : r.status === 'processing' ? '⏳' : '❌';
            return `
                <div class="recent-card" onclick="loadReport('${escapeHtml(r.id)}')">
                    ${r.thumbnail_url
                        ? `<img src="${escapeHtml(r.thumbnail_url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'recent-thumb-placeholder\\'>${platformIcon}</div>'">`
                        : `<div class="recent-thumb-placeholder">${platformIcon}</div>`}
                    <div class="recent-info">
                        <div class="recent-title">${escapeHtml(r.title || r.video_url.substring(0, 40))}</div>
                        <div class="recent-meta">${statusIcon} ${dateStr} · ${platformIcon} ${r.platform || 'Unknown'}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        section.style.display = 'none';
    }
}

// ──────────────────────────────────────────────
//   NEW: Particle Background Animation
// ──────────────────────────────────────────────
function initParticleBg() {
    const canvas = document.getElementById('particle-bg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    let animFrame = null;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = document.body.scrollHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const COUNT = 100;
    particles = Array.from({ length: COUNT }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: 1.5 + Math.random() * 2,
        alpha: 0.08 + Math.random() * 0.15,
    }));

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0) p.x = canvas.width;
            if (p.x > canvas.width) p.x = 0;
            if (p.y < 0) p.y = canvas.height;
            if (p.y > canvas.height) p.y = 0;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(34, 214, 94, ${p.alpha})`;
            ctx.fill();
        });

        // Draw connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 150) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(34, 214, 94, ${0.04 * (1 - dist / 150)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        animFrame = requestAnimationFrame(draw);
    }
    draw();
}

// ──────────────────────────────────────────────
//   NEW: Animated Activity Feed
// ──────────────────────────────────────────────
const ACTIVITY_TEMPLATES = [
    { icon: '📺', text: '<strong>Someone</strong> fact-checked a YouTube video', time: 'just now' },
    { icon: '🐦', text: '<strong>Someone</strong> verified a claim from Twitter', time: '1m ago' },
    { icon: '🎵', text: '<strong>Someone</strong> checked a TikTok video', time: '2m ago' },
    { icon: '✅', text: '<strong>Someone</strong> found a <strong>TRUE</strong> claim about science', time: '3m ago' },
    { icon: '❌', text: '<strong>Someone</strong> busted a <strong>FALSE</strong> viral claim', time: '5m ago' },
    { icon: '📘', text: '<strong>Someone</strong> analyzed a Facebook video', time: '7m ago' },
    { icon: '🔍', text: '<strong>Someone</strong> fact-checked a news clip', time: '8m ago' },
    { icon: '⚠️', text: '<strong>Someone</strong> found a <strong>MISLEADING</strong> statistic', time: '10m ago' },
    { icon: '🧠', text: '<strong>Someone</strong> earned the <strong>Fact Finder</strong> badge', time: '12m ago' },
    { icon: '🔥', text: '<strong>Someone</strong> is on a <strong>5-day streak</strong>!', time: '15m ago' },
];
let _activityInterval = null;

function startActivityFeed() {
    const list = document.getElementById('activity-list');
    if (!list) return;
    if (_activityInterval) clearInterval(_activityInterval);

    // Initial items
    const initial = ACTIVITY_TEMPLATES.slice(0, 4);
    list.innerHTML = initial.map(a => createActivityItem(a)).join('');

    // Add new items periodically
    _activityInterval = setInterval(() => {
        const template = ACTIVITY_TEMPLATES[Math.floor(Math.random() * ACTIVITY_TEMPLATES.length)];
        const item = document.createElement('div');
        item.innerHTML = createActivityItem(template);
        item.className = 'activity-item new';
        item.style.animation = 'none';
        // Force reflow
        void item.offsetHeight;
        item.style.animation = 'slideInItem 0.4s ease';

        if (list.firstChild) {
            list.insertBefore(item, list.firstChild);
        } else {
            list.appendChild(item);
        }

        // Remove old items if too many
        while (list.children.length > 8) {
            list.lastChild.remove();
        }

        // Remove 'new' class after 3s
        setTimeout(() => { item.classList.remove('new'); }, 3000);
    }, 8000);
}

function createActivityItem(a) {
    return `<span class="activity-icon">${a.icon}</span><span class="activity-text">${a.text}</span><span class="activity-time">${a.time}</span>`;
}

function stopActivityFeed() {
    if (_activityInterval) { clearInterval(_activityInterval); _activityInterval = null; }
}

// ──────────────────────────────────────────────
//   NEW: Trending Claims Carousel
// ──────────────────────────────────────────────
const TRENDING_CLAIMS = [
    { claim: '"The Great Wall of China is visible from space with the naked eye"', verdict: 'FALSE', source: 'NASA Astronaut Interviews' },
    { claim: '"Humans only use 10% of their brains"', verdict: 'FALSE', source: 'Neuroscience Research' },
    { claim: '"Octopuses have three hearts"', verdict: 'TRUE', source: 'Marine Biology Studies' },
    { claim: '"Vaccines cause autism"', verdict: 'FALSE', source: 'CDC / WHO Studies' },
    { claim: '"The Earth is 4.5 billion years old"', verdict: 'TRUE', source: 'Geological Evidence' },
    { claim: '"Eating chocolate causes acne"', verdict: 'FALSE', source: 'Dermatology Research' },
    { claim: '"Honey never spoils"', verdict: 'TRUE', source: 'Archaeological Findings' },
    { claim: '"Sharks existed before trees"', verdict: 'TRUE', source: 'Paleontology Records' },
];

function renderTrendingClaims() {
    const el = document.getElementById('trending-carousel');
    if (!el) return;
    el.innerHTML = TRENDING_CLAIMS.map(tc => `
        <div class="trending-card">
            <div class="trending-card-claim">${tc.claim}</div>
            <div class="trending-card-verdict ${tc.verdict.toLowerCase()}">${tc.verdict === 'TRUE' ? '✅' : tc.verdict === 'FALSE' ? '❌' : '⚠️'} ${tc.verdict}</div>
            <div class="trending-card-source">📖 ${tc.source}</div>
        </div>
    `).join('');
}

// ──────────────────────────────────────────────
//   NEW: Gamification Hub (XP, Level, Badges)
// ──────────────────────────────────────────────
const BADGES = [
    { id: 'first_check', icon: '🔍', label: 'First Check', desc: 'Check your first video' },
    { id: 'streak_3', icon: '🔥', label: '3-Day Streak', desc: 'Fact-check 3 days in a row' },
    { id: 'streak_7', icon: '⭐', label: '7-Day Streak', desc: 'Fact-check 7 days in a row' },
    { id: 'ten_checks', icon: '🏅', label: '10 Checks', desc: 'Check 10 videos' },
    { id: 'fifty_claims', icon: '🎯', label: 'Claim Hunter', desc: 'Analyze 50 claims' },
    { id: 'speed_demon', icon: '⚡', label: 'Speed Demon', desc: 'Complete the Speed Round' },
    { id: 'truth_seeker', icon: '✅', label: 'Truth Seeker', desc: 'Find 20 TRUE claims' },
    { id: 'myth_buster', icon: '❌', label: 'Myth Buster', desc: 'Find 20 FALSE claims' },
];

function getXPForLevel(level) {
    return level * 100;
}

function getLevel(xp) {
    let level = 1;
    while (xp >= getXPForLevel(level)) {
        xp -= getXPForLevel(level);
        level++;
    }
    return { level, currentXP: xp, neededXP: getXPForLevel(level), totalXP: xp + (level - 1) * getXPForLevel(level - 1) || 0 };
}

function checkBadges() {
    const earned = [];
    if (_ml.videos >= 1) earned.push('first_check');
    if (_ml.streak >= 3) earned.push('streak_3');
    if (_ml.streak >= 7) earned.push('streak_7');
    if (_ml.videos >= 10) earned.push('ten_checks');
    if (_ml.claims >= 50) earned.push('fifty_claims');
    if (_ml.speedRoundUnlocked) earned.push('speed_demon');
    if (_ml.claims >= 20) earned.push('truth_seeker');
    return earned;
}

function renderGamificationHub() {
    const grid = document.getElementById('gamification-grid');
    const xpFill = document.getElementById('xp-bar-fill');
    const xpText = document.getElementById('xp-text');
    const badgeEl = document.getElementById('badge-showcase');
    if (!grid || !xpFill) return;

    const totalXP = _ml.points;
    const { level, currentXP, neededXP } = getLevel(totalXP);
    const pct = Math.min(100, Math.round((currentXP / neededXP) * 100));

    // Grid stats
    grid.innerHTML = `
        <div class="gamification-card">
            <div class="gamification-card-icon">🧠</div>
            <div class="gamification-card-value">${_ml.points}</div>
            <div class="gamification-card-label">Total XP</div>
        </div>
        <div class="gamification-card">
            <div class="gamification-card-icon">📺</div>
            <div class="gamification-card-value">${_ml.videos}</div>
            <div class="gamification-card-label">Videos Checked</div>
        </div>
        <div class="gamification-card">
            <div class="gamification-card-icon">🔍</div>
            <div class="gamification-card-value">${_ml.claims}</div>
            <div class="gamification-card-label">Claims Analyzed</div>
            <div class="gamification-card-sub">Keep going!</div>
        </div>
        <div class="gamification-card">
            <div class="gamification-card-icon">🔥</div>
            <div class="gamification-card-value">${_ml.streak > 0 ? _ml.streak + 'd' : '—'}</div>
            <div class="gamification-card-label">Best Streak</div>
        </div>
    `;

    // XP Bar
    xpFill.style.width = pct + '%';
    xpText.textContent = `Level ${level} · ${currentXP}/${neededXP} XP`;

    // Badges
    const earned = checkBadges();
    badgeEl.innerHTML = BADGES.map(b => {
        const isEarned = earned.includes(b.id);
        return `
            <div class="badge-item ${isEarned ? 'earned' : 'locked'}">
                ${b.icon}
                <div class="badge-tooltip">${isEarned ? b.desc : '🔒 ' + b.desc}</div>
            </div>
        `;
    }).join('');
}

// ──────────────────────────────────────────────
//   NEW: AI Thinking Indicator
// ──────────────────────────────────────────────
function showAIThinking() {
    const el = document.getElementById('ai-thinking');
    if (el) el.style.display = 'flex';
}

function hideAIThinking() {
    const el = document.getElementById('ai-thinking');
    if (el) el.style.display = 'none';
}

// ──────────────────────────────────────────────
//   NEW: Live Fact-Check Scanning + Analysis
// ──────────────────────────────────────────────
let _scanningTimer = null;

function showScanningOverlay() {
    const overlay = document.getElementById('scanning-overlay');
    if (!overlay) return;
    overlay.classList.add('active');
    // Auto-hide after 2s
    clearTimeout(_scanningTimer);
    _scanningTimer = setTimeout(() => hideScanningOverlay(), 2000);
}

function hideScanningOverlay() {
    const overlay = document.getElementById('scanning-overlay');
    if (overlay) overlay.classList.remove('active');
}

function showLiveAnalysis(claimText, verdict, detail) {
    const panel = document.getElementById('live-analysis');
    const claimEl = document.getElementById('live-analysis-claim');
    const badgeEl = document.getElementById('live-analysis-badge');
    const textEl = document.getElementById('live-analysis-text');
    if (!panel) return;

    if (claimText) claimEl.textContent = `"${claimText}"`;
    if (verdict) {
        const v = verdict.toLowerCase();
        badgeEl.textContent = verdict;
        badgeEl.className = 'live-analysis-badge ' + v;
    }
    if (detail) textEl.textContent = detail;
    panel.classList.add('active');
}

function hideLiveAnalysis() {
    const panel = document.getElementById('live-analysis');
    if (panel) panel.classList.remove('active');
}

// Enhanced factCheckPausedMoment with live scanning
function factCheckPausedMoment() {
    if (!ytPlayer) return;
    const time = ytPlayer.getCurrentTime();
    const claim = findClaimAtTime(time);

    // Show scanning animation
    showScanningOverlay();
    showLiveAnalysis(
        claim ? (claim.claim || claim.text || 'Analyzing...') : 'Analyzing this moment...',
        claim ? (claim.verdict || 'CHECKING') : 'CHECKING',
        claim ? `Verified against ${(claim.sources || []).length} sources` : 'Searching for evidence...'
    );

    setTimeout(() => {
        hideScanningOverlay();
        if (!claim) {
            showLiveAnalysis('', 'UNVERIFIABLE', 'No verifiable claim at this timestamp');
            setTimeout(() => hideLiveAnalysis(), 2500);
            showToast('No claim at this timestamp');
            return;
        }

        const claimIndex = ytClaims.indexOf(claim);
        const cards = document.querySelectorAll('.claim-card');
        if (cards[claimIndex]) {
            cards[claimIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (!cards[claimIndex].classList.contains('expanded')) {
                cards[claimIndex].classList.add('expanded');
            }
            cards[claimIndex].style.borderColor = 'var(--primary)';
            cards[claimIndex].style.boxShadow = '0 0 24px rgba(34,214,94,0.2)';
            setTimeout(() => {
                cards[claimIndex].style.borderColor = '';
                cards[claimIndex].style.boxShadow = '';
            }, 3000);
        }
        showToast(`⚡ Fact-checked moment at ${formatTime(time)}`);

        // Keep live analysis showing the claim for a bit, then hide
        setTimeout(() => hideLiveAnalysis(), 4000);
    }, 1500);

    document.getElementById('pause-factcheck-btn').classList.remove('visible');
}

// ──────────────────────────────────────────────
//   NEW: Swipe Game 'Cap or Fact?'
// ──────────────────────────────────────────────
const SWIPE_QUESTIONS_BANK = [
    { claim: 'Lightning never strikes the same place twice.', answer: 'false', explanation: 'The Empire State Building is hit about 25 times per year!' },
    { claim: 'Humans only use 10% of their brains.', answer: 'false', explanation: 'Brain scans show we use virtually all parts of our brain every day.' },
    { claim: 'Octopuses have three hearts.', answer: 'true', explanation: 'Two pump blood to the gills, one pumps it to the rest of the body.' },
    { claim: 'Bananas grow on trees.', answer: 'false', explanation: 'Banana plants are actually giant herbs, not trees!' },
    { claim: 'Honey never spoils.', answer: 'true', explanation: 'Archaeologists found 3000-year-old honey in Egyptian tombs that was still edible!' },
    { claim: 'Mount Everest is the tallest mountain in the world.', answer: 'false', explanation: 'Mauna Kea from its base on the ocean floor is taller (10,210m vs 8,848m).' },
    { claim: 'Dogs only see in black and white.', answer: 'false', explanation: 'Dogs can see blue and yellow — they\'re dichromatic, not monochrome.' },
    { claim: 'A day on Venus is longer than a year on Venus.', answer: 'true', explanation: 'Venus takes 243 Earth days to rotate but only 225 to orbit the sun.' },
    { claim: 'Goldfish have a 3-second memory.', answer: 'false', explanation: 'Studies show goldfish can remember things for months.' },
    { claim: 'Sharks existed before trees.', answer: 'true', explanation: 'Sharks have been around for ~400 million years, trees for ~350 million.' },
    { claim: 'Vikings wore horned helmets.', answer: 'false', explanation: 'No historical evidence — the horned helmet myth was invented for 19th-century opera costumes.' },
    { claim: 'Eating chocolate gives you acne.', answer: 'false', explanation: 'Multiple studies found no direct link between chocolate consumption and acne.' },
    { claim: 'Fortune cookies were invented in China.', answer: 'false', explanation: 'They were invented in early-1900s San Francisco by Japanese immigrants.' },
    { claim: 'Ostriches bury their heads in the sand.', answer: 'false', explanation: 'They dig nests in the ground but never bury their heads — that\'s a myth.' },
    { claim: 'Humans share 60% of their DNA with bananas.', answer: 'true', explanation: 'About 60% of human genes have a recognizable counterpart in the banana genome.' },
    { claim: 'The Great Wall of China is visible from space.', answer: 'false', explanation: 'It\'s actually very hard to see from space with the naked eye.' },
    { claim: 'Water freezes faster if it\'s already hot.', answer: 'true', explanation: 'The Mpemba effect — under certain conditions, hot water can freeze faster than cold.' },
    { claim: 'The Amazon rainforest produces 20% of the world\'s oxygen.', answer: 'true', explanation: 'Through photosynthesis, the Amazon contributes about 20% of Earth\'s oxygen.' },
    { claim: 'Bats are blind.', answer: 'false', explanation: 'Bats can see — they also use echolocation, but they are not blind.' },
    { claim: 'An apple a day keeps the doctor away.', answer: 'false', explanation: 'While apples are healthy, no scientific evidence supports this specific claim.' },
];
const SWIPE_REWARD_PER_CORRECT = 10;
let SWIPE_QUESTIONS = [];

function shuffleAndPickQuestions() {
    const shuffled = shuffleArray([...SWIPE_QUESTIONS_BANK]);
    return shuffled.slice(0, 10);
}

let _swipeState = {
    active: false,
    current: 0,
    score: 0,
    correct: 0,
    total: 10,
    results: [],
    claimed: false,
    isSwiping: false,
    startX: 0,
    currentX: 0,
};

function startSwipeGame() {
    const el = document.getElementById('swipe-game');
    if (!el) return;
    SWIPE_QUESTIONS = shuffleAndPickQuestions();
    _swipeState = {
        active: true, current: 0, score: 0, correct: 0,
        total: SWIPE_QUESTIONS.length, results: [], claimed: false,
        isSwiping: false, startX: 0, currentX: 0,
    };
    el.style.display = 'block';
    // Clear history
    document.getElementById('swipe-history-list').innerHTML = '';
    document.getElementById('swipe-history-empty').style.display = 'block';
    document.getElementById('swipe-history-header').style.display = 'block';
    showSwipeQuestion();
    attachSwipeListeners();
}

function closeSwipeGame() {
    document.getElementById('swipe-game').style.display = 'none';
    _swipeState.active = false;
    detachSwipeListeners();
    const historyEl = document.getElementById('swipe-history');
    if (historyEl) historyEl.style.display = '';
}

function renderSwipeHistory() {
    const list = document.getElementById('swipe-history-list');
    const empty = document.getElementById('swipe-history-empty');
    const countEl = document.getElementById('swipe-history-count');
    if (!list) return;
    list.innerHTML = '';
    if (countEl) countEl.textContent = _swipeState.results.length;
    if (_swipeState.results.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    _swipeState.results.forEach((r, i) => {
        const q = SWIPE_QUESTIONS[i];
        if (!q) return;
        const item = document.createElement('div');
        item.className = 'swipe-history-item';
        item.innerHTML = `
            <div class="swipe-history-verdict ${r.correct ? 'correct' : 'wrong'}">${r.correct ? '✅' : '❌'}</div>
            <div class="swipe-history-text">"${escapeHtml(q.claim.substring(0, 50))}${q.claim.length > 50 ? '...' : ''}"</div>
        `;
        item.title = q.explanation;
        list.appendChild(item);
    });
    list.scrollTop = list.scrollHeight;
}

function showSwipeQuestion() {
    const q = _swipeState.current;
    if (q >= _swipeState.total) { endSwipeGame(); return; }
    const question = SWIPE_QUESTIONS[q];
    document.getElementById('swipe-claim').textContent = `"${question.claim}"`;
    document.getElementById('swipe-progress').textContent = `${q + 1} / ${_swipeState.total}`;
    document.getElementById('swipe-score').textContent = `✅ ${_swipeState.correct}`;
    document.getElementById('swipe-feedback').style.display = 'none';
    // Reset card position
    const card = document.getElementById('swipe-game-card');
    card.classList.remove('swiped-left', 'swiped-right', 'swiping');
    card.style.transform = '';
    card.style.opacity = '';
    document.getElementById('swipe-label-false').classList.remove('show');
    document.getElementById('swipe-label-true').classList.remove('show');
    _swipeState.claimed = false;
    renderSwipeHistory();
}

function swipeChoice(guess) {
    if (!_swipeState.active || _swipeState.claimed) return;
    const q = _swipeState.current;
    if (q >= _swipeState.total) return;
    _swipeState.claimed = true;

    const question = SWIPE_QUESTIONS[q];
    const correct = guess === question.answer;

    const card = document.getElementById('swipe-game-card');
    if (guess === 'false') {
        card.classList.add('swiped-left');
    } else {
        card.classList.add('swiped-right');
    }

    setTimeout(() => {
        if (correct) {
            _swipeState.correct++;
            _swipeState.score += SWIPE_REWARD_PER_CORRECT;
        }
        _swipeState.results.push({ guess, correct });
        renderSwipeHistory();

        // Show feedback
        const fb = document.getElementById('swipe-feedback');
        fb.style.display = 'block';
        fb.className = 'swipe-feedback ' + (correct ? 'correct' : 'wrong');
        fb.innerHTML = correct
            ? `✅ FACT! +${SWIPE_REWARD_PER_CORRECT} pts — ${question.explanation}`
            : `❌ CAP! The answer was <strong>${question.answer.toUpperCase()}</strong> — ${question.explanation}`;

        // Reset card
        card.classList.remove('swiped-left', 'swiped-right', 'swiping');
        card.style.transform = '';
        card.style.opacity = '';

        setTimeout(() => {
            fb.style.display = 'none';
            _swipeState.current++;
            showSwipeQuestion();
        }, 1800);
    }, 300);
}

// Touch/drag swipe support
function onSwipeStart(e) {
    if (!_swipeState.active || _swipeState.claimed) return;
    const touch = e.touches ? e.touches[0] : e;
    _swipeState.isSwiping = true;
    _swipeState.startX = touch.clientX;
    _swipeState.currentX = touch.clientX;
    document.getElementById('swipe-game-card').classList.add('swiping');
}

function onSwipeMove(e) {
    if (!_swipeState.isSwiping) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    _swipeState.currentX = touch.clientX;
    const dx = _swipeState.currentX - _swipeState.startX;
    const card = document.getElementById('swipe-game-card');
    const rotate = Math.max(-20, Math.min(20, dx / 8));
    card.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;

    // Show overlays
    if (dx > 30) {
        document.getElementById('swipe-label-true').classList.add('show');
        document.getElementById('swipe-label-false').classList.remove('show');
    } else if (dx < -30) {
        document.getElementById('swipe-label-false').classList.add('show');
        document.getElementById('swipe-label-true').classList.remove('show');
    } else {
        document.getElementById('swipe-label-true').classList.remove('show');
        document.getElementById('swipe-label-false').classList.remove('show');
    }
}

function onSwipeEnd(e) {
    if (!_swipeState.isSwiping) return;
    _swipeState.isSwiping = false;
    const dx = _swipeState.currentX - _swipeState.startX;
    document.getElementById('swipe-game-card').classList.remove('swiping');

    if (dx > 60) {
        swipeChoice('true');
    } else if (dx < -60) {
        swipeChoice('false');
    } else {
        // Snap back
        const card = document.getElementById('swipe-game-card');
        card.style.transform = '';
    }
    document.getElementById('swipe-label-true').classList.remove('show');
    document.getElementById('swipe-label-false').classList.remove('show');
}

function attachSwipeListeners() {
    const card = document.getElementById('swipe-game-card');
    if (!card) return;
    card.addEventListener('mousedown', onSwipeStart);
    document.addEventListener('mousemove', onSwipeMove);
    document.addEventListener('mouseup', onSwipeEnd);
    card.addEventListener('touchstart', onSwipeStart, { passive: true });
    document.addEventListener('touchmove', onSwipeMove, { passive: false });
    document.addEventListener('touchend', onSwipeEnd);
}

function detachSwipeListeners() {
    const card = document.getElementById('swipe-game-card');
    if (card) {
        card.removeEventListener('mousedown', onSwipeStart);
        card.removeEventListener('touchstart', onSwipeStart);
    }
    document.removeEventListener('mousemove', onSwipeMove);
    document.removeEventListener('mouseup', onSwipeEnd);
    document.removeEventListener('touchmove', onSwipeMove);
    document.removeEventListener('touchend', onSwipeEnd);
}

function endSwipeGame() {
    _swipeState.active = false;
    const card = document.getElementById('swipe-game-card');
    const body = document.getElementById('swipe-game-body');
    const total = _swipeState.total;
    const correct = _swipeState.correct;
    const pct = Math.round((correct / total) * 100);

    body.innerHTML = `
        <div class="swipe-game-result">
            <div class="swipe-game-result-score">${correct}/${total}</div>
            <div class="swipe-game-result-label">${pct >= 80 ? '🏆 Fact Expert!' : pct >= 60 ? '👏 Getting There!' : '📚 Keep Learning!'}</div>
            <div class="swipe-game-result-detail">${correct >= 8 ? 'Amazing knowledge!' : correct >= 5 ? 'Not bad!' : 'Time to brush up on facts!'}</div>
            <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;">
                <button class="btn btn-primary btn-sm" onclick="claimSwipeReward()">🏆 Claim ${_swipeState.score} pts</button>
                <button class="btn btn-outline btn-sm" onclick="restartSwipeGame()">🔄 Play Again</button>
                <button class="btn btn-secondary btn-sm" onclick="closeSwipeGame()">Close</button>
            </div>
        </div>
    `;
    detachSwipeListeners();
}

function claimSwipeReward() {
    const s = _swipeState.score;
    if (s > 0) {
        _ml.points += s;
        saveML();
        showMLBadge();
        showToast(`🏆 Cap or Fact complete! +${s} points`);
    }
    closeSwipeGame();
}

function restartSwipeGame() {
    document.getElementById('swipe-game-body').innerHTML = `
        <div class="swipe-game-claim" id="swipe-claim">"Loading..."</div>
        <div class="swipe-game-hint">👆 Swipe right if FACT, left if CAP</div>
    `;
    document.getElementById('swipe-feedback').style.display = 'none';
    document.getElementById('swipe-feedback').innerHTML = '';
    const historyEl = document.getElementById('swipe-history');
    if (historyEl) historyEl.style.display = '';
    document.getElementById('swipe-history-list').innerHTML = '';
    document.getElementById('swipe-history-empty').style.display = 'block';
    SWIPE_QUESTIONS = shuffleAndPickQuestions();
    _swipeState = {
        active: true, current: 0, score: 0, correct: 0,
        total: SWIPE_QUESTIONS.length, results: [], claimed: false,
        isSwiping: false, startX: 0, currentX: 0,
    };
    showSwipeQuestion();
    attachSwipeListeners();
}

// ──────────────────────────────────────────────
//   Override startFunFacts to start swipe game
//   instead of the old quiz (user requested this)
// ──────────────────────────────────────────────
const _origStartFunFacts = startFunFacts;
startFunFacts = function() {
    const el = document.getElementById('fun-fact-text');
    if (!el) return;
    let idx = Math.floor(Math.random() * FUN_FACTS.length);
    el.textContent = FUN_FACTS[idx];
    if (_funFactInterval) clearInterval(_funFactInterval);
    _funFactInterval = setInterval(() => {
        idx = (idx + 1) % FUN_FACTS.length;
        el.style.opacity = '0';
        setTimeout(() => {
            el.textContent = FUN_FACTS[idx];
            el.style.opacity = '1';
        }, 300);
    }, 5000);
    // Auto-start the swipe game instead of the old mini-game
    setTimeout(() => startSwipeGame(), 1000);
};

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
    if (_ml.videos > 0) showMLBadge();
    const page = getPageFromPath();

    if (page === 'history') {
        showPage('history');
        updateNavActive('history');
        loadHistory();
    } else if (page === 'results') {
        const match = window.location.pathname.match(/\/report\/(.+)/);
        if (match) loadReport(match[1]);
    } else if (page === 'compare') {
        showPage('compare');
        updateNavActive('');
    } else {
        showPage('home');
        updateNavActive('home');
        updateHomeStats();
        loadRecentActivity();
        // NEW: Dashboard features
        initParticleBg();
        startActivityFeed();
        renderTrendingClaims();
        renderGamificationHub();
    }

    document.getElementById('video-url-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitFactCheck();
    });
});
