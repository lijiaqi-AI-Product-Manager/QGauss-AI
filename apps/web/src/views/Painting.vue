<template>
  <div class="qp-wrap qp-workspace">
    <header class="qp-masthead">
      <div><span class="qp-eyebrow">QGAUSS / IMAGE STUDIO</span><h1>想象，<em>正在成形。</em></h1><p>从一句描述，到一幅属于你的作品。</p></div>
      <div class="qp-mast-art" aria-hidden="true"><span></span><i></i><b>Q</b><small>MAKE ROOM<br>FOR IMAGINATION</small></div>
      <div class="qp-studio-note"><span class="qp-live-dot"></span> {{ pendingCount ? '本页 ' + pendingCount + ' 个灵感正在生成' : '给灵感一点空间' }} <router-link to="/mj">打开 MJ 进阶创作 ↗</router-link></div>
    </header>
    <GalleryEntryNotice :entry="galleryEntry" />

    <aside class="qp-params qp-composer" aria-label="绘画创作台">
      <div class="qp-section-heading"><span class="qp-step">01</span><div><h2>你的创作台</h2><p>描述画面，其他交给想象。</p></div><ClientIcon name="palette" /></div>
      <div v-if="optionsError" class="qp-inline-error" role="alert"><span>{{ optionsError }}</span><button type="button" @click="loadOptions">重新加载参数</button></div>
      <div class="qp-block"><label class="qp-label" for="qp-model">绘画模型</label>
        <el-select id="qp-model" v-model="form.model" aria-label="绘画模型" placeholder="站点默认模型">
          <el-option label="站点默认模型" value="" />
          <el-option v-if="form.model && !imageModels.some(m => m.name === form.model)" :label="form.model + '（已停用）'" :value="form.model" disabled />
          <el-option v-for="m in imageModels" :key="m.name" :label="(m.displayName || m.name) + (m.ready === false ? '（未接入）' : '')" :value="m.name" :disabled="m.ready === false" />
        </el-select>
      </div>
      <div class="qp-mode" aria-label="生成模式"><button type="button" :aria-pressed="form.mode === 'text2img'" @click="form.mode = 'text2img'"><ClientIcon name="write" />文字成画</button><button type="button" :aria-pressed="form.mode === 'img2img'" @click="form.mode = 'img2img'"><ClientIcon name="image" />参考图创作</button></div>
      <div class="qp-prompt-label"><label for="qp-prompt">说说你的画面</label><span>{{ form.prompt.length }} / 4000</span></div>
      <el-input id="qp-prompt" v-model="form.prompt" class="qp-prompt" aria-label="绘画提示词" type="textarea" :rows="5" maxlength="4000" placeholder="想画什么？试着描述主体、颜色、光线与氛围…" />
      <section v-if="form.mode === 'img2img'" class="qp-reference-board" aria-label="参考图板">
        <div class="qp-reference-heading"><span>把灵感放在一起</span><b>{{ referenceItems.length }} / {{ maxReferences }}</b></div><p class="qp-reference-hint">第一张是主图。可把主体、材质、氛围分开放进来，在描述里说明各图的用途。</p>
        <div class="qp-reference-grid"><div v-for="(item, i) in referenceItems" :key="item.id" class="qp-reference-tile"><img v-if="referenceUrl(item)" :src="referenceUrl(item)" :alt="item.name || '参考图 ' + (i + 1)" /><span>{{ i === 0 ? '主图' : '参考 ' + (i + 1) }}</span><button type="button" :aria-label="'移除参考图 ' + (i + 1)" :disabled="uploading || creating" @click="removeReference(i)"><ClientIcon name="close" /></button><button v-if="i" type="button" class="qp-reference-move" :aria-label="'将参考图 ' + (i + 1) + ' 设为主图'" :disabled="uploading || creating" @click="makePrimary(i)">置首</button></div><button v-if="referenceItems.length < maxReferences" type="button" class="qp-reference-tile qp-reference-add" :disabled="uploading || creating" @click="fileInput?.click()"><ClientIcon name="plus" /><b>{{ uploading ? '上传中…' : '加入参考图' }}</b></button></div>
        <button v-if="referenceItems.length" type="button" class="qp-mask-action" :disabled="!features.mask || uploading || creating || !referenceSource" @click="maskEditor?.open(mask?.strokes || [])"><ClientIcon name="palette" /><span>{{ mask ? '调整重绘区域' : '涂抹局部重绘' }}</span><span>{{ features.mask ? '打开画布 ↗' : '此模型未开放' }}</span></button>
        <div v-if="mask" class="qp-mask-saved"><span>✦ {{ mask.id ? '已选择重绘区域' : '选区未保存，请重新确认' }}</span><button type="button" :disabled="uploading || creating" @click="mask = null">移除选区</button></div><p v-if="referenceItems.length > maxReferences || (mask && !features.mask)" role="alert" class="qp-reference-note">当前模型不支持这组参考设置，请减少图片或移除选区后再生成。</p><p class="qp-reference-note">每张最多 10 MB / 800 万像素。图片与选区私有保存，移除只改变本次草稿。</p>
      </section>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change="onRefPicked" />
      <ImageMaskEditor ref="maskEditor" :source="referenceSource" @apply="saveMask" />
      <details class="qp-settings">
        <summary><span><ClientIcon name="layout" />画面与进阶设置</span><b>{{ form.ratio }} · {{ form.resolution }} · {{ form.n }} 张</b><ClientIcon name="chevronRight" /></summary>
        <div class="qp-settings-content">
          <div class="qp-block"><span class="qp-label">画面比例</span><div class="qp-ratio-grid"><button v-for="r in ratios" :key="r.key" type="button" class="qp-ratio" :aria-label="'选择比例 ' + r.key" :aria-pressed="form.ratio === r.key" :disabled="!features.ratios.includes(r.key)" @click="form.ratio = r.key"><span class="qp-ratio-shape" :style="{ aspectRatio: (r.w || 1) + '/' + (r.h || 1) }"></span><b>{{ r.key }}</b><small>{{ r.label || r.scene }}</small></button></div></div>
          <div class="qp-setting-pair"><label>分辨率<el-select v-model="form.resolution" aria-label="分辨率"><el-option v-for="r in resolutions" :key="r.key" :value="r.key" :label="r.label" :disabled="!features.resolutions.includes(r.key)" /></el-select></label><label>生成张数<el-input-number v-model="form.n" aria-label="生成张数" :min="1" :max="4" /></label></div>
          <div class="qp-setting-pair"><label>画质<el-select v-model="form.quality" aria-label="画质" :disabled="features.qualities.length === 1"><el-option label="自动" value="auto" /><el-option label="低" value="low" :disabled="!features.qualities.includes('low')" /><el-option label="中" value="medium" :disabled="!features.qualities.includes('medium')" /><el-option label="高" value="high" :disabled="!features.qualities.includes('high')" /></el-select></label><label>随机种子<small class="qp-field-hint">{{ features.seed ? '供应商解码种子' : '仅保存到作品记录' }}</small><el-input-number v-model="form.seed" aria-label="随机种子" :min="0" :max="4294967295" :controls="false" placeholder="随机" /></label></div>
          <label v-if="cats.length" class="qp-block qp-label">风格分类<el-select v-model="form.catId" aria-label="风格分类" clearable placeholder="不分类"><el-option v-for="c in cats" :key="c.id" :value="c.id" :label="c.name" /></el-select></label>
          <label class="qp-block qp-label">负向提示词<el-input v-model="form.negativePrompt" aria-label="负向提示词" type="textarea" :rows="2" maxlength="2000" placeholder="不希望出现在画面里的元素" /></label>
          <p class="qp-size-note">画布尺寸 <strong>{{ sizeHint }}</strong></p>
        </div>
      </details>
      <div class="qp-actions"><button type="button" class="qp-generate" :disabled="creating || uploading || !optionsReady || galleryEntry.blocked" :aria-busy="creating" @click="submit"><ClientIcon name="spark" /><span>{{ creating ? '正在提交…' : '开始生成' }}</span><ClientIcon name="arrow" /></button><p>{{ costHint }}</p></div>
      <div class="qp-composer-footer"><span class="qp-tiny-spark">✦</span> 提示词保留着，随时试试下一个版本。</div>
    </aside>

    <section class="qp-main qp-gallery" aria-label="作品画廊">
      <div class="qp-gallery-toolbar"><div class="qp-gallery-tabs" role="tablist" aria-label="作品来源"><button type="button" role="tab" :aria-selected="tab === 'mine'" @click="tab = 'mine'">我的画廊 <small v-if="mineTotal !== null">{{ mineTotal }}</small></button><button type="button" role="tab" :aria-selected="tab === 'square'" @click="tab = 'square'">灵感广场 <small v-if="squareTotal !== null">{{ squareTotal }}</small></button></div><button type="button" class="qp-refresh" :disabled="galleryLoading" @click="reloadGallery"><ClientIcon name="refresh" />刷新</button></div>
      <div v-if="galleryError" class="qp-inline-error" role="alert"><span>{{ galleryError }}</span><button type="button" @click="reloadGallery">再试一次</button></div>
      <div v-if="galleryLoading && !galleryItems.length" class="qp-gallery-loading" role="status"><BrandLoader :size="46" text="正在打开你的灵感画廊…" /><div class="qp-skeleton-grid" aria-hidden="true"><span v-for="i in 3" :key="i"></span></div></div>
      <template v-else-if="!galleryItems.length && !galleryError">
        <section class="qp-empty-artboard"><div class="qp-empty-scene" aria-hidden="true"><span class="qp-empty-orb"></span><span class="qp-empty-frame"></span><span class="qp-empty-spark">✦</span><span class="qp-empty-sticker">Q / IMAGINE</span></div><span class="qp-eyebrow">A LITTLE IDEA, A NEW WORLD</span><h2>{{ tab === 'mine' ? '下一幅好作品，' : '灵感，等你来点亮。' }}<em v-if="tab === 'mine'">就从这里开始。</em></h2><p>{{ tab === 'mine' ? '写一句描述，或挑一张灵感签。每一个小念头，都值得被看见。' : '公开发布的作品会在这里相遇。你可以查看细节，带着灵感再创作。' }}</p></section>
        <div v-if="tab === 'mine'" class="qgd-painting-prompts qp-inspirations" aria-label="绘画灵感"><button v-for="idea in ideas" :key="idea.title" type="button" @click="form.prompt = idea.prompt"><span :class="idea.shape"></span><b>{{ idea.title }}</b><small>{{ idea.tags }}</small><ClientIcon name="arrowUpRight" /></button></div>
      </template>
      <div v-else class="qp-art-grid" :aria-busy="galleryLoading">
        <article v-for="(t, index) in galleryItems" :key="t.id" class="qp-card" :class="'qp-card-' + (t.status || 'QUEUED').toLowerCase()">
          <button v-if="t.results?.length" type="button" class="qp-image-button" :aria-label="'查看作品：' + t.prompt" @click="openDetail(t, 0, $event)"><img v-if="imageSource(t.results[0])" :src="imageSource(t.results[0])" :alt="t.prompt" loading="lazy" /><span v-else class="qp-image-placeholder"><ClientIcon name="image" />{{ assets.errors.get(t.results[0].url) ? '图片暂未加载，打开详情重试' : '正在显影…' }}</span><span class="qp-image-zoom"><ClientIcon name="arrowUpRight" /></span><span v-if="t.results.length > 1" class="qp-image-count">{{ t.results.length }} 张作品</span></button>
          <div v-else class="qp-process-art" :class="{ 'is-pending': isPending(t.status) }"><BrandLoader v-if="isPending(t.status)" :size="45" /><ClientIcon v-else name="image" /><b>{{ statusLabel(t.status) }}</b><p>{{ t.status === 'FAILED' ? t.errorMessage || '请调整描述或参数后再试一次' : t.status === 'CANCELED' ? '灵感还在，随时可以再创作。' : t.status === 'SETTLING' ? t.errorMessage || '图片已生成，正在保存与结算。' : '画面正在一点点成形。' }}</p><div v-if="isPending(t.status)" class="qp-progress" role="progressbar" :aria-valuenow="t.progress || 0" aria-valuemin="0" aria-valuemax="100" :aria-label="statusLabel(t.status)"><i :style="{ width: Math.max(4, Math.min(100, t.progress || 0)) + '%' }"></i></div></div>
          <div class="qp-card-body"><div class="qp-card-topline"><span class="qp-card-status" :data-status="t.status">{{ t.status === 'SUCCESS' && t.results.length < t.n ? '已完成 ' + t.results.length + ' / ' + t.n + ' 张' : statusLabel(t.status) }}</span><span>{{ t.published ? '已公开' : tab === 'square' ? t.author : '仅自己可见' }}</span><small>{{ String(index + 1).padStart(2, '0') }}</small></div><h3>{{ t.prompt }}</h3><p class="qp-card-spec">{{ t.ratio }} <span>·</span> {{ t.resolution }} <span>·</span> {{ t.versionName || t.model || '站点默认模型' }}</p><div class="qp-card-actions"><button type="button" @click="openDetail(t, 0, $event)">查看详情 <ClientIcon name="arrowUpRight" /></button><button v-if="tab === 'mine' && canCancel(t.status)" type="button" :disabled="busyTasks.has(t.id)" @click="cancel(t)">取消生成</button><button v-else-if="t.status === 'SETTLING'" type="button" disabled>正在保存…</button><button v-else type="button" @click="reuse(t)"><ClientIcon name="shuffle" />{{ t.status === 'FAILED' ? '调整后重试' : '做同款' }}</button></div></div>
        </article>
      </div>
      <div v-if="galleryTotal > pageSize" class="qp-pagination" aria-label="作品分页"><button type="button" :disabled="galleryLoading || galleryPage <= 1" @click="changePage(-1)"><ClientIcon name="chevronLeft" />上一页</button><span>第 {{ galleryPage }} / {{ Math.max(1, Math.ceil(galleryTotal / pageSize)) }} 页</span><button type="button" :disabled="galleryLoading || galleryPage * pageSize >= galleryTotal" @click="changePage(1)">下一页<ClientIcon name="chevronRight" /></button></div>
      <p class="qp-gallery-foot"><span>QGAUSS CREATIVE ARCHIVE</span><span>每一次尝试，都在靠近你的想象。</span></p>
    </section>

    <Teleport to="body"><dialog ref="detailDialog" class="qp-artwork-dialog" aria-labelledby="qp-artwork-title" @cancel.prevent="closeDetail" @close="onNativeDetailClose" @click="onDialogBackdrop" @keydown="onDetailKey">
      <header class="qp-dialog-header"><span class="qp-eyebrow">QGAUSS / ARTWORK</span><h2 id="qp-artwork-title">作品详情</h2><button type="button" class="qp-icon-action" aria-label="关闭作品详情" @click="closeDetail"><ClientIcon name="close" /></button></header>
      <div v-if="detailLoading" class="qp-detail-loading"><BrandLoader :size="55" text="正在展开作品…" /></div>
      <div v-else-if="detailError" class="qp-detail-loading" role="alert"><p>{{ detailError }}</p><button type="button" class="qp-text-action" @click="openDetail(detailTask, selectedImage)">重新加载详情</button></div>
      <div v-else-if="detail" class="qp-detail-layout">
        <div class="qp-detail-stage"><div class="qp-detail-image-area"><img v-if="selectedResult && imageSource(selectedResult)" :src="imageSource(selectedResult)" :alt="detail.prompt + '，第 ' + (selectedImage + 1) + ' 张'" /><div v-else class="qp-image-placeholder"><ClientIcon name="image" /><p>{{ selectedResult ? assets.errors.get(selectedResult.url) || '正在加载图片…' : statusLabel(detail.status) }}</p><button v-if="selectedResult && assets.errors.has(selectedResult.url)" type="button" @click="assets.load(selectedResult, true)">重新加载图片</button></div><button v-if="detail.results.length > 1" type="button" class="qp-carousel-prev qp-icon-action" aria-label="上一张作品" @click="selectImage(-1)"><ClientIcon name="chevronLeft" /></button><button v-if="detail.results.length > 1" type="button" class="qp-carousel-next qp-icon-action" aria-label="下一张作品" @click="selectImage(1)"><ClientIcon name="chevronRight" /></button></div><div class="qp-image-filmstrip" v-if="detail.results.length"><button v-for="(r, i) in detail.results" :key="r.fileId" type="button" :aria-label="'查看第 ' + (i + 1) + ' 张作品'" :aria-pressed="selectedImage === i" @click="selectedImage = i"><img v-if="imageSource(r)" :src="imageSource(r)" alt="" /><span>{{ String(i + 1).padStart(2, '0') }}</span></button><small>{{ selectedImage + 1 }} / {{ detail.results.length }}</small></div></div>
        <section class="qp-detail-inspector"><span class="qp-card-status" :data-status="detail.status">{{ statusLabel(detail.status) }}</span><h3>画面里的想法</h3><p class="qp-detail-prompt">{{ detail.prompt }}</p><button type="button" class="qp-text-action" @click="copyPrompt"><ClientIcon name="copy" />复制提示词</button><p v-if="detail.negativePrompt" class="qp-detail-negative"><span>负向提示词</span>{{ detail.negativePrompt }}</p><dl class="qp-detail-specs"><div><dt>模型</dt><dd>{{ detail.versionName || detail.model || '站点默认模型' }}</dd></div><div><dt>请求画布</dt><dd>{{ detail.ratio }} · {{ detail.size }}</dd></div><div><dt>分辨率 / 画质</dt><dd>{{ detail.resolution }} / {{ qualityLabel(detail.quality) }}</dd></div><div><dt>随机种子</dt><dd>{{ detail.seed ?? '随机' }}</dd></div><div><dt>生成时间</dt><dd>{{ fmt(detail.createdAt) }}</dd></div></dl>
          <ArtworkBilling v-if="detail.mine && detail.billing" :billing="detail.billing" />
          <details v-if="detail.events?.length" class="qp-timeline"><summary>创作足迹 <span>{{ detail.events.length }}</span></summary><ol><li v-for="event in detail.events" :key="event.id"><i></i><div><b>{{ event.message || statusLabel(event.status) }}</b><time>{{ fmt(event.createdAt) }}</time></div></li></ol></details>
          <div class="qp-detail-primary"><button type="button" class="qp-primary-action" :disabled="!selectedResult || downloading" @click="downloadSelected"><ClientIcon name="download" />{{ downloading ? '准备下载…' : '下载第 ' + (selectedImage + 1) + ' 张' }}</button><button type="button" class="qp-secondary-action" @click="reuse(detail)"><ClientIcon name="shuffle" />带着灵感做同款</button></div>
          <button v-if="detail.mine && detail.status === 'SUCCESS' && /^image\/(png|jpeg|webp|gif)$/.test(selectedResult?.mime || '')" type="button" class="qp-mask-action" @click="editArtwork"><ClientIcon name="palette" />继续编辑这张图<span>参考 / 局部重绘 ↗</span></button>
          <div v-if="detail.mine" class="qp-owner-actions"><button v-if="detail.status === 'SUCCESS'" type="button" :disabled="detailBusy" @click="publishConfirm = true">{{ detail.published ? '从广场撤下' : '发布到灵感广场' }}</button><button v-if="!isPending(detail.status)" type="button" :disabled="detailBusy" @click="deleteConfirm = true">移入回收</button><button v-else-if="canCancel(detail.status)" type="button" :disabled="busyTasks.has(detail.id)" @click="cancel(detail)">取消生成</button></div>
          <ArtworkPublication v-if="publishConfirm && detail.mine" kind="image" :work="detail" :categories="cats" @updated="publicationUpdated" @cancel="publishConfirm = false" /><div v-if="deleteConfirm" class="qp-delete-confirm" role="alert"><p>移入回收后，这件作品会从画廊和广场隐藏。</p><button type="button" :disabled="detailBusy" @click="remove">确认移入回收</button><button type="button" @click="deleteConfirm = false">保留作品</button></div><p v-if="detail.mine === false" class="qp-public-note">公开作品供灵感交流。复用参数不会复制作者的私有参考图。</p>
        </section>
      </div>
    </dialog></Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElInput, ElInputNumber, ElMessage, ElOption, ElSelect } from 'element-plus';
