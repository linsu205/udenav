<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { get, patch, del } from '../api';
import { useStore } from '../store';
import { ElMessage, ElMessageBox } from 'element-plus';
import ModalShell from './ModalShell.vue';
import AvatarCropper from './AvatarCropper.vue';
import { Edit, Delete, Refresh, Lock, User, Camera, InfoFilled } from '@element-plus/icons-vue';

interface U {
  id: number; username: string; role: string;
  avatar: string;
  failed_login: number; locked: boolean; lock_until: number;
  created_at: number; self: boolean;
}

const store = useStore();
const users = ref<U[]>([]);
const loading = ref(false);
const onlySelf = computed(() => users.value.length <= 1);

async function load() {
  loading.value = true;
  try {
    const r = await get<any>('/api/admin/users');
    users.value = r.users || [];
  } catch (e: any) {
    /* 401 已由全局处理退回登录页，这里不再叠加提示 */
    if (e?.status !== 401) ElMessage.error(e?.message || '读取账号失败');
  } finally {
    loading.value = false;
  }
}
/* 从侧栏账号卡点进来时，把自己那一行闪一下，指明「要改的就是这里」 */
const flashSelf = ref(false);
let flashTimer = 0;
function flash() {
  if (!users.value.some(u => u.self)) return;
  flashSelf.value = false;
  clearTimeout(flashTimer);
  // 先清空再加回，保证连点也能重新触发一次动画
  flashTimer = window.setTimeout(() => {
    flashSelf.value = true;
    flashTimer = window.setTimeout(() => { flashSelf.value = false; }, 1800);
  }, 40);
}

watch(() => store.usersHit, flash);

onMounted(async () => {
  await load();
  if (store.usersHit) flash();
});

function fmtDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/* ---------------- 编辑弹窗 ---------------- */
const open = ref(false);
const saving = ref(false);
const target = ref<U | null>(null);
const f = reactive({ username: '', password: '', confirm: '', unlock: false, avatar: '' });

/* 裁切器：选完文件先读成 dataURL，交给 AvatarCropper 裁成圆形 256×256 */
const cropSrc = ref('');
const avatarInput = ref<HTMLInputElement | null>(null);

function pickAvatarFile() { avatarInput.value?.click(); }

function onAvatarPicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';   // 清空，选同一张也能再次触发 change
  if (!file) return;
  if (!/^image\//.test(file.type)) return ElMessage.error('请选择图片文件');
  if (file.size > 8 * 1024 * 1024) return ElMessage.error('图片不能超过 8 MB，请先压缩');
  const fr = new FileReader();
  fr.onload = () => { cropSrc.value = String(fr.result || ''); };
  fr.onerror = () => ElMessage.error('图片读取失败，请换一张');
  fr.readAsDataURL(file);
}

function onCropped(url: string) {
  f.avatar = url;
  cropSrc.value = '';
}

function edit(u: U) {
  target.value = u;
  f.username = u.username;
  f.password = '';
  f.confirm = '';
  f.unlock = false;
  f.avatar = u.avatar || '';
  open.value = true;
}

const pwdErr = computed(() => {
  if (!f.password) return '';
  if (f.password.length < 4) return '密码至少 4 位';
  if (f.confirm && f.confirm !== f.password) return '两次输入不一致';
  return '';
});

/* 无头像时用首字母占位；用户名清空的瞬间显示「?」而不是空白圆 */
const initial = computed(() => (f.username || '').trim().charAt(0).toUpperCase() || '?');

const canSave = computed(() => {
  if (!f.username.trim()) return false;
  if (f.password && (f.password.length < 4 || f.confirm !== f.password)) return false;
  return true;
});

