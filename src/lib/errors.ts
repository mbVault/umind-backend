export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: Record<string, string[]>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function fail(statusCode: number, message: string, details?: Record<string, string[]>): never {
  throw new HttpError(statusCode, message, details);
}
