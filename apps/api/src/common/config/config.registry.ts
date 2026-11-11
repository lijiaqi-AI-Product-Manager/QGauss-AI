/**
 * 配置注册表：所有可配置项的唯一定义处。
 *
 * 规则（采纳评审建议 #8）：
 *   - 数据库只存"覆盖值"，默认值、类型、分组、说明都在这里
 *   - 未知 key 一律拒绝写入
 *   - 读取时做类型校验，非法值回落默认值并告警
 *
 * 这样改错一个值不会把线上打挂，也不会出现"配置项散落各处"的问题。
 */

export type ConfigType = 'string' | 'number' | 'boolean';
export type ConfigValue = string | number | boolean;

export interface ConfigDef {
  key: string;
  type: ConfigType;
  default: ConfigValue;
  group: string;
  description: string;
  /** 是否允许未登录读取 */
  public?: boolean;
  min?: number;
  max?: number;
}

export const CONFIG_REGISTRY: ConfigDef[] = [
  {key:'security.phonePasswordEnabled',type:'boolean',default:true,group:'security',description:'允许已绑定号码使用密码登录'},
  {key:'security.phoneRegistrationEnabled',type:'boolean',default:true,group:'security',description:'开放注册时允许通过手机验证创建账户'},
  {key:'security.smsDailyLimit',type:'number',default:1000,group:'security',description:'全站最近二十四小时最多接收的短信申请数',min:1,max:10000},
  {key:'security.externalLoginEnabled',type:'boolean',default:true,group:'security',description:'允许通过已配置的外部身份登录'},
  {key:'security.externalRegistrationEnabled',type:'boolean',default:true,group:'security',description:'允许通过验证后的外部身份创建账户'},
  {key:'security.externalDailyLimit',type:'number',default:1000,group:'security',description:'全站最近二十四小时最多准备的外部身份连接数',min:1,max:10000},
  ...(['model3','model4','drawMj','agent'] as const).map(pool=>({key:'apps.reviewReward.'+pool,type:'number' as const,default:0,group:'apps',description:'用户应用首次审核通过赠送'+({model3:'基础次数',model4:'高级次数',drawMj:'绘画次数',agent:'应用次数'})[pool],min:0,max:10000})),
  { key:'security.voiceRateLimit',type:'number',default:20,group:'security',description:'单用户每分钟最多发起的语音生成次数',min:1,max:1000 },
  { key:'security.videoRateLimit',type:'number',default:10,group:'security',description:'单用户每分钟最多发起的视频创作次数',min:1,max:1000 },
  { key:'security.mjRateLimit',type:'number',default:10,group:'security',description:'单用户每分钟最多发起的 MJ 创作次数',min:1,max:1000 },
  { key:'security.mjQuoteRateLimit',type:'number',default:30,group:'security',description:'单用户每分钟最多核对的 MJ 创作报价次数',min:1,max:1000 },
  { key:'security.videoQuoteRateLimit',type:'number',default:20,group:'security',description:'单用户每分钟最多核对的视频创作报价次数',min:1,max:1000 },
  {
    key: 'site.name',
    type: 'string',
    default: 'QGauss AI',
    group: 'site',
    description: '站点名称',
    public: true,
  },
  {
    key: 'site.welcome',
    type: 'string',
    default: '你好，我是你的 AI 助手。',
    group: 'site',
    description: '对话页欢迎语',
    public: true,
  },
  {
    key: 'site.announcement',
    type: 'string',
    default: '',
    group: 'site',
    description: '全站公告（留空不显示）',
    public: true,
  },
  {
    key: 'chat.defaultModel',
    type: 'string',
    default: 'mock-chat',
    group: 'chat',
    description: '新建会话的默认模型名',
    public: true,
  },
  {
    key: 'chat.maxConcurrentStreams',
    type: 'number',
    default: 2,
    group: 'chat',
    description: '单用户同时生成的回复上限（含后台继续的任务）',
    min: 1,
    max: 50,
  },
  {
    key: 'chat.runDetachedTimeoutMs', type: 'number', default: 120000, group: 'chat',
    description: '无人查看的生成任务自动停止等待时间（毫秒）', min: 1000, max: 3600000,
  },
  {
    key: 'chat.maxAttachments',
    type: 'number',
    default: 9,
    group: 'chat',
    description: '单条消息最多附带的文件数（图片 + 文档）',
    min: 1,
    max: 20,
  },
  {
    key: 'chat.attachmentMaxChars',
    type: 'number',
    default: 20000,
    group: 'chat',
    description: '单个文档注入上下文的最大字符数，超出部分截断并提示',
    min: 1000,
    max: 200000,
  },
  {
    key: 'security.registerEnabled',
    type: 'boolean',
    default: false,
    group: 'security',
    description: '是否开放注册（关闭时只能由管理员建号）',
    public: true,
  },
  {
    key: 'security.registerInviteCode',
    type: 'string',
    default: '',
    group: 'security',
    description: '注册邀请码（留空表示不需要）',
  },
  {
    key: 'security.emailVerificationRequired',
    type: 'boolean',
    default: false,
    group: 'security',
    description: '新用户注册时必须验证邮箱（需先准备发件设置；已有账号可继续登录）',
    public: true,
  },
  {
    key: 'security.captchaEnabled',
    type: 'boolean',
    default: false,
    group: 'security',
    description: '注册是否必须填写图形验证码（开启后不可省略）',
  },
  {
    key: 'quota.dailyTokens',
    type: 'number',
    default: 200000,
    group: 'quota',
    description: '每用户每日 token 上限（0 表示不限）',
    min: 0,
  },
  {
    key: 'upstream.allowHttp',
    type: 'boolean',
    default: false,
    group: 'upstream',
    description: '是否允许 http（非 https）上游地址',
  },
  {
    key: 'upstream.hostAllowlist',
    type: 'string',
    default: '',
    group: 'upstream',
    description: '上游主机白名单，逗号分隔；留空表示不限制（仍受内网屏蔽保护）',
  },
  {
    key: 'upload.maxSizeMb',
    type: 'number',
    default: 10,
    group: 'upload',
    description: '单文件大小上限（MB）',
    min: 1,
    max: 200,
  },
  {
    key: 'upload.allowedMime',
    type: 'string',
    default:
      'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,' +
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    group: 'upload',
    description: '允许的 MIME 类型，逗号分隔；按文件内容嗅探结果判定',
  },
  {
    key: 'site.baseUrl',
    type: 'string',
    default: 'http://localhost:5173',
    group: 'site',
    description: '前端访问地址，用于生成邮件里的链接',
    public: true,
  },
  {
    key: 'security.loginRateLimit',
    type: 'number',
    default: 10,
    group: 'security',
    description: '登录尝试：每 IP 每分钟次数（0 表示不限）',
    min: 0,
  },
  {
    key: 'security.registerRateLimit',
    type: 'number',
    default: 5,
    group: 'security',
    description: '注册：每 IP 每分钟次数（0 表示不限）',
    min: 0,
  },
  {
    key: 'security.chatRateLimit',
    type: 'number',
    default: 30,
    group: 'security',
    description: '对话：每用户每分钟次数（0 表示不限）',
    min: 0,
  },
  {
    key: 'image.defaultChannel',
    type: 'string',
    default: '',
    group: 'image',
    description: '图像生成使用的渠道 ID（留空则取第一个可用渠道）',
  },
  {
    key: 'image.model',
    type: 'string',
    default: '',
    group: 'image',
    description: '图像上游模型名（如 gpt-image-2.5）；留空则由供应商默认',
  },
  {
    key: 'demo.siteEnabled',
    type: 'boolean',
    default: false,
    group: 'demo',
    description: '演示站模式：AI 请求不调用上游，仅返回演示提示',
    public: true,
  },
  {
    key: 'demo.payDisabled',
    type: 'boolean',
    default: false,
    group: 'demo',
    description: '演示站禁用前台支付入口（commerce.enabled 为 true 时生效）',
    public: true,
  },

  // ---- 商业化（批 1 账本与支付内核）----
  {
    key: 'commerce.enabled',
    type: 'boolean',
    default: false,
    group: 'commerce',
    description: '总开关：关闭时 /balance /crami /order /pay /sales /signin 一律 404，不扣费不计次',
    public: true,
  },
  {
    key: 'commerce.rechargeEnabled',
    type: 'boolean',
    default: false,
    group: 'commerce',
    description: '前台是否展示充值入口（关闭时只能由管理员或卡密发放）',
    public: true,
  },
  {
    key: 'commerce.signinEnabled',
    type: 'boolean',
    default: false,
    group: 'commerce',
    description: '每日签到是否开放',
    public: true,
  },
  {
    key: 'commerce.signinCount',
    type: 'number',
    default: 5,
    group: 'commerce',
    description: '每次签到奖励的次数（发放到 commerce.signinPool 指定的池）',
    min: 0,
    max: 100000,
  },
  {
    key: 'commerce.signinPool',
    type: 'string',
    default: 'model3',
    group: 'commerce',
    description: '签到奖励发放到哪个次数池：model3 / model4 / drawMj / agent',
  },
  {
    key: 'commerce.orderTimeoutMinutes',
    type: 'number',
    default: 30,
    group: 'commerce',
    description: '订单未支付超时时间（分钟），超时后回调一律拒绝',
    min: 1,
    max: 1440,
  },
  {
    key: 'commerce.defaultCommissionBps',
    type: 'number',
    default: 0,
    group: 'commerce',
    description: '新分销员默认佣金比例，万分比（1000 = 10%）',
    min: 0,
    max: 10000,
  },
  {
    key: 'commerce.currency',
    type: 'string',
    default: 'CNY',
    group: 'commerce',
    description: '结算币种（仅用于展示，支付渠道需自行匹配）',
    public: true,
  },
  {
    key: 'commerce.minWithdrawalCents',
    type: 'number',
    default: 1000,
    group: 'commerce',
    description: '最低提现金额（分）',
    min: 0,
  },
  {
    key: 'commerce.payProviders',
    type: 'string',
    default: 'mock',
    group: 'commerce',
    description: '启用的支付通道，逗号分隔（mock / epay / hupi）；密钥读 .env，不落数据库',
    public: true,
  },
  {
    key: 'commerce.payNotifyBaseUrl',
    type: 'string',
    default: '',
    group: 'commerce',
    description: '支付回调对外地址（留空则用 site.baseUrl），必须公网可达',
  },
  {
    key: 'commerce.exchangeRateLimit',
    type: 'number',
    default: 10,
    group: 'commerce',
    description: '每个用户每分钟最多核销卡密次数（防撞码）',
    min: 0,
  },
  {
    key: 'commerce.orderRateLimit',
    type: 'number',
    default: 20,
    group: 'commerce',
    description: '每个用户每分钟最多下单次数（防刷单）',
    min: 0,
  },
  {
    key: 'commerce.withdrawRateLimit',
    type: 'number',
    default: 5,
    group: 'commerce',
    description: '每个用户每分钟最多申请提现次数',
    min: 0,
  },
  {
    key: 'commerce.mockPayRateLimit',
    type: 'number',
    default: 20,
    group: 'commerce',
    description: '每个用户每分钟最多调用模拟支付次数（仅开发环境生效）',
    min: 0,
  },
  {
    key: 'commerce.notifyRateLimit',
    type: 'number',
    default: 120,
    group: 'commerce',
    description: '每个 IP 每分钟最多接收的支付回调次数（网关会重推，别设太小）',
    min: 0,
  },
  {
    key: 'commerce.imageCost',
    type: 'number',
    default: 1,
    group: 'commerce',
    description: '每张生成图片扣除的绘图片数（0 表示不扣）',
    min: 0,
  },
];

export const CONFIG_MAP = new Map(CONFIG_REGISTRY.map((d) => [d.key, d]));

export function isKnownConfig(key: string): boolean {
  return CONFIG_MAP.has(key);
}

/** 校验并规范化一个配置值；不合法返回 null */
export function coerceConfigValue(def: ConfigDef, input: unknown): ConfigValue | null {
  if (def.type === 'string') {
    return typeof input === 'string' ? input : input == null ? '' : String(input);
  }
  if (def.type === 'boolean') {
    if (typeof input === 'boolean') return input;
    if (input === 'true' || input === '1') return true;
    if (input === 'false' || input === '0') return false;
    return null;
  }
  // number
  const num = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(num)) return null;
  if (def.min !== undefined && num < def.min) return null;
  if (def.max !== undefined && num > def.max) return null;
  return num;
}
