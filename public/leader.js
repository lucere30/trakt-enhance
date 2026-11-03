// 放映厅：第一卷前放一段老胶片片头倒计时（5 → 3），之后每部电影的剧照铺满屏幕、缓慢推移，
// 台词叠在下方；每隔一段时间（或点一下）用带漏光的溶解转场换到下一部。可开启按情绪生成的配乐（score.js）。
// 台词和剧照地址来自 /films.json（部署时由 scripts/build-films.mjs 生成），剧照直接从 TMDb 图片服务器加载；
// 系统开启「减弱动态效果」时不放倒计时、不推移、不自动换片。
(() => {
    // films.json 加载失败时用这一条兜底
    const FALLBACK_FILMS = [{ line: "毕竟，明天又是新的一天。", original: "After all, tomorrow is another day.", source: "《乱世佳人》1939", mood: "sweeping", still: null }];

    const COUNT_FROM = 5;
    const COUNT_TO = 3;
    const BEAT_MS = 550;
    const FLASH_MS = 260;
    const SHOW_MS = 9000; // 每部电影停留多久后自动换下一部
    const TRANSITION_MS = 1600;
    const TEXT_SWAP_MS = 520; // 转场开始后多久换上新台词
    const IMAGE_WAIT_MS = 2500; // 下一张剧照还没加载好时最多等多久
    const FPS = 24;

    const canvas = document.getElementById("film");
    const ctx = canvas.getContext("2d");
    const card = document.getElementById("card");
    const rollButton = document.getElementById("roll");
    const soundButton = document.getElementById("sound");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const score = window.LanternScore;

    let films = FALLBACK_FILMS;
    let deck = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let phase = "countdown"; // countdown → flash → showing ⇄ waiting → transition
    let phaseStart = 0;
    let lastFrame = 0;
    let reelNumber = 0;
    let current = null; // { film, image, start, panFrom, panTo }
    let previous = null;
    let upcoming = null;
    let textTimer = null;
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
                    drawStatic();
                }
            });
            image.src = film.still;
        }
        // 每部电影随机从左往右或从右往左推
        const leftToRight = Math.random() < 0.5;
        upcoming = { film, image, start: 0, panFrom: leftToRight ? 0.3 : 0.7, panTo: leftToRight ? 0.7 : 0.3 };
    }

    function isImageSettled(entry) {
        return !entry?.image || entry.image.complete;
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
                    mood: typeof item.mood === "string" ? item.mood : "gentle",
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
            drawStatic();
        }
    }

    // ---------- 绘制：胶片质感 ----------

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

    // ---------- 绘制：片头倒计时 ----------

    function drawLeader(now) {
        const elapsed = now - phaseStart;
        const number = COUNT_FROM - Math.floor(elapsed / BEAT_MS);
        const progress = (elapsed % BEAT_MS) / BEAT_MS;
        const flicker = 0.9 + Math.random() * 0.1;
        const cx = width / 2;
        const cy = height / 2 + (Math.random() - 0.5) * 2 * dpr;
        const ring = Math.min(width, height) * 0.3;

        ctx.save();
        ctx.fillStyle = `rgb(${Math.round(150 * flicker)},${Math.round(141 * flicker)},${Math.round(124 * flicker)})`;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "rgba(40,34,27,0.42)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, Math.hypot(width, height), -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.closePath();
        ctx.fill();

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

        if (progress < 0.08) {
            ctx.fillStyle = "rgba(255,248,232,0.18)";
            ctx.fillRect(0, 0, width, height);
        }
    }

    // ---------- 绘制：剧照 ----------

    function easeInOut(t) {
        return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    }

    // 剧照按 cover 铺满屏幕，缓慢放大并横向推移（竖屏时能看到整幅画面）
    function drawEntry(entry, now, alpha, animated) {
        const image = entry?.image;
        if (!image?.complete || image.naturalWidth === 0 || alpha <= 0) {
            return;
        }
        const t = animated ? Math.min(1, Math.max(0, (now - entry.start) / (SHOW_MS + TRANSITION_MS * 2))) : 0.5;
        const zoom = animated ? 1.04 + 0.08 * t : 1.04;
        const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
        const drawW = image.naturalWidth * scale;
        const drawH = image.naturalHeight * scale;
        const pan = entry.panFrom + (entry.panTo - entry.panFrom) * easeInOut(t);
        const x = -(drawW - width) * pan;
        const y = -(drawH - height) * 0.42;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.filter = "sepia(0.3) contrast(1.06) saturate(0.85)";
        ctx.drawImage(image, x, y, drawW, drawH);
        ctx.restore();
    }

    // 下半部分压暗，台词才看得清
    function drawCaptionShade() {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, "rgba(8,7,6,0.35)");
        gradient.addColorStop(0.3, "rgba(8,7,6,0)");
        gradient.addColorStop(0.5, "rgba(8,7,6,0.15)");
        gradient.addColorStop(0.78, "rgba(8,7,6,0.82)");
        gradient.addColorStop(1, "rgba(8,7,6,0.95)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }

    // 转场时一道暖色漏光从一侧扫过
    function drawLightLeak(t) {
        const strength = Math.sin(Math.PI * t) * 0.42;
        if (strength <= 0.01) {
            return;
        }
        const cx = width * (-0.2 + 1.4 * t);
        const gradient = ctx.createRadialGradient(cx, height * 0.35, 0, cx, height * 0.35, Math.max(width, height) * 0.75);
        gradient.addColorStop(0, `rgba(255,186,110,${strength})`);
        gradient.addColorStop(0.45, `rgba(255,120,60,${strength * 0.45})`);
        gradient.addColorStop(1, "rgba(255,120,60,0)");
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    function drawBackground(flicker) {
        ctx.fillStyle = `rgb(${Math.round(14 * flicker)},${Math.round(12 * flicker)},${Math.round(10 * flicker)})`;
        ctx.fillRect(0, 0, width, height);
    }

    function drawScene(now) {
        const flicker = 0.95 + Math.random() * 0.05;
        drawBackground(flicker);
        if (phase === "transition") {
            const t = Math.min(1, (now - phaseStart) / TRANSITION_MS);
            drawEntry(previous, now, (1 - easeInOut(t)) * flicker, true);
            drawEntry(current, now, easeInOut(t) * flicker, true);
            drawCaptionShade();
            drawLightLeak(t);
        } else {
            drawEntry(current, now, flicker, true);
            drawCaptionShade();
        }
        drawGrain(0.13);
        drawScratches(0.12, 0.26);
        drawVignette(0.6);
        drawSprockets(now, 0.4);
        if (phase === "flash") {
            const t = (now - phaseStart) / FLASH_MS;
            ctx.fillStyle = `rgba(255,246,228,${Math.max(0, 1 - t)})`;
            ctx.fillRect(0, 0, width, height);
        }
    }

    function drawStatic() {
        drawBackground(1);
        drawEntry(current, 0, 1, false);
        drawCaptionShade();
        drawGrain(0.08);
        drawVignette(0.6);
        drawSprockets(0, 0.4);
    }

    // ---------- 台词卡 ----------

    function setCaption(entry) {
        reelNumber += 1;
        const { film } = entry;
        document.getElementById("reel").textContent = `第 ${reelNumber} 卷 · Reel ${String(reelNumber).padStart(2, "0")}`;
        document.getElementById("line").textContent = film.line;
        document.getElementById("original").textContent = film.original;
        document.getElementById("source").textContent = film.source;
        card.classList.add("show");
        rollButton.classList.add("show");
    }

    function takeUpcoming(now) {
        if (!upcoming) {
            prepareNext();
        }
        previous = current;
        current = upcoming;
        current.start = now;
        upcoming = null;
        prepareNext();
        if (score?.isEnabled()) {
            score.play(current.film.mood, current.film.source);
        }
    }

    // ---------- 流程 ----------

    function startFirstFilm(now) {
        phase = "flash";
        phaseStart = now;
        takeUpcoming(now);
        setCaption(current);
    }

    // force：等剧照超时后照样转场，只是这一卷先没有画面
    function beginTransition(now, force = false) {
        if (!force && !isImageSettled(upcoming)) {
            phase = "waiting";
            phaseStart = now;
            return;
        }
        takeUpcoming(now);
        phase = "transition";
        phaseStart = now;
        card.classList.remove("show");
        clearTimeout(textTimer);
        textTimer = setTimeout(() => setCaption(current), TEXT_SWAP_MS);
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (now - lastFrame < 1000 / FPS) {
            return;
        }
        lastFrame = now;

        if (phase === "countdown") {
            if (now - phaseStart >= (COUNT_FROM - COUNT_TO + 1) * BEAT_MS) {
                startFirstFilm(now);
            } else {
                drawLeader(now);
                return;
            }
        }
        if (phase === "flash" && now - phaseStart >= FLASH_MS) {
            phase = "showing";
            phaseStart = now;
        }
        if (phase === "waiting" && (isImageSettled(upcoming) || now - phaseStart >= IMAGE_WAIT_MS)) {
            beginTransition(now, true);
        }
        if (phase === "transition" && now - phaseStart >= TRANSITION_MS) {
            phase = "showing";
            phaseStart = now;
            previous = null;
        }
        if (phase === "showing" && now - phaseStart >= SHOW_MS) {
            beginTransition(now);
        }
        drawScene(now);
    }

    function advance() {
        const now = performance.now();
        if (reduceMotion.matches) {
            takeUpcoming(now);
            setCaption(current);
            drawStatic();
            return;
        }
        if (phase === "countdown") {
            startFirstFilm(now);
        } else if (phase === "showing" || phase === "flash") {
            beginTransition(now);
        }
    }

    function toggleSound() {
        if (!score) {
            return;
        }
        if (score.isEnabled()) {
            score.disable();
        } else {
            score.enable(current?.film.mood ?? "gentle", current?.film.source ?? "");
        }
        const on = score.isEnabled();
        soundButton.setAttribute("aria-pressed", String(on));
        soundButton.textContent = on ? "配乐 · 开" : "配乐 · 关";
    }

    // 切回前台时重新计时，免得一回来就连跳几部
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && phase === "showing") {
            phaseStart = performance.now();
        }
    });

    // ---------- 启动 ----------

    makeGrainTiles();
    resize();
    window.addEventListener("resize", resize);
    document.body.addEventListener("click", (event) => {
        if (event.target !== rollButton && event.target !== soundButton) {
            advance();
        }
    });
    rollButton.addEventListener("click", advance);
    soundButton.addEventListener("click", toggleSound);
    document.addEventListener("keydown", (event) => {
        if ((event.key === " " || event.key === "Enter") && event.target === document.body) {
            event.preventDefault();
            advance();
        }
    });

    if (reduceMotion.matches) {
        phase = "showing";
        loadFilms().then(() => {
            takeUpcoming(performance.now());
            setCaption(current);
            drawStatic();
        });
    } else {
        phase = "countdown";
        phaseStart = performance.now();
        requestAnimationFrame(frame);
        // 片单在倒计时期间加载好，第一卷就能带上剧照
        loadFilms().then(prepareNext);
    }
})();
