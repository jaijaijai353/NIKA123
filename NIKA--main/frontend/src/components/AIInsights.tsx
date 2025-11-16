// src/components/AIInsights.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
} from "recharts";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Target,
  Lightbulb,
  Star,
  ArrowRight,
  Search,
  Filter,
  Settings,
  ChevronDown,
  ChevronUp,
  Download,
  Zap,
  Columns,
  FileText,
} from "lucide-react";
import { useDataContext } from "../context/DataContext";
import { API_BASE } from "../../config";
import { auth, isFirebaseConfigured } from "../firebase/clientApp";

/**
 * AIInsights.tsx
 *
 * Single-file, expanded AI-powered insights panel.
 * - Reads uploaded dataset from useDataContext()
 * - Computes summary stats, trends, correlations, anomalies, categorical breakdowns
 * - Generates dynamic insight objects (type/title/desc/confidence/importance/meta)
 * - UI: search, filters, sort, collapsible groups, sparkline mini-charts, drilldown modal
 * - Defensive: guards for missing/insufficient data
 *
 * Drop into src/components and render <AIInsights /> inside your app.
 */

/* ===========================
   Types
   =========================== */

type Row = Record<string, any>;

type InsightType =
  | "anomaly"
  | "trend"
  | "correlation"
  | "recommendation"
  | "quality"
  | "categorical"
  | "segmentation"
  | "other";

type Insight = {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  confidence: number; // 0..1
  importance: "high" | "medium" | "low";
  meta?: Record<string, any>; // supporting data for drilldown/chart
};

/* ===========================
   Palette / small utilities
   =========================== */

const PALETTE = [
  "#00BFA6",
  "#FFC107",
  "#66BB6A",
  "#FF7043",
  "#42A5F5",
  "#AB47BC",
  "#26C6DA",
  "#EC407A",
  "#8D6E63",
  "#7E57C2",
];

const safeLen = (arr?: any[]) => (Array.isArray(arr) ? arr.length : 0);
const isMissing = (v: any) =>
  v === null ||
  v === undefined ||
  v === "" ||
  (typeof v === "number" && Number.isNaN(v));
const isFiniteNumber = (v: any) => typeof v === "number" && Number.isFinite(v);

const toNumber = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/* ===========================
   Math helpers
   =========================== */

const mean = (arr: number[]) => {
  if (!arr || arr.length === 0) return 0;
  const s = arr.reduce((a, b) => a + b, 0);
  return s / arr.length;
};

const median = (arr: number[]) => {
  if (!arr || arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const stdDev = (arr: number[]) => {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
};

const minMax = (arr: number[]) => {
  if (!arr || arr.length === 0) return { min: 0, max: 0 };
  let mn = arr[0],
    mx = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { min: mn, max: mx };
};

const pearson = (x: number[], y: number[]) => {
  if (!x || !y) return 0;
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    if (isFiniteNumber(x[i]) && isFiniteNumber(y[i])) {
      xs.push(x[i]);
      ys.push(y[i]);
    }
  }
  if (xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0,
    sx = 0,
    sy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    sx += (xs[i] - mx) ** 2;
    sy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(sx * sy);
  if (!isFiniteNumber(num) || !isFiniteNumber(den) || den === 0) return 0;
  return num / den;
};

const zScoreOutliers = (arr: number[], thresh = 2.5) => {
  if (!arr || arr.length < 2) return [];
  const m = mean(arr);
  const s = stdDev(arr);
  if (s === 0) return [];
  const idx: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const z = (arr[i] - m) / s;
    if (Math.abs(z) > thresh) idx.push(i);
  }
  return idx;
};

/* ===========================
   Data normalization hook
   =========================== */

/**
 * Normalizes whatever context might give us:
 * - dataset: { columns, data } OR
 * - uploadedData or data: Row[]
 *
 * Returns rows array and inferred columns lists.
 */
const useNormalizedData = () => {
  const ctx = useDataContext() as any;
  const dataset = ctx?.dataset ?? null;
  const plain = ctx?.data ?? ctx?.uploadedData ?? null;

  const rows: Row[] = useMemo(() => {
    if (dataset && Array.isArray(dataset.data)) return dataset.data as Row[];
    if (Array.isArray(plain)) return plain as Row[];
    return [];
  }, [dataset, plain]);

  const columns: string[] = useMemo(() => {
    if (dataset && Array.isArray(dataset.columns) && dataset.columns.length > 0) {
      try {
        return dataset.columns.map((c: any) => (typeof c === "string" ? c : c.name));
      } catch {
        return [];
      }
    }
    if (rows.length > 0) return Object.keys(rows[0]);
    return [];
  }, [dataset, rows]);

  const numericColumns: string[] = useMemo(() => {
    if (dataset && Array.isArray(dataset.columns) && dataset.columns.length > 0) {
      const nums = dataset.columns
        .filter((c: any) =>
          c && (c.type === "numeric" || c.type === "number" || c.type === "int" || c.type === "float")
        )
        .map((c: any) => (typeof c === "string" ? c : c.name));
      if (nums.length > 0) return nums;
    }
    const out: string[] = [];
    columns.forEach((col) => {
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i]?.[col];
        if (!isMissing(v)) {
          const n = toNumber(v);
          if (!Number.isNaN(n)) out.push(col);
          break;
        }
      }
    });
    return out;
  }, [dataset, columns, rows]);

  const categoricalColumns: string[] = useMemo(() => {
    if (dataset && Array.isArray(dataset.columns) && dataset.columns.length > 0) {
      const cats = dataset.columns
        .filter((c: any) => c && (c.type === "categorical" || c.type === "string" || c.type === "enum"))
        .map((c: any) => (typeof c === "string" ? c : c.name));
      if (cats.length > 0) return cats;
    }
    return columns.filter((c) => !numericColumns.includes(c));
  }, [dataset, columns, numericColumns]);

  return { rows, columns, numericColumns, categoricalColumns };
};

