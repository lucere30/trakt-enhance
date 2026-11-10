// 海风：站在沙滩上看海。天空、云、海面、浪花、冲上沙滩又退下的海水都由 WebGL 着色器逐像素实时绘制：
// 涌浪越靠岸越挤、越陡，破碎成一道白浪，白沫留在水面上慢慢散开；浪头到岸后薄水冲上沙滩再退下，
// 退过的湿沙像镜子一样映着天空；干沙上是脚印和风吹出的沙纹；太阳在海面上碎成一条光带。
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
const float TAU = 6.2831853;
const float PERIOD = ${SWASH_PERIOD.toFixed(1)};
const float SWASH_W = TAU / PERIOD;
// 涌浪：外海波长约 57 米，越靠岸水越浅、浪走得越慢、浪与浪之间挤得越近
const float K_DEEP = 0.11;
const float D0 = 3.0;
const float DD = 63.0;
const float F0 = 27.495;      // 2 * sqrt(DD * D0)
const float LEAD = 0.55;      // 浪头到达水线后多久（弧度）开始往沙滩上冲
// 低角度的暖色阳光 + 偏蓝的天光
const vec3 SUN_COL = vec3(1.0, 0.76, 0.52) * 4.6;
const vec3 SKY_AMB = vec3(0.40, 0.50, 0.66);

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p, int octaves) {
    float a = 0.5;
    float s = 0.0;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;
        s += a * noise(p);
        p = m * p;
        a *= 0.5;
    }
    return s;
}
// 泡沫纹理：沿噪声等值线的细丝连成网，像浪退后留在水面上的泡沫
float foamTex(vec2 q) {
    float a = 0.55;
    float s = 0.0;
    mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 3; i++) {
        s += a * (1.0 - abs(2.0 * noise(q) - 1.0));
        q = m * q * 2.1 + 3.7;
        a *= 0.5;
    }
    return s;
}

float sandHeight(vec2 xz) { return (SHORE_Z - xz.y) * SLOPE; }

// ---------- 浪 ----------

// 浪峰线不是直的：沿岸方向有先有后。岸上的冲刷和海里的浪共用这一项，所以浪头到岸和水冲上沙滩对得上
float alongshore(float x) { return x * 0.06 + noise(vec2(x * 0.05, 3.0)) * 2.5; }

// 主涌浪的相位：浪峰在 2π 的整数倍处，朝岸边（z 减小的方向）推进
float wavePhase(vec2 p) {
    float dd = max(p.y - SHORE_Z + D0, 0.2);
    float travel = dd < DD ? 2.0 * sqrt(DD * dd) : dd + DD;
    return uTime * SWASH_W + K_DEEP * (travel - F0) + alongshore(p.x) - LEAD;
}
// 每一道浪在离岸多远处开始破碎：各不相同，沿岸方向也不齐
float breakDist(float x, float id) { return 12.0 + 16.0 * noise(vec2(x * 0.035 + id * 5.3, id * 1.9)); }

float mainWave(vec2 p) {
    float d = p.y - SHORE_Z;
    float u = wavePhase(p);
    float id = floor(u / TAU + 0.5);
    float ul = u - id * TAU;
    float db = breakDist(p.x, id);
    float shoal = 1.0 - smoothstep(db, 110.0, d);
    // 越靠岸越高，破碎以后变成一道越来越矮的白浪
    float amp = mix(0.22, 0.72, shoal * shoal) * mix(0.16, 1.0, smoothstep(-1.0, db, d));
    // 浪峰变尖，朝岸的一面变陡
    float uw = ul - 0.7 * shoal * (1.0 - cos(ul));
    return amp * pow(0.5 + 0.5 * cos(uw), mix(1.5, 3.2, shoal)) - 0.07;
}

