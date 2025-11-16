// backend/server.ts
import express from 'express';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { adminApp, admin, db as firestoreDb, bucket, demoMode } from './src/firebase/admin';
import { generateGeminiInsights, isGeminiConfigured } from './src/services/gemini';
import { generateGeminiAnswer } from './src/services/qa';
import { sanitizeSample } from './src/utils/sanitize';
import { rateLimiter } from './src/middleware/rateLimiter';

// Load environment variables from .env without external deps
const loadEnvFromFile = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {}
};

loadEnvFromFile(path.join(__dirname, '.env'));
loadEnvFromFile(path.join(__dirname, '..', '.env'));

const app = express();
const PORT = Number(process.env.PORT || 5000);
const metrics = { total: 0, failed: 0, latencyMsAvg: 0, modelCalls: 0 } as any;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Firebase ID Token verification middleware (optional)
const verifyFirebaseToken = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // If no token, continue (for demo mode or local uploads)
    return next();
  }

  if (!adminApp || demoMode) {
    // Firebase not configured, skip verification
    return next();
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.warn('⚠️ Token verification failed:', error);
    // Continue anyway for demo mode compatibility
    next();
  }
};

// Define project root
const isDist = path.basename(__dirname) === 'dist' || __dirname.includes(`${path.sep}dist${path.sep}`);
const projectRoot = isDist ? path.join(__dirname, '..', '..') : path.join(__dirname, '..');
const backendRoot = isDist ? path.join(__dirname, '..') : __dirname;

// Serve frontend files
const frontendDistPath = path.join(projectRoot, 'dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
}

// Ensure uploads directory exists
const uploadsDir = path.join(backendRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

// Database setup
const dbPath = path.join(backendRoot, 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

// Initialize database
console.log('📍 Starting database initialization');
db.serialize(() => {
  console.log('📍 Inside db.serialize');
  db.run(`
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploadedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      rowCount INTEGER DEFAULT 0,
      columnCount INTEGER DEFAULT 0,
      metadata TEXT
    )
  `, (err: Error | null) => {
    if (err) {
      console.error('❌ Error creating datasets table:', err);
    } else {
      console.log('✅ Datasets table created');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY,
      userId TEXT,
      query TEXT NOT NULL,
      answer TEXT,
      insightId TEXT,
      datasetId TEXT,
      meta TEXT,
      piiDetected INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err: Error | null) => {
    if (err) {
      console.error('❌ Error creating queries table:', err);
    } else {
      console.log('✅ Queries table created');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS feedbacks (
      id TEXT PRIMARY KEY,
      queryId TEXT NOT NULL,
      userId TEXT,
      rating INTEGER,
      comment TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err: Error | null) => {
    if (err) {
      console.error('❌ Error creating feedbacks table:', err);
    } else {
      console.log('✅ Feedbacks table created');
      console.log('✅ Database table initialized');
    }
  });
});

console.log('📍 Database initialization queued');

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls', '.json'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, Excel, and JSON files are allowed.'));
    }
  }
});

// Utility functions
const parseFile = async (filePath: string, originalName: string): Promise<{ data: any[]; columns: string[] }> => {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === '.csv') {
      const csvContent = fs.readFileSync(filePath, 'utf8');
      return new Promise((resolve, reject) => {
        Papa.parse(csvContent, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results: Papa.ParseResult<any>) => {
            if (results.errors && results.errors.length > 0) {
              console.warn('CSV parsing warnings:', results.errors);
            }
            const data = results.data as any[];
            const columns = data.length > 0 ? Object.keys(data[0]) : [];
            resolve({ data, columns });
          },
          error: (error: any) => reject(error)
        });
      });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('No sheets found in Excel file');
      }
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet) as any[];
      const columns = data.length > 0 ? Object.keys(data[0] as any) : [];
      return { data, columns };
    } else if (ext === '.json') {
      const jsonContent = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(jsonContent);
      if (!Array.isArray(data)) {
        throw new Error('JSON must be an array of objects');
      }
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      return { data, columns };
    } else {
      throw new Error('Unsupported file format');
    }
  } catch (error) {
    console.error('❌ Error parsing file:', error);
    throw error;
  }
};

const generatePreview = (data: any[], limit: number = 5): any[] => {
  return data.slice(0, limit);
};

