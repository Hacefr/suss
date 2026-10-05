const NOTE_COLORS = [0xc24b99, 0x00ffff, 0x12fa05, 0xf9393f]; 
const ARROW_ANGLES = [-Math.PI / 2, Math.PI, 0, Math.PI / 2];

function drawArrowShape(graphics, color, size = 32) {
    graphics.clear();
    graphics.beginFill(color);
    graphics.moveTo(0, -size);
    graphics.lineTo(size * 0.8, size * 0.7);
    graphics.lineTo(0, size * 0.4);
    graphics.lineTo(-size * 0.8, size * 0.7);
    graphics.closePath();
    graphics.endFill();
}

let playState = null;
let activeCountdownTimer = null;

class PlayStateScene {
    constructor(songItem, dadChar, bfChar, gfChar, stageData, stageProps, stageJson, extraChars = {}) {
        this.songItem = songItem;
        this.speed = songItem.speed || 2.5;

        this.worldContainer = new PIXI.Container();
        this.hudContainer = new PIXI.Container();

        this.dad = dadChar;
        this.bf = bfChar;
        this.gf = gfChar;
        this.extraChars = extraChars;

        this.notes = [];
        this.events = [];
        this.receptors = [];
        this.score = 0;
        this.combo = 0;
        this.misses = 0;
        this.totalNotesHit = 0;
        this.totalNotesPossible = 0;
        this.health = 1.0;

        this.gfDanceLeft = false;
        this.props = {};
        this.mistLayers = [];

        this.hesDying = false;
        this.isDark = false;

        this.camZoom = (stageJson && stageJson.cameraZoom) ? stageJson.cameraZoom : 0.7;
        this.baseZoom = this.camZoom;

        this.initStageCameras(songItem.id.toLowerCase());
        this.setupStage(stageData, stageProps, stageJson);
        this.setupCharacters(stageJson);
        this.setupStrumlines();
        this.parseChartNotes(songItem.chartData);
        this.setupHUD();

        app.stage.addChild(this.worldContainer);
        app.stage.addChild(this.hudContainer);
    }

    initStageCameras(songId) {
        if (songId.includes('49') || songId.includes('suspect')) {
            this.dadCam = [500, 450];
            this.bfCam = [850, 450];
            this.camTargetX = 675;
            this.camTargetY = 450;
        } else if (songId.includes('trot')) {
            this.dadCam = [540, 380];
            this.bfCam = [900, 380];
            this.camTargetX = 720;
            this.camTargetY = 380;
        } else if (songId.includes('lied')) {
            this.dadCam = [640, 450];
            this.bfCam = [810, 450];
            this.camTargetX = 725;
            this.camTargetY = 450;
        } else if (songId.includes('threat')) {
            this.dadCam = [950, 550];
            this.bfCam = [950, 550];
            this.camTargetX = 1100;
            this.camTargetY = 550;
            this.baseZoom = 0.5;
            this.camZoom = 0.5;
        } else {
            this.dadCam = [600, 450];
            this.bfCam = [850, 450];
            this.camTargetX = 725;
            this.camTargetY = 450;
        }

        this.camFocusX = this.camTargetX;
        this.camFocusY = this.camTargetY;
    }

