<script setup lang="ts">
defineProps<{
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <div class="auth-shell">
    <div class="auth-frame">
      <aside class="auth-rail">
        <div class="rail-brand">
          <span class="rail-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <div>
            <strong>智学</strong>
            <span>EduPi</span>
          </div>
        </div>

        <div class="rail-body">
          <h1>把今天的学习，<br />落在纸面上。</h1>
          <p class="rail-copy">教材、题目、错题和掌握度都在同一个学习台里，登录后接着上次的进度继续。</p>

          <dl class="rail-list">
            <div>
              <dt>资料问答</dt>
              <dd>基于教材回答，并标注引用来源</dd>
            </div>
            <div>
              <dt>引导解题</dt>
              <dd>先启发思路，再展开步骤</dd>
            </div>
            <div>
              <dt>错题复盘</dt>
              <dd>按遗忘曲线安排复习，更新掌握度</dd>
            </div>
          </dl>
        </div>

        <p class="rail-foot">数据保存在本机 · 登录后继续你的学习记录</p>
      </aside>

      <main class="auth-main">
        <section class="auth-card">
          <header class="auth-head">
            <h2>{{ title }}</h2>
            <p>{{ subtitle }}</p>
          </header>
          <slot />
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.auth-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background-color: var(--paper);
  background-image:
    linear-gradient(rgba(21, 32, 43, 0.034) 1px, transparent 1px),
    linear-gradient(90deg, rgba(21, 32, 43, 0.034) 1px, transparent 1px);
  background-size: 32px 32px;
  background-position: -1px -1px;
}

.auth-frame {
  width: min(1040px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--white);
  box-shadow: 0 28px 80px rgba(21, 32, 43, 0.12);
}

.auth-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 38px 40px 30px;
  overflow: hidden;
  background: var(--rail);
  color: #fff;
}

.auth-rail::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 28px 28px;
}

.rail-brand,
.rail-body,
.rail-foot {
  position: relative;
}

.rail-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rail-mark {
  width: 38px;
  height: 38px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 9px;
  flex: none;
}

.rail-mark i {
  background: rgba(255, 255, 255, 0.78);
  border-radius: 1px;
}

.rail-mark i:nth-child(2) {
  background: #7f9cff;
}

.rail-brand strong {
  display: block;
  font-family: var(--font-serif);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.12em;
  line-height: 1.2;
}

.rail-brand span:not(.rail-mark) {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  letter-spacing: 0.18em;
  color: rgba(255, 255, 255, 0.42);
}

.rail-body {
  margin-top: auto;
  padding: 42px 0 34px;
}

.rail-body h1 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 34px;
  font-weight: 600;
  line-height: 1.42;
  letter-spacing: 0.03em;
}

.rail-copy {
  max-width: 30em;
  margin: 18px 0 0;
  font-size: 13px;
  line-height: 1.85;
  color: rgba(255, 255, 255, 0.62);
}

.rail-list {
  margin: 30px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.rail-list > div {
  display: grid;
  grid-template-columns: 82px 1fr;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.rail-list dt {
  font-size: 12.5px;
  color: #fff;
}

.rail-list dd {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.48);
}

.rail-foot {
  margin: 0;
  padding-top: 18px;
  font-size: 11px;
  letter-spacing: 0.03em;
  color: rgba(255, 255, 255, 0.36);
}

.auth-main {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 54px 56px;
  background: #fff;
}

.auth-card {
  width: min(360px, 100%);
}

.auth-head {
  margin-bottom: 26px;
}

.auth-head h2 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--ink);
}

.auth-head p {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--muted);
}

@media (max-width: 820px) {
  .auth-shell {
    padding: 18px;
  }

  .auth-frame {
    grid-template-columns: 1fr;
  }

  .auth-rail {
    padding: 24px 26px 22px;
  }

  .rail-body {
    margin-top: 0;
    padding: 26px 0 10px;
  }

  .rail-body h1 {
    font-size: 26px;
  }

  .rail-copy,
  .rail-list {
    display: none;
  }

  .rail-foot {
    padding-top: 10px;
  }

  .auth-main {
    padding: 34px 26px 38px;
  }
}
</style>
