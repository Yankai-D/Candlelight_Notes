"""Rebuild the licensed, public course fixture from the prepared PDFs.

The output is source data, never a trusted instruction or a model evaluation.
Original PDFs are optional at test time; the checked-in extracted fixture is used.
"""
import hashlib
import json
from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[1]
package = root / 'output/pdf/descriptive-statistics'
manifest = json.loads((package / 'manifest.json').read_text(encoding='utf-8'))
sources = []
for entry in manifest['sources']:
    path = package / entry['output']
    pdf = fitz.open(path)
    mappings = {p['pdf_page']: p['source_pdf_page'] for p in entry['page_mapping'] if p.get('source_pdf_page')}
    sources.append({
        'id': entry['id'], 'title': entry['source_title'],
        'file': entry['output'], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'authors': entry['authors'], 'contributors': entry.get('contributors', []),
        'url': entry['source_url'], 'license': entry['license'], 'licenseUrl': entry['license_url'],
        'pages': [{'number': i + 1, 'originalPage': mappings.get(i + 1),
                   'kind': 'content' if i + 1 in mappings else 'notice',
                   'text': page.get_text(),
                   # This fixture has known image-only formula slides. They
                   # remain unavailable until a reviewed transcription exists.
                   'needsReview': entry['id'] == 'numerical' and mappings.get(i + 1) in [8, 33, 38]}
                  for i, page in enumerate(pdf)]
    })
out = root / 'examples/course/descriptive-statistics/sources.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'status': 'public-source-fixture', 'sources': sources}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {out.relative_to(root)} ({len(sources)} sources)')
