<template>
  <div class="qp-wrap qp-workspace">
    <header class="qp-masthead">
      <div><span class="qp-eyebrow">QGAUSS / IMAGE STUDIO</span><h1>{{ pt("想象，") }}<em>{{ pt("正在成形。") }}</em></h1><p>{{ pt("从一句描述，到一幅属于你的作品。") }}</p></div>
      <div class="qp-mast-art" aria-hidden="true"><span></span><i></i><b>Q</b><small>MAKE ROOM<br>FOR IMAGINATION</small></div>
      <div class="qp-studio-note"><span class="qp-live-dot"></span> {{ pendingCount ? pt("本页 {p0} 个灵感正在生成",{p0:(pendingCount)}) : pt("给灵感一点空间") }} <router-link to="/mj">{{ pt("打开 MJ 进阶创作 ↗") }}</router-link></div>
    </header>
    <GalleryEntryNotice :entry="galleryEntry" />
    <ImageEditorEntryNotice :entry="editorEntry" />

    <aside class="qp-params qp-composer" :aria-label="pt(&quot;绘画创作台&quot;)">
      <div class="qp-section-heading"><span class="qp-step">01</span><div><h2>{{ pt("你的创作台") }}</h2><p>{{ pt("描述画面，其他交给想象。") }}</p></div><ClientIcon name="palette" /></div>
      <div v-if="optionsError" class="qp-inline-error" role="alert"><span>{{ pt(optionsError) }}</span><button type="button" @click="loadOptions">{{ pt("重新加载参数") }}</button></div>
      <div class="qp-block"><label class="qp-label" for="qp-model">{{ pt("绘画模型") }}</label>
        <el-select id="qp-model" v-model="form.model" :aria-label="pt(&quot;绘画模型&quot;)" :placeholder="pt(&quot;站点默认模型&quot;)">
          <el-option :label="pt(&quot;站点默认模型&quot;)" value="" />
          <el-option v-if="form.model && !imageModels.some(m => m.name === form.model)" :label="pt(&quot;{p0}（已停用）&quot;,{p0:(form.model)})" :value="form.model" disabled />
          <el-option v-for="m in imageModels" :key="m.name" :label="(m.displayName || m.name) + (m.ready === false ? pt(&quot;（未接入）&quot;) : '')" :value="m.name" :disabled="m.ready === false" />
        </el-select>
      </div>
      <div class="qp-mode" :aria-label="pt(&quot;生成模式&quot;)"><button type="button" :aria-pressed="form.mode === 'text2img'" @click="form.mode = 'text2img'"><ClientIcon name="write" />{{ pt("文字成画") }}</button><button type="button" :aria-pressed="form.mode === 'img2img'" @click="form.mode = 'img2img'"><ClientIcon name="image" />{{ pt("参考图创作") }}</button></div>
      <div class="qp-prompt-label"><label for="qp-prompt">{{ pt("说说你的画面") }}</label><span>{{ form.prompt.length }} / 4000</span></div>
      <el-input id="qp-prompt" v-model="form.prompt" class="qp-prompt" :aria-label="pt(&quot;绘画提示词&quot;)" type="textarea" :rows="5" maxlength="4000" :placeholder="pt(&quot;想画什么？试着描述主体、颜色、光线与氛围…&quot;)" />
      <section v-if="form.mode === 'img2img'" class="qp-reference-board" :aria-label="pt(&quot;参考图板&quot;)">
        <div class="qp-reference-heading"><span>{{ pt("把灵感放在一起") }}</span><b>{{ referenceItems.length }} / {{ maxReferences }}</b></div><p class="qp-reference-hint">{{ pt("第一张是主图。可把主体、材质、氛围分开放进来，在描述里说明各图的用途。") }}</p>
        <div class="qp-reference-grid"><div v-for="(item, i) in referenceItems" :key="item.id" class="qp-reference-tile"><img v-if="referenceUrl(item)" :src="referenceUrl(item)" :alt="item.name || pt(&quot;参考图 {p0}&quot;,{p0:(i + 1)})" /><span>{{ i === 0 ? pt("主图") : pt("参考 {p0}",{p0:(i + 1)}) }}</span><button type="button" :aria-label="pt(&quot;移除参考图 {p0}&quot;,{p0:(i + 1)})" :disabled="uploading || creating" @click="removeReference(i)"><ClientIcon name="close" /></button><button v-if="i" type="button" class="qp-reference-move" :aria-label="pt(&quot;将参考图 {p0} 设为主图&quot;,{p0:(i + 1)})" :disabled="uploading || creating" @click="makePrimary(i)">{{ pt("置首") }}</button></div><button v-if="referenceItems.length < maxReferences" type="button" class="qp-reference-tile qp-reference-add" :disabled="uploading || creating" @click="fileInput?.click()"><ClientIcon name="plus" /><b>{{ uploading ? pt("上传中…") : pt("加入参考图") }}</b></button></div>
        <button v-if="referenceItems.length" type="button" class="qp-mask-action" :disabled="!features.mask || uploading || creating || !referenceSource" @click="adjustMask"><ClientIcon name="palette" /><span>{{ mask ? pt("调整重绘区域") : pt("涂抹局部重绘") }}</span><span>{{ features.mask ? pt("打开画布 ↗") : pt("此模型未开放") }}</span></button>
        <div v-if="mask" class="qp-mask-saved"><span>✦ {{ mask.id ? pt("已选择重绘区域") : pt("选区未保存，请重新确认") }}</span><button type="button" :disabled="uploading || creating" @click="mask = null">{{ pt("移除选区") }}</button></div><p v-if="referenceItems.length > maxReferences || (mask && !features.mask)" role="alert" class="qp-reference-note">{{ pt("当前模型不支持这组参考设置，请减少图片或移除选区后再生成。") }}</p><p class="qp-reference-note">{{ pt("每张最多 10 MB / 800 万像素。图片与选区私有保存，移除只改变本次草稿。") }}</p>
      </section>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change="onRefPicked" />
      <button v-if="referenceItems.length" type="button" class="qp-mask-action" :disabled="uploading||creating||!referenceSource" @click="openImageEditor()"><ClientIcon name="palette"/>{{ pt("在图像编辑台调整") }}<span>{{ pt("颜色选区 / 自由涂抹 ↗") }}</span></button>
      <ImageMaskEditor ref="maskEditor" :source="referenceSource" @apply="saveMask" />
      <details class="qp-settings">
        <summary><span><ClientIcon name="layout" />{{ pt("画面与进阶设置") }}</span><b>{{ pt("{p0} · {p1} · {p2} 张",{p0:(form.ratio),p1:(form.resolution),p2:(form.n)}) }}</b><ClientIcon name="chevronRight" /></summary>
        <div class="qp-settings-content">
          <div class="qp-block"><span class="qp-label">{{ pt("画面比例") }}</span><div class="qp-ratio-grid"><button v-for="r in ratios" :key="r.key" type="button" class="qp-ratio" :aria-label="pt(&quot;选择比例 {p0}&quot;,{p0:(r.key)})" :aria-pressed="form.ratio === r.key" :disabled="!features.ratios.includes(r.key)" @click="form.ratio = r.key"><span class="qp-ratio-shape" :style="{ aspectRatio: (r.w || 1) + '/' + (r.h || 1) }"></span><b>{{ r.key }}</b><small>{{ paintingRatioLabel(r,pt) }}</small></button></div></div>
          <div class="qp-setting-pair"><label>{{ pt("分辨率") }}<el-select v-model="form.resolution" :aria-label="pt(&quot;分辨率&quot;)"><el-option v-for="r in resolutions" :key="r.key" :value="r.key" :label="r.label" :disabled="!features.resolutions.includes(r.key)" /></el-select></label><label>{{ pt("生成张数") }}<el-input-number v-model="form.n" :aria-label="pt(&quot;生成张数&quot;)" :min="1" :max="4" /></label></div>
          <div class="qp-setting-pair"><label>{{ pt("画质") }}<el-select v-model="form.quality" :aria-label="pt(&quot;画质&quot;)" :disabled="features.qualities.length === 1"><el-option :label="pt(&quot;自动&quot;)" value="auto" /><el-option :label="pt(&quot;低&quot;)" value="low" :disabled="!features.qualities.includes('low')" /><el-option :label="pt(&quot;中&quot;)" value="medium" :disabled="!features.qualities.includes('medium')" /><el-option :label="pt(&quot;高&quot;)" value="high" :disabled="!features.qualities.includes('high')" /></el-select></label><label>{{ pt("随机种子") }}<small class="qp-field-hint">{{ features.seed ? pt("供应商解码种子") : pt("仅保存到作品记录") }}</small><el-input-number v-model="form.seed" :aria-label="pt(&quot;随机种子&quot;)" :min="0" :max="4294967295" :controls="false" :placeholder="pt(&quot;随机&quot;)" /></label></div>
          <label v-if="cats.length" class="qp-block qp-label">{{ pt("风格分类") }}<el-select v-model="form.catId" :aria-label="pt(&quot;风格分类&quot;)" clearable :placeholder="pt(&quot;不分类&quot;)"><el-option v-for="c in cats" :key="c.id" :value="c.id" :label="c.name" /></el-select></label>
          <label class="qp-block qp-label">{{ pt("负向提示词") }}<el-input v-model="form.negativePrompt" :aria-label="pt(&quot;负向提示词&quot;)" type="textarea" :rows="2" maxlength="2000" :placeholder="pt(&quot;不希望出现在画面里的元素&quot;)" /></label>
          <p class="qp-size-note">{{ pt("画布尺寸 ") }}<strong>{{ sizeHint }}</strong></p>
        </div>
      </details>
      <div class="qp-actions"><button type="button" class="qp-generate" :disabled="creating || uploading || !optionsReady || !quote.known || galleryEntry.blocked || editorEntry.blocked" :aria-busy="creating" @click="submit"><ClientIcon name="spark" /><span>{{ creating ? pt("正在提交…") : pt("开始生成") }}</span><ClientIcon name="arrow" /></button><p>{{ costHint }} <button v-if="optionsReady&&!quote.known" type="button" class="qp-price-recheck" :disabled="creating||uploading" @click="loadOptions">{{ pt("重新核对费用") }}</button></p></div>
      <div class="qp-composer-footer"><span class="qp-tiny-spark">✦</span>{{ pt(" 提示词保留着，随时试试下一个版本。") }}</div>
    </aside>

    <section class="qp-main qp-gallery" :aria-label="pt(&quot;作品画廊&quot;)">
      <div class="qp-gallery-toolbar"><div class="qp-gallery-tabs" role="tablist" :aria-label="pt(&quot;作品来源&quot;)"><button type="button" role="tab" :aria-selected="tab === 'mine'" @click="tab = 'mine'">{{ pt("我的画廊 ") }}<small v-if="mineTotal !== null">{{ mineTotal }}</small></button><button type="button" role="tab" :aria-selected="tab === 'square'" @click="tab = 'square'">{{ pt("灵感广场 ") }}<small v-if="squareTotal !== null">{{ squareTotal }}</small></button></div><button type="button" class="qp-refresh" :disabled="galleryLoading" @click="reloadGallery"><ClientIcon name="refresh" />{{ pt("刷新") }}</button></div>
      <div v-if="galleryError" class="qp-inline-error" role="alert"><span>{{ pt(galleryError) }}</span><button type="button" @click="reloadGallery">{{ pt("再试一次") }}</button></div>
      <div v-if="galleryLoading && !galleryItems.length" class="qp-gallery-loading" role="status"><BrandLoader :size="46" :text="pt(&quot;正在打开你的灵感画廊…&quot;)" /><div class="qp-skeleton-grid" aria-hidden="true"><span v-for="i in 3" :key="i"></span></div></div>
      <template v-else-if="!galleryItems.length && !galleryError">
        <section class="qp-empty-artboard"><div class="qp-empty-scene" aria-hidden="true"><span class="qp-empty-orb"></span><span class="qp-empty-frame"></span><span class="qp-empty-spark">✦</span><span class="qp-empty-sticker">Q / IMAGINE</span></div><span class="qp-eyebrow">A LITTLE IDEA, A NEW WORLD</span><h2>{{ tab === 'mine' ? pt("下一幅好作品，") : pt("灵感，等你来点亮。") }}<em v-if="tab === 'mine'">{{ pt("就从这里开始。") }}</em></h2><p>{{ tab === 'mine' ? pt("写一句描述，或挑一张灵感签。每一个小念头，都值得被看见。") : pt("公开发布的作品会在这里相遇。你可以查看细节，带着灵感再创作。") }}</p></section>
        <div v-if="tab === 'mine'" class="qgd-painting-prompts qp-inspirations" :aria-label="pt(&quot;绘画灵感&quot;)"><button v-for="idea in ideas" :key="idea.title" type="button" @click="form.prompt = pt(idea.prompt)"><span :class="idea.shape"></span><b>{{ pt(idea.title) }}</b><small>{{ pt(idea.tags) }}</small><ClientIcon name="arrowUpRight" /></button></div>
      </template>
      <div v-else class="qp-art-grid" :aria-busy="galleryLoading">
        <article v-for="(t, index) in galleryItems" :key="t.id" class="qp-card" :class="'qp-card-' + (t.status || 'QUEUED').toLowerCase()">
          <button v-if="t.results?.length" type="button" class="qp-image-button" :aria-label="pt(&quot;查看作品：{p0}&quot;,{p0:(t.prompt)})" @click="openDetail(t, 0, $event)"><img v-if="imageSource(t.results[0])" :src="imageSource(t.results[0])" :alt="t.prompt" loading="lazy" /><span v-else class="qp-image-placeholder"><ClientIcon name="image" />{{ assets.errors.get(t.results[0].url) ? pt("图片暂未加载，打开详情重试") : pt("正在显影…") }}</span><span class="qp-image-zoom"><ClientIcon name="arrowUpRight" /></span><span v-if="t.results.length > 1" class="qp-image-count">{{ pt("{p0} 张作品",{p0:(t.results.length)}) }}</span></button>
          <div v-else class="qp-process-art" :class="{ 'is-pending': isPending(t.status) }"><BrandLoader v-if="isPending(t.status)" :size="45" /><ClientIcon v-else name="image" /><b>{{ statusLabel(t.status) }}</b><p>{{ t.status === 'FAILED' ? pt(t.errorMessage) || pt("请调整描述或参数后再试一次") : t.status === 'CANCELED' ? pt("灵感还在，随时可以再创作。") : t.status === 'SETTLING' ? pt(t.errorMessage) || pt("图片已生成，正在保存与结算。") : pt("画面正在一点点成形。") }}</p><div v-if="isPending(t.status)" class="qp-progress" role="progressbar" :aria-valuenow="t.progress || 0" aria-valuemin="0" aria-valuemax="100" :aria-label="statusLabel(t.status)"><i :style="{ width: Math.max(4, Math.min(100, t.progress || 0)) + '%' }"></i></div></div>
          <div class="qp-card-body"><div class="qp-card-topline"><span class="qp-card-status" :data-status="t.status">{{ t.status === 'SUCCESS' && t.results.length < t.n ? pt("已完成 {p0} / {p1} 张",{p0:(t.results.length),p1:(t.n)}) : statusLabel(t.status) }}</span><span>{{ t.published ? pt("已公开") : tab === 'square' ? t.author : pt("仅自己可见") }}</span><small>{{ String(index + 1).padStart(2, '0') }}</small></div><h3>{{ t.prompt }}</h3><p class="qp-card-spec">{{ t.ratio }} <span>·</span> {{ t.resolution }} <span>·</span> {{ t.versionName || t.model || pt("站点默认模型") }}</p><div class="qp-card-actions"><button type="button" @click="openDetail(t, 0, $event)">{{ pt("查看详情 ") }}<ClientIcon name="arrowUpRight" /></button><button v-if="tab === 'mine' && canCancel(t.status)" type="button" :disabled="busyTasks.has(t.id)" @click="cancel(t)">{{ pt("取消生成") }}</button><button v-else-if="t.status === 'SETTLING'" type="button" disabled>{{ pt("正在保存…") }}</button><button v-else type="button" @click="reuse(t)"><ClientIcon name="shuffle" />{{ t.status === 'FAILED' ? pt("调整后重试") : pt("做同款") }}</button></div></div>
        </article>
      </div>
      <div v-if="galleryTotal > pageSize" class="qp-pagination" :aria-label="pt(&quot;作品分页&quot;)"><button type="button" :disabled="galleryLoading || galleryPage <= 1" @click="changePage(-1)"><ClientIcon name="chevronLeft" />{{ pt("上一页") }}</button><span>{{ pt("第 {p0} / {p1} 页",{p0:(galleryPage),p1:(Math.max(1, Math.ceil(galleryTotal / pageSize)))}) }}</span><button type="button" :disabled="galleryLoading || galleryPage * pageSize >= galleryTotal" @click="changePage(1)">{{ pt("下一页") }}<ClientIcon name="chevronRight" /></button></div>
      <p class="qp-gallery-foot"><span>QGAUSS CREATIVE ARCHIVE</span><span>{{ pt("每一次尝试，都在靠近你的想象。") }}</span></p>
    </section>

    <Teleport to="body"><dialog ref="detailDialog" class="qp-artwork-dialog" aria-labelledby="qp-artwork-title" @cancel.prevent="closeDetail" @close="onNativeDetailClose" @click="onDialogBackdrop" @keydown="onDetailKey">
      <header class="qp-dialog-header"><span class="qp-eyebrow">QGAUSS / ARTWORK</span><h2 id="qp-artwork-title">{{ pt("作品详情") }}</h2><button type="button" class="qp-icon-action" :aria-label="pt(&quot;关闭作品详情&quot;)" @click="closeDetail"><ClientIcon name="close" /></button></header>
      <div v-if="detailLoading" class="qp-detail-loading"><BrandLoader :size="55" :text="pt(&quot;正在展开作品…&quot;)" /></div>
      <div v-else-if="detailError" class="qp-detail-loading" role="alert"><p>{{ pt(detailError) }}</p><button type="button" class="qp-text-action" @click="openDetail(detailTask, selectedImage)">{{ pt("重新加载详情") }}</button></div>
      <div v-else-if="detail" class="qp-detail-layout">
        <div class="qp-detail-stage"><div class="qp-detail-image-area"><img v-if="selectedResult && imageSource(selectedResult)" :src="imageSource(selectedResult)" :alt="pt(&quot;{p0}，第 {p1} 张&quot;,{p0:(detail.prompt),p1:(selectedImage + 1)})" /><div v-else class="qp-image-placeholder"><ClientIcon name="image" /><p>{{ selectedResult ? pt(assets.errors.get(selectedResult.url)) || pt("正在加载图片…") : statusLabel(detail.status) }}</p><button v-if="selectedResult && assets.errors.has(selectedResult.url)" type="button" @click="assets.load(selectedResult, true)">{{ pt("重新加载图片") }}</button></div><button v-if="detail.results.length > 1" type="button" class="qp-carousel-prev qp-icon-action" :aria-label="pt(&quot;上一张作品&quot;)" @click="selectImage(-1)"><ClientIcon name="chevronLeft" /></button><button v-if="detail.results.length > 1" type="button" class="qp-carousel-next qp-icon-action" :aria-label="pt(&quot;下一张作品&quot;)" @click="selectImage(1)"><ClientIcon name="chevronRight" /></button></div><div class="qp-image-filmstrip" v-if="detail.results.length"><button v-for="(r, i) in detail.results" :key="r.fileId" type="button" :aria-label="pt(&quot;查看第 {p0} 张作品&quot;,{p0:(i + 1)})" :aria-pressed="selectedImage === i" @click="selectedImage = i"><img v-if="imageSource(r)" :src="imageSource(r)" alt="" /><span>{{ String(i + 1).padStart(2, '0') }}</span></button><small>{{ selectedImage + 1 }} / {{ detail.results.length }}</small></div></div>
        <section class="qp-detail-inspector"><span class="qp-card-status" :data-status="detail.status">{{ statusLabel(detail.status) }}</span><h3>{{ pt("画面里的想法") }}</h3><p class="qp-detail-prompt">{{ detail.prompt }}</p><button type="button" class="qp-text-action" @click="copyPrompt"><ClientIcon name="copy" />{{ pt("复制提示词") }}</button><p v-if="detail.negativePrompt" class="qp-detail-negative"><span>{{ pt("负向提示词") }}</span>{{ detail.negativePrompt }}</p><dl class="qp-detail-specs"><div><dt>{{ pt("模型") }}</dt><dd>{{ detail.versionName || detail.model || pt("站点默认模型") }}</dd></div><div><dt>{{ pt("请求画布") }}</dt><dd>{{ detail.ratio }} · {{ detail.size }}</dd></div><div><dt>{{ pt("分辨率 / 画质") }}</dt><dd>{{ detail.resolution }} / {{ qualityLabel(detail.quality) }}</dd></div><div><dt>{{ pt("随机种子") }}</dt><dd>{{ detail.seed ?? pt("随机") }}</dd></div><div><dt>{{ pt("生成时间") }}</dt><dd>{{ fmt(detail.createdAt) }}</dd></div></dl>
          <ArtworkBilling v-if="detail.mine && detail.billing" :billing="detail.billing" />
          <details v-if="detail.events?.length" class="qp-timeline"><summary>{{ pt("创作足迹 ") }}<span>{{ detail.events.length }}</span></summary><ol><li v-for="event in detail.events" :key="event.id"><i></i><div><b>{{ paintingEventLabel(event,pt) || statusLabel(event.status) }}</b><time>{{ fmt(event.createdAt) }}</time></div></li></ol></details>
          <div class="qp-detail-primary"><button type="button" class="qp-primary-action" :disabled="!selectedResult || downloading" @click="downloadSelected"><ClientIcon name="download" />{{ downloading ? pt("准备下载…") : pt("下载第 {p0} 张",{p0:(selectedImage + 1)}) }}</button><button type="button" class="qp-secondary-action" @click="reuse(detail)"><ClientIcon name="shuffle" />{{ pt("带着灵感做同款") }}</button></div>
          <button v-if="detail.mine && detail.status === 'SUCCESS' && /^image\/(png|jpeg|webp|gif)$/.test(selectedResult?.mime || '')" type="button" class="qp-mask-action" @click="editArtwork"><ClientIcon name="palette" />{{ pt("继续编辑这张图") }}<span>{{ pt("参考 / 局部重绘 ↗") }}</span></button>
          <div v-if="detail.mine" class="qp-owner-actions"><button v-if="detail.status === 'SUCCESS'" type="button" :disabled="detailBusy" @click="publishConfirm = true">{{ detail.published ? pt("从广场撤下") : pt("发布到灵感广场") }}</button><button v-if="!isPending(detail.status)" type="button" :disabled="detailBusy" @click="deleteConfirm = true">{{ pt("移入回收") }}</button><button v-else-if="canCancel(detail.status)" type="button" :disabled="busyTasks.has(detail.id)" @click="cancel(detail)">{{ pt("取消生成") }}</button></div>
          <ArtworkPublication v-if="publishConfirm && detail.mine" kind="image" :work="detail" :categories="cats" @updated="publicationUpdated" @cancel="publishConfirm = false" /><div v-if="deleteConfirm" class="qp-delete-confirm" role="alert"><p>{{ pt("移入回收后，这件作品会从画廊和广场隐藏。") }}</p><button type="button" :disabled="detailBusy" @click="remove">{{ pt("确认移入回收") }}</button><button type="button" @click="deleteConfirm = false">{{ pt("保留作品") }}</button></div><p v-if="detail.mine === false" class="qp-public-note">{{ pt("公开作品供灵感交流。复用参数不会复制作者的私有参考图。") }}</p>
        </section>
      </div>
    </dialog></Teleport>
  </div>
