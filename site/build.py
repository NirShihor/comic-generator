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

# Every published example has its own page at EX_BASE/<slug> (canonical URL,
# sitemap entry and all internal links use this; the server serves the same path
# from site/examples/<slug>.html). Old URLs 301 via site/redirects.json.
SITE_URL = 'https://comigo.net'
EX_BASE = '/spanish-reading-practice'
def ex_url(slug):
    return f'{EX_BASE}/{slug}'

# {{OGIMG_name}} -> og:image / twitter:image tags for a site/assets image, as a
# 1200x630 JPEG cut from the top of the page (link previews: LinkedIn and
# others don't show WebP).
og_manifest = {}
def og_repl(m):
    name = m.group(1)
    if name not in og_manifest:
        src = next((os.path.join(here, 'assets', f'{name}.{x}') for x in ('jpg', 'png')
                    if os.path.exists(os.path.join(here, 'assets', f'{name}.{x}'))), None)
        if not src:
            sys.exit(f'missing asset: {name}')
        tmp = os.path.join(DIST, f'.{name}.og.jpg')
        r = subprocess.run(['node', os.path.join(here, 'img-webp.js'), src, tmp, 'og'], capture_output=True, text=True)
        if r.returncode:
            sys.exit(f'og image failed for {name}: {r.stderr.strip()}')
        w, h = r.stdout.split()[0].split('x')
        data = open(tmp, 'rb').read(); os.remove(tmp)
        fname = f'{name}-og.{hashlib.md5(data).hexdigest()[:8]}.jpg'
        open(os.path.join(DIST, fname), 'wb').write(data)
        og_manifest[name] = (f'{SITE_URL}/assets/{fname}', w, h)
    url, w, h = og_manifest[name]
    return (f'<meta property="og:image" content="{url}">\n<meta property="og:image:width" content="{w}">\n'
            f'<meta property="og:image:height" content="{h}">\n<meta name="twitter:image" content="{url}">')

# {{EXAMPLE:slug}} or {{EXAMPLE:slug|note}} -> an interactive comic stage built
# from site/examples/<slug>.json (published from the generator's Marketing →
# Examples tab). The shared styles/script (site/example-stage.html) are added
# once per page that uses any example.
def expand_examples(html, own_slug=None):
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
        # On the example's own page the comic is the main content (loaded
        # eagerly: it is the largest thing above the fold); embedded in another
        # page it loads lazily and links to that page.
        own = slug == own_slug
        comic, coll = sentence_case(data.get('comic')), sentence_case(data.get('collection'))
        alt = data.get('imageAlt') or (f"A page from {comic or 'an original Comigo comic'}"
                                       + (f" ({coll})" if coll else '') + ', an original Comigo Spanish comic.')
        blob = json.dumps({'bubbles': data.get('bubbles', [])}, ensure_ascii=False).replace('</', '<\\/')
        htag = 'h2' if own else 'h3'
        load = 'fetchpriority="high" decoding="async"' if own else 'loading="lazy" decoding="async"'
        link = ('' if own else
                f'<p class="wrap stage-link"><a href="{ex_url(slug)}">Read &ldquo;{e(page_label(data))}&rdquo; as a full '
                'exercise, with the transcript, vocabulary and translation &rarr;</a></p>\n')
        return (f'<section class="wrap stage-wrap">\n'
                f'  <{htag} class="display stage-head">Click on a bubble</{htag}>\n'
                + (f'  <p class="stage-note">{e(note)}</p>\n' if note else '') +
                f'  <div class="stage" data-ex="{e(slug)}">\n'
                f'    <img {load} src="{{{{IMG_{data["image"]}}}}}" alt="{e(alt)}">\n'
                + '\n'.join(spots) + '\n'
                '    <div class="popup" hidden><button class="popup-x" aria-label="Close">✕</button><div class="popup-body"></div></div>\n'
                '    <div class="ex-sheet" hidden><div class="sh-head"><b></b><button class="sh-done">Done</button></div><div class="sh-body"></div></div>\n'
                '    <audio preload="none"></audio>\n'
                '    <div class="hint">\U0001F446 Tap a speech bubble</div>\n'
                '  </div>\n'
                f'  <script type="application/json" class="ex-data">{blob}</script>\n'
                '</section>\n' + link)
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

