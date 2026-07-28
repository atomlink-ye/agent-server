import { loadConfig } from '../../shared/config.js';
import {
  ProjectSkillRegistrationError,
  registerProjectSkills,
} from '../../application/extensions/register-project-skills.js';

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const project = parseProjectArgument(args);
  const config = loadConfig();
  const registered = await registerProjectSkills({
    projectRoot: project,
    registryRoot: config.skillRegistryRoot,
  });
  process.stdout.write(`${JSON.stringify({ registered })}\n`);
}

function parseProjectArgument(arguments_: readonly string[]): string {
  const normalized = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
  if (normalized.length !== 2 || normalized[0] !== '--project')
    throw new CliError(
      'CLI_INVALID_ARGUMENTS',
      'Expected --project <directory>.',
    );
  const project = normalized[1];
  if (!project)
    throw new CliError(
      'CLI_INVALID_ARGUMENTS',
      'Expected --project <directory>.',
    );
  return project;
}

class CliError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

try {
  await main();
} catch (error) {
  const registered =
    error instanceof ProjectSkillRegistrationError ? error.completed : [];
  const sanitized =
    error instanceof ProjectSkillRegistrationError || error instanceof CliError
      ? { code: error.code, message: error.message }
      : { code: 'CLI_FAILURE', message: 'Skill registration failed.' };
  process.stdout.write(`${JSON.stringify({ registered, error: sanitized })}\n`);
  process.exitCode = 1;
}
