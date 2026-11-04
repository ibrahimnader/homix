export class AppError extends Error {
  public readonly statusCode: number;
  public readonly status = false;
  public readonly code: string;

  public constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  public constructor(message = "Validation failed") {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class NotFoundError extends AppError {
  public constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  public constructor(message = "Resource conflict") {
    super(message, 409, "CONFLICT");
  }
}

export class UnauthorizedError extends AppError {
  public constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  public constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}
