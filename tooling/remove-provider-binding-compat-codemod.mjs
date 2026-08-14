import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/infrastructure/postgres/postgres-runtime-session-repository.ts';
let source = await readFile(path, 'utf8');
const before = source;
source = source.replace(
  /\n  public async findPaseoWorkspaceByTeamRun\([\s\S]*?\n  }\n\n  public async createOrGetForProductSession/,
  '\n\n  public async createOrGetForProductSession',
);
source = source.replace(
  /\n  public async bindProvider\([\s\S]*?\n  }\n\n  async #bind/,
  '\n\n  async #bind',
);
source = source.replace(/\n\s*paseoWorkspaceId,\n\s*providerAgentId,/, '');
if (source === before) throw new Error('provider binding compatibility anchors missing');
if (source.includes('findPaseoWorkspaceByTeamRun') || source.includes('bindProvider('))
  throw new Error('provider binding compatibility remains');
await writeFile(path, source);