float seaHeight(vec2 p, int detail) {
    float calm = smoothstep(-2.0, 25.0, p.y - SHORE_Z);
    float h = mainWave(p);
    h += 0.06 * calm * sin(dot(p, vec2(-0.26, 0.96)) * 0.75 + uTime * 1.9);
    // 风吹出来的碎浪
    vec2 q = p * vec2(0.55, 0.8) + vec2(uTime * (0.5 + 0.4 * uGust), uTime * 0.25);
    float amp = 0.11 * (0.6 + 0.7 * uGust) * mix(0.25, 1.0, calm);
    mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        if (i >= detail) break;
        h += amp * (noise(q) - 0.5) * 2.0;
        q = m * q * 2.03 + vec2(uTime * 0.35, 0.0);
        amp *= 0.48;
    }
    return h;
}
float mapSea(vec3 p, int detail) { return p.y - seaHeight(p.xz, detail); }
vec3 seaNormal(vec3 p, float eps) {
    float h = seaHeight(p.xz, 6);
    return normalize(vec3(h - seaHeight(p.xz + vec2(eps, 0.0), 6), eps, h - seaHeight(p.xz + vec2(0.0, eps), 6)));
}

// 冲上沙滩的薄水：x = 水线位置（z 越小越靠近相机），y = 流向（>0 往上冲，<0 往回退），
// z = 这一道浪能冲到的最远处，w = 冲刷进度 0..1
vec4 swash(float x) {
    float ph = uTime * SWASH_W + alongshore(x);
    float s = sin(ph) * 0.5 + 0.5;
    float id = floor((ph + PI * 0.5) / TAU);
    float reach = RUNUP * (0.62 + 0.38 * noise(vec2(x * 0.07 + id * 9.1, id * 3.7)));
    return vec4(SHORE_Z - reach * pow(s, 1.6), cos(ph), SHORE_Z - reach, s);
}

// 浪破碎后的白沫：浪头上厚厚一道，过后留在水面上的泡沫慢慢散成网、消失
float seaFoam(vec2 p) {
    float d = p.y - SHORE_Z;
    float u = wavePhase(p);
    float id = floor(u / TAU + 0.5);
    float ul = u - id * TAU;
    float idPassed = floor(u / TAU);
    float age = (u - idPassed * TAU) / TAU;
    float dbN = breakDist(p.x, id);
    float dbP = breakDist(p.x, idPassed);
    float brokeN = 1.0 - smoothstep(dbN - 3.0, dbN + 1.5, d);
    float brokeP = 1.0 - smoothstep(dbP - 3.0, dbP + 1.5, d);
    float churn = noise(p * 2.6 + vec2(0.0, uTime * 1.4));
    float roller = brokeN * smoothstep(-0.75, -0.3, ul) * (1.0 - smoothstep(0.05, 0.9, ul)) * (0.72 + 0.28 * churn);
    float tex = foamTex(p * vec2(0.5, 0.85) + vec2(idPassed * 7.3 + uTime * 0.02, idPassed * 3.1));
    float trail = brokeP * pow(1.0 - age, 1.3) * smoothstep(mix(0.40, 0.90, age), mix(0.66, 1.0, age), tex);
    // 风大时外海零星的白头浪
    float cap = uGust * smoothstep(0.80, 0.93, noise(p * 0.11 + vec2(uTime * 0.07, 0.0))) * smoothstep(0.62, 0.8, noise(p * 0.9 + vec2(uTime * 0.5, 0.0))) * smoothstep(30.0, 60.0, d);
    return max(max(roller, trail), cap * 0.7);
}

// 冲上沙滩的那层水上的白沫：under = 离水线前沿多远
float swashFoam(vec2 p, vec4 sw, float under) {
    float up = smoothstep(-0.3, 0.5, sw.y);
    float web = foamTex(p * vec2(0.9, 1.5) + vec2(0.0, (sw.x - SHORE_Z) * 1.1));
    // 前沿：往上冲时是一道翻滚的白边，往回退时只剩细细一线
    float edge = smoothstep(0.0, 0.1, under) * (1.0 - smoothstep(0.2, mix(0.45, 1.7, up), under));
    float lace = smoothstep(mix(0.84, 0.64, up), 1.0, web) * (1.0 - 0.6 * smoothstep(3.0, 9.0, under));
    return max(edge * (0.55 + 0.45 * web), lace * mix(0.5, 0.95, up));
}

