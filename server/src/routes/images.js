const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const sharp = require('sharp');

// Load reference images from disk, resize to reduce payload, and return as File objects
async function loadReferenceImages(imagePaths) {
  const files = [];
  for (const imgPath of imagePaths) {
    // imgPath is like /projects/comic-xxx/images/ref-xxx.png
    const fullPath = path.join(__dirname, '../..', imgPath);
    try {
      await fs.access(fullPath);
      // Resize to max 512px on longest side and convert to JPEG for smaller payload
      const resizedBuffer = await sharp(fullPath)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const filename = path.basename(fullPath, path.extname(fullPath)) + '.jpg';
      files.push(new File([resizedBuffer], filename, { type: 'image/jpeg' }));
    } catch (err) {
      console.log(`Reference image not found or resize failed, skipping: ${fullPath}`);
    }
  }
  return files;
}

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

// Generate image with AI (OpenAI)
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
    let fullPrompt = `${prompt}. Style: ${style || 'comic book illustration, detailed ink drawing with dramatic lighting'}`;

    // Truncate to stay within OpenAI's 32000 character limit
    if (fullPrompt.length > 32000) {
      console.log(`Prompt too long (${fullPrompt.length} chars), truncating to 32000`);
      fullPrompt = fullPrompt.substring(0, 32000);
    }

    console.log('Generating with OpenAI, prompt length:', fullPrompt.length);

    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: fullPrompt,
      n: 1,
      size: '1024x1536',
      quality: 'high'
    });

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
      path: `/uploads/${filename}`
    });
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate comic page using OpenAI
router.post('/generate-page', async (req, res) => {
  try {
    const { prompt, referenceImages } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
      });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Load reference images if provided
    const refStreams = referenceImages && referenceImages.length > 0
      ? await loadReferenceImages(referenceImages)
      : [];

    // Truncate prompt — use a lower limit when sending reference images
    // because the total multipart payload (images + prompt) has a size limit
    let finalPrompt = prompt;
    const maxPromptLen = 32000;
    if (finalPrompt.length > maxPromptLen) {
      console.log(`Page prompt too long (${finalPrompt.length} chars), truncating to ${maxPromptLen}`);
      finalPrompt = finalPrompt.substring(0, maxPromptLen);
    }

    console.log(`Generating page with OpenAI, prompt length: ${finalPrompt.length}, reference images: ${refStreams.length}`);

    let response;
    if (refStreams.length > 0) {
      response = await openai.images.edit({
        model: 'gpt-image-1',
        image: refStreams,
        prompt: finalPrompt,
        n: 1,
        size: '1024x1536',
        quality: 'high'
      });
    } else {
      response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: finalPrompt,
        n: 1,
        size: '1024x1536',
        quality: 'high'
      });
    }

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
      path: `/uploads/${filename}`
    });
  } catch (error) {
    console.error('Page generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate single panel image
router.post('/generate-panel', async (req, res) => {
  try {
    const { prompt, panelId, aspectRatio = 'square', referenceImages } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
      });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Choose size based on aspect ratio
    // OpenAI gpt-image-1 supports: 1024x1024, 1024x1536, 1536x1024
    let size = '1024x1024'; // default square
    if (aspectRatio === 'portrait') {
      size = '1024x1536';
    } else if (aspectRatio === 'landscape') {
      size = '1536x1024';
    }

    // Load reference images if provided
    const refStreams = referenceImages && referenceImages.length > 0
      ? await loadReferenceImages(referenceImages)
      : [];

    // Truncate prompt — use a lower limit when sending reference images
    // because the total multipart payload (images + prompt) has a size limit
    let finalPrompt = prompt;
    const maxPromptLen = 32000;
    if (finalPrompt.length > maxPromptLen) {
      console.log(`Panel prompt too long (${finalPrompt.length} chars), truncating to ${maxPromptLen}`);
      finalPrompt = finalPrompt.substring(0, maxPromptLen);
    }

    console.log(`Generating panel ${panelId}, aspect: ${aspectRatio}, size: ${size}, prompt length: ${finalPrompt.length}, reference images: ${refStreams.length}`);

    let response;
    if (refStreams.length > 0) {
      response = await openai.images.edit({
        model: 'gpt-image-1',
        image: refStreams,
        prompt: finalPrompt,
        n: 1,
        size: size,
        quality: 'high'
      });
    } else {
      response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: finalPrompt,
        n: 1,
        size: size,
        quality: 'high'
      });
    }

    const imageData = response.data[0];
    let buffer;

    if (imageData.b64_json) {
      buffer = Buffer.from(imageData.b64_json, 'base64');
    } else if (imageData.url) {
      const imageResponse = await fetch(imageData.url);
      const arrayBuffer = await imageResponse.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    const filename = `panel-${panelId}-${uuidv4()}.png`;
    const filePath = path.join(__dirname, '../../uploads', filename);
    await fs.writeFile(filePath, buffer);

    console.log(`Panel ${panelId} generated: ${filename}`);

    res.json({
      panelId,
      filename,
      path: `/uploads/${filename}`
    });
  } catch (error) {
    console.error('Panel generation error:', error);
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
      : imageType === 'cover-baked'
      ? `${comicId}_cover_baked.png`
      : imageType === 'baked'
      ? `${comicId}_p${pageNumber}_baked.png`
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

// Save a base64 reference image to a comic or collection project
router.post('/save-reference', async (req, res) => {
  try {
    const { comicId, collectionId, image } = req.body;
    if ((!comicId && !collectionId) || !image) {
      return res.status(400).json({ error: 'comicId or collectionId, and image (base64) are required' });
    }

    // Use collection path if collectionId is provided, otherwise comic path
    const projectFolder = collectionId
      ? path.join('collections', collectionId)
      : comicId;
    const destDir = path.join(__dirname, '../../projects', projectFolder, 'images');
    await fs.mkdir(destDir, { recursive: true });

    const filename = `ref-${uuidv4()}.png`;
    const destPath = path.join(destDir, filename);
    await fs.writeFile(destPath, Buffer.from(image, 'base64'));

    res.json({
      filename,
      path: `/projects/${projectFolder}/images/${filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
