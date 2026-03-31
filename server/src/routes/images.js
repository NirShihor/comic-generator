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
async function generateWithGemini(prompt, styleRefPaths = [], linkedRefPaths = [], isAngleChange = false) {
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
  if (isAngleChange && linkedCount > 0) {
    const angleNote = `CAMERA ANGLE CHANGE — The FIRST attached image is the CURRENT scene. You MUST recreate this EXACT SAME scene — same characters, same clothing, same environment, same props, same lighting — but viewed from a DIFFERENT camera angle as specified in the prompt below. DO NOT add or remove characters. DO NOT change any visual details. The ONLY thing that changes is the camera position.`;
    const styleNote = styleCount > 0 ? `\n\nThe remaining ${styleCount} image(s) are style references for art consistency only.` : '';
    textPrompt = `${angleNote}${styleNote}\n\n${prompt}`;
  } else if (styleCount > 0) {
    const styleNote = `IMPORTANT: ${styleCount} of the attached image(s) are STYLE and CHARACTER REFERENCES ONLY. Do NOT reproduce or copy these images. Use them ONLY to match the art style, character appearance, and visual consistency. Generate a COMPLETELY NEW and ORIGINAL scene based on the prompt below.`;
    textPrompt = `${styleNote}\n\n${prompt}`;
  }
  parts.push({ text: textPrompt });

  console.log(`Gemini: generating with ${linkedCount} linked refs + ${styleCount} style refs, prompt length: ${prompt.length}`);

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: parts,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      }
    });

    const candidate = response.candidates?.[0];

    if (!candidate || !candidate.content || !candidate.content.parts) {
      const finishReason = candidate?.finishReason || 'unknown';
      console.log(`Gemini attempt ${attempt}/${maxRetries}: no image data (finishReason: ${finishReason})`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw new Error(`Gemini returned no image data after ${maxRetries} attempts (finishReason: ${finishReason})`);
    }

    // Find the image part in the response
    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }

    // Response had parts but none with image data — log what we got
    const partTypes = candidate.content.parts.map(p => p.text ? `text: "${p.text.substring(0, 100)}"` : Object.keys(p).join(',')).join('; ');
    console.log(`Gemini attempt ${attempt}/${maxRetries}: response had parts but no image (${partTypes})`);
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
      continue;
    }
    throw new Error(`Gemini response contained no image after ${maxRetries} attempts`);
  }
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

