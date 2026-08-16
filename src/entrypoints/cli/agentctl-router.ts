const command = process.argv[2];

if (command === 'definition' || command === 'work')
  await import('./agentctl-product.js');
else await import('./agentctl.js');
