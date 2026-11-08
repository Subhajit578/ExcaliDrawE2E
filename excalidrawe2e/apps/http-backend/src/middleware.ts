import { NextFunction, Request, Response } from "express";
import { JWT_SECRET } from "@repo/backend-common/config";
import jwt from "jsonwebtoken";

type JwtPayload = { userId: string; username: string };

export function isLoggedIn(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers["authorization"];
  const raw = Array.isArray(auth) ? auth[0] : auth || "";
  const token = (raw.startsWith("Bearer ") ? raw.slice(7) : raw).trim();

  if (!token) {
    return res.status(401).json({ message: "Login again" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // Everything behind this guard is about one account. Saying so is what
    // stops a shared cache - a CDN, a corporate proxy, the browser's own
    // back/forward store - from handing one person's canvases, email or
    // avatar to the next person who asks for the same URL.
    //
    // The mirror image of the public caching on /avatars: that one is the
    // same for everybody, these never are. Vary names the header the answer
    // actually depends on, so a cache that ignores no-store still cannot
    // confuse two tokens.
    res.set("Cache-Control", "private, no-store");
    // vary(), not set(): compression puts Accept-Encoding in this header, and
    // replacing it would let a cache serve a brotli body to a client that
    // asked for none. vary() appends.
    res.vary("Authorization");

    //@ts-ignore
    req.userId = decoded.userId;
    //@ts-ignore
    req.username = decoded.username;
    return next();
  } catch (err) {
    console.error("[auth] jwt verify failed:", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}