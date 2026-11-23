<script setup>
import { QBtn, QSpinner } from 'quasar'
import { CircleHelp, Download, FolderOpen, House, Layers3, Plus, Scissors, ShieldCheck } from '@lucide/vue'
import BrandMark from '../components/BrandMark.vue'
import ProjectCard from '../components/ProjectCard.vue'
import heroPhoto from '../assets/ambiente.jpg'

defineProps({ projects: Array, loading: Boolean, offline: String, installable: Boolean })
defineEmits(['new', 'open', 'delete', 'help', 'install', 'duplicate', 'rename', 'library'])

function showProjects(event) {
  event.preventDefault()
  document.getElementById('montagens').scrollIntoView({ block: 'start', behavior: 'smooth' })
  document.getElementById('montagens').focus({ preventScroll: true })
}
</script>

<template>
  <div class="home-shell">
    <aside class="sidebar">
      <BrandMark />
      <nav aria-label="Área de trabalho">
        <span class="nav-label">ÁREA DE TRABALHO</span>
        <a class="nav-item current" href="#" aria-current="page"><House :size="19" /> Início</a>
        <a class="nav-item" href="#montagens" @click="showProjects"><FolderOpen :size="19" /> Minhas montagens</a>
        <button class="nav-item" type="button" @click="$emit('library')"><Scissors :size="19" /> Meus Recortes</button>
        <button class="nav-item" type="button" @click="$emit('help')"><CircleHelp :size="19" /> Como funciona</button>
      </nav>
      <div class="sidebar-footer"><ShieldCheck :size="19" /><div><strong>Privado por padrão</strong><span>Suas fotos ficam neste dispositivo.</span></div></div>
    </aside>

    <div class="home-workspace">
      <header class="topbar">
        <span class="desktop-top"><House :size="16" /> Início</span>
        <div class="mobile-brand"><BrandMark /></div>
        <div class="top-actions">
          <QBtn v-if="installable" no-caps unelevated class="btn btn-outline install-button" aria-label="Instalar aplicativo" @click="$emit('install')">
            <Download :size="17" /> <span>Instalar aplicativo</span>
          </QBtn>
          <button class="offline-indicator" type="button" @click="$emit('help')">
            <span :class="{ ready: offline === 'ready' }"></span>{{ offline === 'ready' ? 'Offline pronto' : offline === 'checking' ? 'Preparando offline' : 'Uso local' }}
          </button>
        </div>
      </header>
      <main class="home-main">
        <div class="page-intro">
          <h1>Editor de Ambientes</h1>
          <p>Combine móveis e objetos nas suas próprias fotos.</p>
          <QBtn no-caps unelevated class="btn btn-outline mobile-library" @click="$emit('library')"><Scissors :size="17" /> Meus Recortes</QBtn>
        </div>

        <section class="home-hero" aria-labelledby="hero-title">
          <div class="hero-content">
            <h2 id="hero-title">Crie uma montagem</h2>
            <p>Comece com uma foto do ambiente, recorte os objetos que deseja inserir e ajuste cada detalhe da composição.</p>
            <div class="hero-actions">
              <QBtn no-caps unelevated class="btn btn-light" @click="$emit('new')"><Plus :size="20" /> Nova montagem</QBtn>
              <a class="btn hero-secondary" href="#montagens" @click="showProjects"><FolderOpen :size="18" /> Abrir montagem salva</a>
            </div>
          </div>
          <div class="hero-image"><img :src="heroPhoto" alt="" fetchpriority="high"></div>
        </section>

        <section id="montagens" class="projects-section" tabindex="-1" aria-labelledby="projects-title">
          <div class="section-heading">
            <div><h2 id="projects-title">Minhas montagens</h2><p>Projetos salvos neste dispositivo.</p></div>
            <span class="project-count">{{ projects.length }} {{ projects.length === 1 ? 'projeto' : 'projetos' }}</span>
          </div>
          <div v-if="loading" class="empty-projects" role="status"><QSpinner size="26px" /> Carregando montagens…</div>
          <div v-else-if="projects.length" class="project-grid">
            <ProjectCard v-for="project in projects" :key="project.id" :project
              @open="$emit('open', project.id)" @delete="$emit('delete', project)"
              @duplicate="$emit('duplicate', project.id)" @rename="$emit('rename', project)" />
          </div>
          <div v-else class="empty-projects">
            <div class="empty-symbol"><Layers3 :size="24" /></div>
            <strong>Nenhuma montagem por aqui</strong>
            <p>Seus projetos aparecem aqui depois que você os salva.</p>
            <QBtn no-caps flat class="btn btn-text" @click="$emit('new')"><Plus :size="17" /> Criar primeira montagem</QBtn>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
