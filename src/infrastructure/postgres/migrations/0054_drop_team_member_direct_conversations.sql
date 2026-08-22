-- Remove Direct Conversations that were provisioned for Team members.
--
-- The Co-Worker roster listed every managed definition, so Team roles were
-- offered as conversation targets, and the startup coworker reconciliation
-- (PR #109) then created a Direct Conversation for each of them. Filtering the
-- roster stops new ones; the rows already written have to go.
--
-- Team membership is derived from team_versions.spec rather than stored on the
-- definition: it is a relationship, it can start existing after the Agent is
-- authored, and agent_definitions rows are immutable once inserted
-- (0005b_managed_agent_registry_hardening.sql).

BEGIN;

CREATE TEMP TABLE team_member_direct_conversations ON COMMIT DROP AS
  SELECT DISTINCT c.id
    FROM conversations c
    JOIN conversation_members cm
      ON cm.conversation_id = c.id
     AND cm.member_type = 'agent_definition'
    JOIN agent_definitions d
      ON d.id::text = cm.member_id
     AND d.tenant_id = cm.tenant_id
   WHERE c.kind = 'direct'
     AND EXISTS (
           SELECT 1
             FROM team_versions tv
             JOIN agent_versions av
               ON av.definition_id = d.id
            WHERE tv.tenant_id = d.tenant_id
              AND (
                    tv.spec #>> '{lead,agentVersionId}' = av.id::text
                 OR EXISTS (
                      SELECT 1
                        FROM jsonb_array_elements(
                               coalesce(tv.spec -> 'roster', '[]'::jsonb)
                             ) member
                       WHERE member ->> 'agentVersionId' = av.id::text
                    )
                  )
         );

-- Every table with a NO ACTION foreign key to conversations must be cleared
-- first. agent_chat_runtime_watermarks cascades, so it is not listed here.
DELETE FROM chat_activation_causes         WHERE conversation_id IN (SELECT id FROM team_member_direct_conversations);
DELETE FROM chat_dispatches                WHERE conversation_id IN (SELECT id FROM team_member_direct_conversations);
DELETE FROM chat_messages                  WHERE conversation_id IN (SELECT id FROM team_member_direct_conversations);
DELETE FROM conversation_reads             WHERE conversation_id IN (SELECT id FROM team_member_direct_conversations);
DELETE FROM conversation_work_entitlements WHERE conversation_id IN (SELECT id FROM team_member_direct_conversations);
DELETE FROM conversation_work_links        WHERE conversation_id IN (SELECT id FROM team_member_direct_conversations);
DELETE FROM conversation_members           WHERE conversation_id IN (SELECT id FROM team_member_direct_conversations);

DELETE FROM conversations
 WHERE id IN (SELECT id FROM team_member_direct_conversations);

COMMIT;
