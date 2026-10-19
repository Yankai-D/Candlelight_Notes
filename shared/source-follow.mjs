export const easeOutCubic = t => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

// Delay the start of following, then retarget an active animation immediately.
// The note scroller supplies direction; late PDF anchors must not reverse it.
export function createSourceFollower(root, { raf = requestAnimationFrame, cancelRaf = cancelAnimationFrame, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, reducedMotion = false } = {}) {
  let frame = 0, timer = null, pending, waitingSince = 0, generation = 0;
  let readingOffset, direction = 0, destination;
  function stopFrame() { generation++; if (frame) cancelRaf(frame); frame = 0; }
  function cancel() { stopFrame(); if (timer !== null) clearTimer(timer); timer = null; waitingSince = 0; readingOffset = undefined; direction = 0; destination = undefined; }
  function target() {
    const proposed = Math.max(0, Math.min(Math.max(0, root.scrollHeight - root.clientHeight), pending()));
    return direction > 0 ? Math.max(root.scrollTop, proposed) : direction < 0 ? Math.min(root.scrollTop, proposed) : proposed;
  }
  function start() {
    if (timer !== null) clearTimer(timer);
    timer = null; waitingSince = 0;
    stopFrame();
    const from = root.scrollTop;
    const to = target();
    destination = to;
    if (reducedMotion || Math.abs(to - from) < 1) { root.scrollTop = to; frame = 0; return; }
    const version = generation;
    const began = now(), duration = Math.min(650, 360 + Math.abs(to - from) * .12);
    function tick(time) {
      if (generation !== version) return;
      const progress = Math.min(1, (time - began) / duration);
      root.scrollTop = from + (to - from) * easeOutCubic(progress);
      frame = progress < 1 ? raf(tick) : 0;
    }
    frame = raf(tick);
  }
  return { cancel, to(getTarget, immediate = false, movement = /** @type {{ readingOffset?: number }} */ ({})) {
    pending = getTarget;
    if (immediate) { cancel(); root.scrollTop = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, pending())); return; }
    if (Number.isFinite(movement.readingOffset)) {
      if (Number.isFinite(readingOffset) && movement.readingOffset !== readingOffset) direction = Math.sign(movement.readingOffset - readingOffset);
      readingOffset = movement.readingOffset;
    } else { readingOffset = undefined; direction = 0; }
    if (frame) {
      // Do not let an old destination run for another debounce interval. Also
      // avoid restarting the easing curve for duplicate render/anchor updates.
      if (Math.abs(target() - destination) >= .5) start();
      return;
    }
    const time = now();
    if (timer === null) waitingSince = time;
    else clearTimer(timer);
    timer = setTimer(start, Math.max(0, Math.min(110, 190 - (time - waitingSince))));
  } };
}
