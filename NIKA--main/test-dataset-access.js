// Test data simulating a salary dataset
const testDataset = {
  data: [
    { name: "John Doe", salary: 75000, department: "Engineering" },
    { name: "Jane Smith", salary: 45000, department: "Marketing" },
    { name: "Bob Johnson", salary: 120000, department: "Management" },
    { name: "Alice Brown", salary: 55000, department: "Engineering" },
    { name: "Charlie Wilson", salary: 35000, department: "Support" }
  ],
  columns: [
    { name: "name", type: "string" },
    { name: "salary", type: "number" },
    { name: "department", type: "string" }
  ]
};

async function testDatasetAccess() {
  try {
    console.log('🧪 Testing AI dataset access...');
    
    // Test the AI search endpoint with dataset data
    const response = await fetch('http://localhost:5000/api/ai-insights/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'Identify individuals with salaries above 50,000',
        datasetData: testDataset
      })
    });

    const result = await response.json();
    console.log('📊 AI Response:', JSON.stringify(result, null, 2));
    
    if (response.ok) {
      console.log('✅ Test successful! AI can access uploaded dataset');
    } else {
      console.log('❌ Test failed:', result.error);
    }
  } catch (error) {
    console.error('🚨 Test error:', error.message);
  }
}

testDatasetAccess();