/* ===========================
   Insight builder
   =========================== */

/**
 * Given normalized rows and column lists, produce a list of Insights.
 * The function below is intentionally verbose and explicit — it tries multiple checks and creates many insight types.
 */
const buildInsights = (rows: Row[], numericCols: string[], catCols: string[], allCols: string[]) => {
  const insights: Insight[] = [];
  const N = rows.length;

  // --- 1. Quick dataset-level insights
  if (N === 0) {
    insights.push({
      id: "no-data",
      type: "quality",
      title: "No data available",
      description: "Please upload data to generate insights. This panel will automatically update when a dataset is available.",
      confidence: 0.9,
      importance: "high",
    });
    return insights;
  }

  insights.push({
    id: "dataset-overview",
    type: "other",
    title: `Dataset contains ${N} rows and ${allCols.length} columns`,
    description: `This dataset has ${N} rows and ${allCols.length} columns. ${numericCols.length} numeric columns detected and ${catCols.length} categorical columns detected.`,
    confidence: 0.85,
    importance: "low",
  });

  // --- 2. Missingness & column quality
  const missing = allCols.map((c) => {
    const miss = rows.filter((r) => isMissing(r?.[c])).length;
    return {
      column: c,
      missing: miss,
      percent: N === 0 ? 0 : (miss / N) * 100,
    };
  });

  const highMissing = missing.filter((m) => m.percent >= 30);
  if (highMissing.length > 0) {
    insights.push({
      id: "missing-high",
      type: "quality",
      title: `${highMissing.length} column(s) with high missingness`,
      description: `Columns with >=30% missing values: ${highMissing
        .map((m) => `${m.column} (${m.percent.toFixed(0)}%)`)
        .join(", ")}. Consider imputation or inspecting data source.`,
      confidence: 0.92,
      importance: "high",
      meta: { highMissing },
    });
  } else {
    const someMissing = missing.filter((m) => m.percent > 0);
    if (someMissing.length > 0) {
      insights.push({
        id: "missing-some",
        type: "quality",
        title: `${someMissing.length} column(s) have some missing values`,
        description: `No columns exceed 30% missingness, but several columns contain some missing values. Choose an imputation or cleaning strategy based on column importance.`,
        confidence: 0.75,
        importance: "medium",
        meta: { someMissing },
      });
    }
  }

  // --- 3. Categorical cardinality suggestions
  const catCard = catCols.map((c) => {
    const vals = rows.map((r) => r?.[c]).filter((v) => !isMissing(v));
    const unique = new Set(vals.map((v) => (typeof v === "string" ? v : JSON.stringify(v)))).size;
    return { column: c, unique, total: vals.length };
  });
  const highCard = catCard.filter((c) => c.unique > Math.max(50, Math.sqrt(Math.max(1, N))));
  if (highCard.length > 0) {
    insights.push({
      id: "high-cardinality",
      type: "quality",
      title: `High cardinality categorical columns (${highCard.length})`,
      description: `Found categorical columns with high number of distinct values: ${highCard
        .map((c) => `${c.column} (${c.unique})`)
        .join(", ")}. Consider bucketing, hashing, or leaving as-is depending on downstream needs.`,
      confidence: 0.78,
      importance: "medium",
      meta: { highCard },
    });
  }

  // --- 4. Numeric columns summary, skewness & outliers
  numericCols.forEach((col) => {
    const arr = rows.map((r) => toNumber(r?.[col])).filter(Number.isFinite);
    if (arr.length === 0) {
      insights.push({
        id: `numeric-empty-${col}`,
        type: "quality",
        title: `Numeric column "${col}" has no valid numbers`,
        description: `Column "${col}" was detected as numeric but has no parseable numeric values. Check parsing rules or data typing.`,
        confidence: 0.85,
        importance: "high",
        meta: { column: col },
      });
      return;
    }
    const m = mean(arr);
    const md = median(arr);
    const sd = stdDev(arr);
    const { min, max } = minMax(arr);
    const skew = m > md ? "right-skewed" : m < md ? "left-skewed" : "symmetric";
    const outIdx = zScoreOutliers(arr, 2.5);

    if (outIdx.length > Math.max(1, Math.floor(arr.length * 0.01))) {
      insights.push({
        id: `outliers-${col}`,
        type: "anomaly",
        title: `Outliers detected in "${col}" (${outIdx.length})`,
        description: `Column "${col}" shows ${skew} distribution with mean=${m.toFixed(2)}, median=${md.toFixed(
          2
        )}, std=${sd.toFixed(2)}. Detected ${outIdx.length} potential outlier(s) using z-score.`,
        confidence: Math.min(0.95, 0.5 + Math.min(0.4, outIdx.length / Math.max(1, arr.length))),
        importance: outIdx.length > arr.length * 0.05 ? "high" : "medium",
        meta: { column: col, mean: m, median: md, std: sd, min, max, outlierIndices: outIdx.slice(0, 100) },
      });
    } else {
      insights.push({
        id: `summary-${col}`,
        type: "trend",
        title: `Summary for "${col}"`,
        description: `Range: ${min} → ${max}. Mean: ${m.toFixed(2)}, Median: ${md.toFixed(2)}, Std: ${sd.toFixed(
          2
        )}. Distribution appears ${skew}.`,
        confidence: 0.7,
        importance: "low",
        meta: { column: col, mean: m, median: md, std: sd, min, max },
      });
    }
  });

  // --- 5. Correlations: pairwise Pearson, report strong ones
  if (numericCols.length >= 2) {
    const pairs: { x: string; y: string; corr: number }[] = [];
    for (let i = 0; i < numericCols.length; i++) {
      for (let j = i + 1; j < numericCols.length; j++) {
        const xArr = rows.map((r) => toNumber(r?.[numericCols[i]]));
        const yArr = rows.map((r) => toNumber(r?.[numericCols[j]]));
        const corr = pearson(xArr, yArr);
        pairs.push({ x: numericCols[i], y: numericCols[j], corr });
      }
    }
    const strong = pairs.filter((p) => Math.abs(p.corr) >= 0.6).sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));
    if (strong.length > 0) {
      strong.slice(0, 6).forEach((s, idx) =>
        insights.push({
          id: `corr-${s.x}-${s.y}-${idx}`,
          type: "correlation",
          title: `Correlation detected: ${s.x} vs ${s.y}`,
          description: `Found ${s.corr >= 0 ? "positive" : "negative"} linear correlation (r=${s.corr.toFixed(
            3
          )}) between "${s.x}" and "${s.y}". Consider exploring causality or confounders.`,
          confidence: Math.min(0.95, Math.abs(s.corr)),
          importance: Math.abs(s.corr) > 0.8 ? "high" : "medium",
          meta: { pair: [s.x, s.y], corr: s.corr },
        })
      );
    } else {
      insights.push({
        id: "corr-none",
        type: "correlation",
        title: "No strong linear correlations found",
        description: "Pairwise Pearson correlation did not find absolute correlations >= 0.6. Consider nonlinear relationships or engineered features.",
        confidence: 0.6,
        importance: "low",
      });
    }
  }

  // --- 6. Trend detection: simple slope using index as x
  numericCols.forEach((col) => {
    const pts = rows.map((r, i) => ({ x: i, y: toNumber(r?.[col]) })).filter((p) => Number.isFinite(p.y));
    if (pts.length < 4) return;
    const n = pts.length;
    let sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += pts[i].x;
      sy += pts[i].y;
      sxx += pts[i].x * pts[i].x;
      sxy += pts[i].x * pts[i].y;
    }
    const denom = n * sxx - sx * sx || 1;
    const slope = (n * sxy - sx * sy) / denom;
    const first = pts[0].y;
    const last = pts[n - 1].y;
    const pct = Math.abs(first) > 1e-9 ? ((last - first) / Math.abs(first)) * 100 : 0;
    if (Math.abs(pct) >= 5) {
      insights.push({
        id: `trend-${col}`,
        type: "trend",
        title: `Trend detected for "${col}"`,
        description: `Values for "${col}" changed by ${pct.toFixed(1)}% from first to last sample. Estimated slope ≈ ${slope.toFixed(4)}.`,
        confidence: Math.min(0.9, Math.min(0.8 + Math.abs(pct) / 100, 0.98)),
        importance: Math.abs(pct) > 20 ? "high" : "medium",
        meta: { column: col, slope, pct, series: pts.slice(-200) },
      });
    }
  });

  // --- 7. Recommendations & transformations (generated heuristically)
  // Example heuristics:
  if (numericCols.length > 0 && catCols.length > 0) {
    insights.push({
      id: "recommend-features",
      type: "recommendation",
      title: "Feature engineering suggestions",
      description:
        "Consider creating interaction terms between numeric and categorical columns (e.g., numeric_mean_by_category), and normalizing skewed numeric columns using log or Box-Cox transforms.",
      confidence: 0.7,
      importance: "medium",
    });
  } else if (numericCols.length > 0) {
    insights.push({
      id: "recommend-normalize",
      type: "recommendation",
      title: "Normalization suggestion",
      description: "Some numeric columns appear skewed. Consider log-transform or scaling to stabilize variance for modeling.",
      confidence: 0.68,
      importance: "low",
    });
  }

  // --- 8. Segmentation hint (if a categorical column has a clear top group)
  catCard.forEach((c) => {
    if (c.total > 0 && c.unique > 1) {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const v = r?.[c.column];
        const key = isMissing(v) ? "__MISSING__" : String(v);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 1 && sorted[0][1] > sorted[1][1] * 2) {
        insights.push({
          id: `segmentation-${c.column}`,
          type: "segmentation",
          title: `Segmentation opportunity on "${c.column}"`,
          description: `Most records (${sorted[0][1]}) belong to "${sorted[0][0]}". Consider separate modeling or KPI tracking for this dominant segment.`,
          confidence: 0.72,
          importance: "medium",
          meta: { column: c.column, top: sorted[0] },
        });
      }
    }
  });

  // --- 9. Final catch-all: top-k suggestions summary
  insights.push({
    id: "summary-actions",
    type: "recommendation",
    title: "Top suggested next actions",
    description:
      "1) Inspect and impute or remove columns with high missingness. 2) Handle outliers in flagged numeric columns. 3) Explore strong correlations and consider additional visuals. 4) Apply normalization to skewed columns before modeling.",
    confidence: 0.8,
    importance: "high",
  });

  return insights;
};

