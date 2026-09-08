import type { MessageKey } from './index';

/**
 * Simplified Chinese.
 *
 * Typed as a total `Record<MessageKey, string>`, not a `Partial`: a key that is
 * missing here fails `tsc`, which is the whole reason the key type is derived
 * from the English dictionary.
 *
 * Two rules this file follows:
 *
 *   - Product nouns stay in English — Work, Run, Agent, Coworker, Board,
 *     Workspace. They name things in this product; a Chinese synonym would be a
 *     second name for the same thing, and readers would have to learn both.
 *   - The register matches the English, which is plain and direct. The product
 *     says "Coworkers work on their own and with each other", not "Agent
 *     instances execute autonomously" — so the Chinese says 「同事各自工作，也
 *     彼此协作」, not 「智能体实例自主执行任务」.
 */
export const zhCN: Record<MessageKey, string> = {
  // --- Shared verbs and controls -------------------------------------------
  'common.retry': '重试',
  'common.cancel': '取消',
  'common.tryAgain': '再试一次',

  // --- Shell: rail, title bar, language picker ------------------------------
  'shell.nav.primary': '主导航',
  'shell.nav.sections': '功能区',
  'shell.nav.conversations': '对话',
  'shell.nav.agents': 'Agent',
  'shell.nav.tasks': '任务',
  'shell.nav.boards': 'Board',
  'shell.nav.work': 'Work',
  'shell.nav.observe': '观察',
  'shell.nav.files': '文件',
  'shell.nav.whispers': '悄悄话',
  // An aria-label is prose read aloud, so this one describes rather than
  // brands: 「对话 工作区」reads; 「对话 Workspace」does not.
  'shell.titleBar.workspace': '{section} 工作区',
  'shell.language.change': '切换语言',
  'shell.language.menu': '语言',
  'shell.language.current': '当前语言：{language}',

  // --- Conversations: sidebar ----------------------------------------------
  'conversations.nav.label': '对话导航',
  'conversations.eyebrow.workspace': 'Workspace',
  'conversations.title': '对话',
  'conversations.count': '{count} 个对话',
  'conversations.new': '新建对话',
  'conversations.chooseCoworker': '选一位 Coworker',
  'conversations.loadingCoworkers': '正在加载 Coworker…',
  'conversations.noCoworkers': '还没有已发布的 Coworker。',
  'conversations.openExisting': '打开',
  'conversations.search.label': '搜索对话',
  'conversations.search.placeholder': '搜索对话',
  'conversations.filters.label': '对话筛选',
  'conversations.filters.all': '全部',
  'conversations.filters.recent': '最近',

  // --- Conversations: list --------------------------------------------------
  'conversations.list.label': '对话',
  'conversations.list.loading': '正在加载对话…',
  'conversations.list.loadError': '无法加载对话。',
  'conversations.list.refreshError': '无法刷新对话。',
  'conversations.list.empty': '还没有对话。',
  'conversations.list.noMatches': '没有匹配的对话。',
  'conversations.list.selectionUnavailable': '选中的对话已经不可用了。',

  // --- Conversations: names a conversation falls back to --------------------
  'conversations.fallback.agent': 'Agent',
  'conversations.fallback.title': '对话',

  // --- Conversations: main panel -------------------------------------------
  'conversations.header.eyebrow': '对话',
  'conversations.content.label': '对话',
  'conversations.unavailable.eyebrow': '对话不可用',
  'conversations.unavailable.backLink': '返回对话列表',
  'conversations.loadFailed.title': '这个对话没能加载出来。',
  'conversations.loadFailed.body': '稍等片刻再试，或者先回到对话列表。',
  'conversations.missing.title': '这个对话不可用。',
  'conversations.missing.body': '它可能已经被删除，也可能你没有访问权限。',

  // --- Conversations: sending ----------------------------------------------
  'conversations.send.failed': '这条消息没能发出去，请再试一次。',
  'conversations.send.notPersisted': '消息没有保存下来，请再试一次。',
  'conversations.send.wrongConversation': '返回的消息属于另一个对话。',

  // --- Composer -------------------------------------------------------------
  'composer.field.label': '消息',
  'composer.field.placeholder': '写点什么…',
  'composer.send': '发送消息',
  'composer.sending': '正在发送',
  'composer.hint': '回车发送 · Shift + 回车换行',

  // --- Transcript -----------------------------------------------------------
  'transcript.label': '消息记录',
  'transcript.empty.title': '随时可以开始',
  'transcript.empty.body':
    '先找一位 Coworker 聊起来，你们的共同上下文和往来回复都会留在这里。',
  'transcript.empty.action': '认识你的 Coworker',
  'transcript.selectConversation': '选择一个对话，看看里面的消息。',
  'transcript.loading': '正在加载消息…',
  'transcript.loadError': '无法加载消息。',
  'transcript.noMessages': '这个对话里还没有消息。',
  'transcript.awaitingReply': '正在等回复',

  // --- Transcript: create a Task from a message ----------------------------
  'transcript.task.action': '建任务',
  'transcript.task.actionLabel': '用这条消息创建任务',
  'transcript.task.formTitle': '用消息创建任务',
  'transcript.task.title': '标题',
  'transcript.task.description': '描述',
  'transcript.task.submit': '创建任务',
  'transcript.task.submitting': '正在创建…',

  // --- Transcript: Task dispatch event -------------------------------------
  'dispatch.label': '任务派发',
  'dispatch.actor.fallback': '某人',
  'dispatch.recipient.fallback': 'Coworker',
  // Chinese puts the task before the person; the whole sentence is one message
  // for exactly this reason.
  'dispatch.event.assignment': '{actor} 把 {task} 指派给了 {recipient}',
  'dispatch.event.mention': '{actor} 在 {task} 里提到了 {recipient}',
  'dispatch.event.comment': '{actor} 在 {task} 里给 {recipient} 留了言',
  'dispatch.status.loading': '正在查看任务状态…',
  'dispatch.status.unavailable': '任务状态不可用。',
  'dispatch.status.error': '任务状态没能加载出来。',
  'dispatch.details': '派发详情',

  // --- Work card in a conversation ------------------------------------------
  'workCard.label': 'Work 动态',
  'workCard.loading': '正在加载 Work 动态…',
  'workCard.unavailable': 'Work 动态不可用。',
  'workCard.open': '打开 Work',
  'workCard.eyebrow': 'Work',
  'workCard.statusUnavailable': '状态不可用',
  'workCard.result.unavailableHere': '这里看不到最新结果。',
  'workCard.result.redacted': '结果在这里不可见。',
  'workCard.result.none': '还没有结果。',

  // --- WorkItem status, as Tasks/Boards/Conversations all name it ----------
  'workItem.status.todo': '待办',
  'workItem.status.in_progress': '进行中',
  'workItem.status.in_review': '待验收',
  'workItem.status.done': '已完成',

  // --- A linked Work's product state, in the words the Work surface uses ---
  'productState.running.label': '运行中',
  'productState.needs_you.label': '需要你',
  'productState.complete.label': '已完成',
  'productState.problem.label': '有问题',
  'productState.not_captured.label': '状态不可用',

  // --- The fuller Work stage vocabulary, with what each stage means --------
  'workStage.not_started.label': '待启动',
  'workStage.not_started.description':
    '这个 Work 已经建好，还没跑过。打开它，启动第一个 Run。',
  'workStage.starting.label': '正在启动',
  'workStage.starting.description': '这个 Run 已经提交，正在启动。',
  'workStage.running.label': '运行中',
  'workStage.running.description': '这个 Run 正在跑。',
  'workStage.needs_you.label': '需要你',
  'workStage.needs_you.description': '需要你处理一下，这个 Work 才能往下走。',
  'workStage.complete.label': '已完成',
  'workStage.complete.description': '这个 Run 跑完了，打开结果看看。',
  'workStage.problem.label': '有问题',
  'workStage.problem.description': '这个 Run 得有人看一眼，Work 才能往下走。',
  'workStage.not_captured.label': '状态未知',
  'workStage.not_captured.description': '我们没拿到这个 Work 的状态更新。',

  // --- A Coworker's reachability -------------------------------------------
  'runtimeStatus.available': '在线',
  'runtimeStatus.draining': '收尾中',
  'runtimeStatus.unavailable': '不在线',
  'coworker.role.fallback': 'AI Coworker',
};

export default zhCN;
