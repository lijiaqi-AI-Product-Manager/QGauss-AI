import 'reflect-metadata';
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {PresetsService} from '../dist/modules/presets/presets.service.js';

const directory = mkdtempSync(join(tmpdir(), 'qgauss-presets-'));
const database = join(directory, 'test.db');
execFileSync(process.execPath, ['prisma/migrate.mjs'], {
  env: {...process.env, DATABASE_FILE: database}, stdio: 'pipe', windowsHide: true,
});
const prisma = new SqliteClient({datasourceUrl: 'file:' + database.replaceAll('\\', '/')});
const presets = new PresetsService(prisma);
const status = code => error => error.getStatus?.() === code;
after(async () => {
  await prisma.$disconnect();
  assert.ok(realpathSync(directory).startsWith(realpathSync(tmpdir()) + sep + 'qgauss-presets-'));
  rmSync(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
});

test('the conversation library exposes enabled presets and archive and restore preserve the stored prompt', async () => {
  const group = await presets.createGroup({name: '项目协作'});
  const text = '保留 {原文} 和 $&。\n  这行有缩进。';
  const preset = await presets.createPreset({title: '整理项目', prompt: text, groupId: group.id, enabled: false});
  const live = async () => (await presets.listGrouped()).flatMap(row => row.items).find(row => row.id === preset.id);
  assert.equal(await live(), undefined);
  const enabled = await presets.updatePreset(preset.id, {enabled: true, expectedUpdatedAt: preset.updatedAt.toISOString()});
  assert.equal((await live()).prompt, text);
  await assert.rejects(presets.removePreset(preset.id, preset.updatedAt.toISOString()), status(409));
  await presets.removePreset(preset.id, enabled.updatedAt.toISOString());
  assert.equal(await live(), undefined);
  const archived = (await presets.adminList(true)).find(row => row.id === preset.id);
  assert.equal(archived.prompt, text);
  await assert.rejects(presets.restorePreset(preset.id, enabled.updatedAt.toISOString()), status(409));
  const restored = await presets.restorePreset(preset.id, archived.updatedAt.toISOString());
  assert.equal(restored.groupId, group.id);
  assert.equal(restored.enabled, true);
  assert.equal((await live()).prompt, text);
});

test('concurrent editors get one confirmed update and removing a group preserves its presets', async () => {
  const group = await presets.createGroup({name: '写作'});
  await assert.rejects(presets.createGroup({name: '写作'}), status(409));
  const preset = await presets.createPreset({title: '标题', prompt: '保留这段文字。', groupId: group.id});
  const expectedUpdatedAt = preset.updatedAt.toISOString();
  const updates = await Promise.allSettled([
    presets.updatePreset(preset.id, {title: '先保存', expectedUpdatedAt}),
    presets.updatePreset(preset.id, {title: '后保存', expectedUpdatedAt}),
  ]);
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(updates.find(result => result.status === 'rejected').reason.getStatus(), 409);
  const revisedGroup = await presets.updateGroup(group.id, {sort: 4, expectedUpdatedAt: group.updatedAt.toISOString()});
  await assert.rejects(presets.removeGroup(group.id, group.updatedAt.toISOString()), status(409));
  await presets.removeGroup(group.id, revisedGroup.updatedAt.toISOString());
  const ungrouped = (await presets.listGrouped()).find(row => row.id === 'ungrouped');
  assert.equal(ungrouped.items.find(row => row.id === preset.id).prompt, '保留这段文字。');
});
