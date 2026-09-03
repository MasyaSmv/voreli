/**
 * Base class for every error the domain raises on purpose.
 *
 * The code lives on the error class itself, not in a central registry: a new failure mode
 * should mean a new file, never an edit to a shared enum every module depends on.
 */
export abstract class DomainError extends Error {
  abstract readonly errorCode: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  /** Extra data carried to the logs; subclasses override to describe the failed operation. */
  context(): Readonly<Record<string, unknown>> {
    return {};
  }
}
