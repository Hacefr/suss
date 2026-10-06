function extractMatrix(el) {
    if (el.MX) return new PIXI.Matrix(...el.MX);
    if (el.M3D) return new PIXI.Matrix(el.M3D[0], el.M3D[1], el.M3D[4], el.M3D[5], el.M3D[12], el.M3D[13]);
    return new PIXI.Matrix();
}

function parseSparrowAtlas(baseTexture, xmlDoc) {
    if (!xmlDoc) return {};
    const subTextures = xmlDoc.getElementsByTagName("SubTexture");
    const anims = {};

    for (let i = 0; i < subTextures.length; i++) {
        const sub = subTextures[i];
        const rawName = sub.getAttribute("name");
        if (!rawName) continue;

        const match = rawName.match(/^(.*?)[-_ ]*([0-9]+)$/);
        const animName = match ? match[1].trim() : rawName.trim();

        const x = parseInt(sub.getAttribute("x") || 0, 10);
        const y = parseInt(sub.getAttribute("y") || 0, 10);
        const width = parseInt(sub.getAttribute("width") || 0, 10);
        const height = parseInt(sub.getAttribute("height") || 0, 10);
        const frameX = parseInt(sub.getAttribute("frameX") || 0, 10);
        const frameY = parseInt(sub.getAttribute("frameY") || 0, 10);
        const frameWidth = parseInt(sub.getAttribute("frameWidth") || width, 10);
        const frameHeight = parseInt(sub.getAttribute("frameHeight") || height, 10);

        const rect = new PIXI.Rectangle(x, y, width, height);
        const orig = new PIXI.Rectangle(0, 0, frameWidth, frameHeight);
        const trim = new PIXI.Rectangle(-frameX, -frameY, width, height);

        const texture = new PIXI.Texture(baseTexture, rect, orig, trim);
        if (!anims[animName]) anims[animName] = [];
        anims[animName].push(texture);
    }
    return anims;
}

class DynamicAtlasCharacter {
    constructor(baseTexture, animJson, spritemapJson, charName = '', isPlayer = false, isGF = false, globalOffset = [0, 0]) {
        this.charName = charName.toLowerCase();
        this.isPlayer = isPlayer;
        this.isGF = isGF;
        this.globalOffset = globalOffset;
        this.idleSuffix = '';

        this.container = new PIXI.Container();
        this.displayContainer = new PIXI.Container();
        this.container.addChild(this.displayContainer);

        this.spritemap = {};
        for (const item of spritemapJson.ATLAS.SPRITES) {
            const s = item.SPRITE;
            this.spritemap[s.name] = new PIXI.Texture(baseTexture, new PIXI.Rectangle(s.x, s.y, s.w, s.h));
        }

        this.symbols = {};
        if (animJson.SD && animJson.SD.S) {
            for (const s of animJson.SD.S) {
                this.symbols[s.SN] = s;
            }
        }

        this.timelineAnims = {};
        this.masterLayers = (animJson.AN && animJson.AN.TL && animJson.AN.TL.L) ? animJson.AN.TL.L : [];
        this.rootMatrices = {};

        for (const layer of this.masterLayers) {
            for (const fr of layer.FR || []) {
                if (fr.N) {
                    const label = fr.N.toLowerCase().trim();
                    this.timelineAnims[label] = { startFrame: fr.I, duration: fr.DU || 1 };
                }
                for (const el of fr.E || []) {
                    if (el.SI && el.SI.SN) {
                        this.rootMatrices[el.SI.SN] = extractMatrix(el.SI);
                    }
                }
            }
        }

        this.charConfig = VirtualFS.charJsons[this.charName] || {};
        this.animOffsets = {}; 

        if (this.charConfig.animations) {
            this.charConfig.animations.forEach(a => {
                this.animOffsets[a.name.toLowerCase()] = a.offsets || [0, 0];
            });
        }

        this.currentAnim = this.isGF ? 'danceright' : 'idle';
        this.frame = 0;
        this.frameTimer = 0;
        this.holdTimer = 0;
        this.fps = 24;

        const charScale = this.charConfig.scale || 1.0;
        this.isFlipped = !!this.charConfig.flipX;
        this.container.scale.set(this.isFlipped ? -charScale : charScale, charScale);

        this.playAnim(this.currentAnim, true);
    }

