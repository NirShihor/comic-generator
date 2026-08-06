#!/usr/bin/env python3
"""Build the Comigo landing page: inlines site/assets images into index.template.html
as data URIs, producing a single self-contained site/index.html.

Usage: python3 site/build.py
"""
import base64, re, os, sys

here = os.path.dirname(os.path.abspath(__file__))
html = open(os.path.join(here, 'index.template.html')).read()

def repl(m):
    name = m.group(1)
    for ext, mime in (('jpg', 'jpeg'), ('png', 'png')):
        p = os.path.join(here, 'assets', f'{name}.{ext}')
        if os.path.exists(p):
            return f'data:image/{mime};base64,' + base64.b64encode(open(p, 'rb').read()).decode()
    sys.exit(f'missing asset: {name}')

out = re.sub(r'\{\{IMG_([\w-]+)\}\}', repl, html)
if '{{IMG_' in out:
    sys.exit('unreplaced token remains')

# The template has no document skeleton (it doubles as a Claude Artifact source,
# which supplies its own). Split at the end of the style block and wrap.
head, sep, body = out.partition('</style>')
if not sep:
    sys.exit('template missing </style>')
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
       + head + sep + '\n</head>\n<body>' + body + '\n</body>\n</html>\n')

open(os.path.join(here, 'index.html'), 'w').write(doc)
print('site/index.html written,', os.path.getsize(os.path.join(here, 'index.html')), 'bytes')
