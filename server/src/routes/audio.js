const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const Comic = require('../models/Comic');
const multer = require('multer');
const wordRecordingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PROJECTS_DIR = path.join(__dirname, '../../projects');
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// --- FFmpeg post-processing helpers ---

function buildFFmpegFilterChain(effects, sampleRate = 44100) {
  const filters = [];
  const preset = effects.preset || 'none';
  const sr = sampleRate;

  switch (preset) {
    case 'robot': {
      const freq = effects.intensity != null ? 20 + effects.intensity * 40 : 30;
      // Tremolo for ring-modulation effect, short echo for metallic quality, EQ boost for tinny resonance
      filters.push(`tremolo=f=${freq}:d=1`);
      filters.push('aecho=0.8:0.88:30:0.4');
      filters.push('equalizer=f=3000:t=q:w=2:g=8');
      break;
    }
    case 'pitch_up': {
      const semitones = effects.semitones != null ? effects.semitones : 4;
      const rate = Math.pow(2, semitones / 12);
      filters.push(`asetrate=${sr}*${rate.toFixed(6)}`);
      filters.push(`aresample=${sr}`);
      filters.push(`atempo=${(1 / rate).toFixed(6)}`);
      break;
    }
    case 'pitch_down': {
      const semitones = effects.semitones != null ? effects.semitones : 4;
      const rate = Math.pow(2, -semitones / 12);
      filters.push(`asetrate=${sr}*${rate.toFixed(6)}`);
      filters.push(`aresample=${sr}`);
      filters.push(`atempo=${(1 / rate).toFixed(6)}`);
      break;
    }
    case 'radio': {
      // Bandpass 300-3000Hz simulates AM radio, compressor evens dynamics
      filters.push('highpass=f=300');
      filters.push('lowpass=f=3000');
      filters.push('acompressor=threshold=0.1:ratio=4');
      filters.push('volume=1.5');
      break;
    }
    case 'echo': {
      const delay = effects.delayMs != null ? effects.delayMs : 200;
      const decay = effects.decay != null ? effects.decay : 0.5;
      filters.push(`aecho=0.8:0.9:${delay}:${decay}`);
      break;
    }
    case 'megaphone': {
      // Bandpass + bitcrusher distortion + hard compression = bullhorn
      filters.push('highpass=f=500');
      filters.push('lowpass=f=4000');
      filters.push('acrusher=bits=8:mix=0.5:mode=log:aa=1');
      filters.push('acompressor=threshold=0.1:ratio=9:attack=0.01:release=0.1');
      filters.push('volume=0.7');
      break;
    }
    case 'whisper': {
      // Cut low frequencies, boost remaining, add slight room ambiance
      filters.push('highpass=f=500');
      filters.push('lowpass=f=8000');
      filters.push('volume=1.8');
      filters.push('aecho=0.6:0.3:40:0.3');
      break;
    }
    case 'deep': {
      const rate = Math.pow(2, -3 / 12);
      filters.push(`asetrate=${sr}*${rate.toFixed(6)}`);
      filters.push(`aresample=${sr}`);
      filters.push(`atempo=${(1 / rate).toFixed(6)}`);
      filters.push('equalizer=f=200:t=q:w=1:g=6');
      filters.push('aecho=0.8:0.88:60:0.3');
      break;
    }
    case 'chipmunk': {
      const rate = Math.pow(2, 6 / 12);
      filters.push(`asetrate=${sr}*${rate.toFixed(6)}`);
      filters.push(`aresample=${sr}`);
      filters.push(`atempo=${(1 / rate).toFixed(6)}`);
      break;
    }
    default:
      break;
  }

  return filters;
}

async function getAudioSampleRate(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath
    ]);
    const info = JSON.parse(stdout);
    const audioStream = info.streams.find(s => s.codec_type === 'audio');
    return audioStream ? parseInt(audioStream.sample_rate) : 44100;
  } catch {
    return 44100;
  }
}

async function applyAudioEffects(inputPath, effects) {
  if (!effects || effects.preset === 'none') return;

  // Detect actual sample rate for pitch-shift effects
  const sampleRate = await getAudioSampleRate(inputPath);
  console.log(`Detected audio sample rate: ${sampleRate}Hz`);

  const filters = buildFFmpegFilterChain(effects, sampleRate);
  if (filters.length === 0) return;

  const outputPath = inputPath.replace('.mp3', '_fx.mp3');
  const filterChain = filters.join(',');

  console.log(`FFmpeg filter chain: ${filterChain}`);

  const { stderr } = await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-af', filterChain,
    '-y',
    outputPath
  ]);

  if (stderr) {
    console.log('FFmpeg stderr (last 500 chars):', stderr.substring(stderr.length - 500));
  }

  // Replace original with processed version
  await fs.rename(outputPath, inputPath);
}

