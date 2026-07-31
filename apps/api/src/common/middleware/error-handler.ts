import type { NextFunction, Request, Response } from "express";
import { AppError } from "../http.js";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ ok: false, message: error.message, details: error.details ?? null });
  }

  console.error(error);
  const message = error instanceof Error ? error.message : "Une erreur interne est survenue.";
  const stack = error instanceof Error ? error.stack : null;
  return res.status(500).json({ ok: false, message, details: stack });
}