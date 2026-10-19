import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSourceFollower } from '../shared/source-follow.mjs';

function fixture() {
  let time = 0, serial = 0;
  const frames = new Map(), timers = new Map();
  const root = { scrollTop: 0, scrollHeight: 5000, clientHeight: 400 };
  const follower = createSourceFollower(root, {
    now: () => time,
    raf: fn => { frames.set(++serial, fn); return serial; }, cancelRaf: id => frames.delete(id),
    setTimer: (fn, delay) => { timers.set(++serial, { fn, at: time + delay }); return serial; }, clearTimer: id => timers.delete(id),
  });
  function advance(to) {
    for (; time < to;) {
      time = Math.min(to, time + 10);
      for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); }
      for (const [id, fn] of [...frames]) { frames.delete(id); fn(time); }
    }
  }
  const update = (target, readingOffset) => follower.to(() => target, false, { readingOffset });
  return { follower, root, frames, timers, advance, update };
}

test('continuous downward reading never folds backward when a late quote corrects an estimate', () => {
  const f = fixture();
  f.update(700, 0); f.advance(110);
  f.update(800, 100); f.advance(220);
  const positions = [f.root.scrollTop];
  assert.ok(positions[0] > 100);
  // The PDF quote resolves above a position the preview has already reached.
  f.update(100, 100);
  for (let t = 230; t <= 400; t += 10) { f.advance(t); positions.push(f.root.scrollTop); }
  f.update(900, 200);
  for (let t = 410; t <= 1100; t += 10) { f.advance(t); positions.push(f.root.scrollTop); }
  assert.ok(positions.every((p, i) => i === 0 || p >= positions[i - 1]));
  assert.equal(f.root.scrollTop, 900);
});

test('new targets take effect during an animation without letting its old destination overshoot', () => {
  const f = fixture();
  f.update(1500, 0); f.advance(110);
  f.update(1500, 100); f.advance(200);
  const target = f.root.scrollTop + 15;
  const obsoleteFrame = [...f.frames.values()][0];
  f.update(target, 120);
  const before = f.root.scrollTop;
  obsoleteFrame(600);
  assert.equal(f.root.scrollTop, before, 'A canceled animation cannot write an obsolete scroll position');
  for (let t = 210; t <= 900; t += 10) { f.advance(t); assert.ok(f.root.scrollTop <= target); }
  assert.equal(f.root.scrollTop, target);
});

test('upward reading follows immediately and stale higher anchors cannot reverse it', () => {
  const f = fixture();
  f.update(1100, 0); f.advance(110);
  f.update(1200, 100); f.advance(300);
  const previous = f.root.scrollTop;
  f.update(50, 80); f.advance(310);
  assert.ok(f.root.scrollTop < previous, 'A real direction change must not wait for the previous animation');
  const reversed = f.root.scrollTop;
  f.update(1500, 80); f.advance(500);
  assert.equal(f.root.scrollTop, reversed);
  f.update(20, 40); f.advance(1200);
  assert.equal(f.root.scrollTop, 20);
});

test('explicit page navigation resets direction protection; duplicate renders do not restart easing', () => {
  const f = fixture();
  f.update(800, 0); f.advance(110);
  f.update(800, 100);
  for (let t = 120; t <= 700; t += 10) { f.advance(t); f.update(800, 100); }
  assert.equal(f.root.scrollTop, 800);
  f.follower.to(() => 30); f.advance(1500);
  assert.equal(f.root.scrollTop, 30, 'The page selector is allowed to go backward');
  f.update(1800, 200); f.advance(1700);
  const obsolete = [...f.frames.values()][0];
  f.follower.cancel(); const stopped = f.root.scrollTop;
  obsolete?.(3000); f.advance(3000);
  assert.equal(f.root.scrollTop, stopped);
});
