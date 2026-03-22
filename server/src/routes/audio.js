const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const Comic = require('../models/Comic');

const PROJECTS_DIR = path.join(__dirname, '../../projects');
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

function sanitizeWordForFilename(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/[.,!?;:"""''¿¡…\[\](){}\/\\]/g, '').trim().replace(/\s+/g, '_');
}

function collectUniqueWords(comic) {
  const uniqueWords = new Set();
  const allBubbles = [
    ...(comic.cover?.bubbles || []),
    ...(comic.pages || []).flatMap(p => p.bubbles || [])
  ];
  for (const bubble of allBubbles) {
    for (const sentence of bubble.sentences || []) {
      for (const word of sentence.words || []) {
        const text = sanitizeWordForFilename(word.text);
        const base = sanitizeWordForFilename(word.baseForm);
        if (text) uniqueWords.add(text);
        if (base && base !== text) uniqueWords.add(base);
      }
    }
  }
  return [...uniqueWords];
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
- Delivery: [whispers], [shouts], [laughs], [sighs], [gasps], [cries], [screams]
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
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 500,
      temperature: 0.7
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
      language_code
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
      wordTimestamps
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
      model: 'gpt-5.4',
      messages: [
        {
          role: 'system',
          content: `You are a translator. Translate the given ${fromLang} text to ${toLang}. Return ONLY the translated text, nothing else. Keep the same tone and style. If the text is dialogue, keep it natural and conversational.`
        },
        { role: 'user', content: text }
      ],
      max_completion_tokens: 500,
      temperature: 0.3
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

    const uniqueWords = collectUniqueWords(comic.toObject());
    const wordsDir = path.join(PROJECTS_DIR, comicId, 'audio', 'words');

    let alreadyGenerated = 0;
    if (!forceRegenerate) {
      try {
        const existingFiles = await fs.readdir(wordsDir);
        const existingSet = new Set(existingFiles.map(f => f.replace('.mp3', '')));
        alreadyGenerated = uniqueWords.filter(w => existingSet.has(w)).length;
      } catch (e) {
        // Directory doesn't exist yet
      }
    }

    res.json({
      totalUnique: uniqueWords.length,
      alreadyGenerated,
      toGenerate: uniqueWords.length - alreadyGenerated
    });
  } catch (error) {
    console.error('Word audio count error:', error);
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

    const uniqueWords = collectUniqueWords(comic.toObject());
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

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    console.log(`Word audio: ${uniqueWords.length} unique words, ${existingSet.size} already on disk${forceRegenerate ? ' (force regenerate)' : ''}`);

    for (const word of uniqueWords) {
      if (existingSet.has(word)) {
        skipped++;
        continue;
      }

      try {
        const requestBody = {
          text: word,
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
        await fs.writeFile(path.join(wordsDir, `${word}.mp3`), buffer);
        generated++;
        console.log(`  [${generated + skipped + failed}/${uniqueWords.length}] Generated: ${word}`);

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, 250));
      } catch (err) {
        failed++;
        errors.push({ word, error: err.message });
        console.error(`  Failed: ${word} - ${err.message}`);
      }
    }

    console.log(`Word audio done: ${generated} generated, ${skipped} skipped, ${failed} failed`);

    res.json({ generated, skipped, failed, errors: errors.slice(0, 10), totalFiles: generated + skipped });
  } catch (error) {
    console.error('Word audio generation error:', error);
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
