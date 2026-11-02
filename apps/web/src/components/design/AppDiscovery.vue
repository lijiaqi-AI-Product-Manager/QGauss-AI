<template>
  <section class="qa-discovery" aria-label="应用发现">
    <header class="qa-hero">
      <div class="qa-hero-copy"><span class="qa-eyebrow"><i></i> SMALL TEAMS. BIG IDEAS.</span><h1>好想法，<br>总有<span>好搭档。</span><em>✦</em></h1><p>写作、学习、规划、灵感。<br>让各有所长的 AI，加入你的创作小队。</p><a class="qa-explore" href="#qa-library"><ClientIcon name="apps" />探索应用<small>向下发现</small><ClientIcon name="arrow" /></a></div>
      <div class="qa-constellation" aria-hidden="true"><div class="qa-orbit qa-orbit-one"></div><div class="qa-orbit qa-orbit-two"></div><div class="qa-glass-core"><span>Q</span><i></i><b>IDEAS<br>COME TOGETHER</b></div><span class="qa-floating qa-floating-write"><ClientIcon name="write" /></span><span class="qa-floating qa-floating-reason"><ClientIcon name="reasoning" /></span><span class="qa-floating qa-floating-spark"><ClientIcon name="spark" /></span><span class="qa-hero-star">✦</span><span class="qa-orbit-caption">YOUR CREATIVE CREW / QGAUSS AI</span></div>
      <div class="qa-hero-sticker"><span>✳</span><p>把擅长的事<br><b>交给好搭档</b></p></div>
    </header>

    <section id="qa-library" class="qa-library" aria-labelledby="qa-library-title">
      <div class="qa-library-heading"><div><span class="qa-eyebrow">FIND YOUR PEOPLE, IN AI</span><h2 id="qa-library-title">今天，和谁一起发光？</h2></div><label class="qa-search"><ClientIcon name="search" /><input v-model="keyword" type="search" maxlength="200" placeholder="搜名字、能力或模型" aria-label="搜索应用" /><button v-if="keyword" type="button" aria-label="清空应用搜索" @click="keyword = ''"><ClientIcon name="close" /></button></label></div>
      <div class="qa-filter-bar"><div class="qa-categories" aria-label="应用分类"><button type="button" class="qg-vendor-chip" :class="{ active: !categoryId }" :aria-pressed="!categoryId" @click="filterBy('')">全部搭档</button><button v-for="c in categories" :key="c.id" type="button" class="qg-vendor-chip" :class="{ active: categoryId === c.id }" :aria-pressed="categoryId === c.id" @click="filterBy(c.id)">{{ c.name }}</button></div><button type="button" class="qa-favorites-filter" :aria-pressed="favoritesOnly" @click="favoritesOnly = !favoritesOnly"><span>♡</span>我的收藏</button></div>
      <div v-if="categoryError" class="qa-inline-error" role="alert">{{ categoryError }}<button type="button" @click="loadCategories">重试分类</button></div>
      <div class="qa-result-line" role="status"><span v-if="loadError">搭档列表暂未更新</span><span v-else>{{ favoritesOnly ? '收藏的' : '为你找到' }} <b>{{ loading ? '…' : filtered.length }}</b> 位搭档<span v-if="categoryId"> · {{ selectedCategory }}</span></span><button type="button" :disabled="loading" @click="loadMarket"><ClientIcon name="refresh" />刷新</button></div>
      <div v-if="loading" class="qa-loading" role="status"><BrandLoader :size="45" text="正在集合你的灵感小队…" /><div class="qa-skeletons" aria-hidden="true"><span v-for="i in 3" :key="i"></span></div></div>
      <div v-else-if="loadError" class="qa-empty" role="alert"><span class="qa-empty-object">☁</span><h3>搭档还在路上</h3><p>{{ loadError }}</p><button type="button" class="qgd-primary" @click="loadMarket">重新集合<ClientIcon name="refresh" /></button></div>
      <div v-else-if="!filtered.length" class="qa-empty"><span class="qa-empty-object">{{ favoritesOnly ? '♡' : '✳' }}</span><h3>{{ favoritesOnly ? '给喜欢的搭档，留个位置。' : keyword ? '换个词，让灵感碰个面。' : '这里，等着新的好搭档。' }}</h3><p>{{ favoritesOnly ? '在卡片上点一下爱心，就能在这里找到它。' : keyword ? '试试名称、介绍、分类或默认模型。' : '应用上架后，就会在这里与你相遇。' }}</p><button v-if="keyword || favoritesOnly || categoryId" type="button" class="qgd-primary" @click="resetFilters">看看全部搭档<ClientIcon name="arrow" /></button></div>
      <div v-else class="qa-card-grid">
        <article v-for="(app, index) in visibleApps" :key="app.id" class="qa-card" :class="'qa-tone-' + tone(app)" :style="{ '--qa-order': index % 9 }">
          <div class="qa-card-art"><span class="qa-card-orbit"></span><span class="qa-card-number">CREW / {{ String(index + 1).padStart(2, '0') }}</span><span class="qa-app-object"><ClientIcon :name="glyph(app)" /></span><span class="qa-card-spark">✦</span></div>
          <button type="button" class="apps-fav" :class="{ on: app.favorited }" :aria-label="(app.favorited ? '取消收藏：' : '收藏：') + app.name" :aria-pressed="!!app.favorited" :disabled="favoriteBusy.has(app.id)" :aria-busy="favoriteBusy.has(app.id)" @click="toggleFavorite(app)"><span>{{ favoriteBusy.has(app.id) ? '·' : app.favorited ? '♥' : '♡' }}</span></button>
          <button type="button" class="qa-card-open" :aria-label="'查看应用：' + app.name" @click="openDetail(app, $event)"><span class="qa-card-category">{{ app.category?.name || '灵感搭档' }}</span><h3>{{ app.name }}</h3><p>{{ app.description || '一个新的专业搭档，点开看看它的开场白。' }}</p><span class="qa-card-preview">认识一下<ClientIcon name="arrowUpRight" /></span></button>
          <footer><span :title="app.defaultModel || '使用站点默认模型'"><i></i>{{ app.defaultModel || '站点默认模型' }}</span><button type="button" class="qa-start" :aria-label="'与' + app.name + '开始新会话'" @click="launch(app, $event)">开始协作<ClientIcon name="arrow" /></button></footer>
        </article>
      </div>
      <div v-if="!loading && !loadError && filtered.length" class="qa-library-footer"><span>每个专业，都有新的可能。</span><button v-if="visibleApps.length < filtered.length" type="button" @click="limit += 9">再认识几位 <small>{{ visibleApps.length }} / {{ filtered.length }}</small><ClientIcon name="plus" /></button><span v-else>{{ filtered.length }} 位搭档 · 已全部展示 <i>✦</i></span></div>
    </section>

    <dialog ref="dialog" class="qa-detail-dialog" aria-labelledby="qa-detail-title" @cancel.prevent="closeDetail" @close="onNativeClose" @click="onBackdrop">
      <div class="qa-detail-shell" :class="'qa-tone-' + tone(detail || detailApp || {})">
        <button type="button" class="qa-detail-close" aria-label="关闭应用详情" @click="closeDetail"><ClientIcon name="close" /></button>
        <div class="qa-detail-art" aria-hidden="true"><span class="qa-detail-orbit"></span><span class="qa-app-object"><ClientIcon :name="glyph(detail || detailApp || {})" /></span><span class="qa-detail-stamp">YOUR NEXT<br>CREATIVE PARTNER</span><i>✦</i></div>
        <div class="qa-detail-content"><span class="qa-eyebrow">MEET YOUR CREATIVE CREW</span><h2 id="qa-detail-title">{{ detail?.name || detailApp?.name || '认识新搭档' }}</h2>
          <div v-if="detailLoading" class="qa-detail-loading" role="status"><BrandLoader :size="36" :text="launching ? '正在准备新的协作空间…' : '正在打开搭档档案…'" /></div>
          <div v-else-if="detailError" class="qa-detail-error" role="alert"><ClientIcon name="info" /><p>{{ detailError }}</p><button type="button" class="qgd-primary" @click="openDetail(detailApp)">重新查看<ClientIcon name="refresh" /></button></div>
          <template v-else-if="detail"><div class="qa-detail-tags"><span>{{ detail.category?.name || '灵感搭档' }}</span><span>{{ detail.defaultModel || '站点默认模型' }}</span></div><p class="qa-detail-description">{{ detail.description || '这个搭档还没有介绍，先从一句问候开始吧。' }}</p><section class="qa-greeting"><h3><ClientIcon name="chat" />它会这样和你打招呼<span>HELLO, YOU</span></h3><p>{{ detail.greeting || '你好，很高兴加入你的创作小队。今天想从什么开始？' }}</p><small v-if="!detail.greeting">开场白示意 · 应用尚未设置专属问候</small></section><p class="qa-launch-note">开启一个新的应用会话。准备好后，再发送你的第一个问题。</p><div class="qa-detail-actions"><button type="button" class="qa-start" @click="launch(detail)">开始新会话<ClientIcon name="arrowUpRight" /></button><button type="button" class="qa-detail-favorite" :aria-pressed="!!detail.favorited" :disabled="favoriteBusy.has(detail.id)" @click="toggleFavorite(detail)"><span>{{ detail.favorited ? '♥' : '♡' }}</span>{{ favoriteBusy.has(detail.id) ? '正在保存' : detail.favorited ? '已收藏' : '收藏搭档' }}</button></div></template>
        </div>
      </div>
    </dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../../api/client.js';
