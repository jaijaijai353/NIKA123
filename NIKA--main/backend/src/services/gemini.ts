import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

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

loadEnvFromFile(path.join(__dirname, '..', '..', '.env'));
loadEnvFromFile(path.join(__dirname, '..', '.env'));

// Check if Gemini is configured
const apiKey = process.env.GEMINI_API_KEY || '';
const isGeminiConfigured = !!apiKey;

console.log('📍 Gemini Service: API Key loaded:', apiKey ? `${apiKey.substring(0, 20)}...` : 'NONE');
console.log('📍 Gemini Service: isGeminiConfigured =', isGeminiConfigured);

let genAI: GoogleGenerativeAI | null = null;
let model: any = null;

if (isGeminiConfigured) {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    // Try to initialize with the configured or default model
    const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const fallbackModels = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-pro',
      'models/gemini-2.5-flash',
      'models/gemini-2.5-pro',
      'models/gemini-1.5-flash',
      'models/gemini-1.5-pro',
      'models/gemini-pro',
    ];
    
    let modelToTry = preferredModel;
    try {
      model = genAI.getGenerativeModel({ model: modelToTry });
      console.log('✅ Gemini AI initialized with model:', modelToTry);
    } catch (merr) {
      console.warn('⚠️ Preferred model failed:', String(merr));
      // Try fallback models
      for (const m of fallbackModels) {
        if (m === modelToTry) continue; // Skip the one we already tried
        try {
          model = genAI.getGenerativeModel({ model: m });
          console.log('✅ Gemini AI initialized with fallback model:', m);
          break;
        } catch (_) {
          // ignore and try next
        }
      }
      if (!model) {
        console.error('❌ All Gemini models failed. Please verify GEMINI_API_KEY is valid and has model access.');
        throw merr;
      }
    }
  } catch (error) {
    console.warn('⚠️ Gemini AI initialization failed:', error);
    genAI = null;
    model = null;
  }
} else {
  console.warn('⚠️ Gemini AI not configured (no API key), using basic insights');
}

/**
 * Generate AI-powered insights from dataset
 */
export async function generateGeminiInsights(
  data: any[],
  columns: string[],
  filename: string
): Promise<{
  summary: any;
  recommendations: string[];
  insights: string[];
  metadata: any;
}> {
  if (!model || !isGeminiConfigured) {
    // Fallback to basic insights
    return generateBasicInsights(data, columns, filename);
  }

  try {
    // Prepare data summary for Gemini
    const rowCount = data.length;
    const columnCount = columns.length;
    
    // Sample data for analysis (first 100 rows to avoid token limits)
    const sampleData = data.slice(0, 100);
    const sampleJson = JSON.stringify(sampleData.slice(0, 10)); // First 10 rows as example
    
    // Get column statistics
    const columnStats = columns.map(col => {
      const values = data.map(row => row[col]).filter(v => v != null && v !== '');
      const numericValues = values.filter(v => typeof v === 'number' && !isNaN(v));
      const uniqueValues = new Set(values);
      
      return {
        name: col,
        type: numericValues.length > values.length * 0.8 ? 'numeric' : 'categorical',
        missing: data.length - values.length,
        unique: uniqueValues.size,
        sample: values.slice(0, 5)
      };
    });

    const prompt = `You are a data analytics expert. Analyze the following dataset and provide comprehensive insights.

Dataset Information:
- Filename: ${filename}
- Total Rows: ${rowCount}
- Total Columns: ${columnCount}
- Columns: ${columns.join(', ')}

Column Statistics:
${columnStats.map(stat => 
  `- ${stat.name}: ${stat.type}, ${stat.missing} missing values, ${stat.unique} unique values`
).join('\n')}

Sample Data (first 10 rows):
${sampleJson}

Please provide:
1. A comprehensive summary of the dataset (structure, quality, key characteristics)
2. Three actionable recommendations for data analysis or improvement
3. Five key insights about patterns, trends, or anomalies in the data
4. Data quality assessment

Format your response as a JSON object with this structure:
{
  "summary": {
    "totalRows": ${rowCount},
    "totalColumns": ${columnCount},
    "dataQuality": "assessment",
    "keyCharacteristics": ["characteristic1", "characteristic2"],
    "processingTime": 0.5
  },
  "recommendations": [
    "recommendation1",
    "recommendation2",
    "recommendation3"
  ],
  "insights": [
    "insight1",
    "insight2",
    "insight3",
    "insight4",
    "insight5"
  ],
  "metadata": {
    "processedAt": "${new Date().toISOString()}",
    "model": "gemini-pro",
    "version": "1.0.0"
  }
}

Return ONLY the JSON object, no additional text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Try to parse JSON from response
    let parsedResponse;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        parsedResponse = JSON.parse(text);
      }
    } catch (parseError) {
      console.warn('⚠️ Failed to parse Gemini response as JSON, using fallback');
      return generateBasicInsights(data, columns, filename);
    }

    return {
      summary: parsedResponse.summary || {
        totalRows: rowCount,
        totalColumns: columnCount,
        processingTime: 0.5,
      },
      recommendations: parsedResponse.recommendations || [],
      insights: parsedResponse.insights || [],
      metadata: parsedResponse.metadata || {
        processedAt: new Date().toISOString(),
        model: 'gemini-pro',
        version: '1.0.0',
      },
    };
  } catch (error) {
    console.error('❌ Gemini AI error:', error);
    try {
      const status = (error as any)?.status || (error as any)?.statusCode;
      const statusText = (error as any)?.statusText || (error as any)?.status;
      if (status === 404 || /Not Found/i.test(String(statusText || ''))) {
        console.error('⚠️ Model not supported for this API version (404).\nSet `GEMINI_MODEL` to a supported model name for your account or update the Google Generative AI package.');
      }
    } catch (e) {
      // ignore
    }
    // Fallback to basic insights
    return generateBasicInsights(data, columns, filename);
  }
}

/**
 * Fallback basic insights generator
 */
function generateBasicInsights(
  data: any[],
  columns: string[],
  filename: string
): {
  summary: any;
  recommendations: string[];
  insights: string[];
  metadata: any;
} {
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
}

export { isGeminiConfigured, genAI, model };

