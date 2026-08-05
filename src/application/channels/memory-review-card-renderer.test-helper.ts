import type { MemoryReviewCardRenderer } from '../ports/memory-review-card-renderer.js';

const card = (token: string, title: string) => ({
  schema: '2.0',
  config: {
    update_multi: true,
    enable_forward: false,
    width_mode: 'default',
  },
  header: {
    template: 'blue',
    title: { tag: 'plain_text', content: title },
  },
  body: {
    elements: [
      { tag: 'markdown', content: 'test' },
      { tag: 'markdown', content: 'test' },
      { tag: 'markdown', content: 'test' },
      {
        tag: 'column_set',
        flex_mode: 'flow',
        columns: [
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [
              {
                tag: 'button',
                text: { tag: 'plain_text', content: 'Test' },
                type: 'primary_filled',
                behaviors: [
                  { type: 'callback', value: { action: 'accept', token } },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
});

export const testMemoryReviewCardRenderer: MemoryReviewCardRenderer = {
  renderPending: ({ token }) => card(token, 'Workspace memory review'),
  renderWithDocumentControls: ({ token }) =>
    card(token, 'Workspace memory review'),
  renderResolved: ({ status }) => card('', `Memory ${status}`),
};