import { useAuth } from '../../stores/auth.js';
import ClientIcon from '../reference/ClientIcon.vue';
import BrandLoader from './BrandLoader.vue';
import './app-discovery.css';

const auth = useAuth(), router = useRouter();
const apps = ref([]), categories = ref([]), categoryId = ref(''), keyword = ref(''), favoritesOnly = ref(false), limit = ref(9);
const loading = ref(true), loadError = ref(''), categoryError = ref('');
const dialog = ref(null), detail = ref(null), detailApp = ref(null), detailLoading = ref(false), detailError = ref(''), launching = ref(false);
const favoriteBusy = reactive(new Set()), controllers = new Map(), favoriteUpdates = new Map();
let active = true, owner = auth.user?.id, opener = null, favoriteVersion = 0;
const current = () => active && !!owner && owner === auth.user?.id;
function scope(key) { controllers.get(key)?.abort(); const controller = new AbortController(); controllers.set(key, controller); const user = owner; return { signal: controller.signal, current: () => current() && user === owner && !controller.signal.aborted && controllers.get(key) === controller }; }
const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
const filtered = computed(() => { const words = normalized(keyword.value).split(/\s+/).filter(Boolean); return apps.value.filter(app => (!favoritesOnly.value || app.favorited) && words.every(word => normalized([app.name, app.description, app.category?.name, app.defaultModel, app.greeting].join(' ')).includes(word))); });
const visibleApps = computed(() => filtered.value.slice(0, limit.value));
const selectedCategory = computed(() => categories.value.find(c => c.id === categoryId.value)?.name || '所选分类');
function tone(app) { let hash = 0; for (const char of String(app.id || app.name || 'Q')) hash = (hash * 31 + char.codePointAt(0)) >>> 0; return ['violet', 'peach', 'sky', 'lime'][hash % 4]; }
function glyph(app) { const text = String(app.category?.name || '') + String(app.name || ''); return /写|文|表达/.test(text) ? 'write' : /学|知识|研|思/.test(text) ? 'reasoning' : /图|画|创意/.test(text) ? 'palette' : /计划|规划|工作/.test(text) ? 'layout' : 'spark'; }
function mergeFavorite(app, version) { const update = favoriteUpdates.get(app.id); return update && update.version > version ? { ...app, favorited: update.value } : app; }
async function loadMarket() { const req = scope('market'), version = favoriteVersion; loading.value = true; loadError.value = ''; try { const rows = await api.get('/apps' + (categoryId.value ? '?categoryId=' + encodeURIComponent(categoryId.value) : ''), { signal: req.signal }); if (req.current()) apps.value = (Array.isArray(rows) ? rows : []).map(app => mergeFavorite(app, version)); } catch (error) { if (req.current()) loadError.value = error.message || '应用列表暂未加载，请稍后再试。'; } finally { if (req.current()) loading.value = false; } }
async function loadCategories() { const req = scope('categories'); categoryError.value = ''; try { const rows = await api.get('/apps/categories', { signal: req.signal }); if (req.current()) categories.value = Array.isArray(rows) ? rows : []; } catch { if (req.current()) categoryError.value = '分类暂未加载，仍可浏览全部应用。'; } }
function filterBy(id) { if (categoryId.value === id) return; categoryId.value = id; void loadMarket(); }
function resetFilters() { keyword.value = ''; favoritesOnly.value = false; filterBy(''); }
async function toggleFavorite(app) { if (!current() || favoriteBusy.has(app.id)) return; const req = scope('favorite:' + app.id), wanted = !app.favorited; favoriteBusy.add(app.id); try { const result = await api.post('/apps/' + encodeURIComponent(app.id) + '/favorite', { favorited: wanted }, { signal: req.signal }); if (!req.current()) return; const value = !!result.favorited; favoriteUpdates.set(app.id, { version: ++favoriteVersion, value }); for (const row of apps.value) if (row.id === app.id) row.favorited = value; if (detail.value?.id === app.id) detail.value.favorited = value; } catch (error) { if (req.current()) ElMessage.error(error.message || '收藏暂未保存，请重试。'); } finally { if (req.current()) favoriteBusy.delete(app.id); } }
async function openDetail(app, event, start = false) {
  if (!app || !current()) return;
  const req = scope('detail'), version = favoriteVersion;
  if (event?.currentTarget) opener = event.currentTarget;
  detailApp.value = app; detail.value = null; detailError.value = ''; detailLoading.value = true; launching.value = start;
  await nextTick(); if (!req.current()) return; if (!dialog.value.open) dialog.value.showModal();
  try { const result = await api.get('/apps/' + encodeURIComponent(app.id), { signal: req.signal }); if (!req.current()) return; detail.value = mergeFavorite(result, version); if (start) { const id = result.id; closeDetail(false); await router.push({ path: '/chat', query: { app: id } }); } }
  catch (error) { if (req.current()) detailError.value = error.status === 404 ? '这位搭档暂时不在场，可能已经下架。可以关掉窗口，认识其他搭档。' : error.message || '搭档档案暂未加载，请重试。'; }
  finally { if (req.current()) { detailLoading.value = false; launching.value = false; } }
}
function launch(app, event) { return openDetail(app, event, true); }
function closeDetail(restoreFocus = true) { controllers.get('detail')?.abort(); if (dialog.value?.open) dialog.value.close(); detail.value = null; detailApp.value = null; detailError.value = ''; detailLoading.value = false; launching.value = false; const target = opener; opener = null; if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true }); }
function onNativeClose() { if (!dialog.value?.open && detailApp.value) closeDetail(); }
function onBackdrop(event) { if (event.target !== dialog.value) return; const rect = dialog.value.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDetail(); }
watch([keyword, favoritesOnly, categoryId], () => { limit.value = 9; });
function clear() { for (const controller of controllers.values()) controller.abort(); controllers.clear(); favoriteBusy.clear(); favoriteUpdates.clear(); apps.value = []; categories.value = []; closeDetail(false); }
watch(() => auth.user?.id, id => { if (id === owner) return; clear(); owner = id; if (id) { void loadMarket(); void loadCategories(); } });
onMounted(() => { void loadMarket(); void loadCategories(); });
onBeforeUnmount(() => { active = false; clear(); });
defineExpose({ reload: loadMarket });
</script>
