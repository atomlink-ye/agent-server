import { useCallback, useMemo, useState } from 'react';

import {
  selectEventModel,
  selectInspectorModel,
  selectMapModel,
  selectTimelineModel,
  type InspectorMode,
} from './selectors';
import type { NormalizedTrace } from './normalized';

export type TraceView = 'timeline' | 'map' | 'events';

export type RunTraceViewState = {
  readonly view: TraceView;
  readonly selectedAttemptId: string | null;
  readonly selectedMessageId: string | null;
  readonly inspectorMode: InspectorMode;
};

export function useRunTraceViewModel(
  trace: NormalizedTrace,
  controlledView?: TraceView,
  controlledAttemptId?: string | null,
  onViewChange?: (view: TraceView) => void,
  onSelectAttempt?: (attemptId: string) => void,
) {
  const [state, setState] = useState<RunTraceViewState>({
    view: 'timeline',
    selectedAttemptId: [...trace.attempts.keys()][0] ?? null,
    selectedMessageId: null,
    inspectorMode: 'overview',
  });
  const view = controlledView ?? state.view;
  const selectedAttemptId = controlledAttemptId ?? state.selectedAttemptId;
  const setView = useCallback(
    (nextView: TraceView) => {
      setState((current) => ({ ...current, view: nextView }));
      onViewChange?.(nextView);
    },
    [onViewChange],
  );
  const selectAttempt = useCallback(
    (attemptId: string) => {
      setState((current) => ({
        ...current,
        selectedAttemptId: attemptId,
        selectedMessageId: null,
      }));
      onSelectAttempt?.(attemptId);
    },
    [onSelectAttempt],
  );
  const selectMessage = useCallback(
    (messageId: string) => {
      const edge = trace.edges.find(
        (candidate) =>
          candidate.kind === 'observed_message' &&
          candidate.messageId === messageId,
      );
      let nextAttemptId = selectedAttemptId;
      if (edge?.kind === 'observed_message') {
        if (edge.attemptId) nextAttemptId = edge.attemptId;
        else if (edge.workItemId) {
          const item = trace.workItems.get(edge.workItemId);
          if (item?.attempts.length === 1) nextAttemptId = item.attempts[0]!.id;
        }
        // Ambiguous messages intentionally do not fabricate first-attempt association.
        setState((current) => ({
          ...current,
          selectedAttemptId: nextAttemptId,
          selectedMessageId: messageId,
          inspectorMode: 'conversation',
        }));
        if (nextAttemptId && nextAttemptId !== selectedAttemptId)
          onSelectAttempt?.(nextAttemptId);
      }
    },
    [onSelectAttempt, selectedAttemptId, trace],
  );
  const setInspectorMode = useCallback((inspectorMode: InspectorMode) => {
    setState((current) => ({ ...current, inspectorMode }));
  }, []);
  const stateModel = {
    view,
    selectedAttemptId,
    selectedMessageId: state.selectedMessageId,
    inspectorMode: state.inspectorMode,
  } satisfies RunTraceViewState;

  return {
    state: stateModel,
    setView,
    selectAttempt,
    selectMessage,
    setInspectorMode,
    timeline: useMemo(() => selectTimelineModel(trace), [trace]),
    map: useMemo(() => selectMapModel(trace), [trace]),
    events: useMemo(() => selectEventModel(trace), [trace]),
    inspector: useMemo(
      () =>
        selectInspectorModel(
          trace,
          stateModel.selectedAttemptId,
          stateModel.selectedMessageId,
        ),
      [stateModel.selectedAttemptId, stateModel.selectedMessageId, trace],
    ),
  };
}