// ---------- 天空 ----------

vec3 skyBase(vec3 rd) {
    float y = clamp(rd.y, 0.0, 1.0);
    float sd = max(dot(rd, uSun), 0.0);
    float az = 0.5 + 0.5 * dot(normalize(rd.xz + vec2(0.0, 1e-4)), normalize(uSun.xz));
    vec3 col = mix(vec3(0.24, 0.46, 0.84), vec3(0.045, 0.17, 0.52), pow(y, 0.5));
    // 地平线附近空气厚：朝太阳一侧发暖，背着太阳一侧灰蓝
    vec3 hazeCol = mix(vec3(0.60, 0.69, 0.80), vec3(1.02, 0.84, 0.64), az * az);
    col = mix(col, hazeCol, exp(-y * 9.0) * 0.85);
    // 太阳周围的光晕
    col += vec3(1.0, 0.60, 0.28) * pow(sd, 6.0) * 0.20;
    col += vec3(1.0, 0.74, 0.46) * pow(sd, 40.0) * 0.50;
    col += vec3(1.0, 0.88, 0.68) * pow(sd, 500.0) * 1.6;
    col += vec3(1.0, 0.92, 0.78) * pow(sd, 6000.0) * 6.0;
    return col;
}

// 云：远处海面上一排积云 + 高处的卷云丝。octaves 少的版本用在倒影里
vec3 addClouds(vec3 col, vec3 rd, int octaves) {
    if (rd.y <= 0.0) return col;
    float sd = max(dot(rd, uSun), 0.0);
    vec2 uv = rd.xz / (rd.y + 0.10);
    uv.x += uTime * 0.012 * (0.7 + 0.6 * uGust);
    vec2 cuv = uv * 0.85 + vec2(3.0, 7.0);
    float base = fbm(cuv, octaves) + 0.05 * (noise(cuv * 7.0) - 0.5);
    float cov = smoothstep(0.57, 0.72, base + 0.06 * (1.0 - smoothstep(0.0, 0.25, rd.y)));
    // 朝太阳方向再采一次密度：那边更厚就是背光面
    vec2 toSun = normalize(uSun.xz / (uSun.y + 0.10) - rd.xz / (rd.y + 0.10) + vec2(1e-3));
    float occ = fbm(cuv + toSun * 0.22, octaves > 3 ? 3 : 2);
    float lit = clamp(0.7 + (base - occ) * 5.0, 0.0, 1.0);
    vec3 shade = mix(vec3(0.46, 0.52, 0.66), vec3(0.66, 0.58, 0.58), sd * sd);
    vec3 bright = mix(vec3(1.15, 1.12, 1.10), vec3(1.6, 1.35, 1.05), pow(sd, 1.5));
    vec3 cloud = mix(shade, bright, lit * (1.0 - 0.4 * smoothstep(0.62, 0.80, base)));
    // 太阳附近的薄边被照透
    cloud += vec3(1.2, 0.85, 0.5) * pow(sd, 10.0) * (1.0 - cov) * 1.2;
    float cirrus = smoothstep(0.56, 0.9, fbm(uv * vec2(0.22, 1.1) + vec2(11.0, 2.0), octaves > 3 ? 4 : 2)) * smoothstep(0.10, 0.45, rd.y);
    col = mix(col, mix(vec3(0.92, 0.93, 0.96), vec3(1.25, 1.0, 0.75), pow(sd, 2.0)), cirrus * 0.30);
    // 越靠近地平线，云越融进空气里
    float fade = 1.0 - exp(-rd.y * 16.0);
    return mix(col, cloud, cov * 0.94 * fade);
}

