import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveProjectPath } from '../project-resolver.js';

type ConfigFile = 'hermes-toml' | 'config-yaml' | 'soul-md';

const FILE_MAP: Record<ConfigFile, { name: string; ext: string }> = {
  'hermes-toml': { name: 'hermes.toml', ext: 'toml' },
  'config-yaml': { name: 'config.yaml', ext: 'yaml' },
  'soul-md': { name: 'SOUL.md', ext: 'markdown' },
};

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deployments/:name/config/files — list available config files
  app.get<{ Params: { name: string } }>(
    '/api/deployments/:name/config/files',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const files = Object.entries(FILE_MAP).map(([key, { name }]) => ({
          key,
          name,
          exists: existsSync(join(projectPath, name)),
        }));
        return { projectPath, files };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // GET /api/deployments/:name/config/:file
  app.get<{ Params: { name: string; file: string } }>(
    '/api/deployments/:name/config/:file',
    async (request, reply) => {
      const fileInfo = FILE_MAP[request.params.file as ConfigFile];
      if (!fileInfo) {
        reply.code(400).send({ error: `unknown config file: ${request.params.file}` });
        return;
      }

      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const filePath = join(projectPath, fileInfo.name);
        if (!existsSync(filePath)) {
          reply.code(404).send({ error: `${fileInfo.name} not found` });
          return;
        }
        const content = readFileSync(filePath, 'utf-8');
        return { file: request.params.file, name: fileInfo.name, language: fileInfo.ext, content };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // PUT /api/deployments/:name/config/:file
  app.put<{ Params: { name: string; file: string }; Body: { content: string } }>(
    '/api/deployments/:name/config/:file',
    async (request, reply) => {
      const fileInfo = FILE_MAP[request.params.file as ConfigFile];
      if (!fileInfo) {
        reply.code(400).send({ error: `unknown config file: ${request.params.file}` });
        return;
      }

      const { content } = request.body ?? {};
      if (typeof content !== 'string') {
        reply.code(400).send({ error: 'content is required' });
        return;
      }

      // Validate hermes.toml if that's what we're saving
      if (request.params.file === 'hermes-toml') {
        try {
          const { parse } = await import('smol-toml');
          const { HermesTomlSchema } = await import('../../schema/hermes-toml.js');
          const parsed = parse(content);
          HermesTomlSchema.parse(parsed);
        } catch (err) {
          reply.code(422).send({ error: `invalid hermes.toml: ${(err as Error).message}` });
          return;
        }
      }

      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const filePath = join(projectPath, fileInfo.name);
        writeFileSync(filePath, content);
        return { ok: true };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
