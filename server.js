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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

const EUCLID_PARSER_PROMPT = `You are parsing a University of Edinburgh EUCLID transcript. Extract ONLY the course-level information.

CRITICAL RULES:
1. Extract ONLY the FINAL COURSE GRADE - this appears as a large percentage with grade letter next to the course title (e.g., "Software Testing – INFR10057  78% A3")
2. DO NOT extract individual coursework components (CW1, CW2, Exam scores, etc.) - these are sub-components, not the final grade
3. If a course shows "No final result yet", set confirmed: false and mark: null
4. For courses without a final grade yet, you can optionally include "components" array with the sub-assessments

EUCLID FORMAT:
- Course headers look like: "Course Name – INFRXXXXX    XX% Grade"
- The percentage next to the course name IS the final grade
- Below each course are breakdowns (Coursework, Exam, CW1, CW2) - IGNORE these for the main mark
- Credits appear as "Credits: XX"
- Period shows semester info

Return format:
{
  "modules": [
    {
      "name": "Software Testing",
      "code": "INFR10057",
      "credits": 10,
      "mark": 78,
      "confirmed": true,
      "semester": 1
    },
    {
      "name": "Blockchains and Distributed Ledgers",
      "code": "INFR11144",
      "credits": 10,
      "mark": null,
      "confirmed": false,
      "semester": 1,
      "components": [
        {"name": "Exam", "weight": 70, "mark": null},
        {"name": "Coursework Project", "weight": 30, "mark": 65}
      ]
    }
  ],
  "year": "3" or "4"
}

Key identifiers:
- Year 3 courses: Level 9/10 courses (INFR09xxx, INFR10xxx)
- Year 4 courses: Level 11 courses (INFR11xxx), Honours Project (40 credits)
- Honours Project/Dissertation: INFR10044, always 40 credits
- "No final result yet" = confirmed: false, mark: null`;

// Parse transcript with OpenAI (text/PDF)
app.post('/api/parse-transcript', upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const content = req.file.buffer.toString('utf8');

    const response = await openai.chat.completions.create({
      model: 'gpt-5.2-mini',
      messages: [
        { role: 'system', content: EUCLID_PARSER_PROMPT },
        { role: 'user', content: `Parse this EUCLID transcript. Remember: extract ONLY the final course grade (the big % next to course name), NOT the coursework breakdown.\n\n${content}` }
      ],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    res.json(parsed);

  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ error: 'Failed to parse transcript', details: error.message });
  }
});

// Parse any file (PDF, image) with OpenAI
app.post('/api/parse-transcript-image', upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const base64Data = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // OpenAI supports PDFs and images via the file content type
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
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
              text: 'Parse this EUCLID transcript and return JSON. Extract ONLY the final course grade shown next to each course name (e.g. "78% A3"). Do NOT include individual coursework or exam component marks - only the overall course result.'
            }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    res.json(parsed);

  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ error: 'Failed to parse transcript', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Grade Calculator running at http://localhost:${PORT}`);
});
