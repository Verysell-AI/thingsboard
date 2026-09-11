import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import type { AccessTokenClaims } from '@platform/shared/dto';
import type { TokenSigner } from '../services/auth/auth.service.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenClaims;
    user: AccessTokenClaims;
  }
}

/** JWT signing/verification; hands a signer to the container so AuthService can issue tokens. */
export default fp(
  async (fastify) => {
    await fastify.register(fastifyJwt, { secret: fastify.config.JWT_SECRET });
    const signer: TokenSigner = {
      sign: (payload, opts) => fastify.jwt.sign(payload as never, { expiresIn: opts.expiresIn }),
      verify: <T>(token: string) => fastify.jwt.verify(token) as unknown as T,
    };
    fastify.services.withSigner(signer);
  },
  { name: 'auth', dependencies: ['services'] },
);
