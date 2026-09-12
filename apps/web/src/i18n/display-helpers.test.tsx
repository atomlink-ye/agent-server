import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import {
  workRunFailureMessage,
  ProductMutationError,
} from '../features/work/clients/errors';
import { setLocale } from './index';
import { CommentCount } from '../features/work-organization/WorkItemMeta';
import { MentionedText } from '../features/work-organization/MentionedText';
import { claimBlockedReason } from '../features/work-organization/work-item-extensions';
import type { WorkItemDto } from '@atomlink-ye/agent-server/product-contract';

afterEach(() => setLocale('en'));
it.each(['en', 'zh-CN'] as const)(
  'localizes comments, mentions and claim reasons in %s',
  (locale) => {
    setLocale(locale);
    expect(renderToStaticMarkup(<CommentCount count={2} />)).toContain(
      locale === 'en' ? ' comments' : ' 条评论',
    );
    expect(renderToStaticMarkup(<CommentCount count={1} />)).toContain(
      locale === 'en' ? ' comment' : ' 条评论',
    );
    expect(
      renderToStaticMarkup(
        <MentionedText text="@unknown-member" participants={[]} />,
      ),
    ).toContain(
      locale === 'en'
        ? 'unknown-member is not in this workspace&#x27;s member directory.'
        : '此 Workspace 成员目录中没有 unknown-member。',
    );
    const item = {
      status: 'in_progress',
      assignee_id: 'unknown-member',
      updated_at: '2026-08-01T00:00:00Z',
    } as WorkItemDto;
    expect(claimBlockedReason(item, Date.parse(item.updated_at), [])).toBe(
      locale === 'en'
        ? 'This Task has already been claimed by this member.'
        : '此 Task 已由该成员领取。',
    );
    expect(
      claimBlockedReason(
        { ...item, status: 'done' },
        Date.parse(item.updated_at),
        [],
      ),
    ).toBe(
      locale === 'en' ? 'This Task is already complete.' : '此 Task 已完成。',
    );
  },
);

it.each(['en', 'zh-CN'] as const)(
  'localizes the unsupported WorkRun capability reason in %s',
  (locale) => {
    setLocale(locale);
    const error = new ProductMutationError(
      'The Work requires unsupported runtime capability: external_workspace.',
      409,
      'unsupported_runtime_capability',
    );
    expect(workRunFailureMessage(error)).toBe(
      locale === 'en'
        ? 'This WorkRun requires runtime capabilities that this deployment does not support.'
        : '当前部署不支持此 WorkRun 所需的运行能力。',
    );
  },
);