    setupStage(stageData, stageProps, stageJson) {
        this.stageBack = new PIXI.Container();
        this.stageFront = new PIXI.Container();

        if (stageJson && stageJson.props) {
            stageJson.props.forEach(p => {
                const cleanName = p.assetPath.split('/').pop().toLowerCase();
                const tex = stageData[cleanName];

                if (p.assetPath && p.assetPath.startsWith('#')) {
                    const g = new PIXI.Graphics();
                    const hexColor = parseInt(p.assetPath.replace('#', '0x'), 16) || 0x000000;
                    g.beginFill(hexColor);
                    g.drawRect(-4000, -4000, 10000, 10000);
                    g.endFill();
                    g.alpha = 0;

                    if (p.blend === 'multiply') g.blendMode = PIXI.BLEND_MODES.MULTIPLY;
                    if (p.blend === 'subtract') g.blendMode = PIXI.BLEND_MODES.SUBTRACT;
                    if (p.blend === 'add') g.blendMode = PIXI.BLEND_MODES.ADD;

                    const propName = p.name ? p.name.toLowerCase() : cleanName;
                    this.props[propName] = g;

                    if (p.zIndex >= 300) this.stageFront.addChild(g);
                    else this.stageBack.addChild(g);
                    return;
                }

                const propAnims = stageProps[cleanName];
                let animTextures = null;

                if (propAnims && typeof propAnims === 'object') {
                    const keys = Object.keys(propAnims);
                    if (keys.length > 0) {
                        const targetKey = keys.find(k => k === p.startingAnimation || k === 'idle' || k.includes('bop')) || keys[0];
                        animTextures = propAnims[targetKey] || Object.values(propAnims)[0];
                    }
                }

                if (Array.isArray(animTextures) && animTextures.length > 0) {
                    const aSpr = new PIXI.AnimatedSprite(animTextures);
                    aSpr.position.set(p.position[0], p.position[1]);
                    aSpr.scale.set(p.scale || 1);
                    aSpr.zIndex = p.zIndex || 0;
                    aSpr.alpha = (p.alpha !== undefined) ? p.alpha : 1;
                    aSpr.loop = true;
                    aSpr.animationSpeed = 24 / 60;
                    aSpr.play();

                    this.stageBack.addChild(aSpr);
                    const propName = p.name ? p.name.toLowerCase() : cleanName;
                    this.props[propName] = aSpr;
                    this.props[cleanName] = aSpr;
                } else if (tex) {
                    const spr = new PIXI.Sprite(tex);
                    spr.position.set(p.position[0], p.position[1]);
                    
                    const isBackdrop = (cleanName === 'bg' || cleanName === 'sky' || cleanName === 'wall');
                    const propScale = p.scale || 1;
                    spr.scale.set(isBackdrop ? propScale * 1.3 : propScale);

                    spr.alpha = (p.alpha !== undefined) ? p.alpha : 1;
                    if (p.blend === 'subtract') spr.blendMode = PIXI.BLEND_MODES.SUBTRACT;
                    if (p.blend === 'add') spr.blendMode = PIXI.BLEND_MODES.ADD;
                    spr.zIndex = p.zIndex || 0;

                    const propName = p.name ? p.name.toLowerCase() : cleanName;
                    this.props[propName] = spr;
                    this.props[cleanName] = spr;

                    if (p.zIndex >= 300) this.stageFront.addChild(spr);
                    else this.stageBack.addChild(spr);
                }
            });

            if (stageData['mistback'] && stageData['mistmid']) {
                const mb = new PIXI.TilingSprite(stageData['mistback'], 4000, 720);
                mb.position.set(-1000, -270);
                mb.alpha = 0.6;
                mb.blendMode = PIXI.BLEND_MODES.SCREEN;
                this.stageBack.addChild(mb);
                this.mistLayers.push({ sprite: mb, speed: 15 });

                const mm = new PIXI.TilingSprite(stageData['mistmid'], 4000, 720);
                mm.position.set(-1000, -270);
                mm.alpha = 0.6;
                mm.blendMode = PIXI.BLEND_MODES.SCREEN;
                this.stageBack.addChild(mm);
                this.mistLayers.push({ sprite: mm, speed: -15 });
            }

            this.stageBack.sortChildren();
            this.stageFront.sortChildren();
        }

        this.worldContainer.addChild(this.stageBack);
    }

    setupCharacters(stageJson) {
        const c = (stageJson && stageJson.characters) ? stageJson.characters : null;

        let dadPos = [100, 100];
        let bfPos = [770, 450];
        let gfPos = [400, 130];

        if (c) {
            if (c.dad && Array.isArray(c.dad.position)) dadPos = c.dad.position;
            if (c.bf && Array.isArray(c.bf.position)) bfPos = c.bf.position;
            if (c.gf && Array.isArray(c.gf.position)) gfPos = c.gf.position;
        }

        if (this.dad) this.dad.container.position.set(dadPos[0], dadPos[1]);
        if (this.bf) this.bf.container.position.set(bfPos[0], bfPos[1]);
        
        if (this.gf) {
            this.gf.container.position.set(gfPos[0], gfPos[1]);
            this.gf.container.visible = !!(c && c.gf);
        }

        if (this.gf && this.gf.container.visible) this.worldContainer.addChild(this.gf.container);
        if (this.dad) this.worldContainer.addChild(this.dad.container);
        if (this.bf) this.worldContainer.addChild(this.bf.container);

        if (this.extraChars.maroon) {
            this.extraChars.maroon.container.position.set(-950, 530);
            this.extraChars.maroon.container.visible = false;
            this.worldContainer.addChild(this.extraChars.maroon.container);
        }
        if (this.extraChars.grey) {
            this.extraChars.grey.container.position.set(-700, 600);
            this.extraChars.grey.container.visible = false;
            this.worldContainer.addChild(this.extraChars.grey.container);
        }
        if (this.extraChars.maroonParasite) {
            this.extraChars.maroonParasite.container.position.set(-350, 240);
            this.extraChars.maroonParasite.container.visible = false;
            this.worldContainer.addChild(this.extraChars.maroonParasite.container);
        }

        this.worldContainer.addChild(this.stageFront);
    }

