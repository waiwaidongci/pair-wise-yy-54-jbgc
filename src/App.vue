<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useSchemeStore } from './store/scheme'

const route = useRoute()
const router = useRouter()
const store = useSchemeStore()
const nav = [
  { name: 'overview', label: '方案总览' },
  { name: 'map', label: '地图与阶段' },
  { name: 'review', label: '多单位会签' },
]
</script>

<template>
  <a-layout class="shell">
    <a-layout-sider :width="224" class="sider">
      <div class="brand"><b>路</b><div><strong>封路协调台</strong><small>ROAD CONTROL</small></div></div>
      <a-menu :selected-keys="[route.name]" class="menu" @menu-item-click="(key: string) => router.push({ name: key })">
        <a-menu-item v-for="item in nav" :key="item.name">{{ item.label }}</a-menu-item>
      </a-menu>
      <div class="project-card"><span></span><div><b>{{ store.scheme.project }}</b><small>当前 v{{ store.scheme.version }} · {{ store.versions.length }} 个版本 · 4 家单位会签</small></div></div>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="topbar">
        <div><b>{{ store.scheme.id }}</b><span>{{ store.scheme.area }} · 2026 年第四季度施工计划</span></div>
        <div class="top-actions"><a-tag v-if="store.held.length" color="red" @click="router.push('/review')" style="cursor:pointer">冲突保留 {{ store.held.length }}</a-tag><a-tag color="green">协同在线 11</a-tag><a-button :disabled="!store.dirty" @click="store.undo">撤销修改</a-button><a-button type="primary" @click="router.push('/review')">发起阶段审批</a-button></div>
      </a-layout-header>
      <a-layout-content class="main"><router-view /></a-layout-content>
    </a-layout>
  </a-layout>
</template>
