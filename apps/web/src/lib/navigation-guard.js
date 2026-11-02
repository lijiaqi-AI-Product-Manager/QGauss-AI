import { useAuth } from '../stores/auth.js';
import { useInstallation } from '../stores/installation.js';

export async function guardNavigation(to) {
  const installation = useInstallation();
  if (!installation.status && !installation.error) await installation.check();
  if (installation.status?.required || installation.error) return to.name === 'setup' ? true : { path: '/setup' };
  const auth = useAuth();
  if (auth.booting) await auth.bootstrap();
  if (to.meta.public && to.path !== '/agent/chat') {
    if (auth.isLoggedIn && to.name === 'login') return { path: '/chat' };
    return true;
  }
  if (!auth.isLoggedIn) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.meta.admin && !auth.isAdmin) return { path: '/chat' };
  return true;
}
