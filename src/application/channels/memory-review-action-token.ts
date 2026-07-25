import { createHmac } from 'node:crypto';

export interface MemoryReviewActionTokenDeriver {
  derive(input: {
    readonly surfaceId: string;
    readonly version: number;
  }): string;
}

const DOMAIN = 'agent-server:lark-review-action:v1\0';

export function createMemoryReviewActionTokenDeriver(
  appSecret: string,
): MemoryReviewActionTokenDeriver {
  return {
    derive(input) {
      return createHmac('sha256', appSecret)
        .update(`${DOMAIN}${input.surfaceId}\0${input.version}`, 'utf8')
        .digest('base64url');
    },
  };
}
