import { plainToInstance, Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from "class-validator";

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

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  /** Backs the Socket.IO adapter, so events reach sockets held by other instances. */
  @IsString()
  @MinLength(1)
  REDIS_URL: string = "redis://localhost:6379";

  /**
   * No default on purpose. A development fallback secret is the kind of thing that reaches
   * production, and every token ever signed with it stays forgeable.
   */
  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  /** Access token lifetime in seconds. Short: it cannot be revoked, only outlived. */
  @IsInt()
  @Min(60)
  @Max(3600)
  ACCESS_TOKEN_TTL: number = 900;

  @IsInt()
  @Min(1)
  @Max(365)
  REFRESH_TOKEN_TTL_DAYS: number = 30;

  /**
   * Off in local development, where there is no TLS to carry a Secure cookie.
   *
   * Parsed explicitly because implicit conversion runs `Boolean("false")`, which is `true`
   * — the exact wrong answer for a security flag.
   */
  @Transform(({ obj }) => {
    // Read the raw value, not `value`: enableImplicitConversion has already run
    // Boolean("false") by the time a transform sees it, which yields true.
    const raw: unknown = (obj as Record<string, unknown>)["COOKIE_SECURE"];

    return raw === true || raw === "true";
  })
  @IsBoolean()
  COOKIE_SECURE: boolean = false;
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