async function save() {
  const u = target.value;
  if (!u) return;
  const name = f.username.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) {
    ElMessage.error('用户名只能是 3-20 位字母 / 数字 / 下划线');
    return;
  }
  if (f.password && f.password.length < 4) {
    ElMessage.error('密码至少 4 位');
    return;
  }
  if (f.password && f.password !== f.confirm) {
    ElMessage.error('两次输入的密码不一致');
    return;
  }

  const body: any = {};
  if (name !== u.username) body.username = name;
  if (f.password) body.password = f.password;
  if (f.unlock) body.unlock = true;
  if (f.avatar !== (u.avatar || '')) body.avatar = f.avatar;   // 空串 = 清除头像
  if (!Object.keys(body).length) { open.value = false; return; }

  saving.value = true;
  try {
    const r = await patch<any>('/api/admin/users/' + u.id, body);
    open.value = false;
    /* 改的是自己：侧栏用户名 / 头像来自 store.user，得重新拉一次（后端已补发新 cookie） */
    if (u.self && (r.renamed || r.avatar_changed)) await store.checkLogin();
    await load();
    const parts: string[] = [];
    if (r.renamed) parts.push('用户名已更新');
    if (r.password_changed) parts.push('密码已更新');
    if (r.avatar_changed) parts.push(f.avatar ? '头像已更新' : '头像已清除');
    if (f.unlock) parts.push('已解除锁定');
    ElMessage.success(parts.length ? parts.join('，') : '没有改动');
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(u: U) {
  try {
    await ElMessageBox.confirm(`删除账号「${u.username}」？该账号将无法再登录。`, '确认删除', { type: 'warning', lockScroll: false });
  } catch { return; }
  try {
    await del('/api/admin/users/' + u.id);
    await load();
    ElMessage.success('已删除');
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败');
  }
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>用户管理</h2>
        <div class="sub">修改登录账号的头像、用户名与密码</div>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">账号列表</div>

      <div v-for="u in users" :key="u.id" class="u-row" :class="{ flash: flashSelf && u.self }">
        <div class="u-avatar">
          <img v-if="u.avatar" :src="u.avatar" alt="" />
          <template v-else>{{ u.username.charAt(0).toUpperCase() }}</template>
        </div>

        <div class="u-info">
          <div class="u-name">
            {{ u.username }}
            <span v-if="u.self" class="u-badge me">当前登录</span>
            <span v-if="u.locked" class="u-badge lock">
              <el-icon><Lock /></el-icon> 已锁定
            </span>
          </div>
          <div class="u-meta">
            创建于 {{ fmtDate(u.created_at) }}
            <template v-if="u.failed_login"> · 失败 {{ u.failed_login }} 次</template>
          </div>
        </div>

        <div class="u-ops">
          <el-button link size="small" :icon="Edit" title="修改用户名 / 密码" @click="edit(u)" />
          <el-button v-if="!u.self && !onlySelf" link size="small" type="danger" :icon="Delete"
                     title="删除账号" @click="remove(u)" />
        </div>
      </div>

      <el-empty v-if="!loading && !users.length" description="还没有账号，刷新页面会进入首次注册" />

      <div class="u-note">
        <el-icon><User /></el-icon>
        <span>
          本项目是单用户导航：所有账号共用同一套分组与卡片，这里只负责登录凭据。
          密码在数据库里只保存哈希，无法还原，忘了只能用命令行重置（<code>npm run passwd</code>）。
        </span>
      </div>
    </div>

    <!-- 弹窗统一走 ModalShell：不锁 body 滚动，滚动条不会消失、页面不抖 -->
    <ModalShell v-if="open" title="修改账号" width="520px" @close="open = false">
      <div class="acc">
        <!-- 头像：整块是按钮，点圆头像也能换（hover 出相机遮罩） -->
        <div class="av-field">
          <button type="button" class="av-box" :title="f.avatar ? '点击更换头像' : '点击上传头像'"
                  @click="pickAvatarFile">
            <img v-if="f.avatar" :src="f.avatar" alt="" />
            <span v-else class="av-ini">{{ initial }}</span>
            <span class="av-mask"><el-icon><Camera /></el-icon></span>
          </button>
          <div class="av-side">
            <div class="av-name">
              <span class="av-uname">{{ f.username || '未命名账号' }}</span>
              <span v-if="target?.self" class="av-badge">当前登录</span>
            </div>
            <div class="av-tip">可拖动、缩放裁成圆形，保存后生效</div>
            <div class="av-btns">
              <el-button size="small" :icon="Camera" @click="pickAvatarFile">上传头像</el-button>
              <el-button v-if="f.avatar" size="small" text type="danger" @click="f.avatar = ''">移除</el-button>
            </div>
          </div>
        </div>
        <input ref="avatarInput" type="file" accept="image/*" class="av-file" @change="onAvatarPicked" />

        <div class="fld">
          <div class="fld-h">
            <span class="fld-lb">用户名</span>
            <span class="fld-note">3-20 位字母 / 数字 / 下划线</span>
          </div>
          <el-input v-model="f.username" maxlength="20" placeholder="登录用户名" aria-label="用户名" />
        </div>

        <div class="pwd">
          <div class="fld-h">
            <span class="fld-lb">修改密码</span>
            <span class="fld-note">留空则不修改</span>
          </div>
          <div class="pwd-grid">
            <label class="pwd-col">
              <span>新密码</span>
              <el-input v-model="f.password" type="password" show-password autocomplete="new-password"
                        placeholder="至少 4 位" aria-label="新密码" />
            </label>
            <label class="pwd-col">
              <span>确认新密码</span>
              <el-input v-model="f.confirm" type="password" show-password autocomplete="new-password"
                        placeholder="再输入一次" aria-label="确认新密码" :disabled="!f.password" />
            </label>
          </div>
          <div v-if="pwdErr" class="pwd-err">{{ pwdErr }}</div>
        </div>

        <el-checkbox v-if="target && (target.locked || target.failed_login > 0)" v-model="f.unlock" class="unlock">
          解除登录锁定（清零失败次数）
        </el-checkbox>

        <div class="acc-tip">
          <el-icon><InfoFilled /></el-icon>
          <span>改密码不会让当前已登录的浏览器掉线，下次登录用新密码。</span>
        </div>
      </div>

      <template #footer>
        <el-button @click="open = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!canSave" class="save-btn" @click="save">保存</el-button>
      </template>
    </ModalShell>

    <!-- 裁切头像：选完文件后打开，确认后把裁好的 dataURL 回填到 f.avatar -->
    <AvatarCropper v-if="cropSrc" :src="cropSrc" @close="cropSrc = ''" @done="onCropped" />
  </div>
</template>

<style scoped>
  .u-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; margin-bottom: 8px;
    background: var(--sp-card-in); border: 1px solid transparent;
    border-radius: 10px; transition: background .15s, border-color .15s;
  }
  .u-row:last-of-type { margin-bottom: 0; }
  .u-row:hover { background: var(--sp-hover); border-color: var(--sp-card-border); }
  /* 从侧栏账号卡进来时，自己那一行短暂描边，提示改动入口 */
  .u-row.flash {
    border-color: rgba(var(--sp-accent-rgb), .55);
    background: rgba(var(--sp-accent-rgb), .07);
    box-shadow: 0 0 0 3px rgba(var(--sp-accent-rgb), .12);
    animation: rowFlash 1.8s ease-out;
  }
  @keyframes rowFlash {
    0% { box-shadow: 0 0 0 6px rgba(var(--sp-accent-rgb), .22); }
    100% { box-shadow: 0 0 0 3px rgba(var(--sp-accent-rgb), .12); }
  }

  .u-avatar {
    flex: 0 0 36px; width: 36px; height: 36px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 700; color: #fff;
    background: linear-gradient(135deg, #66b1ff, #337ecc);
    overflow: hidden;   /* 自定义头像裁成圆 */
  }
  .u-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .u-info { flex: 1; min-width: 0; }
  .u-name {
    display: flex; align-items: center; gap: 8px;
    font-size: 13.5px; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .u-meta { font-size: 12px; color: var(--sp-faint); margin-top: 2px; }

  .u-badge {
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 20px; flex: none;
  }
  .u-badge.me { color: var(--sp-accent); background: rgba(var(--sp-accent-rgb), .12); border: 1px solid rgba(var(--sp-accent-rgb), .28); }
  .u-badge.lock { color: #e6a23c; background: rgba(230, 162, 60, .12); border: 1px solid rgba(230, 162, 60, .3); }

  .u-ops { display: flex; gap: 2px; flex: none; }
  .u-ops .el-button { padding: 5px; height: auto; }
  .u-ops :deep(.el-icon) { font-size: 15px; }

  .u-note {
    display: flex; align-items: flex-start; gap: 7px;
    margin-top: 16px; padding-top: 14px;
    border-top: 1px solid var(--sp-card-border);
    font-size: 12px; line-height: 1.7; color: var(--sp-dim);
  }
  .u-note .el-icon { margin-top: 3px; flex: none; }
  .u-note code {
    font-family: ui-monospace, Consolas, monospace; font-size: 11.5px;
    background: var(--sp-chip-bg); padding: 1px 5px; border-radius: 4px;
  }

  /* ---- 修改账号弹窗 ---- */
  .acc { display: flex; flex-direction: column; gap: 14px; padding-top: 2px; }

  .av-field { display: flex; align-items: center; gap: 16px; }
  .av-box {
    position: relative; flex: 0 0 66px; width: 66px; height: 66px; padding: 0;
    border: 0; border-radius: 50%; overflow: hidden; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; font-weight: 700; color: #fff;
    background: linear-gradient(135deg, #7cc0ff, #337ecc);
    box-shadow: 0 0 0 1px var(--sp-border), 0 3px 10px rgba(0, 0, 0, .12);
  }
  .av-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .av-ini { line-height: 1; }
  /* hover 出相机遮罩，暗示「点头像也能换」 */
  .av-mask {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 18px; background: rgba(0, 0, 0, .44);
    opacity: 0; transition: opacity .16s;
  }
  .av-box:hover .av-mask, .av-box:focus-visible .av-mask { opacity: 1; }
  .av-box:focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 3px; }

  .av-side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .av-name { display: flex; align-items: center; gap: 8px; }
  .av-uname {
    font-size: 15px; font-weight: 600; color: var(--sp-text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .av-badge {
    flex: none; font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 20px;
    color: var(--sp-accent); background: rgba(var(--sp-accent-rgb), .12);
    border: 1px solid rgba(var(--sp-accent-rgb), .26);
  }
  .av-tip { font-size: 12px; line-height: 1.55; color: var(--sp-faint); }
  .av-btns { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .av-btns :deep(.el-button) { margin-left: 0; }
  .av-file { display: none; }

  /* 字段：标题 + 右侧说明，比 el-form-item 的默认间距紧凑一档 */
  .fld-h { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
  .fld-lb { font-size: 13px; font-weight: 600; color: var(--sp-text); }
  .fld-note { font-size: 12px; color: var(--sp-faint); }
  .acc :deep(.el-input__wrapper) { min-height: 36px; border-radius: 9px; }
  .acc :deep(.el-input__inner) { font-size: 13.5px; }

  /* 密码区：上方一条细线分组，两个输入并排，省掉两行 label */
  .pwd { border-top: 1px solid var(--sp-border); padding-top: 14px; }
  .pwd .fld-h { margin-bottom: 10px; }
  .pwd-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .pwd-col { display: flex; flex-direction: column; gap: 6px; }
  .pwd-col > span { font-size: 11.5px; color: var(--sp-dim); }
  .pwd-err { margin-top: 6px; font-size: 12px; color: var(--sp-danger-text); }

  .unlock { height: auto; }
  .acc :deep(.el-checkbox__label) { font-size: 12.5px; }

  /* 说明条：跟着主题的 alert 色组走，深浅底都够对比 */
  .acc-tip {
    display: flex; align-items: flex-start; gap: 7px;
    padding: 9px 11px; border-radius: 9px;
    font-size: 12px; line-height: 1.65; color: var(--sp-alert-text);
    background: var(--sp-alert-bg); border: 1px solid var(--sp-alert-border);
  }
  .acc-tip .el-icon { margin-top: 2px; flex: none; color: var(--sp-accent); }
  /* 深色底上 alert 的 8% 太淡，提示条会跟弹窗底糊成一片 */
  html.dark .acc-tip {
    background: rgba(var(--sp-accent-rgb), .12);
    border-color: rgba(var(--sp-accent-rgb), .26);
  }

  .save-btn { min-width: 84px; }

  @media (max-width: 540px) {
    .pwd-grid { grid-template-columns: 1fr; }
    .av-field { gap: 12px; }
  }
</style>