const analyzeColumns = (data: any[]): any[] => {
  if (!data || data.length === 0) return [];
  
  const columns = Object.keys(data[0] || {});
  
  return columns.map(columnName => {
    const values = data.map(row => row[columnName]).filter(val => val !== null && val !== undefined && val !== '');
    const nonMissingCount = values.length;
    const missingCount = data.length - nonMissingCount;
    const uniqueValues = new Set(values);
    
    // Detect column type
    const numericValues = values.filter(val => typeof val === 'number' && !isNaN(val));
    const isNumeric = numericValues.length > values.length * 0.8;
    
    let type = 'text';
    if (isNumeric) {
      type = 'numeric';
    } else if (uniqueValues.size < values.length * 0.1 && uniqueValues.size > 1) {
      type = 'categorical';
    } else if (values.some(val => !isNaN(Date.parse(val)))) {
      type = 'date';
    }
    
    return {
      name: columnName,
      type,
      missingCount,
      uniqueCount: uniqueValues.size
    };
  });
};

// Helper function to download file from Firebase Storage
const downloadFromStorage = async (storagePath: string): Promise<string> => {
  if (!bucket || demoMode) {
    throw new Error('Firebase Storage not configured');
  }

  const file = bucket.file(storagePath);
  const tempPath = path.join(uploadsDir, `temp-${Date.now()}-${path.basename(storagePath)}`);
  
  await file.download({ destination: tempPath });
  return tempPath;
};

// Helper function to generate insights (uses Gemini AI if configured)
const generateInsights = async (data: any[], columns: string[], filename: string): Promise<any> => {
  if (isGeminiConfigured) {
    try {
      console.log('🤖 Using Gemini AI for insights generation...');
      return await generateGeminiInsights(data, columns, filename);
    } catch (error) {
      console.warn('⚠️ Gemini AI failed, using basic insights:', error);
    }
  }
  
  // Fallback to basic insights
  const rowCount = data.length;
  const columnCount = columns.length;
  
  return {
    summary: {
      totalRows: rowCount,
      totalColumns: columnCount,
      dataQuality: 'Good',
      keyCharacteristics: [
        `${rowCount} rows of data`,
        `${columnCount} columns analyzed`,
        'Ready for analysis'
      ],
      processingTime: 0.3,
    },
    recommendations: [
      'Consider normalizing numeric columns for better analysis',
      'Check for missing values in key columns',
      'Explore correlations between numeric variables',
    ],
    insights: [
      `Dataset contains ${rowCount} rows across ${columnCount} columns`,
      'Review data quality metrics before analysis',
      'Consider feature engineering for better model performance',
      'Check for outliers in numeric columns',
      'Explore categorical distributions for insights',
    ],
    metadata: {
      processedAt: new Date().toISOString(),
      model: 'basic',
      version: '1.0.0',
    },
  };
};

// API Routes

// Health check endpoint
app.get('/health', (req: express.Request, res: express.Response): void => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    firebase: !demoMode && !!adminApp ? 'configured' : 'demo mode',
    gemini: isGeminiConfigured ? 'configured' : 'not configured'
  });
});

app.get('/metrics', (req, res) => {
  res.type('text/plain').send(
    `ai_requests_total ${metrics.total}\n` +
    `ai_requests_failed ${metrics.failed}\n` +
    `ai_latency_seconds ${metrics.latencyMsAvg / 1000}\n` +
    `ai_model_calls_total ${metrics.modelCalls}\n`
  );
});
app.get('/api/metrics', (req, res) => {
  res.type('text/plain').send(
    `ai_requests_total ${metrics.total}\n` +
    `ai_requests_failed ${metrics.failed}\n` +
    `ai_latency_seconds ${metrics.latencyMsAvg / 1000}\n` +
    `ai_model_calls_total ${metrics.modelCalls}\n`
  );
});


