#!/usr/bin/env python3
"""Build the Comigo landing page: inlines site/assets images into index.template.html
as data URIs, producing a single self-contained site/index.html.

Usage: python3 site/build.py
"""
import hashlib, json, re, os, subprocess, sys
from html import escape as html_escape

here = os.path.dirname(os.path.abspath(__file__))

# Images are emitted as separate, content-hashed static files (served under
# /assets/ with immutable caching) instead of base64 data URIs. Each is capped
# at 640px wide (2x the largest rendered size) and encoded as WebP when that
# is meaningfully smaller than the original; the tag gets explicit
# width/height so nothing shifts while it loads.
DIST = os.path.join(here, 'assets-dist')
os.makedirs(DIST, exist_ok=True)
for f in os.listdir(DIST):
    os.remove(os.path.join(DIST, f))

def process(name):
    for ext in ('jpg', 'png'):
        p = os.path.join(here, 'assets', f'{name}.{ext}')
        if os.path.exists(p):
            break
    else:
        sys.exit(f'missing asset: {name}')
    tmp = os.path.join(DIST, f'.{name}.webp')
    r = subprocess.run(['node', os.path.join(here, 'img-webp.js'), p, tmp], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'webp encode failed for {name}: {r.stderr.strip()}')
    webp_wh, orig_wh = r.stdout.split()
    webp = open(tmp, 'rb').read(); os.remove(tmp)
    orig = open(p, 'rb').read()
    if len(webp) < len(orig) * 0.9:
        data, ext_out, (w, h) = webp, 'webp', webp_wh.split('x')
    else:
        data, ext_out, (w, h) = orig, ext, orig_wh.split('x')
    fname = f'{name}.{hashlib.md5(data).hexdigest()[:8]}.{ext_out}'
    open(os.path.join(DIST, fname), 'wb').write(data)
    return f'/assets/{fname}', w, h

manifest = {}
def repl(m):
    name = m.group(1)
    if name not in manifest:
        manifest[name] = process(name)
    url, w, h = manifest[name]
    return f'src="{url}" width="{w}" height="{h}"'

# {{AUD_name}} -> site/audio/name.mp3, content-hashed into assets-dist like
# images. The token is replaced wherever it appears (src=, data-audio=,
# embedded JSON word data, ...).
aud_manifest = {}
def aud_repl(m):
    name = m.group(1)
    if name not in aud_manifest:
        p = os.path.join(here, 'audio', f'{name}.mp3')
        if not os.path.exists(p):
            sys.exit(f'missing audio asset: {name}')
        data = open(p, 'rb').read()
        fname = f'{name}.{hashlib.md5(data).hexdigest()[:8]}.mp3'
        open(os.path.join(DIST, fname), 'wb').write(data)
        aud_manifest[name] = f'/assets/{fname}'
    return aud_manifest[name]

# {{VID_name}} -> site/video/name.mp4, content-hashed the same way.
vid_manifest = {}
def vid_repl(m):
    name = m.group(1)
    if name not in vid_manifest:
        p = os.path.join(here, 'video', f'{name}.mp4')
        if not os.path.exists(p):
            sys.exit(f'missing video asset: {name}')
        data = open(p, 'rb').read()
        fname = f'{name}.{hashlib.md5(data).hexdigest()[:8]}.mp4'
        open(os.path.join(DIST, fname), 'wb').write(data)
        vid_manifest[name] = f'/assets/{fname}'
    return vid_manifest[name]

# poster="{{IMG_name}}" -> the optimised image's URL only (no dimensions).
def poster_repl(m):
    name = m.group(1)
    if name not in manifest:
        manifest[name] = process(name)
    return f'poster="{manifest[name][0]}"'

