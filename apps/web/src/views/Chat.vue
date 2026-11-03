<template>
  <Teleport defer to="#qg-chat-history">
    <!-- 左：会话列表 -->
    <aside class="cv-convs qg-glass" :class="{ open: convOpen }" aria-label="会话列表">
      <div class="cv-convs-head">
        <button type="button" class="cv-new" title="新对话（Ctrl / ⌘ + K）" @click="newChat">
          <el-icon><Plus /></el-icon>
          <span>开启新对话</span>
        </button>
        <button
          type="button"
          class="qg-icon-btn"
          :class="{ 'cv-on': searchOpen }"
          title="搜索对话"
          aria-label="搜索对话"
          @click="searchOpen = !searchOpen"
        >
          <el-icon><Search /></el-icon>
        </button>
      </div>
      <div v-if="searchOpen" class="cv-search">
        <el-icon class="cv-search-icon"><Search /></el-icon>
        <input v-model="convKeyword" placeholder="搜索对话" aria-label="搜索会话" />
      </div>
      <div class="qgc-history-tabs" role="tablist" aria-label="对话类型"><button type="button" role="tab" :aria-selected="conversationKind === 'chat'" @click="conversationKind = 'chat'">AI对话</button><button type="button" role="tab" :aria-selected="conversationKind === 'app'" @click="conversationKind = 'app'">应用对话</button><button type="button" role="tab" :aria-selected="conversationKind === 'agent'" @click="conversationKind = 'agent'">搭档协作</button></div>
      <div v-if="folders.length" class="cv-folders" role="tablist" aria-label="会话分组">
        <button type="button" class="cv-folder" :class="{ active: folderFilter === '' }" @click="folderFilter = ''">全部</button>
        <button
          v-for="f in folders"
          :key="f.id"
          type="button"
          class="cv-folder"
          :class="{ active: folderFilter === f.id }"
          @click="folderFilter = f.id"
          @dblclick="renameFolder(f)"
        >{{ f.name }} <span class="cv-folder-n">{{ f.conversationCount }}</span></button>
      </div>
      <div v-if="activeFolder" class="cv-folder-bar">
        <span>分组「{{ activeFolder.name }}」</span>
        <button type="button" class="cv-link" @click="renameFolder(activeFolder)">重命名</button>
        <button type="button" class="cv-link danger" @click="removeFolder(activeFolder)">删除分组</button>
      </div>
      <div class="cv-convs-list">
        <template v-if="loadingConvs">
          <div v-for="n in 6" :key="n" class="qg-skeleton cv-conv-skel"></div>
        </template>
        <template v-for="group in convGroups" :key="group.key">
          <div class="cv-group">{{ group.label }}</div>
          <div
            v-for="c in group.items"
            :key="c.id"
            class="cv-conv"
            :class="{ active: !selecting && c.id === conversationId, picked: selecting && selected.includes(c.id) }"
            role="button"
            tabindex="0"
            @click="onConvClick(c)"
            @keydown.enter.prevent="onConvClick(c)"
          >
            <span v-if="selecting" class="cv-check" aria-hidden="true">
              <el-icon v-if="selected.includes(c.id)"><Check /></el-icon>
            </span>
            <span class="cv-conv-title" :title="c.title">{{ c.title || '新对话' }}</span><span v-if="c.activeMessageId" class="qgd-run-badge" role="status">{{ c.activeMessageStatus === 'SETTLING' ? '结算中' : '生成中' }}</span>
            <el-icon v-if="c.pinned && !selecting" class="cv-pin-mark" title="已置顶"><StarFilled /></el-icon>
            <span v-if="!selecting" class="cv-conv-ops" @click.stop>
              <el-dropdown trigger="click" size="small" @command="(cmd) => onConvCommand(c, cmd)">
                <button type="button" class="cv-op" title="更多操作" aria-label="会话操作">
                  <el-icon><MoreFilled /></el-icon>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="pin">{{ c.pinned ? '取消置顶' : '置顶' }}</el-dropdown-item>
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item
                      v-for="f in folders"
                      :key="f.id"
                      :command="`move:${f.id}`"
                      :disabled="c.folderId === f.id"
                    >移到「{{ f.name }}」</el-dropdown-item>
                    <el-dropdown-item v-if="c.folderId" command="unfolder">移出分组</el-dropdown-item>
                    <el-dropdown-item command="newfolder">移到新分组…</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </span>
          </div>
        </template>
        <div v-if="!loadingConvs && conversations.length === 0" class="qgc-history-empty"><QBot mood="sleep" :size="45" /><b>灵感故事，从这里开始</b><small>{{ auth.isLoggedIn ? "开启对话后，会自动留在这里。" : "登录后，让每一次灵感都有迹可循。" }}</small></div>
        <QEmpty v-else-if="!loadingConvs && convGroups.length === 0" compact mood="sleep" title="没找到匹配的会话" desc="换个关键词试试？" />
      </div>
      <div v-if="selecting" class="cv-bulk">
        <div class="cv-bulk-info">
          <span>已选 {{ selected.length }} 个</span>
          <button type="button" class="cv-link" @click="toggleSelectAll">
            {{ selected.length && selected.length === visibleConvIds.length ? '取消全选' : '全选' }}
          </button>
        </div>
        <div class="cv-bulk-actions">
          <el-button size="small" type="danger" plain :disabled="!selected.length" @click="bulkDelete({ ids: selected })">
            删除所选
          </el-button>
          <el-button size="small" plain @click="bulkDelete({ unpinnedOnly: true })">清空未置顶</el-button>
        </div>
      </div>
      <div class="qgc-history-operations"><button type="button" @click="toggleSelecting">{{ selecting ? '退出批量管理' : '批量管理' }}</button><button type="button" :disabled="!visibleUnpinnedIds.length" @click="bulkDelete({ unpinnedOnly: true })">清空非置顶</button><button type="button" @click="createFolder">会话分组</button><button type="button" @click="router.push('/apps')">应用广场</button></div>
    </aside>
  </Teleport>
  <EmptyChat v-if="!draftStarted && !conversationId" :models="models" :recent="conversations" @start="newChat" @open="openConversation" @voice="openHomeVoice" />
  <div v-else class="cv qgc-chat" :class="{ 'cv-immersive': immersive, 'is-new-chat': messages.length === 0 && !loadingDetail }">
    <!-- 中：对话主区 -->
    <section class="cv-main">
      <!-- 会随状态变色的极光：待机紫 / 思考蓝 / 回答黄绿 -->
      <div class="cv-aurora" :class="`is-${auroraState}`" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="qgc-chat-stage">
      <header class="cv-top">
        <button type="button" class="qg-icon-btn cv-only-narrow" aria-label="打开会话列表" @click="clientNavigationOpen = true">
          <el-icon><Fold /></el-icon>
        </button>
        <button type="button" class="qg-icon-btn" aria-label="打开外观实验室" title="外观实验室" @click="appearance.open = true"><ClientIcon name="palette" /></button>
        <router-link v-if="agentId" class="cv-model" :to="{path:'/agent/app',query:{agent:agentId}}"><ClientIcon name="agent" /><span class="cv-model-name">{{ currentAgent?.name||'智能体搭档' }}</span></router-link>
        <button v-else type="button" class="cv-model" :title="'切换模型'" aria-haspopup="dialog" :aria-expanded="panelOpen" @click="panelOpen = !panelOpen">
          <span class="cv-model-dot" :class="{ off: currentModel && !currentModel.ready }"></span>
          <span class="cv-model-name">{{ currentModel ? currentModel.displayName : t('chat.model') }}</span>
          <el-icon class="cv-model-caret"><ArrowDown /></el-icon>
        </button>
        <span v-if="appId||appError||appLoading" class="cv-app">
          <AppAvatar v-if="appIcon" :icon="appIcon" :app-id="appId"/><el-icon v-else><Grid /></el-icon>{{ appName||(appLoading?'正在打开应用':'应用暂不可用') }}
          <button type="button" aria-label="退出应用" @click="leaveApp">
            <el-icon><Close /></el-icon>
          </button>
        </span>
        <span class="cv-grow"></span>
        <span v-if="quota.limit > 0" class="cv-quota" title="今日已用 / 每日上限">{{ quota.used }} / {{ quota.limit }}</span>
        <button
          v-if="messages.length"
          type="button"
          class="qg-icon-btn"
          title="导出为 Markdown"
          aria-label="导出为 Markdown"
          @click="exportMarkdown"
        >
          <el-icon><Download /></el-icon>
        </button>
        <button
          type="button"
          class="qg-icon-btn"
          :title="immersive ? '退出沉浸模式（Esc）' : '沉浸模式'"
          :aria-label="immersive ? '退出沉浸模式' : '进入沉浸模式'"
          @click="immersive = !immersive"
        >
          <el-icon><component :is="immersive ? 'Aim' : 'FullScreen'" /></el-icon>
        </button>
        <button
          type="button"
          class="qg-icon-btn"
          :class="{ 'cv-on': panelOpen }"
          v-if="!agentId" title="模型列表"
          aria-label="模型列表"
          @click="panelOpen = !panelOpen"
        >
          <el-icon><Operation /></el-icon>
        </button>
        <ConversationOutline :entries="outlineEntries" :scroller="scroller" :thread-key="conversationId || 'draft'" @navigate="atBottom = false" />
      </header>

      <div ref="scroller" class="cv-scroll" role="log" aria-live="polite" aria-label="消息列表" @scroll.passive="onScroll">
        <div v-if="loadingDetail" class="cv-thread">
          <QLoader text="正在翻聊天记录…" />
        </div>

        <section v-else-if="messages.length === 0 && agentId" class="qag-chat-intro"><span class="qag-mini-core" aria-hidden="true">Q</span><small>QGAUSS / YOUR ACTION PARTNER</small><h1>{{ currentAgent?.name||'正在迎接你的搭档…' }}</h1><p>{{ currentAgent?.greeting||'说说你的目标，让搭档一起向前推进。' }}</p><span>{{ contextOn?'沿当前分支接续协作':'使用独立的服务方会话' }}</span><router-link to="/agent">认识其他搭档<ClientIcon name="arrowUpRight" /></router-link></section>
        <ChatWelcome v-else-if="messages.length === 0" :app-name="appName" :hide-hint="welcomeHintHidden" :hide-heading="welcomeHeadingHidden" :near-input="compactComposer && composerFocus && !welcomeHeadingHidden" />

        <div v-else class="cv-thread">
          <div v-for="(m, i) in visibleMessages" :key="m.serverId || `local-${i}`" class="cv-msg" :class="m.role" :data-qg-turn="i" tabindex="-1">
            <template v-if="m.role === 'user'">
              <div v-if="m.attachments?.length" class="cv-att-list">
                <template v-for="a in m.attachments" :key="a.id">
                  <img
                    v-if="a.kind === 'image'"
                    class="cv-att-thumb"
                    :src="a.preview || thumbs[a.id]"
                    :alt="a.name"
                    :title="a.name"
                  />
                  <div v-else class="cv-att-card" :title="a.name">
                    <span class="cv-att-ext">{{ extOf(a.name) }}</span>
                    <span class="cv-att-meta">
                      <span class="cv-att-name">{{ a.name }}</span>
                      <span class="cv-att-size">{{ formatSize(a.size) }}</span>
                    </span>
                  </div>
                </template>
              </div>
              <div class="cv-bubble">{{ m.content }}</div>
              <div class="cv-actions">
                <button type="button" class="cv-act" title="复制" aria-label="复制" @click="copyMessage(m)">
                  <el-icon><CopyDocument /></el-icon>
                </button>
                <button type="button" class="cv-act" title="编辑后重发" aria-label="编辑后重发" @click="editMessage(m)">
                  <el-icon><EditPen /></el-icon>
                </button>
              </div>
            </template>
            <template v-else>
              <QBot class="cv-avatar" :size="32" :mood="botMood(m, i)" :still="i !== visibleMessages.length - 1" />
              <div class="cv-body">
                <details v-if="m.reasoning" class="cv-think" :open="m.streaming && !m.content">
                  <summary>
                    <QStar :size="12" :twinkle="!!m.streaming && !m.content" />
                    {{ m.streaming && !m.content ? '正在思考…' : '思考过程' }}
                  </summary>
                  <div class="cv-think-body">{{ m.reasoning }}</div>
                </details>
                <div v-if="m.streaming && !m.content && !m.reasoning" class="cv-typing" aria-label="正在生成">
                  <i></i><i></i><i></i><span>马上就来~</span>
                </div>
                <MarkdownMessage v-else-if="m.content" :content="m.streaming?m.content:citationMarkdown(m.content,m.webSearch)" :streaming="!!m.streaming" @rendered="scrollToBottom()" />
                <WebSearchSources :value="m.webSearch" :streaming="!!m.streaming" />
                <AgentRunPanel :value="m.agentActivity" :disabled="streaming||loadingDetail" @select="fillAgentQuestion" />
                <div v-if="m.notice" class="cv-notice" :class="m.noticeType">{{ m.notice }}</div>
                <div v-if="m.billing?.limit" class="cv-billing" aria-label="本次对话次数"><QStar :size="12" /><span>{{ billingLabel(m.billing) }}</span></div>
                <div v-if="!m.streaming" class="cv-actions">
                  <span v-if="branchInfo(m)" class="cv-branch">
                    <button type="button" :disabled="branchInfo(m).index === 0" aria-label="上一个版本" @click="switchBranch(m, -1)">
                      <el-icon><ArrowLeft /></el-icon>
                    </button>
                    <span>{{ branchInfo(m).index + 1 }} / {{ branchInfo(m).total }}</span>
                    <button
                      type="button"
                      :disabled="branchInfo(m).index === branchInfo(m).total - 1"
                      aria-label="下一个版本"
                      @click="switchBranch(m, 1)"
                    >
                      <el-icon><ArrowRight /></el-icon>
                    </button>
                  </span>
                  <button type="button" class="cv-act" title="复制" aria-label="复制" @click="copyMessage(m)">
                    <el-icon><CopyDocument /></el-icon>
                  </button>
                  <button v-if="m.status==='COMPLETED' && m.serverId && m.content" type="button" class="cv-act" title="朗读回答" aria-label="朗读回答" :disabled="voice.busy || streaming || loadingDetail" @click="voice.speak(m)"><ClientIcon name="sound" /></button>
                  <button
                    type="button"
                    class="cv-act"
                    title="重新生成"
                    aria-label="重新生成"
                    :disabled="streaming || m.status === 'SETTLING'"
                    @click="regenerate(m)"
                  >
                    <el-icon><RefreshRight /></el-icon>
                  </button>
                  <button type="button" class="cv-act danger" title="删除" aria-label="删除" @click="removeMessage(m)">
                    <el-icon><Delete /></el-icon>
                  </button>
                  <span v-if="m.usage" class="cv-meta">
                    {{ usageLabel(m.usage) }}
                  </span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- 底：输入区 -->
      <div class="cv-dock">
        <VoiceStudio :session="voice" :disabled="streaming || loadingDetail" />
        <button v-if="!atBottom && messages.length" type="button" class="cv-jump" @click="scrollToBottom(true)">
          <el-icon><Bottom /></el-icon> 回到最新
        </button>
        <div
          ref="composerElement"
          class="cv-composer qg-glass"
          :class="{ focus: composerFocus, dragging }"
          @focusin="composerFocus = true"
          @focusout="onComposerBlur"
          @dragover.prevent="dragging = true"
          @dragleave.self="dragging = false"
          @drop.prevent="onDrop"
        >
          <div v-if="pendingFiles.length" class="cv-pending">
            <div
              v-for="f in pendingFiles"
              :key="f.localId"
              class="cv-pending-item"
              :class="f.status"
              :title="f.error || f.name"
            >
              <img v-if="f.kind === 'image' && f.preview" :src="f.preview" class="cv-pending-thumb" :alt="f.name" />
              <span v-else class="cv-att-ext">{{ extOf(f.name) }}</span>
              <span class="cv-pending-name">{{ f.name }}</span>
              <span v-if="f.status === 'uploading'" class="cv-pending-state">上传中…</span>
              <span v-else-if="f.status === 'error'" class="cv-pending-state">失败</span>
              <button type="button" class="cv-pending-x" :aria-label="`移除 ${f.name}`" @click="removePending(f)">
                <el-icon><Close /></el-icon>
              </button>
            </div>
          </div>
          <div class="cv-inputrow">
            <textarea
              ref="inputEl"
              v-model="input"
              class="cv-input"
              :rows="compactComposer ? 1 : 3"
              :placeholder="composerPlaceholder"
              aria-label="消息输入框"
              :disabled="entryPending||loadingDetail"
              @input="autosize"
              @paste="onPaste"
              @keydown.enter.exact="onEnter"
            ></textarea>
            <div ref="inputMirror" class="qgc-input-mirror" aria-hidden="true"></div>
          </div>
          <input
            ref="fileInput"
            type="file"
            multiple
            :accept="ACCEPT"
            style="display: none"
            @change="onPickFiles"
          />
        <p v-if="entryPending||entryError" class="qgc-model-cost-note qag-composer-quote" :role="entryError?'alert':'status'"><ClientIcon name="sound"/><span>{{ entryPending?'正在打开指定的创作空间…':entryError }}</span><button v-if="entryError" type="button" @click="applyRouteEntry">重新打开</button><button v-if="entryError" type="button" @click="leaveEntry">开始普通对话</button></p>
        <p v-if="agentId" class="qgc-model-cost-note qag-composer-quote"><ClientIcon name="agent" /><span>{{ agentQuote(currentAgent).label }}</span><small>{{ agentLoading?'正在核对搭档资料…':agentError||'问题与所选附件将交给搭档服务处理' }}</small><button type="button" :disabled="agentLoading||streaming" @click="loadCurrentAgent">刷新资料</button></p>
        <p v-if="appId||appError||appLoading" class="qgc-model-cost-note qag-composer-quote" :role="appError?'alert':'status'"><AppAvatar v-if="appIcon" :icon="appIcon" :app-id="appId"/><ClientIcon v-else name="apps"/><span>{{ appName||'应用资料' }}</span><small>{{ appLoading?'正在核对应用设定…':appError||'已核对第 '+appVersion+' 版设定，发送时再开始生成' }}</small><button v-if="appId" type="button" :disabled="appLoading||streaming||loadingDetail" @click="loadCurrentApp()">刷新应用资料</button><button v-else type="button" @click="leaveApp">返回普通对话</button></p>
        <p v-else-if="auth.isLoggedIn && currentModel" class="qgc-model-cost-note"><ClientIcon name="wallet" /><span>{{ modelBilling(currentModel).title }}</span><small>发送时按站点设置</small></p>
        <p v-if="webSearchOn" class="cv-web-search-note" role="status"><ClientIcon name="globe" />{{ currentModel?.webSearchAvailable ? '本轮允许模型按需要联网，仅发送当前问题和附件；仍按当前模型设置结算。' : '当前模型尚未接入联网，请关闭联网或选择支持的模型后发送。' }}</p>
        <div class="cv-tools">
            <button v-if="!agentId" type="button" class="cv-chip" :aria-label="`选择模型：${currentModel?.displayName || '未选择'}`" aria-haspopup="dialog" :aria-expanded="panelOpen" :aria-busy="modelSaving" @click="panelOpen = !panelOpen">
              <el-icon><Cpu /></el-icon>
              <span class="cv-chip-text">{{ compactComposer && currentModel?.displayName?.length > 6 ? currentModel.displayName.slice(0, 5) + '..' : currentModel ? currentModel.displayName : '选择模型' }}</span><el-icon class="qgc-model-caret"><ArrowDown /></el-icon>
            </button>
            <el-dropdown v-if="!agentId && flatPresets.length" size="small" trigger="click" @command="usePreset">
              <button type="button" class="cv-chip qgc-compact-tool" aria-label="预设" title="预设">
                <el-icon><MagicStick /></el-icon><span class="cv-chip-text">预设</span>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="p in flatPresets" :key="p.id" :command="p">{{ p.title }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <span class="cv-grow"></span>
            <button v-if="!agentId" type="button" class="cv-chip qgc-compact-tool cv-web-search-chip" :class="{on:webSearchOn}" :disabled="!webSearchOn&&!currentModel?.webSearchAvailable" :aria-pressed="webSearchOn" aria-label="允许联网检索" :title="currentModel?.webSearchAvailable ? '按需要检索资料；本轮不带历史消息' : '当前模型尚未接入联网'" @click="webSearchOn=!webSearchOn"><ClientIcon name="globe" /><span class="cv-chip-text">联网</span></button>
            <button
              type="button"
              class="cv-chip qgc-compact-tool"
              :aria-label="contextOn&&!webSearchOn ? '上下文开' : '上下文关'"
              :class="{ on: contextOn&&!webSearchOn }"
              :disabled="webSearchOn"
              :title="webSearchOn ? '联网时只发送当前问题和附件' : contextOn ? '会带上本会话的历史消息' : '只发送本条消息，不带历史'"
              :aria-pressed="contextOn&&!webSearchOn"
              @click="toggleContext"
            >
              <el-icon><Connection /></el-icon><span class="cv-chip-text">{{ contextOn&&!webSearchOn ? '上下文开' : '上下文关' }}</span>
            </button>
            <button type="button" class="cv-plus" title="添加图片或文档（也可以粘贴 / 拖进来）" aria-label="添加附件" @click="fileInput?.click()"><el-icon><Plus /></el-icon></button>
            <button type="button" class="cv-mic" :class="{ on: voice.recording }" title="语音输入与音色" aria-label="语音输入与音色" :aria-pressed="voice.open" @click="openVoice"><el-icon><Microphone /></el-icon></button>
            <button v-if="streaming" type="button" class="cv-stop" aria-label="停止生成（Esc）" :disabled="stopping || activeRun?.target.status === 'SETTLING'" @click="stop"><span class="cv-stop-square"></span></button>
            <button v-else type="button" class="cv-send" :disabled="!canSend" aria-label="发送" @click="send"><el-icon><Top /></el-icon></button>
        </div>
        </div>
      </div>
      </div>
    </section>

    <ModelPicker :open="panelOpen" :models="models" :selected="model" :busy="modelSaving" @close="panelOpen = false" @select="selectModel" />
  </div>
</template>

<script setup>
import AppAvatar from '../components/design/AppAvatar.vue';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon, ElMessage, ElMessageBox } from 'element-plus';
import { api, fetchBlobUrl, streamChat, resumeChat, uploadFile, waitMessageSettled } from '../api/client.js';
import { saveGuestDraft, takeGuestDraft } from '../lib/chat-draft.js';
import { imageOnly, modelBilling } from '../lib/model-presentation.js';
import { citationMarkdown,webSearchReport } from '../lib/web-search.js';
import WebSearchSources from '../components/design/WebSearchSources.vue';
import AgentRunPanel from '../components/design/AgentRunPanel.vue';
import {agentQuote,agentRunReport} from '../lib/agent-presentation.js';
import VoiceStudio from '../components/design/VoiceStudio.vue';
import { useVoiceSession } from '../composables/useVoiceSession.js';
import { currentLang, t } from '../i18n/index.js';
import MarkdownMessage from '../components/MarkdownMessage.vue';
import ConversationOutline from '../components/ConversationOutline.vue';
import QBot from '../components/QBot.vue';
import QStar from '../components/QStar.vue';
import QEmpty from '../components/QEmpty.vue';
import QLoader from '../components/QLoader.vue';
import EmptyChat from '../components/reference/EmptyChat.vue';
import ChatWelcome from '../components/reference/ChatWelcome.vue';
import ModelPicker from '../components/reference/ModelPicker.vue';
import ClientIcon from '../components/reference/ClientIcon.vue';
import { useAppearance } from '../stores/appearance.js';
import '../components/design/workbench-chat.css';
import { useAuth } from '../stores/auth.js';
import { useBalance } from '../stores/balance.js';
import { useUi } from '../stores/ui.js';

