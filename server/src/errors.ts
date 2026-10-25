export class AppError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}
export function invariant(
  condition: unknown,
  message: string,
  status = 409
): asserts condition {
  if (!condition) throw new AppError(status, message)
}