    setupStrumlines() {
        const startX_Opponent = 96;
        const startX_Player = 1280 - 96 - (4 * 110);
        const receptorY = 85;
        const spacing = 110;

        for (let i = 0; i < 8; i++) {
            const isPlayer = i >= 4;
            const dir = i % 4;
            const x = (isPlayer ? startX_Player : startX_Opponent) + (dir * spacing);

            const receptor = new PIXI.Container();
            receptor.position.set(x, receptorY);

            const base = new PIXI.Graphics();
            base.lineStyle(4, 0x3d4457, 1);
            base.drawCircle(0, 0, 42);
            receptor.addChild(base);

            const arrow = new PIXI.Graphics();
            drawArrowShape(arrow, 0x8a95aa, 28);
            arrow.rotation = ARROW_ANGLES[dir];
            receptor.addChild(arrow);

            this.receptors.push({ container: receptor, dir, isPlayer, arrow, base });
            this.hudContainer.addChild(receptor);
        }
    }

    parseChartNotes(chart) {
        this.notes = [];
        this.events = [];
        if (!chart) return;

        const data = chart.chartData || chart;

        if (data.events && Array.isArray(data.events)) {
            data.events.forEach(evt => {
                if (evt.t !== undefined) {
                    this.events.push({ time: evt.t, name: evt.e, val: evt.v, fired: false });
                }
            });
            this.events.sort((a, b) => a.time - b.time);
        }

        if (data.notes && typeof data.notes === 'object') {
            const diffNotes = data.notes.hard || data.notes.normal || Object.values(data.notes)[0] || [];
            diffNotes.forEach(n => {
                const rawDir = n.d !== undefined ? n.d : (n.dir || 0);
                this.notes.push({
                    time: n.t !== undefined ? n.t : n.time,
                    dir: rawDir % 4,
                    isPlayer: (rawDir < 4),
                    kind: n.k || '',
                    sustain: n.l !== undefined ? n.l : (n.sLen || 0),
                    hit: false, missed: false, sprite: null, tailSprite: null
                });
            });
        }

        this.notes.sort((a, b) => a.time - b.time);

        this.notes.forEach(n => {
            const spr = new PIXI.Graphics();
            drawArrowShape(spr, NOTE_COLORS[n.dir], 32);
            spr.rotation = ARROW_ANGLES[n.dir];
            spr.visible = false;
            this.hudContainer.addChild(spr);
            n.sprite = spr;

            if (n.sustain > 50) {
                const tail = new PIXI.Graphics();
                tail.visible = false;
                this.hudContainer.addChildAt(tail, 0);
                n.tailSprite = tail;
            }
        });
    }

    setupHUD() {
        this.healthBarCont = new PIXI.Container();
        this.healthBarCont.position.set(640, 660);

        this.barWidth = 600;
        this.barHeight = 16;

        this.barBorder = new PIXI.Graphics();
        this.barBorder.beginFill(0x000000);
        this.barBorder.drawRect(-this.barWidth / 2 - 4, -this.barHeight / 2 - 4, this.barWidth + 8, this.barHeight + 8);
        this.barBorder.endFill();
        this.healthBarCont.addChild(this.barBorder);

        this.barFill = new PIXI.Graphics();
        this.healthBarCont.addChild(this.barFill);

        this.scoreText = new PIXI.Text('Score: 0 | Misses: 0 | Accuracy: ?', {
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: 16,
            fontWeight: 'bold',
            fill: 0xffffff,
            align: 'center'
        });
        this.scoreText.anchor.set(0.5);
        this.scoreText.position.set(640, 690);
        this.hudContainer.addChild(this.scoreText);

        this.ratingText = new PIXI.Text('READY!', {
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: 48,
            fontWeight: 'bold',
            fill: 0x00d2d3,
            align: 'center'
        });
        this.ratingText.anchor.set(0.5);
        this.ratingText.position.set(640, 350);
        this.hudContainer.addChild(this.ratingText);

        this.hudContainer.addChild(this.healthBarCont);
        this.updateHealthBar();
    }

