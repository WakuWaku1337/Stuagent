<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AuthLayout from '../components/AuthLayout.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const form = reactive({
  username: '',
  password: '',
  confirm: '',
  displayName: '',
  phone: '',
  email: '',
});
const submitting = ref(false);
const message = ref('');

async function submit(): Promise<void> {
  message.value = '';
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(form.username.trim())) {
    message.value = '用户名需为 3–32 位字母、数字、下划线或中划线';
    return;
  }
  if (form.password.length < 6) {
    message.value = '密码至少 6 位';
    return;
  }
  if (form.password !== form.confirm) {
    message.value = '两次输入的密码不一致';
    return;
  }
  submitting.value = true;
  const ok = await auth.register({
    username: form.username.trim(),
    password: form.password,
    displayName: form.displayName.trim() || undefined,
    phone: form.phone.trim() || undefined,
    email: form.email.trim() || undefined,
  });
  submitting.value = false;
  if (!ok) {
    message.value = auth.error;
    return;
  }
  router.replace('/');
}
</script>

<template>
  <AuthLayout title="注册账号" subtitle="手机号和邮箱仅作联系方式，不发送验证码。">
    <el-alert
      v-if="auth.enabled && !auth.initialized"
      class="auth-alert"
      type="warning"
      :closable="false"
      show-icon
      title="实例尚未初始化"
      description="请先在服务器运行 npm run auth:bootstrap 创建第一个管理员。"
    />
    <el-alert
      v-else-if="!auth.registrationOpen"
      class="auth-alert"
      type="info"
      :closable="false"
      show-icon
      title="当前未开放注册"
      description="请联系管理员创建账号。"
    />

    <form v-else class="auth-form" @submit.prevent="submit">
      <label class="field-label" for="reg-username">用户名</label>
      <el-input
        id="reg-username"
        v-model="form.username"
        size="large"
        autocomplete="username"
        placeholder="3–32 位字母、数字、下划线或中划线"
        :disabled="submitting"
      />

      <label class="field-label" for="reg-password">密码</label>
      <el-input
        id="reg-password"
        v-model="form.password"
        size="large"
        type="password"
        show-password
        autocomplete="new-password"
        placeholder="至少 6 位"
        :disabled="submitting"
      />

      <label class="field-label" for="reg-confirm">确认密码</label>
      <el-input
        id="reg-confirm"
        v-model="form.confirm"
        size="large"
        type="password"
        show-password
        autocomplete="new-password"
        placeholder="再次输入密码"
        :disabled="submitting"
      />

      <div class="auth-grid">
        <div>
          <label class="field-label" for="reg-display">显示名（可选）</label>
          <el-input id="reg-display" v-model="form.displayName" size="large" placeholder="怎么称呼你" :disabled="submitting" />
        </div>
        <div>
          <label class="field-label" for="reg-phone">手机号（可选）</label>
          <el-input id="reg-phone" v-model="form.phone" size="large" placeholder="仅作联系方式" :disabled="submitting" />
        </div>
      </div>

      <label class="field-label" for="reg-email">邮箱（可选）</label>
      <el-input
        id="reg-email"
        v-model="form.email"
        size="large"
        autocomplete="email"
        placeholder="仅作联系方式，不验证"
        :disabled="submitting"
      />

      <p v-if="message" class="auth-error">{{ message }}</p>

      <el-button class="auth-submit" type="primary" size="large" native-type="submit" :loading="submitting">
        注册并登录
      </el-button>
    </form>

    <div class="auth-links">
      <router-link to="/login">已有账号，去登录</router-link>
      <router-link to="/privacy">隐私政策</router-link>
      <router-link to="/terms">用户协议</router-link>
      <router-link to="/">返回首页</router-link>
    </div>
  </AuthLayout>
</template>