# A title with an English version shows the Spanish first and fades to the
# English every 2 seconds (page headings and example cards, all in step).
ALT_TITLE = """<style>
  .alt-title { display: grid; }
  .alt-title > span { grid-area: 1 / 1; transition: opacity 0.45s ease; }
  .alt-title > .alt-en { opacity: 0; }
  .alt-title.show-en > .alt-es { opacity: 0; }
  .alt-title.show-en > .alt-en { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .alt-title > span { transition: none; } }
</style>
<script>
  setInterval(function () {
    document.querySelectorAll('.alt-title').forEach(function (t) { t.classList.toggle('show-en'); });
  }, 2000);
</script>
"""
def alt_title(tag, es, en):
    e = lambda t: html_escape(str(t or ''), quote=True)
    if not en:
        return f'<{tag} class="display">{e(es)}</{tag}>'
    # The space between the spans isn't rendered (grid items) but keeps the two
    # titles apart in the page text ("Un pueblo pequeño A small town").
    return (f'<{tag} class="display alt-title"><span class="alt-es" lang="es">{e(es)}</span> '
            f'<span class="alt-en" lang="en" aria-hidden="true">{e(en)}</span></{tag}>')

# {{EXAMPLE_LINKS}} -> the Reading practice library: a card for every published
# example, grouped by level once there is more than one level.
# {{EXAMPLE_LINKS:slug}} -> up to RELATED_MAX cards for an example's own page:
# the same collection first, then the same level, then the rest.
RELATED_MAX = 6
LINKS_CSS = """<style>
  .ex-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 22px; padding: 18px 24px 6px; }
  .ex-level { padding: 26px 24px 0; }
  .ex-level-head { margin: 0; font-size: 1.5rem; color: var(--accent); }
  .ex-card {
    display: flex; flex-direction: column; background: var(--card); color: var(--ink); text-decoration: none;
    border: 3px solid var(--line); border-radius: 14px; overflow: hidden; box-shadow: 6px 6px 0 var(--shadow);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .ex-card:hover { transform: translate(2px, 2px); box-shadow: 4px 4px 0 var(--shadow); }
  .ex-card img { width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: cover; object-position: top; display: block; border-bottom: 3px solid var(--line); }
  .ex-card .ex-card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .ex-card .label { color: var(--accent); }
  .ex-card .ex-title { margin: 0; font-size: 1.3rem; }
  .ex-card .ex-src { font-family: system-ui, sans-serif; font-size: 0.85rem; color: var(--muted); }
  .ex-card .ex-go { font-family: system-ui, sans-serif; font-weight: 700; font-size: 0.92rem; margin-top: auto; padding-top: 4px; }
</style>
"""
def ex_card(x, htag):
    e = lambda t: html_escape(str(t or ''), quote=True)
    lvl = (x.get('level') or '').capitalize()
    title = alt_title(htag, page_label(x), x.get('labelEn')).replace('class="display', 'class="display ex-title', 1)
    return (f'  <a class="ex-card" href="{ex_url(e(x["slug"]))}">\n'
            f'    <img loading="lazy" decoding="async" src="{{{{IMG_{x["image"]}}}}}" alt="">\n'
            f'    <div class="ex-card-body">\n'
            + (f'      <span class="label">{e(lvl)}</span>\n' if lvl else '') +
            f'      {title}\n'
            + (f'      <span class="ex-src" lang="es">{e(source_line(x))}</span>\n' if source_line(x) else '') +
            f'      <span class="ex-go">Read and listen &rarr;</span>\n'
            f'    </div>\n  </a>')

