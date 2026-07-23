import {
  normalizeMemoryContent,
  type ExistingMemoryCandidate,
} from './memory-policy.js';

export interface GardenerCandidate extends ExistingMemoryCandidate {
  readonly expiresAt?: string | null;
}

export interface GardenerSuggestion {
  readonly kind: 'duplicate' | 'supersession' | 'expiry';
  readonly category: string;
  readonly reasonCode: string;
  readonly relatedEntryCount: number;
  readonly expiresAt?: string;
}

export function suggestMemoryGardenerActions(
  candidate: GardenerCandidate,
  existingEntries: readonly ExistingMemoryCandidate[],
): readonly GardenerSuggestion[] {
  const normalized = normalizeMemoryContent(candidate.content);
  const same = existingEntries.filter(
    (entry) => entry.category === candidate.category,
  );
  const suggestions: GardenerSuggestion[] = [];
  if (
    same.some((entry) => normalizeMemoryContent(entry.content) === normalized)
  )
    suggestions.push({
      kind: 'duplicate',
      category: candidate.category,
      reasonCode: 'exact_normalized_duplicate',
      relatedEntryCount: same.length,
    });
  else if (same.length > 0)
    suggestions.push({
      kind: 'supersession',
      category: candidate.category,
      reasonCode: 'same_category_contradiction_candidate',
      relatedEntryCount: same.length,
    });
  if (candidate.expiresAt)
    suggestions.push({
      kind: 'expiry',
      category: candidate.category,
      reasonCode: 'explicit_expiry_metadata',
      relatedEntryCount: 0,
      expiresAt: candidate.expiresAt,
    });
  return Object.freeze(suggestions);
}