    updateHealthBar() {
        const bw = this.barWidth;
        const bh = this.barHeight;
        const pct = Math.max(0, Math.min(2.0, this.health)) / 2.0;

        this.barFill.clear();
        this.barFill.beginFill(this.isDark ? 0x000000 : 0x800080);
        this.barFill.drawRect(-bw / 2, -bh / 2, bw, bh);
        this.barFill.endFill();

        const bfWidth = bw * pct;
        this.barFill.beginFill(this.isDark ? 0x000000 : 0x31b0d5);
        this.barFill.drawRect(bw / 2 - bfWidth, -bh / 2, bfWidth, bh);
        this.barFill.endFill();
    }

    triggerEvent(e) {
        const name = e.name;
        const val = e.val || {};

        switch(name) {
            case 'FocusCamera':
                if (val.char === 1) {
                    this.camTargetX = this.dadCam[0];
                    this.camTargetY = this.dadCam[1];
                } else if (val.char === 0) {
                    this.camTargetX = this.bfCam[0];
                    this.camTargetY = this.bfCam[1];
                } else if (val.char === -1 && val.x !== undefined && val.y !== undefined) {
                    this.camTargetX = val.x;
                    this.camTargetY = val.y;
                }
                break;

            case 'ClassicCameraZoom':
            case 'ZoomCamera':
                if (val.zoom !== undefined) this.baseZoom = val.zoom;
                break;

            case 'ChangeSuffix':
                if (val.char === 'dad' && this.dad) this.dad.idleSuffix = val.suffix || '';
                if (val.char === 'bf' && this.bf) this.bf.idleSuffix = val.suffix || '';
                break;

            case 'PlayAnimation':
                if (val.target === 'dad' && this.dad) this.dad.playAnim(val.anim, true);
                if (val.target === 'bf' && this.bf) this.bf.playAnim(val.anim, true);
                break;
        }
    }

    update(deltaSec) {
        if (!Conductor.isPlaying) return;

        const songPos = Conductor.songPosition;
        const receptorY = 85;
        const scrollMult = 0.32 * this.speed;

        if (this.dad) this.dad.update(deltaSec);
        if (this.bf) this.bf.update(deltaSec);
        if (this.gf && this.gf.container.visible) this.gf.update(deltaSec);

        if (this.extraChars.maroon && this.extraChars.maroon.container.visible) this.extraChars.maroon.update(deltaSec);
        if (this.extraChars.grey && this.extraChars.grey.container.visible) this.extraChars.grey.update(deltaSec);
        if (this.extraChars.maroonParasite && this.extraChars.maroonParasite.container.visible) this.extraChars.maroonParasite.update(deltaSec);

        this.mistLayers.forEach(m => {
            m.sprite.tilePosition.x += m.speed * deltaSec;
        });

        for (let i = 0; i < this.events.length; i++) {
            const e = this.events[i];
            if (!e.fired && songPos >= e.time) {
                e.fired = true;
                this.triggerEvent(e);
            }
        }

        this.camFocusX += (this.camTargetX - this.camFocusX) * 0.05;
        this.camFocusY += (this.camTargetY - this.camFocusY) * 0.05;
        this.camZoom += (this.baseZoom - this.camZoom) * 0.08;

        this.worldContainer.scale.set(this.camZoom);
        this.worldContainer.pivot.set(this.camFocusX, this.camFocusY);
        this.worldContainer.position.set(640, 360);

        this.receptors.forEach(r => {
            r.container.scale.x += (1.0 - r.container.scale.x) * 0.2;
            r.container.scale.y += (1.0 - r.container.scale.y) * 0.2;
        });

        for (let i = 0; i < this.notes.length; i++) {
            const n = this.notes[i];
            if (n.hit || n.missed) continue;

            const diff = n.time - songPos;

            // Opponent Hit
            if (!n.isPlayer && diff <= 0) {
                n.hit = true;
                n.sprite.visible = false;
                if (n.tailSprite) n.tailSprite.visible = false;
                this.hitReceptor(n.dir, false);

                if (this.songItem.id.includes('lied') && this.health > 0.2) {
                    this.health = Math.max(0.2, this.health - 0.02);
                    this.updateHealthBar();
                }

                const anims = ['left', 'down', 'up', 'right'];
                const animToPlay = anims[n.dir];

                if (n.kind === 'maroon' && this.extraChars.maroon && this.extraChars.maroon.container.visible) {
                    this.extraChars.maroon.playAnim(animToPlay, true);
                } else if (n.kind === 'grey' && this.extraChars.grey && this.extraChars.grey.container.visible) {
                    this.extraChars.grey.playAnim(animToPlay, true);
                } else if (n.kind === 'maroonP' && this.extraChars.maroonParasite && this.extraChars.maroonParasite.container.visible) {
                    this.extraChars.maroonParasite.playAnim(animToPlay, true);
                } else if (this.dad) {
                    this.dad.playAnim(animToPlay + (this.dad.idleSuffix || ''), true);
                }
                continue;
            }

            // Player Miss
            if (n.isPlayer && diff < -150) {
                n.missed = true;
                n.sprite.visible = false;
                if (n.tailSprite) n.tailSprite.visible = false;
                this.combo = 0;
                this.misses++;
                this.health = Math.max(0.0, this.health - 0.09);
                this.score = Math.max(0, this.score - 100);

                this.showRating("MISS", 0xff334b);
                this.updateScore();
                this.updateHealthBar();

                const missAnims = ['singleftmiss', 'singdownmiss', 'singupmiss', 'singrightmiss'];
                if (this.bf) this.bf.playAnim(missAnims[n.dir] || 'singleftmiss', true);
                continue;
            }

            // Draw Note
            if (diff > -200 && diff < 1600) {
                const targetReceptor = this.receptors[n.isPlayer ? n.dir + 4 : n.dir];
                const noteY = receptorY + (diff * scrollMult);

                n.sprite.position.set(targetReceptor.container.x, noteY);
                n.sprite.visible = true;

                if (n.tailSprite) {
                    const tailHeight = n.sustain * scrollMult;
                    n.tailSprite.clear();
                    n.tailSprite.beginFill(NOTE_COLORS[n.dir], 0.6);
                    n.tailSprite.drawRect(-8, 0, 16, tailHeight);
                    n.tailSprite.endFill();
                    n.tailSprite.position.set(targetReceptor.container.x, noteY);
                    n.tailSprite.visible = true;
                }
            } else {
                n.sprite.visible = false;
                if (n.tailSprite) n.tailSprite.visible = false;
            }
        }
    }

