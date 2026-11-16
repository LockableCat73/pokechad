/**
 * Chiptune sound effects, synthesised in the browser with square waves.
 * No audio files are shipped. The audio context is created on the first
 * sound, which always follows a tap or click, as browsers require.
 */

/** Each sound is a list of notes: [frequency in Hz, start in s, length in s]. */
const SOUNDS = {
  click: [[660, 0, 0.04]],
  start: [[523, 0, 0.07], [659, 0.07, 0.07], [784, 0.14, 0.12]],
  pause: [[587, 0, 0.07], [440, 0.08, 0.1]],
  resume: [[440, 0, 0.07], [587, 0.08, 0.1]],
  stop: [[784, 0, 0.07], [659, 0.07, 0.07], [523, 0.14, 0.14]],
  save: [[880, 0, 0.05], [1175, 0.06, 0.1]],
  warning: [[988, 0, 0.09], [988, 0.16, 0.09]],
  expired: [[392, 0, 0.12], [330, 0.13, 0.12], [262, 0.26, 0.25]],
  error: [[196, 0, 0.12], [185, 0.13, 0.16]],
  appear: [[196, 0, 0.08], [262, 0.09, 0.08], [196, 0.18, 0.08], [330, 0.27, 0.14]],
  throw: [[440, 0, 0.05], [554, 0.05, 0.05], [698, 0.1, 0.05], [880, 0.15, 0.05], [1109, 0.2, 0.08]],
  hit: [[147, 0, 0.06], [110, 0.06, 0.1]],
  caught: [[1319, 0, 0.05], [1760, 0.08, 0.14]],
  wobble: [[330, 0, 0.05], [262, 0.06, 0.05]],
  open: [[1047, 0, 0.04], [1319, 0.04, 0.04], [1568, 0.08, 0.08]],
  reward: [[523, 0, 0.09], [659, 0.1, 0.09], [784, 0.2, 0.09], [1047, 0.3, 0.26]],
  legendary: [
    [392, 0, 0.1], [523, 0.11, 0.1], [659, 0.22, 0.1], [784, 0.33, 0.1],
    [1047, 0.44, 0.14], [988, 0.6, 0.1], [1047, 0.72, 0.36],
  ],
  shiny: [[1568, 0, 0.05], [2093, 0.06, 0.05], [2637, 0.12, 0.05], [3136, 0.18, 0.16]],
};

/**
 * @param {() => boolean} isMuted Read on every play, so the mute toggle is live.
 * @returns {{play: (name: keyof typeof SOUNDS) => void}}
 */
export function createSfx(isMuted) {
  let context = null;

  function play(name) {
    const notes = SOUNDS[name];
    if (!notes || isMuted()) return;
    try {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctor) return;
      context = context || new Ctor();
      if (context.state === 'suspended') context.resume();
      const t0 = context.currentTime + 0.01;
      for (const [frequency, at, length] of notes) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'square';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.06, t0 + at);
        gain.gain.setValueAtTime(0.06, t0 + at + length * 0.7);
        gain.gain.linearRampToValueAtTime(0, t0 + at + length);
        osc.connect(gain).connect(context.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + length + 0.02);
      }
    } catch {
      /* sound is a nicety; never let it break the app */
    }
  }

  return { play };
}
