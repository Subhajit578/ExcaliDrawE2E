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