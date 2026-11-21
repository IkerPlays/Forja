// Publica /forja-config.json con la URL y la clave PÚBLICA de Supabase para que la app de la 3DS
// no necesite config.txt. (Ambos valores ya están en el JavaScript público de la web.)
import { mkdirSync, writeFileSync } from 'node:fs'

const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
const anon = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
mkdirSync('public', { recursive: true })
if (url && anon && !anon.startsWith('sb_secret_')) {
  writeFileSync('public/forja-config.json', JSON.stringify({ url, anon }) + '\n')
  console.log('forja-config.json generado')
} else {
  console.log('forja-config.json omitido (faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY o la clave no es pública)')
}
