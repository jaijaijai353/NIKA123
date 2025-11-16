import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  TrendingUp,
  AlertTriangle,
  Users,
  BarChart3,
  PieChart as PieChartIcon,
  Sparkles,
  Undo2,
  Redo2,
  History,
  Download as DownloadIcon,
  Moon,
  Sun,
  ListTree,
  SplitSquareHorizontal,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useDataContext } from "../context/DataContext"; // safe-optional usage with fallbacks

/**
 * -----------------------------------------------------
 * Advanced Overview.tsx (single-file, animated, all-in-one)
 * -----------------------------------------------------
 * What you get:
 * - Sticky header with dataset meta + dark-mode toggle
 * - Summary stats + Data Quality score (animated progress bar)
 * - Auto Charts: Column Types pie, Missing Values bar
 * - Auto-Detected Quick Charts: categorical bar + numeric histogram
 * - Correlation Heatmap for numeric columns
 * - Preview Switcher (Original vs Cleaned) + Side-by-side option
 * - Paginated, sortable table with sticky header
 * - Highlight of modified columns (✨) from cleaning
 * - Cleaning Log drawer (transformation history)
 * - Undo / Redo / Version history controls (gracefully disabled if unsupported)
 * - Framer Motion animations throughout
 * - Defensive coding: works even if context fields are partially missing
 */

// -----------------------------
// Types (defensive / optional)
// -----------------------------

type Row = Record<string, any>;

type Column = {
  name: string;
  type?: string;
  missingCount?: number;
  modified?: boolean; // optional flag from cleaning
};

type Dataset = {
  name?: string;
  uploadedAt?: Date | string | number;
  columns: Column[];
  data: Row[];
  originalData?: Row[]; // optional: if you store original upload separately
  modifiedColumns?: string[]; // optional: list of modified column names
};

type DataSummary = {
  totalRows: number;
  totalColumns: number;
  missingValues: number;
  duplicates?: number;
  // optional cleaning log
  cleaningLog?: Array<{ id?: string; timestamp?: string | number | Date; action: string; details?: string }>; 
};

// --------------
// Color helpers
// --------------
const PALETTE = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#22C55E", "#EAB308"];
const genColor = (i: number) => `hsl(${(i * 53) % 360} 70% 55%)`;

// ---------------------
// Utility / Data logic
// ---------------------
const isNumber = (v: any) => typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v);
const isDateObj = (v: any) => v instanceof Date || (typeof v === "string" && /\d{4}-\d{2}-\d{2}T\d{2}/.test(v));

// Always show raw-ish value in table (avoid ISO noise). If Date-like, prettify.
const renderCell = (value: any): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (value instanceof Date) return value.toLocaleDateString("en-GB");
  if (typeof value === "string") {
    // If ISO string, show date part only
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB");
    }
    return value;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// Pick one numeric and one categorical column for quick charts
const pickQuickColumns = (columns: Column[], data: Row[]) => {
  let numericCol: string | null = null;
  let categoricalCol: string | null = null;

  for (const col of columns) {
    if (!numericCol) {
      // Heuristic: If column type says numeric/integer, or first few values parse to numbers
      if (col.type?.toLowerCase().includes("num") || col.type?.toLowerCase().includes("int")) {
        numericCol = col.name;
      } else {
        // sample first 20 rows
        const sample = data.slice(0, 20).map((r) => r[col.name]);
        const numLike = sample.filter((v) => isNumber(v) || (!Number.isNaN(Number(v)) && v !== null && v !== ""));
        if (numLike.length >= Math.max(5, Math.floor(sample.length * 0.6))) numericCol = col.name;
      }
    }
    if (!categoricalCol) {
      const sample = data.slice(0, 50).map((r) => r[col.name]);
      const uniqueCount = new Set(sample.filter((v) => v !== null && v !== undefined && v !== "")).size;
      if (uniqueCount > 1 && uniqueCount <= 20) {
        categoricalCol = col.name;
      }
    }
    if (numericCol && categoricalCol) break;
  }

  return { numericCol, categoricalCol };
};

