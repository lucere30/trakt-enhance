// 放映厅：老胶片片头倒计时（5 → 3），然后投出一帧剧照和一张台词字幕卡。点一下换下一卷。
// 台词和剧照地址来自 /films.json（部署时由 scripts/build-films.mjs 生成），剧照直接从 TMDb 图片服务器加载；
// 系统开启「减弱动态效果」时跳过动画。
(() => {
    // films.json 加载失败时用这一条兜底
    const FALLBACK_FILMS = [{ line: "毕竟，明天又是新的一天。", original: "After all, tomorrow is another day.", source: "《乱世佳人》1939", still: null }];

    const COUNT_FROM = 5;
    const COUNT_TO = 3;
    const BEAT_MS = 550;
    const FLASH_MS = 220;
    const STILL_FADE_MS = 900;
    const FPS = 24;

    const canvas = document.getElementById("film");
    const ctx = canvas.getContext("2d");
    const card = document.getElementById("card");
    const screen = document.getElementById("screen");
    const rollButton = document.getElementById("roll");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let films = FALLBACK_FILMS;
    let deck = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let phase = "countdown";
    let phaseStart = 0;
    let lastFrame = 0;
    let reelNumber = 0;
    let upcoming = null; // 倒计时期间预加载的下一卷 { film, image }
    let current = null; // 正在放映的那一卷
    const grainTiles = [];

    // ---------- 数据 ----------

    function shuffle(items) {
        const result = items.slice();
        for (let i = result.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    function prepareNext() {
        if (deck.length === 0) {
            deck = shuffle(films);
        }
        const film = deck.pop();
        let image = null;
        if (film.still) {
            image = new Image();
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("load", () => {
                if (reduceMotion.matches && current?.image === image) {
                    drawProjection(performance.now(), false);
                }
            });
            image.src = film.still;
        }
        upcoming = { film, image };
    }

    async function loadFilms() {
        try {
            const response = await fetch("/films.json", { cache: "no-cache" });
            const list = await response.json();
            const valid = Array.isArray(list) ? list.filter((item) => item && typeof item.line === "string" && typeof item.source === "string") : [];
            if (valid.length > 0) {
                films = valid.map((item) => ({
                    line: item.line,
                    original: typeof item.original === "string" ? item.original : "",
                    source: item.source,
                    // 只接受 TMDb 图片服务器的 https 地址
                    still: typeof item.still === "string" && item.still.startsWith("https://image.tmdb.org/") ? item.still : null,
                }));
            }
        } catch {
            // 用兜底的那一条
        }
        deck = [];
    }

    // ---------- 准备 ----------

    function makeGrainTiles() {
        const size = 160;
        for (let t = 0; t < 4; t += 1) {
            const tile = document.createElement("canvas");
            tile.width = size;
            tile.height = size;
            const tileCtx = tile.getContext("2d");
            const image = tileCtx.createImageData(size, size);
            for (let i = 0; i < image.data.length; i += 4) {
                const v = Math.random() * 255;
                image.data[i] = v;
                image.data[i + 1] = v;
                image.data[i + 2] = v;
                image.data[i + 3] = Math.random() < 0.5 ? 255 : 0;
            }
            tileCtx.putImageData(image, 0, 0);
            grainTiles.push(ctx.createPattern(tile, "repeat"));
        }
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = Math.floor(window.innerWidth * dpr);
        height = Math.floor(window.innerHeight * dpr);
        canvas.width = width;
        canvas.height = height;
        if (reduceMotion.matches) {
            drawProjection(performance.now(), false);
        }
    }

    // ---------- 绘制 ----------

    function drawGrain(alpha) {
        const pattern = grainTiles[Math.floor(Math.random() * grainTiles.length)];
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = "overlay";
        ctx.translate(Math.random() * 160, Math.random() * 160);
        ctx.fillStyle = pattern;
        ctx.fillRect(-160, -160, width + 320, height + 320);
        ctx.restore();
    }

    function drawScratches(chance, alpha) {
        if (Math.random() > chance) {
            return;
        }
        const count = 1 + Math.floor(Math.random() * 2);
        ctx.save();
        for (let i = 0; i < count; i += 1) {
            const x = Math.random() * width;
            ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
            ctx.strokeStyle = Math.random() < 0.6 ? "#f6efe2" : "#14110e";
            ctx.lineWidth = (0.6 + Math.random()) * dpr;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.bezierCurveTo(x + (Math.random() - 0.5) * 8 * dpr, height * 0.33, x + (Math.random() - 0.5) * 8 * dpr, height * 0.66, x + (Math.random() - 0.5) * 6 * dpr, height);
            ctx.stroke();
        }
        if (Math.random() < 0.5) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = "#14110e";
            ctx.beginPath();
            ctx.arc(Math.random() * width, Math.random() * height, (1 + Math.random() * 3) * dpr, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawVignette(strength) {
        const r = Math.hypot(width, height) / 2;
        const gradient = ctx.createRadialGradient(width / 2, height / 2, r * 0.35, width / 2, height / 2, r);
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(1, `rgba(0,0,0,${strength})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }

    function drawSprockets(now, alpha) {
        const strip = Math.max(14 * dpr, Math.min(width, height) * 0.055);
        const holeH = strip * 0.62;
        const holeW = strip * 0.48;
        const gap = holeH * 1.9;
        const offset = ((now / 6) * dpr) % gap;
        ctx.save();
        ctx.globalAlpha = alpha;
        for (const x0 of [0, width - strip]) {
            ctx.fillStyle = "#050404";
            ctx.fillRect(x0, 0, strip, height);
            ctx.fillStyle = "#c9bfae";
            for (let y = -gap + offset; y < height + gap; y += gap) {
                const x = x0 + (strip - holeW) / 2;
                const radius = holeW * 0.22;
                ctx.beginPath();
                ctx.moveTo(x + radius, y);
                ctx.arcTo(x + holeW, y, x + holeW, y + holeH, radius);
                ctx.arcTo(x + holeW, y + holeH, x, y + holeH, radius);
                ctx.arcTo(x, y + holeH, x, y, radius);
                ctx.arcTo(x, y, x + holeW, y, radius);
                ctx.closePath();
                ctx.fill();
            }
        }
        ctx.restore();
    }

    function drawLeader(now) {
        const elapsed = now - phaseStart;
        const beat = Math.floor(elapsed / BEAT_MS);
        const number = COUNT_FROM - beat;
        const progress = (elapsed % BEAT_MS) / BEAT_MS;
        const flicker = 0.9 + Math.random() * 0.1;
        const weave = (Math.random() - 0.5) * 2 * dpr;
        const cx = width / 2;
        const cy = height / 2 + weave;
        const ring = Math.min(width, height) * 0.3;

        ctx.save();
        ctx.fillStyle = `rgb(${Math.round(150 * flicker)},${Math.round(141 * flicker)},${Math.round(124 * flicker)})`;
        ctx.fillRect(0, 0, width, height);

        // 扫过的扇形
        ctx.fillStyle = "rgba(40,34,27,0.42)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, Math.hypot(width, height), -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.closePath();
        ctx.fill();

        // 十字线和圆环
        ctx.strokeStyle = "rgba(24,20,16,0.85)";
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(width, cy);
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, height);
        ctx.stroke();

        ctx.strokeStyle = "rgba(248,242,230,0.92)";
        ctx.lineWidth = 3 * dpr;
        for (const r of [ring, ring * 1.16]) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 数字
        ctx.fillStyle = "#16120e";
        ctx.font = `700 ${Math.round(ring * 1.3)}px Georgia, "Times New Roman", serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(number), cx, cy + ring * 0.06);
        ctx.restore();

        drawGrain(0.32);
        drawScratches(0.45, 0.5);
        drawVignette(0.72);
        drawSprockets(now, 0.9);

        // 每一拍刚开始闪一下，像换了一格
        if (progress < 0.08) {
            ctx.fillStyle = "rgba(255,248,232,0.18)";
            ctx.fillRect(0, 0, width, height);
        }
    }

    // 把剧照按 cover 方式画进字幕卡上方的银幕区域
    function drawStill(now, animated, flicker) {
        const image = current?.image;
        if (!image?.complete || image.naturalWidth === 0) {
            return;
        }
        const rect = screen.getBoundingClientRect();
        if (rect.width === 0) {
            return;
        }
        const weave = animated ? (Math.random() - 0.5) * 1.6 * dpr : 0;
        const x = rect.left * dpr;
        const y = rect.top * dpr + weave;
        const w = rect.width * dpr;
        const h = rect.height * dpr;
        const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
        const sw = w / scale;
        const sh = h / scale;
        const sx = (image.naturalWidth - sw) / 2;
        const sy = (image.naturalHeight - sh) / 2;
        const fade = animated ? Math.min(1, (now - phaseStart) / STILL_FADE_MS) : 1;

        ctx.save();
        // 银幕边缘的漏光
        ctx.shadowColor = `rgba(255,214,150,${0.35 * fade})`;
        ctx.shadowBlur = 40 * dpr;
        ctx.fillStyle = "#000";
        ctx.fillRect(x, y, w, h);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = fade * flicker;
        ctx.filter = "sepia(0.35) contrast(1.08) saturate(0.85)";
        ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
        ctx.restore();
    }

    function drawProjection(now, animated) {
        const flicker = animated ? 0.94 + Math.random() * 0.06 : 1;
        ctx.fillStyle = `rgb(${Math.round(16 * flicker)},${Math.round(14 * flicker)},${Math.round(12 * flicker)})`;
        ctx.fillRect(0, 0, width, height);

        // 放映机的光
        const glow = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.7);
        glow.addColorStop(0, `rgba(255,214,150,${0.09 * flicker})`);
        glow.addColorStop(1, "rgba(255,214,150,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);

        drawStill(now, animated, flicker);
        drawGrain(animated ? 0.14 : 0.08);
        if (animated) {
            drawScratches(0.14, 0.28);
        }
        drawVignette(0.78);
        drawSprockets(animated ? now : 0, 0.45);
    }

    function drawFlash(now) {
        const t = (now - phaseStart) / FLASH_MS;
        drawProjection(now, true);
        ctx.fillStyle = `rgba(255,246,228,${Math.max(0, 1 - t)})`;
        ctx.fillRect(0, 0, width, height);
    }

    // ---------- 流程 ----------

    function showCard() {
        if (!upcoming) {
            prepareNext();
        }
        current = upcoming;
        upcoming = null;
        const { film } = current;
        reelNumber += 1;
        document.getElementById("reel").textContent = `第 ${reelNumber} 卷 · Reel ${String(reelNumber).padStart(2, "0")}`;
        document.getElementById("line").textContent = film.line;
        document.getElementById("original").textContent = film.original;
        document.getElementById("source").textContent = film.source;
        screen.hidden = !film.still;
        card.classList.add("show");
        rollButton.classList.add("show");
        prepareNext();
    }

    function startCountdown(now) {
        card.classList.remove("show");
        rollButton.classList.remove("show");
        phase = "countdown";
        phaseStart = now;
    }

    function startFlash(now) {
        phase = "flash";
        phaseStart = now;
        showCard();
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (now - lastFrame < 1000 / FPS) {
            return;
        }
        lastFrame = now;

        if (phase === "countdown") {
            if (now - phaseStart >= (COUNT_FROM - COUNT_TO + 1) * BEAT_MS) {
                startFlash(now);
            } else {
                drawLeader(now);
                return;
            }
        }
        if (phase === "flash") {
            if (now - phaseStart >= FLASH_MS) {
                phase = "projecting";
            } else {
                drawFlash(now);
                return;
            }
        }
        drawProjection(now, true);
    }

    function advance() {
        const now = performance.now();
        if (reduceMotion.matches) {
            showCard();
            drawProjection(now, false);
            return;
        }
        if (phase === "countdown") {
            startFlash(now);
        } else {
            startCountdown(now);
        }
    }

    // ---------- 启动 ----------

    makeGrainTiles();
    resize();
    window.addEventListener("resize", resize);
    document.body.addEventListener("click", (event) => {
        if (event.target !== rollButton) {
            advance();
        }
    });
    rollButton.addEventListener("click", advance);
    document.addEventListener("keydown", (event) => {
        if ((event.key === " " || event.key === "Enter") && event.target === document.body) {
            event.preventDefault();
            advance();
        }
    });

    // 先开始倒计时，片单在倒计时期间加载好，第一卷就能带上剧照
    if (reduceMotion.matches) {
        phase = "projecting";
        loadFilms().then(() => {
            showCard();
            drawProjection(performance.now(), false);
        });
    } else {
        startCountdown(performance.now());
        requestAnimationFrame(frame);
        loadFilms().then(prepareNext);
    }
})();
