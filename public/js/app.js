/**
 * PDF to WORD – Frontend Application
 * Handles file upload, drag & drop, conversion flow, and downloads.
 */

(function () {
    'use strict';

    // ---- DOM Elements ----
    const uploadBox = document.getElementById('uploadBox');
    const selectBtn = document.getElementById('selectBtn');
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');
    const convertActions = document.getElementById('convertActions');
    const convertBtn = document.getElementById('convertBtn');
    const progressSection = document.getElementById('progressSection');
    const progressFill = document.getElementById('progressFill');
    const progressLabel = document.getElementById('progressLabel');
    const progressPercent = document.getElementById('progressPercent');
    const downloadSection = document.getElementById('downloadSection');
    const downloadBtn = document.getElementById('downloadBtn');
    const downloadZipBtn = document.getElementById('downloadZipBtn');
    const convertAnother = document.getElementById('convertAnother');
    const hamburger = document.getElementById('hamburger');
    const mainNav = document.getElementById('mainNav');
    const navOverlay = document.getElementById('navOverlay');
    const siteHeader = document.getElementById('siteHeader');

    // ---- State ----
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    let selectedFiles = []; // { file, id? }
    let uploadedFiles = []; // { id, originalName, size, filename }
    let convertedFiles = []; // { downloadUrl, outputFilename }

    // ---- Utilities ----
    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function showNotification(message, type = 'error') {
        // Remove existing notification
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.className = `notification ${type}`;
        el.innerHTML = `
      <span>${message}</span>
      <button class="notification-close" aria-label="Close">&times;</button>
    `;
        document.body.appendChild(el);
        el.querySelector('.notification-close').addEventListener('click', () => el.remove());
        setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
    }

    // ---- Analytics helper ----
    function trackEvent(action, label) {
        if (typeof gtag === 'function') {
            gtag('event', action, {
                event_category: 'conversion',
                event_label: label,
            });
        }
    }

    // ---- Header scroll effect ----
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY > 10;
        siteHeader.classList.toggle('scrolled', scrolled);
        lastScroll = window.scrollY;
    }, { passive: true });

    // ---- Mobile nav ----
    hamburger.addEventListener('click', () => {
        const isOpen = mainNav.classList.toggle('open');
        hamburger.classList.toggle('active');
        navOverlay.classList.toggle('visible');
        hamburger.setAttribute('aria-expanded', isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    navOverlay.addEventListener('click', () => {
        mainNav.classList.remove('open');
        hamburger.classList.remove('active');
        navOverlay.classList.remove('visible');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    });

    // ---- Select button click ----
    selectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    uploadBox.addEventListener('click', () => {
        fileInput.click();
    });

    uploadBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });

    // ---- File input change ----
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            addFiles(Array.from(fileInput.files));
        }
        fileInput.value = ''; // reset so re-selecting same file works
    });

    // ---- Drag & Drop ----
    ['dragenter', 'dragover'].forEach((evt) => {
        uploadBox.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadBox.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach((evt) => {
        uploadBox.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadBox.classList.remove('drag-over');
        });
    });

    uploadBox.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer.files);
        addFiles(files);
    });

    // ---- Add files ----
    function addFiles(files) {
        for (const file of files) {
            // Validate type
            if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                showNotification(`"${file.name}" is not a PDF file.`);
                continue;
            }
            // Validate size
            if (file.size > MAX_FILE_SIZE) {
                showNotification(`"${file.name}" exceeds the 50MB size limit.`);
                continue;
            }
            // Avoid duplicates
            if (selectedFiles.some((f) => f.file.name === file.name && f.file.size === file.size)) {
                continue;
            }
            selectedFiles.push({ file });
        }
        renderFileList();
        updateUI();
    }

    // ---- Render file list ----
    function renderFileList() {
        fileList.innerHTML = '';
        selectedFiles.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'file-card';
            card.innerHTML = `
        <div class="file-icon">PDF</div>
        <div class="file-info">
          <div class="file-name" title="${item.file.name}">${item.file.name}</div>
          <div class="file-size">${formatSize(item.file.size)}</div>
        </div>
        <button class="file-remove" data-index="${index}" aria-label="Remove file" title="Remove">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      `;
            fileList.appendChild(card);
        });

        // Remove handlers
        fileList.querySelectorAll('.file-remove').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index, 10);
                selectedFiles.splice(idx, 1);
                renderFileList();
                updateUI();
            });
        });
    }

    // ---- UI state updates ----
    function updateUI() {
        const hasFiles = selectedFiles.length > 0;
        convertActions.classList.toggle('visible', hasFiles);

        // Hide upload box hint parts when files are selected
        if (hasFiles) {
            uploadBox.querySelector('h3').textContent = 'Add more files';
            uploadBox.querySelector('p:not(.upload-hint)').textContent = 'or drag & drop additional PDFs';
        } else {
            uploadBox.querySelector('h3').textContent = 'Drag & drop your PDF files here';
            uploadBox.querySelector('p:not(.upload-hint)').textContent = 'or click to browse your files';
        }
    }

    function setState(state) {
        // states: idle, uploading, converting, done
        const sections = { uploadSection: uploadBox.parentElement };

        uploadBox.style.display = state === 'idle' || state === 'selected' ? '' : 'none';
        fileList.style.display = state === 'idle' || state === 'selected' ? '' : 'none';
        convertActions.style.display = state === 'idle' || state === 'selected' ? '' : 'none';

        progressSection.classList.toggle('visible', state === 'uploading' || state === 'converting');
        downloadSection.classList.toggle('visible', state === 'done');

        if (state === 'uploading') {
            progressLabel.textContent = 'Uploading your files...';
            progressFill.style.width = '0%';
            progressPercent.textContent = '0%';
        } else if (state === 'converting') {
            progressLabel.textContent = 'Converting to Word...';
        }
    }

    // ---- Convert button ----
    convertBtn.addEventListener('click', async () => {
        if (selectedFiles.length === 0) return;

        trackEvent('click', 'convert_button');
        setState('uploading');

        try {
            // 1. Upload files
            const formData = new FormData();
            selectedFiles.forEach((item) => {
                formData.append('files', item.file);
            });

            // Simulate upload progress
            let uploadProgress = 0;
            const uploadInterval = setInterval(() => {
                uploadProgress = Math.min(uploadProgress + Math.random() * 15, 90);
                progressFill.style.width = uploadProgress + '%';
                progressPercent.textContent = Math.round(uploadProgress) + '%';
            }, 200);

            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            clearInterval(uploadInterval);
            progressFill.style.width = '100%';
            progressPercent.textContent = '100%';

            if (!uploadRes.ok) {
                const err = await uploadRes.json();
                throw new Error(err.error || 'Upload failed');
            }

            const uploadData = await uploadRes.json();
            uploadedFiles = uploadData.files;

            // 2. Convert
            setState('converting');
            let convertProgress = 0;
            const convertInterval = setInterval(() => {
                convertProgress = Math.min(convertProgress + Math.random() * 10, 85);
                progressFill.style.width = convertProgress + '%';
                progressPercent.textContent = Math.round(convertProgress) + '%';
            }, 300);

            if (uploadedFiles.length === 1) {
                // Single file
                const convertRes = await fetch('/api/convert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: uploadedFiles[0].filename }),
                });

                clearInterval(convertInterval);

                if (!convertRes.ok) {
                    const err = await convertRes.json();
                    throw new Error(err.error || 'Conversion failed');
                }

                const convertData = await convertRes.json();
                convertedFiles = [convertData];
            } else {
                // Batch conversion
                const convertRes = await fetch('/api/convert-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filenames: uploadedFiles.map((f) => f.filename) }),
                });

                clearInterval(convertInterval);

                if (!convertRes.ok) {
                    const err = await convertRes.json();
                    throw new Error(err.error || 'Conversion failed');
                }

                const convertData = await convertRes.json();
                convertedFiles = convertData.results.filter((r) => r.success);

                if (convertedFiles.length === 0) {
                    throw new Error('All conversions failed');
                }
            }

            progressFill.style.width = '100%';
            progressPercent.textContent = '100%';

            // 3. Show download
            await new Promise((r) => setTimeout(r, 500));
            setState('done');

            // Show ZIP button if multiple files
            downloadZipBtn.style.display = convertedFiles.length > 1 ? 'inline-flex' : 'none';

            trackEvent('conversion', 'success');
        } catch (error) {
            setState('idle');
            updateUI();
            renderFileList();
            showNotification(error.message || 'Something went wrong. Please try again.');
            trackEvent('conversion', 'error');
        }
    });

    // ---- Download ----
    downloadBtn.addEventListener('click', () => {
        if (convertedFiles.length === 0) return;

        trackEvent('click', 'download_button');

        if (convertedFiles.length === 1) {
            window.location.href = convertedFiles[0].downloadUrl;
        } else {
            // Download first file, user can use ZIP for all
            window.location.href = convertedFiles[0].downloadUrl;
        }
    });

    // ---- Download ZIP ----
    downloadZipBtn.addEventListener('click', async () => {
        if (convertedFiles.length === 0) return;
        trackEvent('click', 'download_zip');

        const filenames = convertedFiles.map((f) => f.outputFilename || f.filename);
        const res = await fetch('/api/download-zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filenames }),
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'converted-files.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            showNotification('Failed to download ZIP file.');
        }
    });

    // ---- Convert another ----
    convertAnother.addEventListener('click', () => {
        selectedFiles = [];
        uploadedFiles = [];
        convertedFiles = [];
        renderFileList();
        updateUI();
        setState('idle');
        uploadBox.style.display = '';
        fileList.style.display = '';
        // Reset text
        uploadBox.querySelector('h3').textContent = 'Drag & drop your PDF files here';
        uploadBox.querySelector('p:not(.upload-hint)').textContent = 'or click to browse your files';
    });

    // ---- Initialize ----
    setState('idle');
})();
