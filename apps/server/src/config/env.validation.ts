import { hostname } from "node:os";

import { plainToInstance, Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsIP,
  IsInt,
  IsOptional,
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

export enum MediasoupLogLevel {
  Debug = "debug",
  Warn = "warn",
  Error = "error",
  None = "none",
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
   * How long a resolved permission answer may be reused, in seconds.
   *
   * Kept short even though domain events invalidate the cache explicitly: the number is a
   * statement about how much we trust pub/sub delivery, and a lost event should cost a
   * minute of staleness rather than an unbounded one.
   *
   * At least one second: Redis rejects `EX 0`, so a zero here would not disable the cache,
   * it would make every write fail and log.
   */
  @IsInt()
  @Min(1)
  @Max(3600)
  PERMISSION_CACHE_TTL: number = 60;

  /**
   * Number of reverse proxies in front of the server, or 0 when it is exposed directly.
   *
   * The rate limiter keys on the client address. Behind nginx without this, every request
   * arrives from the proxy, so one abusive client spends the login allowance of everyone
   * else. Counting hops rather than trusting `X-Forwarded-For` wholesale matters: a client
   * can forge that header, and a blanket trust would let it forge its own address.
   */
  @IsInt()
  @Min(0)
  @Max(10)
  TRUSTED_PROXY_HOPS: number = 0;

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

  @IsIP()
  MEDIASOUP_ANNOUNCED_IP: string = "127.0.0.1";

  @IsIP()
  MEDIASOUP_LISTEN_IP: string = "0.0.0.0";

  @IsInt()
  @Min(1)
  @Max(65535)
  MEDIASOUP_RTC_MIN_PORT: number = 40000;

  @IsInt()
  @Min(1)
  @Max(65535)
  MEDIASOUP_RTC_MAX_PORT: number = 40100;

  @Transform(({ obj }) => {
    const raw: unknown = (obj as Record<string, unknown>)["MEDIASOUP_MAX_WORKERS"];
    return raw === "" || raw === undefined ? undefined : Number(raw);
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  MEDIASOUP_MAX_WORKERS?: number;

  @IsEnum(MediasoupLogLevel)
  MEDIASOUP_LOG_LEVEL: MediasoupLogLevel = MediasoupLogLevel.Warn;

  @Transform(({ obj }) => {
    const raw: unknown = (obj as Record<string, unknown>)["INSTANCE_ID"];
    return raw === "" || raw === undefined ? hostname() : raw;
  })
  @IsString()
  @MinLength(1)
  INSTANCE_ID: string = hostname();

  @IsInt()
  @Min(1)
  @Max(1000)
  VOICE_MAX_PARTICIPANTS: number = 20;

  @IsInt()
  @Min(1)
  ROUTER_IDLE_TTL: number = 60;

  @IsInt()
  @Min(1)
  VOICE_PRESENCE_TTL: number = 90;

  @IsInt()
  @Min(1)
  VOICE_RECONNECT_GRACE: number = 20;
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

  if (parsed.MEDIASOUP_RTC_MIN_PORT > parsed.MEDIASOUP_RTC_MAX_PORT) {
    throw new Error(
      "Invalid environment configuration — MEDIASOUP_RTC_MIN_PORT must not exceed MEDIASOUP_RTC_MAX_PORT",
    );
  }

  return parsed;
}