// Build histogram for one numeric column
const buildHistogram = (values: number[], bins = 12) => {
  if (!values.length) return [] as { bin: string; count: number }[];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = range / bins;
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach((v) => {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width));
    counts[idx] += 1;
  });
  return counts.map((c, i) => ({ bin: `${(min + i * width).toFixed(1)}–${(min + (i + 1) * width).toFixed(1)}`, count: c }));
};

// Build bar counts for a categorical column
const buildCategoryCounts = (values: any[], topN = 15) => {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = v === null || v === undefined || v === "" ? "(blank)" : String(v);
    map.set(key, (map.get(key) || 0) + 1);
  }
  const arr = Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  arr.sort((a, b) => b.value - a.value);
  return arr.slice(0, topN);
};

// Correlation matrix (Pearson) for numeric columns
const pearson = (xs: number[], ys: number[]) => {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return 0;
  const x = xs.slice(0, n);
  const y = ys.slice(0, n);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const denom = Math.sqrt(dx * dy) || 1;
  return num / denom;
};

const buildCorrelation = (columns: Column[], data: Row[]) => {
  const numericNames = columns
    .map((c) => c.name)
    .filter((name) => {
      const sample = data.slice(0, 50).map((r) => r[name]);
      const nums = sample.filter((v) => isNumber(v) || (!Number.isNaN(Number(v)) && v !== null && v !== ""));
      return nums.length >= Math.max(5, Math.floor(sample.length * 0.6));
    });

  const series: Record<string, number[]> = {};
  numericNames.forEach((name) => {
    series[name] = data
      .map((r) => r[name])
      .map((v) => (isNumber(v) ? Number(v) : Number(v)))
      .filter((v) => !Number.isNaN(v));
  });

  const matrix: number[][] = [];
  for (let i = 0; i < numericNames.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < numericNames.length; j++) {
      const xi = series[numericNames[i]] || [];
      const yj = series[numericNames[j]] || [];
      const len = Math.min(xi.length, yj.length);
      matrix[i][j] = len ? pearson(xi.slice(0, len), yj.slice(0, len)) : 0;
    }
  }
  return { numericNames, matrix };
};

// Data Quality Score (simple heuristic)
const computeQuality = (summary: DataSummary | null, dataset: Dataset | null) => {
  if (!summary || !dataset) return 0;
  const totalCells = (summary.totalRows || 0) * (summary.totalColumns || 0);
  const missingPenalty = totalCells ? (summary.missingValues || 0) / totalCells : 0;
  const dupPenalty = (summary.duplicates || 0) / Math.max(1, summary.totalRows || 1) * 0.2; // weight duplicates lower
  const score = Math.max(0, 1 - missingPenalty - dupPenalty);
  return Math.round(score * 100);
};

// Sort helper
const sortRows = (rows: Row[], key: string, dir: "asc" | "desc") => {
  const sorted = [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (isNumber(va) && isNumber(vb)) return dir === "asc" ? va - vb : vb - va;
    const sa = String(va ?? "").toLowerCase();
    const sb = String(vb ?? "").toLowerCase();
    if (sa < sb) return dir === "asc" ? -1 : 1;
    if (sa > sb) return dir === "asc" ? 1 : -1;
    return 0;
  });
  return sorted;
};

// -----------------------
// Main Component
// -----------------------

