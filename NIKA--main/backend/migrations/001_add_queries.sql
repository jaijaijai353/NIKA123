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
);