import React, { useState, useEffect, useReducer, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Download, X, RefreshCw, Loader } from "lucide-react";
import { useInView } from "react-intersection-observer";
import { useDataContext } from "../context/DataContext";
import { Responsive, WidthProvider } from "react-grid-layout";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Legend, RadarChart, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Radar, Treemap, ComposedChart, ScatterChart, Scatter, Brush
} from "recharts";

// Simple deep equality check (replaces lodash.isequal)
const isEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!isEqual(a[key], b[key])) return false;
  }
  return true;
};
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

/**
 * ============================================================================================
 * Super-Advanced Visualization Component
 *
 * - 🧠 Off-thread Processing: Uses a Web Worker for all heavy data computations.
 * - 🧊 Dynamic Grid Layout: Draggable and resizable charts with persistent layouts.
 * - 🔗 Cross-Filtering: Clicking a data point on one chart filters the entire dashboard.
 * - 🔍 Brushing & Zooming: Select a range on time-series charts to zoom in.
 * - ⚙️ Configuration-Driven: Charts are defined by a config object for easy extension.
 * - ✨ Rich Interactivity: Glow effects, loading states, and filter management UI.
 * ============================================================================================
 */

/* ============================
   Type Definitions
   ============================ */
type DataRow = Record<string, any>;
type ChartDataPoint = { name: string; value: number; size: number; };
type AggregationMethod = "none" | "sum" | "average" | "count" | "min" | "max";
type SortKey = "x" | "y";
type SortDirection = "asc" | "desc";
type ColorPalette = "vibrant" | "cool" | "forest" | "sunset";
type ChartType = "bar" | "line" | "area" | "pie" | "combo" | "radar" | "treemap" | "scatter";
type Filter = { column: string; value: any; type: 'categorical' | 'range'; };

interface ChartState {
  xAxis: string;
  yAxis: string;
  aggregation: AggregationMethod;
  sortKey: SortKey;
  sortDirection: SortDirection;
  colorPalette: ColorPalette;
  filters: Filter[];
  layout: ReactGridLayout.Layouts;
  isProcessing: boolean;
}

type ChartAction =
  | { type: "SET_AXIS"; payload: { axis: 'x' | 'y'; value: string } }
  | { type: "SET_AGGREGATION"; payload: AggregationMethod }
  | { type: "SET_SORT"; payload: { key: SortKey; direction: SortDirection } }
  | { type: "SET_PALETTE"; payload: ColorPalette }
  | { type: "ADD_FILTER"; payload: Filter }
  | { type: "REMOVE_FILTER"; payload: { column: string } }
  | { type: "SET_RANGE_FILTER"; payload: { column: string; value: [any, any] } }
  | { type: "RESET_FILTERS" }
  | { type: "INIT_STATE"; payload: Partial<ChartState> }
  | { type: "SET_LAYOUT"; payload: ReactGridLayout.Layouts }
  | { type: "SET_PROCESSING"; payload: boolean };

/* ============================
   Constants & Palettes
   ============================ */
const COLOR_PALETTES: Record<ColorPalette, string[]> = {
  vibrant: ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4"],
  cool: ["#06B6D4", "#3B82F6", "#6366F1", "#A78BFA", "#C084FC", "#34D399"],
  forest: ["#10B981", "#22C55E", "#84CC16", "#F59E0B", "#65A30D", "#15803D"],
  sunset: ["#F97316", "#EF4444", "#EC4899", "#D946EF", "#F59E0B", "#E11D48"],
};

const INITIAL_LAYOUTS = {
  lg: [
    { i: 'bar', x: 0, y: 0, w: 6, h: 8 }, { i: 'line', x: 6, y: 0, w: 6, h: 8 },
    { i: 'area', x: 0, y: 8, w: 6, h: 8 }, { i: 'pie', x: 6, y: 8, w: 3, h: 8 },
    { i: 'radar', x: 9, y: 8, w: 3, h: 8 }, { i: 'combo', x: 0, y: 16, w: 12, h: 8 },
  ],
};

/* ============================
   Reducer Implementation
   ============================ */
