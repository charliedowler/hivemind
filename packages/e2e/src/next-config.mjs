import { resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { webRoot, packageRoot } from './paths.mjs';

const replacements = new Map([
  ['classify', 'classify'],
  ['capture-categories', 'capture-categories'],
  ['memory-judgments', 'memory-judgments'],
  ['llm/embeddings', 'embeddings'],
  ['llm/tagger', 'tagger'],
  ['llm/synthesize', 'synthesize'],
  ['llm/capture', 'capture'],
  ['blob-store', 'blob-store'],
  ['outcome-judgments', 'outcome-judgments'],
]);
export default {
    distDir: `.next/e2e-${process.env.HIVE_E2E_RUN_ID}`,
    devIndicators: false,
    transpilePackages: ['@hivemind/core', '@hivemind/design-system'],
    experimental: { authInterrupts: true },
    webpack(config, { webpack }) {
      config.resolve.alias['@vercel/queue'] = resolve(packageRoot, 'fixtures/queue.mjs');
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/classify|capture-categories|memory-judgments|outcome-judgments|embeddings|tagger|synthesize|llm\/capture|blob-store/, resource => {
        if (resource.request.includes('hive-e2e-original')) return;
        let path;
        if (resource.request.startsWith('@/')) path = resolve(process.env.HIVE_E2E_APP_DIR, 'src', resource.request.slice(2));
        else if (resource.request.startsWith('.')) path = resolve(resource.context, resource.request);
        else if (resource.request.startsWith('/')) path = resource.request;
        if (!path) return;
        const keys = [webRoot, process.env.HIVE_E2E_APP_DIR].map(root => relative(resolve(root, 'src/server'), path).replace(/\.tsx?$/, ''));
        const fixture = keys.map(key => replacements.get(key)).find(Boolean);
        if (fixture) {
          const target = resolve(packageRoot, 'fixtures/models', `${fixture}.mjs`);
          if (existsSync(target)) resource.request = target;
        }
      }));
      return config;
    },
  };
