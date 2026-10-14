export class ActionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ActionValidationError";
  }
}


export function requireAction(condition, message) {
  if (!condition) throw new ActionValidationError(message);
}