// POST /upload - Upload and process dataset
app.post('/upload', upload.single('file'), async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const file = req.file as Express.Multer.File;
    const { filename, originalname, size } = file;
    const filePath = file.path;
    const datasetId = `dataset-${Date.now()}`;

    console.log(`📤 Processing upload: ${originalname} (${(size / 1024 / 1024).toFixed(2)} MB)`);

    // Parse file to get basic info
    const { data, columns } = await parseFile(filePath, originalname);
    const rowCount = data.length;
    const columnCount = columns.length;

    console.log(`📊 Parsed: ${rowCount} rows, ${columnCount} columns`);

    // Analyze columns
    const analyzedColumns = analyzeColumns(data);

    // Generate preview (first 5 rows)
    const preview = generatePreview(data, 5);

    // Store metadata in database
    const metadata = JSON.stringify({
      columns: analyzedColumns,
      preview,
      originalName: originalname,
      analyzedAt: new Date().toISOString()
    });

    db.run(
      `INSERT INTO datasets (id, name, path, size, rowCount, columnCount, metadata) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [datasetId, originalname, filePath, size, rowCount, columnCount, metadata],
      function(err: Error | null): void {
        if (err) {
          console.error('❌ Database error:', err);
          res.status(500).json({ error: 'Failed to save dataset metadata' });
          return;
        }

        console.log(`✅ Dataset saved: ${datasetId}`);

        // Return response compatible with frontend
        res.json({
          id: datasetId,
          name: originalname,
          data: preview,
          columns: analyzedColumns,
          uploadedAt: new Date(),
          size,
          rowCount,
          columnCount,
          isPreview: true
        });
      }
    );

  } catch (error: unknown) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to process file'
    });
  }
});

// POST /api/insights - Generate insights from Firebase Storage or local file
app.post('/api/insights', verifyFirebaseToken, upload.single('file'), async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { storagePath, uploadId } = req.body;
    const user = (req as any).user;
    let filePath: string | null = null;
    let originalName: string = '';

    // If storagePath provided, download from Firebase Storage
    if (storagePath && bucket && !demoMode) {
      try {
        console.log(`📥 Downloading from Firebase Storage: ${storagePath}`);
        filePath = await downloadFromStorage(storagePath);
        
        // Get original filename from Firestore if uploadId provided
        if (uploadId && firestoreDb) {
          try {
            const uploadDoc = await firestoreDb.collection('uploads').doc(uploadId).get();
            if (uploadDoc.exists) {
              const uploadData = uploadDoc.data();
              originalName = uploadData?.filename || path.basename(storagePath);
            } else {
              originalName = path.basename(storagePath);
            }
          } catch (err) {
            console.warn('⚠️ Could not fetch upload metadata:', err);
            originalName = path.basename(storagePath);
          }
        } else {
          originalName = path.basename(storagePath);
        }
      } catch (error) {
        console.error('❌ Error downloading from Firebase Storage:', error);
        res.status(500).json({ error: 'Failed to download file from Firebase Storage' });
        return;
      }
    } 
    // If local file uploaded
    else if (req.file) {
      filePath = req.file.path;
      originalName = req.file.originalname;
    } 
    // Fallback: no file provided
    else {
      res.status(400).json({ error: 'No file or storagePath provided' });
      return;
    }

    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    console.log(`📊 Processing file: ${originalName}`);

    // Parse file
    const { data, columns } = await parseFile(filePath, originalName);
    const rowCount = data.length;
    const columnCount = columns.length;

    console.log(`✅ Parsed: ${rowCount} rows, ${columnCount} columns`);

    // Generate insights using Gemini AI (or fallback to basic)
    const insights = await generateInsights(data, columns, originalName);

    // Save insights to Firestore if configured
    let insightId: string | null = null;
    if (firestoreDb && user && !demoMode) {
      try {
        const insightDoc = await firestoreDb.collection('insights').add({
          uid: user.uid,
          uploadId: uploadId || null,
          storagePath: storagePath || null,
          filename: originalName,
          rowCount,
          columnCount,
          insights,
          data: data.slice(0, 1000), // Store first 1000 rows for preview
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        insightId = insightDoc.id;
        console.log(`✅ Insights saved to Firestore: ${insightId}`);
      } catch (error) {
        console.warn('⚠️ Failed to save insights to Firestore:', error);
      }
    }

    // Clean up temp file if downloaded from Storage
    if (storagePath && filePath && filePath.includes('temp-')) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('⚠️ Could not delete temp file:', err);
      }
    }

    // Return response
    res.json({
      id: insightId || `insight-${Date.now()}`,
      uploadId: uploadId || null,
      filename: originalName,
      rowCount,
      columnCount,
      data: data, // Return full dataset
      insights,
      uploadedAt: new Date().toISOString(),
    });

  } catch (error: unknown) {
    console.error('❌ Insights generation error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate insights'
    });
  }
});

// GET /api/insights/:id - Fetch insights from Firestore
app.get('/api/insights/:id', verifyFirebaseToken, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    if (!firestoreDb || demoMode) {
      res.status(503).json({ error: 'Firestore not configured' });
      return;
    }

    const insightDoc = await firestoreDb.collection('insights').doc(id).get();
    
    if (!insightDoc.exists) {
      res.status(404).json({ error: 'Insight not found' });
      return;
    }

    const insightData = insightDoc.data();
    
    // Check if user has access
    if (user && insightData?.uid !== user.uid) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({
      id: insightDoc.id,
      ...insightData,
    });

  } catch (error: unknown) {
    console.error('❌ Error fetching insight:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch insight'
    });
  }
});

// GET /datasets - List all datasets
app.get('/datasets', (req: express.Request, res: express.Response): void => {
  db.all(
    `SELECT id, name, size, uploadedAt, rowCount, columnCount FROM datasets ORDER BY uploadedAt DESC`,
    [],
    (err: Error | null, rows: any[]): void => {
      if (err) {
        console.error('❌ Database error:', err);
        res.status(500).json({ error: 'Failed to fetch datasets' });
        return;
      }
      res.json(rows || []);
    }
  );
});

// GET /summary/:id - Get dataset summary
app.get('/summary/:id', (req: express.Request, res: express.Response): void => {
  const { id } = req.params;

  db.get(
    `SELECT rowCount, columnCount, metadata FROM datasets WHERE id = ?`,
    [id],
    (err: Error | null, row: any): void => {
      if (err) {
        console.error('❌ Database error:', err);
        res.status(500).json({ error: 'Failed to fetch summary' });
        return;
      }

      if (!row) {
        res.status(404).json({ error: 'Dataset not found' });
        return;
      }

      try {
        const metadata = JSON.parse(row.metadata);
        res.json({
          totalRows: row.rowCount,
          totalColumns: row.columnCount,
          missingValues: 0, // Calculate if needed
          duplicates: 0, // Calculate if needed
          memoryUsage: `${(JSON.stringify(metadata).length / 1024).toFixed(2)} KB`,
          columns: metadata.columns || []
        });
      } catch (error) {
        console.error('❌ Error parsing metadata:', error);
        res.status(500).json({ error: 'Failed to parse dataset metadata' });
      }
    }
  );
});

// GET /preview/:id - Get dataset preview
app.get('/preview/:id', async (req: express.Request, res: express.Response): Promise<void> => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit as string) || 500;

  db.get(
    `SELECT path, name, metadata FROM datasets WHERE id = ?`,
    [id],
    async (err: Error | null, row: any): Promise<void> => {
      if (err) {
        console.error('❌ Database error:', err);
        res.status(500).json({ error: 'Failed to fetch dataset' });
        return;
      }

      if (!row) {
        res.status(404).json({ error: 'Dataset not found' });
        return;
      }

      try {
        // Check if file still exists
        if (!fs.existsSync(row.path)) {
          res.status(404).json({ error: 'Dataset file not found on disk' });
          return;
        }

        // Parse the full file and return limited rows
        const { data, columns } = await parseFile(row.path, row.name);
        const preview = data.slice(0, limit);
        const analyzedColumns = analyzeColumns(data);

        res.json({
          data: preview,
          columns: analyzedColumns,
          totalRows: data.length,
          previewRows: preview.length
        });
      } catch (error) {
        console.error('❌ Error reading dataset:', error);
        res.status(500).json({ error: 'Failed to read dataset file' });
      }
    }
  );
});

// Catch-all route to serve index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path === '/metrics' || req.path === '/health') {
    res.status(404).send('Not Found');
    return;
  }
  const indexPath = path.join(frontendDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend not built. Run the frontend dev server at http://localhost:5173');
  }
});


// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction): void => {
  console.error('❌ Server error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large. Maximum size is 100MB.' });
      return;
    }
  }
  
  res.status(500).json({
    error: error?.message || 'Internal server error'
  });
});



// Start server
let server: any;
const numericPort = typeof PORT === 'string' ? parseInt(PORT, 10) : (PORT || 5000);

console.log('📍 About to call app.listen() with port:', numericPort);
try {
  server = app.listen(numericPort, '0.0.0.0', () => {
    console.log(`🚀 NIKA Backend server running on http://localhost:${numericPort}`);
    console.log(`📁 Upload directory: ${uploadsDir}`);
    console.log(`🗄️  Database: ${dbPath}`);
  });
  console.log('📍 app.listen() completed, server object created');
} catch (err) {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
}

