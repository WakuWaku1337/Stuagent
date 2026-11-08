<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '../components/AuthLayout.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const form = reactive({ username: '', password: '' });
const submitting = ref(false);
const message = ref('');

function redirectTarget(): string {
  const raw = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

async function submit(): Promise<void> {
  message.value = '';
  if (!form.username.trim() || !form.password) {
    message.value = '请输入用户名和密码';
    return;
  }
  submitting.value = true;
  const ok = await auth.login(form.username.trim(), form.password);
  submitting.value = false;
  if (!ok) {
    message.value = auth.error;
    return;
  }
  router.replace(auth.user?.must_change_password ? '/account' : redirectTarget());
}
</script>

<template>
  <AuthLayout title="登录" subtitle="登录后继续你的学习记录。">
    <el-alert
      v-if="auth.enabled && !auth.initialized"
      class="auth-alert"
      type="warning"
      :closable="false"
      show-icon
      title="实例尚未初始化"
      description="请先在服务器运行 npm run auth:bootstrap 创建第一个管理员。"
    />

    <form class="auth-form" @submit.prevent="submit">
      <label class="field-label" for="login-username">用户名</label>
      <el-input
        id="login-username"
        v-model="form.username"
        size="large"
        autocomplete="username"
        placeholder="请输入用户名"
        :disabled="submitting"
      />

      <label class="field-label" for="login-password">密码</label>
      <el-input
        id="login-password"
        v-model="form.password"
        size="large"
        type="password"
        show-password
        autocomplete="current-password"
        placeholder="请输入密码"
        :disabled="submitting"
        @keyup.enter="submit"
      />

      <p v-if="message" class="auth-error">{{ message }}</p>

      <el-button class="auth-submit" type="primary" size="large" native-type="submit" :loading="submitting">
        登录
      </el-button>
    </form>

    <div class="auth-links">
      <router-link v-if="auth.registrationOpen" to="/register">注册账号</router-link>
      <span v-else>当前未开放注册</span>
      <router-link to="/">返回首页</router-link>
    </div>
  </AuthLayout>
</template>
