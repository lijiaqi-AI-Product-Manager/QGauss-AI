import { currentLang, setLang } from '../../i18n/index.js';

const texts = {
  zh: {
    invitationReady: '好友邀请码已填入，可自行修改。请核对后完成注册。',
    'auth.emailLogin': '邮箱/用户名登录', 'auth.phoneLogin': '手机号登录', 'auth.wechatLogin': '微信登录',
    'auth.emailTab': '邮箱', 'auth.phoneTab': '手机', 'auth.registerTab': '注册', 'auth.findPassword': '找回密码',
    'auth.enterLoginInfo': '请输入你的账号信息', 'auth.enterRegisterInfo': '请输入注册信息', 'auth.enterFindPwdInfo': '请输入您的注册邮箱',
    'setting.language': '语言', 'layout.langZhCN': '简体中文', 'layout.langZhTW': '繁體中文', 'layout.langEnUS': 'English',
    email: '邮箱', username: '用户名', password: '密码', account: '请输入用户名/邮箱号', passwordHint: '请输入您的账户密码',
    usernameHint: '请输入您的用户名昵称', emailHint: '请填写您的邮箱账号', passwordRule: '请输入 8–32 位密码', captcha: '验证码', captchaHint: '请填写图中验证码结果',
    submit: '登录账户', register: '立即注册', forgot: '忘记密码？', reset: '发送重置邮件', back: '返回登录',
    noAccount: '没有账户？', goRegister: '去注册', hasAccount: '已有账户？', goLogin: '去登录',
    agreement: '登陆默认已经阅读并同意', userAgreement: '《用户协议》', privacy: '《隐私政策》', and: '和',
    required: '请填写账号信息', agreementRequired: '请阅读并同意用户协议及隐私政策', loading: '处理中…', remember: '记住登录30天', cancel: '取消', accept: '同意', consentTitle: '用户协议及隐私政策', consentMessage: '我已阅读并同意', inviteCode: '邀请码', inviteHint: '邀请码（选填）',
    resetSent: '如果邮箱存在，重置邮件已发送', registrationClosed: '当前未开放注册，请联系管理员',
    agreementRegister: '注册默认已经阅读并同意', showPassword: '显示密码', hidePassword: '隐藏密码', changeCaptcha: '更换验证码', closeLogin: '关闭登录',
  },
  en: {
    invitationReady: 'Your friend’s invitation code is filled in. You can edit it before registering.',
    'auth.emailLogin': 'Email / Username Login', 'auth.phoneLogin': 'Phone Login', 'auth.wechatLogin': 'WeChat Login',
    'auth.emailTab': 'Email ', 'auth.phoneTab': 'Phone ', 'auth.registerTab': 'Registration', 'auth.findPassword': 'Reset Password',
    'auth.enterLoginInfo': 'Please enter your account information', 'auth.enterRegisterInfo': 'Please enter your registration information', 'auth.enterFindPwdInfo': 'Enter your registered email',
    'setting.language': 'Language', 'layout.langZhCN': '简体中文', 'layout.langZhTW': '繁體中文', 'layout.langEnUS': 'English',
    email: 'Email', username: 'Username', password: 'Password', account: 'Enter username / email', passwordHint: 'Enter your account password',
    usernameHint: 'Enter username', emailHint: 'Enter your email', passwordRule: 'Enter an 8–32 character password', captcha: 'Verification code', captchaHint: 'Enter verification code',
    submit: 'Log in', register: 'Register now', forgot: 'Forgot password?', reset: 'Send reset email', back: 'Back to login',
    noAccount: 'No account?', goRegister: 'Register', hasAccount: 'Already registered?', goLogin: 'Log in',
    agreement: 'By logging in you agree to the ', userAgreement: 'User Agreement', privacy: 'Privacy Policy', and: ' and ',
    required: 'Please enter your account information', agreementRequired: 'Please read and accept the user agreement and privacy policy', loading: 'Working…', remember: 'Remember me for 30 days', cancel: 'Cancel', accept: 'Agree', consentTitle: 'User Agreement and Privacy Policy', consentMessage: 'I have read and agree to the', inviteCode: 'Invitation code', inviteHint: 'Invitation code (optional)',
    resetSent: 'If the email exists, a reset email has been sent', registrationClosed: 'Registration is currently closed',
    agreementRegister: 'By registering you agree to the ', showPassword: 'Show password', hidePassword: 'Hide password', changeCaptcha: 'Refresh verification code', closeLogin: 'Close login',
  },
};
const traditional = {
  invitationReady: '好友邀請碼已填入，可自行修改。請核對後完成註冊。',
  'auth.emailLogin': '郵箱/用戶名登錄', 'auth.emailTab': '郵箱', 'auth.registerTab': '註冊', 'auth.findPassword': '找回密碼',
  'auth.enterLoginInfo': '請輸入你的帳號資訊', 'auth.enterRegisterInfo': '請輸入您的註冊資訊', 'auth.enterFindPwdInfo': '請輸入您的註冊郵箱',
  'setting.language': '語言', email: '郵箱', username: '用戶名', password: '密碼', account: '請輸入用戶名/郵箱號',
  passwordHint: '請輸入您的帳戶密碼', usernameHint: '請輸入用戶名', emailHint: '請輸入您的郵箱', passwordRule: '請輸入 8–32 位密碼',
  submit: '登錄帳戶', register: '立即註冊', forgot: '忘記密碼？', reset: '發送重設郵件', back: '返回登錄',
  noAccount: '沒有帳戶？', goRegister: '去註冊', hasAccount: '已有帳戶？', goLogin: '去登錄',
  agreement: '登錄默認已經閱讀並同意', userAgreement: '《用戶協議》', privacy: '《隱私政策》', and: '和',
  agreementRequired: '請閱讀並同意用戶協議及隱私政策', consentTitle: '用戶協議及隱私政策', consentMessage: '我已閱讀並同意', remember: '記住登錄30天', captcha: '驗證碼', captchaHint: '請輸入驗證碼', loading: '處理中…', accept: '同意', inviteCode: '邀請碼', inviteHint: '邀請碼（選填）',
  agreementRegister: '註冊默認已經閱讀並同意', showPassword: '顯示密碼', hidePassword: '隱藏密碼', changeCaptcha: '更換驗證碼', closeLogin: '關閉登錄',
};
texts['zh-TW'] = { ...texts.zh, ...traditional };
export function authText(key) { return texts[currentLang.value]?.[key] ?? texts.zh[key] ?? key; }
export function authLanguage() { return currentLang.value === 'en' ? 'en-US' : currentLang.value === 'zh-TW' ? 'zh-TW' : 'zh-CN'; }
export function setAuthLanguage(value) { setLang(value === 'auto' ? 'auto' : value === 'en-US' ? 'en' : value === 'zh-TW' ? 'zh-TW' : 'zh'); }
