import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { parseOverflow, sourceScrollInventory } from './scroll-inventory';

it('finds known scroll owners and excludes similarly named text properties', async () => {
  expect(window.innerWidth).toBe(1440);
  const control = parseOverflow(
    'control.css',
    `
    /* .fake { overflow: hidden } */
    .actual { overflow-y: auto; text-overflow: ellipsis; overflow-wrap: anywhere; }
    @media (max-width: 700px) { .mobile { overflow: scroll; } }
  `,
  );
  expect(control).toHaveLength(2);
  expect(control[0]).toMatchObject({
    selector: '.actual',
    property: 'overflow-y',
    value: 'auto',
    active: true,
  });
  expect(control[1]).toMatchObject({ selector: '.mobile', active: false });
  const inventory = sourceScrollInventory();
  expect(inventory.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file: '/src/index.css',
        selector: '.scroll-region',
        property: 'overflow',
        value: 'auto',
      }),
      expect.objectContaining({
        file: '/src/features/work/components/work-list.css',
        selector: '.work-pane-scroll > .work-list',
        property: 'overflow',
        value: 'visible',
      }),
    ]),
  );
  expect(inventory.sourceSites).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file: '/src/features/work/WorkPane.tsx',
        text: '<div className="work-pane-scroll scroll-region">',
      }),
      expect.objectContaining({
        file: '/src/features/work/components/panes/work-chat-pane.tsx',
        text: 'history.scrollTop = history.scrollHeight;',
      }),
    ]),
  );
  await commands.writeFile(
    '../../.local/browser/scroll-source-inventory.json',
    JSON.stringify(inventory, null, 2),
  );
});
