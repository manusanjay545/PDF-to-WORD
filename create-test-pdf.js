const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');

async function createPdf() {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    page.drawText('Hello World! This is a valid PDF test file.', {
        x: 50,
        y: height - 100,
        size: 24,
        color: rgb(0, 0.53, 0.71),
    });
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync('test.pdf', pdfBytes);
    console.log('test.pdf created successfully.');
}

createPdf();
