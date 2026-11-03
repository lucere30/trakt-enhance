// 海风：站在沙滩上看海。天空、云、海面、浪花、冲上沙滩又退下的海水都由 WebGL 着色器逐像素实时绘制；
// 前景的沙丘草、被风吹起的沙粒和海鸥画在上面一层 2D 画布上。风力有阵风起伏，草、沙、云、海面一起响应。
// 可开启由噪声实时合成的浪声和风声（与浪冲上沙滩的节奏同步）。不加载任何外部资源。
// 系统开启「减弱动态效果」时只画一帧静止画面。
(() => {
    const SWASH_PERIOD = 9.0; // 秒：一次浪冲上沙滩再退下
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const seaCanvas = document.getElementById("sea");
    const airCanvas = document.getElementById("air");
    const soundButton = document.getElementById("sound");

    // 阵风：几个慢正弦叠加，0..1
    function gust(t) {
        const g = 0.5 + 0.5 * (0.55 * Math.sin(t * 0.13) + 0.3 * Math.sin(t * 0.31 + 1.3) + 0.15 * Math.sin(t * 0.73 + 2.1));
        return Math.min(1, Math.max(0, g));
    }

    // ---------- WebGL 海景 ----------

    const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

    const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uGust;
uniform vec3 uSun;

const float SHORE_Z = 15.0;   // 平均水线到相机的距离（米）
const float SLOPE = 0.06;     // 沙滩坡度
const float RUNUP = 6.5;      // 浪冲上沙滩的最大距离
const float PI = 3.14159265;
const float SWASH_W = 2.0 * PI / ${SWASH_PERIOD.toFixed(1)};

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) {
        s += a * noise(p);
        p = m * p;
        a *= 0.5;
    }
    return s;
}

float sandHeight(vec2 xz) { return (SHORE_Z - xz.y) * SLOPE; }

// 朝岸边推进的一道长涌浪：sharp 越大浪峰越尖
float swell(vec2 p, vec2 dir, float freq, float speed, float amp, float sharp) {
    float s = sin(dot(p, dir) * freq + uTime * speed) * 0.5 + 0.5;
    return amp * (pow(s, sharp) - 0.35);
}
float mainPhase(vec2 p) { return dot(p, normalize(vec2(0.12, 1.0))) * 0.32 + uTime * 1.1; }

// 海面高度：两道涌浪 + 风吹出来的碎浪；越靠近岸边水越浅，浪被压低
float seaHeight(vec2 p, int detail) {
    float depth = clamp((p.y - SHORE_Z) * SLOPE, 0.0, 6.0);
    float shoal = smoothstep(0.0, 2.2, depth);
    float h = 0.0;
    h += swell(p, normalize(vec2(0.12, 1.0)), 0.32, 1.1, 0.62, 2.6);
    h += swell(p, normalize(vec2(-0.3, 1.0)), 0.5, 1.6, 0.26, 2.0);
    vec2 q = p * vec2(0.55, 0.8) + vec2(uTime * (0.5 + 0.4 * uGust), uTime * 0.25);
    float amp = 0.16 * (0.6 + 0.7 * uGust);
    mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        if (i >= detail) break;
        h += amp * (noise(q) - 0.5) * 2.0;
        q = m * q * 2.03 + vec2(uTime * 0.35, 0.0);
        amp *= 0.48;
    }
    return h * mix(0.25, 1.0, shoal);
}

float mapSea(vec3 p, int detail) { return p.y - seaHeight(p.xz, detail); }

vec3 seaNormal(vec3 p, float eps) {
    float h = seaHeight(p.xz, 6);
    return normalize(vec3(h - seaHeight(p.xz + vec2(eps, 0.0), 6), eps, h - seaHeight(p.xz + vec2(0.0, eps), 6)));
}

// 冲上沙滩的水线位置（z 越小越靠近相机）
float swashLine(float x) {
    float s = sin(uTime * SWASH_W + x * 0.06 + noise(vec2(x * 0.05, 3.0)) * 2.5) * 0.5 + 0.5;
    return SHORE_Z - RUNUP * pow(s, 1.6);
}

