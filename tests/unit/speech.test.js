// speech.js picks a voice when it loads, so each test stubs the browser API first, then imports a fresh copy.
import { afterEach, describe, expect, it, vi } from 'vitest';

/** @param {{ voices?: { lang: string, name: string }[], withUtterance?: boolean }} [options] */
function stubSpeech({ voices = [], withUtterance = true } = {}) {
  const calls = [];
  /** @type {(() => void) | undefined} */
  let onVoicesChanged;
  let available = voices;
  const synth = {
    getVoices: () => available,
    addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn) => {
      if (type === 'voiceschanged') onVoicesChanged = fn;
    },
    cancel: () => calls.push('cancel'),
    speak: (/** @type {any} */ u) => calls.push(u),
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    withUtterance
      ? class {
          /** @param {string} text */
          constructor(text) {
            this.text = text;
          }
        }
      : undefined,
  );
  return {
    calls,
    /** @param {{ lang: string, name: string }[]} next */
    loadVoices(next) {
      available = next;
      onVoicesChanged?.();
    },
  };
}

async function freshSpeech() {
  vi.resetModules();
  return import('../../js/core/speech.js');
}

afterEach(() => vi.unstubAllGlobals());

describe('speech', () => {
  it('cancels anything still talking, then speaks at a gentle rate', async () => {
    const { calls } = stubSpeech({ voices: [{ lang: 'en-GB', name: 'UK' }] });
    const speech = await freshSpeech();
    speech.speak('Tap the star.');
    expect(calls[0]).toBe('cancel');
    expect(calls[1]).toMatchObject({ text: 'Tap the star.', lang: 'en-GB', rate: 0.9 });
    expect(calls[1].voice).toMatchObject({ name: 'UK' });
  });

  it('prefers a British voice, then any English voice', async () => {
    const { calls } = stubSpeech({ voices: [{ lang: 'fr-FR', name: 'FR' }, { lang: 'en-US', name: 'US' }] });
    const speech = await freshSpeech();
    speech.speak('Hi');
    expect(calls[1].voice).toMatchObject({ name: 'US' });
  });

  it('picks up voices that load late', async () => {
    const stub = stubSpeech({ voices: [] });
    const speech = await freshSpeech();
    stub.loadVoices([{ lang: 'en-GB', name: 'Late UK' }]);
    speech.speak('Hi');
    expect(stub.calls[1].voice).toMatchObject({ name: 'Late UK' });
  });

  it('copes if speech disappears before late voices arrive', async () => {
    const stub = stubSpeech({ voices: [{ lang: 'en-GB', name: 'UK' }] });
    await freshSpeech();
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => stub.loadVoices([])).not.toThrow();
  });

  it('falls back to en-GB with no voice when no English voice exists', async () => {
    const { calls } = stubSpeech({ voices: [{ lang: 'de-DE', name: 'DE' }] });
    const speech = await freshSpeech();
    speech.speak('Hi');
    expect(calls[1].lang).toBe('en-GB');
    expect(calls[1].voice).toBeUndefined();
  });

  it('says nothing for empty text', async () => {
    const { calls } = stubSpeech({ voices: [{ lang: 'en-GB', name: 'UK' }] });
    const speech = await freshSpeech();
    speech.speak('');
    expect(calls).toEqual([]);
  });

  it('reports no speech and does nothing when the browser lacks it', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const speech = await freshSpeech();
    expect(speech.canSpeak()).toBe(false);
    expect(() => speech.speak('Hi')).not.toThrow();
    expect(() => speech.stopSpeaking()).not.toThrow();
  });

  it('needs the utterance API too', async () => {
    stubSpeech({ withUtterance: false });
    const speech = await freshSpeech();
    expect(speech.canSpeak()).toBe(false);
    speech.speak('Hi'); // must not throw
  });

  it('stopSpeaking cancels', async () => {
    const { calls } = stubSpeech();
    const speech = await freshSpeech();
    speech.stopSpeaking();
    expect(calls).toEqual(['cancel']);
  });
});
