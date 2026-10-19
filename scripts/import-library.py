"""Prepare a private local paper collection from an explicit JSON manifest.

Usage: python scripts/import-library.py path/to/manifest.json
Requires PyMuPDF. Original files are copied byte for byte, never rewritten.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import time
import unicodedata

import fitz

sys.stdout.reconfigure(encoding='utf-8')
workspace = Path(__file__).resolve().parent.parent
target = workspace / '.local-library'


def prepare(manifest):
    inputs = json.loads(Path(manifest).read_text(encoding='utf-8'))
    documents, sources, ids = [], [], set()
    now = int(time.time() * 1000)
    for order, item in enumerate(inputs):
        paper_id = item['id']
        if not re.fullmatch(r'[a-z0-9-]+', paper_id) or paper_id in ids:
            raise ValueError('Paper IDs must be unique lowercase slugs.')
        ids.add(paper_id)
        source = Path(item['path'])
        raw = source.read_bytes()
        if not raw.startswith(b'%PDF-') or len(raw) > 50 * 1024 * 1024:
            raise ValueError(f'Not a supported PDF: {source.name}')
        pdf = fitz.open(stream=raw, filetype='pdf')
        if not 0 < len(pdf) <= 1000:
            raise ValueError('Page count outside supported range.')
        pages = [{'number': i + 1, 'text': unicodedata.normalize('NFKC', page.get_text()).strip()} for i, page in enumerate(pdf)]
        if not any(len(page['text']) > 30 for page in pages):
            raise ValueError(f'No extractable text: {source.name}')
        sections = item.get('sections')
        if not sections:
            sections = [[title, page] for level, title, page in pdf.get_toc() if level == 1]
        if not sections:
            sections = [[f'原文 p.{page}', page] for page in range(1, len(pdf) + 1, 3)]
        if any(not 1 <= section[1] <= len(pdf) for section in sections):
            raise ValueError(f'Invalid section page: {paper_id}')
        if sections != sorted(sections, key=lambda section: section[1]):
            raise ValueError(f'Sections are not in source order: {paper_id}')
        if sections[0][1] > 1:
            sections.insert(0, ['Abstract', 1])
        chapters = []
        for i, (title, first_page) in enumerate(sections):
            # Adjacent sections can share a PDF page. Include the next heading's
            # page as context so no end-of-section paragraphs disappear.
            last_page = sections[i + 1][1] if i + 1 < len(sections) else len(pdf)
            for page in range(first_page, last_page + 1, 5):
                suffix = f' · 续 {(page - first_page) // 5 + 1}' if page != first_page else ''
                chapter_id = f'{paper_id}-s{i + 1}-p{page}'
                chapters.append({'id': chapter_id, 'title': title + suffix,
                    'sourcePages': list(range(page, min(page + 4, last_page) + 1)),
                    'status': 'empty', 'content': {'type': 'doc', 'content': [
                        {'type': 'paragraph', 'attrs': {'id': chapter_id + '-start'}, 'content': []}]}})
        if len(chapters) > 300:
            raise ValueError(f'Too many sections: {paper_id}')
        title = item.get('title') or pdf.metadata.get('title') or source.stem
        documents.append({'id': 'paper-' + paper_id, 'title': title,
            'subtitle': f"{item['authors']} · {item['year']}", 'filename': source.name,
            'kind': 'pdf', 'intent': item['intent'], 'createdAt': now, 'updatedAt': now,
            'revision': 0, 'pages': pages, 'chapters': chapters,
            'currentChapter': chapters[0]['id'], 'currentPage': 1, 'versions': [],
            'library': {key: item[key] for key in ['id', 'label', 'year', 'authors', 'group']} | {'order': order}})
        sources.append({'source': source, 'id': paper_id, 'sha256': hashlib.sha256(raw).hexdigest()})
        pdf.close()
    target.mkdir(exist_ok=True)
    # Validate the entire collection before touching an existing local edition.
    for item in sources:
        dest = target / (item['id'] + '.pdf')
        if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError(f"Existing PDF differs; use a new edition ID: {item['id']}")
    for item in sources:
        dest = target / (item['id'] + '.pdf')
        if not dest.exists():
            shutil.copy2(item['source'], dest)
        if hashlib.sha256(dest.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError(f"Copy verification failed: {item['id']}")
    catalog = {'collection': '机器学习经典原文', 'documents': documents}
    pending = target / 'catalog.pending.json'
    pending.write_text(json.dumps(catalog, ensure_ascii=False), encoding='utf-8')
    pending.replace(target / 'catalog.json')
    for doc in documents:
        print(f"{doc['library']['label']}: {len(doc['pages'])} pages, {len(doc['chapters'])} sections")
    print(f'{len(documents)} papers ready in .local-library/')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python scripts/import-library.py manifest.json')
    prepare(sys.argv[1])
