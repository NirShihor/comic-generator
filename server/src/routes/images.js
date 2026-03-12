const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({ storage });

// Upload image
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      filename: req.file.filename,
      path: `/uploads/${req.file.filename}`,
      originalName: req.file.originalname
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate image with AI
router.post('/generate', async (req, res) => {
  try {
    const { prompt, style, size = '1024x1536' } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
      });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Build the full prompt with style instructions
    const fullPrompt = `${prompt}. Style: ${style || 'comic book illustration, detailed ink drawing with dramatic lighting'}`;

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: fullPrompt,
      n: 1,
      size: size,
      quality: 'hd'
    });

    const imageUrl = response.data[0].url;

    // Download and save the image locally
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const filename = `generated-${uuidv4()}.png`;
    const filePath = path.join(__dirname, '../../uploads', filename);
    await fs.writeFile(filePath, buffer);

    res.json({
      filename,
      path: `/uploads/${filename}`,
      originalUrl: imageUrl,
      revisedPrompt: response.data[0].revised_prompt
    });
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate comic page using GPT-4o native image generation (same as ChatGPT)
router.post('/generate-page', async (req, res) => {
  try {
    const { prompt, size = '1024x1792' } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
      });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    console.log('Generating with GPT image model, prompt length:', prompt.length);

    // Use gpt-image-1 (native ChatGPT image generation)
    // Supported sizes: 1024x1024, 1024x1536, 1536x1024, auto
    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: prompt,
      n: 1,
      size: '1024x1536',
      quality: 'high'
    });

    // gpt-image-1 returns base64 by default
    const imageData = response.data[0];
    let buffer;

    if (imageData.b64_json) {
      buffer = Buffer.from(imageData.b64_json, 'base64');
    } else if (imageData.url) {
      const imageResponse = await fetch(imageData.url);
      const arrayBuffer = await imageResponse.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    const filename = `generated-${uuidv4()}.png`;
    const filePath = path.join(__dirname, '../../uploads', filename);
    await fs.writeFile(filePath, buffer);

    res.json({
      filename,
      path: `/uploads/${filename}`,
      revisedPrompt: imageData.revised_prompt || prompt
    });
  } catch (error) {
    console.error('Page generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save image to comic project
router.post('/save-to-project', async (req, res) => {
  try {
    const { comicId, filename, imageType, pageNumber } = req.body;

    const sourcePath = path.join(__dirname, '../../uploads', filename);
    const destDir = path.join(__dirname, '../../projects', comicId, 'images');

    await fs.mkdir(destDir, { recursive: true });

    const newFilename = imageType === 'cover'
      ? `${comicId}_cover.png`
      : `${comicId}_p${pageNumber}.png`;

    const destPath = path.join(destDir, newFilename);

    await fs.copyFile(sourcePath, destPath);

    res.json({
      filename: newFilename,
      path: `/projects/${comicId}/images/${newFilename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
