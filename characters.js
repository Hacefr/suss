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

        // Matches bop0001, bop01, bop0, bop 1, etc.
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
        this.animMap = {};
        this.animMatrices = {};

        if (this.charConfig.animations) {
            this.charConfig.animations.forEach(a => {
                const prefixLower = a.prefix.toLowerCase();
                const matchedSym = Object.keys(this.symbols).find(s => s.toLowerCase().startsWith(prefixLower) || prefixLower.startsWith(s.toLowerCase()));
                if (matchedSym) {
                    this.animMap[a.name.toLowerCase()] = matchedSym;
                    this.animMatrices[a.name.toLowerCase()] = this.rootMatrices[matchedSym] || new PIXI.Matrix();
                }
            });
        }

        for (const symName of Object.keys(this.symbols)) {
            const lower = symName.toLowerCase();
            const assign = (key) => {
                if (!this.animMap[key]) {
                    this.animMap[key] = symName;
                    this.animMatrices[key] = this.rootMatrices[symName] || new PIXI.Matrix();
                }
            };

            if (this.isGF) {
                if (lower.includes('idle1') || lower.includes('idleleft')) assign('danceleft');
                if (lower.includes('idle2') || lower.includes('idleright')) assign('danceright');
            } else {
                if (lower.includes('idle')) assign('idle');
                if (lower.includes('left') && !lower.includes('miss')) { assign('left'); assign('singleft'); }
                if (lower.includes('down') && !lower.includes('miss')) { assign('down'); assign('singdown'); }
                if (lower.includes('up') && !lower.includes('miss')) { assign('up'); assign('singup'); }
                if (lower.includes('right') && !lower.includes('miss')) { assign('right'); assign('singright'); }
            }
        }

        this.currentAnim = this.isGF ? 'danceright' : 'idle';
        this.frame = 0;
        this.frameTimer = 0;
        this.holdTimer = 0;
        this.fps = 24;

        const charScale = this.charConfig.scale || 1.0;
        this.container.scale.set(this.charConfig.flipX ? -charScale : charScale, charScale);

        this.playAnim(this.currentAnim, true);
    }

    playAnim(animName, forced = false) {
        let clean = animName.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (this.charName.includes('pinkthreat') && this.idleSuffix === '-bruh') {
            if (clean.includes('left')) clean = 'lbruh';
            if (clean.includes('down')) clean = 'dbruh';
            if (clean.includes('up')) clean = 'ubruh';
            if (clean.includes('right')) clean = 'rbruh';
        }

        let targetTimelineKey = Object.keys(this.timelineAnims).find(k => {
            const kc = k.replace(/[^a-z0-9]/g, '');
            return kc === clean || kc.startsWith(clean) || clean.startsWith(kc);
        });

        if (!targetTimelineKey && animName.includes('idle')) {
            targetTimelineKey = Object.keys(this.timelineAnims).find(k => k.includes('idle'));
        }

        if (targetTimelineKey) {
            this.mode = 'timeline';
            this.currentAnim = targetTimelineKey;
            this.activeAnimData = this.timelineAnims[targetTimelineKey];
            this.frame = 0;
            this.frameTimer = 0;
            if (!targetTimelineKey.includes('idle')) this.holdTimer = 0.35;
            this.renderCurrentFrame();
            return;
        }

        let targetKey = Object.keys(this.animMap).find(k => {
            const kc = k.replace(/[^a-z0-9]/g, '');
            return kc === clean || kc.startsWith(clean) || clean.startsWith(kc);
        });

        if (!targetKey && animName.includes('idle')) targetKey = this.isGF ? 'danceright' : 'idle';

        if (targetKey && this.animMap[targetKey]) {
            this.mode = 'symbol';
            this.currentAnim = targetKey;
            this.activeSymbolName = this.animMap[targetKey];
            this.frame = 0;
            this.frameTimer = 0;
            if (!targetKey.includes('idle')) this.holdTimer = 0.35;
            this.renderCurrentFrame();
        }
    }

    renderCurrentFrame() {
        this.displayContainer.removeChildren();
        const self = this;

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
                            spr.transform.setFromMatrix(parentMat.clone().append(localMat));
                            target.addChild(spr);
                        }
                    } else if (el.SI) {
                        let subFrame = (el.SI.LP === "SF") ? (el.SI.FF || 0) : (frameNum - activeFR.I + (el.SI.FF || 0));
                        const localMat = extractMatrix(el.SI);
                        renderSymbolInstance(el.SI.SN, subFrame, parentMat.clone().append(localMat), target);
                    }
                }
            }
        }

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

                    if (this.charName.includes('pico')) baseMat.translate(116, -180);
                    else if (this.charName.includes('noob')) baseMat.translate(-120, -320);
                    else if (this.charName.includes('detective')) baseMat.translate(0, -220);
                    else if (this.charName.includes('horse')) baseMat.translate(0, -260);

                    baseMat.translate(this.globalOffset[0] || 0, this.globalOffset[1] || 0);

                    if (el.ASI) {
                        const tex = this.spritemap[el.ASI.N];
                        if (tex) {
                            const spr = new PIXI.Sprite(tex);
                            spr.transform.setFromMatrix(baseMat.append(extractMatrix(el.ASI)));
                            this.displayContainer.addChild(spr);
                        }
                    } else if (el.SI) {
                        let subFrame = (el.SI.LP === "SF") ? (el.SI.FF || 0) : (masterFrame - activeFR.I + (el.SI.FF || 0));
                        const localMat = extractMatrix(el.SI);
                        renderSymbolInstance(el.SI.SN, subFrame, baseMat.clone().append(localMat), this.displayContainer);
                    }
                }
            }
            return;
        }

        if (this.mode === 'symbol' && this.activeSymbolName) {
            const animMat = this.animMatrices[this.currentAnim] || this.rootMatrices[this.activeSymbolName] || new PIXI.Matrix();
            const rootMat = animMat.clone();

            if (this.isPlayer) rootMat.translate(-405, -280);
            else if (this.isGF) rootMat.translate(-350, -320);
            else rootMat.translate(-200, -320);

            rootMat.translate(this.globalOffset[0] || 0, this.globalOffset[1] || 0);
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
                    this.frame = (this.currentAnim.includes('idle')) ? 0 : this.activeAnimData.duration - 1;
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
                        this.frame = (this.currentAnim.includes('idle')) ? 0 : maxFrames - 1;
                    }
                }
            }

            this.renderCurrentFrame();
        }
    }
}

async function loadCharacter(charName, isPlayer, isGF = false) {
    const clean = charName.toLowerCase().trim();
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
        let isMatch = false;

        if (isGF) {
            isMatch = path.includes(`characters/gf/cosmicube/${clean}`) || path.includes('/gf/');
        } else if (isPlayer) {
            if (clean.includes('pico')) isMatch = path.includes('characters/pico/cosmicube/');
            else isMatch = path.includes(`characters/bf/cosmicube/${clean}`) || path.includes('characters/bf/cosmicube/');
        } else {
            isMatch = path.includes(`characters/dlc/${clean}/`) || 
                      path.includes(`characters/triple/${clean}/`) || 
                      path.includes(`characters/triple/maroon/${clean}/`) ||
                      path.includes(`characters/${clean}/`);
        }

        if (isMatch) {
            if (path.endsWith('animation.json')) animJsonEntry = entry;
            if (path.endsWith('spritemap1.json')) spritemapJsonEntry = entry;
            if (path.endsWith('spritemap1.png')) spritemapPngEntry = entry;
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