def related(slug, items):
    me = next((x for x in items if x['slug'] == slug), {})
    others = [x for x in items if x['slug'] != slug]
    rank = lambda x: (0 if me.get('collection') and x.get('collection') == me.get('collection') else
                      1 if x.get('level') == me.get('level') else 2)
    return sorted(others, key=rank)[:RELATED_MAX]      # stable: library order within each rank

def expand_links(html):
    used = False
    def one(m):
        nonlocal used
        slug = m.group(1)
        items = load_examples()
        if slug:
            body = '<section class="wrap ex-links">\n' + '\n'.join(ex_card(x, 'h3') for x in related(slug, items)) + '\n</section>'
        else:
            levels = []
            for x in items:
                if (x.get('level') or '') not in levels: levels.append(x.get('level') or '')
            if len(levels) > 1:
                body = ''.join(
                    f'<div class="wrap ex-level" id="level-{lv or "other"}"><h3 class="display ex-level-head">{(lv or "Other").capitalize()}</h3></div>\n'
                    '<section class="wrap ex-links">\n'
                    + '\n'.join(ex_card(x, 'h4') for x in items if (x.get('level') or '') == lv) + '\n</section>\n'
                    for lv in levels)
            else:
                body = '<section class="wrap ex-links">\n' + '\n'.join(ex_card(x, 'h3') for x in items) + '\n</section>'
        if not items:
            return ''
        css = '' if used else LINKS_CSS
        used = True
        return css + body
    return re.sub(r'\{\{EXAMPLE_LINKS(?::([\w-]+))?\}\}', one, html)

def build(tmpl_name, out_name, html=None, nav_slug=None, own_slug=None):
    if html is None:
        html = open(os.path.join(here, tmpl_name)).read()
    html = expand_links(html)
    html, has_examples = expand_examples(html, own_slug)
    if has_examples:
        # Shared stage styles/script: appended to the page body once.
        html += '\n' + open(os.path.join(here, 'example-stage.html')).read()
    if re.search(r'class="[^"]*\balt-title\b', html):
        html += '\n' + ALT_TITLE
    # Shared navigation: {{NAV}} pulls in site/nav.html, with the current
    # page's link marked (aria-current) so it can be styled subtly.
    if '{{NAV}}' in html:
        nav = open(os.path.join(here, 'nav.html')).read()
        slug = nav_slug or out_name[:-len('.html')]
        nav = nav.replace(f'data-nav="{slug}"', f'data-nav="{slug}" aria-current="page"')
        html = html.replace('{{NAV}}', nav)
    html = re.sub(r'\{\{OGIMG_([\w-]+)\}\}', og_repl, html)
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

# Every published example also gets its own page at EX_BASE/<slug>, built from
# site/example-page.html. Pages for examples no longer published are removed.
# Its text comes from the example's JSON (published from the generator's
# Marketing → Examples): titles, summary and image description are entered once
# there; the transcript, vocabulary and language notes come from the comic.
ex_dir = os.path.join(here, 'examples')
for f in os.listdir(ex_dir):
    if f.endswith('.html') and not os.path.exists(os.path.join(ex_dir, f[:-5] + '.json')):
        os.remove(os.path.join(ex_dir, f))

# Function words left out of the "Words on this page" list.
STOP = set('a al ante con de del el ella en es la las lo los me mi mis no nos o para por que se su sus te tu tus un una unos unas y yo tú él'.split())

def seo_title(x):
    level = (x.get('level') or '').capitalize()
    base = x.get('seoTitle') or f"{x.get('labelEn') or page_label(x)}: {level + ' ' if level else ''}Spanish Reading Practice"
    return f'{base} | Comigo'

def seo_desc(x):
    if x.get('summary'):
        return x['summary']
    first = [s.get('es') for b in x.get('bubbles', []) for s in b.get('sentences', []) if s.get('es')][:2]
    return (f"A {x.get('level') or ''} Spanish comic page to read and listen to: "
            + ' '.join(f'«{t}»' for t in first) + ' Every line voiced, with translations.').replace('  ', ' ')

