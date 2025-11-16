import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ZoomIn, 
  ZoomOut, 
  Grid3X3, 
  BarChart3, 
  Layers, 
  Search, 
  Filter,
  Download,
  Maximize2,
  Settings,
  Eye,
  RefreshCw
} from 'lucide-react';
import { useDataContext } from '../context/DataContext';

// ============================================================================================
// TYPES & INTERFACES
// ============================================================================================

interface DataPoint {
  id: string;
  x: number;
  y: number;
  value: any;
  originalRow: Record<string, any>;
  color?: string;
  size?: number;
}

interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface VisualizationMode {
  id: string;
  name: string;
  icon: React.ElementType;
  description: string;
}

interface HeatmapCell {
  x: number;
  y: number;
  value: number;
  count: number;
  color: string;
}

// ============================================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================================

const VISUALIZATION_MODES: VisualizationMode[] = [
  { id: 'heatmap', name: 'Density Heatmap', icon: Grid3X3, description: 'Color-coded density visualization' },
  { id: 'scatter', name: 'Scatter Plot', icon: BarChart3, description: 'Point-based scatter visualization' },
  { id: 'grid', name: 'Data Grid', icon: Layers, description: 'Virtualized table view' }
];

const CANVAS_CONFIG = {
  POINT_SIZE: 3,
  HOVER_RADIUS: 8,
  GRID_SIZE: 50,
  MAX_VISIBLE_POINTS: 5000,
  ZOOM_SENSITIVITY: 0.001,
  PAN_SENSITIVITY: 1,
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 10
};

const COLOR_SCALES = {
  viridis: ['#440154', '#31688e', '#35b779', '#fde725'],
  plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89441', '#f0f921'],
  cool: ['#00ffff', '#0080ff', '#8000ff', '#ff00ff'],
  warm: ['#ffff00', '#ff8000', '#ff0000', '#800000']
};

// ============================================================================================
// UTILITY FUNCTIONS
// ============================================================================================

const isNumeric = (value: any): boolean => {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
};

const normalizeValue = (value: any, min: number, max: number): number => {
  if (!isNumeric(value)) return 0;
  if (max === min) return 0.5;
  return (value - min) / (max - min);
};