vec3 skyColor(vec3 rd) {
    vec3 col = addClouds(skyBase(rd), rd, 5);
    float sd = max(dot(rd, uSun), 0.0);
    col += vec3(1.0, 0.93, 0.80) * smoothstep(0.99986, 0.99993, sd) * 45.0;
    return col;
}
vec3 skyReflect(vec3 r) {
    r.y = abs(r.y) + 0.01;
    return addClouds(skyBase(r), r, 3);
}

// ---------- 沙 ----------

vec3 sandAlbedo(vec2 xz, float dist) {
    float n = fbm(xz * 0.9, 4);
    vec3 c = mix(vec3(0.66, 0.53, 0.37), vec3(0.86, 0.74, 0.55), n);
    c *= 0.9 + 0.2 * fbm(xz * 0.12 + 4.0, 3);
    float grain = noise(xz * 46.0) - 0.5;
    c *= 1.0 + grain * 0.16 * (1.0 - smoothstep(4.0, 12.0, dist));
    return c;
}

// 被踩乱的沙：大大小小、边缘柔和的浅坑
float dimples(vec2 p) {
    float a = smoothstep(0.30, 0.62, noise(p * 3.1 + 2.0));
    float b = smoothstep(0.35, 0.70, noise(p * 6.7 + 11.0));
    return -(0.65 * a + 0.35 * b) + 0.5;
}

// 沙面的起伏（米）：trample = 干沙上被踩乱的程度；湿沙被水抹平
float sandBump(vec2 p, float trample) {
    float h = 0.030 * (noise(p * 2.1) - 0.5) + 0.014 * (noise(p * 6.3 + 9.0) - 0.5);
    // 风吹出的沙纹
    float warp = noise(p * vec2(0.5, 0.7)) * 4.0 + noise(p * 2.0) * 1.2;
    float ripple = sin(p.x * 17.0 + p.y * 2.6 + warp);
    h += 0.0045 * ripple * smoothstep(0.35, 0.65, noise(p * 0.45 + 21.0)) * trample;
    h += 0.026 * dimples(p) * trample;
    h += 0.004 * (noise(p * 23.0) - 0.5);
    return h * mix(0.12, 1.0, trample);
}

