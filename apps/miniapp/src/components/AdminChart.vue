<template>
  <section class="card">
    <header class="head">
      <div>
        <div class="title">{{ title }}</div>
        <div v-if="subtitle" class="sub">{{ subtitle }}</div>
      </div>
      <div class="legend" v-if="series.length > 1">
        <div class="legend-item" v-for="s in series" :key="s.key">
          <span class="dot" :style="{ background: s.color }" />
          <span class="label">{{ s.label }}</span>
        </div>
      </div>
    </header>

    <div
      ref="wrapEl"
      class="chart"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @click="onClick"
    >
      <div class="clip">
        <svg
          :viewBox="`0 0 ${width} ${height}`"
          :width="width"
          :height="height"
          role="img"
          :aria-label="title"
        >
          <g>
            <line :x1="padL" :y1="padT" :x2="padL" :y2="height - padB" class="axis" />
            <line
              :x1="padL"
              :y1="height - padB"
              :x2="width - padR"
              :y2="height - padB"
              class="axis"
            />
          </g>

          <g v-if="yMax > 0">
            <text :x="padL - 8" :y="padT + 4" class="yLabel" text-anchor="end">
              {{ formatCompact(yMax) }}
            </text>
            <text :x="padL - 8" :y="height - padB + 4" class="yLabel" text-anchor="end">0</text>
          </g>

          <g v-if="days.length && xLabels !== 'all'">
            <text :x="padL" :y="height - 6" class="xLabel" text-anchor="start">
              {{ formatXLabel(days[0]) }}
            </text>
            <text :x="width - padR" :y="height - 6" class="xLabel" text-anchor="end">
              {{ formatXLabel(days[days.length - 1]) }}
            </text>
          </g>

          <g v-else-if="days.length && xLabels === 'all'">
            <text
              v-for="tick in xTicks"
              :key="tick.key"
              :x="tick.x"
              :y="xLabelY"
              class="xLabel"
              text-anchor="middle"
              :transform="xLabelTransform(tick.x, xLabelY)"
            >
              {{ tick.label }}
            </text>
          </g>

          <g v-if="isHoverActive">
            <line :x1="hoverX" :y1="padT" :x2="hoverX" :y2="height - padB" class="guide" />
          </g>

          <g v-if="kind === 'bar'">
            <template v-for="bar in barRects" :key="bar.key">
              <rect
                v-for="seg in bar.segments"
                :key="seg.key"
                :x="seg.x"
                :y="seg.y"
                :width="seg.w"
                :height="seg.h"
                :fill="seg.color"
                :class="[
                  'bar',
                  { hovered: isHoverActive && hover.index === bar.i, dimmed: isHoverActive && hover.index !== bar.i }
                ]"
              />
            </template>
          </g>

          <g v-else>
            <polyline
              v-for="line in lines"
              :key="line.key"
              :points="line.points"
              :stroke="line.color"
              :class="['line', { dimmed: isHoverActive && hover.index !== -1 }]"
              fill="none"
            />
          </g>

          <g v-if="kind !== 'bar' && pointDots.length">
            <circle
              v-for="pt in pointDots"
              :key="pt.key"
              :cx="pt.x"
              :cy="pt.y"
              :r="pt.i === hover.index ? 4 : 2.5"
              :fill="pt.color"
              :class="['dotPoint', { dimmed: isHoverActive && pt.i !== hover.index }]"
            />
          </g>

          <g v-if="!days.length" class="empty">
            <text :x="width / 2" :y="height / 2" text-anchor="middle">No data</text>
          </g>
        </svg>
      </div>

      <div v-if="tooltip && isHoverActive && tooltipPayload" class="tooltip" :style="tooltipStyle">
        <div class="tooltip-title">{{ tooltipPayload.title }}</div>
        <div v-if="tooltipPayload.total !== null" class="tooltip-total">
          Total: <strong>{{ formatNumber(tooltipPayload.total) }}</strong>
        </div>
        <div class="tooltip-rows">
          <div v-for="row in tooltipPayload.rows" :key="row.key" class="tooltip-row">
            <span class="tooltip-dot" :style="{ background: row.color }" />
            <span class="tooltip-label">{{ row.label }}</span>
            <span class="tooltip-value">{{ formatNumber(row.value) }}</span>
          </div>
        </div>
        <div class="tooltip-hint" v-if="hover.locked">Tap to unpin</div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  kind: { type: String, default: 'bar' }, // 'bar' | 'line'
  data: { type: Array, default: () => [] },
  xLabels: { type: String, default: 'ends' }, // 'ends' | 'all'
  tooltip: { type: Boolean, default: true },
  series: {
    type: Array,
    default: () => [
      { key: 'count', label: 'Count', color: 'rgba(199, 90, 36, 0.85)' }
    ]
  }
});

const width = 680;
const padL = 48;
const padR = 18;
const padT = 18;

function isIsoDateLabel(label) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(label || ''));
}

