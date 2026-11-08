import { createRouter, createWebHistory } from 'vue-router';

const HomeView = () => import('../views/HomeView.vue');
const PlanView = () => import('../views/PlanView.vue');
const ChatView = () => import('../views/ChatView.vue');
const DocumentsView = () => import('../views/DocumentsView.vue');
const QuizView = () => import('../views/QuizView.vue');
const WrongbookView = () => import('../views/WrongbookView.vue');
const MasteryView = () => import('../views/MasteryView.vue');
const ExamView = () => import('../views/ExamView.vue');
const TasksView = () => import('../views/TasksView.vue');
const ReviewView = () => import('../views/ReviewView.vue');
const SettingsView = () => import('../views/SettingsView.vue');
const UsageView = () => import('../views/UsageView.vue');
const StorageView = () => import('../views/StorageView.vue');
const McpView = () => import('../views/McpView.vue');
const VisualizeView = () => import('../views/VisualizeView.vue');

export default createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { title: '学习台', subtitle: '掌握度、待复习与资料状态，一屏看清' },
    },
    {
      path: '/chat',
      name: 'chat',
      component: ChatView,
      meta: { title: '智学对话', subtitle: '主讲老师随问随答，回答附带教材引用' },
    },
    {
      path: '/plan',
      name: 'plan',
      component: PlanView,
      meta: { title: '学习计划', subtitle: '按目标与薄弱点拆解每日任务，逐项完成' },
    },
    {
      path: '/documents',
      name: 'documents',
      component: DocumentsView,
      meta: { title: '资料库', subtitle: '上传教材与笔记，构建本地知识库' },
    },
    {
      path: '/quiz',
      name: 'quiz',
      component: QuizView,
      meta: { title: '智能出题', subtitle: '按知识点生成练习，作答后即时判分' },
    },
    {
      path: '/wrongbook',
      name: 'wrongbook',
      component: WrongbookView,
      meta: { title: '错题本', subtitle: '按遗忘曲线安排复习，逐个消除盲点' },
    },
    {
      path: '/mastery',
      name: 'mastery',
      component: MasteryView,
      meta: { title: '掌握度', subtitle: 'BKT 知识追踪给出的知识点掌握概率' },
    },
    {
      path: '/exam',
      name: 'exam',
      component: ExamView,
      meta: { title: '模拟考试', subtitle: '从题库随机组卷，限时作答并统计失分' },
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: TasksView,
      meta: { title: '后台任务', subtitle: '长任务入队执行，进度通过 WebSocket 推送' },
    },
    {
      path: '/review',
      name: 'review',
      component: ReviewView,
      meta: { title: '考试复盘', subtitle: '整卷识别、逐题失分分析与趋势对比' },
    },
    {
      path: '/courseware',
      redirect: (to) => ({ path: '/visualize', query: to.query }),
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
      meta: { title: '模型设置', subtitle: 'Provider、密钥、思考强度与生成参数' },
    },
    {
      path: '/usage',
      name: 'usage',
      component: UsageView,
      meta: { title: '用量统计', subtitle: 'Token、成本、成功率与延迟趋势' },
    },
    {
      path: '/storage',
      name: 'storage',
      component: StorageView,
      meta: { title: '存储治理', subtitle: '图片与资料占用、配额告警与孤儿文件回收' },
    },
    {
      path: '/mcp',
      name: 'mcp',
      component: McpView,
      meta: { title: 'MCP 扩展', subtitle: '接入本地或远程 MCP，发现并授权工具' },
    },
    {
      path: '/visualize',
      name: 'visualize',
      component: VisualizeView,
      meta: { title: '统一可视化', subtitle: '按题目内容本地解析建模，不调用对话模型生成图形' },
    },
  ],
});