const POOL_LABELS = { model3: '低价模型', model4: '高价模型', drawMj: '绘图', agent: '智能体' };
const CONTEXT_KEY = 'qg:chat-context';

const appearance = useAppearance();
const route = useRoute();
const router = useRouter();
const { refresh: refreshBalance } = useBalance();
const { immersive, clientNavigationOpen, clientChatTitle, chatActivity } = useUi();

const conversations = ref([]);
const conversationId = ref(null);
let conversationViewRevision = 0;
const draftStarted = ref(!!route.query.agent);
const searchOpen = ref(false);
const conversationKind = ref('chat');
const messages = ref([]);
const models = ref([]);
const presets = ref([]);
const model = ref('');
const historicalModel = ref(null);
const input = ref('');
const editorMedia = window.matchMedia('(max-width:639px)');
const compactComposer = ref(editorMedia.matches);
function updateEditorSize(event) { compactComposer.value = event.matches; nextTick(autosize); }
const composerPlaceholder = computed(() => dragging.value ? '松开即可添加附件' : compactComposer.value ? currentLang.value === 'en' ? 'Say something...' : currentLang.value === 'zh-TW' ? '來說點什麼...' : '来说点什么...' : currentLang.value === 'en' ? 'Say something... (Shift + Enter = newline; Enter = send)' : currentLang.value === 'zh-TW' ? '來說點什麼吧...（Shift + Enter = 換行； Enter = 發送）' : '来说点什么吧...（Shift + Enter = 换行； Enter = 发送）');
const streaming = ref(false);
watch(() => streaming.value ? messages.value.some(message => message.streaming && message.content) ? 'responding' : 'thinking' : 'idle', value => { chatActivity.value = value; });
const scroller = ref(null);
const inputEl = ref(null);
const inputMirror = ref(null), composerElement = ref(null), composerLines = ref(1);
let inputResizeObserver = null;
watch(inputEl, element => {
  inputResizeObserver?.disconnect();
  if (!element || typeof ResizeObserver === 'undefined') return;
  let lastWidth = -1;
  inputResizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width;
    if (width !== undefined && Math.abs(width - lastWidth) > .01) { lastWidth = width; nextTick(autosize); }
  });
  inputResizeObserver.observe(element);
});
const quota = ref({ limit: 0, used: 0 });
const entryKeys=['conversation','voiceTask','agent','app','voice'];
const entryPending=ref(entryKeys.some(key=>route.query[key]!==undefined)),entryError=ref('');let entryRead=null;
const appId = ref('');
const appName = ref('');
const appIcon=ref('');
const appVersion=ref(null),appLoading=ref(false),appError=ref('');let appRead=null;
const agentId=ref(String(route.query.agent||'')),currentAgent=ref(null),agentLoading=ref(!!route.query.agent),agentError=ref('');let agentRead=null;
const activeTitle = computed(() => !draftStarted.value && !conversationId.value ? '' : conversations.value.find(c => c.id === conversationId.value)?.title || currentAgent.value?.name || appName.value || (currentLang.value === 'en' ? 'New chat' : currentLang.value === 'zh-TW' ? '新對話' : '新对话'));
watch(activeTitle, value => { clientChatTitle.value = value; }, { immediate: true });
const convOpen = ref(false);
const loadingConvs = ref(true);
const loadingDetail = ref(false);
const atBottom = ref(true);
const composerFocus = ref(false);
const contextOn = ref(readContextPref());
const webSearchOn = ref(false);

