import { Context, Next } from 'hono';
export declare function authMiddleware(c: Context, next: Next): Promise<(Response & import("hono").TypedResponse<{
    success: false;
    error: string;
}, 401, "json">) | undefined>;
//# sourceMappingURL=auth.d.ts.map