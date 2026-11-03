// 放映厅配乐：用 Web Audio 实时合成的原创配乐，按每部电影的情绪（mood）生成和弦、琶音和旋律。
// 不使用任何电影原声。旋律由固定种子的随机游走生成，同一部电影每次听到的是同一段。
// 用法：LanternScore.enable() / disable() / play(mood, seed)；需要在用户点击后 enable。
(() => {
    const MAJOR = [0, 2, 4, 5, 7, 9, 11];
    const MINOR = [0, 2, 3, 5, 7, 8, 10];
    const DORIAN = [0, 2, 3, 5, 7, 9, 10];
    const PENTA = [0, 2, 4, 7, 9];

    // root: MIDI 音高；prog: 每小节和弦的音阶级数；lead: 旋律乐器；arp: 琶音型；pad: 铺底音色
    const MOODS = {
        heroic: { bpm: 72, beats: 4, root: 50, scale: MAJOR, prog: [0, 4, 5, 3], pad: "brass", lead: "horn", arp: "sparse", bass: true, drum: "timpani" },
        gentle: { bpm: 84, beats: 4, root: 60, scale: MAJOR, prog: [0, 5, 3, 4], pad: "warm", lead: "piano", arp: "flowing", bass: false },
        tense: { bpm: 100, beats: 4, root: 45, scale: MINOR, prog: [0, 0, 5, 6], pad: "dark", lead: "metal", arp: "pulse", bass: true, drum: "pulse" },
        noir: { bpm: 64, beats: 4, root: 52, scale: MINOR, prog: [0, 5, 3, 4], pad: "dark", lead: "piano", arp: "sparse", bass: true },
        waltz: { bpm: 96, beats: 3, root: 57, scale: MAJOR, prog: [0, 3, 4, 5], pad: "warm", lead: "piano", arp: "waltz", bass: true },
        dark: { bpm: 56, beats: 4, root: 38, scale: MINOR, prog: [0, 5, 1, 0], pad: "drone", lead: "cello", arp: "none", bass: true, drum: "pulse" },
        playful: { bpm: 116, beats: 4, root: 60, scale: MAJOR, prog: [0, 3, 4, 4], pad: "bright", lead: "pluck", arp: "bouncy", bass: true },
        pentatonic: { bpm: 60, beats: 4, root: 57, scale: PENTA, prog: [0, 3, 1, 0], pad: "warm", lead: "zheng", arp: "sparse", bass: false },
        romantic: { bpm: 66, beats: 4, root: 53, scale: MAJOR, prog: [0, 5, 1, 4], pad: "strings", lead: "piano", arp: "flowing", bass: true, sevenths: true },
        hopeful: { bpm: 70, beats: 4, root: 55, scale: MAJOR, prog: [0, 4, 5, 3], pad: "strings", lead: "piano", arp: "sparse", bass: true },
        wistful: { bpm: 62, beats: 4, root: 50, scale: DORIAN, prog: [0, 3, 6, 0], pad: "strings", lead: "zheng", arp: "sparse", bass: false },
        sweeping: { bpm: 68, beats: 3, root: 55, scale: MAJOR, prog: [0, 3, 4, 0], pad: "strings", lead: "horn", arp: "waltz", bass: true, sevenths: true },
    };

    const LOOKAHEAD_S = 0.25;
    const TICK_MS = 80;
    const FADE_S = 1.6;

    let ctx = null;
    let master = null;
    let reverb = null;
    let whirr = null;
    let enabled = false;
    let session = null; // 当前正在播的配乐
    let timer = null;

    function midiToHz(midi) {
        return 440 * 2 ** ((midi - 69) / 12);
    }

    // 固定种子的伪随机数（mulberry32）
    function seeded(seed) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hashString(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        }
        return h >>> 0;
    }

    // ---------- 音频图 ----------

    function makeImpulse(seconds, decay) {
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
        for (let channel = 0; channel < 2; channel += 1) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < length; i += 1) {
                data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
            }
        }
        return buffer;
    }

    function setupGraph() {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.ratio.value = 3;
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(compressor);
        compressor.connect(ctx.destination);

        const convolver = ctx.createConvolver();
        convolver.buffer = makeImpulse(3.2, 2.6);
        reverb = ctx.createGain();
        reverb.gain.value = 0.42;
        reverb.connect(convolver);
        convolver.connect(master);

        // 放映机的转动声：带通噪声，按 24 格/秒轻轻起伏
        const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) {
            data[i] = Math.random() * 2 - 1;
        }
        const source = ctx.createBufferSource();
        source.buffer = noise;
        source.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 1400;
        band.Q.value = 0.8;
        whirr = ctx.createGain();
        whirr.gain.value = 0.012;
        const flutter = ctx.createOscillator();
        flutter.frequency.value = 24;
        const flutterDepth = ctx.createGain();
        flutterDepth.gain.value = 0.006;
        flutter.connect(flutterDepth);
        flutterDepth.connect(whirr.gain);
        source.connect(band);
        band.connect(whirr);
        whirr.connect(master);
        source.start();
        flutter.start();
    }

    // ---------- 乐器 ----------

    function envelope(gainNode, time, { attack, hold = 0, release, peak }) {
        gainNode.gain.setValueAtTime(0.0001, time);
        gainNode.gain.exponentialRampToValueAtTime(peak, time + attack);
        gainNode.gain.setValueAtTime(peak, time + attack + hold);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release);
        return time + attack + hold + release + 0.05;
    }

    function voice(out, time, midi, { types, detune = 0, attack, hold, release, peak, cutoff, wet = 0.5 }) {
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = cutoff;
        filter.connect(gain);
        gain.connect(out);
        const send = ctx.createGain();
        send.gain.value = wet;
        gain.connect(send);
        send.connect(reverb);
        const end = envelope(gain, time, { attack, hold, release, peak });
        types.forEach((type, index) => {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.value = midiToHz(midi);
            osc.detune.value = index === 0 ? -detune : detune;
            osc.connect(filter);
            osc.start(time);
            osc.stop(end);
        });
    }

    const INSTRUMENTS = {
        piano: (out, t, midi, len) =>
            voice(out, t, midi, { types: ["triangle", "sine"], detune: 3, attack: 0.008, hold: 0.02, release: Math.min(2.4, len * 2), peak: 0.16, cutoff: 3200, wet: 0.45 }),
        pluck: (out, t, midi) => voice(out, t, midi, { types: ["triangle"], attack: 0.004, release: 0.35, peak: 0.14, cutoff: 4200, wet: 0.3 }),
        zheng: (out, t, midi) => voice(out, t, midi, { types: ["sawtooth", "triangle"], detune: 4, attack: 0.003, release: 1.6, peak: 0.08, cutoff: 2600, wet: 0.55 }),
        horn: (out, t, midi, len) =>
            voice(out, t, midi, { types: ["sawtooth", "sawtooth"], detune: 6, attack: 0.18, hold: len * 0.6, release: 0.6, peak: 0.07, cutoff: 1400, wet: 0.5 }),
        cello: (out, t, midi, len) =>
            voice(out, t, midi, { types: ["sawtooth", "sawtooth"], detune: 8, attack: 0.5, hold: len * 0.7, release: 1.2, peak: 0.07, cutoff: 900, wet: 0.5 }),
        metal: (out, t, midi) => voice(out, t, midi, { types: ["square", "sine"], detune: 13, attack: 0.002, release: 0.5, peak: 0.05, cutoff: 3000, wet: 0.6 }),
    };

    const PADS = {
        warm: { types: ["triangle", "triangle"], detune: 7, cutoff: 1800, peak: 0.05 },
        strings: { types: ["sawtooth", "sawtooth"], detune: 9, cutoff: 1500, peak: 0.035 },
        brass: { types: ["sawtooth", "square"], detune: 6, cutoff: 1100, peak: 0.035 },
        dark: { types: ["sawtooth", "triangle"], detune: 11, cutoff: 700, peak: 0.045 },
        drone: { types: ["sawtooth", "sawtooth"], detune: 14, cutoff: 420, peak: 0.06 },
        bright: { types: ["triangle", "square"], detune: 5, cutoff: 2600, peak: 0.025 },
    };

    function playPad(out, time, notes, barSeconds, kind) {
        const pad = PADS[kind];
        notes.forEach((midi) => {
            voice(out, time, midi, {
                types: pad.types,
                detune: pad.detune,
                attack: barSeconds * 0.35,
                hold: barSeconds * 0.45,
                release: barSeconds * 0.6,
                peak: pad.peak,
                cutoff: pad.cutoff,
                wet: 0.6,
            });
        });
    }

    function playBass(out, time, midi, barSeconds) {
        voice(out, time, midi, { types: ["sine", "triangle"], attack: 0.03, hold: barSeconds * 0.5, release: barSeconds * 0.4, peak: 0.12, cutoff: 500, wet: 0.15 });
    }

    function playDrum(out, time, kind) {
        const gain = ctx.createGain();
        const osc = ctx.createOscillator();
        osc.type = "sine";
        const start = kind === "timpani" ? 110 : 70;
        osc.frequency.setValueAtTime(start, time);
        osc.frequency.exponentialRampToValueAtTime(start * 0.5, time + 0.4);
        osc.connect(gain);
        gain.connect(out);
        const send = ctx.createGain();
        send.gain.value = 0.4;
        gain.connect(send);
        send.connect(reverb);
        const end = envelope(gain, time, { attack: 0.005, release: kind === "timpani" ? 1.1 : 0.35, peak: kind === "timpani" ? 0.22 : 0.16 });
        osc.start(time);
        osc.stop(end);
    }

    // ---------- 编曲 ----------

    function chordNotes(mood, degree) {
        const { scale, root } = mood;
        const steps = mood.sevenths ? [0, 2, 4, 6] : [0, 2, 4];
        return steps.map((step) => {
            const index = degree + step;
            return root + scale[index % scale.length] + 12 * Math.floor(index / scale.length);
        });
    }

    function scaleNote(mood, index) {
        const { scale, root } = mood;
        const octave = Math.floor(index / scale.length);
        return root + 12 + scale[((index % scale.length) + scale.length) % scale.length] + 12 * octave;
    }

    function scheduleBar(s, time) {
        const mood = s.mood;
        const beat = 60 / mood.bpm;
        const bar = beat * mood.beats;
        const degree = mood.prog[s.bar % mood.prog.length];
        const chord = chordNotes(mood, degree);
        const rand = s.rand;

        playPad(s.out, time, chord, bar, mood.pad);
        if (mood.bass) {
            playBass(s.out, time, chord[0] - 12, bar);
        }
        if (mood.drum === "timpani" && s.bar % 2 === 0) {
            playDrum(s.out, time, "timpani");
        }

        const lead = INSTRUMENTS[mood.lead];
        const arpNotes = chord.map((midi) => midi + 12);
        const hits = [];
        switch (mood.arp) {
            case "flowing":
                for (let i = 0; i < mood.beats * 2; i += 1) hits.push([i * (beat / 2), arpNotes[i % arpNotes.length], beat]);
                break;
            case "waltz":
                hits.push([0, chord[0], beat], [beat, arpNotes[1], beat], [beat * 2, arpNotes[2], beat]);
                break;
            case "bouncy":
                for (let i = 0; i < mood.beats * 2; i += 1)
                    if (rand() < 0.75) hits.push([i * (beat / 2), arpNotes[Math.floor(rand() * arpNotes.length)] + (rand() < 0.2 ? 12 : 0), beat / 2]);
                break;
            case "pulse":
                for (let i = 0; i < mood.beats * 2; i += 1) hits.push([i * (beat / 2), chord[0] + (i % 4 === 3 ? 7 : 0), beat / 2]);
                break;
            case "sparse":
                for (let i = 0; i < mood.beats; i += 1) if (rand() < 0.55) hits.push([i * beat, arpNotes[Math.floor(rand() * arpNotes.length)], beat * 2]);
                break;
            default:
                break;
        }
        if (mood.drum === "pulse") {
            for (let i = 0; i < mood.beats; i += 2) playDrum(s.out, time + i * beat, "pulse");
        }
        const arpPlayer = mood.arp === "pulse" ? INSTRUMENTS.metal : mood.lead === "horn" || mood.lead === "cello" ? INSTRUMENTS.piano : lead;
        for (const [offset, midi, len] of hits) {
            arpPlayer(s.out, time + offset, midi, len);
        }

        // 旋律：在音阶上随机游走，一般每两小节一句（圆号、大提琴每小节两个长音）
        if (s.bar % 2 === 1 || mood.lead === "horn" || mood.lead === "cello") {
            const notes = mood.lead === "cello" || mood.lead === "horn" ? 2 : 3 + Math.floor(rand() * 2);
            for (let i = 0; i < notes; i += 1) {
                const stepChoices = [-2, -1, -1, 1, 1, 2];
                s.melody = Math.max(-2, Math.min(9, s.melody + stepChoices[Math.floor(rand() * stepChoices.length)]));
                const len = bar / notes;
                lead(s.out, time + i * len + beat * 0.02, scaleNote(mood, s.melody), len);
            }
        }
    }

    function tick() {
        if (!session || !ctx) {
            return;
        }
        while (session.nextBar < ctx.currentTime + LOOKAHEAD_S) {
            scheduleBar(session, session.nextBar);
            session.nextBar += (60 / session.mood.bpm) * session.mood.beats;
            session.bar += 1;
        }
    }

    // ---------- 对外 ----------

    function fadeOutSession(s) {
        if (!s) {
            return;
        }
        const now = ctx.currentTime;
        s.out.gain.cancelScheduledValues(now);
        s.out.gain.setValueAtTime(s.out.gain.value, now);
        s.out.gain.linearRampToValueAtTime(0, now + FADE_S);
        setTimeout(() => s.out.disconnect(), (FADE_S + 4) * 1000);
    }

    function play(moodName, seedText) {
        if (!enabled || !ctx) {
            return;
        }
        const mood = MOODS[moodName] || MOODS.gentle;
        fadeOutSession(session);
        const out = ctx.createGain();
        out.gain.value = 0;
        out.connect(master);
        const now = ctx.currentTime;
        out.gain.linearRampToValueAtTime(1, now + FADE_S);
        session = { mood, out, bar: 0, melody: 4, rand: seeded(hashString(seedText || moodName)), nextBar: now + 0.1 };
        tick();
    }

    function enable(moodName, seedText) {
        if (!ctx) {
            setupGraph();
        }
        enabled = true;
        ctx.resume();
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.7, now + 0.8);
        if (!timer) {
            timer = setInterval(tick, TICK_MS);
        }
        play(moodName, seedText);
    }

    function disable() {
        enabled = false;
        if (!ctx) {
            return;
        }
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + 0.6);
        fadeOutSession(session);
        session = null;
        clearInterval(timer);
        timer = null;
        setTimeout(() => {
            if (!enabled) {
                ctx.suspend();
            }
        }, 900);
    }

    // 切到后台时暂停，回来时继续
    document.addEventListener("visibilitychange", () => {
        if (!ctx || !enabled) {
            return;
        }
        if (document.hidden) {
            ctx.suspend();
        } else {
            ctx.resume();
        }
    });

    window.LanternScore = {
        enable,
        disable,
        play,
        isEnabled: () => enabled,
        moods: Object.keys(MOODS),
    };
})();
