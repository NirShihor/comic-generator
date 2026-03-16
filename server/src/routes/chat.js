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

module.exports = router;
