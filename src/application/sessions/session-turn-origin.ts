export type SessionTurnOrigin =
  | { readonly channel: 'api'; readonly requestId: string }
  | { readonly channel: 'lark'; readonly ingressEventId: string };

export type AdmissionIngress = SessionTurnOrigin['channel'];

export function originReference(origin: SessionTurnOrigin): string | null {
  return origin.channel === 'lark' ? origin.ingressEventId : null;
}
