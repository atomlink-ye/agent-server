export async function authMiddleware(c, next) {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        // No API key configured, skip auth
        await next();
        return;
    }
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ success: false, error: 'Missing or invalid Authorization header' }, 401);
    }
    const token = authHeader.slice(7);
    if (token !== apiKey) {
        return c.json({ success: false, error: 'Invalid API key' }, 401);
    }
    await next();
}
//# sourceMappingURL=auth.js.map