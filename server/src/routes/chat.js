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
            detail: 'high'
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
    console.log('Calling OpenAI API with model gpt-5.4...');

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: openaiMessages,
      max_completion_tokens: 2000,
      temperature: 0.7
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
      max_completion_tokens: 200,
      temperature: 0.2
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

module.exports = router;
