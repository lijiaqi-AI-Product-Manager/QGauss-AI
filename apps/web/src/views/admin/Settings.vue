<template>
  <div class="qev-settings" style="padding: 20px; height: 100%; overflow: auto">
    <section class="qev-card qev-admission" aria-label="注册与邮箱验证设置"><div class="qev-top"><span class="qev-envelope" aria-hidden="true"><i></i><b>✦</b></span><div><span class="qev-eyebrow">A GOOD BEGINNING / QGAUSS AI</span><h3>每个新空间，都有可靠的起点。</h3><p>发件准备好后，可在下方安全设置开启新用户邮箱必验；已有账户仍可登录。</p></div></div><p class="qev-address"><span>{{ emailPolicy?.emailDeliveryReady ? '发件设置已准备，真实收件仍需体验信核对。' : '发件设置尚未准备，邮箱必验暂不可开启。' }}</span><router-link to="/mail">前往邮件中心 ↗</router-link></p></section>
    <el-card v-for="group in groups" :key="group.name" shadow="never" style="margin-bottom: 16px">
      <template #header>
        <span style="text-transform: capitalize">{{ groupLabel(group.name) }}</span>
      </template>

      <el-form label-width="220" style="max-width: 760px">
        <el-form-item v-for="item in group.items" :key="item.key" :label="item.description || item.key">
          <div style="width: 100%">
            <el-switch v-if="item.type === 'boolean'" v-model="draft[item.key]" :disabled="item.key === 'security.emailVerificationRequired' && !emailPolicy?.emailDeliveryReady && !draft[item.key]" />
            <el-input-number
              v-else-if="item.type === 'number'"
              v-model="draft[item.key]"
              :min="0"
              style="width: 220px"
            />
            <el-input v-else v-model="draft[item.key]" />
            <div style="font-size: 12px; color: var(--qg-sub); margin-top: 2px">
              默认设置：{{ typeof item.defaultValue === 'boolean' ? item.defaultValue ? '开启' : '关闭' : String(item.defaultValue) || '（空）' }}
              <el-tag v-if="item.public" size="small" type="info" style="margin-left: 6px">公开</el-tag>
            </div>
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="qev-settings-actions" style="position: sticky; bottom: 0; background: var(--qg-bg); padding: 12px 0">
      <el-button type="primary" :loading="saving" @click="save">保存全部</el-button>
      <el-button @click="load">重置</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElButton, ElCard, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElSwitch, ElTag } from 'element-plus';
import { api } from '../../api/client.js';
import '../../components/auth/email-verification.css';

const items = ref([]);
const draft = reactive({});
const saving = ref(false);
const emailPolicy=ref(null),policyAbort=new AbortController();
let alive=true;

const groups = computed(() => {
  const map = new Map();
  for (const item of items.value) {
    if (!map.has(item.group)) map.set(item.group, { name: item.group, items: [] });
    map.get(item.group).items.push(item);
  }
  return [...map.values()];
});

function groupLabel(name) {
  return { apps:'应用与创作者', site: '站点', chat: '对话', security: '安全', quota: '配额', upstream: '上游', upload: '上传' }[name] ?? name;
}

async function load() {
  items.value = await api.get('/settings');
  for (const item of items.value) draft[item.key] = item.value;
}

async function save() {
  saving.value = true;
  try {
    const settings = items.value.map((i) => ({ key: i.key, value: draft[i.key] }));
    await api.put('/settings', { settings });
    ElMessage.success('已保存，配置立即生效');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(()=>{load();api.get('/auth/registration-policy',{signal:policyAbort.signal,retry:false}).then(row=>{if(alive)emailPolicy.value=row;}).catch(()=>{});});
onBeforeUnmount(()=>{alive=false;policyAbort.abort();});
</script>
<style scoped>.qev-admission{margin-bottom:20px}.qev-address a{flex-shrink:0;color:var(--qd-brand);text-decoration:none;font-size:12px}@media(max-width:600px){.qev-settings{padding:14px 14px 110px!important}.qev-admission .qev-top{align-items:flex-start}.qev-admission .qev-address{align-items:flex-start;flex-direction:column}.qev-settings :deep(.el-form-item){display:block}.qev-settings :deep(.el-form-item__label){float:none;width:auto!important;height:auto;line-height:1.7;white-space:normal;padding:0 0 8px;justify-content:flex-start}.qev-settings :deep(.el-form-item__content){margin-left:0!important;min-width:0}.qev-settings :deep(.el-input-number){width:100%!important}.qev-settings :deep(.el-input__inner){font-size:16px;min-height:48px}.qev-settings :deep(.el-switch){min-height:48px}.qev-settings-actions{bottom:74px!important;z-index:3}.qev-settings-actions :deep(.el-button){min-height:48px}}</style>
