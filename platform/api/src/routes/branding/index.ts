import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { BrandingSchema } from '@platform/shared/dto';
import { brandAssetBody, toBranding } from '../../services/tenants/tenants.service.js';

const routes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '',
    { schema: { tags: ['branding'], response: { 200: BrandingSchema } } },
    async (request) => toBranding(request.tenant!),
  );

  /** Logo and favicon are served from the tenant row; SVG or raster, whichever was uploaded. */
  for (const [path, pick] of [
    ['/logo', 'logo'],
    ['/favicon', 'favicon'],
  ] as const) {
    fastify.get(path, { schema: { tags: ['branding'], hide: true } }, async (request, reply) => {
      const { mime, body } = brandAssetBody(request.tenant!.brand[pick]);
      return reply.type(mime).header('cache-control', 'public, max-age=60').send(body);
    });
  }
};

export default routes;
