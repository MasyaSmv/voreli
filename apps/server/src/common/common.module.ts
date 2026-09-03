import { Global, Module } from "@nestjs/common";

import { CLOCK, SystemClock } from "./services/clock.js";
import { Cuid2IdGenerator, ID_GENERATOR } from "./services/id-generator.js";
import { Argon2PasswordHasher, PASSWORD_HASHER } from "./services/password-hasher.js";

@Global()
@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: Cuid2IdGenerator },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
  ],
  exports: [CLOCK, ID_GENERATOR, PASSWORD_HASHER],
})
export class CommonModule {}
