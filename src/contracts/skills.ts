import { z } from 'zod';

/**
 * Browser-safe Skill catalog contract.
 *
 * The Skill catalog previously had no browser-facing shape at all: only the
 * registry-internal `ResolvedSkillPackage` (`src/application/extensions/
 * skill-catalog.ts`) existed, and nothing stated what a client is allowed to
 * see when it lists the catalog. This schema is the single canonical
 * statement of that shape, so Work authoring (which offers Skills to select)
 * and the route that serves the catalog agree by construction.
 *
 * A Skill manifest carries `requiredToolRefs` and nothing else -- there is no
 * separate per-Skill permission model, so this contract does not invent one.
 */

export const SkillSchema = z.object({
  ref: z.string().min(1),
  name: z.string().min(1),
  required_tool_refs: z.array(z.string().min(1)),
});

export const SkillListResponseSchema = z.object({
  skills: z.array(SkillSchema),
});

export type Skill = z.infer<typeof SkillSchema>;
export type SkillListResponse = z.infer<typeof SkillListResponseSchema>;
