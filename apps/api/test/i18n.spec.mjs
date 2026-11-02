import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, translateError } from '../dist/common/i18n/messages.js';

test('识别语言：默认中文', () => {
  assert.equal(detectLang(undefined), 'zh');
  assert.equal(detectLang(''), 'zh');
  assert.equal(detectLang('zh-CN,zh;q=0.9'), 'zh');
});

test('识别语言：en 开头走英文', () => {
  assert.equal(detectLang('en-US,en;q=0.9'), 'en');
  assert.equal(detectLang('en'), 'en');
});

test('中文场景保留原始 message', () => {
  assert.equal(translateError(2005, 'zh', '账号或密码错误'), '账号或密码错误');
  assert.equal(translateError(9999, 'zh', '自定义错误'), '自定义错误');
});

test('英文场景翻译已知错误码', () => {
  assert.equal(translateError(2005, 'en', '账号或密码错误'), 'Invalid credentials');
  assert.equal(translateError(7001, 'en', '内容包含敏感词'), 'Content blocked by moderation');
  assert.equal(translateError(6001, 'en', '额度用完'), 'Daily quota exceeded');
});

test('英文场景未知错误码回落原文', () => {
  assert.equal(translateError(9999, 'en', '自定义错误'), '自定义错误');
});
