// Reads text aloud with the browser's built-in voice (D10). No audio files, no network.
// iOS only allows speech from inside a tap handler, so speak() must be called directly from the tap.

/** @type {SpeechSynthesisVoice | null} */
let voice = null;

function chooseVoice() {
  const synth = globalThis.speechSynthesis;
  if (!synth) return;
  const voices = synth.getVoices();
  voice =
    voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
}

if (globalThis.speechSynthesis) {
  chooseVoice();
  globalThis.speechSynthesis.addEventListener?.('voiceschanged', chooseVoice); // voices load late
}

/** @returns {boolean} */
export function canSpeak() {
  return Boolean(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance);
}

/**
 * @param {string} text
 */
export function speak(text) {
  const synth = globalThis.speechSynthesis;
  if (!synth || !globalThis.SpeechSynthesisUtterance || !text) return;
  synth.cancel(); // stop anything still talking, so repeated taps don't queue up
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang ?? 'en-GB';
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9;
  synth.speak(utterance);
}

export function stopSpeaking() {
  globalThis.speechSynthesis?.cancel();
}
