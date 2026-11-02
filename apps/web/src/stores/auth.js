import { defineStore } from 'pinia';
import { api, setAccessToken } from '../api/client.js';

const REFRESH_KEY = 'qg:refresh';

function sessionToken() {
  try { return sessionStorage.getItem(REFRESH_KEY) || ''; } catch { return ''; }
}

function readStoredToken(remember = true) {
  try {
    return (remember ? localStorage : sessionStorage).getItem(REFRESH_KEY) || '';
  } catch {
    return '';
  }
}

function writeStoredToken(token, remember = true) {
  try {
    const storage = remember ? localStorage : sessionStorage;
    if (token) storage.setItem(REFRESH_KEY, token);
    else storage.removeItem(REFRESH_KEY);
  } catch {
    /* 隐私模式下 localStorage 可能抛错，只影响「刷新页面后免登录」 */
  }
}

// 同一时刻只允许一个刷新请求在飞：并发 401 共享结果，避免同一个令牌被重复消费
let inflight = null;
let syncing = false;

export const useAuth = defineStore('auth', {
  state: () => ({
    user: null,
    accessToken: '',
    remember: !sessionToken(),
    refreshToken: sessionToken() || readStoredToken(),
    sessionRevision: 0,
    identityRevision: 0,
    sessionNotice: '',
    booting: true,
  }),

  getters: {
    isLoggedIn: (s) => !!s.user,
    isAdmin: (s) => s.user?.role === 'ADMIN',
  },

  actions: {
    apply(data, { renewal = false } = {}) {
      this.sessionRevision += 1;
      if (!renewal) this.identityRevision += 1;
      this.sessionNotice = '';
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.user = data.user;
      setAccessToken(data.accessToken, (data.user?.id || '') + ':' + this.identityRevision);
      if (data.refreshToken) writeStoredToken(data.refreshToken, this.remember);
    },

    async login(account, password, { remember = true } = {}) {
      const data = await api.post('/auth/login', { account, password });
      writeStoredToken('', !remember);
      this.remember = remember;
      this.apply(data);
    },

    async register(payload) {
      this.apply(await api.post('/auth/register', payload));
    },

    /**
     * 刷新令牌：故意用裸 fetch，避免和 401 拦截器互相递归。
     * 只有服务端明确拒绝（401/403）才算登录失效；网络中断、页面卸载、5xx 都只返回 false，
     * 保留令牌等下次再试——否则用户连按两次刷新就会被踢下线。
     */
    async refresh() {
      // 多标签页共享同一个 refresh token：别的标签可能刚轮换过，以存储里的为准
      const latest = readStoredToken(this.remember);
      if (latest) this.refreshToken = latest;
      if (!this.refreshToken) return false;
      if (inflight) return inflight;
      const revision = this.sessionRevision;

      inflight = (async () => {
        let res;
        try {
          res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: this.refreshToken }),
          });
        } catch {
          return false;
        }
        // 登出或切换账号后，旧请求的成功 / 失败都不能覆盖当前会话。
        if (revision !== this.sessionRevision) return false;
        if (res.status === 401 || res.status === 403) {
          this.clearLocal();
          return false;
        }
        if (!res.ok) return false;
        const json = await res.json().catch(() => null);
        if (revision !== this.sessionRevision) return false;
        if (!json?.data?.accessToken) return false;
        this.apply(json.data, { renewal: true });
        return true;
      })();

      try {
        return await inflight;
      } finally {
        inflight = null;
      }
    },

    async bootstrap() {
      this.booting = true;
      this.listenOtherTabs();
      try {
        if (this.refreshToken || readStoredToken(this.remember)) {
          // 网络抖动时再给一次机会，别让用户一打开就看到登录页
          if (!(await this.refresh()) && readStoredToken(this.remember)) {
            await new Promise((resolve) => setTimeout(resolve, 800));
            await this.refresh();
          }
        }
        if (this.accessToken) {
          try {
            this.user = await api.get('/auth/me');
          } catch (e) {
            if (e?.status === 401 || e?.status === 403) this.clearLocal();
          }
        }
      } finally {
        this.booting = false;
      }
    },

    /** 其他标签页登出 / 轮换令牌时同步到本页 */
    listenOtherTabs() {
      if (syncing || typeof window === 'undefined') return;
      syncing = true;
      window.addEventListener('storage', (e) => {
        if (!this.remember) return;
        if (e.key !== REFRESH_KEY) return;
        if (e.newValue) this.refreshToken = e.newValue;
        else if (this.user) this.clearLocal();
      });
    },

    /** 只清本地状态，不通知服务端（服务端已判定失效，或别的标签已经登出） */
    clearLocal(notice = '') {
      this.sessionRevision += 1;
      this.identityRevision += 1;
      this.sessionNotice = ['password-changed', 'password-unknown'].includes(notice) ? notice : '';
      this.user = null;
      this.accessToken = '';
      this.refreshToken = '';
      setAccessToken('', 'signed-out:' + this.identityRevision);
      writeStoredToken('', this.remember);
    },

    async logout() {
      const token = this.refreshToken || readStoredToken(this.remember);
      this.clearLocal();
      if (!token) return;
      // 服务端也要吊销：只清本地的话，库里这条 refresh token 仍然能换出新会话。
      // 用裸 fetch 而不是 api，避免和 401 自动刷新互相递归。
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token }),
          keepalive: true,
        });
      } catch {
        /* 离线/已失效都不影响本地登出 */
      }
    },
  },
});
