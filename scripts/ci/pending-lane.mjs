const lane = process.argv[2];

if (!lane) {
  process.stderr.write('Usage: node scripts/ci/pending-lane.mjs <lane>\n');
  process.exitCode = 2;
} else {
  process.stdout.write(
    `${lane}: SKIPPED (the repository has no boundary that makes this lane meaningful yet)\n`,
  );
}
