import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import '../../index.css';
import '../agents/agents.css';
import '../files/files.css';
import './run-trace.css';
import './execution-transcript.css';
import './transcript-stream.css';

it('uses one code font across source previews, files, trace and transcript output', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <section className="run-trace">
          <pre className="agents-mono">const result = '你好';</pre>
          <pre className="agents-source-preview">const result = '你好';</pre>
          <pre className="files-mono">const result = '你好';</pre>
          <div className="files-rendered-markdown">
            <pre>const result = '你好';</pre>
          </div>
          <div className="run-trace__axis">00:00</div>
          <div className="run-trace__event">
            <strong>output</strong>
          </div>
          <div className="execution-transcript__event">
            <pre>const result = '你好';</pre>
          </div>
          <div className="transcript__detail">
            <pre>const result = '你好';</pre>
          </div>
          <div className="transcript__prose">
            <code>result</code>
          </div>
        </section>,
      );
    });
    expect(window.innerWidth).toBe(1440);
    const token = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-mono')
      .replaceAll(/['"]/g, '')
      .replaceAll(/\s+/g, ' ')
      .trim();
    expect(token).toContain('ui-monospace');
    for (const element of host.querySelectorAll(
      'pre, code, .run-trace__axis, strong',
    )) {
      expect(getComputedStyle(element).fontFamily.replaceAll(/['"]/g, '')).toBe(
        token,
      );
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
