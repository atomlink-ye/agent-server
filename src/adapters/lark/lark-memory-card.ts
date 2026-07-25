import { assertCardActionToken } from '../../domain/channels/card-action.js';

export type MemoryCardAction =
  'accept' | 'edit_in_doc' | 'reject' | 'preview_doc' | 'accept_preview';

export type MemoryCardActionValue = {
  action: MemoryCardAction;
  token: string;
};

type PlainText = { tag: 'plain_text'; content: string };
type Markdown = { tag: 'markdown'; content: string };
type Divider = { tag: 'hr' };
type CallbackBehavior = {
  type: 'callback';
  value: MemoryCardActionValue;
};
type OpenUrlBehavior = { type: 'open_url'; default_url: string };
type CardButton = {
  tag: 'button';
  text: PlainText;
  type: 'primary_filled' | 'default' | 'danger';
  behaviors?: Array<CallbackBehavior | OpenUrlBehavior>;
  confirm?: { title: PlainText; text: PlainText };
};
type CardColumn = {
  tag: 'column';
  width: 'weighted';
  weight: number;
  elements: CardButton[];
};
type ButtonColumnSet = {
  tag: 'column_set';
  flex_mode: 'flow';
  columns: CardColumn[];
};
type CardElement = Markdown | Divider | ButtonColumnSet;

export type MemoryCard = {
  schema: '2.0';
  config: {
    update_multi: true;
    enable_forward: false;
    width_mode: 'default';
  };
  header: {
    template: 'blue' | 'green' | 'red';
    title: PlainText;
  };
  body: { elements: CardElement[] };
};

export type PendingMemoryInput = {
  category: string;
  content: string;
  token: string;
};

export type DocControlsInput = {
  category: string;
  excerpt: string;
  docStatus: string;
  docUrl: string;
  token: string;
  previewed: boolean;
  previewExcerpt?: string;
  previewFingerprint?: string;
};

export type ResolvedMemoryInput = {
  status: 'accepted' | 'rejected';
  category: string;
  content: string;
};

const MAX_PROPOSAL_CHARS = 1_500;
const MAX_PROPOSAL_LINES = 20;
const MAX_EXCERPT_CHARS = 1_000;
const MAX_EXCERPT_LINES = 12;

export function renderPendingMemoryCard(input: PendingMemoryInput): MemoryCard {
  validateShortProposal(input.content);
  validateToken(input.token);
  const category = safeText(input.category, 120);
  const content = boundedSafeText(
    input.content,
    MAX_PROPOSAL_CHARS,
    MAX_PROPOSAL_LINES,
  );

  return card('blue', 'Workspace memory review', [
    markdown(`**Category**\n${category}`),
    markdown(`**Proposed memory**\n${content}`),
    markdown(
      '**Source**\nProposed by the completed agent task in this thread.',
    ),
    actionRow([
      callbackButton('Accept', 'primary_filled', 'accept', input.token),
      callbackButton('Edit in Doc', 'default', 'edit_in_doc', input.token),
      callbackButton('Reject', 'danger', 'reject', input.token, true),
    ]),
  ]);
}

export function renderCardWithDocControls(input: DocControlsInput): MemoryCard {
  validateToken(input.token);
  const category = safeText(input.category, 120);
  const excerpt = boundedSafeText(
    input.excerpt,
    MAX_EXCERPT_CHARS,
    MAX_EXCERPT_LINES,
  );
  const docStatus = safeText(input.docStatus, 80);
  const docUrl = safeDocUrl(input.docUrl);

  return card('blue', 'Workspace memory review', [
    markdown(`**Category**\n${category}`),
    markdown(`**Doc status**\n${docStatus}`),
    markdown(`**Doc excerpt**\n${excerpt}`),
    actionRow([
      openButton('Open Doc', docUrl),
      callbackButton('Accept', 'primary_filled', 'accept', input.token),
      callbackButton('Reject', 'danger', 'reject', input.token, true),
    ]),
  ]);
}

export function renderResolvedMemoryCard(
  input: ResolvedMemoryInput,
): MemoryCard {
  const accepted = input.status === 'accepted';
  return card(
    accepted ? 'green' : 'red',
    accepted ? 'Memory accepted' : 'Memory rejected',
    [
      markdown(`**Category**\n${safeText(input.category, 120)}`),
      markdown(
        `**${accepted ? 'Accepted memory' : 'Rejected memory'}**\n${boundedSafeText(input.content, MAX_EXCERPT_CHARS, MAX_EXCERPT_LINES)}`,
      ),
    ],
  );
}

function card(
  template: MemoryCard['header']['template'],
  title: string,
  elements: CardElement[],
): MemoryCard {
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      enable_forward: false,
      width_mode: 'default',
    },
    header: { template, title: plain(title) },
    body: { elements },
  };
}

function markdown(content: string): Markdown {
  return { tag: 'markdown', content };
}

function actionRow(actions: CardButton[]): ButtonColumnSet {
  return {
    tag: 'column_set',
    flex_mode: 'flow',
    columns: actions.map((button) => ({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [button],
    })),
  };
}

function callbackButton(
  label: string,
  type: CardButton['type'],
  action: MemoryCardAction,
  token: string,
  confirm = false,
  docUrl?: string,
): CardButton {
  const button: CardButton = {
    tag: 'button',
    text: plain(label),
    type,
    behaviors: [{ type: 'callback', value: { action, token } }],
  };
  if (confirm) {
    button.confirm = {
      title: plain('Confirm rejection'),
      text: plain('Reject this memory proposal?'),
    };
  }
  if (docUrl) {
    button.behaviors = [
      { type: 'callback', value: { action, token } },
      { type: 'open_url', default_url: docUrl },
    ];
  }
  return button;
}

function openButton(label: string, url: string): CardButton {
  return {
    tag: 'button',
    text: plain(label),
    type: 'default',
    behaviors: [{ type: 'open_url', default_url: url }],
  };
}

function plain(content: string): PlainText {
  return { tag: 'plain_text', content };
}

function boundedSafeText(
  value: string,
  maxChars: number,
  maxLines: number,
): string {
  const lines = value.split(/\r?\n/).slice(0, maxLines);
  let bounded = lines.join('\n');
  if (bounded.length > maxChars) bounded = bounded.slice(0, maxChars);
  return escapeMarkdown(bounded);
}

function safeText(value: string, maxChars: number): string {
  return escapeMarkdown(value.slice(0, maxChars));
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/<at\b[^>]*>[\s\S]*?<\/at>/gi, '[mention removed]')
    .replace(/<at\b[^>]*>/gi, '[mention removed]')
    .replace(/<\/at>/gi, '')
    .replace(/[\\`*_~\[\]()<>#{}]/g, '\\$&');
}

function safeDocUrl(value: string): string {
  return /^https?:\/\/[^\s]+$/i.test(value) ? value : 'about:blank';
}

function validateShortProposal(value: string): void {
  if (
    value.length > MAX_PROPOSAL_CHARS ||
    value.split(/\r?\n/).length > MAX_PROPOSAL_LINES
  ) {
    throw new Error('proposal content does not fit the short Card; use a Doc');
  }
}

function validateToken(value: string): void {
  assertCardActionToken(value);
}
