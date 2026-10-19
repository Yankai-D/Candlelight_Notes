// Runs in the isolated print renderer. Keep it free of module-scope references.
export function freezePrintLayout() {
  function activeRules(rules) {
    return [...rules].map(rule => rule instanceof CSSMediaRule
      ? (matchMedia(rule.conditionText).matches ? activeRules(rule.cssRules) : '')
      : rule.cssText).join('\n');
  }
  const css = [...document.styleSheets].map(sheet => activeRules(sheet.cssRules)).join('\n');
  document.querySelectorAll('style').forEach(style => style.remove());
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
}
