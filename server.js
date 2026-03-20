const express = require('express');
const multer = require('multer');
const compression = require('compression');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Directories
// ---------------------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CONVERTED_DIR = path.join(__dirname, 'converted');
[UPLOAD_DIR, CONVERTED_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: false, // allow inline scripts for analytics
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Clean URL routing
// ---------------------------------------------------------------------------
const pages = {
  '/pdf-to-word': 'index.html',
  '/about': 'about.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
  '/contact': 'contact.html',
};
Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
});

// ---------------------------------------------------------------------------
// Multer configuration
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const id = uuidv4();
    cb(null, `${id}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ---------------------------------------------------------------------------
// Helpers – auto-delete files after 10 minutes
// ---------------------------------------------------------------------------
function scheduleDelete(filePath, delayMs = 10 * 60 * 1000) {
  setTimeout(() => {
    fs.unlink(filePath, () => { }); // ignore errors
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Check if LibreOffice is available
// ---------------------------------------------------------------------------
let libreOfficeAvailable = false;
let libreOfficePath = 'libreoffice';

function detectLibreOffice() {
  return new Promise((resolve) => {
    // Try common Windows paths first
    const windowsPaths = [
      '"C:\\Program Files\\LibreOffice\\program\\soffice.exe"',
      '"C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"',
      'soffice',
      'libreoffice',
    ];

    let checked = 0;
    for (const p of windowsPaths) {
      exec(`${p} --version`, (err) => {
        checked++;
        if (!err && !libreOfficeAvailable) {
          libreOfficeAvailable = true;
          libreOfficePath = p;
          console.log(`✓ LibreOffice found at: ${p}`);
        }
        if (checked === windowsPaths.length && !libreOfficeAvailable) {
          console.log('✗ LibreOffice not found – using fallback text-extraction conversion');
        }
        if (checked === windowsPaths.length) resolve();
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Conversion: LibreOffice (high quality) or fallback (text extraction)
// ---------------------------------------------------------------------------
function convertWithLibreOffice(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const cmd = `${libreOfficePath} --headless --convert-to docx --outdir "${outputDir}" "${inputPath}"`;
    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`LibreOffice conversion failed: ${stderr || err.message}`));
      // LibreOffice outputs file with same base name but .docx extension
      const baseName = path.basename(inputPath, path.extname(inputPath));
      const outputPath = path.join(outputDir, `${baseName}.docx`);
      if (fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error('Conversion completed but output file not found'));
      }
    });
  });
}

async function convertWithFallback(inputPath, outputDir) {
  const pdfParse = require('pdf-parse');
  const docx = require('docx');
  const fs = require('fs');
  const path = require('path');

  const dataBuffer = fs.readFileSync(inputPath);
  let text = '';
  try {
    const data = await pdfParse(dataBuffer);
    text = data.text;
  } catch (err) {
    console.warn('PDF parsing failed (using placeholder text):', err.message);
    text = 'Could not extract text from this PDF. This is a fallback conversion because LibreOffice is not installed.\n\nPlease install LibreOffice on the server for full PDF-to-DOCX conversion that preserves layout and formatting.';
  }

  const paragraphs = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(
      (line) =>
        new docx.Paragraph({
          children: [
            new docx.TextRun({
              text: line,
              size: 24, // 12pt
              font: 'Calibri',
            }),
          ],
          spacing: { after: 120 },
        })
    );

  const doc = new docx.Document({
    sections: [
      {
        properties: {},
        children: paragraphs.length > 0 ? paragraphs : [new docx.Paragraph('Empty Document')],
      },
    ],
  });

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${baseName}.docx`);
  const buffer = await docx.Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// Upload endpoint – accepts multiple files
app.post('/api/upload', (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File size exceeds 50MB limit' });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const fileInfos = req.files.map((f) => {
      scheduleDelete(f.path);
      return {
        id: path.basename(f.filename, path.extname(f.filename)),
        originalName: f.originalname,
        size: f.size,
        filename: f.filename,
      };
    });

    res.json({ files: fileInfos });
  });
});

// Convert endpoint
app.post('/api/convert', async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'No filename provided' });

  // Prevent path traversal
  const safeFilename = path.basename(filename);
  const inputPath = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'File not found. It may have expired.' });
  }

  try {
    let outputPath;
    if (libreOfficeAvailable) {
      outputPath = await convertWithLibreOffice(inputPath, CONVERTED_DIR);
    } else {
      outputPath = await convertWithFallback(inputPath, CONVERTED_DIR);
    }

    scheduleDelete(outputPath);

    const outputFilename = path.basename(outputPath);
    res.json({
      success: true,
      downloadUrl: `/api/download/${outputFilename}`,
      filename: outputFilename,
    });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Conversion failed. Please try again.' });
  }
});

// Batch convert endpoint
app.post('/api/convert-batch', async (req, res) => {
  const { filenames } = req.body;
  if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
    return res.status(400).json({ error: 'No filenames provided' });
  }

  const results = [];
  for (const filename of filenames) {
    const safeFilename = path.basename(filename);
    const inputPath = path.join(UPLOAD_DIR, safeFilename);

    if (!fs.existsSync(inputPath)) {
      results.push({ filename, error: 'File not found' });
      continue;
    }

    try {
      let outputPath;
      if (libreOfficeAvailable) {
        outputPath = await convertWithLibreOffice(inputPath, CONVERTED_DIR);
      } else {
        outputPath = await convertWithFallback(inputPath, CONVERTED_DIR);
      }
      scheduleDelete(outputPath);
      const outputFilename = path.basename(outputPath);
      results.push({
        filename,
        success: true,
        downloadUrl: `/api/download/${outputFilename}`,
        outputFilename,
      });
    } catch (error) {
      results.push({ filename, error: 'Conversion failed' });
    }
  }

  res.json({ results });
});

// Download endpoint
app.get('/api/download/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(CONVERTED_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or expired' });
  }

  // Make the download name user-friendly
  const friendlyName = safeFilename.replace(/^[a-f0-9-]+/, 'converted');
  res.download(filePath, friendlyName);
});

// Download all as ZIP
app.post('/api/download-zip', async (req, res) => {
  const { filenames } = req.body;
  if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
    return res.status(400).json({ error: 'No filenames provided' });
  }

  const archiver = require('archiver');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="converted-files.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  for (const filename of filenames) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(CONVERTED_DIR, safeFilename);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: safeFilename });
    }
  }

  archive.finalize();
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
detectLibreOffice().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 PDF to WORD server running at http://localhost:${PORT}`);
    console.log(`   Conversion engine: ${libreOfficeAvailable ? 'LibreOffice' : 'Fallback (text extraction)'}\n`);
  });
});
