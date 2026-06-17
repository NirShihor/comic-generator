// Text-to-speech for Flow Practice, using ElevenLabs (same provider/key as the
// comic narration) for natural, human-sounding voices. Reliable speed control
// via voice_settings.speed (0.7–1.2; <1 = slower). All knobs are env-tunable.
const TTS_VOICE_ID = process.env.FLOW_TTS_VOICE_ID || 'rDkIS117MFsZ9FVeK2Rx';
const TTS_MODEL = process.env.FLOW_TTS_MODEL || 'eleven_multilingual_v2';
const TTS_SPEED = parseFloat(process.env.FLOW_TTS_SPEED || '0.8');          // slower for beginners (ElevenLabs range 0.7–1.2)
const TTS_STABILITY = parseFloat(process.env.FLOW_TTS_STABILITY || '0.5');
const TTS_SIMILARITY = parseFloat(process.env.FLOW_TTS_SIMILARITY || '0.75');
const TTS_STYLE = parseFloat(process.env.FLOW_TTS_STYLE || '0.2');

/**
 * Synthesize speech and return MP3 bytes via ElevenLabs.
 * @returns {Promise<Buffer>}
 */
async function generateSpeech({ text, voiceId, speed } = {}) {
  if (!process.env.ELEVENLABS_API_KEY) {
    const err = new Error('ElevenLabs API key not configured. Add ELEVENLABS_API_KEY to .env file.');
    err.statusCode = 503;
    throw err;
  }
  const clean = (text || '').trim();
  if (!clean) {
    const err = new Error('text is required');
    err.statusCode = 400;
    throw err;
  }

  const vid = voiceId || TTS_VOICE_ID;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: clean.slice(0, 2000),
      model_id: TTS_MODEL,
      voice_settings: {
        stability: TTS_STABILITY,
        similarity_boost: TTS_SIMILARITY,
        style: TTS_STYLE,
        speed: speed || TTS_SPEED,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`ElevenLabs error ${response.status}: ${detail.slice(0, 300)}`);
    err.statusCode = response.status;
    throw err;
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Synthesize speech AND return character-level timing, for lip-sync. Uses
 * ElevenLabs' /with-timestamps endpoint, which returns the MP3 plus an
 * alignment of every character to its start/end time in the audio.
 * @returns {Promise<{audioBase64: string, alignment: object}>}
 */
async function generateSpeechTimed({ text, voiceId, speed } = {}) {
  if (!process.env.ELEVENLABS_API_KEY) {
    const err = new Error('ElevenLabs API key not configured. Add ELEVENLABS_API_KEY to .env file.');
    err.statusCode = 503;
    throw err;
  }
  const clean = (text || '').trim();
  if (!clean) {
    const err = new Error('text is required');
    err.statusCode = 400;
    throw err;
  }

  const vid = voiceId || TTS_VOICE_ID;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text: clean.slice(0, 2000),
      model_id: TTS_MODEL,
      voice_settings: {
        stability: TTS_STABILITY,
        similarity_boost: TTS_SIMILARITY,
        style: TTS_STYLE,
        speed: speed || TTS_SPEED,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`ElevenLabs error ${response.status}: ${detail.slice(0, 300)}`);
    err.statusCode = response.status;
    throw err;
  }

  const data = await response.json();
  // ElevenLabs returns { audio_base64, alignment: { characters,
  // character_start_times_seconds, character_end_times_seconds }, ... }.
  return { audioBase64: data.audio_base64, alignment: data.alignment };
}

module.exports = { generateSpeech, generateSpeechTimed, TTS_VOICE_ID, TTS_MODEL };
