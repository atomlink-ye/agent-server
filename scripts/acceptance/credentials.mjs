import { readFile } from 'node:fs/promises';

// 🔴 ⛔ 不许经 shell `source` 取这个值。
// 实测（热沙箱）：`set -a; source /root/.agent-env; set +a` 之后 process.env 里的值
// 长度 150、双引号 0 个，JSON.parse 报
// "Expecting property name enclosed in double quotes: line 1 column 3"；
// 而直接读文件那一行 `=` 右侧长度 170、双引号 20 个，可正常解析。
// 原因：.agent-env 里该赋值未加引号，shell 在 source 时吃掉了内层双引号。
// 一个名为 *_JSON 的变量，不能证明到达 process.env 的东西是 JSON。
export function parseServiceAccounts(rawLineValue) {
  if (typeof rawLineValue !== 'string' || rawLineValue.trim() === '') {
    throw new Error('SERVICE_ACCOUNTS_JSON is empty or missing — not observed');
  }
  let parsed;
  try {
    parsed = JSON.parse(rawLineValue);
  } catch (cause) {
    // ⛔ 不许宽松兜底解析。去引号形态必须在这里显式变红，并点名变量。
    throw new Error(
      `SERVICE_ACCOUNTS_JSON is not valid JSON (did it come through shell \`source\`? that strips quotes): ${cause.message}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('SERVICE_ACCOUNTS_JSON did not parse to a non-empty array');
  }
  const token = parsed[0]?.token;
  // ⛔ 不许静默返回 undefined —— 那会让 token 变成空串，红在一个看不出真因的地方。
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('SERVICE_ACCOUNTS_JSON[0].token is missing or not a non-empty string');
  }
  return { token, serviceAccountId: parsed[0].serviceAccountId, tenantId: parsed[0].tenantId };
}

export function extractEnvLineValue(fileContent, name) {
  const prefix = `${name}=`;
  const line = fileContent.split(/\r?\n/u).find((l) => l.startsWith(prefix));
  if (line === undefined) throw new Error(`${name} not observed in the agent env file`);
  return line.slice(prefix.length);
}

export async function readServiceToken(agentEnvPath) {
  const content = await readFile(agentEnvPath, 'utf8');
  return parseServiceAccounts(extractEnvLineValue(content, 'SERVICE_ACCOUNTS_JSON'));
}
