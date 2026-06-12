import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { agentRoutes } from './routes/agents.js';
import { authMiddleware } from '../middleware/auth.js';
export const app = new Hono();
// Global middleware
app.use('*', logger());
app.use('*', cors());
// Health check (no auth)
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
// Auth for API routes
app.use('/api/v1/*', authMiddleware);
// Routes
app.route('/api/v1', agentRoutes);
// 404
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
// Error handler
app.onError((err, c) => {
    console.error('[api] Error:', err.message);
    return c.json({ success: false, error: err.message }, 500);
});
//# sourceMappingURL=app.js.map