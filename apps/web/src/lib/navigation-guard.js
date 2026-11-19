import { useAuth } from '../stores/auth.js';
import { useInstallation } from '../stores/installation.js';

export function adminVerificationDestination(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/chat';
  try {
    const path = decodeURIComponent(new URL(value, 'https://qgauss.invalid').pathname).toLowerCase();
    if (path.startsWith('//') || /^\/(?:login|verify-admin)\/?$/.test(path)) return '/chat';
    return value;
  } catch {
    return '/chat';
  }
}

export async function guardNavigation(to) {
  if (to.meta.systemStatus) return true;
  const installation = useInstallation();
  if (!installation.status && !installation.error) await installation.check();
  if (installation.status?.required || installation.error) return to.name === 'setup' ? true : { path: '/setup' };
  const auth = useAuth();
  if (auth.booting) await auth.bootstrap();
  if (auth.adminVerificationRequired) {
    if (to.meta.adminVerification) return true;
    const redirect = adminVerificationDestination(to.meta.authSurface ? to.query?.redirect : to.fullPath);
    return { name: 'verifyAdmin', query: { redirect } };
  }
  if (to.meta.adminVerification) {
    const redirect = adminVerificationDestination(to.query?.redirect);
    return auth.isLoggedIn ? redirect : { name: 'login', query: { redirect } };
  }
  if (to.meta.public && to.path !== '/agent/chat') {
    if (auth.isLoggedIn && to.name === 'login' && to.query?.mode !== 'forget') return { path: '/chat' };
    return true;
  }
  if (!auth.isLoggedIn) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.meta.admin && !auth.isAdmin) return { path: '/unauthorized' };
  return true;
}