import { api, uploadFile } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import { createArtworkAssets } from '../lib/artwork-assets.js';
import ClientIcon from '../components/reference/ClientIcon.vue';
import GalleryEntryNotice from '../components/design/GalleryEntryNotice.vue';
import ArtworkPublication from '../components/design/ArtworkPublication.vue';
import {useGalleryEntry} from '../composables/useGalleryEntry.js';
import BrandLoader from '../components/design/BrandLoader.vue';
import ArtworkBilling from '../components/design/ArtworkBilling.vue';
import ImageMaskEditor from '../components/design/ImageMaskEditor.vue';
import '../components/design/painting-workspace.css';

const route = useRoute(), auth = useAuth(), owner = auth.user?.id;
let alive = true, poller, detailVersion = 0, uploadVersion = 0, opener;
const controllers = new Map(), versions = new Map(), downloadTimers = new Map();
const isCurrent = () => alive && auth.isLoggedIn && auth.user?.id === owner;
const assets = createArtworkAssets(isCurrent);
const form = reactive({ prompt: '', negativePrompt: '', ratio: '1:1', resolution: '1K', quality: 'auto', n: 1, seed: undefined, catId: '', mode: 'text2img', model: String(route.query.model || ''), editOf: '' });
const ratios = ref([]), resolutions = ref([]), cats = ref([]), imageModels = ref([]), billing = ref(null), defaultFeatures = ref(null), optionsReady = ref(false), optionsError = ref('');
const tasks = ref([]), square = ref([]), mineTotal = ref(null), squareTotal = ref(null), minePage = ref(1), squarePage = ref(1), pageSize = 12;
const tab = ref(route.query.tab === 'square' ? 'square' : 'mine'), mineLoading = ref(false), squareLoading = ref(false), mineError = ref(''), squareError = ref('');
const creating = ref(false), uploading = ref(false), fileInput = ref(null), refName = ref(''), busyTasks = reactive(new Set());
const references = ref([]), mask = ref(null), maskEditor = ref(null), editOrigin = ref(null), localPreviews = new Map();
const referenceItems = computed(() => references.value.length ? references.value : form.editOf ? [{ id: form.editOf, name: refName.value || '原作参考图' }] : []);
const maxReferences = computed(() => features.value.maxReferences || 1);
const referenceUrl = item => localPreviews.get(item.id) || assets.urls.get('/api/upload/' + item.id + '/raw') || '';
const detailDialog = ref(null), detail = ref(null), detailTask = ref(null), detailLoading = ref(false), detailError = ref(''), selectedImage = ref(0), detailBusy = ref(false), downloading = ref(false), publishConfirm = ref(false), deleteConfirm = ref(false);
const ideas = [
  { title: '云端工作室', tags: '柔光 · 玻璃 · 3D', shape: 'qgd-paint-sphere', prompt: '一个漂浮在柔软云层上的未来工作室，薰衣草与天蓝渐变，透明玻璃和珍珠白软胶材质，柔和的工作室光线，3D 艺术渲染，干净构图' },
  { title: '光影里的日常', tags: '建筑 · 留白 · 材质', shape: 'qgd-paint-arch', prompt: '奶油白背景上的几何建筑与拱门，清晨阳光照出柔和阴影，一枝小绿植，米色和鼠尾草绿，极简杂志摄影，安静克制的构图' },
  { title: '一点宇宙浪漫', tags: '极光 · 星轨 · 梦境', shape: 'qgd-paint-planet', prompt: '一颗环绕着透明冰蓝轨道的星球，深靛蓝宇宙，流动的青紫极光与细小星尘，轻盈半透明玻璃，梦幻科幻，精细光照' },
];
const galleryItems = computed(() => tab.value === 'mine' ? tasks.value : square.value);
const galleryLoading = computed(() => tab.value === 'mine' ? mineLoading.value : squareLoading.value);
const galleryError = computed(() => tab.value === 'mine' ? mineError.value : squareError.value);
const galleryTotal = computed(() => (tab.value === 'mine' ? mineTotal.value : squareTotal.value) || 0);
const galleryPage = computed(() => tab.value === 'mine' ? minePage.value : squarePage.value);
const pendingCount = computed(() => tasks.value.filter(t => isPending(t.status)).length);
const selectedResult = computed(() => detail.value?.results?.[selectedImage.value]);
const referenceSource = computed(() => referenceItems.value[0] ? referenceUrl(referenceItems.value[0]) : '');
const features = computed(() => imageModels.value.find(m => m.name === form.model)?.features || defaultFeatures.value || { qualities: ['auto', 'low', 'medium', 'high'], resolutions: ['1K', '2K', '4K'], ratios: ratios.value.map(r => r.key), seed: false, pixelSize: true });
const sizeHint = computed(() => { if (features.value.pixelSize === false) return form.ratio + ' · ' + form.resolution + '（像素由模型决定）'; const r = ratios.value.find(x => x.key === form.ratio) || { w: 1, h: 1 }; const base = resolutions.value.find(x => x.key === form.resolution)?.base || ({ '1K': 1024, '2K': 2048, '4K': 3072 }[form.resolution]) || 1024; const long = Math.max(r.w || 1, r.h || 1); return Math.round(base * (r.w || 1) / long / 16) * 16 + ' × ' + Math.round(base * (r.h || 1) / long / 16) * 16; });
const costHint = computed(() => {
  if (!billing.value) return '生成成功后按站点设置结算';
  if (!billing.value.enabled) return '当前站点不扣绘画次数';
  return '预计 ' + billing.value.costPerImage * (form.n || 1) * (billing.value.qualityFactors?.[form.quality] || 1) + ' 次 · 提交时预留，按成功张数结算';
});
const isPending = s => ['QUEUED', 'RUNNING', 'SETTLING'].includes(s);
const canCancel = s => s === 'QUEUED' || s === 'RUNNING';
const statusLabel = s => ({ QUEUED: '等待灵感就位', RUNNING: '想象正在成形', SETTLING: '正在保存与结算', SUCCESS: '创作完成', FAILED: '这次没有完成', CANCELED: '已取消生成' }[s] || s || '准备中');
const qualityLabel = s => ({ auto: '自动', low: '低', medium: '中', high: '高' }[s] || s);
const fmt = d => d ? new Date(d).toLocaleString('zh-CN', { hour12: false }) : '—';
const imageSource = r => assets.urls.get(r?.url) || (r?.url?.startsWith('/art/') ? r.url : '');
function requestScope(key) { controllers.get(key)?.abort(); const controller = new AbortController(); controllers.set(key, controller); const version = (versions.get(key) || 0) + 1; versions.set(key, version); return { signal: controller.signal, current: () => isCurrent() && !controller.signal.aborted && versions.get(key) === version }; }
function retainAssets() {
  const paths = new Set([...tasks.value, ...square.value].flatMap(t => t.results?.slice(0, 1).map(r => r.url) || []));
  for (const r of detail.value?.results || []) paths.add(r.url);
  for (const item of referenceItems.value) paths.add('/api/upload/' + item.id + '/raw');
  assets.retain(paths);
}
function loadVisibleImages(rows) { for (const t of rows) if (t.results?.[0]) void assets.load(t.results[0]); retainAssets(); }
const galleryInitial={...form};let galleryBaseline=JSON.stringify(form);
const galleryEntry=useGalleryEntry({auth,target:'/painting',canApply:()=>isCurrent()&&optionsReady.value&&!creating.value&&!uploading.value,hasDraft:()=>!!form.prompt.trim()||referenceItems.value.length>0||JSON.stringify(form)!==galleryBaseline,apply(draft){
 if(typeof draft.model!=='string'||!draft.model||typeof draft.ratio!=='string'||typeof draft.resolution!=='string'||draft.prompt.length>4000)throw Error('公开绘画设定不完整，请重新核对。');
 clearReference();Object.assign(form,galleryInitial,Object.fromEntries(["prompt","negativePrompt","model","ratio","resolution","quality","seed","n","catId"].filter(key=>Object.hasOwn(draft,key)).map(key=>[key,draft[key]])),{mode:'text2img',editOf:''});tab.value='mine';
}});
async function loadOptions() { const req = requestScope('options'); optionsError.value = ''; try { const data = await api.get('/image/options', { signal: req.signal }); if (!req.current()) return; ratios.value = data.ratios || []; resolutions.value = data.resolutions || []; cats.value = data.cats || []; imageModels.value = data.models || []; billing.value = data.billing; defaultFeatures.value = data.defaultFeatures; optionsReady.value = true; } catch (error) { if (req.current()) { optionsReady.value = false; optionsError.value = '创作参数暂未加载，请重试。'; } } }
async function loadGallery(kind = tab.value) {
  const mine = kind === 'mine', loading = mine ? mineLoading : squareLoading, errorState = mine ? mineError : squareError;
  const req = requestScope(kind), page = mine ? minePage.value : squarePage.value;
  loading.value = true; errorState.value = '';
  try { const data = await api.get('/image/' + (mine ? 'tasks' : 'square') + '?page=' + page + '&pageSize=' + pageSize, { signal: req.signal }); if (!req.current()) return; const rows = (data.items || []).map(t => ({ ...t, results: Array.isArray(t.results) ? t.results : [], mine: mine ? true : t.mine })); if (mine) { tasks.value = rows; mineTotal.value = data.total ?? rows.length; } else { square.value = rows; squareTotal.value = data.total ?? rows.length; } if (mine && detail.value?.mine) { const update = rows.find(t => t.id === detail.value.id); if (update) { const events = detail.value.events, statusChanged = detail.value.status !== update.status; detail.value = { ...detail.value, ...update, events }; for (const result of detail.value.results) void assets.load(result); if (statusChanged) void refreshDetailSnapshot(update.id, detailVersion); } } loadVisibleImages(rows); }
  catch (error) { if (req.current()) errorState.value = '作品暂未更新，你的创作参数仍然保留着。'; }
  finally { if (req.current()) loading.value = false; }
}
async function refreshDetailSnapshot(id, revision) {
  const req = requestScope('detail-refresh');
  try {
    const data = await api.get('/image/tasks/' + id, { signal: req.signal });
    if (!req.current() || revision !== detailVersion || detail.value?.id !== id) return;
    detail.value = { ...data, results: Array.isArray(data.results) ? data.results : [] };
    selectedImage.value = Math.max(0, Math.min(selectedImage.value, detail.value.results.length - 1));
    for (const result of detail.value.results) void assets.load(result);
    retainAssets();
  } catch { /* The latest list state stays visible; reopening can retry the detail. */ }
}
const reloadGallery = () => loadGallery();
function changePage(delta) { const page = tab.value === 'mine' ? minePage : squarePage; page.value = Math.max(1, page.value + delta); void loadGallery(); }
function clearReference() { uploadVersion += 1; controllers.get('upload')?.abort(); uploading.value = false; form.editOf = ''; editOrigin.value = null; references.value = []; mask.value = null; refName.value = ''; for (const url of localPreviews.values()) URL.revokeObjectURL(url); localPreviews.clear(); retainAssets(); }
function removeReference(index) { const rows = [...referenceItems.value], removed = rows.splice(index, 1)[0]; if (index === 0) { mask.value = null; editOrigin.value = null; } references.value = rows; form.editOf = rows[0]?.id || ''; if (removed && localPreviews.has(removed.id)) { URL.revokeObjectURL(localPreviews.get(removed.id)); localPreviews.delete(removed.id); } retainAssets(); }
function makePrimary(index) { const rows = [...referenceItems.value], chosen = rows.splice(index, 1)[0]; if (!chosen) return; rows.unshift(chosen); references.value = rows; form.editOf = chosen.id; mask.value = null; editOrigin.value = null; }
async function onRefPicked(event) {
  const files = Array.from(event.target.files || []); event.target.value = ''; if (!files.length || uploading.value || creating.value) return;
  if (referenceItems.value.length + files.length > maxReferences.value) return ElMessage.warning('当前模型最多支持 ' + maxReferences.value + ' 张参考图');
  if (files.some(file => !/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024)) return ElMessage.warning('请选择每张不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片');
  const revision = ++uploadVersion, req = requestScope('upload'); uploading.value = true;
  try { for (const file of files) { const data = await uploadFile(file, { signal: req.signal }); if (!req.current() || revision !== uploadVersion) return; const rows = [...referenceItems.value, { id: data.id, name: file.name }]; localPreviews.set(data.id, URL.createObjectURL(file)); references.value = rows; form.editOf = rows[0].id; } retainAssets(); }
  catch (error) { if (req.current()) ElMessage.error(error.message || '参考图上传失败，已成功上传的图片会保留'); }
  finally { if (req.current() && revision === uploadVersion) uploading.value = false; }
}
async function saveMask(data) {
  if (!referenceItems.value.length || uploading.value || creating.value) return;
  const primary = referenceItems.value[0].id, revision = ++uploadVersion, req = requestScope('upload'); mask.value = { id: null, sourceId: primary, strokes: data.strokes }; uploading.value = true;
  try { const file = new File([data.blob], 'QGauss-selection.png', { type: 'image/png' }); const uploaded = await uploadFile(file, { signal: req.signal }); if (!req.current() || revision !== uploadVersion || primary !== referenceItems.value[0]?.id) return; mask.value = { id: uploaded.id, sourceId: primary, strokes: data.strokes }; ElMessage.success('重绘区域已保存，描述想改变的内容后再生成。'); }
  catch (error) { if (req.current()) ElMessage.error(error.message || '选区保存失败'); }
  finally { if (req.current() && revision === uploadVersion) uploading.value = false; }
}
async function submit() { if (galleryEntry.blocked) return;if(galleryEntry.applied&&[['ratios','ratio'],['resolutions','resolution'],['qualities','quality']].some(([cap,key])=>!Array.isArray(features.value[cap])||!features.value[cap].includes(form[key])))return ElMessage.warning('原作品的画面设置当前不再支持，请明确调整后再生成。'); if (creating.value || uploading.value || !optionsReady.value) return; if (!form.prompt.trim()) return ElMessage.warning('先给画面写一句描述吧'); const model = imageModels.value.find(m => m.name === form.model); if (form.model && (!model || model.ready === false)) return ElMessage.warning('原绘画模型已停用或未接入，请重新选择模型'); if (form.mode === 'img2img' && !form.editOf) return ElMessage.warning('请先选择自己的参考图'); if (form.mode === 'img2img' && (referenceItems.value.length > maxReferences.value || (mask.value && !features.value.mask))) return ElMessage.warning('所选模型不支持当前参考设置，请调整后再生成'); if (form.mode === 'img2img' && mask.value && !mask.value.id) return ElMessage.warning('选区尚未保存，请打开画布重新确认'); creating.value = true; try { const data = await api.post('/image/tasks', { prompt: form.prompt, negativePrompt: form.negativePrompt || undefined, ratio: form.ratio, resolution: form.resolution, quality: form.quality, n: form.n, seed: form.seed, catId: form.catId || undefined, mode: form.mode, model: form.model || undefined, expectedUnitCost: billing.value ? (billing.value.enabled ? billing.value.costPerImage * (billing.value.qualityFactors?.[form.quality] || 1) : 0) : undefined, versionName: model?.displayName || model?.name || undefined, editOf: form.mode === 'img2img' ? form.editOf : undefined, referenceIds: form.mode === 'img2img' && references.value.length ? references.value.map(item => item.id) : undefined, maskId: form.mode === 'img2img' ? mask.value?.id : undefined, parentId: form.mode === 'img2img' && editOrigin.value?.fileId === form.editOf ? editOrigin.value.taskId : undefined, action: form.mode === 'img2img' && editOrigin.value?.fileId === form.editOf ? (mask.value ? 'redraw' : 'variant') : undefined }); if (!isCurrent()) return; if (data?.id) tasks.value = [{ ...data, results: data.results || [], mine: true }, ...tasks.value.filter(t => t.id !== data.id)].slice(0, pageSize); ElMessage.success('灵感已进入队列，创作台留给下一个想法。'); minePage.value = 1; if (tab.value !== 'mine') tab.value = 'mine'; else await loadGallery('mine'); } catch (error) { if (isCurrent()) { if (error.status === 409) await loadOptions(); if (isCurrent()) ElMessage.error(error.message || '提交失败，请稍后重试'); } } finally { if (isCurrent()) creating.value = false; } }
async function cancel(t) { if (busyTasks.has(t.id)) return; busyTasks.add(t.id); try { await api.post('/image/tasks/' + t.id + '/cancel'); if (!isCurrent()) return; await loadGallery('mine'); } catch (error) { if (isCurrent()) ElMessage.error(error.message); } finally { busyTasks.delete(t.id); } }
async function openDetail(task, index = 0, event) { if (!task) return; controllers.get('detail-refresh')?.abort(); const revision = ++detailVersion, req = requestScope('detail'); if (event?.currentTarget) opener = event.currentTarget; detailTask.value = task; detail.value = null; selectedImage.value = index; detailError.value = ''; detailLoading.value = true; publishConfirm.value = deleteConfirm.value = false; await nextTick(); if (!req.current() || revision !== detailVersion) return; if (!detailDialog.value.open) detailDialog.value.showModal(); try { const data = await api.get('/image/tasks/' + task.id, { signal: req.signal }); if (!req.current() || revision !== detailVersion) return; detail.value = { ...data, results: Array.isArray(data.results) ? data.results : [] }; selectedImage.value = Math.max(0, Math.min(index, detail.value.results.length - 1)); for (const result of detail.value.results) void assets.load(result); retainAssets(); } catch (error) { if (req.current()) detailError.value = error.message || '作品详情暂时不可用'; } finally { if (req.current()) detailLoading.value = false; } }
function closeDetail() {
  detailVersion += 1;
  controllers.get('detail')?.abort();
  controllers.get('detail-refresh')?.abort();
  if (detailDialog.value?.open) detailDialog.value.close();
  detail.value = null; detailTask.value = null; detailLoading.value = false;
  detailError.value = ''; publishConfirm.value = deleteConfirm.value = false;
  retainAssets();
  const returnTarget = opener; opener = null;
  if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
}
// Native close arrives asynchronously; a handled close must not steal reuse's input focus.
function onNativeDetailClose() { if (!detailDialog.value?.open && detailTask.value) closeDetail(); }
function onDialogBackdrop(event) { if (event.target === detailDialog.value) { const rect = detailDialog.value.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDetail(); } }
function selectImage(delta) { const count = detail.value?.results?.length || 0; if (count) selectedImage.value = (selectedImage.value + delta + count) % count; }
function onDetailKey(event) { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); selectImage(event.key === 'ArrowLeft' ? -1 : 1); } }
function reuse(t) { const mine = t.mine === true; form.prompt = t.prompt || ''; form.negativePrompt = t.negativePrompt || ''; form.ratio = t.ratio || '1:1'; form.resolution = t.resolution || '1K'; form.quality = t.quality || 'auto'; form.n = t.n || 1; form.seed = t.seed ?? undefined; form.catId = cats.value.some(c => c.id === t.catId) ? t.catId : ''; form.model = t.model || ''; form.mode = t.mode === 'img2img' ? 'img2img' : 'text2img'; clearReference(); if (mine && t.editOf && form.mode === 'img2img') { const ids = t.referenceIds?.length ? t.referenceIds : [t.editOf]; if (t.referenceIds?.length) references.value = ids.map((id, i) => ({ id, name: '原作参考 ' + (i + 1) })); form.editOf = ids[0]; refName.value = '原作参考图'; for (const id of ids) void assets.load({ url: '/api/upload/' + id + '/raw' }); } closeDetail(); nextTick(() => { if (isCurrent()) document.querySelector('#qp-prompt')?.focus({ preventScroll: false }); }); ElMessage.success(form.mode === 'img2img' && !form.editOf ? '参数已带入，请选择自己的参考图。' : '提示词与参数已带入，修改后再开始生成。'); }
async function copyPrompt() { try { await navigator.clipboard.writeText(detail.value.prompt); if (isCurrent()) ElMessage.success('提示词已复制'); } catch { if (isCurrent()) ElMessage.warning('复制失败，可直接选中提示词复制'); } }
function editArtwork() { const t = detail.value, result = selectedResult.value, index = selectedImage.value; if (!t?.mine || !result?.fileId || t.status !== 'SUCCESS') return; reuse(t); clearReference(); references.value = [{ id: result.fileId, name: '作品第 ' + (index + 1) + ' 张' }]; form.editOf = result.fileId; form.mode = 'img2img'; form.n = 1; editOrigin.value = { taskId: t.id, fileId: result.fileId }; void assets.load({ url: '/api/upload/' + result.fileId + '/raw' }); retainAssets(); }
async function downloadSelected() { const result = selectedResult.value, id = detail.value?.id, index = selectedImage.value; if (!result || downloading.value) return; downloading.value = true; try { const entry = await assets.load(result, true); if (!entry?.blob || !isCurrent() || detail.value?.id !== id) return; const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }; const url = URL.createObjectURL(entry.blob), link = document.createElement('a'); link.href = url; link.download = 'QGauss-' + id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-12) + '-' + (index + 1) + '.' + (extensions[entry.blob.type.split(';')[0]] || 'png'); document.body.append(link); link.click(); link.remove(); downloadTimers.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloadTimers.delete(url); }, 30000)); } finally { if (isCurrent()) downloading.value = false; } }
async function publicationUpdated(value) { if(!isCurrent()||detail.value?.id!==value.id)return;Object.assign(detail.value,value);await Promise.all([loadGallery('mine'),squareTotal.value!==null?loadGallery('square'):Promise.resolve()]); }
async function remove() { const t = detail.value; if (!t?.mine || !deleteConfirm.value || detailBusy.value) return; detailBusy.value = true; try { await api.del('/image/tasks/' + t.id); if (!isCurrent()) return; if (detail.value?.id === t.id) closeDetail(); await Promise.all([loadGallery('mine'), squareTotal.value !== null ? loadGallery('square') : Promise.resolve()]); ElMessage.success('作品已移入回收'); } catch (error) { if (isCurrent()) ElMessage.error(error.message); } finally { if (isCurrent()) detailBusy.value = false; } }
watch(features, value => { if(galleryEntry.applied&&form.model===galleryEntry.sourceDraft?.model)return; if (!value.qualities.includes(form.quality)) form.quality = 'auto'; if (!value.resolutions.includes(form.resolution)) form.resolution = value.resolutions[0]; if (!value.ratios.includes(form.ratio)) form.ratio = value.ratios[0] || '1:1'; });
watch(tab, () => { void loadGallery(); });
watch(() => route.query.tab, value => { if (value === 'square' || value === 'mine') tab.value = value; });
watch(() => route.query.model, value => { if (typeof value === 'string' && value) form.model = value; });
function dispose() { alive = false; clearInterval(poller); for (const controller of controllers.values()) controller.abort(); assets.close(); for (const url of localPreviews.values()) URL.revokeObjectURL(url); localPreviews.clear(); for (const [url, timer] of downloadTimers) { clearTimeout(timer); URL.revokeObjectURL(url); } downloadTimers.clear(); tasks.value = []; square.value = []; closeDetail(); }
watch(() => auth.user?.id, id => { if (id !== owner) dispose(); });
onMounted(async () => { await Promise.all([loadOptions(), loadGallery()]); await nextTick();galleryBaseline=JSON.stringify(form);if(isCurrent())void galleryEntry.initialize(); if (isCurrent()) poller = setInterval(() => { if (isCurrent() && !mineLoading.value && tasks.value.some(t => isPending(t.status))) void loadGallery('mine'); }, 2500); });
onUnmounted(dispose);
</script>
