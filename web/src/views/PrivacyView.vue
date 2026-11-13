<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <main class="legal-page">
    <article class="legal-card">
      <button class="legal-back" type="button" @click="router.back()">返回</button>
      <h1>隐私政策</h1>
      <!-- TODO(Q6)：正文、生效日期、备案号与联系方式由运营方提供 -->
      <p class="legal-updated">生效日期：待补充</p>
      <p>
        本页为隐私政策占位页。正式内容尚未提供，上线前必须由运营方补齐并完成法务确认。
      </p>
      <h2>我们收集哪些信息</h2>
      <p>待补充：账号信息、学习资料、对话与用量数据的收集范围与用途。</p>
      <h2>信息如何存储与使用</h2>
      <p>待补充：本地优先存储策略、云端模型调用的数据外发范围与保留期限。</p>
      <h2>你的权利</h2>
      <p>待补充：查询、导出、更正与删除个人信息的路径。</p>
      <p class="legal-todo">TODO(Q6)：正文与联系方式待提供，本页已登记为上线阻断项。</p>
    </article>
  </main>
</template>

<style scoped>
.legal-page {
  min-height: 100vh;
  padding: 48px 20px;
  background: var(--paper, #f6f4ef);
}

.legal-card {
  max-width: 760px;
  margin: 0 auto;
  padding: 40px 44px;
  border: 1px solid var(--line, #e2ded4);
  border-radius: 14px;
  background: #fff;
  color: var(--ink, #2b2a26);
  line-height: 1.9;
}

.legal-back {
  margin-bottom: 20px;
  padding: 6px 12px;
  border: 1px solid var(--line, #e2ded4);
  border-radius: 8px;
  background: transparent;
  color: var(--muted, #77736a);
  cursor: pointer;
}

.legal-card h1 {
  font-family: var(--font-serif, serif);
  font-size: 26px;
  letter-spacing: 0.04em;
}

.legal-card h2 {
  margin-top: 22px;
  font-size: 15px;
  font-weight: 600;
}

.legal-updated {
  margin: 6px 0 18px;
  color: var(--faint, #9a958b);
  font-size: 12px;
}

.legal-todo {
  margin-top: 26px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fdf6e7;
  color: #8a6a1f;
  font-size: 12px;
}

@media (max-width: 640px) {
  .legal-card {
    padding: 26px 20px;
  }
}
</style>
