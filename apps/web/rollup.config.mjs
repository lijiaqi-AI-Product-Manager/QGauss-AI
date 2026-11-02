import vue from 'rollup-plugin-vue';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import postcss from 'rollup-plugin-postcss';
import terser from '@rollup/plugin-terser';
import { richAssets } from '../../scripts/web/rich-assets.mjs';
import {mindmapAssets} from '../../scripts/web/mindmap-assets.mjs';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { precompressAsset } from '../../scripts/web/precompress.mjs';

/**
 * 为什么不用 Vite：Vite 依赖 esbuild，而 esbuild 需要拉起子进程；
 * 在受限环境里这一步会被拦。Rollup 是纯 JS 实现，没有子进程，行为完全一致地可构建。
 *
 * 产物约定（生产）：
 *   dist/index.html                     由下面的 htmlEntry 插件按产物生成，不缓存
 *   dist/assets/main-[hash].js          入口
 *   dist/assets/chunks/*-[hash].js      路由级拆包 + vendor
 *   dist/assets/bundle-[hash].css       全量样式
 *   *.br / *.gz                         预压缩副本，由 API 静态托管按 Accept-Encoding 选用
 * 文件名带内容哈希，可以 immutable 长缓存；升级后浏览器不会拿到旧包。
 */
const here = dirname(fileURLToPath(import.meta.url));
export function createWebConfig({ webRoot = here, outputRoot, development = false } = {}) {
  const root = resolvePath(webRoot), DIST = outputRoot && resolvePath(outputRoot), dev = development;
  if (!DIST || DIST === join(root, 'dist')) throw new Error('请使用 QGauss 隔离构建入口，不能直接写入正在发布的目录');

  function htmlEntry() {
    return {
      name: 'qg-html-entry',
      buildStart() { this.addWatchFile(join(root, 'index.html')); },
      generateBundle(_opts, bundle) {
        // rollup-plugin-postcss 只能产出固定文件名，这里补上内容哈希
        const css = bundle['bundle.css'];
        if (!css) return;
        const hash = createHash('sha256').update(css.source).digest('hex').slice(0, 10);
        delete bundle['bundle.css'];
        this.emitFile({ type: 'asset', fileName: `bundle-${hash}.css`, source: css.source });
      },
      writeBundle(_opts, bundle) {
        const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry);
        const cssName = Object.keys(bundle).find((n) => /^bundle-[0-9a-f]+\.css$/.test(n));
        const head = [
          cssName ? `<link rel="stylesheet" href="/assets/${cssName}" />` : '',
          // 入口的静态依赖（vendor 等）提前并行拉取，避免瀑布
          ...entry.imports.map((f) => `<link rel="modulepreload" href="/assets/${f}" />`),
        ]
          .filter(Boolean)
          .join('\n    ');
        const template = readFileSync(join(root, 'index.html'), 'utf8');
        if (!entry || !template.includes('<!-- qg:head -->') || !template.includes('<!-- qg:entry -->')) throw new Error('前端入口模板不完整');
        const html = template
          .replace('<!-- qg:head -->', head)
          .replace('<!-- qg:entry -->', `<script type="module" src="/assets/${entry.fileName}"></script>`);
        mkdirSync(DIST, { recursive: true });
        if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), DIST, { recursive: true });
        writeFileSync(join(DIST, 'index.html'), html);

        // 验证实际落盘字节和全部静态 / 动态依赖，公共目录不能覆盖生成文件。
        for (const [name, item] of Object.entries(bundle)) {
          const expected = Buffer.from(item.type === 'chunk' ? item.code : item.source);
          if (!readFileSync(join(DIST, 'assets', name)).equals(expected)) throw new Error('构建资源字节不完整: ' + name);
          if (item.type === 'chunk') for (const dependency of [...item.imports, ...item.dynamicImports, ...item.referencedFiles]) {
            if (!Object.hasOwn(bundle, dependency)) throw new Error('构建资源缺少依赖: ' + dependency);
          }
        }

        if (dev) return;
        const compressionStarted = performance.now(), compression = { reused: 0, created: 0 };
        for (const [name, item] of Object.entries(bundle)) {
          if (!/\.(js|css)$/.test(name)) continue;
          const buf = Buffer.from(item.type === 'chunk' ? item.code : item.source);
          if (buf.length < 1024) continue;
          const file = join(DIST, 'assets', name);
          const result = precompressAsset(buf, file, join(root, 'dist/assets', name));
          compression.reused += result.reused; compression.created += result.created;
        }
        console.log('[QGauss build] compression', JSON.stringify({ ...compression, elapsedMs: Math.round(performance.now() - compressionStarted) }));
      },
    };
  }

  return {
    input: { main: join(root, 'src/main.js') },
    output: {
      dir: join(DIST, 'assets'),
      format: 'es',
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      // 生产生成 sourcemap 但不在产物里引用，排障时手动对照；API 托管也不对外提供 .map
      sourcemap: dev ? true : 'hidden',
      // 框架稳定缓存；组件库由路由按实际依赖拆分，避免后台组件进入聊天首屏。
      manualChunks(id) {
        if (!id.includes('node_modules')) return undefined;
        if (/[\\/]node_modules[\\/](vue|@vue|vue-router|pinia|vue-demi)[\\/]/.test(id)) return 'vendor-vue';
        return undefined;
      },
    },
    plugins: [
      replace({
        preventAssignment: true,
        'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      }),
      vue({ css: false }),
      richAssets(), mindmapAssets(),
      postcss({ extract: 'bundle.css', minimize: !dev, sourceMap: false }),
      resolve({ browser: true, extensions: ['.mjs', '.js', '.json', '.vue'] }),
      commonjs(),
      // 固定压缩并发，避免在多核桌面环境同时启动过多压缩线程。
      !dev && terser({ maxWorkers: 2, format: { comments: false } }),
      htmlEntry(),
    ].filter(Boolean),
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') return;
      if (warning.code === 'THIS_IS_UNDEFINED') return;
      warn(warning);
    },
  };
}

export default function () {
  throw new Error('请运行 npm run build -w @qgauss/web 或 npm run watch -w @qgauss/web，确保隔离构建与安全发布');
}