# {{EXAMPLE:slug}} or {{EXAMPLE:slug|note}} -> an interactive comic stage built
# from site/examples/<slug>.json (published from the generator's Marketing →
# Examples tab). The shared styles/script (site/example-stage.html) are added
# once per page that uses any example.
def expand_examples(html):
    used = False
    def one(m):
        nonlocal used
        slug, note = m.group(1), (m.group(2) or '').strip()
        p = os.path.join(here, 'examples', f'{slug}.json')
        if not os.path.exists(p):
            sys.exit(f'missing example: {slug} (publish it from Marketing → Examples)')
        data = json.load(open(p))
        used = True
        e = lambda t: html_escape(str(t or ''), quote=True)
        spots = []
        for i, b in enumerate(data.get('bubbles', [])):
            pad_x, pad_y = (0, 0) if b.get('caption') else (0.012, 0.015)
            left, top = max(0, b['x'] - pad_x) * 100, max(0, b['y'] - pad_y) * 100
            w, h = (b['w'] + 2 * pad_x) * 100, (b['h'] + 2 * pad_y) * 100
            first = (b.get('sentences') or [{}])[0].get('es', '')
            spots.append(f'    <button class="hotspot" data-i="{i}" style="left:{left:.1f}%;top:{top:.1f}%;width:{w:.1f}%;height:{h:.1f}%"'
                         f'{" data-caption" if b.get("caption") else ""} aria-label="{e(first)} — tap to hear and explore"></button>')
        alt = f"A page from {data.get('comic') or 'an original Comigo comic'}"
        alt += f" ({data['collection']})" if data.get('collection') else ''
        alt += ', an original Comigo Spanish comic.'
        transcript = ' '.join(f"{s.get('es', '')} — {s.get('en', '')}"
                              for b in data.get('bubbles', []) for s in b.get('sentences', []))
        blob = json.dumps({'bubbles': data.get('bubbles', [])}, ensure_ascii=False).replace('</', '<\\/')
        return (f'<section class="wrap stage-wrap">\n'
                f'  <h3 class="display stage-head">Click on a bubble</h3>\n'
                + (f'  <p class="stage-note">{e(note)}</p>\n' if note else '') +
                f'  <div class="stage" data-ex="{e(slug)}">\n'
                f'    <img loading="lazy" decoding="async" src="{{{{IMG_{data["image"]}}}}}" alt="{e(alt)}">\n'
                + '\n'.join(spots) + '\n'
                '    <div class="popup" hidden><button class="popup-x" aria-label="Close">✕</button><div class="popup-body"></div></div>\n'
                '    <div class="ex-sheet" hidden><div class="sh-head"><b></b><button class="sh-done">Done</button></div><div class="sh-body"></div></div>\n'
                '    <audio preload="none"></audio>\n'
                '    <div class="hint">\U0001F446 Tap a speech bubble</div>\n'
                '  </div>\n'
                f'  <script type="application/json" class="ex-data">{blob}</script>\n'
                '</section>\n'
                f'<div class="wrap visually-hidden"><p lang="es">{e(transcript)}</p></div>')
    html = re.sub(r'\{\{EXAMPLE:([\w-]+)(?:\|([^}]*))?\}\}', one, html)
    return html, used

LEVELS = {'beginner': 0, 'intermediate': 1, 'advanced': 2}
def load_examples():
    d = os.path.join(here, 'examples')
    items = [json.load(open(os.path.join(d, f))) for f in sorted(os.listdir(d)) if f.endswith('.json')]
    return sorted(items, key=lambda x: (LEVELS.get(x.get('level'), 9), (x.get('label') or x['slug']).lower()))

def sentence_case(t):
    t = (t or '').strip()
    return t[:1].upper() + t[1:].lower() if t.isupper() else t

def page_label(x):
    return x.get('label') or sentence_case(x.get('comic')) or x['slug']

def source_line(x):
    comic, coll = sentence_case(x.get('comic')), sentence_case(x.get('collection'))
    return f'{comic} · {coll}' if comic and coll else comic or coll

