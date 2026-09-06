// Minimal request/response shapes so the handlers stay typed without pulling in
// a platform-specific types package.

export interface ApiRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = "sign in first") => new HttpError(401, msg);

/** Body may already be parsed by the platform, or arrive as a JSON string. */
export function readBody<T = Record<string, unknown>>(req: ApiRequest): T {
  const b = req.body;
  if (!b) return {} as T;
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as T;
    } catch {
      throw bad("body must be JSON");
    }
  }
  return b as T;
}

export function methodIs(req: ApiRequest, method: string) {
  if ((req.method || "GET").toUpperCase() !== method) {
    throw new HttpError(405, `use ${method}`);
  }
}

/** Wrap a handler so thrown HttpErrors become clean JSON responses. */
export function handler(fn: (req: ApiRequest, res: ApiResponse) => Promise<void>) {
  return async (req: ApiRequest, res: ApiResponse) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!process.env.DATABASE_URL) throw new HttpError(500, "DATABASE_URL is not configured");
      await fn(req, res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      // never leak an internal failure's text to the client
      const message = e instanceof HttpError ? e.message : "something went wrong";
      if (!(e instanceof HttpError)) console.error("api error:", e);
      res.status(status).json({ error: message });
    }
  };
}