const chartStateReducer = (state: ChartState, action: ChartAction): ChartState => {
  switch (action.type) {
    case "SET_AXIS": {
        const { axis, value } = action.payload;
        if (axis === 'x' && value === state.yAxis) return { ...state, xAxis: value, yAxis: state.xAxis };
        if (axis === 'y' && value === state.xAxis) return { ...state, yAxis: value, xAxis: state.yAxis };
        return { ...state, [axis === 'x' ? 'xAxis' : 'yAxis']: value };
    }
    case "SET_AGGREGATION": return { ...state, aggregation: action.payload };
    case "SET_SORT": return { ...state, sortKey: action.payload.key, sortDirection: action.payload.direction };
    case "SET_PALETTE": return { ...state, colorPalette: action.payload };
    case "ADD_FILTER": {
      const newFilters = state.filters.filter(f => f.column !== action.payload.column);
      return { ...state, filters: [...newFilters, action.payload] };
    }
    case "REMOVE_FILTER": return { ...state, filters: state.filters.filter(f => f.column !== action.payload.column) };
    case "SET_RANGE_FILTER": {
      const newFilters = state.filters.filter(f => f.column !== action.payload.column);
      return { ...state, filters: [...newFilters, { ...action.payload, type: 'range'}] };
    }
    case "RESET_FILTERS": return { ...state, filters: [] };
    case "INIT_STATE": return { ...state, ...action.payload };
    case "SET_LAYOUT": return { ...state, layout: action.payload };
    case "SET_PROCESSING": return { ...state, isProcessing: action.payload };
    default: return state;
  }
};

/* ============================
   Custom Hooks
   ============================ */

/**
 * useDataProcessor - Custom hook to manage the Web Worker for data processing.
 */
const useDataProcessor = (onDataProcessed: (data: ChartDataPoint[]) => void, onProcessingChange: (isProcessing: boolean) => void) => {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize the worker
    workerRef.current = new Worker('/data.worker.js');
    
    workerRef.current.onmessage = (event) => {
      const { status, data, error } = event.data;
      if (status === "success") {
        onDataProcessed(data);
      } else {
        console.error("Worker Error:", error);
      }
      onProcessingChange(false);
    };
    
    // Cleanup
    return () => workerRef.current?.terminate();
  }, [onDataProcessed, onProcessingChange]);

  const processData = useCallback((data: DataRow[], config: any) => {
    if (workerRef.current) {
        onProcessingChange(true);
        workerRef.current.postMessage({ data, config });
    }
  }, [onProcessingChange]);

  return { processData };
};