// sunDisk：反射里只要光晕不要清晰的日面时传 0
vec3 skyColor(vec3 rd, float sunDisk) {
    float y = max(rd.y, 0.0);
    vec3 zenith = vec3(0.07, 0.25, 0.60);
    vec3 horizon = vec3(0.64, 0.75, 0.86);
    vec3 col = mix(horizon, zenith, pow(y, 0.42));
    // 地平线附近一层暖色
    col = mix(col, vec3(0.96, 0.82, 0.64), exp(-y * 18.0) * 0.4);
    float sd = max(dot(rd, uSun), 0.0);
    col += vec3(1.0, 0.66, 0.36) * pow(sd, 12.0) * 0.35;
    col += vec3(1.0, 0.80, 0.55) * pow(sd, 120.0) * 0.6;
    col += vec3(1.0, 0.94, 0.80) * smoothstep(0.99955, 0.99975, sd) * 5.0 * sunDisk;
    if (rd.y > 0.0) {
        vec2 uv = rd.xz / (rd.y + 0.05) * 0.8;
        uv.x += uTime * 0.035 * (0.7 + 0.6 * uGust);
        float c = fbm(uv * 0.75 + vec2(0.0, 7.0));
        c = smoothstep(0.48, 0.78, c) * smoothstep(0.0, 0.14, rd.y);
        vec3 lit = mix(vec3(0.98, 0.95, 0.92), vec3(1.0, 0.84, 0.62), pow(sd, 3.0));
        vec3 shade = vec3(0.62, 0.66, 0.74);
        vec3 cloud = mix(shade, lit, smoothstep(0.3, 0.9, fbm(uv * 2.2 + vec2(uTime * 0.01, 0.0))));
        col = mix(col, cloud, c * 0.9);
    }
    return col;
}

vec3 sandAlbedo(vec2 xz, float dist) {
    float n = fbm(xz * 0.9);
    vec3 c = mix(vec3(0.82, 0.70, 0.52), vec3(0.97, 0.88, 0.71), n);
    // 大块的深浅变化
    c *= 0.9 + 0.2 * fbm(xz * 0.12 + 4.0);
    // 零星的小贝壳和碎石
    vec2 cell = floor(xz * 3.0);
    float pick = hash12(cell);
    vec2 local = fract(xz * 3.0) - 0.5 - (vec2(hash12(cell + 1.7), hash12(cell + 3.1)) - 0.5) * 0.6;
    float speck = step(0.965, pick) * smoothstep(0.09, 0.04, length(local)) * (1.0 - smoothstep(3.0, 9.0, dist));
    c = mix(c, mix(vec3(0.98, 0.95, 0.9), vec3(0.45, 0.38, 0.32), step(0.985, pick)), speck);
    // 细沙粒，远处淡掉免得闪烁
    float grain = noise(xz * 38.0) - 0.5;
    c *= 1.0 + grain * 0.12 * (1.0 - smoothstep(4.0, 14.0, dist));
    return c;
}

// 风吹出的沙纹：波峰大致沿着风向的垂直方向，弯弯曲曲；低角度的阳光让它们明暗分明
float sandRelief(vec2 xz) {
    float warp = noise(xz * vec2(0.35, 0.5)) * 3.0;
    float ripple = sin(xz.x * 5.0 + warp + xz.y * 0.6);
    ripple = ripple * 0.5 + 0.5;
    ripple = pow(ripple, 1.8);
    return ripple * 0.6 + 0.4 * noise(xz * 7.0);
}

vec3 sandNormal(vec2 xz, float dist) {
    float e = 0.03;
    float amp = 0.045 * (1.0 - smoothstep(5.0, 16.0, dist)) * (1.0 - smoothstep(SHORE_Z - RUNUP - 3.0, SHORE_Z - RUNUP, xz.y));
    float h0 = sandRelief(xz);
    float hx = sandRelief(xz + vec2(e, 0.0));
    float hz = sandRelief(xz + vec2(0.0, e));
    return normalize(vec3((h0 - hx) * amp / e, 1.0, SLOPE + (h0 - hz) * amp / e));
}