function formatXLabel(label) {
  const s = String(label || '');
  if (isIsoDateLabel(s)) return s.slice(5); // MM-DD
  return s;
}

const xLabelAngle = computed(() => {
  if (props.xLabels !== 'all') return 0;
  const first = props.data?.[0]?.day;
  if (isIsoDateLabel(first)) return -55;
  const s = String(first || '');
  if (s.length >= 5 && props.data.length >= 10) return -45;
  return 0;
});

const padB = computed(() => {
  if (props.xLabels !== 'all') return 34;
  return xLabelAngle.value ? 76 : 46;
});

const height = computed(() => 210 + (padB.value - 34));

const days = computed(() => props.data.map((r) => r.day));

function formatCompact(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1_000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

const numFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
function formatNumber(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '—';
  return numFmt.format(v);
}

const yMax = computed(() => {
  let max = 0;
  for (const row of props.data) {
    if (props.kind === 'bar' && props.series.length > 1) {
      const sum = props.series.reduce((acc, s) => acc + Number(row?.[s.key] || 0), 0);
      if (sum > max) max = sum;
      continue;
    }
    for (const s of props.series) {
      const v = Number(row?.[s.key] || 0);
      if (v > max) max = v;
    }
  }
  return max;
});

function yForValue(value) {
  const v = Math.max(0, Number(value || 0));
  if (!yMax.value) return height.value - padB.value;
  const innerH = height.value - padT - padB.value;
  const t = v / yMax.value;
  return padT + (1 - t) * innerH;
}

function innerW() {
  return width - padL - padR;
}

function xForIndex(i) {
  const n = props.data.length;
  if (!n) return padL;
  if (props.kind === 'bar') {
    const step = innerW() / n;
    return padL + i * step + step / 2;
  }
  if (n === 1) return padL;
  const step = innerW() / (n - 1);
  return padL + i * step;
}

const xLabelY = computed(() => height.value - 8);
function xLabelTransform(x, y) {
  if (!xLabelAngle.value) return undefined;
  return `rotate(${xLabelAngle.value} ${x} ${y})`;
}

const xTicks = computed(() => {
  const n = props.data.length;
  if (!n) return [];
  const ticks = [];
  for (let i = 0; i < n; i += 1) {
    const row = props.data[i] || {};
    ticks.push({
      key: `${row.day || 'x'}-${i}`,
      i,
      x: xForIndex(i),
      label: formatXLabel(row.day)
    });
  }
  return ticks;
});

const barRects = computed(() => {
  const n = props.data.length;
  if (!n) return [];
  const step = innerW() / n;
  const barW = Math.max(2, step * 0.72);
  const bars = [];
  for (let i = 0; i < n; i += 1) {
    const row = props.data[i] || {};
    const x = padL + i * step + (step - barW) / 2;

    const segments = [];
    let acc = 0;
    for (const s of props.series) {
      const v = Math.max(0, Number(row?.[s.key] || 0));
      const yTop = yForValue(acc + v);
      const yBottom = yForValue(acc);
      const h = Math.max(0, yBottom - yTop);
      if (h > 0.5) {
        segments.push({
          key: `${row.day}-${s.key}`,
          x,
          y: yTop,
          w: barW,
          h,
          color: s.color
        });
      }
      acc += v;
    }

    bars.push({ key: row.day || String(i), i, segments });
  }
  return bars;
});

const lines = computed(() => {
  const n = props.data.length;
  if (!n) return [];
  const step = n === 1 ? 0 : innerW() / (n - 1);
  const out = [];
  for (const s of props.series) {
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const row = props.data[i] || {};
      const x = padL + i * step;
      const y = yForValue(row?.[s.key] || 0);
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    out.push({ key: s.key, color: s.color, points: pts.join(' ') });
  }
  return out;
});

const pointDots = computed(() => {
  if (props.kind !== 'line') return [];
  const n = props.data.length;
  if (!n) return [];
  const step = n === 1 ? 0 : innerW() / (n - 1);
  const dots = [];
  for (const s of props.series) {
    for (let i = 0; i < n; i += 1) {
      const row = props.data[i] || {};
      const x = padL + i * step;
      const y = yForValue(row?.[s.key] || 0);
      dots.push({ key: `${s.key}-${i}`, i, x, y, color: s.color });
    }
  }
  return dots;
});

const wrapEl = ref(null);
const hover = reactive({
  index: -1,
  px: 0,
  py: 0,
  locked: false,
  rectW: 0,
  rectH: 0
});

const isHoverActive = computed(() => props.tooltip && hover.index >= 0 && hover.index < props.data.length);
const hoverX = computed(() => xForIndex(hover.index));

function pickIndexFromPointer(event) {
  const el = wrapEl.value;
  if (!el) return { index: -1 };
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return { index: -1 };
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const xSvg = (px / rect.width) * width;

  const n = props.data.length;
  if (!n) return { index: -1 };

  let idx = 0;
  if (props.kind === 'bar') {
    const step = innerW() / n;
    idx = Math.floor((xSvg - padL) / step);
  } else {
    if (n === 1) idx = 0;
    else {
      const step = innerW() / (n - 1);
      idx = Math.round((xSvg - padL) / step);
    }
  }

  idx = Math.max(0, Math.min(n - 1, idx));
  return { index: idx, px, py, rectW: rect.width, rectH: rect.height };
}

function onPointerMove(event) {
  if (hover.locked) return;
  const picked = pickIndexFromPointer(event);
  if (picked.index === -1) return;
  hover.index = picked.index;
  hover.px = picked.px;
  hover.py = picked.py;
  hover.rectW = picked.rectW;
  hover.rectH = picked.rectH;
}

function onPointerLeave() {
  if (hover.locked) return;
  hover.index = -1;
}

function onClick(event) {
  if (!props.tooltip) return;
  if (hover.locked) {
    hover.locked = false;
    hover.index = -1;
    return;
  }
  const picked = pickIndexFromPointer(event);
  if (picked.index === -1) return;
  hover.index = picked.index;
  hover.px = picked.px;
  hover.py = picked.py;
  hover.rectW = picked.rectW;
  hover.rectH = picked.rectH;
  hover.locked = true;
}

const tooltipPayload = computed(() => {
  if (!isHoverActive.value) return null;
  const row = props.data[hover.index] || {};
  const rows = props.series.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    value: Number(row?.[s.key] ?? 0)
  }));
  const isStacked = props.kind === 'bar' && props.series.length > 1;
  const total = isStacked ? rows.reduce((acc, r) => acc + (Number.isFinite(r.value) ? r.value : 0), 0) : null;
  return {
    title: String(row.day ?? ''),
    rows,
    total
  };
});