let controller = null;
let streamRevision = 0;
let activeRun = null;
let conversationListRevision = 0;
let finishNoticeTimer = null;
let historyPoll = null;
const stopping = ref(false);
function detachStream() {
  streamRevision += 1;
  controller?.abort(); controller = null;
  if (activeRun) activeRun.target.streaming = false;
  activeRun = null; streaming.value = false; stopping.value = false;
  if (finishNoticeTimer) clearTimeout(finishNoticeTimer);
  finishedAt.value = 0;
}

/* ---------------- 附件：选择 / 粘贴 / 拖拽 → 立即上传 → 发送时带文件 id ---------------- */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.pdf,.doc,.docx,.xlsx,.txt,.md,.csv,.json';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const fileInput = ref(null);
const pendingFiles = ref([]);
const welcomeHeadingHidden = computed(() => compactComposer.value && (pendingFiles.value.length > 0 || composerFocus.value && composerLines.value > 2));
const welcomeHintHidden = computed(() => pendingFiles.value.length > 0 || compactComposer.value && composerFocus.value);
const dragging = ref(false);
const thumbs = reactive({});
const objectUrls = new Set();

const uploading = computed(() => pendingFiles.value.some((f) => f.status === 'uploading'));
const readyFiles = computed(() => pendingFiles.value.filter((f) => f.status === 'done'));
const canSend = computed(() => !entryPending.value&&!entryError.value&&!appLoading.value&&!appError.value&&(!appId.value||Number.isInteger(appVersion.value))&&!uploading.value && !loadingDetail.value && !modelSaving.value && (!agentId.value||!agentLoading.value&&currentAgent.value?.ready&&!!currentAgent.value.offerRevision) && (!webSearchOn.value||currentModel.value?.webSearchAvailable) && (!!input.value.trim() || readyFiles.value.length > 0));

function extOf(name = '') {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return (m ? m[1] : 'file').toUpperCase();
}

function formatSize(n = 0) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function trackUrl(url) {
  objectUrls.add(url);
  return url;
}

async function addFiles(list) {
  if(entryPending.value||entryError.value||loadingDetail.value)return ElMessage.info('请等待当前创作空间打开后再添加附件。');
  const files = [...list];
  if (!files.length) return;
  const room = 9 - pendingFiles.value.length;
  if (room <= 0) return ElMessage.warning('一条消息最多附带 9 个文件');
  if (files.length > room) ElMessage.warning(`最多还能添加 ${room} 个文件，多出的已忽略`);
  for (const file of files.slice(0, room)) {
    const isImage = IMAGE_TYPES.includes(file.type);
    const item = reactive({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name || (isImage ? '粘贴的图片.png' : '文件'),
      size: file.size,
      kind: isImage ? 'image' : 'document',
      preview: isImage ? trackUrl(URL.createObjectURL(file)) : '',
      status: 'uploading',
      id: '',
      error: '',
    });
    pendingFiles.value.push(item);
    uploadFile(file)
      .then((data) => {
        item.id = data.id;
        item.status = 'done';
        // 以服务端嗅探的类型为准：扩展名伪装成图片的文本会被当作文档处理
        item.kind = IMAGE_TYPES.includes(data.mime) ? 'image' : 'document';
      })
      .catch((e) => {
        item.status = 'error';
        item.error = e?.message || '上传失败';
        ElMessage.error(`「${item.name}」${item.error}`);
      });
  }
}

function onPickFiles(e) {
  addFiles(e.target.files || []);
  e.target.value = '';
}

function onPaste(e) {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return; // 纯文本粘贴照常进输入框
  e.preventDefault();
  addFiles(files);
}

function onDrop(e) {
  dragging.value = false;
  addFiles(e.dataTransfer?.files || []);
}

function removePending(f) {
  pendingFiles.value = pendingFiles.value.filter((x) => x !== f);
}

/** 历史消息里的图片：带鉴权取回后转 blob URL，按文件 id 缓存 */
async function ensureThumb(a) {
  if (a.kind !== 'image' || a.preview || thumbs[a.id]) return;
  const identity=auth.identityRevision;
  thumbs[a.id] = '';
  try {
    const url=await fetchBlobUrl(`/api/upload/${a.id}/raw`);
    if(!viewActive||!auth.isLoggedIn||auth.identityRevision!==identity){URL.revokeObjectURL(url);return;}
    thumbs[a.id] = trackUrl(url);
  } catch {
    /* 文件已删除时只显示占位 */
  }
}

/** 发给服务端的消息：附件只传 id */
function toPayloadMessage(m) {
  return {
    role: m.role,
    content: m.content,
    ...(m.attachments?.length ? { attachments: m.attachments.map((a) => a.id) } : {}),
  };
}

function parseAttachments(parts) {
  try {
    return JSON.parse(parts || '{}').attachments ?? [];
  } catch {
    return [];
  }
}

const flatPresets = computed(() =>
  presets.value.flatMap((g) => (g.items || []).map((it) => ({ ...it, group: g.name }))),
);

const auth = useAuth();

/* ---------------- 情绪化：极光随状态变色，角色随状态换表情 ---------------- */
const finishedAt = ref(0);
const auroraState = computed(() => {
  const last = messages.value[messages.value.length - 1];
  if (!streaming.value || !last?.streaming) return 'idle';
  return last.content ? 'answering' : 'thinking';
});

function botMood(m, i) {
  if (m.streaming) return 'thinking';
  // 刚答完的那条笑一会儿，之后回到待机
  if (i === visibleMessages.value.length - 1 && Date.now() - finishedAt.value < 4000) return 'happy';
  return 'idle';
}

/* Voice input is reviewed before insertion; only newly generated replies may autoplay. */
const voice = useVoiceSession({ auth, context:computed(()=>conversationId.value || `draft:${agentId.value || appId.value || 'chat'}`), disabled:computed(()=>streaming.value || loadingDetail.value||entryPending.value||!!entryError.value||appLoading.value||!!appError.value), refreshBalance, insert(text){ input.value += `${input.value && !/\s$/.test(input.value)?'\n':''}${text}`; nextTick(()=>{autosize();inputEl.value?.focus();}); } });
function openVoice(){ if(!auth.isLoggedIn){saveGuestDraft(input.value);router.push('/login?redirect=/chat');return;}void voice.show(); }
async function openHomeVoice(seed){if(!auth.isLoggedIn){saveGuestDraft(seed);await router.push({path:'/login',query:{redirect:'/chat?new=1'}});return;}newChat(seed);await nextTick();await voice.show();}

function readContextPref() {
  try {
    return localStorage.getItem(CONTEXT_KEY) !== 'off';
  } catch {
    return true;
  }
}

