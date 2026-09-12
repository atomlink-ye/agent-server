import { sourceScrollInventory } from './scroll-inventory';
import { expect } from 'vitest';

const declarations = sourceScrollInventory().declarations;
const label = (el: Element) =>
  el.tagName.toLowerCase() +
  (el.id ? `#${el.id}` : '') +
  [...el.classList].map((name) => `.${name}`).join('');
const rectangle = (rect: DOMRect) => ({
  top: rect.top,
  bottom: rect.bottom,
  left: rect.left,
  right: rect.right,
  width: rect.width,
  height: rect.height,
});
const visible = (el: Element) =>
  el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
const canScroll = (el: HTMLElement, axis: 'x' | 'y') => {
  const style = getComputedStyle(el);
  return (
    /^(auto|scroll)$/.test(axis === 'y' ? style.overflowY : style.overflowX) &&
    (axis === 'y'
      ? el.scrollHeight > el.clientHeight + 1
      : el.scrollWidth > el.clientWidth + 1)
  );
};

/** Measure every rendered owner, including native controls without authored overflow.
 * Bring the owner's end into the ancestor viewport first, then move only that
 * owner. Nested independent regions retain their own ownership boundaries.
 * No fixture content or production styles are changed by this probe.
 */
export function probeScrollRegions(host: HTMLElement) {
  const coverage = declarations.map((declaration) => {
    const matches = [
      ...host.querySelectorAll<HTMLElement>(declaration.selector),
    ];
    if (document.body.matches(declaration.selector))
      matches.push(document.body);
    return {
      ...declaration,
      matches: matches.length,
      elements: matches.map(label),
      visible: matches.filter(visible).length,
    };
  });
  const elements = [...host.querySelectorAll<HTMLElement>('*')].filter(
    (el) => visible(el) && el.clientHeight > 0 && el.clientWidth > 0,
  );
  const positions = elements.map((el) => ({
    el,
    x: el.scrollLeft,
    y: el.scrollTop,
  }));
  const regions = elements
    .filter((el) => {
      const style = getComputedStyle(el);
      return (
        /^(auto|scroll)$/.test(style.overflowY) ||
        /^(auto|scroll)$/.test(style.overflowX)
      );
    })
    .map((el) => {
      const style = getComputedStyle(el);
      const axes = (['x', 'y'] as const).filter((axis) => canScroll(el, axis));
      const before = {
        rect: rectangle(el.getBoundingClientRect()),
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
      };
      const probes = axes.map((axis) => {
        el.scrollIntoView({ block: 'end', inline: 'end', behavior: 'instant' });
        if (axis === 'y') el.scrollTop = 0;
        else el.scrollLeft = 0;
        const ancestors: HTMLElement[] = [];
        for (
          let parent = el.parentElement;
          parent;
          parent = parent.parentElement
        )
          ancestors.push(parent);
        const ancestorPositions = ancestors.map((parent) => [
          parent.scrollLeft,
          parent.scrollTop,
        ]);
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode())
          textNodes.push(node as Text);
        let last: Text | null = null;
        let lastOffset = 0;
        let furthest = -Infinity;
        for (const node of textNodes) {
          if (
            !node.textContent?.trim() ||
            !node.parentElement ||
            !visible(node.parentElement)
          )
            continue;
          // An inner scrollport owns its own text; it is audited separately.
          let parent = node.parentElement;
          let truncated = false;
          while (parent !== el && !canScroll(parent, axis)) {
            const style = getComputedStyle(parent);
            if (
              Number(style.webkitLineClamp) > 0 ||
              style.textOverflow === 'ellipsis' ||
              style.clipPath !== 'none' ||
              style.clip !== 'auto'
            )
              truncated = true;
            parent = parent.parentElement!;
          }
          if (parent !== el || truncated) continue;
          const text = node as Text;
          if (axis === 'y') {
            const range = document.createRange();
            const offset = Math.max(0, text.length - 1);
            range.setStart(text, offset);
            range.setEnd(text, offset + 1);
            const edge = range.getBoundingClientRect().bottom;
            if (edge > furthest) {
              last = text;
              lastOffset = offset;
              furthest = edge;
            }
          } else {
            // The final DOM line may be shorter than an earlier code line.
            // Find the actual rightmost line ending, not the last text node.
            let index = 0;
            for (const line of text.data.split('\n')) {
              if (line.length) {
                const range = document.createRange();
                const offset = index + line.length - 1;
                range.setStart(text, offset);
                range.setEnd(text, offset + 1);
                const edge = range.getBoundingClientRect().right;
                if (edge > furthest) {
                  last = text;
                  lastOffset = offset;
                  furthest = edge;
                }
              }
              index += line.length + 1;
            }
          }
        }
        if (axis === 'y') {
          el.scrollTop = 0;
          el.scrollTop = el.scrollHeight;
        } else {
          el.scrollLeft = 0;
          el.scrollLeft = el.scrollWidth;
        }
        const offset = axis === 'y' ? el.scrollTop : el.scrollLeft;
        const maximum =
          axis === 'y'
            ? el.scrollHeight - el.clientHeight
            : el.scrollWidth - el.clientWidth;
        let endpoint: ReturnType<typeof rectangle> | null = null;
        const native =
          el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
        if (native) {
          endpoint = rectangle(el.getBoundingClientRect());
        } else if (last) {
          const range = document.createRange();
          range.setStart(last, lastOffset);
          range.setEnd(last, lastOffset + 1);
          endpoint = rectangle(range.getBoundingClientRect());
        }
        const contentAncestors: HTMLElement[] = [];
        for (
          let parent = last?.parentElement;
          parent;
          parent = parent.parentElement
        )
          contentAncestors.push(parent);
        const clips = (
          !native && last ? contentAncestors : [el, ...ancestors]
        ).flatMap((parent) => {
          const parentStyle = getComputedStyle(parent);
          const bounds = parent.getBoundingClientRect();
          const clipping =
            axis === 'y'
              ? parentStyle.overflowY !== 'visible'
              : parentStyle.overflowX !== 'visible';
          if (!clipping || !endpoint) return [];
          const clipped =
            axis === 'y'
              ? endpoint.bottom > bounds.bottom + 1 ||
                endpoint.top < bounds.top - 1
              : endpoint.right > bounds.right + 1 ||
                endpoint.left < bounds.left - 1;
          return clipped
            ? [
                {
                  selector: label(parent),
                  rect: rectangle(bounds),
                  overflow:
                    axis === 'y'
                      ? parentStyle.overflowY
                      : parentStyle.overflowX,
                },
              ]
            : [];
        });
        const ancestorsMoved = ancestors
          .filter(
            (parent, index) =>
              parent.scrollLeft !== ancestorPositions[index]![0] ||
              parent.scrollTop !== ancestorPositions[index]![1],
          )
          .map(label);
        return {
          axis,
          offset,
          maximum,
          endpoint,
          lastText: last?.textContent?.slice(-80) ?? null,
          clips,
          ancestorsMoved,
          ownerCount: last
            ? contentAncestors
                .slice(0, contentAncestors.indexOf(el) + 1)
                .filter((parent) => canScroll(parent, axis)).length
            : null,
          native,
          endpointKind: native ? 'native-control-viewport' : 'text-glyph',
          endpointElement: native
            ? label(el)
            : last?.parentElement
              ? label(last.parentElement)
              : null,
          reachedMaximum: offset > 0 && Math.abs(offset - maximum) <= 1,
        };
      });
      return {
        selector: label(el),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        before,
        probes,
      };
    });
  for (const { el, x, y } of positions) {
    el.scrollLeft = x;
    el.scrollTop = y;
  }
  return { coverage, regions };
}

/** Active overflow alone is insufficient: pin movement and visible endpoints. */
export function expectMeasuredScrollRegions(
  result: ReturnType<typeof probeScrollRegions>,
) {
  for (const region of result.regions) {
    for (const probe of region.probes) {
      const context = `${region.selector} ${probe.axis}`;
      expect.soft(probe.reachedMaximum, context).toBe(true);
      expect.soft(probe.ancestorsMoved, context).toEqual([]);
      expect.soft(probe.endpoint, context).not.toBeNull();
      expect.soft(probe.clips, context).toEqual([]);
      if (!probe.native) {
        expect.soft(probe.ownerCount, context).toBe(1);
      }
    }
  }
}
