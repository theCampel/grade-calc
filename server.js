const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Dynamic OpenAI client - reloads if API key changes
let openai = null;
let currentApiKey = null;

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'sk-your-api-key-here') return null;
  
  // Recreate client if key changed
  if (!openai || currentApiKey !== key) {
    openai = new OpenAI({ apiKey: key });
    currentApiKey = key;
  }
  return openai;
}

// Check if API key is configured
app.get('/api/config/status', (req, res) => {
  // Re-read .env file to get latest value
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/OPENAI_API_KEY=(.+)/);
    if (match && match[1]) {
      process.env.OPENAI_API_KEY = match[1].trim();
    }
  }
  
  const key = process.env.OPENAI_API_KEY;
  const isConfigured = key && key.length > 10 && key !== 'sk-your-api-key-here';
  res.json({ 
    apiKeyConfigured: isConfigured,
    hasEnvFile: fs.existsSync(envPath)
  });
});

// Set API key (writes to or updates .env file)
app.post('/api/config/apikey', (req, res) => {
  const { apiKey } = req.body;
  
  if (!apiKey || apiKey.length < 10) {
    return res.status(400).json({ error: 'Invalid API key' });
  }
  
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    // Read existing .env if it exists and preserve other variables
    if (fs.existsSync(envPath)) {
      const existing = fs.readFileSync(envPath, 'utf8');
      const lines = existing.split('\n');
      const otherLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('OPENAI_API_KEY=') && !trimmed.startsWith('#');
      });
      if (otherLines.length > 0) {
        envContent = otherLines.join('\n') + '\n';
      }
    }
    
    // Add/update the API key
    envContent += `OPENAI_API_KEY=${apiKey}\n`;
    fs.writeFileSync(envPath, envContent);
    
    // Update process.env and reset client
    process.env.OPENAI_API_KEY = apiKey;
    openai = new OpenAI({ apiKey });
    
    res.json({ success: true, message: 'API key saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save API key', details: error.message });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize data file if it doesn't exist
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      year3: [],
      year4: [],
      lastUpdated: null
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Get all grades
app.get('/api/grades', (req, res) => {
  const data = loadData();
  res.json(data);
});

// Save grades
app.post('/api/grades', (req, res) => {
  const { year3, year4 } = req.body;
  const data = { year3, year4 };
  saveData(data);
  res.json({ success: true, data });
});

// Calculate final grade
app.post('/api/calculate', (req, res) => {
  const { year3, year4 } = req.body;

  const calcYearAvg = (modules) => {
    if (!modules || modules.length === 0) return 0;
    const totalCredits = modules.reduce((sum, m) => sum + m.credits, 0);
    const weightedSum = modules.reduce((sum, m) => sum + (m.mark * m.credits), 0);
    return totalCredits > 0 ? weightedSum / totalCredits : 0;
  };

  const year3Avg = calcYearAvg(year3);
  const year4Avg = calcYearAvg(year4);

  // 50/50 split for UoE honours
  const finalGrade = (year3Avg * 0.5) + (year4Avg * 0.5);

  // UoE classification boundaries
  let classification = '';
  if (finalGrade >= 70) classification = 'First Class Honours';
  else if (finalGrade >= 60) classification = 'Upper Second Class (2:1)';
  else if (finalGrade >= 50) classification = 'Lower Second Class (2:2)';
  else if (finalGrade >= 40) classification = 'Third Class';
  else classification = 'Fail';

  res.json({
    year3Avg: year3Avg.toFixed(2),
    year4Avg: year4Avg.toFixed(2),
    finalGrade: finalGrade.toFixed(2),
    classification
  });
});

// What-if calculator - what do I need?
app.post('/api/whatif', (req, res) => {
  const { year3, year4Confirmed, targetGrade } = req.body;

  const calcYearAvg = (modules) => {
    if (!modules || modules.length === 0) return 0;
    const totalCredits = modules.reduce((sum, m) => sum + m.credits, 0);
    const weightedSum = modules.reduce((sum, m) => sum + (m.mark * m.credits), 0);
    return totalCredits > 0 ? weightedSum / totalCredits : 0;
  };

  const year3Avg = calcYearAvg(year3);
  const confirmedCredits = year4Confirmed.reduce((sum, m) => sum + m.credits, 0);
  const confirmedWeighted = year4Confirmed.reduce((sum, m) => sum + (m.mark * m.credits), 0);
  const remainingCredits = 120 - confirmedCredits;

  // target = (year3Avg * 0.5) + (year4Avg * 0.5)
  // year4Avg = (confirmedWeighted + X * remainingCredits) / 120
  // Solve for X (average needed on remaining modules)
  const neededYear4Avg = (targetGrade - (year3Avg * 0.5)) / 0.5;
  const neededOnRemaining = remainingCredits > 0
    ? ((neededYear4Avg * 120) - confirmedWeighted) / remainingCredits
    : 0;

  res.json({
    year3Avg: year3Avg.toFixed(2),
    confirmedCredits,
    remainingCredits,
    neededYear4Avg: neededYear4Avg.toFixed(2),
    neededOnRemaining: neededOnRemaining.toFixed(2),
    achievable: neededOnRemaining <= 100 && neededOnRemaining >= 0
  });
});