const Overview: React.FC = () => {
  // Context (graceful fallbacks if fields absent)
  const ctx = (() => {
    try {
      return useDataContext?.();
    } catch {
      return {} as any;
    }
  })() as Partial<{
    dataset: Dataset;
    dataSummary: DataSummary;
    // optional extras if your DataContext provides them
    cleanedDataset?: Dataset;
    originalDataset?: Dataset;
    versions?: Dataset[];
    currentVersionIndex?: number;
    undo?: () => void;
    redo?: () => void;
  }>;

  const dataset: Dataset | null = ctx.dataset || ctx.cleanedDataset || null;
  const dataSummary: DataSummary | null = ctx.dataSummary || null;

  // -----------------------
  // UI State
  // -----------------------
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("theme");
    return stored ? stored === "dark" : true; // default dark
  });
  const [viewMode, setViewMode] = useState<"cleaned" | "original" | "side-by-side">("cleaned");
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(0);
  const [sortBy, setSortBy] = useState<{ key: string | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" });
  const [showLog, setShowLog] = useState<boolean>(false);

  // Sync dark mode to <html> for Tailwind's `dark:`
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  // Derived dataset(s) for view
  const originalRows = useMemo<Row[]>(() => dataset?.originalData || dataset?.data || [], [dataset]);
  const cleanedRows = useMemo<Row[]>(() => dataset?.data || [], [dataset]);

  const activeRows = useMemo<Row[]>(() => {
    const rows = viewMode === "original" ? originalRows : cleanedRows;
    if (!sortBy.key) return rows;
    return sortRows(rows, sortBy.key, sortBy.dir);
  }, [viewMode, originalRows, cleanedRows, sortBy]);

  const columns = useMemo<Column[]>(() => dataset?.columns || [], [dataset]);

  // Charts: types pie + missing bar
  const { typesPie, missingCols, maxMissing } = useMemo(() => {
    const typeMap: Record<string, number> = {};
    columns.forEach((c) => {
      const t = c.type || "Unknown";
      typeMap[t] = (typeMap[t] || 0) + 1;
    });
    const total = Object.values(typeMap).reduce((s, v) => s + v, 0) || 1;
    const typesPie = Object.entries(typeMap).map(([name, value]) => ({ name, value, pct: ((value / total) * 100).toFixed(1) }));

    const missingCols = columns
      .filter((c) => (c.missingCount ?? 0) > 0)
      .map((c) => ({ ...c, highlight: selectedType ? c.type === selectedType : true }));
    const maxMissing = Math.max(0, ...missingCols.map((c) => c.missingCount || 0));
    return { typesPie, missingCols, maxMissing };
  }, [columns, selectedType]);

  // Quick charts: numeric histogram & categorical bar
  const { numericCol, categoricalCol } = useMemo(() => pickQuickColumns(columns, cleanedRows), [columns, cleanedRows]);
  const histogramData = useMemo(() => {
    if (!numericCol) return [] as { bin: string; count: number }[];
    const nums = cleanedRows
      .map((r) => r[numericCol])
      .map((v) => (isNumber(v) ? Number(v) : Number(v)))
      .filter((v) => !Number.isNaN(v));
    return buildHistogram(nums, 12);
  }, [cleanedRows, numericCol]);
  const categoryData = useMemo(() => {
    if (!categoricalCol) return [] as { name: string; value: number }[];
    return buildCategoryCounts(cleanedRows.map((r) => r[categoricalCol]));
  }, [cleanedRows, categoricalCol]);

  // Correlation Heatmap
  const { numericNames, matrix } = useMemo(() => buildCorrelation(columns, cleanedRows), [columns, cleanedRows]);

  // Quality score
  const quality = useMemo(() => computeQuality(dataSummary, dataset), [dataSummary, dataset]);

  // Pagination data
  const totalPages = Math.max(1, Math.ceil(activeRows.length / pageSize));
  useEffect(() => {
    // reset page if data length changes or page overflows
    if (page >= totalPages) setPage(0);
  }, [page, totalPages]);
  const pageRows = useMemo(() => activeRows.slice(page * pageSize, page * pageSize + pageSize), [activeRows, page, pageSize]);

  // Sorting handler
  const onSort = (key: string) => {
    setSortBy((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  };

  // Modified columns highlighting list
  const modifiedSet = useMemo(() => new Set<string>((dataset?.modifiedColumns || []).concat(columns.filter((c) => c.modified).map((c) => c.name))), [dataset, columns]);

  // Cleaning Log
  const cleaningLog = useMemo(() => dataSummary?.cleaningLog || [], [dataSummary]);

  // Versioning controls (gracefully handle if context lacks methods)
  const canUndo = Boolean(ctx.undo);
  const canRedo = Boolean(ctx.redo);
  const versions = ctx.versions || [];
  const versionIndex = ctx.currentVersionIndex ?? -1;

  // ---------------
  // Render helpers
  // ---------------

  const StatCard: React.FC<{ title: string; value: number | string; icon: React.ElementType; accent: string }> = ({ title, value, icon: Icon, accent }) => (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl border border-gray-700/60 bg-gray-800/40 p-5 backdrop-blur-sm`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className={`mt-1 text-3xl font-bold ${accent}`}>{typeof value === "number" ? value.toLocaleString() : value}</p>
        </div>
        <Icon className={`h-8 w-8 ${accent}`} />
      </div>
    </motion.div>
  );

  const ProgressBar: React.FC<{ value: number }> = ({ value }) => (
    <div className="w-full rounded-full border border-gray-700/60 bg-gray-900/40 p-1">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
        className="h-3 rounded-full bg-green-500"
      />
    </div>
  );

  const Header = () => (
    <div className="sticky top-0 z-20 -mx-2 bg-gray-900/80 px-2 py-3 backdrop-blur supports-[backdrop-filter]:bg-gray-900/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold text-white">
            {dataset?.name || "Dataset"}
          </h2>
          <p className="text-xs text-gray-400">
            Uploaded: {dataset?.uploadedAt ? new Date(dataset.uploadedAt).toLocaleString() : "Not available"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDarkMode((d) => !d)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-700/60 bg-gray-800/60 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
          >
            {darkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />} {darkMode ? "Dark" : "Light"}
          </button>
          <button
            onClick={() => setShowLog(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-700/60 bg-gray-800/60 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
          >
            <ListTree className="h-4 w-4" /> Cleaning Log
          </button>
          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={() => ctx.undo?.()}
              disabled={!canUndo}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                canUndo ? "border-gray-700/60 bg-gray-800/60 text-gray-200 hover:border-gray-500" : "cursor-not-allowed border-gray-800 bg-gray-900/40 text-gray-600"
              }`}
            >
              <Undo2 className="h-4 w-4" /> Undo
            </button>
            <button
              onClick={() => ctx.redo?.()}
              disabled={!canRedo}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                canRedo ? "border-gray-700/60 bg-gray-800/60 text-gray-200 hover:border-gray-500" : "cursor-not-allowed border-gray-800 bg-gray-900/40 text-gray-600"
              }`}
            >
              <Redo2 className="h-4 w-4" /> Redo
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-gray-700/60 bg-gray-800/60 p-1 text-xs">
            <button
              onClick={() => setViewMode("cleaned")}
              className={`rounded-lg px-3 py-1 ${viewMode === "cleaned" ? "bg-gray-700 text-white" : "text-gray-300"}`}
              title="Show Cleaned"
            >
              Cleaned
            </button>
            <button
              onClick={() => setViewMode("original")}
              className={`rounded-lg px-3 py-1 ${viewMode === "original" ? "bg-gray-700 text-white" : "text-gray-300"}`}
              title="Show Original"
            >
              Original
            </button>
            <button
              onClick={() => setViewMode("side-by-side")}
              className={`rounded-lg px-3 py-1 ${viewMode === "side-by-side" ? "bg-gray-700 text-white" : "text-gray-300"}`}
              title="Compare Side-by-side"
            >
              <SplitSquareHorizontal className="-mt-0.5 inline h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // -----------------------
  // Layout
  // -----------------------

  return (
    <div className="space-y-6">
      <Header />

      {/* Summary & Quality */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="grid grid-cols-1 gap-6 md:grid-cols-4"
      >
        <StatCard title="Total Rows" value={dataSummary?.totalRows || (dataset?.data?.length || 0)} icon={Database} accent="text-blue-400" />
        <StatCard title="Total Columns" value={dataSummary?.totalColumns || (dataset?.columns?.length || 0)} icon={BarChart3} accent="text-emerald-400" />
        <StatCard title="Missing Values" value={dataSummary?.missingValues || 0} icon={AlertTriangle} accent={(dataSummary?.missingValues || 0) > 0 ? "text-yellow-400" : "text-emerald-400"} />
        <StatCard title="Duplicates" value={dataSummary?.duplicates || 0} icon={Users} accent={(dataSummary?.duplicates || 0) > 0 ? "text-rose-400" : "text-emerald-400"} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Data Quality</h3>
            <p className="text-xs text-gray-400">Higher is better – based on missing cells and duplicates</p>
          </div>
          <div className="text-2xl font-bold text-white">{quality}%</div>
        </div>
        <ProgressBar value={quality} />
      </motion.div>

      {/* Core Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Column Types Distribution */}
        <motion.div initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
          <h3 className="mb-4 flex items-center text-xl font-semibold text-white"><PieChartIcon className="mr-2 h-5 w-5 text-purple-400" /> Column Types Distribution</h3>
          {typesPie.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={typesPie}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  paddingAngle={5}
                  label={({ name, pct }) => `${name} (${pct}%)`}
                  onClick={(d) => setSelectedType((prev) => (prev === (d?.name as string) ? null : (d?.name as string)))}
                  cursor="pointer"
                >
                  {typesPie.map((e, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length] || genColor(i)} stroke={selectedType === e.name ? "#fff" : "none"} strokeWidth={selectedType === e.name ? 3 : 0} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const p = payload[0].payload as any;
                    return (
                      <div className="rounded border border-gray-600 bg-gray-900 p-2 text-sm text-white shadow-lg">
                        <p className="font-semibold">{p.name}</p>
                        <p>Count: {p.value}</p>
                        <p>Percentage: {p.pct}%</p>
                      </div>
                    );
                  }}
                />
                <Legend iconType="circle" />
              </RechartsPieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-400">No column type data available</p>
          )}
        </motion.div>

        {/* Missing Values by Column */}
        <motion.div initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
          <h3 className="mb-4 flex items-center text-xl font-semibold text-white"><TrendingUp className="mr-2 h-5 w-5 text-green-400" /> Missing Values by Column</h3>
          {missingCols.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={missingCols} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#9CA3AF" fontSize={12} angle={-45} textAnchor="end" height={80} interval={0} />
                <YAxis stroke="#9CA3AF" />
                <Tooltip
                  cursor={{ fill: "rgba(107,114,128,0.1)" }}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const p = payload[0].payload as any;
                    return (
                      <div className="rounded border border-gray-600 bg-gray-900 p-2 text-sm text-white shadow-lg">
                        <p className="font-semibold">{p.name}</p>
                        <p>Missing: {p.missingCount}</p>
                        <p>Type: {p.type}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="missingCount">
                  {missingCols.map((c, idx) => {
                    const isMax = c.missingCount === maxMissing && c.highlight;
                    const fill = isMax ? "#F87171" : c.highlight ? "#FBBF24" : "#4B5563";
                    return <Cell key={idx} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[300px] items-center justify-center">
              <p className="text-center text-gray-400">No missing values found in the dataset! ✨</p>
            </div>
          )}
        </motion.div>
      </div>

      {/* Quick Auto Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Numeric Histogram */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
          <h3 className="mb-1 text-lg font-semibold text-white">{numericCol ? `Histogram: ${numericCol}` : "Histogram"}</h3>
          <p className="mb-3 text-xs text-gray-400">Auto-selected numeric column</p>
          {histogramData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={histogramData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="bin" stroke="#9CA3AF" interval={0} angle={-30} textAnchor="end" height={80} />
                <YAxis stroke="#9CA3AF" />
                <Tooltip />
                <Bar dataKey="count" fill="#60A5FA" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-gray-400">No numeric column detected</div>
          )}
        </motion.div>

        {/* Categorical Bar */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 }} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
          <h3 className="mb-1 text-lg font-semibold text-white">{categoricalCol ? `Top Categories: ${categoricalCol}` : "Top Categories"}</h3>
          <p className="mb-3 text-xs text-gray-400">Auto-selected categorical column</p>
          {categoryData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#9CA3AF" interval={0} angle={-30} textAnchor="end" height={80} />
                <YAxis stroke="#9CA3AF" />
                <Tooltip />
                <Bar dataKey="value">
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length] || genColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-gray-400">No categorical column detected</div>
          )}
        </motion.div>
      </div>

      {/* Correlation Heatmap */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
        <h3 className="mb-1 text-lg font-semibold text-white">Correlation Heatmap</h3>
        <p className="mb-4 text-xs text-gray-400">Numeric columns only – Pearson correlation</p>
        {numericNames.length >= 2 ? (
          <div className="overflow-auto">
            <div className="inline-block min-w-[600px]">
              {/* Header */}
              <div className="ml-24 grid" style={{ gridTemplateColumns: `repeat(${numericNames.length}, minmax(80px, 1fr))` }}>
                {numericNames.map((n) => (
                  <div key={n} className="px-2 pb-2 text-center text-xs text-gray-300">{n}</div>
                ))}
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-y-1">
                {numericNames.map((rowName, i) => (
                  <div key={rowName} className="contents">
                    <div className="sticky left-0 z-10 mr-2 w-24 truncate bg-gray-800/40 px-2 py-1 text-right text-xs text-gray-300">{rowName}</div>
                    <div className="grid" style={{ gridTemplateColumns: `repeat(${numericNames.length}, minmax(80px, 1fr))` }}>
                      {numericNames.map((colName, j) => {
                        const v = matrix[i]?.[j] ?? 0;
                        // Map [-1,1] to color from rose to slate to emerald
                        const hue = v < 0 ? 0 : 150; // red for negative, green for positive
                        const alpha = Math.min(1, Math.abs(v));
                        const bg = `hsla(${hue},70%,45%,${alpha})`;
                        return (
                          <div key={colName} className="m-0.5 rounded-md p-2 text-center text-xs text-white" style={{ background: bg }}>
                            {v.toFixed(2)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-[220px] items-center justify-center text-gray-400">Not enough numeric columns to compute correlation</div>
        )}
      </motion.div>

      {/* Data Preview(s) */}
      {viewMode !== "side-by-side" ? (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-semibold text-white">Data Preview ({viewMode === "original" ? "Original" : "Cleaned"})</h3>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Rows per page</label>
              <select
                className="rounded-lg border border-gray-700/60 bg-gray-900 px-2 py-1 text-sm text-gray-200"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-700/30 text-gray-300">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.name}
                      className="sticky top-0 z-10 cursor-pointer border-b border-gray-700 px-3 py-2 backdrop-blur hover:bg-gray-700/40"
                      onClick={() => onSort(col.name)}
                      title="Click to sort"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{col.name}</span>
                        {modifiedSet.has(col.name) && <Sparkles className="h-3.5 w-3.5 text-purple-400" title="Modified in cleaning" />}
                        <span className="text-[10px] text-purple-300">{col.type || ""}</span>
                        {sortBy.key === col.name && (
                          <span className="text-[10px] text-gray-400">{sortBy.dir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, ri) => (
                  <tr key={ri} className="border-b border-gray-800 hover:bg-gray-700/20">
                    {columns.map((col) => (
                      <td key={col.name} className={`whitespace-nowrap px-3 py-2 text-gray-200 ${modifiedSet.has(col.name) ? "bg-purple-500/5" : ""}`}>
                        {renderCell(row[col.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-3 flex items-center justify-between text-sm text-gray-300">
            <div>Page <span className="font-semibold">{page + 1}</span> of <span className="font-semibold">{totalPages}</span></div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(0)} disabled={page === 0} className={`rounded-lg border px-3 py-1 ${page === 0 ? "cursor-not-allowed border-gray-800 text-gray-600" : "border-gray-700/60 bg-gray-800/60 text-gray-200 hover:border-gray-500"}`}>First</button>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={`rounded-lg border px-3 py-1 ${page === 0 ? "cursor-not-allowed border-gray-800 text-gray-600" : "border-gray-700/60 bg-gray-800/60 text-gray-200 hover:border-gray-500"}`}>Prev</button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className={`rounded-lg border px-3 py-1 ${page >= totalPages - 1 ? "cursor-not-allowed border-gray-800 text-gray-600" : "border-gray-700/60 bg-gray-800/60 text-gray-200 hover:border-gray-500"}`}>Next</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className={`rounded-lg border px-3 py-1 ${page >= totalPages - 1 ? "cursor-not-allowed border-gray-800 text-gray-600" : "border-gray-700/60 bg-gray-800/60 text-gray-200 hover:border-gray-500"}`}>Last</button>
            </div>
          </div>
        </motion.div>
      ) : (
        // Side-by-side compare
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[{ label: "Original", rows: originalRows }, { label: "Cleaned", rows: cleanedRows }].map((block) => (
            <div key={block.label} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-white">Data Preview ({block.label})</h3>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Rows</label>
                  <select className="rounded-lg border border-gray-700/60 bg-gray-900 px-2 py-1 text-sm text-gray-200" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                    {[10, 25, 50, 100].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-700/30 text-gray-300">
                    <tr>
                      {columns.map((col) => (
                        <th key={col.name} className="sticky top-0 z-10 border-b border-gray-700 px-3 py-2 backdrop-blur">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{col.name}</span>
                            {modifiedSet.has(col.name) && <Sparkles className="h-3.5 w-3.5 text-purple-400" />}
                            <span className="text-[10px] text-purple-300">{col.type || ""}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.slice(page * pageSize, page * pageSize + pageSize).map((row, ri) => (
                      <tr key={ri} className="border-b border-gray-800">
                        {columns.map((col) => (
                          <td key={col.name} className={`whitespace-nowrap px-3 py-2 text-gray-200 ${modifiedSet.has(col.name) ? "bg-purple-500/5" : ""}`}>
                            {renderCell(row[col.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* AI Suggestions (lightweight heuristic placeholder) */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-400" />
          <h3 className="text-lg font-semibold text-white">Smart Suggestions</h3>
        </div>
        <ul className="list-disc space-y-1 pl-6 text-sm text-gray-300">
          {(dataSummary?.missingValues || 0) > 0 && <li>Consider imputing missing values in columns with high null counts.</li>}
          {(dataSummary?.duplicates || 0) > 0 && <li>There are duplicates detected – try removing them for cleaner analysis.</li>}
          {numericNames.length >= 2 && <li>Highly correlated columns may be redundant; consider feature selection or PCA.</li>}
          {!(dataSummary?.missingValues || dataSummary?.duplicates) && <li>Your data looks quite clean! Add domain checks or outlier detection next.</li>}
        </ul>
      </motion.div>

      {/* Cleaning Log Drawer */}
      <AnimatePresence>
        {showLog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/50">
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 160, damping: 18 }}
              className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-auto border-l border-gray-700 bg-gray-900 p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white"><ListTree className="mr-2 inline h-4 w-4" /> Cleaning Log</h3>
                <button onClick={() => setShowLog(false)} className="rounded-lg border border-gray-700/60 bg-gray-800/60 px-3 py-1 text-sm text-gray-200 hover:border-gray-500">Close</button>
              </div>
              {cleaningLog.length ? (
                <ul className="space-y-3">
                  {cleaningLog.map((item, idx) => (
                    <li key={item.id || idx} className="rounded-lg border border-gray-700/60 bg-gray-800/40 p-3">
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>{item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}</span>
                        <span className="font-mono text-gray-500">#{idx + 1}</span>
                      </div>
                      <p className="mt-1 font-medium text-gray-200">{item.action}</p>
                      {item.details && <p className="text-xs text-gray-400">{item.details}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">No cleaning actions recorded.</p>
              )}

              {/* Version History (if available) */}
              <div className="mt-6 border-t border-gray-800 pt-4">
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><History className="h-4 w-4" /> Version History</h4>
                {versions.length ? (
                  <ul className="space-y-2 text-sm">
                    {versions.map((v, i) => (
                      <li key={i} className={`flex items-center justify-between rounded-lg border p-2 ${i === versionIndex ? "border-blue-500/60 bg-blue-500/10" : "border-gray-700/60 bg-gray-800/40"}`}>
                        <span className="truncate text-gray-200">{v.name || `Version ${i + 1}`}</span>
                        <span className="text-xs text-gray-400">{v.uploadedAt ? new Date(v.uploadedAt).toLocaleString() : ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400">No version history available.</p>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => ctx.undo?.()} disabled={!canUndo} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-sm ${canUndo ? "border-gray-700/60 bg-gray-800/60 text-gray-200 hover:border-gray-500" : "cursor-not-allowed border-gray-800 bg-gray-900/40 text-gray-600"}`}>
                    <Undo2 className="h-4 w-4" /> Undo
                  </button>
                  <button onClick={() => ctx.redo?.()} disabled={!canRedo} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-sm ${canRedo ? "border-gray-700/60 bg-gray-800/60 text-gray-200 hover:border-gray-500" : "cursor-not-allowed border-gray-800 bg-gray-900/40 text-gray-600"}`}>
                    <Redo2 className="h-4 w-4" /> Redo
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Overview;
