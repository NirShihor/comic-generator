const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');

// Generate image using Gemini API
async function generateWithGemini(prompt, styleRefPaths = [], linkedRefPaths = []) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured. Add GEMINI_API_KEY to .env file.');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Build content parts: linked panel images first, then style refs, then prompt
  const parts = [];
  let linkedCount = 0;
  let styleCount = 0;

  // Add linked panel reference images (continuity refs - user prompt controls usage)
  for (const imgPath of linkedRefPaths) {
    const fullPath = path.join(__dirname, '../..', imgPath);
    try {
      await fs.access(fullPath);
      const resizedBuffer = await sharp(fullPath)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: resizedBuffer.toString('base64')
        }
      });
      linkedCount++;
    } catch (err) {
      console.log(`Gemini: linked ref image not found, skipping: ${fullPath}`);
    }
  }

  // Add style/character reference images
  for (const imgPath of styleRefPaths) {
    const fullPath = path.join(__dirname, '../..', imgPath);
    try {
      await fs.access(fullPath);
      const resizedBuffer = await sharp(fullPath)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: resizedBuffer.toString('base64')
        }
      });
      styleCount++;
    } catch (err) {
      console.log(`Gemini: style ref image not found, skipping: ${fullPath}`);
    }
  }

  // Add the text prompt with appropriate reference image instructions
  let textPrompt = prompt;
  if (styleCount > 0) {
    const styleNote = `IMPORTANT: ${styleCount} of the attached image(s) are STYLE and CHARACTER REFERENCES ONLY. Do NOT reproduce or copy these images. Use them ONLY to match the art style, character appearance, and visual consistency. Generate a COMPLETELY NEW and ORIGINAL scene based on the prompt below.`;
    textPrompt = `${styleNote}\n\n${prompt}`;
  }
  parts.push({ text: textPrompt });

  console.log(`Gemini: generating with ${linkedCount} linked refs + ${styleCount} style refs, prompt length: ${prompt.length}`);

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: parts,
    config: {
      responseModalities: ['IMAGE'],
    }
  });

  const candidate = response.candidates[0];

  if (!candidate || !candidate.content || !candidate.content.parts) {
    throw new Error('Gemini returned no image data');
  }

  // Find the image part in the response
  for (const part of candidate.content.parts) {
    if (part.inlineData) {
      return Buffer.from(part.inlineData.data, 'base64');
    }
  }

  throw new Error('Gemini response contained no image');
}

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

