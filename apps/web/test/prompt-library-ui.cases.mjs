const draftText = '我的原始草稿 {name} $&。';
const promptText = '用三句话整理项目。\n保留 {topic} 和换行。';
const presets = [
  {id: 'work', name: '工作', items: [{id: 'summary', title: '项目提炼', prompt: promptText}]},
  {id: 'ungrouped', name: '未分组', items: [{id: 'question', title: '澄清问题', prompt: '先找出最重要的未知点。'}]},
];

export function registerPromptLibraryTests({test, assert, mount, settle, relayJson, setLang}) {
  const dialog = () => document.querySelector('.qpl-dialog');
  const composer = () => document.querySelector('.cv-input');
  const open = () => document.querySelector('.cv-tools button[aria-label="预设"]');
  const calls = fixture => fixture.calls.filter(call => call.url === '/api/presets');
  const send = fixture => fixture.calls.filter(call => call.url === '/api/chat/completions');

  function input(element, value) {
    element.value = value;
    element.dispatchEvent(new Event('input', {bubbles: true}));
  }

  test('prompt library previews matching text and inserts it without replacing or sending the draft', async () => {
    const fixture = await mount({
      loggedIn: true,
      initialPath: '/chat?new=1',
      intercept: call => call.url === '/api/presets' ? relayJson(presets) : null,
    });
    try {
      assert.equal(calls(fixture).length, 0);
      input(composer(), draftText);
      open().click();
      await settle();
      assert.equal(dialog().open, true);
      assert.equal(calls(fixture).length, 1);
      input(dialog().querySelector('input[type=search]'), '最重要');
      await settle();
      assert.equal(dialog().querySelectorAll('.qpl-results button').length, 1);
      assert.match(dialog().querySelector('.qpl-results button').textContent, /澄清问题/);
      input(dialog().querySelector('input[type=search]'), '项目');
      await settle();
      dialog().querySelector('.qpl-results button').click();
      await settle();
      assert.equal(dialog().querySelector('.qpl-prompt').textContent, promptText);
      assert.equal(composer().value, draftText);
      setLang('en');
      await settle();
      assert.equal(dialog().getAttribute('aria-label'), 'Prompt library');
      assert.equal(dialog().querySelector('.qpl-prompt').textContent, promptText);
      dialog().querySelector('.qpl-primary').click();
      await settle();
      assert.equal(dialog().open, false);
      assert.equal(composer().value, promptText + '\n\n' + draftText);
      assert.deepEqual(send(fixture), []);
      assert.deepEqual(fixture.errors, []);
    } finally {
      await fixture.close();
      setLang('zh');
    }
  });

  test('prompt library can recover from a failed read independently of the chat composer', async () => {
    let attempts = 0;
    const fixture = await mount({
      loggedIn: true,
      initialPath: '/chat?new=1',
      intercept: call => {
        if (call.url !== '/api/presets') return null;
        return ++attempts === 1 ? relayJson('Temporarily unavailable', 503) : relayJson(presets);
      },
    });
    try {
      input(composer(), draftText);
      const sendButton = document.querySelector('.cv-send');
      await settle();
      assert.equal(sendButton.disabled, false);
      open().click();
      await settle();
      assert.match(dialog().querySelector('[role=status]').textContent, /暂时未能加载/);
      dialog().querySelector('.qpl-primary').click();
      await settle();
      assert.equal(dialog().querySelectorAll('.qpl-results button').length, 2);
      dialog().querySelector('.qpl-icon-button').click();
      await settle();
      assert.equal(dialog().open, false);
      assert.equal(composer().value, draftText);
      assert.equal(calls(fixture).length, 2);
      assert.deepEqual(send(fixture), []);
      assert.deepEqual(fixture.errors, []);
    } finally {
      await fixture.close();
    }
  });

  test('prompt library ignores a previous account response after switching accounts', async () => {
    let reply;
    let timedRead;
    const fixture = await mount({
      loggedIn: true,
      initialPath: '/chat?new=1',
      intercept: call => {
        if (call.url !== '/api/presets') return null;
        timedRead = call;
        return new Promise(resolve => { reply = () => resolve(relayJson(presets)); });
      },
    });
    try {
      open().click();
      await settle();
      assert.equal(dialog().open, true);
      assert.equal(timedRead.signal.aborted, false);
      fixture.auth.apply({
        accessToken: 'next-test-token',
        user: {id: 'next-test-user', username: 'New account', role: 'USER'},
      });
      await settle();
      assert.equal(timedRead.signal.aborted, true);
      reply();
      await settle();
      assert.equal(document.querySelector('.qpl-dialog[open]'), null);
      assert.doesNotMatch(document.body.textContent, /项目提炼/);
      assert.deepEqual(send(fixture), []);
      assert.deepEqual(fixture.errors, []);
    } finally {
      reply?.();
      await fixture.close();
    }
  });

  test('preset studio previews archive and restore and submits the exact reviewed revision', async () => {
    const initial = '2026-11-01T00:00:00.000Z';
    const archivedAt = '2026-11-01T00:00:01.000Z';
    const row = {id: 'preset-1', title: '原有提示词', prompt: promptText, groupId: null, group: null, enabled: true, sort: 0, updatedAt: initial};
    let archived = false;
    const fixture = await mount({
      loggedIn: true,
      admin: true,
      initialPath: '/presets',
      intercept: call => {
        if (call.url === '/api/presets/groups') return relayJson([]);
        if (call.url === '/api/presets/admin') return relayJson(archived ? [] : [row]);
        if (call.url === '/api/presets/admin?archive=1') return relayJson(archived ? [{...row, updatedAt: archivedAt}] : []);
        if (call.method === 'DELETE') {
          archived = true;
          return relayJson({ok: true});
        }
        if (call.method === 'POST' && call.url === '/api/presets/preset-1/restore') {
          archived = false;
          return relayJson(row, 201);
        }
        return null;
      },
    });
    function click(label, root = document.querySelector('.qpa-page')) {
      const button = [...root.querySelectorAll('button')].find(element => element.textContent.trim() === label);
      assert.ok(button, label);
      button.click();
    }
    const writes = () => fixture.calls.filter(call => call.url.startsWith('/api/presets/') && call.method !== 'GET');
    try {
      click('移入回收站');
      await settle();
      assert.deepEqual(writes(), []);
      const modal = document.querySelector('.qpa-dialog');
      assert.equal(modal.open, true);
      assert.match(modal.textContent, /原有提示词/);
      click('确认', modal);
      await settle();
      assert.equal(writes().length, 1);
      assert.equal(new URL(writes()[0].url, 'https://local.test').searchParams.get('expectedUpdatedAt'), initial);
      click('回收站');
      await settle();
      click('恢复预设');
      await settle();
      click('确认', modal);
      await settle();
      assert.equal(writes().length, 2);
      assert.deepEqual(writes()[1].body, {expectedUpdatedAt: archivedAt});
      click('使用中');
      await settle();
      assert.equal(document.querySelector('.qpa-excerpt').textContent, promptText);
      assert.deepEqual(fixture.errors, []);
    } finally {
      await fixture.close();
    }
  });
}
