import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { WorkPage } from '../WorkPage';
import { WorkDetailPage } from '../pages/WorkDetailPage';
import { useWorkList } from '../queries/use-work-list';
import { useWorkDetail } from '../queries/use-work-detail';
import { WorkDetailRootNotFoundError } from '../queries/load-work-detail';
import { ProductReadError } from '../clients/errors';
import { setLocale, t } from '../../../i18n';
import '../../../index.css';

vi.mock('../queries/use-work-list');
vi.mock('../queries/use-work-detail');
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const workId = '11111111-1111-4111-8111-111111111111';
afterEach(() => { vi.restoreAllMocks(); setLocale('en'); });

for (const locale of ['en', 'zh-CN'] as const) {
  it.each(['loading', 'ready', 'error', 'unavailable', 'denied'] as const)(`${locale} list %s has a stable surface`, async status => {
    await page.viewport(1440, 900);
    setLocale(locale);
    vi.mocked(useWorkList).mockReturnValue({ status, works: [], error: null, refresh: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({items: [], next_cursor: null}))));
    const host = document.createElement('div'); host.className = 'app-shell'; document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => { root.render(<MemoryRouter><div /><WorkPage /></MemoryRouter>); });
      const main = host.querySelector<HTMLElement>('.work-main-empty')!;
      const pane = host.querySelector<HTMLElement>('.pane-placeholder')!;
      expect(main.getBoundingClientRect().height).toBe(340);
      expect(main.getBoundingClientRect().top).toBe(302);
      expect(pane.getBoundingClientRect().height).toBe(220);
      if (status === 'error') {
        await act(async () => { main.querySelector<HTMLButtonElement>('button')!.click(); });
        expect(useWorkList().refresh).toHaveBeenCalledOnce();
      }
      if (status === 'unavailable' || status === 'denied') {
        expect(main.querySelector('a')?.getAttribute('href')).toBe('/conversations');
        expect(main.querySelector('button')).toBeNull();
      }
      if (status === 'loading') {
        const animation = main.getAnimations()[0]!;
        animation.pause(); animation.currentTime = 100;
        expect(getComputedStyle(main).visibility).toBe('hidden');
        animation.currentTime = 150;
        expect(getComputedStyle(main).visibility).toBe('visible');
      }
      expect(main.textContent).toContain(t(status === 'ready' ? 'work.start.title' : status === 'error' ? 'work.loadError.title' : status === 'loading' ? 'work.loading.title' : status === 'denied' ? 'work.permission.title' : 'work.unavailable.title'));
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  });

  it.each(['loading', 'starting', 'error', 'missing', 'permission', 'unavailable'] as const)(`${locale} detail %s explains its state`, async state => {
    await page.viewport(1440, 900); setLocale(locale);
    vi.mocked(useWorkDetail).mockReturnValue({status: state === 'loading' || state === 'starting' ? state : 'error', detail: null,
      error: state === 'missing' ? new WorkDetailRootNotFoundError() : state === 'permission' ? new ProductReadError('private detail', 403) : state === 'unavailable' ? new ProductReadError('private detail', 503, 'feature_unavailable') : new Error('private detail')});
    const host = document.createElement('div'); host.className = 'app-shell'; document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => { root.render(<MemoryRouter><div /><aside /><main className="chat-panel work-main"><section className="work-main-content scroll-region"><WorkDetailPage workId={workId} /></section></main></MemoryRouter>); });
      const shell = host.querySelector<HTMLElement>('.work-shell')!;
      expect(shell.getBoundingClientRect().height).toBe(state === 'missing' ? 399.390625 : 360);
      expect(shell.getBoundingClientRect().width).toBe(964);
      expect(shell.querySelector('a')).not.toBeNull();
      expect(shell.querySelector('a')?.getAttribute('href')).toBe(state === 'unavailable' ? '/conversations' : '/work');
      if (state !== 'error') expect(shell.querySelector('button')).toBeNull();
      if (state === 'permission') expect(shell.textContent).toContain(t('work.permission.body'));
      if (state === 'starting') expect(shell.textContent).toContain(t('work.detail.startingBody'));
      expect(shell.textContent).not.toContain('private detail');
      expect(shell.textContent!.length).toBeGreaterThan(5);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
}

for (const locale of ['en', 'zh-CN'] as const) {
  it(`${locale} invalid Work id offers a valid return route`, async () => {
    setLocale(locale);
    vi.mocked(useWorkList).mockReturnValue({status:'ready', works:[], error:null, refresh:vi.fn()});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({items:[],next_cursor:null}))));
    const host=document.createElement('div');host.className='app-shell';document.body.append(host);const root=createRoot(host);
    try {
      await act(async () => {root.render(<MemoryRouter><div/><WorkPage selectedWorkId="invalid"/></MemoryRouter>);});
      const state=host.querySelector('.not-found')!;
      expect(state.textContent).toContain(t('work.invalidLink.body'));
      expect(state.querySelector('a')?.getAttribute('href')).toBe('/work');
      expect(state.getBoundingClientRect().right).toBeLessThanOrEqual(1440);
    } finally {await act(async () => root.unmount());host.remove();vi.unstubAllGlobals();}
  });
}
