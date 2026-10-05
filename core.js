const app = new PIXI.Application({
    width: 1280,
    height: 720,
    backgroundColor: 0x000000,
    antialias: true,
    powerPreference: "high-performance"
});

const gameContainer = document.getElementById('game-container');
gameContainer.appendChild(app.view);

const videoOverlay = document.getElementById('video-cutscene') || document.createElement('video');
if (!videoOverlay.parentElement) {
    videoOverlay.id = 'video-cutscene';
    videoOverlay.style.display = 'none';
    gameContainer.appendChild(videoOverlay);
}

const VirtualFS = {
    charts: {},      
    assets: {},      
    stageJsons: {},
    charJsons: {},
    audioBufferCache: {}
};

const dropOverlay = document.getElementById('drop-overlay');
const stagedList = document.getElementById('staged-files-list');
const startBtn = document.getElementById('start-engine-btn');
const statusBox = document.getElementById('status-box');
const freeplayScreen = document.getElementById('freeplay-screen');
const songGrid = document.getElementById('song-grid');
const modCounter = document.getElementById('mod-counter');

const stagedFiles = [];
const activeBlobUrls = [];

function createTrackedBlobUrl(blob) {
    const url = URL.createObjectURL(blob);
    activeBlobUrls.push(url);
    return url;
}

function revokeAllBlobUrls() {
    while (activeBlobUrls.length > 0) {
        const url = activeBlobUrls.pop();
        try { URL.revokeObjectURL(url); } catch(e) {}
    }
}

function sanitizeJsonText(text) {
    return text.replace(/^\uFEFF/, '').replace(/\/\/.*$/gm, '').trim();
}

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
        if (file.name.endsWith('.zip') || file.name.endsWith('.imp')) {
            if (!stagedFiles.some(f => f.name === file.name)) stagedFiles.push(file);
        }
    });
    updateStagingUI();
});

function updateStagingUI() {
    if (stagedFiles.length === 0) return;
    stagedList.innerHTML = '';
    stagedFiles.forEach(file => {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        const item = document.createElement('div');
        item.className = 'staged-item';
        item.innerHTML = `<span>✔ ${file.name}</span><span style="color:#747d8c">${sizeMB} MB</span>`;
        stagedList.appendChild(item);
    });

    startBtn.classList.remove('hidden');
    startBtn.innerText = `LOAD MODS & START (${stagedFiles.length} Ready)`;
}

startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.classList.add('hidden');
    statusBox.classList.remove('hidden');

    for (const file of stagedFiles) {
        if (file.name.endsWith('.zip') || file.name.endsWith('.imp')) {
            await ingestZip(file);
        }
    }

    refreshFreeplayUI();
});

async function ingestZip(file) {
    statusBox.innerText = `Scanning: ${file.name}...`;
    const zip = await JSZip.loadAsync(file);

    statusBox.innerText = `Indexing charts, stages & characters...`;
    const scanPromises = [];
    const vsliceMeta = {};
    const vsliceCharts = {};

    zip.forEach((rawPath, entry) => {
        if (entry.dir) return;
        const path = rawPath.toLowerCase().replace(/\\/g, '/');
        VirtualFS.assets[path] = entry;

        if (path.includes('/stages/') && path.endsWith('.json')) {
            const p = entry.async('string').then(text => {
                try {
                    const parsed = JSON.parse(sanitizeJsonText(text));
                    const stageKey = path.split('/').pop().replace('.json', '');
                    VirtualFS.stageJsons[stageKey] = parsed;
                } catch(e) {}
            });
            scanPromises.push(p);
        }

        if (path.includes('/characters/') && path.endsWith('.json')) {
            const p = entry.async('string').then(text => {
                try {
                    const parsed = JSON.parse(sanitizeJsonText(text));
                    const charKey = path.split('/').pop().replace('.json', '');
                    VirtualFS.charJsons[charKey] = parsed;
                } catch(e) {}
            });
            scanPromises.push(p);
        }

        if (path.endsWith('-metadata.json')) {
            const p = entry.async('string').then(text => {
                try {
                    const parsed = JSON.parse(sanitizeJsonText(text));
                    const songName = path.split('/').pop().replace('-metadata.json', '');
                    vsliceMeta[songName] = parsed;
                } catch(e) {}
            });
            scanPromises.push(p);
        }

        if (path.endsWith('-chart.json')) {
            const p = entry.async('string').then(text => {
                try {
                    const parsed = JSON.parse(sanitizeJsonText(text));
                    const songName = path.split('/').pop().replace('-chart.json', '');
                    vsliceCharts[songName] = { parsed, path };
                } catch(e) {}
            });
            scanPromises.push(p);
        }
    });

    await Promise.all(scanPromises);

    for (const [songKey, cObj] of Object.entries(vsliceCharts)) {
        const meta = vsliceMeta[songKey] || {};
        const parsed = cObj.parsed;

        let cleanSpeed = 2.5;
        if (parsed.scrollSpeed) {
            cleanSpeed = (typeof parsed.scrollSpeed === 'object') 
                ? (parsed.scrollSpeed.hard || parsed.scrollSpeed.normal || 2.5) 
                : parsed.scrollSpeed;
        }

        const songName = meta.songName || meta.name || songKey;
        const bpm = meta.bpm || (meta.timeChanges && meta.timeChanges[0] ? meta.timeChanges[0].bpm : 150);
        const playData = meta.playData || {};
        const chars = playData.characters || {};

        let opponent = chars.opponent || meta.opponent || parsed.player2;
        if (!opponent) {
            if (songKey.includes('49')) opponent = 'noob49';
            else if (songKey.includes('trot')) opponent = 'horsemate';
            else if (songKey.includes('threat')) opponent = 'pinkthreat';
            else if (songKey.includes('suspect')) opponent = 'detective';
            else opponent = 'purple';
        }

        let player = chars.player || meta.player || parsed.player1;
        if (!player) {
            player = songKey.includes('suspect') ? 'picoweird' : (songKey.includes('trot') ? 'bfweirdsheriff' : 'bfweird');
        }

        const stage = playData.stage || meta.stage || parsed.stage || (
            songKey.includes('suspect') ? 'security2' : 
            (songKey.includes('trot') ? 'horse' : 
            (songKey.includes('lied') ? 'medbay' : 
            (songKey.includes('threat') ? 'beach' : 'security')))
        );

        VirtualFS.charts[songKey] = {
            id: songKey,
            name: String(songName),
            bpm: bpm,
            speed: parseFloat(cleanSpeed) || 2.5,
            stage: stage,
            player1: player,
            player2: opponent,
            chartData: parsed,
            chartPath: cObj.path
        };
    }
}

