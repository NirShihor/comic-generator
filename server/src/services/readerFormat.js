function sanitizeWordForFilename(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/[.,!?;:"""''¿¡…\[\](){}\/\\]/g, '').trim().replace(/\s+/g, '_');
}

function sanitizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 50);
}

function transformToReaderFormat(comic, comicSlug) {
  let wordCounter = 1;
  let sentenceCounter = 1;
  let bubbleCounter = 1;

  const pages = [];

  if (comic.cover?.image) {
    pages.push({
      id: `${comicSlug}-page-cover`,
      pageNumber: 1,
      masterImage: `${comicSlug}_cover`,
      panels: [{
        id: `${comicSlug}-panel-cover`,
        artworkImage: `${comicSlug}_cover`,
        panelOrder: 1,
        tapZone: { x: 0, y: 0, width: 1, height: 1 },
        bubbles: (comic.cover.bubbles || []).map(bubble => {
          const bubbleId = `${comicSlug}-bubble-cover-${bubbleCounter++}`;
          return {
            id: bubbleId,
            type: bubble.type || 'narration',
            position: {
              x: bubble.x,
              y: bubble.y,
              width: bubble.width,
              height: bubble.height
            },
            sentences: (bubble.sentences || []).map(sentence => {
              const sentenceId = `${comicSlug}-s${sentenceCounter++}`;
              return {
                id: sentenceId,
                text: sentence.text || '',
                translation: sentence.translation || '',
                audioUrl: sentence.audioUrl || '',
                ...(sentence.alternatives?.length > 0 && {
                  alternativeTexts: sentence.alternatives.map(a => a.text),
                  alternativeAudioUrls: sentence.alternatives.filter(a => a.audioUrl).map(a => a.audioUrl)
                }),
                words: (sentence.words || []).map(word => {
                  const wText = sanitizeWordForFilename(word.text);
                  const wBase = sanitizeWordForFilename(word.baseForm || word.text);
                  return {
                    id: `${comicSlug}-w${wordCounter++}`,
                    text: word.text || '',
                    meaning: word.meaning || '',
                    baseForm: word.baseForm || word.text || '',
                    ...(word.startTimeMs != null && { startTimeMs: word.startTimeMs }),
                    ...(word.endTimeMs != null && { endTimeMs: word.endTimeMs }),
                    ...(word.vocabQuiz && { vocabQuiz: true }),
                    ...(word.manual && { manual: true }),
                    ...(wText && { wordAudioUrl: `words/${wText}` }),
                    ...(wBase && { baseFormAudioUrl: `words/${wBase}` })
                  };
                })
              };
            })
          };
        })
      }]
    });
  }

  for (const page of comic.pages) {
    const pageNum = pages.length + 1;
    const exportedPage = {
      id: `${comicSlug}-page-${page.pageNumber}`,
      pageNumber: pageNum,
      masterImage: `${comicSlug}_p${page.pageNumber}`,
      // Include noTextImage when a baked image exists (raw master is exported as _no_text)
      ...(page.bakedImage && page.masterImage && page.bakedImage !== page.masterImage && {
        noTextImage: `${comicSlug}_p${page.pageNumber}_no_text`
      }),
      panels: (page.panels || []).map(panel => {
        const panelNum = panel.panelOrder;
        const hasBakedPage = page.bakedImage && page.masterImage && page.bakedImage !== page.masterImage;

        // Check if any part of the bubble overlaps the panel tap zone
        const panelBubbles = (page.bubbles || []).filter(bubble => {
          const bx = bubble.x || 0;
          const by = bubble.y || 0;
          const bw = bubble.width || 0;
          const bh = bubble.height || 0;
          const tx = panel.tapZone.x;
          const ty = panel.tapZone.y;
          const tw = panel.tapZone.width;
          const th = panel.tapZone.height;
          return bx + bw > tx && bx < tx + tw &&
                 by + bh > ty && by < ty + th;
        }).sort((a, b) => {
          // Sort by reading order: top-to-bottom, left-to-right as tiebreaker
          const ay = a.y || 0;
          const by_ = b.y || 0;
          const ax = a.x || 0;
          const bx = b.x || 0;
          if (Math.abs(ay - by_) < 0.02) return ax - bx; // Same row: left to right
          return ay - by_; // Top to bottom
        });

        return {
          id: `${comicSlug}-panel-${page.pageNumber}-${panelNum}`,
          artworkImage: `${comicSlug}_p${page.pageNumber}_s${panelNum}`,
          ...(hasBakedPage && {
            noTextImage: `${comicSlug}_p${page.pageNumber}_s${panelNum}_no_text`
          }),
          ...(panel.floating && { floating: true }),
          ...(panel.corners && panel.corners.length === 4 && { corners: panel.corners.map(c => ({ x: c.x, y: c.y })) }),
          panelOrder: panelNum,
          tapZone: {
            x: panel.tapZone.x,
            y: panel.tapZone.y,
            width: panel.tapZone.width,
            height: panel.tapZone.height
          },
          bubbles: panelBubbles.map(bubble => {
            const bubbleId = `${comicSlug}-bubble-${page.pageNumber}-${panelNum}-${bubbleCounter++}`;
            return {
              id: bubbleId,
              type: bubble.type || 'speech',
              ...(bubble.isSoundEffect && { isSoundEffect: true }),
              ...(bubble.imageUrl && { imageUrl: bubble.imageUrl }),
              position: {
                x: bubble.x,
                y: bubble.y,
                width: bubble.width,
                height: bubble.height
              },
              sentences: (bubble.sentences || []).map((sentence, sIdx) => {
                const sentenceId = `${comicSlug}-s${sentenceCounter++}`;
                return {
                  id: sentenceId,
                  text: sentence.text || '',
                  translation: sentence.translation || '',
                  audioUrl: sentence.audioUrl || '',
                  ...(sentence.alternatives?.length > 0 && {
                  alternativeTexts: sentence.alternatives.map(a => a.text),
                  alternativeAudioUrls: sentence.alternatives.filter(a => a.audioUrl).map(a => a.audioUrl)
                }),
                  words: (sentence.words || []).map(word => {
                    const wText = sanitizeWordForFilename(word.text);
                    const wBase = sanitizeWordForFilename(word.baseForm || word.text);
                    return {
                      id: `${comicSlug}-w${wordCounter++}`,
                      text: word.text || '',
                      meaning: word.meaning || '',
                      baseForm: word.baseForm || word.text || '',
                      ...(word.startTimeMs != null && { startTimeMs: word.startTimeMs }),
                      ...(word.endTimeMs != null && { endTimeMs: word.endTimeMs }),
                      ...(word.vocabQuiz && { vocabQuiz: true }),
                      ...(word.manual && { manual: true }),
                      ...(wText && { wordAudioUrl: `words/${wText}` }),
                      ...(wBase && { baseFormAudioUrl: `words/${wBase}` })
                    };
                  })
                };
              })
            };
          })
        };
      })
    };
    pages.push(exportedPage);
  }

  return {
    id: `comic-${comicSlug}`,
    title: comic.title,
    description: comic.description || '',
    coverImage: `${comicSlug}_cover`,
    level: comic.level || 'beginner',
    totalPages: pages.length,
    estimatedMinutes: pages.length * 2,
    language: comic.language || 'es',
    targetLanguage: comic.targetLanguage || 'en',
    version: '1.0',
    ...(comic.collectionId && { collectionId: comic.collectionId }),
    ...(comic.collectionTitle && { collectionTitle: comic.collectionTitle }),
    ...(comic.episodeNumber && { episodeNumber: comic.episodeNumber }),
    pages,
    reviewWords: pages.flatMap(page =>
      (page.panels || []).flatMap(panel =>
        (panel.bubbles || []).flatMap(bubble =>
          (bubble.sentences || []).flatMap(sentence =>
            (sentence.words || []).filter(w => w.vocabQuiz).map(w => {
              const wText = sanitizeWordForFilename(w.text);
              const wBase = sanitizeWordForFilename(w.baseForm || w.text);
              return {
                word: {
                  id: w.id,
                  text: w.text,
                  meaning: w.meaning,
                  baseForm: w.baseForm,
                  ...(wText && { wordAudioUrl: `words/${wText}` }),
                  ...(wBase && { baseFormAudioUrl: `words/${wBase}` })
                },
                panelId: panel.id,
                pageId: page.id
              };
            })
          )
        )
      )
    ),
    wordAudioMap: (() => {
      const map = {};
      for (const page of pages) {
        for (const panel of page.panels || []) {
          for (const bubble of panel.bubbles || []) {
            for (const sentence of bubble.sentences || []) {
              for (const word of sentence.words || []) {
                if (word.wordAudioUrl) map[sanitizeWordForFilename(word.text)] = word.wordAudioUrl;
                if (word.baseFormAudioUrl) map[sanitizeWordForFilename(word.baseForm)] = word.baseFormAudioUrl;
              }
            }
          }
        }
      }
      return map;
    })()
  };
}

module.exports = { sanitizeTitle, sanitizeWordForFilename, transformToReaderFormat };
