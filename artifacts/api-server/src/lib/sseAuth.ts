import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, ngrokConfigsTable } from "@workspace/db";
import { GetServerParams } from "@workspace/api-zod";
import { timingSafeEqualStr } from "./crypto";

export interface SseRequest extends Request {
  serverId?: number;
}

// Per-server bearer-token auth for the SSE passthrough endpoints. The token is
// the one stored in the server's ngrok config (the value the user pastes into
// the ChatGPT connector). Constant-time comparison avoids token leakage.
export async function requireServerBearer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(ngrokConfigsTable)
    .where(eq(ngrokConfigsTable.serverId, params.data.id));
  const token = rows[0]?.bearerToken;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const header =
    typeof req.headers["authorization"] === "string"
      ? req.headers["authorization"]
      : "";
  if (!timingSafeEqualStr(header, `Bearer ${token}`)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as SseRequest).serverId = params.data.id;
  next();
}
