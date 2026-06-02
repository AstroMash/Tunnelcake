import { Router, type IRouter } from "express";
import { requireServerBearer, type SseRequest } from "../lib/sseAuth";
import { createRateLimiter } from "../lib/rateLimit";
import { openSseSession, postSseMessage } from "../lib/manager";

const router: IRouter = Router();

// Rate-limit the public-facing SSE passthrough endpoints.
const limiter = createRateLimiter({ windowMs: 60_000, max: 120 });

router.get(
  "/servers/:id/sse",
  limiter,
  requireServerBearer,
  async (req, res) => {
    await openSseSession((req as SseRequest).serverId as number, res);
  },
);

router.post(
  "/servers/:id/messages",
  limiter,
  requireServerBearer,
  async (req, res) => {
    await postSseMessage((req as SseRequest).serverId as number, req, res);
  },
);

export default router;
