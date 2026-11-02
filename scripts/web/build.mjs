import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { rollup, watch } from 'rollup';
import { createWebConfig } from '../../apps/web/rollup.config.mjs';
import { acquireBuildLock, createBuildStage, publishWebBuild, removeBuildStage } from './publish.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web');

function context(root) {
  const lock = acquireBuildLock(root);
  let stage;
  try { stage = createBuildStage(root); }
  catch (error) { lock.release(); throw error; }
  let closed = false;
  return {
    stage,
    cleanup() {
      if (closed) return [];
      closed = true;
      const warnings = [];
      try { removeBuildStage(root, stage); } catch (error) { warnings.push(error.message); }
      try { lock.release(); } catch (error) { warnings.push(error.message); }
      return warnings;
    },
  };
}

export async function buildWeb({ root = webRoot, publish = publishWebBuild } = {}) {
  const started = performance.now(), timings = {};
  const active = context(root);
  let bundle, result, failure;
  try {
    const { output, ...input } = createWebConfig({ webRoot: root, outputRoot: active.stage, development: false });
    bundle = await rollup(input);
    timings.rollupMs = Math.round(performance.now() - started);
    timings.modules = bundle.cache?.modules?.length || 0;
    const writeStarted = performance.now();
    await bundle.write(output);
    timings.writeMs = Math.round(performance.now() - writeStarted);
    const completed = bundle;
    bundle = null;
    await completed.close();
    const publishStarted = performance.now();
    result = await publish(active.stage, join(root, 'dist'));
    timings.publishMs = Math.round(performance.now() - publishStarted);
    timings.totalMs = Math.round(performance.now() - started);
    console.log('[QGauss build] phases', JSON.stringify(timings));
  } catch (error) {
    failure = error;
  } finally {
    try { if (bundle) await bundle.close(); } catch (error) { failure ??= error; }
    const warnings = active.cleanup();
    if (warnings.length && result) result.cleanupWarnings = warnings;
    else if (warnings.length && failure) failure.cleanupWarnings = warnings;
  }
  if (failure) throw failure;
  return result;
}

export function watchWeb({ root = webRoot, report = console.log } = {}) {
  const active = context(root);
  try {
    const config = createWebConfig({ webRoot: root, outputRoot: active.stage, development: true });
    config.plugins.unshift({ name: 'qgauss-reset-own-stage', buildStart() {
      removeBuildStage(root, active.stage);
      mkdirSync(active.stage);
    } });
    const watcher = watch(config);
    let closed = false;
    watcher.on('event', async event => {
      if (event.code === 'BUNDLE_END') {
        try { report({ code: 'PUBLISHED', ...await publishWebBuild(active.stage, join(root, 'dist')) }); }
        catch (error) { report({ code: 'ERROR', message: error.message }); }
        finally { await event.result.close(); }
      } else if (event.code === 'ERROR') {
        report({ code: 'ERROR', message: event.error.message });
        if (event.result) await event.result.close();
      }
    });
    return { watcher, async close() {
      if (closed) return;
      closed = true;
      try { await watcher.close(); }
      finally { const warnings = active.cleanup(); if (warnings.length) report({ code: 'CLEANUP_WARNING', warnings }); }
    } };
  } catch (error) { active.cleanup(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--watch')) {
    const active = watchWeb({ report: event => console.log('[QGauss watch]', JSON.stringify(event)) });
    for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, async () => {
      try { await active.close(); } catch (error) { console.error(error); }
      process.exit(code);
    });
  } else {
    buildWeb().then(result => console.log('QGauss web build published:', JSON.stringify(result))).catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
