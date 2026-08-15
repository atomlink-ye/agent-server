import type { MemoryDocumentDraft } from '../ports/lark-memory-document.js';
import { buildBootstrapPrompt } from '../context/runtime-prompts.js';
import type { ExecutionRuntimeService } from '../runtime/execution-plane-runtime-facade.js';

const MAX_OUTPUT_BYTES = 4096;
const MAX_COMMENT_BYTES = 32768;

export class SynthesizeMemoryDocument {
  public constructor(
    private readonly runtime: Pick<ExecutionRuntimeService, 'executeTurn'>,
  ) {}

  public async execute(input: {
    readonly ingressId: string;
    readonly category: string;
    readonly draft: MemoryDocumentDraft;
  }): Promise<string> {
    if (input.draft.unresolvedComments.length > 100)
      throw new Error('document comments exceed bounds');
    const instructions = input.draft.unresolvedComments
      .flatMap((comment) => [comment.text, ...comment.replies])
      .join('\n');
    if (Buffer.byteLength(instructions, 'utf8') > MAX_COMMENT_BYTES)
      throw new Error('document comments exceed bounds');
    const result = await this.runtime.executeTurn({
      runId: input.ingressId,
      systemPrompt: buildBootstrapPrompt(),
      prompt: `Synthesize the proposed workspace memory in category ${input.category} from this collaborative Doc draft. Apply every unresolved comment and reply as a revision instruction. Return only the final memory content, with no preamble.\n\nDRAFT:\n${input.draft.body}\n\nUNRESOLVED REVISION INSTRUCTIONS:\n${instructions}`,
      proposalLimit: 0,
    });
    const output = result.text.trim();
    if (!output || Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES)
      throw new Error(
        'synthesized preview is empty or exceeds 4096 UTF-8 bytes',
      );
    return output;
  }
}