    hitReceptor(dir, isPlayer) {
        const r = this.receptors[isPlayer ? dir + 4 : dir];
        r.container.scale.set(1.22);
        drawArrowShape(r.arrow, NOTE_COLORS[dir], 32);
        setTimeout(() => drawArrowShape(r.arrow, 0x8a95aa, 28), 110);
    }

    onKeyPress(dir) {
        const songPos = Conductor.songPosition;
        this.hitReceptor(dir, true);
        
        const anims = ['left', 'down', 'up', 'right'];
        if (this.bf) this.bf.playAnim(anims[dir], true);

        if (this.hesDying && this.health > 0.2) {
            this.health = Math.max(0.2, this.health - 0.035);
            this.updateHealthBar();
        }

        let closest = null;
        let minDiff = Infinity;

        for (let i = 0; i < this.notes.length; i++) {
            const n = this.notes[i];
            if (n.isPlayer && n.dir === dir && !n.hit && !n.missed) {
                const diff = Math.abs(n.time - songPos);
                if (diff < minDiff && diff <= 150) {
                    minDiff = diff;
                    closest = n;
                }
            }
        }

        if (closest) {
            closest.hit = true;
            closest.sprite.visible = false;
            if (closest.tailSprite) closest.tailSprite.visible = false;
            this.combo++;
            this.totalNotesHit++;
            this.totalNotesPossible++;
            this.health = Math.min(2.0, this.health + 0.045);

            if (minDiff <= 22.5) { this.score += 400; this.showRating("EPIC!", 0x66fcf1); }
            else if (minDiff <= 45) { this.score += 350; this.showRating("SICK!", 0x00d2d3); }
            else if (minDiff <= 90) { this.score += 200; this.showRating("GOOD", 0x2ed573); }
            else { this.score += 50; this.showRating("BAD", 0xffa502); }

            this.updateScore();
            this.updateHealthBar();
        }
    }

    showRating(text, color) {
        this.ratingText.text = text;
        this.ratingText.style.fill = color;
        this.ratingText.scale.set(1.35);
    }

    updateScore() {
        const acc = this.totalNotesPossible > 0 ? ((this.totalNotesHit / this.totalNotesPossible) * 100).toFixed(1) : '100';
        this.scoreText.text = `Score: ${this.score} | Misses: ${this.misses} | Accuracy: ${acc}%`;
    }

    destroy() {
        app.stage.removeChild(this.worldContainer);
        app.stage.removeChild(this.hudContainer);
        this.worldContainer.destroy({ children: true });
        this.hudContainer.destroy({ children: true });
        revokeAllBlobUrls();
        app.renderer.textureGC.run();
    }
}

