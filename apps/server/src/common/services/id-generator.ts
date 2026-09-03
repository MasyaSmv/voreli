import { createId } from "@paralleldrive/cuid2";
import { Injectable } from "@nestjs/common";

/**
 * Identifiers are generated in the application, not by the database: an entity is complete
 * the moment it is constructed, which keeps object graphs writable in one transaction
 * without round trips for generated keys.
 */
export interface IdGenerator {
  generate(): string;
}

export const ID_GENERATOR = Symbol("ID_GENERATOR");

@Injectable()
export class Cuid2IdGenerator implements IdGenerator {
  generate(): string {
    return createId();
  }
}
