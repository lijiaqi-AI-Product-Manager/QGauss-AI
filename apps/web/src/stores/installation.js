import { defineStore } from 'pinia';
import { api } from '../api/client.js';
const checks = new WeakMap();

// Public facts only. The operator's installation credential stays in the form instance.
export const useInstallation = defineStore('installation', {
  state: () => ({ status: null, error: '', loading: false }),
  actions: {
    async check() {
      if (checks.has(this)) return checks.get(this);
      this.loading = true;
      this.error = '';
      const task = (async () => { try {
        const result = await api.get('/installation/status', { retry: false });
        if (typeof result?.required !== 'boolean' || typeof result?.canInitialize !== 'boolean') throw new Error('暂时无法确认站点状态，请重试。');
        this.status = result;
        return result;
      } catch (error) {
        this.status = null;
        this.error = error?.message || '无法连接站点，请稍后重试。';
        return null;
      } finally {
        this.loading = false;
        checks.delete(this);
      } })();
      checks.set(this, task);
      return task;
    },
  },
});