// Stage Step Directors
function onStepHit(step) {
    if (!playState) return;
    const currentSong = playState.songItem.id.toLowerCase();

    // 1. "49"
    if (currentSong.includes('49')) {
        if (step >= 993) {
            if (playState.props['graypet']) playState.props['graypet'].alpha = 0.001;
            if (playState.props['tawny']) playState.props['tawny'].alpha = 0.001;
            if (playState.props['deadtawny']) playState.props['deadtawny'].alpha = 1;
            playState.dadCam = [270, 450];
        }
    }

    // 2. "Suspect"
    if (currentSong.includes('suspect')) {
        if (step >= 48 && step < 64) {
            if (playState.props['loblack']) playState.props['loblack'].alpha = 1;
            playState.hudContainer.visible = false;
        }
        if (step >= 60 && step < 64) {
            if (playState.props['discuss']) playState.props['discuss'].alpha = 1;
        }
        if (step >= 64) {
            if (playState.props['discuss']) playState.props['discuss'].alpha = 0;
            if (playState.props['loblack']) playState.props['loblack'].alpha = 0;
            playState.hudContainer.visible = true;
        }

        if (step === 448 || step === 464 || step === 480) {
            playState.camTargetX = 500; playState.camTargetY = 450;
        }
        if (step === 460 || step === 476 || step === 492) {
            playState.camTargetX = 850; playState.camTargetY = 450;
        }

        if (step === 805) {
            if (playState.bf) playState.bf.playAnim('lock in', true);
            if (playState.props['player'] && typeof playState.props['player'].gotoAndPlay === 'function') {
                playState.props['player'].gotoAndPlay(0);
            }
        }
        if (step === 812) {
            if (playState.bf) playState.bf.playAnim('cock', true);
            if (playState.dad) playState.dad.playAnim('singright', true);
        }
        if (step === 816) {
            if (playState.bf) playState.bf.playAnim('blast', true);
            if (playState.dad) playState.dad.playAnim('shock', true);
        }
    }

    // 3. "Trot Away"
    if (currentSong.includes('trot')) {
        if (step === 840) {
            playState.isDark = true;
            if (playState.props['subtract']) playState.props['subtract'].alpha = 0.5;
            playState.updateHealthBar();
        }
        if (step === 1096) {
            playState.isDark = false;
            if (playState.props['caught']) playState.props['caught'].alpha = 1;
            if (playState.props['subtract']) playState.props['subtract'].alpha = 0.11;
            playState.updateHealthBar();
        }
    }

    // 4. "Don't Lied"
    if (currentSong.includes('lied')) {
        if (step === 1184) {
            if (playState.props['loblack']) playState.props['loblack'].alpha = 1;
            if (playState.gf) playState.gf.container.alpha = 0.001;
            if (playState.dad) playState.dad.idleSuffix = '-alt';
        }
        if (step === 1232) {
            if (playState.dad) playState.dad.container.position.x = 690;
        }
        if (step === 1376) {
            if (playState.props['loblack']) playState.props['loblack'].alpha = 0;
            if (playState.gf) playState.gf.container.alpha = 1;
        }
        if (step === 1394) {
            playState.hesDying = true;
            if (playState.dad) playState.dad.playAnim('stab', true);
        }
        if (step === 1396) {
            if (playState.props['blooodfuckkk']) {
                playState.props['blooodfuckkk'].alpha = 0.8;
                setTimeout(() => { if (playState.props['blooodfuckkk']) playState.props['blooodfuckkk'].alpha = 0.2; }, 100);
            }
            if (playState.gf) playState.gf.playAnim('sad', true);
        }
        if (step === 1408) {
            if (playState.dad) playState.dad.idleSuffix = '-fart';
            if (playState.props['loblack2']) playState.props['loblack2'].alpha = 0.6;
        }
    }

    // 5. "Triple Threat"
    if (currentSong.includes('threat')) {
        if (step === 240) {
            if (playState.extraChars.maroon) playState.extraChars.maroon.container.visible = true;
            if (playState.dad) playState.dad.playAnim('wow', true);
            playState.dadCam = [850, 550];
        }
        if (step === 680) {
            playVideoCutscene('tthreat');
        }
        if (step === 690) {
            if (playState.extraChars.grey) playState.extraChars.grey.container.visible = true;
            playState.dadCam = [300, 660];
        }
        if (step === 1300) {
            if (playState.extraChars.maroon) playState.extraChars.maroon.playAnim('shift', true);
        }
        if (step === 1304) {
            if (playState.bf) playState.bf.playAnim('hey', true);
        }
        if (step === 1320) {
            if (playState.extraChars.maroon) playState.extraChars.maroon.container.visible = false;
            if (playState.extraChars.maroonParasite) playState.extraChars.maroonParasite.container.visible = true;
            playState.dadCam = [700, 550];
        }
        if (step === 1848) {
            if (playState.dad) playState.dad.playAnim('bruh', true);
        }
        if (step === 2064) {
            if (playState.dad) playState.dad.playAnim('holy shit', true);
        }
    }
}

