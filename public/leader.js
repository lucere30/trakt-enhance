// 放映厅：老胶片片头倒计时（8 → 3），然后投出一张台词字幕卡。点一下换下一卷。
// 纯本地绘制，不请求任何外部资源；系统开启「减弱动态效果」时跳过动画。
(() => {
    const QUOTES = [
        { line: "愿原力与你同在。", original: "May the Force be with you.", source: "《星球大战》1977" },
        {
            line: "人生就像一盒巧克力，你永远不知道下一块是什么味道。",
            original: "Life was like a box of chocolates. You never know what you're gonna get.",
            source: "《阿甘正传》1994",
        },
        { line: "我会回来的。", original: "I'll be back.", source: "《终结者》1984" },
        { line: "出来混，迟早要还的。", original: "", source: "《无间道》2002" },
        { line: "曾经发生过的事情不可能忘记，只不过是想不起来而已。", original: "", source: "《千与千寻》2001" },
        { line: "何必那么严肃？", original: "Why so serious?", source: "《蝙蝠侠：黑暗骑士》2008" },
        { line: "飞向宇宙，浩瀚无垠！", original: "To infinity and beyond!", source: "《玩具总动员》1995" },
        { line: "不疯魔，不成活。", original: "", source: "《霸王别姬》1993" },
        { line: "我们永远会有巴黎。", original: "We'll always have Paris.", source: "《卡萨布兰卡》1942" },
        { line: "希望是件好东西，也许是世上最好的东西。", original: "Hope is a good thing, maybe the best of things.", source: "《肖申克的救赎》1994" },
        { line: "如果非要给这份爱加一个期限，我希望是……一万年。", original: "", source: "《大话西游之大圣娶亲》1995" },
        { line: "毕竟，明天又是新的一天。", original: "After all, tomorrow is another day.", source: "《乱世佳人》1939" },
    ];

    const COUNT_FROM = 8;
    const COUNT_TO = 3;
    const BEAT_MS = 1000;
    const FPS = 24;

    const canvas = document.getElementById("film");
    const ctx = canvas.getContext("2d");
    const card = document.getElementById("card");
    const rollButton = document.getElementById("roll");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let width = 0;
    let height = 0;
    let dpr = 1;
    let phase = "countdown";
    let phaseStart = 0;
    let lastFrame = 0;
    let reelNumber = 0;
    let deck = [];
    const grainTiles = [];

    // ---------- 准备 ----------

    function shuffle(items) {
        const result = items.slice();
        for (let i = result.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    function nextQuote() {
        if (deck.length === 0) {
            deck = shuffle(QUOTES);
        }
        return deck.pop();
    }

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
        if (progress < 0.06) {
            ctx.fillStyle = "rgba(255,248,232,0.18)";
            ctx.fillRect(0, 0, width, height);
        }
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

        drawGrain(animated ? 0.12 : 0.08);
        if (animated) {
            drawScratches(0.12, 0.25);
        }
        drawVignette(0.8);
        drawSprockets(animated ? now : 0, 0.45);
    }

    function drawFlash(now) {
        const t = (now - phaseStart) / 260;
        ctx.fillStyle = `rgba(255,246,228,${Math.max(0, 1 - t)})`;
        drawProjection(now, true);
        ctx.fillRect(0, 0, width, height);
    }

    // ---------- 流程 ----------

    function showCard() {
        const quote = nextQuote();
        reelNumber += 1;
        document.getElementById("reel").textContent = `第 ${reelNumber} 卷 · Reel ${String(reelNumber).padStart(2, "0")}`;
        document.getElementById("line").textContent = quote.line;
        document.getElementById("original").textContent = quote.original;
        document.getElementById("source").textContent = quote.source;
        card.classList.add("show");
        rollButton.classList.add("show");
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
            if (now - phaseStart >= 260) {
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

    if (reduceMotion.matches) {
        phase = "projecting";
        showCard();
        drawProjection(performance.now(), false);
    } else {
        startCountdown(performance.now());
        requestAnimationFrame(frame);
    }
})();
