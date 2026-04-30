import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
  type Plugin,
} from 'chart.js';
import type { ChartPayload } from '../../lib/dqa/types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// Plugin to draw value labels above bars
const valueLabelPlugin: Plugin<'bar'> = {
  id: 'valueLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const datasets = chart.data.datasets;
    if (!datasets?.length) return;
    ctx.save();
    ctx.font = 'bold 11px IBM Plex Sans, system-ui, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let di = 0; di < datasets.length; di++) {
      const meta = chart.getDatasetMeta(di);
      if (!meta?.data) continue;
      meta.data.forEach((el, idx) => {
        const v = datasets[di].data?.[idx];
        if (v === null || v === undefined) return;
        const val = typeof v === 'number' ? v : parseFloat(String(v));
        if (isNaN(val)) return;
        const pos = el.tooltipPosition(false);
        if (pos.x === null || pos.y === null) return;
        ctx.fillText(String(val), pos.x as number, (pos.y as number) - 4);
      });
    }
    ctx.restore();
  },
};

interface Props {
  payload: ChartPayload;
  canvasId: string;
}

export function KpiChart({ payload, canvasId }: Props) {
  if (!payload.labels.length) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data available
      </div>
    );
  }

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
    },
    layout: {
      padding: { top: 20 },
    },
    scales: {
      x: {
        ticks: {
          font: { size: 11 },
          maxRotation: 40,
          minRotation: 0,
          callback(val) {
            const label = String(this.getLabelForValue(Number(val)));
            return label.length > 12 ? label.slice(0, 11) + '…' : label;
          },
        },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { precision: 0, font: { size: 11 } },
      },
    },
  };

  const data = {
    labels: payload.labels,
    datasets: [
      {
        label: '',
        data: payload.values,
        backgroundColor: payload.color,
        borderRadius: 4,
        borderWidth: 0,
      },
    ],
  };

  return (
    <Bar
      id={canvasId}
      data={data}
      options={options}
      plugins={[valueLabelPlugin]}
    />
  );
}