function toggleContext() {
  contextOn.value = !contextOn.value;
  try {
    localStorage.setItem(CONTEXT_KEY, contextOn.value ? 'on' : 'off');
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 会话列表：搜索 + 分组（置顶 / 今天 / 昨天 / 7 天内 / 更早） ---------------- */
const convKeyword = ref('');

/* 用户自建分组（folder）：作为筛选维度，与按日期分组正交 */
const folders = ref([]);
const folderFilter = ref('');
const activeFolder = computed(() => folders.value.find((f) => f.id === folderFilter.value) || null);

async function loadFolders() {
  const identity=auth.identityRevision;
  const rows = await api.get('/folders').catch(() => folders.value);
  if(!viewActive||!auth.isLoggedIn||identity!==auth.identityRevision)return;
  folders.value=rows;
  if (folderFilter.value && !folders.value.some((f) => f.id === folderFilter.value)) folderFilter.value = '';
}

async function createFolder() {
  if (!auth.isLoggedIn) return newChat();
  const name = await askFolderName('新建分组');
  if (!name) return;
  try { await api.post('/folders', { name }); await loadFolders(); }
  catch (error) { ElMessage.error(error.message || '新建分组失败'); }
}

async function askFolderName(title, initial = '') {
  try {
    const { value } = await ElMessageBox.prompt('分组名称', title, {
      inputValue: initial,
      inputValidator: (v) => (v.trim().length > 0 && v.trim().length <= 32) || '名称 1–32 个字',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    });
    return value.trim();
  } catch {
    return null;
  }
}

async function renameFolder(f) {
  const name = await askFolderName('重命名分组', f.name);
  if (!name) return;
  try {
    await api.patch(`/folders/${f.id}`, { name });
    await loadFolders();
  } catch (e) {
    ElMessage.error(e?.message || '重命名失败');
  }
}

async function removeFolder(f) {
  try {
    await ElMessageBox.confirm(`删除分组「${f.name}」？其中的会话会回到未分组，不会被删除。`, '删除分组', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await api.del(`/folders/${f.id}`);
    folderFilter.value = '';
    await Promise.all([loadFolders(), loadConversations()]);
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

async function moveToFolder(c, folderId) {
  try {
    await api.patch(`/conversations/${c.id}`, { folderId });
    c.folderId = folderId;
    await loadFolders();
  } catch (e) {
    ElMessage.error(e?.message || '移动失败');
  }
}

async function onConvCommand(c, cmd) {
  if (cmd === 'pin') return togglePin(c);
  if (cmd === 'rename') return renameConversation(c);
  if (cmd === 'delete') return removeConversation(c);
  if (cmd === 'unfolder') return moveToFolder(c, null);
  if (cmd.startsWith('move:')) return moveToFolder(c, cmd.slice(5));
  if (cmd === 'newfolder') {
    const name = await askFolderName('新建分组');
    if (!name) return;
    try {
      const folder = await api.post('/folders', { name });
      await moveToFolder(c, folder.id);
    } catch (e) {
      ElMessage.error(e?.message || '新建分组失败');
    }
  }
}

const convGroups = computed(() => {
  const kw = convKeyword.value.trim().toLowerCase();
  const list = conversations.value.filter(
    (c) =>
      (conversationKind.value === 'agent' ? !!c.agentId : conversationKind.value === 'app' ? !!c.appId&&!c.agentId : !c.appId&&!c.agentId) &&
      (!folderFilter.value || c.folderId === folderFilter.value) &&
      (!kw || (c.title || '').toLowerCase().includes(kw)),
  );
  const groups = [
    { key: 'pinned', label: '置顶', items: [] },
    { key: 'today', label: '今天', items: [] },
    { key: 'yesterday', label: '昨天', items: [] },
    { key: 'week', label: '7 天内', items: [] },
    { key: 'earlier', label: '更早', items: [] },
  ];
  const byKey = new Map(groups.map((g) => [g.key, g]));
  // 按自然日分组，而不是「距今 24 小时」：昨晚 11 点的会话应当算昨天
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today0 = startOfToday.getTime();
  const DAY = 86_400_000;
  for (const c of list) {
    let key;
    if (c.pinned) key = 'pinned';
    else if (!c.lastMessageAt) key = 'today';
    else {
      const ts = new Date(c.lastMessageAt).getTime();
      key = ts >= today0 ? 'today' : ts >= today0 - DAY ? 'yesterday' : ts >= today0 - 6 * DAY ? 'week' : 'earlier';
    }
    byKey.get(key).items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
});

async function togglePin(c) {
  const pinned = !c.pinned;
  c.pinned = pinned; // 乐观更新，失败再回滚
  try {
    await api.patch(`/conversations/${c.id}`, { pinned });
    await loadConversations();
  } catch (e) {
    c.pinned = !pinned;
    ElMessage.error(e?.message || '置顶失败');
  }
}

/* ---------------- 批量管理 ---------------- */
const selecting = ref(false);
const selected = ref([]);
const visibleConvIds = computed(() => convGroups.value.flatMap((g) => g.items.map((c) => c.id)));
const visibleUnpinnedIds = computed(() => convGroups.value.flatMap((g) => g.items.filter((c) => !c.pinned).map((c) => c.id)));

function toggleSelecting() {
  if (!auth.isLoggedIn) return newChat();
  selecting.value = !selecting.value;
  selected.value = [];
}

function onConvClick(c) {
  if (!selecting.value) return openConversation(c.id);
  selected.value = selected.value.includes(c.id)
    ? selected.value.filter((id) => id !== c.id)
    : [...selected.value, c.id];
}

function toggleSelectAll() {
  const all = visibleConvIds.value;
  selected.value = selected.value.length === all.length ? [] : [...all];
}

async function bulkDelete(body) {
  if (!auth.isLoggedIn) return newChat();
  // 分类、搜索和分组后的清理只提交可见 ID，不能误删另一个历史标签页。
  const request = { ids: body.unpinnedOnly ? [...visibleUnpinnedIds.value] : [...body.ids] };
  if (!request.ids.length) return;
  const text = body.unpinnedOnly ? `删除当前列表中 ${request.ids.length} 个未置顶的会话？置顶会话会保留。` : `删除选中的 ${request.ids.length} 个会话？`;
  try {
    await ElMessageBox.confirm(text, '批量删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
  } catch {
    return;
  }
  try {
    const { count } = await api.post('/conversations/bulk-delete', request);
    ElMessage.success(`已删除 ${count} 个会话`);
    await loadConversations();
    if (conversationId.value && !conversations.value.some((c) => c.id === conversationId.value)) newChat();
    selected.value = [];
    selecting.value = false;
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

async function renameConversation(c) {
  let value;
  try {
    ({ value } = await ElMessageBox.prompt('新的会话标题', '重命名', {
      inputValue: c.title || '',
      inputValidator: (v) => (v.trim().length > 0 && v.trim().length <= 60) || '标题 1–60 个字',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    }));
  } catch {
    return;
  }
  try {
    await api.patch(`/conversations/${c.id}`, { title: value.trim() });
    c.title = value.trim();
  } catch (e) {
    ElMessage.error(e?.message || '重命名失败');
  }
}

/** 导出当前可见分支为 Markdown 文件（纯前端，不经服务端） */
function exportMarkdown() {
  const conv = conversations.value.find((c) => c.id === conversationId.value);
  const title = conv?.title || '对话';
  const lines = [`# ${title}`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')} · 模型：${currentModel.value?.displayName || model.value}`, ''];
  for (const m of visibleMessages.value) {
    if (!m.content) continue;
    lines.push(m.role === 'user' ? '## 我' : '## 助手', '');
    if (m.attachments?.length) lines.push(`> 附件：${m.attachments.map((a) => a.name).join('、')}`, '');
    lines.push(m.content, '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function removeConversation(c) {
  try {
    await ElMessageBox.confirm(`删除会话「${c.title || '新对话'}」？删除后不可恢复。`, '删除会话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await api.del(`/conversations/${c.id}`);
    if (c.id === conversationId.value) newChat();
    await loadConversations();
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

/* ---------------- 模型面板 ---------------- */
const panelOpen = ref(false);
const modelSaving = ref(false);
let modelSelectionRevision = 0;

const currentModel = computed(() => models.value.find((m) => m.name === model.value) || (historicalModel.value?.name === model.value ? { ...historicalModel.value, ready: false } : null));

async function selectModel(m) {
  if (agentId.value || modelSaving.value || loadingDetail.value) return;
  if (!m.ready || imageOnly(m)) return ElMessage.warning('请选择已接入的对话模型；图像模型请到绘画创作。');
  const selectedConversation = conversationId.value;
  const viewRevision = conversationViewRevision;
  const sessionRevision = auth.sessionRevision;
  const selectionRevision = ++modelSelectionRevision;
  const isCurrent = () => viewActive && auth.isLoggedIn && auth.sessionRevision === sessionRevision && viewRevision === conversationViewRevision;
  modelSaving.value = true;
  try {
    if (selectedConversation && m.name !== model.value) {
      await api.patch(`/conversations/${selectedConversation}`, { modelId: m.id });
    }
    if (!isCurrent()) return;
    model.value = m.name;
    historicalModel.value = null;
    const row = conversations.value.find(c => c.id === selectedConversation);
    if (row) row.modelId = m.id;
    panelOpen.value = false;
  } catch (error) {
    if (isCurrent()) ElMessage.error(error.message || '模型保存失败，请重试');
  } finally {
    if (selectionRevision === modelSelectionRevision) modelSaving.value = false;
  }
}

function changeConversationView() {
  entryRead?.abort();entryRead=null;entryPending.value=false;entryError.value='';
  appRead?.abort();appRead=null;appLoading.value=false;
  voice.reset();
  detachStream();
  conversationViewRevision += 1;
  modelSelectionRevision += 1;
  modelSaving.value = false;
  panelOpen.value = false;
}

/* ---------------- 滚动：只在用户停在底部时自动跟随 ---------------- */
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(force = false) {
  if (!force && !atBottom.value) return;
  nextTick(() => {
    const el = scroller.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottom.value = true;
  });
}

function autosize() {
  const el = inputEl.value;
  const mirror = inputMirror.value;
  if (!el || !mirror) return;
  mirror.style.width = `${el.getBoundingClientRect().width}px`;
  mirror.textContent = `${input.value || ''} `;
  const minimum = compactComposer.value ? 35.4 : 71.8;
  const maximum = compactComposer.value ? 147.4 : 248.2;
  el.style.height = `${Math.max(minimum, Math.min(mirror.getBoundingClientRect().height, maximum))}px`;
  const style = getComputedStyle(el), lineHeight = parseFloat(style.lineHeight) || 19.6;
  const contentHeight = el.scrollHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  composerLines.value = input.value.trim() ? Math.min(12, Math.max(1, Math.round(contentHeight / lineHeight))) : 1;
}

function onComposerBlur() { nextTick(() => { if (!composerElement.value?.contains(document.activeElement)) composerFocus.value = false; }); }

function onEnter(e) {
  // 输入法组字时的回车是选词，不是发送
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  send();
}

/* ---------------- 数据加载 ---------------- */
async function loadConversations() {
  const listRevision = ++conversationListRevision;
  const sessionRevision = auth.sessionRevision;
  const current = () => viewActive && auth.isLoggedIn && auth.sessionRevision === sessionRevision && listRevision === conversationListRevision;
  try { const rows = await api.get('/conversations'); if (current()) conversations.value = rows; }
  finally { if (current()) loadingConvs.value = false; }
}

async function loadMeta() {
  const identity=auth.identityRevision;
  const [m, p, q] = await Promise.all([
    api.get('/models/available'),
    api.get('/presets'),
    api.get('/chat/quota').catch(() => ({ limit: 0, used: 0 })),
  ]);
  if(!viewActive||!auth.isLoggedIn||identity!==auth.identityRevision)return;
  models.value = m.filter(model => !imageOnly(model));
  presets.value = p;
  quota.value = q;
  if (!model.value && models.value.length > 0) model.value = (models.value.find((x) => x.ready) || models.value[0]).name;
}

function newChat(seed) {
  const prompt = typeof seed === 'string' ? seed : '';
  if (!auth.isLoggedIn) { saveGuestDraft(prompt); return router.push({ path: '/login', query: { redirect: '/chat?new=1' } }); }
  changeConversationView();
  webSearchOn.value=false;
  loadingDetail.value = false;
  draftStarted.value = true;
  clientNavigationOpen.value = false;
  conversationId.value = null;
  historicalModel.value = null;
  if (!models.value.some(item => item.name === model.value && item.ready)) model.value = models.value.find(item => item.ready)?.name || '';
  messages.value = [];
  input.value = prompt;
  branchChoice.value = {};
  convOpen.value = false;
  nextTick(() => { autosize(); if (!compactComposer.value) inputEl.value?.focus(); });
}

function clearApp(){appRead?.abort();appRead=null;appId.value='';appName.value='';appIcon.value='';appVersion.value=null;appLoading.value=false;appError.value='';}
function leaveApp() { clearApp();conversationKind.value = 'chat'; newChat();if(route.query.app!==undefined){const query={...route.query};delete query.app;void router.replace({path:route.path,query});} }
async function loadCurrentApp({opening=false}={}){
 appRead?.abort();const id=appId.value;if(!id||!auth.isLoggedIn)return;
 const request=new AbortController(),identity=auth.identityRevision,view=conversationViewRevision,choice=modelSelectionRevision;appRead=request;appLoading.value=true;appError.value='';
 const current=()=>viewActive&&!request.signal.aborted&&auth.isLoggedIn&&auth.identityRevision===identity&&appId.value===id&&view===conversationViewRevision;
 try{const row=await api.get('/apps/'+encodeURIComponent(id),{signal:request.signal,retry:false});if(!current())return;if(row?.id!==id||!Number.isInteger(row.version)||row.version<1)throw Error('应用资料不完整，请重新核对。');appName.value=row.name;appIcon.value=row.icon||'';appVersion.value=row.version;
  if(opening){if(row.defaultModel&&choice===modelSelectionRevision)model.value=row.defaultModel;if(row.greeting)messages.value=[{role:'assistant',content:row.greeting}];}
 }catch(error){if(current()){appIcon.value='';appVersion.value=null;appError.value=error.status===404?'这位搭档当前不可用。已有对话保留；可以刷新核对，或退出应用后开始普通对话。':error.message||'应用资料暂未确认，请刷新后继续。';}}
 finally{if(appRead===request){appLoading.value=false;appRead=null;}}
}
async function startApp(id){
 if(!auth.isLoggedIn)return;agentRead?.abort();agentId.value='';currentAgent.value=null;agentError.value='';agentLoading.value=false;clearApp();conversationKind.value='app';newChat();
 if(typeof id!=='string'||!id||id.length>128){appError.value='应用入口不完整，请回到应用广场重新选择。';return;}
 appId.value=id;await loadCurrentApp({opening:true});
}
function clearEntryAgent(){agentRead?.abort();agentId.value='';currentAgent.value=null;agentError.value='';agentLoading.value=false;}
function validEntryId(id){return typeof id==='string'&&id.length>0&&id.length<=128;}
async function savedTranscript(id){
 clearApp();clearEntryAgent();conversationKind.value='chat';newChat();entryPending.value=true;entryError.value='';
 if(!validEntryId(id)){entryPending.value=false;entryError.value='声音记录入口不完整，请回到声音收藏室重新选择。';return;}
 const request=new AbortController(),identity=auth.identityRevision,view=conversationViewRevision;entryRead=request;
 const current=()=>viewActive&&!request.signal.aborted&&auth.isLoggedIn&&auth.identityRevision===identity&&conversationViewRevision===view;
 try{const row=await api.get('/voice/library/'+encodeURIComponent(id),{signal:request.signal,retry:false});if(!current())return;
  if(row?.id!==id||row.kind!=='transcription'||row.availability!=='ready'||typeof row.transcript!=='string'||!row.transcript.trim()||row.transcript.length>30000)throw Error(row?.availability==='expired'?'这份转写已过保留期限，无法带入对话。':'这份记录当前没有可读取的转写文字。');
  input.value=row.transcript;entryPending.value=false;await nextTick();if(current()){autosize();inputEl.value?.focus();}
 }catch(error){if(current())entryError.value=error.status===404?'这份转写已被清理或当前不可用。':error.message||'转写文字暂未打开，请重试。';}
 finally{if(entryRead===request){entryRead=null;entryPending.value=false;}}
}
async function applyRouteEntry(){
 if(!auth.isLoggedIn)return;const query={...route.query};let opening=Promise.resolve();
 if(query.conversation!==undefined){clearApp();clearEntryAgent();conversationKind.value='chat';newChat();if(!validEntryId(query.conversation)){entryPending.value=false;entryError.value='原对话入口不完整，请重新选择。';return;}opening=openConversation(query.conversation,{fromEntry:true});}
 else if(query.voiceTask!==undefined)opening=savedTranscript(query.voiceTask);
 else if(query.agent)opening=startAgent(query.agent);
 else if(query.app!==undefined)opening=startApp(query.app);
 else if(query.voice!==undefined&&!draftStarted.value&&!conversationId.value)newChat();
 const identity=auth.identityRevision,view=conversationViewRevision,choice=modelSelectionRevision;
 await opening;if(!viewActive||!auth.isLoggedIn||auth.identityRevision!==identity||conversationViewRevision!==view)return;
 if(query.model&&!query.conversation&&!agentId.value&&choice===modelSelectionRevision)applyModelParam(query.model);
 if(query.voice!==undefined){if(!['record','voices'].includes(query.voice)){entryError.value='声音功能入口不完整，请重新选择。';entryPending.value=false;return;}await voice.show(query.voice);}
 if(viewActive&&auth.identityRevision===identity&&conversationViewRevision===view)entryPending.value=false;
}
function leaveEntry(){clearApp();clearEntryAgent();conversationKind.value='chat';newChat();const query={...route.query};for(const key of entryKeys)delete query[key];void router.replace({path:'/chat',query});}
async function initializeChat(){
 if(!auth.isLoggedIn){loadingConvs.value=false;if(entryKeys.some(key=>route.query[key]!==undefined))void router.replace({path:'/login',query:{redirect:route.fullPath}});return;}
 if(route.query.new==='1'){newChat(takeGuestDraft());const query={...route.query};delete query.new;void router.replace({path:route.path,query});}
 const identity=auth.identityRevision,opening=applyRouteEntry(),view=conversationViewRevision,choice=modelSelectionRevision;
 const results=await Promise.allSettled([loadConversations(),loadMeta(),loadFolders(),opening]);
 if(!viewActive||!auth.isLoggedIn||auth.identityRevision!==identity||view!==conversationViewRevision)return;
 if(route.path==='/agent/chat'&&!agentId.value){void router.replace('/agent');return;}
 if(route.query.model&&!route.query.conversation&&!agentId.value&&choice===modelSelectionRevision)applyModelParam(route.query.model);
 if(results.some(result=>result.status==='rejected'))ElMessage.error('部分创作资料暂未加载，请刷新后再试。');
}
function markAppUnavailable(error){if(appId.value&&/应用/.test(error.message||'')&&/变化|不存在|不可用|下架/.test(error.message||'')){appError.value=error.message;appVersion.value=null;}}

async function loadCurrentAgent(){
  agentRead?.abort();const request=new AbortController(),id=agentId.value,identity=auth.identityRevision,view=conversationViewRevision;agentRead=request;if(!id||!auth.isLoggedIn)return;agentLoading.value=true;agentError.value='';
  const current=()=>viewActive&&!request.signal.aborted&&auth.isLoggedIn&&auth.identityRevision===identity&&agentId.value===id&&view===conversationViewRevision;
  try{const row=await api.get('/agents/'+encodeURIComponent(id),{signal:request.signal,retry:false});if(current()){currentAgent.value=row;if(!row.ready)agentError.value='这位搭档暂未就绪，请稍后刷新。';}}
  catch(error){if(current()){currentAgent.value=null;agentError.value=error.message||'搭档资料暂未确认，请刷新。';}}
  finally{if(agentRead===request){agentLoading.value=false;agentRead=null;}}
}
async function startAgent(id){
  agentRead?.abort();agentId.value=String(id||'');currentAgent.value=null;agentError.value='';clearApp();conversationKind.value='agent';newChat(typeof route.query.draft==='string'?route.query.draft.slice(0,20000):'');webSearchOn.value=false;await loadCurrentAgent();
}
function fillAgentQuestion(question){if(streaming.value||loadingDetail.value)return;input.value=question;nextTick(()=>{autosize();inputEl.value?.focus();});}
function agentPayload(history){const parent=history.slice(0,-1).at(-1);return{agentId:agentId.value,agentOfferRevision:currentAgent.value?.offerRevision,...(contextOn.value&&parent?.role==='assistant'&&parent.status==='COMPLETED'&&parent.serverId?{agentParentId:parent.serverId}:{})};}

async function openConversation(id,{fromEntry=false}={}) {
  changeConversationView();
  if(fromEntry)entryPending.value=true;
  const viewRevision = conversationViewRevision;
  const sessionRevision = auth.sessionRevision;
  const isCurrent = () => viewActive && auth.isLoggedIn && auth.sessionRevision === sessionRevision && viewRevision === conversationViewRevision;
  draftStarted.value = true;
  clientNavigationOpen.value = false;
  convOpen.value = false;
  loadingDetail.value = true;
  try {
    const detail = await api.get(`/conversations/${id}`);
    if (!isCurrent()) return;
    conversationId.value = detail.id;
    clearApp();appId.value = detail.appId || '';
    appName.value = detail.app?.name || '';
    appIcon.value=detail.app?.icon||'';
    appVersion.value=detail.app?.version||null;
    if(appId.value&&!detail.app)appError.value='这位搭档当前不可用。已有对话保留；可以刷新核对，或退出应用后开始普通对话。';
    else if(appId.value&&!Number.isInteger(appVersion.value))void loadCurrentApp();
    agentRead?.abort();agentId.value=detail.agentId||'';currentAgent.value=null;agentError.value='';agentLoading.value=false;
    conversationKind.value = detail.agentId?'agent':detail.appId ? 'app' : 'chat';
    if(detail.agentId)void loadCurrentAgent();
    // 沿用保存的模型；下线时由发送接口明确报错，不能悄悄改用另一模型。
    const usedModel = detail.model?.name;
    historicalModel.value = detail.model || null;
    if (usedModel) model.value = usedModel;
    messages.value = (detail.messages || []).map((m) => ({
      role: m.role.toLowerCase(),
      content: m.content,
      reasoning: m.reasoning || '',
      attachments: parseAttachments(m.parts),
      serverId: m.id,
      parentId: m.parentId,
      status: m.status,
      billing: m.billing || null,
      webSearch: webSearchReport(m.webSearch),
      agentActivity:agentRunReport(m.agentActivity),
      streaming: ['PENDING', 'STREAMING', 'SETTLING'].includes(m.status),
      ...statusNotice(m.status, m.finishReason),
      usage:
        m.promptTokens != null
          ? { promptTokens: m.promptTokens, completionTokens: m.completionTokens, contextLimit: null, usageEstimated: m.usageEstimated }
          : null,
    }));
    branchChoice.value = {};
    webSearchOn.value=!agentId.value&&!!messages.value.findLast(message=>message.role==='assistant')?.webSearch?.requested;
    messages.value.forEach((m) => m.attachments?.forEach(ensureThumb));
  } catch (e) {
    if(isCurrent()){if(fromEntry)entryError.value=e.status===404?'这段对话已被移除，无法继续打开。':e.message||'原对话暂未打开，请重试。';else ElMessage.error(e?.message || '会话加载失败');}
  } finally {
    if(isCurrent()){loadingDetail.value=false;if(fromEntry)entryPending.value=false;}
  }
  if (isCurrent()) {
    scrollToBottom(true);
    const pending = visibleMessages.value.findLast(item => item.role === 'assistant' && ['PENDING', 'STREAMING', 'SETTLING'].includes(item.status));
    if (pending) void streamInto(null, pending, pending.serverId);
  }
}

/** 落库状态 → 消息下方的提示 */
function statusNotice(status, finishReason) {
  if (status === 'COMPLETED' && finishReason === 'length') return { notice: '本轮已达到输出上限，保留已生成的内容；可以继续提问', noticeType: 'warn' };
  if (status === 'SETTLING') return { notice: '回复正在保存与结算，请稍候；无需重新发送', noticeType: 'warn' };
  if (status === 'ABORTED') return { notice: '已停止生成，保留已生成的内容', noticeType: 'warn' };
  if (status === 'FAILED') return { notice: '这条回复生成失败', noticeType: 'error' };
  if (status === 'PENDING' || status === 'STREAMING') return { notice: '正在接回生成进度…', noticeType: 'warn' };
  return { notice: '', noticeType: '' };
}

function billingLabel(b) {
  const pool = POOL_LABELS[b.pool] || '模型';
  if (['RESERVED', 'SETTLING'].includes(b.state)) return '已预留 ' + b.reserved + ' 次 · ' + pool + ' · 完成后结算';
  if (b.state === 'SETTLED') return '已结算 ' + b.charged + ' 次 · ' + pool;
  if (b.state === 'RELEASED') return '本次未扣次数' + (b.returned ? ' · 已释放 ' + b.returned + ' 次' : '') + (b.expired ? ' · ' + b.expired + ' 次会员额度已到期' : '');
  return '';
}

function usageLabel(u) {
  const used = (u.promptTokens || 0) + (u.completionTokens || 0);
  const source = u.usageEstimated === false ? '模型服务返回' : '估算';
  return (u.contextLimit ? `上下文 ${used} / ${u.contextLimit}` : `用量 ${used}`) + ' · ' + source;
}

/* ---------------- 分支：同一父节点下的助手回复，默认显示最后一条 ---------------- */
const siblingsByParent = computed(() => {
  const map = new Map();
  for (const m of messages.value) {
    if (m.role !== 'assistant') continue;
    const key = m.parentId || 'root';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return map;
});

const branchChoice = ref({});

const visibleMessages = computed(() => {
  const chosen = new Set();
  for (const [key, list] of siblingsByParent.value) {
    const idx = Math.min(branchChoice.value[key] ?? list.length - 1, list.length - 1);
    chosen.add(list[idx]);
  }
  return messages.value.filter((m) => m.role !== 'assistant' || chosen.has(m));
});

const outlineEntries = computed(() => visibleMessages.value.map((message, index) => ({ index, role: message.role, label: String(message.content || '附件问题').replace(/\s+/g, ' ').trim().slice(0, 90) })).filter(item => item.role === 'user'));

function branchInfo(message) {
  if (message.role !== 'assistant') return null;
  const list = siblingsByParent.value.get(message.parentId || 'root') ?? [];
  if (list.length <= 1) return null;
  const index = list.indexOf(message);
  return { index, total: list.length };
}

function switchBranch(message, delta) {
  const key = message.parentId || 'root';
  const list = siblingsByParent.value.get(key) ?? [];
  const current = branchChoice.value[key] ?? list.length - 1;
  branchChoice.value = {
    ...branchChoice.value,
    [key]: Math.max(0, Math.min(list.length - 1, current + delta)),
  };
}

/* ---------------- 消息操作 ---------------- */
async function copyMessage(message) {
  try {
    await navigator.clipboard.writeText(message.content);
    ElMessage.success('已复制');
  } catch {
    ElMessage.warning('当前环境不支持剪贴板');
  }
}

function editMessage(message) {
  input.value = message.content;
  // 附件一并带回输入区，改完文字可以直接重发
  pendingFiles.value = (message.attachments ?? []).map((a) =>
    reactive({ ...a, localId: `re-${a.id}`, status: 'done', error: '', preview: a.preview || thumbs[a.id] || '' }),
  );
  nextTick(() => {
    autosize();
    inputEl.value?.focus();
  });
}

async function removeMessage(message) {
  if (!message.serverId) {
    // 还没落库的本地消息，直接移除
    messages.value = messages.value.filter((m) => m !== message);
    return;
  }
  try {
    await api.del(`/conversations/${conversationId.value}/messages/${message.serverId}`);
    messages.value = messages.value.filter((m) => m !== message);
    ElMessage.success('已删除');
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

function usePreset(preset) {
  input.value = (preset.prompt || '') + input.value;
  nextTick(() => {
    autosize();
    inputEl.value?.focus();
  });
}

/* ---------------- 流式 ---------------- */
/** Each observer belongs to one view and one signed-in session. */
async function streamInto(payload, target, resumeId) {
  if(payload)target.webSearch=payload.webSearch?{requested:true,status:'requested',sources:[],citations:[]}:null;
  if(payload)target.agentActivity=payload.agentId?{kind:'agent',status:'waiting',context:'fresh',steps:[],suggestions:[],artifacts:[]}:null;
  const revision = ++streamRevision;
  if (finishNoticeTimer) clearTimeout(finishNoticeTimer);
  finishedAt.value = 0;
  const viewRevision = conversationViewRevision, sessionRevision = auth.sessionRevision;
  const isCurrent = () => viewActive && auth.isLoggedIn && revision === streamRevision && viewRevision === conversationViewRevision && sessionRevision === auth.sessionRevision;
  const operation = { target, messageId: resumeId || null, conversationId: conversationId.value, cancelRequested: false, cancelInFlight: false, isCurrent };
  activeRun = operation;
  streaming.value = true; target.streaming = true;
  target.notice = target.status === 'SETTLING' ? statusNotice('SETTLING').notice : resumeId ? '正在接回生成进度…' : '生成中，切换会话后仍会继续';
  target.noticeType = resumeId ? 'warn' : '';
  const handlers = {
    isCurrent,
    onMeta(data) {
      if (!isCurrent()) return;
      if(Object.hasOwn(data,'webSearch'))target.webSearch=webSearchReport(data.webSearch);
      if(Object.hasOwn(data,'agentActivity'))target.agentActivity=agentRunReport(data.agentActivity);
      operation.messageId = data.messageId; operation.conversationId = data.conversationId;
      operation.replay = operation.replay || !!data.replay;
      if (data.billing) { target.billing = data.billing; void refreshBalance(); }
      conversationId.value = data.conversationId; target.serverId = data.messageId;
      if (data.userMessageId) target.parentId = data.userMessageId;
      const row = conversations.value.find(item => item.id === data.conversationId);
      if (row) { row.activeMessageId = data.messageId; row.activeMessageStatus = data.status || 'PENDING'; }
      else void loadConversations().catch(() => {});
      if (operation.cancelRequested) void cancelRun(operation);
    },
    onSnapshot(data) {
      if (!isCurrent()) return;
      if(Object.hasOwn(data,'webSearch'))target.webSearch=webSearchReport(data.webSearch);
      if(Object.hasOwn(data,'agentActivity'))target.agentActivity=agentRunReport(data.agentActivity);
      target.content = data.content || ''; target.reasoning = data.reasoning || ''; target.status = data.status;
      const row = conversations.value.find(item => item.id === data.conversationId); if (row) row.activeMessageStatus = data.status;
      if (data.billing) target.billing = data.billing;
      if (data.status === 'SETTLING') Object.assign(target, statusNotice(data.status, data.finishReason));
      else if (['PENDING', 'STREAMING'].includes(data.status)) { target.notice = '生成中，切换会话后仍会继续'; target.noticeType = ''; }
    },
    onConnection(state) {
      if (!isCurrent() || stopping.value) return;
      if (state === 'reconnecting') { target.notice = '连接中断，正在续接生成进度…'; target.noticeType = 'warn'; }
      else if (target.noticeType === 'warn' && target.status !== 'SETTLING') { target.notice = ''; target.noticeType = ''; }
    },
    onDelta(value) { if (isCurrent()) { target.content += value; target.status = 'STREAMING'; scrollToBottom(); } },
    onSearch(value) { if(isCurrent()) {target.webSearch=webSearchReport(value);scrollToBottom();} },
    onAgent(value) {if(isCurrent()){target.agentActivity=agentRunReport(value);scrollToBottom();}},
    onReasoning(value) { if (isCurrent()) { target.reasoning = (target.reasoning || '') + value; target.status = 'STREAMING'; scrollToBottom(); } },
    onError(error) { if (isCurrent()) { markAppUnavailable(error);target.notice = error.message || '请求失败'; target.noticeType = 'error'; target.status = 'FAILED'; } },
    async onDone(data) {
      if (!isCurrent()) return;
      if(Object.hasOwn(data,'webSearch'))target.webSearch=webSearchReport(data.webSearch);
      if(Object.hasOwn(data,'agentActivity'))target.agentActivity=agentRunReport(data.agentActivity);
      target.streaming = false; target.status = data.status;
      if (data.billing) { target.billing = data.billing; void refreshBalance(); }
      streaming.value = false; stopping.value = false;
      Object.assign(target, statusNotice(data.status, data.finishReason));
      finishedAt.value = Date.now();
      if (finishNoticeTimer) clearTimeout(finishNoticeTimer);
      finishNoticeTimer = setTimeout(() => { if (isCurrent()) finishedAt.value = 0; }, 4000);
      target.usage = { promptTokens: data.promptTokens, completionTokens: data.completionTokens, contextLimit: data.contextLimit, usageEstimated: data.usageEstimated };
      if (data.status==='COMPLETED' && !resumeId && !operation.replay) voice.onReply(target);
      await loadConversations().catch(() => {});
      if (!isCurrent()) return;
      const summary = await api.get('/chat/quota').catch(() => null);
      if (!isCurrent()) return;
      if (summary) quota.value = summary;
      if (data.charged?.amount && !resumeId && !operation.replay) { ElMessage.success('本次消耗 ' + data.charged.amount + ' 次（' + (POOL_LABELS[data.charged.pool] || data.charged.pool) + '）'); void refreshBalance(); }
    },
  };
  try {
    const transport = resumeId ? resumeChat(resumeId, handlers) : streamChat(payload, handlers);
    controller = transport;
    const { ended } = await transport.finished;
    if (isCurrent() && ended === 'interrupted') {
      target.notice = '正在同步已保存的回复…'; target.noticeType = 'warn';
      const row = await waitMessageSettled(operation.conversationId, target.serverId, { signal: transport.signal });
      if (!isCurrent()) return;
      if (row) {
        target.content = row.content || ''; target.reasoning = row.reasoning || ''; target.status = row.status;
        target.webSearch=webSearchReport(row.webSearch);
        target.agentActivity=agentRunReport(row.agentActivity);
        if (row.billing) { target.billing = row.billing; void refreshBalance(); }
        Object.assign(target, statusNotice(row.status, row.finishReason));
        if (row.promptTokens != null) target.usage = { promptTokens: row.promptTokens, completionTokens: row.completionTokens, contextLimit: null, usageEstimated: row.usageEstimated };
      } else { target.notice = '暂时无法续接，稍后重新打开此会话即可查看'; target.noticeType = 'warn'; }
    }
  } catch (error) {
    if (isCurrent()) { markAppUnavailable(error);target.notice = error.message || '请求失败'; target.noticeType = 'error'; }
  } finally {
    if (isCurrent()) { streaming.value = false; stopping.value = false; controller = null; activeRun = null; target.streaming = false; }
  }
}

async function cancelRun(operation) {
  if (!operation.isCurrent() || !operation.messageId || operation.cancelInFlight) return;
  operation.cancelInFlight = true;
  stopping.value = true;
  operation.target.notice = '正在停止生成…'; operation.target.noticeType = 'warn';
  const cancelController = new AbortController();
  const cancelTimer = setTimeout(() => cancelController.abort(), 10000);
  try { await api.post('/chat/runs/' + encodeURIComponent(operation.messageId) + '/cancel', undefined, { signal: cancelController.signal }); }
  catch (error) { if (operation.isCurrent()) { operation.target.notice = error.message || '停止失败，请再试一次'; operation.target.noticeType = 'error'; } }
  finally { clearTimeout(cancelTimer); operation.cancelInFlight = false; if (operation.isCurrent()) stopping.value = false; }
}

async function send() {
  const text = input.value.trim();
  if (!canSend.value || streaming.value) return;
  if (!agentId.value&&!model.value) return ElMessage.warning('请先选择模型');
  if (!agentId.value&&!currentModel.value?.ready) { panelOpen.value = true; return ElMessage.warning('当前模型已停用或未接入，请选择可用模型'); }

  const attachments = readyFiles.value.map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    kind: f.kind,
    preview: f.preview,
  }));
  if (!agentId.value&&attachments.some((a) => a.kind === 'image') && !currentModel.value?.capabilities?.includes('vision')) {
    return ElMessage.warning('当前模型不支持识图，请先在模型列表里换一个支持图片理解的模型');
  }

  input.value = '';
  pendingFiles.value = [];
  nextTick(autosize);
  messages.value.push({ role: 'user', content: text || '请阅读附件', attachments });
  messages.value.push({ role: 'assistant', content: '', streaming: true, notice: '', noticeType: '' });
  const target = messages.value[messages.value.length - 1];
  scrollToBottom(true);

  // 关闭上下文时只发本条，服务端以客户端给的消息为准
  const history = contextOn.value&&!webSearchOn.value
    ? visibleMessages.value.filter((m) => m !== target && m.content)
    : [messages.value[messages.value.length - 2]];

  const payload = {
    ...(agentId.value?agentPayload(history):{model:model.value}),
    webSearch:webSearchOn.value,
    appId: appId.value || undefined,
    appVersion:appId.value?appVersion.value:undefined,
    conversationId: conversationId.value || undefined,
    clientMsgId: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    messages: history.map(toPayloadMessage),
  };

  await streamInto(payload, target);
}

/** 重新生成：复用同一条用户提问，服务端会挂在同一个父节点下形成分支 */
async function regenerate(message) {
  const viewRevision = conversationViewRevision, sessionRevision = auth.sessionRevision;
  if (streaming.value) return;
  if(entryPending.value||entryError.value)return ElMessage.warning('请先打开并核对当前创作空间');
  if(appLoading.value||appError.value||appId.value&&!Number.isInteger(appVersion.value))return ElMessage.warning('请先刷新并核对应用资料');
  if(agentId.value&&(!currentAgent.value?.ready||!currentAgent.value.offerRevision||agentLoading.value))return ElMessage.warning('请先刷新并核对搭档资料与费用');
  if(webSearchOn.value&&!currentModel.value?.webSearchAvailable)return ElMessage.warning('请关闭联网或先选择支持联网的模型');
  if (!message.serverId) return ElMessage.warning('这条消息还不能重新生成');
  const visible = visibleMessages.value;
  const index = visible.indexOf(message);
  if (index < 0) return;

  const history = (contextOn.value&&!webSearchOn.value ? visible.slice(0, index) : visible.slice(index - 1, index)).filter((m) => m.content);

  message.content = '';
  message.reasoning = '';
  message.streaming = true;
  message.usage = null;

  const payload = {
    ...(agentId.value?agentPayload(history):{model:model.value}),
    appId: appId.value || undefined,
    appVersion:appId.value?appVersion.value:undefined,
    conversationId: conversationId.value,
    regenerateOf: message.serverId,
    webSearch:webSearchOn.value,
    messages: history.map(toPayloadMessage),
  };

  await streamInto(payload, message);

  // 服务端把新版本挂成同一父节点下的兄弟消息，本地这条已被复用成新版本；
  // 重载一次才能拿到完整分支列表和正确的服务器字段
  if (viewActive && auth.isLoggedIn && viewRevision === conversationViewRevision && sessionRevision === auth.sessionRevision && conversationId.value) {
    try {
      await openConversation(conversationId.value);
    } catch {
      /* 重载失败就保留本地状态 */
    }
  }
}

function stop() {
  if (!activeRun || activeRun.target.status === 'SETTLING') return;
  activeRun.cancelRequested = true;
  void cancelRun(activeRun);
}

/* ---------------- 生命周期 ---------------- */
let viewActive = true;
watch(()=>auth.identityRevision,()=>{
  changeConversationView();conversationListRevision+=1;webSearchOn.value=false;
  conversationId.value=null;messages.value=[];conversations.value=[];historicalModel.value=null;branchChoice.value={};
  models.value=[];presets.value=[];folders.value=[];folderFilter.value='';selected.value=[];
  model.value='';input.value='';pendingFiles.value=[];clearApp();agentRead?.abort();agentId.value='';currentAgent.value=null;agentError.value='';agentLoading.value=false;draftStarted.value=false;
  loadingConvs.value=false;loadingDetail.value=false;quota.value={limit:0,used:0};
  for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls.clear();for(const key of Object.keys(thumbs))delete thumbs[key];
  if(auth.isLoggedIn)void initializeChat();
});
async function refreshBackgroundState() {
  if (!viewActive || !auth.isLoggedIn || document.hidden) return;
  await loadConversations().catch(() => {});
  if (!viewActive || !auth.isLoggedIn || activeRun || loadingDetail.value || !conversationId.value) return;
  const pending = visibleMessages.value.findLast(item => item.role === 'assistant' && ['PENDING', 'STREAMING', 'SETTLING'].includes(item.status));
  if (pending) void streamInto(null, pending, pending.serverId);
}
onMounted(async () => {
  historyPoll = setInterval(() => { void refreshBackgroundState(); }, 10000);
  document.addEventListener('visibilitychange', refreshBackgroundState);
  editorMedia.addEventListener('change', updateEditorSize);
  window.addEventListener('keydown', onKeydown);
  await initializeChat();
});

/** 模型广场点「开始对话」会带上 ?model=；已在对话页时也要跟随 */
function applyModelParam(name) {
  const target = String(name || '');
  if (!target) return;
  if(agentId.value){agentRead?.abort();agentId.value='';currentAgent.value=null;agentError.value='';conversationKind.value='chat';newChat();}
  model.value = target; draftStarted.value = true;
  if (models.value.length && !models.value.some((m) => m.name === target && m.ready)) ElMessage.warning('指定模型当前不可用，请重新选择对话模型。');
}

watch(
  () => route.query.model,
  (name) => applyModelParam(name),
);
watch(conversationKind, () => { selected.value = []; });
watch(()=>entryKeys.map(key=>route.query[key]),(values,previous)=>{
 if(!auth.isLoggedIn||previous&&values.every((value,index)=>value===previous[index]))return;
 if(values.some(value=>value!==undefined)){void applyRouteEntry();return;}
 if(previous?.slice(0,4).some(value=>value!==undefined)&&(appId.value||agentId.value||conversationId.value||entryError.value||input.value)){clearApp();clearEntryAgent();conversationKind.value='chat';newChat();}
});

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    newChat();
    return;
  }
  if (e.key !== 'Escape') return;
  if (panelOpen.value || appearance.open) return;
  // Esc：先停生成，其次退出沉浸模式
  if (streaming.value) stop();
  else if (immersive.value) immersive.value = false;
}

onUnmounted(() => {
  entryRead?.abort();appRead?.abort();agentRead?.abort();
  inputResizeObserver?.disconnect();
  if (historyPoll) clearInterval(historyPoll);
  document.removeEventListener('visibilitychange', refreshBackgroundState);
  editorMedia.removeEventListener('change', updateEditorSize);
  viewActive = false;
  detachStream();
  window.removeEventListener('keydown', onKeydown);
  immersive.value = false;
  clientChatTitle.value = '';
  chatActivity.value = 'idle';
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
});
</script>

<style scoped>
.cv-billing{display:flex;align-items:center;gap:7px;width:fit-content;max-width:100%;margin:9px 0;padding:7px 11px;border-radius:12px;background:var(--qd-soft,var(--bg-secondary));border:1px solid var(--qd-line,var(--border-color));color:var(--qd-muted,var(--text-secondary));font-size:12px;line-height:1.6;overflow-wrap:anywhere}.cv-billing>svg{flex:none}
.cv {
  position: relative;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  background: var(--qg-bg);
}
.cv-immersive {
  grid-template-columns: minmax(0, 1fr) auto;
}
.cv-immersive .cv-convs {
  display: none;
}

/* ---------- 会话列表 ---------- */
.cv-convs {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--qg-panel);
  border-right: 1px solid var(--qg-border);
}
.cv-convs-head {
  display: flex;
  gap: 6px;
  padding: 12px 12px 8px;
}
.cv-new {
  flex: 1;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--qg-border-strong);
  border-radius: var(--qg-radius-sm);
  background: transparent;
  color: var(--qg-text);
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.cv-new:hover {
  border-color: var(--qg-brand);
  color: var(--qg-brand);
  background: var(--qg-brand-soft);
}
.cv-search {
  position: relative;
  margin: 0 12px 8px;
}
.cv-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--qg-faint);
  font-size: 14px;
}
.cv-search input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 30px;
  border: 1px solid var(--qg-border);
  border-radius: var(--qg-radius-sm);
  background: var(--qg-panel-2);
  color: var(--qg-text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.cv-search input:focus {
  border-color: var(--qg-brand);
  background: var(--qg-panel);
}
.cv-convs-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
}
.cv-conv-skel {
  height: 32px;
  margin: 6px 4px;
}
.cv-group {
  padding: 12px 8px 4px;
  font-size: 12px;
  color: var(--qg-faint);
}
.cv-conv {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 4px 0 10px;
  border-radius: var(--qg-radius-sm);
  color: var(--qg-text-2);
  cursor: pointer;
}
.cv-conv:hover {
  background: var(--qg-panel-2);
}
.cv-conv.active {
  background: var(--qg-brand-soft);
  color: var(--qg-text);
}
.cv-conv-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.cv-conv-ops {
  display: flex;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cv-conv:hover .cv-conv-ops,
.cv-conv:focus-within .cv-conv-ops,
.cv-conv.active .cv-conv-ops {
  opacity: 1;
}
.cv-op {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--qg-faint);
  cursor: pointer;
}
.cv-op:hover {
  color: var(--qg-text);
  background: var(--qg-border);
}
.cv-op.on {
  color: var(--qg-accent);
}
.cv-pin-mark {
  color: var(--qg-accent);
  font-size: 12px;
  margin-right: 2px;
}
.cv-folders {
  display: flex;
  gap: 4px;
  padding: 0 12px 8px;
  overflow-x: auto;
}
.cv-folder {
  flex: none;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--qg-border);
  border-radius: 12px;
  background: transparent;
  color: var(--qg-text-2);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.cv-folder.active {
  border-color: var(--qg-brand);
  background: var(--qg-brand-soft);
  color: var(--qg-brand);
}
.cv-folder-n {
  color: var(--qg-faint);
}
.cv-folder-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 6px;
  font-size: 12px;
  color: var(--qg-sub);
}
.cv-folder-bar span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv-link.danger {
  color: var(--qg-danger);
}
.cv-conv.picked {
  background: var(--qg-brand-soft);
}
.cv-check {
  flex: none;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  margin-right: 4px;
  border: 1px solid var(--qg-border-strong);
  border-radius: 4px;
  font-size: 12px;
  color: var(--qg-brand-ink);
}
.cv-conv.picked .cv-check {
  border-color: var(--qg-brand);
  background: var(--qg-brand);
}
.cv-bulk {
  padding: 10px 12px;
  border-top: 1px solid var(--qg-border);
}
.cv-bulk-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--qg-sub);
}
.cv-bulk-actions {
  display: flex;
  gap: 6px;
}
.cv-bulk-actions .el-button {
  flex: 1;
  margin: 0;
}
.cv-link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--qg-brand);
  font-size: 12px;
  cursor: pointer;
}
.cv-empty-line {
  margin: 16px 8px;
  font-size: 12px;
  color: var(--qg-faint);
  text-align: center;
}

/* ---------- 主区 ---------- */
.cv-main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.cv-top {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--qg-border);
  background: var(--qg-panel);
}
.cv-model {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 280px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--qg-radius-sm);
  background: transparent;
  font-weight: 600;
  cursor: pointer;
}
.cv-model:hover {
  background: var(--qg-panel-2);
}
.cv-model-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--qg-success);
}
.cv-model-dot.off {
  background: var(--qg-faint);
}
.cv-model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv-model-caret {
  color: var(--qg-faint);
  font-size: 12px;
}
.cv-app {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 4px 0 8px;
  border-radius: 13px;
  background: var(--qg-brand-soft);
  color: var(--qg-brand);
  font-size: 12px;
}
.cv-app button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.cv-grow {
  flex: 1;
}
.cv-quota {
  font-size: 12px;
  color: var(--qg-sub);
  font-variant-numeric: tabular-nums;
}
.cv-on {
  color: var(--qg-brand);
  background: var(--qg-brand-soft);
}
.cv-only-narrow {
  display: none;
}

.cv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.cv-thread {
  max-width: 820px;
  margin: 0 auto;
  padding: 24px 20px 16px;
}

/* 空状态 */
.cv-hero {
  max-width: 720px;
  margin: 0 auto;
  padding: 12vh 20px 24px;
  text-align: center;
}
.cv-hero-mark {
  width: 52px;
  height: 52px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  border-radius: var(--qg-radius-lg);
  background: var(--qg-brand);
  color: var(--qg-brand-ink);
  font-size: 24px;
  font-weight: 700;
}
.cv-hero h1 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 650;
}
.cv-hero p {
  margin: 0;
  color: var(--qg-sub);
}
.cv-hero-presets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
  margin-top: 28px;
  text-align: left;
}
.cv-hero-preset {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--qg-border);
  border-radius: var(--qg-radius);
  background: var(--qg-panel);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.cv-hero-preset:hover {
  border-color: var(--qg-brand);
  box-shadow: var(--qg-shadow-sm);
}
.cv-hero-preset-title {
  font-weight: 600;
  font-size: 13px;
}
.cv-hero-preset-text {
  font-size: 12px;
  color: var(--qg-sub);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 消息 */
.cv-msg {
  display: flex;
  gap: 12px;
  margin-bottom: 22px;
}
.cv-msg.user {
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.cv-bubble {
  max-width: min(78%, 640px);
  padding: 10px 14px;
  border-radius: var(--qg-radius-lg) var(--qg-radius-lg) 4px var(--qg-radius-lg);
  background: var(--qg-bubble);
  color: var(--qg-bubble-text);
  white-space: pre-wrap;
  word-break: break-word;
}
.cv-avatar {
  margin-top: 2px;
}
.cv-body {
  flex: 1;
  min-width: 0;
  padding-top: 4px;
}
.cv-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cv-msg:hover .cv-actions,
.cv-actions:focus-within,
.cv-msg:last-child .cv-actions {
  opacity: 1;
}
.cv-act {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--qg-radius-sm);
  background: transparent;
  color: var(--qg-faint);
  cursor: pointer;
}
.cv-act:hover:not(:disabled) {
  color: var(--qg-text);
  background: var(--qg-panel-2);
}
.cv-act.danger:hover {
  color: var(--qg-danger);
}
.cv-act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cv-branch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
  font-size: 12px;
  color: var(--qg-sub);
  font-variant-numeric: tabular-nums;
}
.cv-branch button {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--qg-sub);
  cursor: pointer;
}
.cv-branch button:disabled {
  opacity: 0.35;
  cursor: default;
}
.cv-meta {
  margin-left: 8px;
  font-size: 12px;
  color: var(--qg-faint);
}
.cv-notice {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: var(--qg-radius-sm);
  font-size: 12px;
}
.cv-notice.warn {
  background: var(--qg-accent-soft);
  color: var(--qg-accent);
}
.cv-notice.error {
  background: rgba(209, 69, 59, 0.1);
  color: var(--qg-danger);
}
.cv-think {
  margin-bottom: 10px;
  border-left: 2px solid var(--qg-border-strong);
  padding-left: 12px;
}
.cv-think summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--qg-sub);
  user-select: none;
}
.cv-think-body {
  margin-top: 6px;
  font-size: 13px;
  color: var(--qg-sub);
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
}
.cv-typing {
  display: inline-flex;
  gap: 4px;
  padding: 8px 0;
}
.cv-typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--qg-faint);
  animation: cv-blink 1.2s infinite ease-in-out;
}
.cv-typing i:nth-child(2) {
  animation-delay: 0.15s;
}
.cv-typing i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes cv-blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
.cv-skel {
  height: 56px;
  margin-bottom: 18px;
}
.cv-skel-user {
  width: 45%;
  height: 40px;
  margin-left: auto;
}
.cv-skel-short {
  width: 60%;
}