// 没被水盖住的沙：干沙有脚印和沙纹，低角度阳光下明暗分明；浪退过的湿沙颜色深、像镜子一样反光
vec3 sandColor(vec3 p, vec3 rd, float dist, vec4 sw, out vec3 bottom) {
    float wetEdge = SHORE_Z - RUNUP * (0.86 + 0.10 * noise(vec2(p.x * 0.31, 5.0)));
    float wet = smoothstep(wetEdge - 0.35, wetEdge + 0.35, p.z);
    float trample = 1.0 - smoothstep(wetEdge - 2.6, wetEdge - 0.2, p.z);
    float e = max(0.012, dist * 0.004);
    float h0 = sandBump(p.xz, trample);
    float hx = sandBump(p.xz + vec2(e, 0.0), trample);
    float hz = sandBump(p.xz + vec2(0.0, e), trample);
    float fadeN = 1.0 - smoothstep(9.0, 22.0, dist);
    vec3 n = normalize(vec3((h0 - hx) / e * fadeN, 1.0, SLOPE + (h0 - hz) / e * fadeN));
    // 坑的背阳面落在阴影里
    vec2 sdir = normalize(uSun.xz);
    float run = 0.14;
    float hs = sandBump(p.xz + sdir * run, trample);
    float shadow = mix(1.0, 0.8 + 0.2 * smoothstep(-0.05, 0.03, h0 + run * uSun.y / length(uSun.xz) - hs), fadeN);
    vec3 albedo = sandAlbedo(p.xz, dist);
    // 潮线：浪冲到最远处留下的一道碎海草和小贝壳
    float wrack = exp(-pow((p.z - (wetEdge - 0.55 + 0.5 * noise(vec2(p.x * 0.6, 8.0)))) * 2.2, 2.0));
    float bits = smoothstep(0.66, 0.74, noise(p.xz * 13.0)) * smoothstep(0.45, 0.6, noise(p.xz * 3.1 + 5.0));
    albedo = mix(albedo, vec3(0.11, 0.09, 0.06), bits * wrack * 0.85 * fadeN);
    vec2 cell = floor(p.xz * 3.0);
    float pick = hash12(cell);
    vec2 local = fract(p.xz * 3.0) - 0.5 - (hash22(cell + 1.7) - 0.5) * 0.6;
    float speck = step(0.955, pick) * (1.0 - smoothstep(0.03, 0.06, length(local))) * fadeN;
    albedo = mix(albedo, vec3(0.93, 0.90, 0.84), speck);
    albedo *= mix(vec3(1.0), vec3(0.50, 0.45, 0.40), wet);
    vec3 light = SUN_COL * max(dot(n, uSun), 0.0) * shadow + SKY_AMB * (0.55 + 0.25 * n.y);
    vec3 col = albedo * light;
    bottom = col;
    // 湿沙的反光：水刚退走的地方最亮，然后慢慢渗干
    float back = 1.0 - smoothstep(-0.5, 0.2, sw.y);
    float fresh = clamp((p.z - sw.z) / max(sw.x - sw.z, 0.05), 0.0, 1.0);
    float gloss = wet * mix(0.5, 0.5 + 0.5 * fresh, back);
    vec3 ng = normalize(vec3(n.x * 0.25, 1.0, n.z * 0.25));
    float fres = 0.03 + 0.97 * pow(1.0 - max(dot(ng, -rd), 0.0), 5.0);
    vec3 r = reflect(rd, ng);
    vec3 refl = min(skyReflect(r), vec3(1.25)) + SUN_COL * (pow(max(dot(r, uSun), 0.0), 900.0) * 1.1 + pow(max(dot(r, uSun), 0.0), 90.0) * 0.16);
    return mix(col, refl, gloss * fres);
}

// ---------- 水 ----------

// 水面：反射天空，透出水底的沙（越深越偏青绿，红光先被吸收），太阳在水面上碎成一条光带，再盖上白沫
vec3 shadeWater(vec3 p, vec3 rd, vec3 n, float depth, vec3 bottom, float foam, float dist) {
    float cosv = max(dot(n, -rd), 0.0);
    float rough = smoothstep(8.0, 320.0, dist);
    float fres = (0.02 + 0.98 * pow(1.0 - cosv, 5.0)) * (1.0 - 0.3 * rough);
    vec3 r = reflect(rd, n);
    // 太阳本身的反光由下面的碎光单独算，这里只要天空
    vec3 refl = min(skyReflect(r), vec3(1.35));
    float path = depth * (1.0 + 2.0 * (1.0 - cosv));
    vec3 trans = exp(-path * vec3(1.9, 0.50, 0.36));
    vec3 deep = vec3(0.010, 0.085, 0.120) * (1.0 + 0.8 * uSun.y);
    vec3 body = bottom * trans + deep * (1.0 - trans.b);
    // 浪峰薄的地方被阳光照透
    body += vec3(0.02, 0.20, 0.16) * smoothstep(0.12, 0.55, p.y) * (0.4 + 0.6 * max(dot(normalize(uSun.xz), normalize(rd.xz)), 0.0));
    vec3 col = mix(body, refl, fres);
    // 太阳的碎光：近处是一粒粒闪光，远处每个像素里有无数小浪面，合成一条越远越窄的光带
    r.y = abs(r.y);
    vec2 ra = normalize(r.xz);
    vec2 sa = normalize(uSun.xz);
    float daz = ra.x * sa.y - ra.y * sa.x;
    float del = r.y - uSun.y;
    float sigA = mix(0.035, 0.085, rough);
    float sigE = mix(0.035, 0.24, sqrt(rough));
    float glit = exp(-daz * daz / (2.0 * sigA * sigA) - del * del / (2.0 * sigE * sigE)) * step(0.0, dot(ra, sa));
    float twinkle = mix(0.45, 1.0, rough) + mix(2.2, 0.0, sqrt(rough)) * pow(noise(p.xz * mix(6.0, 0.9, rough) + vec2(uTime * 1.7, uTime * 0.9)), 3.0);
    col += SUN_COL * glit * twinkle * mix(3.2, 0.42, sqrt(rough));
    // 白沫本身是被太阳和天光照亮的，不是纯白
    vec3 foamCol = vec3(0.86, 0.88, 0.88) * (SUN_COL * (0.16 + 0.20 * max(dot(n, uSun), 0.0)) + SKY_AMB * 1.2);
    return mix(col, foamCol, clamp(foam, 0.0, 1.0));
}

