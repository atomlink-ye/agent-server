import { expect, it } from 'vitest';
import { en } from './en';
import { zhCN } from './zh-CN';

// Product records, execution instances, and Definition access have distinct names.
it.each([
  [
    'work.chat.runLead',
    'Questions about this WorkRun · no execution changes',
    'WorkRun 问答 · 不更改执行',
  ],
  [
    'workCard.statusUnavailable',
    'Latest WorkRun unavailable',
    '最新 WorkRun 不可用',
  ],
  ['workItem.status.in_progress', 'In progress', '进行中'],
  ['boards.doing', 'Doing', '进行中'],
  [
    'workStage.running.description',
    'This WorkRun is active.',
    '此 WorkRun 运行中。',
  ],
  ['tasks.startWork', 'Create Work', '创建 Work'],
  ['agents.startWork', 'Create Work', '创建 Work'],
  [
    'agents.noCapabilities',
    'No Definitions are available to this Coworker yet. Browse Definitions or create one.',
    '此 Coworker 暂无可用 Definition，可浏览或新建。',
  ],
  ['agents.browseWorkCatalog', 'Browse Definitions', '浏览 Definition'],
  ['work.catalog', 'Definition catalog', 'Definition 目录'],
  ['work.start.title', 'Create a Work', '创建 Work'],
  [
    'work.start.heading',
    'Create Work and start a WorkRun',
    '创建 Work 并启动 WorkRun',
  ],
  [
    'work.start.start',
    'Create Work & start WorkRun',
    '创建 Work 并启动 WorkRun',
  ],
  [
    'work.definitionExecutor',
    'The Definition selects the Worker or Team for each WorkRun.',
    'Definition 为每次 WorkRun 指定 Worker 或 Team。',
  ],
  ['work.chat.runPlaceholder', 'Ask about this WorkRun…', '询问此 WorkRun…'],
  [
    'work.run.checkingBody',
    'Checking whether a WorkRun can start here…',
    '检查能否启动 WorkRun…',
  ],
  [
    'work.run.checkError',
    'We couldn’t check whether a WorkRun can start here.',
    '无法确认能否启动 WorkRun。',
  ],
  [
    'work.run.unavailableTitle',
    'WorkRuns can’t start in this deployment.',
    '当前部署无法启动 WorkRun。',
  ],
  [
    'definition.currentVersion',
    'Current Definition version',
    '当前 Definition 版本',
  ],
  [
    'definition.historicalVersion',
    'WorkRun’s Definition version',
    'WorkRun 的 Definition 版本',
  ],
  ['authoring.saveStart', 'Save & create Work', '保存并创建 Work'],
  [
    'authoring.inputsDescription',
    'These fields supply input when starting a WorkRun.',
    '这些字段用于填写 WorkRun 输入。',
  ],
  [
    'authoring.saved',
    'Capability saved to this Coworker’s Definition catalog.',
    '已保存到此 Coworker 的 Definition 目录。',
  ],
  [
    'agents.activityWorkHint',
    'These Work records were created from Definitions available to this Coworker.',
    '这些 Work 由此 Coworker 可用的 Definition 创建。',
  ],
] as const)('keeps %s precise in both locales', (key, english, chinese) => {
  expect(en[key]).toBe(english);
  expect(zhCN[key]).toBe(chinese);
});
