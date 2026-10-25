import { Router, raw } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { fail } from "../lib/errors";
import { getLocalObjectStorage } from "../lib/objectStorage";

export const storageRouter = Router();

storageRouter.put(
  "/objects",
  raw({ type: "*/*", limit: "100mb" }),
  asyncHandler(async (req, res) => {
    const local = getLocalObjectStorage();
    if (!local) {
      fail(503, "Object storage is not configured");
    }

    const key = typeof req.query.key === "string" ? req.query.key : "";
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === "string" ? req.query.sig : "";
    if (!key || !sig || !local.verifySignature("PUT", key, exp, sig)) {
      fail(403, "Invalid or expired upload URL");
    }

    const contentType = req.header("content-type") || "application/octet-stream";
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    if (body.length === 0) {
      fail(400, "Empty upload body");
    }

    await local.putObject(key, body, contentType);
    res.status(200).json({ status: "success", data: { objectKey: key, byteSize: body.length } });
  }),
);

storageRouter.get(
  "/objects",
  asyncHandler(async (req, res) => {
    const local = getLocalObjectStorage();
    if (!local) {
      fail(503, "Object storage is not configured");
    }

    const key = typeof req.query.key === "string" ? req.query.key : "";
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === "string" ? req.query.sig : "";
    if (!key || !sig || !local.verifySignature("GET", key, exp, sig)) {
      fail(403, "Invalid or expired view URL");
    }

    const { stream, contentType, byteSize } = await local.openObjectStream(key);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(byteSize));
    stream.pipe(res);
  }),
);
