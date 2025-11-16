// Test the QA service directly by calling the endpoint with minimal data
async function testDirectQA() {
  try {
    console.log('🧪 Testing AI with direct dataset data...');
    
    // Test with minimal dataset data
    const response = await fetch('http://localhost:5000/api/ai-insights/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'Identify individuals with salaries above 50,000',
        datasetData: {
          data: [
            { name: "John Doe", salary: 75000 },
            { name: "Jane Smith", salary: 45000 },
            { name: "Bob Johnson", salary: 120000 }
          ],
          columns: ['name', 'salary']
        }
      })
    });

    const result = await response.json();
    console.log('📊 AI Response:', JSON.stringify(result, null, 2));
    
    // Check if the AI actually used the data
    if (result.answer && result.answer.includes('John Doe') || result.answer.includes('Bob Johnson')) {
      console.log('✅ SUCCESS: AI used the dataset data!');
    } else {
      console.log('❌ FAILURE: AI did not use the dataset data');
    }
  } catch (error) {
    console.error('🚨 Test error:', error.message);
  }
}

testDirectQA();