const getColorFromScale = (value: number, scale: string[]): string => {
  const clampedValue = Math.max(0, Math.min(1, value));
  const index = clampedValue * (scale.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  
  if (lowerIndex === upperIndex) return scale[lowerIndex];
  
  const ratio = index - lowerIndex;
  const lower = scale[lowerIndex];
  const upper = scale[upperIndex];
  
  // Simple color interpolation
  const r1 = parseInt(lower.slice(1, 3), 16);
  const g1 = parseInt(lower.slice(3, 5), 16);
  const b1 = parseInt(lower.slice(5, 7), 16);
  const r2 = parseInt(upper.slice(1, 3), 16);
  const g2 = parseInt(upper.slice(3, 5), 16);
  const b2 = parseInt(upper.slice(5, 7), 16);
  
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const createSpatialIndex = (points: DataPoint[], gridSize: number) => {
  const index = new Map<string, DataPoint[]>();
  
  points.forEach(point => {
    const gridX = Math.floor(point.x / gridSize);
    const gridY = Math.floor(point.y / gridSize);
    const key = `${gridX},${gridY}`;
    
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key)!.push(point);
  });
  
  return index;
};

// ============================================================================================
// VIRTUALIZED DATA GRID COMPONENT
// ============================================================================================

interface VirtualizedGridProps {
  data: Record<string, any>[];
  columns: string[];
  width: number;
  height: number;
  searchTerm: string;
}

const VirtualizedGrid: React.FC<VirtualizedGridProps> = memo(({ 
  data, 
  columns, 
  width, 
  height, 
  searchTerm 
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const ROW_HEIGHT = 35;
  const COLUMN_WIDTH = 120;
  const HEADER_HEIGHT = 40;
  
  const filteredData = useMemo(() => {
    if (!searchTerm) return data;
    return data.filter(row => 
      Object.values(row).some(value => 
        String(value).toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
  }, [data, searchTerm]);
  
  const visibleRowCount = Math.ceil((height - HEADER_HEIGHT) / ROW_HEIGHT) + 2;
  const visibleColumnCount = Math.ceil(width / COLUMN_WIDTH) + 2;
  const startRow = Math.floor(scrollTop / ROW_HEIGHT);
  const startColumn = Math.floor(scrollLeft / COLUMN_WIDTH);
  const endRow = Math.min(startRow + visibleRowCount, filteredData.length);
  const endColumn = Math.min(startColumn + visibleColumnCount, columns.length);
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
    setScrollLeft(target.scrollLeft);
  }, []);
  
  return (
    <div 
      ref={containerRef}
      className="relative overflow-auto bg-gray-900 border border-gray-700 rounded-lg"
      style={{ width, height }}
      onScroll={handleScroll}
    >
      {/* Virtual scrollable area */}
      <div 
        style={{ 
          width: columns.length * COLUMN_WIDTH,
          height: filteredData.length * ROW_HEIGHT + HEADER_HEIGHT
        }}
      >
        {/* Header */}
        <div 
          className="sticky top-0 z-10 bg-gray-800 border-b border-gray-600 flex"
          style={{ transform: `translateX(-${scrollLeft}px)` }}
        >
          {columns.slice(startColumn, endColumn).map((column, index) => (
            <div
              key={column}
              className="flex-shrink-0 px-3 py-2 text-sm font-semibold text-gray-200 border-r border-gray-600"
              style={{ 
                width: COLUMN_WIDTH,
                left: (startColumn + index) * COLUMN_WIDTH
              }}
            >
              {column}
            </div>
          ))}
        </div>
        
        {/* Rows */}
        <div style={{ paddingTop: HEADER_HEIGHT }}>
          {filteredData.slice(startRow, endRow).map((row, rowIndex) => (
            <div
              key={startRow + rowIndex}
              className="flex hover:bg-gray-800/50 border-b border-gray-800"
              style={{ 
                transform: `translateY(${(startRow + rowIndex) * ROW_HEIGHT}px) translateX(-${scrollLeft}px)`,
                position: 'absolute',
                top: 0,
                left: 0
              }}
            >
              {columns.slice(startColumn, endColumn).map((column, colIndex) => (
                <div
                  key={column}
                  className="flex-shrink-0 px-3 py-2 text-sm text-gray-300 border-r border-gray-800 truncate"
                  style={{ width: COLUMN_WIDTH }}
                  title={String(row[column] || '')}
                >
                  {String(row[column] || '')}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      
      {/* Scroll indicators */}
      <div className="absolute bottom-2 right-2 bg-gray-800/80 px-2 py-1 rounded text-xs text-gray-400">
        {startRow + 1}-{endRow} of {filteredData.length} rows
      </div>
    </div>
  );
});

// ============================================================================================
// CANVAS VISUALIZATION COMPONENT
// ============================================================================================

interface CanvasVisualizationProps {
  data: DataPoint[];
  mode: string;
  width: number;
  height: number;
  colorScale: string;
  onPointHover: (point: DataPoint | null) => void;
  onPointClick: (point: DataPoint) => void;
}

const CanvasVisualization: React.FC<CanvasVisualizationProps> = memo(({
  data,
  mode,
  width,
  height,
  colorScale,
  onPointHover,
  onPointClick
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const spatialIndexRef = useRef<Map<string, DataPoint[]>>(new Map());
  
  // Create spatial index for efficient point lookup
  useEffect(() => {
    spatialIndexRef.current = createSpatialIndex(data, CANVAS_CONFIG.GRID_SIZE);
  }, [data]);
  
  // Transform screen coordinates to data coordinates
  const screenToData = useCallback((screenX: number, screenY: number) => {
    return {
      x: (screenX - pan.x) / zoom,
      y: (screenY - pan.y) / zoom
    };
  }, [zoom, pan]);
  
  // Transform data coordinates to screen coordinates
  const dataToScreen = useCallback((dataX: number, dataY: number) => {
    return {
      x: dataX * zoom + pan.x,
      y: dataY * zoom + pan.y
    };
  }, [zoom, pan]);
  
  // Find points near cursor for hover detection
  const findNearbyPoints = useCallback((x: number, y: number, radius: number = CANVAS_CONFIG.HOVER_RADIUS): DataPoint[] => {
    const dataCoords = screenToData(x, y);
    const gridX = Math.floor(dataCoords.x / CANVAS_CONFIG.GRID_SIZE);
    const gridY = Math.floor(dataCoords.y / CANVAS_CONFIG.GRID_SIZE);
    
    const nearby: DataPoint[] = [];
    
    // Check surrounding grid cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gridX + dx},${gridY + dy}`;
        const points = spatialIndexRef.current.get(key) || [];
        
        points.forEach(point => {
          const screenPos = dataToScreen(point.x, point.y);
          const distance = Math.sqrt(
            Math.pow(screenPos.x - x, 2) + Math.pow(screenPos.y - y, 2)
          );
          
          if (distance <= radius) {
            nearby.push(point);
          }
        });
      }
    }
    
    return nearby;
  }, [screenToData, dataToScreen]);
  
  // Render visualization
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Calculate visible bounds
    const topLeft = screenToData(0, 0);
    const bottomRight = screenToData(width, height);
    
    if (mode === 'heatmap') {
      // Render heatmap
      const gridSize = Math.max(5, 20 / zoom);
      const heatmapData = new Map<string, { count: number; totalValue: number }>();
      
      // Aggregate data into grid cells
      data.forEach(point => {
        if (point.x >= topLeft.x && point.x <= bottomRight.x && 
            point.y >= topLeft.y && point.y <= bottomRight.y) {
          const gridX = Math.floor(point.x / gridSize);
          const gridY = Math.floor(point.y / gridSize);
          const key = `${gridX},${gridY}`;
          
          if (!heatmapData.has(key)) {
            heatmapData.set(key, { count: 0, totalValue: 0 });
          }
          
          const cell = heatmapData.get(key)!;
          cell.count++;
          cell.totalValue += isNumeric(point.value) ? point.value : 1;
        }
      });
      
      // Find max count for normalization
      const maxCount = Math.max(...Array.from(heatmapData.values()).map(cell => cell.count));
      
      // Render heatmap cells
      heatmapData.forEach((cell, key) => {
        const [gridX, gridY] = key.split(',').map(Number);
        const screenPos = dataToScreen(gridX * gridSize, gridY * gridSize);
        const cellSize = gridSize * zoom;
        
        const intensity = cell.count / maxCount;
        const color = getColorFromScale(intensity, COLOR_SCALES[colorScale as keyof typeof COLOR_SCALES]);
        
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(screenPos.x, screenPos.y, cellSize, cellSize);
      });
      
      ctx.globalAlpha = 1;
      
    } else if (mode === 'scatter') {
      // Render scatter plot
      const visiblePoints = data.filter(point => 
        point.x >= topLeft.x && point.x <= bottomRight.x && 
        point.y >= topLeft.y && point.y <= bottomRight.y
      );
      
      // Limit visible points for performance
      const pointsToRender = visiblePoints.slice(0, CANVAS_CONFIG.MAX_VISIBLE_POINTS);
      
      pointsToRender.forEach(point => {
        const screenPos = dataToScreen(point.x, point.y);
        const size = (point.size || CANVAS_CONFIG.POINT_SIZE) * Math.min(zoom, 2);
        
        ctx.fillStyle = point.color || getColorFromScale(
          normalizeValue(point.value, 0, 1), 
          COLOR_SCALES[colorScale as keyof typeof COLOR_SCALES]
        );
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, size, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
    
  }, [data, mode, width, height, zoom, pan, colorScale, screenToData, dataToScreen]);
  
  // Re-render when dependencies change
  useEffect(() => {
    render();
  }, [render]);
  
  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
  }, []);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (isDragging) {
      const deltaX = e.clientX - lastMousePos.x;
      const deltaY = e.clientY - lastMousePos.y;
      
      setPan(prev => ({
        x: prev.x + deltaX * CANVAS_CONFIG.PAN_SENSITIVITY,
        y: prev.y + deltaY * CANVAS_CONFIG.PAN_SENSITIVITY
      }));
      
      setLastMousePos({ x: e.clientX, y: e.clientY });
    } else {
      // Handle hover
      const nearbyPoints = findNearbyPoints(x, y);
      onPointHover(nearbyPoints.length > 0 ? nearbyPoints[0] : null);
    }
  }, [isDragging, lastMousePos, findNearbyPoints, onPointHover]);
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  const handleMouseClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const nearbyPoints = findNearbyPoints(x, y);
    if (nearbyPoints.length > 0) {
      onPointClick(nearbyPoints[0]);
    }
  }, [findNearbyPoints, onPointClick]);
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const zoomFactor = 1 - e.deltaY * CANVAS_CONFIG.ZOOM_SENSITIVITY;
    const newZoom = Math.max(CANVAS_CONFIG.MIN_ZOOM, Math.min(CANVAS_CONFIG.MAX_ZOOM, zoom * zoomFactor));
    
    // Zoom towards mouse position
    const zoomRatio = newZoom / zoom;
    setPan(prev => ({
      x: mouseX - (mouseX - prev.x) * zoomRatio,
      y: mouseY - (mouseY - prev.y) * zoomRatio
    }));
    
    setZoom(newZoom);
  }, [zoom]);
  
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleMouseClick}
      onWheel={handleWheel}
      style={{ display: 'block' }}
    />
  );
});

