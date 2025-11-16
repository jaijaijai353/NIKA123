import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
admin.initializeApp();

/**
 * Cloud Function: processFile
 * 
 * Processes a file uploaded to Firebase Storage and generates insights.
 * 
 * Input: { storagePath, uploadId }
 * - Downloads file from Firebase Storage
 * - Parses dataset (CSV, JSON, Excel)
 * - Generates insights
 * - Saves to Firestore
 * - Returns insights JSON
 */
export const processFile = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated to process files'
    );
  }

  const { storagePath, uploadId } = data;

  if (!storagePath) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'storagePath is required'
    );
  }

  try {
    const uid = context.auth.uid;
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    // Verify file belongs to user
    const pathParts = storagePath.split('/');
    if (pathParts.length < 3 || pathParts[1] !== uid) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'File does not belong to user'
      );
    }

    // Download file to temp location
    const tempFilePath = `/tmp/${Date.now()}_${pathParts[pathParts.length - 1]}`;
    await file.download({ destination: tempFilePath });

    // TODO: Parse file based on extension
    // TODO: Generate insights
    // For now, return mock insights
    const insights = {
      summary: {
        totalRows: 0,
        totalColumns: 0,
        processingTime: 0.5,
      },
      recommendations: [
        'Consider normalizing numeric columns',
        'Check for missing values',
        'Explore correlations',
      ],
      metadata: {
        processedAt: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    // Save insights to Firestore
    const db = admin.firestore();
    const insightDoc = await db.collection('insights').add({
      uid,
      uploadId: uploadId || null,
      storagePath,
      insights,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Clean up temp file
    try {
      const fs = require('fs');
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (err) {
      console.warn('Could not delete temp file:', err);
    }

    return {
      id: insightDoc.id,
      insights,
      success: true,
    };
  } catch (error: any) {
    console.error('Error processing file:', error);
    throw new functions.https.HttpsError(
      'internal',
      error.message || 'Failed to process file'
    );
  }
});

