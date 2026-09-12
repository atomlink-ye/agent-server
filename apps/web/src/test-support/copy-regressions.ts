// Exact prior text is replayed only to measure the same production container.
export const copyRegressions = {
  'work.chat.runLead': {
    en: {
      before: 'WorkRun conversation · no execution changes',
      after: 'Questions about this WorkRun · no execution changes',
    },
    'zh-CN': {
      before: 'WorkRun 对话 · 不更改执行',
      after: 'WorkRun 问答 · 不更改执行',
    },
  },
  'workCard.statusUnavailable': {
    en: {
      before: 'Status unavailable',
      after: 'Latest WorkRun unavailable',
    },
    'zh-CN': {
      before: '状态不可用',
      after: '最新 WorkRun 不可用',
    },
  },
  'workItem.status.in_progress': {
    en: {
      before: 'In progress',
      after: 'In progress',
    },
    'zh-CN': {
      before: '中',
      after: '进行中',
    },
  },
  'boards.doing': {
    en: {
      before: 'Doing',
      after: 'Doing',
    },
    'zh-CN': {
      before: '中',
      after: '进行中',
    },
  },
  'workStage.running.description': {
    en: {
      before: 'This WorkRun is active.',
      after: 'This WorkRun is active.',
    },
    'zh-CN': {
      before: '此 WorkRun 运行。',
      after: '此 WorkRun 运行中。',
    },
  },
  'tasks.startWork': {
    en: {
      before: 'Start Work',
      after: 'Create Work',
    },
    'zh-CN': {
      before: '启动 Work',
      after: '创建 Work',
    },
  },
  'agents.startWork': {
    en: {
      before: 'Start Work',
      after: 'Create Work',
    },
    'zh-CN': {
      before: '启动 Work',
      after: '创建 Work',
    },
  },
  'agents.noCapabilities': {
    en: {
      before:
        'No Work is available to this Coworker yet. Browse the shared Work catalog or create a Definition.',
      after:
        'No Definitions are available to this Coworker yet. Browse Definitions or create one.',
    },
    'zh-CN': {
      before:
        '此 Coworker 还没有可用的 Work。可以浏览共享 Work 目录，或创建一个 Definition。',
      after: '此 Coworker 暂无可用 Definition，可浏览或新建。',
    },
  },
  'agents.browseWorkCatalog': {
    en: {
      before: 'Browse Work catalog',
      after: 'Browse Definitions',
    },
    'zh-CN': {
      before: '浏览 Work 目录',
      after: '浏览 Definition',
    },
  },
  'work.catalog': {
    en: {
      before: 'Work catalog',
      after: 'Definition catalog',
    },
    'zh-CN': {
      before: 'Work 目录',
      after: 'Definition 目录',
    },
  },
  'work.start.title': {
    en: {
      before: 'Start a piece of Work',
      after: 'Create a Work',
    },
    'zh-CN': {
      before: '启动一项 Work',
      after: '创建 Work',
    },
  },
  'work.start.heading': {
    en: {
      before: 'Start formal Work',
      after: 'Create Work and start a WorkRun',
    },
    'zh-CN': {
      before: '开始正式 Work',
      after: '创建 Work 并启动 WorkRun',
    },
  },
  'work.start.start': {
    en: {
      before: 'Start Work',
      after: 'Create Work & start WorkRun',
    },
    'zh-CN': {
      before: '开始 Work',
      after: '创建 Work 并启动 WorkRun',
    },
  },
  'work.definitionExecutor': {
    en: {
      before: 'The Definition selects the Worker or Team for this Work.',
      after: 'The Definition selects the Worker or Team for each WorkRun.',
    },
    'zh-CN': {
      before: 'Work 由 Definition 指定的 Worker 或 Team 执行。',
      after: 'Definition 为每次 WorkRun 指定 Worker 或 Team。',
    },
  },
  'work.chat.runPlaceholder': {
    en: {
      before: 'Message this WorkRun’s executor…',
      after: 'Ask about this WorkRun…',
    },
    'zh-CN': {
      before: '向这次 WorkRun 的执行者发消息…',
      after: '询问此 WorkRun…',
    },
  },
  'work.run.checkingBody': {
    en: {
      before: 'Checking whether this Work can run here…',
      after: 'Checking whether a WorkRun can start here…',
    },
    'zh-CN': {
      before: '检查这个 Work 能否在这里运行…',
      after: '检查能否启动 WorkRun…',
    },
  },
  'work.run.checkError': {
    en: {
      before: 'We couldn’t check whether this Work can run here.',
      after: 'We couldn’t check whether a WorkRun can start here.',
    },
    'zh-CN': {
      before: '无法确认这个 Work 能否在这里运行。',
      after: '无法确认能否启动 WorkRun。',
    },
  },
  'work.run.unavailableTitle': {
    en: {
      before: 'This Work can’t run in this deployment.',
      after: 'WorkRuns can’t start in this deployment.',
    },
    'zh-CN': {
      before: '这个 Work 无法在当前部署中运行。',
      after: '当前部署无法启动 WorkRun。',
    },
  },
  'definition.currentVersion': {
    en: {
      before: 'Current Work version',
      after: 'Current Definition version',
    },
    'zh-CN': {
      before: 'Work 当前版本',
      after: '当前 Definition 版本',
    },
  },
  'definition.historicalVersion': {
    en: {
      before: 'Historical WorkRun version',
      after: 'WorkRun’s Definition version',
    },
    'zh-CN': {
      before: '历史 WorkRun 版本',
      after: 'WorkRun 的 Definition 版本',
    },
  },
  'authoring.saveStart': {
    en: {
      before: 'Save & start Work',
      after: 'Save & create Work',
    },
    'zh-CN': {
      before: '保存并启动 Work',
      after: '保存并创建 Work',
    },
  },
  'authoring.inputsDescription': {
    en: {
      before: 'These fields become the questions shown when starting Work.',
      after: 'These fields supply input when starting a WorkRun.',
    },
    'zh-CN': {
      before: '这些字段会成为启动 Work 时显示的问题。',
      after: '这些字段用于填写 WorkRun 输入。',
    },
  },
  'authoring.saved': {
    en: {
      before: 'Capability saved to this Coworker’s Work Catalog.',
      after: 'Capability saved to this Coworker’s Definition catalog.',
    },
    'zh-CN': {
      before: 'Capability 已保存到此 Coworker 的 Work Catalog 中。',
      after: '已保存到此 Coworker 的 Definition 目录。',
    },
  },
  'agents.activityWorkHint': {
    en: {
      before: "Work here was started from this Coworker's Capabilities.",
      after:
        'These Work records were created from Definitions available to this Coworker.',
    },
    'zh-CN': {
      before: '这里的 Work 都是从这位 Coworker 的 Capabilities 启动的。',
      after: '这些 Work 由此 Coworker 可用的 Definition 创建。',
    },
  },
} as const;