/* ============================
   UI Components
   ============================ */

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 text-sm shadow-lg">
        <p className="font-bold text-white mb-1">{label}</p>
        {payload.map((pld: any, index: number) => (
          <p key={index} style={{ color: pld.color || "#FFFFFF" }} className="text-sm">
            {`${pld.name}: ${Number(pld.value).toLocaleString()}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const ChartWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.1 });
  return (
    <div ref={ref} className="h-full w-full">
      {inView ? children : <div className="flex items-center justify-center h-full text-gray-500">Loading Chart...</div>}
    </div>
  );
};

/* ============================
   Main Visualizations Component
   ============================ */
const Visualizations: React.FC = () => {
  const { dataset } = useDataContext();

  const initialState: ChartState = {
    xAxis: "", yAxis: "", aggregation: "sum", sortKey: "y", sortDirection: "desc",
    colorPalette: "vibrant", filters: [], layout: INITIAL_LAYOUTS, isProcessing: false,
  };

  const [state, dispatch] = useReducer(chartStateReducer, initialState);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [activeItem, setActiveItem] = useState<{ type: string; index: number | null }>({ type: '', index: null });

  // Memoize column types to avoid re-calculation
  const { allColumns, numericColumns, categoricalColumns } = useMemo(() => {
    if (!dataset?.columns) return { allColumns: [], numericColumns: [], categoricalColumns: [] };
    const numeric: string[] = [];
    const categorical: string[] = [];
    const sample = dataset.data?.[0] || {};
    for (const col of dataset.columns) {
      if (typeof sample[col.name] === 'number') numeric.push(col.name);
      else categorical.push(col.name);
    }
    return { allColumns: dataset.columns.map(c => c.name), numericColumns: numeric, categoricalColumns: categorical };
  }, [dataset]);
  
  // Initialize axes on dataset load
  useEffect(() => {
    if (allColumns.length > 0 && !state.xAxis) {
      const initialX = categoricalColumns[0] || allColumns[0];
      const initialY = numericColumns[0] || allColumns[1] || allColumns[0];
      dispatch({ type: "INIT_STATE", payload: { xAxis: initialX, yAxis: initialY } });
    }
  }, [allColumns, categoricalColumns, numericColumns, state.xAxis]);

  // Setup Web Worker communication
  const { processData } = useDataProcessor(
    useCallback((data) => setChartData(data), []),
    useCallback((isProcessing) => dispatch({ type: "SET_PROCESSING", payload: isProcessing }), [])
  );

  // Trigger data processing in the worker when dependencies change
  useEffect(() => {
    if (dataset?.data && state.xAxis && state.yAxis) {
      const config = {
        xAxis: state.xAxis, yAxis: state.yAxis, aggregation: state.aggregation, filters: state.filters,
        sortKey: state.sortKey, sortDirection: state.sortDirection, numericColumns
      };
      processData(dataset.data, config);
    }
  }, [dataset?.data, state.xAxis, state.yAxis, state.aggregation, state.filters, state.sortKey, state.sortDirection, numericColumns, processData]);

  // --- INTERACTIVITY HANDLERS ---
  const handleBarClick = (data: any) => {
    if (data?.activePayload?.[0]?.payload?.name) {
      dispatch({ type: "ADD_FILTER", payload: { column: state.xAxis, value: data.activePayload[0].payload.name, type: 'categorical' } });
    }
  };
  
  const handlePieClick = (data: any) => {
     if (data?.name) {
      dispatch({ type: "ADD_FILTER", payload: { column: state.xAxis, value: data.name, type: 'categorical' } });
    }
  };

  const handleBrushChange = (range: any) => {
    if (range.startIndex !== undefined && range.endIndex !== undefined && chartData[range.startIndex] && chartData[range.endIndex]) {
        const startValue = chartData[range.startIndex].name;
        const endValue = chartData[range.endIndex].name;
        dispatch({ type: 'SET_RANGE_FILTER', payload: { column: state.xAxis, value: [startValue, endValue] }});
    }
  };

  const handleReset = () => dispatch({ type: 'RESET_FILTERS' });
  const handleLayoutChange = (_: any, allLayouts: ReactGridLayout.Layouts) => {
    if (!isEqual(allLayouts, state.layout)) {
      dispatch({ type: "SET_LAYOUT", payload: allLayouts });
    }
  };

  // --- CHART RENDERING ---
  const chartConfigs: { id: ChartType; title: string; component: React.ReactNode }[] = [
    { id: 'bar', title: 'Bar Chart', component: <BarChart data={chartData} onClick={handleBarClick}>
        <CartesianGrid stroke="#1F2937" />
        <XAxis dataKey="name" stroke="#9CA3AF" />
        <YAxis stroke="#9CA3AF" />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="value" name={state.yAxis}>
          {chartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLOR_PALETTES[state.colorPalette][index % COLOR_PALETTES[state.colorPalette].length]} />)}
        </Bar>
      </BarChart> },
    { id: 'area', title: 'Area Chart with Zoom', component: <AreaChart data={chartData}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COLOR_PALETTES[state.colorPalette][1]} stopOpacity={0.8}/>
            <stop offset="95%" stopColor={COLOR_PALETTES[state.colorPalette][1]} stopOpacity={0.1}/>
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1F2937" />
        <XAxis dataKey="name" stroke="#9CA3AF" />
        <YAxis stroke="#9CA3AF" />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="value" stroke={COLOR_PALETTES[state.colorPalette][1]} fill="url(#areaGrad)" />
        <Brush dataKey="name" height={30} stroke="#3B82F6" onMouseUp={handleBrushChange} />
      </AreaChart> },
    { id: 'line', title: 'Line Chart', component: <LineChart data={chartData}>
        <CartesianGrid stroke="#1F2937" />
        <XAxis dataKey="name" stroke="#9CA3AF" />
        <YAxis stroke="#9CA3AF" />
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey="value" stroke={COLOR_PALETTES[state.colorPalette][2]} strokeWidth={2} dot={false} />
      </LineChart> },
    { id: 'pie', title: 'Pie Chart', component: <PieChart>
        <Tooltip content={<CustomTooltip />} />
        <Pie data={chartData.slice(0, 8)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} onClick={handlePieClick}>
          {chartData.slice(0, 8).map((_, index) => <Cell key={`cell-${index}`} fill={COLOR_PALETTES[state.colorPalette][index % COLOR_PALETTES[state.colorPalette].length]} />)}
        </Pie>
        <Legend />
      </PieChart> },
    // Add other chart configs here (Radar, Combo, etc.) in the same pattern
  ];


  return (
    <div className="space-y-6 p-4 md:p-6 relative">
      <AnimatePresence>
        {state.isProcessing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-4 text-white">
              <Loader className="animate-spin h-10 w-10" />
              <span className="text-lg font-semibold">Processing Data...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* --- HEADER & CONTROLS --- */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700">
        <h2 className="text-2xl font-bold text-white mb-4">Advanced Analytics Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {/* Control Selects: X-Axis, Y-Axis, Aggregation, etc. */}
            <div>
              <label className="text-xs font-medium text-gray-400">X-Axis</label>
              <select value={state.xAxis} onChange={e => dispatch({type: 'SET_AXIS', payload: {axis: 'x', value: e.target.value}})} className="w-full bg-gray-700 border-gray-600 text-white rounded p-2 mt-1">
                {allColumns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400">Y-Axis</label>
              <select value={state.yAxis} onChange={e => dispatch({type: 'SET_AXIS', payload: {axis: 'y', value: e.target.value}})} className="w-full bg-gray-700 border-gray-600 text-white rounded p-2 mt-1">
                {numericColumns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400">Aggregation</label>
              <select value={state.aggregation} onChange={e => dispatch({type: 'SET_AGGREGATION', payload: e.target.value as AggregationMethod})} className="w-full bg-gray-700 border-gray-600 text-white rounded p-2 mt-1">
                <option value="sum">Sum</option>
                <option value="average">Average</option>
                <option value="count">Count</option>
                <option value="none">None</option>
              </select>
            </div>
             <div>
              <label className="text-xs font-medium text-gray-400">Sort By</label>
              <select value={`${state.sortKey}-${state.sortDirection}`} onChange={(e) => { const [k, d] = e.target.value.split("-"); dispatch({ type: "SET_SORT", payload: { key: k as SortKey, direction: d as SortDirection } }); }} className="w-full bg-gray-700 border border-gray-600 text-white rounded p-2 mt-1">
                  <option value="y-desc">Value (High→Low)</option>
                  <option value="y-asc">Value (Low→High)</option>
                  <option value="x-asc">Category (A→Z)</option>
                  <option value="x-desc">Category (Z→A)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400">Color Palette</label>
              <select value={state.colorPalette} onChange={(e) => dispatch({ type: "SET_PALETTE", payload: e.target.value as ColorPalette })} className="w-full bg-gray-700 border border-gray-600 text-white rounded p-2 mt-1">
                  <option value="vibrant">Vibrant</option>
                  <option value="cool">Cool</option>
                  <option value="forest">Forest</option>
                  <option value="sunset">Sunset</option>
              </select>
            </div>
        </div>

        {/* --- ACTIVE FILTERS --- */}
        <AnimatePresence>
            {state.filters.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-4 pt-4 border-t border-gray-700 flex items-center gap-4 flex-wrap">
                    <h3 className="text-sm font-semibold text-white">Active Filters:</h3>
                    {state.filters.map(filter => (
                        <motion.div key={filter.column} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 bg-blue-600/30 text-blue-100 text-xs px-2 py-1 rounded-full">
                            <span>{filter.column}: <strong>{Array.isArray(filter.value) ? 'Range Selected' : filter.value}</strong></span>
                            <button onClick={() => dispatch({type: 'REMOVE_FILTER', payload: {column: filter.column}})} className="hover:bg-white/20 rounded-full p-0.5">
                                <X size={12} />
                            </button>
                        </motion.div>
                    ))}
                    <button onClick={handleReset} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 font-semibold ml-auto">
                        <RefreshCw size={12} /> Reset All
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
      </motion.div>

      {/* --- GRID LAYOUT --- */}
      <ResponsiveGridLayout
        className="layout"
        layouts={state.layout}
        onLayoutChange={handleLayoutChange}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={30}
        draggableHandle=".drag-handle"
      >
        {chartConfigs.map(config => (
          <div key={config.id} className="bg-gray-800/30 rounded-xl border border-gray-700 overflow-hidden">
            <div className="p-4 h-full flex flex-col">
              <h3 className="text-white font-semibold mb-2 drag-handle cursor-move">{config.title}</h3>
              <div className="flex-grow">
                 <ChartWrapper>
                    <ResponsiveContainer width="100%" height="100%">
                        {config.component}
                    </ResponsiveContainer>
                 </ChartWrapper>
              </div>
            </div>
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
};

export default Visualizations;