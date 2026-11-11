"""Merge Chromium's vector diagram pages into a bookmarked PDF atlas."""
from pathlib import Path
import json
import sys

from pypdf import PdfReader, PdfWriter

temp, output = map(Path, sys.argv[1:3])
manifest = json.loads((temp / 'atlas-manifest.json').read_text(encoding='utf-8'))
writer = PdfWriter()
expected = len(manifest['diagrams']) + 1
for index in range(expected):
    file = temp / 'pages' / f'{index:02}.pdf'
    reader = PdfReader(file)
    if len(reader.pages) != 1:
        raise ValueError(f'{file} contains {len(reader.pages)} pages; expected one.')
    writer.append(reader, import_outline=False)
writer.add_outline_item('Contents', 0)
for source in manifest['sources']:
    diagrams = [d for d in manifest['diagrams'] if d['source'] == source['source']]
    parent = writer.add_outline_item(source['title'], diagrams[0]['page'] - 1)
    for diagram in diagrams:
        writer.add_outline_item(diagram['heading'], diagram['page'] - 1, parent=parent)
writer.page_mode = '/UseOutlines'
writer.add_metadata({
    '/Title': 'Club BCI - Visual Map Atlas',
    '/Author': 'Club BCI',
    '/Subject': 'Runtime, EEG, recording, code, user journeys, builds and tools',
})
target = output / 'visual-maps.pdf'
with target.open('wb') as stream:
    writer.write(stream)
check = PdfReader(target)
assert len(check.pages) == expected
for index, page in enumerate(check.pages):
    assert page.extract_text().strip(), f'Blank page {index + 1}'
print(f'Created {target}: {expected} pages with section and diagram bookmarks.')