vec3 shadeGround(vec3 p, vec3 rd, float dist) {
    vec4 sw = swash(p.x);
    vec3 bottom;
    vec3 col = sandColor(p, rd, dist, sw, bottom);
    float under = p.z - sw.x;
    if (under > 0.0) {
        // 薄薄一层水，涌上来时往岸上流，退下时往回流
        vec2 drift = vec2(uTime * 0.2, (sw.x - SHORE_Z) * 0.9);
        vec3 nw = normalize(vec3(noise(p.xz * 2.4 + drift) - 0.5, 5.0, noise(p.xz * 2.4 - drift + 5.0) - 0.5));
        float depth = 0.012 + 0.07 * smoothstep(0.0, 4.0, under);
        vec3 water = shadeWater(p, rd, nw, depth, bottom, swashFoam(p.xz, sw, under), dist);
        col = mix(col, water, smoothstep(0.0, 0.18, under));
    } else if (sw.y < 0.2) {
        // 水退走时在最远处留下一线细泡沫，很快就破掉
        float resid = exp(-abs(p.z - sw.z - 0.08) * 11.0) * step(0.5, noise(p.xz * 11.0)) * sqrt(sw.w) * (1.0 - smoothstep(-0.3, 0.2, sw.y));
        col = mix(col, vec3(0.80, 0.80, 0.78) * (SKY_AMB + SUN_COL * 0.12), resid * 0.6);
    }
    return col;
}