</template>

<script setup>
import {paintingText as pt,paintingLocale} from "../i18n/painting.js";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute,useRouter } from 'vue-router';
import { ElInput, ElInputNumber, ElMessage, ElOption, ElSelect } from 'element-plus';
import { api, uploadFile } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import {useBalance} from '../stores/balance.js';
import { createArtworkAssets } from '../lib/artwork-assets.js';
import ClientIcon from '../components/reference/ClientIcon.vue';
import GalleryEntryNotice from '../components/design/GalleryEntryNotice.vue';
import ImageEditorEntryNotice from '../components/design/ImageEditorEntryNotice.vue';
import {useImageEditorEntry} from '../composables/useImageEditorEntry.js';
import {saveImageEditorTransfer} from '../lib/image-editor-transfer.js';
import ArtworkPublication from '../components/design/ArtworkPublication.vue';
import {useGalleryEntry} from '../composables/useGalleryEntry.js';
import BrandLoader from '../components/design/BrandLoader.vue';
import ArtworkBilling from '../components/design/ArtworkBilling.vue';
import ImageMaskEditor from '../components/design/ImageMaskEditor.vue';
import '../components/design/painting-workspace.css';
import{paintingQuote,paintingPriceChanged,paintingRatioLabel,paintingEventLabel}from'../lib/painting-presentation.js';