/* ---------- 输入区 ---------- */
.cv-dock {
  position: relative;
  flex: none;
  padding: 8px 20px calc(10px + env(safe-area-inset-bottom));
}
.cv-jump {
  position: absolute;
  left: 50%;
  top: -40px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--qg-border);
  border-radius: 15px;
  background: var(--qg-elev);
  color: var(--qg-text-2);
  font-size: 12px;
  box-shadow: var(--qg-shadow);
  cursor: pointer;
}
.cv-jump:hover {
  color: var(--qg-brand);
}
.cv-composer {
  max-width: 820px;
  margin: 0 auto;
  border: 1px solid var(--qg-border);
  border-radius: var(--qg-radius-lg);
  background: var(--qg-panel);
  box-shadow: var(--qg-shadow-sm);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.cv-composer.focus {
  border-color: var(--qg-brand);
  box-shadow: var(--qg-ring);
}
.cv-composer.dragging {
  border-color: var(--qg-brand);
  border-style: dashed;
  background: var(--qg-brand-soft);
}
.cv-pending {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 10px 0;
}
.cv-pending-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 36px;
  padding: 0 4px 0 4px;
  border: 1px solid var(--qg-border);
  border-radius: var(--qg-radius-sm);
  background: var(--qg-panel-2);
  font-size: 12px;
}
.cv-pending-item.error {
  border-color: var(--qg-danger);
  color: var(--qg-danger);
}
.cv-pending-item.uploading {
  opacity: 0.7;
}
.cv-pending-thumb {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  object-fit: cover;
}
.cv-pending-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv-pending-state {
  flex: none;
  color: var(--qg-faint);
}
.cv-pending-x {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--qg-faint);
  cursor: pointer;
}
.cv-pending-x:hover {
  color: var(--qg-text);
  background: var(--qg-border);
}
.cv-att-ext {
  flex: none;
  min-width: 28px;
  height: 28px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: var(--qg-brand-soft);
  color: var(--qg-brand);
  font-size: 10px;
  font-weight: 700;
}
.cv-att-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: min(78%, 640px);
}
.cv-att-thumb {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: var(--qg-radius);
  border: 1px solid var(--qg-border);
  background: var(--qg-panel-2);
}
.cv-att-card {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 240px;
  padding: 6px 10px 6px 6px;
  border: 1px solid var(--qg-border);
  border-radius: var(--qg-radius);
  background: var(--qg-panel);
}
.cv-att-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.cv-att-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv-att-size {
  font-size: 11px;
  color: var(--qg-faint);
}
.cv-input {
  display: block;
  width: 100%;
  min-height: 48px;
  max-height: 220px;
  padding: 12px 14px 4px;
  border: 0;
  background: transparent;
  color: var(--qg-text);
  font: inherit;
  line-height: 1.6;
  resize: none;
  outline: none;
}
.cv-input::placeholder {
  color: var(--qg-faint);
}
.cv-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 8px;
  flex-wrap: wrap;
}
.cv-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--qg-border);
  border-radius: 14px;
  background: transparent;
  color: var(--qg-text-2);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.cv-chip:hover {
  border-color: var(--qg-border-strong);
  color: var(--qg-text);
}
.cv-chip.on {
  border-color: var(--qg-brand);
  background: var(--qg-brand-soft);
  color: var(--qg-brand);
}
.cv-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv-send,
.cv-stop {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.1s ease;
}
.cv-send {
  background: var(--qg-brand);
  color: var(--qg-brand-ink);
  font-size: 16px;
}
.cv-send:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.cv-send:not(:disabled):active {
  transform: scale(0.94);
}
.cv-stop {
  background: var(--qg-text);
}
.cv-stop-square {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--qg-panel);
}
.cv-hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--qg-faint);
  text-align: center;
}