const tooltipStyle = computed(() => {
  const w = hover.rectW || 0;
  const h = hover.rectH || 0;
  const px = hover.px || 0;
  const py = hover.py || 0;
  const offset = 12;
  const pad = 10;

  const preferRight = px > w * 0.66;
  const left = Math.max(pad, Math.min(w - pad, preferRight ? px - offset : px + offset));
  const top = Math.max(pad, Math.min(h - pad, py - offset));

  const transform = preferRight ? 'translate(-100%, -100%)' : 'translate(0, -100%)';
  return { left: `${left}px`, top: `${top}px`, transform };
});
</script>

<style scoped>
.card {
  border: 1px solid var(--stroke);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 18px 40px var(--shadow);
  padding: 14px 14px 10px;
  display: grid;
  gap: 10px;
  align-self: start;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.title {
  font-weight: 750;
  letter-spacing: -0.01em;
}

.sub {
  margin-top: 3px;
  color: var(--muted);
  font-size: 12px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  box-shadow: 0 8px 16px rgba(30, 26, 22, 0.18);
}

.chart {
  position: relative;
  user-select: none;
}

.clip {
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(246, 241, 232, 0.5);
}

svg {
  display: block;
  width: 100%;
  height: auto;
  touch-action: pan-y;
}

.axis {
  stroke: rgba(30, 26, 22, 0.18);
  stroke-width: 1;
}

.guide {
  stroke: rgba(30, 26, 22, 0.18);
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.yLabel,
.xLabel {
  fill: rgba(30, 26, 22, 0.55);
  font-size: 11px;
  font-family: var(--font-body);
}

.bar {
  opacity: 0.92;
}

.bar.hovered {
  opacity: 1;
  filter: drop-shadow(0 10px 18px rgba(30, 26, 22, 0.12));
}

.bar.dimmed {
  opacity: 0.45;
}

.line {
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 10px 18px rgba(30, 26, 22, 0.12));
}

.line.dimmed {
  opacity: 0.5;
}

.dotPoint {
  opacity: 0.9;
}

.dotPoint.dimmed {
  opacity: 0.35;
}

.tooltip {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  min-width: 170px;
  max-width: 260px;
  padding: 10px 10px 9px;
  border-radius: 12px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 40px rgba(20, 18, 16, 0.18);
  backdrop-filter: blur(8px);
}

.tooltip-title {
  font-weight: 760;
  letter-spacing: -0.01em;
  font-size: 12px;
  margin-bottom: 6px;
}

.tooltip-total {
  font-size: 12px;
  color: rgba(30, 26, 22, 0.75);
  margin-bottom: 6px;
}

.tooltip-rows {
  display: grid;
  gap: 6px;
}

.tooltip-row {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(30, 26, 22, 0.82);
}

.tooltip-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  box-shadow: 0 8px 16px rgba(30, 26, 22, 0.12);
}

.tooltip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tooltip-value {
  font-variant-numeric: tabular-nums;
}

.tooltip-hint {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(30, 26, 22, 0.55);
}

.empty {
  fill: rgba(30, 26, 22, 0.5);
  font-size: 12px;
}
</style>
