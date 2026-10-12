export class HiveError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message.replace(/[\r\n]+/g, " "));
    this.name = new.target.name;
  }
}
export class HiveNotFoundError extends HiveError {
  constructor(message = "Learning not found in your team.") {
    super(message, 404);
  }
}
export class HiveUnavailableError extends HiveError {
  constructor(
    message = "The hive database is unavailable. Set DATABASE_URL to connect it.",
  ) {
    super(message, 503);
  }
}
export class HiveInputError extends HiveError {
  constructor(message = "The input is invalid.") {
    super(message, 400);
  }
}
