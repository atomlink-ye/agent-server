import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { setLocale, t, type Locale } from './index';
import { copyRegressions } from '../test-support/copy-regressions';
import { findCopy, measureCopy } from '../test-support/copy-measurement';
import { NewWork } from '../features/work/components/new-work';
import { WorkPage } from '../features/work/WorkPage';
import { useWorkList } from '../features/work/queries/use-work-list';
import { DefinitionPanel } from '../features/work/components/definition-panel';
import { RunTrigger } from '../features/work/components/run-trigger';
import { WorkCard } from '../features/work/components/WorkCard';
import { CapabilityBuilder } from '../features/agents/AuthoringPanels';
import { StatusBadge } from '../features/work-organization/WorkItemMeta';
import { workDefinitionClient } from '../features/work/clients/work-definition-client';
import { useRunAvailability } from '../features/work/queries/use-run-availability';
import { useWorkCard } from '../features/work/queries/use-work-card';
import '../index.css';
import '../features/agents/agents.css';
import '../features/work-organization/work-organization.css';
import '../features/work/components/work-shell.css';
import '../features/work/components/work-detail.css';
import '../features/work/work-page.css';

vi.mock('../features/work/queries/use-work-list', () => ({
  useWorkList: vi.fn(),
}));
vi.mock('../features/work/queries/use-run-availability', () => ({
  useRunAvailability: vi.fn(),
}));
vi.mock('../features/work/queries/use-work-card', () => ({
  useWorkCard: vi.fn(),
}));
vi.mock('../features/agents/queries/use-skill-catalog', () => ({
  useSkillCatalog: () => ({ status: 'ready', skills: [] }),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const workId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const definitionId = '00000000-0000-4000-8000-000000000003';
const version = {
  id: versionId,
  definition_id: definitionId,
  status: 'published' as const,
  fingerprint: `sha256:${'a'.repeat(64)}`,
  source: {
    apiVersion: 'agentserver.dev/v1alpha1',
    kind: 'WorkDefinition',
    metadata: { name: 'review' },
    spec: {
      kind: 'single_worker',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
        additional_properties: false,
      },
    },
  },
  source_yaml: 'kind: WorkDefinition',
  resolved: { resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}` },
  created_at: '2026-08-26T00:00:00.000Z',
  published_at: '2026-08-26T00:00:00.000Z',
  links: { self: 'version', definition: 'definition' },
};

type Key = keyof typeof copyRegressions;
const measurements: unknown[] = [];
function measure(
  host: HTMLElement,
  locale: Locale,
  key: Key,
  selector?: string,
) {
  const copy = copyRegressions[key][locale];
  const element = findCopy(host, copy.after, selector);
  measurements.push({ locale, key, ...measureCopy(element, copy.before) });
}
async function mounted(
  children: React.ReactNode,
  use: (host: HTMLElement, root: Root) => Promise<void> | void,
  shell = false,
) {
  const host = document.createElement('div');
  host.style.width = shell ? '1440px' : '1084px';
  if (shell) {
    host.className = 'app-shell';
    host.style.height = '900px';
  }
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter>{children}</MemoryRouter>));
    await act(async () => {
      await Promise.resolve();
    });
    await use(host, root);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

it.each(['en', 'zh-CN'] as const)(
  'fits corrected creation, Definition, and status copy at 1440 in %s',
  async (locale) => {
    await page.viewport(1440, 900);
    setLocale(locale);
    vi.spyOn(workDefinitionClient, 'getVersion').mockResolvedValue(version);
    vi.mocked(useRunAvailability).mockReturnValue({
      status: 'ready',
      missingCapability: null,
      retry: () => {},
    });
    try {
      await mounted(
        <NewWork initialCapabilityVersionId={versionId} />,
        (host) => {
          measure(host, locale, 'work.start.heading', 'h2');
          measure(host, locale, 'work.start.start', 'button');
          measure(host, locale, 'work.definitionExecutor');
        },
      );
      for (const current of [true, false]) {
        await mounted(
          <DefinitionPanel
            workId={workId}
            workDefinitionId={definitionId}
            currentWorkVersionId={current ? versionId : 'older'}
            selectedVersionId={versionId}
            version={version}
            editable={false}
          />,
          (host) =>
            measure(
              host,
              locale,
              current
                ? 'definition.currentVersion'
                : 'definition.historicalVersion',
            ),
        );
      }
      for (const [status, key] of [
        ['loading', 'work.run.checkingBody'],
        ['error', 'work.run.checkError'],
        ['ready', 'work.run.unavailableTitle'],
      ] as const) {
        vi.mocked(useRunAvailability).mockReturnValue({
          status,
          missingCapability: 'external_workspace',
          retry: () => {},
        } as ReturnType<typeof useRunAvailability>);
        await mounted(
          <RunTrigger workId={workId} definitionVersion={version} />,
          (host) => measure(host, locale, key),
        );
      }
      vi.mocked(useWorkCard).mockReturnValue({
        status: 'ready',
        card: {
          workId,
          workRef: workId,
          problemKind: null,
          attentionReason: null,
          title: 'Review',
          availability: 'available',
          productState: null,
          resultSummary: null,
          resultCaptureStatus: 'not_captured',
        },
      });
      await mounted(<WorkCard workRef={workId} onOpen={() => {}} />, (host) =>
        measure(host, locale, 'workCard.statusUnavailable'),
      );
      await mounted(<StatusBadge status="in_progress" />, (host) =>
        measure(host, locale, 'workItem.status.in_progress'),
      );
      vi.mocked(useWorkCard).mockReturnValue({
        status: 'ready',
        card: {
          workId,
          workRef: workId,
          title: 'Review',
          availability: 'available',
          productState: 'running',
          problemKind: null,
          attentionReason: null,
          resultSummary: null,
          resultCaptureStatus: 'not_present',
        },
      });
      await mounted(<WorkCard workRef={workId} onOpen={() => {}} />, (host) =>
        measure(host, locale, 'workStage.running.description'),
      );
      vi.mocked(useWorkList).mockReturnValue({
        status: 'ready',
        works: [],
        error: null,
        refresh: () => {},
      });
      vi.spyOn(workDefinitionClient, 'listCatalog').mockResolvedValue([
        {
          definitionId,
          definitionVersionId: versionId,
          name: 'Review',
          description: null,
          composition: 'single_worker',
          roster: [],
          availableTo: [],
        },
      ]);
      await mounted(
        <>
          <div />
          <WorkPage />
        </>,
        async (host) => {
          await act(async () => {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          });
          measure(host, locale, 'work.start.title', 'h1');
          measure(host, locale, 'work.catalog', '.eyebrow');
        },
        true,
      );
      await mounted(
        <CapabilityBuilder
          agent={{
            id: workId,
            displayName: 'Reviewer',
            roleLabel: null,
            summary: null,
            activeAgentVersionId: versionId,
            runtimeStatus: 'available',
          }}
          onCancel={() => {}}
          onSaved={() => {}}
          onStart={() => {}}
        />,
        async (host) => {
          measure(host, locale, 'authoring.saveStart', 'button');
          measure(host, locale, 'authoring.inputsDescription');
          const team =
            host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!;
          await act(async () => team.click());
          const role = [...host.querySelectorAll('input')].find(
            (input) => input.value === t('authoring.reviewer'),
          )!;
          expect(role).toBeDefined();
          measurements.push({
            locale,
            key: 'authoring.reviewer',
            ...measureCopy(role, 'Reviewer'),
          });
          const instructions = [...host.querySelectorAll('textarea')].find(
            (input) => input.value === t('authoring.reviewerInstructions'),
          )!;
          expect(instructions).toBeDefined();
          measurements.push({
            locale,
            key: 'authoring.reviewerInstructions',
            ...measureCopy(
              instructions,
              'Review the work independently, identify material gaps, and return clear corrections or approval evidence.',
            ),
          });
        },
      );
    } finally {
      vi.restoreAllMocks();
      setLocale('en');
    }
    await commands.writeInventory(
      JSON.stringify({ kind: 'copy-layout', measurements }),
      'canary',
    );
  },
);