    playAnim(animName, forced = false) {
        let clean = animName.toLowerCase().trim();

        // 1. Pink Threat Alt-Anim Suffix Redirect (pinkthreat.hxc)
        if (this.charName.includes('pinkthreat') && this.idleSuffix === '-bruh') {
            if (clean.includes('left')) clean = 'lbruh';
            if (clean.includes('down')) clean = 'dbruh';
            if (clean.includes('up')) clean = 'ubruh';
            if (clean.includes('right')) clean = 'rbruh';
        }

        // 2. Lookup the official prefix from character JSON
        let targetPrefix = null;
        let animConfig = null;
        if (this.charConfig && this.charConfig.animations) {
            animConfig = this.charConfig.animations.find(a => {
                const aName = a.name.toLowerCase().trim();
                return aName === clean || clean.startsWith(aName) || aName.startsWith(clean);
            });
            if (animConfig && animConfig.prefix) {
                targetPrefix = animConfig.prefix.toLowerCase().trim();
            }
        }

        const candidates = [targetPrefix, clean, animName].filter(Boolean);

        // 3. Match against Master Timeline Labels (Pico, BF, Detective, Horsemate, Noob49)
        let matchedTimelineKey = null;
        for (const term of candidates) {
            const tClean = term.replace(/[^a-z0-9]/g, '');
            matchedTimelineKey = Object.keys(this.timelineAnims).find(k => {
                const kClean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                return kClean === tClean || kClean.startsWith(tClean) || tClean.startsWith(kClean);
            });
            if (matchedTimelineKey) break;
        }

        // GF / Idle fallbacks
        if (!matchedTimelineKey && clean.includes('idle')) {
            matchedTimelineKey = Object.keys(this.timelineAnims).find(k => k.toLowerCase().includes('idle'));
        }
        if (!matchedTimelineKey && clean.includes('dance')) {
            const isLeft = clean.includes('left');
            matchedTimelineKey = Object.keys(this.timelineAnims).find(k => {
                const kl = k.toLowerCase();
                return isLeft ? (kl.includes('left') || kl.includes('1')) : (kl.includes('right') || kl.includes('2'));
            });
        }

        if (matchedTimelineKey) {
            this.mode = 'timeline';
            this.currentAnim = animConfig ? animConfig.name.toLowerCase() : clean;
            this.activeTimelineKey = matchedTimelineKey;
            this.activeAnimData = this.timelineAnims[matchedTimelineKey];
            this.frame = 0;
            this.frameTimer = 0;
            if (!clean.includes('idle') && !clean.includes('dance')) this.holdTimer = 0.35;
            this.renderCurrentFrame();
            return;
        }

        // 4. Fallback to Symbol Mode if not on timeline (e.g. Maroon Threat)
        let matchedSymKey = null;
        for (const term of candidates) {
            const tClean = term.replace(/[^a-z0-9]/g, '');
            matchedSymKey = Object.keys(this.symbols).find(k => {
                const kClean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                return kClean === tClean || kClean.startsWith(tClean) || tClean.startsWith(kClean);
            });
            if (matchedSymKey) break;
        }

        if (matchedSymKey) {
            this.mode = 'symbol';
            this.currentAnim = animConfig ? animConfig.name.toLowerCase() : clean;
            this.activeSymbolName = matchedSymKey;
            this.frame = 0;
            this.frameTimer = 0;
            if (!clean.includes('idle') && !clean.includes('dance')) this.holdTimer = 0.35;
            this.renderCurrentFrame();
        }
    }

