// 放映厅配乐：用 Web Audio 实时合成的原创管弦乐——弦乐组铺和声、独奏小提琴拉旋律，
// 配竖琴、拨弦、圆号、长笛和定音鼓，按每部电影的情绪（mood）编配。不使用任何电影原声。
// 旋律由固定种子的随机游走生成，同一部电影每次听到的是同一段。
// 用法：LanternScore.enable() / disable() / play(mood, seed)；需要在用户点击后 enable。
(() => {
    const MAJOR = [0, 2, 4, 5, 7, 9, 11];
    const MINOR = [0, 2, 3, 5, 7, 8, 10];
    const DORIAN = [0, 2, 3, 5, 7, 9, 10];
    const PENTA = [0, 2, 4, 7, 9];

    // strings：弦乐组织体；lead：旋律乐器；arp：伴奏型；counter：副旋律；timpani：定音鼓
    const MOODS = {
        heroic: { bpm: 72, beats: 4, root: 50, scale: MAJOR, prog: [0, 4, 5, 3], strings: "full", lead: "violin", counter: "horn", arp: "harp", timpani: true },
        gentle: { bpm: 74, beats: 4, root: 60, scale: MAJOR, prog: [0, 5, 3, 4], strings: "soft", lead: "violin", arp: "harpFlow" },
        tense: { bpm: 100, beats: 4, root: 45, scale: MINOR, prog: [0, 0, 5, 6], strings: "tremolo", lead: "cello", arp: "ostinato", timpani: true },
        noir: { bpm: 60, beats: 4, root: 52, scale: MINOR, prog: [0, 5, 3, 4], strings: "soft", lead: "violin", arp: "harp" },
        waltz: { bpm: 92, beats: 3, root: 57, scale: MAJOR, prog: [0, 3, 4, 5], strings: "soft", lead: "violin", arp: "waltzPizz" },
        dark: { bpm: 54, beats: 4, root: 38, scale: MINOR, prog: [0, 5, 1, 0], strings: "dark", lead: "cello", arp: "none", timpani: true },
        playful: { bpm: 112, beats: 4, root: 60, scale: MAJOR, prog: [0, 3, 4, 4], strings: "soft", lead: "flute", arp: "pizz" },
        pentatonic: { bpm: 58, beats: 4, root: 57, scale: PENTA, prog: [0, 3, 1, 0], strings: "soft", lead: "violin", arp: "harp" },
        romantic: { bpm: 62, beats: 4, root: 53, scale: MAJOR, prog: [0, 5, 1, 4], strings: "full", lead: "violin", arp: "harpFlow", sevenths: true },
        hopeful: { bpm: 66, beats: 4, root: 55, scale: MAJOR, prog: [0, 4, 5, 3], strings: "full", lead: "violin", arp: "harp" },
        wistful: { bpm: 58, beats: 4, root: 50, scale: DORIAN, prog: [0, 3, 6, 0], strings: "soft", lead: "violin", arp: "harp" },
        sweeping: {
            bpm: 64,
            beats: 3,
            root: 55,
            scale: MAJOR,
            prog: [0, 3, 4, 0],
            strings: "full",
            lead: "violin",
            counter: "horn",
            arp: "waltzHarp",
            timpani: true,
            sevenths: true,
        },
    };

    const LOOKAHEAD_S = 0.3;
    const TICK_MS = 80;
    const FADE_S = 2.2;
    const MASTER_LEVEL = 0.55;

    let ctx = null;
    let master = null;
    let reverb = null;
    let noise = null;
    let enabled = false;
    let session = null;
    let timer = null;

    const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

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

    // 音乐厅混响：衰减的立体声噪声做冲激响应
    function makeHall(seconds) {
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
        for (let channel = 0; channel < 2; channel += 1) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < length; i += 1) {
                const t = i / length;
                data[i] = (Math.random() * 2 - 1) * (1 - t) ** 3.2 * (t < 0.02 ? t / 0.02 : 1);
            }
        }
        return buffer;
    }

    function buildGraph(destination) {
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.ratio.value = 2.5;
        compressor.attack.value = 0.02;
        compressor.release.value = 0.4;
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(compressor);
        compressor.connect(destination);

        const hall = ctx.createConvolver();
        hall.buffer = makeHall(4.2);
        const hallTone = ctx.createBiquadFilter();
        hallTone.type = "lowpass";
        hallTone.frequency.value = 5200;
        reverb = ctx.createGain();
        reverb.gain.value = 0.55;
        reverb.connect(hall);
        hall.connect(hallTone);
        hallTone.connect(master);

        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) {
            data[i] = Math.random() * 2 - 1;
        }
    }

    function peaking(frequency, gain, q) {
        const filter = ctx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = frequency;
        filter.gain.value = gain;
        filter.Q.value = q;
        return filter;
    }

    // 乐器的「琴身」：一串固定的共振滤波器，这件乐器的所有音都经过它
    function makeBody(out, { lowpass, peaks, wet }) {
        const input = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = lowpass;
        input.connect(lp);
        let node = lp;
        for (const [frequency, gain, q] of peaks) {
            const filter = peaking(frequency, gain, q);
            node.connect(filter);
            node = filter;
        }
        node.connect(out);
        const send = ctx.createGain();
        send.gain.value = wet;
        node.connect(send);
        send.connect(reverb);
        return input;
    }

    function makeSessionBuses(out) {
        return {
            strings: makeBody(out, {
                lowpass: 4600,
                peaks: [
                    [280, 4, 1.1],
                    [1100, -3, 1],
                    [2700, 4.5, 1.4],
                    [6000, -6, 0.8],
                ],
                wet: 0.6,
            }),
            violin: makeBody(out, {
                lowpass: 6500,
                peaks: [
                    [290, 3, 1.2],
                    [1200, -2, 1],
                    [2900, 6, 1.6],
                    [4500, 2, 2],
                ],
                wet: 0.5,
            }),
            cello: makeBody(out, {
                lowpass: 3200,
                peaks: [
                    [200, 4, 1.2],
                    [700, 2, 1.2],
                    [1800, 3, 1.5],
                ],
                wet: 0.5,
            }),
            horn: makeBody(out, {
                lowpass: 1500,
                peaks: [
                    [350, 3, 1],
                    [900, 2, 1.2],
                ],
                wet: 0.65,
            }),
            harp: makeBody(out, {
                lowpass: 5200,
                peaks: [
                    [400, 2, 1],
                    [2500, 2, 1.2],
                ],
                wet: 0.55,
            }),
            flute: makeBody(out, { lowpass: 7000, peaks: [[1500, 2, 1]], wet: 0.5 }),
            perc: makeBody(out, { lowpass: 2000, peaks: [[90, 4, 1]], wet: 0.45 }),
        };
    }

    // ---------- 乐器 ----------

    // 揉弦：正弦 LFO 接到振荡器的 detune 上；音头之后才慢慢起来，像演奏者拉稳了才开始揉
    function addVibrato(osc, time, end, { rate, depth, delay }) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rate * (0.94 + Math.random() * 0.12);
        const amount = ctx.createGain();
        amount.gain.setValueAtTime(0, time);
        amount.gain.linearRampToValueAtTime(0, time + delay);
        amount.gain.linearRampToValueAtTime(depth, time + delay + 0.45);
        lfo.connect(amount);
        amount.connect(osc.detune);
        lfo.start(time);
        lfo.stop(end);
    }

    function swell(gainNode, time, attack, sustain, release, peak) {
        gainNode.gain.setValueAtTime(0.0001, time);
        gainNode.gain.exponentialRampToValueAtTime(peak, time + attack);
        gainNode.gain.setValueAtTime(peak, time + attack + sustain);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + attack + sustain + release);
        return time + attack + sustain + release + 0.05;
    }

    // 弦乐组的一个音：几个音准略有出入的「乐手」各自揉弦，合起来就是一片弦乐
    function sectionNote(bus, time, midi, dur, { players = 3, peak, attack, release = 1.4, tremolo = false }) {
        const gain = ctx.createGain();
        gain.connect(bus);
        const end = swell(gain, time, attack, Math.max(0.05, dur - attack), release, peak / Math.sqrt(players));
        let target = gain;
        if (tremolo) {
            const trem = ctx.createGain();
            trem.connect(gain);
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 11;
            const depth = ctx.createGain();
            depth.gain.value = 0.45;
            lfo.connect(depth);
            depth.connect(trem.gain);
            lfo.start(time);
            lfo.stop(end);
            target = trem;
        }
        for (let i = 0; i < players; i += 1) {
            const osc = ctx.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = hz(midi);
            osc.detune.value = (i - (players - 1) / 2) * 7 + (Math.random() - 0.5) * 4;
            addVibrato(osc, time, end, { rate: 5.2, depth: 9, delay: 0.25 + Math.random() * 0.2 });
            osc.connect(target);
            osc.start(time + Math.random() * 0.03);
            osc.stop(end);
        }
    }

    // 独奏旋律：一整句用同一组振荡器，音与音之间滑过去（连弓），每个音轻轻重新起弓
    function soloPhrase(bus, notes, { register = 0, peak, vibrato, bowNoise, type = "sawtooth" }) {
        if (notes.length === 0) {
            return;
        }
        const start = notes[0].time;
        const last = notes[notes.length - 1];
        const end = last.time + last.dur + 1.2;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.connect(bus);

        const oscillators = [0, 1].map((index) => {
            const osc = ctx.createOscillator();
            osc.type = index === 0 ? type : "triangle";
            osc.detune.value = index === 0 ? -3 : 4;
            osc.frequency.setValueAtTime(hz(notes[0].midi + register), start);
            osc.connect(gain);
            osc.start(start);
            osc.stop(end);
            return osc;
        });
        const vibratoLfo = ctx.createOscillator();
        vibratoLfo.frequency.value = vibrato.rate;
        const vibratoAmount = ctx.createGain();
        vibratoAmount.gain.value = 0;
        vibratoLfo.connect(vibratoAmount);
        for (const osc of oscillators) {
            vibratoAmount.connect(osc.detune);
        }
        vibratoLfo.start(start);
        vibratoLfo.stop(end);

        notes.forEach((note, index) => {
            const frequency = hz(note.midi + register);
            if (index > 0) {
                for (const osc of oscillators) {
                    osc.frequency.setTargetAtTime(frequency, note.time, 0.035);
                }
            }
            // 句中略强、两头略弱；每个音音头稍弱、随后渐强，揉弦在音头之后才起来
            const level = peak * (0.85 + 0.15 * Math.sin((index / Math.max(1, notes.length - 1)) * Math.PI));
            gain.gain.setTargetAtTime(level * 0.55, note.time, 0.03);
            gain.gain.setTargetAtTime(level, note.time + 0.08, Math.min(0.4, note.dur * 0.3));
            vibratoAmount.gain.setTargetAtTime(0, note.time, 0.02);
            vibratoAmount.gain.setTargetAtTime(vibrato.depth, note.time + vibrato.delay, 0.18);
            if (bowNoise) {
                const src = ctx.createBufferSource();
                src.buffer = noise;
                const band = ctx.createBiquadFilter();
                band.type = "bandpass";
                band.frequency.value = 3200;
                band.Q.value = 1.2;
                const noiseGain = ctx.createGain();
                swell(noiseGain, note.time, 0.01, 0.03, 0.12, peak * 0.05);
                src.connect(band);
                band.connect(noiseGain);
                noiseGain.connect(bus);
                src.start(note.time, Math.random());
                src.stop(note.time + 0.3);
            }
        });
        gain.gain.setTargetAtTime(0.0001, last.time + last.dur, 0.35);
    }

    function harpNote(bus, time, midi, peak = 0.16) {
        const gain = ctx.createGain();
        gain.connect(bus);
        const end = time + 2.6;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(peak, time + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        for (const [type, ratio, level] of [
            ["triangle", 1, 1],
            ["sine", 2, 0.35],
        ]) {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.value = hz(midi) * ratio;
            const partial = ctx.createGain();
            partial.gain.value = level;
            osc.connect(partial);
            partial.connect(gain);
            osc.start(time);
            osc.stop(end);
        }
    }

    function pizzNote(bus, time, midi, peak = 0.2) {
        const gain = ctx.createGain();
        gain.connect(bus);
        const end = time + 0.5;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(peak, time + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = hz(midi);
        const tone = ctx.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.setValueAtTime(2600, time);
        tone.frequency.exponentialRampToValueAtTime(500, time + 0.25);
        osc.connect(tone);
        tone.connect(gain);
        osc.start(time);
        osc.stop(end);
    }

    function hornNote(bus, time, midi, dur, peak = 0.11) {
        const gain = ctx.createGain();
        gain.connect(bus);
        const end = swell(gain, time, 0.22, Math.max(0.1, dur - 0.22), 0.8, peak);
        for (const detune of [-5, 5]) {
            const osc = ctx.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = hz(midi);
            osc.detune.value = detune;
            addVibrato(osc, time, end, { rate: 4.8, depth: 5, delay: 0.4 });
            osc.connect(gain);
            osc.start(time);
            osc.stop(end);
        }
    }

    function timpaniHit(bus, time, midi, peak = 0.32) {
        const gain = ctx.createGain();
        gain.connect(bus);
        const end = time + 1.8;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(peak, time + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(hz(midi) * 1.04, time);
        osc.frequency.exponentialRampToValueAtTime(hz(midi), time + 0.15);
        osc.connect(gain);
        osc.start(time);
        osc.stop(end);
        // 鼓皮的「噗」
        const src = ctx.createBufferSource();
        src.buffer = noise;
        const low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 600;
        const thump = ctx.createGain();
        swell(thump, time, 0.003, 0.01, 0.15, peak * 0.35);
        src.connect(low);
        low.connect(thump);
        thump.connect(bus);
        src.start(time, Math.random());
        src.stop(time + 0.3);
    }

    // ---------- 编曲 ----------

    function noteAt(mood, index, octaveShift = 0) {
        const { scale, root } = mood;
        const octave = Math.floor(index / scale.length);
        return root + scale[((index % scale.length) + scale.length) % scale.length] + 12 * (octave + octaveShift);
    }

    function chordIndexes(mood, degree) {
        return (mood.sevenths ? [0, 2, 4, 6] : [0, 2, 4]).map((step) => degree + step);
    }

    // 旋律的节奏型（单位：拍），每句两小节
    const RHYTHMS = {
        4: [
            [2, 1, 1, 3, 1],
            [3, 1, 2, 2],
            [1, 1, 2, 4],
            [2, 2, 1, 1, 2],
        ],
        3: [
            [2, 1, 3],
            [1, 1, 1, 3],
            [3, 2, 1],
        ],
    };

    const LEADS = {
        violin: { bus: "violin", register: 0, peak: 0.16, vibrato: { rate: 5.6, depth: 22, delay: 0.22 }, bowNoise: true },
        cello: { bus: "cello", register: -12, peak: 0.2, vibrato: { rate: 5, depth: 18, delay: 0.3 }, bowNoise: true },
        flute: { bus: "flute", register: 12, peak: 0.13, vibrato: { rate: 4.6, depth: 12, delay: 0.15 }, bowNoise: false, type: "sine" },
    };

    function scheduleMelody(s, time, chord) {
        const { mood, rand } = s;
        const beat = 60 / mood.bpm;
        const patterns = RHYTHMS[mood.beats];
        const rhythm = patterns[Math.floor(rand() * patterns.length)];
        const notes = [];
        let offset = 0;
        rhythm.forEach((beats, i) => {
            if (i === rhythm.length - 1) {
                // 句尾落到离当前位置最近的和弦音
                const targets = chord.flatMap((index) => [index, index + mood.scale.length]);
                s.melody = targets.reduce((best, index) => (Math.abs(index - s.melody) < Math.abs(best - s.melody) ? index : best), targets[0]);
            } else {
                const steps = [-2, -1, -1, 1, 1, 2, 3];
                s.melody = Math.max(2, Math.min(12, s.melody + steps[Math.floor(rand() * steps.length)]));
            }
            notes.push({ time: time + offset * beat, dur: beats * beat * 0.98, midi: noteAt(mood, s.melody, 1) });
            offset += beats;
        });
        const lead = LEADS[mood.lead];
        soloPhrase(s.buses[lead.bus], notes, lead);
    }

    function scheduleBar(s, time) {
        const { mood, rand, buses } = s;
        const beat = 60 / mood.bpm;
        const bar = beat * mood.beats;
        const chord = chordIndexes(mood, mood.prog[s.bar % mood.prog.length]);

        // 弦乐组：中音区和弦 + 低音区根音（大提琴/低音提琴）；full 时再加一层高音小提琴
        const level = { full: 0.16, soft: 0.13, dark: 0.16, tremolo: 0.13 }[mood.strings];
        const stringOpts = { peak: level, attack: mood.strings === "tremolo" ? 0.15 : bar * 0.3, release: bar * 0.55, tremolo: mood.strings === "tremolo" };
        const voicing = mood.strings === "dark" ? [chord[0], chord[0] + 4] : chord;
        for (const index of voicing) {
            sectionNote(buses.strings, time, noteAt(mood, index), bar, stringOpts);
        }
        sectionNote(buses.strings, time, noteAt(mood, chord[0], -1), bar, { ...stringOpts, peak: level * 1.1, players: 2 });
        if (mood.strings === "full") {
            sectionNote(buses.strings, time, noteAt(mood, chord[chord.length - 1], 1), bar, { ...stringOpts, peak: level * 0.6 });
        }

        // 伴奏型
        const high = chord.map((index) => noteAt(mood, index, 1));
        switch (mood.arp) {
            case "harp":
                high.forEach((midi, i) => {
                    harpNote(buses.harp, time + i * beat * 0.5, midi);
                });
                break;
            case "harpFlow":
                for (let i = 0; i < mood.beats * 2; i += 1) {
                    harpNote(buses.harp, time + i * beat * 0.5, high[i % high.length] + (i >= high.length * 2 ? 12 : 0), 0.13);
                }
                break;
            case "waltzHarp":
                harpNote(buses.harp, time, noteAt(mood, chord[0], -1), 0.18);
                harpNote(buses.harp, time + beat, high[1], 0.12);
                harpNote(buses.harp, time + beat * 2, high[2], 0.12);
                break;
            case "waltzPizz":
                pizzNote(buses.strings, time, noteAt(mood, chord[0], -1), 0.26);
                pizzNote(buses.strings, time + beat, noteAt(mood, chord[1]), 0.16);
                pizzNote(buses.strings, time + beat * 2, noteAt(mood, chord[2]), 0.16);
                break;
            case "pizz":
                for (let i = 0; i < mood.beats * 2; i += 1) {
                    if (rand() < 0.7) {
                        pizzNote(buses.strings, time + i * beat * 0.5, high[Math.floor(rand() * high.length)] - 12, 0.18);
                    }
                }
                break;
            case "ostinato":
                for (let i = 0; i < mood.beats * 2; i += 1) {
                    sectionNote(buses.strings, time + i * beat * 0.5, noteAt(mood, chord[0], -1) + (i % 4 === 3 ? 1 : 0), beat * 0.3, {
                        peak: 0.14,
                        attack: 0.02,
                        release: 0.12,
                        players: 2,
                    });
                }
                break;
            default:
                break;
        }

        if (mood.timpani && s.bar % 2 === 0) {
            timpaniHit(buses.perc, time, noteAt(mood, chord[0], -2));
            if (mood.strings === "tremolo") {
                timpaniHit(buses.perc, time + beat * (mood.beats - 0.5), noteAt(mood, chord[0], -2), 0.18);
            }
        }
        if (mood.counter === "horn" && s.bar % 2 === 0) {
            hornNote(buses.horn, time, noteAt(mood, chord[1]), bar * 1.8);
        }

        // 旋律：每两小节一句
        if (s.bar % 2 === 0) {
            scheduleMelody(s, time, chord);
        }
    }

    function scheduleUntil(s, until) {
        while (s.nextBar < until) {
            scheduleBar(s, s.nextBar);
            s.nextBar += (60 / s.mood.bpm) * s.mood.beats;
            s.bar += 1;
        }
    }

    function tick() {
        if (session && ctx) {
            scheduleUntil(session, ctx.currentTime + LOOKAHEAD_S);
        }
    }

    function newSession(moodName, seedText, startTime) {
        const mood = MOODS[moodName] || MOODS.gentle;
        const out = ctx.createGain();
        out.gain.setValueAtTime(0, startTime);
        out.gain.linearRampToValueAtTime(1, startTime + FADE_S);
        out.connect(master);
        return { mood, out, buses: makeSessionBuses(out), bar: 0, melody: 7, rand: seeded(hashString(seedText || moodName)), nextBar: startTime + 0.1 };
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
        setTimeout(() => s.out.disconnect(), (FADE_S + 6) * 1000);
    }

    function play(moodName, seedText) {
        if (!enabled || !ctx) {
            return;
        }
        fadeOutSession(session);
        session = newSession(moodName, seedText, ctx.currentTime);
        tick();
    }

    function enable(moodName, seedText) {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            buildGraph(ctx.destination);
        }
        enabled = true;
        ctx.resume();
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(MASTER_LEVEL, now + 0.8);
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

    // 离线渲染一段，供测试和试听用；不影响正在播放的配乐
    async function preview(moodName, seconds, seedText = moodName, sampleRate = 44100) {
        const saved = { ctx, master, reverb, noise };
        const offline = new OfflineAudioContext(2, Math.floor(sampleRate * seconds), sampleRate);
        ctx = offline;
        try {
            buildGraph(offline.destination);
            master.gain.value = MASTER_LEVEL;
            scheduleUntil(newSession(moodName, seedText, 0), seconds);
        } finally {
            ({ ctx, master, reverb, noise } = saved);
        }
        return offline.startRendering();
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
        preview,
        isEnabled: () => enabled,
        moods: Object.keys(MOODS),
    };
})();