// Load reference images with heavy blur — for OpenAI linked panel refs.
// The blur strips compositional detail so images.edit() can't just reproduce
// the layout, but preserves color palette, lighting, and general style.
async function loadBlurredReferenceImages(imagePaths) {
  const files = [];
  for (const imgPath of imagePaths) {
    const fullPath = path.join(__dirname, '../..', imgPath);
    try {
      await fs.access(fullPath);
      const resizedBuffer = await sharp(fullPath)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .blur(8)
        .jpeg({ quality: 70 })
        .toBuffer();
      const filename = path.basename(fullPath, path.extname(fullPath)) + '-blur.jpg';
      files.push(new File([resizedBuffer], filename, { type: 'image/jpeg' }));
    } catch (err) {
      console.log(`Blurred ref image not found or failed, skipping: ${fullPath}`);
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

// Generate image with AI (OpenAI or Gemini)
router.post('/generate', async (req, res) => {
  try {
    const { prompt, style, size = '1024x1536', provider = 'openai' } = req.body;

    // Build the full prompt with style instructions
    let fullPrompt = `${prompt}. Style: ${style || 'comic book illustration, detailed ink drawing with dramatic lighting'}`;

    let buffer;

    if (provider === 'gemini') {
      buffer = await generateWithGemini(fullPrompt, [], []);
    } else {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({
          error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
        });
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
      if (imageData.b64_json) {
        buffer = Buffer.from(imageData.b64_json, 'base64');
      } else if (imageData.url) {
        const imageResponse = await fetch(imageData.url);
        const arrayBuffer = await imageResponse.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }
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

// Generate comic page using OpenAI or Gemini
router.post('/generate-page', async (req, res) => {
  try {
    const { prompt, referenceImages, provider = 'openai' } = req.body;

    let finalPrompt = prompt;
    let buffer;

    if (provider === 'gemini') {
      // generate-page only has style refs (no per-panel linked refs)
      buffer = await generateWithGemini(finalPrompt, referenceImages || [], []);
    } else {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({
          error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
        });
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Load reference images if provided
      const refStreams = referenceImages && referenceImages.length > 0
        ? await loadReferenceImages(referenceImages)
        : [];

      const maxPromptLen = 32000;
      if (finalPrompt.length > maxPromptLen) {
        console.log(`Page prompt too long (${finalPrompt.length} chars), truncating to ${maxPromptLen}`);
        finalPrompt = finalPrompt.substring(0, maxPromptLen);
      }

      console.log(`Generating page with OpenAI, prompt length: ${finalPrompt.length}, reference images: ${refStreams.length}`);

      let response;
      if (refStreams.length > 0) {
        const refPrompt = `IMPORTANT: The attached image(s) are STYLE and CHARACTER REFERENCES ONLY. Do NOT reproduce or copy these images. Use them ONLY to match the art style, character appearance, and visual consistency. Generate a COMPLETELY NEW and ORIGINAL scene based on the prompt below.\n\n${finalPrompt}`;
        response = await openai.images.edit({
          model: 'gpt-image-1',
          image: refStreams,
          prompt: refPrompt,
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
      if (imageData.b64_json) {
        buffer = Buffer.from(imageData.b64_json, 'base64');
      } else if (imageData.url) {
        const imageResponse = await fetch(imageData.url);
        const arrayBuffer = await imageResponse.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }
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

// Generate single panel image (OpenAI or Gemini)
router.post('/generate-panel', async (req, res) => {
  try {
    const { prompt, panelId, aspectRatio = 'square', referenceImages, linkedPanelImages, isRefinement, provider = 'openai' } = req.body;

    const styleRefs = referenceImages || [];
    const linkedRefs = linkedPanelImages || [];

    let finalPrompt = prompt;
    let buffer;

    if (provider === 'gemini') {
      buffer = await generateWithGemini(finalPrompt, styleRefs, linkedRefs);
      console.log(`Panel ${panelId} generated with Gemini`);
    } else {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({
          error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.'
        });
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Choose size based on aspect ratio
      // OpenAI gpt-image-1 supports: 1024x1024, 1024x1536, 1536x1024
      let size = '1024x1024';
      if (aspectRatio === 'portrait') {
        size = '1024x1536';
      } else if (aspectRatio === 'landscape') {
        size = '1536x1024';
      }

      // For OpenAI: linked panel refs are blurred for new generations so
      // images.edit() picks up style/palette/mood but can't copy composition.
      // For refinements, load unblurred so the edit actually works on the image.
      const linkedRefStreams = linkedRefs.length > 0
        ? (isRefinement ? await loadReferenceImages(linkedRefs) : await loadBlurredReferenceImages(linkedRefs))
        : [];
      const styleRefStreams = styleRefs.length > 0
        ? await loadReferenceImages(styleRefs)
        : [];
      const allRefStreams = [...linkedRefStreams, ...styleRefStreams];

      const maxPromptLen = 32000;
      if (finalPrompt.length > maxPromptLen) {
        console.log(`Panel prompt too long (${finalPrompt.length} chars), truncating to ${maxPromptLen}`);
        finalPrompt = finalPrompt.substring(0, maxPromptLen);
      }

      console.log(`Generating panel ${panelId}, aspect: ${aspectRatio}, size: ${size}, prompt length: ${finalPrompt.length}, linked refs (blurred): ${linkedRefStreams.length}, style refs: ${styleRefStreams.length}`);

      let response;
      if (allRefStreams.length > 0) {
        // Build reference instructions based on what types are present
        let refInstructions = '';
        if (linkedRefStreams.length > 0) {
          refInstructions = `REFERENCE IMAGE INSTRUCTIONS:
Some attached images are blurred scene references — use them ONLY to match the color palette, lighting mood, and art style.
Do NOT try to recreate their composition or layout. Generate a completely NEW composition following the prompt below.
KEEP: art style, color palette, lighting mood, character appearances as described in the character bible.
CHANGE: camera angle, composition, character poses, framing — follow the prompt instructions exactly.\n\n`;
        } else {
          refInstructions = `IMPORTANT: The attached image(s) are STYLE and CHARACTER REFERENCES ONLY. Do NOT reproduce or copy these images. Use them ONLY to match the art style, character appearance, and visual consistency. Generate a COMPLETELY NEW and ORIGINAL scene based on the prompt below.\n\n`;
        }
        response = await openai.images.edit({
          model: 'gpt-image-1',
          image: allRefStreams,
          prompt: refInstructions + finalPrompt,
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
      if (imageData.b64_json) {
        buffer = Buffer.from(imageData.b64_json, 'base64');
      } else if (imageData.url) {
        const imageResponse = await fetch(imageData.url);
        const arrayBuffer = await imageResponse.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }
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