console.log('📍 About to set up server event handlers');
if (server) {
  server.on('error', (err: any) => {
    console.error('❌ Server error:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`   Port ${numericPort} is already in use`);
    }
  });
}

console.log('📍 Setting up keepalive interval');
// Keep server alive - use ref() to ensure this keeps the process alive
const keepaliveInterval = setInterval(() => {
  // Do nothing, just keep the event loop busy
}, 5000);

// Make sure the interval refs the process
keepaliveInterval.ref();

console.log('📍 Server setup complete');

export { app };

// Vercel serverless function handler
export default function handler(req: any, res: any) {
  return app(req, res);
}

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('\n🛑 Shutting down server...');
  
  server.close(() => {
    console.log('🔌 HTTP server closed');
    
    db.close((err: Error | null) => {
      if (err) {
        console.error('❌ Error closing database:', err);
      } else {
        console.log('🗄️  Database connection closed');
      }
      process.exit(0);
    });
  });
};

// Disabled for debugging - these were causing unexpected shutdowns
// process.on('SIGINT', gracefulShutdown);
// process.on('SIGTERM', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('   Stack:', error.stack);
  // Don't exit, keep running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:');
  console.error('   Reason:', reason);
  if (reason instanceof Error) {
    console.error('   Stack:', reason.stack);
  }
  // Don't exit, keep running
});