vec3 shadeSea(vec3 p, vec3 rd, float dist) {
    vec3 n = seaNormal(p, max(0.03, dist * 0.006));
    float depth = max(0.0, p.y - sandHeight(p.xz));
    vec4 sw = swash(p.x);
    float d = p.z - SHORE_Z;
    vec3 bottom = sandAlbedo(p.xz, dist) * vec3(0.50, 0.45, 0.40) * (SUN_COL * uSun.y + SKY_AMB * 0.8);
    float foam = max(seaFoam(p.xz) * smoothstep(-0.5, 2.5, d), swashFoam(p.xz, sw, p.z - sw.x) * (1.0 - smoothstep(1.0, 5.0, d)));
    return shadeWater(p, rd, n, depth, bottom, foam, dist);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    // 相机：站在沙滩上，眼睛离沙面 1.7 米，略微俯视大海；竖屏时视角放宽
    float aspect = uRes.x / uRes.y;
    float fov = aspect < 1.0 ? 1.15 : 0.85;
    vec3 ro = vec3(0.0, sandHeight(vec2(0.0)) + 1.7, 0.0);
    float pitch = -0.06 + 0.0025 * sin(uTime * 0.37);
    vec3 rd = normalize(vec3(uv.x * fov, uv.y * fov * cos(pitch) + sin(pitch), 1.0));

    vec3 col;
    float dist = 1e4;
    if (rd.y >= -0.0005) {
        col = skyColor(rd);
    } else {
        // 沙面是斜平面，直接求交；海面只可能在 y = -0.6..1.0 之间，在这一段里用割线法求交
        float tSand = (SLOPE * SHORE_Z - ro.y - SLOPE * ro.z) / (rd.y + SLOPE * rd.z);
        float tm = (ro.y - 1.0) / -rd.y;
        float tx = min((ro.y + 0.6) / -rd.y, 4000.0);
        float hm = mapSea(ro + rd * tm, 3);
        float hx = mapSea(ro + rd * tx, 3);
        float tSea = tx;
        bool seaReached = hx < 0.0 && tx > tm;
        for (int i = 0; i < 8; i++) {
            float tmid = mix(tm, tx, clamp(hm / (hm - hx), 0.08, 0.92));
            float hmid = mapSea(ro + rd * tmid, 3);
            if (hmid < 0.0) { tx = tmid; hx = hmid; } else { tm = tmid; hm = hmid; }
            tSea = tmid;
        }
        if (tSand > 0.0 && (tSand < tSea || !seaReached)) {
            dist = tSand;
            col = shadeGround(ro + rd * tSand, rd, dist);
        } else if (seaReached) {
            dist = tSea;
            col = shadeSea(ro + rd * tSea, rd, dist);
        } else {
            col = skyBase(normalize(vec3(rd.x, 0.015, rd.z)));
        }
        // 远处的海面融进海雾，地平线不是一条硬边
        vec3 haze = skyBase(normalize(vec3(rd.x, 0.015, rd.z)));
        col = mix(col, haze, 1.0 - exp(-dist * 0.0011));
    }
    // 逆光：整个画面蒙着一层很淡的暖色眩光
    col += vec3(1.0, 0.72, 0.45) * pow(max(dot(rd, uSun), 0.0), 5.0) * 0.07;
    // 色调映射 + 轻微暗角 + 一点颗粒（顺便消除天空渐变的色带）
    col *= 0.86;
    col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, 0.0, 1.0), vec3(0.96));
    vec2 q = gl_FragCoord.xy / uRes;
    col *= 0.84 + 0.16 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.2);
    col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.022;
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
    let grassPaints = [];
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

    // 两丛大的在左右下角，再散几丛小的。每丛里大多是细长的叶子，夹着几根带穗的草秆
    function makeTufts() {
        const rand = seededRandom(7);
        const spots = [
            { x: -0.02, size: 1.0, count: 150 },
            { x: 0.11, size: 0.5, count: 60 },
            { x: 0.89, size: 0.62, count: 80 },
            { x: 1.02, size: 1.05, count: 160 },
            { x: 0.5, size: 0.26, count: 26 },
        ];
        tufts = spots.map((spot) => ({
            x: spot.x,
            blades: Array.from({ length: spot.count }, () => {
                const spread = (rand() + rand() + rand()) / 3 - 0.5;
                return {
                    offset: spread * 0.3 * spot.size,
                    length: (0.15 + rand() * 0.27) * spot.size * (1 - Math.abs(spread) * 0.7),
                    lean: (rand() - 0.6) * 0.7 + spread * 0.9,
                    width: 0.5 + rand() * 1.1,
                    stiffness: 0.6 + rand() * 0.7,
                    phase: rand() * Math.PI * 2,
                    shade: rand(),
                    seed: rand() > 0.9,
                };
            }).sort((p, q) => p.shade - q.shade),
        }));
    }

    function resizeAir() {
        airDpr = Math.min(window.devicePixelRatio || 1, 2);
        airW = Math.floor(window.innerWidth * airDpr);
        airH = Math.floor(window.innerHeight * airDpr);
        airCanvas.width = airW;
        airCanvas.height = airH;
        makeGrassPaints();
    }

    // 草叶从根到尖的颜色：根部在阴影里发暗，叶尖被逆光照成枯草的金色。分几档深浅，暗的先画、亮的盖在上面
    function makeGrassPaints() {
        const top = airH - Math.min(airW, airH * 0.9) * 0.36;
        const stops = [
            ["#14170c", "#2c3317", "#59592c"],
            ["#1a1d0e", "#3d4520", "#8b8444"],
            ["#22240f", "#56592a", "#c2ad66"],
            ["#2a2910", "#6f6a33", "#ecd596"],
        ];
        grassPaints = stops.map(([root, mid, tip]) => {
            const paint = air.createLinearGradient(0, airH, 0, top);
            paint.addColorStop(0, root);
            paint.addColorStop(0.45, mid);
            paint.addColorStop(1, tip);
            return paint;
        });
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
                const flutter = Math.sin(t * (2.2 + blade.stiffness) + blade.phase + x0 * 0.002) * (0.1 + 0.16 * g);
                const bend = blade.lean - (0.3 + 0.7 * g) / blade.stiffness + flutter;
                // 叶子越往上越弯，叶尖垂下来
                const midX = x0 + Math.sin(bend * 0.35) * len * 0.5;
                const midY = y0 - Math.cos(bend * 0.35) * len * 0.55;
                const tipX = midX + Math.sin(bend * 1.25) * len * 0.55;
                const tipY = midY - Math.cos(bend * 1.25) * len * 0.5;
                const w = blade.width * airDpr * (0.8 + len / unit);
                air.fillStyle = grassPaints[Math.min(3, Math.floor(blade.shade * 4))];
                air.beginPath();
                air.moveTo(x0 - w, y0);
                air.quadraticCurveTo(midX - w * 0.8, midY, tipX, tipY);
                air.quadraticCurveTo(midX + w * 0.8, midY, x0 + w, y0);
                air.closePath();
                air.fill();
                if (blade.seed) {
                    // 草穗
                    const ang = Math.atan2(tipX - midX, midY - tipY);
                    air.save();
                    air.translate(tipX, tipY);
                    air.rotate(ang);
                    air.fillStyle = "rgba(226,200,140,0.9)";
                    air.beginPath();
                    air.ellipse(0, len * 0.03, w * 1.5, len * 0.07, 0, 0, Math.PI * 2);
                    air.fill();
                    air.restore();
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
                size: 0.4 + Math.random() * 0.8,
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
            air.strokeStyle = `rgba(238,220,184,${0.08 + 0.2 * g})`;
            air.lineWidth = p.size * airDpr;
            air.beginPath();
            air.moveTo(p.x, p.y);
            air.lineTo(p.x + streak, p.y - p.lift * streak);
            air.stroke();
        }
        air.restore();
    }

    // 远处的海鸥：逆光下是深色的剪影，大部分时间张着翅膀滑翔，偶尔扇几下
    function drawGulls(t, dt, g) {
        air.save();
        air.fillStyle = "rgba(52,50,54,0.82)";
        for (const gull of gulls) {
            // 逆风飞：被风往后推，慢慢横穿天空
            gull.x += gull.speed * (1.1 - g) * dt;
            if (gull.x > 1.15) {
                gull.x = -0.15;
            }
            const x = gull.x * airW;
            const y = (gull.y + Math.sin(t * 0.4 + gull.phase) * 0.015) * airH;
            const span = 13 * gull.size * airDpr;
            const flapping = Math.max(0, Math.sin(t * 0.23 + gull.phase * 2.0));
            const flap = Math.sin(t * (5.5 + gull.size) + gull.phase) * flapping;
            const lift = span * (0.12 + 0.4 * flap);
            const thick = span * 0.11;
            air.beginPath();
            air.moveTo(x - span, y - lift);
            air.quadraticCurveTo(x - span * 0.5, y - lift * 1.5 - span * 0.12, x - span * 0.08, y - thick);
            air.quadraticCurveTo(x, y - thick * 1.6, x + span * 0.08, y - thick);
            air.quadraticCurveTo(x + span * 0.5, y - lift * 1.5 - span * 0.12, x + span, y - lift);
            air.quadraticCurveTo(x + span * 0.5, y - lift * 1.1 + thick * 0.6, x + span * 0.1, y + thick);
            air.quadraticCurveTo(x, y + thick * 1.8, x - span * 0.1, y + thick);
            air.quadraticCurveTo(x - span * 0.5, y - lift * 1.1 + thick * 0.6, x - span, y - lift);
            air.closePath();
            air.fill();
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
