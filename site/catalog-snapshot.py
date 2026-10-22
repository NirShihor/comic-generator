#!/usr/bin/env python3
"""Refresh site/catalog.json — the snapshot of the reader's catalogue that the
comics catalogue page (/spanish-comics-for-beginners) is built from. Run this
whenever a comic or episode is published to the app, then site/build.py:

    curl -s http://localhost:3001/api/reader/catalog | python3 site/catalog-snapshot.py

Reads the catalogue JSON on stdin, groups the comics by collection in the
app's order, keeps only what the page shows (titles, levels, page counts,
descriptions) and writes site/catalog.json.
"""
import json, os, sys

here = os.path.dirname(os.path.abspath(__file__))
comics = json.load(sys.stdin)['comics']
series = {}
for c in sorted(comics, key=lambda c: (c.get('order', 0), c.get('episodeNumber', 0))):
    k = c.get('collectionId') or c['id']
    s = series.setdefault(k, {'id': k, 'title': c.get('collectionTitle') or c['title'], 'titleEn': c.get('collectionTitleEn', ''),
                              'description': (c.get('collectionDescription') or '').strip(), 'episodes': []})
    s['episodes'].append({'episode': c.get('episodeNumber'), 'title': c['title'], 'titleEn': c.get('titleEn', ''),
                          'level': c.get('level', 'beginner'), 'pages': c.get('totalPages'), 'minutes': c.get('estimatedMinutes'),
                          'description': (c.get('description') or '').strip()})
for s in series.values():
    s['episodes'].sort(key=lambda e: (e['episode'] or 0))
out = {'series': list(series.values())}
with open(os.path.join(here, 'catalog.json'), 'w') as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)
    fh.write('\n')
print(f"site/catalog.json written: {len(out['series'])} series, {sum(len(s['episodes']) for s in out['series'])} episodes")
