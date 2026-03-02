<template>
  <section class="card">
    <header class="head">
      <div>
        <div class="title">{{ title }}</div>
        <div v-if="subtitle" class="sub">{{ subtitle }}</div>
      </div>
    </header>

    <div ref="surfaceEl" class="chart">
      <div class="clip" :style="{ height: `${chartHeight}px` }">
        <canvas
          v-if="hasData"
          ref="canvasEl"
          class="canvas"
          role="img"
          :aria-label="title"
        />
        <div v-else class="empty" role="img" :aria-label="title">
          <span>No data</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
} from 'chart.js';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
);

const BASE_WIDTH = 680;
const PAD_L = 48;
const PAD_R = 18;

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  kind: { type: String, default: 'bar' },
  data: { type: Array, default: () => [] },
  xLabels: { type: String, default: 'ends' },
  tooltip: { type: Boolean, default: true },
  series: {
    type: Array,
    default: () => [{ key: 'count', label: 'Count', color: 'rgba(199, 90, 36, 0.85)' }]
  }
});

const canvasEl = ref(null);
const surfaceEl = ref(null);
const chartInstance = ref(null);
const chartWidth = ref(BASE_WIDTH);

let resizeObserver = null;

const labels = computed(() => props.data.map((row) => String(row?.day ?? '')));
const hasData = computed(() => labels.value.length > 0);
const isStacked = computed(() => props.kind === 'bar' && props.series.length > 1);
const usesRightAxis = computed(() => props.series.some((series) => series?.yAxisId === 'y1'));

function safeNum(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function isIsoDateLabel(label) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(label || ''));
}

function formatXLabel(label) {
  const s = String(label || '');
  if (isIsoDateLabel(s)) return s.slice(5);
  return s;
}

function formatCompact(n) {
  const v = safeNum(n);
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

function chartFontFamily() {
  if (typeof window === 'undefined') return 'Chivo, system-ui, sans-serif';
  const value = window.getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim();
  return value || 'Chivo, system-ui, sans-serif';
}

function innerWidth() {
  return Math.max(120, chartWidth.value - PAD_L - PAD_R);
}

const xLabelAngle = computed(() => {
  if (props.xLabels !== 'all') return 0;
  const n = props.data.length;
  if (n <= 1) return 0;
  const maxLen = props.data.reduce((acc, row) => {
    const label = formatXLabel(row?.day);
    return Math.max(acc, String(label || '').length);
  }, 0);
  const approxLabelWidth = maxLen * 6.2 + 6;
  const stepPx = props.kind === 'bar' ? innerWidth() / n : innerWidth() / Math.max(1, n - 1);
  if (approxLabelWidth <= stepPx * 0.92) return 0;
  if (approxLabelWidth <= stepPx * 1.8) return -38;
  return -55;
});

const padBottom = computed(() => {
  if (props.xLabels !== 'all') return 34;
  if (xLabelAngle.value <= -50) return 92;
  if (xLabelAngle.value < 0) return 80;
  return 46;
});

const chartHeight = computed(() => 210 + (padBottom.value - 34));

function tickLabelForIndex(index) {
  const count = labels.value.length;
  if (!count) return '';
  if (props.xLabels === 'ends') {
    if (index !== 0 && index !== count - 1) return '';
    return formatXLabel(labels.value[index]);
  }

  return formatXLabel(labels.value[index]);
}

function seriesType(series) {
  const type = String(series?.type || props.kind).toLowerCase();
  return type === 'line' ? 'line' : 'bar';
}

function buildDatasets() {
  return props.series.map((series) => {
    const values = props.data.map((row) => Math.max(0, safeNum(row?.[series.key])));
    const type = seriesType(series);
    const yAxisId = series?.yAxisId === 'y1' ? 'y1' : 'y';

    if (type === 'line') {
      return {
        type: 'line',
        label: series.label,
        data: values,
        borderColor: series.color,
        backgroundColor: series.color,
        pointBackgroundColor: series.color,
        pointBorderColor: series.color,
        pointBorderWidth: 0,
        pointRadius: 2.5,
        pointHoverRadius: props.tooltip ? 4 : 2.5,
        pointHitRadius: 12,
        borderWidth: 2.25,
        tension: 0.18,
        fill: false,
        yAxisId
      };
    }

    return {
      type: 'bar',
      label: series.label,
      data: values,
      backgroundColor: series.color,
      borderColor: series.color,
      borderWidth: 0,
      borderRadius: isStacked.value ? 0 : 8,
      borderSkipped: false,
      barPercentage: 0.72,
      categoryPercentage: 0.84,
      maxBarThickness: 36,
      hoverBackgroundColor: series.color,
      stack: isStacked.value ? 'total' : undefined,
      yAxisId
    };
  });
}

function tooltipLabel(context) {
  const parsed = typeof context.parsed === 'object' ? context.parsed?.y : context.parsed;
  return `${context.dataset.label}: ${formatNumber(parsed)}`;
}

function buildOptions() {
  const rotation = Math.abs(xLabelAngle.value);
  const fontFamily = chartFontFamily();
  const scales = {
    x: {
      stacked: isStacked.value,
      grid: {
        display: false,
        drawBorder: false
      },
      border: {
        color: 'rgba(30, 26, 22, 0.18)'
      },
      ticks: {
        autoSkip: false,
        color: 'rgba(30, 26, 22, 0.55)',
        font: {
          family: fontFamily,
          size: 11
        },
        maxRotation: rotation,
        minRotation: rotation,
        callback(value, index) {
          return tickLabelForIndex(index);
        }
      }
    },
    y: {
      beginAtZero: true,
      stacked: isStacked.value,
      grid: {
        color: 'rgba(30, 26, 22, 0.08)',
        drawBorder: false
      },
      border: {
        color: 'rgba(30, 26, 22, 0.18)'
      },
      ticks: {
        color: 'rgba(30, 26, 22, 0.55)',
        font: {
          family: fontFamily,
          size: 11
        },
        padding: 8,
        callback(value) {
          return formatCompact(value);
        }
      }
    }
  };

  if (usesRightAxis.value) {
    scales.y1 = {
      beginAtZero: true,
      position: 'right',
      grid: {
        drawOnChartArea: false,
        drawBorder: false
      },
      border: {
        color: 'rgba(30, 26, 22, 0.18)'
      },
      ticks: {
        color: 'rgba(30, 26, 22, 0.55)',
        font: {
          family: fontFamily,
          size: 11
        },
        padding: 8,
        callback(value) {
          return formatCompact(value);
        }
      }
    };
  }

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 220
    },
    events: props.tooltip ? undefined : [],
    interaction: props.tooltip
      ? {
          mode: 'index',
          intersect: false
        }
      : undefined,
    layout: {
      padding: {
        left: 6,
        right: 8,
        top: 10,
        bottom: 8
      }
    },
    plugins: {
      legend: {
        display: props.series.length > 1,
        position: 'top',
        align: 'start',
        labels: {
          color: 'rgba(30, 26, 22, 0.72)',
          usePointStyle: true,
          pointStyle: 'rect',
          boxWidth: 10,
          boxHeight: 10,
          padding: 14,
          font: {
            family: fontFamily,
            size: 12,
            weight: '600'
          }
        }
      },
      tooltip: {
        enabled: props.tooltip,
        callbacks: {
          title(items) {
            return String(items[0]?.label ?? '');
          },
          label: tooltipLabel,
          footer(items) {
            if (!isStacked.value || !items.length) return '';
            const total = items.reduce((sum, item) => {
              const value = typeof item.parsed === 'object' ? item.parsed?.y : item.parsed;
              return sum + safeNum(value);
            }, 0);
            return `Total: ${formatNumber(total)}`;
          }
        },
        backgroundColor: 'rgba(255, 255, 255, 0.94)',
        borderColor: 'rgba(30, 26, 22, 0.10)',
        borderWidth: 1,
        titleColor: 'rgba(30, 26, 22, 0.92)',
        bodyColor: 'rgba(30, 26, 22, 0.82)',
        footerColor: 'rgba(30, 26, 22, 0.74)',
        titleFont: {
          family: fontFamily,
          size: 12,
          weight: '700'
        },
        bodyFont: {
          family: fontFamily,
          size: 12
        },
        footerFont: {
          family: fontFamily,
          size: 12,
          weight: '600'
        },
        padding: 10,
        displayColors: true,
        boxPadding: 6
      }
    },
    scales
  };
}

