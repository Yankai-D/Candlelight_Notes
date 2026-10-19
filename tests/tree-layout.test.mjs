import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTree } from '../src/tree-layout.ts';

test('tree layout exposes every document at readable size without placeholder categories or a camera', () => {
  const domain = { id: 'ml', label: '机器学习', documentIds: Array.from({ length: 12 }, (_, index) => `paper-${index}`), topics: [] };
  domain.topics = [{ id: 'pending', label: '', description: '', unclassified: true, documentIds: domain.documentIds }];
  for (const width of [290, 360, 700, 1144]) {
    const tree = layoutTree([domain], width, 645);
    const boughs = tree.domains.flatMap(domain => domain.boughs), leaves = boughs.flatMap(bough => bough.leaves);
    assert.deepEqual(leaves.map(leaf => leaf.id), domain.documentIds);
    assert.equal(boughs.some(bough => bough.label), false);
    for (const leaf of leaves) {
      assert.ok(leaf.x >= 0 && leaf.x + leaf.width <= width, `Leaf ${leaf.id} lies inside ${width}px width`);
      assert.ok(leaf.y >= 24 && leaf.y + 52 < tree.root.y, `Leaf ${leaf.id} lies above the roots`);
    }
  }
});

test('classified branches retain their labels while large topics unfold all their leaves', () => {
  const domains = [{ id: 'ml', label: '机器学习', documentIds: Array.from({ length: 11 }, (_, i) => String(i)),
    topics: [{ id: 'training', label: '训练与优化', description: '', documentIds: ['0','1','2','3','4','5','6','7'] },
      { id: 'architecture', label: '架构', description: '', documentIds: ['8','9','10'] }] }];
  const tree = layoutTree(domains, 1144, 645);
  assert.deepEqual(tree.domains[0].boughs.map(bough => bough.label).filter(Boolean), ['训练与优化', '架构']);
  assert.equal(tree.domains[0].boughs.flatMap(bough => bough.leaves).length, 11);
  assert.equal(tree.height, 645, 'The desktop collection fits the available height without scrolling');
});
