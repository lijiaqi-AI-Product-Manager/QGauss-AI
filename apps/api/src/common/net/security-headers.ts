import type { Request, Response, NextFunction } from 'express';

/** 不压缩、不缓冲响应，因此不会影响 SSE；内联样式供 Element Plus 和流式渐显使用。 */
export function securityHeaders(production: boolean) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
  const canvasCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'";
  return (req: Request, res: Response, next: NextFunction) => {
    // Only the owned, credential-free canvas can be embedded by this application.
    const canvas = req.path === '/extensions/idea-canvas.html';
    res.setHeader('Content-Security-Policy', canvas ? canvasCsp : csp);
    res.setHeader('X-Frame-Options', canvas ? 'SAMEORIGIN' : 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}
