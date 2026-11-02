import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

/** Emit local KaTeX CSS/fonts for all builds; never depend on a CDN. */
export function richAssets() {
  const require = createRequire(import.meta.url);
  return {
    name: 'qgauss-rich-assets',
    resolveId(id) { if (id === 'qgauss:math-style') return '\0qgauss:math-style'; },
    load(id) {
      if (id !== '\0qgauss:math-style') return;
      const dist = dirname(require.resolve('katex/dist/katex.min.css'));
      this.emitFile({ type: 'asset', fileName: 'rich/katex-license.txt', source: readFileSync(join(dist, '../LICENSE'), 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'rich/mermaid-license.txt', source: readFileSync(join(dirname(require.resolve('mermaid')), '../LICENSE'), 'utf8') });
      let css = readFileSync(join(dist, 'katex.min.css'), 'utf8');
      for (const name of readdirSync(join(dist, 'fonts'))) {
        const source = readFileSync(join(dist, 'fonts', name));
        const hash = createHash('sha256').update(source).digest('hex').slice(0, 10);
        const fileName = name.replace(/(\.[^.]+)$/, '-' + hash + '$1');
        this.emitFile({ type: 'asset', fileName: 'rich/fonts/' + fileName, source });
        css = css.replace(new RegExp('fonts/' + name.replaceAll('.', '\\.') + '(?=[)\\x22\\x27])', 'g'), 'fonts/' + fileName);
      }
      const hash = createHash('sha256').update(css).digest('hex').slice(0, 10);
      const ref = this.emitFile({ type: 'asset', fileName: 'rich/katex-' + hash + '.css', source: css });
      return 'export default import.meta.ROLLUP_FILE_URL_' + ref + ';';
    },
  };
}