const EUCLID_PARSER_PROMPT = `Parse this University of Edinburgh EUCLID transcript PDF.

EXTRACT FOR EACH COURSE:
- name: Course name (e.g., "Machine Learning Practical")
- code: Course code (e.g., "INFR11223")  
- credits: Credit value as INTEGER (usually 10, 20, or 40). REQUIRED - look for "Credits: X" or "X credits"
- mark: Final course grade as INTEGER (0-100), or null if no final grade yet
- confirmed: true if final grade exists, false if "No final result yet"
- components: Array of individual assessments (coursework, exams) that make up the grade

COMPONENTS - Extract these for EVERY course when visible:
Each component needs: name (e.g., "CW1", "Exam"), weight (percentage, e.g., 30), mark (score or null)
Components help users track progress before final grades are released.

CREDIT VALUES:
- Most courses: 10 or 20 credits
- Honours Project/Dissertation: 40 credits
- If unclear, use 20 as default

YEAR DETECTION:
- INFR09xxx, INFR10xxx = Year 3
- INFR11xxx = Year 4
- EPCC courses = usually Year 4`;

// JSON Schema for structured output
const TRANSCRIPT_SCHEMA = {
  type: "object",
  properties: {
    modules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          code: { type: "string" },
          credits: { type: "integer" },
          mark: { type: ["integer", "null"] },
          confirmed: { type: "boolean" },
          components: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                weight: { type: "integer" },
                mark: { type: ["integer", "null"] }
              },
              required: ["name", "weight", "mark"],
              additionalProperties: false
            }
          }
        },
        required: ["name", "code", "credits", "mark", "confirmed", "components"],
        additionalProperties: false
      }
    },
    year: { type: "string", enum: ["3", "4"] }
  },
  required: ["modules", "year"],
  additionalProperties: false
};

// Parse transcript with OpenAI (text/PDF)
app.post('/api/parse-transcript', upload.single('transcript'), async (req, res) => {
  try {
    const client = getOpenAI();
    if (!client) {
      return res.status(400).json({ 
        error: 'API key not configured',
        needsApiKey: true 
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const content = req.file.buffer.toString('utf8');

    const response = await client.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: EUCLID_PARSER_PROMPT },
        { role: 'user', content: `Parse this EUCLID transcript. Extract each course with credits (integer), final mark, and assessment components.\n\n${content}` }
      ],
      response_format: { 
        type: 'json_schema',
        json_schema: {
          name: 'transcript',
          strict: true,
          schema: TRANSCRIPT_SCHEMA
        }
      }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    
    // Ensure credits has fallback
    if (parsed.modules) {
      parsed.modules = parsed.modules.map(m => ({
        ...m,
        credits: m.credits || 20
      }));
    }
    
    res.json(parsed);

  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ error: 'Failed to parse transcript', details: error.message });
  }
});

// Parse any file (PDF, image) with OpenAI
app.post('/api/parse-transcript-image', upload.single('transcript'), async (req, res) => {
  try {
    const client = getOpenAI();
    if (!client) {
      return res.status(400).json({ 
        error: 'API key not configured',
        needsApiKey: true 
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const base64Data = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // OpenAI supports PDFs via the file content type
    const response = await client.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: EUCLID_PARSER_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: {
                filename: req.file.originalname || 'transcript.pdf',
                file_data: `data:${mimeType};base64,${base64Data}`
              }
            },
            {
              type: 'text',
              text: 'Parse this EUCLID transcript. Extract each course with its credits (REQUIRED - integer like 10, 20, or 40), final mark if available, and any visible assessment components (coursework, exams with their weights and marks). Components help track progress before final grades.'
            }
          ]
        }
      ],
      response_format: { 
        type: 'json_schema',
        json_schema: {
          name: 'transcript',
          strict: true,
          schema: TRANSCRIPT_SCHEMA
        }
      }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    
    // Ensure credits has fallback
    if (parsed.modules) {
      parsed.modules = parsed.modules.map(m => ({
        ...m,
        credits: m.credits || 20 // Default to 20 if missing
      }));
    }
    
    res.json(parsed);

  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ error: 'Failed to parse transcript', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Grade Calculator running at http://localhost:${PORT}`);
});
