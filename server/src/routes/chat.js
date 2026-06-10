const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

// Chat with GPT-4 Vision
router.post('/message', async (req, res) => {
  try {
    const { messages, images } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Build the messages array for OpenAI
    const openaiMessages = [
      {
        role: 'system',
        content: 'You are a helpful assistant for a comic book creator. You can help with story ideas, character development, dialogue, art direction, and general creative assistance. When shown images of comic pages or panels, provide constructive feedback and suggestions.'
      }
    ];

    // Add conversation history
    for (const msg of messages.slice(0, -1)) {
      openaiMessages.push({
        role: msg.role,
        content: msg.content
      });
    }

    // Build the last user message with images if any
    const lastMessage = messages[messages.length - 1];
    if (images && images.length > 0) {
      const content = [];

      // Add text if present
      if (lastMessage.content) {
        content.push({ type: 'text', text: lastMessage.content });
      }

      // Add images
      for (const base64Image of images) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64Image}`,
            detail: 'auto'
          }
        });
      }

      openaiMessages.push({
        role: 'user',
        content
      });
    } else {
      openaiMessages.push({
        role: 'user',
        content: lastMessage.content
      });
    }

    console.log(`Chat request: ${messages.length} messages, ${images?.length || 0} images`);
    console.log('Calling OpenAI API with model gpt-5.5...');

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.5',
      messages: openaiMessages,
      max_completion_tokens: 16000
    });

    console.log('OpenAI API response received');
    console.log('Completion object:', JSON.stringify(completion.choices[0], null, 2).substring(0, 500));

    const responseMessage = completion.choices[0].message.content;
    console.log('Chat response message:', responseMessage ? responseMessage.substring(0, 100) + '...' : 'EMPTY');
    console.log('Response message type:', typeof responseMessage);
    console.log('Response message length:', responseMessage?.length || 0);

    res.json({
      message: responseMessage
    });
  } catch (error) {
    console.error('Chat error:', error.message);
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    res.status(500).json({ error: error.message });
  }
});

// Describe/refine a reference image for use in prompt settings
router.post('/describe-image', async (req, res) => {
  try {
    const { image, messages } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured.' });
    }

    if (!image) {
      return res.status(400).json({ error: 'image (base64) is required' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are a visual description specialist for comic book art direction. Your job is to produce detailed, precise descriptions of characters, objects, buildings, and scenes from reference images. These descriptions will be used as prompts for AI image generation, so they must be specific and consistent.

When describing a reference image, include:
- Physical appearance: build, proportions, distinguishing features
- Face: shape, expression defaults, notable features
- Hair: style, color, length, texture
- Clothing: every garment, colors, patterns, accessories
- Props or objects they carry
- Any notable style or artistic characteristics
- For buildings/objects: materials, colors, architectural style, condition, distinguishing details

Write in a direct, descriptive style. Use comma-separated visual tags where appropriate. Do not narrate or tell a story — just describe what you see in concrete visual terms suitable for image generation prompts.`;

    const openaiMessages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history (previous refinements)
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        if (msg.role === 'user' && msg.isInitial) {
          // First message includes the image
          openaiMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: msg.content },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${image}`, detail: 'high' } }
            ]
          });
        } else {
          openaiMessages.push({ role: msg.role, content: msg.content });
        }
      }
    } else {
      // First call — just the image with a default prompt
      openaiMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this reference image in detail for use in comic book art direction prompts.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${image}`, detail: 'high' } }
        ]
      });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.5',
      messages: openaiMessages,
      max_completion_tokens: 4000
    });

    res.json({ message: completion.choices[0].message.content });
  } catch (error) {
    console.error('Describe image error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Word lookup - get text, meaning, and baseForm for a clicked word or phrase
router.post('/word-lookup', async (req, res) => {
  try {
    const { selectedText, sentenceText, sentenceTranslation, sourceLanguage = 'es', targetLanguage = 'en' } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured.' });
    }

    if (!selectedText || !sentenceText) {
      return res.status(400).json({ error: 'selectedText and sentenceText are required' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const languageNames = {
      en: 'English', es: 'Spanish', fr: 'French', de: 'German',
      it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese'
    };

    const sourceLang = languageNames[sourceLanguage] || sourceLanguage;
    const targetLang = languageNames[targetLanguage] || targetLanguage;

    const isSourceLanguage = sentenceText.includes(selectedText);

    let prompt;
    if (isSourceLanguage) {
      prompt = `The ${sourceLang} sentence is: "${sentenceText}"
The ${targetLang} translation is: "${sentenceTranslation || ''}"

The user clicked on: "${selectedText}" (from the ${sourceLang} sentence)

Return a JSON object with:
- "text": the ${sourceLang} word/phrase exactly as it appears in the sentence (with any punctuation)
- "meaning": the ${targetLang} meaning of this word/phrase in this context
- "baseForm": the dictionary/base form of the ${sourceLang} word (lowercase, no punctuation). For verbs use the infinitive, for nouns use the singular, for adjectives use the masculine singular.

Return ONLY the JSON object, no other text.`;
    } else {
      prompt = `The ${sourceLang} sentence is: "${sentenceText}"
The ${targetLang} translation is: "${sentenceTranslation || ''}"

The user clicked on: "${selectedText}" (from the ${targetLang} translation)

Find the corresponding ${sourceLang} word(s) in the original sentence.

Return a JSON object with:
- "text": the corresponding ${sourceLang} word/phrase as it appears in the sentence (with any punctuation)
- "meaning": the ${targetLang} meaning (which should include or relate to "${selectedText}")
- "baseForm": the dictionary/base form of the ${sourceLang} word (lowercase, no punctuation). For verbs use the infinitive, for nouns use the singular, for adjectives use the masculine singular.

Return ONLY the JSON object, no other text.`;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise language assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 200
    });

    const responseText = completion.choices[0].message.content.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse word lookup response' });
    }

    const wordData = JSON.parse(jsonMatch[0]);
    res.json(wordData);
  } catch (error) {
    console.error('Word lookup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Batch word lookup - get meaning + baseForm for all words in a sentence
router.post('/batch-word-lookup', async (req, res) => {
  try {
    const { words, sentenceText, sentenceTranslation, sourceLanguage = 'es', targetLanguage = 'en' } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured.' });
    }

    if (!words || !words.length || !sentenceText) {
      return res.status(400).json({ error: 'words array and sentenceText are required' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const languageNames = {
      en: 'English', es: 'Spanish', fr: 'French', de: 'German',
      it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese'
    };

    const sourceLang = languageNames[sourceLanguage] || sourceLanguage;
    const targetLang = languageNames[targetLanguage] || targetLanguage;

    const prompt = `Given this ${sourceLang} sentence: "${sentenceText}"
Translation: "${sentenceTranslation || ''}"

For each word below, provide the ${targetLang} meaning in this context, its dictionary base form (infinitive for verbs, singular for nouns, masculine singular for adjectives), and whether it is a proper noun (name of a person, place, pet, or any other proper name).

Words: ${words.join(', ')}

Return a JSON array with one entry per word in the same order: [{ "text": "word", "meaning": "english meaning", "baseForm": "base form", "isName": false }, ...]
Set "isName": true for any proper nouns (people, places, pets, brands, etc.).
Return ONLY the JSON array, no other text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise language assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 1000
    });

    const responseText = completion.choices[0].message.content.trim();
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse batch word lookup response' });
    }

    const wordDataArray = JSON.parse(jsonMatch[0]);
    res.json(wordDataArray);
  } catch (error) {
    console.error('Batch word lookup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Generate grammar transformations for a sentence
router.post('/generate-transformations', async (req, res) => {
  try {
    const { sentenceText, sentenceTranslation, sourceLanguage = 'es', targetLanguage = 'en' } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured.' });
    }

    if (!sentenceText || !sentenceTranslation) {
      return res.status(400).json({ error: 'sentenceText and sentenceTranslation are required' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const languageNames = {
      en: 'English', es: 'Spanish', fr: 'French', de: 'German',
      it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese'
    };

    const sourceLang = languageNames[sourceLanguage] || sourceLanguage;
    const targetLang = languageNames[targetLanguage] || targetLanguage;

    const prompt = `Given this ${sourceLang} sentence: "${sentenceText}"
Translation: "${sentenceTranslation}"

Generate 3-5 grammar transformations of this sentence. Each transformation should change one or two grammatical aspects to create a useful language exercise. Vary the types of changes across transformations.

Types of changes to consider:
- Tense: present → preterite, imperfect, future, conditional
- Person: I → he/she, you, we, they
- Mood: indicative → subjunctive, imperative
- Polarity: affirmative → negative
- Combined changes (e.g. different person + different tense)

Important:
- Each transformation must be a complete, grammatically correct ${sourceLang} sentence
- When changing person, update ALL parts that depend on it (verb conjugations, pronouns, reflexive pronouns, possessives)
- If the sentence is too simple (single word, interjection, sound effect), return an empty array []
- Order from simpler changes to more complex ones

For each transformation provide:
- "prompt": the ${targetLang} translation (this is shown as the cue to the learner)
- "text": the transformed ${sourceLang} sentence (this is the answer)

Return a JSON array: [{ "prompt": "english cue", "text": "spanish answer" }, ...]
Return ONLY the JSON array, no other text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise language teaching assistant specializing in grammar. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 1000
    });

    const responseText = completion.choices[0].message.content.trim();
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse transformations response' });
    }

    const transformations = JSON.parse(jsonMatch[0]);
    res.json(transformations);
  } catch (error) {
    console.error('Generate transformations error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Fill missing word meanings + base forms across entire comic
router.post('/fill-missing-meanings', async (req, res) => {
  try {
    const { comicId } = req.body;
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured.' });
    }
    if (!comicId) {
      return res.status(400).json({ error: 'comicId is required' });
    }

    const Comic = require('../models/Comic');
    const comic = await Comic.findOne({ id: comicId });
    if (!comic) return res.status(404).json({ error: 'Comic not found' });

    const language = comic.language || 'es';
    const targetLanguage = comic.targetLanguage || 'en';
    const languageNames = {
      en: 'English', es: 'Spanish', fr: 'French', de: 'German',
      it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese'
    };
    const sourceLang = languageNames[language] || language;
    const targetLang = languageNames[targetLanguage] || targetLanguage;

    // Stream progress
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const comicObj = comic.toObject();

    // Collect all sentences that have words with missing meanings
    const sentencesToFix = [];
    function collectSentences(bubbles, location) {
      for (const bubble of bubbles || []) {
        for (const sentence of bubble.sentences || []) {
          const wordsNeedingMeaning = (sentence.words || []).filter(w => w.text && (!w.meaning || !w.baseForm));
          if (wordsNeedingMeaning.length > 0) {
            sentencesToFix.push({ sentence, bubble, location, wordsToFix: wordsNeedingMeaning });
          }
        }
      }
    }

    collectSentences(comicObj.cover?.bubbles, 'cover');
    for (const page of comicObj.pages || []) {
      collectSentences(page.bubbles, `page-${page.pageNumber}`);
      for (const panel of page.panels || []) {
        collectSentences(panel.bubbles, `page-${page.pageNumber}-panel-${panel.panelOrder}`);
      }
    }

    if (sentencesToFix.length === 0) {
      res.write(JSON.stringify({ type: 'done', fixed: 0, total: 0, message: 'All words already have meanings' }) + '\n');
      res.end();
      return;
    }

    let totalFixed = 0;
    for (let i = 0; i < sentencesToFix.length; i++) {
      const { sentence, wordsToFix } = sentencesToFix[i];
      const wordTexts = wordsToFix.map(w => w.text);

      try {
        const prompt = `Given this ${sourceLang} sentence: "${sentence.text}"
Translation: "${sentence.translation || ''}"

For each word below, provide the ${targetLang} meaning in this context, its dictionary base form (infinitive for verbs, singular for nouns, masculine singular for adjectives), and whether it is a proper noun (name of a person, place, pet, or any other proper name).

Words: ${wordTexts.join(', ')}

Return a JSON array with one entry per word in the same order: [{ "text": "word", "meaning": "english meaning", "baseForm": "base form", "isName": false }, ...]
Set "isName": true for any proper nouns (people, places, pets, brands, etc.).
Return ONLY the JSON array, no other text.`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a precise language assistant. Always respond with valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          max_completion_tokens: 2000
        });

        const responseText = completion.choices[0].message.content.trim();
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const wordDataArray = JSON.parse(jsonMatch[0]);
          for (const wd of wordDataArray) {
            const target = wordsToFix.find(w => w.text.toLowerCase() === wd.text?.toLowerCase());
            if (target) {
              if (wd.meaning) target.meaning = wd.meaning;
              if (wd.baseForm) target.baseForm = wd.baseForm;
              totalFixed++;
            }
          }
        }
      } catch (err) {
        console.error(`Fill meanings error for sentence "${sentence.text?.substring(0, 40)}":`, err.message);
      }

      res.write(JSON.stringify({ type: 'progress', current: i + 1, total: sentencesToFix.length, fixed: totalFixed }) + '\n');

      if (i + 1 < sentencesToFix.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Save
    await Comic.updateOne(
      { id: comicId },
      { $set: { pages: comicObj.pages, ...(comicObj.cover && { cover: comicObj.cover }) } }
    );

    console.log(`Fill missing meanings: fixed ${totalFixed} words across ${sentencesToFix.length} sentences`);
    res.write(JSON.stringify({ type: 'done', fixed: totalFixed, total: sentencesToFix.length }) + '\n');
    res.end();
  } catch (error) {
    console.error('Fill missing meanings error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(JSON.stringify({ type: 'error', error: error.message }) + '\n');
      res.end();
    }
  }
});

// Generate grammatical forms for all words in a comic (batch)
router.post('/generate-word-forms', async (req, res) => {
  try {
    const { comicId, forceRegenerate = false } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured.' });
    }
    if (!comicId) {
      return res.status(400).json({ error: 'comicId is required' });
    }

    const Comic = require('../models/Comic');
    const comic = await Comic.findOne({ id: comicId });
    if (!comic) return res.status(404).json({ error: 'Comic not found' });

    const language = comic.language || 'es';
    const targetLanguage = comic.targetLanguage || 'en';
    const languageNames = {
      en: 'English', es: 'Spanish', fr: 'French', de: 'German',
      it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese'
    };
    const sourceLang = languageNames[language] || language;
    const targetLang = languageNames[targetLanguage] || targetLanguage;

    // Collect unique base forms with their meanings
    const baseFormMap = new Map(); // baseForm -> { meaning, wordType hint }
    const allBubbles = [
      ...(comic.cover?.bubbles || []),
      ...(comic.pages || []).flatMap(p => [
        ...(p.bubbles || []),
        ...(p.panels || []).flatMap(panel => panel.bubbles || [])
      ])
    ];

    for (const bubble of allBubbles) {
      for (const sentence of bubble.sentences || []) {
        for (const word of sentence.words || []) {
          const base = (word.baseForm || word.text || '').toLowerCase().trim();
          if (!base) continue;
          if (!forceRegenerate && word.forms && word.forms.length > 0) continue;
          if (!baseFormMap.has(base)) {
            baseFormMap.set(base, { meaning: word.meaning || '', text: word.text || '' });
          }
        }
      }
    }

    if (baseFormMap.size === 0) {
      return res.json({ generated: 0, skipped: 0, message: 'All words already have forms' });
    }

    // Stream progress as NDJSON to keep the connection alive
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    // Process in chunks of 20 to keep GPT responses manageable
    const entries = [...baseFormMap.entries()];
    const chunkSize = 20;
    const totalChunks = Math.ceil(entries.length / chunkSize);
    const allForms = new Map();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunkIndex = Math.floor(i / chunkSize) + 1;
      const chunk = entries.slice(i, i + chunkSize);
      const wordList = chunk.map(([base, info]) => `${base} (${info.meaning})`).join('\n');

      const prompt = `For each ${sourceLang} word below, generate its key grammatical forms. The ${targetLang} meaning is provided for context.

For VERBS, provide these forms (all in first person singular "yo" unless noted):
- Present: (yo form)
- Preterite: (yo form)
- Imperfect: (yo form)
- Future: (yo form)
- Conditional: (yo form)
- Subjunctive: (yo present subjunctive)
- Command: (tú imperative)
- Gerund: (-ando/-iendo form)
- Past Participle: (-ado/-ido form)

For ADJECTIVES, provide: Masc. sing., Fem. sing., Masc. plural, Fem. plural

For NOUNS, provide: Singular, Plural (and if the noun has a gendered form, include both masculine and feminine)

For ARTICLES and DETERMINERS (el/la/un/una/los/las/etc.), provide: Masc. sing., Fem. sing., Masc. plural, Fem. plural

For ADVERBS, PREPOSITIONS, or other truly invariable words: return an empty array.

Words:
${wordList}

Return a JSON object where each key is the base form (lowercase) and the value is an array of { "label": "form name", "text": "word form" }.
Example: { "esconder": [{ "label": "Present", "text": "escondo" }, { "label": "Preterite", "text": "escondí" }, ...], "alto": [{ "label": "Masc. sing.", "text": "alto" }, ...], "siempre": [] }

Return ONLY the JSON object, no other text.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a precise language assistant. Always respond with valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        max_completion_tokens: 4000
      });

      const responseText = completion.choices[0].message.content.trim();
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        for (const [base, forms] of Object.entries(parsed)) {
          if (Array.isArray(forms) && forms.length > 0) {
            allForms.set(base.toLowerCase(), forms);
          }
        }
      }

      // Stream progress after each chunk
      res.write(JSON.stringify({ type: 'progress', chunk: chunkIndex, totalChunks, wordsProcessed: Math.min(i + chunkSize, entries.length), totalWords: entries.length }) + '\n');

      // Small delay between chunks
      if (i + chunkSize < entries.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Write forms back to all matching words in the comic
    let updated = 0;
    const comicObj = comic.toObject();

    function applyForms(bubbles) {
      for (const bubble of bubbles || []) {
        for (const sentence of bubble.sentences || []) {
          for (const word of sentence.words || []) {
            if (!forceRegenerate && word.forms && word.forms.length > 0) continue;
            const base = (word.baseForm || word.text || '').toLowerCase().trim();
            const forms = allForms.get(base);
            if (forms) {
              word.forms = forms;
              updated++;
            }
          }
        }
      }
    }

    applyForms(comicObj.cover?.bubbles);
    for (const page of comicObj.pages || []) {
      applyForms(page.bubbles);
      for (const panel of page.panels || []) {
        applyForms(panel.bubbles);
      }
    }

    // Save with atomic update
    await Comic.updateOne(
      { id: comicId },
      { $set: { pages: comicObj.pages, ...(comicObj.cover && { cover: comicObj.cover }) } }
    );

    console.log(`Word forms: generated for ${allForms.size} base forms, updated ${updated} word instances`);
    res.write(JSON.stringify({ type: 'done', generated: allForms.size, updated, total: baseFormMap.size }) + '\n');
    res.end();
  } catch (error) {
    console.error('Generate word forms error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(JSON.stringify({ type: 'error', error: error.message }) + '\n');
      res.end();
    }
  }
});

module.exports = router;