function sanitizeWordForFilename(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/[.,!?;:"""''¿¡…\[\](){}\/\\]/g, '').trim().replace(/\s+/g, '_');
}

function collectUniqueWords(comic) {
  const wordMap = new Map(); // sanitized filename -> original text for TTS
  const allBubbles = [
    ...(comic.cover?.bubbles || []),
    ...(comic.pages || []).flatMap(p => p.bubbles || [])
  ];
  for (const bubble of allBubbles) {
    for (const sentence of bubble.sentences || []) {
      for (const word of sentence.words || []) {
        const text = sanitizeWordForFilename(word.text);
        const base = sanitizeWordForFilename(word.baseForm);
        if (text && !wordMap.has(text)) wordMap.set(text, word.text);
        if (base && !wordMap.has(base)) wordMap.set(base, word.baseForm);
        // Include word form texts
        for (const form of word.forms || []) {
          const formText = sanitizeWordForFilename(form.text);
          if (formText && !wordMap.has(formText)) wordMap.set(formText, form.text);
        }
      }
    }
  }
  return wordMap;
}

// Get available voices from ElevenLabs
router.get('/voices', async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(400).json({
        error: 'ElevenLabs API key not configured. Add ELEVENLABS_API_KEY to .env file.'
      });
    }

    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const data = await response.json();

    // Return simplified voice list
    const voices = data.voices.map(voice => ({
      voice_id: voice.voice_id,
      name: voice.name,
      category: voice.category,
      labels: voice.labels,
      preview_url: voice.preview_url
    }));

    res.json({ voices });
  } catch (error) {
    console.error('Failed to fetch voices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Browse the ElevenLabs community / shared voice library (thousands of voices).
// Search + language/gender/age filters are applied server-side by ElevenLabs.
router.get('/shared-voices', async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(400).json({ error: 'ElevenLabs API key not configured.' });
    }
    const { search = '', language = '', gender = '', age = '', accent = '', page = '0', page_size = '30' } = req.query;
    const params = new URLSearchParams();
    params.set('page_size', String(Math.min(Number(page_size) || 30, 100)));
    params.set('page', String(Number(page) || 0));
    if (search) params.set('search', search);
    if (language) params.set('language', language);
    if (gender) params.set('gender', gender);
    if (age) params.set('age', age);
    if (accent) params.set('accent', accent);

    const response = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${params.toString()}`, {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
    });
    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: `ElevenLabs API error: ${response.status} ${body}` });
    }
    const data = await response.json();
    const voices = (data.voices || []).map(v => ({
      voice_id: v.voice_id,
      public_owner_id: v.public_owner_id,
      name: v.name,
      preview_url: v.preview_url,
      language: v.language,
      accent: v.accent,
      gender: v.gender,
      age: v.age,
      descriptive: v.descriptive,
      use_case: v.use_case,
      category: v.category
    }));
    res.json({ voices, has_more: !!data.has_more });
  } catch (error) {
    console.error('Failed to fetch shared voices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a community/shared voice to the account library so it can be used for TTS.
// Returns the new voice_id minted in the account. Requires voices_write on the key.
router.post('/add-shared-voice', async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(400).json({ error: 'ElevenLabs API key not configured.' });
    }
    const { public_owner_id, voice_id, name } = req.body;
    if (!public_owner_id || !voice_id || !name) {
      return res.status(400).json({ error: 'public_owner_id, voice_id and name are required' });
    }
    const response = await fetch(`https://api.elevenlabs.io/v1/voices/add/${public_owner_id}/${voice_id}`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: name })
    });
    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: `ElevenLabs API error: ${response.status} ${body}` });
    }
    const data = await response.json();
    res.json({ voice_id: data.voice_id });
  } catch (error) {
    console.error('Failed to add shared voice:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available models
router.get('/models', async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(400).json({
        error: 'ElevenLabs API key not configured. Add ELEVENLABS_API_KEY to .env file.'
      });
    }

    const response = await fetch('https://api.elevenlabs.io/v1/models', {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const models = await response.json();

    // Filter to only TTS-capable models
    const ttsModels = models.filter(m => m.can_do_text_to_speech).map(m => ({
      model_id: m.model_id,
      name: m.name,
      description: m.description,
      languages: m.languages
    }));

    res.json({ models: ttsModels });
  } catch (error) {
    console.error('Failed to fetch models:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhance text with audio tags using OpenAI
router.post('/enhance', async (req, res) => {
  try {
    const { text, context } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
      });
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an audio director helping enhance text for text-to-speech.
Add audio tags in square brackets to make the speech more expressive and natural.

Available audio tags:
- Emotions: [excited], [sad], [angry], [happy], [fearful], [surprised], [disgusted], [contemptuous]
- Delivery: [whispers], [shouts], [laughs], [sighs], [gasps], [cries], [screams], [emphasise]
- Pacing: [pause], [slowly], [quickly]
- Actions: [clears throat], [sniffles], [yawns]

Rules:
1. Only add tags where they genuinely improve the delivery
2. Don't overuse tags - subtlety is key
3. Place tags before the words they should affect
4. Keep the original text intact, just add tags
5. Return ONLY the enhanced text, no explanations`;

    const userPrompt = context
      ? `Context: ${context}\n\nEnhance this text for TTS: "${text}"`
      : `Enhance this text for TTS: "${text}"`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 500
    });

    const enhancedText = completion.choices[0].message.content.trim();

    res.json({
      original: text,
      enhanced: enhancedText
    });
  } catch (error) {
    console.error('Failed to enhance text:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate TTS audio
router.post('/generate', async (req, res) => {
  try {
    const {
      text,
      voice_id,
      model_id = 'eleven_v3',
      stability = 0.5,
      similarity_boost = 0.75,
      style = 0.0,
      speed = 1.0,
      language_code,
      postProcessing
    } = req.body;

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(400).json({
        error: 'ElevenLabs API key not configured. Add ELEVENLABS_API_KEY to .env file.'
      });
    }

    if (!text || !voice_id) {
      return res.status(400).json({
        error: 'text and voice_id are required'
      });
    }

    console.log(`Generating audio: voice=${voice_id}, model=${model_id}, text="${text.substring(0, 50)}..."`);

    const requestBody = {
      text,
      model_id,
      voice_settings: {
        stability,
        similarity_boost,
        style,
        speed
      }
    };

    // Add language code if provided (useful for multilingual)
    if (language_code) {
      requestBody.language_code = language_code;
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/with-timestamps`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs error:', errorText);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const buffer = Buffer.from(data.audio_base64, 'base64');

    // Save to temp file
    const filename = `audio-${uuidv4()}.mp3`;
    const filePath = path.join(UPLOADS_DIR, filename);
    await fs.writeFile(filePath, buffer);

    // Apply post-processing effects if requested
    let effectApplied = null;
    if (postProcessing && postProcessing.preset && postProcessing.preset !== 'none') {
      try {
        console.log(`Applying audio effect: ${postProcessing.preset}`, JSON.stringify(postProcessing));
        await applyAudioEffects(filePath, postProcessing);
        // Re-read the processed file for base64 response
        const processedBuffer = await fs.readFile(filePath);
        data.audio_base64 = processedBuffer.toString('base64');
        effectApplied = postProcessing.preset;
        console.log(`Audio effect "${postProcessing.preset}" applied successfully`);
      } catch (ffmpegError) {
        console.error('FFmpeg post-processing failed:', ffmpegError.message);
        if (ffmpegError.stderr) console.error('FFmpeg stderr:', ffmpegError.stderr.substring(0, 1000));
        effectApplied = `FAILED: ${ffmpegError.message}`;
      }
    }

    // Convert character-level alignment to word-level timestamps
    let wordTimestamps = [];
    const alignment = data.normalized_alignment || data.alignment;
    if (alignment && alignment.characters) {
      const chars = alignment.characters;
      const starts = alignment.character_start_times_seconds;
      const ends = alignment.character_end_times_seconds;

      let wordStart = null;
      let currentWord = '';

      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === ' ' || ch === '\n' || ch === '\t') {
          if (currentWord) {
            wordTimestamps.push({
              word: currentWord,
              startMs: Math.round(wordStart * 1000),
              endMs: Math.round(ends[i - 1] * 1000)
            });
            currentWord = '';
            wordStart = null;
          }
        } else {
          if (wordStart === null) wordStart = starts[i];
          currentWord += ch;
        }
      }
      if (currentWord) {
        wordTimestamps.push({
          word: currentWord,
          startMs: Math.round(wordStart * 1000),
          endMs: Math.round(ends[chars.length - 1] * 1000)
        });
      }
    }

    console.log(`Generated ${wordTimestamps.length} word timestamps`);

    res.json({
      filename,
      path: `/uploads/${filename}`,
      base64: data.audio_base64,
      mimeType: 'audio/mpeg',
      text,
      voice_id,
      model_id,
      wordTimestamps,
      effectApplied
    });
  } catch (error) {
    console.error('Failed to generate audio:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save audio to project
router.post('/save-to-project', async (req, res) => {
  try {
    const { comicId, filename, audioName } = req.body;

    const sourcePath = path.join(UPLOADS_DIR, filename);
    const destDir = path.join(PROJECTS_DIR, comicId, 'audio');

    await fs.mkdir(destDir, { recursive: true });

    const newFilename = `${audioName}.mp3`;
    const destPath = path.join(destDir, newFilename);

    // Check if source temp file exists
    let sourceExists = true;
    try {
      await fs.access(sourcePath);
    } catch {
      sourceExists = false;
    }

    if (sourceExists) {
      await fs.copyFile(sourcePath, destPath);
      // Delete temp file after copying
      try {
        await fs.unlink(sourcePath);
      } catch (e) {
        // Ignore if can't delete
      }
    } else {
      // Source doesn't exist - check if dest already exists (already saved)
      try {
        await fs.access(destPath);
        // Dest exists, audio was already saved - return success
      } catch {
        // Neither source nor dest exists - need to regenerate audio
        return res.status(400).json({
          error: 'Audio file not found. Please regenerate the audio before saving.'
        });
      }
    }

    res.json({
      filename: newFilename,
      path: `/projects/${comicId}/audio/${newFilename}`
    });
  } catch (error) {
    console.error('Failed to save audio:', error);
    res.status(500).json({ error: error.message });
  }
});

// Translate text from one language to another
router.post('/translate', async (req, res) => {
  try {
    const { text, fromLanguage = 'en', toLanguage = 'es' } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
      });
    }

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const languageNames = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      ja: 'Japanese',
      ko: 'Korean',
      zh: 'Chinese'
    };

    const fromLang = languageNames[fromLanguage] || fromLanguage;
    const toLang = languageNames[toLanguage] || toLanguage;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.5',
      messages: [
        {
          role: 'system',
          content: `You are a translator. Translate the given ${fromLang} text to ${toLang}. Return ONLY the translated text, nothing else. Keep the same tone and style. If the text is dialogue, keep it natural and conversational.`
        },
        { role: 'user', content: text }
      ],
      max_completion_tokens: 500
    });

    const translated = completion.choices[0].message.content.trim();

    res.json({
      original: text,
      translated,
      fromLanguage,
      toLanguage
    });
  } catch (error) {
    console.error('Failed to translate:', error);
    res.status(500).json({ error: error.message });
  }
});

// Count unique words for word audio generation
router.post('/word-audio-count', async (req, res) => {
  try {
    const { comicId, forceRegenerate } = req.body;
    if (!comicId) return res.status(400).json({ error: 'comicId is required' });

    const comic = await Comic.findOne({ id: comicId });
    if (!comic) return res.status(404).json({ error: 'Comic not found' });

    const wordMap = collectUniqueWords(comic.toObject());
    const uniqueKeys = [...wordMap.keys()];
    const wordsDir = path.join(PROJECTS_DIR, comicId, 'audio', 'words');

    let alreadyGenerated = 0;
    if (!forceRegenerate) {
      try {
        const existingFiles = await fs.readdir(wordsDir);
        const existingSet = new Set(existingFiles.map(f => f.replace('.mp3', '')));
        alreadyGenerated = uniqueKeys.filter(w => existingSet.has(w)).length;
      } catch (e) {
        // Directory doesn't exist yet
      }
    }

    res.json({
      totalUnique: uniqueKeys.length,
      alreadyGenerated,
      toGenerate: uniqueKeys.length - alreadyGenerated
    });
  } catch (error) {
    console.error('Word audio count error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------- Word-audio audit & repair ----------

// Transcribe an audio buffer via OpenAI (same model the reader uses).
async function transcribeWordBufferOnce(buffer, name, model, lang = 'es') {
  const form = new FormData();
  form.append('model', model);
  form.append('language', lang);
  if (model === 'whisper-1' && lang === 'es') form.append('prompt', 'Una sola palabra en español.');
  form.append('file', new Blob([buffer]), name);
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!r.ok) throw new Error(`transcribe ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()).text || '').trim();
}

// gpt-4o-transcribe glitches on ultra-short clips (Cyrillic output, wrong
// language). When the result looks like a glitch, retry with whisper-1,
// which is steadier on single words.
async function transcribeWordBuffer(buffer, name = 'word.mp3') {
  const first = await transcribeWordBufferOnce(buffer, name, 'gpt-4o-transcribe');
  const looksGlitched = !first || first.length > 40 || /[^ -ɏḀ-ỿ]/.test(first);
  if (!looksGlitched) return first;
  try {
    const second = await transcribeWordBufferOnce(buffer, name, 'whisper-1');
    return second || first;
  } catch (e) {
    return first;
  }
}

const SPANISH_NUMS = {
  0: 'cero', 1: 'uno', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis',
  7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez', 11: 'once', 12: 'doce',
  13: 'trece', 14: 'catorce', 15: 'quince', 16: 'dieciseis', 17: 'diecisiete',
  18: 'dieciocho', 19: 'diecinueve', 20: 'veinte', 21: 'veintiuno',
  30: 'treinta', 40: 'cuarenta', 50: 'cincuenta', 60: 'sesenta', 70: 'setenta',
  80: 'ochenta', 90: 'noventa', 100: 'cien', 1000: 'mil',
};

function normalizeSpokenWord(s) {
  let t = (s || '').toLowerCase().trim();
  // Digits the transcriber may emit for number words.
  t = t.replace(/\d+/g, (d) => SPANISH_NUMS[parseInt(d, 10)] || d);
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zn]/g, '');
}

// Homophone-tolerant comparison: silent h, b/v, ll/y all sound identical in
// Spanish, so the transcriber's spelling choice must not count as a failure.
function spokenWordMatches(expected, heard) {
  const ne = normalizeSpokenWord(expected);
  const nh = normalizeSpokenWord(heard);
  if (!ne || !nh) return false;
  if (ne === nh) return true;
  // Phonetic folds for Spanish homophone spellings the transcriber may pick:
  // silent h, b/v, ll/y, k/c ("con"->"Kon"), qu/k ("que"->"ke"),
  // ce,ci/se,si (seseo), z/s, ge,gi/je,ji.
  const loose = (x) => x
    .replace(/h/g, '')
    .replace(/b/g, 'v')
    .replace(/ll/g, 'y')
    .replace(/qu/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/z/g, 's')
    .replace(/g(?=[ei])/g, 'j')
    .replace(/k/g, 'c');
  return loose(ne) === loose(nh);
}

// Detect speech segments in a word file via ffmpeg silencedetect. A clean
// single-word take is ONE utterance; extra bits before/after the word show
// up as additional segments separated by silence.
async function speechSegments(filePath) {
  let stderr = '';
  try {
    const out = await execFileAsync('ffmpeg', [
      '-i', filePath, '-af', 'silencedetect=noise=-32dB:d=0.22', '-f', 'null', '-',
    ]);
    stderr = out.stderr || '';
  } catch (e) {
    stderr = e.stderr || '';
  }
  const durMatch = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duration = durMatch
    ? (+durMatch[1]) * 3600 + (+durMatch[2]) * 60 + (+durMatch[3])
    : null;
  if (duration == null) return null;
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]);
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
  // Build speech segments from the silence intervals.
  const segs = [];
  let cursor = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] - cursor > 0.05) segs.push({ start: cursor, end: starts[i] });
    cursor = ends[i] != null ? ends[i] : duration;
  }
  if (duration - cursor > 0.05) segs.push({ start: cursor, end: duration });
  return { duration, segs };
}

// If the file contains more than one utterance, cut it down to the LONGEST
// one (the word), then verify the trim still says the word before replacing.
// Returns 'clean' | 'trimmed' | 'trim-failed' | 'skipped'.
async function trimExtraUtterances(filePath, expectedWord) {
  if (/\s/.test((expectedWord || '').trim())) return 'skipped';  // multi-word entries legitimately pause
  const info = await speechSegments(filePath);
  if (!info || info.segs.length <= 1) return 'clean';
  const main = info.segs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  const from = Math.max(0, main.start - 0.06);
  const to = Math.min(info.duration, main.end + 0.09);
  const tmpOut = filePath.replace(/\.mp3$/, `.trim-${Date.now()}.mp3`);
  try {
    await execFileAsync('ffmpeg', [
      '-i', filePath, '-ss', from.toFixed(3), '-to', to.toFixed(3),
      '-c:a', 'libmp3lame', '-b:a', '128k', '-y', tmpOut,
    ]);
    const heard = await transcribeWordBuffer(await fs.readFile(tmpOut), path.basename(filePath));
    if (spokenWordMatches(expectedWord, heard)) {
      await fs.rename(tmpOut, filePath);
      return 'trimmed';
    }
    await fs.unlink(tmpOut).catch(() => {});
    return 'trim-failed';
  } catch (e) {
    await fs.unlink(tmpOut).catch(() => {});
    return 'trim-failed';
  }
}

// Fresh ES->EN translation for the English-check report, so the author can
// compare what the Spanish MEANS against what the English audio SAYS.
async function translateSpanishToEnglish(text) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Translate the Spanish sentence to natural English. Reply with the translation only.' },
        { role: 'user', content: text },
      ],
      max_completion_tokens: 120,
    }),
  });
  if (!r.ok) throw new Error(`translate ${r.status}`);
  const d = await r.json();
  return (d.choices?.[0]?.message?.content || '').trim();
}

// POST /api/audio/audit-word-audio — transcribe every word file, flag files
// whose audio doesn't say the word (clipped onsets etc.), and (repair=true)
// regenerate failures with a verify loop. Streams NDJSON progress.
router.post('/audit-word-audio', async (req, res) => {
  try {
    const {
      comicId, voiceId, modelId = 'eleven_v3', repair = true,
      stability = 0.5, similarityBoost = 0.75, speed = 1.0, languageCode,
    } = req.body;
    if (!comicId) return res.status(400).json({ error: 'comicId is required' });
    if (repair && !voiceId) return res.status(400).json({ error: 'voiceId is required to repair' });
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OpenAI API key not configured.' });

    const comic = await Comic.findOne({ id: comicId });
    if (!comic) return res.status(404).json({ error: 'Comic not found' });

    const wordMap = collectUniqueWords(comic.toObject());
    const wordsDir = path.join(PROJECTS_DIR, comicId, 'audio', 'words');
    let files = [];
    try {
      files = (await fs.readdir(wordsDir)).filter(f => f.endsWith('.mp3'));
    } catch (e) {
      return res.status(404).json({ error: 'No word audio directory for this comic yet.' });
    }

    const audited = files.filter(f => wordMap.has(f.replace('.mp3', '')));
    const orphans = files.length - audited.length;

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const generateWordBuffer = async (text, attempt) => {
      // Attempt 2+ leads with an ellipsis: a silent beat that stops the model
      // clipping soft onsets (silent h / vowel starts — the "hiciste" bug).
      const trimmed = (text || '').trim();
      const punct = /[.!?…,;:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
      const ttsText = attempt >= 1 ? `… ${punct}` : punct;
      const body = {
        text: ttsText, model_id: modelId,
        voice_settings: { stability, similarity_boost: similarityBoost, speed },
      };
      if (languageCode) body.language_code = languageCode;
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return Buffer.from(await r.arrayBuffer());
    };

    let checked = 0, ok = 0, repaired = 0, errors = 0, trimmed = 0;
    const unresolved = [];
    const total = audited.length;
    console.log(`Word audit: ${total} files (${orphans} orphans skipped)${repair ? ', repair on' : ''}`);

    let numericSkipped = 0;
    for (const file of audited) {
      const fileKey = file.replace('.mp3', '');
      const expected = wordMap.get(fileKey);
      const filePath = path.join(wordsDir, file);
      checked++;
      // Pure-number "words" (years etc.) can't be verified — the transcriber
      // writes them out in words and our matcher can't map arbitrary numbers.
      if (/^\d+$/.test((expected || '').trim())) {
        numericSkipped++;
        ok++;
        continue;
      }
      try {
        const heard = await transcribeWordBuffer(await fs.readFile(filePath), file);
        if (spokenWordMatches(expected, heard)) {
          // Text matches — but the file may still carry a stray extra bit
          // before/after the word that the transcriber silently ignored.
          // Energy analysis catches that; trim to the main utterance.
          const t = await trimExtraUtterances(filePath, expected);
          if (t === 'trimmed') { trimmed++; }
          else if (t === 'trim-failed') { unresolved.push({ word: expected, fileKey, heard: 'extra audio detected — trim failed, listen manually' }); }
          ok++;
        } else if (!repair) {
          unresolved.push({ word: expected, fileKey, heard });
        } else {
          let fixed = false;
          let lastHeard = heard;
          for (let attempt = 0; attempt < 3 && !fixed; attempt++) {
            const buf = await generateWordBuffer(expected, attempt);
            const heardNew = await transcribeWordBuffer(buf, file);
            if (spokenWordMatches(expected, heardNew)) {
              await fs.writeFile(filePath, buf);
              // Fresh takes can carry stray extras too.
              const t = await trimExtraUtterances(filePath, expected);
              if (t === 'trimmed') trimmed++;
              repaired++;
              fixed = true;
            } else {
              lastHeard = heardNew;
            }
            await new Promise(r2 => setTimeout(r2, 250));
          }
          if (!fixed) unresolved.push({ word: expected, fileKey, heard: lastHeard });
          console.log(`  audit: "${expected}" heard "${heard}" -> ${fixed ? 'repaired' : 'UNRESOLVED'}`);
        }
      } catch (err) {
        errors++;
        unresolved.push({ word: expected, fileKey, heard: `ERROR: ${err.message.slice(0, 80)}` });
      }
      if (checked % 5 === 0 || checked === total) {
        res.write(JSON.stringify({ type: 'progress', checked, ok, repaired, trimmed, bad: unresolved.length, total, current: expected }) + '\n');
      }
      await new Promise(r2 => setTimeout(r2, 120));
    }

    res.write(JSON.stringify({ type: 'done', checked, ok, repaired, trimmed, errors, orphans, numericSkipped, unresolved: unresolved.slice(0, 50) }) + '\n');
    res.end();
    console.log(`Word audit done: ${ok} ok, ${repaired} repaired, ${unresolved.length} unresolved`);
  } catch (error) {
    console.error('Word audit error:', error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
    else { res.write(JSON.stringify({ type: 'error', error: error.message }) + '\n'); res.end(); }
  }
});

// POST /api/audio/regenerate-single-word — regenerate ONE word's audio file
// with the verify loop (generate -> transcribe -> keep only if it says the
// word; up to 3 attempts, later ones lead with a silent beat). If no attempt
// verifies, the last take is saved anyway and verified:false is returned.
router.post('/regenerate-single-word', async (req, res) => {
  try {
    const {
      comicId, voiceId, modelId = 'eleven_v3', word, ttsText,
      stability = 0.5, similarityBoost = 0.75, speed = 1.0, languageCode,
    } = req.body;
    if (!comicId || !voiceId || !word) {
      return res.status(400).json({ error: 'comicId, voiceId and word are required' });
    }
    const fileKey = sanitizeWordForFilename(word);
    if (!fileKey) return res.status(400).json({ error: 'word sanitizes to nothing' });
    const wordsDir = path.join(PROJECTS_DIR, comicId, 'audio', 'words');
    await fs.mkdir(wordsDir, { recursive: true });
    const filePath = path.join(wordsDir, `${fileKey}.mp3`);

    // ttsText lets the author shape delivery with ElevenLabs tags
    // ("[slowly] con") — the FILE is still named/verified by the word itself.
    const trimmed = ((ttsText || word) + '').trim();
    const punct = /[.!?…,;:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    let lastBuf = null, lastHeard = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = {
        text: attempt >= 1 ? `… ${punct}` : punct,
        model_id: modelId,
        voice_settings: { stability, similarity_boost: similarityBoost, speed },
      };
      if (languageCode) body.language_code = languageCode;
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
      lastBuf = Buffer.from(await r.arrayBuffer());
      try {
        lastHeard = await transcribeWordBuffer(lastBuf, `${fileKey}.mp3`);
        if (spokenWordMatches(word, lastHeard)) {
          await fs.writeFile(filePath, lastBuf);
          return res.json({ success: true, verified: true, heard: lastHeard, attempts: attempt + 1 });
        }
      } catch (e) {
        lastHeard = `ERROR: ${e.message.slice(0, 80)}`;
      }
    }
    await fs.writeFile(filePath, lastBuf);
    res.json({ success: true, verified: false, heard: lastHeard, attempts: 3 });
  } catch (error) {
    console.error('Single word regen error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/audio/word-audio-preview — generate a one-off ElevenLabs take
// (editable text, same voice setup as word generation) WITHOUT saving; the
// audio streams back for preview. Saving goes through word-audio-upload.
router.post('/word-audio-preview', async (req, res) => {
  try {
    const {
      voiceId, modelId = 'eleven_v3', text,
      stability = 0.5, similarityBoost = 0.75, speed = 1.0, languageCode,
    } = req.body;
    if (!voiceId || !text) return res.status(400).json({ error: 'voiceId and text are required' });
    const body = {
      text, model_id: modelId,
      voice_settings: { stability, similarity_boost: similarityBoost, speed },
    };
    if (languageCode) body.language_code = languageCode;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return res.status(502).json({ error: `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}` });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (error) {
    console.error('Word audio preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/audio/word-audio-upload — replace a word's audio with a manual
// recording from the browser (webm/mp4/whatever MediaRecorder produced);
// ffmpeg converts it to the mp3 the reader expects. Returns what the
// transcriber hears in the new take as a sanity check (informational only).
router.post('/word-audio-upload', wordRecordingUpload.single('audio'), async (req, res) => {
  try {
    const { comicId, fileKey, word } = req.body;
    if (!comicId || !fileKey || !req.file) {
      return res.status(400).json({ error: 'comicId, fileKey and audio file are required' });
    }
    if (fileKey.includes('/') || fileKey.includes('\\') || fileKey.includes('..')) {
      return res.status(400).json({ error: 'invalid fileKey' });
    }
    const wordsDir = path.join(PROJECTS_DIR, comicId, 'audio', 'words');
    await fs.mkdir(wordsDir, { recursive: true });

    const tmpIn = path.join(UPLOADS_DIR, `word-rec-${uuidv4()}`);
    const outPath = path.join(wordsDir, `${fileKey}.mp3`);
    await fs.writeFile(tmpIn, req.file.buffer);
    try {
      // Normalize loudness a touch and trim leading/trailing silence so a
      // hand recording sits comfortably next to the TTS words.
      await execFileAsync('ffmpeg', [
        '-i', tmpIn,
        '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=1:stop_threshold=-45dB,loudnorm=I=-18:TP=-2',
        '-ar', '44100', '-b:a', '128k',
        '-y', outPath,
      ]);
    } finally {
      await fs.unlink(tmpIn).catch(() => {});
    }

    // Sanity check: what does the transcriber hear?
    let heard = null, matches = null;
    try {
      heard = await transcribeWordBuffer(await fs.readFile(outPath), `${fileKey}.mp3`);
      if (word) matches = spokenWordMatches(word, heard);
    } catch (e) { /* informational only */ }

    res.json({ success: true, heard, matches });
  } catch (error) {
    console.error('Word audio upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate word audio for all unique words in a comic
router.post('/generate-word-audio', async (req, res) => {
  try {
    const {
      comicId,
      voiceId,
      modelId = 'eleven_v3',
      stability = 0.5,
      similarityBoost = 0.75,
      speed = 1.0,
      languageCode,
      forceRegenerate = false
    } = req.body;

    if (!comicId || !voiceId) {
      return res.status(400).json({ error: 'comicId and voiceId are required' });
    }
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(400).json({ error: 'ElevenLabs API key not configured.' });
    }

    const comic = await Comic.findOne({ id: comicId });
    if (!comic) return res.status(404).json({ error: 'Comic not found' });

    const wordMap = collectUniqueWords(comic.toObject());
    const uniqueKeys = [...wordMap.keys()];
    const wordsDir = path.join(PROJECTS_DIR, comicId, 'audio', 'words');
    await fs.mkdir(wordsDir, { recursive: true });

    // Check which files already exist
    let existingSet = new Set();
    if (!forceRegenerate) {
      try {
        const existingFiles = await fs.readdir(wordsDir);
        existingSet = new Set(existingFiles.map(f => f.replace('.mp3', '')));
      } catch (e) {}
    }

    // Stream progress as NDJSON to keep the connection alive
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    let total = uniqueKeys.length;

    console.log(`Word audio: ${total} unique words, ${existingSet.size} already on disk${forceRegenerate ? ' (force regenerate)' : ''}`);

    // The word inventory can GROW while this run generates (a Word Grammar
    // Forms pass finishing, a bubble text save adding words). One click must
    // cover everything, so after draining the queue we re-collect from the DB
    // and continue until the inventory is stable.
    const processed = new Set();
    let queue = uniqueKeys;
    let activeMap = wordMap;
    while (queue.length > 0) {
    for (const fileKey of queue) {
      processed.add(fileKey);
      if (existingSet.has(fileKey)) {
        skipped++;
        continue;
      }

      const originalText = activeMap.get(fileKey);
      try {
        // Append a period so ElevenLabs fully articulates the word ending. Bare
        // ultra-short words (e.g. "en", "un") otherwise get their trailing
        // consonant clipped. The period isn't spoken — it just gives a clean
        // falling intonation so the final sound isn't cut.
        const trimmedWord = (originalText || '').trim();
        const ttsText = /[.!?…,;:]$/.test(trimmedWord) ? trimmedWord : `${trimmedWord}.`;
        const requestBody = {
          text: ttsText,
          model_id: modelId,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            speed
          }
        };
        if (languageCode) requestBody.language_code = languageCode;

        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg'
            },
            body: JSON.stringify(requestBody)
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ElevenLabs ${response.status}: ${errorText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(path.join(wordsDir, `${fileKey}.mp3`), buffer);
        generated++;
        console.log(`  [${generated + skipped + failed}/${total}] Generated: ${originalText} -> ${fileKey}.mp3`);

        // Stream progress every word
        res.write(JSON.stringify({ type: 'progress', generated, skipped, failed, total, current: originalText }) + '\n');

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, 250));
      } catch (err) {
        failed++;
        errors.push({ word: originalText, error: err.message });
        console.error(`  Failed: ${originalText} - ${err.message}`);
        res.write(JSON.stringify({ type: 'progress', generated, skipped, failed, total, current: originalText }) + '\n');
      }
    }

    // Re-collect: anything added while we were generating?
    const freshComic = await Comic.findOne({ id: comicId });
    const freshMap = collectUniqueWords(freshComic.toObject());
    queue = [...freshMap.keys()].filter(k => !processed.has(k));
    if (queue.length > 0) {
      activeMap = freshMap;
      total += queue.length;
      console.log(`Word audio: inventory grew mid-run — ${queue.length} new word(s), continuing`);
      res.write(JSON.stringify({ type: 'progress', generated, skipped, failed, total, current: `+${queue.length} new words appeared — continuing` }) + '\n');
    }
    }

    console.log(`Word audio done: ${generated} generated, ${skipped} skipped, ${failed} failed`);

    // Final result line
    res.write(JSON.stringify({ type: 'done', generated, skipped, failed, errors: errors.slice(0, 10), totalFiles: generated + skipped }) + '\n');
    res.end();
  } catch (error) {
    console.error('Word audio generation error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(JSON.stringify({ type: 'error', error: error.message }) + '\n');
      res.end();
    }
  }
});

// Generate translation (English) audio for all sentences in a comic
// Audit: which bubbles are missing ENGLISH (translation) audio? Read-only —
// walks every page bubble (cover included), skipping sound effects / image
// bubbles, and reports sentences with no translation, no translationAudioUrl,
// or a URL whose file is missing on disk.
router.get('/english-audio-check/:comicId', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.comicId });
    if (!comic) return res.status(404).json({ error: 'Comic not found' });
    const audioDir = path.join(PROJECTS_DIR, req.params.comicId, 'audio');

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    // Fuzzy sentence comparison: [tags] aren't spoken; punctuation,
    // apostrophes and case are transcription noise; small wording drift
    // (contractions, number spelling) shouldn't flag a match failure.
    const normEn = (t) => (t || '')
      .replace(/\[[^\]]+\]/g, ' ')
      .toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const lev = (a, b) => {
      const m = a.length, n = b.length;
      if (!m) return n; if (!n) return m;
      let prev = Array.from({ length: n + 1 }, (_, i) => i);
      for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
      }
      return prev[n];
    };
    const matches = (expected, heard) => {
      const e = normEn(expected), h = normEn(heard);
      if (!e || !h) return false;
      if (e === h || e.includes(h) || h.includes(e)) return true;
      const d = lev(e, h);
      return 1 - d / Math.max(e.length, h.length) >= 0.82;
    };

    const missing = [];
    let checked = 0;
    const emit = () => res.write(JSON.stringify({ type: 'progress', checked, issues: missing.length }) + '\n');

    const checkBubbles = async (bubbles, pageLabel, pageId) => {
      for (const b of bubbles || []) {
        // Image bubbles CAN carry (invisible) sentences — check those too.
        if (b.isSoundEffect) continue;
        for (const sentence of b.sentences || []) {
          if (!sentence.text || !sentence.text.trim()) continue;
          checked++;
          const snippet = sentence.text.slice(0, 60);
          const entry = { page: pageLabel, pageId, bubbleId: b.id, text: snippet };
          const flag = async (extra) => {
            try { extra.spanishSays = await translateSpanishToEnglish(sentence.text); } catch (e) {}
            missing.push({ ...entry, ...extra });
          };
          if (!sentence.translation || !sentence.translation.trim()) {
            await flag({ issue: 'no English translation text' });
          } else if (!sentence.translationAudioUrl) {
            await flag({ issue: 'no English audio' });
          } else {
            const fname = path.basename(sentence.translationAudioUrl);
            // The stored URL is often extensionless — OpenAI infers the format
            // from the uploaded FILENAME, so it must carry .mp3.
            const mp3Name = fname.endsWith('.mp3') ? fname : `${fname}.mp3`;
            const filePath = path.join(audioDir, mp3Name);
            try {
              await fs.access(filePath);
              // File exists — does it actually SAY the translation?
              try {
                const buf = await fs.readFile(filePath);
                let heard = await transcribeWordBufferOnce(buf, mp3Name, 'gpt-4o-transcribe', 'en');
                if (!matches(sentence.translation, heard)) {
                  // Second opinion: short clips glitch gpt-4o-transcribe into
                  // gibberish/wrong languages. Only flag when whisper-1 also
                  // fails to match (and show its usually-cleaner transcript).
                  try {
                    const heard2 = await transcribeWordBufferOnce(buf, mp3Name, 'whisper-1', 'en');
                    if (matches(sentence.translation, heard2)) {
                      heard = null;   // false alarm — audio is fine
                    } else {
                      heard = heard2 || heard;
                    }
                  } catch (e2) { /* keep first transcript */ }
                  if (heard != null) {
                    await flag({ issue: "audio doesn't match translation", englishSays: (heard || '').slice(0, 140) });
                  }
                }
              } catch (e) {
                await flag({ issue: `transcription failed (${e.message.slice(0, 60)}) — re-run to retry` });
              }
            } catch {
              await flag({ issue: 'English audio file missing on disk' });
            }
          }
          if (checked % 5 === 0) emit();
        }
      }
    };

    await checkBubbles(comic.cover?.bubbles, 'Cover', null);
    for (const page of [...(comic.pages || [])].sort((a, b) => a.pageNumber - b.pageNumber)) {
      await checkBubbles(page.bubbles, `Page ${page.pageNumber}`, page.id);
    }

    res.write(JSON.stringify({ type: 'done', checked, missingCount: missing.length, missing }) + '\n');
    res.end();
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: error.message });
    else { res.write(JSON.stringify({ type: 'error', error: error.message }) + '\n'); res.end(); }
  }
});

// Bulk-clean ElevenLabs intonation [tags] out of ENGLISH translations. The
// tags stay in place while iterating on EN audio (regeneration needs them);
// run this once happy — mirrors what the bubble-text save does for Spanish.
router.post('/clean-english-tags/:comicId', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.comicId });
    if (!comic) return res.status(404).json({ error: 'Comic not found' });

    const strip = (t) => t.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    let cleaned = 0;
    const cleanBubbles = (bubbles) => {
      for (const b of bubbles || []) {
        for (const sentence of b.sentences || []) {
          if (sentence.translation && /\[[^\]]+\]/.test(sentence.translation)) {
            sentence.translation = strip(sentence.translation);
            cleaned++;
          }
        }
      }
    };
    cleanBubbles(comic.cover?.bubbles);
    for (const page of comic.pages || []) cleanBubbles(page.bubbles);

    if (cleaned > 0) {
      comic.markModified('pages');
      comic.markModified('cover');
      await comic.save();
    }
    res.json({ cleaned });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate-translation-audio', async (req, res) => {
  try {
    const {
      comicId,
      voiceId,
      modelId = 'eleven_v3',
      stability = 0.5,
      similarityBoost = 0.75,
      speed = 1.0,
      languageCode,
      forceRegenerate = false
    } = req.body;

    if (!comicId || !voiceId) {
      return res.status(400).json({ error: 'comicId and voiceId are required' });
    }
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(400).json({ error: 'ElevenLabs API key not configured.' });
    }

    const comic = await Comic.findOne({ id: comicId });
    if (!comic) return res.status(404).json({ error: 'Comic not found' });

    const comicObj = comic.toObject();
    const audioDir = path.join(PROJECTS_DIR, comicId, 'audio');
    await fs.mkdir(audioDir, { recursive: true });

    // Collect all sentences with translations
    const allBubbles = [
      ...(comicObj.cover?.bubbles || []),
      ...(comicObj.pages || []).flatMap(p => p.bubbles || [])
    ];

    const sentenceEntries = [];
    for (const bubble of allBubbles) {
      for (const sentence of bubble.sentences || []) {
        if (!sentence.translation || !sentence.audioUrl) continue;
        sentenceEntries.push({
          id: sentence.id,
          translation: sentence.translation,
          audioName: `${sentence.audioUrl}_en`,
          existingUrl: sentence.translationAudioUrl
        });
      }
    }

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    console.log(`Translation audio: ${sentenceEntries.length} sentences to process`);

    for (const entry of sentenceEntries) {
      // Skip if already has translation audio and not forcing
      if (!forceRegenerate && entry.existingUrl) {
        const existingPath = path.join(audioDir, `${entry.existingUrl}.mp3`);
        try {
          await fs.access(existingPath);
          skipped++;
          continue;
        } catch {
          // File doesn't exist, regenerate
        }
      }

      try {
        const requestBody = {
          text: entry.translation,
          model_id: modelId,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            speed
          }
        };
        if (languageCode) requestBody.language_code = languageCode;

        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg'
            },
            body: JSON.stringify(requestBody)
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ElevenLabs ${response.status}: ${errorText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(path.join(audioDir, `${entry.audioName}.mp3`), buffer);

        // Update sentence in DB
        await Comic.updateOne(
          { id: comicId, 'pages.bubbles.sentences.id': entry.id },
          { $set: { 'pages.$[].bubbles.$[].sentences.$[s].translationAudioUrl': entry.audioName } },
          { arrayFilters: [{ 's.id': entry.id }] }
        );
        // Also check cover bubbles
        await Comic.updateOne(
          { id: comicId, 'cover.bubbles.sentences.id': entry.id },
          { $set: { 'cover.bubbles.$[].sentences.$[s].translationAudioUrl': entry.audioName } },
          { arrayFilters: [{ 's.id': entry.id }] }
        );

        generated++;
        console.log(`  [${generated + skipped + failed}/${sentenceEntries.length}] Generated: ${entry.translation.substring(0, 40)}...`);

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, 250));
      } catch (err) {
        failed++;
        errors.push({ id: entry.id, error: err.message });
        console.error(`  Failed: ${entry.id} - ${err.message}`);
      }
    }

    console.log(`Translation audio done: ${generated} generated, ${skipped} skipped, ${failed} failed`);

    res.json({ generated, skipped, failed, errors: errors.slice(0, 10), total: sentenceEntries.length });
  } catch (error) {
    console.error('Translation audio generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete temp audio file
router.delete('/temp/:filename', async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    await fs.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