.cv-mask {
  display: none;
}

/* =====================================================================
   设计报告改造层：底有光（状态极光）、面有材质（玻璃）、有一个「物」（QBot）、会动
   放在响应式规则之前，窄屏规则仍可覆盖
   ===================================================================== */
.cv {
  background: transparent;
}
.cv-convs {
  margin: 0 0 12px 12px;
  border-right: 0;
  border-radius: var(--qg-radius-lg);
  background: var(--qg-glass);
  overflow: hidden;
}
.cv-convs-head {
  padding: 14px 12px 10px;
}
.cv-new {
  height: 40px;
  border: 0;
  border-radius: 999px;
  background: var(--qg-grad);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 10px 22px -10px var(--qg-brand);
  transition:
    transform var(--qg-dur-fast) var(--qg-ease-spring),
    filter var(--qg-dur-base) ease;
}
.cv-new:hover {
  color: #fff;
  background: var(--qg-grad);
  filter: brightness(1.06);
}
.cv-new:active {
  transform: scale(0.96);
}
.cv-search input {
  height: 36px;
  border: 0;
  border-radius: 999px;
  padding-left: 32px;
  background: var(--qg-panel-2);
}
.cv-search input:focus {
  background: var(--qg-panel);
  box-shadow: var(--qg-ring);
}
.cv-group {
  padding: 14px 10px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
}
.cv-conv {
  height: 40px;
  border-radius: 14px;
  transition:
    background var(--qg-dur-base) ease,
    transform var(--qg-dur-fast) var(--qg-ease-spring);
}
.cv-conv:active {
  transform: scale(0.98);
}
.cv-conv.active {
  background: var(--qg-brand-soft);
  color: var(--qg-brand-2);
  font-weight: 600;
}
.cv-folder {
  height: 26px;
  border: 0;
  padding: 0 10px;
  background: var(--qg-panel-2);
}
.cv-folder.active {
  background: var(--qg-grad);
  color: #fff;
}
.cv-folder.active .cv-folder-n {
  color: rgba(255, 255, 255, 0.75);
}

