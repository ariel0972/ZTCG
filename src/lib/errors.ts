export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
    public details?: unknown,
  ) {
    super(message);
  }
}