// Helper: wrap a long-running async operation with periodic keep-alive writes
// to prevent browser/proxy from closing the connection on idle.
// Sends newlines every 15s, then the final JSON result.
function withKeepAlive(res, asyncFn) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache');
  const keepAlive = setInterval(() => {
    try { res.write(' '); } catch (e) { clearInterval(keepAlive); }
  }, 15000);
  return asyncFn()
    .then(result => {
      clearInterval(keepAlive);
      res.end(JSON.stringify(result));
    })
    .catch(err => {
      clearInterval(keepAlive);
      console.error('Generation error:', err);
      // If headers already sent (we wrote keep-alive bytes), send error as JSON in body
      res.end(JSON.stringify({ error: err.message }));
    });
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
router.post('/generate-page', (req, res) => {
  withKeepAlive(res, async () => {
    const { prompt, referenceImages, provider = 'openai' } = req.body;

    let finalPrompt = prompt;
    let buffer;

    if (provider === 'gemini') {
      // generate-page only has style refs (no per-panel linked refs)
      buffer = await generateWithGemini(finalPrompt, referenceImages || [], []);
    } else {
      if (!process.env.OPENAI_API_KEY) {
        return { error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.' };
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

    return {
      filename,
      path: `/uploads/${filename}`
    };
  });
});

// Use GPT-4o Responses API with image_generation tool to rotate a scene.
// This is how ChatGPT's web interface works — GPT-4o sees the input image,
// reasons about the perspective change, and generates a new image natively.
async function generateAngleChange(imagePath, angleDegrees, panelContent) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const fullPath = path.join(__dirname, '../..', imagePath);
  const imageBuffer = await fs.readFile(fullPath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  // For negative angles, we generate with the positive equivalent and flip the result.
  // This is because the image generation model doesn't reliably follow left/right
  // directional cues in text — it tends to default to one direction regardless.
  // Horizontal flipping is a standard technique in comics/animation for mirroring angles.
  const needsFlip = angleDegrees < 0 && Math.abs(angleDegrees) < 150; // Don't flip 180°
  const effectiveAngle = Math.abs(angleDegrees); // Always generate as positive
  const absAngle = effectiveAngle;

  // Always use positive-angle descriptions for generation
  const cameraSide = 'RIGHT';
  const visibleSide = 'LEFT';
  const facingDirection = 'LEFT';
  const angleDirection = `${absAngle} degrees to the ${cameraSide}`;

  // Add a plain-language description of how extreme the rotation is
  // Focus on VISUAL RESULT: which side of character is visible, which way they face in frame
  let angleIntensity = '';
  if (absAngle >= 150) {
    angleIntensity = 'This is a complete 180° turn — we should see the characters FROM BEHIND. Their backs face the camera. The background shows what was originally in front of them.';
  } else if (absAngle >= 85) {
    angleIntensity = `This is a full 90° side view. The character must be shown in COMPLETE PROFILE: we see ONLY their ${visibleSide} cheek, ${visibleSide} ear, ${visibleSide} shoulder. Their nose points toward the ${facingDirection} edge of the frame. They are looking toward the ${facingDirection}. The background perspective changes completely — what was behind them is now on the ${cameraSide} side of the frame.`;
  } else if (absAngle >= 60) {
    angleIntensity = `This is a strong three-quarter to near-profile view. The character's ${visibleSide} cheek, ${visibleSide} ear, and ${visibleSide} shoulder are prominently visible. Their nose and gaze point toward the ${facingDirection} edge of the frame. The background perspective shifts dramatically.`;
  } else if (absAngle >= 40) {
    angleIntensity = `This is a three-quarter view. The character's ${visibleSide} side is more visible than their ${cameraSide} side. They appear to be looking slightly toward the ${facingDirection}. The background perspective shifts noticeably.`;
  } else {
    angleIntensity = `This is a subtle angle shift. The character's ${visibleSide} side becomes slightly more visible. They appear to be looking slightly toward the ${facingDirection}.`;
  }

  console.log(`GPT-4o Responses API: generating angle change (${angleDegrees}°)...`);

  // Step 1: Ask GPT-4o to analyze the scene and describe what the rotated
  // background should look like (without generating an image yet)
  const analysisResponse = await openai.responses.create({
    model: 'gpt-5.4',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: `data:${mimeType};base64,${base64Image}`
          },
          {
            type: 'input_text',
            text: `Look at this image. I want to rotate the camera ${absAngle}° to the ${cameraSide} around the subject.

IMPORTANT VISUAL RESULT: In the new image, the character's ${visibleSide} side (${visibleSide} cheek, ${visibleSide} ear, ${visibleSide} shoulder) must face the camera. The character's nose and gaze must point toward the ${facingDirection} edge of the frame.

${angleIntensity}

The ENTIRE background perspective must also change to match the new camera position. Describe in detail what the background would look like from this new camera angle. Don't generate an image yet — just describe the changes.`
          }
        ]
      }
    ],
  });

  const analysisText = analysisResponse.output_text || '';
  console.log(`GPT-4o analysis (${analysisText.length} chars): ${analysisText.substring(0, 150)}...`);

  // Step 2: Generate the image. Include the analysis directly in the generation prompt
  // so the model has the background description right next to the generation request.
  const response = await openai.responses.create({
    model: 'gpt-5.4',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: `data:${mimeType};base64,${base64Image}`
          },
          {
            type: 'input_text',
            text: `I need you to recreate this scene but with the camera rotated ${absAngle}° to the ${cameraSide}. Here is a detailed description of what the rotated scene should look like:

${analysisText}

IMPORTANT REQUIREMENTS:
1. The character's ${visibleSide} side faces the camera (${visibleSide} cheek, ${visibleSide} ear visible). Their nose points toward the ${facingDirection} of the frame.
2. The BACKGROUND MUST CHANGE DRAMATICALLY — do NOT keep the same background composition. The perspective shift means buildings, streets, and environment appear completely different from the new camera position. This is the most important requirement.
3. Keep the same character appearance, clothing, and art style.
4. Scene context: ${panelContent}

Generate this image now.`
          }
        ]
      }
    ],
    tools: [{ type: 'image_generation', quality: 'high' }],
  });

  // Extract the generated image from the response
  const imageOutput = response.output.find(o => o.type === 'image_generation_call');
  if (!imageOutput || !imageOutput.result) {
    throw new Error('GPT-4o Responses API returned no image');
  }

  let resultBuffer = Buffer.from(imageOutput.result, 'base64');

  // For negative angles, flip the image horizontally to get the opposite direction
  if (needsFlip) {
    console.log(`Flipping image horizontally for negative angle (${angleDegrees}°)`);
    resultBuffer = await sharp(resultBuffer).flop().toBuffer();
  }

  return resultBuffer;
}