// Simple test endpoint
app.get('/api/test', (req: express.Request, res: express.Response): void => {
  res.json({ 
    message: 'Backend is working!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.post('/api/qa', async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { query, datasetData } = req.body || {};
    
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    // Check if Gemini API key is available
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️ GEMINI_API_KEY not found in environment variables');
      res.json({
        id: `q-${Date.now()}`,
        answer: 'I apologize, but the AI service is not properly configured. Please ensure the GEMINI_API_KEY environment variable is set in your Vercel deployment.',
        explanation: 'The AI service requires a valid Gemini API key to function. This should be configured in your Vercel environment variables.',
        calculations: [],
        sources: [],
        timestamp: new Date().toISOString(),
        error: 'API_KEY_MISSING'
      });
      return;
    }

    let summary = 'No dataset provided';
    let columns: string[] = [];
    let sampleRows: any[] = [];

    if (datasetData && datasetData.data && datasetData.columns) {
      columns = datasetData.columns;
      sampleRows = datasetData.data.slice(0, 5);
      summary = `Dataset with ${datasetData.data.length} rows and ${columns.length} columns`;
    }

    const result = await generateGeminiAnswer({
      query,
      context: { summary, columns, sampleRows },
      config: { timeoutMs: 15000, modelName: 'gemini-pro' }
    });

    res.json({
      id: `q-${Date.now()}`,
      answer: result.answer,
      explanation: result.explanation,
      calculations: result.calculations || [],
      sources: result.sources || [],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ QA Error:', error);
    res.status(500).json({ 
      error: 'Failed to process query',
      answer: 'I apologize, I cannot process your query at this moment.',
      explanation: 'The AI service encountered an issue. Please try again.',
      calculations: [],
      sources: [],
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/ai-insights/search', verifyFirebaseToken, rateLimiter(), async (req: express.Request, res: express.Response): Promise<void> => {
  const start = Date.now();
  metrics.total += 1;
  try {
    let user = (req as any).user;
    if (!user) {
      if (demoMode) {
        user = { uid: 'demo' } as any;
      } else {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }
    
    // Debug: Log the entire request body
    console.log('🔍 AI Search Debug - Full request body:', JSON.stringify(req.body, null, 2));
    
    const { query, insightId, datasetId } = req.body || {};
    console.log('🔍 AI Search Debug - Request body:', { query: query?.slice(0, 100), insightId, datasetId, hasDatasetData: !!req.body.datasetData });
    
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Invalid query' });
      return;
    }

    let summary = '';
    let columns: string[] = [];
    let sampleRows: any[] = [];
    
    // Check if frontend sent dataset data directly (for client-side processed datasets)
    if (req.body.datasetData) {
      console.log('🔍 AI Search Debug - Using frontend dataset data');
      const { datasetData } = req.body;
      columns = Array.isArray(datasetData.columns) 
        ? datasetData.columns.map((c: any) => typeof c === 'string' ? c : c.name)
        : Object.keys(datasetData.data[0] || []);
      sampleRows = Array.isArray(datasetData.data) ? datasetData.data.slice(0, 5) : [];
      console.log('🔍 AI Search Debug - Frontend dataset:', {
        columnsCount: columns.length,
        rowsCount: sampleRows.length,
        columns: columns,
        sampleRows: sampleRows
      });
    } else if (datasetId) {
      console.log('🔍 AI Search Debug - Retrieving dataset from database:', datasetId);
      await new Promise<void>((resolve) => {
        db.get(
          `SELECT path, name, metadata FROM datasets WHERE id = ?`,
          [datasetId],
          async (err: Error | null, row: any) => {
            if (!err && row) {
              try {
                const meta = JSON.parse(row.metadata || '{}');
                const cols = Array.isArray(meta.columns) ? meta.columns.map((c: any) => (typeof c === 'string' ? c : c.name)) : [];
                columns = cols;
                const prev = Array.isArray(meta.preview) ? meta.preview : [];
                sampleRows = prev.slice(0, 5);
                console.log('🔍 AI Search Debug - Dataset retrieved:', {
                  datasetId,
                  name: row.name,
                  columnsCount: columns.length,
                  rowsCount: sampleRows.length,
                  columns: columns,
                  sampleRows: sampleRows
                });
              } catch (e) {
                console.error('🔍 AI Search Debug - Error parsing metadata:', e);
              }
            } else {
              console.log('🔍 AI Search Debug - No dataset found for ID:', datasetId);
            }
            resolve();
          }
        );
      });
    } else {
      console.log('🔍 AI Search Debug - No datasetId or datasetData provided in request');
    }
    if (insightId) {
      summary = `Insight ${insightId}`;
    }

    const sanitized = sanitizeSample(columns, sampleRows);

    console.log('🔍 AI Search Debug - Data being sent to QA service:', {
      originalColumnsCount: columns.length,
      originalRowsCount: sampleRows.length,
      sanitizedColumnsCount: sanitized.columns.length,
      sanitizedRowsCount: sanitized.rows.length,
      sanitizedColumns: sanitized.columns,
      sanitizedRows: sanitized.rows,
      summary: summary
    });

    const result = await generateGeminiAnswer({
      query,
      context: { summary, columns: sanitized.columns, sampleRows: sanitized.rows },
      config: { timeoutMs: 15000, modelName: 'gemini-pro' }
    });

    metrics.modelCalls += result.meta.fallback ? 0 : 1;
    const id = `q-${Date.now()}`;
    const answerTrunc = String(result.answer || '').slice(0, 4000);
    const meta = JSON.stringify({ explanation: result.explanation || '', calculations: Array.isArray(result.calculations) ? result.calculations.slice(0, 10) : [], sources: result.sources || [], meta: result.meta });
    await new Promise<void>((resolve) => {
      db.run(
        `INSERT INTO queries (id, userId, query, answer, insightId, datasetId, meta, piiDetected) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, user.uid || '', query, answerTrunc, insightId || null, datasetId || null, meta, sanitized.piiDetected ? 1 : 0],
        () => resolve()
      );
    });

    const latency = Date.now() - start;
    metrics.latencyMsAvg = metrics.latencyMsAvg === 0 ? latency : Math.round((metrics.latencyMsAvg * 0.9) + (latency * 0.1));

    res.json({
      id,
      answer: result.answer,
      explanation: result.explanation,
      calculations: result.calculations || [],
      sources: result.sources || [],
      meta: result.meta,
    });
  } catch (error) {
    metrics.failed += 1;
    res.status(500).json({ error: 'Failed to process AI search' });
  }
});

app.post('/api/ai-insights/feedback', verifyFirebaseToken, async (req: express.Request, res: express.Response): Promise<void> => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { queryId, rating, comment } = req.body || {};
  if (!queryId || typeof rating !== 'number') {
    res.status(400).json({ error: 'Invalid feedback' });
    return;
  }
  const id = `f-${Date.now()}`;
  await new Promise<void>((resolve) => {
    db.run(
      `INSERT INTO feedbacks (id, queryId, userId, rating, comment) VALUES (?, ?, ?, ?, ?)`,
      [id, queryId, (req as any).user.uid || '', rating, comment || null],
      () => resolve()
    );
  });
  res.json({ id });
});

app.get('/api/ai-insights/history', verifyFirebaseToken, async (req: express.Request, res: express.Response): Promise<void> => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20')) || 20));
  db.all(
    `SELECT id, query, answer, insightId, datasetId, meta, piiDetected, createdAt FROM queries WHERE userId = ? ORDER BY createdAt DESC LIMIT ?`,
    [user.uid || '', limit],
    (err: Error | null, rows: any[]) => {
      if (err) {
        res.status(500).json({ error: 'Failed to fetch history' });
        return;
      }
      res.json(rows || []);
    }
  );
});