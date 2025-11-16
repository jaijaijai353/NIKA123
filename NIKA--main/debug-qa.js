// Test the QA service directly to see if dataset context is reaching the AI
const { promptFrom } = require('./backend/src/services/qa.ts');

const testDataset = {
  summary: 'Dataset with employee salary information',
  columns: ['name', 'salary', 'department'],
  sampleRows: [
    { name: "John Doe", salary: 75000, department: "Engineering" },
    { name: "Jane Smith", salary: 45000, department: "Marketing" },
    { name: "Bob Johnson", salary: 120000, department: "Management" }
  ]
};

console.log('🔍 Testing QA prompt generation...');
const prompt = promptFrom('Identify individuals with salaries above 50,000', testDataset);
console.log('📝 Generated prompt:');
console.log(prompt);
