import { plainToInstance } from "class-transformer";
import { IsEnum, IsInt, IsString, Max, Min, MinLength, validateSync } from "class-validator";

export enum NodeEnv {
  Development = "development",
  Test = "test",
  Production = "production",
}

/**
 * Only variables the server actually reads are validated here. Postgres, Redis and MinIO
 * are in `docker-compose.yml` and `.env.example` from day one, but the server does not talk
 * to them yet — demanding them would fail startup over something unused.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Origin the browser client is served from; the client never hardcodes the server host. */
  @IsString()
  @MinLength(1)
  CORS_ORIGIN: string = "http://localhost:5173";
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const parsed = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(parsed, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(", ")}`)
      .join("; ");

    throw new Error(`Invalid environment configuration — ${details}`);
  }

  return parsed;
}