function buildConfig() {
  return {
    type: props.kind,
    data: {
      labels: labels.value,
      datasets: buildDatasets()
    },
    options: buildOptions()
  };
}

function destroyChart() {
  if (!chartInstance.value) return;
  chartInstance.value.destroy();
  chartInstance.value = null;
}

function createChart() {
  if (!hasData.value || !canvasEl.value) return;
  const ctx = canvasEl.value.getContext('2d');
  if (!ctx) return;
  chartInstance.value = new Chart(ctx, buildConfig());
}

async function syncChart() {
  await nextTick();

  if (!hasData.value) {
    destroyChart();
    return;
  }

  if (!chartInstance.value || chartInstance.value.config.type !== props.kind) {
    destroyChart();
    createChart();
    return;
  }

  const config = buildConfig();
  chartInstance.value.data = config.data;
  chartInstance.value.options = config.options;
  chartInstance.value.update();
}

function updateChartWidth() {
  const width = surfaceEl.value?.clientWidth;
  chartWidth.value = width && width > 0 ? width : BASE_WIDTH;
}

onMounted(async () => {
  updateChartWidth();

  if (typeof ResizeObserver !== 'undefined' && surfaceEl.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect?.width;
      if (!nextWidth) return;
      chartWidth.value = nextWidth;
    });
    resizeObserver.observe(surfaceEl.value);
  }

  await syncChart();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  destroyChart();
});

watch(
  [
    () => props.kind,
    () => props.title,
    () => props.tooltip,
    () => props.xLabels,
    () => props.data,
    () => props.series,
    chartWidth
  ],
  () => {
    syncChart();
  },
  { deep: true }
);
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
  gap: 8px;
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

.chart {
  position: relative;
  user-select: none;
}

.clip {
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(246, 241, 232, 0.5);
  position: relative;
}

.canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: pan-y;
}

.empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: rgba(30, 26, 22, 0.5);
  font-size: 12px;
  font-family: var(--font-body);
}
</style>