# {{EXAMPLE_LINKS}} or {{EXAMPLE_LINKS:slug-to-skip}} -> a grid of cards linking
# to every published example's own page (/examples/<slug>).
LINKS_CSS = """<style>
  .ex-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 22px; padding: 18px 24px 6px; }
  .ex-card {
    display: flex; flex-direction: column; background: var(--card); color: var(--ink); text-decoration: none;
    border: 3px solid var(--line); border-radius: 14px; overflow: hidden; box-shadow: 6px 6px 0 var(--shadow);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .ex-card:hover { transform: translate(2px, 2px); box-shadow: 4px 4px 0 var(--shadow); }
  .ex-card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; object-position: top; display: block; border-bottom: 3px solid var(--line); }
  .ex-card .ex-card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 6px; }
  .ex-card .label { color: var(--accent); }
  .ex-card h3 { margin: 0; font-size: 1.3rem; }
  .ex-card .ex-src { font-family: system-ui, sans-serif; font-size: 0.85rem; color: var(--muted); }
  .ex-card .ex-go { font-family: system-ui, sans-serif; font-weight: 700; font-size: 0.92rem; margin-top: 4px; }
</style>
"""
def expand_links(html):
    used = False
    def one(m):
        nonlocal used
        skip = m.group(1)
        e = lambda t: html_escape(str(t or ''), quote=True)
        cards = []
        for x in load_examples():
            if x['slug'] == skip:
                continue
            lvl = (x.get('level') or '').capitalize()
            cards.append(
                f'  <a class="ex-card" href="/examples/{e(x["slug"])}">\n'
                f'    <img loading="lazy" decoding="async" src="{{{{IMG_{x["image"]}}}}}" alt="">\n'
                f'    <div class="ex-card-body">\n'
                + (f'      <span class="label">{e(lvl)}</span>\n' if lvl else '') +
                f'      <h3 class="display">{e(page_label(x))}</h3>\n'
                + (f'      <span class="ex-src" lang="es">{e(source_line(x))}</span>\n' if source_line(x) else '') +
                f'      <span class="ex-go">Read this page &rarr;</span>\n'
                f'    </div>\n  </a>')
        if not cards:
            return ''
        css = '' if used else LINKS_CSS
        used = True
        return css + '<section class="wrap ex-links">\n' + '\n'.join(cards) + '\n</section>'
    return re.sub(r'\{\{EXAMPLE_LINKS(?::([\w-]+))?\}\}', one, html)

def build(tmpl_name, out_name, html=None, nav_slug=None):
    if html is None:
        html = open(os.path.join(here, tmpl_name)).read()
    html = expand_links(html)
    html, has_examples = expand_examples(html)
    if has_examples:
        # Shared stage styles/script: appended to the page body once.
        html += '\n' + open(os.path.join(here, 'example-stage.html')).read()
    # Shared navigation: {{NAV}} pulls in site/nav.html, with the current
    # page's link marked (aria-current) so it can be styled subtly.
    if '{{NAV}}' in html:
        nav = open(os.path.join(here, 'nav.html')).read()
        slug = nav_slug or out_name[:-len('.html')]
        nav = nav.replace(f'data-nav="{slug}"', f'data-nav="{slug}" aria-current="page"')
        html = html.replace('{{NAV}}', nav)
    out = re.sub(r'poster="\{\{IMG_([\w-]+)\}\}"', poster_repl, html)
    out = re.sub(r'src="\{\{IMG_([\w-]+)\}\}"', repl, out)
    out = re.sub(r'\{\{AUD_([\w-]+)\}\}', aud_repl, out)
    out = re.sub(r'\{\{VID_([\w-]+)\}\}', vid_repl, out)
    if '{{IMG_' in out or '{{AUD_' in out or '{{VID_' in out:
        sys.exit(f'unreplaced token remains in {tmpl_name}')
    # Interactive sample pages: inline the bubble/audio data generated by
    # build-pages-data.py.
    pages_js_path = os.path.join(here, 'interactive-pages.js')
    if '{{PAGES_JS}}' in out:
        if not os.path.exists(pages_js_path):
            sys.exit('run build-pages-data.py first (interactive-pages.js missing)')
        out = out.replace('{{PAGES_JS}}', open(pages_js_path).read())
    # The template has no document skeleton (it doubles as a Claude Artifact
    # source, which supplies its own). Split at the end of the style block and wrap.
    head, sep, body = out.partition('</style>')
    if not sep:
        sys.exit(f'{tmpl_name} missing </style>')
    # OpenAI conversion pixel — injected into every built page's head.
    oai_pixel = ('<script>!function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];'
                 'w.oaiq=q;var j=d.createElement(s);j.async=1;j.src=u;var f=d.getElementsByTagName(s)[0];'
                 'f.parentNode.insertBefore(j,f)}(window,document,"script","https://bzrcdn.openai.com/sdk/oaiq.min.js");'
                 'oaiq("init",{pixelId:"TvYodr4Ct4JBQ2GkX5u1gK"});</script>')
    doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           + head + sep + '\n' + oai_pixel + '\n</head>\n<body>' + body + '\n</body>\n</html>\n')
    open(os.path.join(here, out_name), 'w').write(doc)
    print(f'site/{out_name} written,', os.path.getsize(os.path.join(here, out_name)), 'bytes')