// ============================================================================================
// MAIN UNIFIED VISUALIZATION COMPONENT
// ============================================================================================

const UnifiedVisualization: React.FC = () => {
  const { dataset } = useDataContext();
  
  // State management
  const [mode, setMode] = useState('heatmap');
  const [colorScale, setColorScale] = useState('viridis');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPoint, setSelectedPoint] = useState<DataPoint | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<DataPoint | null>(null);
  const [xColumn, setXColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  const [colorColumn, setColorColumn] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Get container dimensions
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: isFullscreen ? window.innerHeight - 100 : rect.height
        });
      }
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [isFullscreen]);
  
  // Process data for visualization
  const { processedData, columns, numericColumns } = useMemo(() => {
    if (!dataset?.data || !dataset?.columns) {
      return { processedData: [], columns: [], numericColumns: [] };
    }
    
    const cols = dataset.columns.map(c => c.name);
    const numCols = cols.filter(col => {
      const sample = dataset.data.slice(0, 100);
      return sample.some(row => isNumeric(row[col]));
    });
    
    // Auto-select columns if not set
    if (!xColumn && numCols.length > 0) setXColumn(numCols[0]);
    if (!yColumn && numCols.length > 1) setYColumn(numCols[1]);
    if (!colorColumn && numCols.length > 2) setColorColumn(numCols[2]);
    
    // Process data points
    const points: DataPoint[] = dataset.data.map((row, index) => {
      const xVal = row[xColumn];
      const yVal = row[yColumn];
      const colorVal = row[colorColumn];
      
      return {
        id: `point-${index}`,
        x: isNumeric(xVal) ? xVal : index,
        y: isNumeric(yVal) ? yVal : Math.random() * 100,
        value: isNumeric(colorVal) ? colorVal : 1,
        originalRow: row,
        color: undefined,
        size: CANVAS_CONFIG.POINT_SIZE
      };
    });
    
    return { processedData: points, columns: cols, numericColumns: numCols };
  }, [dataset, xColumn, yColumn, colorColumn]);
  
  // Event handlers
  const handlePointHover = useCallback((point: DataPoint | null) => {
    setHoveredPoint(point);
  }, []);
  
  const handlePointClick = useCallback((point: DataPoint) => {
    setSelectedPoint(point);
  }, []);
  
  const handleExport = useCallback(() => {
    // Export current view as image
    const canvas = containerRef.current?.querySelector('canvas');
    if (canvas) {
      const link = document.createElement('a');
      link.download = `visualization-${Date.now()}.png`;
      link.href = canvas.toDataURL();
      link.click();
    }
  }, []);
  
  if (!dataset) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-400">
        <div className="text-center">
          <Grid3X3 className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <p>No dataset loaded. Please upload data to visualize.</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className={`space-y-4 ${isFullscreen ? 'fixed inset-0 z-50 bg-black p-4' : ''}`}>
      {/* Controls Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gray-800/60 backdrop-blur-sm rounded-xl p-4 border border-gray-700"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-white">Unified Dataset Visualization</h2>
            <div className="text-sm text-gray-400">
              {processedData.length.toLocaleString()} data points
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Mode Selection */}
            <div className="flex bg-gray-700 rounded-lg p-1">
              {VISUALIZATION_MODES.map(vizMode => {
                const Icon = vizMode.icon;
                return (
                  <button
                    key={vizMode.id}
                    onClick={() => setMode(vizMode.id)}
                    className={`px-3 py-2 rounded-md flex items-center gap-2 text-sm transition-colors ${
                      mode === vizMode.id 
                        ? 'bg-blue-600 text-white' 
                        : 'text-gray-300 hover:text-white hover:bg-gray-600'
                    }`}
                    title={vizMode.description}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{vizMode.name}</span>
                  </button>
                );
              })}
            </div>
            
            {/* Controls */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300"
              title="Toggle Fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            
            <button
              onClick={handleExport}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300"
              title="Export Image"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>
        
        {/* Configuration Row */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Column Selectors */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">X-Axis</label>
            <select
              value={xColumn}
              onChange={(e) => setXColumn(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
            >
              {numericColumns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Y-Axis</label>
            <select
              value={yColumn}
              onChange={(e) => setYColumn(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
            >
              {numericColumns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Color</label>
            <select
              value={colorColumn}
              onChange={(e) => setColorColumn(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
            >
              {numericColumns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Color Scale</label>
            <select
              value={colorScale}
              onChange={(e) => setColorScale(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
            >
              {Object.keys(COLOR_SCALES).map(scale => (
                <option key={scale} value={scale}>{scale}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Search for Grid Mode */}
        {mode === 'grid' && (
          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search data..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg pl-10 pr-4 py-2 text-sm"
              />
            </div>
          </div>
        )}
      </motion.div>
      
      {/* Main Visualization Area */}
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden relative"
        style={{ height: isFullscreen ? 'calc(100vh - 200px)' : '600px' }}
      >
        {mode === 'grid' ? (
          <VirtualizedGrid
            data={dataset.data}
            columns={columns}
            width={dimensions.width}
            height={dimensions.height}
            searchTerm={searchTerm}
          />
        ) : (
          <CanvasVisualization
            data={processedData}
            mode={mode}
            width={dimensions.width}
            height={dimensions.height}
            colorScale={colorScale}
            onPointHover={handlePointHover}
            onPointClick={handlePointClick}
          />
        )}
        
        {/* Hover Tooltip */}
        <AnimatePresence>
          {hoveredPoint && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute top-4 left-4 bg-gray-800/90 backdrop-blur-sm border border-gray-600 rounded-lg p-3 text-sm text-white max-w-xs"
            >
              <div className="font-semibold mb-2">Data Point</div>
              <div className="space-y-1">
                <div>{xColumn}: {hoveredPoint.originalRow[xColumn]}</div>
                <div>{yColumn}: {hoveredPoint.originalRow[yColumn]}</div>
                {colorColumn && (
                  <div>{colorColumn}: {hoveredPoint.originalRow[colorColumn]}</div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Zoom/Pan Instructions */}
        {mode !== 'grid' && (
          <div className="absolute bottom-4 left-4 bg-gray-800/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-gray-400">
            Scroll to zoom • Drag to pan • Click points for details
          </div>
        )}
      </motion.div>
      
      {/* Selected Point Details */}
      <AnimatePresence>
        {selectedPoint && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-gray-800/60 backdrop-blur-sm rounded-xl p-4 border border-gray-700"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Selected Data Point</h3>
              <button
                onClick={() => setSelectedPoint(null)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(selectedPoint.originalRow).slice(0, 8).map(([key, value]) => (
                <div key={key} className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">{key}</div>
                  <div className="text-sm text-white font-medium truncate" title={String(value)}>
                    {String(value)}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UnifiedVisualization;