function refreshFreeplayUI() {
    const songKeys = Object.keys(VirtualFS.charts);
    if (songKeys.length === 0) {
        statusBox.innerText = "No charts detected in dropped files!";
        return;
    }

    dropOverlay.classList.add('hidden');
    freeplayScreen.classList.remove('hidden');

    songGrid.innerHTML = '';
    modCounter.innerText = `${songKeys.length} Songs Ready`;

    songKeys.sort().forEach(key => {
        const item = VirtualFS.charts[key];
        const card = document.createElement('div');
        card.className = 'song-card';
        card.innerHTML = `
            <h3>${String(item.name).toUpperCase()}</h3>
            <div class="song-meta">
                <span>Opponent: <strong>${item.player2}</strong></span>
                <span>Stage: <strong>${item.stage}</strong></span>
            </div>
        `;

        card.onclick = () => launchSong(item);
        songGrid.appendChild(card);
    });
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const Conductor = {
    bpm: 100,
    crochet: 600,
    stepCrochet: 150,
    songPosition: 0,
    lastBeat: -1,
    lastStep: -1,
    curBeat: 0,
    curStep: 0,
    isPlaying: false,
    startTime: 0,
    activeSources: [],

    setBPM(newBpm) {
        this.bpm = newBpm;
        this.crochet = (60 / newBpm) * 1000;
        this.stepCrochet = this.crochet / 4;
    },

    start() {
        this.startTime = audioCtx.currentTime;
        this.songPosition = 0;
        this.lastBeat = -1;
        this.lastStep = -1;
        this.curBeat = 0;
        this.curStep = 0;
        this.isPlaying = true;
    },

    stop() {
        this.isPlaying = false;
        this.songPosition = 0;
        this.lastBeat = -1;
        this.lastStep = -1;
        this.curBeat = 0;
        this.curStep = 0;
        for (const src of this.activeSources) {
            try {
                src.stop();
                src.disconnect();
            } catch(e) {}
        }
        this.activeSources = [];
    },

    update() {
        if (!this.isPlaying) return;
        this.songPosition = (audioCtx.currentTime - this.startTime) * 1000;
        this.curStep = Math.floor(this.songPosition / this.stepCrochet);
        this.curBeat = Math.floor(this.curStep / 4);

        if (this.curStep > this.lastStep) {
            this.lastStep = this.curStep;
            if (typeof onStepHit === 'function') onStepHit(this.curStep);
        }

        if (this.curBeat > this.lastBeat) {
            this.lastBeat = this.curBeat;
            if (typeof onBeatHit === 'function') onBeatHit(this.curBeat);
        }
    }
};

async function playVideoCutscene(videoKey) {
    let videoEntry = null;
    for (const [p, e] of Object.entries(VirtualFS.assets)) {
        if (p.includes(`videos/videos/${videoKey.toLowerCase()}.mp4`) || p.endsWith(`${videoKey.toLowerCase()}.mp4`)) {
            videoEntry = e;
            break;
        }
    }
    if (!videoEntry) return Promise.resolve();

    return new Promise(async (resolve) => {
        try {
            const blob = await videoEntry.async('blob');
            const url = createTrackedBlobUrl(blob);
            videoOverlay.src = url;
            videoOverlay.style.display = 'block';

            const finish = () => {
                videoOverlay.pause();
                videoOverlay.style.display = 'none';
                videoOverlay.onended = null;
                window.removeEventListener('keydown', skip);
                resolve();
            };

            const skip = (e) => {
                if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') finish();
            };

            window.addEventListener('keydown', skip);
            videoOverlay.onended = finish;
            await videoOverlay.play();
        } catch(err) {
            videoOverlay.style.display = 'none';
            resolve();
        }
    });
}
