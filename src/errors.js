/**
 * A deliberate, user-facing failure. Every message that reaches the UI carries
 * a plain explanation and, where possible, one concrete next step.
 */
export class AppError extends Error {
  constructor(message, { code = "bad_request", status = 400, why = "", fix = "" } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.why = why;
    this.fix = fix;
  }
}

export function asAppError(error, fallback = "Something went wrong") {
  if (error instanceof AppError) return error;
  return new AppError(fallback, {
    code: "internal_error",
    status: 500,
    why: "ModelDuck hit an unexpected error while handling this request.",
    fix: "Check the terminal window for details, then try again.",
  });
}

export function errorPayload(error) {
  const appError = asAppError(error);
  return {
    error: {
      code: appError.code,
      message: appError.message,
      why: appError.why,
      fix: appError.fix,
    },
  };
}
