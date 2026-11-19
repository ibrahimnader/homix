import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { AppError, ValidationError } from "../errors";
import { logger } from "../logger/logger";

const INTERNAL_SERVER_ERROR = 500;

const toAppError = (error: unknown): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new ValidationError(error.issues.map((issue) => issue.message).join(", "));
  }

  if (error instanceof Error) {
    return new AppError(error.message, INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR");
  }

  return new AppError("Something went wrong!", INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR");
};

export const errorMiddleware = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
): void => {
  const appError = toAppError(error);
  logger.error(
    {
      err: error,
      operationName: request.operationName,
      requestId: request.requestId,
      userId: request.user?.id ?? null,
    },
    appError.message,
  );

  response.status(appError.statusCode).json({
    code: appError.code,
    message: appError.message,
    status: appError.status,
    ...(appError.details !== undefined ? { details: appError.details } : {}),
  });
};
