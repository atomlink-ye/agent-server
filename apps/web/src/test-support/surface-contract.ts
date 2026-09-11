import { expect } from 'vitest';
import { commands } from 'vitest/browser';

// One target per role, shared by every row. Surface rows choose elements,
// never different expected values. Joined disclosure corners are measured
// on the two elements that draw the outside of the composite card.
export const surfaceTargets = {
  titleHeight: '--surface-title-height',
  titleInset: '--space-6',
  cardPadding: '--space-4',
  contentGutter: '--space-6',
  collectionGap: '--space-4',
  radius: '--radius-lg',
} as const;

type SurfaceRow = {
  title: string | null;
  card: string;
  gutter: string | null;
  collection: string | null;
  joinedCard?: string;
  absent?: string;
};

export const surfaceContract = {
  agents: {
    title: '.title-bar',
    card: '.agents-card, .agents-home-file-scope',
    gutter: '.agents-main',
    collection:
      '.agents-first-screen, .agents-card-grid, .agents-capability-grid, .agents-home-files-grid',
  },
  'agents-roster': {
    title: '.title-bar',
    card: '.agents-roster-card',
    gutter: '.agents-main',
    collection: '.agents-roster-grid',
  },
  files: {
    title: '.title-bar',
    card: '.files-file-viewer',
    gutter: '.files-main',
    collection: '.files-files-grid',
  },
  observe: {
    title: '.title-bar',
    card: '.observe-metric-card, .observe-summary-status',
    gutter: '.observe-detail',
    collection: '.observe-metric-cards',
  },
  tasks: {
    title: '.title-bar',
    card: '.work-org-card, .work-org-comment',
    gutter: '.work-org-content',
    collection: '.work-org-detail-grid, .work-org-comments',
  },
  boards: {
    title: '.title-bar',
    card: '.work-board-card, .work-board-column',
    gutter: '.work-org-content',
    collection: '.work-board-canvas, .work-board-cards',
  },
  whispers: {
    title: '.title-bar, header.whisper-observer-badge',
    card: '.whisper-message',
    gutter: '.whisper-message-log',
    collection: '.whisper-message-log',
  },
  trace: {
    title: '.run-trace__header',
    card: '.run-trace__inspector, .run-trace__detail-disclosure',
    gutter: '.run-trace__canvas',
    collection: '.run-trace__body--with-inspector',
  },
  sessions: {
    title: null,
    card: '.execution-transcript__summary, .execution-transcript__messages article, .execution-transcript__answer article, .execution-transcript__event',
    gutter: '.execution-transcript__detail',
    collection: '.execution-transcript__summary dl',
    absent:
      'Embedded section; its content heading is not a workspace title bar.',
  },
  stream: {
    title: null,
    card: '.transcript__detail',
    joinedCard: '.transcript__row:has(> .transcript__detail)',
    gutter: '.execution-transcript__detail',
    collection: '.transcript__stream',
    absent:
      'Embedded in Sessions; shares the containing content gutter and has no title bar.',
  },
  dispatch: {
    title: null,
    card: '.dispatch-card',
    gutter: null,
    collection: null,
    absent:
      'Inline conversation card; title bar, page gutter and collection layout belong to its host, outside dispatch-card.css.',
  },
} as const satisfies Record<string, SurfaceRow>;

export type Surface = keyof typeof surfaceContract;

const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
const corners = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const;

function tokenPixels(token: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;visibility:hidden;width:var(${token});height:0;`;
  document.body.append(probe);
  const value = probe.getBoundingClientRect().width;
  probe.remove();
  expect(
    value,
    `${token} must resolve to a nonzero root length`,
  ).toBeGreaterThan(0);
  return value;
}

export async function assertSurfaceContract(
  host: HTMLElement,
  surface: Surface,
  locale: string,
) {
  expect(window.innerWidth).toBe(1440);
  const row: SurfaceRow = surfaceContract[surface];
  const resolved = Object.fromEntries(
    Object.entries(surfaceTargets).map(([role, token]) => [
      role,
      tokenPixels(token),
    ]),
  );
  const actual: Record<string, number[]> = {};
  const expected: Record<string, number[]> = {};
  const rectangles: Record<
    string,
    { width: number; height: number; x: number; y: number }[]
  > = {};
  const opened: HTMLDetailsElement[] = [];
  const elements = (selector: string) => {
    const matches = [...host.querySelectorAll<HTMLElement>(selector)];
    expect(matches.length, `${surface}: missing ${selector}`).toBeGreaterThan(
      0,
    );
    return matches;
  };
  const measure = (
    role: keyof typeof surfaceTargets,
    selector: string,
    read: (element: HTMLElement) => number[],
  ) => {
    const matches = elements(selector);
    const values = matches.flatMap(read);
    actual[role] = [...new Set(values)].sort((a, b) => a - b);
    expected[role] = [resolved[role]!];
    rectangles[role] = matches.map((element) => {
      const { width, height, x, y } = element.getBoundingClientRect();
      return { width, height, x, y };
    });
  };
  try {
    // A collapsed disclosure has no painted content; open it for the
    // measurement, then restore the fixture's original interaction state.
    for (const card of elements(row.card)) {
      const details = card.closest('details');
      if (details && !details.open) {
        opened.push(details);
        details.open = true;
      }
    }
    if (row.title) {
      measure('titleHeight', row.title, (element) => [
        element.getBoundingClientRect().height,
      ]);
      measure('titleInset', row.title, (element) => {
        const style = getComputedStyle(element);
        return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
      });
    }
    measure('cardPadding', row.card, (element) => {
      const style = getComputedStyle(element);
      return sides.map((side) => parseFloat(style[`padding${side}`]));
    });
    if (row.gutter)
      measure('contentGutter', row.gutter, (element) => {
        const style = getComputedStyle(element);
        return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
      });
    if (row.collection)
      measure('collectionGap', row.collection, (element) => {
        const style = getComputedStyle(element);
        expect(['grid', 'flex']).toContain(style.display);
        return [style.rowGap === 'normal' ? 0 : parseFloat(style.rowGap), style.columnGap === 'normal' ? 0 : parseFloat(style.columnGap)];
      });
    measure('radius', row.card, (element) => {
      const style = getComputedStyle(element);
      if (row.joinedCard) {
        const parentStyle = getComputedStyle(element.closest(row.joinedCard)!);
        return [
          parseFloat(parentStyle.borderTopLeftRadius),
          parseFloat(parentStyle.borderTopRightRadius),
          parseFloat(style.borderBottomRightRadius),
          parseFloat(style.borderBottomLeftRadius),
        ];
      }
      return corners.map((corner) =>
        parseFloat(style[`border${corner}Radius`]),
      );
    });
    await commands.writeFile(
      `../../.local/surface-contract/${surface}-${locale}.json`,
      JSON.stringify(
        {
          surface,
          locale,
          tokens: surfaceTargets,
          expected,
          actual,
          rectangles,
          absent: row.absent,
        },
        null,
        2,
      ),
    );
    expect
      .soft(actual, `${surface}/${locale}: shared surface token table`)
      .toEqual(expected);
  } finally {
    for (const details of opened) details.open = false;
  }
}