# Every *.template.html builds to its .html twin — index plus any SEO/story
# pages; new pages need only a template file (the sitemap picks them up too).
for tmpl in sorted(f for f in os.listdir(here) if f.endswith('.template.html')):
    build(tmpl, tmpl.replace('.template.html', '.html'))

# Every published example also gets its own page at /examples/<slug>, built
# from site/example-page.html. Pages for examples no longer published are removed.
ex_dir = os.path.join(here, 'examples')
for f in os.listdir(ex_dir):
    if f.endswith('.html') and not os.path.exists(os.path.join(ex_dir, f[:-5] + '.json')):
        os.remove(os.path.join(ex_dir, f))
page_tmpl = open(os.path.join(here, 'example-page.html')).read()
for x in load_examples():
    e = lambda t: html_escape(str(t or ''), quote=True)
    label, level = page_label(x), (x.get('level') or '')
    comic, coll = sentence_case(x.get('comic')), sentence_case(x.get('collection'))
    src = f'<i lang="es">{e(comic)}</i>' + (f', from the <i lang="es">{e(coll)}</i> collection' if coll else '') if comic else ''
    art = 'An' if level[:1].lower() in 'aeiou' and level else 'A'
    intro = (f'{art} {e(level) + " " if level else ""}Spanish reading exercise: a real page from {src} &mdash; '
             'an original Comigo comic, voiced line by line.' if src else
             f'{art} {e(level) + " " if level else ""}Spanish reading exercise: a real page from an original Comigo comic, voiced line by line.')
    desc = (f'Read "{label}", {art.lower()} {level + " " if level else ""}Spanish comic page'
            + (f' from {comic}' if comic else '') +
            '. Tap a bubble to hear every line, tap any word for its meaning, and check the English.')
    lines = '\n'.join(
        f'    <details><summary lang="es">{e(s_.get("es"))}</summary><p class="ans">{e(s_.get("en"))}</p></details>'
        for b in x.get('bubbles', []) for s_ in b.get('sentences', []) if s_.get('es'))
    vals = {
        'PG_TITLE': e(f'{label} — {level.capitalize() + " " if level else ""}Spanish Reading Practice | Comigo'),
        'PG_DESC': e(desc), 'PG_URL': f'https://comigo.net/examples/{x["slug"]}',
        'PG_SLUG': x['slug'], 'PG_LABEL': e(label),
        'PG_EYEBROW': e(f'{level.capitalize()} · Spanish reading practice' if level else 'Spanish reading practice'),
        'PG_INTRO': intro, 'PG_LINES': lines,
    }
    html = re.sub(r'\{\{(PG_\w+)\}\}', lambda m: vals[m.group(1)], page_tmpl)
    build('example-page.html', os.path.join('examples', x['slug'] + '.html'), html=html, nav_slug='spanish-reading-practice')

total = sum(os.path.getsize(os.path.join(DIST, f)) for f in os.listdir(DIST))
print(f'assets-dist: {len(os.listdir(DIST))} files, {total / 1024:.0f} KB')
