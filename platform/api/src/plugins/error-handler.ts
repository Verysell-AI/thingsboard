import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import type { ProblemDetails } from '@platform/shared/dto';
import { isAppError } from '../lib/errors.js';
import { isTbError } from '../services/tb/tb.client.js';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Upstream Error',
  503: 'Service Unavailable',
};

/** Renders every error as RFC 7807 problem+json and never leaks upstream bodies. */
export default fp(
  async (fastify) => {
    fastify.setErrorHandler((error: FastifyError, request, reply) => {
      const err: FastifyError = error;
      let problem: ProblemDetails;
      if (isAppError(error)) {
        problem = {
          type: error.type,
          title: error.title,
          status: error.status,
          detail: error.detail,
        };
      } else if (hasZodFastifySchemaValidationErrors(error)) {
        problem = {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'Request validation failed',
          errors: error.validation.map((v) => ({
            path: v.instancePath || '',
            message: v.message ?? 'invalid',
          })),
        };
      } else if (isResponseSerializationError(error)) {
        request.log.error({ err: error }, 'response serialization failed');
        problem = {
          type: 'about:blank',
          title: 'Internal Server Error',
          status: 500,
          detail: 'Response did not match its schema',
        };
      } else if (isTbError(error)) {
        request.log.warn({ status: error.status, path: error.path }, 'ThingsBoard call failed');
        problem = {
          type: 'about:blank',
          title: 'Upstream Error',
          status: 502,
          detail: 'ThingsBoard request failed',
        };
      } else {
        const status =
          typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
        if (status >= 500) request.log.error({ err }, 'unhandled error');
        problem = {
          type: 'about:blank',
          title: TITLES[status] ?? 'Error',
          status,
          detail: status >= 500 ? 'Unexpected error' : err.message,
        };
      }
      problem.instance = request.url;
      reply.code(problem.status).type('application/problem+json').send(problem);
    });

    fastify.setNotFoundHandler((request, reply) => {
      const problem: ProblemDetails = {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: `Route ${request.method} ${request.url} not found`,
        instance: request.url,
      };
      reply.code(404).type('application/problem+json').send(problem);
    });
  },
  { name: 'error-handler' },
);
