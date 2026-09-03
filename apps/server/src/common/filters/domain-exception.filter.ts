import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { DomainError } from "../errors/domain-error.js";
import { isHttpMappable } from "../errors/http-mappable.js";

interface ErrorBody {
  readonly errorCode: string;
  readonly message: string;
}

/**
 * Turns anything thrown inside the app into one response shape, and — just as important —
 * guarantees it reaches the log. An error swallowed without a log entry is a bug nobody
 * can find later.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const { status, body } = this.describe(exception);

    this.logger.error(
      `${request.method} ${request.url} -> ${String(status)} ${body.errorCode}`,
      exception instanceof Error ? exception.stack : String(exception),
      exception instanceof DomainError ? JSON.stringify(exception.context()) : undefined,
    );

    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return {
        // The error class decides its status when it cares; otherwise the request was
        // well-formed but the domain refused it, which is what 422 means.
        status: isHttpMappable(exception) ? exception.httpStatus : HttpStatus.UNPROCESSABLE_ENTITY,
        body: { errorCode: exception.errorCode, message: exception.message },
      };
    }

    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        body: { errorCode: "HTTP_EXCEPTION", message: exception.message },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { errorCode: "INTERNAL_ERROR", message: "Internal server error" },
    };
  }
}
