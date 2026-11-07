import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import ChatView from '../views/ChatView.vue';
import DocumentsView from '../views/DocumentsView.vue';
import QuizView from '../views/QuizView.vue';
import WrongbookView from '../views/WrongbookView.vue';
import MasteryView from '../views/MasteryView.vue';
import ExamView from '../views/ExamView.vue';
import TasksView from '../views/TasksView.vue';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/chat', name: 'chat', component: ChatView },
    { path: '/documents', name: 'documents', component: DocumentsView },
    { path: '/quiz', name: 'quiz', component: QuizView },
    { path: '/wrongbook', name: 'wrongbook', component: WrongbookView },
    { path: '/mastery', name: 'mastery', component: MasteryView },
    { path: '/exam', name: 'exam', component: ExamView },
    { path: '/tasks', name: 'tasks', component: TasksView },
  ],
});