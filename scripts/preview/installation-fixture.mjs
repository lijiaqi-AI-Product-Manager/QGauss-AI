/** Explicit synthetic GET-only onboarding observations. Writes remain unsupported by the preview. */
export function installationFixtures(state) {
  const required = state?.startsWith('install-') && state !== 'install-closed';
  const ready = state === 'welcome-ready';
  return {
    '/api/installation/status': { required: !!required, canInitialize: !!required && !['install-locked', 'install-insecure'].includes(state), needsSecureConnection: state === 'install-insecure' },
    '/api/installation/readiness': {
      canEnableDemo: !ready, chatModel: ready ? { name: 'qgauss-demo-chat', displayName: 'QGauss 本地体验', demo: true, billing: { mode: 'none', amount: 0 } } : null,
      checks: [
        { id: 'account', state: 'ready', title: '守好空间的第一把钥匙', description: '明确的合成管理员样例，未修改任何真实账户。', action: { label: '查看账户与密码', path: '/account?section=security' } },
        { id: 'model', state: ready ? 'configured' : 'missing', title: '让一位创作搭档就位', description: ready ? 'QGauss 本地体验是离线演示，不代表真实模型能力。' : '还没有可用的对话模型，可以连接渠道或明确开启本地体验。', action: { label: '连接模型服务', path: '/models/channels' } },
        { id: 'mail', state: 'optional', title: '为账户留一条返回的路', description: '此观察样例不发邮件，邮件配置不代表投递成功。', action: { label: '核对站点地址', path: '/settings' } },
        { id: 'creation', state: ready ? 'ready' : 'action', title: '留下你的第一份创作', description: ready ? '此处是已完成创作的合成观察状态。' : '准备好内容后，在工作区明确开始生成。', action: { label: '打开创作工作区', path: '/chat' } },
        { id: 'opening', state: 'optional', title: '按准备程度，决定开放节奏', description: '商业化保持关闭，先体验创作，再考虑开放与收付款。', action: { label: '查看开放设置', path: '/settings' } },
      ],
    },
  };
}