def study_section(x):
    e = lambda t: html_escape(str(t or ''), quote=True)
    sents = [s for b in x.get('bubbles', []) for s in b.get('sentences', []) if s.get('es')]
    if not sents:
        return ''
    lines = '\n'.join(f'      <li><span class="es" lang="es">{e(s["es"])}</span>'
                      + (f'<span class="en">{e(s["en"])}</span>' if s.get('en') else '') + '</li>' for s in sents)
    seen, vocab = set(), []
    for s in sents:
        for w in s.get('words', []):
            shown = re.sub(r'[^\w\s\'-]', '', w.get('t') or '').strip()
            key = (w.get('b') or shown).lower()
            if not shown or not w.get('m') or key in seen or shown.lower() in STOP:
                continue
            seen.add(key)
            base = w.get('b') if w.get('b') and w.get('b').lower() != shown.lower() else ''
            vocab.append(f'      <li><b lang="es">{e(shown)}</b>'
                         + (f' <span class="base">(<span lang="es">{e(base)}</span>)</span>' if base else '')
                         + f' &mdash; {e(w["m"])}</li>')
    notes = [s for s in sents if s.get('g')]
    out = ['<section class="wrap study">',
           '  <h2 class="display">Study the Spanish</h2>',
           '  <p class="hint-line">Everything on the page as text: open a section when you want it.</p>',
           '  <details class="study-block">',
           '    <summary><h3>Transcript and translation</h3></summary>',
           '    <ol class="lines">', lines, '    </ol>',
           '  </details>']
    if vocab:
        out += ['  <details class="study-block">',
                '    <summary><h3>Words on this page</h3></summary>',
                '    <ul class="vocab">', '\n'.join(vocab), '    </ul>',
                '  </details>']
    if notes:
        out += ['  <details class="study-block">',
                '    <summary><h3>Language notes</h3></summary>',
                '    <ul class="notes">',
                '\n'.join(f'      <li><span class="es" lang="es">{e(s["es"])}</span><span class="note">{e(s["g"])}</span></li>' for s in notes),
                '    </ul>',
                '  </details>']
    out.append('</section>')
    return '\n'.join(out) + '\n'

page_tmpl = open(os.path.join(here, 'example-page.html')).read()
examples = load_examples()
for x in examples:
    e = lambda t: html_escape(str(t or ''), quote=True)
    label, level = page_label(x), (x.get('level') or '')
    comic, coll = sentence_case(x.get('comic')), sentence_case(x.get('collection'))
    src = (f'A page from <i lang="es">{e(comic)}</i>' + (f', in the <i lang="es">{e(coll)}</i> collection' if coll else '')
           + ' &mdash; an original Comigo comic, voiced line by line.') if comic else 'A page from an original Comigo comic, voiced line by line.'
    intro = (f'<p>{e(x["summary"])}</p>\n  <p class="src">{src}</p>' if x.get('summary') else f'<p>{src}</p>')
    url = SITE_URL + ex_url(x['slug'])
    crumbs = json.dumps({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': SITE_URL + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Spanish reading practice', 'item': SITE_URL + '/spanish-reading-practice'},
            {'@type': 'ListItem', 'position': 3, 'name': label, 'item': url},
        ]}, ensure_ascii=False, indent=1)
    # Optional hand-written extras (comprehension questions, vocab) for this
    # page live in site/example-extras/<slug>.html.
    extra_path = os.path.join(here, 'example-extras', x['slug'] + '.html')
    extra = open(extra_path).read() if os.path.exists(extra_path) else ''
    vals = {
        'PG_TITLE': e(seo_title(x)), 'PG_DESC': e(seo_desc(x)), 'PG_URL': url,
        'PG_OG_IMAGE': f'{{{{OGIMG_{x["image"]}}}}}',
        'PG_BREADCRUMB_LD': f'<script type="application/ld+json">\n{crumbs}\n</script>',
        'PG_SLUG': x['slug'], 'PG_LABEL': e(label),
        'PG_H1': alt_title('h1', label, x.get('labelEn')),
        'PG_EYEBROW': e(f'{level.capitalize()} · Spanish reading practice' if level else 'Spanish reading practice'),
        'PG_INTRO': intro, 'PG_STUDY': study_section(x), 'PG_EXTRA': extra,
    }
    html = re.sub(r'\{\{(PG_\w+)\}\}', lambda m: vals[m.group(1)], page_tmpl)
    build('example-page.html', os.path.join('examples', x['slug'] + '.html'), html=html,
          nav_slug='spanish-reading-practice', own_slug=x['slug'])

