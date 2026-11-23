import { createApp } from 'vue'
import { Quasar } from 'quasar'
import lang from 'quasar/lang/pt-BR'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/instrument-serif/latin-400.css'
import 'quasar/dist/quasar.css'
import './css/app.css'
import App from './App.vue'

createApp(App).use(Quasar, { lang }).mount('#app')