.cv-main {
  overflow: hidden;
  background: transparent;
}
.cv-top {
  position: relative;
  z-index: 1;
  height: 54px;
  border-bottom: 0;
  background: transparent;
}
.cv-model {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--qg-panel);
  box-shadow: var(--qg-shadow-sm);
}
.cv-model:hover {
  background: var(--qg-panel);
  color: var(--qg-brand);
}
.cv-scroll,
.cv-dock {
  position: relative;
  z-index: 1;
}

/* 状态极光：多团模糊光缓慢漂移，颜色随「待机 / 思考 / 回答」切换 */
.cv-aurora {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.cv-aurora i {
  position: absolute;
  aspect-ratio: 1;
  border-radius: 50%;
  filter: blur(70px);
  transition:
    background 1.2s ease,
    opacity 1.2s ease;
  animation: qg-drift 16s ease-in-out infinite alternate;
}
.cv-aurora i:nth-child(1) {
  width: 55%;
  top: -38%;
  left: -14%;
}
.cv-aurora i:nth-child(2) {
  width: 45%;
  bottom: -32%;
  right: -12%;
  animation-delay: -8s;
}
.cv-aurora i:nth-child(3) {
  width: 32%;
  top: 18%;
  right: 22%;
  animation-duration: 21s;
}
.cv-aurora.is-idle i:nth-child(1) {
  background: #8673f2;
  opacity: 0.2;
}
.cv-aurora.is-idle i:nth-child(2) {
  background: #dbf866;
  opacity: 0.2;
}
.cv-aurora.is-idle i:nth-child(3) {
  background: #9fb8ff;
  opacity: 0.1;
}
.cv-aurora.is-thinking i:nth-child(1) {
  background: #6fa8ff;
  opacity: 0.34;
}
.cv-aurora.is-thinking i:nth-child(2) {
  background: #86c3dc;
  opacity: 0.32;
}
.cv-aurora.is-thinking i:nth-child(3) {
  background: #8673f2;
  opacity: 0.22;
}
.cv-aurora.is-answering i:nth-child(1) {
  background: #b5e782;
  opacity: 0.34;
}
.cv-aurora.is-answering i:nth-child(2) {
  background: #dbf866;
  opacity: 0.3;
}
.cv-aurora.is-answering i:nth-child(3) {
  background: #86c3dc;
  opacity: 0.2;
}
html.dark .cv-aurora i {
  filter: blur(80px);
}
html.dark .cv-aurora.is-idle i:nth-child(1) {
  opacity: 0.4;
}
html.dark .cv-aurora.is-idle i:nth-child(2) {
  opacity: 0.12;
}

/* 空状态主视觉：漂浮的角色 + 四角星 + 光晕托底 */
.cv-hero {
  padding-top: 8vh;
}
.cv-hero-stage {
  position: relative;
  width: 170px;
  height: 140px;
  margin: 0 auto 8px;
  display: grid;
  place-items: center;
}
.cv-hero-glow {
  position: absolute;
  inset: 8px 18px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(134, 115, 242, 0.42), transparent);
  filter: blur(6px);
}
.cv-hero-bot {
  animation: qg-float 3.2s ease-in-out infinite;
}
.cv-hero-star {
  position: absolute;
}
.cv-hero-star.s1 {
  top: 6px;
  right: 22px;
}
.cv-hero-star.s2 {
  bottom: 26px;
  left: 18px;
}
.cv-hero-star.s3 {
  top: 30px;
  left: 34px;
}
.cv-hero h1 {
  margin: 0 0 8px;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.01em;
}
.cv-hero p {
  font-size: 15px;
}
/* 色彩编码建议卡：薰衣草 / 浅蓝 / 蜜桃 / 薄荷，标签与 ↗ 按钮同色系 */
.cv-hero-presets {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  max-width: 640px;
  margin: 30px auto 0;
}
.cv-hero-preset {
  --tint: var(--qg-pastel-1);
  --tint-ink: var(--qg-pastel-1-ink);
  position: relative;
  min-height: 116px;
  padding: 14px 18px 16px;
  border: 0;
  border-radius: var(--qg-radius-lg);
  background: var(--tint);
  box-shadow: none;
  gap: 6px;
  transition: transform var(--qg-dur-base) var(--qg-ease-spring);
}
.cv-hero-preset:nth-child(2) {
  --tint: var(--qg-pastel-2);
  --tint-ink: var(--qg-pastel-2-ink);
}
.cv-hero-preset:nth-child(3) {
  --tint: var(--qg-pastel-3);
  --tint-ink: var(--qg-pastel-3-ink);
}
.cv-hero-preset:nth-child(4) {
  --tint: var(--qg-pastel-4);
  --tint-ink: var(--qg-pastel-4-ink);
}
.cv-hero-preset:hover {
  transform: translateY(-3px);
  border: 0;
  box-shadow: none;
}
.cv-hero-preset-tag {
  align-self: flex-start;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 22px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.7);
  color: var(--tint-ink);
}
html.dark .cv-hero-preset-tag {
  background: rgba(255, 255, 255, 0.08);
}
.cv-hero-preset-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--qg-text);
}
.cv-hero-preset-text {
  padding-right: 34px;
  color: var(--qg-text-2);
}
.cv-hero-go {
  position: absolute;
  right: 14px;
  bottom: 14px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--tint-ink);
  color: #fff;
  transition: transform var(--qg-dur-base) var(--qg-ease-spring);
}
.cv-hero-preset:hover .cv-hero-go {
  transform: rotate(45deg) scale(1.08);
}

