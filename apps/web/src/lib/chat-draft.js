const KEY = 'qg:guest-draft';
export function saveGuestDraft(text) { try { sessionStorage.setItem(KEY, String(text || '').slice(0, 12000)); } catch { /* 不能保存时仍可进入登录 */ } }
export function takeGuestDraft() { try { const text = sessionStorage.getItem(KEY) || ''; sessionStorage.removeItem(KEY); return text; } catch { return ''; } }