vec3 shadeSand(vec3 p, vec3 rd, float dist) {
    vec3 n = sandNormal(p.xz, dist);
    vec3 albedo = sandAlbedo(p.xz, dist);
    float line = swashLine(p.x);
    float under = p.z - line;                       // >0：被冲上来的薄水覆盖
    float wet = smoothstep(SHORE_Z - RUNUP - 1.5, SHORE_Z - RUNUP + 1.0, p.z);
    albedo *= mix(vec3(1.0), vec3(0.62, 0.57, 0.52), wet);
    float diff = max(dot(n, uSun), 0.0);
    vec3 col = albedo * (vec3(1.25, 1.02, 0.80) * diff * 1.9 + vec3(0.60, 0.62, 0.68) * 0.58);
    // 湿沙反光
    float fres = pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), -rd), 0.0), 5.0);
    col = mix(col, skyColor(reflect(rd, vec3(0.0, 1.0, 0.0)), 0.0), wet * (0.06 + 0.35 * fres));
    if (under > 0.0) {
        // 薄薄一层水：透出湿沙，带天空反光和太阳闪光，前沿一条白沫
        // 涌上来时水往岸上流，退下时往回流：泡沫纹理跟着水流方向移动
        float flow = cos(uTime * SWASH_W + p.x * 0.06);
        vec2 drift = vec2(uTime * 0.15, -flow * 1.2);
        vec3 nw = normalize(vec3(noise(p.xz * 2.5 + drift * 2.0) - 0.5, 3.5, noise(p.xz * 2.5 - drift * 2.0 + 5.0) - 0.5));
        float f = (0.02 + 0.98 * pow(1.0 - max(dot(nw, -rd), 0.0), 5.0)) * 0.7;
        float depthTint = smoothstep(0.0, 3.0, under);
        vec3 seen = col * mix(vec3(0.78, 0.90, 0.88), vec3(0.45, 0.72, 0.72), depthTint);
        vec3 water = mix(seen, skyColor(reflect(rd, nw), 0.25), f);
        water += vec3(1.0, 0.86, 0.62) * pow(max(dot(reflect(rd, nw), uSun), 0.0), 160.0) * 2.5;
        col = mix(col, water, smoothstep(0.0, 0.5, under));
        // 浪头的白沫带 + 水里散开的泡沫丝
        float lace = smoothstep(0.38, 0.72, fbm(p.xz * vec2(1.4, 3.2) + drift));
        float edge = smoothstep(0.0, 0.2, under) * (1.0 - smoothstep(0.6, 2.4, under));
        float streaks = smoothstep(0.62, 0.8, fbm(p.xz * vec2(0.8, 2.6) + drift * 1.5)) * (1.0 - smoothstep(1.0, 5.0, under));
        col = mix(col, vec3(0.96, 0.96, 0.94), max(edge * (0.45 + 0.55 * lace), streaks * 0.6));
    }
    return col;
}