/* ===========================
   UI: big component
   =========================== */

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

const formatPct = (v: number) => `${Math.round(v * 100)}%`;

/* Small sparkline component using LineChart (recharts) */
const Sparkline: React.FC<{ data: { x: number; y: number }[]; color?: string }> = ({ data, color = "#00BFA6" }) => {
  if (!data || data.length === 0)
    return <div className="h-8 w-24 flex items-center justify-center text-xs text-gray-400">no data</div>;
  const mapped = data.map((d, i) => ({ x: d.x, y: d.y }));
  return (
    <ResponsiveContainer width={100} height={36}>
      <LineChart data={mapped}>
        <Line type="monotone" dataKey="y" stroke={color} dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
};

/* Drilldown Modal (simple) */
const DrilldownModal: React.FC<{
  open: boolean;
  onClose: () => void;
  insight?: Insight | null;
  rows?: Row[];
}> = ({ open, onClose, insight, rows }) => {
  if (!open || !insight) return null;
  const meta = insight.meta ?? {};
  const sampleRows = (meta?.sampleRows && Array.isArray(meta.sampleRows) && meta.sampleRows) || rows?.slice(0, 50) || [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative z-10 w-[90%] max-w-4xl bg-[#0B0E13] border border-gray-800 rounded-2xl p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-white">{insight.title}</h3>
            <p className="text-sm text-gray-300 mt-2">{insight.description}</p>
            <div className="mt-3 text-xs text-gray-400">
              Confidence: <span className="text-white">{Math.round(insight.confidence * 100)}%</span> • Importance:{" "}
              <span className="text-white">{insight.importance}</span>
            </div>
          </div>

          <div className="flex-shrink-0">
            <button
              onClick={onClose}
              className="bg-[#13151A] px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-[#17181c]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0F1418] p-3 rounded-lg border border-gray-800">
            <h4 className="text-sm text-gray-300 mb-2">Supporting sample rows</h4>
            <div className="max-h-56 overflow-auto text-xs text-gray-200">
              {sampleRows.length === 0 ? (
                <div className="text-gray-400">No sample rows available.</div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-gray-400">
                      {Object.keys(sampleRows[0]).slice(0, 6).map((k) => (
                        <th key={k} className="p-1">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleRows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-800">
                        {Object.keys(r).slice(0, 6).map((k) => (
                          <td key={k} className="p-1 text-gray-200">{String(r[k])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="bg-[#0F1418] p-3 rounded-lg border border-gray-800">
            <h4 className="text-sm text-gray-300 mb-2">Actionable Suggestions</h4>
            <div className="text-xs text-gray-200 space-y-2">
              {/* Heuristics based on type */}
              {insight.type === "anomaly" && (
                <>
                  <div>- <strong>Investigate Root Cause:</strong> Check if outliers correspond to specific events, data entry errors, or sensor malfunctions.</div>
                  <div>- <strong>Robust Statistics:</strong> Use methods less sensitive to outliers, like using the median instead of the mean for aggregation.</div>
                  <div>- <strong>Treatment Strategy:</strong> Consider capping (winsorizing), trimming, or transforming (e.g., log transform) the data. For models, flagging outliers with a binary feature can also be effective.</div>
                </>
              )}
              {insight.type === "trend" && (
                <>
                  <div>- <strong>Time Series Decomposition:</strong> Decompose the data into trend, seasonality, and residual components to better understand its structure.</div>
                  <div>- <strong>Stationarity Check:</strong> Before forecasting, test if the series is stationary (e.g., using an ADF test) and apply differencing if needed.</div>
                  <div>- <strong>Forecasting Models:</strong> Utilize models like ARIMA, Prophet, or exponential smoothing to forecast future values based on the detected trend.</div>
                </>
              )}
              {insight.type === "correlation" && (
                <>
                  <div>- <strong>Causality Warning:</strong> Remember that correlation does not imply causation. Investigate for confounding variables that might be influencing both columns.</div>
                  <div>- <strong>Regression Analysis:</strong> Build a simple linear regression model to quantify the relationship and check the R-squared value to see how much variance is explained.</div>
                  <div>- <strong>Multicollinearity:</strong> If using both variables in a model, be aware of multicollinearity, which can destabilize coefficient estimates. Consider removing one variable or using dimensionality reduction techniques like PCA.</div>
                </>
              )}
              {insight.type === "quality" && (
                <>
                    <div>- <strong>Imputation Strategies:</strong> For missing data, consider mean/median/mode imputation for simple cases. For more complex patterns, explore k-NN or MICE imputation.</div>
                    <div>- <strong>Impact Analysis:</strong> Analyze if missingness is random (MCAR) or systematic (MAR/MNAR). Systematic missingness can introduce bias.</div>
                    <div>- <strong>Data Source Inspection:</strong> High missingness or high cardinality can indicate problems with data collection or joins. Review the upstream data pipeline.</div>
                </>
              )}
              {insight.type === "segmentation" && (
                <>
                  <div>- <strong>Group-by Analysis:</strong> Compare key performance indicators (KPIs) across the dominant segment versus other segments to uncover differences in behavior.</div>
                  <div>- <strong>Targeted Strategies:</strong> Develop marketing campaigns, product features, or support models specifically for this large, homogeneous group.</div>
                  <div>- <strong>Predictive Modeling:</strong> Consider building a classification model to predict which segment a new user will belong to.</div>
                </>
              )}
              {insight.type === "recommendation" && (
                <>
                    <div>- <strong>Transformation Choice:</strong> For skewed data, a log transform works well for right-skewed data. A Box-Cox transform can find an optimal transformation automatically.</div>
                    <div>- <strong>Scaling vs. Normalization:</strong> Use `StandardScaler` if you assume the data is normally distributed (or for algorithms that do, like SVMs). Use `MinMaxScaler` if you want to preserve relationships and scale to a fixed range [0, 1].</div>
                    <div>- <strong>Feature Creation:</strong> Beyond interactions, consider creating polynomial features (e.g., `age^2`) to capture non-linear effects or binning numeric features to create categorical ones.</div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-xs text-gray-400">
          <div>Meta: {insight.meta ? JSON.stringify(Object.fromEntries(Object.entries(insight.meta).slice(0, 5))) : "{}"}</div>
        </div>
      </motion.div>
    </div>
  );
};

/* ===========================
   The main AIInsights component
   =========================== */

const AIInsights: React.FC = () => {
  const ctx = useDataContext() as any;
  
  // Debug: Log when component renders
  console.log("AIInsights component rendered:", { 
    hasDataset: !!ctx.dataset, 
    dataLength: ctx.dataset?.data?.length,
    updateCounter: ctx.updateCounter 
  });
  
  // Force re-render when update counter changes
  useEffect(() => {
    console.log("AIInsights: Update counter changed to:", ctx.updateCounter);
  }, [ctx.updateCounter]);
  
  // Force re-render when dataset data changes
  useEffect(() => {
    console.log("AIInsights: Dataset data length changed to:", ctx.dataset?.data?.length);
  }, [ctx.dataset?.data?.length]);

  const { rows, columns, numericColumns, categoricalColumns } = useNormalizedData();

  // local UI state
  const [query, setQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ id?: string; answer: string; explanation?: string; calculations?: any[]; sources?: string[]; meta?: any } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<InsightType | "all">("all");
  const [importanceFilter, setImportanceFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [sortBy, setSortBy] = useState<"confidence" | "importance" | "type">("confidence");
  const [collapsedTypes, setCollapsedTypes] = useState<Record<string, boolean>>({});
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);

  // Build insights when data changes
  useEffect(() => {
    const list = buildInsights(rows, numericColumns, categoricalColumns, columns);
    setInsights(list);
  }, [rows, numericColumns, categoricalColumns, columns]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        if (!isFirebaseConfigured || !auth) return;
        const u = auth.currentUser;
        if (!u) return;
        const token = await u.getIdToken();
        const r = await fetch(`${API_BASE}/api/ai-insights/history?limit=20`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const j = await r.json();
          setHistory(j);
        }
      } catch {}
    };
    fetchHistory();
  }, []);

  // Filtering / searching / sorting
  const filtered = useMemo(() => {
    let items = insights.slice();
    if (filterType !== "all") items = items.filter((i) => i.type === filterType);
    if (importanceFilter !== "all") items = items.filter((i) => i.importance === importanceFilter);
    if (query.trim() !== "") {
      const q = query.toLowerCase();
      items = items.filter((i) => (i.title + " " + i.description).toLowerCase().includes(q));
    }
    // sort
    if (sortBy === "confidence") items.sort((a, b) => b.confidence - a.confidence);
    else if (sortBy === "importance")
      items.sort((a, b) => {
        const score = (imp: string) => (imp === "high" ? 3 : imp === "medium" ? 2 : 1);
        return score(b.importance) - score(a.importance);
      });
    else if (sortBy === "type") items.sort((a, b) => a.type.localeCompare(b.type));
    return items;
  }, [insights, filterType, importanceFilter, query, sortBy]);

  // counts
  const counts = useMemo(() => {
    return {
      total: insights.length,
      high: insights.filter((i) => i.importance === "high").length,
      medium: insights.filter((i) => i.importance === "medium").length,
      low: insights.filter((i) => i.importance === "low").length,
      avgConfidence:
        insights.length === 0 ? 0 : insights.reduce((s, i) => s + (i.confidence || 0), 0) / insights.length,
    };
  }, [insights]);

  const toggleCollapse = (type: string) => {
    setCollapsedTypes((c) => ({ ...c, [type]: !c[type] }));
  };

  const openDrill = (ins: Insight) => {
    setSelectedInsight(ins);
    setModalOpen(true);
  };

  const closeDrill = () => {
    setModalOpen(false);
    setSelectedInsight(null);
  };

  const runSearch = useCallback(async () => {
    try {
      // Validate query
      if (!query || query.trim().length === 0) {
        setAiError('Please enter a question before asking AI');
        return;
      }
      
      setAiError(null);
      setAiLoading(true);
      setAiResult(null);
      const payload: any = { query: query.trim() };
      
      // Send dataset data directly if available (for client-side processed datasets)
      if (ctx?.dataset?.data) {
        payload.datasetData = {
          data: ctx.dataset.data,
          columns: ctx.dataset.columns
        };
      } else if (ctx?.dataset?.id) {
        payload.datasetId = ctx.dataset.id;
      }
      
      // Try the simple QA endpoint first (no auth required)
      console.log('🔍 AI Debug - Making request to:', `${API_BASE}/api/qa`);
      console.log('🔍 AI Debug - Payload:', JSON.stringify(payload, null, 2));
      
      const r = await fetch(`${API_BASE}/api/qa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let data;
      if (r.ok) {
        data = await r.json();
        console.log('✅ AI Debug - Response received:', data);
      } else {
        console.error('❌ AI Debug - Request failed:', {
          status: r.status,
          statusText: r.statusText,
          url: `${API_BASE}/api/qa`
        });
        // Fallback to the original endpoint if simple one fails
        const token = isFirebaseConfigured && auth && auth.currentUser ? await auth.currentUser.getIdToken() : null;
        const r2 = await fetch(`${API_BASE}/api/ai-insights/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!r2.ok) {
          throw new Error(`HTTP ${r2.status}: ${r2.statusText}`);
        }
        data = await r2.json();
      }
      
      setAiResult(data);
      setAiLoading(false);
      
      // Try to fetch history
      try {
        if (isFirebaseConfigured && auth && auth.currentUser) {
          const token2 = await auth.currentUser.getIdToken();
          const rh = await fetch(`${API_BASE}/api/ai-insights/history?limit=20`, { headers: { Authorization: `Bearer ${token2}` } });
          if (rh.ok) setHistory(await rh.json());
        }
      } catch {}
      
    } catch (e: any) {
      setAiError(e?.message || "Request failed");
      setAiLoading(false);
    }
  }, [query, ctx, API_BASE, isFirebaseConfigured, auth]);

  /* UI helpers */
  const getIcon = (type: InsightType) => {
    switch (type) {
      case "anomaly":
        return AlertTriangle;
      case "trend":
        return TrendingUp;
      case "correlation":
        return Target;
      case "recommendation":
        return Lightbulb;
      case "quality":
        return Zap;
      case "categorical":
        return Columns;
      case "segmentation":
        return FileText;
      default:
        return Brain;
    }
  };

  const importanceClass = (imp: Insight["importance"]) => {
    switch (imp) {
      case "high":
        return "border-red-500 bg-red-500/10 text-red-400";
      case "medium":
        return "border-yellow-500 bg-yellow-500/10 text-yellow-400";
      case "low":
      default:
        return "border-blue-500 bg-blue-500/10 text-blue-400";
    }
  };

  const confidenceColor = (c: number) => {
    if (c >= 0.8) return "text-green-400";
    if (c >= 0.6) return "text-yellow-400";
    return "text-red-400";
  };

  /* Small Insight Card */
  const InsightCard: React.FC<{ insight: Insight; index: number }> = ({ insight, index }) => {
    const Icon = getIcon(insight.type as InsightType);
    const impClass = importanceClass(insight.importance);

    return (
      <motion.div
        key={insight.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: index * 0.03 }}
        className={`bg-gray-800/30 backdrop-blur-sm rounded-lg p-5 border ${impClass} hover:scale-[1.02] transition-transform duration-200 cursor-pointer group`}
        onClick={() => openDrill(insight)}
      >
        <div className="flex items-start gap-4">
          <div className={`p-2 rounded-lg ${impClass}`}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-white group-hover:text-blue-300 transition-colors">
                  {insight.title}
                </h4>
                <p className="text-xs text-gray-300 mt-2 line-clamp-3">{insight.description}</p>
              </div>

              <div className="flex-shrink-0 text-right">
                <div className="flex items-center gap-2">
                  <Star className={`h-4 w-4 ${confidenceColor(insight.confidence)}`} />
                  <div className={`text-xs font-medium ${confidenceColor(insight.confidence)}`}>
                    {Math.round((insight.confidence || 0) * 100)}%
                  </div>
                </div>

                <div className="mt-2 text-xs">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${impClass}`}>{insight.importance}</span>
                </div>
              </div>
            </div>

            {/* optional meta sparkline for trend or numeric insights */}
            {insight.meta?.series && Array.isArray(insight.meta.series) && insight.meta.series.length > 0 && (
              <div className="mt-3">
                <Sparkline data={insight.meta.series.slice(-30)} color={PALETTE[index % PALETTE.length]} />
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-gray-400">Type: {insight.type}</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openDrill(insight);
                  }}
                  className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-xs"
                >
                  Explore <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // placeholder for action
                    navigator.clipboard?.writeText(insight.title);
                  }}
                  className="text-gray-400 hover:text-gray-200 text-xs"
                >
                  Copy title
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  /* ===========================
     Render
     =========================== */

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="bg-gray-800/30 backdrop-blur-sm rounded-lg p-5 border border-gray-700">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Brain className="h-7 w-7 text-purple-400" />
              <div>
                <h2 className="text-xl font-bold text-white">AI Insights</h2>
                <p className="text-xs text-gray-400">Data-driven observations, recommendations and actions based on your uploaded dataset.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs text-gray-400">Avg Confidence</div>
              <div className="text-sm font-bold text-white">{Math.round((counts.avgConfidence || 0) * 100)}%</div>
              <button
                onClick={() => {
                  // export summarized insights as JSON
                  const payload = JSON.stringify({ insights, generatedAt: new Date().toISOString() }, null, 2);
                  const blob = new Blob([payload], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `insights-${Date.now()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="ml-2 px-3 py-1 rounded-lg bg-[#0B1220] border border-gray-700 text-xs flex items-center gap-2"
                title="Export insights"
              >
                <Download className="h-4 w-4 text-gray-300" /> Export
              </button>
            </div>
          </div>

          {/* filters row */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search insights..."
                className="w-full bg-[#0B0E13] border border-gray-800 rounded-lg py-2 px-3 text-sm text-gray-200 focus:outline-none"
              />
              <Search className="absolute right-3 top-2.5 text-gray-400" />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="bg-[#0B0E13] border border-gray-800 rounded-lg py-2 px-3 text-sm text-gray-200 focus:outline-none"
              >
                <option value="all">All types</option>
                <option value="anomaly">Anomalies</option>
                <option value="trend">Trends</option>
                <option value="correlation">Correlations</option>
                <option value="recommendation">Recommendations</option>
                <option value="quality">Quality</option>
                <option value="categorical">Categorical</option>
                <option value="segmentation">Segmentation</option>
              </select>

              <select
                value={importanceFilter}
                onChange={(e) => setImportanceFilter(e.target.value as any)}
                className="bg-[#0B0E13] border border-gray-800 rounded-lg py-2 px-3 text-sm text-gray-200 focus:outline-none"
              >
                <option value="all">All priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-[#0B0E13] border border-gray-800 rounded-lg py-2 px-3 text-sm text-gray-200 focus:outline-none"
              >
                <option value="confidence">Sort: Confidence</option>
                <option value="importance">Sort: Importance</option>
                <option value="type">Sort: Type</option>
              </select>
              <button onClick={runSearch} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs">Ask AI</button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Overview tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#0E1113] border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-400">Total Insights</div>
          <div className="text-2xl font-bold text-white">{counts.total}</div>
        </div>

        <div className="bg-[#0E1113] border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-400">High priority</div>
          <div className="text-2xl font-bold text-red-400">{counts.high}</div>
        </div>

        <div className="bg-[#0E1113] border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-400">Medium priority</div>
          <div className="text-2xl font-bold text-yellow-400">{counts.medium}</div>
        </div>

        <div className="bg-[#0E1113] border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-400">Low priority</div>
          <div className="text-2xl font-bold text-blue-400">{counts.low}</div>
        </div>
      </div>

      {/* Insights grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {filtered.length === 0 ? (
            <div className="bg-[#0F1418] border border-gray-800 rounded-xl p-6 text-gray-400">
              No insights match your filters/search.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filtered.map((ins, idx) => (
                <InsightCard key={ins.id} insight={ins} index={idx} />
              ))}
            </div>
          )}
        </div>

        {/* Right rail: details & quick charts */}
        <div className="space-y-4">
          <div className="bg-[#0F1418] border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Quick Stats</h4>
                <p className="text-xs text-gray-400">Snapshot of dataset health & suggestions</p>
              </div>
              <div>
                <button
                  onClick={() => {
                    // refresh insights manually
                    const list = buildInsights(rows, numericColumns, categoricalColumns, columns);
                    setInsights(list);
                  }}
                  className="p-2 rounded-lg bg-[#0B1220] border border-gray-700 text-gray-300"
                  title="Refresh insights"
                >
                  <Zap className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Rows x Columns</span>
                <span className="text-white font-mono">{rows.length} x {columns.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Numeric Columns</span>
                <span className="text-white font-mono">{numericColumns.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Categorical Columns</span>
                <span className="text-white font-mono">{categoricalColumns.length}</span>
              </div>
            </div>
          </div>

          <div className="bg-[#0F1418] border border-gray-800 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-white">AI Answer</h4>
            {aiLoading ? (
              <div className="mt-3 text-xs text-gray-400">Loading...</div>
            ) : aiError ? (
              <div className="mt-3 text-xs text-red-400">{aiError}</div>
            ) : aiResult ? (
              <div className="mt-3 space-y-3 text-xs text-gray-200">
                <div className="text-sm text-white">{aiResult.answer}</div>
                {aiResult.explanation && <div className="text-gray-300">{aiResult.explanation}</div>}
                {Array.isArray(aiResult.calculations) && aiResult.calculations.length > 0 && (
                  <div>
                    <div className="text-gray-300 mb-2">Calculations</div>
                    <div className="overflow-auto max-h-48">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            {Object.keys(aiResult.calculations[0]).slice(0, 6).map((k) => (
                              <th key={k} className="p-1">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {aiResult.calculations.map((r, i) => (
                            <tr key={i} className="border-t border-gray-800">
                              {Object.keys(r).slice(0, 6).map((k) => (
                                <td key={k} className="p-1 text-gray-200">{String((r as any)[k])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {Array.isArray(aiResult.sources) && aiResult.sources.length > 0 && (
                  <div>
                    <div className="text-gray-300 mb-1">Sources</div>
                    <ul className="list-disc ml-5 space-y-1">
                      {aiResult.sources.map((s, i) => (
                        <li key={i} className="text-gray-300 break-all">{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={async () => {
                      try {
                        if (!(isFirebaseConfigured && auth && auth.currentUser) || !aiResult?.id) return;
                        const token = await auth.currentUser.getIdToken();
                        await fetch(`${API_BASE}/api/ai-insights/feedback`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ queryId: aiResult.id, rating: 1 }),
                        });
                      } catch {}
                    }}
                    className="px-2 py-1 rounded bg-green-600 text-white text-xs"
                  >
                    👍
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        if (!(isFirebaseConfigured && auth && auth.currentUser) || !aiResult?.id) return;
                        const token = await auth.currentUser.getIdToken();
                        await fetch(`${API_BASE}/api/ai-insights/feedback`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ queryId: aiResult.id, rating: 0 }),
                        });
                      } catch {}
                    }}
                    className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                  >
                    👎
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-gray-400">Ask a question to get AI assistance.</div>
            )}
          </div>

          <div className="bg-[#0F1418] border border-gray-800 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-white">Insight Distribution</h4>
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={Object.entries(insights.reduce((acc, i) => ({...acc, [i.type]: (acc[i.type] || 0) + 1}), {} as Record<string, number>)).map(([name, value]) => ({ name, value }))}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                  <Tooltip cursor={{fill: 'rgba(156, 163, 175, 0.1)'}} contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #4B5563', borderRadius: '0.5rem' }} />
                  <Bar dataKey="value" >
                    {Object.entries(insights.reduce((acc, i) => ({...acc, [i.type]: (acc[i.type] || 0) + 1}), {} as Record<string, number>)).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Drilldown modal */}
      <DrilldownModal open={modalOpen} onClose={closeDrill} insight={selectedInsight} rows={rows} />

      <div className="bg-[#0F1418] border border-gray-800 rounded-xl p-4 mt-6">
        <h4 className="text-sm font-semibold text-white">AI History</h4>
        <div className="mt-3 space-y-2 text-xs text-gray-200">
          {history.length === 0 ? (
            <div className="text-gray-400">No history</div>
          ) : (
            history.map((h) => (
              <div key={h.id} className="border-b border-gray-800 pb-2">
                <div className="text-white">{h.query}</div>
                <div className="text-gray-400">{String(h.answer || '').slice(0, 160)}</div>
                <div className="text-gray-500">{h.createdAt}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AIInsights;
