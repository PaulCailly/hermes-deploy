import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveProjectPath } from '../project-resolver.js';
import { loadHermesToml } from '../../schema/load.js';

/** Build the file map for a given profile. Default profile uses the flat [hermes] paths. Named profiles use their [[hermes.profiles]] paths. */
function buildFileMap(projectPath: string, profile?: string): Record<string, { name: string; ext: string; resolvedPath: string }> {
  const map: Record<string, { name: string; ext: string; resolvedPath: string }> = {
    'hermes-toml': { name: 'hermes.toml', ext: 'toml', resolvedPath: join(projectPath, 'hermes.toml') },
  };

  if (!profile || profile === 'default') {
    // Default profile: use the flat [hermes] paths
    map['config-yaml'] = { name: 'config.yaml', ext: 'yaml', resolvedPath: join(projectPath, 'config.yaml') };
    // Check hermes.toml for documents to show
    try {
      const config = loadHermesToml(join(projectPath, 'hermes.toml'));
      for (const [docName, docPath] of Object.entries(config.hermes.documents)) {
        const ext = docName.endsWith('.md') ? 'markdown' : docName.endsWith('.yaml') || docName.endsWith('.yml') ? 'yaml' : 'plaintext';
        const key = `doc-${docName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
        map[key] = { name: docName, ext, resolvedPath: join(projectPath, docPath) };
      }
    } catch {
      // Fallback: show SOUL.md at the standard path
      map['soul-md'] = { name: 'SOUL.md', ext: 'markdown', resolvedPath: join(projectPath, 'SOUL.md') };
    }
  } else {
    // Named profile: load hermes.toml and find the profile's file paths
    try {
      const config = loadHermesToml(join(projectPath, 'hermes.toml'));
      const profileCfg = config.hermes.profiles.find(p => p.name === profile);
      if (profileCfg) {
        map['config-yaml'] = { name: basename(profileCfg.config_file), ext: 'yaml', resolvedPath: join(projectPath, profileCfg.config_file) };
        for (const [docName, docPath] of Object.entries(profileCfg.documents)) {
          const ext = docName.endsWith('.md') ? 'markdown' : docName.endsWith('.yaml') || docName.endsWith('.yml') ? 'yaml' : 'plaintext';
          const key = `doc-${docName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
          map[key] = { name: docName, ext, resolvedPath: join(projectPath, docPath) };
        }
      }
    } catch {
      // hermes.toml failed to load — only show hermes.toml so the user can fix it
    }
  }

  return map;
}

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deployments/:name/config/files — list available config files
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>(
    '/api/deployments/:name/config/files',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const fileMap = buildFileMap(projectPath, request.query.profile);
        const files = Object.entries(fileMap).map(([key, { name, resolvedPath }]) => ({
          key,
          name,
          exists: existsSync(resolvedPath),
        }));
        return { projectPath, files };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // GET /api/deployments/:name/config/:file
  app.get<{ Params: { name: string; file: string }; Querystring: { profile?: string } }>(
    '/api/deployments/:name/config/:file',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const fileMap = buildFileMap(projectPath, request.query.profile);
        const fileInfo = fileMap[request.params.file];
        if (!fileInfo) {
          reply.code(400).send({ error: `unknown config file: ${request.params.file}` });
          return;
        }

        if (!existsSync(fileInfo.resolvedPath)) {
          reply.code(404).send({ error: `${fileInfo.name} not found` });
          return;
        }
        const content = readFileSync(fileInfo.resolvedPath, 'utf-8');
        return { file: request.params.file, name: fileInfo.name, language: fileInfo.ext, content };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // PUT /api/deployments/:name/config/:file
  app.put<{ Params: { name: string; file: string }; Querystring: { profile?: string }; Body: { content: string } }>(
    '/api/deployments/:name/config/:file',
    async (request, reply) => {
      const { content } = request.body ?? {};
      if (typeof content !== 'string') {
        reply.code(400).send({ error: 'content is required' });
        return;
      }

      // Validate hermes.toml before writing
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
        const fileMap = buildFileMap(projectPath, request.query.profile);
        const fileInfo = fileMap[request.params.file];
        if (!fileInfo) {
          reply.code(400).send({ error: `unknown config file: ${request.params.file}` });
          return;
        }

        // Validate YAML syntax before writing
        if (fileInfo.ext === 'yaml') {
          try {
            const { parse } = await import('yaml');
            parse(content);
          } catch (err) {
            reply.code(422).send({ error: `invalid YAML in ${fileInfo.name}: ${(err as Error).message}` });
            return;
          }
        }

        writeFileSync(fileInfo.resolvedPath, content);
        return { ok: true };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