// Generate single panel image (OpenAI or Gemini)
router.post('/generate-panel', (req, res) => {
  withKeepAlive(res, async () => {
    const { prompt, panelId, aspectRatio = 'square', referenceImages, linkedPanelImages, isRefinement, isAngleChange, angleSourceImage, angleDegrees, panelContent, provider = 'openai' } = req.body;

    const styleRefs = referenceImages || [];
    const linkedRefs = linkedPanelImages || [];

    let finalPrompt = prompt;
    let buffer;

    // For angle changes with OpenAI, use the Responses API with image_generation tool.
    // This is how ChatGPT's web interface works — GPT-4o sees the input image,
    // reasons about the perspective change, and generates a new image natively.
    if (isAngleChange && angleSourceImage && angleDegrees && provider !== 'gemini' && process.env.OPENAI_API_KEY) {
      try {
        buffer = await generateAngleChange(angleSourceImage, angleDegrees, panelContent || '');
        console.log(`Panel ${panelId} angle change generated with GPT-4o Responses API`);

        // Save to file
        const filename = `panel-${panelId}-${uuidv4()}.png`;
        const uploadDir = path.join(__dirname, '../../uploads');
        const outputPath = path.join(uploadDir, filename);
        await fs.writeFile(outputPath, buffer);
        console.log(`Panel ${panelId} generated: ${filename}`);
        return { path: `/uploads/${filename}` };
      } catch (err) {
        console.log(`GPT-4o Responses API failed, falling back to images.edit: ${err.message}`);
        // Fall through to the normal generation path
      }
    }

    if (provider === 'gemini') {
      // For angle changes, only send the source image — skip character refs and style refs
      // to prevent the AI from adding extra characters or changing the scene
      const geminiStyleRefs = isAngleChange && angleSourceImage ? [] : styleRefs;
      const geminiLinkedRefs = isAngleChange && angleSourceImage
        ? [angleSourceImage]
        : linkedRefs;
      buffer = await generateWithGemini(finalPrompt, geminiStyleRefs, geminiLinkedRefs, isAngleChange);
      console.log(`Panel ${panelId} generated with Gemini`);
    } else {
      if (!process.env.OPENAI_API_KEY) {
        return { error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env file.' };
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

      // For angle changes: the source image (current panel) goes unblurred FIRST,
      // and user's linked panel refs stay blurred (they're character references, not the scene).
      // For refinements: linked refs unblurred. For new generations: linked refs blurred.
      let allRefStreams = [];

      if (isAngleChange && angleSourceImage) {
        // For angle changes: ONLY send the current panel image (unblurred).
        // Skip per-panel character refs entirely — they confuse the AI into
        // adding extra characters. Style refs also skipped to keep focus on
        // recreating the source image from a different angle.
        const sourceStreams = await loadReferenceImages([angleSourceImage]);
        allRefStreams = [...sourceStreams];
      } else {
        const linkedRefStreams = linkedRefs.length > 0
          ? await loadReferenceImages(linkedRefs)
          : [];
        const styleRefStreams = styleRefs.length > 0
          ? await loadReferenceImages(styleRefs)
          : [];
        allRefStreams = [...linkedRefStreams, ...styleRefStreams];
      }

      const maxPromptLen = 32000;
      if (finalPrompt.length > maxPromptLen) {
        console.log(`Panel prompt too long (${finalPrompt.length} chars), truncating to ${maxPromptLen}`);
        finalPrompt = finalPrompt.substring(0, maxPromptLen);
      }

      console.log(`Generating panel ${panelId}, aspect: ${aspectRatio}, size: ${size}, prompt length: ${finalPrompt.length}, angle-change: ${!!isAngleChange}, source: ${angleSourceImage ? 1 : 0}, linked refs: ${linkedRefs.length}, style refs: ${styleRefs.length}`);

      let response;
      if (allRefStreams.length > 0) {
        // Build reference instructions based on what types are present
        let refInstructions = '';
        if (isAngleChange && angleSourceImage) {
          refInstructions = `CAMERA ANGLE CHANGE — REFERENCE IMAGE INSTRUCTIONS:
The FIRST attached image is the CURRENT scene that you MUST use as your primary reference.
You must recreate this EXACT SAME scene — same characters, same clothing, same environment, same props, same lighting — but from a DIFFERENT camera angle as specified in the prompt.
DO NOT add any new characters. DO NOT remove any characters. DO NOT change clothing, hair, or any visual detail.
The ONLY thing that changes is the camera position/angle. Everything else must be IDENTICAL.
Other attached images are style/character references ONLY — do NOT add characters from reference images into the scene.\n\n`;
        } else if (linkedRefs.length > 0) {
          refInstructions = `REFERENCE IMAGE INSTRUCTIONS:
Some attached images are SCENE REFERENCES — use them to match the setting, environment, color palette, lighting, and art style.
Maintain visual consistency with the reference scene while following the prompt below for the specific action and composition.
Other attached images are style/character references — use them for art style and character appearance consistency only.\n\n`;
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

    return {
      panelId,
      filename,
      path: `/uploads/${filename}`
    };
  });
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

// Flip an image horizontally
router.post('/flip', async (req, res) => {
  try {
    const { imagePath } = req.body;
    if (!imagePath) return res.status(400).json({ error: 'imagePath is required' });

    const fullPath = path.join(__dirname, '../..', imagePath);
    await fs.access(fullPath);

    const flippedBuffer = await sharp(fullPath).flop().toBuffer();
    const ext = path.extname(fullPath);
    const filename = `panel-flipped-${uuidv4()}${ext}`;
    const outputPath = path.join(__dirname, '../../uploads', filename);
    await fs.writeFile(outputPath, flippedBuffer);

    res.json({ path: `/uploads/${filename}` });
  } catch (error) {
    console.error('Flip error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