const route = useRoute(), router=useRouter(),auth = useAuth(), owner = auth.user?.id,ownerIdentity=auth.identityRevision;
let alive = true, poller, detailVersion = 0, uploadVersion = 0, opener;
const controllers = new Map(), versions = new Map(), downloadTimers = new Map();
const isCurrent = () => alive && auth.isLoggedIn && auth.user?.id === owner && auth.identityRevision===ownerIdentity;
const {refresh:refreshSharedBalance}=useBalance();
const feeSignature=task=>JSON.stringify([task?.billing?.state,task?.billing?.reserved,task?.billing?.charged,task?.billing?.returned,task?.billing?.expired]);
function refreshCredits(){if(isCurrent())void refreshSharedBalance();}
const assets = createArtworkAssets(isCurrent);
const form = reactive({ prompt: '', negativePrompt: '', ratio: '1:1', resolution: '1K', quality: 'auto', n: 1, seed: undefined, catId: '', mode: 'text2img', model: String(route.query.model || ''), editOf: '' });
const ratios = ref([]), resolutions = ref([]), cats = ref([]), imageModels = ref([]), billing = ref(null), defaultFeatures = ref(null), optionsReady = ref(false), optionsError = ref('');
const tasks = ref([]), square = ref([]), mineTotal = ref(null), squareTotal = ref(null), minePage = ref(1), squarePage = ref(1), pageSize = 12;
const tab = ref(route.query.tab === 'square' ? 'square' : 'mine'), mineLoading = ref(false), squareLoading = ref(false), mineError = ref(''), squareError = ref('');
const creating = ref(false), uploading = ref(false), fileInput = ref(null), refName = ref(''), busyTasks = reactive(new Set());
const references = ref([]), mask = ref(null), maskEditor = ref(null), editOrigin = ref(null), localPreviews = new Map();
const referenceItems = computed(() => references.value.length ? references.value : form.editOf ? [{ id: form.editOf, name: refName.value || '原作参考图' }] : []);
const maxReferences = computed(() => features.value.maxReferences || 1);
const referencePath=item=>item.url||'/api/upload/'+item.id+'/raw';
const referenceUrl = item => localPreviews.get(item.id) || assets.urls.get(referencePath(item)) || '';
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
const sizeHint = computed(() => { if (features.value.pixelSize === false) return form.ratio + ' · ' + form.resolution + pt('（像素由模型决定）'); const r = ratios.value.find(x => x.key === form.ratio) || { w: 1, h: 1 }; const base = resolutions.value.find(x => x.key === form.resolution)?.base || ({ '1K': 1024, '2K': 2048, '4K': 3072 }[form.resolution]) || 1024; const long = Math.max(r.w || 1, r.h || 1); return Math.round(base * (r.w || 1) / long / 16) * 16 + ' × ' + Math.round(base * (r.h || 1) / long / 16) * 16; });
const quote=computed(()=>paintingQuote(billing.value,form.quality,form.n));
const costHint=computed(()=>!quote.value.known?pt('费用待核对，请重新加载参数。'):quote.value.total===0?pt('当前站点不扣绘画次数'):pt('预计 {count} 次 · 提交时预留，按成功张数结算',{count:quote.value.total}));
const isPending = s => ['QUEUED', 'RUNNING', 'SETTLING'].includes(s);
const canCancel = s => s === 'QUEUED' || s === 'RUNNING';
const statusLabel = s => pt(({ QUEUED: '等待灵感就位', RUNNING: '想象正在成形', SETTLING: '正在保存与结算', SUCCESS: '创作完成', FAILED: '这次没有完成', CANCELED: '已取消生成' }[s] || s || '准备中'));
const qualityLabel = s => pt(({ auto: '自动', low: '低', medium: '中', high: '高' }[s] || s));
const fmt = d => d ? new Date(d).toLocaleString(paintingLocale(), { hour12: false }) : '—';
const imageSource = r => assets.urls.get(r?.url) || (r?.url?.startsWith('/art/') ? r.url : '');
function requestScope(key) { controllers.get(key)?.abort(); const controller = new AbortController(); controllers.set(key, controller); const version = (versions.get(key) || 0) + 1; versions.set(key, version); return { signal: controller.signal, current: () => isCurrent() && !controller.signal.aborted && versions.get(key) === version }; }
function retainAssets() {
  const paths = new Set([...tasks.value, ...square.value].flatMap(t => t.results?.slice(0, 1).map(r => r.url) || []));
  for (const r of detail.value?.results || []) paths.add(r.url);
  for (const item of referenceItems.value) paths.add(referencePath(item));
  assets.retain(paths);
}
function loadVisibleImages(rows) { for (const t of rows) if (t.results?.[0]) void assets.load(t.results[0]); retainAssets(); }
const galleryInitial={...form};let galleryBaseline=JSON.stringify(form);
const galleryEntry=useGalleryEntry({auth,target:'/painting',canApply:()=>isCurrent()&&optionsReady.value&&!creating.value&&!uploading.value&&route.query.editor===undefined,hasDraft:()=>!!form.prompt.trim()||referenceItems.value.length>0||JSON.stringify(form)!==galleryBaseline,apply(draft){
 if(typeof draft.model!=='string'||!draft.model||typeof draft.ratio!=='string'||typeof draft.resolution!=='string'||draft.prompt.length>4000)throw Error('公开绘画设定不完整，请重新核对。');
 clearReference();Object.assign(form,galleryInitial,Object.fromEntries(["prompt","negativePrompt","model","ratio","resolution","quality","seed","n","catId"].filter(key=>Object.hasOwn(draft,key)).map(key=>[key,draft[key]])),{mode:'text2img',editOf:''});tab.value='mine';
}});
const editorEntry=useImageEditorEntry({auth,canApply:()=>isCurrent()&&optionsReady.value&&!creating.value&&!uploading.value&&route.query.gallery===undefined,hasDraft:()=>!!form.prompt.trim()||referenceItems.value.length>0||JSON.stringify(form)!==galleryBaseline,currentModel:()=>form.model,apply({record,inputs}){
 const saved=record.returnDraft;
 if(inputs.source.id!==record.sourceId||(inputs.mask?.id||null)!==record.maskId)throw Error('重绘设定不完整。');
 clearReference();
 if(saved)Object.assign(form,Object.fromEntries(['prompt','negativePrompt','model','ratio','resolution','quality','n','seed','catId'].map(key=>[key,key==='seed'?saved[key]:saved[key]??'']))) ;
 references.value=(saved?.references||[{id:record.sourceId,name:inputs.source.name||'重绘原图'}]).map((row,index)=>({...row,url:index===0?'/api/image/editor/files/'+row.id:'/api/upload/'+row.id+'/raw'}));
 form.mode='img2img';form.editOf=record.sourceId;if(record.prompt.trim())form.prompt=record.prompt;if(!saved)form.n=1;
 mask.value=record.maskId?{id:record.maskId,sourceId:record.sourceId,editor:true,strokes:[]}:null;editOrigin.value=saved?.editOrigin||null;tab.value='mine';
 for(const item of references.value)void assets.load({url:referencePath(item)});retainAssets();
}});
function openImageEditor(){
 if(!isCurrent()||uploading.value||creating.value||!referenceItems.value.length)return;
 if(mask.value&&!mask.value.id)return ElMessage.warning(pt("请先重新确认并保存当前选区，再打开图像编辑台。"));
 try{const transfer=saveImageEditorTransfer(owner,{sourceId:referenceItems.value[0].id,maskId:mask.value?.id||null,prompt:form.prompt,returnDraft:{...form,references:referenceItems.value.map(row=>({id:row.id,name:(row.name||'参考图片').slice(0,255)})),editOrigin:editOrigin.value}});void router.push({path:'/inpaint',query:{editor:transfer.id}});}catch(error){ElMessage.error(pt(error.message));}
}
function adjustMask(){if(mask.value?.editor)return openImageEditor();maskEditor.value?.open(mask.value?.strokes||[]);}
async function loadOptions() { const req = requestScope('options'); optionsReady.value=false; optionsError.value = ''; try { const data = await api.get('/image/options', { signal: req.signal }); if (!req.current()) return; ratios.value = data.ratios || []; resolutions.value = data.resolutions || []; cats.value = data.cats || []; imageModels.value = data.models || []; billing.value = data.billing; defaultFeatures.value = data.defaultFeatures; optionsReady.value = true; } catch (error) { if (req.current()) { optionsReady.value = false; optionsError.value = '创作参数暂未加载，请重试。'; } } }
async function loadGallery(kind = tab.value) {
  const mine = kind === 'mine', loading = mine ? mineLoading : squareLoading, errorState = mine ? mineError : squareError;
  const req = requestScope(kind), page = mine ? minePage.value : squarePage.value;
  loading.value = true; errorState.value = '';
  try { const data = await api.get('/image/' + (mine ? 'tasks' : 'square') + '?page=' + page + '&pageSize=' + pageSize, { signal: req.signal }); if (!req.current()) return; const rows = (data.items || []).map(t => ({ ...t, results: Array.isArray(t.results) ? t.results : [], mine: mine ? true : t.mine })); if(mine&&rows.some(row=>{const previous=tasks.value.find(item=>item.id===row.id);return previous&&feeSignature(previous)!==feeSignature(row);}))refreshCredits(); if (mine) { tasks.value = rows; mineTotal.value = data.total ?? rows.length; } else { square.value = rows; squareTotal.value = data.total ?? rows.length; } if (mine && detail.value?.mine) { const update = rows.find(t => t.id === detail.value.id); if (update) { const events = detail.value.events, statusChanged = detail.value.status !== update.status; detail.value = { ...detail.value, ...update, events }; for (const result of detail.value.results) void assets.load(result); if (statusChanged) void refreshDetailSnapshot(update.id, detailVersion); } } loadVisibleImages(rows); }
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
  if (referenceItems.value.length + files.length > maxReferences.value) return ElMessage.warning(pt("当前模型最多支持 {p0} 张参考图",{p0:(maxReferences.value)}));
  if (files.some(file => !/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024)) return ElMessage.warning(pt("请选择每张不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片"));
  const revision = ++uploadVersion, req = requestScope('upload'); uploading.value = true;
  try { for (const file of files) { const data = await uploadFile(file, { signal: req.signal }); if (!req.current() || revision !== uploadVersion) return; const rows = [...referenceItems.value, { id: data.id, name: file.name }]; localPreviews.set(data.id, URL.createObjectURL(file)); references.value = rows; form.editOf = rows[0].id; } retainAssets(); }
  catch (error) { if (req.current()) ElMessage.error(pt(error.message || pt("参考图上传失败，已成功上传的图片会保留"))); }
  finally { if (req.current() && revision === uploadVersion) uploading.value = false; }
}
async function saveMask(data) {
  if (!referenceItems.value.length || uploading.value || creating.value) return;
  const primary = referenceItems.value[0].id, revision = ++uploadVersion, req = requestScope('upload'); mask.value = { id: null, sourceId: primary, strokes: data.strokes }; uploading.value = true;
  try { const file = new File([data.blob], 'QGauss-selection.png', { type: 'image/png' }); const uploaded = await uploadFile(file, { signal: req.signal }); if (!req.current() || revision !== uploadVersion || primary !== referenceItems.value[0]?.id) return; mask.value = { id: uploaded.id, sourceId: primary, strokes: data.strokes }; ElMessage.success(pt("重绘区域已保存，描述想改变的内容后再生成。")); }
  catch (error) { if (req.current()) ElMessage.error(pt(error.message || pt("选区保存失败"))); }
  finally { if (req.current() && revision === uploadVersion) uploading.value = false; }
}
async function submit() { if (galleryEntry.blocked||editorEntry.blocked) return;if((galleryEntry.applied||editorEntry.applied)&&[['ratios','ratio'],['resolutions','resolution'],['qualities','quality']].some(([cap,key])=>!Array.isArray(features.value[cap])||!features.value[cap].includes(form[key])))return ElMessage.warning(pt("原作品的画面设置当前不再支持，请明确调整后再生成。")); if (creating.value || uploading.value || !optionsReady.value) return; const acceptedQuote=quote.value;if(!acceptedQuote.known)return ElMessage.warning(pt("费用待核对，请重新加载参数。")); if (!form.prompt.trim()) return ElMessage.warning(pt("先给画面写一句描述吧")); const model = imageModels.value.find(m => m.name === form.model); if (form.model && (!model || model.ready === false)) return ElMessage.warning(pt("原绘画模型已停用或未接入，请重新选择模型")); if (form.mode === 'img2img' && !form.editOf) return ElMessage.warning(pt("请先选择自己的参考图")); if (form.mode === 'img2img' && (referenceItems.value.length > maxReferences.value || (mask.value && !features.value.mask))) return ElMessage.warning(pt("所选模型不支持当前参考设置，请调整后再生成")); if (form.mode === 'img2img' && mask.value && !mask.value.id) return ElMessage.warning(pt("选区尚未保存，请打开画布重新确认")); creating.value = true; try { const data = await api.post('/image/tasks', { prompt: form.prompt, negativePrompt: form.negativePrompt || undefined, ratio: form.ratio, resolution: form.resolution, quality: form.quality, n: form.n, seed: form.seed, catId: form.catId || undefined, mode: form.mode, model: form.model || undefined, expectedUnitCost: acceptedQuote.unitCost, versionName: model?.displayName || model?.name || undefined, editOf: form.mode === 'img2img' ? form.editOf : undefined, referenceIds: form.mode === 'img2img' && references.value.length ? references.value.map(item => item.id) : undefined, maskId: form.mode === 'img2img' ? mask.value?.id : undefined, parentId: form.mode === 'img2img' && editOrigin.value?.fileId === form.editOf ? editOrigin.value.taskId : undefined, action: form.mode === 'img2img' && editOrigin.value?.fileId === form.editOf ? (mask.value ? 'redraw' : 'variant') : undefined }); if (!isCurrent()) return; refreshCredits(); if (data?.id) tasks.value = [{ ...data, results: data.results || [], mine: true }, ...tasks.value.filter(t => t.id !== data.id)].slice(0, pageSize); ElMessage.success(pt("灵感已进入队列，创作台留给下一个想法。")); minePage.value = 1; if (tab.value !== 'mine') tab.value = 'mine'; else await loadGallery('mine'); } catch (error) { if (isCurrent()) { const priceChanged=paintingPriceChanged(error);if(priceChanged)await loadOptions(); if (isCurrent()) ElMessage.error(pt(priceChanged?pt("绘画费用已更新，请核对新费用后再生成。"):error.message || pt("提交失败，请稍后重试"))); } } finally { if (isCurrent()) creating.value = false; } }
async function cancel(t) { if (busyTasks.has(t.id)) return; busyTasks.add(t.id); try { await api.post('/image/tasks/' + t.id + '/cancel'); if (!isCurrent()) return; await loadGallery('mine');if(isCurrent()){const current=tasks.value.find(row=>row.id===t.id);if(!current||feeSignature(current)===feeSignature(t))refreshCredits();} } catch (error) { if (isCurrent()) ElMessage.error(pt(error.message)); } finally { busyTasks.delete(t.id); } }
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
function reuse(t) { const mine = t.mine === true; form.prompt = t.prompt || ''; form.negativePrompt = t.negativePrompt || ''; form.ratio = t.ratio || '1:1'; form.resolution = t.resolution || '1K'; form.quality = t.quality || 'auto'; form.n = t.n || 1; form.seed = t.seed ?? undefined; form.catId = cats.value.some(c => c.id === t.catId) ? t.catId : ''; form.model = t.model || ''; form.mode = t.mode === 'img2img' ? 'img2img' : 'text2img'; clearReference(); if (mine && t.editOf && form.mode === 'img2img') { const ids = t.referenceIds?.length ? t.referenceIds : [t.editOf]; if (t.referenceIds?.length) references.value = ids.map((id, i) => ({ id, name: '原作参考 ' + (i + 1) })); form.editOf = ids[0]; mask.value = t.maskId ? { id: t.maskId, sourceId: ids[0], editor: true, strokes: [] } : null; refName.value = '原作参考图'; for (const id of ids) void assets.load({ url: '/api/upload/' + id + '/raw' }); } closeDetail(); nextTick(() => { if (isCurrent()) document.querySelector('#qp-prompt')?.focus({ preventScroll: false }); }); ElMessage.success(pt(form.mode === 'img2img' && !form.editOf ? pt("参数已带入，请选择自己的参考图。") : pt("提示词与参数已带入，修改后再开始生成。"))); }
async function copyPrompt() { try { await navigator.clipboard.writeText(detail.value.prompt); if (isCurrent()) ElMessage.success(pt("提示词已复制")); } catch { if (isCurrent()) ElMessage.warning(pt("复制失败，可直接选中提示词复制")); } }
function editArtwork() { const t = detail.value, result = selectedResult.value, index = selectedImage.value; if (!t?.mine || !result?.fileId || t.status !== 'SUCCESS') return; reuse(t); clearReference(); references.value = [{ id: result.fileId, name: '作品第 ' + (index + 1) + ' 张' }]; form.editOf = result.fileId; form.mode = 'img2img'; form.n = 1; editOrigin.value = { taskId: t.id, fileId: result.fileId }; void assets.load({ url: '/api/upload/' + result.fileId + '/raw' }); retainAssets(); }
async function downloadSelected() { const result = selectedResult.value, id = detail.value?.id, index = selectedImage.value; if (!result || downloading.value) return; downloading.value = true; try { const entry = await assets.load(result, true); if (!entry?.blob || !isCurrent() || detail.value?.id !== id) return; const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }; const url = URL.createObjectURL(entry.blob), link = document.createElement('a'); link.href = url; link.download = 'QGauss-' + id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-12) + '-' + (index + 1) + '.' + (extensions[entry.blob.type.split(';')[0]] || 'png'); document.body.append(link); link.click(); link.remove(); downloadTimers.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloadTimers.delete(url); }, 30000)); } finally { if (isCurrent()) downloading.value = false; } }
async function publicationUpdated(value) { if(!isCurrent()||detail.value?.id!==value.id)return;Object.assign(detail.value,value);await Promise.all([loadGallery('mine'),squareTotal.value!==null?loadGallery('square'):Promise.resolve()]); }
async function remove() { const t = detail.value; if (!t?.mine || !deleteConfirm.value || detailBusy.value) return; detailBusy.value = true; try { await api.del('/image/tasks/' + t.id); if (!isCurrent()) return; if (detail.value?.id === t.id) closeDetail(); await Promise.all([loadGallery('mine'), squareTotal.value !== null ? loadGallery('square') : Promise.resolve()]); ElMessage.success(pt("作品已移入回收")); } catch (error) { if (isCurrent()) ElMessage.error(pt(error.message)); } finally { if (isCurrent()) detailBusy.value = false; } }
watch(features, value => { if(galleryEntry.applied&&form.model===galleryEntry.sourceDraft?.model||editorEntry.applied&&form.model===editorEntry.sourceModel)return; if (!value.qualities.includes(form.quality)) form.quality = 'auto'; if (!value.resolutions.includes(form.resolution)) form.resolution = value.resolutions[0]; if (!value.ratios.includes(form.ratio)) form.ratio = value.ratios[0] || '1:1'; });
watch(tab, () => { void loadGallery(); });
watch(() => route.query.tab, value => { if (value === 'square' || value === 'mine') tab.value = value; });
watch(() => route.query.model, value => { if (typeof value === 'string' && value) form.model = value; });
function dispose() { alive = false; clearInterval(poller); for (const controller of controllers.values()) controller.abort(); assets.close(); for (const url of localPreviews.values()) URL.revokeObjectURL(url); localPreviews.clear(); for (const [url, timer] of downloadTimers) { clearTimeout(timer); URL.revokeObjectURL(url); } downloadTimers.clear(); tasks.value = []; square.value = []; closeDetail(); }
watch([() => auth.user?.id,()=>auth.identityRevision], ([id,identity]) => { if (id !== owner||identity!==ownerIdentity) dispose(); });
onMounted(async () => { await Promise.all([loadOptions(), loadGallery()]); await nextTick();galleryBaseline=JSON.stringify(form);if(isCurrent()){refreshCredits();void galleryEntry.initialize();void editorEntry.initialize();} if (isCurrent()) poller = setInterval(() => { if (isCurrent() && !mineLoading.value && tasks.value.some(t => isPending(t.status))) void loadGallery('mine'); }, 2500); });
onUnmounted(dispose);
</script>
