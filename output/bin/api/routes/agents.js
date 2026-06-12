import { Hono } from 'hono';
import { CreateAgentSchema, SendPromptSchema } from '../../types/index.js';
import { paseoClient } from '../../paseo-client/singleton.js';
export const agentRoutes = new Hono();
// GET /agents — List all agents
agentRoutes.get('/agents', async (c) => {
    try {
        const agents = await paseoClient.listAgents();
        return c.json({
            success: true,
            data: agents,
        });
    }
    catch (err) {
        console.error('[agents] Failed to list agents:', err.message);
        return c.json({ success: false, error: err.message }, 500);
    }
});
// POST /agents — Create a new agent
agentRoutes.post('/agents', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
        return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const parsed = CreateAgentSchema.safeParse(body);
    if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        return c.json({ success: false, error: errors.join('; ') }, 400);
    }
    try {
        const { prompt, provider, model, cwd, mode, systemPrompt } = parsed.data;
        const agent = await paseoClient.createAgent({
            prompt,
            provider,
            model,
            cwd,
            mode,
            systemPrompt,
        });
        return c.json({ success: true, data: agent }, 201);
    }
    catch (err) {
        console.error('[agents] Failed to create agent:', err.message);
        return c.json({ success: false, error: err.message }, 500);
    }
});
// GET /agents/:id — Get agent details
agentRoutes.get('/agents/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const agent = await paseoClient.getAgent(id);
        if (!agent) {
            return c.json({ success: false, error: 'Agent not found' }, 404);
        }
        return c.json({ success: true, data: agent });
    }
    catch (err) {
        console.error(`[agents] Failed to get agent ${id}:`, err.message);
        if (err.message?.includes('not found') || err.message?.includes('Not found')) {
            return c.json({ success: false, error: 'Agent not found' }, 404);
        }
        return c.json({ success: false, error: err.message }, 500);
    }
});
// POST /agents/:id/send — Send prompt to agent
agentRoutes.post('/agents/:id/send', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) {
        return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const parsed = SendPromptSchema.safeParse(body);
    if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        return c.json({ success: false, error: errors.join('; ') }, 400);
    }
    try {
        const result = await paseoClient.sendPrompt(id, parsed.data.prompt);
        return c.json({ success: true, data: result });
    }
    catch (err) {
        console.error(`[agents] Failed to send prompt to agent ${id}:`, err.message);
        if (err.message?.includes('not found') || err.message?.includes('Not found')) {
            return c.json({ success: false, error: 'Agent not found' }, 404);
        }
        return c.json({ success: false, error: err.message }, 500);
    }
});
// DELETE /agents/:id — Stop and archive agent
agentRoutes.delete('/agents/:id', async (c) => {
    const id = c.req.param('id');
    try {
        await paseoClient.stopAgent(id);
        await paseoClient.archiveAgent(id);
        return c.json({ success: true, data: { id, status: 'archived' } });
    }
    catch (err) {
        console.error(`[agents] Failed to delete agent ${id}:`, err.message);
        if (err.message?.includes('not found') || err.message?.includes('Not found')) {
            return c.json({ success: false, error: 'Agent not found' }, 404);
        }
        return c.json({ success: false, error: err.message }, 500);
    }
});
// GET /agents/:id/stream — SSE stream of agent output
agentRoutes.get('/agents/:id/stream', async (c) => {
    const id = c.req.param('id');
    // Verify agent exists before opening stream
    try {
        const agent = await paseoClient.getAgent(id);
        if (!agent) {
            return c.json({ success: false, error: 'Agent not found' }, 404);
        }
    }
    catch (err) {
        if (err.message?.includes('not found') || err.message?.includes('Not found')) {
            return c.json({ success: false, error: 'Agent not found' }, 404);
        }
        return c.json({ success: false, error: err.message }, 500);
    }
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            // Send initial connected event
            const connectedEvent = `event: connected\ndata: ${JSON.stringify({ agentId: id })}\n\n`;
            controller.enqueue(encoder.encode(connectedEvent));
            // Subscribe to agent events
            const unsubscribe = paseoClient.subscribe(id, (event) => {
                try {
                    const sseData = `data: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(sseData));
                }
                catch {
                    // Stream may be closed, ignore write errors
                }
            });
            // Handle client disconnect via abort signal
            const abortHandler = () => {
                unsubscribe();
                try {
                    controller.close();
                }
                catch {
                    // Already closed
                }
            };
            c.req.raw.signal.addEventListener('abort', abortHandler);
        },
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
});
//# sourceMappingURL=agents.js.map