vec3 shadeSea(vec3 p, vec3 rd, float dist) {
    vec3 n = seaNormal(p, max(0.02, dist * 0.0018));
    float depth = max(0.0, p.y - sandHeight(p.xz));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    vec3 refl = skyColor(reflect(rd, n), 1.0);
    float shallow = exp(-depth * 0.7);
    vec3 body = mix(vec3(0.01, 0.09, 0.19), vec3(0.06, 0.50, 0.52), shallow);
    body = mix(body, sandAlbedo(p.xz, dist) * vec3(0.60, 0.82, 0.78), shallow * shallow * 0.7);
    // 浪峰被阳光透过时的绿松石色
    body += vec3(0.04, 0.18, 0.14) * smoothstep(0.1, 0.6, p.y) * max(dot(uSun, -rd), 0.0);
    vec3 col = mix(body, refl, fres);
    col += vec3(1.0, 0.85, 0.6) * pow(max(dot(reflect(rd, n), uSun), 0.0), 360.0) * 5.0;
    // 白沫：浪尖 + 岸边碎浪
    float crest = smoothstep(0.34, 0.62, p.y);
    float breaking = (1.0 - smoothstep(0.2, 1.7, depth)) * smoothstep(0.55, 0.95, sin(mainPhase(p.xz)) * 0.5 + 0.5);
    float foam = max(crest * 0.6, breaking) * smoothstep(0.35, 0.7, fbm(p.xz * vec2(0.8, 1.6) + vec2(uTime * 0.25, uTime * 0.1)));
    col = mix(col, vec3(0.93, 0.94, 0.93), foam * (1.0 - smoothstep(60.0, 220.0, dist)));
    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    // 相机：站在沙滩上，眼睛离沙面 1.7 米，略微俯视大海；竖屏时视角放宽
    float aspect = uRes.x / uRes.y;
    float fov = aspect < 1.0 ? 1.15 : 0.85;
    vec3 ro = vec3(0.0, sandHeight(vec2(0.0)) + 1.7, 0.0);
    float pitch = -0.06;
    vec3 rd = normalize(vec3(uv.x * fov, uv.y * fov * cos(pitch) + sin(pitch), 1.0));

    vec3 col;
    float dist = 1e4;
    if (rd.y >= -0.0005) {
        col = skyColor(rd, 1.0);
    } else {
        // 沙面是斜平面，直接求交；海面高度场用割线法求交
        float tSand = (SLOPE * SHORE_Z - ro.y - SLOPE * ro.z) / (rd.y + SLOPE * rd.z);
        float tm = 0.0;
        float tx = 2000.0;
        float hm = mapSea(ro, 3);
        float hx = mapSea(ro + rd * tx, 3);
        float tSea = tx;
        bool seaReached = hx < 0.0;
        for (int i = 0; i < 9; i++) {
            float tmid = mix(tm, tx, hm / (hm - hx));
            float hmid = mapSea(ro + rd * tmid, 3);
            if (hmid < 0.0) { tx = tmid; hx = hmid; } else { tm = tmid; hm = hmid; }
            tSea = tmid;
        }
        if (tSand > 0.0 && (tSand < tSea || !seaReached)) {
            dist = tSand;
            col = shadeSand(ro + rd * tSand, rd, dist);
        } else if (seaReached) {
            dist = tSea;
            col = shadeSea(ro + rd * tSea, rd, dist);
        } else {
            // 贴着地平线、在可见距离内碰不到海面的视线：直接当远处的海雾
            col = skyColor(normalize(vec3(rd.x, 0.02, rd.z)), 0.0);
        }
        // 远处的海雾
        vec3 haze = skyColor(normalize(vec3(rd.x, 0.02, rd.z)), 0.0);
        col = mix(col, haze, 1.0 - exp(-dist * 0.0022));
    }
    // 色调映射 + 轻微暗角
    col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, 0.0, 1.0), vec3(0.95));
    vec2 q = gl_FragCoord.xy / uRes;
    col *= 0.82 + 0.18 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.18);
    gl_FragColor = vec4(col, 1.0);
}
`;

    function createSea() {
        const gl = seaCanvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
        if (!gl) {
            return null;
        }
        function compile(type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
            }
            return shader;
        }
        const program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || "program link failed");
        }
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(program, "aPos");
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        const uniforms = {
            res: gl.getUniformLocation(program, "uRes"),
            time: gl.getUniformLocation(program, "uTime"),
            gust: gl.getUniformLocation(program, "uGust"),
            sun: gl.getUniformLocation(program, "uSun"),
        };
        let lastAspect = 0;
        function setSun(aspect) {
            // 太阳在左前方；竖屏视野窄，往中间挪一些，让海面上的金色光带留在画面里
            const sun = [-0.42 * Math.min(1, Math.max(0.4, aspect * 1.2)), 0.24, 1.0];
            const len = Math.hypot(...sun);
            gl.uniform3f(uniforms.sun, sun[0] / len, sun[1] / len, sun[2] / len);
        }
        return {
            draw(t, g, width, height) {
                const aspect = width / height;
                if (aspect !== lastAspect) {
                    lastAspect = aspect;
                    setSun(aspect);
                }
                gl.viewport(0, 0, width, height);
                gl.uniform2f(uniforms.res, width, height);
                gl.uniform1f(uniforms.time, t);
                gl.uniform1f(uniforms.gust, g);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            },
        };
    }

    // ---------- 2D 前景：沙丘草、飞沙、海鸥 ----------

    const air = airCanvas.getContext("2d");
    let airW = 0;
    let airH = 0;
    let airDpr = 1;
    let tufts = [];
    const grains = [];
    const gulls = [
        { x: 0.25, y: 0.2, speed: 0.012, size: 1, phase: 0 },
        { x: 0.62, y: 0.13, speed: 0.009, size: 0.7, phase: 1.7 },
        { x: 0.8, y: 0.27, speed: 0.015, size: 0.55, phase: 3.1 },
    ];

    function seededRandom(seed) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // 两丛大的在左右下角，再散几丛小的
    function makeTufts() {
        const rand = seededRandom(7);
        const spots = [
            { x: -0.02, size: 1.0, count: 70 },
            { x: 0.12, size: 0.55, count: 30 },
            { x: 0.88, size: 0.65, count: 36 },
            { x: 1.02, size: 1.05, count: 74 },
            { x: 0.5, size: 0.3, count: 14 },
        ];
        tufts = spots.map((spot) => ({
            x: spot.x,
            blades: Array.from({ length: spot.count }, () => ({
                offset: (rand() - 0.5) * 0.16 * spot.size,
                length: (0.12 + rand() * 0.22) * spot.size,
                lean: (rand() - 0.62) * 0.5,
                width: 0.8 + rand() * 1.6,
                stiffness: 0.6 + rand() * 0.7,
                phase: rand() * Math.PI * 2,
                shade: rand(),
            })),
        }));
    }

    function resizeAir() {
        airDpr = Math.min(window.devicePixelRatio || 1, 2);
        airW = Math.floor(window.innerWidth * airDpr);
        airH = Math.floor(window.innerHeight * airDpr);
        airCanvas.width = airW;
        airCanvas.height = airH;
    }

    function drawGrass(t, g) {
        const unit = Math.min(airW, airH * 0.9);
        for (const tuft of tufts) {
            const baseX = tuft.x * airW;
            for (const blade of tuft.blades) {
                const x0 = baseX + blade.offset * unit;
                const y0 = airH + 4 * airDpr;
                const len = blade.length * unit;
                // 风从右往左吹：草尖向左弯，阵风时弯得更厉害，还会抖
                const flutter = Math.sin(t * (2.2 + blade.stiffness) + blade.phase + x0 * 0.002) * (0.12 + 0.18 * g);
                const bend = blade.lean - (0.35 + 0.75 * g) / blade.stiffness + flutter;
                const tipX = x0 + Math.sin(bend) * len;
                const tipY = y0 - Math.cos(bend) * len;
                const ctrlX = x0 + Math.sin(bend * 0.45) * len * 0.55;
                const ctrlY = y0 - len * 0.6;
                const w = blade.width * airDpr * (1 + len / unit);
                const tone = 28 + blade.shade * 30;
                air.fillStyle = `rgba(${tone + 18},${tone + 14},${Math.round(tone * 0.6)},0.95)`;
                air.beginPath();
                air.moveTo(x0 - w, y0);
                air.quadraticCurveTo(ctrlX - w * 0.6, ctrlY, tipX, tipY);
                air.quadraticCurveTo(ctrlX + w * 0.6, ctrlY, x0 + w, y0);
                air.closePath();
                air.fill();
                // 逆光：草叶边缘一点暖色
                if (blade.shade > 0.55) {
                    air.strokeStyle = `rgba(255,196,120,${0.18 + 0.2 * blade.shade})`;
                    air.lineWidth = 0.7 * airDpr;
                    air.beginPath();
                    air.moveTo(x0, y0 - len * 0.2);
                    air.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
                    air.stroke();
                }
            }
        }
    }

    function drawGrains(dt, g) {
        const target = Math.round(30 + 140 * g);
        while (grains.length < target) {
            grains.push({
                x: airW * (1 + Math.random() * 0.3),
                y: airH * (0.62 + Math.random() * 0.38),
                v: 0.5 + Math.random(),
                size: 0.6 + Math.random() * 1.2,
                lift: (Math.random() - 0.6) * 0.08,
            });
        }
        air.save();
        air.lineCap = "round";
        for (let i = grains.length - 1; i >= 0; i -= 1) {
            const p = grains[i];
            const speed = airW * (0.25 + 0.75 * g) * p.v;
            p.x -= speed * dt;
            p.y += p.lift * speed * dt + Math.sin(p.x * 0.01) * 0.3 * airDpr;
            if (p.x < -20 || grains.length > target + 20) {
                grains.splice(i, 1);
                continue;
            }
            const streak = Math.min(24 * airDpr, speed * 0.02);
            air.strokeStyle = `rgba(236,214,172,${0.15 + 0.25 * g})`;
            air.lineWidth = p.size * airDpr;
            air.beginPath();
            air.moveTo(p.x, p.y);
            air.lineTo(p.x + streak, p.y - p.lift * streak);
            air.stroke();
        }
        air.restore();
    }

    function drawGulls(t, dt, g) {
        air.save();
        air.strokeStyle = "rgba(40,36,34,0.75)";
        air.lineCap = "round";
        for (const gull of gulls) {
            // 逆风飞：被风往后推，慢慢横穿天空
            gull.x += gull.speed * (1.1 - g) * dt;
            if (gull.x > 1.15) {
                gull.x = -0.15;
            }
            const x = gull.x * airW;
            const y = (gull.y + Math.sin(t * 0.4 + gull.phase) * 0.015) * airH;
            const span = 16 * gull.size * airDpr;
            const flap = Math.sin(t * (4.5 + gull.size) + gull.phase);
            const lift = span * (0.15 + 0.35 * flap);
            air.lineWidth = 1.6 * gull.size * airDpr;
            air.beginPath();
            air.moveTo(x - span, y - lift);
            air.quadraticCurveTo(x - span * 0.45, y - lift * 1.4 - span * 0.1, x, y);
            air.quadraticCurveTo(x + span * 0.45, y - lift * 1.4 - span * 0.1, x + span, y - lift);
            air.stroke();
        }
        air.restore();
    }

    function drawAir(t, dt, g) {
        air.clearRect(0, 0, airW, airH);
        drawGulls(t, dt, g);
        drawGrains(dt, g);
        drawGrass(t, g);
    }

    // ---------- 声音：浪声 + 风声 ----------

    const ambience = (() => {
        let ctx = null;
        let waveGain = null;
        let waveFilter = null;
        let windGain = null;
        let windFilter = null;
        let masterGain = null;
        let wanted = false;

        function noiseBuffer(seconds) {
            const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
            for (let c = 0; c < 2; c += 1) {
                const data = buffer.getChannelData(c);
                let brown = 0;
                for (let i = 0; i < data.length; i += 1) {
                    // 偏「棕」的噪声，低频多，像水声
                    brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
                    data[i] = brown * 3.5 + (Math.random() * 2 - 1) * 0.08;
                }
            }
            return buffer;
        }

        function start() {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.value = 0;
            masterGain.connect(ctx.destination);
            const buffer = noiseBuffer(6);

            const waves = ctx.createBufferSource();
            waves.buffer = buffer;
            waves.loop = true;
            waveFilter = ctx.createBiquadFilter();
            waveFilter.type = "lowpass";
            waveFilter.frequency.value = 600;
            waveGain = ctx.createGain();
            waveGain.gain.value = 0.3;
            waves.connect(waveFilter);
            waveFilter.connect(waveGain);
            waveGain.connect(masterGain);
            waves.start();

            const wind = ctx.createBufferSource();
            wind.buffer = buffer;
            wind.loop = true;
            wind.playbackRate.value = 1.9;
            windFilter = ctx.createBiquadFilter();
            windFilter.type = "bandpass";
            windFilter.frequency.value = 700;
            windFilter.Q.value = 0.9;
            windGain = ctx.createGain();
            windGain.gain.value = 0.05;
            wind.connect(windFilter);
            windFilter.connect(windGain);
            windGain.connect(masterGain);
            wind.start(0, 2.3);
        }

        return {
            get on() {
                return wanted;
            },
            enable() {
                if (!ctx) {
                    start();
                }
                wanted = true;
                ctx.resume();
                masterGain.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
            },
            disable() {
                wanted = false;
                if (ctx) {
                    masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
                }
            },
            // 每帧更新：浪冲上来时声音涨起、变亮，退下时变小；风声跟着阵风
            update(t, g) {
                if (!ctx || ctx.state !== "running") {
                    return;
                }
                const phase = (Math.sin((t * 2 * Math.PI) / SWASH_PERIOD) * 0.5 + 0.5) ** 1.6;
                const now = ctx.currentTime;
                waveGain.gain.setTargetAtTime(0.18 + 0.55 * phase, now, 0.25);
                waveFilter.frequency.setTargetAtTime(380 + 1500 * phase, now, 0.3);
                windGain.gain.setTargetAtTime(0.02 + 0.13 * g * g, now, 0.4);
                windFilter.frequency.setTargetAtTime(450 + 700 * g, now, 0.5);
            },
            suspend() {
                ctx?.suspend();
            },
            resume() {
                ctx?.resume();
            },
        };
    })();

    // ---------- 主循环 ----------

    let sea = null;
    try {
        sea = createSea();
    } catch (error) {
        console.error(error);
    }
    if (!sea) {
        document.body.classList.add("no-webgl");
    }

    let scale = 0.75; // 海景的渲染分辨率比例，按帧耗时自动调整
    let seaW = 0;
    let seaH = 0;
    let frameAvg = 16;
    let lastAdjust = 0;
    let lastTime = performance.now();
    const startTime = lastTime;

    function resizeSea() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const maxPixels = 1400 * 900;
        let w = window.innerWidth * dpr * scale;
        let h = window.innerHeight * dpr * scale;
        const over = Math.sqrt((w * h) / maxPixels);
        if (over > 1) {
            w /= over;
            h /= over;
        }
        seaW = Math.max(160, Math.floor(w));
        seaH = Math.max(120, Math.floor(h));
        seaCanvas.width = seaW;
        seaCanvas.height = seaH;
    }

    function resize() {
        resizeSea();
        resizeAir();
        if (reduceMotion.matches) {
            renderFrame(30, 0);
        }
    }

    function renderFrame(t, dt) {
        const g = gust(t);
        sea?.draw(t, g, seaW, seaH);
        drawAir(t, dt, g);
        ambience.update(t, g);
    }

    function loop(now) {
        requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        frameAvg = frameAvg * 0.9 + (now - lastTime) * 0.1;
        lastTime = now;
        renderFrame((now - startTime) / 1000 + 30, dt);
        // 每 1.5 秒按平均帧耗时调一次分辨率：太慢就降，很快就升
        if (now - lastAdjust > 1500) {
            lastAdjust = now;
            const next = frameAvg > 26 ? Math.max(0.35, scale * 0.85) : frameAvg < 15 ? Math.min(1, scale * 1.1) : scale;
            if (Math.abs(next - scale) > 0.01) {
                scale = next;
                resizeSea();
            }
        }
    }

    makeTufts();
    resize();
    window.addEventListener("resize", resize);

    soundButton.addEventListener("click", () => {
        if (ambience.on) {
            ambience.disable();
        } else {
            ambience.enable();
        }
        const on = ambience.on;
        soundButton.setAttribute("aria-pressed", String(on));
        soundButton.textContent = on ? "海浪 · 开" : "海浪 · 关";
    });
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            ambience.suspend();
        } else if (ambience.on) {
            ambience.resume();
        }
    });

    if (reduceMotion.matches) {
        renderFrame(30, 0);
    } else {
        requestAnimationFrame(loop);
    }
})();
