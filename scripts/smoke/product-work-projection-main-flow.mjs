const phase = process.argv[2] ?? '';
if (phase !== '--phase' || process.argv[3] !== 'durable-identity') {
  throw new Error(
    'usage: node scripts/smoke/product-work-projection-main-flow.mjs --phase durable-identity',
  );
}

process.env.PRODUCT_WORK_DURABLE_IDENTITY = '1';
await import('./agent-teams-v2-main-flow.mjs');
