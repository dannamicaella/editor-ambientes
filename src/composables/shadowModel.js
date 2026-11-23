import { clamp } from '../utils/geometry.js'

export const AUTO_SHADOW = Object.freeze({
  enabled: true, opacity: 22, blur: 5, x: 0, y: 3, color: '#18221d', contact: 32,
})

const LEGACY_SHADOW = { ...AUTO_SHADOW, opacity: 40, blur: 4.5, y: 3.8, color: '#121910', contact: 0 }

export function shadowSettings(value) {
  if (value === true) return { ...LEGACY_SHADOW }
  if (!value || typeof value !== 'object') return { ...AUTO_SHADOW, enabled: false }
  const number = (key, min, max) => Number.isFinite(value[key]) ? clamp(value[key], min, max) : AUTO_SHADOW[key]
  return {
    enabled: Boolean(value.enabled),
    opacity: number('opacity', 0, 100),
    blur: number('blur', 0, 18),
    x: number('x', -25, 25),
    y: number('y', -25, 25),
    color: typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color.toLowerCase() : AUTO_SHADOW.color,
    contact: number('contact', 0, 100),
  }
}