    renderCurrentFrame() {
        this.displayContainer.removeChildren();
        const self = this;

        // Data-driven NightmareVision offsets: (stagePos - animOffset)
        const curOffset = this.animOffsets[this.currentAnim] || [0, 0];
        const offX = (this.isFlipped ? (curOffset[0] || 0) : -(curOffset[0] || 0)) + (this.globalOffset[0] || 0);
        const offY = -(curOffset[1] || 0) + (this.globalOffset[1] || 0);

        // Correct child -> parent matrix multiplication: child.clone().append(parent)
        function renderSymbolInstance(symName, frameNum, parentMat, target) {
            const sym = self.symbols[symName];
            if (!sym || !sym.TL || !sym.TL.L) return;

            for (let l = sym.TL.L.length - 1; l >= 0; l--) {
                const layer = sym.TL.L[l];
                if (!layer.FR || layer.FR.length === 0) continue;

                let activeFR = null;
                for (const fr of layer.FR) {
                    if (frameNum >= fr.I && frameNum < fr.I + fr.DU) {
                        activeFR = fr;
                        break;
                    }
                }

                if (!activeFR) activeFR = layer.FR[layer.FR.length - 1];
                if (!activeFR || !activeFR.E) continue;

                for (const el of activeFR.E) {
                    if (el.ASI) {
                        const tex = self.spritemap[el.ASI.N];
                        if (tex) {
                            const spr = new PIXI.Sprite(tex);
                            const localMat = extractMatrix(el.ASI);
                            const finalMat = localMat.clone().append(parentMat);
                            spr.transform.setFromMatrix(finalMat);
                            target.addChild(spr);
                        }
                    } else if (el.SI) {
                        let subFrame = (el.SI.LP === "SF") ? (el.SI.FF || 0) : (frameNum - activeFR.I + (el.SI.FF || 0));
                        const localMat = extractMatrix(el.SI);
                        const finalMat = localMat.clone().append(parentMat);
                        renderSymbolInstance(el.SI.SN, subFrame, finalMat, target);
                    }
                }
            }
        }

        // Style A: Master Timeline Mode (No Teleportation!)
        if (this.mode === 'timeline' && this.activeAnimData) {
            const masterFrame = this.activeAnimData.startFrame + this.frame;

            for (let l = this.masterLayers.length - 1; l >= 0; l--) {
                const layer = this.masterLayers[l];
                if (!layer.FR) continue;

                let activeFR = null;
                for (const fr of layer.FR) {
                    if (masterFrame >= fr.I && masterFrame < fr.I + fr.DU) {
                        activeFR = fr;
                        break;
                    }
                }

                if (!activeFR || !activeFR.E) continue;

                for (const el of activeFR.E) {
                    const baseMat = new PIXI.Matrix();
                    baseMat.translate(offX, offY);

                    if (el.ASI) {
                        const tex = this.spritemap[el.ASI.N];
                        if (tex) {
                            const spr = new PIXI.Sprite(tex);
                            const localMat = extractMatrix(el.ASI);
                            spr.transform.setFromMatrix(localMat.clone().append(baseMat));
                            this.displayContainer.addChild(spr);
                        }
                    } else if (el.SI) {
                        let subFrame = (el.SI.LP === "SF") ? (el.SI.FF || 0) : (masterFrame - activeFR.I + (el.SI.FF || 0));
                        const localMat = extractMatrix(el.SI);
                        const finalMat = localMat.clone().append(baseMat);
                        renderSymbolInstance(el.SI.SN, subFrame, finalMat, this.displayContainer);
                    }
                }
            }
            return;
        }

        // Style B: Symbol Mode (Maroon)
        if (this.mode === 'symbol' && this.activeSymbolName) {
            const rootMat = new PIXI.Matrix();
            rootMat.translate(offX, offY);

            renderSymbolInstance(this.activeSymbolName, this.frame, rootMat, this.displayContainer);
        }
    }