function onBeatHit(beat) {
    if (!playState) return;
    const currentSong = playState.songItem.id.toLowerCase();

    if (currentSong.includes('49')) {
        if (beat % 2 === 0 && playState.props['shit'] && typeof playState.props['shit'].gotoAndPlay === 'function') {
            playState.props['shit'].gotoAndPlay(0);
        }
        if (beat % 1 === 0) {
            if (playState.props['tawny'] && typeof playState.props['tawny'].gotoAndPlay === 'function') {
                playState.props['tawny'].gotoAndPlay(0);
            }
            if (playState.props['graypet'] && typeof playState.props['graypet'].gotoAndPlay === 'function') {
                playState.props['graypet'].gotoAndPlay(0);
            }
        }
    }

    if (currentSong.includes('trot') && beat % 2 === 0 && playState.props['caught'] && typeof playState.props['caught'].gotoAndPlay === 'function') {
        playState.props['caught'].gotoAndPlay(0);
    }

    if (playState.gf && playState.gf.container.visible) {
        playState.gfDanceLeft = !playState.gfDanceLeft;
        playState.gf.playAnim(playState.gfDanceLeft ? 'danceleft' : 'danceright', true);
    }

    if (playState.dad && playState.dad.holdTimer <= 0) playState.dad.playAnim('idle');
    if (playState.bf && playState.bf.holdTimer <= 0) playState.bf.playAnim('idle');

    if (playState.extraChars.maroon && playState.extraChars.maroon.holdTimer <= 0) playState.extraChars.maroon.playAnim('idle');
    if (playState.extraChars.grey && playState.extraChars.grey.holdTimer <= 0) playState.extraChars.grey.playAnim('idle');
    if (playState.extraChars.maroonParasite && playState.extraChars.maroonParasite.holdTimer <= 0) playState.extraChars.maroonParasite.playAnim('idle');

    playState.receptors.forEach(r => r.container.scale.set(1.06));
}

app.ticker.add((delta) => {
    const deltaSec = delta / 60;
    Conductor.update();

    if (playState) {
        playState.update(deltaSec);
        if (playState.ratingText && playState.ratingText.scale.x > 1.0) {
            playState.ratingText.scale.x -= delta * 0.05;
            playState.ratingText.scale.y -= delta * 0.05;
        }
    }
});

const KEY_MAP = {
    'KeyD': 0, 'ArrowLeft': 0,
    'KeyF': 1, 'ArrowDown': 1,
    'KeyJ': 2, 'ArrowUp': 2,
    'KeyK': 3, 'ArrowRight': 3
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        returnToFreeplay();
        return;
    }

    if (playState && KEY_MAP[e.code] !== undefined) {
        if (!e.repeat) playState.onKeyPress(KEY_MAP[e.code]);
    }
});

async function loadAnimatedProp(stageFolder, propName) {
    let pngEntry = null;
    let xmlEntry = null;

    for (const [path, entry] of Object.entries(VirtualFS.assets)) {
        if (path.includes(`bg/${stageFolder}/`) || path.includes(`bg/`)) {
            if (path.endsWith(`/${propName}.png`) || path.endsWith(`${propName}.png`)) pngEntry = entry;
            if (path.endsWith(`/${propName}.xml`) || path.endsWith(`${propName}.xml`)) xmlEntry = entry;
        }
    }

    if (pngEntry && xmlEntry) {
        try {
            const pngBlob = await pngEntry.async('blob');
            const xmlRaw = await xmlEntry.async('string');
            const xmlClean = xmlRaw.replace(/^\uFEFF/, '').trim();
            const imgUrl = createTrackedBlobUrl(pngBlob);
            const tex = await PIXI.Texture.fromURL(imgUrl);
            const xmlDoc = new DOMParser().parseFromString(xmlClean, 'text/xml');
            return parseSparrowAtlas(tex.baseTexture, xmlDoc);
        } catch(e) {
            console.warn("Failed loading animated prop:", propName, e);
        }
    }
    return null;
}

