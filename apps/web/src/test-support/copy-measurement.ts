import { expect } from 'vitest';

export function measureCopy(element: HTMLElement, beforeText: string) {
  const control =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement;
  const afterText = control ? element.value : element.textContent!;
  const read = () => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const textBox = range.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      textWidth: control ? element.scrollWidth : textBox.width,
      textHeight: control ? element.scrollHeight : textBox.height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  };
  const textNode = [...element.childNodes].find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  );
  const original = textNode?.textContent ?? '';
  if (control) element.value = beforeText;
  else {
    expect(textNode, 'Copy must have a measurable text node').toBeDefined();
    textNode!.textContent = beforeText;
  }
  const before = read();
  if (control) element.value = afterText;
  else textNode!.textContent = original;
  const after = read();
  expect(window.innerWidth).toBe(1440);
  expect(after.width).toBeGreaterThan(0);
  expect(after.scrollWidth, afterText).toBeLessThanOrEqual(after.clientWidth);
  expect(after.scrollHeight, afterText).toBeLessThanOrEqual(after.clientHeight);
  if (!control) {
    expect(after.textWidth, afterText).toBeLessThanOrEqual(after.width + 1);
    expect(after.textHeight, afterText).toBeLessThanOrEqual(after.height + 1);
  }
  return { before, after };
}

export function findCopy(
  host: HTMLElement,
  text: string,
  selector = '*',
): HTMLElement {
  const elements = [...host.querySelectorAll<HTMLElement>(selector)];
  const found = elements.find(
    (element) =>
      element.textContent?.trim() === text.trim() &&
      ![...element.children].some(
        (child) => child.textContent?.trim() === text.trim(),
      ),
  );
  expect(found, `Rendered copy: ${text}`).toBeDefined();
  return found!;
}

/** Native select/placeholder glyphs have no DOM Range: measure the same font
 * in a browser span and compare against the real control's available width. */
export function measureControlCopy(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  beforeText: string,
  afterText: string,
) {
  const style = getComputedStyle(element);
  const span = document.createElement('span');
  span.style.cssText = `position:absolute;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing}`;
  document.body.append(span);
  const read = (text: string) => {
    span.textContent = text;
    const box = element.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      textWidth: span.getBoundingClientRect().width,
      textHeight: span.getBoundingClientRect().height,
    };
  };
  try {
    const before = read(beforeText);
    const after = read(afterText);
    const availableWidth =
      element.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      (element instanceof HTMLSelectElement ? 24 : 0);
    expect(window.innerWidth).toBe(1440);
    expect(after.textWidth).toBeLessThanOrEqual(availableWidth);
    return {
      before,
      after,
      availableWidth,
      method: 'same-font DOM text proxy in native control',
    };
  } finally {
    span.remove();
  }
}