# SEO checks: every example page needs its own title and description, and the
# summary / image description that make them useful (Marketing → Examples).
for field, fn in (('title', seo_title), ('description', seo_desc)):
    seen = {}
    for x in examples:
        seen.setdefault(fn(x), []).append(x['slug'])
    for v, slugs in seen.items():
        if len(slugs) > 1:
            print(f'WARNING: duplicate {field} on {", ".join(slugs)}: {v}')
for x in examples:
    missing = [k for k in ('summary', 'imageAlt', 'labelEn') if not x.get(k)]
    if missing:
        print(f'WARNING: {x["slug"]} has no {", ".join(missing)} (set it in Marketing → Examples, then republish)')

# IndexNow manifest: every public URL with a fingerprint of the content that
# makes it what it is. After a deploy, the server submits the URLs whose
# fingerprint changed, appeared or disappeared since its last submission
# (server/src/services/indexNow.js). Fingerprints follow CONTENT, not markup:
# a layout/CSS change or a new "related" card doesn't resubmit every page.
#   - template pages: the template's text; the hub also what its exercise cards show
#   - privacy: the file itself
#   - exercises: the published JSON (minus publishedAt) and any hand-written extras
#   - redirected old URLs: "redirect:<target>", so a new or re-pointed redirect
#     gets its old URL submitted once
def fingerprint(*parts):
    return hashlib.sha256('\x00'.join(parts).encode()).hexdigest()[:16]
index_manifest = {}
for tmpl in sorted(f for f in os.listdir(here) if f.endswith('.template.html')):
    name = tmpl.replace('.template.html', '')
    text = open(os.path.join(here, tmpl)).read()
    parts = [text]
    if '{{EXAMPLE_LINKS}}' in text:
        parts.append(json.dumps([{k: x.get(k) for k in ('slug', 'label', 'labelEn', 'level', 'comic', 'collection')} for x in examples],
                                sort_keys=True, ensure_ascii=False))
    index_manifest[SITE_URL + ('/' if name == 'index' else '/' + name)] = fingerprint(*parts)
index_manifest[SITE_URL + '/privacy'] = fingerprint(open(os.path.join(here, 'privacy.html')).read())
for x in examples:
    content = {k: v for k, v in x.items() if k != 'publishedAt'}
    extra_path = os.path.join(here, 'example-extras', x['slug'] + '.html')
    index_manifest[SITE_URL + ex_url(x['slug'])] = fingerprint(
        json.dumps(content, sort_keys=True, ensure_ascii=False),
        open(extra_path).read() if os.path.exists(extra_path) else '')
redirects_path = os.path.join(here, 'redirects.json')
for old, target in (json.load(open(redirects_path)).items() if os.path.exists(redirects_path) else []):
    index_manifest[SITE_URL + old] = 'redirect:' + target
with open(os.path.join(here, 'indexnow-manifest.json'), 'w') as fh:
    json.dump(dict(sorted(index_manifest.items())), fh, indent=1)
    fh.write('\n')
print(f'site/indexnow-manifest.json written, {len(index_manifest)} URLs')

total = sum(os.path.getsize(os.path.join(DIST, f)) for f in os.listdir(DIST))
print(f'assets-dist: {len(os.listdir(DIST))} files, {total / 1024:.0f} KB')
