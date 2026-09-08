/**
 * The source of truth for every user-visible string that has been migrated.
 *
 * `MessageKey` is `keyof typeof en`, so this object defines the vocabulary and
 * every other dictionary is checked against it. English copy is authored here
 * first and translated afterwards; a translation never edits this file.
 *
 * Product nouns — Work, Run, Agent, Coworker, Board, Workspace — stay in
 * English in every locale. They are the names of things in this product, and a
 * translated name is a second name for the same thing.
 */
export const en = {
  // --- Shared verbs and controls -------------------------------------------
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.tryAgain': 'Try again',

  // --- Shell: rail, title bar, language picker ------------------------------
  'shell.nav.primary': 'Primary navigation',
  'shell.nav.sections': 'Sections',
  'shell.nav.conversations': 'Conversations',
  'shell.nav.agents': 'Agents',
  'shell.nav.tasks': 'Tasks',
  'shell.nav.boards': 'Boards',
  'shell.nav.work': 'Work',
  'shell.nav.observe': 'Observe',
  'shell.nav.files': 'Files',
  'shell.nav.whispers': 'Whispers',
  'shell.titleBar.workspace': '{section} workspace',
  'shell.language.change': 'Change language',
  'shell.language.menu': 'Language',
  'shell.language.current': 'Current language: {language}',

  // --- Conversations: sidebar ----------------------------------------------
  'conversations.nav.label': 'Conversations navigation',
  'conversations.eyebrow.workspace': 'Workspace',
  'conversations.title': 'Conversations',
  'conversations.count': '{count} conversations',
  'conversations.new': 'New conversation',
  'conversations.chooseCoworker': 'Choose a coworker',
  'conversations.loadingCoworkers': 'Loading coworkers…',
  'conversations.noCoworkers': 'No published Coworkers found.',
  'conversations.openExisting': 'Open',
  'conversations.search.label': 'Search conversations',
  'conversations.search.placeholder': 'Search conversations',
  'conversations.filters.label': 'Conversation filters',
  'conversations.filters.all': 'All',
  'conversations.filters.recent': 'Recent',

  // --- Conversations: list --------------------------------------------------
  'conversations.list.label': 'Conversations',
  'conversations.list.loading': 'Loading conversations…',
  'conversations.list.loadError': 'Unable to load conversations.',
  'conversations.list.refreshError': 'Unable to refresh conversations.',
  'conversations.list.empty': 'No conversations yet.',
  'conversations.list.noMatches': 'No matching conversations.',
  'conversations.list.selectionUnavailable':
    'The selected Conversation is unavailable.',

  // --- Conversations: names a conversation falls back to --------------------
  'conversations.fallback.agent': 'Agent',
  'conversations.fallback.title': 'Conversation',

  // --- Conversations: main panel -------------------------------------------
  'conversations.header.eyebrow': 'Conversation',
  'conversations.content.label': 'Conversation',
  'conversations.unavailable.eyebrow': 'Conversation unavailable',
  'conversations.unavailable.backLink': 'Back to Conversations',
  'conversations.loadFailed.title': 'This Conversation couldn’t be loaded.',
  'conversations.loadFailed.body':
    'Try again in a moment, or return to Conversations.',
  'conversations.missing.title': 'This Conversation is unavailable.',
  'conversations.missing.body':
    'It may have been removed, or you may not have access.',

  // --- Conversations: sending ----------------------------------------------
  'conversations.send.failed': 'Unable to send this message. Please try again.',
  'conversations.send.notPersisted':
    'The message was not persisted. Please try again.',
  'conversations.send.wrongConversation':
    'The message was returned for a different conversation.',

  // --- Composer -------------------------------------------------------------
  'composer.field.label': 'Message',
  'composer.field.placeholder': 'Write a message...',
  'composer.send': 'Send message',
  'composer.sending': 'Sending message',
  'composer.hint': 'Press Enter to send · Shift + Enter for a new line',

  // --- Transcript -----------------------------------------------------------
  'transcript.label': 'Message transcript',
  'transcript.empty.title': 'Ready when you are',
  'transcript.empty.body':
    'Start with a Coworker, then this is where your shared context and replies will live.',
  'transcript.empty.action': 'Meet your Coworkers',
  'transcript.selectConversation':
    'Select a conversation to view its messages.',
  'transcript.loading': 'Loading messages…',
  'transcript.loadError': 'Unable to load messages.',
  'transcript.noMessages': 'No messages in this conversation yet.',
  'transcript.awaitingReply': 'Waiting for a reply',

  // --- Transcript: create a Task from a message ----------------------------
  'transcript.task.action': 'Create task',
  'transcript.task.actionLabel': 'Create Task from this message',
  'transcript.task.formTitle': 'Create Task from message',
  'transcript.task.title': 'Title',
  'transcript.task.description': 'Description',
  'transcript.task.submit': 'Create Task',
  'transcript.task.submitting': 'Creating…',

  // --- Transcript: Task dispatch event -------------------------------------
  'dispatch.label': 'Task dispatch',
  'dispatch.actor.fallback': 'Someone',
  'dispatch.recipient.fallback': 'Coworker',
  'dispatch.event.assignment': '{actor} assigned {recipient} to {task}',
  'dispatch.event.mention': '{actor} mentioned {recipient} on {task}',
  'dispatch.event.comment': '{actor} commented for {recipient} on {task}',
  'dispatch.status.loading': 'Checking task status…',
  'dispatch.status.unavailable': 'Task status is unavailable.',
  'dispatch.status.error': 'Task status could not be loaded.',
  'dispatch.details': 'Dispatch details',

  // --- Work card in a conversation ------------------------------------------
  'workCard.label': 'Work update',
  'workCard.loading': 'Loading Work update…',
  'workCard.unavailable': 'Work update is unavailable.',
  'workCard.open': 'Open Work',
  'workCard.eyebrow': 'Work',
  'workCard.statusUnavailable': 'Status unavailable',
  'workCard.result.unavailableHere': 'The latest result is not available here.',
  'workCard.result.redacted': 'The result is unavailable here.',
  'workCard.result.none': 'No result is available yet.',

  // --- WorkItem status, as Tasks/Boards/Conversations all name it ----------
  'workItem.status.todo': 'To do',
  'workItem.status.in_progress': 'In progress',
  'workItem.status.in_review': 'In review',
  'workItem.status.done': 'Done',

  // --- A linked Work's product state, in the words the Work surface uses ---
  'productState.running.label': 'Running',
  'productState.needs_you.label': 'Needs You',
  'productState.complete.label': 'Complete',
  'productState.problem.label': 'Problem',
  'productState.not_captured.label': 'State unavailable',

  // --- The fuller Work stage vocabulary, with what each stage means --------
  'workStage.not_started.label': 'Ready to start',
  'workStage.not_started.description':
    'This Work is set up and hasn’t run yet. Open it to start the first Run.',
  'workStage.starting.label': 'Starting',
  'workStage.starting.description':
    'This Run has been requested and is starting.',
  'workStage.running.label': 'Running',
  'workStage.running.description': 'This Run is active.',
  'workStage.needs_you.label': 'Needs You',
  'workStage.needs_you.description':
    'Your action is required before this Work can progress.',
  'workStage.complete.label': 'Complete',
  'workStage.complete.description':
    'This Run is complete. Open its result to review.',
  'workStage.problem.label': 'Problem',
  'workStage.problem.description':
    'This Run needs review before Work can progress.',
  'workStage.not_captured.label': 'Status unknown',
  'workStage.not_captured.description':
    'We don’t have a status update for this Work.',

  // --- A Coworker's reachability -------------------------------------------
  'runtimeStatus.available': 'Available',
  'runtimeStatus.draining': 'Draining',
  'runtimeStatus.unavailable': 'Unavailable',
  'coworker.role.fallback': 'AI Coworker',
} as const;

export default en;