async function launchSong(item) {
    if (activeCountdownTimer) {
        clearTimeout(activeCountdownTimer);
        activeCountdownTimer = null;
    }

    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    Conductor.stop();
    Conductor.setBPM(item.bpm);

    freeplayScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');

    if (playState) {
        playState.destroy();
        playState = null;
    }

    const songId = item.id.toLowerCase();
    const cleanId = songId.replace(/[^a-z0-9]/g, '');

    if (songId.includes('49')) await playVideoCutscene('49');
    else if (songId.includes('suspect')) await playVideoCutscene('suspect');
    else if (songId.includes('lied')) await playVideoCutscene('dontlied');

    try {
        if (!VirtualFS.audioBufferCache[cleanId]) {
            const audioToLoad = [];
            for (const [path, entry] of Object.entries(VirtualFS.assets)) {
                const cleanPath = path.replace(/[^a-z0-9\/\.]/g, '');
                if (cleanPath.includes(`/${cleanId}/`) || cleanPath.includes(`songs/${cleanId}`)) {
                    if (cleanPath.endsWith('.ogg')) audioToLoad.push(entry);
                }
            }

            const decodedBuffers = [];
            for (const entry of audioToLoad) {
                const buffer = await entry.async('arraybuffer');
                const decoded = await audioCtx.decodeAudioData(buffer.slice(0));
                decodedBuffers.push(decoded);
            }
            VirtualFS.audioBufferCache[cleanId] = decodedBuffers;
        }

        for (const decoded of VirtualFS.audioBufferCache[cleanId]) {
            const source = audioCtx.createBufferSource();
            source.buffer = decoded;
            source.connect(audioCtx.destination);
            Conductor.activeSources.push(source);
        }

        const dadChar = await loadCharacter(item.player2, false, false);
        const bfChar = await loadCharacter(item.player1, true, false);
        const gfChar = await loadCharacter(item.id.includes('suspect') ? 'deadnoob49' : (item.id.includes('trot') ? 'gfweird-sheriff' : 'gfweird'), false, true);

        const extraChars = {};
        if (cleanId.includes('threat')) {
            extraChars.maroon = await loadCharacter('maroonthreat', false, false);
            extraChars.grey = await loadCharacter('greythreat', false, false);
            extraChars.maroonParasite = await loadCharacter('maroonParasite', false, false);
        }

        const stageData = {};
        const stageFolder = (item.stage || 'security').toLowerCase().includes('sec') ? 'security' : (item.stage || 'security').toLowerCase();
        const stageJson = VirtualFS.stageJsons[item.stage] || VirtualFS.stageJsons[stageFolder] || null;

        for (const [path, entry] of Object.entries(VirtualFS.assets)) {
            if (path.includes(`bg/${stageFolder}/`)) {
                const key = path.split('/').pop().replace(/\.(png|jpg)$/, '');
                if (path.endsWith('.png') || path.endsWith('.jpg')) {
                    const blob = await entry.async('blob');
                    const imgUrl = createTrackedBlobUrl(blob);
                    stageData[key] = await PIXI.Texture.fromURL(imgUrl);
                }
            }
        }

        const stageProps = {};
        for (const path of Object.keys(VirtualFS.assets)) {
            if (path.includes(`bg/${stageFolder}/`)) {
                if (path.endsWith('.xml')) {
                    const propKey = path.split('/').pop().replace('.xml', '').toLowerCase();
                    stageProps[propKey] = await loadAnimatedProp(stageFolder, propKey);
                }
            }
        }

        playState = new PlayStateScene(item, dadChar, bfChar, gfChar, stageData, stageProps, stageJson, extraChars);

        activeCountdownTimer = setTimeout(() => {
            if (playState) {
                playState.showRating("GO!", 0x2ed573);
                const playTime = audioCtx.currentTime + 0.05;
                Conductor.activeSources.forEach(s => s.start(playTime));
                Conductor.start();
            }
            activeCountdownTimer = null;
        }, 1500);

    } catch(err) {
        console.error("Launch error:", err);
        alert("Failed to start song. Check console (F12).");
        returnToFreeplay();
    }
}

function returnToFreeplay() {
    if (activeCountdownTimer) {
        clearTimeout(activeCountdownTimer);
        activeCountdownTimer = null;
    }

    Conductor.stop();
    if (playState) {
        playState.destroy();
        playState = null;
    }

    videoOverlay.pause();
    videoOverlay.style.display = 'none';

    gameContainer.classList.add('hidden');
    freeplayScreen.classList.remove('hidden');
}