    update(deltaSec) {
        if (this.holdTimer > 0) {
            this.holdTimer -= deltaSec;
            if (this.holdTimer <= 0) {
                this.playAnim(this.isGF ? 'danceright' : 'idle');
            }
        }

        this.frameTimer += deltaSec;
        if (this.frameTimer >= (1 / this.fps)) {
            this.frameTimer = 0;
            this.frame++;

            if (this.mode === 'timeline' && this.activeAnimData) {
                if (this.frame >= this.activeAnimData.duration) {
                    this.frame = (this.currentAnim.includes('idle') || this.currentAnim.includes('dance')) ? 0 : this.activeAnimData.duration - 1;
                }
            } else if (this.mode === 'symbol' && this.activeSymbolName) {
                const sym = this.symbols[this.activeSymbolName];
                if (sym) {
                    let maxFrames = 1;
                    for (const layer of sym.TL.L || []) {
                        for (const fr of layer.FR || []) {
                            maxFrames = Math.max(maxFrames, fr.I + fr.DU);
                        }
                    }
                    if (this.frame >= maxFrames) {
                        this.frame = (this.currentAnim.includes('idle') || this.currentAnim.includes('dance')) ? 0 : maxFrames - 1;
                    }
                }
            }

            this.renderCurrentFrame();
        }
    }
}

// Character loader (Dead Noob fix: matches by folder identity rather than slot identity)
async function loadCharacter(charName, isPlayer, isGF = false) {
    const clean = charName.toLowerCase().trim();
    const cleanId = clean.replace(/[^a-z0-9]/g, '');
    const charConfig = VirtualFS.charJsons[clean] || {};
    let globalX = 0;
    let globalY = 0;

    if (Array.isArray(charConfig.position) && charConfig.position.length >= 2) {
        globalX += charConfig.position[0];
        globalY += charConfig.position[1];
    } else if (Array.isArray(charConfig.offsets) && charConfig.offsets.length >= 2) {
        globalX += charConfig.offsets[0];
        globalY += charConfig.offsets[1];
    }

    let animJsonEntry = null;
    let spritemapJsonEntry = null;
    let spritemapPngEntry = null;

    for (const [path, entry] of Object.entries(VirtualFS.assets)) {
        const pNorm = path.replace(/\\/g, '/').toLowerCase();
        const folderPart = pNorm.split('/').slice(0, -1).join('/');
        const folderNorm = folderPart.replace(/[^a-z0-9]/g, '');

        if (folderNorm.includes(cleanId) || folderPart.endsWith(`/${clean}`) || folderPart.endsWith(`/${cleanId}`)) {
            if (pNorm.endsWith('animation.json')) animJsonEntry = entry;
            if (pNorm.endsWith('spritemap1.json')) spritemapJsonEntry = entry;
            if (pNorm.endsWith('spritemap1.png')) spritemapPngEntry = entry;
        }
    }

    if (animJsonEntry && spritemapJsonEntry && spritemapPngEntry) {
        try {
            const animText = sanitizeJsonText(await animJsonEntry.async('string'));
            const spritemapText = sanitizeJsonText(await spritemapJsonEntry.async('string'));
            const animJson = JSON.parse(animText);
            const spritemapJson = JSON.parse(spritemapText);

            const pngBlob = await spritemapPngEntry.async('blob');
            const imgUrl = createTrackedBlobUrl(pngBlob);
            const tex = await PIXI.Texture.fromURL(imgUrl);
            const baseTexture = tex.baseTexture;

            return new DynamicAtlasCharacter(baseTexture, animJson, spritemapJson, charName, isPlayer, isGF, [globalX, globalY]);
        } catch(err) {
            console.warn(`Atlas load failed for ${charName}:`, err);
        }
    }

    const cont = new PIXI.Container();
    return { container: cont, holdTimer: 0, playAnim: () => {}, update: () => {} };
}
