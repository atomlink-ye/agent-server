export interface MemoryReviewCardRenderer {
  renderPending(input: {
    readonly category: string;
    readonly content: string;
    readonly token: string;
  }): unknown;
  renderWithDocumentControls(input: {
    readonly category: string;
    readonly excerpt: string;
    readonly docStatus: string;
    readonly docUrl: string;
    readonly token: string;
    readonly previewed: boolean;
    readonly previewExcerpt?: string;
    readonly previewFingerprint?: string;
  }): unknown;
  renderResolved(input: {
    readonly status: 'accepted' | 'rejected';
    readonly category: string;
    readonly content: string;
  }): unknown;
}
