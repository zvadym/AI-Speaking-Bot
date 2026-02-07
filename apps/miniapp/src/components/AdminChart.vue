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

    <div class="chart">
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

        <g v-if="days.length">
          <text :x="padL" :y="height - 6" class="xLabel" text-anchor="start">
            {{ days[0] }}
          </text>
          <text :x="width - padR" :y="height - 6" class="xLabel" text-anchor="end">
            {{ days[days.length - 1] }}
          </text>
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
              class="bar"
            />
          </template>
        </g>

        <g v-else>
          <polyline
            v-for="line in lines"
            :key="line.key"
            :points="line.points"
            :stroke="line.color"
            class="line"
            fill="none"
          />
        </g>

        <g v-if="kind !== 'bar' && pointDots.length">
          <circle
            v-for="pt in pointDots"
            :key="pt.key"
            :cx="pt.x"
            :cy="pt.y"
            :r="2.5"
            :fill="pt.color"
            class="dotPoint"
          />
        </g>

        <g v-if="!days.length" class="empty">
          <text :x="width / 2" :y="height / 2" text-anchor="middle">No data</text>
        </g>
      </svg>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  kind: { type: String, default: 'bar' }, // 'bar' | 'line'
  data: { type: Array, default: () => [] },
  series: {
    type: Array,
    default: () => [
      { key: 'count', label: 'Count', color: 'rgba(199, 90, 36, 0.85)' }
    ]
  }
});

const width = 680;
const height = 210;
const padL = 48;
const padR = 18;
const padT = 18;
const padB = 34;

const days = computed(() => props.data.map((r) => r.day));

function formatCompact(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1_000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
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
  if (!yMax.value) return height - padB;
  const innerH = height - padT - padB;
  const t = v / yMax.value;
  return padT + (1 - t) * innerH;
}

const barRects = computed(() => {
  const n = props.data.length;
  if (!n) return [];
  const innerW = width - padL - padR;
  const step = innerW / n;
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

    bars.push({ key: row.day || String(i), segments });
  }
  return bars;
});

const lines = computed(() => {
  const n = props.data.length;
  if (!n) return [];
  const innerW = width - padL - padR;
  const step = n === 1 ? 0 : innerW / (n - 1);
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
  const innerW = width - padL - padR;
  const step = n === 1 ? 0 : innerW / (n - 1);
  const dots = [];
  for (const s of props.series) {
    for (let i = 0; i < n; i += 1) {
      const row = props.data[i] || {};
      const x = padL + i * step;
      const y = yForValue(row?.[s.key] || 0);
      dots.push({ key: `${s.key}-${i}`, x, y, color: s.color });
    }
  }
  return dots;
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
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(246, 241, 232, 0.5);
}

svg {
  display: block;
  width: 100%;
  height: auto;
}

.axis {
  stroke: rgba(30, 26, 22, 0.18);
  stroke-width: 1;
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

.line {
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 10px 18px rgba(30, 26, 22, 0.12));
}

.dotPoint {
  opacity: 0.9;
}

.empty {
  fill: rgba(30, 26, 22, 0.5);
  font-size: 12px;
}
</style>

