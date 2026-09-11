/** Application error carrying an HTTP status; the error handler renders it as problem+json. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail?: string,
    public readonly type: string = 'about:blank',
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }
}

/** Duck-typed check so errors survive being loaded through two module instances (tests, tsx). */
export function isAppError(err: unknown): err is AppError {
  return (
    err instanceof AppError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'AppError' &&
      typeof (err as { status?: unknown }).status === 'number')
  );
}

export const notFound = (detail = 'Not found') => new AppError(404, 'Not Found', detail);
export const unauthorized = (detail = 'Unauthorized') => new AppError(401, 'Unauthorized', detail);
export const forbidden = (detail = 'Forbidden') => new AppError(403, 'Forbidden', detail);
export const badRequest = (detail: string) => new AppError(400, 'Bad Request', detail);
export const conflict = (detail: string) => new AppError(409, 'Conflict', detail);
export const upstream = (detail: string) => new AppError(502, 'Upstream Error', detail);
export const notImplemented = (detail: string) => new AppError(501, 'Not Implemented', detail);
