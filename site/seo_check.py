#!/usr/bin/env python3
"""SEO checks on the built site (run after build.py): every public page has one
title, description, canonical and H1, sensible heading order, no noindex, images
with alt text and dimensions, valid JSON-LD, and internal links that resolve.
Canonicals must match the sitemap URLs the server generates.

Usage: python3 site/seo_check.py        (exit code 1 if anything fails)
"""
import json, os, re, sys
from html.parser import HTMLParser

here = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://comigo.net'
EX_BASE = '/spanish-reading-practice'

def public_pages():
    """(url path, file) for every page the sitemap lists — same rules as the server."""
    out = []
    for f in sorted(os.listdir(here)):
        if f.endswith('.html') and '.template.' not in f and f not in ('example-page.html', 'example-stage.html', 'nav.html'):
            out.append(('/' if f == 'index.html' else '/' + f[:-5], os.path.join(here, f)))
    ex = os.path.join(here, 'examples')
    for f in sorted(os.listdir(ex)):
        if f.endswith('.html'):
            out.append((f'{EX_BASE}/' + f[:-5], os.path.join(ex, f)))
    return out

class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.meta, self.links, self.imgs, self.headings, self.ld = '', {}, [], [], [], []
        self.canonical = None
        self._in = None; self._buf = ''
    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == 'title': self._in, self._buf = 'title', ''
        elif tag == 'meta' and (a.get('name') or a.get('property')): self.meta[a.get('name') or a.get('property')] = a.get('content', '')
        elif tag == 'link' and a.get('rel') == 'canonical': self.canonical = a.get('href')
        elif tag == 'a' and a.get('href'): self.links.append(a['href'])
        elif tag == 'img': self.imgs.append(a)
        elif re.fullmatch(r'h[1-6]', tag): self._in, self._buf, self._h = 'h', '', int(tag[1])
        elif tag == 'script' and a.get('type') == 'application/ld+json': self._in, self._buf = 'ld', ''
    def handle_endtag(self, tag):
        if self._in == 'title' and tag == 'title': self.title = self._buf.strip(); self._in = None
        elif self._in == 'h' and re.fullmatch(r'h[1-6]', tag): self.headings.append((self._h, ' '.join(self._buf.split()))); self._in = None
        elif self._in == 'ld' and tag == 'script': self.ld.append(self._buf); self._in = None
    def handle_data(self, d):
        if self._in: self._buf += d

def main():
    pages = public_pages()
    known = {u for u, _ in pages} | {'/privacy', '/go/app-store'}   # /go/app-store: counted App Store redirect
    redirects = json.load(open(os.path.join(here, 'redirects.json'))) if os.path.exists(os.path.join(here, 'redirects.json')) else {}
    problems, titles, descs, rows = [], {}, {}, []
    for url, f in pages:
        p = Page(); p.feed(open(f).read())
        bad = lambda m: problems.append(f'{url}: {m}')
        if not p.title: bad('no <title>')
        desc = p.meta.get('description', '')
        if not desc: bad('no meta description')
        if 'noindex' in p.meta.get('robots', ''): bad('noindex')
        want = SITE + ('/' if url == '/' else url)
        if url != '/privacy' and p.canonical != want: bad(f'canonical {p.canonical!r} != {want}')
        h1 = [t for lvl, t in p.headings if lvl == 1]
        if len(h1) != 1: bad(f'{len(h1)} H1s')
        prev = 0
        for lvl, t in p.headings:
            if lvl > prev + 1 and prev: bad(f'heading jumps h{prev} -> h{lvl} at "{t[:40]}"')
            prev = lvl
        for im in p.imgs:
            if 'alt' not in im: bad(f'img without alt: {im.get("src")}')
            if not (im.get('width') and im.get('height')) and not str(im.get('src', '')).startswith('data:'):
                bad(f'img without width/height: {im.get("src")}')
        for block in p.ld:
            try: json.loads(block)
            except Exception as e: bad(f'invalid JSON-LD: {e}')
        for href in p.links:
            if href.startswith('/') and not href.startswith('//'):
                path = href.split('#')[0].split('?')[0]
                if path in redirects: bad(f'internal link to a redirected URL {href}')
                elif path and path not in known and not path.startswith('/assets/'): bad(f'broken internal link {href}')
        if url.startswith(EX_BASE + '/'):
            for k in ('og:title', 'og:description', 'og:image', 'og:url'):
                if not p.meta.get(k): bad(f'no {k}')
            if '/spanish-reading-practice' not in p.links: bad('no link back to the reading-practice hub')
        titles.setdefault(p.title, []).append(url); descs.setdefault(desc, []).append(url)
        rows.append((url, p.title, h1[0] if h1 else '', p.canonical))
    for v, us in list(titles.items()) + list(descs.items()):
        if v and len(us) > 1: problems.append(f'duplicate title/description on {", ".join(us)}: {v[:60]}')
    hub = Page(); hub.feed(open(os.path.join(here, 'spanish-reading-practice.html')).read())
    for url, _ in pages:
        if url.startswith(EX_BASE + '/') and url not in hub.links:
            problems.append(f'{url} is not linked from /spanish-reading-practice')
    # Redirects: each old URL points straight at a live page (no chains), and
    # nothing redirected is still a page of its own.
    for old, new in redirects.items():
        if new not in known: problems.append(f'redirect {old} -> {new}: target is not a page')
        if old in known: problems.append(f'redirect {old} is also a live page')
    # The sitemap manifest (site/sitemap.json, served as /sitemap.xml) must list
    # exactly the public pages, each with a date and (exercises) an image.
    sm_path = os.path.join(here, 'sitemap.json')
    sm = json.load(open(sm_path)) if os.path.exists(sm_path) else None
    if sm is None:
        problems.append('site/sitemap.json missing (run build.py)')
    else:
        want_urls = {SITE + ('/' if u == '/' else u) for u, _ in pages} | {SITE + '/privacy'}
        for u in want_urls - set(sm): problems.append(f'sitemap.json: {u} missing')
        for u in set(sm) - want_urls: problems.append(f'sitemap.json: {u} is not a public page')
        for u, v in sm.items():
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(v.get('lastmod', ''))): problems.append(f'sitemap.json: {u} has no lastmod date')
            if u.startswith(SITE + EX_BASE + '/') and not (v.get('image') or {}).get('loc', '').startswith(SITE + '/assets/'):
                problems.append(f'sitemap.json: {u} has no page image')
            if 'noindex' in str(v): problems.append(f'sitemap.json: {u} carries noindex')
    for url, title, h1, can in rows:
        print(f'{url}\n    title: {title}\n    h1:    {h1}\n    canonical: {can}')
    print(f'\n{len(pages)} pages checked')
    for m in problems: print('FAIL', m)
    print('OK — no problems' if not problems else f'{len(problems)} problem(s)')
    sys.exit(1 if problems else 0)

if __name__ == '__main__':
    main()