/* 消息 */
.cv-bubble {
  padding: 12px 16px;
  border-radius: 22px 22px 6px 22px;
  line-height: 1.7;
}
.cv-think {
  margin-bottom: 12px;
  padding: 10px 14px;
  border-left: 0;
  border-radius: var(--qg-radius);
  background: var(--qg-brand-soft);
}
.cv-think summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--qg-brand-2);
}
.cv-typing {
  align-items: center;
}
.cv-typing i {
  background: var(--qg-brand);
}
.cv-typing span {
  margin-left: 8px;
  font-size: 12px;
  color: var(--qg-sub);
}
.cv-act {
  border-radius: 10px;
}
.cv-act:hover:not(:disabled) {
  background: var(--qg-brand-soft);
  color: var(--qg-brand);
}
.cv-notice {
  border-radius: 12px;
}
.cv-notice.warn {
  background: var(--qg-accent-soft);
  color: #c97a06;
}

/* 输入区：超大玻璃胶囊（+ / 输入 / 麦克风 / 圆形主按钮） */
.cv-dock {
  padding: 6px 20px calc(14px + env(safe-area-inset-bottom));
}
.cv-composer {
  max-width: 820px;
  border: 0;
  border-radius: 28px;
  background: var(--qg-glass);
  box-shadow:
    inset 0 1px 12px rgba(255, 255, 255, 0.55),
    var(--qg-shadow-float);
}
.cv-composer.focus {
  border-color: transparent;
  box-shadow:
    inset 0 1px 12px rgba(255, 255, 255, 0.55),
    var(--qg-shadow-float),
    var(--qg-ring);
}
.cv-composer.dragging {
  border: 0;
  background: var(--qg-brand-soft);
  box-shadow: 0 0 0 2px var(--qg-brand), var(--qg-shadow-float);
}
.cv-pending {
  padding: 12px 14px 0;
}
.cv-pending-item {
  border: 0;
  border-radius: 12px;
  background: var(--qg-panel-2);
}
.cv-inputrow {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 8px 8px 8px 10px;
}
.cv-plus,
.cv-mic {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--qg-panel-2);
  color: var(--qg-text-2);
  font-size: 18px;
  cursor: pointer;
  transition:
    background var(--qg-dur-base) ease,
    color var(--qg-dur-base) ease,
    transform var(--qg-dur-fast) var(--qg-ease-spring);
}
.cv-mic {
  background: transparent;
}
.cv-plus:hover,
.cv-mic:hover {
  background: var(--qg-brand-soft);
  color: var(--qg-brand);
}
.cv-plus:active,
.cv-mic:active {
  transform: scale(0.9);
}
.cv-mic.on {
  background: rgba(255, 44, 89, 0.12);
  color: var(--qg-danger);
  animation: cv-pulse 1.2s ease-in-out infinite;
}
.cv-input {
  flex: 1;
  min-height: 40px;
  padding: 9px 4px;
  font-size: 15px;
}
.cv-send,
.cv-stop {
  width: 44px;
  height: 44px;
}
.cv-send {
  background: var(--qg-grad);
  color: #fff;
  font-size: 18px;
  box-shadow: 0 10px 22px -10px var(--qg-brand);
}
.cv-send:not(:disabled):hover {
  filter: brightness(1.06);
}
.cv-tools {
  max-width: 820px;
  margin: 0 auto;
  padding: 10px 6px 0;
}
.cv-chip {
  height: 30px;
  border: 0;
  padding: 0 12px;
  background: var(--qg-panel);
  box-shadow: var(--qg-shadow-sm);
  transition:
    transform var(--qg-dur-fast) var(--qg-ease-spring),
    background var(--qg-dur-base) ease;
}
.cv-chip:hover {
  color: var(--qg-brand);
}
.cv-chip:active {
  transform: scale(0.94);
}
.cv-chip.on {
  border: 0;
  background: var(--qg-lime);
  color: var(--qg-lime-ink);
}
.cv-hint {
  margin: 0;
  font-size: 11px;
}
.cv-jump {
  border: 0;
  background: var(--qg-panel);
  box-shadow: var(--qg-shadow-float);
  height: 34px;
  padding: 0 14px;
}

@keyframes cv-pulse {
  50% {
    box-shadow: 0 0 0 6px rgba(255, 44, 89, 0.12);
  }
}

/* ---------- 窄屏 ---------- */
@media (max-width: 1100px) {
  .cv,
  .cv-immersive {
    grid-template-columns: minmax(0, 1fr);
  }
  .cv-convs {
    position: fixed;
    z-index: 2001;
    inset: 10px auto 10px 10px;
    margin: 0;
    width: min(300px, 84vw);
    transform: translateX(calc(-100% - 24px));
    transition: transform var(--qg-dur-slow) var(--qg-ease-out);
    box-shadow: var(--qg-shadow-lg);
  }
  .cv-immersive .cv-convs {
    display: flex;
  }
  .cv-convs.open {
    transform: none;
  }
  .cv-mask {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.4);
  }
  .cv-only-narrow {
    display: inline-grid;
  }
  .cv-conv-ops,
  .cv-actions {
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .cv-thread {
    padding: 16px 12px 8px;
  }
  .cv-hero {
    padding-top: 6vh;
  }
  .cv-hero-presets {
    grid-template-columns: 1fr 1fr;
  }
  .cv-bubble {
    max-width: 88%;
  }
  .cv-dock {
    padding: 6px 8px calc(8px + env(safe-area-inset-bottom));
  }
  .cv-chip {
    max-width: 120px;
  }
  .cv-hint {
    display: none;
  }
  .cv-model {
    max-width: 160px;
  }
}
</style>
